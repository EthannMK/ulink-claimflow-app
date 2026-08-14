from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.models import Claim, ClaimList, Channel, Category, Status, ExtractedField, DocumentFile
router = APIRouter(prefix="/api")

# Temporary in-memory data until the DB + adapters are wired.
_CLAIMS = [
    Claim(
        id="c1", reference="CLM-26001", channel=Channel.email, category=Category.new_claim,
        status=Status.ready_for_review, insurer="MGEN", memberName="Thin Zar", policyNumber="MG-100234",
        assignee="u1", suggestedAssignee="u1", receivedAt=datetime.fromisoformat("2026-08-14T09:12:00"),
        documentsComplete=True, amount=185000, summary="Outpatient consultation + medication.",
        extracted=[ExtractedField(key="Diagnosis", value="Acute gastritis", confidence=0.72)],
        documents=[DocumentFile(id="d1", name="Claim form.pdf", type="claim_form", url="#", pages=2)],
    ),
]

@router.get("/claims", response_model=ClaimList)
def list_claims(page: int = 1):
    return ClaimList(items=_CLAIMS, page=page, total=len(_CLAIMS))

@router.get("/claims/{claim_id}", response_model=Claim)
def get_claim(claim_id: str):
    for c in _CLAIMS:
        if c.id == claim_id:
            return c
    raise HTTPException(status_code=404, detail="Claim not found")
