import { apiBase, authHeaders } from './auth'
import type { PageDetail } from './review'

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

export interface SupportingDoc {
  name: string; doc_type: string; summary: string; provider: string; date: string
  amount: string; diagnosis: string; person_name: string; flags: string[]; confidence: number; page: number
}
export interface ConsistencyCheck { label: string; status: 'ok' | 'warning' | 'fail' | 'unclear'; detail: string }
export interface SupportingAnalysis { documents: SupportingDoc[]; checks: ConsistencyCheck[]; summary: string }

export interface FileNotes { file: string; pages: PageDetail[] }
/** JD1's "Required fields" for one uploaded file (with JD1's edits). page is 0-based. */
export interface ReqField { name: string; value: string; section: string; page: number; ai_value?: string }
export interface FileFields { file: string; fields: ReqField[] }

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
  supporting: SupportingAnalysis
  ai_summary: string
  files_count: number
  document_count: number
  provider: string
  notes: string
  page_notes: FileNotes[]
  required_fields?: FileFields[]
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
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `JD1 failed (${r.status})`) }
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
  status: JD2Status; assignee?: string | null; assignee_username?: string | null
  ticket_id?: string | null; ticket_ref?: string
  note: JD1Note; attachments: StoredDoc[]
  decision: string | null; reasons: string; decided_by: string | null; decided_at: string | null
}

function jsonHeaders(): Record<string, string> { return { ...authHeaders(), 'Content-Type': 'application/json' } }


async function okJson<T>(r: Response, what: string): Promise<T> {
  if (!r.ok) {
    const d = await r.json().catch(() => ({}))
    const detail = typeof d.detail === 'string' ? d.detail : ''
    throw new Error(detail || (r.status === 413 ? `${what}: the file is too large to upload` : `${what} failed (${r.status})`))
  }
  return r.json()
}

/** Cloud Run accepts at most 32 MB per request, so each document is uploaded on its own. */
export const MAX_UPLOAD_BYTES = 31 * 1024 * 1024

/** Send the JD1 note to JD2 (the server links / creates the Inbox ticket), then upload each
 *  document separately. Returns the JD2 item plus any files that could not be attached. */
export async function handoffToJD2(note: JD1Note, files: File[] = [], ticketId?: string | null,
  onProgress?: (text: string) => void): Promise<{ item: JD2Item; failed: string[] }> {
  onProgress?.('Sending the note to JD2…')
  let item = await okJson<JD2Item>(await fetch(`${apiBase()}/api/jd2/handoff`, {
    method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ note, ticket_id: ticketId || null }),
  }), 'Send to JD2')
  const failed: string[] = []
  // files already saved with the ticket come along on the server — only upload the rest
  const have = new Set((item.attachments ?? []).map((a) => `${a.name}:${a.size}`))
  const todo = files.filter((f) => !have.has(`${f.name}:${f.size}`))
  for (let i = 0; i < todo.length; i++) {
    const f = todo[i]
    onProgress?.(`Uploading document ${i + 1} of ${todo.length}: ${f.name}`)
    if (f.size > MAX_UPLOAD_BYTES) { failed.push(`${f.name} (over 31 MB)`); continue }
    try {
      const fd = new FormData(); fd.append('file', f, f.name)
      item = await okJson<JD2Item>(await fetch(`${apiBase()}/api/jd2/${item.id}/documents`, { method: 'POST', headers: authHeaders(), body: fd }), 'Upload')
    } catch (e: any) { failed.push(`${f.name} (${e?.message ?? 'upload failed'})`) }
  }
  return { item, failed }
}

/** People the signed-in user may assign claims to (every role can call this). */
export interface Assignee { username: string; name: string; role: string }
export async function getAssignees(): Promise<Assignee[]> {
  return (await okJson<{ items: Assignee[] }>(await fetch(`${apiBase()}/api/assignees`, { headers: authHeaders() }), 'Loading team')).items
}
export async function assignTicket(id: string, username: string): Promise<unknown> {
  return okJson(await fetch(`${apiBase()}/api/claims/${id}/assign`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ assignee: username }) }), 'Assign')
}
/** Download a JD2 attachment as a File (for the in-page viewer). */
export async function fetchDocFile(itemId: string, doc: StoredDoc): Promise<File> {
  const r = await fetch(`${apiBase()}/api/jd2/${itemId}/documents/${doc.id}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Could not load ${doc.name} (${r.status})`)
  const blob = await r.blob()
  return new File([blob], doc.name, { type: doc.mime || blob.type })
}

// ---- tickets (Inbox) ----
export interface Ticket { id: string; reference: string; status: string; category: string; insurer: string; memberName: string; documents?: { id: string; name: string; size?: number | null }[] }

