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
    request_ctx.set_user(user.get("username", ""), "JD1 note")
    try:
        return read_packet(packet)
    except usage.UsageCapExceeded as e:
        raise usage.cap_http_error(e)


@router.post("/jd1/stream")
async def jd1_stream(files: list[UploadFile] = File(...), user=Depends(get_current_user)):
    """Same as POST /jd1, but streams live progress as newline-delimited JSON while it works:
      {"type":"start"} · {"type":"step","text":..,"pct":..} · {"type":"warn",..} ·
      {"type":"stream","chars":n} · {"type":"ping"} (keep-alive every 2 s) ·
      then exactly one {"type":"result","note":{...}} or {"type":"error","status":..,"detail":..}.
    The work runs in its own thread and the request stays open until it finishes, so the
    server keeps full CPU for it (also on Cloud Run) and nothing needs to be stored."""
    import json, queue, threading, time, contextvars
    from fastapi.responses import StreamingResponse
    from app import progress
    if not files:
        raise HTTPException(status_code=400, detail="No files uploaded")
    packet: list[tuple[str, bytes, str]] = []
    for f in files:
        data = await f.read()
        if data:
            packet.append((f.filename or "file", data, f.content_type or ""))
    if not packet:
        raise HTTPException(status_code=400, detail="All files were empty")

    q: "queue.Queue[dict | None]" = queue.Queue()
    username = user.get("username", "")

    def work():
        request_ctx.set_user(username, "JD1 note")
        progress.set_emitter(q.put)
        try:
            note = read_packet(packet)
            q.put({"type": "result", "note": note.model_dump(), "t": time.time()})
        except usage.UsageCapExceeded as e:
            q.put({"type": "error", "status": 402, "detail": usage.cap_http_error(e).detail, "t": time.time()})
        except Exception as e:
            print(f"[jd1-stream] FAILED: {str(e)[:300]}", flush=True)
            q.put({"type": "error", "status": 500, "detail": "The JD1 scan failed unexpectedly. Please try again.", "t": time.time()})
        finally:
            q.put(None)

    threading.Thread(target=contextvars.copy_context().run, args=(work,), daemon=True).start()

    def events():
        yield json.dumps({"type": "start", "t": time.time(), "files": [n for n, _d, _m in packet]}) + "\n"
        while True:
            try:
                ev = q.get(timeout=2)
            except queue.Empty:
                yield json.dumps({"type": "ping", "t": time.time()}) + "\n"
                continue
            if ev is None:
                break
            yield json.dumps(ev, default=str) + "\n"

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


class DraftMail(BaseModel):
    subject: str
    body: str
    reason: str = ""   # why the mail is suggested (missing docs / mismatch / clarification)

@router.post("/jd1/draft-mail", response_model=DraftMail)
async def jd1_draft_mail(note: JD1Note, user=Depends(get_current_user)):
    """Draft (never send) an email to the client requesting missing documents or
    clarification, based on the JD1 note. The officer reviews and sends it themselves."""
    sender = user.get("name") or user.get("username", "")
    request_ctx.set_user(user.get("username", ""), "Client email draft")
    subject, body, reason = draft_client_mail(note, sender)   # falls back to a template if capped
    return DraftMail(subject=subject, body=body, reason=reason)
