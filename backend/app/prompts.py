"""Editable AI prompts (Super Admin → AI Prompts).

Every AI feature asks `prompts.get(<id>)` for its instructions. If a Super Admin has
saved a custom version it is used; otherwise the built-in default (the text that
lives next to each feature's code) is used. "Reset to default" just deletes the
custom version. Changes apply to the next AI request — no restart needed.
"""
from __future__ import annotations
from datetime import datetime, timezone
from app.db import Collection

_store = Collection("ai_prompts")

REGISTRY: list[dict] = [
    {"id": "jd1_note", "name": "JD1 note", "feature": "JD1 note", "output": "json",
     "description": "Reads the whole claim packet and writes the JD1 Process Note (sections A/B/C, invoices, supporting documents, checks).",
     "note": "The app reads this answer field by field — keep the JSON shape and key names exactly as they are. "
             "Wording, detail level and rules can be changed freely."},
    {"id": "full_detection", "name": "Full detection (page by page)", "feature": "Full detection", "output": "json",
     "description": "Summarises each page and lists its data points (label/value) for the Full detection view.",
     "note": "Keep the final 'Respond ONLY with JSON: {\"pages\":[…]}' instruction and its keys. The app adds a line "
             "about page numbering after this text."},
    {"id": "required_fields", "name": "Required fields", "feature": "Required fields", "output": "json",
     "description": "Extracts the insurer's required form fields (the numbered list from Settings → Insurers & Fields).",
     "note": "The app appends 'Fields:' and the numbered field list after this text. Keep the JSON answer shape "
             "{\"fields\":[{\"n\",\"value\",\"confidence\"}]}."},
    {"id": "quick_scan", "name": "Quick scan", "feature": "Quick scan", "output": "json",
     "description": "Single-document scan used by the quick OCR / new-claim screens.",
     "note": "Keep the JSON keys doc_type, text, fields, summary."},
    {"id": "extract_rules", "name": "Settings — extract adjudication rules", "feature": "Rules / benefits extraction", "output": "json",
     "description": "Turns an uploaded policy/rules document into rule rows for Settings → Adjudication Rules.",
     "note": "Keep the JSON shape {\"items\":[{name, category, condition, action}]}."},
    {"id": "extract_benefits", "name": "Settings — extract table of benefits", "feature": "Rules / benefits extraction", "output": "json",
     "description": "Turns an uploaded Table of Benefits into rows for Settings → Tables of Benefits.",
     "note": "Keep the JSON shape {\"items\":[{name, category, limit, subLimit, waiting, copay}]}."},
    {"id": "help_assistant", "name": "Help chat — rules & style", "feature": "Help assistant", "output": "text",
     "description": "How the small help chat behaves: what it may talk about, safety rules and answer format.",
     "note": "Before this text the app automatically adds who is asking and which pages their role can open — "
             "so role restrictions keep working whatever you write here."},
]
_IDS = {p["id"] for p in REGISTRY}


def _default(pid: str) -> str:
    # imported lazily: the defaults live next to each feature's code
    if pid == "jd1_note":
        from app.adapters.jd1 import _JD1_PROMPT
        return _JD1_PROMPT
    if pid == "full_detection":
        from app.routers.review import _PAGE_BASE
        return _PAGE_BASE
    if pid == "required_fields":
        from app.routers.review import _FIELDS_PROMPT
        return _FIELDS_PROMPT
    if pid == "quick_scan":
        from app.adapters.ocr import _PROMPT
        return _PROMPT
    if pid in ("extract_rules", "extract_benefits"):
        from app.routers.extract import PROMPTS
        return PROMPTS["rules" if pid == "extract_rules" else "benefits"]
    if pid == "help_assistant":
        from app.routers.assistant import _RULES_DEFAULT
        return _RULES_DEFAULT
    raise KeyError(pid)


def get(pid: str) -> str:
    """The prompt text to use right now (custom if saved, else the built-in default)."""
    doc = _store.get(pid)
    if isinstance(doc, dict) and str(doc.get("text", "")).strip():
        return doc["text"]
    return _default(pid)


def meta(pid: str) -> dict:
    return next(p for p in REGISTRY if p["id"] == pid)


def list_all() -> list[dict]:
    out = []
    for p in REGISTRY:
        doc = _store.get(p["id"]) or {}
        custom = bool(str(doc.get("text", "")).strip())
        out.append({**p, "custom": custom, "updated_at": doc.get("updated_at", "") if custom else "",
                    "updated_by": doc.get("updated_by", "") if custom else ""})
    return out


def detail(pid: str) -> dict:
    doc = _store.get(pid) or {}
    return {**[x for x in list_all() if x["id"] == pid][0], "text": get(pid), "default": _default(pid)}


def save(pid: str, text: str, by: str) -> dict:
    from app import audit
    if text.strip() == _default(pid).strip():
        return reset(pid, by)
    _store.put(pid, {"text": text, "updated_at": datetime.now(timezone.utc).isoformat(), "updated_by": by})
    audit.record("prompt_update", by, detail=f"Changed AI prompt: {meta(pid)['name']}", ref=pid)
    return detail(pid)


def reset(pid: str, by: str) -> dict:
    from app import audit
    if _store.get(pid):
        _store.delete(pid)
        audit.record("prompt_reset", by, detail=f"Reset AI prompt to default: {meta(pid)['name']}", ref=pid)
    return detail(pid)
