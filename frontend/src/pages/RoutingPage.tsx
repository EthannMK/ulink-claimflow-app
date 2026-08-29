import { useState } from 'react'
import { PageTitle, Card, Button, Icon, Badge } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'

interface Cond { field: string; op: string; value: string }
interface Rule {
  id: string; name: string; enabled: boolean
  match: 'all' | 'any'; conditions: Cond[]
  assignType: string; assignTo: string
  priority: string; applySla: string
  businessHoursOnly: boolean; escalateMins: string
}

const COND_FIELDS = ['Channel', 'Claim type', 'Insurer', 'Priority', 'Amount (MMK)', 'Keyword', 'Requester email', 'Business hours']
const OPS = ['is', 'is not', 'contains', 'starts with', '≥', '≤']
const ASSIGN = [
  { v: 'agent', l: 'Specific agent' }, { v: 'team_rr', l: 'Team — round-robin' },
  { v: 'team_lb', l: 'Team — load-balanced' }, { v: 'skill', l: 'Skill-based (by tag)' },
]
const PRIORITIES = ['— keep —', 'Low', 'Medium', 'High', 'Urgent']

function blankRule(): Rule {
  return { id: genId(), name: '', enabled: true, match: 'all', conditions: [{ field: 'Channel', op: 'is', value: '' }], assignType: 'team_rr', assignTo: '', priority: '— keep —', applySla: '', businessHoursOnly: false, escalateMins: '' }
}

export function RoutingPage() {
  const [rules, setRules] = usePersistent<Rule[]>('routing.v2', [])
  const [draft, setDraft] = useState<Rule | null>(null)

  function save() {
    if (!draft || !draft.name.trim()) return
    setRules((rs) => rs.some((r) => r.id === draft.id) ? rs.map((r) => r.id === draft.id ? draft : r) : [...rs, draft])
    setDraft(null)
  }
  function move(i: number, dir: -1 | 1) {
    setRules((rs) => { const a = [...rs]; const j = i + dir; if (j < 0 || j >= a.length) return rs;[a[i], a[j]] = [a[j], a[i]]; return a })
  }
  const inp = 'text-sm border border-outline-variant rounded-md px-2 py-1.5'
  const assignLabel = (r: Rule) => `${ASSIGN.find((a) => a.v === r.assignType)?.l ?? r.assignType}${r.assignTo ? ` → ${r.assignTo}` : ''}`

  return (
    <div>
      <PageTitle title="Routing & Assignment Rules" sub="Rules run top to bottom; the first matching rule assigns the ticket. Unavailable / on-leave agents are skipped."
        action={<Button onClick={() => setDraft(blankRule())}><Icon name="add" className="text-[16px]" />Add rule</Button>} />

      {draft && (
        <Card className="p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <input className={`${inp} flex-1`} placeholder="Rule name (e.g. Urgent LOG → LOG team)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>

          {/* conditions */}
          <div className="bg-surface-container/50 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="text-text-main">Match</span>
              <select className={inp} value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as any })}><option value="all">ALL (AND)</option><option value="any">ANY (OR)</option></select>
              <span className="text-text-main">of these conditions:</span>
              <button onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'Channel', op: 'is', value: '' }] })} className="ml-auto text-xs text-primary">+ Add condition</button>
            </div>
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <select className={`${inp} w-40`} value={c.field} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}>{COND_FIELDS.map((f) => <option key={f}>{f}</option>)}</select>
                <select className={`${inp} w-28`} value={c.op} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, op: e.target.value } : x) })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
                <input className={`${inp} flex-1`} placeholder="value" value={c.value} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                {draft.conditions.length > 1 && <button onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })} className="text-xs text-status-rejected">×</button>}
              </div>
            ))}
          </div>

          {/* actions */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-text-main mb-1">Assignment method</label>
              <select className={`${inp} w-full`} value={draft.assignType} onChange={(e) => setDraft({ ...draft, assignType: e.target.value })}>{ASSIGN.map((a) => <option key={a.v} value={a.v}>{a.l}</option>)}</select></div>
            <div><label className="block text-xs text-text-main mb-1">Assign to (team / agent / skill tag)</label>
              <input className={`${inp} w-full`} placeholder="e.g. JD1 Intake team" value={draft.assignTo} onChange={(e) => setDraft({ ...draft, assignTo: e.target.value })} /></div>
            <div><label className="block text-xs text-text-main mb-1">Set priority</label>
              <select className={`${inp} w-full`} value={draft.priority} onChange={(e) => setDraft({ ...draft, priority: e.target.value })}>{PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
            <div><label className="block text-xs text-text-main mb-1">Apply SLA policy</label>
              <input className={`${inp} w-full`} placeholder="e.g. LOG (emergency)" value={draft.applySla} onChange={(e) => setDraft({ ...draft, applySla: e.target.value })} /></div>
            <div><label className="block text-xs text-text-main mb-1">Escalate if no action (minutes)</label>
              <input className={`${inp} w-full`} placeholder="e.g. 60" value={draft.escalateMins} onChange={(e) => setDraft({ ...draft, escalateMins: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={draft.businessHoursOnly} onChange={(e) => setDraft({ ...draft, businessHoursOnly: e.target.checked })} />Apply during business hours only</label>
          </div>

          <div className="flex gap-2 mt-4"><Button size="sm" onClick={save}>Save rule</Button><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </Card>
      )}

      {rules.length === 0 && !draft ? (
        <Card className="p-10 text-center"><Icon name="alt_route" className="text-[32px] text-outline" /><p className="text-sm text-text-main mt-2">No routing rules yet. Click <b>Add rule</b> to build one.</p></Card>
      ) : (
        <div className="space-y-3">
          {rules.map((r, i) => (
            <Card key={r.id} className={`p-4 ${r.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <button onClick={() => move(i, -1)} className="text-outline hover:text-primary leading-none"><Icon name="expand_less" className="text-[16px]" /></button>
                  <button onClick={() => move(i, 1)} className="text-outline hover:text-primary leading-none"><Icon name="expand_more" className="text-[16px]" /></button>
                </div>
                <div className="w-6 h-6 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-semibold">{i + 1}</div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">{r.name}</div>
                  <div className="text-xs text-text-main mt-0.5">
                    Match <b>{r.match === 'all' ? 'ALL' : 'ANY'}</b>: {r.conditions.map((c) => `${c.field} ${c.op} ${c.value || '…'}`).join(r.match === 'all' ? ' AND ' : ' OR ')}
                  </div>
                  <div className="text-xs text-primary mt-0.5">→ {assignLabel(r)}
                    {r.priority !== '— keep —' && <Badge className="ml-2 bg-status-pending/10 text-status-pending">{r.priority}</Badge>}
                    {r.applySla && <Badge className="ml-1 bg-status-ai/10 text-status-ai">SLA: {r.applySla}</Badge>}
                    {r.escalateMins && <Badge className="ml-1 bg-brand-accent/10 text-brand-accent">escalate {r.escalateMins}m</Badge>}
                    {r.businessHoursOnly && <Badge className="ml-1 bg-surface-container">business hours</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setDraft(r)} className="text-xs text-primary">Edit</button>
                  <button onClick={() => setRules((rs) => rs.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} className="text-xs text-primary">{r.enabled ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => setRules((rs) => rs.filter((x) => x.id !== r.id))} className="text-xs text-status-rejected">Delete</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
