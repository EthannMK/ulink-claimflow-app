import { useQuery } from '@tanstack/react-query'
import { listClaims } from '../lib/api'
import { Card, Icon } from '../components/ui'

function Stat({ label, value, icon, tone, sub }: { label: string; value: string; icon: string; tone: string; sub?: string }) {
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
function Bars({ data, color = 'primary' }: { data: [string, number][]; color?: string }) {
  const max = Math.max(1, ...data.map((d) => d[1]))
  return (
    <div className="space-y-2.5">
      {data.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3">
          <div className="w-24 text-sm text-text-main capitalize truncate">{k}</div>
          <div className="flex-1 bg-surface-container rounded-full h-6 overflow-hidden">
            <div className={`h-full bg-${color} rounded-full flex items-center justify-end pr-2 text-white text-xs font-medium`} style={{ width: `${Math.max(12, (v / max) * 100)}%` }}>{v}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
export function DashboardPage() {
  const { data } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const items = data?.items ?? []
  const by = (f: (c: any) => string) => Object.entries(items.reduce<Record<string, number>>((a, c) => (a[f(c)] = (a[f(c)] ?? 0) + 1, a), {})) as [string, number][]
  const stage = [['JD1', items.length], ['JD2', items.filter((c) => c.documentsComplete).length], ['JD3', items.filter((c) => (c.amount ?? 0) >= 300000).length]] as [string, number][]
  return (
    <div className="space-y-6">
      {/* hero */}
      <div className="rounded-2xl p-6 text-white bg-gradient-to-r from-primary to-primary-dark relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-brand-accent/20" />
        <div className="absolute right-16 bottom-0 w-24 h-24 rounded-full bg-white/10" />
        <div className="relative">
          <h1 className="font-display text-2xl font-bold">Good morning, Admin 👋</h1>
          <p className="text-white/80 text-sm mt-1">Here's what's happening across your claims today.</p>
        </div>
      </div>
      {/* stats */}
      <div className="grid grid-cols-4 gap-4">
        <Stat label="New today" value={String(items.filter((c) => c.status === 'new').length)} icon="fiber_new" tone="status-ai" sub="+2" />
        <Stat label="In progress" value={String(items.filter((c) => c.status === 'in_progress').length)} icon="autorenew" tone="status-pending" />
        <Stat label="Awaiting my review" value={String(items.filter((c) => c.status === 'ready_for_review').length)} icon="rate_review" tone="brand-accent" />
        <Stat label="SLA breaches" value="0" icon="verified" tone="status-approved" sub="on track" />
      </div>
      {/* charts */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon name="filter_alt" className="text-[18px]" /></div><h3 className="font-semibold text-sm">Volume by stage (funnel)</h3></div>
          <Bars data={stage} />
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-brand-accent/10 text-brand-accent grid place-items-center"><Icon name="hub" className="text-[18px]" /></div><h3 className="font-semibold text-sm">By channel</h3></div>
          <Bars data={by((c) => c.channel)} color="brand-accent" />
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-secondary/10 text-secondary grid place-items-center"><Icon name="category" className="text-[18px]" /></div><h3 className="font-semibold text-sm">By category</h3></div>
          <Bars data={by((c) => c.category.replace('_', ' '))} color="secondary" />
        </Card>
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-4"><div className="w-8 h-8 rounded-lg bg-status-approved/10 text-status-approved grid place-items-center"><Icon name="shield" className="text-[18px]" /></div><h3 className="font-semibold text-sm">By insurer</h3></div>
          <Bars data={by((c) => c.insurer)} color="status-approved" />
        </Card>
      </div>
    </div>
  )
}
