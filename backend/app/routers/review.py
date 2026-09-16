"""Hybrid document review:
 - Gemini extracts the field VALUES (best at handwriting / Burmese, maps to the insurer's fields)
 - Document AI Form Parser provides the bounding BOX (where on the page) for highlighting
When no fields are requested, falls back to raw Document AI key/values."""
import base64, hashlib, json, re, uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.models import ReviewResult, ReviewField, ReviewBox, PageAnalysis, PageDetail, PageItem
from app.security import get_current_user
from app.adapters.docai import review as docai_review
from app.adapters.jd1 import pdf_text_and_pages, is_pdf
from app.config import settings

router = APIRouter(prefix="/api", tags=["review"])

_CACHE: dict[str, ReviewResult] = {}
_MAX = 200


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _find_box(value: str, raw: list[ReviewField]):
    """Locate the highlight by the VALUE Gemini extracted, matched ONLY against the
    Document AI field's read value (never the printed question). Strict: only returns
    a box on a strong match, otherwise none — better no highlight than a wrong one."""
    nv = _norm(value)
    if not nv or len(nv) < 3:
        return 0, ReviewBox()
    vw = [w for w in nv.split() if w]
    best = None; score = 0.0
    for r in raw:
        if not (r.box and r.box.w > 0):
            continue
        nc = _norm(r.value)
        if not nc:
            continue
        if nc == nv:
            s = 1.0
        else:
            longer, shorter = (nc, nv) if len(nc) >= len(nv) else (nv, nc)
            if len(shorter) >= 5 and shorter in longer:
                s = len(shorter) / len(longer)          # strong containment only
            else:
                shared = len(set(nc.split()) & set(vw))
                s = shared / max(len(vw), 1) if shared else 0.0
        if s > score:
            score = s; best = r
    if best and score >= 0.8:
        return best.page, best.box
    return 0, ReviewBox()


def _gemini_values(data: bytes, mime: str, fields: list[dict]) -> dict:
    if not (settings.ocr_provider == "gemini" and settings.gemini_api_key):
        return {}
    import httpx
    lines = []
    for i, f in enumerate(fields, 1):
        if not f.get("label"):
            continue
        sec = f.get("section"); hint = f.get("hint")
        lines.append(f"{i}. " + (f"[{sec}] " if sec else "") + str(f.get("label"))
                     + (f" (hint: {hint})" if hint else ""))
    labels = "\n".join(lines)
    prompt = (
        "Read this insurance claim document carefully, INCLUDING handwriting and Burmese text, across ALL pages. "
        "For each NUMBERED field below, extract the applicant's answer (the value the customer FILLED IN, "
        "not the printed question/label). Keep numbers and IDs exactly as written. "
        "Dates in these forms are written in DD/MM/YY (or DD/MM/YYYY) format — return them as written, do not reorder. "
        "For a total claim amount, use the overall total figure even if it appears at the bottom of a table on a later page. "
        "Follow any per-field hint in parentheses. "
        'Respond ONLY with JSON: {"fields":[{"n":<field number>,"value":"<answer>","confidence":0.0}]}. '
        "Include an entry for every field number. confidence is 0..1; if a field is blank or not present, "
        'use value "" and confidence 0.\n\nFields:\n' + labels
    )
    parts = [{"text": prompt}]
    text = ""
    if is_pdf("doc", mime) or (mime or "").startswith("application/pdf"):
        text, _ = pdf_text_and_pages(data)
    if len(text.strip()) > 200:
        parts.append({"text": "[DOCUMENT TEXT]\n" + text[:15000]})
    elif len(data) <= 18_000_000:
        parts.append({"inline_data": {"mime_type": mime or "application/pdf", "data": base64.b64encode(data).decode()}})
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}")
    try:
        r = httpx.post(url, json={"contents": [{"parts": parts}]}, timeout=120)
        r.raise_for_status()
        txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception:
        return {}
    m = re.search(r"\{.*\}", txt, re.S)
    try:
        d = json.loads(m.group(0) if m else txt)
    except Exception:
        return {}
    out = {}
    for it in d.get("fields", []):
        if isinstance(it, dict) and it.get("n") is not None:
            try:
                n = int(it["n"])
            except (TypeError, ValueError):
                continue
            out[n] = {"value": str(it.get("value", "")).strip(), "confidence": float(it.get("confidence", 0) or 0)}
    return out


_PAGE_CACHE: dict[str, PageAnalysis] = {}


