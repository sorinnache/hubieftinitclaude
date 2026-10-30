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
    "inlocuire": "Înlocuire produs trimis în pachet",
}
# mișcările care spun ce produs a plecat efectiv pentru o comandă (pentru a ști unde revine stocul)
ORDER_FLOW_TYPES = ["vanzare", "awb_anulat", "retur", "inlocuire", "refuzat"]


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


def _candidates(comp: dict) -> list[str]:
    """Componenta principală + înlocuitorii ei, în ordinea preferinței."""
    out = [comp["variant_id"]]
    for a in comp.get("alternates") or []:
        if a not in out:
            out.append(a)
    return out


async def candidates_for(comp: dict) -> list[str]:
    """Principalul + înlocuitorii setați pe componentă + înlocuitorii setați pe produsul principal."""
    out = _candidates(comp)
    pv = await _variant(comp["variant_id"]) or {}
    for a in pv.get("alternates") or []:
        if a not in out:
            out.append(a)
    return out


async def _allocate(vid: str, delta: int, order_id: str = "") -> list[tuple[str, int, Optional[str]]]:
    """Descompune o mișcare pe un pachet în mișcări pe componente, ținând cont de înlocuitori.
    Ieșire (vânzare): se scade din principal cât are în stoc, apoi din înlocuitori (în ordine);
    restul rămâne pe principal (merge pe minus).
    Intrare (AWB anulat / retur): stocul revine pe produsele care au plecat efectiv pentru comanda respectivă."""
    db = get_db()
    v = await _variant(vid)
    comps = (v or {}).get("bundle") or []
    bundle_key = vid if comps else None
    if not comps:
        alts = [a for a in (v or {}).get("alternates") or [] if a != vid]
        if not alts:
            return [(vid, delta, None)]
        comps = [{"variant_id": vid, "qty": 1, "alternates": alts}]  # produs simplu cu înlocuitori
    out: list[tuple[str, int, Optional[str]]] = []
    for c in comps:
        cands = await candidates_for(c)
        need = int(c["qty"]) * abs(delta)
        if len(cands) == 1:
            out.append((cands[0], need if delta > 0 else -need, c["variant_id"]))
            continue
        if delta < 0:
            for cv in cands:
                if need <= 0:
                    break
                oh = int((await _variant(cv) or {}).get("on_hand") or 0)
                take = min(need, max(oh, 0))
                if take:
                    out.append((cv, -take, c["variant_id"]))
                    need -= take
            if need > 0:
                out.append((cands[0], -need, c["variant_id"]))
        else:
            net = {}
            if order_id:
                async for m in db.stock_movements.find({"order_id": order_id, "bundle_variant_id": bundle_key,
                                                        "variant_id": {"$in": cands}, "type": {"$in": ORDER_FLOW_TYPES}},
                                                       {"_id": 0, "variant_id": 1, "delta": 1}):
                    net[m["variant_id"]] = net.get(m["variant_id"], 0) - int(m["delta"])
            for cv in reversed(cands):  # întâi înlocuitorii care au plecat, apoi principalul
                give = min(need, max(net.get(cv, 0), 0))
                if give:
                    out.append((cv, give, c["variant_id"]))
                    need -= give
            if need > 0:
                out.append((cands[0], need, c["variant_id"]))
    return out


