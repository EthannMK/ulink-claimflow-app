import { apiBase, authHeaders } from './auth'

export interface ReviewBox { x: number; y: number; w: number; h: number }
export interface ReviewField { id: string; name: string; value: string; confidence: number; page: number; section?: string; box: ReviewBox }
export interface ReviewResult { pages: number; fields: ReviewField[]; all_fields: ReviewField[]; provider: string; error: string }

// Per-session cache keyed by file identity + requested fields.
const cache = new Map<string, Promise<ReviewResult>>()

async function fetchReview(file: File, fields: string): Promise<ReviewResult> {
  const fd = new FormData(); fd.append('file', file, file.name)
  if (fields) fd.append('fields', fields)
  const r = await fetch(`${apiBase()}/api/review`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Review failed (${r.status})`) }
  return r.json()
}

export function reviewDoc(file: File, fields = ''): Promise<ReviewResult> {
  const key = `${file.name}:${file.size}:${file.lastModified}:${fields.length}:${fields.slice(0, 80)}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = fetchReview(file, fields).catch((e) => { cache.delete(key); throw e })
  cache.set(key, p)
  return p
}
