export interface ConfirmationRecord {
  id: string; inputDate: string; assignee: string; reason: string; ticket: string; claim: string;
  member: string; provider: string; providerPhone: string; insurer: string; csr: string;
  status: 'Done' | 'Pending' | 'Fraud' | 'Closed'
}
export const mockConfirmations: ConfirmationRecord[] = [
  { id:'x1', inputDate:'2026-08-14', assignee:'Su Su', reason:'Verify invoice authenticity', ticket:'CLM-26004', claim:'AYA-55110',
    member:'Su Su Hlaing', provider:'Pun Hlaing Hospital', providerPhone:'01-3687000', insurer:'AYA Sompo', csr:'Mya Mya', status:'Pending' },
  { id:'x2', inputDate:'2026-08-13', assignee:'Su Su', reason:'Confirm treatment took place', ticket:'CLM-26001', claim:'MG-100234',
    member:'Thin Zar', provider:'City Clinic', providerPhone:'09-771234567', insurer:'MGEN', csr:'Mya Mya', status:'Done' },
  { id:'x3', inputDate:'2026-08-12', assignee:'Su Su', reason:'Suspicious duplicate invoice', ticket:'CLM-25998', claim:'MI-77120',
    member:'Hla Hla', provider:'Sunshine Clinic', providerPhone:'09-880011223', insurer:'Myanma Insurance', csr:'Mya Mya', status:'Fraud' },
]
