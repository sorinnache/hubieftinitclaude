"""Istoric complet (registru ANPC).

Colecția `activity_logs` este doar de adăugare: aplicația nu are niciun
endpoint care modifică sau șterge intrări. Fiecare acțiune păstrează cine,
când, de unde (IP) și valorile vechi/noi.
"""
from typing import Optional

from .db import get_db, new_id, now_iso


async def log(
    *,
    resource_type: str,
    resource_id: str,
    action: str,
    actor: Optional[dict] = None,
    actor_name: Optional[str] = None,
    details: Optional[dict] = None,
    ip: Optional[str] = None,
    at: Optional[str] = None,
) -> dict:
    doc = {
        "id": new_id(),
        "resource_type": resource_type,
        "resource_id": resource_id,
        "action": action,
        "actor_id": (actor or {}).get("id"),
        "actor_name": actor_name or (actor or {}).get("name") or "Sistem",
        "actor_email": (actor or {}).get("email"),
        "details": details or {},
        "ip": ip,
        "created_at": at or now_iso(),
    }
    await get_db().activity_logs.insert_one(dict(doc))
    return doc


async def history(resource_type: str, resource_id: str) -> list[dict]:
    cur = get_db().activity_logs.find(
        {"resource_type": resource_type, "resource_id": resource_id}, {"_id": 0}
    ).sort("created_at", 1)
    return await cur.to_list(2000)


def client_ip(request) -> Optional[str]:
    if request is None:
        return None
    fwd = request.headers.get("x-forwarded-for")
    if fwd:
        return fwd.split(",")[0].strip()
    return request.client.host if request.client else None
