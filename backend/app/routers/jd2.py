import base64, uuid
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException, Response
from app.models import JD1Note, JD2Item, JD2List, JD2Decision, JD2Status, StoredDoc
from app.security import get_current_user
from app import jd2_store, storage, audit, store, access_settings
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
    attachments: list[HandoffAttachment] = []


@router.post("/handoff", response_model=JD2Item)
async def handoff(body: HandoffRequest, user=Depends(get_current_user)):
    """JD1 sends a completed Process Note (plus the uploaded documents) to the JD2 queue."""
    note = body.note
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
        claim_amount=note.header.total_claim_amount.value or note.section_b.claim_amount.value,
        status=JD2Status.pending,
        note=note,
        attachments=stored,
    )
    return jd2_store.add(item)


class AssignBody(BaseModel):
    assignee: str = ""

@router.put("/{item_id}/assign", response_model=JD2Item)
async def assign_item(item_id: str, body: AssignBody, user=Depends(get_current_user)):
    """Reassign a claim to a team member. Who the current officer is allowed to assign to
    is controlled by the Settings-driven permission map (role -> allowed target roles).
    Clearing the assignment (empty assignee) is always allowed."""
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    target_name = body.assignee or None
    if target_name:
        target = store.get_by_name(target_name)
        if not target:
            raise HTTPException(status_code=404, detail="No such user")
        allowed = access_settings.get_assign_permissions().get(user.get("role", ""), [])
        if target["role"] not in allowed:
            raise HTTPException(status_code=403, detail="Your role is not permitted to assign claims to that team member")
    item.assignee = target_name
    # keep the linked Inbox ticket in sync
    claims = Collection("claims")
    for c in claims.all():
        if c.get("jd2_item_id") == item_id:
            c["assignee"] = target_name
            claims.put(c.get("id"), c)
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
        storage.delete(f"jd2/{item_id}/{att.id}")
    # remove any linked Inbox ticket(s)
    claims = Collection("claims")
    for c in claims.all():
        if c.get("jd2_item_id") == item_id:
            claims.delete(c.get("id"))
    jd2_store.delete(item_id)
    audit.record("delete_claim", user.get("name") or user.get("username", ""),
                 detail=f"Deleted JD2 claim — {item.member_name or '—'} · {item.insurer or '—'} · {item.claim_amount or '—'}",
                 ref=item_id)
    return {"ok": True}


@router.get("/{item_id}/documents/{doc_id}")
async def download_document(item_id: str, doc_id: str, user=Depends(get_current_user)):
    """Return the raw bytes of a JD1-uploaded document so JD2 can preview or download it."""
    blob = jd2_store.get_blob(item_id, doc_id)
    if not blob:
        raise HTTPException(status_code=404, detail="Document not found")
    name, mime, data = blob
    return Response(content=data, media_type=mime or "application/octet-stream",
                    headers={"Content-Disposition": f'inline; filename="{name}"'})

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
    item.claim_amount = note.header.total_claim_amount.value or note.section_b.claim_amount.value
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
    claims = Collection("claims")
    for c in claims.all():
        if c.get("jd2_item_id") == item_id:
            c["status"] = item.status.value
            claims.put(c.get("id"), c)
    return jd2_store.save(item)
