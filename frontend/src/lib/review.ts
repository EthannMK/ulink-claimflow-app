import { apiBase, authHeaders } from './auth'

export interface ReviewBox { x: number; y: number; w: number; h: number }
export interface ReviewField { id: string; name: string; value: string; confidence: number; page: number; box: ReviewBox }
export interface ReviewResult { pages: number; fields: ReviewField[]; provider: string; error: string }

export async function reviewDoc(file: File): Promise<ReviewResult> {
  const fd = new FormData(); fd.append('file', file, file.name)
  const r = await fetch(`${apiBase()}/api/review`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Review failed (${r.status})`) }
  return r.json()
}
