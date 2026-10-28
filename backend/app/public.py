"""Endpoint-uri publice folosite de formularele de pe ieftinit.ro (fără autentificare)."""
import logging
import re
import time
from typing import Literal, Optional

from fastapi import APIRouter, File, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, EmailStr, Field

from . import audit, emails, shopify, storage
from .cases import default_status_id, insert_with_number
from .db import get_db, new_id, now_iso
from .normalize import normalize_order_number

log = logging.getLogger("public")
router = APIRouter(prefix="/public", tags=["Public"])
files_router = APIRouter(tags=["Fișiere"])

_hits: dict[str, list[float]] = {}


def _rate_limit(request: Request, bucket: str, limit: int, window: int = 600):
    ip = audit.client_ip(request) or "-"
    key = f"{bucket}|{ip}"
    now = time.time()
    lst = [t for t in _hits.get(key, []) if now - t < window]
    if len(lst) >= limit:
        raise HTTPException(429, "Prea multe încercări. Te rugăm să reîncerci peste câteva minute.")
    lst.append(now)
    _hits[key] = lst


async def _verified_order(order_number: str, identity: str) -> dict:
    identity = (identity or "").strip()
    if not identity:
        raise HTTPException(400, "Introdu telefonul (sau emailul) folosit la comandă")
    try:
        order = await shopify.get_order(order_number)
    except Exception as e:  # noqa: BLE001
        log.error("Shopify lookup: %s", e)
        raise HTTPException(503, "Nu putem verifica comanda acum. Te rugăm să reîncerci în câteva minute.")
    is_email = "@" in identity
    if not order or not shopify.identity_matches(order, phone=None if is_email else identity,
                                                 email=identity if is_email else None):
        raise HTTPException(404, "Nu am găsit comanda. Verifică numărul comenzii și telefonul folosit la comandă.")
    return order


@router.get("/order/{order_number}")
async def lookup_order(order_number: str, request: Request, phone: Optional[str] = None, email: Optional[str] = None):
    _rate_limit(request, "lookup", 30)
    order = await _verified_order(order_number, phone or email or "")
    ship = order.get("shipping_address") or {}
    return {
        "order_number": order["order_number"],
        "name": order["name"],
        "email": order.get("email"),
        "phone": order.get("phone"),
        "customer": order["customer"],
        "created_at": order["created_at"],
        "total_price": order["total_price"],
        "currency": order["currency"],
        "line_items": order["line_items"],
        "shipping_address": {k: ship.get(k) for k in ("name", "address1", "address2", "city", "zip", "province", "phone")},
    }


async def _upload(request: Request, file: UploadFile, kind: str) -> dict:
    _rate_limit(request, "upload", 60)
    fid = new_id()
    saved = await storage.save_upload(file, fid)
    doc = {"id": fid, "ref_type": kind, "ref_id": None, "original_filename": file.filename, "source": "client",
           "created_at": now_iso(), **saved}
    await get_db().files.insert_one(dict(doc))
    return {"id": fid, "filename": file.filename, "content_type": saved["content_type"], "size": saved["size"]}


@router.post("/upload")
async def upload_return_file(request: Request, file: UploadFile = File(...)):
    return await _upload(request, file, "return")


@router.post("/service/upload")
async def upload_service_file(request: Request, file: UploadFile = File(...)):
    return await _upload(request, file, "service")


class Item(BaseModel):
    line_item_id: str
    quantity: int = Field(ge=1)
    reason: Optional[str] = ""


def _pick_items(order: dict, items: list[Item]) -> list[dict]:
    by_id = {li["id"]: li for li in order["line_items"]}
    out = []
    for it in items:
        li = by_id.get(it.line_item_id)
        if not li:
            raise HTTPException(400, "Produs inexistent în comandă")
        if it.quantity > int(li.get("quantity") or 1):
            raise HTTPException(400, f"Cantitate prea mare pentru {li['title']}")
        out.append({"line_item_id": li["id"], "product_id": li.get("product_id"), "variant_id": li.get("variant_id"),
                    "title": li["title"],
                    "variant_title": li.get("variant_title"), "sku": li.get("sku"), "quantity": it.quantity,
                    "price": li.get("price"), "image": li.get("image"), "reason": (it.reason or "").strip()})
    if not out:
        raise HTTPException(400, "Selectează cel puțin un produs")
    return out


async def _link_files(file_ids: list[str], kind: str, ref_id: str):
    if file_ids:
        await get_db().files.update_many({"id": {"$in": file_ids[:30]}, "ref_type": kind, "ref_id": None},
                                         {"$set": {"ref_id": ref_id}})


def _consent(request: Request) -> dict:
    return {"accepted_terms": True, "accepted_at": now_iso(), "ip": audit.client_ip(request),
            "user_agent": (request.headers.get("user-agent") or "")[:300]}


class ReturnSubmit(BaseModel):
    order_number: str
    identity: str
    customer_name: str
    email: EmailStr
    phone: str
    items: list[Item]
    reason: str
    notes: Optional[str] = ""
    return_type: Literal["refund", "exchange", "voucher"]
    iban: Optional[str] = ""
    bank: Optional[str] = ""
    file_ids: list[str] = []
    accepted_terms: bool


