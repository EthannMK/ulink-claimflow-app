import base64, uuid
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Response, UploadFile, File
from app.models import JD1Note, JD2Item, JD2List, JD2Decision, JD2Status, StoredDoc, Status
from app.security import get_current_user
from app import jd2_store, storage, audit, assignment
from app.db import Collection

router = APIRouter(prefix="/api/jd2", tags=["jd2"])

_DECISION_STATUS = {
    "approve": JD2Status.approved,
    "partial": JD2Status.partially_approved,
    "reject": JD2Status.rejected,
}


class HandoffAttachment(BaseModel):
    name: str
    mime: str = "application/octet-stream"
    data: str = ""   # base64-encoded file bytes

class HandoffRequest(BaseModel):
    note: JD1Note
    attachments: list[HandoffAttachment] = []   # old clients only — new ones upload files one by one
    ticket_id: str | None = None                 # the Inbox ticket JD1 already created (if any)


def _amount_of(note: JD1Note) -> str:
    return note.header.total_claim_amount.value or note.section_b.claim_amount.value


@router.post("/handoff", response_model=JD2Item)
async def handoff(body: HandoffRequest, user=Depends(get_current_user)):
    """JD1 sends a completed Process Note to the JD2 queue and links its Inbox ticket
    (creating one if JD1 has none). The documents follow with POST /{id}/documents, one
    request per file — sending them inside this JSON as base64 made big packets exceed
    Cloud Run's 32 MB request limit, so "Send to JD2" failed."""
    from app.routers import claims as tickets
    note = body.note
    # sent before (double click, re-send after a re-generate): update that JD2 claim, never make a second one
    prev_t = tickets._get(body.ticket_id) if body.ticket_id else None
    prev = jd2_store.get(prev_t.jd2_item_id) if prev_t and prev_t.jd2_item_id else None
    if prev is not None and prev.ticket_id not in (None, prev_t.id):
        prev = None          # (old bad data) that JD2 claim belongs to another ticket
    if prev is not None:
        if prev.status != JD2Status.pending:
            raise HTTPException(status_code=409, detail=f"{prev_t.reference} was already decided in JD2 ({prev.status.value.replace('_', ' ')})")
        prev.note = note
        prev.member_name, prev.insurer = note.header.member_name.value, note.header.insurer.value
        prev.claim_type, prev.claim_amount = note.claim_type, _amount_of(note)
        audit.record("jd2_handoff", user.get("name") or user.get("username", ""),
                     detail=f"Re-sent to JD2 (note updated) — {prev.member_name or '—'} · {prev_t.reference}", ref=prev.id)
        return jd2_store.save(prev)
    item_id = uuid.uuid4().hex[:12]
    stored: list[StoredDoc] = []
    for att in body.attachments:
        try:
            raw = base64.b64decode(att.data) if att.data else b""
        except Exception:
            raw = b""
        doc_id = uuid.uuid4().hex[:8]
        jd2_store.put_blob(item_id, doc_id, att.name, att.mime, raw)
        stored.append(StoredDoc(id=doc_id, name=att.name, mime=att.mime, size=len(raw)))
    item = JD2Item(
        id=item_id,
        created_at=datetime.now(timezone.utc),
        handed_by=user.get("name") or user.get("username", ""),
        member_name=note.header.member_name.value,
        insurer=note.header.insurer.value,
        claim_type=note.claim_type,
        claim_amount=_amount_of(note),
        status=JD2Status.pending,
        note=note,
        attachments=stored,
    )
    # link the Inbox ticket so everyone can follow the claim from the Inbox
    t = tickets._get(body.ticket_id) if body.ticket_id else None
    if t is None:
        t = tickets.new_ticket_for_note(note)
    # documents already saved with the ticket are shared (not copied, not uploaded again)
    for d in (t.documents or []):
        if not any(s.name == d.name for s in item.attachments):
            item.attachments.append(StoredDoc(id=d.id, name=d.name, mime=d.type or "application/octet-stream",
                                              size=d.size or 0, key=d.key or f"claims/{t.id}/{d.id}"))
    t.jd2_item_id = item_id
    t.status = Status.ready_for_review
    t.documentsComplete = len(note.checklist_missing) == 0
    if t.assignee:   # keep an existing ticket assignment
        item.assignee, item.assignee_username = t.assignee, t.assignee_username
    tickets._put(t)
    item.ticket_id, item.ticket_ref = t.id, t.reference
    audit.record("jd2_handoff", item.handed_by, detail=f"Sent to JD2 — {item.member_name or '—'} · {t.reference}", ref=item_id)
    return jd2_store.add(item)


@router.post("/{item_id}/documents", response_model=JD2Item)
async def upload_document(item_id: str, file: UploadFile = File(...), user=Depends(get_current_user)):
    """Attach one uploaded document to a JD2 claim (called once per file after the handoff)."""
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    data = await file.read()
    name = file.filename or "document"
    mime = file.content_type or "application/octet-stream"
    from app.routers import claims as tickets
    t = tickets._get(item.ticket_id) if item.ticket_id else None
    if t is not None:
        # file it with the claim's other documents (one folder per claim, see app/filing.py)
        t, doc = tickets.file_document(t, name, mime, data, user.get("name") or user.get("username", ""), "jd2")
        name = doc.name    # may have been made unique ("image (2).jpg")
        att = StoredDoc(id=doc.id, name=name, mime=mime, size=len(data), key=doc.key)
    else:
        doc_id = uuid.uuid4().hex[:8]
        jd2_store.put_blob(item_id, doc_id, name, mime, data)
        att = StoredDoc(id=doc_id, name=name, mime=mime, size=len(data))
    item.attachments = [a for a in item.attachments if a.id != att.id] + [att]
    return jd2_store.save(item)


