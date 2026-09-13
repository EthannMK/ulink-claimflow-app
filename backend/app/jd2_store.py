"""In-memory JD2 queue (POC). Swap for Firestore/BigQuery in GCP without changing callers."""
from __future__ import annotations
from app.models import JD2Item

_QUEUE: dict[str, JD2Item] = {}
# document bytes for each item: _BLOBS[item_id][doc_id] = (name, mime, bytes)
_BLOBS: dict[str, dict[str, tuple[str, str, bytes]]] = {}

def add(item: JD2Item) -> JD2Item:
    _QUEUE[item.id] = item
    return item

def put_blob(item_id: str, doc_id: str, name: str, mime: str, data: bytes) -> None:
    _BLOBS.setdefault(item_id, {})[doc_id] = (name, mime, data)

def get_blob(item_id: str, doc_id: str) -> tuple[str, str, bytes] | None:
    return _BLOBS.get(item_id, {}).get(doc_id)

def all_items() -> list[JD2Item]:
    return sorted(_QUEUE.values(), key=lambda x: x.created_at, reverse=True)

def get(item_id: str) -> JD2Item | None:
    return _QUEUE.get(item_id)

def save(item: JD2Item) -> JD2Item:
    _QUEUE[item.id] = item
    return item