async def move(vid: str, delta: int, mtype: str, *, ref: str = "", note: str = "", actor: str = "Sistem",
               ref_kind: str = "", ref_id: str = "", expand_bundle: bool = True, order_id: str = "") -> list[dict]:
    """Aplică o mișcare de stoc (pachetele se descompun, cu înlocuitori) și o scrie în registru."""
    db = get_db()
    if not order_id and ref_kind == "order":
        order_id = ref_id
    targets = await _allocate(vid, delta, order_id) if expand_bundle else [(vid, delta, None)]
    src_is_bundle = bool(((await _variant(vid)) or {}).get("bundle")) if expand_bundle else False
    out = []
    for tvid, tdelta, primary in targets:
        if not tdelta:
            continue
        mnote, requested = note, None
        cur = await db.stock_variants.find_one({"variant_id": tvid}, {"_id": 0, "on_hand": 1})
        if tdelta > 0 and mtype == "awb_anulat" and order_id:
            # revine doar cât s-a scăzut efectiv pentru această comandă
            net = 0
            async for pm in db.stock_movements.find({"order_id": order_id, "variant_id": tvid,
                                                     "type": {"$in": ["vanzare", "awb_anulat", "inlocuire"]}},
                                                    {"_id": 0, "delta": 1}):
                net -= int(pm["delta"])
            if net < tdelta:
                requested, tdelta = tdelta, max(0, net)
        if tdelta < 0:
            # stocul fizic nu poate fi negativ: scădem cel mult cât există în sistem
            have = max(int((cur or {}).get("on_hand") or 0), 0)
            if -tdelta > have:
                requested, tdelta = tdelta, -have
                mnote = " · ".join(x for x in [note, f"Stoc insuficient în sistem: trebuiau scăzute {-requested} buc, "
                                                     f"erau {have}. Verifică stocul (inventar greșit sau alt produs trimis)."] if x)
        if cur is None:  # varianta nu e încă sincronizată — o creăm minim
            await db.stock_variants.insert_one({"variant_id": tvid, "product_title": "(variantă necunoscută)",
                                                "variant_title": "", "on_hand": max(tdelta, 0), "status": "UNKNOWN",
                                                "created_at": now_iso(), "updated_at": now_iso()})
            v = {"on_hand": max(tdelta, 0)}
        else:
            v = await db.stock_variants.find_one_and_update(
                {"variant_id": tvid}, {"$inc": {"on_hand": tdelta}, "$set": {"updated_at": now_iso()}},
                return_document=True, projection={"_id": 0})
        m = {"id": new_id(), "variant_id": tvid, "delta": tdelta, "type": mtype, "ref": ref, "note": mnote,
             "actor": actor, "ref_kind": ref_kind, "ref_id": ref_id, "on_hand_after": v.get("on_hand", 0),
             "via_bundle": src_is_bundle and tvid != vid, "bundle_variant_id": vid if src_is_bundle and tvid != vid else None,
             "component_of": primary if primary and primary != tvid else None, "order_id": order_id or None,
             "requested": requested, "shortfall": (requested is not None and requested < 0), "created_at": now_iso()}
        await db.stock_movements.insert_one(dict(m))
        out.append(m)
    return out


