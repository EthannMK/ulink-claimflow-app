"""JD1 packet reader: take a claim packet (multiple files), classify each document,
read digital PDFs as text and scanned docs with the vision model, and produce a
structured JD1 Process Note (Sections A/B/C).

POC: uses Gemini when OCR_PROVIDER=gemini + a key is set; otherwise returns a stub note."""
from __future__ import annotations
import base64, json, re, uuid
from app.config import settings
from app import ai_provider, progress, prompts
from app.models import (
    JD1Note, NoteField, ClassifiedDoc,
    JD1Header, JD1SectionA, JD1SectionB, JD1SectionC,
    InvoiceItem, InvoiceSummary,
    SupportingDoc, ConsistencyCheck, SupportingAnalysis,
)

# ---- document classification ---------------------------------------------------
# per claim type -> mandatory document types (checklist)
MANDATORY = {
    "reimbursement": ["Claim form", "Invoice / bill", "Medical report", "ID copy"],
    "LOG": ["LOG / pre-authorization form", "Medical report", "ID copy"],
    "API-eclaim": ["Claim form", "Invoice / bill", "Medical report"],
}

_TYPE_PATTERNS = [
    ("Policy wording", r"policy wording|contract wording|policy_wording"),
    ("Table of Benefits", r"\btob\b|table of benefit"),
    ("LOG / pre-authorization form", r"letter of guarantee|guarantee letter|pre.?authori[sz]ation|pre.?auth\b"),
    ("Claim form", r"claim.?notification|e.?claim|claim.?submission|claim.?form"),
    ("Invoice / bill", r"invoice|receipt|voucher|\bbill\b|charges"),
    ("Medical report", r"discharge|endoscopy|diagnos|prescription|consultation|medical report"),
    ("ID copy", r"\bnrc\b|passport|national registration|identity card"),
    ("Provider CSR", r"\bcsr\b|provider confirmation"),
]


def classify_name(name: str, text: str = "") -> str:
    """Cheap first-pass from the file name, then the document's own text. Scanned/opaque files
    land in 'Other' here and get their real type from the vision model instead.
    In the text, the type named FIRST wins (a document's title comes first) — so an invoice that
    later says "payment by letter of guarantee" stays an invoice, not a LOG form."""
    n = name.lower()
    if re.search(r"\blog\b|letter.?of.?guarantee|guarantee.?letter|pre.?auth", n.replace("_", " ").replace("-", " ")):
        return "LOG / pre-authorization form"
    for dtype, pat in _TYPE_PATTERNS:
        if re.search(pat, n):
            return dtype
    t = text[:1500].lower()
    best = None
    for dtype, pat in _TYPE_PATTERNS:
        m = re.search(pat, t)
        if m and (best is None or m.start() < best[0]):
            best = (m.start(), dtype)
    return best[1] if best else "Other"

# canonical doc types the vision model may return, mapped to our checklist names
CANON = {
    "claim form": "Claim form", "invoice": "Invoice / bill", "invoice / bill": "Invoice / bill",
    "bill": "Invoice / bill", "receipt": "Invoice / bill", "medical report": "Medical report",
    "medical": "Medical report", "id": "ID copy", "id copy": "ID copy",
    "log": "LOG / pre-authorization form", "log / pre-authorization form": "LOG / pre-authorization form",
    "policy wording": "Policy wording", "table of benefits": "Table of Benefits",
    "provider csr": "Provider CSR", "csr": "Provider CSR", "other": "Other",
}
def canon_type(t: str) -> str:
    return CANON.get((t or "").strip().lower(), "Other")

def norm_claim_type(v) -> str:
    """The AI's claim_type -> one of reimbursement / LOG / API-eclaim ('' if unusable)."""
    t = re.sub(r"[^a-z]", "", str(v or "").lower())
    if t in ("log", "letterofguarantee", "preauthorization", "preauthorisation"):
        return "LOG"
    if "eclaim" in t:
        return "API-eclaim"
    if t.startswith("reimburs"):
        return "reimbursement"
    return ""


def detect_claim_type(docs: list[ClassifiedDoc]) -> str:
    types = {d.doc_type for d in docs}
    if "LOG / pre-authorization form" in types: return "LOG"
    return "reimbursement"

def pdf_text_and_pages(data: bytes) -> tuple[str, int]:
    try:
        from pypdf import PdfReader
        import io
        r = PdfReader(io.BytesIO(data))
        txt = "".join((p.extract_text() or "") for p in r.pages[:8])
        return txt, len(r.pages)
    except Exception:
        return "", 0

def pdf_text_by_page(data: bytes, max_pages: int = 40) -> list[str]:
    """Extracted text per page (for fast, page-aware analysis of digital PDFs)."""
    try:
        from pypdf import PdfReader
        import io
        r = PdfReader(io.BytesIO(data))
        return [(p.extract_text() or "") for p in r.pages[:max_pages]]
    except Exception:
        return []


