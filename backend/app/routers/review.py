"""Hybrid document review:
 - Gemini extracts the field VALUES (best at handwriting / Burmese, maps to the insurer's fields)
 - Document AI Form Parser provides the bounding BOX (where on the page) for highlighting
When no fields are requested, falls back to raw Document AI key/values."""
import base64, hashlib, json, re, uuid
from fastapi import APIRouter, Depends, UploadFile, File, Form, HTTPException
from fastapi.concurrency import run_in_threadpool
from app.models import ReviewResult, ReviewField, ReviewBox, PageAnalysis, PageDetail, PageItem, PageTable
from app.security import get_current_user
from app.adapters.docai import review as docai_review
from app.adapters.jd1 import pdf_text_and_pages, pdf_text_by_page, pdf_page_images, pdf_page_plan, pdf_render_pages, is_pdf
from app.config import settings
from app import ai_provider, request_ctx, usage

router = APIRouter(prefix="/api", tags=["review"])

_CACHE: dict[str, ReviewResult] = {}
_MAX = 200


# ---- results are also kept in Cloud Storage, so the same document is not read (and billed) again
#      after the server restarts. Since the server now sleeps when idle (min instances 0), the
#      in-memory cache alone was lost every time. The key includes the prompt and the AI settings,
#      so editing a prompt or switching models reads the document again.
def _fingerprint(prompt_id: str) -> str:
    from app import prompts
    try:
        cfg = json.dumps([prompts.get(prompt_id), ai_provider.get_settings().get("providers"),
                          ai_provider.get_feature_models()], sort_keys=True, default=str)
    except Exception:
        cfg = prompt_id
    return hashlib.sha256(cfg.encode("utf-8")).hexdigest()[:16]


def _saved_get(kind: str, key: str, model):
    from app import storage
    try:
        hit = storage.get(f"cache/{kind}/{key}.json")
        return model.model_validate_json(hit[2]) if hit else None
    except Exception:
        return None


def _saved_put(kind: str, key: str, obj) -> None:
    from app import storage
    try:
        storage.put(f"cache/{kind}/{key}.json", f"{key}.json", "application/json", obj.model_dump_json().encode("utf-8"))
    except Exception:
        pass


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


_FIELDS_PROMPT = (
        "Read this insurance claim document carefully, INCLUDING handwriting and Burmese text, across ALL pages. "
        "For each NUMBERED field below, extract the applicant's answer (the value the customer FILLED IN, "
        "not the printed question/label). Keep numbers and IDs exactly as written. "
        "Dates in these forms are written in DD/MM/YY (or DD/MM/YYYY) format — return them as written, do not reorder. "
        "For a total claim amount, use the overall total figure even if it appears at the bottom of a table on a later page. "
        "Follow any per-field hint in parentheses. "
        "If a field's answer has multiple parts (e.g. more than one diagnosis, or a multi-line address), include ALL of them in full rather than truncating to the first one. "
        'Respond ONLY with JSON: {"fields":[{"n":<field number>,"value":"<answer>","confidence":0.0}]}. '
        "Include an entry for every field number. confidence is 0..1; if a field is blank or not present, "
        'use value "" and confidence 0.'
)


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
    from app import prompts
    prompt = prompts.get("required_fields") + "\n\nFields:\n" + labels
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
    "Also transcribe any stamp, seal, or signature block you can read (issuing office, date stamped, signatory name/title) as its own label/value pair, and note if a required stamp or signature appears to be missing. "
    "Never write a vague summary like 'contains patient details' or 'form with information' — name the actual fields and values present, even if that means a longer summary. "
    "If the page contains a TABLE, VOUCHER, bill or ledger (rows and columns, printed or hand-drawn), return it in "
    "\"tables\" as {\"title\":\"...\",\"columns\":[\"...\"],\"rows\":[[\"...\"]]} with the real column headers and "
    "EVERY row in order, one cell per column, each cell exactly as written (codes, descriptions, units, quantities, "
    "prices, discounts, amounts). Do NOT also repeat the table rows as label/value items, and never collapse rows. "
    "If a page is an INVOICE, BILL or RECEIPT, also give as label/value items: provider/hospital, date, "
    "invoice/receipt/slip number, patient name/ID, and every total line (sub total, discount, tax, net amount, grand "
    "total) — e.g. {\"label\":\"Net amount\",\"value\":\"...\"}. "
    "Keep numbers and IDs exactly as written. Include every page, even near-empty ones (brief summary, empty items). "
    'Respond ONLY with JSON: {"pages":[{"page":1,"title":"...","summary":"...","items":[{"label":"...","value":"..."}],'
    '"tables":[{"title":"...","columns":["..."],"rows":[["..."]]}]}]} — use "tables":[] when a page has no table.'
)
_PAGE_ABS_SUFFIX = " For \"page\", use the [PAGE n] number shown, or the page's position starting at 1."
# Always added (even to a custom prompt from the AI Prompts page): handwriting marks used by the
# "use the clearest value across pages" check on the Document review screen.
_HW_SUFFIX = (" For EVERY item also add \"hw\":true when the value is HANDWRITTEN (omit it for printed/typed text) and "
              "\"unclear\":true when that handwriting is hard to read. For unclear handwriting write the value letter by "
              "letter exactly as you see it — never guess, correct or 'fix' a name, ID or date to match another page.")
