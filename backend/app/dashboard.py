"""Dashboard: vânzările zilei în curs, în timp real (comenzile se aduc din Shopify la ~45 de secunde)."""
import asyncio
import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends

from . import profit, shopify
from .auth import get_current_user
from .db import get_db, now_iso

log = logging.getLogger("dashboard")
router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
TZ = ZoneInfo("Europe/Bucharest")


def _z(d: datetime) -> str:
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


async def _state() -> dict:
    return await get_db().settings.find_one({"key": "dashboard"}, {"_id": 0}) or {}


async def _set(**f):
    await get_db().settings.update_one({"key": "dashboard"}, {"$set": f}, upsert=True)


async def loop():
    await asyncio.sleep(60)
    while True:
        try:
            if await shopify._shop():
                now = datetime.now(timezone.utc)
                st = await _state()
                cur = st.get("cursor")
                since = datetime.fromisoformat(cur.replace("Z", "+00:00")) if cur else now - timedelta(hours=2)
                await profit._fetch(f"updated_at:>'{_z(since - timedelta(minutes=2))}'")
                await _set(cursor=_z(now), last_sync=now_iso(), last_error=None)
        except Exception as e:  # noqa: BLE001
            log.error("dashboard: %s", e)
            await _set(last_error=str(e)[:300])
        await asyncio.sleep(45)


def _local(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(TZ)


@router.get("/today")
async def today(_: dict = Depends(get_current_user)):
    db = get_db()
    now = datetime.now(TZ)
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    y_start, y_now = start - timedelta(days=1), now - timedelta(days=1)
    w_start = start - timedelta(days=7)  # aceeași zi săptămâna trecută
    q = {"test": {"$ne": True}}
    orders = await db.profit_orders.find({**q, "created_at": {"$gte": _z(start)}}, {"_id": 0}).sort("created_at", -1).to_list(10000)
    yday = await db.profit_orders.find({**q, "created_at": {"$gte": _z(y_start), "$lt": _z(start)}},
                                       {"_id": 0, "created_at": 1, "total_original": 1, "total": 1, "cancelled": 1}).to_list(10000)
    wk = await db.profit_orders.find({**q, "created_at": {"$gte": _z(w_start), "$lt": _z(w_start + timedelta(days=1))}},
                                     {"_id": 0, "created_at": 1, "total_original": 1, "total": 1, "cancelled": 1}).to_list(10000)

    def val(o):
        return float(o.get("total_original") or o.get("total") or 0)

    live = [o for o in orders if not o.get("cancelled")]
    revenue = sum(val(o) for o in live)
    y_live = [o for o in yday if not o.get("cancelled")]
    y_same = [o for o in y_live if _local(o["created_at"]) <= y_now]

    hours = [{"hour": h, "orders": 0, "revenue": 0.0, "y_orders": 0, "y_revenue": 0.0, "w_orders": 0} for h in range(24)]
    for o in live:
        h = _local(o["created_at"]).hour
        hours[h]["orders"] += 1
        hours[h]["revenue"] += val(o)
    for o in y_live:
        h = _local(o["created_at"]).hour
        hours[h]["y_orders"] += 1
        hours[h]["y_revenue"] += val(o)
    for o in wk:
        if not o.get("cancelled"):
            hours[_local(o["created_at"]).hour]["w_orders"] += 1

    # produse
    vids = {i.get("variant_id") for o in live for i in (o.get("items") or o.get("lines") or []) if i.get("variant_id")}
    info = {v["variant_id"]: v async for v in db.stock_variants.find(
        {"variant_id": {"$in": list(vids)}}, {"_id": 0, "variant_id": 1, "image": 1, "product_title": 1, "variant_title": 1, "on_hand": 1})}
    prod = defaultdict(lambda: {"qty": 0, "orders": 0})
    units = 0
    for o in live:
        seen = set()
        for i in (o.get("items") or o.get("lines") or []):
            if not i.get("variant_id"):
                continue  # livrare prioritară etc.
            k = i["variant_id"]
            p = prod[k]
            p["qty"] += int(i.get("qty") or 0)
            units += int(i.get("qty") or 0)
            if k not in seen:
                p["orders"] += 1
                seen.add(k)
            p.setdefault("title", i.get("title") or i.get("name"))
    top = []
    for k, p in sorted(prod.items(), key=lambda x: (-x[1]["qty"], -x[1]["orders"]))[:10]:
        v = info.get(k, {})
        top.append({"variant_id": k, "title": v.get("product_title") or p["title"], "variant": v.get("variant_title") or "",
                    "image": v.get("image"), "qty": p["qty"], "orders": p["orders"]})

    counties = defaultdict(int)
    for o in live:
        c = ((o.get("ship") or {}).get("county") or "").strip()
        if c:
            counties[c] += 1
    top_counties = [{"county": c, "orders": n} for c, n in sorted(counties.items(), key=lambda x: -x[1])[:8]]

    # confirmări (din modulul de stocuri)
    ids = [o["order_id"] for o in orders]
    confirmed = await db.stock_orders.count_documents({"order_id": {"$in": ids}, "confirmed": True})
    conf_ids = {x["order_id"] async for x in db.stock_orders.find({"order_id": {"$in": ids[:30]}, "confirmed": True}, {"_id": 0, "order_id": 1})}
    awb_today = await db.depot_parcels.count_documents({"emitted_day": now.strftime("%Y-%m-%d"), "cancelled": False})

    feed = []
    for o in orders[:25]:
        its = [i for i in (o.get("items") or o.get("lines") or []) if i.get("variant_id")]
        first = info.get(its[0]["variant_id"], {}) if its else {}
        feed.append({"order_id": o["order_id"], "name": o["name"], "created_at": o["created_at"], "total": val(o),
                     "city": (o.get("ship") or {}).get("city"), "county": (o.get("ship") or {}).get("county"),
                     "customer": ((o.get("ship") or {}).get("name") or "").split(" ")[0],
                     "items": [f"{i['qty']}× {i.get('title') or i.get('name')}" if i["qty"] > 1 else (i.get("title") or i.get("name")) for i in its],
                     "image": first.get("image"), "cancelled": bool(o.get("cancelled")), "confirmed": o["order_id"] in conf_ids})

    best = max(hours, key=lambda h: h["orders"]) if live else None
    st = await _state()
    y_rev_same = sum(val(o) for o in y_same)
    return {
        "now": now.isoformat(), "orders": len(live), "cancelled": len(orders) - len(live), "revenue": round(revenue, 2),
        "aov": round(revenue / len(live), 2) if live else 0, "units": units,
        "y_orders_same": len(y_same), "y_revenue_same": round(y_rev_same, 2),
        "y_orders": len(y_live), "y_revenue": round(sum(val(o) for o in y_live), 2),
        "w_orders": sum(1 for o in wk if not o.get("cancelled")),
        "confirmed": confirmed, "awb_today": awb_today,
        "hours": [{**h, "revenue": round(h["revenue"], 2), "y_revenue": round(h["y_revenue"], 2)} for h in hours],
        "best_hour": {"hour": best["hour"], "orders": best["orders"]} if best and best["orders"] else None,
        "last_hour": sum(1 for o in live if _local(o["created_at"]) >= now - timedelta(hours=1)),
        "top_products": top, "top_counties": top_counties, "feed": feed,
        "last_order_at": orders[0]["created_at"] if orders else None, "last_sync": st.get("last_sync"),
    }