def pdf_page_images(data: bytes, start: int = 1, count: int = 0, dpi: int = 120, cap: int = 12,
                    quality: int = 72) -> list[tuple[int, bytes]]:
    """Rasterize PDF pages to JPEG so scanned/image-only PDFs can go to a vision model.
    start is 1-based; count 0 = to the end. Never renders more than `cap` pages per call.
    dpi/quality are kept modest for speed — 120 DPI still reads Burmese handwriting well and
    the JPEG payload is much smaller (faster upload + faster model). Returns [(page_no, bytes)]."""
    try:
        import pymupdf
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        return []
    n = doc.page_count
    a0 = max(start - 1, 0)
    hi = n if count <= 0 else min(a0 + count, n)
    hi = min(hi, a0 + cap)
    out: list[tuple[int, bytes]] = []
    for i in range(a0, hi):
        try:
            pix = doc.load_page(i).get_pixmap(dpi=dpi)
            out.append((i + 1, pix.tobytes("jpeg", jpg_quality=quality)))
        except Exception:
            continue
    return out

def pdf_page_plan(data: bytes, start: int = 1, count: int = 0) -> tuple[int, list[dict]]:
    """Look at each page in the range and decide how the AI should get it.
    Returns (total_pages, [{"page", "text", "visual"}]). "visual" = the page is a
    photo/scan (it contains a picture, or has almost no real text) and must be sent
    as an IMAGE — sending only its (empty) text would make the AI skip it.
    Many claim packets are MIXED: a digital e-claim form followed by phone photos
    of medical records and bills."""
    try:
        import pymupdf
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        texts = pdf_text_by_page(data, max_pages=500)
        a0 = max(start - 1, 0)
        hi = len(texts) if count <= 0 else min(a0 + count, len(texts))
        return len(texts), [{"page": i + 1, "text": texts[i], "visual": len(texts[i].strip()) < 40} for i in range(a0, hi)]
    n = doc.page_count
    a0 = max(start - 1, 0)
    hi = n if count <= 0 else min(a0 + count, n)
    out = []
    for i in range(a0, hi):
        try:
            p = doc.load_page(i)
            text = p.get_text() or ""
            has_picture = bool(p.get_images(full=False))
        except Exception:
            text, has_picture = "", True
        out.append({"page": i + 1, "text": text, "visual": has_picture or len(text.strip()) < 40})
    return n, out


def pdf_render_pages(data: bytes, pages: list[int], dpi: int = 160, quality: int = 78) -> dict[int, bytes]:
    """Render specific pages (1-based) to JPEG. 160 DPI keeps small printed bill
    figures legible; the extra cost vs 120 DPI is a fraction of a cent per page."""
    out: dict[int, bytes] = {}
    if not pages:
        return out
    try:
        import pymupdf
        doc = pymupdf.open(stream=data, filetype="pdf")
    except Exception:
        return out
    for pno in pages:
        try:
            pix = doc.load_page(pno - 1).get_pixmap(dpi=dpi)
            out[pno] = pix.tobytes("jpeg", jpg_quality=quality)
        except Exception:
            continue
    return out


def is_pdf(name: str, mime: str) -> bool:
    return mime == "application/pdf" or name.lower().endswith(".pdf")

def is_image(name: str, mime: str) -> bool:
    return (mime or "").startswith("image/") or name.lower().endswith((".jpg", ".jpeg", ".png"))

# ---- prompt --------------------------------------------------------------------
# Always added to the JD1 instructions (also to a custom prompt from the AI Prompts page).
_NAME_RULE = ("\n\nHANDWRITING: names, NRC numbers, dates of birth and policy numbers often appear on several pages. "
              "When a handwritten copy is hard to read or differs slightly from a clear printed/typed copy elsewhere, use "
              "the clear printed version in the note, and add a consistency check (status \"warning\") that lists "
              "each variant with its page, e.g. 'Patient name: \"Aung Aung\" (printed, claim form p.1) vs \"Aung Aye\" "
              "(handwritten, unclear, bill p.35) — likely the same person, handwriting'. If the names look like "
              "DIFFERENT people, use status \"fail\" and say so.")

# Always added too: how to decide the claim type (the JSON shape alone did not say).
_TYPE_RULE = ("\n\nCLAIM TYPE: use \"LOG\" ONLY when the packet contains an actual Letter of Guarantee / "
              "pre-authorization form (a request to the insurer, or the insurer's approval, to guarantee payment to a "
              "hospital for a planned or ongoing treatment). Invoices, receipts, medical reports and claim forms alone are "
              "NOT a LOG — even when an invoice mentions \"LOG\", a guarantee letter, direct billing or cashless payment. "
              "Use \"API-eclaim\" only for an insurer's electronic e-claim submission. Everything else, and whenever you are "
              "unsure, is \"reimbursement\". List \"LOG / pre-authorization form\" in doc_types_present only if such a "
              "form is really in the packet.")

