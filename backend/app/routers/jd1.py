from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from app.models import JD1Note
from app.security import get_current_user
from app.adapters.jd1 import read_packet

router = APIRouter(prefix="/api", tags=["jd1"])

@router.post("/jd1", response_model=JD1Note)
async def jd1(files: list[UploadFile] = File(...), user=Depends(get_current_user)):
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    packet: list[tuple[str, bytes, str]] = []
    for f in files:
        data = await f.read()
        if data:
            packet.append((f.filename or "file", data, f.content_type or ""))
    if not packet:
        raise HTTPException(status_code=400, detail="All files were empty")
    return read_packet(packet)
