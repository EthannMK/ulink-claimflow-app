import { useState } from 'react'
import { PageTitle, Card, Button, Icon } from '../components/ui'
import { mockRouting } from '../mocks/admin'

interface Rule { when: string; assign: string; enabled: boolean }

export function RoutingPage() {
  const [rules, setRules] = useState<Rule[]>(() => mockRouting.map((r) => ({ ...r, enabled: true })))
  const [adding, setAdding] = useState(false)
  const [when, setWhen] = useState('')
  const [assign, setAssign] = useState('')

  function add() {
    if (!when.trim() || !assign.trim()) return
    setRules((rs) => [...rs, { when: when.trim(), assign: assign.trim(), enabled: true }])
    setWhen(''); setAssign(''); setAdding(false)
  }
  function toggle(i: number) { setRules((rs) => rs.map((r, j) => j === i ? { ...r, enabled: !r.enabled } : r)) }
  function remove(i: number) { setRules((rs) => rs.filter((_, j) => j !== i)) }

  return (
    <div>
      <PageTitle title="Routing & Assignment Rules" sub="How AI auto-assigns incoming items. Rules run top to bottom; staff can always reassign."
        action={<Button onClick={() => setAdding((v) => !v)}><Icon name="add" className="text-[16px]" />Add rule</Button>} />

      {adding && (
        <Card className="p-4 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-text-main">When</span>
            <input value={when} onChange={(e) => setWhen(e.target.value)} placeholder="Channel = Viber + Type = Query"
              className="flex-1 min-w-[220px] text-sm border border-outline-variant rounded-md px-2 py-1.5" />
            <Icon name="arrow_forward" className="text-[18px] text-outline" />
            <span className="text-sm text-text-main">assign to</span>
            <input value={assign} onChange={(e) => setAssign(e.target.value)} placeholder="CSR team"
              className="flex-1 min-w-[160px] text-sm border border-outline-variant rounded-md px-2 py-1.5" />
            <Button size="sm" onClick={add}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      <div className="space-y-3">
        {rules.map((r, i) => (
          <Card key={i} className={`p-4 flex items-center gap-3 ${r.enabled ? '' : 'opacity-50'}`}>
            <div className="w-7 h-7 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-semibold">{i + 1}</div>
            <div className="text-sm"><span className="text-text-main">When </span><span className="font-medium">{r.when}</span></div>
            <Icon name="arrow_forward" className="text-[18px] text-outline" />
            <div className="text-sm"><span className="text-text-main">Assign to </span><span className="font-medium text-primary">{r.assign}</span></div>
            <div className="ml-auto flex items-center gap-3">
              <button onClick={() => toggle(i)} className="text-xs text-primary">{r.enabled ? 'Disable' : 'Enable'}</button>
              <button onClick={() => remove(i)} className="text-xs text-status-rejected">Delete</button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
