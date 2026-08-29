import { useState } from 'react'
import { PageTitle, Card, Button, Icon } from '../components/ui'
import { getName } from '../lib/auth'
import { changeMyPassword } from '../lib/api'

export function MyProfilePage() {
  const [name, setName] = useState(getName())
  const [lang, setLang] = useState('English')
  const [email, setEmail] = useState(true)
  const [inApp, setInApp] = useState(true)
  const [saved, setSaved] = useState(false)
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pwMsg, setPwMsg] = useState('')
  const [pwErr, setPwErr] = useState(false)

  async function submitPassword() {
    setPwMsg(''); setPwErr(false)
    if (nw.length < 6) { setPwErr(true); setPwMsg('New password must be at least 6 characters'); return }
    if (nw !== confirm) { setPwErr(true); setPwMsg('New passwords do not match'); return }
    const r = await changeMyPassword(cur, nw)
    if (r.ok) { setPwMsg('Password changed ✓'); setCur(''); setNw(''); setConfirm('') }
    else { setPwErr(true); setPwMsg((await r.json().catch(() => ({}))).detail || 'Failed to change password') }
  }

  return (
    <div>
      <PageTitle title="My Profile & Preferences" />
      <div className="grid grid-cols-3 gap-4">
        <Card className="p-5 text-center">
          <div className="w-20 h-20 rounded-full bg-primary text-white grid place-items-center text-2xl font-display font-bold mx-auto mb-3">{name[0]?.toUpperCase() || 'A'}</div>
          <div className="font-semibold">{name}</div>
          <div className="text-sm text-text-main">admin@ulink.com</div>
          <div className="text-xs text-outline mt-1">Role: Admin · Team: Ops</div>
        </Card>
        <Card className="col-span-2 p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Display name</label>
            <input value={name} onChange={(e) => { setName(e.target.value); setSaved(false) }} className="w-full text-sm border border-outline-variant rounded-md px-3 py-2" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Language</label>
            <select value={lang} onChange={(e) => { setLang(e.target.value); setSaved(false) }} className="w-full text-sm border border-outline-variant rounded-md px-3 py-2"><option>English</option><option>Burmese</option></select>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={email} onChange={(e) => { setEmail(e.target.checked); setSaved(false) }} /> Email notifications</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inApp} onChange={(e) => { setInApp(e.target.checked); setSaved(false) }} /> In-app notifications</label>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={() => setSaved(true)}>Save changes</Button>
            {saved && <span className="text-sm text-status-approved flex items-center gap-1"><Icon name="check_circle" className="text-[18px]" />Saved</span>}
          </div>
        </Card>

        <Card className="col-span-3 p-5">
          <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Icon name="lock" className="text-[18px] text-primary" />Change my password</h3>
          <div className="grid grid-cols-3 gap-3 max-w-2xl">
            <div><label className="block text-xs text-text-main mb-1">Current password</label><input type="password" value={cur} onChange={(e) => setCur(e.target.value)} className="w-full text-sm border border-outline-variant rounded-md px-3 py-2" /></div>
            <div><label className="block text-xs text-text-main mb-1">New password</label><input type="password" value={nw} onChange={(e) => setNw(e.target.value)} className="w-full text-sm border border-outline-variant rounded-md px-3 py-2" /></div>
            <div><label className="block text-xs text-text-main mb-1">Confirm new</label><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className="w-full text-sm border border-outline-variant rounded-md px-3 py-2" /></div>
          </div>
          <div className="flex items-center gap-3 mt-3">
            <Button onClick={submitPassword}>Update password</Button>
            {pwMsg && <span className={`text-sm ${pwErr ? 'text-status-rejected' : 'text-status-approved'}`}>{pwMsg}</span>}
          </div>
        </Card>
      </div>
    </div>
  )
}
