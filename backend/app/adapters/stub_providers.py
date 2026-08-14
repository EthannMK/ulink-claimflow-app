"""STUB OCR/AI/iAS providers so the app runs before real integrations exist."""
from .base import OcrProvider, AiProvider, IasAdapter, InboundMessage

class StubOcr(OcrProvider):
    def extract_text(self, document_url: str) -> str:
        return "STUB extracted text"

class StubAi(AiProvider):
    def categorize(self, message: InboundMessage) -> str:
        return "new_claim"
    def extract_fields(self, text: str) -> list[dict]:
        return [{"key": "Member Name", "value": "Unknown", "confidence": 0.5}]
    def summarize(self, text: str) -> str:
        return "STUB summary"

class StubIas(IasAdapter):
    def push_claim(self, claim: dict) -> str:
        return "IAS-STUB-1"
    def get_payment_status(self, claim_id: str) -> str:
        return "pending"
