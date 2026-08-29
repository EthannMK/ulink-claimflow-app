import { useState } from 'react'
import { PageTitle, Card, Badge, Icon, Button } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'
import { DEFAULT_INSURERS, type InsurerConfig, type FieldType } from '../lib/insurers'

// ---------- data shapes ----------
interface Template { id: string; name: string; channel: string; subject: string; bodyEn: string; bodyMm: string }
interface ChecklistItem { name: string; mandatory: boolean; aiHint: string }
interface Checklist { id: string; insurer: string; claimType: string; items: ChecklistItem[] }
interface Rule { id: string; text: string; enabled: boolean }
interface Benefit { name: string; limit: string }
interface Tob { id: string; plan: string; benefits: Benefit[] }

const SECTIONS = ['Insurers & Fields', 'Reply templates', 'Document checklists', 'Business rules', 'Tables of Benefits'] as const
const inp = 'w-full text-sm border border-outline-variant rounded-md px-2 py-1.5'
const FIELD_TYPES: FieldType[] = ['text', 'number', 'amount', 'date', 'select', 'textarea']

export function SettingsPage() {
  const [tab, setTab] = useState<(typeof SECTIONS)[number]>('Reply templates')
  return (
    <div>
      <PageTitle title="Settings" sub="Templates, checklists, rules and benefits the AI and staff use. Changes are saved automatically." />
      <div className="flex items-center gap-1 mb-4 bg-surface-container rounded-xl p-1 w-fit">
        {SECTIONS.map((s) => (
          <button key={s} onClick={() => setTab(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === s ? 'bg-white text-primary shadow-sm' : 'text-text-main hover:text-primary'}`}>{s}</button>
        ))}
      </div>
      {tab === 'Insurers & Fields' && <Insurers />}
      {tab === 'Reply templates' && <Templates />}
      {tab === 'Document checklists' && <Checklists />}
      {tab === 'Business rules' && <Rules />}
      {tab === 'Tables of Benefits' && <Benefits />}
    </div>
  )
}

// ---------- Insurers & Fields (drives New Claim, JD1/JD2 display, AI extraction) ----------
function Insurers() {
  const [items, setItems] = usePersistent<InsurerConfig[]>('settings.insurers', DEFAULT_INSURERS)
  const [sel, setSel] = useState<string | null>(items[0]?.id ?? null)
  const cur = items.find((i) => i.id === sel) || null
  function upd(p: Partial<InsurerConfig>) { if (!cur) return; setItems(items.map((i) => i.id === cur.id ? { ...i, ...p } : i)) }
  function addInsurer() { const c: InsurerConfig = { id: genId(), name: 'New insurer', fields: [] }; setItems([...items, c]); setSel(c.id) }
  function addField() { if (!cur) return; upd({ fields: [...cur.fields, { id: genId(), label: '', type: 'text', required: false, aiHint: '', options: '' }] }) }
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-3 p-3 h-fit">
        <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-sm">Insurers</h3><button onClick={addInsurer} className="text-xs text-primary flex items-center gap-1"><Icon name="add" className="text-[15px]" />New</button></div>
        {items.map((i) => (
          <button key={i.id} onClick={() => setSel(i.id)} className={`w-full text-left px-2 py-2 rounded-md text-sm flex items-center gap-2 ${sel === i.id ? 'bg-primary/[0.07] text-primary' : 'hover:bg-surface-container'}`}>
            <Icon name="shield" className="text-[16px]" /><span className="flex-1 truncate">{i.name}</span><Badge className="bg-surface-container">{i.fields.length}</Badge>
          </button>
        ))}
      </Card>
      <Card className="col-span-9 p-5">
        {!cur ? <p className="text-sm text-text-main text-center py-10">Select an insurer, or click <b>New</b>.</p> : (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="flex-1"><label className="block text-xs text-text-main mb-1">Insurer name</label><input className={inp} value={cur.name} onChange={(e) => upd({ name: e.target.value })} /></div>
              <button onClick={() => { setItems(items.filter((i) => i.id !== cur.id)); setSel(null) }} className="text-xs text-status-rejected mt-5">Delete insurer</button>
            </div>
            <div className="flex items-center justify-between"><label className="text-xs text-text-main font-semibold">Fields the system reads from this insurer's documents</label>
              <button onClick={addField} className="text-xs text-primary">+ Add field</button></div>
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 text-[11px] text-outline uppercase tracking-wide px-1">
                <span className="col-span-3">Label</span><span className="col-span-2">Type</span><span className="col-span-1">Req</span><span className="col-span-5">AI hint (where to find it)</span><span className="col-span-1"></span>
              </div>
              {cur.fields.map((fl) => (
                <div key={fl.id} className="grid grid-cols-12 gap-2 items-center">
                  <input className={`${inp} col-span-3`} value={fl.label} placeholder="Field label" onChange={(e) => upd({ fields: cur.fields.map((x) => x.id === fl.id ? { ...x, label: e.target.value } : x) })} />
                  <select className={`${inp} col-span-2`} value={fl.type} onChange={(e) => upd({ fields: cur.fields.map((x) => x.id === fl.id ? { ...x, type: e.target.value as FieldType } : x) })}>{FIELD_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                  <label className="col-span-1 grid place-items-center"><input type="checkbox" checked={fl.required} onChange={(e) => upd({ fields: cur.fields.map((x) => x.id === fl.id ? { ...x, required: e.target.checked } : x) })} /></label>
                  <input className={`${inp} col-span-5`} value={fl.aiHint} placeholder="e.g. top-right of form; MMK amount" onChange={(e) => upd({ fields: cur.fields.map((x) => x.id === fl.id ? { ...x, aiHint: e.target.value } : x) })} />
                  <button onClick={() => upd({ fields: cur.fields.filter((x) => x.id !== fl.id) })} className="col-span-1 text-xs text-status-rejected">Remove</button>
                </div>
              ))}
              {cur.fields.length === 0 && <p className="text-xs text-outline">No fields yet — add the ones this insurer's form contains.</p>}
            </div>
            <p className="text-xs text-outline">These fields drive the <b>New Claim</b> form, the JD1/JD2 display, and the AI extraction prompt for this insurer.</p>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------- Reply templates ----------
function Templates() {
  const [items, setItems] = usePersistent<Template[]>('settings.templates', [])
  const [sel, setSel] = useState<string | null>(null)
  const cur = items.find((t) => t.id === sel) || null
  function add() { const t: Template = { id: genId(), name: 'New template', channel: 'Email', subject: '', bodyEn: '', bodyMm: '' }; setItems([...items, t]); setSel(t.id) }
  function upd(p: Partial<Template>) { if (!cur) return; setItems(items.map((t) => t.id === cur.id ? { ...t, ...p } : t)) }
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-4 p-3 h-fit">
        <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-sm">Templates</h3><button onClick={add} className="text-xs text-primary flex items-center gap-1"><Icon name="add" className="text-[15px]" />New</button></div>
        {items.length === 0 && <p className="text-xs text-outline py-4 text-center">No templates yet.</p>}
        {items.map((t) => (
          <button key={t.id} onClick={() => setSel(t.id)} className={`w-full text-left px-2 py-2 rounded-md text-sm flex items-center gap-2 ${sel === t.id ? 'bg-primary/[0.07] text-primary' : 'hover:bg-surface-container'}`}>
            <Icon name="mail" className="text-[16px]" /><span className="flex-1 truncate">{t.name}</span><Badge className="bg-surface-container">{t.channel}</Badge>
          </button>
        ))}
      </Card>
      <Card className="col-span-8 p-5">
        {!cur ? <p className="text-sm text-text-main text-center py-10">Select a template, or click <b>New</b>.</p> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-text-main mb-1">Name</label><input className={inp} value={cur.name} onChange={(e) => upd({ name: e.target.value })} /></div>
              <div><label className="block text-xs text-text-main mb-1">Channel</label>
                <select className={inp} value={cur.channel} onChange={(e) => upd({ channel: e.target.value })}><option>Email</option><option>Viber</option><option>Facebook</option><option>SMS</option><option>Any</option></select></div>
            </div>
            <div><label className="block text-xs text-text-main mb-1">Subject</label><input className={inp} value={cur.subject} onChange={(e) => upd({ subject: e.target.value })} /></div>
            <div><label className="block text-xs text-text-main mb-1">Body (English)</label><textarea rows={4} className={inp} value={cur.bodyEn} onChange={(e) => upd({ bodyEn: e.target.value })} /></div>
            <div><label className="block text-xs text-text-main mb-1">Body (Burmese)</label><textarea rows={4} className={inp} value={cur.bodyMm} onChange={(e) => upd({ bodyMm: e.target.value })} /></div>
            <div className="text-xs text-outline">
              <span className="font-medium text-text-main">Merge variables:</span>{' '}
              {['{{customer.name}}', '{{claim.reference}}', '{{claim.amount}}', '{{insurer}}', '{{agent.name}}', '{{missing.docs}}'].map((v) => (
                <button key={v} onClick={() => upd({ bodyEn: cur.bodyEn + ' ' + v })} className="inline-block bg-surface-container rounded px-1.5 py-0.5 mr-1 mb-1 font-mono text-[11px] hover:bg-primary/10 hover:text-primary">{v}</button>
              ))}
              <span> — click to insert; they fill in per ticket when sent.</span>
            </div>
            <Button variant="ghost" onClick={() => { setItems(items.filter((t) => t.id !== cur.id)); setSel(null) }}><Icon name="delete" className="text-[16px] text-status-rejected" />Delete template</Button>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------- Document checklists ----------
function Checklists() {
  const [items, setItems] = usePersistent<Checklist[]>('settings.checklists', [])
  const [sel, setSel] = useState<string | null>(null)
  const cur = items.find((c) => c.id === sel) || null
  function add() { const c: Checklist = { id: genId(), insurer: 'AYA Sompo', claimType: 'New claim', items: [] }; setItems([...items, c]); setSel(c.id) }
  function upd(p: Partial<Checklist>) { if (!cur) return; setItems(items.map((c) => c.id === cur.id ? { ...c, ...p } : c)) }
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-4 p-3 h-fit">
        <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-sm">Checklists</h3><button onClick={add} className="text-xs text-primary flex items-center gap-1"><Icon name="add" className="text-[15px]" />New</button></div>
        {items.length === 0 && <p className="text-xs text-outline py-4 text-center">No checklists yet.</p>}
        {items.map((c) => (
          <button key={c.id} onClick={() => setSel(c.id)} className={`w-full text-left px-2 py-2 rounded-md text-sm flex items-center gap-2 ${sel === c.id ? 'bg-primary/[0.07] text-primary' : 'hover:bg-surface-container'}`}>
            <Icon name="checklist" className="text-[16px]" /><span className="flex-1 truncate">{c.insurer} — {c.claimType}</span>
          </button>
        ))}
      </Card>
      <Card className="col-span-8 p-5">
        {!cur ? <p className="text-sm text-text-main text-center py-10">Select a checklist, or click <b>New</b>.</p> : (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-text-main mb-1">Insurer</label><input className={inp} value={cur.insurer} onChange={(e) => upd({ insurer: e.target.value })} /></div>
              <div><label className="block text-xs text-text-main mb-1">Claim type</label><input className={inp} value={cur.claimType} onChange={(e) => upd({ claimType: e.target.value })} /></div>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1"><label className="text-xs text-text-main">Required documents (with AI acceptance criteria)</label>
                <button onClick={() => upd({ items: [...cur.items, { name: '', mandatory: true, aiHint: '' }] })} className="text-xs text-primary">+ Add document</button></div>
              {cur.items.map((it, i) => (
                <div key={i} className="py-1.5 border-b border-outline-variant/40 last:border-0">
                  <div className="flex items-center gap-2">
                    <input className={inp} value={it.name} placeholder="Document name (e.g. Itemised invoice)" onChange={(e) => upd({ items: cur.items.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                    <label className="flex items-center gap-1 text-xs whitespace-nowrap"><input type="checkbox" checked={it.mandatory} onChange={(e) => upd({ items: cur.items.map((x, j) => j === i ? { ...x, mandatory: e.target.checked } : x) })} />Mandatory</label>
                    <button onClick={() => upd({ items: cur.items.filter((_, j) => j !== i) })} className="text-xs text-status-rejected">Remove</button>
                  </div>
                  <input className={`${inp} mt-1`} value={it.aiHint ?? ''} placeholder="AI instruction — what makes this valid (e.g. must show itemised line costs, stamped, dated within 60 days)" onChange={(e) => upd({ items: cur.items.map((x, j) => j === i ? { ...x, aiHint: e.target.value } : x) })} />
                </div>
              ))}
              {cur.items.length === 0 && <p className="text-xs text-outline">No documents — add the ones this claim type requires.</p>}
            </div>
            <Button variant="ghost" onClick={() => { setItems(items.filter((c) => c.id !== cur.id)); setSel(null) }}><Icon name="delete" className="text-[16px] text-status-rejected" />Delete checklist</Button>
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------- Business rules ----------
function Rules() {
  const [rules, setRules] = usePersistent<Rule[]>('settings.rules', [])
  const [text, setText] = useState('')
  function add() { if (!text.trim()) return; setRules([...rules, { id: genId(), text: text.trim(), enabled: true }]); setText('') }
  return (
    <Card className="p-5 max-w-3xl">
      <div className="flex items-center gap-2 mb-3">
        <input className={inp} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. 60-day submission window; JD2 authority ≤ 300,000 MMK; accepted banks AYA/CB/KBZ/YOMA" />
        <Button size="sm" onClick={add}>Add rule</Button>
      </div>
      {rules.length === 0 && <p className="text-sm text-outline text-center py-6">No business rules yet.</p>}
      {rules.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-sm py-2 border-b border-outline-variant/40 last:border-0">
          <Icon name="gavel" className="text-outline" />
          <span className={`flex-1 ${r.enabled ? '' : 'text-outline line-through'}`}>{r.text}</span>
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={r.enabled} onChange={() => setRules(rules.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} />On</label>
          <button onClick={() => setRules(rules.filter((x) => x.id !== r.id))} className="text-xs text-status-rejected">Delete</button>
        </div>
      ))}
    </Card>
  )
}

// ---------- Tables of Benefits ----------
function Benefits() {
  const [items, setItems] = usePersistent<Tob[]>('settings.tob', [])
  const [sel, setSel] = useState<string | null>(null)
  const cur = items.find((t) => t.id === sel) || null
  function add() { const t: Tob = { id: genId(), plan: 'New plan', benefits: [] }; setItems([...items, t]); setSel(t.id) }
  function upd(p: Partial<Tob>) { if (!cur) return; setItems(items.map((t) => t.id === cur.id ? { ...t, ...p } : t)) }
  return (
    <div className="grid grid-cols-12 gap-4">
      <Card className="col-span-4 p-3 h-fit">
        <div className="flex items-center justify-between mb-2"><h3 className="font-semibold text-sm">Plans</h3><button onClick={add} className="text-xs text-primary flex items-center gap-1"><Icon name="add" className="text-[15px]" />New</button></div>
        {items.length === 0 && <p className="text-xs text-outline py-4 text-center">No benefit tables yet.</p>}
        {items.map((t) => (
          <button key={t.id} onClick={() => setSel(t.id)} className={`w-full text-left px-2 py-2 rounded-md text-sm flex items-center gap-2 ${sel === t.id ? 'bg-primary/[0.07] text-primary' : 'hover:bg-surface-container'}`}>
            <Icon name="table" className="text-[16px]" /><span className="flex-1 truncate">{t.plan}</span>
          </button>
        ))}
      </Card>
      <Card className="col-span-8 p-5">
        {!cur ? <p className="text-sm text-text-main text-center py-10">Select a plan, or click <b>New</b>.</p> : (
          <div className="space-y-3">
            <div><label className="block text-xs text-text-main mb-1">Plan name</label><input className={inp} value={cur.plan} onChange={(e) => upd({ plan: e.target.value })} /></div>
            <div>
              <div className="flex items-center justify-between mb-1"><label className="text-xs text-text-main">Benefits & limits</label>
                <button onClick={() => upd({ benefits: [...cur.benefits, { name: '', limit: '' }] })} className="text-xs text-primary">+ Add benefit</button></div>
              {cur.benefits.map((b, i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <input className={inp} value={b.name} placeholder="Benefit (e.g. Hospitalisation)" onChange={(e) => upd({ benefits: cur.benefits.map((x, j) => j === i ? { ...x, name: e.target.value } : x) })} />
                  <input className={inp} value={b.limit} placeholder="Limit (e.g. 11,000,000 MMK)" onChange={(e) => upd({ benefits: cur.benefits.map((x, j) => j === i ? { ...x, limit: e.target.value } : x) })} />
                  <button onClick={() => upd({ benefits: cur.benefits.filter((_, j) => j !== i) })} className="text-xs text-status-rejected">Remove</button>
                </div>
              ))}
              {cur.benefits.length === 0 && <p className="text-xs text-outline">No benefits — add rows for this plan.</p>}
            </div>
            <Button variant="ghost" onClick={() => { setItems(items.filter((t) => t.id !== cur.id)); setSel(null) }}><Icon name="delete" className="text-[16px] text-status-rejected" />Delete plan</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
