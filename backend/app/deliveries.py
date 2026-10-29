"""Modul Analiza livrări (doar admin).

Sursa: comenzile sincronizate din Shopify de modulul Profit (`profit_orders`), cu AWB-urile lor.
Pentru fiecare colet trimis (fulfillment SUCCESS) stabilim rezultatul:
  * livrat   — statusul Shopify este DELIVERED sau GLS raportează livrarea;
  * refuzat / returnat — GLS raportează refuz (17) sau retur la expeditor (23, 40),
                         ori Shopify îl marchează FAILURE / NOT_DELIVERED;
  * pierdut  — casat / de negăsit / avariat total la GLS;
  * în curs  — încă nu are un rezultat final.
Coletele care nu apar ca livrate în Shopify sunt verificate direct în MyGLS (bucla de urmărire).

Unitatea de analiză este COMANDA (o comandă cu 2 colete — ex. mașină de tuns + accesorii — contează o dată).
Banii pierduți pe o comandă refuzată = colete × (curier dus + curier retur + coletare) + costul reclamei pentru
o comandă (CPA-ul lunii: reclame / comenzi plasate), toate fără TVA.
"""
import asyncio
import logging
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import audit, gls, shopify
from .auth import require_admin
from .db import get_db, now_iso
from .normalize import normalize_phone_ro

log = logging.getLogger("deliveries")
router = APIRouter(prefix="/livrari", tags=["Analiza livrari"])
TZ = ZoneInfo("Europe/Bucharest")

DEFAULTS = {"shipping_cost": None, "packing_cost": None, "return_cost": 0.0, "include_ads": True, "stale_days": 30}

DELIVERED_CODES = {5, 54, 55, 58, 92, 93}
RETURN_CODES = {23, 40}
REFUSED_CODE = 17
LOST_CODES = {28, 42, 43, 31}
FINAL_OUTCOMES = {"delivered", "returned", "lost"}
TRACK_WINDOW_DAYS = 75   # după atâtea zile nu mai reverificăm un colet fără rezultat
MIN_AGE_HOURS = 18       # coletele foarte noi nu au încă ce urmări
RECHECK_HOURS = 6

VALUE_BUCKETS = [(0, 100, "sub 100 lei"), (100, 200, "100–200 lei"), (200, 300, "200–300 lei"),
                 (300, 500, "300–500 lei"), (500, 10 ** 9, "peste 500 lei")]


