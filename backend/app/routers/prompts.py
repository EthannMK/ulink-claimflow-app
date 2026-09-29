"""Super Admin: view, edit, test and reset the AI prompts (see app/prompts.py)."""
import base64, json, re, time
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from app.models import Role
from app.security import require_role
from app import prompts, ai_provider, usage
from app.adapters.jd1 import pdf_text_and_pages, pdf_page_images, is_pdf

router = APIRouter(prefix="/api/prompts", tags=["prompts"])

_SAMPLE_FIELDS = "1. Member name\n2. Policy number\n3. Treatment date\n4. Diagnosis\n5. Total claim amount"


def _check(pid: str):
    if pid not in prompts._IDS:
        raise HTTPException(status_code=404, detail="Unknown prompt")


class PromptText(BaseModel):
    text: str


@router.get("")
def list_prompts(user=Depends(require_role(Role.super_admin))):
    return prompts.list_all()


@router.get("/{pid}")
def get_prompt(pid: str, user=Depends(require_role(Role.super_admin))):
    _check(pid)
    return prompts.detail(pid)


@router.put("/{pid}")
def save_prompt(pid: str, body: PromptText, user=Depends(require_role(Role.super_admin))):
    _check(pid)
    if len(body.text.strip()) < 20:
        raise HTTPException(status_code=400, detail="The prompt is too short")
    if len(body.text) > 30000:
        raise HTTPException(status_code=400, detail="The prompt is too long (max 30,000 characters)")
    return prompts.save(pid, body.text, user.get("name") or user["username"])


@router.delete("/{pid}")
def reset_prompt(pid: str, user=Depends(require_role(Role.super_admin))):
    _check(pid)
    return prompts.reset(pid, user.get("name") or user["username"])


def _run_test(pid: str, text: str, sample: str, data: bytes, name: str, mime: str,
              provider: str, model: str, username: str) -> dict:
    # build the request exactly the way the live feature would, around the DRAFT text
    head = text
    if pid == "required_fields":
        head = text + "\n\nFields:\n" + _SAMPLE_FIELDS
    elif pid == "full_detection":
        from app.routers.review import _PAGE_ABS_SUFFIX
        head = text + _PAGE_ABS_SUFFIX
    elif pid == "help_assistant":
        from app.routers.assistant import _AREAS
        head = ("You are the built-in help assistant for 'Ulink ClaimFlow', a health-insurance claims and helpdesk system "
                "used by Ulink Assist Myanmar. Your ONLY job is to help staff USE the app.\n"
                f"The person asking has the role 'user'. They can open: {_AREAS['user']}\n" + text
                + f"\n\n---\nConversation so far:\nUser: {sample.strip() or 'How do I scan a claim packet?'}\n\nAssistant:")
    parts = [{"text": head}]
    if pid != "help_assistant":
        if data:
            if is_pdf(name, mime):
                doc_text, _n = pdf_text_and_pages(data)
                if len(doc_text.strip()) > 200:
                    parts.append({"text": "[DOCUMENT TEXT]\n" + doc_text[:15000]})
                else:
                    for _p, jpg in pdf_page_images(data, 1, 3, dpi=120, cap=3):
                        parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpg).decode()}})
            else:
                parts.append({"inline_data": {"mime_type": mime or "image/jpeg", "data": base64.b64encode(data).decode()}})
        elif sample.strip():
            parts.append({"text": "[DOCUMENT TEXT]\n" + sample.strip()[:15000]})
        else:
            raise HTTPException(status_code=400, detail="Add a sample document (file or pasted text) to test with")

    # which provider/model: the chosen one, else the first enabled & available provider
    specs = sorted([p for p in ai_provider.get_settings()["providers"] if p.get("enabled", True)], key=lambda p: p.get("priority", 99))
    if provider:
        specs = [p for p in ai_provider.get_settings()["providers"] if p.get("provider") == provider] or specs
    for spec in specs:
        reg = ai_provider._REGISTRY.get(spec["provider"])
        if reg and reg["available"]():
            break
    else:
        raise HTTPException(status_code=503, detail="No AI provider is available")
    mdl = model or ai_provider.get_feature_models().get("Prompt test", {}).get(spec["provider"]) or spec.get("model") or ""
    t0 = time.time()
    try:
        out, tok = reg["call"](parts, mdl)
        ok = bool(out and out.strip())
    except Exception as e:
        secs = time.time() - t0
        usage.record(username, spec["provider"], mdl, 0, 0, ok=False, purpose="Prompt test", seconds=secs)
        return {"ok": False, "output": "", "error": f"The AI call failed: {ai_provider._why(e)}", "seconds": round(secs, 1),
                "provider_label": ai_provider.provider_label(spec["provider"]), "model": mdl}
    secs = time.time() - t0
    usage.record(username, spec["provider"], mdl, tok.get("in", 0), tok.get("out", 0), ok=ok, purpose="Prompt test", seconds=secs)
    json_ok = None
    if prompts.meta(pid)["output"] == "json":
        m = re.search(r"\{.*\}", out or "", re.S)
        try:
            json.loads(m.group(0) if m else out)
            json_ok = True
        except Exception:
            json_ok = False
    return {"ok": ok, "output": out or "", "error": "" if ok else "The AI returned an empty answer",
            "seconds": round(secs, 1), "tokens_in": tok.get("in", 0), "tokens_out": tok.get("out", 0),
            "json_ok": json_ok, "provider_label": ai_provider.provider_label(spec["provider"]), "model": mdl}


@router.post("/{pid}/test")
async def test_prompt(pid: str, text: str = Form(...), sample_text: str = Form(""), provider: str = Form(""),
                      model: str = Form(""), file: UploadFile | None = File(None),
                      user=Depends(require_role(Role.super_admin))):
    """Run the DRAFT prompt once on a sample (nothing is saved). Counted in AI usage as "Prompt test"."""
    _check(pid)
    data = await file.read() if file else b""
    return await run_in_threadpool(_run_test, pid, text, sample_text, data, (file.filename if file else "") or "",
                                   (file.content_type if file else "") or "", provider, model, user["username"])
