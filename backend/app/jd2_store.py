"""JD2 queue — Firestore-backed with in-memory fallback (app/db.py).
Item metadata + the JD1 note persist in Firestore; the uploaded document bytes go to
Cloud Storage (app/storage.py), so previews/downloads also survive redeploys."""
from __future__ import annotations
from app.models import JD2Item
from app.db import Collection
from app import storage

_items = Collection("jd2_items")


def add(item: JD2Item) -> JD2Item:
    _items.put(item.id, item.model_dump(mode="json"))
    return item

def all_items() -> list[JD2Item]:
    items = [JD2Item.model_validate(d) for d in _items.all()]
    return sorted(items, key=lambda x: x.created_at, reverse=True)

def get(item_id: str) -> JD2Item | None:
    d = _items.get(item_id)
    return JD2Item.model_validate(d) if d else None

def delete(item_id: str) -> None:
    _items.delete(item_id)

def save(item: JD2Item) -> JD2Item:
    _items.put(item.id, item.model_dump(mode="json"))
    return item

def _blob_key(item_id: str, doc_id: str) -> str:
    return f"jd2/{item_id}/{doc_id}"

def put_blob(item_id: str, doc_id: str, name: str, mime: str, data: bytes) -> None:
    storage.put(_blob_key(item_id, doc_id), name, mime, data)

def get_blob(item_id: str, doc_id: str) -> tuple[str, str, bytes] | None:
    return storage.get(_blob_key(item_id, doc_id))
