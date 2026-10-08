import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { PageTitle, Card, CardHeader, Icon, Badge, Button, EmptyState, Skeleton } from '../components/ui'
import { apiBase, authHeaders, backendOn, getRole } from '../lib/auth'
import { categoryMeta, statusMeta } from '../lib/format'
import type { Category, Status } from '../lib/types'

// ---- API ------------------------------------------------------------------------------
interface Stat { count: number; median_hours: number | null; avg_hours: number | null }
interface Dash {
  range: { date_from: string; date_to: string; days: number }
  kpis: { received: number; open_now: number; waiting_jd1: number; waiting_jd2: number; awaiting_docs: number; decided: number
    approved: number; partially_approved: number; rejected: number; amount_claimed: number; unassigned_open: number }
  turnaround: { to_jd2: Stat; jd2_decision: Stat; end_to_end: Stat }
  funnel: { key: string; label: string; count: number }[]
  by_day: { day: string; received: number; sent: number; decided: number }[]
  by_insurer: { insurer: string; received: number; open: number; in_jd2: number; decided: number; approved: number; amount_claimed: number; missing_docs: number }[]
  by_status: { key: string; count: number }[]
  by_category: { key: string; count: number }[]
  by_channel: { key: string; count: number }[]
  ageing: { label: string; count: number }[]
  workload: { username: string; name: string; assigned: boolean; open: number; in_jd2: number }[]
  attention: { id: string; reference: string; member: string; insurer: string; status: string; received_at: string; age_hours: number
    assignee: string | null; next_step: string; jd2_item_id: string | null; missing: string[] }[]
  ai: null | { requests: number; failed: number; tokens: number; users: number; per_claim_tokens: number | null; cost_usd?: number; per_claim_usd?: number | null }
  activity: null | { at: string; by: string; action: string; detail: string }[]
}
async function getDashboard(q: string): Promise<Dash> {
  const r = await fetch(`${apiBase()}/api/dashboard?${q}`, { headers: authHeaders() })
  if (!r.ok) throw new Error(`Loading the dashboard failed (${r.status})`)
  return r.json()
}

