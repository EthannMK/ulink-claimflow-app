import logging
import threading
import uuid
from pydantic import BaseModel
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.models import JD1Note
from app.security import get_current_user
from app.adapters.jd1 import read_packet, draft_client_mail
from app import request_ctx, usage

router = APIRouter(prefix="/api", tags=["jd1"])
log = logging.getLogger("claimflow.jd1")
_JOBS: dict[str, tuple[threading.Event, str]] = {}   # running streamed scans: job id -> (cancel flag, owner)

@router.post("/jd1", response_model=JD1Note)
async def jd1(files: list[UploadFile] = File(...), corrections: str = Form(""), user=Depends(get_current_user)):
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
        return read_packet(packet, corrections)
    except usage.UsageCapExceeded as e:
        raise usage.cap_http_error(e)


@router.post("/jd1/stream")
async def jd1_stream(files: list[UploadFile] = File(...), corrections: str = Form(""), user=Depends(get_current_user)):
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
    job_id = uuid.uuid4().hex
    stop = threading.Event()
    _JOBS[job_id] = (stop, username)

    def work():
        request_ctx.set_user(username, "JD1 note")
        progress.set_emitter(q.put)
        progress.set_cancel_event(stop)
        tally = usage.start_tally()      # client tokens this scan used (tokens only — never dollars)
        try:
            note = read_packet(packet, corrections)
            q.put({"type": "result", "note": note.model_dump(), "tokens_used": usage.tally_tokens(tally), "t": time.time()})
        except progress.Cancelled:
            log.info(f"[jd1-stream] cancelled by {username}")
            q.put({"type": "cancelled", "tokens_used": usage.tally_tokens(tally), "t": time.time()})
        except usage.UsageCapExceeded as e:
            q.put({"type": "error", "status": 402, "detail": usage.cap_http_error(e).detail, "t": time.time()})
        except Exception as e:
            print(f"[jd1-stream] FAILED: {str(e)[:300]}", flush=True)
            q.put({"type": "error", "status": 500, "detail": "The JD1 scan failed unexpectedly. Please try again.", "t": time.time()})
        finally:
            _JOBS.pop(job_id, None)
            q.put(None)

    threading.Thread(target=contextvars.copy_context().run, args=(work,), daemon=True).start()

    def events():
        try:
            yield json.dumps({"type": "start", "t": time.time(), "job": job_id, "files": [n for n, _d, _m in packet]}) + "\n"
            while True:
                try:
                    ev = q.get(timeout=2)
                except queue.Empty:
                    yield json.dumps({"type": "ping", "t": time.time()}) + "\n"
                    continue
                if ev is None:
                    break
                yield json.dumps(ev, default=str) + "\n"
        finally:
            # The browser went away (tab closed, network lost) without a result: nobody can
            # receive the note, so stop the AI instead of paying for an answer no one sees.
            if job_id in _JOBS:
                stop.set()

    return StreamingResponse(events(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/jd1/cancel/{job_id}")
def jd1_cancel(job_id: str, user=Depends(get_current_user)):
    """Cancel a running JD1 scan: the AI call is stopped on the server within a second or two.
    Only the person who started it (or a Super Admin) can cancel it."""
    job = _JOBS.get(job_id)
    if not job:
        return {"ok": True, "running": False}   # already finished
    stop, owner = job
    if owner != user.get("username", "") and user.get("role") != "super_admin":
        raise HTTPException(status_code=403, detail="You can only cancel your own scan")
    stop.set()
    return {"ok": True, "running": True}


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
