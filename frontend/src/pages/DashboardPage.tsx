import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listClaims } from '../lib/api'
import { Card, Icon, Badge } from '../components/ui'
import { ChannelGlyph } from '../components/BrandIcons'
import { mockChannels } from '../mocks/admin'
import { statusMeta } from '../lib/format'
import { usePersistent, genId } from '../lib/persist'

type WType = 'kpi' | 'chart' | 'note' | 'stage' | 'attention' | 'channels' | 'activity'
interface Widget { id: string; type: WType; title: string; w: number; metric?: string; value?: string; chartBy?: string }

const DEFAULTS: Widget[] = [
  { id: 'k1', type: 'kpi', title: 'New', w: 3, metric: 'new' },
  { id: 'k2', type: 'kpi', title: 'In progress', w: 3, metric: 'in_progress' },
  { id: 'k3', type: 'kpi', title: 'Awaiting review', w: 3, metric: 'ready_for_review' },
  { id: 'k4', type: 'kpi', title: 'Total claims', w: 3, metric: 'total' },
  { id: 'w1', type: 'stage', title: 'Queue by stage', w: 4 },
  { id: 'w2', type: 'attention', title: 'Needs attention', w: 4 },
  { id: 'w3', type: 'channels', title: 'Channel status', w: 4 },
  { id: 'w4', type: 'chart', title: 'Claims by status', w: 6, chartBy: 'status' },
  { id: 'w5', type: 'activity', title: 'Recent activity', w: 6 },
]
const PALETTE: { type: WType; label: string; icon: string; w: number }[] = [
  { type: 'kpi', label: 'KPI card', icon: '123', w: 3 },
  { type: 'chart', label: 'Chart', icon: 'bar_chart', w: 6 },
  { type: 'note', label: 'Note', icon: 'sticky_note_2', w: 4 },
  { type: 'stage', label: 'Queue by stage', icon: 'filter_alt', w: 4 },
  { type: 'attention', label: 'Needs attention', icon: 'priority_high', w: 4 },
  { type: 'channels', label: 'Channel status', icon: 'hub', w: 4 },
  { type: 'activity', label: 'Recent activity', icon: 'bolt', w: 6 },
]
const KPI_METRICS = [['new', 'New'], ['in_progress', 'In progress'], ['ready_for_review', 'Awaiting review'], ['total', 'Total claims'], ['custom', 'Custom value']]
const CHART_BY = ['status', 'category', 'insurer', 'channel']

function inRange(iso: string, range: string, from: string, to: string): boolean {
  if (!iso) return true
  const t = new Date(iso).getTime(); const now = Date.now()
  if (range === 'today') { const s = new Date(); s.setHours(0, 0, 0, 0); return t >= s.getTime() }
  if (range === '7d') return t >= now - 7 * 864e5
  if (range === '30d') return t >= now - 30 * 864e5
  if (range === 'custom') { const f = from ? new Date(from).getTime() : -Infinity; const e = to ? new Date(to).getTime() + 864e5 : Infinity; return t >= f && t <= e }
  return true
}

