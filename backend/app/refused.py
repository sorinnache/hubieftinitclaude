"""Recepție colete refuzate: se scanează AWB-ul de pe colet, iar produsele revin automat în stoc.

Ce revine în stoc = exact ce a plecat pentru acea comandă (din registrul de mișcări: vânzare la AWB,
înlocuitori, produse surpriză). Dacă nu există mișcări (comandă expediată înainte de pornirea stocurilor),
se folosesc produsele din comandă. Fiecare AWB / comandă se recepționează o singură dată.
"""
import re
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from . import audit, profit
from .auth import get_current_user, require_admin
from .db import get_db, new_id, now_iso
from .stock import _title, _variant, move

router = APIRouter(prefix="/stock/refused", tags=["Recepție refuzate"])
TZ = ZoneInfo("Europe/Bucharest")


def _variants_of_code(code: str) -> list[str]:
    """Codul de bare GLS conține AWB-ul (10 cifre) cu zerouri / cifră de control în jur
    (ex. 062545371600 → AWB 6254537160). Încercăm codul întreg și toate secvențele de 10–11 cifre din el."""
    c = re.sub(r"\s+", "", code or "").strip()
    out = [c]
    for digits in re.findall(r"\d+", c):
        out.append(digits)
        out.append(digits.lstrip("0"))
        for n in (10, 11):
            for k in range(0, max(0, len(digits) - n) + 1):
                out.append(digits[k:k + n])
    seen, res = set(), []
    for x in out:
        if x and len(x) >= 6 and x not in seen:
            seen.add(x)
            res.append(x)
    return res


async def _find_order(code: str) -> tuple[Optional[dict], Optional[str]]:
    db = get_db()
    cands = _variants_of_code(code)
    o = await db.profit_orders.find_one({"fulfillments.awbs": {"$in": cands}}, {"_id": 0})
    if o:
        awb = next((a for f in o.get("fulfillments") or [] for a in f.get("awbs") or [] if a in cands), cands[0])
        return o, awb
    p = await db.depot_parcels.find_one({"awb": {"$in": cands}}, {"_id": 0, "order_id": 1, "awb": 1})
    if p:
        o = await db.profit_orders.find_one({"order_id": p["order_id"]}, {"_id": 0})
        if o:
            return o, p["awb"]
    if await db.shipments.find_one({"awb": {"$in": cands}}, {"_id": 1}):
        return None, "retur"
    # nu e încă în hub: căutăm direct în Shopify după numărul AWB (căutarea Shopify include tracking-ul)
    for c in [x for x in cands if x.isdigit() and 10 <= len(x) <= 11][:4]:
        try:
            if await profit._fetch(c):
                o = await db.profit_orders.find_one({"fulfillments.awbs": c}, {"_id": 0})
                if o:
                    return o, c
        except Exception:  # noqa: BLE001
            break
    return None, None


async def _shipped(order_id: str) -> dict[str, int]:
    """Ce a plecat efectiv din depozit pentru comandă, pe produs (net)."""
    out: dict[str, int] = {}
    async for m in get_db().stock_movements.find(
            {"order_id": order_id, "type": {"$in": ["vanzare", "awb_anulat", "inlocuire", "retur", "refuzat"]}},
            {"_id": 0, "variant_id": 1, "delta": 1, "requested": 1, "type": 1}):
        d = int(m["delta"])
        if m["type"] == "vanzare" and m.get("requested") is not None and int(m["requested"]) < 0:
            d = int(m["requested"])  # fizic a plecat cât s-a cerut, chiar dacă sistemul avea mai puțin
        out[m["variant_id"]] = out.get(m["variant_id"], 0) - d
    return {k: v for k, v in out.items() if v > 0}


class ScanBody(BaseModel):
    code: str


