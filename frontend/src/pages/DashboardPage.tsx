import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listClaims } from '../lib/api'
import { Card, Icon, Badge } from '../components/ui'
import { mockAudit, mockChannels } from '../mocks/admin'
import { statusMeta } from '../lib/format'

function Kpi({ label, value, icon, tone, sub }: { label: string; value: string; icon: string; tone: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between">
        <div className={`w-11 h-11 rounded-xl grid place-items-center bg-${tone}/10 text-${tone}`}><Icon name={icon} /></div>
        {sub && <span className="text-[11px] text-status-approved font-medium bg-status-approved/10 px-2 py-0.5 rounded-full">{sub}</span>}
      </div>
      <div className="text-3xl font-bold font-display text-on-surface mt-3 leading-none">{value}</div>
      <div className="text-xs text-text-main mt-1">{label}</div>
    </Card>
  )
}
export function DashboardPage() {
  const { data } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const nav = useNavigate()
  const [range, setRange] = useState('today')
  const items = data?.items ?? []
  const attention = items.filter((c) => c.status === 'ready_for_review' || c.status === 'awaiting_docs')
  const stage = [['JD1 · intake', items.length], ['JD2 · adjudication', items.filter((c) => c.documentsComplete).length], ['JD3 · medical', items.filter((c) => (c.amount ?? 0) >= 300000).length]] as [string, number][]
  const max = Math.max(1, ...stage.map((s) => s[1]))
  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-6 text-white bg-gradient-to-r from-primary to-primary-dark relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-brand-accent/20" />
        <div className="relative flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold flex items-center gap-2">Live Monitoring <span className="w-2 h-2 rounded-full bg-status-approved animate-pulse" /></h1>
            <p className="text-white/80 text-sm mt-1">Real-time view of the claims operation.</p>
          </div>
          <div className="flex gap-1 bg-white/10 rounded-lg p-1">
            {[['today', 'Today'], ['7d', '7 days'], ['30d', '30 days']].map(([k, l]) => (
              <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${range === k ? 'bg-white text-primary' : 'text-white/80'}`}>{l}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4">
        <Kpi label="New today" value={String(items.filter((c) => c.status === 'new').length)} icon="fiber_new" tone="status-ai" sub="+2" />
        <Kpi label="In progress" value={String(items.filter((c) => c.status === 'in_progress').length)} icon="autorenew" tone="status-pending" />
        <Kpi label="Awaiting review" value={String(items.filter((c) => c.status === 'ready_for_review').length)} icon="rate_review" tone="brand-accent" />
        <Kpi label="SLA breaches" value="0" icon="verified" tone="status-approved" sub="on track" />
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* queue by stage */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon name="filter_alt" className="text-[18px]" /></div><h3 className="font-semibold text-sm">Queue by stage</h3></div>
          <div className="space-y-3">
            {stage.map(([k, v]) => (
              <div key={k}><div className="flex justify-between text-xs mb-1"><span className="text-text-main">{k}</span><span className="font-semibold">{v}</span></div>
                <div className="bg-surface-container rounded-full h-2.5"><div className="h-full bg-primary rounded-full" style={{ width: `${(v / max) * 100}%` }} /></div></div>
            ))}
          </div>
        </Card>
        {/* needs attention */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg bg-brand-accent/10 text-brand-accent grid place-items-center"><Icon name="priority_high" className="text-[18px]" /></div><h3 className="font-semibold text-sm">Needs attention</h3></div>
          <div className="space-y-2">
            {attention.map((c) => (
              <div key={c.id} onClick={() => nav(`/claim/${c.id}`)} className="flex items-center gap-2 text-sm p-2 rounded-lg hover:bg-surface-container cursor-pointer">
                <span className="font-medium text-primary">{c.reference}</span><span className="text-text-main truncate">{c.memberName}</span>
                <Badge className={`ml-auto ${statusMeta[c.status].cls}`}>{statusMeta[c.status].label}</Badge>
              </div>
            ))}
            {attention.length === 0 && <p className="text-xs text-outline">Nothing needs attention.</p>}
          </div>
        </Card>
        {/* channel status */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg bg-secondary/10 text-secondary grid place-items-center"><Icon name="hub" className="text-[18px]" /></div><h3 className="font-semibold text-sm">Channel status</h3></div>
          <div className="space-y-2">
            {mockChannels.map((ch) => (
              <div key={ch.name} className="flex items-center gap-2 text-sm">
                <Icon name={ch.icon} className="text-[18px] text-text-main" />{ch.name}
                <span className={`ml-auto flex items-center gap-1 text-xs ${ch.connected ? 'text-status-approved' : 'text-outline'}`}><span className={`w-1.5 h-1.5 rounded-full ${ch.connected ? 'bg-status-approved' : 'bg-outline'}`} />{ch.connected ? 'Live' : 'Off'}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* recent activity feed */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3"><div className="w-8 h-8 rounded-lg bg-status-ai/10 text-status-ai grid place-items-center"><Icon name="bolt" className="text-[18px]" /></div><h3 className="font-semibold text-sm">Recent activity</h3></div>
        <div className="space-y-1">
          {mockAudit.slice(0, 5).map((a, i) => (
            <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b border-outline-variant/40 last:border-0">
              {a.user === 'AI' ? <Badge className="bg-status-ai/10 text-status-ai">AI</Badge> : <span className="w-6 h-6 rounded-full bg-secondary/15 text-secondary grid place-items-center text-[10px] font-semibold">{a.user.split(' ')[0][0]}</span>}
              <span className="text-on-surface">{a.action}</span>
              <span className="text-primary font-medium">{a.item}</span>
              <span className="ml-auto text-xs text-outline">{a.time.split(' ')[1]}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
