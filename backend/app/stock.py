"""Modul Stocuri.

Reguli:
  * Produsele (variantele) vin din Shopify. Stocul fizic îl ține hub-ul, nu Shopify.
  * Comandă nouă → nu se întâmplă nimic.
  * Comandă cu tag de confirmare (implicit „confirmata”), neanulată și neexpediată → stoc REZERVAT.
  * Comanda devine Fulfilled (AWB emis) → se SCADE stocul fizic (o singură dată, idempotent).
    Dacă AWB-ul este anulat în Shopify (fulfillment anulat), stocul revine automat.
  * Pachetele se descompun în componente.
  * Retur trecut pe „Produs recepționat” → stocul revine.
  * Fiecare modificare de stoc e o mișcare în registru (cine, când, de ce, sold după).
"""
import asyncio
import logging
import re
import unicodedata
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from . import audit, shopify
from .auth import get_current_user, require_admin
from .db import get_db, new_id, now_iso

log = logging.getLogger("stock")
router = APIRouter(prefix="/stock", tags=["Stocuri"])

DEFAULT_CONFIRM_TAGS = ["confirmata"]
DEFAULT_CANCEL_TAGS = ["anulata", "sms canceled 🔴", "voice canceled 🔴"]
RESERVE_WINDOW_DAYS = 45
# produsele care se văd în stocuri și se numără la inventar: active pe site + draft (nepromovate, dar pot fi în depozit)
STOCK_STATUSES = {"$in": ["ACTIVE", "DRAFT"]}

MOVEMENT_LABELS = {
    "inventar": "Inventar",
    "intrare": "Intrare marfă",
    "vanzare": "Vânzare (AWB emis)",
    "awb_anulat": "AWB anulat — reintrare",
    "retur": "Retur recepționat",
    "refuzat": "Colet refuzat — reintrare",
    "ajustare": "Ajustare manuală",
}


def _tail(gid) -> str:
    return str(gid or "").split("/")[-1]


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", (s or "").strip().lower())
    return "".join(c for c in s if not unicodedata.combining(c))


async def get_settings() -> dict:
    doc = await get_db().settings.find_one({"key": "stock"}, {"_id": 0}) or {}
    doc.setdefault("confirm_tags", DEFAULT_CONFIRM_TAGS)
    doc.setdefault("cancel_tags", DEFAULT_CANCEL_TAGS)
    return doc


async def _set_settings(**fields):
    await get_db().settings.update_one({"key": "stock"}, {"$set": fields}, upsert=True)


def is_bundle(v: Optional[dict]) -> bool:
    """Pachet = bifat manual ca pachet sau cu componente definite. Pachetele nu au stoc propriu și nu se numără."""
    return bool(v) and (bool(v.get("is_bundle")) or bool(v.get("bundle")))


NOT_BUNDLE = {"is_bundle": {"$ne": True}, "bundle": {"$in": [None, []]}}

# ------------------------------------------------------------------ mișcări
async def _variant(vid: str) -> Optional[dict]:
    return await get_db().stock_variants.find_one({"variant_id": vid}, {"_id": 0})


async def expand(vid: str, qty: int) -> list[tuple[str, int]]:
    """Un pachet se descompune în componentele lui."""
    v = await _variant(vid)
    comps = (v or {}).get("bundle") or []
    if comps:
        return [(c["variant_id"], int(c["qty"]) * qty) for c in comps]
    return [(vid, qty)]


async def move(vid: str, delta: int, mtype: str, *, ref: str = "", note: str = "", actor: str = "Sistem",
               ref_kind: str = "", ref_id: str = "", expand_bundle: bool = True) -> list[dict]:
    """Aplică o mișcare de stoc (pachetele se descompun) și o scrie în registru."""
    db = get_db()
    targets = await expand(vid, delta) if expand_bundle else [(vid, delta)]
    out = []
    for tvid, tdelta in targets:
        if not tdelta:
            continue
        v = await db.stock_variants.find_one_and_update(
            {"variant_id": tvid}, {"$inc": {"on_hand": tdelta}, "$set": {"updated_at": now_iso()}},
            return_document=True, projection={"_id": 0})
        if v is None:  # varianta nu e încă sincronizată — o creăm minim
            await db.stock_variants.insert_one({"variant_id": tvid, "product_title": "(variantă necunoscută)",
                                                "variant_title": "", "on_hand": tdelta, "status": "UNKNOWN",
                                                "created_at": now_iso(), "updated_at": now_iso()})
            v = {"on_hand": tdelta, "product_title": "(variantă necunoscută)"}
        m = {"id": new_id(), "variant_id": tvid, "delta": tdelta, "type": mtype, "ref": ref, "note": note,
             "actor": actor, "ref_kind": ref_kind, "ref_id": ref_id, "on_hand_after": v.get("on_hand", 0),
             "via_bundle": tvid != vid, "bundle_variant_id": vid if tvid != vid else None, "created_at": now_iso()}
        await db.stock_movements.insert_one(dict(m))
        out.append(m)
    return out


