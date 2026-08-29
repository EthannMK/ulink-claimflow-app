export interface ConfirmationRecord {
  id: string; inputDate: string; assignee: string; reason: string; ticket: string; claim: string;
  member: string; provider: string; providerPhone: string; insurer: string; csr: string;
  status: 'Done' | 'Pending' | 'Fraud' | 'Closed'
}
// No demo data — records come from imports or manual entry.
export const mockConfirmations: ConfirmationRecord[] = []
