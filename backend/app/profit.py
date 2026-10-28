"""Modul Profit (doar admin).

Pe fiecare lună (ora României):
  * Vânzări = comenzile LIVRATE în luna respectivă (fulfillment cu status DELIVERED, după data livrării),
    la valoarea curentă a comenzii (după eventualele rambursări / produse scoase).
  * Cost marfă = cantitatea livrată × costul (COGS) din Shopify, fără TVA.
  * Cost coletare = numărul de colete expediate în lună (toate fulfillment-urile, inclusiv cele refuzate
    ulterior) × cost per colet; opțional și ridicările de retur chemate din hub.
  * Reclame Facebook / Google / TikTok, costuri fixe lunare și alte costuri — introduse manual.
  * TVA și impozit (pe profit sau micro) după setări.
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import audit, shopify
from .auth import require_admin
from .db import get_db, now_iso

log = logging.getLogger("profit")
router = APIRouter(prefix="/profit", tags=["Profit"])
TZ = ZoneInfo("Europe/Bucharest")

DEFAULTS = {
    "vat_payer": True, "vat_rate": 21.0,
    "tax_regime": "profit",  # profit | micro | none
    "profit_tax_rate": 16.0, "micro_rate": 1.0,
    "parcel_cost": 0.0, "include_return_pickups": True,
    "fixed_costs": [],  # [{name, amount}]
    "backfill_from": "2026-01",
}

ORDERS_QUERY = """
query P($q: String!, $after: String) {
  orders(first: 40, after: $after, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt cancelledAt test
      currentTotalPriceSet { shopMoney { amount } }
      lineItems(first: 15) { nodes { name sku currentQuantity variant { id } } }
      fulfillments(first: 4) { createdAt status displayStatus deliveredAt }
    }
  }
}
"""


def _tail(gid) -> str:
    return str(gid or "").split("/")[-1]


async def get_settings() -> dict:
    doc = await get_db().settings.find_one({"key": "profit"}, {"_id": 0}) or {}
    return {**DEFAULTS, **doc}


async def _set(**f):
    await get_db().settings.update_one({"key": "profit"}, {"$set": f}, upsert=True)


# ------------------------------------------------------------------ sincronizare comenzi
async def _save(node: dict):
    lines = []
    for li in (node.get("lineItems") or {}).get("nodes") or []:
        q = int(li.get("currentQuantity") or 0)
        if q <= 0:
            continue
        lines.append({"variant_id": _tail((li.get("variant") or {}).get("id")), "qty": q,
                      "name": li.get("name") or "", "sku": li.get("sku") or ""})
    fuls = [{"created_at": f.get("createdAt"), "status": f.get("status"), "display": f.get("displayStatus"),
             "delivered_at": f.get("deliveredAt")} for f in node.get("fulfillments") or []]
    delivered = sorted(f["delivered_at"] for f in fuls if f["delivered_at"] and (f["display"] == "DELIVERED"))
    await get_db().profit_orders.update_one({"order_id": _tail(node["id"])}, {"$set": {
        "order_id": _tail(node["id"]), "name": node["name"], "created_at": node.get("createdAt"),
        "updated_at": node.get("updatedAt"), "cancelled": bool(node.get("cancelledAt")), "test": bool(node.get("test")),
        "total": float(((node.get("currentTotalPriceSet") or {}).get("shopMoney") or {}).get("amount") or 0),
        "lines": lines, "fulfillments": fuls, "delivered_at": delivered[0] if delivered else None,
        "synced_at": now_iso(),
    }}, upsert=True)


async def _fetch(q: str, progress_key: Optional[str] = None) -> int:
    after, n = None, 0
    while True:
        data = await shopify.graphql(ORDERS_QUERY, {"q": q, "after": after})
        conn = data["orders"]
        for node in conn["nodes"]:
            await _save(node)
            n += 1
        if progress_key:
            await _set(**{progress_key: n})
        if not conn["pageInfo"]["hasNextPage"]:
            return n
        after = conn["pageInfo"]["endCursor"]


_lock = asyncio.Lock()


async def sync(full_recent: bool = False) -> dict:
    async with _lock:
        s = await get_settings()
        now = datetime.now(timezone.utc)
        out = {}
        if not s.get("backfill_done_from") or s.get("backfill_done_from") != s["backfill_from"]:
            since = f"{s['backfill_from']}-01T00:00:00+02:00"
            await _set(backfill_running=True, backfill_count=0, backfill_started=now_iso())
            out["backfill"] = await _fetch(f"created_at:>='{since}'", "backfill_count")
            await _set(backfill_running=False, backfill_done_from=s["backfill_from"], backfill_done_at=now_iso(),
                       cursor=now.strftime("%Y-%m-%dT%H:%M:%SZ"), last_recent=now_iso())
            return out
        cursor = s.get("cursor") or now.strftime("%Y-%m-%dT%H:%M:%SZ")
        since = (datetime.fromisoformat(cursor.replace("Z", "+00:00")) - timedelta(minutes=3)).strftime("%Y-%m-%dT%H:%M:%SZ")
        out["updated"] = await _fetch(f"updated_at:>'{since}'")
        await _set(cursor=now.strftime("%Y-%m-%dT%H:%M:%SZ"), last_sync=now_iso(), last_error=None)
        # statusul de livrare nu modifică mereu data comenzii — reîmprospătăm periodic ultimele 40 de zile
        last_recent = s.get("last_recent")
        if full_recent or not last_recent or \
                datetime.fromisoformat(last_recent.replace("Z", "+00:00")) < now - timedelta(hours=4):
            since = (now - timedelta(days=40)).strftime("%Y-%m-%dT%H:%M:%SZ")
            out["recent"] = await _fetch(f"created_at:>'{since}' fulfillment_status:shipped")
            await _set(last_recent=now_iso())
        return out


async def sync_loop():
    await asyncio.sleep(90)
    while True:
        try:
            if await shopify._shop():
                await sync()
        except Exception as e:  # noqa: BLE001
            log.error("sync profit: %s", e)
            await _set(last_error=str(e)[:300], last_error_at=now_iso(), backfill_running=False)
        await asyncio.sleep(600)


# ------------------------------------------------------------------ calcul
def _month_bounds(period: str) -> tuple[str, str]:
    y, m = map(int, period.split("-"))
    start = datetime(y, m, 1, tzinfo=TZ)
    end = datetime(y + (m == 12), m % 12 + 1, 1, tzinfo=TZ)
    f = lambda d: d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # noqa: E731
    return f(start), f(end)


async def _month_inputs(period: str) -> dict:
    doc = await get_db().profit_months.find_one({"period": period}, {"_id": 0}) or {}
    return {"ads_facebook": 0.0, "ads_google": 0.0, "ads_tiktok": 0.0, "other_costs": 0.0, "other_note": "",
            "parcel_cost": None, "fixed_costs": None, **doc}


async def compute(period: str, settings: Optional[dict] = None, detail: bool = False) -> dict:
    db = get_db()
    s = settings or await get_settings()
    inp = await _month_inputs(period)
    a, b = _month_bounds(period)
    vat = float(s["vat_rate"]) / 100
    costs = {v["variant_id"]: v for v in await db.stock_variants.find(
        {}, {"_id": 0, "variant_id": 1, "cost": 1, "product_title": 1, "variant_title": 1, "sku": 1, "untracked": 1}).to_list(50000)}

    # vânzări: comenzile PLASATE în lună care au ajuns la statusul DELIVERED (oricând au fost livrate)
    gross, orders_delivered, cogs_net, missing = 0.0, 0, 0.0, {}
    placed = await db.profit_orders.count_documents({"created_at": {"$gte": a, "$lt": b}, "test": {"$ne": True}})
    async for o in db.profit_orders.find({"created_at": {"$gte": a, "$lt": b}, "delivered_at": {"$ne": None},
                                          "cancelled": False, "test": {"$ne": True}},
                                         {"_id": 0, "total": 1, "lines": 1}):
        orders_delivered += 1
        gross += o["total"]
        for l in o["lines"]:
            if not l["variant_id"]:
                continue  # linii fără produs (ex. Livrare prioritară)
            v = costs.get(l["variant_id"]) or {}
            c = v.get("cost")
            if c is None or float(c) <= 0:
                if v.get("untracked"):
                    continue  # garanții / servicii marcate „nu urmări stocul”
                k = l["variant_id"] or l["name"]
                m = missing.setdefault(k, {"title": v.get("product_title") or l["name"], "sku": v.get("sku") or l["sku"],
                                           "qty": 0, "variant_id": l["variant_id"]})
                m["qty"] += l["qty"]
                continue
            cogs_net += float(c) * l["qty"]

    # colete trimise pentru comenzile plasate în lună (toate, inclusiv cele refuzate ulterior)
    parcels, shipped_orders = 0, 0
    async for o in db.profit_orders.find({"created_at": {"$gte": a, "$lt": b}, "fulfillments.status": "SUCCESS",
                                          "test": {"$ne": True}}, {"_id": 0, "fulfillments": 1}):
        n = sum(1 for f in o["fulfillments"] if f["status"] == "SUCCESS")
        parcels += n
        shipped_orders += 1 if n else 0
    return_pickups = 0
    if s.get("include_return_pickups"):
        a_loc = datetime.fromisoformat(a.replace("Z", "+00:00")).isoformat()
        b_loc = datetime.fromisoformat(b.replace("Z", "+00:00")).isoformat()
        async for sh in db.shipments.find({"ref_type": "return", "status": {"$nin": ["cancelled"]}}, {"_id": 0, "created_at": 1}):
            ca = sh.get("created_at") or ""
            try:
                t = datetime.fromisoformat(ca.replace("Z", "+00:00"))
            except ValueError:
                continue
            if datetime.fromisoformat(a_loc) <= t < datetime.fromisoformat(b_loc):
                return_pickups += 1

    parcel_cost = float(inp["parcel_cost"] if inp["parcel_cost"] is not None else s["parcel_cost"])
    fixed_list = inp["fixed_costs"] if inp["fixed_costs"] is not None else s["fixed_costs"]
    fixed = sum(float(f.get("amount") or 0) for f in fixed_list)
    ads = {"facebook": float(inp["ads_facebook"] or 0), "google": float(inp["ads_google"] or 0),
           "tiktok": float(inp["ads_tiktok"] or 0)}
    ads_total = sum(ads.values())
    other = float(inp["other_costs"] or 0)

    payer = bool(s["vat_payer"])
    revenue = gross / (1 + vat) if payer else gross
    vat_collected = gross - revenue if payer else 0.0
    k = 1.0 if payer else (1 + vat)  # neplătitor: TVA-ul de la furnizori devine cost
    cogs = cogs_net * k
    courier = (parcels + return_pickups) * parcel_cost * k
    ads_cost = ads_total * k
    total_costs = cogs + courier + ads_cost + fixed + other
    pbt = revenue - total_costs
    regime = s["tax_regime"]
    if regime == "profit":
        tax = max(pbt, 0) * float(s["profit_tax_rate"]) / 100
        tax_label = f"Impozit pe profit {float(s['profit_tax_rate']):g}%"
    elif regime == "micro":
        tax = revenue * float(s["micro_rate"]) / 100
        tax_label = f"Impozit micro {float(s['micro_rate']):g}% din venituri"
    else:
        tax, tax_label = 0.0, "Fără impozit"
    net = pbt - tax
    r2 = lambda x: round(x, 2)  # noqa: E731
    out = {
        "period": period, "gross_sales": r2(gross), "revenue": r2(revenue), "vat_collected": r2(vat_collected),
        "orders_delivered": orders_delivered, "orders_placed": placed, "aov": r2(gross / orders_delivered) if orders_delivered else 0,
        "parcels": parcels, "shipped_orders": shipped_orders, "return_pickups": return_pickups,
        "parcel_cost": parcel_cost, "cogs": r2(cogs), "courier": r2(courier), "ads": {k2: r2(v * k) for k2, v in ads.items()},
        "ads_total": r2(ads_cost), "fixed": r2(fixed), "fixed_list": fixed_list, "other": r2(other),
        "other_note": inp.get("other_note") or "", "total_costs": r2(total_costs), "profit_before_tax": r2(pbt),
        "tax": r2(tax), "tax_label": tax_label, "net_profit": r2(net),
        "margin": r2(net / revenue * 100) if revenue else 0,
        "roas": r2(gross / ads_total) if ads_total else None,
        "missing_cost": sorted(missing.values(), key=lambda m: -m["qty"]),
        "inputs": {k2: inp.get(k2) for k2 in ("ads_facebook", "ads_google", "ads_tiktok", "other_costs", "other_note",
                                              "parcel_cost", "fixed_costs")},
        "vat_payer": payer,
    }
    return out


def _periods(n: int = 12) -> list[str]:
    now = datetime.now(TZ)
    y, m = now.year, now.month
    out = []
    for _ in range(n):
        out.append(f"{y}-{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out


# ------------------------------------------------------------------ API
@router.get("/summary")
async def summary(months: int = 12, _: dict = Depends(require_admin)):
    s = await get_settings()
    start = s["backfill_from"]
    periods = [p for p in _periods(months) if p >= start]
    rows = [await compute(p, s) for p in periods]
    for r in rows:
        r.pop("fixed_list", None)
    return {"months": rows, "settings": s, "orders_synced": await get_db().profit_orders.count_documents({})}


@router.get("/month/{period}")
async def month(period: str, _: dict = Depends(require_admin)):
    try:
        _month_bounds(period)
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "Lună invalidă")
    return await compute(period, detail=True)


class FixedCost(BaseModel):
    name: str
    amount: float = Field(ge=0)


class MonthInputs(BaseModel):
    ads_facebook: float = Field(default=0, ge=0)
    ads_google: float = Field(default=0, ge=0)
    ads_tiktok: float = Field(default=0, ge=0)
    other_costs: float = Field(default=0, ge=0)
    other_note: str = ""
    parcel_cost: Optional[float] = Field(default=None, ge=0)
    fixed_costs: Optional[list[FixedCost]] = None


@router.put("/month/{period}")
async def save_month(period: str, body: MonthInputs, request: Request, user: dict = Depends(require_admin)):
    _month_bounds(period)
    data = body.model_dump()
    await get_db().profit_months.update_one({"period": period}, {"$set": {"period": period, **data,
                                                                         "updated_at": now_iso(), "updated_by": user["name"]}},
                                            upsert=True)
    await audit.log(resource_type="profit", resource_id=period, action="profit.month", actor=user, details=data,
                    ip=audit.client_ip(request))
    return await compute(period, detail=True)


class ProfitSettings(BaseModel):
    vat_payer: bool
    vat_rate: float = Field(ge=0, le=50)
    tax_regime: str
    profit_tax_rate: float = Field(ge=0, le=50)
    micro_rate: float = Field(ge=0, le=10)
    parcel_cost: float = Field(ge=0)
    include_return_pickups: bool = True
    fixed_costs: list[FixedCost] = []
    backfill_from: str


@router.put("/settings")
async def save_settings(body: ProfitSettings, request: Request, user: dict = Depends(require_admin)):
    if body.tax_regime not in ("profit", "micro", "none"):
        raise HTTPException(400, "Regim de impozitare invalid")
    try:
        datetime.strptime(body.backfill_from, "%Y-%m")
    except ValueError:
        raise HTTPException(400, "Luna de început trebuie să fie de forma AAAA-LL")
    data = body.model_dump()
    await _set(**data)
    await audit.log(resource_type="settings", resource_id="profit", action="profit.settings", actor=user, details=data,
                    ip=audit.client_ip(request))
    return await get_settings()


@router.post("/sync")
async def manual_sync(_: dict = Depends(require_admin)):
    if _lock.locked():
        raise HTTPException(409, "Sincronizarea comenzilor rulează deja (la prima pornire poate dura câteva minute).")
    asyncio.create_task(_bg_sync())
    return {"ok": True}


async def _bg_sync():
    try:
        await sync(full_recent=True)
    except Exception as e:  # noqa: BLE001
        log.error("sync profit manual: %s", e)
        await _set(last_error=str(e)[:300], last_error_at=now_iso(), backfill_running=False)