/** Keep one uploaded file with its Inbox ticket (stored in Cloud Storage). Same name + size again = no-op. */
export async function uploadTicketDoc(ticketId: string, file: File): Promise<Ticket> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is over 31 MB`)
  const fd = new FormData(); fd.append('file', file, file.name)
  return okJson<Ticket>(await fetch(`${apiBase()}/api/claims/${ticketId}/documents`, { method: 'POST', headers: authHeaders(), body: fd }), 'Saving the document')
}
/** Admin: CSV of every stored claim document (ticket ref, claim no, insurer, member, date, storage path). */
export async function downloadDocumentIndex(filters: { insurer?: string; q?: string; date_from?: string; date_to?: string } = {}): Promise<void> {
  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][])
  const r = await fetch(`${apiBase()}/api/documents/index.csv?${qs}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Export failed (${r.status})`)
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a'); a.href = url; a.download = `claim-documents-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30_000)
}
/** Keep JD1's work (note + page notes + required fields) with the ticket on the server. */
export async function saveJD1Draft(ticketId: string, note: JD1Note): Promise<unknown> {
  return okJson(await fetch(`${apiBase()}/api/claims/${ticketId}/jd1-draft`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(note) }), 'Saving JD1 work')
}
/** JD1's saved work for a ticket, or null when none was saved. */
export async function getJD1Draft(ticketId: string): Promise<JD1Note | null> {
  const r = await fetch(`${apiBase()}/api/claims/${ticketId}/jd1-draft`, { headers: authHeaders() })
  if (r.status === 404) return null
  return okJson<JD1Note>(r, 'Loading JD1 work')
}
/** A document saved with a ticket, as a File (to reopen the claim in JD1). */
export async function fetchTicketFile(ticketId: string, doc: { id: string; name: string; type?: string }): Promise<File> {
  const r = await fetch(`${apiBase()}/api/claims/${ticketId}/documents/${doc.id}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Could not load ${doc.name} (${r.status})`)
  const blob = await r.blob()
  return new File([blob], doc.name, { type: doc.type || blob.type })
}
/** Open or download a document saved with a ticket. */
export async function ticketDocUrl(ticketId: string, docId: string): Promise<{ url: string; revoke: () => void }> {
  const r = await fetch(`${apiBase()}/api/claims/${ticketId}/documents/${docId}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Could not open the document (${r.status})`)
  const url = URL.createObjectURL(await r.blob())
  return { url, revoke: () => URL.revokeObjectURL(url) }
}
/** Log a claim / request by hand (New Claim page). */
export interface ManualTicket { insurer: string; member_name: string; category: string; channel: string; claim_no?: string; amount?: string; summary?: string; fields?: Record<string, string> }
export async function createManualTicket(t: ManualTicket): Promise<Ticket> {
  return okJson<Ticket>(await fetch(`${apiBase()}/api/claims`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(t) }), 'Creating the ticket')
}
export async function createTicketFromJD1(note: JD1Note, channel = 'webform'): Promise<Ticket> {
  const r = await fetch(`${apiBase()}/api/claims/from-jd1`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ note, channel }) })
  if (!r.ok) throw new Error(`Ticket create failed (${r.status})`)
  return r.json()
}
export async function updateTicket(id: string, patch: { status?: string; documentsComplete?: boolean; summary?: string; assignee?: string; jd2_item_id?: string }): Promise<Ticket> {
  const r = await fetch(`${apiBase()}/api/claims/${id}`, { method: 'PATCH', headers: jsonHeaders(), body: JSON.stringify(patch) })
  if (!r.ok) throw new Error(`Ticket update failed (${r.status})`)
  return r.json()
}
export async function deleteTicket(id: string): Promise<void> {
  const r = await fetch(`${apiBase()}/api/claims/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Delete failed (${r.status})`) }
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
  return (await okJson<{ items: JD2Item[] }>(await fetch(`${apiBase()}/api/jd2/queue`, { headers: authHeaders() }), 'Loading the JD2 queue')).items
}
export async function getJD2Item(id: string): Promise<JD2Item> {
  return okJson(await fetch(`${apiBase()}/api/jd2/${id}`, { headers: authHeaders() }), 'Loading the claim')
}
export async function updateJD2Note(id: string, note: JD1Note): Promise<JD2Item> {
  return okJson(await fetch(`${apiBase()}/api/jd2/${id}/note`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify(note) }), 'Save')
}
export async function assignJD2(id: string, assignee: string): Promise<JD2Item> {
  return okJson(await fetch(`${apiBase()}/api/jd2/${id}/assign`, { method: 'PUT', headers: jsonHeaders(), body: JSON.stringify({ assignee }) }), 'Assign')
}
export async function deleteJD2Item(id: string): Promise<void> {
  const r = await fetch(`${apiBase()}/api/jd2/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Delete failed (${r.status})`) }
}
export async function decideJD2(id: string, decision: 'approve' | 'partial' | 'reject', reasons: string): Promise<JD2Item> {
  return okJson(await fetch(`${apiBase()}/api/jd2/${id}/decision`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ decision, reasons }) }), 'Decision')
}
