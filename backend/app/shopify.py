"""Shopify: căutare comenzi după număr + validare telefon/email.

Tokenul de acces se obține, în ordine:
  1. SHOPIFY_ACCESS_TOKEN (dacă e setat în Railway)
  2. tokenul salvat în baza de date după instalarea aplicației (buton „Conectează Shopify”)
  3. client credentials (aplicație din Dev Dashboard, aceeași organizație cu magazinul)
"""
import asyncio
import hashlib
import hmac
import logging
import secrets
import time
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse

from . import audit, config
from .auth import require_admin
from .db import get_db, now_iso
from .normalize import normalize_order_number, normalize_phone_ro

log = logging.getLogger("shopify")

router = APIRouter(prefix="/shopify", tags=["shopify"])

_cc_cache: dict = {"token": None, "exp": 0.0}


async def _shop() -> str:
    if config.SHOPIFY_SHOP:
        return config.SHOPIFY_SHOP
    doc = await get_db().settings.find_one({"key": "shopify"}, {"_id": 0})
    return (doc or {}).get("shop", "")


async def _token() -> Optional[str]:
    if config.SHOPIFY_ACCESS_TOKEN:
        return config.SHOPIFY_ACCESS_TOKEN
    doc = await get_db().settings.find_one({"key": "shopify"}, {"_id": 0})
    if doc and doc.get("access_token"):
        return doc["access_token"]
    shop = await _shop()
    if shop and config.SHOPIFY_CLIENT_ID and config.SHOPIFY_CLIENT_SECRET:
        if _cc_cache["token"] and time.time() < _cc_cache["exp"]:
            return _cc_cache["token"]
        try:
            async with httpx.AsyncClient(timeout=20) as cli:
                r = await cli.post(
                    f"https://{shop}/admin/oauth/access_token",
                    data={
                        "grant_type": "client_credentials",
                        "client_id": config.SHOPIFY_CLIENT_ID,
                        "client_secret": config.SHOPIFY_CLIENT_SECRET,
                    },
                )
            if r.status_code == 200 and r.json().get("access_token"):
                data = r.json()
                _cc_cache["token"] = data["access_token"]
                _cc_cache["exp"] = time.time() + int(data.get("expires_in", 86399)) - 120
                return _cc_cache["token"]
            log.warning("client_credentials refuzat: %s %s", r.status_code, r.text[:200])
        except Exception as e:  # noqa: BLE001
            log.warning("client_credentials eșuat: %s", e)
    return None


async def graphql(query: str, variables: dict | None = None) -> dict:
    shop, token = await _shop(), await _token()
    if not shop or not token:
        raise RuntimeError("Shopify nu este conectat")
    url = f"https://{shop}/admin/api/{config.SHOPIFY_API_VERSION}/graphql.json"
    for attempt in range(5):
        async with httpx.AsyncClient(timeout=40) as cli:
            r = await cli.post(url, json={"query": query, "variables": variables or {}},
                               headers={"X-Shopify-Access-Token": token, "Content-Type": "application/json"})
        if r.status_code == 401:
            _cc_cache["token"] = None
        if r.status_code in (429, 502, 503):
            await asyncio.sleep(2 + attempt * 2)
            continue
        r.raise_for_status()
        data = r.json()
        errs = data.get("errors") or []
        if errs and any((e.get("extensions") or {}).get("code") == "THROTTLED" for e in errs if isinstance(e, dict)):
            await asyncio.sleep(2 + attempt * 2)
            continue
        if errs:
            raise RuntimeError(f"Shopify: {str(errs)[:300]}")
        return data["data"]
    raise RuntimeError("Shopify: prea multe cereri, reîncearcă")


ORDER_QUERY = """
query OrderLookup($q: String!) {
  orders(first: 5, query: $q) {
    edges { node {
      id name email phone createdAt
      displayFinancialStatus displayFulfillmentStatus
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      customer { firstName lastName }
      billingAddress { name firstName lastName phone address1 address2 city zip province country }
      shippingAddress { name firstName lastName phone address1 address2 city zip province country }
      lineItems(first: 100) { edges { node {
        id title variantTitle quantity sku
        product { id }
        variant { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        image { url }
      } } }
    } }
  }
}
"""


def _tail(gid: str | None) -> str:
    return (gid or "").split("/")[-1]


