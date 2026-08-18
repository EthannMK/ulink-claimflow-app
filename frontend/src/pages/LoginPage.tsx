import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../components/ui'
import { login, backendOn } from '../lib/auth'
export function LoginPage() {
  const nav = useNavigate()
  const [username, setU] = useState(backendOn() ? 'superadmin' : 'admin@ulink.com')
  const [password, setP] = useState(backendOn() ? 'super123' : 'password')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true); setErr('')
    const r = await login(username, password)
    setBusy(false)
    if (r.ok) nav('/inbox'); else setErr(r.error || 'Login failed')
  }
  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-b from-surface to-surface-container px-4">
      <div className="w-[400px] bg-white rounded-2xl border border-outline-variant shadow-md p-8">
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/brand-logo.png" alt="Ulink" className="h-16 w-auto mb-2" />
          <div className="font-display font-bold text-primary text-lg leading-tight">Ulink ClaimFlow</div>
          <div className="text-xs text-text-main">AI claims workspace</div>
        </div>
        <h1 className="font-display text-xl font-bold text-on-surface mb-1">Sign in</h1>
        <p className="text-sm text-text-main mb-5">Welcome back. Please enter your details.</p>
        <label className="block text-sm font-medium text-on-surface mb-1">{backendOn() ? 'Username' : 'Email'}</label>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2.5 mb-3 focus-within:ring-2 focus-within:ring-primary/20">
          <Icon name="person" className="text-[20px] text-outline" />
          <input value={username} onChange={(e) => setU(e.target.value)} className="bg-transparent outline-none text-sm w-full" />
        </div>
        <label className="block text-sm font-medium text-on-surface mb-1">Password</label>
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2.5 mb-2 focus-within:ring-2 focus-within:ring-primary/20">
          <Icon name="lock" className="text-[20px] text-outline" />
          <input type="password" value={password} onChange={(e) => setP(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} className="bg-transparent outline-none text-sm w-full" />
        </div>
        {err && <p className="text-xs text-status-rejected mb-2">{err}</p>}
        <label className="flex items-center gap-2 text-sm text-text-main mb-5 mt-3"><input type="checkbox" defaultChecked className="accent-primary" /> Remember me</label>
        <button onClick={submit} disabled={busy} className="w-full bg-primary text-white rounded-lg py-2.5 text-sm font-semibold hover:bg-primary-dark shadow-sm transition-colors disabled:opacity-60">{busy ? 'Signing in…' : 'Sign in'}</button>
        {backendOn() && <p className="text-[11px] text-outline text-center mt-3">Try: superadmin / super123 · admin / admin123 · jd1 / user123</p>}
      </div>
    </div>
  )
}
