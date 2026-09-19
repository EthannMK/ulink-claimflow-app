"""Hybrid document review:
 - Gemini extracts the field VALUES (best at handwriting / Burmese, maps to the insurer's fields)
 - Document AI Form Parser provides the bounding BOX (where on the page) for highlighting
When no fields are requested, falls back to raw Document AI key/values."""
import base64, hashlib, json, re, uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from app.models import ReviewResult, ReviewField, ReviewBox, PageAnalysis, PageDetail, PageItem
from app.security import get_current_user
from app.adapters.docai import review as docai_review
from app.adapters.jd1 import pdf_text_and_pages, pdf_text_by_page, pdf_page_images, is_pdf
from app.config import settings
from app import ai_provider

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
    if not ai_provider.any_available():
        return {}
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
    is_pdf_doc = is_pdf("doc", mime) or (mime or "").startswith("application/pdf")
    text = ""
    if is_pdf_doc:
        text, _ = pdf_text_and_pages(data)
    if len(text.strip()) > 200:
        # digital PDF → send text (any provider, incl. Groq)
        parts.append({"text": "[DOCUMENT TEXT]\n" + text[:15000]})
    elif is_pdf_doc:
        # scanned PDF → rasterize the first pages to images for a vision provider
        for _pno, jpg in pdf_page_images(data, 1, 0, dpi=120, cap=10):
            parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpg).decode()}})
    elif len(data) <= 18_000_000:
        # a plain image upload
        parts.append({"inline_data": {"mime_type": mime or "image/jpeg", "data": base64.b64encode(data).decode()}})
    txt = ai_provider.generate_text(parts)
    if not txt:
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


_PAGE_BASE = (
    "You are analysing an insurance claim document for a health-insurance TPA in Myanmar. "
    "Go through it PAGE BY PAGE. For EACH page return: the page number, a short title, "
    "a 3-5 sentence plain-English summary of what that page contains, and the important data points on that "
    "page as label/value pairs — names, NRC/passport, policy numbers, dates, diagnosis, treatment, "
    "hospital/provider, amounts, bank details, phone, email, and anything else useful. Be thorough and specific: "
    "prefer more label/value pairs over fewer, and never skip a value just because it is handwritten or in Burmese. "
    "READ ALL HANDWRITING, including messy or cursive Burmese handwriting, and transcribe it in FULL — "
    "do not summarise a handwritten note as just 'handwritten remarks'; write out the actual text you read, "
    "in Burmese, as completely as you can. "
    "If the page contains a TABLE, VOUCHER, or hand-written bill/ledger (rows and columns, possibly hand-drawn), "
    "read it ROW BY ROW: for every row capture the description and its amount/quantity as a label/value pair, and "
    "give the column headers. Do not collapse a multi-row table into one line. "
    "If a page is an INVOICE, BILL or RECEIPT, do not just give its name — extract the details: "
    "provider/hospital, date, invoice/receipt number, every notable line item with its amount, "
    "the total amount, and any tax or discount. Put the total as an item like {\"label\":\"Total amount\",\"value\":\"...\"}. "
    "Keep numbers and IDs exactly as written. Include every page, even near-empty ones (brief summary, empty items). "
    'Respond ONLY with JSON: {"pages":[{"page":1,"title":"...","summary":"...","items":[{"label":"...","value":"..."}]}]}'
)
_PAGE_ABS = _PAGE_BASE + " For \"page\", use the [PAGE n] number shown, or the page's position starting at 1."
_PAGE_REL = _PAGE_BASE + " This is a slice of a larger document — number the pages 1, 2, 3… in the order they appear here."


def _gemini_pages_call(parts: list) -> list:
    """One AI call via the shared provider layer; returns the raw 'pages' list (or [])."""
    txt = ai_provider.generate_text(parts)
    if not txt:
        return []
    m = re.search(r"\{.*\}", txt, re.S)
    try:
        d = json.loads(m.group(0) if m else txt)
    except Exception:
        return []
    return d.get("pages", []) if isinstance(d, dict) else []


def _pages_from_raw(raw: list, offset: int) -> list[PageDetail]:
    out: list[PageDetail] = []
    for it in raw:
        if not isinstance(it, dict):
            continue
        try:
            pg = int(it.get("page") or 0)
        except (TypeError, ValueError):
            pg = 0
        if offset:
            pg += offset
        items = [PageItem(label=str(x.get("label", "")).strip(), value=str(x.get("value", "")).strip())
                 for x in (it.get("items") or [])
                 if isinstance(x, dict) and (str(x.get("label", "")).strip() or str(x.get("value", "")).strip())]
        out.append(PageDetail(page=pg, title=str(it.get("title", "")).strip(),
                              summary=str(it.get("summary", "")).strip(), items=items))
    return out


