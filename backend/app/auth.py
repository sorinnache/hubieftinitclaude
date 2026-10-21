"""Autentificare: utilizatori, sesiune în cookie (JWT), roluri admin/operator."""
import time
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

import bcrypt
import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, EmailStr

from . import audit, config
from .db import get_db, new_id, now_iso

COOKIE = "hub_session"
SESSION_HOURS = 12

router = APIRouter(prefix="/auth", tags=["auth"])
users_router = APIRouter(prefix="/users", tags=["users"])


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def _public_user(u: dict) -> dict:
    return {k: u.get(k) for k in ("id", "email", "name", "role", "active", "created_at", "last_login_at")}


async def get_current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if not token:
        auth = request.headers.get("authorization", "")
        if auth.lower().startswith("bearer "):
            token = auth[7:]
    if not token:
        raise HTTPException(401, "Nu ești autentificat")
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise HTTPException(401, "Sesiune expirată. Autentifică-te din nou.")
    user = await get_db().users.find_one({"id": payload.get("sub")}, {"_id": 0})
    if not user or not user.get("active", True):
        raise HTTPException(401, "Cont inexistent sau dezactivat")
    return user


async def require_admin(user: dict = Depends(get_current_user)) -> dict:
    if user.get("role") != "admin":
        raise HTTPException(403, "Doar administratorii pot face asta")
    return user


async def seed_admin():
    """La prima pornire creează contul de administrator din ADMIN_EMAIL / ADMIN_PASSWORD."""
    db = get_db()
    if await db.users.count_documents({}) > 0 or not config.ADMIN_PASSWORD:
        return
    await db.users.insert_one({
        "id": new_id(),
        "email": config.ADMIN_EMAIL.lower(),
        "name": "Administrator",
        "role": "admin",
        "password_hash": hash_password(config.ADMIN_PASSWORD),
        "active": True,
        "created_at": now_iso(),
    })


# ---------- protecție simplă la încercări repetate ----------
_failed: dict[str, list[float]] = {}


def _too_many(key: str) -> bool:
    now = time.time()
    lst = [t for t in _failed.get(key, []) if now - t < 900]
    _failed[key] = lst
    return len(lst) >= 8


class LoginBody(BaseModel):
    email: str
    password: str


@router.post("/login")
async def login(body: LoginBody, request: Request, response: Response):
    ip = audit.client_ip(request) or "-"
    key = f"{body.email.lower().strip()}|{ip}"
    if _too_many(key):
        raise HTTPException(429, "Prea multe încercări. Mai încearcă peste 15 minute.")
    db = get_db()
    user = await db.users.find_one({"email": body.email.lower().strip()}, {"_id": 0})
    if not user or not user.get("active", True) or not verify_password(body.password, user.get("password_hash", "")):
        _failed.setdefault(key, []).append(time.time())
        raise HTTPException(401, "Email sau parolă greșită")
    _failed.pop(key, None)
    exp = datetime.now(timezone.utc) + timedelta(hours=SESSION_HOURS)
    token = jwt.encode({"sub": user["id"], "exp": exp}, config.JWT_SECRET, algorithm="HS256")
    response.set_cookie(
        COOKIE, token, httponly=True, secure=config.COOKIE_SECURE, samesite="lax",
        max_age=SESSION_HOURS * 3600, path="/",
    )
    await db.users.update_one({"id": user["id"]}, {"$set": {"last_login_at": now_iso()}})
    await audit.log(resource_type="user", resource_id=user["id"], action="user.login",
                    actor=user, ip=ip)
    return {"user": _public_user(user)}


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return _public_user(user)


class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str


@router.post("/change-password")
async def change_password(body: ChangePasswordBody, request: Request, user: dict = Depends(get_current_user)):
    if not verify_password(body.current_password, user.get("password_hash", "")):
        raise HTTPException(400, "Parola actuală nu este corectă")
    if len(body.new_password) < 8:
        raise HTTPException(400, "Parola nouă trebuie să aibă minim 8 caractere")
    await get_db().users.update_one({"id": user["id"]}, {"$set": {"password_hash": hash_password(body.new_password)}})
    await audit.log(resource_type="user", resource_id=user["id"], action="user.password_changed",
                    actor=user, ip=audit.client_ip(request))
    return {"ok": True}


# ---------- administrare utilizatori ----------
class UserCreate(BaseModel):
    email: EmailStr
    name: str
    role: Literal["admin", "operator"] = "operator"
    password: str


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["admin", "operator"]] = None
    active: Optional[bool] = None
    password: Optional[str] = None


@users_router.get("")
async def list_users(_: dict = Depends(get_current_user)):
    users = await get_db().users.find({}, {"_id": 0}).sort("created_at", 1).to_list(500)
    return [_public_user(u) for u in users]


@users_router.post("")
async def create_user(body: UserCreate, request: Request, admin: dict = Depends(require_admin)):
    db = get_db()
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(400, "Există deja un utilizator cu acest email")
    if len(body.password) < 8:
        raise HTTPException(400, "Parola trebuie să aibă minim 8 caractere")
    doc = {
        "id": new_id(), "email": email, "name": body.name.strip(), "role": body.role,
        "password_hash": hash_password(body.password), "active": True, "created_at": now_iso(),
    }
    await db.users.insert_one(dict(doc))
    await audit.log(resource_type="user", resource_id=doc["id"], action="user.created", actor=admin,
                    details={"email": email, "name": doc["name"], "role": body.role}, ip=audit.client_ip(request))
    return _public_user(doc)


@users_router.patch("/{user_id}")
async def update_user(user_id: str, body: UserUpdate, request: Request, admin: dict = Depends(require_admin)):
    db = get_db()
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(404, "Utilizator inexistent")
    upd: dict = {}
    details: dict = {}
    for f in ("name", "role", "active"):
        v = getattr(body, f)
        if v is not None and v != u.get(f):
            upd[f] = v
            details[f] = {"from": u.get(f), "to": v}
    if body.password:
        if len(body.password) < 8:
            raise HTTPException(400, "Parola trebuie să aibă minim 8 caractere")
        upd["password_hash"] = hash_password(body.password)
        details["password"] = "resetată"
    if user_id == admin["id"] and (upd.get("active") is False or upd.get("role") == "operator"):
        raise HTTPException(400, "Nu îți poți dezactiva sau retrograda propriul cont")
    if upd:
        await db.users.update_one({"id": user_id}, {"$set": upd})
        await audit.log(resource_type="user", resource_id=user_id, action="user.updated", actor=admin,
                        details=details, ip=audit.client_ip(request))
    return _public_user({**u, **upd})
