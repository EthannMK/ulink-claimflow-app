"""JD2 queue — Firestore-backed with in-memory fallback (app/db.py).
Item metadata + the JD1 note persist; document bytes (blobs) stay in memory only,
because Firestore documents can't hold file payloads (Cloud Storage is the durable home)."""
from __future__ import annotations
from app.models import JD2Item
from app.db import Collection

_items = Collection("jd2_items")
# document bytes for each item: _BLOBS[item_id][doc_id] = (name, mime, bytes) — in-memory only
_BLOBS: dict[str, dict[str, tuple[str, str, bytes]]] = {}


def add(item: JD2Item) -> JD2Item:
    _items.put(item.id, item.model_dump(mode="json"))
    return item

def all_items() -> list[JD2Item]:
    items = [JD2Item.model_validate(d) for d in _items.all()]
    return sorted(items, key=lambda x: x.created_at, reverse=True)

def get(item_id: str) -> JD2Item | None:
    d = _items.get(item_id)
    return JD2Item.model_validate(d) if d else None

def save(item: JD2Item) -> JD2Item:
    _items.put(item.id, item.model_dump(mode="json"))
    return item

def put_blob(item_id: str, doc_id: str, name: str, mime: str, data: bytes) -> None:
    _BLOBS.setdefault(item_id, {})[doc_id] = (name, mime, data)

def get_blob(item_id: str, doc_id: str) -> tuple[str, str, bytes] | None:
    return _BLOBS.get(item_id, {}).get(doc_id)