export function DashboardPage() {
  const { data } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const nav = useNavigate()
  const [range, setRange] = useState('today')
  const [from, setFrom] = useState(''); const [to, setTo] = useState('')
  const [editing, setEditing] = useState(false)
  const [widgets, setWidgets] = usePersistent<Widget[]>('dashboard.v2', DEFAULTS)

  const items = useMemo(() => (data?.items ?? []).filter((c) => inRange(c.receivedAt as any, range, from, to)), [data, range, from, to])
  const attention = items.filter((c) => c.status === 'ready_for_review' || c.status === 'awaiting_docs')
  const stage = [['JD1 · intake', items.length], ['JD2 · adjudication', items.filter((c) => c.documentsComplete).length], ['JD3 · medical', items.filter((c) => (c.amount ?? 0) >= 300000).length]] as [string, number][]
  const stageMax = Math.max(1, ...stage.map((s) => s[1]))

  function metricValue(m?: string, custom?: string) {
    if (m === 'total') return String(items.length)
    if (m === 'custom') return custom || '0'
    return String(items.filter((c) => c.status === m).length)
  }
  function counts(by?: string) {
    const m: Record<string, number> = {}
    items.forEach((c: any) => { const k = String(c[by || 'status'] || '—'); m[k] = (m[k] ?? 0) + 1 })
    return Object.entries(m)
  }
  function upd(id: string, p: Partial<Widget>) { setWidgets((ws) => ws.map((w) => w.id === id ? { ...w, ...p } : w)) }
  function add(t: WType, w: number) { setWidgets((ws) => [...ws, { id: genId(), type: t, title: PALETTE.find((p) => p.type === t)?.label || 'Widget', w, metric: 'new', chartBy: 'status', value: '' }]) }
  function move(id: string, dir: -1 | 1) { setWidgets((ws) => { const i = ws.findIndex((w) => w.id === id); const j = i + dir; if (j < 0 || j >= ws.length) return ws; const a = [...ws];[a[i], a[j]] = [a[j], a[i]]; return a }) }

  function Body({ wg }: { wg: Widget }) {
    if (wg.type === 'kpi') return <div><div className="text-3xl font-bold font-display text-on-surface leading-none">{metricValue(wg.metric, wg.value)}</div><div className="text-xs text-text-main mt-1">{wg.title}</div></div>
    if (wg.type === 'note') return editing
      ? <textarea className="w-full text-sm border border-outline-variant rounded p-2" rows={4} value={wg.value || ''} onChange={(e) => upd(wg.id, { value: e.target.value })} placeholder="Write a note…" />
      : <p className="text-sm text-text-main whitespace-pre-wrap">{wg.value || 'Empty note.'}</p>
    if (wg.type === 'chart') {
      const c = counts(wg.chartBy); const mx = Math.max(1, ...c.map((x) => x[1]))
      return <div className="space-y-1.5">{c.length === 0 && <p className="text-xs text-outline">No data.</p>}{c.map(([k, v]) => (
        <div key={k}><div className="flex justify-between text-xs mb-0.5"><span className="text-text-main capitalize">{k}</span><span className="font-semibold">{v}</span></div>
          <div className="bg-surface-container rounded-full h-2"><div className="h-full bg-primary rounded-full" style={{ width: `${(v / mx) * 100}%` }} /></div></div>))}</div>
    }
    if (wg.type === 'stage') return <div className="space-y-3">{stage.map(([k, v]) => (
      <div key={k}><div className="flex justify-between text-xs mb-1"><span className="text-text-main">{k}</span><span className="font-semibold">{v}</span></div>
        <div className="bg-surface-container rounded-full h-2.5"><div className="h-full bg-primary rounded-full" style={{ width: `${(v / stageMax) * 100}%` }} /></div></div>))}</div>
    if (wg.type === 'attention') return <div className="space-y-2">{attention.map((c) => (
      <div key={c.id} onClick={() => nav(`/claim/${c.id}`)} className="flex items-center gap-2 text-sm p-2 rounded-lg hover:bg-surface-container cursor-pointer">
        <span className="font-medium text-primary">{c.reference}</span><span className="text-text-main truncate">{c.memberName}</span>
        <Badge className={`ml-auto ${statusMeta[c.status].cls}`}>{statusMeta[c.status].label}</Badge></div>))}{attention.length === 0 && <p className="text-xs text-outline">Nothing needs attention.</p>}</div>
    if (wg.type === 'channels') return <div className="space-y-2">{mockChannels.map((ch) => (
      <div key={ch.name} className="flex items-center gap-2 text-sm"><ChannelGlyph glyph={ch.glyph} className="text-[18px] text-text-main" />{ch.name}
        <span className={`ml-auto flex items-center gap-1 text-xs ${ch.connected ? 'text-status-approved' : 'text-outline'}`}><span className={`w-1.5 h-1.5 rounded-full ${ch.connected ? 'bg-status-approved' : 'bg-outline'}`} />{ch.connected ? 'Live' : 'Off'}</span></div>))}</div>
    return <p className="text-xs text-outline">No recent activity.</p> // activity
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-6 text-white bg-gradient-to-r from-primary to-primary-dark relative overflow-hidden">
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-brand-accent/20" />
        <div className="relative flex items-center justify-between flex-wrap gap-3">
          <div><h1 className="font-display text-2xl font-bold flex items-center gap-2">Dashboard <span className="w-2 h-2 rounded-full bg-status-approved animate-pulse" /></h1>
            <p className="text-white/80 text-sm mt-1">Build your own view — add, arrange and remove widgets.</p></div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex gap-1 bg-white/10 rounded-lg p-1">
              {[['today', 'Today'], ['7d', '7d'], ['30d', '30d'], ['custom', 'Custom']].map(([k, l]) => (
                <button key={k} onClick={() => setRange(k)} className={`px-3 py-1.5 rounded-md text-xs font-medium ${range === k ? 'bg-white text-primary' : 'text-white/80'}`}>{l}</button>))}
            </div>
            {range === 'custom' && <div className="flex items-center gap-1 text-xs"><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="bg-white/90 text-primary rounded px-2 py-1" /><span>→</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="bg-white/90 text-primary rounded px-2 py-1" /></div>}
            <button onClick={() => setEditing((v) => !v)} className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1 ${editing ? 'bg-white text-primary' : 'bg-white/10'}`}><Icon name="tune" className="text-[16px]" />{editing ? 'Done' : 'Customize'}</button>
          </div>
        </div>
      </div>

      {editing && (
        <Card className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold mr-1">Add widget:</span>
            {PALETTE.map((p) => <button key={p.type + p.label} onClick={() => add(p.type, p.w)} className="text-xs flex items-center gap-1 border border-outline-variant rounded-lg px-2 py-1 hover:bg-surface-container"><Icon name={p.icon} className="text-[15px] text-primary" />{p.label}</button>)}
            <button onClick={() => setWidgets(DEFAULTS)} className="ml-auto text-xs text-outline hover:text-primary">Reset layout</button>
          </div>
        </Card>
      )}

      <div className="grid grid-cols-12 gap-4">
        {widgets.map((wg) => (
          <div key={wg.id} className={`col-span-${wg.w}`} style={{ gridColumn: `span ${wg.w} / span ${wg.w}` }}>
            <Card className="p-4 h-full">
              <div className="flex items-center gap-2 mb-2">
                {editing ? <input value={wg.title} onChange={(e) => upd(wg.id, { title: e.target.value })} className="text-sm font-semibold border border-outline-variant rounded px-1.5 py-0.5 flex-1" />
                  : <h3 className="font-semibold text-sm flex-1">{wg.title}</h3>}
                {editing && (
                  <div className="flex items-center gap-1">
                    <button onClick={() => move(wg.id, -1)} className="text-outline hover:text-primary"><Icon name="chevron_left" className="text-[16px]" /></button>
                    <button onClick={() => move(wg.id, 1)} className="text-outline hover:text-primary"><Icon name="chevron_right" className="text-[16px]" /></button>
                    <select value={wg.w} onChange={(e) => upd(wg.id, { w: Number(e.target.value) })} className="text-xs border border-outline-variant rounded px-1"><option value={3}>¼</option><option value={4}>⅓</option><option value={6}>½</option><option value={12}>Full</option></select>
                    <button onClick={() => setWidgets((ws) => ws.filter((x) => x.id !== wg.id))} className="text-status-rejected"><Icon name="close" className="text-[16px]" /></button>
                  </div>
                )}
              </div>
              {editing && wg.type === 'kpi' && <select value={wg.metric} onChange={(e) => upd(wg.id, { metric: e.target.value })} className="text-xs border border-outline-variant rounded px-1 py-0.5 mb-2 w-full">{KPI_METRICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>}
              {editing && wg.type === 'kpi' && wg.metric === 'custom' && <input value={wg.value || ''} onChange={(e) => upd(wg.id, { value: e.target.value })} placeholder="value" className="text-xs border border-outline-variant rounded px-1 py-0.5 mb-2 w-full" />}
              {editing && wg.type === 'chart' && <select value={wg.chartBy} onChange={(e) => upd(wg.id, { chartBy: e.target.value })} className="text-xs border border-outline-variant rounded px-1 py-0.5 mb-2 w-full">{CHART_BY.map((c) => <option key={c} value={c}>by {c}</option>)}</select>}
              <Body wg={wg} />
            </Card>
          </div>
        ))}
        {widgets.length === 0 && <div className="col-span-12"><Card className="p-10 text-center text-sm text-text-main">No widgets. Click <b>Customize</b> → add some.</Card></div>}
      </div>
    </div>
  )
}
