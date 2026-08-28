import { useState } from 'react'
import { PageTitle, Card, Badge, Icon, Button } from '../components/ui'

function EditableList({ title, icon, initial, badge }: { title: string; icon: string; initial: string[]; badge?: string }) {
  const [items, setItems] = useState<string[]>(initial)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)

  function save(i: number) { setItems((xs) => xs.map((x, j) => j === i ? draft : x)); setEditing(null) }
  function add() { if (draft.trim()) setItems((xs) => [...xs, draft.trim()]); setDraft(''); setAdding(false) }
  const inp = 'flex-1 text-sm border border-outline-variant rounded-md px-2 py-1'

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">{title}</h3>
        <button onClick={() => { setAdding(true); setDraft(''); setEditing(null) }} className="text-xs text-primary flex items-center gap-1"><Icon name="add" className="text-[15px]" />Add</button>
      </div>
      {adding && (
        <div className="flex items-center gap-2 py-1.5">
          <Icon name={icon} className="text-outline" /><input autoFocus className={inp} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="New item…" />
          <button onClick={add} className="text-xs text-primary">Save</button>
          <button onClick={() => setAdding(false)} className="text-xs text-outline">Cancel</button>
        </div>
      )}
      {items.map((t, i) => (
        <div key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-outline-variant/40 last:border-0">
          <Icon name={icon} className="text-outline" />
          {editing === i ? (
            <><input className={inp} value={draft} onChange={(e) => setDraft(e.target.value)} />
              <button onClick={() => save(i)} className="text-xs text-primary">Save</button></>
          ) : (
            <><span className="flex-1">{t}</span>
              {badge && <Badge className="bg-surface-container">{badge}</Badge>}
              <button onClick={() => { setEditing(i); setDraft(t); setAdding(false) }} className="text-xs text-primary">Edit</button>
              <button onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))} className="text-xs text-status-rejected">Delete</button></>
          )}
        </div>
      ))}
    </Card>
  )
}

function BusinessRules() {
  const [rules, setRules] = useState([
    { text: '60-day submission window', on: true },
    { text: 'ID copy mandatory', on: true },
    { text: 'JD2 authority ≤ 300,000 MMK', on: true },
    { text: 'Accepted banks: AYA, CB, KBZ, YOMA', on: true },
    { text: 'Vaccination — JD2 can approve', on: false },
  ])
  return (
    <Card className="p-5">
      <h3 className="font-semibold text-sm mb-3">Business rules</h3>
      {rules.map((r, i) => (
        <label key={i} className="flex items-center gap-2 text-sm py-1.5 border-b border-outline-variant/40 last:border-0 cursor-pointer">
          <Icon name="gavel" className="text-outline" />
          <span className={`flex-1 ${r.on ? '' : 'text-outline line-through'}`}>{r.text}</span>
          <input type="checkbox" checked={r.on} onChange={() => setRules((rs) => rs.map((x, j) => j === i ? { ...x, on: !x.on } : x))} />
        </label>
      ))}
    </Card>
  )
}

export function SettingsPage() {
  const [saved, setSaved] = useState(false)
  return (
    <div>
      <PageTitle title="Settings — Templates, Checklists & Rules" sub="What the AI uses to check and reply (managed by Admin)."
        action={<div className="flex items-center gap-3">{saved && <span className="text-sm text-status-approved flex items-center gap-1"><Icon name="check_circle" className="text-[18px]" />Saved</span>}<Button onClick={() => setSaved(true)}>Save all</Button></div>} />
      <div className="grid grid-cols-2 gap-4">
        <EditableList title="Reply templates" icon="mail" badge="EN · MM"
          initial={['Request missing documents', 'Claim received acknowledgement', 'LOG issued', 'Rejection — policy exclusion']} />
        <EditableList title="Document checklists (per insurer)" icon="checklist"
          initial={['AYA Sompo — New claim', 'AYA Sompo — LOG', 'MGEN — New claim', 'MGEN — LOG']} />
        <BusinessRules />
        <EditableList title="Tables of Benefits" icon="table"
          initial={['AYA Health — 4 plan tiers', 'MGEN Prestige+ Elite', 'Myanma Insurance — MI Health']} />
      </div>
    </div>
  )
}
