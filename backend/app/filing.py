"""How claim documents are filed in Cloud Storage — readable, unique, easy to extract.

    claims/<YYYY>/<MM>/<TICKET-REF>__<insurer>__<member>/
        <TICKET-REF>-D01__<original file name>
        <TICKET-REF>-D02__<original file name>
        _manifest.json      <- everything about the claim and its files, for extraction

    e.g. claims/2026/10/UL-20261008-0007__aya-sompo-insurance__thi-ha-soe/UL-20261008-0007-D01__claim-form.pdf

Unique IDs
  * ticket reference  UL-<YYYYMMDD>-<NNNN>  numbered per day (Myanmar date) and checked for uniqueness
  * document id       <ticket ref>-D<NN>   numbered per ticket
The folder is fixed when the ticket gets its first file; the manifest is rewritten on every
change, so a later re-scan (better member name, insurer) still shows up in the manifest.

Extract with gcloud, e.g.
  by ID       gcloud storage cp -r "gs://<bucket>/claims/*/*/UL-20261008-0007__*" .
  by month    gcloud storage cp -r "gs://<bucket>/claims/2026/10/*" .
  by insurer  gcloud storage ls "gs://<bucket>/claims/**/*__aya-sompo-insurance__*/*"
  by member   gcloud storage ls "gs://<bucket>/claims/**/*__thi-ha-soe/*"
or download the index: GET /api/documents/index.csv (Admin / Super Admin).
"""
from __future__ import annotations
import hashlib
import json
import re
import unicodedata
from datetime import datetime, timedelta, timezone

from app import storage
from app.config import settings


def slug(text: str, fallback: str = "unknown", limit: int = 40) -> str:
    """'AYA SOMPO Insurance' -> 'aya-sompo-insurance'. Non-Latin names (e.g. Burmese) -> fallback."""
    t = unicodedata.normalize("NFKD", text or "").encode("ascii", "ignore").decode()
    t = re.sub(r"[^a-zA-Z0-9]+", "-", t).strip("-").lower()
    return (t[:limit].strip("-") or fallback)


def safe_name(name: str, limit: int = 80) -> str:
    """Keep the original file name readable but safe for storage paths and command lines."""
    name = (name or "document").replace("\\", "/").split("/")[-1]
    stem, dot, ext = name.rpartition(".")
    if not dot:
        stem, ext = name, ""
    stem = re.sub(r"[^A-Za-z0-9._ ()-]+", "-", unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode())
    stem = re.sub(r"\s+", "-", stem).strip("-.") or "document"
    ext = re.sub(r"[^A-Za-z0-9]", "", ext)[:8].lower()
    return f"{stem[:limit]}.{ext}" if ext else stem[:limit]


def local_now() -> datetime:
    return datetime.now(timezone.utc) + timedelta(minutes=settings.app_tz_offset_min)


def new_reference(existing: set[str]) -> str:
    """UL-YYYYMMDD-NNNN, the next free number for today (Myanmar date)."""
    day = local_now().strftime("%Y%m%d")
    prefix = f"UL-{day}-"
    used = [int(r[len(prefix):]) for r in existing if r.startswith(prefix) and r[len(prefix):].isdigit()]
    n = (max(used) if used else 0) + 1
    while f"{prefix}{n:04d}" in existing:
        n += 1
    return f"{prefix}{n:04d}"


def folder_for(ref: str, insurer: str, member: str, when: datetime | None = None) -> str:
    w = (when or datetime.now(timezone.utc))
    if w.tzinfo is None:
        w = w.replace(tzinfo=timezone.utc)
    w = w + timedelta(minutes=settings.app_tz_offset_min)
    return f"claims/{w:%Y}/{w:%m}/{ref}__{slug(insurer if insurer and insurer != '—' else '', 'no-insurer')}__{slug(member if member and member != '—' else '', 'no-member')}"


def next_doc_id(ref: str, existing_ids: list[str]) -> str:
    nums = [int(m.group(1)) for i in existing_ids if (m := re.fullmatch(re.escape(ref) + r"-D(\d+)", i or ""))]
    return f"{ref}-D{(max(nums) if nums else 0) + 1:02d}"


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_manifest(claim) -> None:
    """_manifest.json in the claim's folder: one file that describes the claim and every document."""
    folder = getattr(claim, "storage_folder", None)
    if not folder:
        return
    doc = {
        "ticket_id": claim.id, "reference": claim.reference, "claim_no": getattr(claim, "claim_no", None),
        "member": claim.memberName, "insurer": claim.insurer, "category": str(getattr(claim.category, "value", claim.category)),
        "status": str(getattr(claim.status, "value", claim.status)), "amount": claim.amount,
        "received_at": claim.receivedAt.isoformat() if hasattr(claim.receivedAt, "isoformat") else str(claim.receivedAt),
        "jd2_item_id": claim.jd2_item_id, "updated_at": datetime.now(timezone.utc).isoformat(),
        "documents": [{"id": d.id, "original_name": d.name, "stored_as": (d.key or "").rsplit("/", 1)[-1], "path": d.key,
                       "mime": d.type, "size": d.size, "sha256": d.sha256, "uploaded_at": d.uploaded_at.isoformat() if d.uploaded_at else None,
                       "uploaded_by": d.uploaded_by, "source": d.source} for d in claim.documents],
    }
    try:
        storage.put(f"{folder}/_manifest.json", "_manifest.json", "application/json", json.dumps(doc, ensure_ascii=False, indent=2).encode("utf-8"))
    except Exception:
        pass
