"""Black Friday: ecran special (TV) cu comenzile din perioada campaniei, în timp real."""
import asyncio
import logging
from collections import defaultdict
from decimal import Decimal
from datetime import datetime, timedelta, timezone
from typing import List, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel

from . import audit, profit, shopify
from .auth import get_current_user, require_admin
from .db import get_db, now_iso

log = logging.getLogger("blackfriday")
router = APIRouter(prefix="/blackfriday", tags=["Black Friday"])
TZ = ZoneInfo("Europe/Bucharest")
DEFAULTS = {"start": "2026-11-06T00:00", "end": "2026-11-10T23:59", "title": "BLACK FRIDAY",
            "subtitle": "Reduceri până la 60%", "excluded": []}


def _z(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _local(s: str) -> datetime:
    """'2026-11-06T00:00' (ora României) -> datetime cu fus orar."""
    return datetime.fromisoformat(s).replace(tzinfo=TZ)


async def get_settings() -> dict:
    doc = await get_db().settings.find_one({"key": "blackfriday"}, {"_id": 0}) or {}
    return {**DEFAULTS, **{k: v for k, v in doc.items() if k != "key"}}


async def _set(**f):
    await get_db().settings.update_one({"key": "blackfriday"}, {"$set": f}, upsert=True)


def _period(s: dict):
    a = _local(s["start"])
    b = _local(s["end"]) + timedelta(minutes=1)  # inclusiv minutul de final (23:59:59)
    return a, b


def _initials(name: str) -> str:
    parts = [p for p in (name or "").replace("-", " ").split() if p]
    return " ".join(p[0].upper() + "." for p in parts[:2]) or "—"


def _val(o: dict) -> float:
    return float(o.get("total") or o.get("total_original") or 0)


async def loop():
    """În perioada campaniei aduce comenzile modificate recent la fiecare 20 s (în plus față de dashboard)."""
    await asyncio.sleep(90)
    backfilled = False
    while True:
        try:
            s = await get_settings()
            a, b = _period(s)
            now = datetime.now(timezone.utc)
            if a - timedelta(days=1) <= now <= b + timedelta(days=2) and await shopify._shop():
                if not backfilled:
                    await profit._fetch(f"created_at:>='{_z(a)}'")
                    backfilled = True
                else:
                    await profit._fetch(f"updated_at:>'{_z(now - timedelta(minutes=3))}'")
                await _set(last_sync=now_iso(), last_error=None)
                await asyncio.sleep(20)
                continue
        except Exception as e:  # noqa: BLE001
            log.error("blackfriday: %s", e)
            await _set(last_error=str(e)[:300])
        await asyncio.sleep(60)


@router.get("")
async def board(_: dict = Depends(get_current_user)):
    db = get_db()
    s = await get_settings()
    a, b = _period(s)
    excluded = set(str(x) for x in s.get("excluded") or [])
    orders = await db.profit_orders.find({"test": {"$ne": True}, "created_at": {"$gte": _z(a), "$lt": _z(b)}},
                                         {"_id": 0}).to_list(100000)
    live = [o for o in orders if not o.get("cancelled")]
    shipped = [o for o in live if any(f.get("status") == "SUCCESS" for f in o.get("fulfillments") or [])]

    units = 0
    per = defaultdict(lambda: {"qty": 0, "orders": 0, "name": "", "sku": ""})
    for o in live:
        seen = set()
        for li in o.get("lines") or []:
            vid = str(li.get("variant_id") or "")
            if not vid or vid in excluded:
                continue
            q = int(li.get("qty") or 0)
            units += q
            p = per[vid]
            p["qty"] += q
            p["name"] = p["name"] or li.get("name") or ""
            p["sku"] = p["sku"] or li.get("sku") or ""
            if vid not in seen:
                p["orders"] += 1
                seen.add(vid)
    top_ids = sorted(per, key=lambda k: -per[k]["qty"])[:5]
    imgs = {v["variant_id"]: v for v in await db.stock_variants.find({"variant_id": {"$in": top_ids}},
                                                                      {"_id": 0, "variant_id": 1, "image": 1}).to_list(10)}
    top_products = [{"variant_id": k, **per[k], "image": (imgs.get(k) or {}).get("image")} for k in top_ids]

    big = sorted(live, key=_val, reverse=True)[:3]
    top_orders = [{"name": o.get("name"), "value": _val(o), "initials": _initials((o.get("ship") or {}).get("name")),
                   "city": (o.get("ship") or {}).get("city") or "", "county": (o.get("ship") or {}).get("county") or "",
                   "created_at": o.get("created_at"),
                   "items": sum(int(li.get("qty") or 0) for li in o.get("lines") or [])} for o in big]

    # comenzile pe zile (ora României)
    days = []
    d = a
    while d < b:
        nd = min(d + timedelta(days=1), b)
        n = sum(1 for o in live if _z(d) <= o["created_at"] < _z(nd))
        days.append({"day": d.strftime("%d.%m"), "date": d.date().isoformat(), "start": d.isoformat(), "end": nd.isoformat(), "orders": n})
        d = nd
    # valoarea comenzilor = totalul curent al comenzii (cu TVA, livrare și reduceri; după editări/rambursări), fără cele anulate
    revenue = sum((Decimal(str(o.get("total") or o.get("total_original") or 0)) for o in live), Decimal("0"))
    recent = [{"order_id": o.get("order_id"), "name": o.get("name"), "value": _val(o), "created_at": o.get("created_at")}
              for o in sorted(live, key=lambda o: o.get("created_at") or "", reverse=True)[:10]]

    last = max((o.get("created_at") for o in live), default=None)
    st = await db.settings.find_one({"key": "blackfriday"}, {"_id": 0, "last_sync": 1, "last_error": 1}) or {}
    dash = await db.settings.find_one({"key": "dashboard"}, {"_id": 0, "last_sync": 1}) or {}
    return {"settings": s, "start": a.isoformat(), "end": (b - timedelta(seconds=1)).isoformat(),
            "orders": len(live), "shipped": len(shipped), "units": units, "revenue": float(revenue.quantize(Decimal("0.01"))),
            "recent": recent,
            "cancelled": len(orders) - len(live), "top_products": top_products, "top_orders": top_orders,
            "days": days, "last_order_at": last, "last_sync": st.get("last_sync") or dash.get("last_sync"),
            "last_error": st.get("last_error"), "now": datetime.now(timezone.utc).isoformat()}


@router.get("/products")
async def products(_: dict = Depends(require_admin)):
    """Toate produsele apărute în comenzile din perioadă (pentru lista de excluderi)."""
    db = get_db()
    s = await get_settings()
    a, b = _period(s)
    excluded = set(str(x) for x in s.get("excluded") or [])
    per = {}
    async for o in db.profit_orders.find({"test": {"$ne": True}, "cancelled": {"$ne": True},
                                          "created_at": {"$gte": _z(a), "$lt": _z(b)}}, {"_id": 0, "lines": 1}):
        for li in o.get("lines") or []:
            vid = str(li.get("variant_id") or "")
            if not vid:
                continue
            p = per.setdefault(vid, {"variant_id": vid, "name": li.get("name") or "", "sku": li.get("sku") or "", "qty": 0})
            p["qty"] += int(li.get("qty") or 0)
    # și produsele excluse care (încă) nu au comenzi — ca să poată fi debifate
    for vid in excluded - set(per):
        v = await db.stock_variants.find_one({"variant_id": vid}, {"_id": 0, "product_title": 1, "variant_title": 1, "sku": 1})
        if v:
            per[vid] = {"variant_id": vid, "name": f"{v.get('product_title') or ''}{' — ' + v['variant_title'] if v.get('variant_title') else ''}",
                        "sku": v.get("sku") or "", "qty": 0}
    rows = sorted(per.values(), key=lambda p: (-(p["variant_id"] in excluded), -p["qty"]))
    for r in rows:
        r["excluded"] = r["variant_id"] in excluded
    return {"products": rows, "excluded": sorted(excluded)}


@router.get("/catalog")
async def catalog(q: str = "", _: dict = Depends(require_admin)):
    """Căutare în toate produsele din Shopify (pentru a exclude produse care nu au apărut încă în comenzi)."""
    db = get_db()
    q = (q or "").strip().lower()
    out = []
    async for v in db.stock_variants.find({"deleted": {"$ne": True}}, {"_id": 0, "variant_id": 1, "product_title": 1,
                                                                       "variant_title": 1, "sku": 1}).limit(5000):
        name = f"{v.get('product_title') or ''}{' — ' + v['variant_title'] if v.get('variant_title') else ''}"
        if not q or q in name.lower() or q in (v.get("sku") or "").lower():
            out.append({"variant_id": v["variant_id"], "name": name, "sku": v.get("sku") or ""})
        if len(out) >= 30:
            break
    return {"products": out}


class SettingsIn(BaseModel):
    start: Optional[str] = None
    end: Optional[str] = None
    title: Optional[str] = None
    subtitle: Optional[str] = None
    excluded: Optional[List[str]] = None


@router.put("/settings")
async def put_settings(body: SettingsIn, request: Request, admin: dict = Depends(require_admin)):
    f = {k: v for k, v in body.model_dump().items() if v is not None}
    if "start" in f:
        _local(f["start"])  # validare
    if "end" in f:
        _local(f["end"])
    if "excluded" in f:
        f["excluded"] = sorted({str(x) for x in f["excluded"] if x})
    await _set(**f)
    await audit.log(resource_type="blackfriday", resource_id="settings", action="blackfriday.settings", actor=admin,
                    details=f, ip=audit.client_ip(request))
    return await get_settings()
