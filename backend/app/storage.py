"""Document file storage — Google Cloud Storage with a safe in-memory fallback.

If GCS_BUCKET is set and the bucket is reachable, uploaded document bytes are stored
there and survive redeploys. Otherwise everything falls back to an in-memory dict, so
the app still works — files just reset on restart. Every GCS call is guarded.
"""
from __future__ import annotations
import os

_MODE: str | None = None      # "gcs" | "memory"
_BUCKET = None
_MEM: dict[str, tuple[str, str, bytes]] = {}   # key -> (filename, mime, data)


def _probe() -> None:
    global _MODE, _BUCKET
    if _MODE is not None:
        return
    name = os.getenv("GCS_BUCKET", "").strip()
    if not name:
        _MODE = "memory"
        return
    try:
        from google.cloud import storage
        client = storage.Client()
        bucket = client.bucket(name)
        bucket.exists()   # forces a real call; raises without access
        _BUCKET = bucket
        _MODE = "gcs"
    except Exception:
        _MODE = "memory"


def mode() -> str:
    _probe()
    return _MODE or "memory"


def put(key: str, filename: str, mime: str, data: bytes) -> None:
    if mode() == "gcs":
        try:
            blob = _BUCKET.blob(key)
            blob.metadata = {"filename": filename}
            blob.upload_from_string(data, content_type=mime or "application/octet-stream")
            return
        except Exception:
            pass  # fall through to memory
    _MEM[key] = (filename, mime or "application/octet-stream", data)


def get(key: str) -> tuple[str, str, bytes] | None:
    if mode() == "gcs":
        try:
            blob = _BUCKET.blob(key)
            if blob.exists():
                data = blob.download_as_bytes()
                blob.reload()
                filename = (blob.metadata or {}).get("filename", "file")
                mime = blob.content_type or "application/octet-stream"
                return (filename, mime, data)
        except Exception:
            pass
    return _MEM.get(key)
