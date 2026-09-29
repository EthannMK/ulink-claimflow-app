from pydantic import BaseModel
from fastapi import APIRouter, Depends, UploadFile, File, HTTPException
from app.models import JD1Note
from app.security import get_current_user
from app.adapters.jd1 import read_packet, draft_client_mail
from app import request_ctx, usage

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
    request_ctx.set_user(user.get("username", ""))
    try:
        return read_packet(packet)
    except usage.UsageCapExceeded as e:
        raise usage.cap_http_error(e)


class DraftMail(BaseModel):
    subject: str
    body: str
    reason: str = ""   # why the mail is suggested (missing docs / mismatch / clarification)

@router.post("/jd1/draft-mail", response_model=DraftMail)
async def jd1_draft_mail(note: JD1Note, user=Depends(get_current_user)):
    """Draft (never send) an email to the client requesting missing documents or
    clarification, based on the JD1 note. The officer reviews and sends it themselves."""
    sender = user.get("name") or user.get("username", "")
    request_ctx.set_user(user.get("username", ""))
    subject, body, reason = draft_client_mail(note, sender)   # falls back to a template if capped
    return DraftMail(subject=subject, body=body, reason=reason)
