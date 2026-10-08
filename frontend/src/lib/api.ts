import type { Claim, ClaimList, User } from './types'
import { mockClaims } from '../mocks/claims'
import { mockUsers } from '../mocks/users'
import { mockConfirmations, ConfirmationRecord } from '../mocks/confirmations'
import { mockNotifs, Notif } from '../mocks/notifications'
import { backendOn, apiBase, authHeaders } from './auth'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function listClaims(): Promise<ClaimList> {
  if (!backendOn()) { await wait(120); return { items: mockClaims, page: 1, total: mockClaims.length } }
  const r = await fetch(`${apiBase()}/api/claims`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Loading tickets failed (${r.status})`)
  return r.json()
}
/** A ticket, or null when it doesn't exist (deleted). Other failures throw. */
export async function getClaim(id: string): Promise<Claim | null> {
  if (!backendOn()) { await wait(100); return mockClaims.find((c) => c.id === id) ?? null }
  const r = await fetch(`${apiBase()}/api/claims/${id}`, { headers: authHeaders() })
  if (r.status === 404) return null
  if (!r.ok) throw new Error(`Loading the ticket failed (${r.status})`)
  return r.json()
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
// ---- Cloud costs (Super Admin): Google Cloud bill + backup AI, by component / day / month ----
export interface CostComponent { component: string; source: string; cost: number; credits: number; net: number; share: number; forecast?: number; forecast_net?: number; pace_per_day?: number }
export interface CloudCosts {
  month: string; is_current: boolean; currency: string; google_ok: boolean; google_error: string; table: string
  updated: string | null; fetched_at: string
  /** every amount in this object is USD; the page converts it with `rate` (units of `code` per 1 USD) */
  currency_info: { code: string; rate: number; source: 'base' | 'google' | 'live' | 'manual' | 'unavailable'; bill: string | null
                   bill_rate: number | null; manual_rate: number | null; live_date: string; auto: boolean; options: string[] }
  /** the month as Google's console shows it, in the bill's own currency */
  bill_native: { currency: string; cost: number; credits: number; net: number } | null
  totals: { cost: number; credits: number; net: number; last_month_net: number | null; last_month_gross: number | null }
  forecast: { net: number; pace_per_day: number; days_left: number; low: number; high: number; method: string; gross: number; gross_pace_per_day: number } | null
  budget: { amount: number; used_pct: number | null; forecast_pct: number | null } | null
  credits_info: { trial_total: number; used: number; left: number; this_month: number; days_left_at_pace: number | null
                  by_type: { type: string; name: string; amount: number }[] } | null
  sources: {
    google: { ok: boolean; error: string; updated: string | null }
    backup_ai: { ok: boolean; error: string; checked: string | null; credits_total: number | null; usage_total: number | null; credits_left: number | null; covered_days: number }
  }
  pricing: {
    users: { user: string; name: string; calls: number; jd1_notes: number; ai: number; infra: number; total: number; per_note: number | null; client_tokens: number | null }[]
    ai_scale: number; all_in_cost: number; jd1_notes: number; per_jd1_note: number | null; token_rate: number | null
    break_even_per_1m_tokens: number | null; basis: string
  }
  components: CostComponent[]
  by_day: { day: string; net: number; gross: number; components: Record<string, number>; future: boolean; projected?: number }[]
  by_month: { month: string; google: number; other: number; credits: number; net: number; gross: number; forecast?: number }[]
  skus: { component: string; sku: string; cost: number; credits: number; net: number }[]
  ai: { google_bill: { component: string; net: number }[]; backup: number; note: string
        by_feature: { feature: string; calls: number; tokens: number; cost: number; by_provider: Record<string, number> }[] }
}
export interface CostSettings { dataset: string; budget_usd: number | null; trial_credit_usd: number | null; default_dataset?: string }
export async function getCloudCosts(month: string, refresh = false): Promise<CloudCosts> {
  const q = new URLSearchParams({ month, months: '6', ...(refresh ? { refresh: 'true' } : {}) })
  return jsonOrThrow(await fetch(`${apiBase()}/api/cloud-costs/overview?${q}`, { headers: authHeaders() }), 'Loading cloud costs')
}
export async function saveCostCurrency(code: string, rate: number | null): Promise<unknown> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/cloud-costs/currency`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ code, rate }),
  }), 'Saving the currency')
}
export async function getCostSettings(): Promise<CostSettings> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/cloud-costs/settings`, { headers: authHeaders() }), 'Loading cost settings')
}
export async function saveCostSettings(s: CostSettings): Promise<CostSettings> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/cloud-costs/settings`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset: s.dataset, budget_usd: s.budget_usd, trial_credit_usd: s.trial_credit_usd }),
  }), 'Saving cost settings')
}
export interface ConsistencySettings { enabled: boolean; fields: ('name' | 'nrc' | 'dob' | 'policy')[] }
export async function getConsistency(): Promise<ConsistencySettings> {
  if (!backendOn()) return { enabled: true, fields: ['name'] }
  return jsonOrThrow(await fetch(`${apiBase()}/api/settings/consistency`, { headers: authHeaders() }), 'Loading consistency settings')
}
export async function saveConsistency(s: ConsistencySettings): Promise<ConsistencySettings> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/settings/consistency`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(s),
  }), 'Saving consistency settings')
}
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
/** Own allowance. Everyone gets client tokens; the *_usd fields come back for the Super Admin only. */
export interface MyUsage extends AllowancePeriod {
  requests: number
  used_tokens: number; cap_tokens: number | null; remaining_tokens: number | null
  today_tokens: number; daily_cap_tokens: number | null; daily_remaining_tokens: number | null
  spent_usd?: number; cap_usd?: number | null; today_usd?: number; daily_cap_usd?: number | null
  real_tokens?: number; usd_per_1m_tokens?: number
}
/** The current allowance period: 'monthly' renews on the 1st; a reset by the admin also starts a new one. */
export interface AllowancePeriod {
  period: 'none' | 'monthly'; period_start: number | null; renews_on: string | null
  last_reset: { at: number; reason: string; by: string; used_tokens: number | null } | null
}
export interface Billing { usd_per_1m_tokens: number; default: number; actual: { usd_per_1m_tokens: number | null; calls: number; tokens: number } }
export async function getBilling(): Promise<Billing> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/billing`, { headers: authHeaders() }), 'Loading token rate')
}
export async function saveBilling(usd_per_1m_tokens: number): Promise<Billing> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/billing`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ usd_per_1m_tokens }),
  }), 'Saving token rate')
}
export interface UserLimit extends AllowancePeriod {
  id: string; username: string; name: string; role: string; active: boolean
  spent_usd: number; cap_usd: number | null; remaining_usd: number | null
  today_usd: number; daily_cap_usd: number | null; daily_remaining_usd: number | null
  used_tokens: number | null; cap_tokens: number | null; today_tokens: number | null; daily_cap_tokens: number | null
  status: 'ok' | 'near' | 'daily_reached' | 'total_reached'
  history: { start: number | null; end: number; reason: string; by: string; spent_usd: number; used_tokens: number | null; cap_usd: number | null; cap_tokens: number | null }[]
}
export interface AllowanceChange {
  total_usd?: number | null; daily_usd?: number | null; clear_total?: boolean; clear_daily?: boolean; keep_total?: boolean; keep_daily?: boolean
  period?: 'none' | 'monthly'; reset_total?: boolean; reset_today?: boolean; reason?: string
}
export async function saveAllowance(userId: string, body: AllowanceChange): Promise<UserLimit> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/usage/limits/${userId}`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), 'Saving the AI allowance')
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
/** One row per scan / AI task of the signed-in user: task name + client tokens (no provider or model). */
export interface MyUse { task: string; when: number; ended: number; steps: number; tokens: number; status: 'ok' | 'failed'; usd?: number }
export async function getMyHistory(limit = 50): Promise<MyUse[]> {
  if (!backendOn()) { await wait(80); return [] }
  const d = await jsonOrThrow<{ items: MyUse[] }>(await fetch(`${apiBase()}/api/usage/me/history?limit=${limit}`, { headers: authHeaders() }), 'Loading your AI use')
  return d.items
}
export async function getMyUsage(): Promise<MyUsage> {
  if (!backendOn()) { await wait(80); return { requests: 0, used_tokens: 0, cap_tokens: null, remaining_tokens: null, today_tokens: 0, daily_cap_tokens: null, daily_remaining_tokens: null, period: "none", period_start: null, renews_on: null, last_reset: null } }
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

// ---- Teams (server-side, shared) ---------------------------------------------
export interface Team { id: string; name: string; lead: string; members: string[] }
export async function listTeams(): Promise<Team[]> {
  if (!backendOn()) { await wait(60); return [] }
  return jsonOrThrow(await fetch(`${apiBase()}/api/teams`, { headers: authHeaders() }), 'Loading teams')
}
export async function saveTeam(t: { id?: string; name: string; lead: string; members: string[] }): Promise<Team> {
  const url = t.id ? `${apiBase()}/api/teams/${t.id}` : `${apiBase()}/api/teams`
  return jsonOrThrow(await fetch(url, {
    method: t.id ? 'PUT' : 'POST', headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: t.name, lead: t.lead, members: t.members }),
  }), 'Saving team')
}
export async function removeTeam(id: string): Promise<void> {
  await jsonOrThrow(await fetch(`${apiBase()}/api/teams/${id}`, { method: 'DELETE', headers: authHeaders() }), 'Deleting team')
}
export async function getMySecurity(): Promise<{ default_password: boolean }> {
  if (!backendOn()) return { default_password: false }
  return jsonOrThrow(await fetch(`${apiBase()}/api/me/security`, { headers: authHeaders() }), 'Loading account security')
}

