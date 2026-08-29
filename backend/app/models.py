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

class PasswordChange(BaseModel):
    current_password: str
    new_password: str

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


# ---- JD1 Process Note models (POC) ----
from pydantic import Field

class NoteField(BaseModel):
    value: str = ""
    confidence: float = 0.0     # 0 when no data (per Ulink rule)
    remark: str = ""

class JD1Header(BaseModel):
    member_name: NoteField = Field(default_factory=NoteField)
    insurer: NoteField = Field(default_factory=NoteField)
    claim_date: NoteField = Field(default_factory=NoteField)
    company: NoteField = Field(default_factory=NoteField)
    nrc_passport: NoteField = Field(default_factory=NoteField)
    total_claim_amount: NoteField = Field(default_factory=NoteField)
    treatment_date: NoteField = Field(default_factory=NoteField)
    claim_no: NoteField = Field(default_factory=NoteField)
    ias_note: str = ""          # what JD1 must verify in the iAS system

class JD1SectionA(BaseModel):   # A. Document checking (Yes/No + remark)
    document_complete: NoteField = Field(default_factory=NoteField)
    document_readable: NoteField = Field(default_factory=NoteField)
    missing_document: NoteField = Field(default_factory=NoteField)
    duplicate_document: NoteField = Field(default_factory=NoteField)
    incorrect_inconsistent: NoteField = Field(default_factory=NoteField)

class JD1SectionB(BaseModel):   # B. Claim information (value + remark)
    policy_member_eligibility: NoteField = Field(default_factory=NoteField)
    diagnosis: NoteField = Field(default_factory=NoteField)
    treatment_procedure: NoteField = Field(default_factory=NoteField)
    admission_discharge_dates: NoteField = Field(default_factory=NoteField)
    hospital_provider: NoteField = Field(default_factory=NoteField)
    claim_amount: NoteField = Field(default_factory=NoteField)
    prescription_medical_report: NoteField = Field(default_factory=NoteField)
    invoice_receipt: NoteField = Field(default_factory=NoteField)

class JD1SectionC(BaseModel):   # C. Rule / checking (Yes/No/Unclear + remark)
    covered_status: NoteField = Field(default_factory=NoteField)   # Covered / Not covered / Unclear
    exclusion_identified: NoteField = Field(default_factory=NoteField)
    waiting_period_issue: NoteField = Field(default_factory=NoteField)
    policy_limit_issue: NoteField = Field(default_factory=NoteField)
    pre_existing_indicator: NoteField = Field(default_factory=NoteField)
    duplicate_claim_indicator: NoteField = Field(default_factory=NoteField)
    fraud_indicator: NoteField = Field(default_factory=NoteField)
    need_investigation: NoteField = Field(default_factory=NoteField)

class ClassifiedDoc(BaseModel):
    name: str
    doc_type: str = "Other"     # Claim form / Medical report / Invoice / ID / Policy wording / TOB / LOG / CSR / Other
    read_method: str = "vision" # "native" (digital text) or "vision" (scanned image)
    pages: int | None = None
    confidence: float = 0.0

class JD1Note(BaseModel):
    claim_type: str = ""        # reimbursement / LOG / API-eclaim
    header: JD1Header = Field(default_factory=JD1Header)
    section_a: JD1SectionA = Field(default_factory=JD1SectionA)
    section_b: JD1SectionB = Field(default_factory=JD1SectionB)
    section_c: JD1SectionC = Field(default_factory=JD1SectionC)
    documents: list[ClassifiedDoc] = []
    checklist_missing: list[str] = []
    provider: str = "stub"
    notes: str = ""


# ---- JD2 queue (JD1 -> JD2 handoff) --------------------------------------------
class JD2Status(str, Enum):
    pending = "pending"          # handed off by JD1, awaiting JD2
    approved = "approved"
    partially_approved = "partially_approved"
    rejected = "rejected"

class JD2Item(BaseModel):
    id: str
    created_at: datetime
    handed_by: str = ""          # JD1 officer username
    member_name: str = ""
    insurer: str = ""
    claim_type: str = ""
    claim_amount: str = ""
    status: JD2Status = JD2Status.pending
    note: JD1Note                # the full JD1 Process Note
    decision: str | None = None  # approve / partial / reject
    reasons: str = ""
    decided_by: str | None = None
    decided_at: datetime | None = None

class JD2Decision(BaseModel):
    decision: str                # "approve" | "partial" | "reject"
    reasons: str = ""

class JD2List(BaseModel):
    items: list[JD2Item] = []
