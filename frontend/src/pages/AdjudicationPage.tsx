import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { getClaim } from '../lib/api'
import { Card, Badge, Icon, Button } from '../components/ui'
export function AdjudicationPage() {
  const { id } = useParams(); const nav = useNavigate()
  const { data: c } = useQuery({ queryKey: ['claim', id], queryFn: () => getClaim(id!) })
  if (!c) return <p className="text-outline">Loading…</p>
  const big = (c.amount ?? 0) >= 300000
  const rec = big ? 'Partial approval' : 'Approve'
  return (
    <div>
      <button onClick={() => nav('/inbox')} className="flex items-center gap-1 text-sm text-text-main mb-3 hover:text-primary"><Icon name="arrow_back" className="text-[18px]" /> Back</button>
      <div className="flex items-center gap-3 mb-4">
        <h1 className="font-display text-2xl font-bold text-primary">JD3 Adjudication · {c.reference}</h1>
        <Badge className="bg-status-approved/10 text-status-approved">{c.insurer}</Badge>
        <span className="text-sm text-text-main">{c.memberName} · {c.amount ? c.amount.toLocaleString() + ' MMK' : '—'}</span>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold text-sm mb-3">Applicable benefits (Table of Benefits)</h3>
          {[['Hospitalisation — medical treatment', 'Full refund'], ['Post-hospitalisation', 'Nil'], ['Ambulance', 'Up to 165,000'], ['Chronic — first onset', '11,000,000']].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm py-1 border-b border-outline-variant/40 last:border-0"><span className="text-text-main">{k}</span><span className="font-medium">{v}</span></div>
          ))}
        </Card>
        <Card className="p-5 border-l-4 border-primary">
          <div className="flex items-center gap-2 mb-2"><Icon name="smart_toy" className="text-status-ai text-[20px]" /><h3 className="font-semibold text-sm">AI recommendation</h3></div>
          <div className="text-lg font-bold text-primary mb-1">{rec}</div>
          <p className="text-sm text-text-main mb-3">{big
            ? 'Amount exceeds 300,000 MMK — post-hospitalisation items are not covered (Nil), so recommend partial approval excluding those lines. Reason: policy sub-limit.'
            : 'Within limits and covered benefits. No exclusions triggered.'}</p>
          <div className="flex gap-2"><Button>Approve</Button><Button variant="outline">Partial</Button><Button variant="ghost">Reject</Button></div>
          <p className="text-xs text-outline mt-3">Doctor makes the final decision; the AI only recommends.</p>
        </Card>
      </div>
    </div>
  )
}
