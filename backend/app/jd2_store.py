"""In-memory JD2 queue (POC). Swap for Firestore/BigQuery in GCP without changing callers."""
from __future__ import annotations
from app.models import JD2Item

_QUEUE: dict[str, JD2Item] = {}

def add(item: JD2Item) -> JD2Item:
    _QUEUE[item.id] = item
    return item

def all_items() -> list[JD2Item]:
    return sorted(_QUEUE.values(), key=lambda x: x.created_at, reverse=True)

def get(item_id: str) -> JD2Item | None:
    return _QUEUE.get(item_id)

def save(item: JD2Item) -> JD2Item:
    _QUEUE[item.id] = item
    return item