@router.post("/returns")
async def submit_return(body: ReturnSubmit, request: Request):
    _rate_limit(request, "submit", 10)
    if not body.accepted_terms:
        raise HTTPException(400, "Trebuie să accepți termenii și condițiile")
    iban = (body.iban or "").replace(" ", "").upper()
    if body.return_type == "refund" and not re.fullmatch(r"[A-Z]{2}\d{2}[A-Z0-9]{11,30}", iban):
        raise HTTPException(400, "IBAN invalid. Un IBAN românesc are 24 de caractere și începe cu RO.")
    if not body.reason.strip():
        raise HTTPException(400, "Spune-ne motivul returului")
    order = await _verified_order(body.order_number, body.identity)
    items = _pick_items(order, body.items)
    rid = new_id()
    now = now_iso()
    doc = {
        "id": rid, "order_number": normalize_order_number(order["order_number"]), "order_id": order["id"],
        "customer_name": body.customer_name.strip(), "email": str(body.email).lower(), "phone": body.phone.strip(),
        "items": items, "reason": body.reason.strip(), "customer_notes": (body.notes or "").strip(),
        "return_type": body.return_type, "iban": iban if body.return_type == "refund" else "",
        "bank": (body.bank or "").strip(), "file_ids": body.file_ids[:30],
        "status_id": await default_status_id("return"), "priority": "medium", "assigned_to": None,
        "awb": None, "courier": None, "shopify_order": order, "consent": _consent(request),
        "source": "formular", "created_at": now, "updated_at": now,
    }
    number = await insert_with_number("return", doc)
    await _link_files(body.file_ids, "return", rid)
    await audit.log(resource_type="return", resource_id=rid, action="created", actor_name=doc["customer_name"],
                    details={"number": number, "order_number": doc["order_number"], "via": "formular online",
                             "return_type": body.return_type, "items": [f"{i['quantity']} × {i['title']}" for i in items]},
                    ip=audit.client_ip(request))
    subj, html = emails.return_received(number, doc["customer_name"], doc["order_number"])
    if await emails.send(doc["email"], subj, html):
        await audit.log(resource_type="return", resource_id=rid, action="email_sent",
                        details={"to": doc["email"], "subject": subj})
    return {"id": rid, "return_number": number}


@router.get("/service/problem-types")
async def public_problem_types():
    return await get_db().service_problem_types.find({"active": True}, {"_id": 0}).sort("order", 1).to_list(100)


class Pickup(BaseModel):
    address1: str
    city: str
    county: Optional[str] = ""
    zip: str
    contact_name: str
    contact_phone: str
    preferred_slot: Optional[str] = "anytime"


class ServiceSubmit(BaseModel):
    order_number: str
    identity: str
    customer_name: str
    email: EmailStr
    phone: str
    items: list[Item]
    problem_type_id: str
    defect_description: str
    when_started: Optional[str] = None
    product_used: Optional[bool] = None
    visual_damage: Optional[bool] = None
    notes: Optional[str] = ""
    pickup: Pickup
    file_ids: list[str] = []
    accepted_terms: bool


@router.post("/service")
async def submit_service(body: ServiceSubmit, request: Request):
    _rate_limit(request, "submit", 10)
    if not body.accepted_terms:
        raise HTTPException(400, "Trebuie să accepți termenii și condițiile")
    db = get_db()
    pt = await db.service_problem_types.find_one({"id": body.problem_type_id, "active": True}, {"_id": 0})
    if not pt:
        raise HTTPException(400, "Alege tipul problemei")
    if not body.defect_description.strip():
        raise HTTPException(400, "Descrie problema")
    order = await _verified_order(body.order_number, body.identity)
    items = _pick_items(order, body.items)
    sid = new_id()
    now = now_iso()
    doc = {
        "id": sid, "order_number": normalize_order_number(order["order_number"]), "order_id": order["id"],
        "customer_name": body.customer_name.strip(), "email": str(body.email).lower(), "phone": body.phone.strip(),
        "items": items, "problem_type_id": pt["id"], "problem_type_name": pt["name"],
        "defect_description": body.defect_description.strip(), "when_started": body.when_started,
        "product_used": body.product_used, "visual_damage": body.visual_damage,
        "customer_notes": (body.notes or "").strip(), "pickup": body.pickup.model_dump(),
        "file_ids": body.file_ids[:30], "status_id": await default_status_id("service"), "priority": "medium",
        "assigned_to": None, "awb_inbound": None, "awb_outbound": None, "technician_notes": None,
        "shopify_order": order, "consent": _consent(request), "source": "formular",
        "created_at": now, "updated_at": now,
    }
    number = await insert_with_number("service", doc)
    await _link_files(body.file_ids, "service", sid)
    await audit.log(resource_type="service", resource_id=sid, action="created", actor_name=doc["customer_name"],
                    details={"number": number, "order_number": doc["order_number"], "via": "formular online",
                             "problem": pt["name"], "items": [f"{i['quantity']} × {i['title']}" for i in items]},
                    ip=audit.client_ip(request))
    subj, html = emails.service_received(number, doc["customer_name"], doc["order_number"], pt["name"])
    if await emails.send(doc["email"], subj, html):
        await audit.log(resource_type="service", resource_id=sid, action="email_sent",
                        details={"to": doc["email"], "subject": subj})
    return {"id": sid, "service_number": number}


@files_router.get("/files/{file_id}")
async def get_file(file_id: str, download: bool = False):
    rec = await get_db().files.find_one({"id": file_id, "deleted": {"$ne": True}}, {"_id": 0})
    if not rec:
        raise HTTPException(404, "Fișier inexistent")
    p = storage.full_path(rec["path"])
    if not p.exists():
        raise HTTPException(404, "Fișier lipsă de pe disc")
    return FileResponse(p, media_type=rec.get("content_type") or "application/octet-stream",
                        filename=rec.get("original_filename") if download else None,
                        headers={"Cache-Control": "private, max-age=86400"})
