"""OCR / vision-AI providers behind one interface.
POC default = stub (no key needed). Set OCR_PROVIDER=gemini + GEMINI_API_KEY for real reading.
Later: add a DocumentAiProvider the same way for production-grade OCR."""
from __future__ import annotations
import base64, json, re
from abc import ABC, abstractmethod
from app.config import settings
from app.models import ScanResult, ScanField

class OcrProvider(ABC):
    name = "base"
    @abstractmethod
    def extract(self, data: bytes, mime: str) -> ScanResult: ...

class StubProvider(OcrProvider):
    name = "stub"
    def extract(self, data: bytes, mime: str) -> ScanResult:
        return ScanResult(
            doc_type="claim_form",
            text="STUB OCR output — set OCR_PROVIDER=gemini with a GEMINI_API_KEY to read real documents.",
            fields=[
                ScanField(key="Member name", value="Thin Zar", confidence=0.9),
                ScanField(key="Policy number", value="MG-100234", confidence=0.86),
                ScanField(key="Amount", value="185,000 MMK", confidence=0.8),
            ],
            summary="Sample claim intake (stub). Documents appear complete.",
            provider=self.name,
        )

_PROMPT = (
    "You are an insurance claims intake assistant. Read this document image. "
    "Respond ONLY with JSON of the form: "
    '{"doc_type":"claim_form|invoice|medical_report|id|log|other",'
    '"text":"<full extracted text>",'
    '"fields":[{"key":"Member name","value":"...","confidence":0.0}],'
    '"summary":"<one or two sentence summary>"}. '
    "Extract member name, policy number, diagnosis, treatment date, hospital and amount where present. "
    "confidence is 0..1. If handwriting is unclear, lower the confidence. "
    "IMPORTANT: if a field is not present in the document or its value is blank, set its confidence to exactly 0."
)

def _mk_field(f: dict) -> ScanField:
    value = str(f.get("value", "")).strip()
    conf = 0.0 if value == "" else float(f.get("confidence", 0.5))
    return ScanField(key=f.get("key", ""), value=value, confidence=conf)

class AIProvider(OcrProvider):
    name = "ai"
    def extract(self, data: bytes, mime: str) -> ScanResult:
        from app import ai_provider
        parts = [
            {"text": _PROMPT},
            {"inline_data": {"mime_type": mime or "image/png", "data": base64.b64encode(data).decode()}},
        ]
        try:
            txt = ai_provider.generate_text(parts)
        except Exception:
            txt = ""
        if not txt or not txt.strip():
            return ScanResult(doc_type="other",
                              text="The AI service is busy right now. Please try again in a moment.",
                              provider=self.name)
        m = re.search(r"\{.*\}", txt, re.S)
        raw = m.group(0) if m else txt
        try:
            d = json.loads(raw)
        except Exception:
            return ScanResult(doc_type="other", text=txt, provider=self.name)
        return ScanResult(
            doc_type=d.get("doc_type", "other"),
            text=d.get("text", ""),
            fields=[_mk_field(f) for f in d.get("fields", []) if isinstance(f, dict)],
            summary=d.get("summary", ""),
            provider=self.name,
        )

def get_provider() -> OcrProvider:
    from app import ai_provider
    if ai_provider.any_available():
        return AIProvider()
    return StubProvider()
