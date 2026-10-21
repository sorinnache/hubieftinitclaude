"""Logică comună pentru Retururi și Service (listă, detalii, statusuri, note, fișiere, istoric)."""
import re
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile
from pydantic import BaseModel

from . import audit, shopify, storage
from .auth import get_current_user, require_admin
from .db import get_db, new_id, now_iso

KINDS: dict[str, dict] = {
    "return": {
        "coll": "returns", "num": "return_number", "prefix": "RET", "statuses": "return_statuses",
        "label": "Retur",
        "default_statuses": [
            ("Nou", "#3b82f6", False), ("În verificare", "#f59e0b", False), ("Aprobat", "#10b981", False),
            ("Așteaptă curier", "#8b5cf6", False), ("Produs recepționat", "#06b6d4", False),
            ("Rambursat", "#22c55e", True), ("Respins", "#ef4444", True), ("Închis", "#71717a", True),
        ],
    },
    "service": {
        "coll": "service_requests", "num": "service_number", "prefix": "SVC", "statuses": "service_statuses",
        "label": "Service",
        "default_statuses": [
            ("Nou", "#3b82f6", False), ("Diagnosticare", "#f59e0b", False), ("Așteaptă piesă", "#a855f7", False),
            ("În reparație", "#06b6d4", False), ("Reparat", "#10b981", False),
            ("Trimis către client", "#8b5cf6", False), ("Finalizat", "#22c55e", True),
            ("Respins garanție", "#ef4444", True),
        ],
    },
}

DEFAULT_PROBLEM_TYPES = ["Nu pornește", "Defect electric", "Defect mecanic", "Produs incomplet",
                         "Problemă baterie", "Problemă încărcare", "Problemă motor", "Problemă accesorii",
                         "Altă problemă"]

PRIORITIES = ("low", "medium", "high", "urgent")


async def seed_defaults():
    db = get_db()
    for kind, k in KINDS.items():
        if await db[k["statuses"]].count_documents({}) == 0:
            for i, (name, color, term) in enumerate(k["default_statuses"]):
                await db[k["statuses"]].insert_one({
                    "id": new_id(), "name": name, "color": color, "order": i,
                    "is_default": i == 0, "is_terminal": term, "created_at": now_iso(),
                })
    if await db.service_problem_types.count_documents({}) == 0:
        for i, n in enumerate(DEFAULT_PROBLEM_TYPES):
            await db.service_problem_types.insert_one({"id": new_id(), "name": n, "order": i, "active": True,
                                                       "created_at": now_iso()})


async def default_status_id(kind: str) -> str:
    db = get_db()
    coll = db[KINDS[kind]["statuses"]]
    s = await coll.find_one({"is_default": True}, {"_id": 0}) or await coll.find_one({}, {"_id": 0}, sort=[("order", 1)])
    if not s:
        raise HTTPException(500, "Nu există statusuri definite")
    return s["id"]


async def next_number(kind: str) -> str:
    k = KINDS[kind]
    prefix = f"{k['prefix']}-{datetime.now().year}-"
    last = await get_db()[k["coll"]].find(
        {k["num"]: {"$regex": f"^{re.escape(prefix)}"}}, {"_id": 0, k["num"]: 1}
    ).sort(k["num"], -1).limit(1).to_list(1)
    seq = int(last[0][k["num"]].rsplit("-", 1)[-1]) + 1 if last else 1
    return f"{prefix}{seq:05d}"


async def insert_with_number(kind: str, doc: dict) -> str:
    """Alocă următorul număr (RET-2026-00083 …) și inserează; reîncearcă la coliziune."""
    k = KINDS[kind]
    coll = get_db()[k["coll"]]
    for _ in range(8):
        doc[k["num"]] = await next_number(kind)
        try:
            await coll.insert_one(dict(doc))
            return doc[k["num"]]
        except Exception as e:  # noqa: BLE001  (DuplicateKeyError)
            if "duplicate" not in str(e).lower():
                raise
    raise HTTPException(500, "Nu am putut genera numărul cererii. Încearcă din nou.")


