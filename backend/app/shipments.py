"""Chemare curier GLS la client pentru retururi + urmărire AWB."""
import asyncio
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

from . import audit, emails, gls, storage
from .auth import get_current_user, require_admin
from .db import get_db, new_id, now_iso

log = logging.getLogger("shipments")
router = APIRouter(tags=["Curier"])


class Address(BaseModel):
    name: str = ""
    contact_name: str = ""
    contact_phone: str = ""
    contact_email: Optional[str] = ""
    street: str = ""
    house_number: str = ""
    city: str = ""
    zip_code: str = ""
    county: Optional[str] = ""
    country: str = "RO"


class PickupBody(BaseModel):
    pickup: Address
    parcel_count: int = 1
    pickup_date: Optional[str] = None  # YYYY-MM-DD
    notify_customer: bool = True


class ManualAwbBody(BaseModel):
    awb: str


async def get_warehouse() -> dict:
    doc = await get_db().settings.find_one({"key": "warehouse"}, {"_id": 0})
    return (doc or {}).get("address") or {}


@router.get("/settings/warehouse")
async def read_warehouse(_: dict = Depends(get_current_user)):
    return await get_warehouse()


@router.put("/settings/warehouse")
async def write_warehouse(body: Address, request: Request, user: dict = Depends(require_admin)):
    old = await get_warehouse()
    await get_db().settings.update_one({"key": "warehouse"}, {"$set": {"address": body.model_dump()}}, upsert=True)
    await audit.log(resource_type="settings", resource_id="warehouse", action="warehouse.updated", actor=user,
                    details={"from": old, "to": body.model_dump()}, ip=audit.client_ip(request))
    return body.model_dump()


