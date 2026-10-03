import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/ui'
import { login, backendOn } from '../lib/auth'

export function LoginPage() {
  const nav = useNavigate()
  const [params] = useSearchParams()
  const expired = params.get('expired') === '1'
  const next = params.get('next') || ''
  const [username, setU] = useState(backendOn() ? '' : 'admin@ulink.com')
  const [password, setP] = useState(backendOn() ? '' : 'password')
  const [show, setShow] = useState(false)
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)

  async function submit() {
    if (!username.trim() || !password) { setErr('Enter your username and password.'); return }
    setBusy(true); setErr('')
    const r = await login(username.trim(), password)
    setBusy(false)
    // only go back to a page inside the app
    if (r.ok) nav(next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : '/inbox', { replace: true })
    else setErr(r.error || 'Sign-in failed')
  }

  return (
    <div className="min-h-screen grid lg:grid-cols-[1.05fr_1fr] bg-surface">
      {/* brand panel */}
      <aside className="hidden lg:flex relative overflow-hidden flex-col justify-between p-12 bg-[rgb(0_55_94)] text-[rgb(232_240_250)]">
        <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '22px 22px' }} aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <div className="bg-[rgb(255_255_255)] rounded-xl p-1.5"><img src="/brand-logo.png" alt="" className="h-9 w-auto" /></div>
          <div><div className="font-display font-bold text-lg leading-tight text-[rgb(255_255_255)]">Ulink ClaimFlow</div><div className="text-xs opacity-80">Ulink Assist Myanmar</div></div>
        </div>
        <div className="relative max-w-md">
          <h2 className="font-display text-[34px] leading-[1.15] font-bold text-[rgb(255_255_255)]">Claims, read and checked in minutes.</h2>
          <p className="mt-4 text-[15px] leading-relaxed opacity-85">Scan a claim packet, review every page the AI read, and hand a complete note to adjudication — with the documents, required fields and checks in one place.</p>
          <ul className="mt-8 grid gap-3 text-sm">
            {[['document_scanner', 'JD1 scan: note, full detection and required fields for every document'],
              ['rule', 'JD2 review with the original documents beside the AI reading'],
              ['monitoring', 'AI usage and limits per user, in tokens']].map(([ic, t]) => (
              <li key={ic} className="flex items-start gap-3"><span className="w-8 h-8 shrink-0 rounded-lg bg-[rgb(255_255_255/0.1)] grid place-items-center"><Icon name={ic} className="text-[18px]" /></span><span className="pt-1.5 opacity-90">{t}</span></li>
            ))}
          </ul>
        </div>
        <div className="relative text-xs opacity-70">Authorised Ulink staff only. Activity is recorded in the audit log.</div>
      </aside>

      {/* form */}
      <main className="flex items-center justify-center px-5 py-10">
        <div className="w-full max-w-[380px]">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <img src="/brand-logo.png" alt="" className="h-10 w-auto" />
            <div><div className="font-display font-bold text-primary leading-tight">Ulink ClaimFlow</div><div className="text-xs text-text-main">AI claims workspace</div></div>
          </div>
          <h1 className="font-display text-[26px] font-bold text-on-surface tracking-tight">Sign in</h1>
          <p className="text-sm text-text-main mt-1 mb-6">Use the username and password your administrator gave you.</p>

          {expired && !err && (
            <div className="flex items-start gap-2 rounded-lg border border-status-pending/40 bg-status-pending/[0.07] px-3 py-2.5 mb-4 text-sm text-on-surface" role="status">
              <Icon name="schedule" className="text-[18px] text-status-pending mt-px" />Your session has ended. Sign in again to continue where you were.
            </div>
          )}

          <form className="grid gap-4" onSubmit={(e) => { e.preventDefault(); submit() }} noValidate>
            <div className="grid gap-1.5">
              <label htmlFor="login-user" className="text-sm font-medium text-on-surface">{backendOn() ? 'Username' : 'Email'}</label>
              <input id="login-user" value={username} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus spellCheck={false}
                className="h-11 rounded-lg border border-outline-variant px-3 text-sm" />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor="login-pass" className="text-sm font-medium text-on-surface">Password</label>
              <div className="relative">
                <input id="login-pass" type={show ? 'text' : 'password'} value={password} onChange={(e) => setP(e.target.value)} autoComplete="current-password"
                  className="h-11 w-full rounded-lg border border-outline-variant pl-3 pr-11 text-sm" aria-describedby={err ? 'login-err' : undefined} />
                <button type="button" onClick={() => setShow((v) => !v)} className="absolute right-1.5 top-1.5 w-8 h-8 grid place-items-center rounded-md text-outline hover:text-on-surface hover:bg-surface-container"
                  aria-label={show ? 'Hide password' : 'Show password'}><Icon name={show ? 'visibility_off' : 'visibility'} className="text-[19px]" /></button>
              </div>
            </div>
            {err && <p id="login-err" role="alert" className="flex items-center gap-1.5 text-sm text-status-rejected"><Icon name="error" className="text-[17px]" />{err}</p>}
            <button type="submit" disabled={busy}
              className="h-11 mt-1 rounded-lg bg-primary text-white text-sm font-semibold hover:bg-primary/90 shadow-sm transition-colors disabled:opacity-60 inline-flex items-center justify-center gap-2">
              {busy && <span className="w-4 h-4 rounded-full border-2 border-current border-r-transparent animate-spin" aria-hidden="true" />}{busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
          <p className="text-xs text-outline mt-6">Forgot your password? Ask your administrator to reset it in Users &amp; Teams.</p>
        </div>
      </main>
    </div>
  )
}
