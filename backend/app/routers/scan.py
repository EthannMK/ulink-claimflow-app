from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from app.models import ScanResult
from app.security import get_current_user
from app.adapters.ocr import get_provider

router = APIRouter(prefix="/api", tags=["scan"])

@router.post("/scan", response_model=ScanResult)
async def scan(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    return get_provider().extract(data, file.content_type or "image/png")
