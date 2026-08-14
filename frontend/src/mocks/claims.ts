import type { Claim } from '../lib/types'
export const mockClaims: Claim[] = [
  {
    id: 'c1', reference: 'CLM-26001', channel: 'email', category: 'new_claim', status: 'ready_for_review',
    insurer: 'MGEN', memberName: 'Thin Zar', policyNumber: 'MG-100234', assignee: 'u1', suggestedAssignee: 'u1',
    receivedAt: '2026-08-14T09:12:00Z', documentsComplete: true, amount: 185000,
    summary: 'Outpatient consultation + medication. Documents complete.',
    extracted: [
      { key: 'Member Name', value: 'Thin Zar', confidence: 0.98 },
      { key: 'Policy Number', value: 'MG-100234', confidence: 0.95 },
      { key: 'Diagnosis', value: 'Acute gastritis', confidence: 0.72 },
      { key: 'Amount', value: '185,000 MMK', confidence: 0.9 },
    ],
    documents: [
      { id: 'd1', name: 'Claim form.pdf', type: 'claim_form', url: '#', pages: 2 },
      { id: 'd2', name: 'Invoice.jpg', type: 'invoice', url: '#', pages: 1 },
    ],
  },
  {
    id: 'c2', reference: 'LOG-26014', channel: 'viber', category: 'log_request', status: 'in_progress',
    insurer: 'AYA Sompo', memberName: 'Ko Ko', policyNumber: 'AYA-55021', assignee: null, suggestedAssignee: 'u2',
    receivedAt: '2026-08-14T10:05:00Z', documentsComplete: false, amount: null,
    summary: 'Inpatient LOG request, est > USD 1,000 — needs insurer approval.',
    extracted: [{ key: 'Hospital', value: 'Pun Hlaing', confidence: 0.94 }],
    documents: [],
  },
  {
    id: 'c3', reference: 'CMP-26007', channel: 'facebook', category: 'complaint', status: 'new',
    insurer: 'MGEN', memberName: 'Nilar', assignee: null, suggestedAssignee: 'u4',
    receivedAt: '2026-08-14T11:20:00Z', documentsComplete: false, amount: null,
    summary: 'Complaint about claim rejection reason — route to complaint officer.',
    extracted: [], documents: [],
  },
]