_PAGE_REL_SUFFIX = " This is a slice of a larger document — number the pages 1, 2, 3… in the order they appear here."


def _page_prompt(absolute: bool = True) -> str:
    """Full-detection instructions (editable in AI Prompts) + how to number pages."""
    from app import prompts
    return prompts.get("full_detection") + _HW_SUFFIX + (_PAGE_ABS_SUFFIX if absolute else _PAGE_REL_SUFFIX)


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
        items = [PageItem(label=str(x.get("label", "")).strip(), value=str(x.get("value", "")).strip(),
                          hw=x.get("hw") is True or str(x.get("hw", "")).lower() == "true",
                          unclear=x.get("unclear") is True or str(x.get("unclear", "")).lower() == "true")
                 for x in (it.get("items") or [])
                 if isinstance(x, dict) and (str(x.get("label", "")).strip() or str(x.get("value", "")).strip())]
        tables = []
        for t in (it.get("tables") or [])[:6]:
            if not isinstance(t, dict):
                continue
            cols = [str(c).strip() for c in (t.get("columns") or []) if str(c).strip()][:20]
            rows = []
            for r in (t.get("rows") or [])[:400]:
                if isinstance(r, list):
                    cells = [str(c).strip() for c in r][:max(len(cols), 1) if cols else 20]
                    if cols and len(cells) < len(cols):
                        cells += [""] * (len(cols) - len(cells))
                    if any(cells):
                        rows.append(cells)
            if rows:
                tables.append(PageTable(title=str(t.get("title", "")).strip(), columns=cols, rows=rows))
        out.append(PageDetail(page=pg, title=str(it.get("title", "")).strip(),
                              summary=str(it.get("summary", "")).strip(), items=items, tables=tables))
    return out


