import { useQuery } from '@tanstack/react-query'
import { listClaims } from '../lib/api'
import { PageTitle, Card, StatCard } from '../components/ui'
function Bars({ data }: { data: [string, number][] }) {
  const max = Math.max(1, ...data.map((d) => d[1]))
  return (
    <div className="space-y-2">
      {data.map(([k, v]) => (
        <div key={k} className="flex items-center gap-3">
          <div className="w-28 text-sm text-text-main capitalize">{k}</div>
          <div className="flex-1 bg-surface-container rounded-full h-5 overflow-hidden">
            <div className="h-full bg-primary rounded-full flex items-center justify-end pr-2 text-white text-xs" style={{ width: `${(v / max) * 100}%` }}>{v}</div>
          </div>
        </div>
      ))}
    </div>
  )
}
export function ReportsPage() {
  const { data } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const items = data?.items ?? []
  const by = (f: (c: any) => string) => Object.entries(items.reduce<Record<string, number>>((a, c) => (a[f(c)] = (a[f(c)] ?? 0) + 1, a), {})) as [string, number][]
  return (
    <div>
      <PageTitle title="Reports & Analytics" sub="Volumes and performance (demo data)." />
      <div className="grid grid-cols-4 gap-4 mb-6">
        <StatCard label="Total claims" value={String(items.length)} icon="description" />
        <StatCard label="Avg TAT" value="7 days" icon="timer" tone="status-pending" />
        <StatCard label="SLA compliance" value="94%" icon="verified" tone="status-approved" />
        <StatCard label="AI extraction acc." value="88%" icon="smart_toy" tone="status-ai" />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <Card className="p-5"><h3 className="font-semibold text-sm mb-4">By channel</h3><Bars data={by((c) => c.channel)} /></Card>
        <Card className="p-5"><h3 className="font-semibold text-sm mb-4">By insurer</h3><Bars data={by((c) => c.insurer)} /></Card>
        <Card className="p-5"><h3 className="font-semibold text-sm mb-4">By category</h3><Bars data={by((c) => c.category.replace('_', ' '))} /></Card>
        <Card className="p-5"><h3 className="font-semibold text-sm mb-4">By status</h3><Bars data={by((c) => c.status.replace('_', ' '))} /></Card>
      </div>
    </div>
  )
}
