"""Audit log — records sensitive actions (e.g. deletions) with who/when/what.
Firestore-backed with in-memory fallback (app/db.py)."""
from __future__ import annotations
import uuid
from datetime import datetime, timezone
from app.db import Collection

_audit = Collection("audit")


def record(action: str, by: str, detail: str = "", ref: str = "") -> dict:
    e = {
        "id": uuid.uuid4().hex[:12],
        "at": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "by": by or "unknown",
        "detail": detail,
        "ref": ref,
    }
    _audit.put(e["id"], e)
    return e


def all_events() -> list[dict]:
    return sorted(_audit.all(), key=lambda x: x.get("at", ""), reverse=True)
