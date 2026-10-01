"""JD2 queue — Firestore-backed with in-memory fallback (app/db.py).

Item metadata lives in Firestore; the full JD1 note (which carries every page of full detection,
bill tables and required fields) is stored as a JSON file in Cloud Storage next to the uploaded
documents. A Firestore document is capped at 1 MB, and a big photo packet's notes can get close
to that — when a write failed, the claim silently existed only in one server's memory and JD2
could not see it after a restart. Old items that still carry the note inline keep working."""
from __future__ import annotations
import json
import logging
from app.models import JD2Item, JD1Note
from app.db import Collection
from app import storage

log = logging.getLogger("claimflow.jd2")
_items = Collection("jd2_items")


def _note_key(item_id: str) -> str:
    return f"jd2/{item_id}/_note.json"


def _write(item: JD2Item) -> JD2Item:
    d = item.model_dump(mode="json")
    note = d.pop("note", None) or {}
    storage.put(_note_key(item.id), "note.json", "application/json", json.dumps(note, ensure_ascii=False).encode("utf-8"))
    d["note_in_storage"] = True
    _items.put(item.id, d)
    return item


def _read(d: dict, with_note: bool = True) -> JD2Item:
    d = dict(d)
    if "note" not in d or d.get("note_in_storage"):
        note: dict = {}
        if with_note:
            blob = storage.get(_note_key(d.get("id", "")))
            if blob:
                try:
                    note = json.loads(blob[2].decode("utf-8"))
                except Exception:
                    log.warning("JD2 note for %s could not be read", d.get("id"))
        d["note"] = note
    d.pop("note_in_storage", None)
    item = JD2Item.model_validate(d)
    if not with_note:   # the queue list only needs the summary columns
        item.note = JD1Note()
    return item


def add(item: JD2Item) -> JD2Item:
    return _write(item)


def save(item: JD2Item) -> JD2Item:
    return _write(item)


def all_items() -> list[JD2Item]:
    items = [_read(d, with_note=False) for d in _items.all()]
    return sorted(items, key=lambda x: x.created_at, reverse=True)


def get(item_id: str) -> JD2Item | None:
    d = _items.get(item_id)
    return _read(d) if d else None


def delete(item_id: str) -> None:
    storage.delete(_note_key(item_id))
    _items.delete(item_id)


def _blob_key(item_id: str, doc_id: str) -> str:
    return f"jd2/{item_id}/{doc_id}"

def put_blob(item_id: str, doc_id: str, name: str, mime: str, data: bytes) -> None:
    storage.put(_blob_key(item_id, doc_id), name, mime, data)

def get_blob(item_id: str, doc_id: str) -> tuple[str, str, bytes] | None:
    return storage.get(_blob_key(item_id, doc_id))
