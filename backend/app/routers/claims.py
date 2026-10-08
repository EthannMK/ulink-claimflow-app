"""Tickets (claims). A ticket is auto-created when JD1 generates a note, then flows
through the Inbox by status. Firestore-backed with in-memory fallback (app/db.py)."""
import re, uuid
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Response
from app.models import Claim, ClaimList, Channel, Category, Status, JD1Note, Role, DocumentFile
from app.security import get_current_user, require_role
from app.db import Collection
from app import jd2_store, storage, audit, filing

router = APIRouter(prefix="/api")

_claims = Collection("claims")


def _make_ref() -> str:
    """Unique ticket reference UL-YYYYMMDD-NNNN (numbered per day, Myanmar date)."""
    return filing.new_reference({d.get("reference", "") for d in _claims.all()})

def _amount(s: str) -> float | None:
    digits = re.sub(r"[^\d]", "", s or "")
    return float(digits) if digits else None

def _get(claim_id: str) -> Claim | None:
    d = _claims.get(claim_id)
    return Claim.model_validate(d) if d else None

def _put(c: Claim) -> Claim:
    _claims.put(c.id, c.model_dump(mode="json"))
    if c.storage_folder:
        filing.write_manifest(c)      # keep the folder's _manifest.json in step with the ticket
    return c


def _doc_key(claim_id: str, d) -> str:
    return d.key or f"claims/{claim_id}/{d.id}"     # files saved before the filing scheme


def file_document(c: Claim, name: str, mime: str, data: bytes, by: str, source: str = "jd1") -> tuple[Claim, DocumentFile]:
    """File one document under the claim's folder (see app/filing.py). The same content twice is stored once."""
    digest = filing.sha256(data)
    for d in c.documents:
        if d.sha256 == digest or (not d.sha256 and d.name == name and d.size == len(data)):
            return c, d
    if not c.storage_folder:
        c.storage_folder = filing.folder_for(c.reference, c.insurer, c.memberName, c.receivedAt)
    doc_id = filing.next_doc_id(c.reference, [d.id for d in c.documents])
    key = f"{c.storage_folder}/{doc_id}__{filing.safe_name(name)}"
    storage.put(key, name, mime, data)
    doc = DocumentFile(id=doc_id, name=name, type=mime, url=f"/api/claims/{c.id}/documents/{doc_id}", size=len(data),
                       uploaded_at=datetime.now(timezone.utc), uploaded_by=by, key=key, sha256=digest, source=source)
    c.documents = [d for d in c.documents if d.name != name] + [doc]
    return _put(c), doc


class TicketFromJD1(BaseModel):
    note: JD1Note
    channel: str = "webform"

class TicketUpdate(BaseModel):
    status: Status | None = None
    assignee: str | None = None
    documentsComplete: bool | None = None
    summary: str | None = None
    jd2_item_id: str | None = None


@router.get("/claims", response_model=ClaimList)
def list_claims(status: str = "", category: str = "", page: int = 1, user=Depends(get_current_user)):
    items = [Claim.model_validate(d) for d in _claims.all()]
    if status:
        items = [c for c in items if c.status == status]
    if category:
        items = [c for c in items if c.category == category]
    items.sort(key=lambda c: c.receivedAt, reverse=True)
    return ClaimList(items=items, page=page, total=len(items))

@router.get("/claims/{claim_id}", response_model=Claim)
def get_claim(claim_id: str, user=Depends(get_current_user)):
    c = _get(claim_id)
    if not c:
        raise HTTPException(status_code=404, detail="Claim not found")
    return c

def new_ticket_for_note(note: JD1Note, channel_name: str = "webform") -> Claim:
    """Build and save a new Inbox ticket for a JD1 note (also used by the JD2 handoff)."""
    is_log = (note.claim_type or "").upper() == "LOG"
    try:
        channel = Channel(channel_name)
    except ValueError:
        channel = Channel.webform
    summary = ""
    if note.ai_summary:
        summary = note.ai_summary.split("\n", 1)[0][:200]
    elif note.notes:
        summary = note.notes[:200]
    claim = Claim(
        id=uuid.uuid4().hex[:12],
        reference=_make_ref(),
        channel=channel,
        category=Category.log_request if is_log else Category.new_claim,
        status=Status.in_progress,
        insurer=note.header.insurer.value or "—",
        memberName=note.header.member_name.value or "—",
        policyNumber=None,
        receivedAt=datetime.now(timezone.utc),
        documentsComplete=len(note.checklist_missing) == 0,
        amount=_amount(note.header.total_claim_amount.value or note.section_b.claim_amount.value),
        summary=summary,
        claim_no=note.header.claim_no.value or None,
    )
    return _put(claim)


