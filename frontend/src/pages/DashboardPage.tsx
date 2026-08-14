import { useQuery } from '@tanstack/react-query'
import { listClaims } from '../lib/api'
import { PageTitle, Card, StatCard } from '../components/ui'

export function DashboardPage() {
  const { data } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const items = data?.items ?? []
  const byChannel = items.reduce<Record<string, number>>((a, c) => (a[c.channel] = (a[c.channel] ?? 0) + 1, a), {})
  const stageData = [{ label: 'JD1', v: items.length }, { label: 'JD2', v: items.filter(c => c.documentsComplete).length }, { label: 'JD3', v: items.filter(c => (c.amount ?? 0) >= 300000).length }]
  const max = Math.max(1, ...stageData.map(s => s.v))
  return (
    <div>
      <PageTitle title="Dashboard" sub="Today at a glance" />
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="New today" value={String(items.filter(c => c.status === 'new').length)} icon="fiber_new" />
        <StatCard label="In progress" value={String(items.filter(c => c.status === 'in_progress').length)} icon="autorenew" tone="status-pending" />
        <StatCard label="Awaiting my review" value={String(items.filter(c => c.status === 'ready_for_review').length)} icon="rate_review" tone="status-ai" />
        <StatCard label="SLA breaches" value="0" icon="warning" tone="status-rejected" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5">
          <h3 className="font-semibold text-on-surface mb-4 text-sm">Volume by stage (funnel)</h3>
          <div className="space-y-3">
            {stageData.map(s => (
              <div key={s.label} className="flex items-center gap-3">
                <div className="w-10 text-sm text-text-main">{s.label}</div>
                <div className="flex-1 bg-surface-container rounded-full h-6 overflow-hidden">
                  <div className="h-full bg-primary rounded-full flex items-center justify-end pr-2 text-white text-xs"
                    style={{ width: `${(s.v / max) * 100}%` }}>{s.v}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
        <Card className="p-5">
          <h3 className="font-semibold text-on-surface mb-4 text-sm">By channel</h3>
          <div className="space-y-2">
            {Object.entries(byChannel).map(([ch, n]) => (
              <div key={ch} className="flex items-center justify-between text-sm">
                <span className="capitalize text-text-main">{ch}</span>
                <span className="font-semibold">{n}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  )
}
