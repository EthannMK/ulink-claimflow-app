import { apiBase, authHeaders } from './auth'
export interface BackendField { key: string; value: string; confidence: number }
export interface BackendScan { doc_type: string; text: string; fields: BackendField[]; summary: string; provider: string }

export async function scanFile(file: Blob, filename = 'doc.png'): Promise<BackendScan> {
  const fd = new FormData(); fd.append('file', file, filename)
  const r = await fetch(`${apiBase()}/api/scan`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) throw new Error(`Scan failed (${r.status})`)
  return r.json()
}
export function dataUrlToBlob(d: string): Blob {
  const [meta, b64] = d.split(','); const mime = (meta.match(/:(.*?);/) || [])[1] || 'image/png'
  const bin = atob(b64); const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