# ---------------- modele ----------------
class StatusBody(BaseModel):
    name: str
    color: str = "#71717a"
    is_terminal: bool = False


class StatusPatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    is_terminal: Optional[bool] = None
    is_default: Optional[bool] = None


class ReorderBody(BaseModel):
    order: list[str]


class NoteBody(BaseModel):
    body: str


class ReturnPatch(BaseModel):
    status_id: Optional[str] = None
    priority: Optional[Literal["low", "medium", "high", "urgent"]] = None
    assigned_to: Optional[str] = None
    return_type: Optional[Literal["refund", "exchange", "voucher"]] = None
    customer_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    iban: Optional[str] = None
    bank: Optional[str] = None
    refund_amount: Optional[str] = None
    refund_date: Optional[str] = None
    resolution: Optional[str] = None


class PickupPatch(BaseModel):
    address1: Optional[str] = None
    city: Optional[str] = None
    county: Optional[str] = None
    zip: Optional[str] = None
    contact_name: Optional[str] = None
    contact_phone: Optional[str] = None
    preferred_slot: Optional[str] = None


class ServicePatch(BaseModel):
    status_id: Optional[str] = None
    priority: Optional[Literal["low", "medium", "high", "urgent"]] = None
    assigned_to: Optional[str] = None
    customer_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    technician_notes: Optional[str] = None
    resolution: Optional[str] = None
    awb_inbound: Optional[str] = None
    awb_outbound: Optional[str] = None
    pickup: Optional[PickupPatch] = None


FIELD_LABELS = {
    "status_id": "Status", "priority": "Prioritate", "assigned_to": "Responsabil", "return_type": "Tip retur",
    "customer_name": "Nume client", "email": "Email", "phone": "Telefon", "iban": "IBAN", "bank": "Bancă",
    "refund_amount": "Sumă rambursată", "refund_date": "Data rambursării", "resolution": "Rezoluție",
    "technician_notes": "Note tehnician", "awb_inbound": "AWB ridicare", "awb_outbound": "AWB trimitere",
    "pickup": "Adresă ridicare",
}


async def _status_map(kind: str) -> dict:
    sts = await get_db()[KINDS[kind]["statuses"]].find({}, {"_id": 0}).sort("order", 1).to_list(200)
    return {s["id"]: s for s in sts}


async def _users_map() -> dict:
    us = await get_db().users.find({}, {"_id": 0, "id": 1, "name": 1, "email": 1}).to_list(500)
    return {u["id"]: u for u in us}


