import { useState } from 'react'
import { PageTitle, Card, Button, Icon } from '../components/ui'
import { getName } from '../lib/auth'

export function MyProfilePage() {
  const [name, setName] = useState(getName())
  const [lang, setLang] = useState('English')
  const [email, setEmail] = useState(true)
  const [inApp, setInApp] = useState(true)
  const [saved, setSaved] = useState(false)

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
      </div>
    </div>
  )
}
