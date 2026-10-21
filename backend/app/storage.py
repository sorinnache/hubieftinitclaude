"""Fișierele clienților (poze/video) se salvează pe discul persistent (Railway Volume)."""
import mimetypes
import re
from pathlib import Path

from fastapi import HTTPException, UploadFile

from . import config

ALLOWED = {
    "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif",
    "video/mp4", "video/quicktime", "video/webm", "application/pdf",
}
MAX_BYTES = 100 * 1024 * 1024


def _ext(filename: str | None, content_type: str) -> str:
    if filename and "." in filename:
        e = re.sub(r"[^a-z0-9]", "", filename.rsplit(".", 1)[-1].lower())[:6]
        if e:
            return e
    return (mimetypes.guess_extension(content_type) or ".bin").lstrip(".")


def path_for(file_id: str, ext: str) -> Path:
    config.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return config.UPLOAD_DIR / f"{file_id}.{ext}"


async def save_upload(file: UploadFile, file_id: str) -> dict:
    ct = (file.content_type or "application/octet-stream").lower()
    if ct not in ALLOWED:
        raise HTTPException(400, f"Tip de fișier nepermis ({ct}). Trimite poze sau video.")
    ext = _ext(file.filename, ct)
    dest = path_for(file_id, ext)
    size = 0
    with dest.open("wb") as out:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_BYTES:
                out.close()
                dest.unlink(missing_ok=True)
                raise HTTPException(400, "Fișierul depășește 100MB")
            out.write(chunk)
    return {"path": dest.name, "content_type": ct, "size": size}


def save_bytes(file_id: str, data: bytes, content_type: str, filename: str | None = None) -> dict:
    ext = _ext(filename, content_type)
    dest = path_for(file_id, ext)
    dest.write_bytes(data)
    return {"path": dest.name, "content_type": content_type, "size": len(data)}


def full_path(name: str) -> Path:
    p = (config.UPLOAD_DIR / name).resolve()
    if config.UPLOAD_DIR.resolve() not in p.parents:
        raise HTTPException(404, "Fișier inexistent")
    return p