def _page_analysis(data: bytes, mime: str, start: int = 0, count: int = 0) -> PageAnalysis:
    """Page-by-page 'Full detection'. With start/count, analyses only that page range
    (the frontend fires ranges in parallel and streams them in). Without a range, it
    chunks the whole document and runs the chunks concurrently."""
    if not ai_provider.any_available():
        return PageAnalysis(pages=[], provider="stub", error="No AI provider configured")

    is_pdf_doc = is_pdf("doc", mime) or (mime or "").startswith("application/pdf")
    page_texts = pdf_text_by_page(data) if is_pdf_doc else []
    total_text = sum(len(t) for t in page_texts)
    ranged = count and count > 0
    a0 = max(start - 1, 0)

    tasks: list[tuple[list, int]] = []   # (parts, page-offset)
    if page_texts and total_text > 200:
        if ranged:
            chunk = page_texts[a0:a0 + count]
            joined = "\n\n".join(f"[PAGE {a0 + i + 1}]\n{t}" for i, t in enumerate(chunk) if t.strip())
            if joined.strip():
                tasks.append(([{"text": _PAGE_ABS}, {"text": "[DOCUMENT TEXT BY PAGE]\n" + joined[:20000]}], 0))
        else:
            CH = 10
            for a in range(0, len(page_texts), CH):
                chunk = page_texts[a:a + CH]
                joined = "\n\n".join(f"[PAGE {a + i + 1}]\n{t}" for i, t in enumerate(chunk) if t.strip())
                if joined.strip():
                    tasks.append(([{"text": _PAGE_ABS}, {"text": "[DOCUMENT TEXT BY PAGE]\n" + joined[:20000]}], 0))
    elif is_pdf_doc:
        # scanned PDF → rasterize pages to JPEG images for a vision provider
        imgs = pdf_page_images(data, start if ranged else 1, count if ranged else 0, dpi=120, cap=(count if ranged else 8))
        if imgs:
            parts = [{"text": _PAGE_REL}]
            for _pno, jpg in imgs:
                parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpg).decode()}})
            tasks.append((parts, imgs[0][0] - 1))   # REL page numbers -> absolute via first page offset
    elif len(data) <= 18_000_000:
        tasks = [([{"text": _PAGE_ABS}, {"inline_data": {"mime_type": mime or "image/jpeg", "data": base64.b64encode(data).decode()}}], 0)]
    else:
        text, _ = pdf_text_and_pages(data)
        tasks = [([{"text": _PAGE_ABS}, {"text": "[DOCUMENT TEXT]\n" + text[:30000]}], 0)]

    if not tasks:
        return PageAnalysis(pages=[], provider="ai", error="Could not read the document.")

    import concurrent.futures
    pages: list[PageDetail] = []

    def _run(task):
        parts, offset = task
        return _pages_from_raw(_gemini_pages_call(parts), offset)

    if len(tasks) == 1:
        pages = _run(tasks[0])
    else:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(tasks))) as ex:
            for res in ex.map(_run, tasks):
                pages.extend(res)

    pages.sort(key=lambda p: p.page)
    if not pages:
        return PageAnalysis(pages=[], provider="ai", error="The AI service is busy right now. Please try again in a moment.")
    return PageAnalysis(pages=pages, provider="ai")


@router.post("/review/pages", response_model=PageAnalysis)
async def review_pages(file: UploadFile = File(...), start: int = Form(0), count: int = Form(0), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    mime = file.content_type or "application/pdf"
    key = hashlib.sha256(data + f"::pages:{start}:{count}".encode()).hexdigest()
    cached = _PAGE_CACHE.get(key)
    if cached is not None:
        return cached
    # Run the blocking rasterize + AI call in a worker thread so concurrent page
    # ranges truly run in parallel (an async endpoint would serialize them).
    res = await run_in_threadpool(_page_analysis, data, mime, start, count)
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

    # Document AI is only needed for highlight boxes; skip it unless USE_DOCAI is set (much faster).
    raw: list[ReviewField] = []
    pages = 1
    error = ""
    if settings.use_docai:
        docres = docai_review(data, mime)          # raw key/values + boxes
        raw = docres.fields; pages = docres.pages; error = docres.error
    else:
        try:
            _, n = pdf_text_and_pages(data)
            pages = n or 1
        except Exception:
            pages = 1
    result = ReviewResult(pages=pages, fields=raw, all_fields=raw,
                          provider=("docai" if settings.use_docai else "ai"), error=error)

    req = []
    if fields:
        try:
            req = [f for f in json.loads(fields) if isinstance(f, dict) and f.get("label")]
        except Exception:
            req = []

    if req:
        gem = await run_in_threadpool(_gemini_values, data, mime, req)   # accurate values (handwriting/Burmese), keyed by field number
        mapped: list[ReviewField] = []
        for i, f in enumerate(req, 1):
            g = gem.get(i, {})
            val = g.get("value", "")
            page, box = _find_box(val, raw) if settings.use_docai else (0, ReviewBox())
            mapped.append(ReviewField(
                id=uuid.uuid4().hex[:8], name=f["label"], value=val,
                confidence=(g.get("confidence", 0.0) if val else 0.0),
                page=page, section=str(f.get("section", "")), box=box,
            ))
        result.fields = mapped
        result.provider = ("hybrid" if (settings.use_docai and gem) else ("ai" if gem else result.provider))

    if not result.error:
        if len(_CACHE) >= _MAX:
            _CACHE.pop(next(iter(_CACHE)))
        _CACHE[key] = result
    return result
