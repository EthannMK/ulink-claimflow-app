from enum import Enum
from pydantic import BaseModel

class Role(str, Enum):
    super_admin = "super_admin"   # full access incl. user management
    admin = "admin"               # everything except user management
    user = "user"                 # work claims / scan only

class User(BaseModel):
    id: str
    username: str
    name: str
    email: str
    role: Role
    active: bool = True

class UserCreate(BaseModel):
    username: str
    name: str
    email: str
    role: Role = Role.user
    password: str

class UserUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    role: Role | None = None
    active: bool | None = None
    password: str | None = None

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"
    role: Role
    name: str

class ScanField(BaseModel):
    key: str
    value: str
    confidence: float

class ScanResult(BaseModel):
    doc_type: str
    text: str
    fields: list[ScanField] = []
    summary: str = ""
    provider: str = "stub"


# ---- claim models (used by /api/claims) ----
from datetime import datetime

class Channel(str, Enum):
    email = "email"; facebook = "facebook"; viber = "viber"; telegram = "telegram"; webform = "webform"; phone = "phone"

class Category(str, Enum):
    new_claim = "new_claim"; log_request = "log_request"; query = "query"
    complaint = "complaint"; payment_followup = "payment_followup"; document_submission = "document_submission"

class Status(str, Enum):
    new = "new"; in_progress = "in_progress"; awaiting_docs = "awaiting_docs"
    ready_for_review = "ready_for_review"; approved = "approved"
    partially_approved = "partially_approved"; rejected = "rejected"; closed = "closed"

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
