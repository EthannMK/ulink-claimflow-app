import { apiBase, authHeaders } from './auth'

export interface NoteField { value: string; confidence: number; remark: string }
export interface JD1Header {
  member_name: NoteField; insurer: NoteField; claim_date: NoteField; company: NoteField
  nrc_passport: NoteField; total_claim_amount: NoteField; treatment_date: NoteField; claim_no: NoteField
  ias_note: string
}
export type Section = Record<string, NoteField>
export interface ClassifiedDoc { name: string; doc_type: string; read_method: string; pages?: number | null; confidence: number }

export interface AuditEntry { field: string; old: string; new: string; by: string; at: string | null }
export interface InvoiceItem {
  id: string; description: string; provider: string; date: string
  amount: string; amount_original: string; readable: boolean
  confidence: number; page: number; source_file: string; audit: AuditEntry[]
}
export interface InvoiceSummary {
  items: InvoiceItem[]; count: number; invoices_total: string; claim_total: string
  reconciled: boolean; difference: string; unreadable_count: number; note: string
}

export interface JD1Note {
  claim_type: string
  header: JD1Header
  section_a: Section
  section_b: Section
  section_c: Section
  documents: ClassifiedDoc[]
  checklist_required: string[]
  checklist_missing: string[]
  invoices: InvoiceSummary
  ai_summary: string
  files_count: number
  document_count: number
  provider: string
  notes: string
}

// ---- amount helpers + client-side reconciliation (after JD1 edits an amount) ----
export function amountToInt(s: string): number | null {
  const digits = (s || '').replace(/[^\d]/g, '')
  return digits ? parseInt(digits, 10) : null
}
export function fmtMMK(n: number): string { return `${n.toLocaleString('en-US')} MMK` }

/** Recompute the InvoiceSummary totals + verdict from the current item amounts. */
export function reconcileInvoices(inv: InvoiceSummary): InvoiceSummary {
  const items = inv.items
  const readable = items.filter((i) => amountToInt(i.amount) !== null)
  const unreadable = items.length - readable.length
  const sum = readable.reduce((a, i) => a + (amountToInt(i.amount) || 0), 0)
  const claimInt = amountToInt(inv.claim_total)
  let reconciled = false, difference = '', note = ''
  if (unreadable > 0) {
    note = `${unreadable} of ${items.length} invoice amount(s) not readable — verify manually before trusting the total.`
  } else if (claimInt === null) {
    note = 'No claim-form total to reconcile against — enter the claim total to check.'
  } else {
    const diff = sum - claimInt
    reconciled = diff === 0
    if (reconciled) note = 'Invoices sum exactly to the claim total.'
    else { difference = fmtMMK(Math.abs(diff)); note = diff > 0 ? `Invoices exceed the claim total by ${difference}.` : `Invoices fall short of the claim total by ${difference}.` }
  }
  return { ...inv, count: items.length, invoices_total: items.length ? fmtMMK(sum) : '', reconciled, difference, unreadable_count: unreadable, note }
}

export async function runJD1(files: File[]): Promise<JD1Note> {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f, f.name))
  const r = await fetch(`${apiBase()}/api/jd1`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) throw new Error(`JD1 failed (${r.status})`)
  return r.json()
}

export interface DraftMail { subject: string; body: string; reason: string }
export async function draftClientMail(note: JD1Note): Promise<DraftMail> {
  const r = await fetch(`${apiBase()}/api/jd1/draft-mail`, {
    method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(note),
  })
  if (!r.ok) throw new Error(`Draft mail failed (${r.status})`)
  return r.json()
}

// ---- JD2 queue (JD1 -> JD2 handoff) ----
export type JD2Status = 'pending' | 'approved' | 'partially_approved' | 'rejected'
export interface StoredDoc { id: string; name: string; mime: string; size: number }
export interface JD2Item {
  id: string; created_at: string; handed_by: string
  member_name: string; insurer: string; claim_type: string; claim_amount: string
  status: JD2Status; note: JD1Note; attachments: StoredDoc[]
  decision: string | null; reasons: string; decided_by: string | null; decided_at: string | null
}

function jsonHeaders(): Record<string, string> { return { ...authHeaders(), 'Content-Type': 'application/json' } }

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  return btoa(binary)
}

export async function handoffToJD2(note: JD1Note, files: File[] = []): Promise<JD2Item> {
  const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, mime: f.type || 'application/octet-stream', data: await fileToBase64(f) })))
  const r = await fetch(`${apiBase()}/api/jd2/handoff`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ note, attachments }) })
  if (!r.ok) throw new Error(`Handoff failed (${r.status})`)
  return r.json()
}

/** Fetch a JD2 attachment with auth and return an object URL (caller revokes when done). */
export async function fetchDocBlobUrl(itemId: string, docId: string): Promise<{ url: string; revoke: () => void }> {
  const r = await fetch(`${apiBase()}/api/jd2/${itemId}/documents/${docId}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Download failed (${r.status})`)
  const blob = await r.blob()
  const url = URL.createObjectURL(blob)
  return { url, revoke: () => URL.revokeObjectURL(url) }
}
export async function getJD2Queue(): Promise<JD2Item[]> {
  const r = await fetch(`${apiBase()}/api/jd2/queue`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Queue failed (${r.status})`)
  return (await r.json()).items
}
export async function getJD2Item(id: string): Promise<JD2Item> {
  const r = await fetch(`${apiBase()}/api/jd2/${id}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Not found (${r.status})`)
  return r.json()
}
export async function updateJD2Note(id: string, note: JD1Note): Promise<JD2Item> {
  const r = await fetch(`${apiBase()}/api/jd2/${id}/note`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(note) })
  if (!r.ok) throw new Error(`Save failed (${r.status})`)
  return r.json()
}
export async function decideJD2(id: string, decision: 'approve' | 'partial' | 'reject', reasons: string): Promise<JD2Item> {
  const r = await fetch(`${apiBase()}/api/jd2/${id}/decision`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ decision, reasons }) })
  if (!r.ok) throw new Error(`Decision failed (${r.status})`)
  return r.json()
}
