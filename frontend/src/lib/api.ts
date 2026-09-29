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
export type AssignPermissions = Record<string, string[]>
const DEFAULT_ASSIGN_PERMISSIONS: AssignPermissions = { super_admin: ['super_admin', 'admin', 'user'], admin: ['super_admin', 'admin', 'user'], user: ['super_admin', 'admin', 'user'] }
export async function getAssignPermissions(): Promise<AssignPermissions> {
  if (!backendOn()) { await wait(80); return DEFAULT_ASSIGN_PERMISSIONS }
  const r = await fetch(`${apiBase()}/api/settings/assign-permissions`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Failed to load permissions (${r.status})`)
  return (await r.json()).permissions
}
export async function updateAssignPermissions(permissions: AssignPermissions): Promise<AssignPermissions> {
  const r = await fetch(`${apiBase()}/api/settings/assign-permissions`, { method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ permissions }) })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Save failed (${r.status})`) }
  return (await r.json()).permissions
}

export async function extractDoc(kind: 'rules' | 'benefits', file: File): Promise<any[]> {
  const fd = new FormData(); fd.append('kind', kind); fd.append('file', file, file.name)
  const r = await fetch(`${apiBase()}/api/extract`, { method: 'POST', headers: authHeaders(), body: fd })
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `Extraction failed (${r.status})`) }
  return (await r.json()).items
}
export async function listConfirmations(): Promise<ConfirmationRecord[]> { await wait(90); return mockConfirmations }
export async function listNotifs(): Promise<Notif[]> { await wait(80); return mockNotifs }

// ---- AI providers & models (Super Admin) -------------------------------------
// Provider = the company/platform we call (Vertex AI, OpenRouter).
// Model    = the specific AI model that provider runs for us (e.g. gemini-3.6-flash).
export interface AiProvider { provider: string; model: string; enabled: boolean; priority: number }
export interface AiProviderStatus extends AiProvider { label: string; available: boolean; vision: boolean }
export interface AiStatus { providers: AiProviderStatus[]; openrouter_management_key_configured: boolean }

async function jsonOrThrow<T>(r: Response, what: string): Promise<T> {
  if (!r.ok) { const d = await r.json().catch(() => ({})); throw new Error(d.detail || `${what} failed (${r.status})`) }
  return r.json()
}
export async function getAiStatus(): Promise<AiStatus> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/ai-settings/status`, { headers: authHeaders() }), 'Loading AI providers')
}
export async function updateAiSettings(providers: AiProvider[]): Promise<{ providers: AiProvider[] }> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/ai-settings`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ providers }),
  }), 'Saving AI providers')
}

// ---- AI usage & costs ---------------------------------------------------------
export interface MyUsage { spent_usd: number; cap_usd: number | null; remaining_usd: number | null; requests: number; tokens: number }
export interface UsageSummary {
  days: number; total_cost_usd: number; total_tokens: number; requests: number; failed: number; success_rate: number
  by_model: { provider: string; model: string; requests: number; tokens: number; cost_usd: number }[]
  by_day: { day: string; requests: number; cost_usd: number }[]
  by_user: { user: string; requests: number; cost_usd: number }[]
}
export interface UsageEntry { id: string; ts: number; user: string; provider: string; model: string; tokens_in: number; tokens_out: number; cost_usd: number; ok: boolean }
export interface OpenRouterLive {
  api_key_configured: boolean; management_key_configured: boolean
  key: null | { error?: string; label?: string; usage_usd?: number | null; limit_usd?: number | null; limit_remaining_usd?: number | null; is_free_tier?: boolean }
  credits: null | { error?: string; total_credits_usd?: number | null; total_usage_usd?: number | null; balance_usd?: number | null }
}
export async function getMyUsage(): Promise<MyUsage> {
  if (!backendOn()) { await wait(80); return { spent_usd: 0, cap_usd: null, remaining_usd: null, requests: 0, tokens: 0 } }
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/me`, { headers: authHeaders() }), 'Loading your usage')
}
export async function getUsageSummary(days: number): Promise<UsageSummary> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/summary?days=${days}`, { headers: authHeaders() }), 'Loading usage summary')
}
export async function getUsageRecent(limit = 50): Promise<UsageEntry[]> {
  return (await jsonOrThrow<{ items: UsageEntry[] }>(await fetch(`${apiBase()}/api/usage/recent?limit=${limit}`, { headers: authHeaders() }), 'Loading recent calls')).items
}
export async function getOpenRouterLive(): Promise<OpenRouterLive> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/openrouter`, { headers: authHeaders() }), 'Loading OpenRouter balance')
}