_JD1_PROMPT = """You are a JD1 claims-intake officer at Ulink Assist (a health-insurance TPA in Myanmar).
You are given the documents of ONE claim (some digital text, some scanned images that may be in Burmese or handwritten).
Produce a JD1 Process Note as STRICT JSON with this exact shape (every leaf is {"value","confidence","remark"}; confidence is 0..1):

{
 "claim_type": "reimbursement|LOG|API-eclaim",
 "header": {"member_name":{...},"insurer":{...},"claim_date":{...},"company":{...},
            "nrc_passport":{...},"total_claim_amount":{...},"treatment_date":{...},"claim_no":{...},
            "ias_note":"a specific instruction naming the ACTUAL values found in these documents to check against iAS — e.g. 'Confirm in iAS: member NAW MYAT MYAT THU, NRC 12/MaHaTha(N)123456, policy effective 01/01/2025, remaining outpatient benefit balance vs this claim of 255,300 MMK'. Always use the real name/NRC/dates/amount you read, never a generic checklist with no specifics"},
 "section_a": {"document_complete":{...},"document_readable":{...},"missing_document":{...},
               "duplicate_document":{...},"incorrect_inconsistent":{...}},
 "section_b": {"policy_member_eligibility":{...},"diagnosis":{...},"treatment_procedure":{...},
               "admission_discharge_dates":{...},"hospital_provider":{...},"claim_amount":{...},
               "prescription_medical_report":{...},"invoice_receipt":{...}},
 "section_c": {"covered_status":{...},"exclusion_identified":{...},"waiting_period_issue":{...},
               "policy_limit_issue":{...},"pre_existing_indicator":{...},"duplicate_claim_indicator":{...},
               "fraud_indicator":{...},"need_investigation":{...}},
 "doc_types_present": ["Claim form","Invoice / bill","Medical report","ID copy","LOG / pre-authorization form","Policy wording","Table of Benefits","Provider CSR"],
 "document_count": <integer>,
 "invoices": [{"description":"what this invoice/bill/receipt is for (e.g. in-patient bill, pharmacy, endoscopy, consultation)","provider":"hospital/clinic name if visible","date":"DD/MM/YY as written","amount":"<the invoice total as written, digits only e.g. 255300 — leave \"\" if you cannot read it clearly>","confidence":0.0,"page":<page number, 1-based>}],
 "supporting_documents": [{"name":"<source file name if known>","type":"Invoice|Medical report|Prescription|Lab report|Discharge summary|ID|Other","summary":"2-3 sentence plain-English summary with the actual specifics — provider/hospital name, exact date(s), diagnosis or procedure, and the amount if it is a bill. Never just restate the document type (e.g. not 'a medical report' but what the report actually says)","provider":"hospital/clinic/lab if present","date":"DD/MM/YY","amount":"<total if it is a bill, digits only, else \"\">","diagnosis":"diagnosis/findings if a medical doc, else \"\"","person_name":"name on an ID or patient name on a report, else \"\"","flags":["any issue an officer should look at, e.g. unsigned, illegible, date mismatch"],"confidence":0.0,"page":<page number>}],
 "consistency_checks": [{"label":"short name of the check","status":"ok|warning|fail|unclear","detail":"one to two sentences citing the exact figures/dates/names you compared, e.g. 'Claim form total 255,300 MMK vs invoices summing to 255,300 MMK — match' rather than a vague 'amounts match'"}],
 "notes": "a detailed free-text synopsis (4-6 sentences) covering: what happened and why the member is claiming, the specific diagnosis and treatment, the exact claimed amount and whether invoices reconcile against it, and any concrete red flags or missing items the officer must resolve — use the real names, dates, amounts and diagnoses from the documents, never generic filler phrasing"
}

For "supporting_documents": list every NON-FORM document in the packet — medical reports, prescriptions, lab/endoscopy results, discharge summaries, invoices/bills, ID copies. Do NOT include the insurer's own claim/LOG form here. Give a genuinely useful 2-3 sentence summary of each, with real specifics (names, dates, amounts, diagnosis) so an officer does not have to open it.
For "consistency_checks": cross-check the whole packet and report findings, e.g.: does the diagnosis on the medical report match the claim form; are all treatment/visit dates consistent; do the invoices add up to the claimed amount; are there duplicate invoices (same provider, date and amount); does the ID name match the claimant. Use status "fail" for a clear mismatch, "warning" for something to verify, "ok" when it checks out, "unclear" when the documents don't allow a conclusion.

For "doc_types_present": list every document TYPE you can actually see anywhere in the packet (including inside scanned images — e.g. a hospital invoice or endoscopy report is a "Medical report" or "Invoice / bill" even if the filename is meaningless). Use only the exact labels shown above.
For "document_count": the total number of DISTINCT documents you can identify across the whole packet. A single uploaded/scanned file can contain several distinct documents (e.g. one PDF holding a claim form + an invoice + a medical report counts as 3). Count every distinct document, not the number of files.
For "invoices": list EVERY distinct invoice, bill or receipt in the packet (one entry each). "description" = what it is for. "amount" = that invoice's own total, digits only (strip commas/currency). If an invoice's amount is not clearly readable, set amount to "" and confidence 0 — NEVER guess an amount. Do not include the claim form's grand total as an invoice; only real invoices/bills/receipts.

RULES:
- For section A/C Yes/No fields, "value" is "YES", "NO", or "Unclear"; put reasoning in "remark".
- If information is NOT present in the documents, set value "" and confidence 0 (never invent a number).
- Coverage (section_c) usually needs the policy wording / Table of Benefits and the iAS benefit balance. If those are not provided or not conclusive, set covered_status value "Unclear" and say it must be decided at JD2/JD3. Do the same for exclusions/waiting-period/pre-existing when unclear.
- Amounts: keep the number and add " MMK".
- Be concrete everywhere: every "remark", "ias_note", "notes", consistency-check "detail", and supporting-document "summary" must cite the actual names, dates, amounts, diagnoses, or document contents you found. Never write a generic, evidence-free statement like "looks consistent", "need to verify", or "document present" — say WHAT is consistent, what needs verifying and why, or what the document specifically shows.
- Prefer specific, complete detail over brevity throughout: fuller correct detail is always better than a short vague answer, as long as everything you write is actually grounded in the documents (never pad with invented specifics).
- Respond with ONLY the JSON, no prose, no markdown fences."""

