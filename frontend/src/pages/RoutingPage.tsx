import { useState } from 'react'
import { PageTitle, Card, Button, Icon } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'

interface Rule { id: string; field: string; op: string; value: string; assign: string; enabled: boolean }
const FIELDS = ['Channel', 'Claim type', 'Insurer', 'Amount (MMK)', 'Keyword']
const OPS = ['is', 'is not', 'contains', '≥', '≤']

export function RoutingPage() {
  const [rules, setRules] = usePersistent<Rule[]>('routing', [])
  const [draft, setDraft] = useState<Rule | null>(null)

  function blank(): Rule { return { id: genId(), field: 'Channel', op: 'is', value: '', assign: '', enabled: true } }
  function save() {
    if (!draft || !draft.value.trim() || !draft.assign.trim()) return
    setRules((rs) => rs.some((r) => r.id === draft.id) ? rs.map((r) => r.id === draft.id ? draft : r) : [...rs, draft])
    setDraft(null)
  }
  const inp = 'text-sm border border-outline-variant rounded-md px-2 py-1.5'

  return (
    <div>
      <PageTitle title="Routing & Assignment Rules" sub="Rules run top to bottom; the first match assigns the item. Staff can always reassign."
        action={<Button onClick={() => setDraft(blank())}><Icon name="add" className="text-[16px]" />Add rule</Button>} />

      {draft && (
        <Card className="p-4 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text-main">When</span>
            <select className={inp} value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value })}>{FIELDS.map((f) => <option key={f}>{f}</option>)}</select>
            <select className={inp} value={draft.op} onChange={(e) => setDraft({ ...draft, op: e.target.value })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
            <input className={`${inp} flex-1 min-w-[140px]`} placeholder="value (e.g. Viber, LOG, 300000)" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
            <Icon name="arrow_forward" className="text-[18px] text-outline" />
            <span className="text-sm text-text-main">assign to</span>
            <input className={`${inp} flex-1 min-w-[140px]`} placeholder="team / person (e.g. JD1 team)" value={draft.assign} onChange={(e) => setDraft({ ...draft, assign: e.target.value })} />
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
          </div>
        </Card>
      )}

      {rules.length === 0 ? (
        <Card className="p-10 text-center"><Icon name="alt_route" className="text-[32px] text-outline" /><p className="text-sm text-text-main mt-2">No routing rules yet. Click <b>Add rule</b> to create one.</p></Card>
      ) : (
        <div className="space-y-3">
          {rules.map((r, i) => (
            <Card key={r.id} className={`p-4 flex items-center gap-3 ${r.enabled ? '' : 'opacity-50'}`}>
              <div className="w-7 h-7 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-semibold">{i + 1}</div>
              <div className="text-sm"><span className="text-text-main">When </span><span className="font-medium">{r.field} {r.op} {r.value}</span></div>
              <Icon name="arrow_forward" className="text-[18px] text-outline" />
              <div className="text-sm"><span className="text-text-main">Assign to </span><span className="font-medium text-primary">{r.assign}</span></div>
              <div className="ml-auto flex items-center gap-3">
                <button onClick={() => setDraft(r)} className="text-xs text-primary">Edit</button>
                <button onClick={() => setRules((rs) => rs.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} className="text-xs text-primary">{r.enabled ? 'Disable' : 'Enable'}</button>
                <button onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))} className="text-xs text-status-rejected">Delete</button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