def _page_analysis(data: bytes, mime: str) -> PageAnalysis:
    """Page-by-page 'Full detection': for every page, a short title, a plain-English
    summary, and the important data points as label/value pairs (copyable)."""
    if not (settings.ocr_provider == "gemini" and settings.gemini_api_key):
        return PageAnalysis(pages=[], provider="stub", error="AI not configured")
    import httpx
    prompt = (
        "You are analysing an insurance claim document for a health-insurance TPA in Myanmar. "
        "Go through the document PAGE BY PAGE. For EACH page return: the page number, a short title, "
        "a 2-4 sentence plain-English summary of what that page contains, and the important data points on that "
        "page as label/value pairs — names, NRC/passport, policy numbers, dates, diagnosis, treatment, "
        "hospital/provider, amounts, bank details, phone, email, and anything else useful. "
        "Read handwriting and Burmese too; keep numbers and IDs exactly as written. "
        "Include every page, even near-empty ones (brief summary, empty items). "
        'Respond ONLY with JSON: {"pages":[{"page":1,"title":"...","summary":"...","items":[{"label":"...","value":"..."}]}]}'
    )
    parts = [{"text": prompt}]
    if len(data) <= 18_000_000:
        parts.append({"inline_data": {"mime_type": mime or "application/pdf", "data": base64.b64encode(data).decode()}})
    else:
        text, _ = pdf_text_and_pages(data)
        parts.append({"text": "[DOCUMENT TEXT]\n" + text[:30000]})
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}")
    try:
        r = httpx.post(url, json={"contents": [{"parts": parts}]}, timeout=180)
        r.raise_for_status()
        txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except Exception as e:
        return PageAnalysis(pages=[], provider="gemini", error=f"AI error: {str(e)[:200]}")
    m = re.search(r"\{.*\}", txt, re.S)
    try:
        d = json.loads(m.group(0) if m else txt)
    except Exception:
        return PageAnalysis(pages=[], provider="gemini", error="Could not parse the AI response.")
    pages: list[PageDetail] = []
    for it in d.get("pages", []):
        if not isinstance(it, dict):
            continue
        try:
            pg = int(it.get("page") or 0)
        except (TypeError, ValueError):
            pg = 0
        items = [PageItem(label=str(x.get("label", "")).strip(), value=str(x.get("value", "")).strip())
                 for x in (it.get("items") or [])
                 if isinstance(x, dict) and (str(x.get("label", "")).strip() or str(x.get("value", "")).strip())]
        pages.append(PageDetail(page=pg, title=str(it.get("title", "")).strip(),
                                summary=str(it.get("summary", "")).strip(), items=items))
    return PageAnalysis(pages=pages, provider="gemini")


@router.post("/review/pages", response_model=PageAnalysis)
async def review_pages(file: UploadFile = File(...), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    mime = file.content_type or "application/pdf"
    key = hashlib.sha256(data + b"::pages").hexdigest()
    cached = _PAGE_CACHE.get(key)
    if cached is not None:
        return cached
    res = _page_analysis(data, mime)
    if not res.error:
        if len(_PAGE_CACHE) >= _MAX:
            _PAGE_CACHE.pop(next(iter(_PAGE_CACHE)))
        _PAGE_CACHE[key] = res
    return res


@router.post("/review", response_model=ReviewResult)
async def review(file: UploadFile = File(...), fields: str = Form(""), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    mime = file.content_type or "application/pdf"

    key = hashlib.sha256(data + fields.encode("utf-8")).hexdigest()
    cached = _CACHE.get(key)
    if cached is not None:
        return cached

    docres = docai_review(data, mime)          # raw key/values + boxes
    raw = docres.fields
    result = ReviewResult(pages=docres.pages, fields=raw, all_fields=raw, provider="docai", error=docres.error)

    req = []
    if fields:
        try:
            req = [f for f in json.loads(fields) if isinstance(f, dict) and f.get("label")]
        except Exception:
            req = []

    if req:
        gem = _gemini_values(data, mime, req)   # accurate values (handwriting/Burmese), keyed by field number
        mapped: list[ReviewField] = []
        for i, f in enumerate(req, 1):
            g = gem.get(i, {})
            val = g.get("value", "")
            page, box = _find_box(val, raw)
            mapped.append(ReviewField(
                id=uuid.uuid4().hex[:8], name=f["label"], value=val,
                confidence=(g.get("confidence", 0.0) if val else 0.0),
                page=page, section=str(f.get("section", "")), box=box,
            ))
        result.fields = mapped
        result.provider = "hybrid" if gem else "docai"

    if not result.error:
        if len(_CACHE) >= _MAX:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = result
    return result