async def fix_negative_stock():
    """O singură dată: stocurile negative rămase de dinainte devin 0 (fizic nu pot fi sub zero)."""
    db = get_db()
    async for v in db.stock_variants.find({"on_hand": {"$lt": 0}}, {"_id": 0, "variant_id": 1, "on_hand": 1}):
        n = -int(v["on_hand"])
        await db.stock_variants.update_one({"variant_id": v["variant_id"]}, {"$set": {"on_hand": 0}})
        await db.stock_movements.insert_one({
            "id": new_id(), "variant_id": v["variant_id"], "delta": n, "type": "ajustare",
            "ref": "Corecție automată", "note": f"Stocul era {-n} în sistem (s-au expediat mai multe bucăți decât erau "
                                                f"înregistrate). Stocul fizic nu poate fi negativ — adus la 0.",
            "actor": "Sistem", "ref_kind": "", "ref_id": "", "on_hand_after": 0, "via_bundle": False,
            "bundle_variant_id": None, "component_of": None, "order_id": None, "created_at": now_iso()})


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
    """variant_id -> {qty, orders:[...]} din comenzile confirmate neexpediate.
    La componentele de pachet cu înlocuitori, rezervarea merge pe primul produs care mai are stoc liber."""
    out: dict[str, dict] = {}
    flexible = []  # (comandă, candidați, cantitate) — se repartizează după rezervările fixe

    def add(vid, q, o):
        r = out.setdefault(vid, {"qty": 0, "orders": []})
        r["qty"] += q
        r["orders"].append({"name": o["name"], "order_id": o["order_id"], "qty": q, "created_at": o.get("created_at")})

    orders = await get_db().stock_orders.find(await _reserve_query(), {"_id": 0}).sort("created_at", 1).to_list(20000)
    for o in orders:
        for l in o["lines"]:
            if not l["unfulfilled"]:
                continue
            v = await _variant(l["variant_id"])
            comps = (v or {}).get("bundle") or []
            if not comps:
                alts = [a for a in (v or {}).get("alternates") or [] if a != l["variant_id"]]
                if alts:
                    flexible.append((o, [l["variant_id"], *alts], l["unfulfilled"]))
                else:
                    add(l["variant_id"], l["unfulfilled"], o)
                continue
            for c in comps:
                q = int(c["qty"]) * l["unfulfilled"]
                cands = await candidates_for(c)
                if len(cands) == 1:
                    add(cands[0], q, o)
                else:
                    flexible.append((o, cands, q))
    if flexible:
        on_hand = {}
        for o, cands, q in flexible:
            for cid in cands:
                if cid not in on_hand:
                    on_hand[cid] = int((await _variant(cid) or {}).get("on_hand") or 0)
            for cid in cands:
                if q <= 0:
                    break
                free = on_hand[cid] - out.get(cid, {"qty": 0})["qty"]
                take = min(q, max(free, 0))
                if take:
                    add(cid, take, o)
                    q -= take
            if q > 0:
                add(cands[0], q, o)
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
                        actor=(actor or {}).get("name") or "Sistem", ref_kind="return", ref_id=ret["id"],
                        order_id=_tail(ret.get("order_id")))
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
            "is_bundle": is_bundle(v), "never_counted": not v.get("counted_at"),
            "on_hand": on_hand, "reserved": r["qty"], "available": on_hand - r["qty"],
            "need": max(0, r["qty"] - max(on_hand, 0))}


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
                tot = 0
                for cid in await candidates_for(c):
                    cv = by_id.get(cid) or _row(await _variant(cid) or {"variant_id": cid}, reserved)
                    tot += max(cv["available"], 0)
                avail.append(tot // max(1, int(c["qty"])))
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
    elif view == "never_counted":
        rows = [r for r in rows if r["never_counted"] and not r["is_bundle"]]
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
        "never_counted": await db.stock_variants.count_documents({"status": STOCK_STATUSES, "deleted": {"$ne": True},
                                                                  "untracked": {"$ne": True}, **NOT_BUNDLE, **NEVER_COUNTED}),
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
    row["movements"] = await _enrich_movements(
        await db.stock_movements.find({"variant_id": vid}, {"_id": 0}).sort("created_at", -1).to_list(300))
    if v.get("bundle"):
        comps = []
        for c in v["bundle"]:
            cv = await _variant(c["variant_id"]) or {}
            alts = []
            for a in c.get("alternates") or []:
                av = await _variant(a) or {}
                alts.append({"variant_id": a, "product_title": av.get("product_title"), "variant_title": av.get("variant_title"),
                             "sku": av.get("sku"), "image": av.get("image"), "on_hand": int(av.get("on_hand") or 0)})
            comps.append({**c, "alternates": alts, "product_title": cv.get("product_title"), "variant_title": cv.get("variant_title"),
                          "sku": cv.get("sku"), "image": cv.get("image"), "on_hand": int(cv.get("on_hand") or 0)})
        row["bundle_components"] = comps
    alts = []
    for a in v.get("alternates") or []:
        av = await _variant(a) or {}
        alts.append({"variant_id": a, "product_title": av.get("product_title"), "variant_title": av.get("variant_title"),
                     "sku": av.get("sku"), "image": av.get("image"), "on_hand": int(av.get("on_hand") or 0)})
    row["alternates"] = alts
    row["alternate_for"] = [{"variant_id": x["variant_id"], "title": _title(x)} async for x in db.stock_variants.find(
        {"alternates": vid, "deleted": {"$ne": True}}, {"_id": 0, "variant_id": 1, "product_title": 1, "variant_title": 1})]
    return row


@router.get("/movements")
async def movements(type: Optional[str] = None, limit: int = 300, _: dict = Depends(get_current_user)):
    db = get_db()
    q = {"type": type} if type else {}
    rows = await db.stock_movements.find(q, {"_id": 0}).sort("created_at", -1).limit(min(limit, 2000)).to_list(2000)
    return await _enrich_movements(rows)


async def _enrich_movements(rows: list[dict]) -> list[dict]:
    db = get_db()
    ids = list({r["variant_id"] for r in rows} | {r["component_of"] for r in rows if r.get("component_of")}
               | {r["bundle_variant_id"] for r in rows if r.get("bundle_variant_id")})
    names = {v["variant_id"]: v async for v in db.stock_variants.find(
        {"variant_id": {"$in": ids}}, {"_id": 0, "variant_id": 1, "product_title": 1, "variant_title": 1, "sku": 1,
                                        "alternates": 1})}
    for r in rows:
        n = names.get(r["variant_id"], {})
        r["product_title"], r["variant_title"], r["sku"] = n.get("product_title"), n.get("variant_title"), n.get("sku")
        if r.get("component_of"):
            r["component_of_title"] = _title(names.get(r["component_of"], {}))
        if r.get("bundle_variant_id"):
            r["bundle_title"] = _title(names.get(r["bundle_variant_id"], {}))
        primary = r.get("component_of") or r["variant_id"]
        r["swappable"] = (r["type"] == "vanzare" and r["delta"] < 0 and not r.get("swapped_to")
                          and bool(r.get("bundle_variant_id") or (names.get(primary) or {}).get("alternates")))
    return rows


def _title(v: dict) -> str:
    return f"{v.get('product_title') or ''}{' — ' + v['variant_title'] if v.get('variant_title') else ''}"


async def _swap_context(mid: str):
    db = get_db()
    m = await db.stock_movements.find_one({"id": mid}, {"_id": 0})
    if not m or m["type"] != "vanzare" or m["delta"] >= 0:
        raise HTTPException(400, "Se pot înlocui doar produsele scăzute la emiterea AWB-ului.")
    if m.get("swapped_to"):
        raise HTTPException(400, "Această mișcare a fost deja înlocuită. Folosește mișcarea de înlocuire nouă.")
    primary = m.get("component_of") or m["variant_id"]
    if m.get("bundle_variant_id"):
        b = await _variant(m["bundle_variant_id"])
        comp = next((c for c in (b or {}).get("bundle") or [] if c["variant_id"] == primary), None)
        if not comp:
            raise HTTPException(400, "Componenta nu mai există în pachet.")
        return m, b, comp
    pv = await _variant(primary) or {}
    alts = [a for a in pv.get("alternates") or [] if a != primary]
    if not alts:
        raise HTTPException(400, "Produsul nu are înlocuitori setați.")
    return m, None, {"variant_id": primary, "qty": 1, "alternates": alts}


@router.get("/movements/{mid}/swap-options")
async def swap_options(mid: str, _: dict = Depends(get_current_user)):
    m, b, comp = await _swap_context(mid)
    out = []
    for cid in await candidates_for(comp):
        if cid == m["variant_id"]:
            continue
        v = await _variant(cid) or {}
        out.append({"variant_id": cid, "title": _title(v), "sku": v.get("sku"), "image": v.get("image"),
                    "on_hand": int(v.get("on_hand") or 0), "primary": cid == comp["variant_id"]})
    return {"movement": m, "current": _title(await _variant(m["variant_id"]) or {}), "bundle": _title(b) if b else None,
            "options": out}


class SwapBody(BaseModel):
    variant_id: str


@router.post("/movements/{mid}/swap")
async def swap_movement(mid: str, body: SwapBody, request: Request, user: dict = Depends(get_current_user)):
    """Depozitul a trimis alt produs decât cel scăzut automat: punem înapoi pe cel scăzut și scădem din cel trimis."""
    m, b, comp = await _swap_context(mid)
    cands = await candidates_for(comp)
    if body.variant_id not in cands or body.variant_id == m["variant_id"]:
        raise HTTPException(400, "Produsul ales nu e principalul sau un înlocuitor al acestei componente.")
    n = -int(m["delta"])
    old, new = await _variant(m["variant_id"]), await _variant(body.variant_id)
    note = f"S-a trimis „{_title(new)}” în loc de „{_title(old)}”" + (f" (pachet {_title(b)})" if b else "")
    common = dict(ref=m.get("ref", ""), note=note, actor=user["name"], ref_kind=m.get("ref_kind", ""),
                  ref_id=m.get("ref_id", ""), expand_bundle=False)
    db = get_db()
    out = []
    for tvid, d in ((m["variant_id"], n), (body.variant_id, -n)):
        ms = await move(tvid, d, "inlocuire", **common)
        # legăm mișcarea de comandă și de pachet, ca un eventual AWB anulat / retur să revină corect
        await db.stock_movements.update_one({"id": ms[0]["id"]}, {"$set": {
            "order_id": m.get("order_id"), "bundle_variant_id": m.get("bundle_variant_id"), "via_bundle": bool(b),
            "component_of": comp["variant_id"] if tvid != comp["variant_id"] else None}})
        out += ms
    await db.stock_movements.update_one({"id": mid}, {"$set": {"swapped_to": body.variant_id, "swapped_at": now_iso(),
                                                              "swapped_by": user["name"]}})
    await audit.log(resource_type="stock", resource_id=mid, action="stock.swap", actor=user,
                    details={"order": m.get("ref"), "from": _title(old), "to": _title(new), "qty": n},
                    ip=audit.client_ip(request))
    return {"ok": True}


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
        await mark_counted(it.variant_id, "inventar")
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
    supplier_cui: Optional[str] = ""
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
        for m in await move(it.variant_id, it.qty, "intrare", ref=ref, note=body.note or "", actor=user["name"],
                            ref_kind="receipt", ref_id=rid, expand_bundle=True):
            await mark_counted(m["variant_id"], "intrare")
    doc = {"id": rid, "supplier": body.supplier, "supplier_cui": re.sub(r"\D", "", body.supplier_cui or ""),
           "document": body.document, "note": body.note,
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
    alternates: list[str] = []


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
        alts = []
        for a in c.alternates:
            if a in (vid, c.variant_id) or a in alts:
                continue
            av = await _variant(a)
            if not av:
                raise HTTPException(400, "Înlocuitor inexistent")
            if is_bundle(av):
                raise HTTPException(400, "Un înlocuitor nu poate fi pachet")
            alts.append(a)
        comps.append({"variant_id": c.variant_id, "qty": c.qty, "alternates": alts})
    await db.stock_variants.update_one({"variant_id": vid}, {"$set": {"bundle": comps or None, "is_bundle": bool(comps) or bool(v.get("is_bundle"))}})
    if comps and int(v.get("on_hand") or 0):
        # un pachet nu are stoc propriu: aducem soldul lui la 0
        await move(vid, -int(v["on_hand"]), "ajustare", note="Transformat în pachet — stocul se ține pe componente",
                   actor=user["name"], expand_bundle=False)
    await audit.log(resource_type="stock", resource_id=vid, action="stock.bundle", actor=user,
                    details={"product": v.get("product_title"), "components": comps}, ip=audit.client_ip(request))
    return await item_detail(vid, user)


class AlternatesBody(BaseModel):
    alternates: list[str] = []


@router.put("/items/{vid}/alternates")
async def set_alternates(vid: str, body: AlternatesBody, request: Request, user: dict = Depends(get_current_user)):
    """Produse echivalente: dacă produsul e la 0, la AWB se scade din primul înlocuitor care are stoc."""
    db = get_db()
    v = await _variant(vid)
    if not v:
        raise HTTPException(404, "Produs inexistent")
    if is_bundle(v):
        raise HTTPException(400, "La pachete înlocuitorii se pun pe fiecare componentă.")
    alts = []
    for a in body.alternates:
        if a == vid or a in alts:
            continue
        av = await _variant(a)
        if not av:
            raise HTTPException(400, "Înlocuitor inexistent")
        if is_bundle(av):
            raise HTTPException(400, "Un înlocuitor nu poate fi pachet")
        alts.append(a)
    await db.stock_variants.update_one({"variant_id": vid}, {"$set": {"alternates": alts}})
    await audit.log(resource_type="stock", resource_id=vid, action="stock.alternates", actor=user,
                    details={"product": _title(v), "alternates": [_title(await _variant(a) or {}) for a in alts]},
                    ip=audit.client_ip(request))
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

async def mark_counted(vid: str, how: str):
    """Produsul are de acum un stoc introdus (inventar sau intrare marfă)."""
    await get_db().stock_variants.update_one({"variant_id": vid, "counted_at": {"$exists": False}},
                                             {"$set": {"counted_at": now_iso(), "counted_how": how}})


async def migrate_counted():
    """Marchează produsele care au primit deja stoc prin inventar sau intrări (o singură dată, la pornire)."""
    db = get_db()
    seen = set()
    async for sess in db.stock_inventory_sessions.find({}, {"_id": 0, "counts": 1}):
        seen.update((sess.get("counts") or {}).keys())
    async for m in db.stock_movements.find({"type": {"$in": ["inventar", "intrare"]}}, {"_id": 0, "variant_id": 1}):
        seen.add(m["variant_id"])
    if seen:
        await db.stock_variants.update_many({"variant_id": {"$in": list(seen)}, "counted_at": {"$exists": False}},
                                            {"$set": {"counted_at": now_iso(), "counted_how": "migrare"}})


NEVER_COUNTED = {"counted_at": {"$exists": False}}


def _inv_sort_key(v: dict):
    return ((v.get("location") or "~").lower(), (v.get("product_title") or "").lower(), (v.get("variant_title") or "").lower())


CHECK_DAYS = 15  # verificarea de stoc ia produsele cu mișcări în ultimele 15 zile


async def _inv_targets(only_new: bool = False, check: bool = False) -> list[dict]:
    db = get_db()
    extra: dict = NEVER_COUNTED if only_new else {}
    if check:
        since = (datetime.now(timezone.utc) - timedelta(days=CHECK_DAYS)).isoformat()
        moved = await db.stock_movements.distinct("variant_id", {"created_at": {"$gte": since}})
        extra = {"variant_id": {"$in": moved}}
    vs = await db.stock_variants.find({"status": STOCK_STATUSES, "deleted": {"$ne": True}, "untracked": {"$ne": True},
                                       **NOT_BUNDLE, **extra}, {"_id": 0}).to_list(20000)
    return sorted(vs, key=_inv_sort_key)


async def _open_session() -> Optional[dict]:
    return await get_db().stock_inventory_sessions.find_one({"status": "open"}, {"_id": 0})


async def _session_view(sess: dict) -> dict:
    db = get_db()
    targets = await _inv_targets()
    ids = list(sess.get("order") or [])
    known = set(ids)
    scope = sess.get("scope", "full")
    pool = await _inv_targets(only_new=True) if scope == "new" else ([] if scope == "check" else targets)
    added = [v["variant_id"] for v in pool if v["variant_id"] not in known]
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
                      "status": v.get("status"), "on_hand": int(v.get("on_hand") or 0),
                      "counted": c["counted"] if c else None, "before": c.get("before") if c else None,
                      "counted_by": c.get("by") if c else None, "counted_at": c.get("at") if c else None})
    done = sum(1 for i in items if i["counted"] is not None)
    return {"id": sess["id"], "status": sess["status"], "started_at": sess["started_at"],
            "started_by": sess.get("started_by"), "note": sess.get("note", ""), "scope": sess.get("scope", "full"),
            "total": len(items), "done": done, "items": items}


