import { apiBase, authHeaders } from './auth'

export interface NoteField { value: string; confidence: number; remark: string }
export interface JD1Header {
  member_name: NoteField; insurer: NoteField; claim_date: NoteField; company: NoteField
  nrc_passport: NoteField; total_claim_amount: NoteField; treatment_date: NoteField; claim_no: NoteField
  ias_note: string
}
export type Section = Record<string, NoteField>
export interface ClassifiedDoc { name: string; doc_type: string; read_method: string; pages?: number | null; confidence: number }
export interface JD1Note {
  claim_type: string
  header: JD1Header
  section_a: Section
  section_b: Section
  section_c: Section
  documents: ClassifiedDoc[]
  checklist_missing: string[]
  files_count: number
  document_count: number
  provider: string
  notes: string
}

export async function runJD1(files: File[]): Promise<JD1Note> {
  const fd = new FormData()
  files.forEach((f) => fd.append('files', f, f.name))
  const r = await fetch(`${apiBase()}/api/jd1`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) throw new Error(`JD1 failed (${r.status})`)
  return r.json()
}

// ---- JD2 queue (JD1 -> JD2 handoff) ----
export type JD2Status = 'pending' | 'approved' | 'partially_approved' | 'rejected'
export interface JD2Item {
  id: string; created_at: string; handed_by: string
  member_name: string; insurer: string; claim_type: string; claim_amount: string
  status: JD2Status; note: JD1Note
  decision: string | null; reasons: string; decided_by: string | null; decided_at: string | null
}

function jsonHeaders(): Record<string, string> { return { ...authHeaders(), 'Content-Type': 'application/json' } }

export async function handoffToJD2(note: JD1Note): Promise<JD2Item> {
  const r = await fetch(`${apiBase()}/api/jd2/handoff`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify(note) })
  if (!r.ok) throw new Error(`Handoff failed (${r.status})`)
  return r.json()
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
export async function decideJD2(id: string, decision: 'approve' | 'partial' | 'reject', reasons: string): Promise<JD2Item> {
  const r = await fetch(`${apiBase()}/api/jd2/${id}/decision`, { method: 'POST', headers: jsonHeaders(), body: JSON.stringify({ decision, reasons }) })
  if (!r.ok) throw new Error(`Decision failed (${r.status})`)
  return r.json()
}
