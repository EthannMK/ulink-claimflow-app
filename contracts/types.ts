// Shared types — keep in sync with openapi.yaml. Frontend imports these shapes.
export type Channel = 'email' | 'facebook' | 'viber' | 'telegram' | 'webform' | 'phone';
export type Category = 'new_claim' | 'log_request' | 'query' | 'complaint' | 'payment_followup' | 'document_submission';
export type Status = 'new' | 'in_progress' | 'awaiting_docs' | 'ready_for_review' | 'approved' | 'partially_approved' | 'rejected' | 'closed';
export type Role = 'admin' | 'jd1' | 'jd2' | 'jd3' | 'jd4' | 'csr';

export interface User { id: string; name: string; email: string; role: Role; team?: string; active: boolean; }
export interface DocumentFile { id: string; name: string; type: string; url: string; pages?: number; }
export interface ExtractedField { key: string; value: string; confidence: number; }
export interface Claim {
  id: string; reference: string; channel: Channel; category: Category; status: Status;
  insurer: string; memberName: string; policyNumber?: string;
  assignee?: string | null; suggestedAssignee?: string | null;
  receivedAt: string; documentsComplete: boolean; amount?: number | null; summary?: string | null;
  extracted: ExtractedField[]; documents: DocumentFile[];
}
export interface ClaimList { items: Claim[]; page: number; total: number; }
