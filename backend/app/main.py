"""Hub IEFTINIT — Retururi & Service."""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import APIRouter, FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from . import admin, auth, cases, config, public, shipments, profit, shopify, stock, stock_reports, stock_suppliers
from .db import ensure_indexes

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    await ensure_indexes()
    await auth.seed_admin()
    await cases.seed_defaults()
    await stock.migrate_counted()
    tasks = [asyncio.create_task(shipments.tracking_loop()), asyncio.create_task(stock.sync_loop()),
             asyncio.create_task(stock_reports.snapshot_loop()),
             asyncio.create_task(profit.sync_loop())]
    yield
    for t in tasks:
        t.cancel()


app = FastAPI(title="Hub IEFTINIT", lifespan=lifespan, docs_url=None, redoc_url=None)

api = APIRouter(prefix="/api")
api.include_router(auth.router)
api.include_router(auth.users_router)
api.include_router(public.router)
api.include_router(public.files_router)
api.include_router(shipments.router)
api.include_router(cases.problem_types_router)
api.include_router(cases.build_router("return"))
api.include_router(cases.build_router("service"))
api.include_router(admin.router)
api.include_router(shopify.router)
api.include_router(stock_reports.router)
api.include_router(stock_suppliers.router)
api.include_router(profit.router)
api.include_router(stock.router)


@api.get("/health")
async def health():
    return {"ok": True}


app.include_router(api)

PUBLIC_PAGES = ("/retur", "/service/public", "/formular-retur", "/formular-service")


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path.rstrip("/") in PUBLIC_PAGES or path.startswith(("/assets/", "/api/public/", "/api/files/")) \
            or path in ("/ieftinit-logo.png", "/favicon.png"):
        response.headers["Content-Security-Policy"] = f"frame-ancestors 'self' {config.FRAME_ANCESTORS}"
    else:
        response.headers["Content-Security-Policy"] = "frame-ancestors 'self'"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response


# ---------- interfața (React build) ----------
dist = config.FRONTEND_DIST
if (dist / "assets").exists():
    app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")


@app.get("/{full_path:path}", include_in_schema=False)
async def spa(full_path: str):
    if full_path.startswith("api/"):
        return JSONResponse({"detail": "Not found"}, status_code=404)
    f = dist / full_path
    if full_path and f.is_file() and dist in f.resolve().parents:
        return FileResponse(f)
    index = dist / "index.html"
    if index.exists():
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
    return JSONResponse({"detail": "Interfața nu este construită"}, status_code=503)