# ------------------------------------------------------------------ produse
VARIANTS_QUERY = """
query Variants($after: String) {
  productVariants(first: 200, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id title sku%COST%
      media(first: 1) { nodes { preview { image { url } } } }
      product { id title status featuredMedia { preview { image { url } } } }
    }
  }
}
"""


COST_FIELD = "\n      inventoryItem { unitCost { amount } }"


async def _variants_page(after):
    """Cerem și costul (COGS). Dacă aplicația Shopify nu are acces la cost, sincronizăm restul și semnalăm."""
    try:
        data = await shopify.graphql(VARIANTS_QUERY.replace("%COST%", COST_FIELD), {"after": after})
        return data, None
    except Exception as e:  # noqa: BLE001
        if "inventoryItem" not in str(e) and "unitCost" not in str(e) and "access" not in str(e).lower():
            raise
        data = await shopify.graphql(VARIANTS_QUERY.replace("%COST%", ""), {"after": after})
        return data, str(e)[:300]


def _cost(v: dict):
    uc = ((v.get("inventoryItem") or {}).get("unitCost") or {}).get("amount")
    try:
        return round(float(uc), 2) if uc is not None else None
    except (TypeError, ValueError):
        return None


async def sync_products() -> dict:
    db = get_db()
    after, seen, n = None, set(), 0
    cost_error = None
    while True:
        data, err = await _variants_page(after)
        cost_error = cost_error or err
        conn = data["productVariants"]
        for v in conn["nodes"]:
            vid = _tail(v["id"])
            seen.add(vid)
            p = v.get("product") or {}
            vm = ((v.get("media") or {}).get("nodes") or [{}])
            img = (((vm[0] if vm else {}).get("preview") or {}).get("image") or {}).get("url") or \
                  ((((p.get("featuredMedia") or {}).get("preview") or {}).get("image") or {}).get("url"))
            vt = v.get("title") or ""
            await db.stock_variants.update_one({"variant_id": vid}, {
                "$set": {"product_id": _tail(p.get("id")), "product_title": p.get("title") or "",
                         "variant_title": "" if vt == "Default Title" else vt, "sku": v.get("sku") or "",
                         "image": img, "status": p.get("status") or "ACTIVE", "deleted": False,
                         "updated_at": now_iso(), **({} if err else {"cost": _cost(v)})},
                "$setOnInsert": {"on_hand": 0, "created_at": now_iso()},
            }, upsert=True)
            n += 1
        if not conn["pageInfo"]["hasNextPage"]:
            break
        after = conn["pageInfo"]["endCursor"]
    await db.stock_variants.update_many({"variant_id": {"$nin": list(seen)}, "status": {"$ne": "UNKNOWN"}},
                                        {"$set": {"deleted": True}})
    await _set_settings(last_product_sync=now_iso(), cost_error=cost_error)
    return {"variants": n, "cost_error": cost_error}


# ------------------------------------------------------------------ comenzi
ORDERS_QUERY = """
query Orders($q: String!, $after: String) {
  orders(first: 25, after: $after, query: $q, sortKey: UPDATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt updatedAt cancelledAt closed tags displayFulfillmentStatus
      lineItems(first: 30) { nodes { id quantity unfulfilledQuantity variant { id } } }
      fulfillments(first: 5) { createdAt status }
    }
  }
}
"""


async def process_order(node: dict, settings: dict) -> None:
    db = get_db()
    oid = _tail(node["id"])
    tags = [_norm(t) for t in node.get("tags") or []]
    confirm = {_norm(t) for t in settings["confirm_tags"]}
    cancel = {_norm(t) for t in settings["cancel_tags"]}
    cancelled = bool(node.get("cancelledAt")) or any(t in cancel for t in tags)
    confirmed = any(t in confirm for t in tags)
    start_at = settings.get("start_at")
    prev = await db.stock_orders.find_one({"order_id": oid}, {"_id": 0}) or {}
    prev_deducted = {l["line_id"]: l.get("deducted", 0) for l in prev.get("lines", [])}

    # la prima vedere: a fost expediată înainte de pornirea modulului? atunci e deja în inventar
    first_seen = not prev
    shipped_after_start = bool(start_at) and any(
        (f.get("status") or "").upper() == "SUCCESS" and (f.get("createdAt") or "") >= start_at
        for f in node.get("fulfillments") or [])

    lines = []
    for li in (node.get("lineItems") or {}).get("nodes") or []:
        vid = _tail((li.get("variant") or {}).get("id"))
        if not vid:
            continue  # linie fără produs (ex. livrare prioritară, produs șters)
        lid = _tail(li["id"])
        qty = int(li.get("quantity") or 0)
        unfulfilled = int(li.get("unfulfilledQuantity") or 0)
        fulfilled = max(0, qty - unfulfilled)
        deducted = prev_deducted.get(lid)
        if deducted is None:
            if not start_at or (first_seen and not shipped_after_start):
                deducted = fulfilled  # deja reflectat în inventarul inițial
            else:
                deducted = 0
        delta = fulfilled - deducted
        if start_at and delta:
            if delta > 0:
                await move(vid, -delta, "vanzare", ref=node["name"], ref_kind="order", ref_id=oid)
            else:
                await move(vid, -delta, "awb_anulat", ref=node["name"], ref_kind="order", ref_id=oid)
            deducted = fulfilled
        lines.append({"line_id": lid, "variant_id": vid, "qty": qty, "unfulfilled": unfulfilled,
                      "deducted": deducted})

    reserving = confirmed and not cancelled and not node.get("closed") and any(l["unfulfilled"] for l in lines)
    await db.stock_orders.update_one({"order_id": oid}, {"$set": {
        "order_id": oid, "name": node["name"], "created_at": node.get("createdAt"),
        "updated_at": node.get("updatedAt"), "tags": node.get("tags") or [], "confirmed": confirmed,
        "cancelled": cancelled, "shopify_cancelled": bool(node.get("cancelledAt")), "closed": bool(node.get("closed")),
        "fulfillment_status": node.get("displayFulfillmentStatus"),
        "lines": lines, "reserving": reserving, "synced_at": now_iso(),
    }}, upsert=True)