def _nf(d) -> NoteField:
    if not isinstance(d, dict):
        return NoteField(value=str(d) if d else "", confidence=0.0)
    val = str(d.get("value", "")).strip()
    conf = 0.0 if val == "" else float(d.get("confidence", 0.5) or 0.0)
    return NoteField(value=val, confidence=conf, remark=str(d.get("remark", "")).strip())

def _section(cls, d: dict):
    d = d or {}
    return cls(**{k: _nf(d.get(k)) for k in cls.model_fields})

# ---- invoices: parse amounts, reconcile against the claim total, summarise ------
def _amount_to_int(s: str) -> int | None:
    """Pull an integer amount out of a string like '255,300 MMK' -> 255300.
    Returns None when there is no usable number (so we never treat blank as 0)."""
    if not s:
        return None
    digits = re.sub(r"[^\d]", "", str(s))
    if not digits:
        return None
    try:
        return int(digits)
    except ValueError:
        return None

def _fmt_mmk(n: int) -> str:
    return f"{n:,} MMK"

def _build_invoices(raw: list, claim_total_str: str, files: list) -> InvoiceSummary:
    """Turn the model's invoice list into InvoiceItems, then reconcile the sum of the
    readable amounts against the claim form's total. Unreadable amounts are flagged,
    not guessed (per the confidence-0 rule)."""
    names = [n for (n, _d, _m) in files]
    items: list[InvoiceItem] = []
    for it in (raw or []):
        if not isinstance(it, dict):
            continue
        amt = str(it.get("amount", "")).strip()
        amt_int = _amount_to_int(amt)
        readable = amt_int is not None
        amt_fmt = _fmt_mmk(amt_int) if readable else ""
        try:
            page = int(it.get("page") or 0)
        except (TypeError, ValueError):
            page = 0
        items.append(InvoiceItem(
            id=uuid.uuid4().hex[:8],
            description=str(it.get("description", "")).strip(),
            provider=str(it.get("provider", "")).strip(),
            date=str(it.get("date", "")).strip(),
            amount=amt_fmt,
            amount_original=amt_fmt,
            readable=readable,
            confidence=0.0 if not readable else float(it.get("confidence", 0.0) or 0.0),
            page=page,
            source_file=names[0] if len(names) == 1 else "",
        ))
    return _reconcile(items, claim_total_str)

def _reconcile(items: list[InvoiceItem], claim_total_str: str) -> InvoiceSummary:
    """(Re)compute totals and the reconciliation verdict from the current invoice
    amounts — safe to call again after JD1 edits an amount."""
    readable = [i for i in items if _amount_to_int(i.amount) is not None]
    unreadable = len(items) - len(readable)
    inv_sum = sum(_amount_to_int(i.amount) or 0 for i in readable)
    claim_int = _amount_to_int(claim_total_str)

    reconciled = False
    difference = ""
    if unreadable > 0:
        note = f"{unreadable} of {len(items)} invoice amount(s) not readable — verify manually before trusting the total."
    elif claim_int is None:
        note = "No claim-form total to reconcile against — enter the claim total to check."
    else:
        diff = inv_sum - claim_int
        reconciled = (diff == 0)
        if reconciled:
            note = "Invoices sum exactly to the claim total."
        else:
            difference = _fmt_mmk(abs(diff))
            note = (f"Invoices exceed the claim total by {difference}." if diff > 0
                    else f"Invoices fall short of the claim total by {difference}.")

    return InvoiceSummary(
        items=items,
        count=len(items),
        invoices_total=_fmt_mmk(inv_sum) if items else "",
        claim_total=_fmt_mmk(claim_int) if claim_int is not None else (claim_total_str or ""),
        reconciled=reconciled,
        difference=difference,
        unreadable_count=unreadable,
        note=note,
    )

