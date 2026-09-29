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

// ---- AI providers & models (Super Admin only) --------------------------------
// Provider = the company/platform we call. Model = the specific AI it runs for us.
// Names/details are confidential and come ONLY from Super-Admin endpoints — never
// hard-code them in the frontend.
export interface AiProvider { provider: string; model: string; enabled: boolean; priority: number }
export interface AiProviderStatus extends AiProvider {
  label: string; available: boolean; vision: boolean; description: string; standard_model: string; not_ready_hint: string
}
export interface AiStatus {
  providers: AiProviderStatus[]
  keys: { name: string; hint: string; configured: boolean }[]
}

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
export interface MyUsage {
  spent_usd: number; cap_usd: number | null; remaining_usd: number | null; requests: number; tokens: number
  today_usd: number; daily_cap_usd: number | null; daily_remaining_usd: number | null
}
export interface UserLimit {
  id: string; username: string; name: string; role: string; active: boolean
  spent_usd: number; cap_usd: number | null; remaining_usd: number | null
  today_usd: number; daily_cap_usd: number | null; daily_remaining_usd: number | null
  status: 'ok' | 'near' | 'daily_reached' | 'total_reached'
}
export async function getUsageLimits(): Promise<UserLimit[]> {
  return (await jsonOrThrow<{ items: UserLimit[] }>(await fetch(`${apiBase()}/api/usage/limits`, { headers: authHeaders() }), 'Loading user limits')).items
}
export interface UsageFilters {
  days: number; date_from: string; date_to: string
  user: string; provider: string; model: string; feature: string; status: '' | 'ok' | 'failed'
}
export interface UsageGroup {
  requests: number; failed: number; tokens_in: number; tokens_out: number; cost_usd: number; first_ts: number; last_ts: number
  avg_seconds: number | null; max_seconds: number | null
}
export interface UsageSummary {
  total_cost_usd: number; total_tokens: number; tokens_in: number; tokens_out: number
  requests: number; failed: number; success_rate: number; active_users: number; avg_seconds: number | null
  by_day: (UsageGroup & { day: string })[]
  by_model: (UsageGroup & { provider: string; provider_label: string; model: string })[]
  by_feature: (UsageGroup & { feature: string })[]
  by_user: (UsageGroup & { user: string })[]
  by_user_model: (UsageGroup & { user: string; provider: string; provider_label: string; model: string })[]
}
export interface UsageEntry {
  id: string; ts: number; user: string; provider: string; provider_label: string; model: string; feature: string
  tokens_in: number; tokens_out: number; cost_usd: number; ok: boolean; seconds?: number
}
export interface UsageOptions { users: string[]; providers: { id: string; label: string }[]; models: string[]; features: string[] }
function usageQuery(f: UsageFilters): string {
  const q = new URLSearchParams({ tz_offset_min: String(-new Date().getTimezoneOffset()) })
  if (f.date_from || f.date_to) { if (f.date_from) q.set('date_from', f.date_from); if (f.date_to) q.set('date_to', f.date_to) }
  else q.set('days', String(f.days))
  for (const k of ['user', 'provider', 'model', 'feature', 'status'] as const) if (f[k]) q.set(k, f[k])
  return q.toString()
}
export interface ProviderAccount {
  label: string; api_key_hint: string; management_key_hint: string
  api_key_configured: boolean; management_key_configured: boolean
  key: null | { error?: string; label?: string; usage_usd?: number | null; limit_usd?: number | null; limit_remaining_usd?: number | null; is_free_tier?: boolean }
  credits: null | { error?: string; total_credits_usd?: number | null; total_usage_usd?: number | null; balance_usd?: number | null }
}
export async function getMyUsage(): Promise<MyUsage> {
  if (!backendOn()) { await wait(80); return { spent_usd: 0, cap_usd: null, remaining_usd: null, requests: 0, tokens: 0, today_usd: 0, daily_cap_usd: null, daily_remaining_usd: null } }
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/me`, { headers: authHeaders() }), 'Loading your usage')
}
export async function getUsageSummary(f: UsageFilters): Promise<UsageSummary> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/summary?${usageQuery(f)}`, { headers: authHeaders() }), 'Loading usage summary')
}
export async function getUsageRecent(f: UsageFilters, limit = 200): Promise<UsageEntry[]> {
  return (await jsonOrThrow<{ items: UsageEntry[] }>(await fetch(`${apiBase()}/api/usage/recent?limit=${limit}&${usageQuery(f)}`, { headers: authHeaders() }), 'Loading call log')).items
}
export async function getUsageOptions(): Promise<UsageOptions> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/options`, { headers: authHeaders() }), 'Loading filters')
}
export async function downloadUsageCsv(f: UsageFilters): Promise<void> {
  const r = await fetch(`${apiBase()}/api/usage/export.csv?${usageQuery(f)}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Export failed (${r.status})`)
  const url = URL.createObjectURL(await r.blob())
  const a = document.createElement('a'); a.href = url; a.download = `ai-usage-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000)
}
export async function getProviderAccount(): Promise<ProviderAccount> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/provider-account`, { headers: authHeaders() }), 'Loading provider balance')
}

// ---- Live model catalog (Super Admin only) ------------------------------------
export interface CatalogModel {
  id: string; name: string; vision: boolean; context: number | null
  price_in_per_1m: number | null; price_out_per_1m: number | null; free: boolean; stage: string
}
export interface ModelCatalog { provider: string; models: CatalogModel[]; fetched_at: number; error: string }
export interface ModelTestResult { ok: boolean; detail: string; seconds?: number; tokens?: number }
export async function getModelCatalog(provider: string, force = false): Promise<ModelCatalog> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/ai-settings/models?provider=${encodeURIComponent(provider)}${force ? '&force=true' : ''}`, { headers: authHeaders() }), 'Loading models')
}
export async function testModel(provider: string, model: string): Promise<ModelTestResult> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/ai-settings/test-model`, {
    method: 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, model }),
  }), 'Testing model')
}