def _normalize(node: dict) -> dict:
    items = []
    for e in (node.get("lineItems") or {}).get("edges", []):
        li = e["node"]
        price = (((li.get("originalUnitPriceSet") or {}).get("shopMoney") or {}).get("amount")) or "0.00"
        items.append({
            "id": _tail(li.get("id")),
            "product_id": _tail((li.get("product") or {}).get("id")),
            "variant_id": _tail((li.get("variant") or {}).get("id")),
            "title": li.get("title"),
            "variant_title": li.get("variantTitle"),
            "sku": li.get("sku"),
            "quantity": li.get("quantity", 1),
            "price": str(price),
            "image": (li.get("image") or {}).get("url"),
        })
    cust = node.get("customer") or {}
    ship = node.get("shippingAddress") or {}
    bill = node.get("billingAddress") or {}
    phones = [p for p in (node.get("phone"), ship.get("phone"), bill.get("phone")) if p]
    money = (node.get("currentTotalPriceSet") or {}).get("shopMoney") or {}
    name = node.get("name") or ""
    return {
        "id": node.get("id"),
        "order_number": name.lstrip("#"),
        "name": name,
        "email": node.get("email"),
        "phone": phones[0] if phones else None,
        "phone_candidates": phones,
        "customer": {"first_name": cust.get("firstName") or ship.get("firstName"),
                     "last_name": cust.get("lastName") or ship.get("lastName")},
        "shipping_address": ship,
        "billing_address": bill,
        "total_price": str(money.get("amount") or "0.00"),
        "currency": money.get("currencyCode") or "RON",
        "created_at": node.get("createdAt"),
        "financial_status": (node.get("displayFinancialStatus") or "").lower() or None,
        "fulfillment_status": (node.get("displayFulfillmentStatus") or "").lower() or None,
        "line_items": items,
        "fetched_at": now_iso(),
    }


async def get_order(order_number: str) -> Optional[dict]:
    key = normalize_order_number(order_number)
    if not key:
        return None
    for q in (f"name:#{key}", f"name:{key}"):
        data = await graphql(ORDER_QUERY, {"q": q})
        for e in (data.get("orders") or {}).get("edges") or []:
            o = _normalize(e["node"])
            if o["order_number"] == key:
                return o
    return None


def identity_matches(order: dict, phone: str | None = None, email: str | None = None) -> bool:
    if phone:
        n = normalize_phone_ro(phone)
        if n and n in {normalize_phone_ro(p) for p in order.get("phone_candidates") or []}:
            return True
    if email:
        if (order.get("email") or "").lower().strip() == email.lower().strip():
            return True
    return False


def admin_order_url(order: dict | None, shop: str | None = None) -> Optional[str]:
    if not order or not order.get("id"):
        return None
    store = (shop or config.SHOPIFY_SHOP or "").replace(".myshopify.com", "")
    if not store:
        return None
    return f"https://admin.shopify.com/store/{store}/orders/{_tail(order['id'])}"


# ---------- status + instalare (OAuth) ----------
async def status() -> dict:
    shop = await _shop()
    info = {"shop": shop, "connected": False, "method": None, "error": None}
    if not shop:
        info["error"] = "Lipsește SHOPIFY_SHOP"
        return info
    try:
        data = await graphql("{ shop { name myshopifyDomain } }")
        info["connected"] = True
        info["shop_name"] = data["shop"]["name"]
        info["method"] = ("token din variabile" if config.SHOPIFY_ACCESS_TOKEN else
                          "aplicație instalată" if (await get_db().settings.find_one({"key": "shopify", "access_token": {"$exists": True}}))
                          else "client credentials")
    except Exception as e:  # noqa: BLE001
        info["error"] = str(e)[:300]
    return info


@router.get("/install")
async def install(request: Request, admin: dict = Depends(require_admin)):
    shop = await _shop()
    if not shop or not config.SHOPIFY_CLIENT_ID:
        raise HTTPException(400, "Setează SHOPIFY_SHOP și SHOPIFY_CLIENT_ID în Railway")
    state = secrets.token_urlsafe(24)
    await get_db().settings.update_one({"key": "shopify_oauth_state"},
                                       {"$set": {"state": state, "at": time.time()}}, upsert=True)
    params = {
        "client_id": config.SHOPIFY_CLIENT_ID,
        "scope": config.SHOPIFY_SCOPES,
        "redirect_uri": f"{config.PUBLIC_URL}/api/shopify/callback",
        "state": state,
    }
    return {"url": f"https://{shop}/admin/oauth/authorize?{urlencode(params)}"}


@router.get("/callback")
async def callback(request: Request):
    q = dict(request.query_params)
    db = get_db()
    st = await db.settings.find_one({"key": "shopify_oauth_state"}, {"_id": 0})
    if not st or q.get("state") != st.get("state") or time.time() - st.get("at", 0) > 900:
        raise HTTPException(400, "Cerere de instalare expirată. Încearcă din nou din Setări → Integrări.")
    received = q.pop("hmac", "")
    q.pop("signature", None)
    msg = "&".join(f"{k}={v}" for k, v in sorted(q.items()))
    digest = hmac.new(config.SHOPIFY_CLIENT_SECRET.encode(), msg.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest, received):
        raise HTTPException(400, "Semnătură Shopify invalidă")
    shop = q.get("shop", "")
    async with httpx.AsyncClient(timeout=30) as cli:
        r = await cli.post(f"https://{shop}/admin/oauth/access_token", json={
            "client_id": config.SHOPIFY_CLIENT_ID, "client_secret": config.SHOPIFY_CLIENT_SECRET, "code": q.get("code"),
        })
    r.raise_for_status()
    data = r.json()
    await db.settings.update_one({"key": "shopify"}, {"$set": {
        "shop": shop, "access_token": data["access_token"], "scopes": data.get("scope"), "installed_at": now_iso(),
    }}, upsert=True)
    await audit.log(resource_type="settings", resource_id="shopify", action="shopify.connected",
                    details={"shop": shop, "scopes": data.get("scope")}, ip=audit.client_ip(request))
    return RedirectResponse("/setari?shopify=ok")