class AssignBody(BaseModel):
    assignee: str = ""   # username (a display name still works for old data); empty = unassign

@router.put("/{item_id}/assign", response_model=JD2Item)
async def assign_item(item_id: str, body: AssignBody, user=Depends(get_current_user)):
    """Assign a claim to a team member (allowed targets come from Settings → Assignment
    permissions). Clearing is always allowed. The linked Inbox ticket follows."""
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    username, name = assignment.resolve(user, body.assignee)
    item.assignee, item.assignee_username = name, username
    assignment.sync_ticket(item_id, item.ticket_id, assignee=name, assignee_username=username)
    audit.record("assign_claim", user.get("name") or user.get("username", ""),
                 detail=f"JD2 claim {item.member_name or item_id} assigned to {name or 'nobody'}", ref=item_id)
    return jd2_store.save(item)


@router.delete("/{item_id}")
async def delete_item(item_id: str, user=Depends(get_current_user)):
    """Delete a claim from JD2. Super admin only, and recorded in the audit log."""
    if user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="Only a super admin can delete a claim")
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    # remove stored document files
    for att in (item.attachments or []):
        storage.delete(att.key or f"jd2/{item_id}/{att.id}")
    # remove the linked Inbox ticket with all its files (documents added later, saved JD1 work, manifest)
    from app.routers import claims as tickets
    for d in Collection("claims").all():
        if d.get("jd2_item_id") != item_id:
            continue
        t = tickets._get(d.get("id"))
        if t is None:
            continue
        for doc in t.documents:
            storage.delete(tickets._doc_key(t.id, doc))
        if t.storage_folder:
            storage.delete(f"{t.storage_folder}/_manifest.json")
            storage.delete(tickets._draft_key(t))
        tickets._claims.delete(t.id)
    jd2_store.delete(item_id)
    audit.record("delete_claim", user.get("name") or user.get("username", ""),
                 detail=f"Deleted JD2 claim — {item.member_name or '—'} · {item.insurer or '—'} · {item.claim_amount or '—'}",
                 ref=item_id)
    return {"ok": True}


@router.get("/{item_id}/documents/{doc_id}")
async def download_document(item_id: str, doc_id: str, user=Depends(get_current_user)):
    """Return the raw bytes of a JD1-uploaded document so JD2 can preview or download it."""
    item = jd2_store.get(item_id)
    att = next((a for a in (item.attachments if item else []) if a.id == doc_id), None)
    blob = storage.get(att.key) if att and att.key else jd2_store.get_blob(item_id, doc_id)
    if not blob:
        raise HTTPException(status_code=404, detail="Document not found")
    name, mime, data = blob
    from app import filing
    return Response(content=data, media_type=mime or "application/octet-stream",
                    headers={"Content-Disposition": filing.content_disposition(att.name if att else name)})

@router.get("/queue", response_model=JD2List)
async def queue(user=Depends(get_current_user)):
    return JD2List(items=jd2_store.all_items())

@router.get("/{item_id}", response_model=JD2Item)
async def get_item(item_id: str, user=Depends(get_current_user)):
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return item

@router.put("/{item_id}/note", response_model=JD2Item)
async def update_note(item_id: str, note: JD1Note, user=Depends(get_current_user)):
    """JD2 corrects fields on the note before deciding; save the edits back to the ticket."""
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    if item.status != JD2Status.pending:
        raise HTTPException(status_code=400, detail="Cannot edit a claim that has already been decided")
    item.note = note
    item.member_name = note.header.member_name.value
    item.insurer = note.header.insurer.value
    item.claim_type = note.claim_type
    item.claim_amount = _amount_of(note)
    from app.routers.claims import _amount
    assignment.sync_ticket(item_id, item.ticket_id, memberName=item.member_name or "—",
                           insurer=item.insurer or "—", amount=_amount(item.claim_amount))
    return jd2_store.save(item)

@router.post("/{item_id}/decision", response_model=JD2Item)
async def decide(item_id: str, body: JD2Decision, user=Depends(get_current_user)):
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    if body.decision not in _DECISION_STATUS:
        raise HTTPException(status_code=400, detail="decision must be approve | partial | reject")
    item.decision = body.decision
    item.reasons = body.reasons
    item.status = _DECISION_STATUS[body.decision]
    item.decided_by = user.get("name") or user.get("username", "")
    item.decided_at = datetime.now(timezone.utc)
    # keep the linked Inbox ticket's status in sync with JD2's decision — the JD2Status and
    # Claim Status enums share the same string values for approved/partially_approved/rejected.
    assignment.sync_ticket(item_id, item.ticket_id, status=item.status.value)
    audit.record("jd2_decision", item.decided_by, detail=f"{body.decision} — {item.member_name or item_id}", ref=item_id)
    return jd2_store.save(item)
