"""JD1 packet reader: take a claim packet (multiple files), classify each document,
read digital PDFs as text and scanned docs with the vision model, and produce a
structured JD1 Process Note (Sections A/B/C).

POC: uses Gemini when OCR_PROVIDER=gemini + a key is set; otherwise returns a stub note."""
from __future__ import annotations
import base64, json, re
from app.config import settings
from app.models import (
    JD1Note, NoteField, ClassifiedDoc,
    JD1Header, JD1SectionA, JD1SectionB, JD1SectionC,
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
 "notes": "brief free-text summary"
}

For "doc_types_present": list every document TYPE you can actually see anywhere in the packet (including inside scanned images — e.g. a hospital invoice or endoscopy report is a "Medical report" or "Invoice / bill" even if the filename is meaningless). Use only the exact labels shown above.

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

    if not (settings.ocr_provider == "gemini" and settings.gemini_api_key):
        note = _stub_note(claim_type_hint)
        note.documents = docs; note.checklist_missing = missing; note.provider = "stub"
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
        note = JD1Note(claim_type=claim_type_hint, documents=docs, checklist_missing=missing,
                       provider="gemini", notes=f"Gemini HTTP {e.response.status_code}: {e.response.text[:400]}")
        return note
    except Exception as e:
        note = JD1Note(claim_type=claim_type_hint, documents=docs, checklist_missing=missing,
                       provider="gemini", notes=f"Gemini error: {e}")
        return note

    m = re.search(r"\{.*\}", txt, re.S)
    try:
        d = json.loads(m.group(0) if m else txt)
    except Exception:
        return JD1Note(claim_type=claim_type_hint, documents=docs, checklist_missing=missing,
                       provider="gemini", notes="Could not parse model JSON. Raw: " + txt[:500])

    # checklist from what the vision model actually SAW (content), unioned with digital classification
    ctype = d.get("claim_type") or claim_type_hint
    present = {canon_type(t) for t in d.get("doc_types_present", []) if isinstance(t, str)}
    present |= {dd.doc_type for dd in docs if dd.doc_type != "Other"}
    req = MANDATORY.get(ctype, MANDATORY["reimbursement"])
    missing2 = [t for t in req if t not in present]

    note = JD1Note(
        claim_type=ctype,
        header=_header(d.get("header", {})),
        section_a=_section(JD1SectionA, d.get("section_a", {})),
        section_b=_section(JD1SectionB, d.get("section_b", {})),
        section_c=_section(JD1SectionC, d.get("section_c", {})),
        documents=docs,
        checklist_missing=missing2,
        provider="gemini",
        notes=str(d.get("notes", "")),
    )
    return note

def _header(d: dict) -> JD1Header:
    d = d or {}
    h = JD1Header(**{k: _nf(d.get(k)) for k in JD1Header.model_fields if k != "ias_note"})
    h.ias_note = str(d.get("ias_note", ""))
    return h

def _missing_docs(docs: list[ClassifiedDoc], claim_type: str) -> list[str]:
    present = {d.doc_type for d in docs}
    req = MANDATORY.get(claim_type, MANDATORY["reimbursement"])
    return [t for t in req if t not in present]

def _stub_note(claim_type: str) -> JD1Note:
    n = JD1Note(claim_type=claim_type, provider="stub",
                notes="STUB — set OCR_PROVIDER=gemini with a GEMINI_API_KEY to generate a real JD1 note.")
    n.header.member_name = NoteField(value="(sample) Thein Nyunt", confidence=0.9)
    n.header.insurer = NoteField(value="AYA SOMPO", confidence=0.9)
    return n
