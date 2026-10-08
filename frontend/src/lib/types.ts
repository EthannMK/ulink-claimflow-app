// Shared types — keep in sync with openapi.yaml. Frontend imports these shapes.
export type Channel = 'email' | 'facebook' | 'viber' | 'telegram' | 'webform' | 'phone';
export type Category = 'new_claim' | 'log_request' | 'query' | 'complaint' | 'payment_followup' | 'document_submission';
export type Status = 'new' | 'in_progress' | 'awaiting_docs' | 'ready_for_review' | 'approved' | 'partially_approved' | 'rejected' | 'closed';
export type Role = 'admin' | 'jd1' | 'jd2' | 'jd3' | 'jd4' | 'csr';

export interface User { id: string; name: string; email: string; role: Role; team?: string; active: boolean; username?: string; usage_cap_usd?: number | null; usage_spent_usd?: number; daily_cap_usd?: number | null; usage_today_usd?: number; }
export interface DocumentFile { id: string; name: string; type: string; url: string; pages?: number; size?: number | null; uploaded_at?: string | null; uploaded_by?: string | null }
export interface ExtractedField { key: string; value: string; confidence: number; }
export interface Claim {
  id: string; reference: string; channel: Channel; category: Category; status: Status;
  insurer: string; memberName: string; policyNumber?: string;
  assignee?: string | null; suggestedAssignee?: string | null;
  receivedAt: string; documentsComplete: boolean; amount?: number | null; summary?: string | null;
  jd2_item_id?: string | null; assignee_username?: string | null;
  claim_no?: string | null; jd1_saved_at?: string | null; jd1_saved_by?: string | null; checklist_required?: string[]; checklist_missing?: string[];
  extracted: ExtractedField[]; documents: DocumentFile[];
}
export interface ClaimList { items: Claim[]; page: number; total: number; }