def build_router(kind: str) -> APIRouter:
    k = KINDS[kind]
    path = "/returns" if kind == "return" else "/service"
    r = APIRouter(prefix=path, tags=[k["label"]])
    PatchModel = ReturnPatch if kind == "return" else ServicePatch

    # ---------- statusuri ----------
    @r.get("/statuses")
    async def list_statuses(_: dict = Depends(get_current_user)):
        return await get_db()[k["statuses"]].find({}, {"_id": 0}).sort("order", 1).to_list(200)

    @r.post("/statuses")
    async def create_status(body: StatusBody, request: Request, user: dict = Depends(require_admin)):
        coll = get_db()[k["statuses"]]
        n = await coll.count_documents({})
        doc = {"id": new_id(), "name": body.name.strip(), "color": body.color, "order": n,
               "is_default": False, "is_terminal": body.is_terminal, "created_at": now_iso()}
        await coll.insert_one(dict(doc))
        await audit.log(resource_type=f"{kind}_status", resource_id=doc["id"], action="status.created",
                        actor=user, details={"name": doc["name"]}, ip=audit.client_ip(request))
        return doc

    @r.patch("/statuses/{sid}")
    async def update_status(sid: str, body: StatusPatch, request: Request, user: dict = Depends(require_admin)):
        coll = get_db()[k["statuses"]]
        cur = await coll.find_one({"id": sid}, {"_id": 0})
        if not cur:
            raise HTTPException(404, "Status inexistent")
        upd = {f: v for f, v in body.model_dump().items() if v is not None}
        if upd.get("is_default"):
            await coll.update_many({}, {"$set": {"is_default": False}})
        await coll.update_one({"id": sid}, {"$set": upd})
        await audit.log(resource_type=f"{kind}_status", resource_id=sid, action="status.updated", actor=user,
                        details={f: {"from": cur.get(f), "to": v} for f, v in upd.items()}, ip=audit.client_ip(request))
        return await coll.find_one({"id": sid}, {"_id": 0})

    @r.delete("/statuses/{sid}")
    async def delete_status(sid: str, request: Request, user: dict = Depends(require_admin)):
        db = get_db()
        cur = await db[k["statuses"]].find_one({"id": sid}, {"_id": 0})
        if not cur:
            raise HTTPException(404, "Status inexistent")
        used = await db[k["coll"]].count_documents({"status_id": sid})
        if used:
            raise HTTPException(400, f"Statusul este folosit de {used} cereri și nu poate fi șters")
        if cur.get("is_default"):
            raise HTTPException(400, "Statusul implicit nu poate fi șters")
        await db[k["statuses"]].delete_one({"id": sid})
        await audit.log(resource_type=f"{kind}_status", resource_id=sid, action="status.deleted", actor=user,
                        details={"name": cur["name"]}, ip=audit.client_ip(request))
        return {"ok": True}

    @r.post("/statuses/reorder")
    async def reorder(body: ReorderBody, user: dict = Depends(require_admin)):
        coll = get_db()[k["statuses"]]
        for i, sid in enumerate(body.order):
            await coll.update_one({"id": sid}, {"$set": {"order": i}})
        return {"ok": True}

    # ---------- listă ----------
    @r.get("")
    async def list_items(q: Optional[str] = None, status_id: Optional[str] = None, priority: Optional[str] = None,
                         type: Optional[str] = None, open_only: bool = False,
                         _: dict = Depends(get_current_user)):
        db = get_db()
        query: dict[str, Any] = {}
        statuses = await _status_map(kind)
        if status_id:
            query["status_id"] = status_id
        elif open_only:
            query["status_id"] = {"$in": [s for s, v in statuses.items() if not v.get("is_terminal")]}
        if priority:
            query["priority"] = priority
        if type:
            query["return_type" if kind == "return" else "problem_type_id"] = type
        if q:
            rx = {"$regex": re.escape(q.strip().lstrip("#")), "$options": "i"}
            query["$or"] = [{k["num"]: rx}, {"order_number": rx}, {"customer_name": rx}, {"email": rx},
                            {"phone": rx}, {"awb": rx}, {"items.title": rx}]
        proj = {"_id": 0, "shopify_order": 0}
        items = await db[k["coll"]].find(query, proj).sort("created_at", -1).to_list(5000)
        users = await _users_map()
        ships: dict = {}
        if kind == "return" and items:
            async for s in db.shipments.find({"ref_type": "return", "ref_id": {"$in": [i["id"] for i in items]},
                                              "status": {"$ne": "cancelled"}},
                                             {"_id": 0, "tracking": 0}).sort("created_at", 1):
                ships[s["ref_id"]] = s
        pts = {}
        if kind == "service":
            pts = {p["id"]: p for p in await db.service_problem_types.find({}, {"_id": 0}).to_list(200)}
        for it in items:
            it["status"] = statuses.get(it.get("status_id"))
            it["assigned_user"] = users.get(it.get("assigned_to"))
            if kind == "return":
                sh = ships.get(it["id"])
                it["shipment"] = {"awb": sh["awb"], "status": sh.get("status"),
                                  "status_description": sh.get("status_description")} if sh else None
            else:
                it["problem_type"] = pts.get(it.get("problem_type_id"))
        return items

    @r.get("/stats")
    async def stats(_: dict = Depends(get_current_user)):
        db = get_db()
        statuses = await _status_map(kind)
        out = []
        for sid, s in statuses.items():
            out.append({"status": s, "count": await db[k["coll"]].count_documents({"status_id": sid})})
        return {"total": await db[k["coll"]].count_documents({}), "by_status": out}

    # ---------- detalii ----------
    async def _get(item_id: str) -> dict:
        doc = await get_db()[k["coll"]].find_one({"id": item_id}, {"_id": 0})
        if not doc:
            raise HTTPException(404, "Cerere inexistentă")
        return doc

    @r.get("/{item_id}")
    async def detail(item_id: str, _: dict = Depends(get_current_user)):
        db = get_db()
        doc = await _get(item_id)
        statuses = await _status_map(kind)
        doc["status"] = statuses.get(doc.get("status_id"))
        doc["assigned_user"] = (await _users_map()).get(doc.get("assigned_to"))
        doc["files"] = await db.files.find({"ref_type": kind, "ref_id": item_id, "deleted": {"$ne": True}},
                                           {"_id": 0}).sort("created_at", 1).to_list(500)
        doc["notes"] = await db.notes.find({"ref_type": kind, "ref_id": item_id}, {"_id": 0}).sort("created_at", 1).to_list(1000)
        doc["history"] = await audit.history(kind, item_id)
        doc["shopify_admin_url"] = shopify.admin_order_url(doc.get("shopify_order"))
        if kind == "return":
            doc["shipments"] = await db.shipments.find({"ref_type": "return", "ref_id": item_id},
                                                       {"_id": 0, "label_path": 0}).sort("created_at", -1).to_list(50)
        else:
            if doc.get("problem_type_id"):
                doc["problem_type"] = await db.service_problem_types.find_one({"id": doc["problem_type_id"]}, {"_id": 0})
        return doc

    @r.patch("/{item_id}")
    async def update(item_id: str, body: PatchModel, request: Request, user: dict = Depends(get_current_user)):  # type: ignore[valid-type]
        db = get_db()
        cur = await _get(item_id)
        raw = body.model_dump(exclude_unset=True)
        upd: dict = {}
        changes: dict = {}
        statuses = await _status_map(kind)
        users = await _users_map()
        for f, v in raw.items():
            if f == "pickup":
                merged = dict(cur.get("pickup") or {})
                merged.update({a: b for a, b in (v or {}).items() if b is not None})
                if merged != (cur.get("pickup") or {}):
                    upd["pickup"] = merged
                    changes["pickup"] = {"from": cur.get("pickup"), "to": merged}
                continue
            if isinstance(v, str):
                v = v.strip()
            if f == "status_id" and v not in statuses:
                raise HTTPException(400, "Status invalid")
            if v == cur.get(f) or (v in ("", None) and cur.get(f) in ("", None)):
                continue
            upd[f] = v
            old = cur.get(f)
            if f == "status_id":
                changes[f] = {"from": (statuses.get(old) or {}).get("name"), "to": statuses[v]["name"]}
            elif f == "assigned_to":
                changes[f] = {"from": (users.get(old) or {}).get("name"), "to": (users.get(v) or {}).get("name")}
            else:
                changes[f] = {"from": old, "to": v}
        if not upd:
            return await detail(item_id, user)
        upd["updated_at"] = now_iso()
        await db[k["coll"]].update_one({"id": item_id}, {"$set": upd})
        ip = audit.client_ip(request)
        if "status_id" in changes:
            await audit.log(resource_type=kind, resource_id=item_id, action="status_changed", actor=user,
                            details=changes.pop("status_id"), ip=ip)
        if changes:
            await audit.log(resource_type=kind, resource_id=item_id, action="updated", actor=user,
                            details={"fields": {FIELD_LABELS.get(f, f): c for f, c in changes.items()}}, ip=ip)
        return await detail(item_id, user)

    # ---------- note interne ----------
    @r.post("/{item_id}/notes")
    async def add_note(item_id: str, body: NoteBody, request: Request, user: dict = Depends(get_current_user)):
        await _get(item_id)
        text = body.body.strip()
        if not text:
            raise HTTPException(400, "Nota este goală")
        doc = {"id": new_id(), "ref_type": kind, "ref_id": item_id, "body": text,
               "author_id": user["id"], "author_name": user["name"], "created_at": now_iso()}
        await get_db().notes.insert_one(dict(doc))
        await audit.log(resource_type=kind, resource_id=item_id, action="note_added", actor=user,
                        details={"text": text[:500]}, ip=audit.client_ip(request))
        return doc

    # ---------- fișiere adăugate de operator ----------
    @r.post("/{item_id}/files")
    async def add_file(item_id: str, request: Request, file: UploadFile = File(...), user: dict = Depends(get_current_user)):
        await _get(item_id)
        fid = new_id()
        saved = await storage.save_upload(file, fid)
        doc = {"id": fid, "ref_type": kind, "ref_id": item_id, "original_filename": file.filename,
               "uploaded_by": user["name"], "source": "operator", "created_at": now_iso(), **saved}
        await get_db().files.insert_one(dict(doc))
        await audit.log(resource_type=kind, resource_id=item_id, action="file_added", actor=user,
                        details={"filename": file.filename}, ip=audit.client_ip(request))
        return doc

    # ---------- reîmprospătare date comandă din Shopify ----------
    @r.post("/{item_id}/refresh-order")
    async def refresh_order(item_id: str, request: Request, user: dict = Depends(get_current_user)):
        cur = await _get(item_id)
        try:
            order = await shopify.get_order(cur["order_number"])
        except Exception as e:  # noqa: BLE001
            raise HTTPException(502, f"Shopify: {e}")
        if not order:
            raise HTTPException(404, "Comanda nu a fost găsită în Shopify")
        await get_db()[k["coll"]].update_one({"id": item_id}, {"$set": {"shopify_order": order}})
        await audit.log(resource_type=kind, resource_id=item_id, action="order_refreshed", actor=user,
                        ip=audit.client_ip(request))
        return await detail(item_id, user)

    return r


