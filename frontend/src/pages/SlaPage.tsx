import { useState } from 'react'
import { PageTitle, Card, Button, Icon, Badge, AttachField, type Attachment } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'

interface Cond { field: string; op: string; value: string }
interface Sla {
  id: string; name: string; enabled: boolean
  match: 'all' | 'any'; conditions: Cond[]
  frMinutes: string; frUnit: string
  resMinutes: string; resUnit: string
  hours: '24x7' | 'business'
  escalate: boolean; notes: string; attachment?: Attachment
}
const COND_FIELDS = ['Channel', 'Priority', 'Claim type', 'Insurer', 'Business process']
const OPS = ['is', 'is not', 'contains']
const UNITS = ['minutes', 'hours', 'days']

function blank(): Sla {
  return { id: genId(), name: '', enabled: true, match: 'all', conditions: [{ field: 'Channel', op: 'is', value: '' }], frMinutes: '', frUnit: 'hours', resMinutes: '', resUnit: 'hours', hours: 'business', escalate: true, notes: '' }
}

export function SlaPage() {
  const [rows, setRows] = usePersistent<Sla[]>('sla.v2', [])
  const [draft, setDraft] = useState<Sla | null>(null)
  const inp = 'text-sm border border-outline-variant rounded-md px-2 py-1.5'

  function save() { if (!draft || !draft.name.trim()) return; setRows((rs) => rs.some((r) => r.id === draft.id) ? rs.map((r) => r.id === draft.id ? draft : r) : [...rs, draft]); setDraft(null) }

  return (
    <div>
      <PageTitle title="SLA Policies" sub="Response & resolution targets by channel, priority, type or business process — with business-hours calendars and breach escalation."
        action={<Button onClick={() => setDraft(blank())}><Icon name="add" className="text-[16px]" />Add policy</Button>} />

      {draft && (
        <Card className="p-5 mb-4">
          <input className={`${inp} w-full mb-3`} placeholder="Policy name (e.g. LOG emergency — 3h)" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <div className="bg-surface-container/50 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 text-sm mb-2">
              <span className="text-text-main">Applies when</span>
              <select className={inp} value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as any })}><option value="all">ALL</option><option value="any">ANY</option></select>
              <span className="text-text-main">match:</span>
              <button onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'Channel', op: 'is', value: '' }] })} className="ml-auto text-xs text-primary">+ Add condition</button>
            </div>
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <select className={`${inp} w-40`} value={c.field} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}>{COND_FIELDS.map((f) => <option key={f}>{f}</option>)}</select>
                <select className={`${inp} w-28`} value={c.op} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, op: e.target.value } : x) })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
                <input className={`${inp} flex-1`} placeholder="value (e.g. Viber, Urgent, LOG)" value={c.value} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                {draft.conditions.length > 1 && <button onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })} className="text-xs text-status-rejected">×</button>}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-text-main mb-1">First-response target</label>
              <div className="flex gap-2"><input className={`${inp} w-24`} placeholder="e.g. 2" value={draft.frMinutes} onChange={(e) => setDraft({ ...draft, frMinutes: e.target.value })} /><select className={inp} value={draft.frUnit} onChange={(e) => setDraft({ ...draft, frUnit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div></div>
            <div><label className="block text-xs text-text-main mb-1">Resolution target</label>
              <div className="flex gap-2"><input className={`${inp} w-24`} placeholder="e.g. 24" value={draft.resMinutes} onChange={(e) => setDraft({ ...draft, resMinutes: e.target.value })} /><select className={inp} value={draft.resUnit} onChange={(e) => setDraft({ ...draft, resUnit: e.target.value })}>{UNITS.map((u) => <option key={u}>{u}</option>)}</select></div></div>
            <div><label className="block text-xs text-text-main mb-1">Operating hours</label>
              <select className={`${inp} w-full`} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value as any })}><option value="business">Business hours (Mon–Fri)</option><option value="24x7">24×7</option></select></div>
            <label className="flex items-center gap-2 text-sm mt-6"><input type="checkbox" checked={draft.escalate} onChange={(e) => setDraft({ ...draft, escalate: e.target.checked })} />Escalate & notify on breach</label>
          </div>
          <textarea className={`${inp} w-full mt-3`} rows={2} placeholder="Notes / business-process description" value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
          <div className="mt-2"><AttachField value={draft.attachment} onChange={(a) => setDraft({ ...draft, attachment: a })} label="Attach SLA document" /></div>
          <div className="flex gap-2 mt-4"><Button size="sm" onClick={save}>Save policy</Button><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </Card>
      )}

      {rows.length === 0 && !draft ? (
        <Card className="p-10 text-center"><Icon name="timer" className="text-[32px] text-outline" /><p className="text-sm text-text-main mt-2">No SLA policies yet. Click <b>Add policy</b>.</p></Card>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <Card key={r.id} className={`p-4 ${r.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon name="timer" className="text-[18px]" /></div>
                <div className="flex-1">
                  <div className="font-semibold text-sm">{r.name}</div>
                  <div className="text-xs text-text-main mt-0.5">When {r.match === 'all' ? 'ALL' : 'ANY'}: {r.conditions.map((c) => `${c.field} ${c.op} ${c.value || '…'}`).join(r.match === 'all' ? ' AND ' : ' OR ')}</div>
                  <div className="text-xs mt-0.5 flex flex-wrap gap-1">
                    <Badge className="bg-status-ai/10 text-status-ai">Response {r.frMinutes || '—'} {r.frUnit}</Badge>
                    <Badge className="bg-status-approved/10 text-status-approved">Resolve {r.resMinutes || '—'} {r.resUnit}</Badge>
                    <Badge className="bg-surface-container">{r.hours === '24x7' ? '24×7' : 'Business hours'}</Badge>
                    {r.escalate && <Badge className="bg-brand-accent/10 text-brand-accent">escalate on breach</Badge>}
                    {r.attachment && <Badge className="bg-surface-container">📎 {r.attachment.name}</Badge>}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button onClick={() => setDraft(r)} className="text-xs text-primary">Edit</button>
                  <button onClick={() => setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} className="text-xs text-primary">{r.enabled ? 'Disable' : 'Enable'}</button>
                  <button onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="text-xs text-status-rejected">Delete</button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
