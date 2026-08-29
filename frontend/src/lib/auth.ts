const API = import.meta.env.VITE_API_BASE_URL as string | undefined
const USE_MOCKS = (import.meta.env.VITE_USE_MOCKS ?? 'true') === 'true'
// Backend is on whenever mocks are off. apiBase is the explicit URL (local dev) or '' = same origin
// (when the FastAPI service also serves this built frontend on Cloud Run). Mocks on -> demo mode.
export const backendOn = () => !USE_MOCKS
export const apiBase = () => API ?? ''

export function getToken() { return localStorage.getItem('cf_token') }
export function getRole() { return localStorage.getItem('cf_role') || 'super_admin' }
export function getName() { return localStorage.getItem('cf_name') || 'Admin' }
export function getAvatar() { return localStorage.getItem('cf_avatar') || '' }
export function setAvatar(dataUrl: string) {
  if (dataUrl) localStorage.setItem('cf_avatar', dataUrl); else localStorage.removeItem('cf_avatar')
  window.dispatchEvent(new Event('cf-avatar'))
}
export function setSession(t: string, r: string, n: string) { localStorage.setItem('cf_token', t); localStorage.setItem('cf_role', r); localStorage.setItem('cf_name', n) }
export function clearSession() { ['cf_token', 'cf_role', 'cf_name'].forEach((k) => localStorage.removeItem(k)) }
export function authHeaders(): Record<string, string> { const t = getToken(); return t ? { Authorization: `Bearer ${t}` } : {} }

export async function login(username: string, password: string): Promise<{ ok: boolean; error?: string }> {
  if (!backendOn()) { setSession('demo', 'super_admin', 'Admin'); return { ok: true } } // demo mode
  try {
    const r = await fetch(`${apiBase()}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ username, password }) })
    if (!r.ok) return { ok: false, error: 'Invalid username or password' }
    const d = await r.json(); setSession(d.access_token, d.role, d.name); return { ok: true }
  } catch { return { ok: false, error: 'Cannot reach the server — is the backend running?' } }
}
