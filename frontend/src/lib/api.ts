import type { Claim, ClaimList, User } from './types'
import { mockClaims } from '../mocks/claims'
import { mockUsers } from '../mocks/users'
import { mockConfirmations, ConfirmationRecord } from '../mocks/confirmations'
import { mockNotifs, Notif } from '../mocks/notifications'
import { backendOn, apiBase, authHeaders } from './auth'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function listClaims(): Promise<ClaimList> {
  if (!backendOn()) { await wait(120); return { items: mockClaims, page: 1, total: mockClaims.length } }
  return (await fetch(`${apiBase()}/api/claims`, { headers: authHeaders() })).json()
}
export async function getClaim(id: string): Promise<Claim | undefined> {
  if (!backendOn()) { await wait(100); return mockClaims.find((c) => c.id === id) }
  return (await fetch(`${apiBase()}/api/claims/${id}`, { headers: authHeaders() })).json()
}
export async function listUsers(): Promise<User[]> {
  if (!backendOn()) { await wait(90); return mockUsers }
  return (await fetch(`${apiBase()}/api/users`, { headers: authHeaders() })).json()
}
export async function createUser(body: any): Promise<Response> {
  return fetch(`${apiBase()}/api/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) })
}
export async function updateUser(id: string, body: any): Promise<Response> {
  return fetch(`${apiBase()}/api/users/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify(body) })
}
export async function deleteUser(id: string): Promise<Response> {
  return fetch(`${apiBase()}/api/users/${id}`, { method: 'DELETE', headers: authHeaders() })
}
export async function changeMyPassword(current_password: string, new_password: string): Promise<Response> {
  return fetch(`${apiBase()}/api/me/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeaders() }, body: JSON.stringify({ current_password, new_password }) })
}
export async function extractDoc(kind: 'rules' | 'benefits', file: File): Promise<any[]> {
  const fd = new FormData(); fd.append('kind', kind); fd.append('file', file, file.name)
  const r = await fetch(`${apiBase()}/api/extract`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Extraction failed (${r.status})`) }
  return (await r.json()).items
}
export async function listConfirmations(): Promise<ConfirmationRecord[]> { await wait(90); return mockConfirmations }
export async function listNotifs(): Promise<Notif[]> { await wait(80); return mockNotifs }