async def _fetch_orders(q: str, settings: dict) -> tuple[int, Optional[str]]:
    after, n, last_updated = None, 0, None
    while True:
        data = await shopify.graphql(ORDERS_QUERY, {"q": q, "after": after})
        conn = data["orders"]
        for node in conn["nodes"]:
            await process_order(node, settings)
            n += 1
            last_updated = max(last_updated or "", node.get("updatedAt") or "")
        if not conn["pageInfo"]["hasNextPage"]:
            break
        after = conn["pageInfo"]["endCursor"]
    return n, last_updated


async def sync_orders() -> dict:
    settings = await get_settings()
    cursor = settings.get("orders_cursor")
    if not cursor:
        since = (datetime.now(timezone.utc) - timedelta(days=RESERVE_WINDOW_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")
        n, last = await _fetch_orders(f"created_at:>'{since}' -fulfillment_status:shipped", settings)
        cursor = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        await _set_settings(orders_cursor=cursor, last_order_sync=now_iso())
        return {"orders": n, "initial": True}
    # suprapunere de 2 minute ca să nu pierdem nimic
    since = (datetime.fromisoformat(cursor.replace("Z", "+00:00")) - timedelta(minutes=2)).strftime("%Y-%m-%dT%H:%M:%SZ")
    n, last = await _fetch_orders(f"updated_at:>'{since}'", settings)
    await _set_settings(orders_cursor=last or cursor, last_order_sync=now_iso())
    return {"orders": n}


_sync_lock = asyncio.Lock()


async def sync_all(products: bool = False) -> dict:
    async with _sync_lock:
        out = {}
        if products:
            out["products"] = await sync_products()
        out["orders"] = await sync_orders()
        # curățenie: comenzile vechi și închise nu mai contează pentru rezervări
        old = (datetime.now(timezone.utc) - timedelta(days=RESERVE_WINDOW_DAYS + 15)).isoformat()
        await get_db().stock_orders.delete_many({"created_at": {"$lt": old}, "reserving": False})
        return out


async def sync_loop():
    await asyncio.sleep(30)
    last_products = 0.0
    while True:
        try:
            if await shopify._shop():
                now = asyncio.get_event_loop().time()
                do_products = now - last_products > 3600
                await sync_all(products=do_products)
                if do_products:
                    last_products = now
        except Exception as e:  # noqa: BLE001
            log.error("sync stocuri: %s", e)
            await _set_settings(last_error=str(e)[:300], last_error_at=now_iso())
        await asyncio.sleep(180)


DEFAULT_RESERVE_DAYS = 30


async def _reserve_query() -> dict:
    """Doar comenzile confirmate, neexpediate și mai noi de N zile (implicit 30) rezervă stoc."""
    s = await get_settings()
    days = int(s.get("reserve_days") or DEFAULT_RESERVE_DAYS)
    since = (datetime.now(timezone.utc) - timedelta(days=days)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"reserving": True, "created_at": {"$gte": since}}


async def reserved_map() -> dict[str, dict]:
    """variant_id -> {qty, orders:[...]} din comenzile confirmate neexpediate."""
    out: dict[str, dict] = {}
    async for o in get_db().stock_orders.find(await _reserve_query(), {"_id": 0}):
        for l in o["lines"]:
            if not l["unfulfilled"]:
                continue
            for vid, q in await expand(l["variant_id"], l["unfulfilled"]):
                r = out.setdefault(vid, {"qty": 0, "orders": []})
                r["qty"] += q
                r["orders"].append({"name": o["name"], "order_id": o["order_id"], "qty": q,
                                    "created_at": o.get("created_at")})
    return out


# ------------------------------------------------------------------ retururi
async def restock_return(ret: dict, actor: dict | None) -> list[dict]:
    """Readaugă în stoc produsele unui retur recepționat (o singură dată)."""
    db = get_db()
    if ret.get("stock_restocked_at"):
        return []
    lines = {}
    o = await db.stock_orders.find_one({"order_id": _tail(ret.get("order_id"))}, {"_id": 0})
    for l in (o or {}).get("lines", []):
        lines[l["line_id"]] = l["variant_id"]
    for li in (ret.get("shopify_order") or {}).get("line_items", []):
        if li.get("variant_id"):
            lines.setdefault(str(li["id"]), li["variant_id"])
    if any(not (i.get("variant_id") or lines.get(str(i.get("line_item_id")))) for i in ret.get("items", [])
           if i.get("product_id")):
        try:  # comandă veche — o cerem din Shopify ca să aflăm variantele
            fresh = await shopify.get_order(ret["order_number"])
            for li in (fresh or {}).get("line_items", []):
                if li.get("variant_id"):
                    lines.setdefault(str(li["id"]), li["variant_id"])
        except Exception as e:  # noqa: BLE001
            log.warning("restock: nu pot citi comanda %s: %s", ret.get("order_number"), e)
    done, skipped = [], []
    for it in ret.get("items", []):
        vid = it.get("variant_id") or lines.get(str(it.get("line_item_id")))
        if not vid:
            if it.get("product_id"):
                skipped.append(it.get("title"))
            continue
        ms = await move(vid, int(it.get("quantity") or 1), "retur", ref=ret.get("return_number", ""),
                        actor=(actor or {}).get("name") or "Sistem", ref_kind="return", ref_id=ret["id"])
        done.extend(ms)
    await db.returns.update_one({"id": ret["id"]}, {"$set": {"stock_restocked_at": now_iso()}})
    if done or skipped:
        await audit.log(resource_type="return", resource_id=ret["id"], action="stock_restocked", actor=actor,
                        details={"items": [f"+{m['delta']} × {m['variant_id']}" for m in done],
                                 "skipped": skipped})
    return done


def is_received_status(name: str) -> bool:
    return "receptionat" in _norm(name)


# ------------------------------------------------------------------ API
def _row(v: dict, reserved: dict) -> dict:
    r = reserved.get(v["variant_id"], {"qty": 0})
    on_hand = int(v.get("on_hand") or 0)
    return {**{k: v.get(k) for k in ("variant_id", "product_id", "product_title", "variant_title", "sku", "image",
                                      "status", "deleted", "bundle", "min_stock", "location", "untracked")},
            "is_bundle": is_bundle(v),
            "on_hand": on_hand, "reserved": r["qty"], "available": on_hand - r["qty"]}


@router.get("/items")
async def list_items(q: Optional[str] = None, view: str = "active", _: dict = Depends(get_current_user)):
    db = get_db()
    # produsele șterse din Shopify nu apar în niciun filtru
    query: dict = {"status": STOCK_STATUSES, "deleted": {"$ne": True}, "untracked": {"$ne": True}}
    if view == "active":
        query = {"status": STOCK_STATUSES, "deleted": {"$ne": True}, "untracked": {"$ne": True}}
    elif view == "untracked":
        query = {"untracked": True, "deleted": {"$ne": True}}
    elif view == "all":
        query = {"deleted": {"$ne": True}}
    if q:
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"product_title": rx}, {"variant_title": rx}, {"sku": rx}]
    variants = await db.stock_variants.find(query, {"_id": 0}).sort([("product_title", 1), ("variant_title", 1)]).to_list(20000)
    reserved = await reserved_map()
    rows = [_row(v, reserved) for v in variants]
    by_id = {r["variant_id"]: r for r in rows}
    # pachetele: disponibil = câte pachete se pot face din componente
    for r in rows:
        comps = r.get("bundle") or []
        if comps:
            avail = []
            for c in comps:
                cv = by_id.get(c["variant_id"]) or _row(await _variant(c["variant_id"]) or {"variant_id": c["variant_id"]}, reserved)
                avail.append(cv["available"] // max(1, int(c["qty"])))
            r["bundle_available"] = min(avail) if avail else 0
    if view == "negative":
        rows = [r for r in rows if r["available"] < 0 and not r["is_bundle"]]
    elif view == "reserved":
        rows = [r for r in rows if r["reserved"] > 0]
    elif view == "bundles":
        rows = [r for r in rows if r["is_bundle"]]
    elif view == "bundles_todo":
        rows = [r for r in rows if r["is_bundle"] and not r.get("bundle")]
    elif view == "products":
        rows = [r for r in rows if not r["is_bundle"]]
    return rows


@router.get("/summary")
async def summary(_: dict = Depends(get_current_user)):
    db = get_db()
    s = await get_settings()
    reserved = await reserved_map()
    total_on_hand = 0
    negative = 0
    count = 0
    async for v in db.stock_variants.find({"status": STOCK_STATUSES, "deleted": {"$ne": True}, "untracked": {"$ne": True},
                                           **NOT_BUNDLE},
                                          {"_id": 0, "variant_id": 1, "on_hand": 1}):
        count += 1
        oh = int(v.get("on_hand") or 0)
        total_on_hand += max(oh, 0)
        if oh - reserved.get(v["variant_id"], {"qty": 0})["qty"] < 0:
            negative += 1
    return {
        "started": bool(s.get("start_at")), "start_at": s.get("start_at"),
        "variants": count, "units_on_hand": total_on_hand,
        "units_reserved": sum(r["qty"] for r in reserved.values()),
        "reserving_orders": await db.stock_orders.count_documents(await _reserve_query()),
        "reserve_days": int(s.get("reserve_days") or DEFAULT_RESERVE_DAYS),
        "negative": negative, "last_order_sync": s.get("last_order_sync"),
        "last_product_sync": s.get("last_product_sync"), "last_error": s.get("last_error"),
        "last_error_at": s.get("last_error_at"),
        "confirm_tags": s["confirm_tags"], "cancel_tags": s["cancel_tags"],
    }


@router.get("/items/{vid}")
async def item_detail(vid: str, _: dict = Depends(get_current_user)):
    db = get_db()
    v = await _variant(vid)
    if not v:
        raise HTTPException(404, "Produs inexistent")
    reserved = await reserved_map()
    row = _row(v, reserved)
    row["reserved_orders"] = reserved.get(vid, {}).get("orders", [])
    row["movements"] = await db.stock_movements.find({"variant_id": vid}, {"_id": 0}).sort("created_at", -1).to_list(300)
    if v.get("bundle"):
        comps = []
        for c in v["bundle"]:
            cv = await _variant(c["variant_id"]) or {}
            comps.append({**c, "product_title": cv.get("product_title"), "variant_title": cv.get("variant_title"),
                          "sku": cv.get("sku"), "image": cv.get("image")})
        row["bundle_components"] = comps
    return row


@router.get("/movements")
async def movements(type: Optional[str] = None, limit: int = 300, _: dict = Depends(get_current_user)):
    db = get_db()
    q = {"type": type} if type else {}
    rows = await db.stock_movements.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, 2000)).to_list(2000)
    ids = list({r["variant_id"] for r in rows})
    names = {v["variant_id"]: v async for v in db.stock_variants.find(
        {"variant_id": {"$in": ids}}, {"_id": 0, "variant_id": 1, "product_title": 1, "variant_title": 1, "sku": 1})}
    for r in rows:
        n = names.get(r["variant_id"], {})
        r["product_title"], r["variant_title"], r["sku"] = n.get("product_title"), n.get("variant_title"), n.get("sku")
    return rows


