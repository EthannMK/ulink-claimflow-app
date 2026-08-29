import { useState } from 'react'
import { PageTitle, Card, Button, Icon, Badge } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'

interface DayHours { enabled: boolean; from: string; to: string }
type Week = Record<string, DayHours>
interface BusinessHours { tz: string; week: Week; holidays: string[] }
interface Cond { field: string; op: string; value: string }
interface Action { type: string; value: string }
interface AutoRule { id: string; name: string; enabled: boolean; trigger: string; match: 'all' | 'any'; conditions: Cond[]; actions: Action[] }
interface Template { id: string; name: string }

const DAYS: [string, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']]
const DEFAULT_HOURS: BusinessHours = {
  tz: 'Asia/Yangon',
  week: { mon: { enabled: true, from: '09:00', to: '17:00' }, tue: { enabled: true, from: '09:00', to: '17:00' }, wed: { enabled: true, from: '09:00', to: '17:00' }, thu: { enabled: true, from: '09:00', to: '17:00' }, fri: { enabled: true, from: '09:00', to: '17:00' }, sat: { enabled: false, from: '09:00', to: '13:00' }, sun: { enabled: false, from: '09:00', to: '13:00' } },
  holidays: [],
}
const TRIGGERS = ['Ticket created', 'Ticket updated', 'Outside business hours', 'Weekend', 'Public holiday', 'SLA breached', 'Waiting on customer', 'Ticket resolved / closed']
const COND_FIELDS = ['Channel', 'Claim type', 'Insurer', 'Priority', 'Amount (MMK)', 'Keyword']
const OPS = ['is', 'is not', 'contains', '≥', '≤']
const ACTION_TYPES = ['Send auto-reply (template)', 'Assign to', 'Set priority', 'Add tag', 'Set status', 'Notify email', 'Add internal note']

export function AutomationsPage() {
  const [hours, setHours] = usePersistent<BusinessHours>('businessHours', DEFAULT_HOURS)
  const [rules, setRules] = usePersistent<AutoRule[]>('automations.v2', [])
  const [templates] = usePersistent<Template[]>('settings.templates', [])
  const [holiday, setHoliday] = useState('')
  const [draft, setDraft] = useState<AutoRule | null>(null)
  const inp = 'text-sm border border-outline-variant rounded-md px-2 py-1.5'

  function setDay(k: string, p: Partial<DayHours>) { setHours({ ...hours, week: { ...hours.week, [k]: { ...hours.week[k], ...p } } }) }
  function save() { if (!draft || !draft.name.trim()) return; setRules((rs) => rs.some((r) => r.id === draft.id) ? rs.map((r) => r.id === draft.id ? draft : r) : [...rs, draft]); setDraft(null) }
  function blank(): AutoRule { return { id: genId(), name: '', enabled: true, trigger: 'Ticket created', match: 'all', conditions: [], actions: [{ type: 'Send auto-reply (template)', value: '' }] } }

  return (
    <div>
      <PageTitle title="Automations" sub="Event-driven rules: when something happens, run actions automatically (assign, reply, set priority, notify…)." />

      {/* business hours */}
      <Card className="p-5 mb-5">
        <div className="flex items-center gap-2 mb-3"><Icon name="schedule" className="text-[18px] text-primary" /><h3 className="font-semibold text-sm">Business hours & holidays</h3>
          <span className="ml-auto text-xs text-outline">Used by time-based triggers · TZ {hours.tz}</span></div>
        <div className="space-y-1.5">
          {DAYS.map(([k, label]) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2 w-32"><input type="checkbox" checked={hours.week[k].enabled} onChange={(e) => setDay(k, { enabled: e.target.checked })} />{label}</label>
              {hours.week[k].enabled ? (<><input type="time" className={inp} value={hours.week[k].from} onChange={(e) => setDay(k, { from: e.target.value })} /><span className="text-outline">to</span><input type="time" className={inp} value={hours.week[k].to} onChange={(e) => setDay(k, { to: e.target.value })} /></>) : <span className="text-xs text-outline">Closed</span>}
            </div>
          ))}
        </div>
        <div className="mt-4">
          <div className="flex items-center gap-2 mb-1"><label className="text-xs text-text-main">Public holidays</label>
            <input type="date" className={inp} value={holiday} onChange={(e) => setHoliday(e.target.value)} />
            <Button size="sm" variant="outline" onClick={() => { if (holiday && !hours.holidays.includes(holiday)) { setHours({ ...hours, holidays: [...hours.holidays, holiday].sort() }); setHoliday('') } }}>Add</Button></div>
          <div className="flex flex-wrap gap-2">
            {hours.holidays.map((h) => <Badge key={h} className="bg-surface-container">{h} <button onClick={() => setHours({ ...hours, holidays: hours.holidays.filter((x) => x !== h) })} className="text-status-rejected ml-1">×</button></Badge>)}
            {hours.holidays.length === 0 && <span className="text-xs text-outline">None added.</span>}
          </div>
        </div>
      </Card>

      {/* automation rules */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Automation rules</h3>
        <Button size="sm" onClick={() => setDraft(blank())}><Icon name="add" className="text-[16px]" />Add automation</Button>
      </div>

      {draft && (
        <Card className="p-5 mb-3">
          <div className="grid grid-cols-2 gap-3 mb-3">
            <div><label className="block text-xs text-text-main mb-1">Rule name</label><input className={`${inp} w-full`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. After-hours auto-ack + assign CSR" /></div>
            <div><label className="block text-xs text-text-main mb-1">When (event)</label><select className={`${inp} w-full`} value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}>{TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select></div>
          </div>

          {/* conditions */}
          <div className="bg-surface-container/50 rounded-lg p-3 mb-3">
            <div className="flex items-center gap-2 text-sm mb-2"><span className="text-text-main">If</span>
              <select className={inp} value={draft.match} onChange={(e) => setDraft({ ...draft, match: e.target.value as any })}><option value="all">ALL</option><option value="any">ANY</option></select>
              <span className="text-text-main">conditions (optional):</span>
              <button onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'Channel', op: 'is', value: '' }] })} className="ml-auto text-xs text-primary">+ Condition</button></div>
            {draft.conditions.length === 0 && <p className="text-xs text-outline">No conditions — applies to every {draft.trigger.toLowerCase()} event.</p>}
            {draft.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <select className={`${inp} w-40`} value={c.field} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, field: e.target.value } : x) })}>{COND_FIELDS.map((f) => <option key={f}>{f}</option>)}</select>
                <select className={`${inp} w-24`} value={c.op} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, op: e.target.value } : x) })}>{OPS.map((o) => <option key={o}>{o}</option>)}</select>
                <input className={`${inp} flex-1`} placeholder="value" value={c.value} onChange={(e) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                <button onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })} className="text-xs text-status-rejected">×</button>
              </div>
            ))}
          </div>

          {/* actions */}
          <div className="rounded-lg border border-outline-variant p-3">
            <div className="flex items-center gap-2 text-sm mb-2"><span className="text-text-main font-medium">Then do:</span>
              <button onClick={() => setDraft({ ...draft, actions: [...draft.actions, { type: 'Assign to', value: '' }] })} className="ml-auto text-xs text-primary">+ Action</button></div>
            {draft.actions.map((a, i) => (
              <div key={i} className="flex items-center gap-2 mb-2">
                <select className={`${inp} w-56`} value={a.type} onChange={(e) => setDraft({ ...draft, actions: draft.actions.map((x, j) => j === i ? { ...x, type: e.target.value, value: '' } : x) })}>{ACTION_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                {a.type === 'Send auto-reply (template)' ? (
                  <select className={`${inp} flex-1`} value={a.value} onChange={(e) => setDraft({ ...draft, actions: draft.actions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })}>
                    <option value="">— select template —</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
                ) : a.type === 'Set priority' ? (
                  <select className={`${inp} flex-1`} value={a.value} onChange={(e) => setDraft({ ...draft, actions: draft.actions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })}><option value="">—</option>{['Low', 'Medium', 'High', 'Urgent'].map((p) => <option key={p}>{p}</option>)}</select>
                ) : (
                  <input className={`${inp} flex-1`} placeholder={a.type === 'Notify email' ? 'email@ulink.com' : a.type === 'Assign to' ? 'team / agent' : 'value'} value={a.value} onChange={(e) => setDraft({ ...draft, actions: draft.actions.map((x, j) => j === i ? { ...x, value: e.target.value } : x) })} />
                )}
                {draft.actions.length > 1 && <button onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })} className="text-xs text-status-rejected">×</button>}
              </div>
            ))}
            {templates.length === 0 && <p className="text-xs text-status-pending">Tip: create reply templates in <b>Settings → Reply templates</b> to use the auto-reply action.</p>}
          </div>

          <div className="flex gap-2 mt-4"><Button size="sm" onClick={save}>Save automation</Button><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </Card>
      )}

      {rules.length === 0 && !draft ? (
        <Card className="p-10 text-center"><Icon name="bolt" className="text-[32px] text-outline" /><p className="text-sm text-text-main mt-2">No automations yet. Example: <b>When</b> Outside business hours <b>then</b> send auto-reply + assign to CSR.</p></Card>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <Card key={r.id} className={`p-3 ${r.enabled ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-2">
                <Icon name="bolt" className="text-[18px] text-primary" />
                <span className="font-medium text-sm flex-1">{r.name}</span>
                <button onClick={() => setRules(rules.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} className="text-xs text-primary">{r.enabled ? 'Disable' : 'Enable'}</button>
                <button onClick={() => setDraft(r)} className="text-xs text-primary">Edit</button>
                <button onClick={() => setRules(rules.filter((x) => x.id !== r.id))} className="text-xs text-status-rejected">Delete</button>
              </div>
              <div className="text-xs text-text-main mt-1">
                <b>When</b> {r.trigger}{r.conditions.length > 0 && <> · <b>if</b> {r.match} {r.conditions.map((c) => `${c.field} ${c.op} ${c.value || '…'}`).join(', ')}</>} · <b>then</b> {r.actions.map((a) => a.type.replace(' (template)', '')).join(', ')}
              </div>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-outline mt-4">Reply content lives in <b>Settings → Reply templates</b>; SLA timers are separate in <b>SLA Policies</b>. Actions execute once the channel/email backend is wired.</p>
    </div>
  )
}