@router.get("/returns/{return_id}/pickup-address")
async def suggested_pickup(return_id: str, _: dict = Depends(get_current_user)):
    """Adresa clientului din comanda Shopify — o poți corecta înainte de a chema curierul."""
    ret = await get_db().returns.find_one({"id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(404, "Retur inexistent")
    ship = ((ret.get("shopify_order") or {}).get("shipping_address")) or {}
    street = " ".join(x for x in [(ship.get("address1") or "").strip(), (ship.get("address2") or "").strip()] if x)
    return {
        "name": ret.get("customer_name") or ship.get("name") or "",
        "contact_name": ret.get("customer_name") or ship.get("name") or "",
        "contact_phone": ret.get("phone") or ship.get("phone") or "",
        "contact_email": ret.get("email") or "",
        "street": street,
        "house_number": "",
        "city": ship.get("city") or "",
        "zip_code": ship.get("zip") or "",
        "county": ship.get("province") or "",
        "country": "RO",
    }


async def _active(return_id: str) -> Optional[dict]:
    return await get_db().shipments.find_one(
        {"ref_type": "return", "ref_id": return_id, "status": {"$nin": ["cancelled"]}}, {"_id": 0})


@router.post("/returns/{return_id}/pickup")
async def create_pickup(return_id: str, body: PickupBody, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    ret = await db.returns.find_one({"id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(404, "Retur inexistent")
    if (a := await _active(return_id)) and a.get("awb"):
        raise HTTPException(400, f"Returul are deja AWB activ ({a['awb']}). Anulează-l întâi.")
    wh = await get_warehouse()
    if not wh.get("street") or not wh.get("city"):
        raise HTTPException(400, "Setează adresa depozitului în Setări → Curier GLS")
    p = body.pickup.model_dump()
    missing = [lbl for f, lbl in (("street", "strada"), ("city", "localitatea"), ("zip_code", "codul poștal"),
                                  ("contact_phone", "telefonul")) if not (p.get(f) or "").strip()]
    if missing:
        raise HTTPException(400, "Completează: " + ", ".join(missing))
    pdate = None
    if body.pickup_date:
        try:
            pdate = datetime.fromisoformat(body.pickup_date).replace(hour=9, tzinfo=timezone.utc)
        except ValueError:
            raise HTTPException(400, "Dată ridicare invalidă")
    pdate = pdate or gls.next_business_day()
    try:
        res = await gls.create_pickup(pickup=p, delivery=wh, reference=ret["return_number"],
                                      parcel_count=body.parcel_count, pickup_date=pdate)
    except gls.GlsError as e:
        await audit.log(resource_type="return", resource_id=return_id, action="pickup_failed", actor=user,
                        details={"error": str(e)}, ip=audit.client_ip(request))
        raise HTTPException(400, f"GLS: {e}")
    sid = new_id()
    label_path = None
    if res.get("label_pdf"):
        label_path = storage.save_bytes(f"label-{sid}", res["label_pdf"], "application/pdf", "eticheta.pdf")["path"]
    doc = {
        "id": sid, "ref_type": "return", "ref_id": return_id, "ref_number": ret["return_number"],
        "courier": "gls", "awb": res["awb"], "parcel_id": res["parcel_id"], "manual": False,
        "status": "created", "status_code": None, "status_description": gls.STATUS_LABELS["created"],
        "pickup_address": p, "delivery_address": wh, "parcel_count": body.parcel_count,
        "pickup_date": pdate.date().isoformat(), "label_path": label_path, "tracking": [],
        "created_at": now_iso(), "created_by": user["name"],
    }
    await db.shipments.insert_one(dict(doc))
    await db.returns.update_one({"id": return_id}, {"$set": {"awb": res["awb"], "courier": "gls", "updated_at": now_iso()}})
    await audit.log(resource_type="return", resource_id=return_id, action="pickup_created", actor=user,
                    details={"awb": res["awb"], "pickup_date": doc["pickup_date"], "address": p,
                             "parcel_count": body.parcel_count}, ip=audit.client_ip(request))
    if body.notify_customer and ret.get("email"):
        subj, html = emails.pickup_scheduled(ret["return_number"], ret.get("customer_name", ""), res["awb"],
                                             pdate.strftime("%d.%m.%Y"))
        if await emails.send(ret["email"], subj, html):
            await audit.log(resource_type="return", resource_id=return_id, action="email_sent",
                            details={"to": ret["email"], "subject": subj})
    doc.pop("label_path", None)
    return doc


@router.post("/returns/{return_id}/manual-awb")
async def manual_awb(return_id: str, body: ManualAwbBody, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    ret = await db.returns.find_one({"id": return_id}, {"_id": 0})
    if not ret:
        raise HTTPException(404, "Retur inexistent")
    awb = body.awb.strip().replace(" ", "")
    if not awb.isdigit() or len(awb) < 8:
        raise HTTPException(400, "AWB invalid — doar cifre, minim 8")
    if (a := await _active(return_id)) and a.get("awb"):
        raise HTTPException(400, f"Returul are deja AWB activ ({a['awb']}). Anulează-l întâi.")
    doc = {"id": new_id(), "ref_type": "return", "ref_id": return_id, "ref_number": ret["return_number"],
           "courier": "gls", "awb": awb, "parcel_id": None, "manual": True, "status": "created",
           "status_description": gls.STATUS_LABELS["created"], "tracking": [], "created_at": now_iso(),
           "created_by": user["name"]}
    await db.shipments.insert_one(dict(doc))
    await db.returns.update_one({"id": return_id}, {"$set": {"awb": awb, "courier": "gls", "updated_at": now_iso()}})
    await audit.log(resource_type="return", resource_id=return_id, action="manual_awb", actor=user,
                    details={"awb": awb}, ip=audit.client_ip(request))
    await sync_one(doc)
    return await db.shipments.find_one({"id": doc["id"]}, {"_id": 0, "label_path": 0})


async def sync_one(s: dict) -> dict:
    """Actualizează statusul unui AWB din MyGLS și notează schimbările în istoric."""
    db = get_db()
    try:
        t = await gls.tracking(s["awb"])
    except Exception as e:  # noqa: BLE001
        await db.shipments.update_one({"id": s["id"]}, {"$set": {"sync_error": str(e)[:300], "synced_at": now_iso()}})
        return {"ok": False, "error": str(e)}
    upd = {"synced_at": now_iso(), "sync_error": None}
    if t["events"]:
        upd.update({"tracking": t["events"], "status": t["status"], "status_code": t["status_code"],
                    "status_description": t["status_description"], "last_event_at": t["last_event_at"]})
        if t["status"] == "delivered":
            upd["delivered_at"] = t["last_event_at"]
    await db.shipments.update_one({"id": s["id"]}, {"$set": upd})
    if t["events"] and t["status"] != s.get("status"):
        await audit.log(resource_type=s["ref_type"], resource_id=s["ref_id"], action="courier_status",
                        actor_name="GLS", details={"awb": s["awb"], "from": gls.STATUS_LABELS.get(s.get("status"), s.get("status")),
                                                   "to": t["status_description"], "code": t["status_code"]})
    return {"ok": True, "status": upd.get("status", s.get("status"))}


@router.post("/shipments/{sid}/sync")
async def sync(sid: str, _: dict = Depends(get_current_user)):
    s = await get_db().shipments.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(404, "AWB inexistent")
    res = await sync_one(s)
    if not res["ok"]:
        raise HTTPException(502, f"GLS: {res['error']}")
    return await get_db().shipments.find_one({"id": sid}, {"_id": 0, "label_path": 0})


@router.get("/shipments/{sid}/label")
async def label(sid: str, _: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.shipments.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(404, "AWB inexistent")
    if s.get("label_path"):
        p = storage.full_path(s["label_path"])
        if p.exists():
            return FileResponse(p, media_type="application/pdf", filename=f"AWB-{s['awb']}.pdf")
    try:
        pdf = await gls.label_pdf(s["awb"], s.get("parcel_id"))
    except gls.GlsError as e:
        raise HTTPException(502, f"GLS: {e}")
    path = storage.save_bytes(f"label-{sid}", pdf, "application/pdf", "eticheta.pdf")["path"]
    await db.shipments.update_one({"id": sid}, {"$set": {"label_path": path}})
    return Response(pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'inline; filename="AWB-{s["awb"]}.pdf"'})


@router.post("/shipments/{sid}/cancel")
async def cancel(sid: str, request: Request, user: dict = Depends(get_current_user)):
    db = get_db()
    s = await db.shipments.find_one({"id": sid}, {"_id": 0})
    if not s:
        raise HTTPException(404, "AWB inexistent")
    if not s.get("manual"):
        try:
            await gls.cancel(s.get("parcel_id"))
        except gls.GlsError as e:
            raise HTTPException(400, f"GLS: {e}")
    await db.shipments.update_one({"id": sid}, {"$set": {"status": "cancelled", "status_description": "Anulat",
                                                         "cancelled_at": now_iso(), "cancelled_by": user["name"]}})
    await db[{"return": "returns", "service": "service_requests"}[s["ref_type"]]].update_one(
        {"id": s["ref_id"]}, {"$set": {"awb": None, "updated_at": now_iso()}})
    await audit.log(resource_type=s["ref_type"], resource_id=s["ref_id"], action="pickup_cancelled", actor=user,
                    details={"awb": s["awb"], "manual": bool(s.get("manual"))}, ip=audit.client_ip(request))
    return {"ok": True}


async def tracking_loop():
    """La fiecare 2 ore actualizează toate AWB-urile încă active."""
    await asyncio.sleep(60)
    while True:
        try:
            if gls.configured():
                cur = get_db().shipments.find({"status": {"$nin": list(gls.FINAL)}, "awb": {"$ne": None}}, {"_id": 0})
                async for s in cur:
                    await sync_one(s)
                    await asyncio.sleep(1)
        except Exception as e:  # noqa: BLE001
            log.error("tracking loop: %s", e)
        await asyncio.sleep(2 * 3600)
