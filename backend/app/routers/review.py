"""Hybrid document review:
 - Gemini extracts the field VALUES (best at handwriting / Burmese, maps to the insurer's fields)
 - Document AI Form Parser provides the bounding BOX (where on the page) for highlighting
When no fields are requested, falls back to raw Document AI key/values."""
import base64, hashlib, json, re, uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from app.models import ReviewResult, ReviewField, ReviewBox
from app.security import get_current_user
from app.adapters.docai import review as docai_review
from app.adapters.jd1 import pdf_text_and_pages, is_pdf
from app.config import settings

router = APIRouter(prefix="/api", tags=["review"])

_CACHE: dict[str, ReviewResult] = {}
_MAX = 200


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (s or "").lower()).strip()


def _match_box(label: str, raw: list[ReviewField]):
    """Find the Document AI key whose printed name best matches this field label,
    and return its answer region (page + box) for the highlight."""
    nl = _norm(label); lw = set(nl.split())
    best = None; score = 0.0
    for r in raw:
        nr = _norm(r.name)
        if not nr:
            continue
        if nr == nl:
            s = 100.0
        elif nl in nr or nr in nl:
            s = 60.0
        else:
            shared = len(set(nr.split()) & lw)
            s = (shared * 60.0 / max(len(lw), 1)) if shared else 0.0
        if s > score:
            score = s; best = r
    if best and score >= 40:
        return best.page, best.box
    return 0, ReviewBox()


def _gemini_values(data: bytes, mime: str, fields: list[dict]) -> dict:
    if not (settings.ocr_provider == "gemini" and settings.gemini_api_key):
        return {}
    import httpx
    labels = "\n".join(
        f"- {f.get('label')}" + (f" (hint: {f.get('hint')})" if f.get("hint") else "")
        for f in fields if f.get("label")
    )
    prompt = (
        "Read this insurance claim document carefully, INCLUDING handwriting and Burmese text, across ALL pages. "
        "For each requested field below, extract the applicant's answer (the value the customer FILLED IN, "
        "not the printed question/label). Keep numbers and IDs exactly as written. "
        "Dates in these forms are written in DD/MM/YY (or DD/MM/YYYY) format — return them as written, do not reorder. "
        "For a total claim amount, use the overall total figure even if it appears at the bottom of a table on a later page. "
        "Follow any per-field hint in parentheses. "
        'Respond ONLY with JSON: {"fields":[{"label":"<exact label>","value":"<answer>","confidence":0.0}]}. '
        "confidence is 0..1; if a field is blank or not present, use value \"\" and confidence 0.\n\nFields:\n" + labels
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
        if isinstance(it, dict) and it.get("label"):
            val = str(it.get("value", "")).strip()
            out[_norm(it["label"])] = {"value": val, "confidence": float(it.get("confidence", 0) or 0)}
    return out


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
        gem = _gemini_values(data, mime, req)   # accurate values (handwriting/Burmese)
        mapped: list[ReviewField] = []
        for f in req:
            g = gem.get(_norm(f["label"]), {})
            val = g.get("value", "")
            page, box = _match_box(f["label"], raw)
            mapped.append(ReviewField(
                id=uuid.uuid4().hex[:8], name=f["label"], value=val,
                confidence=(g.get("confidence", 0.0) if val else 0.0), page=page, box=box,
            ))
        result.fields = mapped
        result.provider = "hybrid" if gem else "docai"

    if not result.error:
        if len(_CACHE) >= _MAX:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = result
    return result
