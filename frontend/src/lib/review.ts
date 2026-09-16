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

// ---- page-by-page "Full detection" ----
export interface PageItem { label: string; value: string }
export interface PageDetail { page: number; title: string; summary: string; items: PageItem[] }
export interface PageAnalysis { pages: PageDetail[]; provider: string; error: string }

const pageCache = new Map<string, Promise<PageAnalysis>>()

export function reviewDocPages(file: File): Promise<PageAnalysis> {
  const key = `pages:${file.name}:${file.size}:${file.lastModified}`
  const hit = pageCache.get(key)
  if (hit) return hit
  const p = (async () => {
    const fd = new FormData(); fd.append('file', file, file.name)
    const r = await fetch(`${apiBase()}/api/review/pages`, { method: 'POST', headers: authHeaders(), body: fd })
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Page analysis failed (${r.status})`) }
    return r.json() as Promise<PageAnalysis>
  })().catch((e) => { pageCache.delete(key); throw e })
  pageCache.set(key, p)
  return p
}
