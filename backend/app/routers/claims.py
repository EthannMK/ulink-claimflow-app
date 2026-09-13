"""Tickets (claims). A ticket is auto-created when JD1 generates a note, then flows
through the Inbox by status. Firestore-backed with in-memory fallback (app/db.py)."""
import re, uuid
from datetime import datetime, timezone
from pydantic import BaseModel
from fastapi import APIRouter, Depends, HTTPException
from app.models import Claim, ClaimList, Channel, Category, Status, JD1Note
from app.security import get_current_user
from app.db import Collection

router = APIRouter(prefix="/api")

_claims = Collection("claims")


def _make_ref() -> str:
    return f"UL-{datetime.now().strftime('%Y%m%d')}-{uuid.uuid4().hex[:4].upper()}"

def _amount(s: str) -> float | None:
    digits = re.sub(r"[^\d]", "", s or "")
    return float(digits) if digits else None

def _get(claim_id: str) -> Claim | None:
    d = _claims.get(claim_id)
    return Claim.model_validate(d) if d else None

def _put(c: Claim) -> Claim:
    _claims.put(c.id, c.model_dump(mode="json"))
    return c


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
def list_claims(status: str = "", category: str = "", page: int = 1):
    items = [Claim.model_validate(d) for d in _claims.all()]
    if status:
        items = [c for c in items if c.status == status]
    if category:
        items = [c for c in items if c.category == category]
    items.sort(key=lambda c: c.receivedAt, reverse=True)
    return ClaimList(items=items, page=page, total=len(items))

@router.get("/claims/{claim_id}", response_model=Claim)
def get_claim(claim_id: str):
    c = _get(claim_id)
    if not c:
        raise HTTPException(status_code=404, detail="Claim not found")
    return c

@router.post("/claims/from-jd1", response_model=Claim)
def create_from_jd1(body: TicketFromJD1, user=Depends(get_current_user)):
    """JD1 upload → auto-create a ticket in the Inbox."""
    note = body.note
    is_log = (note.claim_type or "").upper() == "LOG"
    try:
        channel = Channel(body.channel)
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
    )
    return _put(claim)

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
