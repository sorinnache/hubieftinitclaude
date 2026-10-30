"""Modul Depozit: ritmul de coletare în timp real.

  * AWB emis   = fulfillment creat în Shopify (comanda devine Fulfilled), cu numărul AWB.
  * Preluat    = GLS a scanat coletul (primul eveniment GLS care nu e doar „date înregistrate”).
  * Rămas în depozit = AWB emis, încă nescanat de GLS.
Comenzile se reîmprospătează din Shopify la 2 minute, iar AWB-urile nepreluate se verifică în MyGLS.
"""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from . import gls, profit, shopify
from .auth import get_current_user
from .db import get_db, now_iso
from .stock import _reserve_query

log = logging.getLogger("depot")
router = APIRouter(prefix="/depozit", tags=["Depozit"])
TZ = ZoneInfo("Europe/Bucharest")
CREATED_CODES = {51, 52, 83, 84}  # doar date înregistrate, coletul nu e încă la GLS
LOOKBACK_DAYS = 7


def _dt(s) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        return d if d.tzinfo else d.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _z(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _local_day(s) -> Optional[str]:
    d = _dt(s)
    return d.astimezone(TZ).strftime("%Y-%m-%d") if d else None


async def _state() -> dict:
    return await get_db().settings.find_one({"key": "depot"}, {"_id": 0}) or {}


async def _set(**f):
    await get_db().settings.update_one({"key": "depot"}, {"$set": f}, upsert=True)


# ------------------------------------------------------------------ colete
async def rebuild(days: int = LOOKBACK_DAYS):
    """Construiește lista de colete (un rând per AWB) din comenzile sincronizate."""
    db = get_db()
    since = _z(datetime.now(timezone.utc) - timedelta(days=days))
    async for o in db.profit_orders.find({"fulfillments.created_at": {"$gte": since}, "test": {"$ne": True}},
                                         {"_id": 0, "order_id": 1, "name": 1, "fulfillments": 1, "items": 1,
                                          "lines": 1, "ship": 1, "cancelled": 1}):
        items = [{"title": i.get("name") or i.get("title"), "qty": i["qty"], "sku": i.get("sku")}
                 for i in (o.get("items") or o.get("lines") or [])]
        for f in o.get("fulfillments") or []:
            if (f.get("created_at") or "") < since:
                continue
            for awb in f.get("awbs") or [f"fără-awb-{o['order_id']}-{f.get('created_at')}"]:
                await db.depot_parcels.update_one({"awb": awb}, {
                    "$set": {"awb": awb, "order_id": o["order_id"], "order_name": o["name"],
                             "emitted_at": f.get("created_at"), "emitted_day": _local_day(f.get("created_at")),
                             "cancelled": f.get("status") != "SUCCESS", "items": items,
                             "city": (o.get("ship") or {}).get("city"), "county": (o.get("ship") or {}).get("county"),
                             "customer": (o.get("ship") or {}).get("name"), "has_awb": not awb.startswith("fără-awb"),
                             "delivered_shopify": f.get("display") == "DELIVERED"},
                    "$setOnInsert": {"picked_at": None, "created_at": now_iso()}}, upsert=True)


async def _check_one(p: dict):
    db = get_db()
    upd = {"checked_at": now_iso()}
    try:
        t = await gls.tracking(p["awb"])
        real = [e for e in t["events"] if e["code"] not in CREATED_CODES]
        upd.update(last_code=t.get("status_code"), last_desc=t.get("status_description"), gls_error=None)
        if real:
            upd.update(picked_at=real[0]["at"] or now_iso(), picked_depot=real[0].get("depot"))
    except gls.GlsError as e:
        upd["gls_error"] = str(e)[:200]
    await db.depot_parcels.update_one({"awb": p["awb"]}, {"$set": upd})


async def check_gls():
    """Verifică în MyGLS coletele încă nepreluate (cele de azi mai des, seara la 10 minute)."""
    if not gls.configured():
        return
    db = get_db()
    now = datetime.now(timezone.utc)
    local = now.astimezone(TZ)
    today = local.strftime("%Y-%m-%d")
    every_today = timedelta(minutes=10 if local.hour >= 15 else 20)
    todo = []
    async for p in db.depot_parcels.find({"picked_at": None, "cancelled": False, "has_awb": True,
                                          "delivered_shopify": {"$ne": True},
                                          "emitted_at": {"$gte": _z(now - timedelta(days=5))}}, {"_id": 0}):
        ch = _dt(p.get("checked_at"))
        wait = every_today if p.get("emitted_day") == today else timedelta(minutes=60)
        if not ch or now - ch >= wait:
            todo.append(p)
    sem = asyncio.Semaphore(3)

    async def one(p):
        async with sem:
            await _check_one(p)
            await asyncio.sleep(0.2)
    for i in range(0, len(todo), 30):
        await asyncio.gather(*(one(p) for p in todo[i:i + 30]))
    await _set(last_gls_check=now_iso(), last_gls_count=len(todo))


_lock = asyncio.Lock()


async def tick():
    async with _lock:
        st = await _state()
        now = datetime.now(timezone.utc)
        since = _dt(st.get("cursor")) or (now - timedelta(hours=6))
        await profit._fetch(f"updated_at:>'{_z(since - timedelta(minutes=3))}'")
        await _set(cursor=_z(now), last_sync=now_iso(), last_error=None)
        await rebuild()
        await check_gls()


async def loop():
    await asyncio.sleep(120)
    while True:
        try:
            if await shopify._shop():
                await tick()
        except Exception as e:  # noqa: BLE001
            log.error("depozit: %s", e)
            await _set(last_error=str(e)[:300], last_error_at=now_iso())
        await asyncio.sleep(120)


# ------------------------------------------------------------------ API
def _parcel_view(p: dict, today: str) -> dict:
    return {k: p.get(k) for k in ("awb", "order_id", "order_name", "emitted_at", "emitted_day", "picked_at",
                                  "picked_depot", "last_desc", "customer", "city", "county", "items", "has_awb",
                                  "gls_error")} | {"late": p.get("emitted_day") != today and not p.get("picked_at")}


@router.get("")
async def overview(day: Optional[str] = None, _: dict = Depends(get_current_user)):
    db = get_db()
    now_local = datetime.now(TZ)
    today = now_local.strftime("%Y-%m-%d")
    day = day or today
    st = await _state()

    parcels = await db.depot_parcels.find({"emitted_day": day, "cancelled": False}, {"_id": 0}) \
        .sort("emitted_at", 1).to_list(5000)
    cancelled = await db.depot_parcels.count_documents({"emitted_day": day, "cancelled": True})
    picked = [p for p in parcels if p.get("picked_at")]
    waiting = [p for p in parcels if not p.get("picked_at")]
    # colete din zilele anterioare (ultimele 5) rămase nepreluate — problemă
    old_waiting = await db.depot_parcels.find({"emitted_day": {"$lt": day, "$gte": (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=5)).strftime("%Y-%m-%d")},
                                               "cancelled": False, "picked_at": None, "has_awb": True,
                                               "delivered_shopify": {"$ne": True}}, {"_id": 0}) \
        .sort("emitted_at", 1).to_list(1000)

    # ritm pe ore
    hours = defaultdict(int)
    for p in parcels:
        d = _dt(p["emitted_at"])
        if d:
            hours[d.astimezone(TZ).hour] += 1
    first = min(hours) if hours else None
    last = max(hours) if hours else None
    per_hour = [{"hour": h, "count": hours.get(h, 0)} for h in range(7, 22)]
    elapsed_h = None
    if parcels:
        a = _dt(parcels[0]["emitted_at"])
        b = _dt(parcels[-1]["emitted_at"]) if day != today else datetime.now(timezone.utc)
        elapsed_h = max((b - a).total_seconds() / 3600, 0.25)

    # ce s-a coletat (produse)
    prod = defaultdict(int)
    for p in parcels:
        for it in p.get("items") or []:
            prod[(it.get("title") or "?", it.get("sku") or "")] += int(it.get("qty") or 0)
    products = sorted(({"title": k[0], "sku": k[1], "qty": v} for k, v in prod.items()), key=lambda x: -x["qty"])

    # de lucru: comenzi confirmate încă neexpediate
    rq = await _reserve_query()
    backlog = await db.stock_orders.count_documents(rq)
    oldest = await db.stock_orders.find(rq, {"_id": 0, "created_at": 1, "name": 1}).sort("created_at", 1).limit(1).to_list(1)

    # ultimele 14 zile
    start = (datetime.strptime(today, "%Y-%m-%d") - timedelta(days=13)).strftime("%Y-%m-%d")
    days = defaultdict(lambda: {"emitted": 0, "picked": 0, "same_day": 0, "waiting": 0})
    async for p in db.depot_parcels.find({"emitted_day": {"$gte": start}, "cancelled": False},
                                         {"_id": 0, "emitted_day": 1, "picked_at": 1}):
        dd = days[p["emitted_day"]]
        dd["emitted"] += 1
        if p.get("picked_at"):
            dd["picked"] += 1
            if _local_day(p["picked_at"]) == p["emitted_day"]:
                dd["same_day"] += 1
        else:
            dd["waiting"] += 1
    history = [{"day": d, **days[d]} for d in sorted(days, reverse=True)]

    return {
        "day": day, "today": today, "is_today": day == today,
        "emitted": len(parcels), "picked": len(picked), "waiting": len(waiting), "cancelled": cancelled,
        "orders": len({p["order_id"] for p in parcels}),
        "rate_per_hour": round(len(parcels) / elapsed_h, 1) if elapsed_h else 0,
        "first_at": parcels[0]["emitted_at"] if parcels else None, "last_at": parcels[-1]["emitted_at"] if parcels else None,
        "last_pick_at": max((p["picked_at"] for p in picked), default=None),
        "per_hour": per_hour,
        "waiting_list": [_parcel_view(p, today) for p in waiting],
        "picked_list": [_parcel_view(p, today) for p in sorted(picked, key=lambda p: p["picked_at"], reverse=True)][:300],
        "old_waiting": [_parcel_view(p, today) for p in old_waiting],
        "products": products[:60],
        "backlog": backlog, "backlog_oldest": oldest[0] if oldest else None,
        "history": history,
        "last_sync": st.get("last_sync"), "last_gls_check": st.get("last_gls_check"), "last_error": st.get("last_error"),
        "gls_configured": gls.configured(),
    }


@router.post("/refresh")
async def refresh(_: dict = Depends(get_current_user)):
    if _lock.locked():
        return {"ok": True, "running": True}
    await tick()
    return {"ok": True}
