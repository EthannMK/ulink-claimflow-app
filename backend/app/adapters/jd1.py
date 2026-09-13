"""JD1 packet reader: take a claim packet (multiple files), classify each document,
read digital PDFs as text and scanned docs with the vision model, and produce a
structured JD1 Process Note (Sections A/B/C).

POC: uses Gemini when OCR_PROVIDER=gemini + a key is set; otherwise returns a stub note."""
from __future__ import annotations
import base64, json, re, uuid
from app.config import settings
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

def classify_name(name: str, text: str = "") -> str:
    """Cheap first-pass from filename + any digital text. Scanned/opaque files land in
    'Other' here and get their real type from the vision model instead."""
    s = (name + " " + text[:1500]).lower()
    if re.search(r"policy wording|contract wording|policy_wording", s):  return "Policy wording"
    if re.search(r"\btob\b|table of benefit", s):                        return "Table of Benefits"
    if re.search(r"letter of guarantee|pre.?auth|\blog\b", s):           return "LOG / pre-authorization form"
    if re.search(r"claim.?notification|e.?claim|claim.?submission|claim.?form", s): return "Claim form"
    if re.search(r"invoice|receipt|voucher|\bbill\b|charges", s):        return "Invoice / bill"
    if re.search(r"discharge|endoscopy|diagnos|prescription|consultation|medical report", s): return "Medical report"
    if re.search(r"nrc|passport|national registration|identity card", s): return "ID copy"
    if re.search(r"\bcsr\b|provider confirmation", s):                   return "Provider CSR"
    return "Other"

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

def is_pdf(name: str, mime: str) -> bool:
    return mime == "application/pdf" or name.lower().endswith(".pdf")

def is_image(name: str, mime: str) -> bool:
    return (mime or "").startswith("image/") or name.lower().endswith((".jpg", ".jpeg", ".png"))