# ---- adjudicator-facing summary (composed deterministically for trust) ----------
def _flag_hits(section_c: JD1SectionC) -> list[str]:
    labels = {
        "exclusion_identified": "possible exclusion",
        "waiting_period_issue": "waiting-period concern",
        "policy_limit_issue": "policy-limit concern",
        "pre_existing_indicator": "pre-existing indicator",
        "duplicate_claim_indicator": "possible duplicate claim",
        "fraud_indicator": "fraud/suspicion flag",
        "need_investigation": "needs further investigation",
    }
    hits = []
    for k, label in labels.items():
        f = getattr(section_c, k, None)
        if f and str(f.value).strip().upper() in ("YES", "Y", "TRUE"):
            hits.append(label)
    return hits

def _compose_summary(note: JD1Note) -> str:
    h = note.header
    parts: list[str] = []

    who = h.member_name.value or "Member"
    ins = h.insurer.value or "insurer"
    overview = f"{who} · {ins}"
    if h.claim_no.value:
        overview += f" · claim {h.claim_no.value}"
    diag = note.section_b.diagnosis.value
    if diag:
        overview += f" · {diag}"
    hosp = note.section_b.hospital_provider.value
    if hosp:
        overview += f" at {hosp}"
    dates = note.section_b.admission_discharge_dates.value or h.treatment_date.value
    if dates:
        overview += f" ({dates})"
    total = h.total_claim_amount.value or note.section_b.claim_amount.value
    if total:
        overview += f" · claimed {total}"
    parts.append("Overview: " + overview)

    # completeness
    if note.checklist_missing:
        parts.append("Completeness: MISSING — " + ", ".join(note.checklist_missing) + ".")
    else:
        parts.append("Completeness: all required documents present.")

    # invoices + reconciliation
    inv = note.invoices
    if inv and inv.count:
        desc = "; ".join(
            f"{i.description or 'invoice'}"
            + (f" {i.amount}" if i.amount else " (amount not readable)")
            for i in inv.items
        )
        parts.append(f"Invoices ({inv.count}): {desc}.")
        parts.append("Reconciliation: " + inv.note)
    else:
        parts.append("Invoices: none detected in the packet.")

    # confidence flags — fields present but read with low confidence
    low = []
    for sec, lbls in (
        (note.header, {"member_name": "member name", "nrc_passport": "NRC/passport",
                       "total_claim_amount": "total amount"}),
        (note.section_b, {"diagnosis": "diagnosis", "claim_amount": "claim amount",
                          "hospital_provider": "hospital"}),
    ):
        for k, lbl in lbls.items():
            f = getattr(sec, k, None)
            if f and str(f.value).strip() and float(getattr(f, "confidence", 0) or 0) < 0.6:
                low.append(lbl)
    if low:
        parts.append("Low-confidence (verify): " + ", ".join(low) + ".")

    # preliminary flags
    hits = _flag_hits(note.section_c)
    cov = note.section_c.covered_status.value or "Unclear"
    if hits:
        parts.append("Preliminary flags: " + ", ".join(hits) + f" — coverage {cov} (JD2/JD3 decide).")
    else:
        parts.append(f"Preliminary flags: none raised — coverage {cov} (JD2/JD3 decide).")

    # supporting-document consistency
    if note.supporting and note.supporting.checks:
        fails = [c.label for c in note.supporting.checks if c.status == "fail"]
        warns = [c.label for c in note.supporting.checks if c.status == "warning"]
        if fails:
            parts.append("Consistency: FAILED — " + ", ".join(fails) + ".")
        elif warns:
            parts.append("Consistency: verify — " + ", ".join(warns) + ".")
        else:
            parts.append("Consistency: all checks passed.")

    # recommended action
    if note.checklist_missing:
        parts.append("Recommended action: return to client for the missing documents before adjudication.")
    elif inv and inv.count and not inv.reconciled and inv.unreadable_count == 0 and inv.difference:
        parts.append("Recommended action: resolve the invoice/claim-total mismatch, then proceed to JD2.")
    else:
        parts.append("Recommended action: proceed to JD2 for the coverage decision.")

    return "\n".join(parts)

# ---- main entry ----------------------------------------------------------------
# JSON keys in the order the prompt asks the AI to write them -> (label, progress %)
_SECTIONS = [
    ("header", "claimant & claim details", 30), ("section_a", "A. Document checking", 40),
    ("section_b", "B. Claim information", 50), ("section_c", "C. Rule / coverage checking", 60),
    ("doc_types_present", "document checklist", 66), ("invoices", "invoices & bills", 72),
    ("supporting_documents", "supporting documents", 80), ("consistency_checks", "consistency checks", 86),
    ("notes", "summary notes", 90),
]


def _section_listener():
    """Watches the AI's reply as it streams and reports each section it starts writing."""
    seen: set[str] = set()
    last_chars = [0.0]
    import time as _t

    def on_text(so_far: str):
        for key, label, pct in _SECTIONS:
            if key not in seen and f'"{key}"' in so_far:
                seen.add(key)
                progress.emit(f"AI is writing: {label}", pct=pct)
        now = _t.time()
        if now - last_chars[0] >= 1.0:          # light "still writing" pulse for the UI
            last_chars[0] = now
            progress.emit("", kind="stream", chars=len(so_far))
    return on_text


