from datetime import datetime
from fastapi import APIRouter, HTTPException
from app.models import Claim, ClaimList, Channel, Category, Status, ExtractedField, DocumentFile
router = APIRouter(prefix="/api")

# Live claims are created by the pipeline (JD1 intake). Starts empty — no demo data.
_CLAIMS: list[Claim] = []

@router.get("/claims", response_model=ClaimList)
def list_claims(page: int = 1):
    return ClaimList(items=_CLAIMS, page=page, total=len(_CLAIMS))

@router.get("/claims/{claim_id}", response_model=Claim)
def get_claim(claim_id: str):
    for c in _CLAIMS:
        if c.id == claim_id:
            return c
    raise HTTPException(status_code=404, detail="Claim not found")
