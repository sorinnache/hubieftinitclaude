"""Toate setările vin din variabile de mediu (Railway → Variables)."""
import os
from pathlib import Path


def env(name: str, default: str = "") -> str:
    return (os.environ.get(name) or default).strip()


MONGO_URL = env("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = env("DB_NAME", "ieftinit_hub")

# Folder persistent pentru pozele/fișierele clienților (Railway Volume montat pe /data)
DATA_DIR = Path(env("DATA_DIR", "/data"))
UPLOAD_DIR = DATA_DIR / "uploads"

JWT_SECRET = env("JWT_SECRET", "schimba-asta-in-productie")
COOKIE_SECURE = env("COOKIE_SECURE", "1") == "1"

ADMIN_EMAIL = env("ADMIN_EMAIL", "admin@ieftinit.ro")
ADMIN_PASSWORD = env("ADMIN_PASSWORD", "")

PUBLIC_URL = env("PUBLIC_URL", "https://hub.ieftinit.ro").rstrip("/")

# Shopify
SHOPIFY_SHOP = env("SHOPIFY_SHOP")  # ex: ieftinit.myshopify.com
SHOPIFY_ACCESS_TOKEN = env("SHOPIFY_ACCESS_TOKEN")
SHOPIFY_CLIENT_ID = env("SHOPIFY_CLIENT_ID") or env("SHOPIFY_API_KEY")
SHOPIFY_CLIENT_SECRET = env("SHOPIFY_CLIENT_SECRET") or env("SHOPIFY_API_SECRET")
SHOPIFY_API_VERSION = env("SHOPIFY_API_VERSION", "2026-07")
SHOPIFY_SCOPES = env("SHOPIFY_SCOPES", "read_orders,read_all_orders,read_customers,read_products")

# GLS
GLS_USERNAME = env("GLS_USERNAME")
GLS_PASSWORD = env("GLS_PASSWORD")
GLS_CLIENT_NUMBER = env("GLS_CLIENT_NUMBER")
GLS_COUNTRY = env("GLS_COUNTRY", "ro").lower()

# Email (Resend)
RESEND_API_KEY = env("RESEND_API_KEY")
SENDER_EMAIL = env("SENDER_EMAIL", "IEFTINIT.RO <retururi@ieftinit.ro>")
REPLY_TO = env("REPLY_TO")

# Pagini publice: domenii care au voie să afișeze formularele în iframe
FRAME_ANCESTORS = env(
    "FRAME_ANCESTORS",
    "https://ieftinit.ro https://*.ieftinit.ro https://*.myshopify.com https://admin.shopify.com",
)

FRONTEND_DIST = Path(env("FRONTEND_DIST", str(Path(__file__).resolve().parents[2] / "frontend" / "dist")))
