import { apiBase, authHeaders } from './auth'

export interface ReviewBox { x: number; y: number; w: number; h: number }
export interface ReviewField { id: string; name: string; value: string; confidence: number; page: number; box: ReviewBox }
export interface ReviewResult { pages: number; fields: ReviewField[]; provider: string; error: string }

// Per-session cache keyed by file identity so re-opening the same document
// doesn't re-call Document AI (which would re-bill those pages).
const cache = new Map<string, Promise<ReviewResult>>()

async function fetchReview(file: File): Promise<ReviewResult> {
  const fd = new FormData(); fd.append('file', file, file.name)
  const r = await fetch(`${apiBase()}/api/review`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Review failed (${r.status})`) }
  return r.json()
}

export function reviewDoc(file: File): Promise<ReviewResult> {
  const key = `${file.name}:${file.size}:${file.lastModified}`
  const hit = cache.get(key)
  if (hit) return hit
  const p = fetchReview(file).catch((e) => { cache.delete(key); throw e })
  cache.set(key, p)
  return p
}
