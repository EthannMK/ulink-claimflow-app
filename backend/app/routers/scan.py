from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from app.models import ScanResult
from app.security import get_current_user
from app.adapters.ocr import get_provider
from app import request_ctx, usage

router = APIRouter(prefix="/api", tags=["scan"])

@router.post("/scan", response_model=ScanResult)
async def scan(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    request_ctx.set_user(user.get("username", ""), "Quick scan")
    try:
        return get_provider().extract(data, file.content_type or "image/png")
    except usage.UsageCapExceeded as e:
        raise usage.cap_http_error(e)