def _page_analysis(data: bytes, mime: str, start: int = 0, count: int = 0) -> PageAnalysis:
    """Page-by-page 'Full detection'. With start/count, analyses only that page range
    (the frontend fires ranges in parallel and streams them in). Without a range, it
    chunks the whole document and runs the chunks concurrently."""
    if not ai_provider.any_available():
        return PageAnalysis(pages=[], provider="stub", error="AI reading is not available right now — please contact your administrator.")

    is_pdf_doc = is_pdf("doc", mime) or (mime or "").startswith("application/pdf")
    ranged = count and count > 0

    tasks: list[tuple[list, int]] = []   # (parts, page-offset)
    if is_pdf_doc:
        try:
            _total, plan = pdf_page_plan(data, start if ranged else 1, count if ranged else 0)
        except Exception:
            plan = []
        # a requested range is one AI call; a whole document is split into groups of 3 pages
        groups = [plan] if ranged else [plan[i:i + 3] for i in range(0, len(plan), 3)]
        for grp in groups:
            if not grp:
                continue
            imgs = pdf_render_pages(data, [p["page"] for p in grp if p["visual"]])
            parts: list[dict] = [{"text": _page_prompt(True)}]
            for p in grp:
                txt = p["text"].strip()
                if p["visual"] and p["page"] in imgs:
                    parts.append({"text": f"[PAGE {p['page']}] — photo/scanned page, image below"
                                          + (f". Text layer found on it: {txt[:1500]}" if txt else "")})
                    parts.append({"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(imgs[p["page"]]).decode()}})
                elif txt:
                    parts.append({"text": f"[PAGE {p['page']}]\n{txt[:8000]}"})
                else:
                    parts.append({"text": f"[PAGE {p['page']}] — blank page"})
            tasks.append((parts, 0))
    elif len(data) <= 18_000_000:
        tasks = [([{"text": _page_prompt(True)}, {"text": "[PAGE 1] — image below"},
                   {"inline_data": {"mime_type": mime or "image/jpeg", "data": base64.b64encode(data).decode()}}], 0)]

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
        # A raw ThreadPoolExecutor does not carry contextvars over, so copy the
        # request context (who is asking -> usage attribution + cap) into each task.
        import contextvars
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(tasks))) as ex:
            futs = [ex.submit(contextvars.copy_context().run, _run, t) for t in tasks]
            for fut in futs:
                pages.extend(fut.result())

    pages.sort(key=lambda p: p.page)
    if not pages:
        return PageAnalysis(pages=[], provider="ai", error="The AI service is busy right now. Please try again in a moment.")
    return PageAnalysis(pages=pages, provider="ai")


@router.post("/review/pages", response_model=PageAnalysis)
async def review_pages(file: UploadFile = File(...), start: int = Form(0), count: int = Form(0), fresh: bool = Form(False),
                       user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    mime = file.content_type or "application/pdf"
    key = hashlib.sha256(data + f"::pages:{start}:{count}:{_fingerprint('full_detection')}".encode()).hexdigest()
    if not fresh:                     # "Re-run AI" sends fresh=true to read the pages again
        cached = _PAGE_CACHE.get(key)
        if cached is None:
            cached = await run_in_threadpool(_saved_get, "pages", key, PageAnalysis)
            if cached is not None:
                _PAGE_CACHE[key] = cached
        if cached is not None:
            return cached
    # Run the blocking rasterize + AI call in a worker thread so concurrent page
    # ranges truly run in parallel (an async endpoint would serialize them).
    request_ctx.set_user(user.get("username", ""), "Full detection")
    try:
        res = await run_in_threadpool(_page_analysis, data, mime, start, count)
    except usage.UsageCapExceeded as e:
        raise usage.cap_http_error(e)
    if not res.error:
        if len(_PAGE_CACHE) >= _MAX:
            _PAGE_CACHE.pop(next(iter(_PAGE_CACHE)))
        _PAGE_CACHE[key] = res
        await run_in_threadpool(_saved_put, "pages", key, res)
    return res


@router.post("/review", response_model=ReviewResult)
async def review(file: UploadFile = File(...), fields: str = Form(""), user=Depends(get_current_user)):
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    mime = file.content_type or "application/pdf"

    key = hashlib.sha256(data + fields.encode("utf-8") + _fingerprint("required_fields").encode()).hexdigest()
    cached = _CACHE.get(key)
    if cached is None and fields:
        cached = await run_in_threadpool(_saved_get, "fields", key, ReviewResult)
        if cached is not None:
            _CACHE[key] = cached
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
                          provider="ai", error=error)

    req = []
    if fields:
        try:
            req = [f for f in json.loads(fields) if isinstance(f, dict) and f.get("label")]
        except Exception:
            req = []

    if req:
        request_ctx.set_user(user.get("username", ""), "Required fields")
        try:
            gem = await run_in_threadpool(_gemini_values, data, mime, req)   # accurate values (handwriting/Burmese), keyed by field number
        except usage.UsageCapExceeded as e:
            raise usage.cap_http_error(e)
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
        if req and any(f.value for f in result.fields):
            await run_in_threadpool(_saved_put, "fields", key, result)
    return result