class CountItem(BaseModel):
    variant_id: str
    counted: int = Field(ge=0)


class InventoryBody(BaseModel):
    items: list[CountItem]
    note: Optional[str] = ""


@router.post("/inventory")
async def save_inventory(body: InventoryBody, request: Request, user: dict = Depends(get_current_user)):
    """Inventar: stocul fizic devine exact cantitatea numărată. Primul inventar pornește urmărirea stocului."""
    db = get_db()
    s = await get_settings()
    changed = 0
    for it in body.items:
        v = await _variant(it.variant_id)
        if not v:
            continue
        if is_bundle(v):
            continue  # pachetele nu au stoc propriu
        delta = it.counted - int(v.get("on_hand") or 0)
        if delta:
            await move(it.variant_id, delta, "inventar", note=body.note or "", actor=user["name"],
                       expand_bundle=False)
            changed += 1
    first = not s.get("start_at")
    if first:
        await _set_settings(start_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    await audit.log(resource_type="stock", resource_id="inventory", action="stock.inventory", actor=user,
                    details={"counted": len(body.items), "changed": changed, "first": first, "note": body.note},
                    ip=audit.client_ip(request))
    return {"ok": True, "changed": changed, "started": first}


class ReceiptItem(BaseModel):
    variant_id: str
    qty: int = Field(gt=0)
    unit_cost: Optional[float] = None


class ReceiptBody(BaseModel):
    supplier: Optional[str] = ""
    document: Optional[str] = ""
    note: Optional[str] = ""
    items: list[ReceiptItem]


@router.post("/receipts")
async def create_receipt(body: ReceiptBody, request: Request, user: dict = Depends(get_current_user)):
    if not body.items:
        raise HTTPException(400, "Adaugă cel puțin un produs")
    db = get_db()
    rid = new_id()
    ref = " · ".join(x for x in [body.supplier, body.document] if x) or "Intrare marfă"
    for it in body.items:
        if not await _variant(it.variant_id):
            raise HTTPException(400, f"Produs inexistent: {it.variant_id}")
    for it in body.items:
        await move(it.variant_id, it.qty, "intrare", ref=ref, note=body.note or "", actor=user["name"],
                   ref_kind="receipt", ref_id=rid, expand_bundle=True)
    doc = {"id": rid, "supplier": body.supplier, "document": body.document, "note": body.note,
           "items": [i.model_dump() for i in body.items], "created_by": user["name"], "created_at": now_iso()}
    await db.stock_receipts.insert_one(dict(doc))
    await audit.log(resource_type="stock", resource_id=rid, action="stock.receipt", actor=user,
                    details={"supplier": body.supplier, "document": body.document,
                             "units": sum(i.qty for i in body.items)}, ip=audit.client_ip(request))
    return doc


@router.get("/receipts")
async def list_receipts(_: dict = Depends(get_current_user)):
    return await get_db().stock_receipts.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)