def _norm_ref(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def find_open_ticket(note: JD1Note) -> Claim | None:
    """An open ticket for the same claim (same claim number, or same member + amount + treatment
    date) that has not gone to JD2 yet — re-scanning a packet should not create a second ticket."""
    h = note.header
    no = _norm_ref(h.claim_no.value)
    member = _norm_ref(h.member_name.value)
    amount = _amount(h.total_claim_amount.value or note.section_b.claim_amount.value)
    for d in _claims.all():
        try:
            c = Claim.model_validate(d)
        except Exception:
            continue
        if c.jd2_item_id or c.status in (Status.approved, Status.partially_approved, Status.rejected, Status.closed):
            continue
        same_no = no and len(no) >= 5 and (no == _norm_ref(c.claim_no or "") or no in _norm_ref(c.summary or ""))
        same_member = member and member == _norm_ref(c.memberName) and amount is not None and c.amount == amount
        if same_no or same_member:
            return c
    return None


@router.post("/claims/from-jd1", response_model=Claim)
def create_from_jd1(body: TicketFromJD1, user=Depends(get_current_user)):
    """JD1 upload → auto-create a ticket in the Inbox (or reuse the open ticket of the same claim)."""
    existing = find_open_ticket(body.note)
    if existing:
        n = body.note
        existing.insurer = n.header.insurer.value or existing.insurer
        existing.memberName = n.header.member_name.value or existing.memberName
        existing.documentsComplete = len(n.checklist_missing) == 0
        existing.claim_no = n.header.claim_no.value or existing.claim_no
        existing.amount = _amount(n.header.total_claim_amount.value or n.section_b.claim_amount.value) or existing.amount
        summary = (n.ai_summary.split("\n", 1)[0] if n.ai_summary else (n.notes or ""))[:200]
        if summary:
            existing.summary = summary
        audit.record("ticket_reused", user.get("name") or user.get("username", ""), detail=f"Re-scan of {existing.reference} — same claim, ticket reused", ref=existing.id)
        return _put(existing)
    return new_ticket_for_note(body.note, body.channel)


MAX_DOC_BYTES = 31 * 1024 * 1024


@router.post("/claims/{claim_id}/documents", response_model=Claim)
async def add_document(claim_id: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    """Keep a document the user uploaded with its ticket (Cloud Storage: claims/<ticket>/<doc>).
    Uploading the same file (name + size) again is a no-op."""
    c = _get(claim_id)
    if not c:
        raise HTTPException(status_code=404, detail="Claim not found")
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    if len(data) > MAX_DOC_BYTES:
        raise HTTPException(status_code=413, detail="File is over 31 MB")
    c, _doc = file_document(c, file.filename or "document", file.content_type or "application/octet-stream", data,
                            user.get("name") or user.get("username", ""), "jd1")
    return c


@router.get("/claims/{claim_id}/documents/{doc_id}")
def get_document(claim_id: str, doc_id: str, user=Depends(get_current_user)):
    c = _get(claim_id)
    d = next((x for x in (c.documents if c else []) if x.id == doc_id), None)
    if not d:
        raise HTTPException(status_code=404, detail="Document not found")
    blob = storage.get(_doc_key(claim_id, d))
    if not blob:
        raise HTTPException(status_code=404, detail="Document not found")
    name, mime, data = blob
    return Response(content=data, media_type=mime or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{name}"'})


@router.get("/assignees")
def assignees(user=Depends(get_current_user)):
    """People the signed-in user may assign a claim to (any role can read this; filtered by
    Settings → Assignment permissions). Names, usernames and roles only."""
    from app import assignment
    return {"items": assignment.assignable_users(user)}


class AssignBody(BaseModel):
    assignee: str = ""   # username; empty = unassign


@router.put("/claims/{claim_id}/assign", response_model=Claim)
def assign_claim(claim_id: str, body: AssignBody, user=Depends(get_current_user)):
    """Assign an Inbox ticket. If it is already in JD2, the JD2 claim is assigned too."""
    from app import assignment
    c = _get(claim_id)
    if not c:
        raise HTTPException(status_code=404, detail="Claim not found")
    username, name = assignment.resolve(user, body.assignee)
    c.assignee, c.assignee_username = name, username
    assignment.sync_jd2(c.jd2_item_id, assignee=name, assignee_username=username)
    audit.record("assign_claim", user.get("name") or user.get("username", ""),
                 detail=f"Ticket {c.reference} assigned to {name or 'nobody'}", ref=claim_id)
    return _put(c)

@router.patch("/claims/{claim_id}", response_model=Claim)
def update_claim(claim_id: str, body: TicketUpdate, user=Depends(get_current_user)):
    c = _get(claim_id)
    if not c:
        raise HTTPException(status_code=404, detail="Claim not found")
    if body.status is not None:
        c.status = body.status
    if body.assignee is not None:
        c.assignee = body.assignee
    if body.documentsComplete is not None:
        c.documentsComplete = body.documentsComplete
    if body.summary is not None:
        c.summary = body.summary
    if body.jd2_item_id is not None:
        c.jd2_item_id = body.jd2_item_id
    return _put(c)

@router.delete("/claims/{claim_id}")
def delete_claim(claim_id: str, user=Depends(require_role(Role.super_admin, Role.admin))):
    """Delete an Inbox ticket. Super Admin and Admin only (not normal users), recorded in the audit log. If the
    ticket already reached JD2, its JD2 queue item and stored document blobs are
    cleaned up too, mirroring the cleanup the JD2-side delete already does."""
    c = _get(claim_id)
    if not c:
        raise HTTPException(status_code=404, detail="Claim not found")
    if c.jd2_item_id:
        jd2_item = jd2_store.get(c.jd2_item_id)
        if jd2_item:
            for att in (jd2_item.attachments or []):
                storage.delete(att.key or f"jd2/{c.jd2_item_id}/{att.id}")
            jd2_store.delete(c.jd2_item_id)
    for d in c.documents:
        storage.delete(_doc_key(claim_id, d))
    if c.storage_folder:
        storage.delete(f"{c.storage_folder}/_manifest.json")
        storage.delete(_draft_key(c))
    _claims.delete(claim_id)
    audit.record("delete_claim", user.get("name") or user.get("username", ""),
                 detail=f"Deleted Inbox ticket — {c.memberName or '—'} · {c.insurer or '—'} · {c.reference}",
                 ref=claim_id)
    return {"ok": True}


@router.get("/documents/index.csv")
def documents_index(insurer: str = "", q: str = "", date_from: str = "", date_to: str = "",
                    user=Depends(require_role(Role.super_admin, Role.admin))):
    """Every stored claim document with its ticket ID, claim number, insurer, member, date and
    storage path — filter by insurer, a search word (ref / claim no / member) or received date (YYYY-MM-DD)."""
    import csv, io, os
    from datetime import timedelta
    from app.config import settings
    bucket = os.getenv("GCS_BUCKET", "").strip()
    buf = io.StringIO(); w = csv.writer(buf)
    w.writerow(["ticket_ref", "ticket_id", "claim_no", "insurer", "member", "received_date", "status", "jd2_item_id",
                "document_id", "original_name", "storage_path", "size_bytes", "sha256", "uploaded_at", "uploaded_by", "source"])
    ql = q.strip().lower()
    for d in sorted(_claims.all(), key=lambda x: x.get("receivedAt", ""), reverse=True):
        try:
            c = Claim.model_validate(d)
        except Exception:
            continue
        day = (c.receivedAt + timedelta(minutes=settings.app_tz_offset_min)).strftime("%Y-%m-%d")
        if insurer and insurer.lower() not in (c.insurer or "").lower():
            continue
        if ql and ql not in f"{c.reference} {c.claim_no or ''} {c.memberName}".lower():
            continue
        if (date_from and day < date_from) or (date_to and day > date_to):
            continue
        for doc in c.documents:
            key = _doc_key(c.id, doc)
            w.writerow([c.reference, c.id, c.claim_no or "", c.insurer, c.memberName, day, c.status.value, c.jd2_item_id or "",
                        doc.id, doc.name, f"gs://{bucket}/{key}" if bucket else key, doc.size or "", doc.sha256 or "",
                        doc.uploaded_at.isoformat() if doc.uploaded_at else "", doc.uploaded_by or "", doc.source or ""])
    return Response(buf.getvalue(), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="claim-documents.csv"'})


def _draft_key(c: Claim) -> str:
    return f"{c.storage_folder}/{c.reference}__jd1-note.json"


@router.put("/claims/{claim_id}/jd1-draft", response_model=Claim)
def save_jd1_draft(claim_id: str, note: JD1Note, user=Depends(get_current_user)):
    """Keep JD1's work with the ticket (note + full detection + required fields), so anyone can
    open the ticket later and continue in JD1 — not only in the browser where it was scanned."""
    c = _get(claim_id)
    if not c:
        raise HTTPException(status_code=404, detail="Claim not found")
    if not (note.claim_type or note.ai_summary or note.page_notes or note.documents):
        # an empty/wrongly-shaped body must never overwrite real saved work
        raise HTTPException(status_code=422, detail="The JD1 note is empty — nothing to save")
    if not c.storage_folder:
        c.storage_folder = filing.folder_for(c.reference, c.insurer, c.memberName, c.receivedAt)
    storage.put(_draft_key(c), "jd1-note.json", "application/json", note.model_dump_json().encode("utf-8"))
    c.jd1_saved_at = datetime.now(timezone.utc)
    c.jd1_saved_by = user.get("name") or user.get("username", "")
    c.checklist_required = list(note.checklist_required or [])
    c.checklist_missing = list(note.checklist_missing or [])
    c.documentsComplete = len(c.checklist_missing) == 0
    return _put(c)


@router.get("/claims/{claim_id}/jd1-draft", response_model=JD1Note)
def get_jd1_draft(claim_id: str, user=Depends(get_current_user)):
    c = _get(claim_id)
    if not c or not c.storage_folder or not c.jd1_saved_at:
        raise HTTPException(status_code=404, detail="No saved JD1 work for this ticket")
    blob = storage.get(_draft_key(c))
    if not blob:
        raise HTTPException(status_code=404, detail="No saved JD1 work for this ticket")
    return JD1Note.model_validate_json(blob[2])