// ---- per-feature model overrides (Super Admin) --------------------------------
export type FeatureModels = Record<string, Record<string, string>>   // task -> provider -> model id
export interface TaskModels {
  models: FeatureModels; allow_free_for_documents: boolean; free_warning: string
  tasks: { name: string; documents: boolean; hint: string }[]
}
export async function getFeatureModels(): Promise<TaskModels> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/ai-settings/feature-models`, { headers: authHeaders() }), 'Loading task models')
}
export async function saveFeatureModels(models: FeatureModels, allow_free_for_documents: boolean): Promise<TaskModels> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/ai-settings/feature-models`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ models, allow_free_for_documents }),
  }), 'Saving task models')
}

// ---- AI prompts (Super Admin) --------------------------------------------------
export interface PromptInfo {
  id: string; name: string; feature: string; output: 'json' | 'text'; description: string; note: string
  custom: boolean; updated_at: string; updated_by: string
}
export interface PromptDetail extends PromptInfo { text: string; default: string }
export interface PromptTestResult {
  ok: boolean; output: string; error: string; seconds: number; tokens_in?: number; tokens_out?: number
  json_ok: boolean | null; provider_label: string; model: string
}
export async function listPrompts(): Promise<PromptInfo[]> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/prompts`, { headers: authHeaders() }), 'Loading prompts')
}
export async function getPrompt(id: string): Promise<PromptDetail> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/prompts/${id}`, { headers: authHeaders() }), 'Loading prompt')
}
export async function savePrompt(id: string, text: string): Promise<PromptDetail> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/prompts/${id}`, {
    method: 'PUT', headers: { ...authHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
  }), 'Saving prompt')
}
export async function resetPrompt(id: string): Promise<PromptDetail> {
  return jsonOrThrow(await fetch(`${apiBase()}/api/prompts/${id}`, { method: 'DELETE', headers: authHeaders() }), 'Resetting prompt')
}
export async function testPrompt(id: string, text: string, opts: { sample?: string; file?: File | null; provider?: string }): Promise<PromptTestResult> {
  const fd = new FormData()
  fd.append('text', text); fd.append('sample_text', opts.sample ?? ''); fd.append('provider', opts.provider ?? '')
  if (opts.file) fd.append('file', opts.file, opts.file.name)
  return jsonOrThrow(await fetch(`${apiBase()}/api/prompts/${id}/test`, { method: 'POST', headers: authHeaders(), body: fd }), 'Testing prompt')
}