class AdjustBody(BaseModel):
    variant_id: str
    delta: int
    reason: str


@router.post("/adjust")
async def adjust(body: AdjustBody, request: Request, user: dict = Depends(get_current_user)):
    if not body.delta:
        raise HTTPException(400, "Cantitatea nu poate fi 0")
    if not body.reason.strip():
        raise HTTPException(400, "Scrie motivul ajustării")
    if not await _variant(body.variant_id):
        raise HTTPException(404, "Produs inexistent")
    ms = await move(body.variant_id, body.delta, "ajustare", note=body.reason.strip(), actor=user["name"])
    await audit.log(resource_type="stock", resource_id=body.variant_id, action="stock.adjust", actor=user,
                    details={"delta": body.delta, "reason": body.reason}, ip=audit.client_ip(request))
    return ms


class BundleComp(BaseModel):
    variant_id: str
    qty: int = Field(gt=0)


class BundleBody(BaseModel):
    components: list[BundleComp]


@router.put("/items/{vid}/bundle")
async def set_bundle(vid: str, body: BundleBody, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    v = await _variant(vid)
    if not v:
        raise HTTPException(404, "Produs inexistent")
    comps = []
    for c in body.components:
        if c.variant_id == vid:
            raise HTTPException(400, "Un pachet nu se poate conține pe sine")
        cv = await _variant(c.variant_id)
        if not cv:
            raise HTTPException(400, "Componentă inexistentă")
        if is_bundle(cv):
            raise HTTPException(400, "O componentă nu poate fi la rândul ei pachet")
        comps.append(c.model_dump())
    await db.stock_variants.update_one({"variant_id": vid}, {"$set": {"bundle": comps or None, "is_bundle": bool(comps) or bool(v.get("is_bundle"))}})
    if comps and int(v.get("on_hand") or 0):
        # un pachet nu are stoc propriu: aducem soldul lui la 0
        await move(vid, -int(v["on_hand"]), "ajustare", note="Transformat în pachet — stocul se ține pe componente",
                   actor=user["name"], expand_bundle=False)
    await audit.log(resource_type="stock", resource_id=vid, action="stock.bundle", actor=user,
                    details={"product": v.get("product_title"), "components": comps}, ip=audit.client_ip(request))
    return await item_detail(vid, user)


class ItemMeta(BaseModel):
    min_stock: Optional[int] = None
    location: Optional[str] = None
    untracked: Optional[bool] = None
    is_bundle: Optional[bool] = None


@router.patch("/items/{vid}")
async def set_meta(vid: str, body: ItemMeta, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    v = await _variant(vid)
    if not v:
        raise HTTPException(404, "Produs inexistent")
    upd = body.model_dump(exclude_unset=True)
    if "is_bundle" in upd:
        if upd["is_bundle"]:
            used = await db.stock_variants.find_one({"bundle.variant_id": vid}, {"_id": 0, "product_title": 1})
            if used:
                raise HTTPException(400, f"Produsul e componentă în pachetul „{used.get('product_title')}”, deci nu poate fi pachet.")
        else:
            upd["bundle"] = None  # nu mai e pachet: ștergem și componentele
        if upd["is_bundle"] and int(v.get("on_hand") or 0):
            await move(vid, -int(v["on_hand"]), "ajustare", note="Marcat ca pachet — stocul se ține pe componente",
                       actor=user["name"], expand_bundle=False)
        await audit.log(resource_type="stock", resource_id=vid, action="stock.bundle", actor=user,
                        details={"product": v.get("product_title"), "is_bundle": upd["is_bundle"]},
                        ip=audit.client_ip(request))
    await db.stock_variants.update_one({"variant_id": vid}, {"$set": upd})
    return {"ok": True}


class StockSettings(BaseModel):
    confirm_tags: list[str]
    cancel_tags: list[str]
    reserve_days: int = Field(default=30, ge=1, le=365)


@router.put("/settings")
async def save_settings(body: StockSettings, request: Request, user: dict = Depends(require_admin)):
    ct = [t.strip() for t in body.confirm_tags if t.strip()]
    if not ct:
        raise HTTPException(400, "Trebuie cel puțin un tag de confirmare")
    await _set_settings(confirm_tags=ct, cancel_tags=[t.strip() for t in body.cancel_tags if t.strip()],
                        reserve_days=body.reserve_days)
    # recalculăm rezervările pentru comenzile cunoscute
    s = await get_settings()
    confirm = {_norm(t) for t in s["confirm_tags"]}
    cancel = {_norm(t) for t in s["cancel_tags"]}
    db = get_db()
    async for o in db.stock_orders.find({}, {"_id": 0}):
        tags = [_norm(t) for t in o.get("tags") or []]
        confirmed = any(t in confirm for t in tags)
        cancelled = bool(o.get("shopify_cancelled")) or any(t in cancel for t in tags)
        reserving = confirmed and not cancelled and not o.get("closed") and any(l["unfulfilled"] for l in o["lines"])
        await db.stock_orders.update_one({"order_id": o["order_id"]}, {"$set": {
            "confirmed": confirmed, "cancelled": cancelled, "reserving": reserving}})
    await audit.log(resource_type="settings", resource_id="stock", action="stock.settings", actor=user,
                    details=body.model_dump(), ip=audit.client_ip(request))
    return await summary(user)


@router.post("/sync")
async def manual_sync(products: bool = True, _: dict = Depends(get_current_user)):
    if _sync_lock.locked():
        raise HTTPException(409, "O sincronizare rulează deja. Încearcă peste un minut.")
    try:
        return await sync_all(products=products)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"Shopify: {e}")


# ------------------------------------------------------------------ inventar ghidat (telefon)
# O sesiune de inventar trece prin TOATE produsele urmărite, unul câte unul. Fiecare cantitate
# salvată se aplică imediat (stocul devine exact cât s-a numărat), iar sesiunea se poate
# finaliza doar după ce fiecare produs are o cantitate introdusă.

def _inv_sort_key(v: dict):
    return ((v.get("location") or "~").lower(), (v.get("product_title") or "").lower(), (v.get("variant_title") or "").lower())


async def _inv_targets() -> list[dict]:
    db = get_db()
    vs = await db.stock_variants.find({"status": STOCK_STATUSES, "deleted": {"$ne": True}, "untracked": {"$ne": True},
                                       **NOT_BUNDLE}, {"_id": 0}).to_list(20000)
    return sorted(vs, key=_inv_sort_key)


async def _open_session() -> Optional[dict]:
    return await get_db().stock_inventory_sessions.find_one({"status": "open"}, {"_id": 0})


async def _session_view(sess: dict) -> dict:
    db = get_db()
    targets = await _inv_targets()
    ids = list(sess.get("order") or [])
    known = set(ids)
    added = [v["variant_id"] for v in targets if v["variant_id"] not in known]
    if added:  # produse noi apărute în Shopify în timpul inventarului — intră la final
        ids += added
        await db.stock_inventory_sessions.update_one({"id": sess["id"]}, {"$set": {"order": ids}})
    active = {v["variant_id"]: v for v in targets}
    counts = sess.get("counts") or {}
    items = []
    for vid in ids:
        v = active.get(vid)
        if not v and vid not in counts:
            continue  # produs dezactivat / marcat „nu urmări” între timp
        v = v or await _variant(vid) or {"variant_id": vid}
        if is_bundle(v):
            continue  # marcat ca pachet între timp — pachetele nu se numără
        c = counts.get(vid)
        items.append({"variant_id": vid, "product_title": v.get("product_title"), "variant_title": v.get("variant_title"),
                      "sku": v.get("sku"), "image": v.get("image"), "location": v.get("location"),
                      "status": v.get("status"), "counted": c["counted"] if c else None, "before": c.get("before") if c else None,
                      "counted_by": c.get("by") if c else None, "counted_at": c.get("at") if c else None})
    done = sum(1 for i in items if i["counted"] is not None)
    return {"id": sess["id"], "status": sess["status"], "started_at": sess["started_at"],
            "started_by": sess.get("started_by"), "note": sess.get("note", ""),
            "total": len(items), "done": done, "items": items}


@router.get("/inventory/session")
async def get_session(_: dict = Depends(get_current_user)):
    sess = await _open_session()
    return {"session": await _session_view(sess) if sess else None}


class SessionStart(BaseModel):
    note: Optional[str] = ""


@router.post("/inventory/session")
async def start_session(body: SessionStart, request: Request, user: dict = Depends(get_current_user)):
    sess = await _open_session()
    if not sess:
        targets = await _inv_targets()
        if not targets:
            raise HTTPException(400, "Nu există produse de numărat. Sincronizează întâi produsele din Shopify.")
        sess = {"id": new_id(), "status": "open", "started_at": now_iso(), "started_by": user["name"],
                "note": (body.note or "").strip(), "order": [v["variant_id"] for v in targets], "counts": {}}
        await get_db().stock_inventory_sessions.insert_one(dict(sess))
        await audit.log(resource_type="stock", resource_id=sess["id"], action="stock.inventory_started", actor=user,
                        details={"products": len(targets)}, ip=audit.client_ip(request))
    return {"session": await _session_view(sess)}


class SessionCount(BaseModel):
    variant_id: str
    counted: int = Field(ge=0, le=1_000_000)


@router.post("/inventory/session/count")
async def session_count(body: SessionCount, user: dict = Depends(get_current_user)):
    db = get_db()
    sess = await _open_session()
    if not sess:
        raise HTTPException(409, "Nu există un inventar în desfășurare.")
    v = await _variant(body.variant_id)
    if not v:
        raise HTTPException(404, "Produs inexistent")
    if is_bundle(v):
        raise HTTPException(400, "Produsul e marcat ca pachet — pachetele nu se numără.")
    s = await get_settings()
    if not s.get("start_at"):  # primul inventar: urmărirea pornește la prima cantitate salvată
        await _set_settings(start_at=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    before = int(v.get("on_hand") or 0)
    delta = body.counted - before
    note = f"Inventar {sess['started_at'][:10]}" + (f" — {sess['note']}" if sess.get("note") else "")
    if delta:
        await move(body.variant_id, delta, "inventar", note=note, actor=user["name"], ref_kind="inventory",
                   ref_id=sess["id"], expand_bundle=False)
    prev = (sess.get("counts") or {}).get(body.variant_id)
    await db.stock_inventory_sessions.update_one({"id": sess["id"]}, {"$set": {f"counts.{body.variant_id}": {
        "counted": body.counted, "before": prev["before"] if prev else before, "by": user["name"], "at": now_iso()}}})
    return {"session": await _session_view(await _open_session())}


@router.post("/inventory/session/finish")
async def finish_session(request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    sess = await _open_session()
    if not sess:
        raise HTTPException(409, "Nu există un inventar în desfășurare.")
    view = await _session_view(sess)
    left = view["total"] - view["done"]
    if left:
        raise HTTPException(400, f"Mai sunt {left} produse nenumărate. Inventarul se poate finaliza doar după ce sunt numărate toate.")
    diffs = [i for i in view["items"] if i["counted"] != i["before"]]
    await db.stock_inventory_sessions.update_one({"id": sess["id"]}, {"$set": {
        "status": "done", "finished_at": now_iso(), "finished_by": user["name"],
        "summary": {"products": view["total"], "changed": len(diffs),
                    "units": sum(i["counted"] for i in view["items"])}}})
    await audit.log(resource_type="stock", resource_id=sess["id"], action="stock.inventory", actor=user,
                    details={"counted": view["total"], "changed": len(diffs), "first": False, "note": sess.get("note"),
                             "guided": True}, ip=audit.client_ip(request))
    return {"ok": True, "products": view["total"], "changed": len(diffs)}


@router.post("/inventory/session/abandon")
async def abandon_session(request: Request, user: dict = Depends(require_admin)):
    sess = await _open_session()
    if not sess:
        raise HTTPException(409, "Nu există un inventar în desfășurare.")
    await get_db().stock_inventory_sessions.update_one({"id": sess["id"]}, {"$set": {
        "status": "abandoned", "finished_at": now_iso(), "finished_by": user["name"]}})
    await audit.log(resource_type="stock", resource_id=sess["id"], action="stock.inventory_abandoned", actor=user,
                    details={"counted": len(sess.get("counts") or {})}, ip=audit.client_ip(request))
    return {"ok": True}


@router.get("/inventory/sessions")
async def list_sessions(_: dict = Depends(get_current_user)):
    out = await get_db().stock_inventory_sessions.find({}, {"_id": 0, "order": 0, "counts": 0}) \
        .sort("started_at", -1).to_list(50)
    return out


# ------------------------------------------------------------------ valoarea stocului
VAT_RATE = 0.21


def _has_cost(v: dict) -> bool:
    return v.get("cost") is not None and float(v["cost"]) > 0


@router.get("/value")
async def stock_value(_: dict = Depends(get_current_user)):
    """Valoarea stocului din depozit la costul de achiziție (COGS din Shopify, fără TVA)."""
    db = get_db()
    s = await get_settings()
    shop = (await shopify._shop() or "").strip()
    vs = await db.stock_variants.find({"status": STOCK_STATUSES, "deleted": {"$ne": True}, "untracked": {"$ne": True},
                                       **NOT_BUNDLE}, {"_id": 0}).to_list(20000)
    rows, missing_in_stock, missing_no_stock = [], [], 0
    for v in vs:
        oh = int(v.get("on_hand") or 0)
        has = _has_cost(v)
        r = {k: v.get(k) for k in ("variant_id", "product_id", "product_title", "variant_title", "sku", "image", "status")}
        r.update(on_hand=oh, cost=v.get("cost") if has else None,
                 value=round(max(oh, 0) * float(v["cost"]), 2) if has else None,
                 admin_url=f"https://{shop}/admin/products/{v.get('product_id')}/variants/{v['variant_id']}" if shop else None)
        if not has:
            if oh > 0:
                missing_in_stock.append(r)
            else:
                missing_no_stock += 1
        if oh > 0:
            rows.append(r)
    rows.sort(key=lambda r: -(r["value"] or 0))
    total = round(sum(r["value"] or 0 for r in rows), 2)
    return {
        "value": total, "value_vat": round(total * (1 + VAT_RATE), 2), "vat_rate": VAT_RATE,
        "units": sum(r["on_hand"] for r in rows), "products_in_stock": len(rows),
        "missing_cost_in_stock": sorted(missing_in_stock, key=lambda r: -r["on_hand"]),
        "missing_cost_units": sum(r["on_hand"] for r in missing_in_stock),
        "missing_cost_no_stock": missing_no_stock, "rows": rows,
        "last_product_sync": s.get("last_product_sync"), "cost_error": s.get("cost_error"),
        "started": bool(s.get("start_at")),
    }