# ---------------- tipuri probleme (service) ----------------
problem_types_router = APIRouter(prefix="/service-problem-types", tags=["Service"])


class ProblemTypeBody(BaseModel):
    name: str


class ProblemTypePatch(BaseModel):
    name: Optional[str] = None
    active: Optional[bool] = None


@problem_types_router.get("")
async def list_problem_types(_: dict = Depends(get_current_user)):
    return await get_db().service_problem_types.find({}, {"_id": 0}).sort("order", 1).to_list(200)


@problem_types_router.post("")
async def create_problem_type(body: ProblemTypeBody, request: Request, user: dict = Depends(require_admin)):
    coll = get_db().service_problem_types
    doc = {"id": new_id(), "name": body.name.strip(), "order": await coll.count_documents({}), "active": True,
           "created_at": now_iso()}
    await coll.insert_one(dict(doc))
    await audit.log(resource_type="problem_type", resource_id=doc["id"], action="problem_type.created", actor=user,
                    details={"name": doc["name"]}, ip=audit.client_ip(request))
    return doc


@problem_types_router.patch("/{pid}")
async def update_problem_type(pid: str, body: ProblemTypePatch, request: Request, user: dict = Depends(require_admin)):
    coll = get_db().service_problem_types
    upd = {f: v for f, v in body.model_dump().items() if v is not None}
    await coll.update_one({"id": pid}, {"$set": upd})
    await audit.log(resource_type="problem_type", resource_id=pid, action="problem_type.updated", actor=user,
                    details=upd, ip=audit.client_ip(request))
    return await coll.find_one({"id": pid}, {"_id": 0})


@problem_types_router.post("/reorder")
async def reorder_problem_types(body: ReorderBody, user: dict = Depends(require_admin)):
    coll = get_db().service_problem_types
    for i, pid in enumerate(body.order):
        await coll.update_one({"id": pid}, {"$set": {"order": i}})
    return {"ok": True}