def _mb(n: int) -> str:
    return f"{n / 1_048_576:.1f} MB" if n >= 1_048_576 else f"{max(1, n // 1024)} KB"


def _corrections_part(corrections: str) -> dict | None:
    """JD1's own corrections from a previous read (required fields / full detection / note
    fields the officer fixed). Sent as an extra block so a re-generated note uses them."""
    lines = [ln.strip() for ln in (corrections or "").splitlines() if ln.strip()][:200]
    if not lines:
        return None
    return {"text": "OFFICER-VERIFIED VALUES — the JD1 officer checked the documents and corrected these values "
                    "(often messy handwriting). Use them exactly in the note; they override what the scan seems to show. "
                    "Do not mention that they were corrected.\n" + "\n".join(lines)[:8000]}


def read_packet(files: list[tuple[str, bytes, str]], corrections: str = "") -> JD1Note:
    """files: list of (filename, data, mime). corrections: optional officer-verified values."""
    progress.emit(f"Received {len(files)} file(s), {_mb(sum(len(d) for _n, d, _m in files))} in total", pct=2)
    docs: list[ClassifiedDoc] = []
    parts: list[dict] = [{"text": prompts.get("jd1_note") + _NAME_RULE + _TYPE_RULE}]
    _fix = _corrections_part(corrections)
    if _fix:
        parts.append(_fix)
        progress.emit(f"Using {len(_fix['text'].splitlines()) - 1} value(s) you corrected", pct=3)
    reference_only = {"Policy wording", "Table of Benefits"}

    for name, data, mime in files:
        text, pages = ("", None)
        n_visual = 0
        if is_pdf(name, mime):
            text, pages = pdf_text_and_pages(data)
            try:
                total, plan = pdf_page_plan(data)
                pages = total or pages
                n_visual = sum(1 for p in plan if p["visual"])
                full_text = "\n\n".join(f"[PAGE {p['page']}]\n{p['text']}" for p in plan if p["text"].strip())
                if full_text.strip():
                    text = full_text
            except Exception:
                pass
            # digital text only when NO page is a photo/scan — otherwise the AI must see the pages
            native = len(text.strip()) > 200 and n_visual == 0
            dtype = classify_name(name, text)
            method = "native" if native else "vision"
        elif is_image(name, mime):
            dtype = classify_name(name); method = "vision"
        else:
            dtype = classify_name(name); method = "native" if text else "vision"

        docs.append(ClassifiedDoc(name=name, doc_type=dtype, read_method=method, pages=pages, confidence=0.9))
        how = ("digital text — sending the text" if method == "native"
               else (f"{(pages or 0) - n_visual} page(s) with text + {n_visual} photo/scanned page(s) — the AI will read every page"
                     if n_visual and pages and n_visual < pages else "scanned / image — the AI will read the pages visually"))
        progress.emit(f"Read {name}: {'PDF, ' + str(pages) + ' page(s)' if pages else _mb(len(data))} · looks like {dtype} · {how}",
                      pct=min(12, 3 + 9 * len(docs) / max(1, len(files))))

        # what we feed the model
        header = f"[DOCUMENT: {name} | type: {dtype}]"
        if method == "native" and text.strip():
            body = text[:20000] if dtype not in reference_only else text[:2500]
            parts.append({"text": f"{header}\n{body}"})
        else:
            # scanned/image -> send bytes for vision OCR (cap size for the POC)
            if len(data) <= 18_000_000:
                parts.append({"text": header})
                parts.append({"inline_data": {"mime_type": mime or "image/jpeg",
                                              "data": base64.b64encode(data).decode()}})
            else:
                parts.append({"text": f"{header}\n(scanned file too large to include in POC — flagged for manual read)"})

    claim_type_hint = detect_claim_type(docs)
    missing = _missing_docs(docs, claim_type_hint)
    files_count = len(files)

    if not ai_provider.any_available():
        note = _stub_note(claim_type_hint)
        note.documents = docs; note.checklist_missing = missing; note.provider = "stub"
        note.checklist_required = list(MANDATORY.get(claim_type_hint, MANDATORY["reimbursement"]))
        note.files_count = files_count; note.document_count = len(docs)
        return note

    n_img = sum(1 for p in parts if isinstance(p, dict) and p.get("inline_data"))
    sent = sum(len(p["inline_data"]["data"]) * 3 // 4 for p in parts if isinstance(p, dict) and p.get("inline_data"))
    progress.emit(f"Sending {len(docs)} document(s) to the AI"
                  + (f" ({n_img} scanned file(s), {_mb(sent)})" if n_img else " (text only)"), pct=15)
    # one call through the shared AI provider layer (streams when live progress is on)
    progress.set_text_listener(_section_listener())
    try:
        txt = ai_provider.generate_text(parts)
    finally:
        progress.set_text_listener(None)
    if not txt or not txt.strip():
        return JD1Note(claim_type=claim_type_hint, documents=docs, checklist_required=list(MANDATORY.get(claim_type_hint, MANDATORY["reimbursement"])),
                       checklist_missing=missing,
                       files_count=files_count, document_count=len(docs),
                       provider="ai", notes="The AI service is busy right now. Please try Generate again in a moment.")

    progress.emit("Checking the AI's answer and building the JD1 note", pct=92)
    m = re.search(r"\{.*\}", txt, re.S)
    try:
        d = json.loads(m.group(0) if m else txt)
    except Exception:
        progress.emit("The AI's answer could not be read — please try again", kind="warn")
        return JD1Note(claim_type=claim_type_hint, documents=docs, checklist_required=list(MANDATORY.get(claim_type_hint, MANDATORY["reimbursement"])),
                       checklist_missing=missing,
                       files_count=files_count, document_count=len(docs),
                       provider="ai", notes="Could not read the document clearly. Please try Generate again.")

    # checklist from what the vision model actually SAW (content), unioned with digital classification
    present = {canon_type(t) for t in d.get("doc_types_present", []) if isinstance(t, str)}
    present |= {dd.doc_type for dd in docs if dd.doc_type != "Other"}
    ctype = norm_claim_type(d.get("claim_type")) or claim_type_hint
    if ctype == "LOG" and "LOG / pre-authorization form" not in present:
        # a LOG claim needs a LOG / pre-authorization form — without one it is a normal claim
        progress.emit("Claim type: no LOG / pre-authorization form found — treated as a reimbursement claim", kind="step")
        ctype = "reimbursement"
        checks = d.get("consistency_checks") if isinstance(d.get("consistency_checks"), list) else []
        checks.append({"label": "Claim type", "status": "warning",
                       "detail": "The AI suggested a LOG claim, but no LOG / pre-authorization form was found in the "
                                 "documents, so it is treated as a reimbursement claim. Switch the form type if this is wrong."})
        d["consistency_checks"] = checks
    req = MANDATORY.get(ctype, MANDATORY["reimbursement"])
    missing2 = [t for t in req if t not in present]

    try:
        doc_count = int(d.get("document_count") or 0)
    except (TypeError, ValueError):
        doc_count = 0
    if doc_count <= 0:
        doc_count = max(len(present), len(docs))

    note = JD1Note(
        claim_type=ctype,
        header=_header(d.get("header", {})),
        section_a=_section(JD1SectionA, d.get("section_a", {})),
        section_b=_section(JD1SectionB, d.get("section_b", {})),
        section_c=_section(JD1SectionC, d.get("section_c", {})),
        documents=docs,
        checklist_required=list(req),
        checklist_missing=missing2,
        files_count=files_count,
        document_count=doc_count,
        provider="ai",
        notes=str(d.get("notes", "")),
    )
    progress.emit("Checklist: " + ("all required documents present" if not missing2
                                     else "missing " + ", ".join(missing2)), pct=94)
    claim_total = note.header.total_claim_amount.value or note.section_b.claim_amount.value
    note.invoices = _build_invoices(d.get("invoices"), claim_total, files)
    progress.emit(f"Invoices: {len(note.invoices.items) if note.invoices else 0} found — "
                  + (note.invoices.note if note.invoices and note.invoices.note else "reconciled"), pct=96)
    note.supporting = _build_supporting(d.get("supporting_documents"), d.get("consistency_checks"), note)
    note.ai_summary = _compose_summary(note)
    progress.emit("JD1 note ready", pct=100)
    return note

def _header(d: dict) -> JD1Header:
    d = d or {}
    h = JD1Header(**{k: _nf(d.get(k)) for k in JD1Header.model_fields if k != "ias_note"})
    ias = d.get("ias_note", "")
    if isinstance(ias, dict):        # model sometimes returns an object — keep only the text
        ias = ias.get("value", "") or ias.get("remark", "") or ""
    h.ias_note = str(ias)
    return h

def _missing_docs(docs: list[ClassifiedDoc], claim_type: str) -> list[str]:
    present = {d.doc_type for d in docs}
    req = MANDATORY.get(claim_type, MANDATORY["reimbursement"])
    return [t for t in req if t not in present]

def _build_supporting(raw_docs, raw_checks, note: JD1Note) -> SupportingAnalysis:
    """Turn the model's supporting-doc analysis into structured cards + consistency
    checks, and prepend the deterministic invoice reconciliation as the authoritative
    numbers check."""
    docs: list[SupportingDoc] = []
    for it in (raw_docs or []):
        if not isinstance(it, dict):
            continue
        try:
            page = int(it.get("page") or 0)
        except (TypeError, ValueError):
            page = 0
        docs.append(SupportingDoc(
            name=str(it.get("name", "")).strip(),
            doc_type=str(it.get("type", "Other")).strip() or "Other",
            summary=str(it.get("summary", "")).strip(),
            provider=str(it.get("provider", "")).strip(),
            date=str(it.get("date", "")).strip(),
            amount=str(it.get("amount", "")).strip(),
            diagnosis=str(it.get("diagnosis", "")).strip(),
            person_name=str(it.get("person_name", "")).strip(),
            flags=[str(x).strip() for x in (it.get("flags") or []) if str(x).strip()],
            confidence=float(it.get("confidence", 0) or 0),
            page=page,
        ))

    checks: list[ConsistencyCheck] = []
    for c in (raw_checks or []):
        if not isinstance(c, dict):
            continue
        status = str(c.get("status", "unclear")).strip().lower()
        if status not in ("ok", "warning", "fail", "unclear"):
            status = "unclear"
        checks.append(ConsistencyCheck(label=str(c.get("label", "")).strip() or "Check",
                                       status=status, detail=str(c.get("detail", "")).strip()))

    # authoritative invoice reconciliation (computed, not model-guessed)
    inv = note.invoices
    if inv and inv.count:
        st = "ok" if inv.reconciled else ("warning" if inv.unreadable_count > 0 else "fail")
        checks.insert(0, ConsistencyCheck(label="Invoice totals vs claim", status=st, detail=inv.note))

    n_docs = len(docs)
    fails = sum(1 for c in checks if c.status == "fail")
    warns = sum(1 for c in checks if c.status == "warning")
    if fails:
        overall = f"{n_docs} supporting document(s); {fails} consistency issue(s) need attention."
    elif warns:
        overall = f"{n_docs} supporting document(s); {warns} item(s) to verify."
    else:
        overall = f"{n_docs} supporting document(s); no consistency issues detected."
    return SupportingAnalysis(documents=docs, checks=checks, summary=overall)


def draft_client_mail(note: JD1Note, sender: str = "") -> tuple[str, str, str]:
    """Compose (subject, body, reason) for a client email requesting missing
    documents / clarification. Uses Gemini for tone when available, otherwise a
    clean deterministic template. Never sends — the officer sends it themselves."""
    member = note.header.member_name.value or "Policyholder"
    claim_no = note.header.claim_no.value
    insurer = note.header.insurer.value

    asks: list[str] = []
    for m in note.checklist_missing:
        asks.append(f"{m}")
    inv = note.invoices
    if inv:
        if inv.unreadable_count > 0:
            asks.append("A clearer copy of the invoice(s) — some amounts are not legible")
        elif inv.count and not inv.reconciled and inv.difference:
            asks.append(f"Clarification on the invoice totals (they differ from the claimed amount by {inv.difference})")
    # any readable-but-unclear section A remarks
    if str(note.section_a.incorrect_inconsistent.value).strip().upper() in ("YES", "Y"):
        asks.append("Confirmation of the inconsistent details noted on the claim form")

    reason = "; ".join(asks) if asks else "No missing items detected — this is a general acknowledgement."

    claim_ref = f" (claim {claim_no})" if claim_no else ""
    subject = f"Additional documents needed for your claim{claim_ref}" if asks else \
              f"Update on your claim{claim_ref}"

    if not asks:
        asks = ["(No outstanding items — edit this note before sending.)"]

    # deterministic template (fallback + baseline)
    bullet = "\n".join(f"  - {a}" for a in asks)
    signoff = f"\n\nKind regards,\n{sender or 'Ulink Assist Claims Team'}\nUlink Assist"
    body = (
        f"Dear {member},\n\n"
        f"Thank you for submitting your claim{claim_ref}"
        + (f" under {insurer}" if insurer else "") + ".\n\n"
        "To continue processing, we kindly ask you to provide the following:\n\n"
        f"{bullet}\n\n"
        "Once we receive these, we will proceed with your claim without further delay. "
        "Please reply to this email with the documents attached, or contact us if you have any questions."
        f"{signoff}"
    )

    if not ai_provider.any_available():
        return subject, body, reason

    prompt = (
        "You are a claims officer at Ulink Assist, a health-insurance TPA in Myanmar. "
        "Write a short, warm, professional email to a policyholder asking for the items listed below. "
        "Be clear and courteous, keep it under 150 words, do not invent policy details, and end with a sign-off "
        f"from {sender or 'the Ulink Assist Claims Team'}. "
        f"Policyholder: {member}. Claim reference: {claim_no or 'N/A'}. Insurer: {insurer or 'N/A'}.\n\n"
        "Items to request:\n" + "\n".join(f"- {a}" for a in asks) +
        '\n\nRespond ONLY as JSON: {"subject":"...","body":"..."}'
    )
    try:
        txt = ai_provider.generate_text([{"text": prompt}])
        if txt:
            m = re.search(r"\{.*\}", txt, re.S)
            d = json.loads(m.group(0) if m else txt)
            gsub = str(d.get("subject", "")).strip()
            gbody = str(d.get("body", "")).strip()
            if gsub and gbody:
                return gsub, gbody, reason
    except Exception:
        pass
    return subject, body, reason


def _stub_note(claim_type: str) -> JD1Note:
    n = JD1Note(claim_type=claim_type, provider="stub",
                notes="AI reading is not available right now — please contact your administrator.")
    n.header.member_name = NoteField(value="(sample) Thein Nyunt", confidence=0.9)
    n.header.insurer = NoteField(value="AYA SOMPO", confidence=0.9)
    return n
