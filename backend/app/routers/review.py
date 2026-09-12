from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from app.models import ReviewResult
from app.security import get_current_user
from app.adapters.docai import review as docai_review

router = APIRouter(prefix="/api", tags=["review"])

@router.post("/review", response_model=ReviewResult)
async def review(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return docai_review(data, file.content_type or "application/pdf")
