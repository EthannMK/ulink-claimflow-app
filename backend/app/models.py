"""Pydantic schemas — keep in sync with ../contracts/openapi.yaml."""
from datetime import datetime
from enum import Enum
from pydantic import BaseModel

class Channel(str, Enum):
    email = "email"; facebook = "facebook"; viber = "viber"; telegram = "telegram"; webform = "webform"; phone = "phone"

class Category(str, Enum):
    new_claim = "new_claim"; log_request = "log_request"; query = "query"
    complaint = "complaint"; payment_followup = "payment_followup"; document_submission = "document_submission"

class Status(str, Enum):
    new = "new"; in_progress = "in_progress"; awaiting_docs = "awaiting_docs"
    ready_for_review = "ready_for_review"; approved = "approved"
    partially_approved = "partially_approved"; rejected = "rejected"; closed = "closed"

class Role(str, Enum):
    admin = "admin"; jd1 = "jd1"; jd2 = "jd2"; jd3 = "jd3"; jd4 = "jd4"; csr = "csr"

class User(BaseModel):
    id: str; name: str; email: str; role: Role; team: str | None = None; active: bool = True

class DocumentFile(BaseModel):
    id: str; name: str; type: str; url: str; pages: int | None = None

class ExtractedField(BaseModel):
    key: str; value: str; confidence: float

class Claim(BaseModel):
    id: str; reference: str; channel: Channel; category: Category; status: Status
    insurer: str; memberName: str; policyNumber: str | None = None
    assignee: str | None = None; suggestedAssignee: str | None = None
    receivedAt: datetime; documentsComplete: bool = False
    amount: float | None = None; summary: str | None = None
    extracted: list[ExtractedField] = []; documents: list[DocumentFile] = []

class ClaimList(BaseModel):
    items: list[Claim]; page: int = 1; total: int = 0