def _dt(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _z(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ------------------------------------------------------------------ setări
async def get_settings() -> dict:
    doc = await get_db().settings.find_one({"key": "delivery_analysis"}, {"_id": 0}) or {}
    return {**DEFAULTS, **{k: v for k, v in doc.items() if k != "key"}}


async def _set(**f):
    await get_db().settings.update_one({"key": "delivery_analysis"}, {"$set": f}, upsert=True)


# ------------------------------------------------------------------ clasificare GLS
def classify(codes: list[int]) -> tuple[str, Optional[str]]:
    """Din codurile GLS (în ordine cronologică) -> (rezultat, motiv)."""
    s = set(codes)
    if s & RETURN_CODES or REFUSED_CODE in s:
        if REFUSED_CODE in s:
            reason = "Refuzat de client"
        elif s & {18, 20}:
            reason = "Adresă greșită / incompletă"
        elif s & {11, 12, 14, 15}:
            reason = "Destinatar absent / de negăsit"
        else:
            reason = "Returnat (fără motiv în GLS)"
        # livrat DUPĂ un refuz, fără retur la expeditor => s-a livrat până la urmă
        if not (s & RETURN_CODES) and s & DELIVERED_CODES:
            last_ref = max(i for i, c in enumerate(codes) if c == REFUSED_CODE)
            if any(c in DELIVERED_CODES for c in codes[last_ref + 1:]):
                return "delivered", None
        return "returned", reason
    if s & DELIVERED_CODES:
        return "delivered", None
    if s & LOST_CODES:
        return "lost", "Pierdut / avariat la GLS"
    return "in_progress", None


async def _track_one(awb: str):
    db = get_db()
    try:
        t = await gls.tracking(awb)
        codes = [e["code"] for e in t["events"]]
        outcome, reason = classify(codes)
        await db.delivery_tracking.update_one({"awb": awb}, {"$set": {
            "awb": awb, "outcome": outcome, "reason": reason, "codes": codes,
            "last_code": t.get("status_code"), "last_desc": t.get("status_description"),
            "last_event_at": t.get("last_event_at"), "checked_at": now_iso(), "error": None,
        }}, upsert=True)
    except gls.GlsError as e:
        await db.delivery_tracking.update_one({"awb": awb}, {"$set": {
            "awb": awb, "checked_at": now_iso(), "error": str(e)[:200]}, "$setOnInsert": {"outcome": "unknown"}},
            upsert=True)


_lock = asyncio.Lock()


async def track_run() -> dict:
    """Verifică în MyGLS coletele care nu apar ca livrate în Shopify și nu au încă un rezultat final."""
    if not gls.configured():
        return {"skipped": "GLS neconfigurat"}
    if _lock.locked():
        return {"skipped": "rulează deja"}
    async with _lock:
        db = get_db()
        now = datetime.now(timezone.utc)
        known = {t["awb"]: t async for t in db.delivery_tracking.find(
            {}, {"_id": 0, "awb": 1, "outcome": 1, "checked_at": 1})}
        todo: list[tuple[datetime, str]] = []
        async for o in db.profit_orders.find({"fulfillments.status": "SUCCESS", "test": {"$ne": True}},
                                             {"_id": 0, "fulfillments": 1}):
            for f in o.get("fulfillments") or []:
                if f.get("status") != "SUCCESS" or f.get("display") == "DELIVERED":
                    continue
                created = _dt(f.get("created_at"))
                if not created or now - created < timedelta(hours=MIN_AGE_HOURS):
                    continue
                for awb in f.get("awbs") or []:
                    t = known.get(awb)
                    if t is None:
                        todo.append((created, awb))
                    elif t.get("outcome") not in FINAL_OUTCOMES and now - created < timedelta(days=TRACK_WINDOW_DAYS):
                        ch = _dt(t.get("checked_at"))
                        if not ch or now - ch > timedelta(hours=RECHECK_HOURS):
                            todo.append((created, awb))
        todo = sorted(set(todo), reverse=True)  # cele mai noi întâi
        await _set(tracking_running=True, tracking_total=len(todo), tracking_done=0, tracking_started=now_iso())
        sem = asyncio.Semaphore(3)
        done = 0

        async def one(awb):
            nonlocal done
            async with sem:
                await _track_one(awb)
                await asyncio.sleep(0.3)
            done += 1
            if done % 25 == 0:
                await _set(tracking_done=done)

        try:
            for i in range(0, len(todo), 30):
                await asyncio.gather(*(one(a) for _, a in todo[i:i + 30]))
        finally:
            await _set(tracking_running=False, tracking_done=done, tracking_last_run=now_iso())
        return {"checked": done}


async def tracking_loop():
    await _set(tracking_running=False)  # o rulare întreruptă de o repornire nu mai rulează
    await asyncio.sleep(180)
    while True:
        try:
            await track_run()
        except Exception as e:  # noqa: BLE001
            log.error("urmărire livrări: %s", e)
            await _set(tracking_running=False, tracking_error=str(e)[:300], tracking_error_at=now_iso())
        await asyncio.sleep(3 * 3600)


# ------------------------------------------------------------------ calcul pe comenzi
async def _context(settings: dict) -> dict:
    db = get_db()
    p = await db.settings.find_one({"key": "profit"}, {"_id": 0}) or {}
    ship = settings["shipping_cost"] if settings.get("shipping_cost") is not None else float(p.get("shipping_cost") or 0)
    pack = settings["packing_cost"] if settings.get("packing_cost") is not None else float(p.get("parcel_cost") or 0)
    untracked = {v["variant_id"] async for v in db.stock_variants.find({"untracked": True}, {"_id": 0, "variant_id": 1})}
    titles = {v["variant_id"]: v.get("product_title") async for v in db.stock_variants.find(
        {}, {"_id": 0, "variant_id": 1, "product_title": 1})}
    # CPA pe lună = reclame (fără TVA) / comenzi plasate în lună — aceeași numărătoare ca în modulul Profit
    from .profit import _month_bounds
    cpa = {}
    async for m in db.profit_months.find({}, {"_id": 0}):
        ads = sum(float(m.get(k) or 0) for k in ("ads_facebook", "ads_google", "ads_tiktok"))
        if not ads:
            continue
        a, b = _month_bounds(m["period"])
        n = await db.profit_orders.count_documents({"created_at": {"$gte": a, "$lt": b}, "test": {"$ne": True}})
        if n:
            cpa[m["period"]] = ads / n
    return {"ship": float(ship), "pack": float(pack), "ret": float(settings.get("return_cost") or 0),
            "include_ads": bool(settings.get("include_ads")), "stale_days": int(settings.get("stale_days") or 30),
            "untracked": untracked, "titles": titles, "cpa": cpa}


def _local_month(d: datetime) -> str:
    return d.astimezone(TZ).strftime("%Y-%m")


def _order_rec(o: dict, trk: dict, ctx: dict, now: datetime) -> Optional[dict]:
    fs = [f for f in o.get("fulfillments") or [] if f.get("status") == "SUCCESS"]
    if not fs:
        return None
    ship_at = min((_dt(f.get("created_at")) for f in fs if _dt(f.get("created_at"))), default=None)
    if not ship_at:
        return None
    parcels, outs, reasons, awbs = 0, [], [], []
    for f in fs:
        fa = f.get("awbs") or []
        parcels += max(1, len(fa))
        awbs += fa
        if f.get("display") == "DELIVERED":
            outs.append("delivered")
            continue
        res = [trk.get(a) for a in fa if trk.get(a)]
        r_out = [t.get("outcome") for t in res]
        if "returned" in r_out:
            outs.append("returned")
            reasons += [t.get("reason") for t in res if t.get("outcome") == "returned" and t.get("reason")]
        elif "delivered" in r_out:
            outs.append("delivered")
        elif "lost" in r_out:
            outs.append("lost")
            reasons.append("Pierdut / avariat la GLS")
        elif f.get("display") in ("FAILURE", "NOT_DELIVERED"):
            outs.append("returned")
            reasons.append("Marcat nelivrat în Shopify")
        else:
            outs.append("in_progress")
    if "delivered" in outs:
        outcome = "delivered"
    elif "returned" in outs:
        outcome = "returned"
    elif "lost" in outs:
        outcome = "lost"
    else:
        outcome = "stale" if now - ship_at > timedelta(days=ctx["stale_days"]) else "in_progress"

    # produse (cantitățile inițiale; garanțiile / serviciile marcate „nu urmări stocul” nu contează)
    prods: dict[str, int] = {}
    for li in o.get("items") or o.get("lines") or []:
        vid = li.get("variant_id")
        if not vid or vid in ctx["untracked"]:
            continue
        t = ctx["titles"].get(vid) or li.get("title") or li.get("name") or "(fără nume)"
        prods[t] = prods.get(t, 0) + int(li.get("qty") or 0)

    loss, parts = 0.0, {}
    if outcome in ("returned", "lost"):
        parts = {"courier": parcels * ctx["ship"], "return": parcels * ctx["ret"], "packing": parcels * ctx["pack"],
                 "ads": ctx["cpa"].get(_local_month(_dt(o.get("created_at")) or ship_at), 0.0) if ctx["include_ads"] else 0.0}
        loss = sum(parts.values())
    ship_info = o.get("ship") or {}
    value = float(o.get("total_original") or o.get("total") or 0)
    return {
        "order_id": o.get("order_id"), "name": o.get("name"), "created_at": o.get("created_at"),
        "ship_at": ship_at.isoformat(), "month": _local_month(ship_at), "outcome": outcome,
        "reason": (reasons[0] if reasons else None), "parcels": parcels, "awbs": awbs, "value": round(value, 2),
        "county": (ship_info.get("county") or "").strip() or "Necunoscut", "city": ship_info.get("city") or "",
        "customer": ship_info.get("name") or "", "phone": normalize_phone_ro(ship_info.get("phone")),
        "products": prods, "loss": round(loss, 2), "loss_parts": {k: round(v, 2) for k, v in parts.items()},
    }


async def _records(a: str, b: str, ctx: dict) -> list[dict]:
    """Comenzile expediate (primul colet) între a și b (UTC, ISO cu Z)."""
    db = get_db()
    orders = await db.profit_orders.find(
        {"fulfillments": {"$elemMatch": {"status": "SUCCESS", "created_at": {"$gte": a, "$lt": b}}},
         "test": {"$ne": True}},
        {"_id": 0, "order_id": 1, "name": 1, "created_at": 1, "total": 1, "total_original": 1, "lines": 1,
         "items": 1, "fulfillments": 1, "ship": 1}).to_list(None)
    awbs = list({x for o in orders for f in o.get("fulfillments") or [] for x in (f.get("awbs") or [])})
    trk = {}
    for i in range(0, len(awbs), 5000):
        async for t in db.delivery_tracking.find({"awb": {"$in": awbs[i:i + 5000]}}, {"_id": 0}):
            trk[t["awb"]] = t
    now = datetime.now(timezone.utc)
    da, db_ = _dt(a), _dt(b)
    out = []
    for o in orders:
        r = _order_rec(o, trk, ctx, now)
        if r and da <= _dt(r["ship_at"]) < db_:  # data primului colet trebuie să fie în interval
            out.append(r)
    return out


def _empty():
    return {"orders": 0, "delivered": 0, "returned": 0, "lost": 0, "in_progress": 0, "stale": 0, "loss": 0.0,
            "value_returned": 0.0}


def _add(acc: dict, r: dict, share: float = 1.0):
    acc["orders"] += 1
    acc[r["outcome"]] += 1
    if r["outcome"] in ("returned", "lost"):
        acc["loss"] += r["loss"] * share
        acc["value_returned"] += r["value"] * share


def _finish(acc: dict) -> dict:
    final = acc["delivered"] + acc["returned"] + acc["lost"]
    acc["rate"] = round(acc["delivered"] / final * 100, 1) if final else None
    acc["refusal_rate"] = round((acc["returned"] + acc["lost"]) / final * 100, 1) if final else None
    acc["loss"] = round(acc["loss"], 2)
    acc["value_returned"] = round(acc["value_returned"], 2)
    return acc


def _bounds(frm: str, to: str) -> tuple[str, str]:
    try:
        d1, d2 = date.fromisoformat(frm), date.fromisoformat(to)
    except ValueError:
        raise HTTPException(400, "Interval invalid (AAAA-LL-ZZ)")
    if d2 < d1:
        raise HTTPException(400, "Data de final este înaintea celei de început")
    a = datetime(d1.year, d1.month, d1.day, tzinfo=TZ)
    b = datetime(d2.year, d2.month, d2.day, tzinfo=TZ) + timedelta(days=1)
    return _z(a), _z(b)


async def _status() -> dict:
    s = await get_settings()
    p = await get_db().settings.find_one({"key": "profit"}, {"_id": 0}) or {}
    from .profit import QUERY_VERSION
    return {
        "gls_configured": gls.configured(),
        "tracking_running": bool(s.get("tracking_running")), "tracking_total": s.get("tracking_total") or 0,
        "tracking_done": s.get("tracking_done") or 0, "tracking_last_run": s.get("tracking_last_run"),
        "tracking_error": s.get("tracking_error"),
        "orders_backfill_running": bool(p.get("backfill_running")), "orders_backfill_count": p.get("backfill_count") or 0,
        "orders_have_awbs": p.get("query_version") == QUERY_VERSION, "orders_last_sync": p.get("last_sync"),
        "tracked_awbs": await get_db().delivery_tracking.count_documents({}),
    }


# ------------------------------------------------------------------ API
@router.get("/summary")
async def summary(frm: str, to: str, _: dict = Depends(require_admin)):
    a, b = _bounds(frm, to)
    s = await get_settings()
    ctx = await _context(s)
    recs = await _records(a, b, ctx)

    tot = _empty()
    parts = defaultdict(float)
    reasons = Counter()
    products: dict[str, dict] = defaultdict(_empty)
    counties: dict[str, dict] = defaultdict(_empty)
    buckets: dict[str, dict] = {lab: _empty() for _, _, lab in VALUE_BUCKETS}
    phones: dict[str, dict] = {}
    parcels = 0
    for r in recs:
        _add(tot, r)
        parcels += r["parcels"]
        if r["outcome"] in ("returned", "lost"):
            reasons[r["reason"] or "Returnat (fără motiv)"] += 1
            for k, v in r["loss_parts"].items():
                parts[k] += v
        n = len(r["products"]) or 1
        for t in r["products"]:
            _add(products[t], r, 1 / n)
        _add(counties[r["county"]], r)
        for lo, hi, lab in VALUE_BUCKETS:
            if lo <= r["value"] < hi:
                _add(buckets[lab], r)
                break
        if r["phone"]:
            c = phones.setdefault(r["phone"], {"phone": r["phone"], "customer": r["customer"], "county": r["county"],
                                               "orders": 0, "delivered": 0, "returned": 0, "loss": 0.0, "last": []})
            c["orders"] += 1
            if r["outcome"] == "delivered":
                c["delivered"] += 1
            if r["outcome"] in ("returned", "lost"):
                c["returned"] += 1
                c["loss"] += r["loss"]
                c["last"].append(r["name"])

    _finish(tot)
    tot["parcels"] = parcels
    tot["loss_parts"] = {k: round(v, 2) for k, v in parts.items()}
    refused_n = tot["returned"] + tot["lost"]
    tot["avg_loss"] = round(tot["loss"] / refused_n, 2) if refused_n else 0
    repeat = sorted((dict(c, loss=round(c["loss"], 2), last=c["last"][-10:]) for c in phones.values() if c["returned"] >= 2),
                    key=lambda c: (-c["returned"], -c["loss"]))
    refused = sorted((r for r in recs if r["outcome"] in ("returned", "lost")), key=lambda r: r["ship_at"], reverse=True)
    pending = sorted((r for r in recs if r["outcome"] == "stale"), key=lambda r: r["ship_at"])
    shop = (await shopify._shop()).replace(".myshopify.com", "")
    return {
        "from": frm, "to": to, "totals": tot,
        "reasons": [{"reason": k, "count": v} for k, v in reasons.most_common()],
        "products": sorted(({"title": k, **_finish(v)} for k, v in products.items()), key=lambda x: -x["loss"]),
        "counties": sorted(({"county": k, **_finish(v)} for k, v in counties.items()), key=lambda x: -x["loss"]),
        "buckets": [{"bucket": k, **_finish(v)} for k, v in buckets.items()],
        "repeat_customers": repeat[:100],
        "refused": refused[:1000], "stale": pending[:300],
        "costs": {"ship": ctx["ship"], "return": ctx["ret"], "pack": ctx["pack"], "include_ads": ctx["include_ads"],
                  "cpa": {k: round(v, 2) for k, v in ctx["cpa"].items()}},
        "shop_store": shop, "status": await _status(), "settings": s,
    }


@router.get("/trend")
async def trend(months: int = 12, _: dict = Depends(require_admin)):
    now = datetime.now(TZ)
    y, m = now.year, now.month
    for _ in range(max(1, min(months, 24)) - 1):
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    a = _z(datetime(y, m, 1, tzinfo=TZ))
    b = _z(now + timedelta(days=1))
    ctx = await _context(await get_settings())
    recs = await _records(a, b, ctx)
    by = defaultdict(_empty)
    for r in recs:
        _add(by[r["month"]], r)
    return {"months": [{"period": k, **_finish(v)} for k, v in sorted(by.items(), reverse=True)]}


@router.get("/status")
async def status(_: dict = Depends(require_admin)):
    return await _status()


class DeliverySettings(BaseModel):
    shipping_cost: Optional[float] = Field(default=None, ge=0)
    packing_cost: Optional[float] = Field(default=None, ge=0)
    return_cost: float = Field(default=0, ge=0)
    include_ads: bool = True
    stale_days: int = Field(default=30, ge=7, le=120)


@router.put("/settings")
async def save_settings(body: DeliverySettings, request: Request, user: dict = Depends(require_admin)):
    data = body.model_dump()
    await _set(**data)
    await audit.log(resource_type="settings", resource_id="delivery_analysis", action="delivery_analysis.settings",
                    actor=user, details=data, ip=audit.client_ip(request))
    return await get_settings()


@router.post("/track")
async def manual_track(_: dict = Depends(require_admin)):
    if not gls.configured():
        raise HTTPException(400, "GLS nu este configurat (Setări → Integrări)")
    if _lock.locked():
        raise HTTPException(409, "Verificarea AWB-urilor rulează deja")
    asyncio.create_task(_bg())
    return {"ok": True}


async def _bg():
    try:
        await track_run()
    except Exception as e:  # noqa: BLE001
        log.error("urmărire manuală: %s", e)
        await _set(tracking_running=False, tracking_error=str(e)[:300], tracking_error_at=now_iso())
