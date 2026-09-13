"""Optional Firestore persistence with a safe in-memory fallback.

If a Firestore database is reachable, collections are stored there and survive
redeploys. If it is not (API not enabled, no credentials, network error), every
operation degrades to an in-memory dict so the app still starts and works — it
just won't persist across restarts. Set USE_FIRESTORE=0 to force in-memory.
"""
from __future__ import annotations
import os

_MODE: str | None = None      # "firestore" | "memory"
_DB = None


def _probe() -> None:
    global _MODE, _DB
    if _MODE is not None:
        return
    if os.getenv("USE_FIRESTORE", "1").lower() not in ("1", "true", "yes"):
        _MODE = "memory"
        return
    try:
        from google.cloud import firestore
        db = firestore.Client()
        # Force a real round-trip so a misconfig fails here (and we fall back) rather than later.
        list(db.collection("_healthcheck").limit(1).stream())
        _DB = db
        _MODE = "firestore"
    except Exception:
        _MODE = "memory"


def mode() -> str:
    _probe()
    return _MODE or "memory"


def is_firestore() -> bool:
    return mode() == "firestore"


class Collection:
    """A dict-of-dicts keyed by document id, backed by Firestore or memory.
    Every Firestore call is guarded — on any error it uses the in-memory shadow,
    so a store operation never raises up into a request handler."""

    def __init__(self, name: str):
        self.name = name
        self.mem: dict[str, dict] = {}

    def get(self, doc_id: str) -> dict | None:
        if is_firestore():
            try:
                d = _DB.collection(self.name).document(doc_id).get()
                return d.to_dict() if d.exists else None
            except Exception:
                return self.mem.get(doc_id)
        return self.mem.get(doc_id)

    def put(self, doc_id: str, data: dict) -> dict:
        self.mem[doc_id] = data
        if is_firestore():
            try:
                _DB.collection(self.name).document(doc_id).set(data)
            except Exception:
                pass
        return data

    def all(self) -> list[dict]:
        if is_firestore():
            try:
                return [d.to_dict() for d in _DB.collection(self.name).stream()]
            except Exception:
                return list(self.mem.values())
        return list(self.mem.values())

    def delete(self, doc_id: str) -> None:
        self.mem.pop(doc_id, None)
        if is_firestore():
            try:
                _DB.collection(self.name).document(doc_id).delete()
            except Exception:
                pass

    def empty(self) -> bool:
        return len(self.all()) == 0
