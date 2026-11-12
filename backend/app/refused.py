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


CASE_LABEL = {"retur": "Retur", "schimb": "Schimb", "service": "Service"}


async def _find_case(code: str) -> Optional[dict]:
    """Coletul scanat ține de o cerere de retur / schimb / service? (aceste produse NU revin în stoc)
    Căutăm: numărul cererii tastat (RET-… / SVC-…), AWB-urile chemate din hub, AWB-urile notate manual."""
    db = get_db()
    c = re.sub(r"\s+", "", code or "").upper()
    for coll, num, typ in (("returns", "return_number", "return"), ("service_requests", "service_number", "service")):
        if re.match(r"^(RET|SVC)-", c):
            d = await db[coll].find_one({num: c, "deleted": {"$ne": True}}, {"_id": 0, "shopify_order": 0})
            if d:
                return {"type": typ, "doc": d, "awb": c, "shipment": None}
    cands = _variants_of_code(code)
    sh = await db.shipments.find_one({"awb": {"$in": cands}}, {"_id": 0, "tracking": 0}) or \
        await db.shipments.find_one({"all_awbs": {"$in": cands}}, {"_id": 0, "tracking": 0})
    if sh:
        coll = "returns" if sh["ref_type"] == "return" else "service_requests"
        d = await db[coll].find_one({"id": sh["ref_id"]}, {"_id": 0, "shopify_order": 0})
        if d:
            return {"type": sh["ref_type"], "doc": d, "awb": sh["awb"], "shipment": sh}
    d = await db.returns.find_one({"awb": {"$in": cands}, "deleted": {"$ne": True}}, {"_id": 0, "shopify_order": 0})
    if d:
        return {"type": "return", "doc": d, "awb": d["awb"], "shipment": None}
    for f in ("awb_inbound", "awb_outbound"):
        d = await db.service_requests.find_one({f: {"$in": cands}, "deleted": {"$ne": True}}, {"_id": 0, "shopify_order": 0})
        if d:
            return {"type": "service", "doc": d, "awb": d[f], "shipment": None}
    return None


async def _case_of_order(order: dict) -> Optional[dict]:
    """Comanda are o cerere de retur/service deschisă? Atunci coletul (chiar cu AWB-ul vechi pe cutie)
    e un retur de la client, nu un colet refuzat — nu se readaugă în stoc."""
    db = get_db()
    n = (order.get("name") or "").lstrip("#")
    if not n:
        return None
    best = None
    for coll, typ in (("returns", "return"), ("service_requests", "service")):
        async for d in db[coll].find({"order_number": {"$in": [n, "#" + n]}, "deleted": {"$ne": True}},
                                     {"_id": 0, "shopify_order": 0}).sort("created_at", -1).limit(1):
            if not best or d.get("created_at", "") > best["doc"].get("created_at", ""):
                best = {"type": typ, "doc": d, "awb": None, "shipment": None}
    return best


async def _scan_case(case: dict, code: str, awb: str, request: Request, user: dict) -> dict:
    db = get_db()
    d, typ = case["doc"], case["type"]
    number = d.get("return_number") or d.get("service_number")
    kind = "service" if typ == "service" else (
        "schimb" if d.get("return_type") == "exchange" or (case.get("shipment") or {}).get("kind") == "exchange" else "retur")
    prev = await db.refused_scans.find_one({"case_id": d["id"], "awb": awb, "undone": {"$ne": True}}, {"_id": 0})
    if prev:
        raise HTTPException(409, f"Coletul pentru {number} a fost deja scanat pe "
                                 f"{datetime.fromisoformat(prev['created_at']).astimezone(TZ).strftime('%d.%m.%Y %H:%M')} "
                                 f"de {prev['by']}.")
    ship = d.get("pickup") or {}
    sid = new_id()
    doc = {"id": sid, "code": code, "awb": awb, "kind": kind, "case_type": typ, "case_id": d["id"], "case_number": number,
           "order_id": None, "order_name": ("#" + str(d["order_number"]).lstrip("#")) if d.get("order_number") else number,
           "customer": d.get("customer_name"), "city": ship.get("city"),
           "case_items": [{"qty": int(i.get("quantity") or 1), "title": i.get("title") or "", "image": i.get("image")}
                          for i in d.get("items") or []],
           "lines": [], "units": 0, "by": user["name"], "created_at": now_iso(), "source": "cerere"}
    await db.refused_scans.insert_one(dict(doc))
    await audit.log(resource_type=typ, resource_id=d["id"], action="parcel_scanned", actor=user,
                    details={"awb": awb, "code": code, "kind": kind}, ip=audit.client_ip(request))
    await audit.log(resource_type="stock", resource_id=sid, action="stock.case_scanned", actor=user,
                    details={"case": number, "awb": awb, "kind": kind}, ip=audit.client_ip(request))
    return doc


class ScanBody(BaseModel):
    code: str


@router.post("/scan")
async def scan(body: ScanBody, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    code = (body.code or "").strip()
    if len(code) < 6:
        raise HTTPException(400, "Cod prea scurt — scanează codul de bare al AWB-ului.")
    # 1) colet de retur / schimb / service — doar se notează, NU intră în stoc
    case = await _find_case(code)
    if case:
        return await _scan_case(case, code, case["awb"], request, user)
    if re.match(r"^(RET|SVC)-", code.upper()):
        raise HTTPException(404, f"Nu există cererea {code.upper()}. Verifică numărul.")
    order, awb = await _find_order(code)
    if not order:
        raise HTTPException(404, f"Nu am găsit nicio comandă cu AWB {code}. Dacă e un colet de retur, schimb sau service, "
                                 f"scrie numărul cererii (ex. RET-2026-00091 sau SVC-2026-00019) și apasă Enter.")
    # 2) AWB de comandă, dar comanda are cerere de retur/service → tot colet de la client, fără stoc
    case = await _case_of_order(order)
    if case:
        return await _scan_case(case, code, awb, request, user)
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
    ref = [r for r in t if not r.get("kind")]
    return {"items": rows, "today_parcels": len(ref), "today_units": sum(r["units"] for r in ref),
            "today_cases": len(t) - len(ref)}


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
    if s.get("case_id"):
        await audit.log(resource_type=s["case_type"], resource_id=s["case_id"], action="parcel_scan_undone", actor=user,
                        details={"awb": s["awb"]}, ip=audit.client_ip(request))
    await audit.log(resource_type="stock", resource_id=sid, action="stock.refused_undo", actor=user,
                    details={"order": s["order_name"], "awb": s["awb"]}, ip=audit.client_ip(request))
    return {"ok": True}