// ---- helpers ----------------------------------------------------------------------------
const RANGES: [string, string][] = [['1', 'Today'], ['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['custom', 'Custom']]
const n0 = (v: number) => v.toLocaleString('en-US')
function mmk(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B MMK`
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M MMK`
  return `${n0(Math.round(v))} MMK`
}
function dur(h: number | null | undefined) {
  if (h == null) return '—'
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`
  return `${(h / 24).toFixed(1)} days`
}
const shortDay = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0)
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function Kpi({ label, value, hint, icon, tone, onClick }: { label: string; value: ReactNode; hint?: ReactNode; icon: string; tone: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} disabled={!onClick}
      className={`text-left rounded-xl border border-outline-variant/70 bg-surface-container-lowest p-4 transition ${onClick ? 'hover:border-primary/50 hover:shadow-sm' : 'cursor-default'}`}>
      <div className="flex items-center gap-2 text-xs text-text-main">
        <span className={`w-7 h-7 rounded-lg grid place-items-center ${tone}`}><Icon name={icon} className="text-[16px]" /></span>{label}
      </div>
      <div className="mt-2 text-[26px] font-bold font-display text-on-surface leading-none tabular-nums">{value}</div>
      {hint && <div className="mt-1.5 text-xs text-outline">{hint}</div>}
    </button>
  )
}

/** Received bars per day, with sent-to-JD2 and decided as thinner bars beside them. */
function DailyChart({ rows }: { rows: Dash['by_day'] }) {
  const max = Math.max(1, ...rows.map((r) => Math.max(r.received, r.sent, r.decided)))
  const every = rows.length > 45 ? 7 : rows.length > 20 ? 3 : 1
  return (
    <div>
      <div className="flex items-end gap-[3px] h-44 border-b border-outline-variant/60" role="img" aria-label="Claims per day">
        {rows.map((r, i) => (
          <div key={r.day} className="flex-1 min-w-0 h-full flex items-end justify-center gap-[1px] group relative">
            <div className="w-1/2 max-w-[18px] bg-primary/80 rounded-t" style={{ height: `${(r.received / max) * 100}%` }} />
            <div className="w-1/4 max-w-[8px] bg-status-ai/70 rounded-t" style={{ height: `${(r.sent / max) * 100}%` }} />
            <div className="w-1/4 max-w-[8px] bg-status-approved/80 rounded-t" style={{ height: `${(r.decided / max) * 100}%` }} />
            <div className="pointer-events-none absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 whitespace-nowrap rounded-md bg-on-surface text-surface text-[11px] px-2 py-1 shadow">
              {shortDay(r.day)} · {r.received} received · {r.sent} sent · {r.decided} decided
            </div>
            {i % every === 0 && <span className="absolute -bottom-5 text-[10px] text-outline whitespace-nowrap">{shortDay(r.day)}</span>}
          </div>
        ))}
      </div>
      <div className="mt-7 flex flex-wrap gap-4 text-xs text-text-main">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-primary/80" />Received</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-status-ai/70" />Sent to JD2</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-status-approved/80" />Decided</span>
      </div>
    </div>
  )
}

function Bars({ rows, label, onPick }: { rows: { key: string; count: number }[]; label: (k: string) => string; onPick?: (k: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  if (!rows.length) return <p className="text-xs text-outline">Nothing in this period.</p>
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <button key={r.key} onClick={onPick ? () => onPick(r.key) : undefined} disabled={!onPick} className="w-full text-left group">
          <div className="flex justify-between text-xs mb-1"><span className={`text-text-main ${onPick ? 'group-hover:text-primary' : ''}`}>{label(r.key)}</span><span className="font-semibold tabular-nums">{r.count}</span></div>
          <div className="bg-surface-container rounded-full h-2"><div className="h-full bg-primary/80 rounded-full" style={{ width: `${(r.count / max) * 100}%` }} /></div>
        </button>
      ))}
    </div>
  )
}

const ACTION_LABEL: Record<string, string> = {
  jd2_handoff: 'Sent to JD2', jd2_decision: 'JD2 decision', delete_claim: 'Deleted', assign_claim: 'Assigned',
  ticket_reused: 'Re-scan', create_ticket: 'New ticket',
}

// ---- page -------------------------------------------------------------------------------
export function DashboardPage() {
  const nav = useNavigate()
  const [range, setRange] = useState('30')
  const today = iso(new Date())
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 864e5)))
  const [to, setTo] = useState(today)
  const q = range === 'custom' ? `date_from=${from}&date_to=${to}` : `days=${range}`
  const { data: d, isLoading, isError, error, refetch, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['dashboard', q], queryFn: () => getDashboard(q), enabled: backendOn(), refetchInterval: 60_000,
  })
  const isSuper = getRole() === 'super_admin'
  // open the Inbox with matching filters
  const inbox = (p: Record<string, string>) => nav('/inbox?' + new URLSearchParams(p).toString())
  // the exact days this dashboard shows (the server's range), so the Inbox shows the same tickets
  const periodQ: Record<string, string> = d ? { date: 'custom', from: d.range.date_from, to: d.range.date_to } : {}

  const rangePicker = (
    <>
      <div className="flex gap-1 rounded-lg bg-surface-container p-1" role="tablist" aria-label="Period">
        {RANGES.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={range === k} onClick={() => setRange(k)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium ${range === k ? 'bg-surface-container-lowest text-primary shadow-sm' : 'text-text-main hover:text-primary'}`}>{l}</button>
        ))}
      </div>
      {range === 'custom' && (
        <div className="flex items-center gap-1 text-xs">
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className="border border-outline-variant rounded-md px-2 py-1 bg-surface" aria-label="From" />
          <span className="text-outline">→</span>
          <input type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} className="border border-outline-variant rounded-md px-2 py-1 bg-surface" aria-label="To" />
        </div>
      )}
      <Button variant="ghost" size="sm" onClick={() => refetch()} loading={isFetching} title="Refresh (also refreshes every minute)"><Icon name="refresh" className="text-[16px]" /></Button>
    </>
  )

  if (!backendOn()) return (<div><PageTitle title="Dashboard" /><EmptyState icon="dashboard" title="Connect the backend to see live numbers." /></div>)

  return (
    <div>
      <PageTitle title="Dashboard" sub="Live numbers from your tickets, JD1 scans and JD2 decisions."
        meta={d ? <>Times in Myanmar time · {shortDay(d.range.date_from)} – {shortDay(d.range.date_to)} · updated {new Date(dataUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</> : undefined}
        action={rangePicker} />

      {isError && <Card className="p-4 mb-4 text-sm text-status-rejected flex items-center gap-2"><Icon name="error" />{String((error as any)?.message ?? error)}<Button size="sm" variant="outline" className="ml-auto" onClick={() => refetch()}>Try again</Button></Card>}

      {isLoading || !d ? (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">{Array.from({ length: 6 }).map((_, i) => <Card key={i} className="p-4"><Skeleton className="h-4 w-24" /><Skeleton className="h-7 w-14 mt-3" /></Card>)}</div>
      ) : (
        <div className="space-y-4">
          {/* KPIs */}
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <Kpi label="Received" icon="inbox" tone="bg-primary/10 text-primary" value={n0(d.kpis.received)}
              hint={d.kpis.amount_claimed ? `${mmk(d.kpis.amount_claimed)} claimed` : 'in this period'} onClick={() => inbox(periodQ)} />
            <Kpi label="Open now" icon="pending_actions" tone="bg-status-pending/10 text-status-pending" value={n0(d.kpis.open_now)}
              hint={d.kpis.unassigned_open ? `${d.kpis.unassigned_open} unassigned` : 'all assigned'} onClick={() => inbox({ status: 'open' })} />
            <Kpi label="Waiting in JD1" icon="document_scanner" tone="bg-brand-accent/10 text-brand-accent" value={n0(d.kpis.waiting_jd1)}
              hint={d.kpis.awaiting_docs ? `${d.kpis.awaiting_docs} missing documents` : 'not sent to JD2 yet'} onClick={() => inbox({ status: 'open', stage: 'jd1' })} />
            <Kpi label="Waiting for JD2" icon="gavel" tone="bg-status-ai/10 text-status-ai" value={n0(d.kpis.waiting_jd2)} hint="to be decided" onClick={() => inbox({ status: 'open', stage: 'jd2' })} />
            <Kpi label="Decided" icon="task_alt" tone="bg-status-approved/10 text-status-approved" value={n0(d.kpis.decided)}
              hint={d.kpis.decided ? `${d.kpis.approved} approved · ${d.kpis.partially_approved} partial · ${d.kpis.rejected} rejected` : 'in this period'} onClick={() => inbox({ status: 'done' })} />
            <Kpi label="Time to decision" icon="timer" tone="bg-secondary/10 text-secondary" value={dur(d.turnaround.end_to_end.median_hours)}
              hint={d.turnaround.end_to_end.count ? `median of ${d.turnaround.end_to_end.count} · received → decided` : 'no decisions yet'} />
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <Card className="xl:col-span-8 p-4">
              <CardHeader icon="bar_chart" title="Claims per day" hint={`${n0(d.kpis.received)} received in ${d.range.days} day${d.range.days === 1 ? '' : 's'}`} />
              {d.by_day.every((r) => !r.received && !r.sent && !r.decided)
                ? <EmptyState icon="inbox" title="No claims in this period" className="py-8" />
                : <DailyChart rows={d.by_day} />}
            </Card>
            <Card className="xl:col-span-4 p-4">
              <CardHeader icon="filter_alt" title="Pipeline" hint="How far this period's claims got" />
              <div className="space-y-3">
                {d.funnel.map((f, i) => (
                  <div key={f.key}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="text-text-main">{f.label}</span>
                      <span className="tabular-nums"><b>{f.count}</b>{i > 0 && d.funnel[0].count > 0 && <span className="text-outline"> · {pct(f.count, d.funnel[0].count)}%</span>}</span>
                    </div>
                    <div className="bg-surface-container rounded h-3"><div className="h-full rounded bg-primary" style={{ width: `${pct(f.count, Math.max(1, d.funnel[0].count))}%`, opacity: 1 - i * 0.13 }} /></div>
                  </div>
                ))}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-lg bg-surface-container p-2"><div className="text-outline">Received → sent</div><div className="font-semibold text-on-surface mt-0.5">{dur(d.turnaround.to_jd2.median_hours)}</div></div>
                <div className="rounded-lg bg-surface-container p-2"><div className="text-outline">JD2 decision</div><div className="font-semibold text-on-surface mt-0.5">{dur(d.turnaround.jd2_decision.median_hours)}</div></div>
              </div>
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <Card className="xl:col-span-7 p-0 overflow-hidden">
              <div className="p-4 pb-2"><CardHeader icon="domain" title="By insurer" hint="Claims received in this period" className="mb-0" /></div>
              {d.by_insurer.length === 0 ? <p className="px-4 pb-4 text-xs text-outline">Nothing in this period.</p> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-xs text-outline border-b border-outline-variant/60">
                      <th className="text-left font-medium px-4 py-2">Insurer</th><th className="text-right font-medium px-2">Received</th><th className="text-right font-medium px-2">Open</th>
                      <th className="text-right font-medium px-2">In JD2</th><th className="text-right font-medium px-2">Approved</th><th className="text-right font-medium px-2">Missing docs</th><th className="text-right font-medium px-4">Claimed</th>
                    </tr></thead>
                    <tbody>
                      {d.by_insurer.map((r) => (
                        <tr key={r.insurer} className="border-b border-outline-variant/30 last:border-0 hover:bg-surface-container/50 cursor-pointer" onClick={() => inbox({ insurer: r.insurer === 'Unknown' ? '' : r.insurer, ...periodQ })}>
                          <td className="px-4 py-2 font-medium text-on-surface">{r.insurer}</td>
                          <td className="text-right px-2 tabular-nums">{r.received}</td><td className="text-right px-2 tabular-nums">{r.open}</td>
                          <td className="text-right px-2 tabular-nums">{r.in_jd2}</td><td className="text-right px-2 tabular-nums">{r.approved}</td>
                          <td className={`text-right px-2 tabular-nums ${r.missing_docs ? 'text-status-rejected' : ''}`}>{r.missing_docs}</td>
                          <td className="text-right px-4 tabular-nums whitespace-nowrap">{r.amount_claimed ? mmk(r.amount_claimed) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
            <Card className="xl:col-span-5 p-4">
              <CardHeader icon="hourglass_bottom" title="Open work by age" hint="Everything still open, however old" />
              <div className="grid grid-cols-4 gap-2">
                {d.ageing.map((a, i) => (
                  <div key={a.label} className={`rounded-lg p-2 text-center ${i === 3 && a.count ? 'bg-status-rejected/10' : i === 2 && a.count ? 'bg-status-pending/10' : 'bg-surface-container'}`}>
                    <div className={`text-xl font-bold font-display tabular-nums ${i === 3 && a.count ? 'text-status-rejected' : 'text-on-surface'}`}>{a.count}</div>
                    <div className="text-[11px] text-text-main leading-tight mt-0.5">{a.label}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs font-semibold text-on-surface mb-2">Who has the open claims</div>
              {d.workload.length === 0 ? <p className="text-xs text-outline">No open claims.</p> : (
                <div className="space-y-1.5">
                  {d.workload.slice(0, 8).map((w) => (
                    <button key={w.username || w.name} onClick={() => inbox({ status: 'open', who: w.assigned ? `u:${w.username || w.name}` : 'unassigned' })}
                      className="w-full flex items-center gap-2 text-sm rounded-md px-1 py-0.5 hover:bg-surface-container">
                      <Icon name={w.assigned ? 'person' : 'person_off'} className={`text-[16px] ${w.assigned ? 'text-primary' : 'text-status-pending'}`} />
                      <span className="truncate text-left flex-1">{w.name}</span>
                      {w.in_jd2 > 0 && <span className="text-[11px] text-outline">{w.in_jd2} in JD2</span>}
                      <span className="font-semibold tabular-nums w-6 text-right">{w.open}</span>
                    </button>
                  ))}
                </div>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
            <Card className="xl:col-span-7 p-4">
              <CardHeader icon="priority_high" title="Needs attention" hint="Oldest open claims first, with the next step" />
              {d.attention.length === 0 ? <EmptyState icon="task_alt" title="Nothing waiting — all caught up." className="py-6" /> : (
                <div className="divide-y divide-outline-variant/40">
                  {d.attention.map((a) => (
                    <button key={a.id} onClick={() => nav(a.jd2_item_id ? `/jd2/${a.jd2_item_id}` : `/claim/${a.id}`)} className="w-full text-left flex items-center gap-3 py-2 hover:bg-surface-container/50 rounded-md px-1">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 text-sm"><span className="font-mono text-xs text-primary">{a.reference}</span><span className="truncate text-on-surface">{a.member}</span></div>
                        <div className="text-xs text-outline truncate">{a.insurer} · {a.next_step}{a.missing.length ? ` · missing ${a.missing.join(', ')}` : ''}{a.assignee ? ` · ${a.assignee}` : ' · unassigned'}</div>
                      </div>
                      <span className={`text-xs tabular-nums whitespace-nowrap ${a.age_hours > 168 ? 'text-status-rejected font-semibold' : a.age_hours > 72 ? 'text-status-pending' : 'text-outline'}`}>{dur(a.age_hours)}</span>
                      {statusMeta[a.status as Status] && <Badge className={statusMeta[a.status as Status].cls}>{statusMeta[a.status as Status].label}</Badge>}
                    </button>
                  ))}
                </div>
              )}
            </Card>
            <div className="xl:col-span-5 space-y-4">
              <Card className="p-4">
                <CardHeader icon="category" title="Request types" hint="This period" />
                <Bars rows={d.by_category} label={(k) => categoryMeta[k as Category]?.label ?? k} onPick={(k) => inbox({ tab: k, ...periodQ })} />
              </Card>
              {d.ai && (
                <Card className="p-4">
                  <CardHeader icon="auto_awesome" title="AI usage" hint="This period" action={<Button size="sm" variant="ghost" onClick={() => nav('/ai-usage')}>Details</Button>} />
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-lg bg-surface-container p-2"><div className="text-lg font-bold font-display tabular-nums">{n0(d.ai.tokens)}</div><div className="text-[11px] text-text-main">tokens used</div></div>
                    <div className="rounded-lg bg-surface-container p-2"><div className="text-lg font-bold font-display tabular-nums">{n0(d.ai.requests)}</div><div className="text-[11px] text-text-main">AI requests{d.ai.failed ? ` · ${d.ai.failed} failed` : ''}</div></div>
                    <div className="rounded-lg bg-surface-container p-2"><div className="text-lg font-bold font-display tabular-nums">{d.ai.per_claim_tokens != null ? n0(d.ai.per_claim_tokens) : '—'}</div><div className="text-[11px] text-text-main">tokens per claim</div></div>
                  </div>
                  {isSuper && d.ai.cost_usd != null && (
                    <p className="text-xs text-outline mt-2">Cost ${d.ai.cost_usd.toFixed(2)}{d.ai.per_claim_usd != null ? ` · $${d.ai.per_claim_usd.toFixed(3)} per claim received` : ''} (super admin only)</p>
                  )}
                </Card>
              )}
              {d.activity && (
                <Card className="p-4">
                  <CardHeader icon="history" title="Recent activity" />
                  {d.activity.length === 0 ? <p className="text-xs text-outline">No activity yet.</p> : (
                    <ul className="space-y-2">
                      {d.activity.slice(0, 8).map((e, i) => (
                        <li key={i} className="text-xs flex gap-2">
                          <span className="text-outline whitespace-nowrap w-16 shrink-0">{new Date(e.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}<br /><span className="text-[10px]">{new Date(e.at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span></span>
                          <span className="min-w-0"><b className="text-on-surface">{ACTION_LABEL[e.action] ?? e.action.replace(/_/g, ' ')}</b> · <span className="text-text-main">{e.detail}</span> <span className="text-outline">— {e.by}</span></span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
