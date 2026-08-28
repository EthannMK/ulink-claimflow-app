import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from app.models import JD1Note, JD2Item, JD2List, JD2Decision, JD2Status
from app.security import get_current_user
from app import jd2_store

router = APIRouter(prefix="/api/jd2", tags=["jd2"])

_DECISION_STATUS = {
    "approve": JD2Status.approved,
    "partial": JD2Status.partially_approved,
    "reject": JD2Status.rejected,
}

@router.post("/handoff", response_model=JD2Item)
async def handoff(note: JD1Note, user=Depends(get_current_user)):
    """JD1 sends a completed Process Note to the JD2 queue."""
    item = JD2Item(
        id=uuid.uuid4().hex[:12],
        created_at=datetime.now(timezone.utc),
        handed_by=user.get("name") or user.get("username", ""),
        member_name=note.header.member_name.value,
        insurer=note.header.insurer.value,
        claim_type=note.claim_type,
        claim_amount=note.header.total_claim_amount.value or note.section_b.claim_amount.value,
        status=JD2Status.pending,
        note=note,
    )
    return jd2_store.add(item)

@router.get("/queue", response_model=JD2List)
async def queue(user=Depends(get_current_user)):
    return JD2List(items=jd2_store.all_items())

@router.get("/{item_id}", response_model=JD2Item)
async def get_item(item_id: str, user=Depends(get_current_user)):
    item = jd2_store.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Not found")
    return item

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
    return jd2_store.save(item)
