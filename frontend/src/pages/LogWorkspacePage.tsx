import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getClaim } from '../lib/api'
import { Card, Badge, Icon, Button } from '../components/ui'

export function LogWorkspacePage() {
  const { id } = useParams(); const nav = useNavigate()
  const { data: c } = useQuery({ queryKey: ['claim', id], queryFn: () => getClaim(id!) })
  if (!c) return <p className="text-outline">Loading…</p>
  return (
    <div>
      <button onClick={() => nav('/inbox')} className="flex items-center gap-1 text-sm text-text-main mb-3 hover:text-primary">
        <Icon name="arrow_back" className="text-[18px]" /> Back to inbox
      </button>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl font-bold text-primary">LOG Request · {c.reference}</h1>
        <Badge className="bg-brand-accent/10 text-brand-accent">Est &gt; USD 1,000</Badge>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5 space-y-3">
          <h3 className="font-semibold text-sm">Facility &amp; provider</h3>
          {[['Member', c.memberName], ['Insurer', c.insurer], ['Hospital', 'Pun Hlaing'], ['Estimated cost', 'USD 4,850'], ['Length of stay', '2 days (inpatient)'], ['Appointment date', '2026-08-16']].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm"><span className="text-text-main">{k}</span><span className="font-medium">{v}</span></div>
          ))}
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-2">Coverage check</h3>
          <div className="flex items-start gap-2 bg-status-pending/10 text-status-pending rounded-lg p-3 text-sm">
            <Icon name="warning" className="text-[18px]" />
            <span>Estimated cost exceeds USD 1,000 — requires insurer approval before issuing the LOG.</span>
          </div>
          <div className="flex gap-2 mt-4"><Button>Issue LOG</Button><Button variant="outline">Request insurer approval</Button></div>
          <p className="text-xs text-outline mt-3">LOG is valid for 1 week from issue.</p>
        </Card>
      </div>
    </div>
  )
}