@router.post("/scan")
async def scan(body: ScanBody, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    code = (body.code or "").strip()
    if len(code) < 6:
        raise HTTPException(400, "Cod prea scurt — scanează codul de bare al AWB-ului.")
    order, awb = await _find_order(code)
    if awb == "retur":
        raise HTTPException(404, f"AWB {code} e o ridicare de retur chemată din hub, nu un colet refuzat. "
                                 f"Recepționează-l din cererea de retur (status „Produs recepționat”).")
    if not order:
        raise HTTPException(404, f"Nu am găsit nicio comandă cu AWB {code}. Verifică dacă e un colet GLS de la noi "
                                 f"sau introdu AWB-ul manual.")
    prev = await db.refused_scans.find_one({"order_id": order["order_id"], "undone": {"$ne": True}}, {"_id": 0})
    if prev:
        raise HTTPException(409, f"Comanda {order['name']} a fost deja recepționată ca refuzată pe "
                                 f"{datetime.fromisoformat(prev['created_at']).astimezone(TZ).strftime('%d.%m.%Y %H:%M')} "
                                 f"de {prev['by']}. Nu se mai adaugă o dată în stoc.")
    sid = new_id()
    common = dict(ref=order["name"], note=f"Colet refuzat recepționat · AWB {awb}", actor=user["name"],
                  ref_kind="refused", ref_id=sid, order_id=order["order_id"])
    restocked = []
    shipped = await _shipped(order["order_id"])
    if shipped:
        for vid, n in shipped.items():
            for m in await move(vid, n, "refuzat", expand_bundle=False, **common):
                restocked.append(m)
    else:  # comandă expediată înainte de pornirea stocurilor: luăm produsele din comandă
        for it in order.get("items") or order.get("lines") or []:
            if it.get("variant_id") and int(it.get("qty") or 0) > 0:
                restocked += await move(it["variant_id"], int(it["qty"]), "refuzat", **common)
    lines = []
    for m in restocked:
        if not m["delta"]:
            continue
        v = await _variant(m["variant_id"]) or {}
        lines.append({"variant_id": m["variant_id"], "qty": m["delta"], "title": _title(v), "sku": v.get("sku"),
                      "image": v.get("image"), "on_hand_after": m["on_hand_after"], "movement_id": m["id"]})
    doc = {"id": sid, "code": code, "awb": awb, "order_id": order["order_id"], "order_name": order["name"],
           "customer": (order.get("ship") or {}).get("name"), "city": (order.get("ship") or {}).get("city"),
           "lines": lines, "units": sum(l["qty"] for l in lines), "by": user["name"], "created_at": now_iso(),
           "source": "miscari" if shipped else "comanda"}
    await db.refused_scans.insert_one(dict(doc))
    await audit.log(resource_type="stock", resource_id=sid, action="stock.refused", actor=user,
                    details={"order": order["name"], "awb": awb, "units": doc["units"],
                             "items": [f"+{l['qty']} × {l['title']}" for l in lines]}, ip=audit.client_ip(request))
    return doc


@router.get("")
async def list_scans(days: int = 14, _: dict = Depends(get_current_user)):
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    rows = await get_db().refused_scans.find({"created_at": {"$gte": since}}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    today = datetime.now(TZ).strftime("%Y-%m-%d")
    t = [r for r in rows if not r.get("undone") and datetime.fromisoformat(r["created_at"]).astimezone(TZ).strftime("%Y-%m-%d") == today]
    return {"items": rows, "today_parcels": len(t), "today_units": sum(r["units"] for r in t)}


@router.post("/{sid}/undo")
async def undo(sid: str, request: Request, user: dict = Depends(require_admin)):
    db = get_db()
    s = await db.refused_scans.find_one({"id": sid}, {"_id": 0})
    if not s or s.get("undone"):
        raise HTTPException(404, "Recepție inexistentă sau deja anulată")
    for l in s["lines"]:
        await move(l["variant_id"], -int(l["qty"]), "ajustare", ref=s["order_name"], actor=user["name"],
                   note=f"Anulare recepție colet refuzat (AWB {s['awb']}) — scanat din greșeală", expand_bundle=False)
    await db.refused_scans.update_one({"id": sid}, {"$set": {"undone": True, "undone_by": user["name"], "undone_at": now_iso()}})
    await audit.log(resource_type="stock", resource_id=sid, action="stock.refused_undo", actor=user,
                    details={"order": s["order_name"], "awb": s["awb"]}, ip=audit.client_ip(request))
    return {"ok": True}
