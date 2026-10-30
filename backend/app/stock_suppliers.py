"""Necesar furnizori: lista de furnizori cu produsele lor și ce trebuie comandat.

  * Lipsă acum      = rezervat − în depozit (dacă e pozitiv)
  * Estimare N zile = bucățile comandate în ultimele N zile (comenzi neanulate), proiectate pe următoarele N zile
  * De comandat     = rezervat + estimare − în depozit (dacă e pozitiv)
"""
import math
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import audit
from .auth import get_current_user
from .db import get_db, new_id, now_iso
from .stock import NOT_BUNDLE, STOCK_STATUSES, _candidates, _row, _variant, reserved_map

router = APIRouter(prefix="/stock/suppliers", tags=["Necesar furnizori"])
WINDOW_DAYS = 3  # se uită la ultimele 3 zile și estimează următoarele 3


async def sold_last(days: int) -> dict[str, int]:
    """Bucăți comandate în ultimele `days` zile, pe produs (pachetele se descompun în componente)."""
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out: dict[str, int] = {}
    cache: dict[str, Optional[dict]] = {}
    async for o in get_db().stock_orders.find({"created_at": {"$gte": since}, "cancelled": {"$ne": True}},
                                              {"_id": 0, "lines": 1}):
        for l in o.get("lines") or []:
            vid, q = l["variant_id"], int(l.get("qty") or 0)
            if vid not in cache:
                cache[vid] = await _variant(vid)
            comps = (cache[vid] or {}).get("bundle") or []
            if comps:
                for c in comps:
                    pid = _candidates(c)[0]
                    out[pid] = out.get(pid, 0) + int(c["qty"]) * q
            else:
                out[vid] = out.get(vid, 0) + q
    return out


def _need_row(v: dict, reserved: dict, sold: dict) -> dict:
    r = _row(v, reserved)
    s = sold.get(v["variant_id"], 0)
    forecast = s  # aceeași perioadă înainte: ultimele 3 zile → următoarele 3 zile
    r.update(supplier_id=v.get("supplier_id"), sold_window=s, per_day=round(s / WINDOW_DAYS, 1),
             forecast=forecast, short_now=max(0, r["reserved"] - r["on_hand"]),
             to_order=max(0, r["reserved"] + forecast - max(r["on_hand"], 0)))
    return r


@router.get("")
async def needs(_: dict = Depends(get_current_user)):
    db = get_db()
    sups = await db.stock_suppliers.find({}, {"_id": 0}).sort("name", 1).to_list(500)
    reserved = await reserved_map()
    sold = await sold_last(WINDOW_DAYS)
    vs = await db.stock_variants.find({"status": STOCK_STATUSES, "deleted": {"$ne": True}, "untracked": {"$ne": True},
                                       **NOT_BUNDLE}, {"_id": 0}).to_list(20000)
    rows = [_need_row(v, reserved, sold) for v in vs]
    rows.sort(key=lambda r: (-r["to_order"], -r["short_now"], (r["product_title"] or "").lower()))
    by_sup: dict[str, list] = {}
    unassigned = []
    for r in rows:
        if r["supplier_id"]:
            by_sup.setdefault(r["supplier_id"], []).append(r)
        else:
            unassigned.append(r)
    out = []
    for s in sups:
        items = by_sup.get(s["id"], [])
        out.append({**s, "items": items, "products": len(items),
                    "short_now": sum(i["short_now"] for i in items), "to_order": sum(i["to_order"] for i in items),
                    "lines_to_order": sum(1 for i in items if i["to_order"] > 0)})
    return {"suppliers": out, "unassigned": unassigned, "window_days": WINDOW_DAYS,
            "since": (datetime.now(timezone.utc) - timedelta(days=WINDOW_DAYS)).isoformat()}


class SupplierBody(BaseModel):
    name: str
    cui: Optional[str] = ""
    contact: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    notes: Optional[str] = ""


class AssignBody(BaseModel):
    variant_id: str
    supplier_id: Optional[str] = None  # None = fără furnizor


@router.put("/assign")
async def assign(body: AssignBody, _: dict = Depends(get_current_user)):
    db = get_db()
    if body.supplier_id:
        if not await db.stock_suppliers.find_one({"id": body.supplier_id}):
            raise HTTPException(404, "Furnizor inexistent")
        await db.stock_variants.update_one({"variant_id": body.variant_id}, {"$set": {"supplier_id": body.supplier_id}})
    else:
        await db.stock_variants.update_one({"variant_id": body.variant_id}, {"$unset": {"supplier_id": ""}})
    return {"ok": True}


@router.post("")
async def create_supplier(body: SupplierBody, request: Request, user: dict = Depends(get_current_user)):
    if not body.name.strip():
        raise HTTPException(400, "Scrie numele furnizorului")
    doc = {"id": new_id(), **body.model_dump(), "name": body.name.strip(), "created_at": now_iso(),
           "created_by": user["name"]}
    await get_db().stock_suppliers.insert_one(dict(doc))
    await audit.log(resource_type="stock", resource_id=doc["id"], action="stock.supplier", actor=user,
                    details={"name": doc["name"], "op": "creat"}, ip=audit.client_ip(request))
    return doc


@router.patch("/{sid}")
async def update_supplier(sid: str, body: SupplierBody, user: dict = Depends(get_current_user)):
    if not body.name.strip():
        raise HTTPException(400, "Scrie numele furnizorului")
    r = await get_db().stock_suppliers.update_one({"id": sid}, {"$set": {**body.model_dump(), "name": body.name.strip(),
                                                                       "updated_at": now_iso()}})
    if not r.matched_count:
        raise HTTPException(404, "Furnizor inexistent")
    return {"ok": True}


@router.delete("/{sid}")
async def delete_supplier(sid: str, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.stock_suppliers.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(404, "Furnizor inexistent")
    await db.stock_variants.update_many({"supplier_id": sid}, {"$unset": {"supplier_id": ""}})
    await db.stock_suppliers.delete_one({"id": sid})
    await audit.log(resource_type="stock", resource_id=sid, action="stock.supplier", actor=user,
                    details={"name": s["name"], "op": "șters"}, ip=audit.client_ip(request))
    return {"ok": True}


class ProductsBody(BaseModel):
    add: list[str] = []
    remove: list[str] = []


@router.put("/{sid}/products")
async def set_products(sid: str, body: ProductsBody, _: dict = Depends(get_current_user)):
    db = get_db()
    if not await db.stock_suppliers.find_one({"id": sid}):
        raise HTTPException(404, "Furnizor inexistent")
    if body.add:  # un produs are un singur furnizor: îl mutăm aici
        await db.stock_variants.update_many({"variant_id": {"$in": body.add}}, {"$set": {"supplier_id": sid}})
    if body.remove:
        await db.stock_variants.update_many({"variant_id": {"$in": body.remove}, "supplier_id": sid},
                                            {"$unset": {"supplier_id": ""}})
    return {"ok": True}
