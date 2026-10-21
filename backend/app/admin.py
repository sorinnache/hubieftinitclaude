"""Administrare: import date vechi, registru global de activitate, starea integrărilor."""
import asyncio
import logging
import re
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile

from . import audit, config, emails, gls, shopify
from .auth import get_current_user, require_admin
from .db import get_db, now_iso
from .importer import run_import

log = logging.getLogger("admin")
router = APIRouter(prefix="/admin", tags=["Administrare"])


@router.get("/activity")
async def activity(resource_type: Optional[str] = None, q: Optional[str] = None, limit: int = 300,
                   _: dict = Depends(require_admin)):
    query: dict = {}
    if resource_type:
        query["resource_type"] = resource_type
    if q:
        rx = {"$regex": re.escape(q.strip()), "$options": "i"}
        query["$or"] = [{"actor_name": rx}, {"action": rx}]
    rows = await get_db().activity_logs.find(query, {"_id": 0}).sort("created_at", -1).limit(min(limit, 2000)).to_list(2000)
    # numerele cererilor pentru afișare
    ids = {"return": set(), "service": set()}
    for r in rows:
        if r["resource_type"] in ids:
            ids[r["resource_type"]].add(r["resource_id"])
    nums = {}
    for kind, coll, field in (("return", "returns", "return_number"), ("service", "service_requests", "service_number")):
        async for d in get_db()[coll].find({"id": {"$in": list(ids[kind])}}, {"_id": 0, "id": 1, field: 1}):
            nums[d["id"]] = d.get(field)
    for r in rows:
        r["resource_label"] = nums.get(r["resource_id"])
    return rows


@router.get("/integrations")
async def integrations(_: dict = Depends(get_current_user)):
    shop = await shopify.status()
    g = {"configured": gls.configured(), "ok": False, "error": None, "client_number": config.GLS_CLIENT_NUMBER}
    if g["configured"]:
        try:
            await gls.ping()
            g["ok"] = True
        except Exception as e:  # noqa: BLE001
            g["error"] = str(e)[:300]
    wh = (await get_db().settings.find_one({"key": "warehouse"}, {"_id": 0})) or {}
    return {
        "shopify": shop,
        "gls": g,
        "email": {"configured": bool(config.RESEND_API_KEY), "sender": config.SENDER_EMAIL},
        "warehouse_set": bool((wh.get("address") or {}).get("street")),
        "public_url": config.PUBLIC_URL,
    }


@router.post("/test-email")
async def test_email(user: dict = Depends(require_admin)):
    ok = await emails.send(user["email"], "Test email · Hub IEFTINIT",
                           emails._layout("Emailurile funcționează", "<p>Acesta este un email de test.</p>"))
    if not ok:
        raise HTTPException(400, "Emailul nu a putut fi trimis. Verifică RESEND_API_KEY și SENDER_EMAIL (domeniul trebuie verificat în Resend).")
    return {"ok": True, "to": user["email"]}


# ---------- import ----------
@router.get("/import/status")
async def import_status(_: dict = Depends(require_admin)):
    return (await get_db().settings.find_one({"key": "import_status"}, {"_id": 0})) or {"state": "none"}


@router.post("/import")
async def start_import(request: Request, file: UploadFile = File(...), overwrite: bool = Form(False),
                       user: dict = Depends(require_admin)):
    db = get_db()
    st = await db.settings.find_one({"key": "import_status"}, {"_id": 0})
    if st and st.get("state") == "running":
        raise HTTPException(400, "Un import este deja în desfășurare")
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    dest = config.DATA_DIR / "import.json"
    with dest.open("wb") as out:
        while chunk := await file.read(4 * 1024 * 1024):
            out.write(chunk)

    async def progress(msg, stats):
        await db.settings.update_one({"key": "import_status"}, {"$set": {"message": msg, "stats": stats}})

    async def job():
        await db.settings.update_one({"key": "import_status"}, {"$set": {
            "state": "running", "started_at": now_iso(), "message": "Se importă…", "stats": {}, "error": None,
        }}, upsert=True)
        try:
            stats = await run_import(dest, overwrite=overwrite, progress=progress)
            await db.settings.update_one({"key": "import_status"}, {"$set": {
                "state": "done", "finished_at": now_iso(), "stats": stats, "message": "Import finalizat"}})
            await audit.log(resource_type="settings", resource_id="import", action="import.done", actor=user,
                            details={**stats, "overwrite": overwrite, "file": file.filename},
                            ip=audit.client_ip(request))
        except Exception as e:  # noqa: BLE001
            log.exception("import eșuat")
            await db.settings.update_one({"key": "import_status"}, {"$set": {
                "state": "error", "error": str(e)[:500], "finished_at": now_iso()}})
        finally:
            dest.unlink(missing_ok=True)

    asyncio.create_task(job())
    return {"ok": True}