# ---- prompt --------------------------------------------------------------------
_JD1_PROMPT = """You are a JD1 claims-intake officer at Ulink Assist (a health-insurance TPA in Myanmar).
You are given the documents of ONE claim (some digital text, some scanned images that may be in Burmese or handwritten).
Produce a JD1 Process Note as STRICT JSON with this exact shape (every leaf is {"value","confidence","remark"}; confidence is 0..1):

{
 "claim_type": "reimbursement|LOG|API-eclaim",
 "header": {"member_name":{...},"insurer":{...},"claim_date":{...},"company":{...},
            "nrc_passport":{...},"total_claim_amount":{...},"treatment_date":{...},"claim_no":{...},
            "ias_note":"what to verify in the iAS system (member name, NRC, DOB, policy effective/termination, benefit balance)"},
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
 "supporting_documents": [{"name":"<source file name if known>","type":"Invoice|Medical report|Prescription|Lab report|Discharge summary|ID|Other","summary":"1-2 line plain-English summary of what this document is and says","provider":"hospital/clinic/lab if present","date":"DD/MM/YY","amount":"<total if it is a bill, digits only, else \"\">","diagnosis":"diagnosis/findings if a medical doc, else \"\"","person_name":"name on an ID or patient name on a report, else \"\"","flags":["any issue an officer should look at, e.g. unsigned, illegible, date mismatch"],"confidence":0.0,"page":<page number>}],
 "consistency_checks": [{"label":"short name of the check","status":"ok|warning|fail|unclear","detail":"one line explaining the result"}],
 "notes": "brief free-text summary"
}

For "supporting_documents": list every NON-FORM document in the packet — medical reports, prescriptions, lab/endoscopy results, discharge summaries, invoices/bills, ID copies. Do NOT include the insurer's own claim/LOG form here. Give a genuinely useful 1-2 line summary of each so an officer does not have to open it.
For "consistency_checks": cross-check the whole packet and report findings, e.g.: does the diagnosis on the medical report match the claim form; are all treatment/visit dates consistent; do the invoices add up to the claimed amount; are there duplicate invoices (same provider, date and amount); does the ID name match the claimant. Use status "fail" for a clear mismatch, "warning" for something to verify, "ok" when it checks out, "unclear" when the documents don't allow a conclusion.

For "doc_types_present": list every document TYPE you can actually see anywhere in the packet (including inside scanned images — e.g. a hospital invoice or endoscopy report is a "Medical report" or "Invoice / bill" even if the filename is meaningless). Use only the exact labels shown above.
For "document_count": the total number of DISTINCT documents you can identify across the whole packet. A single uploaded/scanned file can contain several distinct documents (e.g. one PDF holding a claim form + an invoice + a medical report counts as 3). Count every distinct document, not the number of files.
For "invoices": list EVERY distinct invoice, bill or receipt in the packet (one entry each). "description" = what it is for. "amount" = that invoice's own total, digits only (strip commas/currency). If an invoice's amount is not clearly readable, set amount to "" and confidence 0 — NEVER guess an amount. Do not include the claim form's grand total as an invoice; only real invoices/bills/receipts.

RULES:
- For section A/C Yes/No fields, "value" is "YES", "NO", or "Unclear"; put reasoning in "remark".
- If information is NOT present in the documents, set value "" and confidence 0 (never invent a number).
- Coverage (section_c) usually needs the policy wording / Table of Benefits and the iAS benefit balance. If those are not provided or not conclusive, set covered_status value "Unclear" and say it must be decided at JD2/JD3. Do the same for exclusions/waiting-period/pre-existing when unclear.
- Amounts: keep the number and add " MMK".
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
def read_packet(files: list[tuple[str, bytes, str]]) -> JD1Note:
    """files: list of (filename, data, mime)."""
    docs: list[ClassifiedDoc] = []
    parts: list[dict] = [{"text": _JD1_PROMPT}]
    reference_only = {"Policy wording", "Table of Benefits"}

    for name, data, mime in files:
        text, pages = ("", None)
        if is_pdf(name, mime):
            text, pages = pdf_text_and_pages(data)
            native = len(text.strip()) > 200
            dtype = classify_name(name, text)
            method = "native" if native else "vision"
        elif is_image(name, mime):
            dtype = classify_name(name); method = "vision"
        else:
            dtype = classify_name(name); method = "native" if text else "vision"

        docs.append(ClassifiedDoc(name=name, doc_type=dtype, read_method=method, pages=pages, confidence=0.9))

        # what we feed the model
        header = f"[DOCUMENT: {name} | type: {dtype}]"
        if method == "native" and text.strip():
            body = text[:6000] if dtype not in reference_only else text[:2500]
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

    if not (settings.ocr_provider == "gemini" and settings.gemini_api_key):
        note = _stub_note(claim_type_hint)
        note.documents = docs; note.checklist_missing = missing; note.provider = "stub"
        note.checklist_required = list(MANDATORY.get(claim_type_hint, MANDATORY["reimbursement"]))
        note.files_count = files_count; note.document_count = len(docs)
        return note

    # call Gemini once with the whole packet
    import httpx
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}")
    try:
        r = httpx.post(url, json={"contents": [{"parts": parts}]}, timeout=180)
        r.raise_for_status()
        txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
    except httpx.HTTPStatusError as e:
        return JD1Note(claim_type=claim_type_hint, documents=docs, checklist_required=list(MANDATORY.get(claim_type_hint, MANDATORY["reimbursement"])),
                       checklist_missing=missing,
                       files_count=files_count, document_count=len(docs),
                       provider="gemini", notes=f"Gemini HTTP {e.response.status_code}: {e.response.text[:400]}")
    except Exception as e:
        return JD1Note(claim_type=claim_type_hint, documents=docs, checklist_required=list(MANDATORY.get(claim_type_hint, MANDATORY["reimbursement"])),
                       checklist_missing=missing,
                       files_count=files_count, document_count=len(docs),
                       provider="gemini", notes=f"Gemini error: {e}")

    m = re.search(r"\{.*\}", txt, re.S)
    try:
        d = json.loads(m.group(0) if m else txt)
    except Exception:
        return JD1Note(claim_type=claim_type_hint, documents=docs, checklist_required=list(MANDATORY.get(claim_type_hint, MANDATORY["reimbursement"])),
                       checklist_missing=missing,
                       files_count=files_count, document_count=len(docs),
                       provider="gemini", notes="Could not parse model JSON. Raw: " + txt[:500])

    # checklist from what the vision model actually SAW (content), unioned with digital classification
    ctype = d.get("claim_type") or claim_type_hint
    present = {canon_type(t) for t in d.get("doc_types_present", []) if isinstance(t, str)}
    present |= {dd.doc_type for dd in docs if dd.doc_type != "Other"}
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
        provider="gemini",
        notes=str(d.get("notes", "")),
    )
    claim_total = note.header.total_claim_amount.value or note.section_b.claim_amount.value
    note.invoices = _build_invoices(d.get("invoices"), claim_total, files)
    note.supporting = _build_supporting(d.get("supporting_documents"), d.get("consistency_checks"), note)
    note.ai_summary = _compose_summary(note)
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

    if not (settings.ocr_provider == "gemini" and settings.gemini_api_key):
        return subject, body, reason

    import httpx
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
        url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}")
        r = httpx.post(url, json={"contents": [{"parts": [{"text": prompt}]}]}, timeout=60)
        r.raise_for_status()
        txt = r.json()["candidates"][0]["content"]["parts"][0]["text"]
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
                notes="STUB — set OCR_PROVIDER=gemini with a GEMINI_API_KEY to generate a real JD1 note.")
    n.header.member_name = NoteField(value="(sample) Thein Nyunt", confidence=0.9)
    n.header.insurer = NoteField(value="AYA SOMPO", confidence=0.9)
    return n
