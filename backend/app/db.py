from datetime import datetime, timezone
import uuid

from . import config

_client = None
_db = None


def get_db():
    global _client, _db
    if _db is None:
        if config.MONGO_URL.startswith("mongomock"):
            from mongomock_motor import AsyncMongoMockClient  # doar pentru teste locale
            _client = AsyncMongoMockClient()
        else:
            from motor.motor_asyncio import AsyncIOMotorClient
            _client = AsyncIOMotorClient(config.MONGO_URL, tz_aware=True)
        _db = _client[config.DB_NAME]
    return _db


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


async def ensure_indexes():
    db = get_db()
    await db.returns.create_index("id", unique=True)
    await db.returns.create_index("return_number", unique=True)
    await db.returns.create_index("created_at")
    await db.service_requests.create_index("id", unique=True)
    await db.service_requests.create_index("service_number", unique=True)
    await db.service_requests.create_index("created_at")
    await db.activity_logs.create_index([("resource_type", 1), ("resource_id", 1), ("created_at", 1)])
    await db.activity_logs.create_index("created_at")
    await db.files.create_index("id", unique=True)
    await db.shipments.create_index("id", unique=True)
    await db.shipments.create_index([("ref_type", 1), ("ref_id", 1)])
    await db.users.create_index("email", unique=True)
    await db.notes.create_index([("ref_type", 1), ("ref_id", 1)])
    await db.stock_variants.create_index("variant_id", unique=True)
    await db.stock_orders.create_index("order_id", unique=True)
    await db.stock_orders.create_index("reserving")
    await db.stock_movements.create_index([("variant_id", 1), ("created_at", -1)])
    await db.stock_movements.create_index("created_at")
    await db.stock_inventory_sessions.create_index("id", unique=True)
    await db.stock_inventory_sessions.create_index("status")
    await db.stock_snapshots.create_index("id", unique=True)
    await db.stock_snapshots.create_index("period")
