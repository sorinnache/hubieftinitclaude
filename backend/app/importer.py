"""Import din exportul JSON al vechiului hub (Emergent): retururi, service, note, istoric, AWB-uri, fișiere."""
import base64
import json
import logging
from pathlib import Path

from . import storage
from .db import get_db, new_id, now_iso

log = logging.getLogger("import")

CASE_DROP = {"status", "notes", "files", "timeline", "shipment_full", "shipments_full", "assigned_user",
             "problem_type", "assigned_to_user", "_id"}


def _decode_data_url(s: str) -> tuple[bytes, str]:
    head, _, b64 = s.partition(",")
    ct = head[5:].split(";")[0] if head.startswith("data:") else "application/octet-stream"
    return base64.b64decode(b64), ct


async def _upsert(coll, doc: dict, overwrite: bool) -> bool:
    if await coll.find_one({"id": doc["id"]}, {"_id": 1}):
        if not overwrite:
            return False
        await coll.replace_one({"id": doc["id"]}, doc)
        return True
    await coll.insert_one(doc)
    return True


async def run_import(path: Path, overwrite: bool = False, progress=None) -> dict:
    db = get_db()
    data = json.loads(path.read_text(encoding="utf-8"))
    files_blob: dict = data.get("files") or {}
    stats = {"returns": 0, "service": 0, "notes": 0, "files": 0, "history": 0, "shipments": 0,
             "statuses": 0, "skipped": 0, "missing_files": 0}

    async def say(msg):
        if progress:
            await progress(msg, stats)

    # statusuri + tipuri probleme
    for key, coll in (("return_statuses", db.return_statuses), ("service_statuses", db.service_statuses),
                      ("service_problem_types", db.service_problem_types)):
        rows = data.get(key) or []
        if rows:
            ids = {r["id"] for r in rows}
            # înlocuiește statusurile implicite create la prima pornire cu cele vechi (păstrând ID-urile)
            unused = [s["id"] async for s in coll.find({"id": {"$nin": list(ids)}}, {"id": 1})]
            for sid in unused:
                ref = "returns" if key == "return_statuses" else "service_requests" if key == "service_statuses" else None
                if ref is None or not await db[ref].count_documents({"status_id": sid}):
                    await coll.delete_one({"id": sid})
            for row in rows:
                row = {k: v for k, v in row.items() if k != "_id"}
                await coll.replace_one({"id": row["id"]}, row, upsert=True)
                stats["statuses"] += 1

    async def import_files(kind: str, case: dict):
        for f in case.get("files") or []:
            if await db.files.find_one({"id": f["id"]}, {"_id": 1}):
                continue
            blob = files_blob.get(f["id"])
            rec = {"id": f["id"], "ref_type": kind, "ref_id": case["id"], "original_filename": f.get("original_filename"),
                   "source": "client", "created_at": f.get("created_at") or now_iso(), "imported": True}
            if blob:
                raw, ct = _decode_data_url(blob)
                rec.update(storage.save_bytes(f["id"], raw, f.get("content_type") or ct, f.get("original_filename")))
                stats["files"] += 1
            else:
                rec.update({"path": "", "content_type": f.get("content_type"), "size": f.get("size"), "missing": True})
                stats["missing_files"] += 1
            await db.files.insert_one(rec)

    async def import_notes(kind: str, case: dict):
        for n in case.get("notes") or []:
            doc = {"id": n["id"], "ref_type": kind, "ref_id": case["id"], "body": n.get("body", ""),
                   "author_id": None, "author_name": n.get("author_name") or "—", "created_at": n.get("created_at")}
            if await _upsert(db.notes, doc, False):
                stats["notes"] += 1

    async def import_history(kind: str, case: dict, status_names: dict):
        for t in case.get("timeline") or []:
            action = (t.get("action") or "").split(".", 1)[-1]
            det = dict(t.get("details") or {})
            if action == "status_change":
                action = "status_changed"
            elif action == "update":
                det.pop("updated_at", None)
                if "status_id" in det:
                    continue  # schimbarea de status are deja intrare proprie
                action = "updated"
                det = {"fields": {k: {"from": None, "to": v} for k, v in det.items()}}
                if not det["fields"]:
                    continue
            elif action == "created":
                det = {"number": det.get("return_number") or det.get("service_number"),
                       "order_number": det.get("order_number"), "via": "formular online",
                       **({"problem": det["problem"]} if det.get("problem") else {})}
            det["imported"] = True
            doc = {"id": t["id"], "resource_type": kind, "resource_id": case["id"], "action": action,
                   "actor_id": None, "actor_name": t.get("actor_name") or "Sistem", "actor_email": None,
                   "details": det, "ip": None, "created_at": t.get("created_at")}
            if await _upsert(db.activity_logs, doc, False):
                stats["history"] += 1

    async def legacy_events(kind: str, case_id: str, events: list, skip_courier_history: bool = True):
        for ev in events or []:
            if skip_courier_history and ev.get("source") == "courier_history":
                continue
            src = ev.get("source")
            doc = {"id": f"legacy-{ev.get('id') or new_id()}", "resource_type": kind, "resource_id": case_id,
                   "action": "courier_status" if src == "courier" else "legacy_event",
                   "actor_id": None, "actor_name": ev.get("actor") or ("GLS" if src == "courier" else "Sistem"),
                   "actor_email": None,
                   "details": {"text": ev.get("description"), "to": ev.get("description"), "code": ev.get("code"),
                               "imported": True},
                   "ip": None, "created_at": ev.get("at")}
            if await _upsert(db.activity_logs, doc, False):
                stats["history"] += 1

    # ---------- retururi ----------
    rs = {s["id"]: s["name"] for s in await db.return_statuses.find({}, {"_id": 0}).to_list(200)}
    for r in data.get("returns") or []:
        case = {k: v for k, v in r.items() if k not in CASE_DROP}
        case["assigned_to"] = None
        case["imported_from"] = "hub-emergent"
        if await _upsert(db.returns, case, overwrite):
            stats["returns"] += 1
        else:
            stats["skipped"] += 1
        await import_files("return", r)
        await import_notes("return", r)
        await import_history("return", r, rs)
        sf = r.get("shipment_full") or {}
        sh = sf.get("shipment")
        if sh and not await db.shipments.find_one({"id": sh["id"]}, {"_id": 1}):
            label_path = None
            if sh.get("label_b64"):
                try:
                    label_path = storage.save_bytes(f"label-{sh['id']}", base64.b64decode(sh["label_b64"]),
                                                    "application/pdf", "eticheta.pdf")["path"]
                except Exception:  # noqa: BLE001
                    label_path = None
            tracking = sorted(
                [{"code": e.get("code"), "status": e.get("status"), "description": e.get("description"),
                  "depot": e.get("depot"), "at": e.get("at")}
                 for e in sf.get("events") or [] if e.get("source") == "courier_history"],
                key=lambda e: e["at"] or "")
            doc = {"id": sh["id"], "ref_type": "return", "ref_id": r["id"], "ref_number": r.get("return_number"),
                   "courier": sh.get("courier", "gls"), "awb": sh.get("awb"), "parcel_id": sh.get("shipment_id"),
                   "manual": bool(sh.get("manual")), "status": sh.get("status"), "status_code": sh.get("status_code"),
                   "status_description": sh.get("status_description"), "pickup_address": sh.get("pickup_address"),
                   "delivery_address": sh.get("delivery_address"), "parcel_count": sh.get("parcel_count", 1),
                   "label_path": label_path, "tracking": tracking, "created_at": sh.get("created_at"),
                   "created_by": sh.get("created_by"), "delivered_at": sh.get("delivered_at"),
                   "cancelled_at": sh.get("cancelled_at"), "last_event_at": sh.get("last_status_at"), "imported": True}
            await db.shipments.insert_one(doc)
            stats["shipments"] += 1
            if sh.get("delivery_address") and not await db.settings.find_one({"key": "warehouse"}):
                await db.settings.insert_one({"key": "warehouse", "address": sh["delivery_address"]})
        await legacy_events("return", r["id"], sf.get("events"))
    await say("Retururi importate")

    # ---------- service ----------
    ss = {s["id"]: s["name"] for s in await db.service_statuses.find({}, {"_id": 0}).to_list(200)}
    for s in data.get("service_requests") or []:
        case = {k: v for k, v in s.items() if k not in CASE_DROP}
        case["assigned_to"] = None
        case["imported_from"] = "hub-emergent"
        if s.get("problem_type"):
            case["problem_type_name"] = s["problem_type"].get("name")
        sf = s.get("shipments_full") or {}
        case["awb_inbound"] = ((sf.get("inbound") or {}).get("awb")) or case.get("awb")
        case["awb_outbound"] = (sf.get("outbound") or {}).get("awb")
        if await _upsert(db.service_requests, case, overwrite):
            stats["service"] += 1
        else:
            stats["skipped"] += 1
        await import_files("service", s)
        await import_notes("service", s)
        await import_history("service", s, ss)
        await legacy_events("service", s["id"], sf.get("events"), skip_courier_history=False)
    await say("Gata")
    log.info("import: %s", stats)
    return stats