@router.get("/inventory/session")
async def get_session(_: dict = Depends(get_current_user)):
    sess = await _open_session()
    return {"session": await _session_view(sess) if sess else None}


class SessionStart(BaseModel):
    note: Optional[str] = ""
    scope: str = "full"  # full = toate · new = produse fără stoc introdus · check = verificare (mișcări în ultimele 15 zile)


@router.post("/inventory/session")
async def start_session(body: SessionStart, request: Request, user: dict = Depends(get_current_user)):
    sess = await _open_session()
    if not sess:
        only_new, check = body.scope == "new", body.scope == "check"
        targets = await _inv_targets(only_new=only_new, check=check)
        if not targets:
            raise HTTPException(400, "Toate produsele au deja stoc introdus." if only_new
                                else f"Niciun produs nu a avut mișcări de stoc în ultimele {CHECK_DAYS} zile." if check
                                else "Nu există produse de numărat. Sincronizează întâi produsele din Shopify.")
        sess = {"id": new_id(), "status": "open", "started_at": now_iso(), "started_by": user["name"],
                "scope": "new" if only_new else "check" if check else "full",
                "note": (body.note or "").strip() or ("Produse noi" if only_new else "Verificare stoc" if check else ""),
                "order": [v["variant_id"] for v in targets], "counts": {}}
        await get_db().stock_inventory_sessions.insert_one(dict(sess))
        await audit.log(resource_type="stock", resource_id=sess["id"], action="stock.inventory_started", actor=user,
                        details={"products": len(targets), "scope": sess["scope"]}, ip=audit.client_ip(request))
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
    note = (f"Verificare stoc {sess['started_at'][:10]}" if sess.get("scope") == "check"
            else f"Inventar {sess['started_at'][:10]}" + (f" — {sess['note']}" if sess.get("note") else ""))
    if delta:
        await move(body.variant_id, delta, "inventar", note=note, actor=user["name"], ref_kind="inventory",
                   ref_id=sess["id"], expand_bundle=False)
    await mark_counted(body.variant_id, "inventar")
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
