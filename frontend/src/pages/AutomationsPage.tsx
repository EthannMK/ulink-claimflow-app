import { useState } from 'react'
import { PageTitle, Card, Button, Icon, Badge } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'

interface DayHours { enabled: boolean; from: string; to: string }
type Week = Record<string, DayHours>
interface BusinessHours { tz: string; week: Week; holidays: string[] }
interface AutoRule { id: string; name: string; trigger: string; channel: string; templateId: string; enabled: boolean }

const DAYS: [string, string][] = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']]
const DEFAULT_HOURS: BusinessHours = {
  tz: 'Asia/Yangon',
  week: {
    mon: { enabled: true, from: '09:00', to: '17:00' }, tue: { enabled: true, from: '09:00', to: '17:00' },
    wed: { enabled: true, from: '09:00', to: '17:00' }, thu: { enabled: true, from: '09:00', to: '17:00' },
    fri: { enabled: true, from: '09:00', to: '17:00' }, sat: { enabled: false, from: '09:00', to: '13:00' },
    sun: { enabled: false, from: '09:00', to: '13:00' },
  },
  holidays: [],
}
const TRIGGERS = ['Outside business hours', 'Weekend', 'Public holiday', 'New ticket created', 'Ticket resolved / closed', 'Waiting on customer']
const CHANNELS = ['Any channel', 'Email', 'Viber', 'Facebook', 'Telegram', 'Web form', 'Call Center']

interface Template { id: string; name: string; channel: string }

export function AutomationsPage() {
  const [hours, setHours] = usePersistent<BusinessHours>('businessHours', DEFAULT_HOURS)
  const [rules, setRules] = usePersistent<AutoRule[]>('automations', [])
  const [templates] = usePersistent<Template[]>('settings.templates', [])
  const [holiday, setHoliday] = useState('')
  const [draft, setDraft] = useState<AutoRule | null>(null)
  const inp = 'text-sm border border-outline-variant rounded-md px-2 py-1.5'

  function setDay(key: string, p: Partial<DayHours>) { setHours({ ...hours, week: { ...hours.week, [key]: { ...hours.week[key], ...p } } }) }
  function save() { if (!draft || !draft.name.trim()) return; setRules((rs) => rs.some((r) => r.id === draft.id) ? rs.map((r) => r.id === draft.id ? draft : r) : [...rs, draft]); setDraft(null) }
  const tName = (id: string) => templates.find((t) => t.id === id)?.name || '(no template)'

  return (
    <div>
      <PageTitle title="Automations — Auto-responders" sub="Send automatic replies based on time or events. Business hours here define what counts as 'after hours'." />

      {/* business hours */}
      <Card className="p-5 mb-5">
        <div className="flex items-center gap-2 mb-3"><Icon name="schedule" className="text-[18px] text-primary" /><h3 className="font-semibold text-sm">Business hours & holidays</h3>
          <span className="ml-auto text-xs text-outline">Timezone: {hours.tz}</span></div>
        <div className="space-y-1.5">
          {DAYS.map(([k, label]) => (
            <div key={k} className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2 w-32"><input type="checkbox" checked={hours.week[k].enabled} onChange={(e) => setDay(k, { enabled: e.target.checked })} />{label}</label>
              {hours.week[k].enabled ? (
                <><input type="time" className={inp} value={hours.week[k].from} onChange={(e) => setDay(k, { from: e.target.value })} />
                  <span className="text-outline">to</span>
                  <input type="time" className={inp} value={hours.week[k].to} onChange={(e) => setDay(k, { to: e.target.value })} /></>
              ) : <span className="text-xs text-outline">Closed</span>}
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

      {/* auto-responders */}
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-sm">Auto-reply rules</h3>
        <Button size="sm" onClick={() => setDraft({ id: genId(), name: '', trigger: 'Outside business hours', channel: 'Any channel', templateId: '', enabled: true })}><Icon name="add" className="text-[16px]" />Add auto-reply</Button>
      </div>

      {draft && (
        <Card className="p-4 mb-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-text-main mb-1">Rule name</label><input className={`${inp} w-full`} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="e.g. After-hours acknowledgement" /></div>
            <div><label className="block text-xs text-text-main mb-1">When (trigger)</label><select className={`${inp} w-full`} value={draft.trigger} onChange={(e) => setDraft({ ...draft, trigger: e.target.value })}>{TRIGGERS.map((t) => <option key={t}>{t}</option>)}</select></div>
            <div><label className="block text-xs text-text-main mb-1">Channel</label><select className={`${inp} w-full`} value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select></div>
            <div><label className="block text-xs text-text-main mb-1">Reply with template</label>
              <select className={`${inp} w-full`} value={draft.templateId} onChange={(e) => setDraft({ ...draft, templateId: e.target.value })}>
                <option value="">— select —</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select></div>
          </div>
          {templates.length === 0 && <p className="text-xs text-status-pending mt-2">No templates yet — create them in <b>Settings → Reply templates</b> first.</p>}
          <div className="flex gap-2 mt-3"><Button size="sm" onClick={save}>Save rule</Button><Button size="sm" variant="ghost" onClick={() => setDraft(null)}>Cancel</Button></div>
        </Card>
      )}

      {rules.length === 0 && !draft ? (
        <Card className="p-10 text-center"><Icon name="smart_toy" className="text-[32px] text-outline" /><p className="text-sm text-text-main mt-2">No auto-replies yet. Add one — e.g. reply <b>outside business hours</b> with your acknowledgement template.</p></Card>
      ) : (
        <div className="space-y-2">
          {rules.map((r) => (
            <Card key={r.id} className={`p-3 flex items-center gap-3 ${r.enabled ? '' : 'opacity-50'}`}>
              <Icon name="smart_toy" className="text-[18px] text-primary" />
              <div className="flex-1">
                <div className="font-medium text-sm">{r.name}</div>
                <div className="text-xs text-text-main">When <b>{r.trigger}</b> on <b>{r.channel}</b> → reply with <b>{tName(r.templateId)}</b></div>
              </div>
              <button onClick={() => setRules(rules.map((x) => x.id === r.id ? { ...x, enabled: !x.enabled } : x))} className="text-xs text-primary">{r.enabled ? 'Disable' : 'Enable'}</button>
              <button onClick={() => setDraft(r)} className="text-xs text-primary">Edit</button>
              <button onClick={() => setRules(rules.filter((x) => x.id !== r.id))} className="text-xs text-status-rejected">Delete</button>
            </Card>
          ))}
        </div>
      )}
      <p className="text-xs text-outline mt-4">Auto-replies send through the connected channel/email backend (wired in the foundation build). Templates are managed in <b>Settings → Reply templates</b>; SLA timers are separate, in <b>SLA Policies</b>.</p>
    </div>
  )
}
