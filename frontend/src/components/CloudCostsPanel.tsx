import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCloudCosts, getCostSettings, saveCostSettings, type CloudCosts, type CostSettings } from '../lib/api'
import { Card, Badge, Button, Icon } from './ui'

const usd = (n: number | null | undefined, dp = 2) => (n == null ? '—' : `${n < 0 ? '-' : ''}$${Math.abs(n).toFixed(dp)}`)
const monthLabel = (m: string) => new Date(+m.slice(0, 4), +m.slice(4) - 1, 1).toLocaleDateString([], { month: 'short', year: 'numeric' })
const dayLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' })
const STRIPES = 'repeating-linear-gradient(135deg, rgb(var(--c-primary, 0 51 102) / 0.35) 0 3px, transparent 3px 7px)'

function recentMonths(n = 12): string[] {
  const out: string[] = []; const d = new Date(); d.setDate(1)
  for (let i = 0; i < n; i++) { out.push(`${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1) }
  return out
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'warn' | 'bad' }) {
  const toneCls = tone === 'bad' ? 'text-status-rejected' : tone === 'warn' ? 'text-status-pending' : 'text-on-surface'
  return (
    <Card className="p-4 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-outline">{label}</div>
      <div className={`text-2xl font-bold font-display mt-1 leading-none tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-text-main mt-1.5">{sub}</div>}
    </Card>
  )
}

/** Single-series bars (one hue). Projected days/months are striped. Hover shows the breakdown. */
function Bars({ bars, onPick }: {
  bars: { key: string; label: string; value: number; projected?: number; parts?: Record<string, number>; note?: string }[]
  onPick?: (key: string) => void
}) {
  const [hover, setHover] = useState<number | null>(null)
  const max = Math.max(0.0001, ...bars.map((b) => Math.max(b.value, 0) + (b.projected ?? 0)))
  const h = bars[hover ?? -1]
  return (
    <div className="relative">
      <div className="flex items-end gap-[2px] h-48 border-b border-outline-variant pt-6" onMouseLeave={() => setHover(null)}>
        {bars.map((b, i) => {
          const actual = Math.max(b.value, 0) / max * 100
          const proj = (b.projected ?? 0) / max * 100
          return (
            <div key={b.key} className="flex-1 h-full flex flex-col justify-end cursor-default" onMouseEnter={() => setHover(i)}
              onClick={() => onPick?.(b.key)} role="img" aria-label={`${b.label}: ${usd(b.value)}${b.projected ? `, projected ${usd(b.projected)}` : ''}`}>
              {proj > 0 && <div className="w-full rounded-t-[4px]" style={{ height: `${proj}%`, background: STRIPES, border: '1px dashed rgb(0 51 102 / 0.45)', borderBottom: 0 }} />}
              {actual > 0 && <div className={`w-full ${proj > 0 ? '' : 'rounded-t-[4px]'} ${hover === i ? 'bg-primary' : 'bg-primary/80'}`} style={{ height: `${Math.max(actual, 0.8)}%` }} />}
            </div>
          )
        })}
      </div>
      <div className="flex gap-[2px] mt-1 text-[10px] text-outline">
        {bars.map((b, i) => <div key={b.key} className="flex-1 text-center truncate">{bars.length <= 14 || i % Math.ceil(bars.length / 10) === 0 ? b.label : ''}</div>)}
      </div>
      {h && (
        <div className="absolute top-0 right-0 bg-white border border-outline-variant rounded-lg shadow-lg px-3 py-2 text-xs min-w-[12rem] pointer-events-none z-10">
          <div className="font-semibold text-on-surface mb-1">{h.label}</div>
          <div className="flex justify-between gap-4"><span className="text-text-main">{h.projected ? 'Spent so far' : 'Net cost'}</span><b className="tabular-nums">{usd(h.value, 3)}</b></div>
          {h.projected ? <div className="flex justify-between gap-4"><span className="text-text-main">Forecast</span><b className="tabular-nums">{usd(h.projected, 3)}</b></div> : null}
          {h.parts && Object.entries(h.parts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => (
            <div key={k} className="flex justify-between gap-4 text-outline"><span className="truncate max-w-[10rem]">{k}</span><span className="tabular-nums">{usd(v, 3)}</span></div>
          ))}
          {h.note && <div className="text-outline mt-1">{h.note}</div>}
        </div>
      )}
    </div>
  )
}

export function CloudCostsPanel() {
  const qc = useQueryClient()
  const months = useMemo(() => recentMonths(12), [])
  const [month, setMonth] = useState(months[0])
  const [view, setView] = useState<'day' | 'month'>('day')
  const [comp, setComp] = useState('')
  const [asTable, setAsTable] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['cloud-costs', month], queryFn: () => getCloudCosts(month), staleTime: 5 * 60_000 })
  useEffect(() => { setComp('') }, [month])

  async function refresh() {
    setRefreshing(true)
    try { const d = await getCloudCosts(month, true); qc.setQueryData(['cloud-costs', month], d) } finally { setRefreshing(false) }
  }

  const d = data as CloudCosts | undefined
  const bars = useMemo(() => {
    if (!d) return []
    if (view === 'month') return d.by_month.map((m) => ({
      key: m.month, label: monthLabel(m.month), value: m.net,
      projected: m.forecast != null ? Math.max(m.forecast - m.net, 0) : undefined,
      parts: { 'Google Cloud (after credits)': m.google + m.credits, 'Backup AI service': m.other },
      note: m.forecast != null ? 'Striped part = forecast for the rest of the month' : undefined,
    }))
    return d.by_day.map((x) => {
      const v = comp ? (x.components[comp] ?? 0) : x.net
      return { key: x.day, label: dayLabel(x.day), value: x.future ? 0 : v, projected: !comp && x.future ? x.projected : undefined, parts: comp ? undefined : x.components,
        note: x.future ? 'Forecast at the recent daily pace' : undefined }
    })
  }, [d, view, comp])

  return (
    <div className="space-y-4">
      {/* controls */}
      <div className="flex items-center gap-2 flex-wrap">
        <select value={month} onChange={(e) => setMonth(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          {months.map((m, i) => <option key={m} value={m}>{monthLabel(m)}{i === 0 ? ' (this month)' : ''}</option>)}
        </select>
        <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1 text-sm">
          {([['day', 'By day'], ['month', 'By month']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`px-3 py-1 rounded-md ${view === k ? 'bg-white text-primary shadow-sm font-medium' : 'text-text-main'}`}>{l}</button>
          ))}
        </div>
        {view === 'day' && d && (
          <select value={comp} onChange={(e) => setComp(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2 max-w-[16rem]">
            <option value="">All components</option>
            {d.components.map((c) => <option key={c.component} value={c.component}>{c.component}</option>)}
          </select>
        )}
        <span className="ml-auto text-xs text-outline">{d?.updated ? `Google data as of ${new Date(d.updated).toLocaleString()}` : ''}</span>
        <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}><Icon name="refresh" className={`text-[16px] ${refreshing ? 'animate-spin' : ''}`} />Refresh</Button>
      </div>

      {isLoading && <Card className="p-8 text-center text-sm text-text-main"><Icon name="autorenew" className="text-[16px] animate-spin align-middle mr-1" />Reading the bill…</Card>}
      {error && <Card className="p-4 text-sm text-status-rejected">{String((error as Error).message)}</Card>}
      {d && d.google_error && (
        <Card className="p-4 text-sm bg-status-pending/5 border-status-pending/40">
          <div className="flex gap-2"><Icon name="info" className="text-status-pending text-[18px] shrink-0" />
            <div><b>Google Cloud costs aren't connected yet.</b> <span className="text-text-main">{d.google_error}</span>
              <div className="text-xs text-outline mt-1">Until then this page shows only the backup AI service (from the app's own records). See “Connect the Google Cloud bill” below.</div></div></div>
        </Card>
      )}

      {d && (
        <>
          {/* KPIs */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile label={d.is_current ? 'Spent this month' : 'Spent in month'} value={usd(d.totals.net)}
              sub={d.totals.credits ? `${usd(d.totals.cost)} usage − ${usd(-d.totals.credits)} credits` : 'after credits'} />
            <Tile label="Forecast month end" value={d.forecast ? usd(d.forecast.net) : '—'}
              sub={d.forecast ? `range ${usd(d.forecast.low)}–${usd(d.forecast.high)} · ${usd(d.forecast.pace_per_day, 3)}/day` : 'only for the current month'} />
            <Tile label="Last month" value={usd(d.totals.last_month_net)}
              sub={d.forecast && d.totals.last_month_net != null ? `${d.forecast.net >= d.totals.last_month_net ? '▲' : '▼'} ${usd(Math.abs(d.forecast.net - d.totals.last_month_net))} vs forecast` : undefined} />
            <Tile label="Monthly budget" value={d.budget ? usd(d.budget.amount, 0) : 'not set'}
              sub={d.budget ? `${d.budget.used_pct ?? 0}% used${d.budget.forecast_pct != null ? ` · forecast ${d.budget.forecast_pct}%` : ''}` : 'set it below'}
              tone={d.budget?.forecast_pct != null ? (d.budget.forecast_pct >= 100 ? 'bad' : d.budget.forecast_pct >= 80 ? 'warn' : 'ok') : undefined} />
            <Tile label="Free credits left" value={d.credits_info ? usd(d.credits_info.left) : '—'}
              sub={d.credits_info ? `${usd(d.credits_info.used)} of ${usd(d.credits_info.trial_total, 0)} used${d.credits_info.days_left_at_pace ? ` · ~${d.credits_info.days_left_at_pace} days at this pace` : ''}` : 'enter your trial credit below'} />
          </div>

          {/* chart */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="bar_chart" className="text-primary text-[18px]" />
              <h3 className="font-semibold text-sm">{view === 'day' ? `Daily cost · ${monthLabel(d.month)}${comp ? ` · ${comp}` : ''}` : 'Monthly cost'}</h3>
              <span className="text-xs text-outline">net, after credits · {d.currency}</span>
              <span className="ml-auto flex items-center gap-3 text-xs text-text-main">
                <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-primary/80" />Actual</span>
                {(d.forecast || view === 'month') && <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm" style={{ background: STRIPES, border: '1px dashed rgb(0 51 102 / 0.45)' }} />Forecast</span>}
                <button onClick={() => setAsTable((v) => !v)} className="text-primary hover:underline">{asTable ? 'Show chart' : 'Show table'}</button>
              </span>
            </div>
            {asTable ? (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-xs"><thead className="text-outline text-left sticky top-0 bg-white"><tr><th className="py-1">{view === 'day' ? 'Day' : 'Month'}</th><th className="text-right">Net cost</th><th className="text-right">Forecast</th></tr></thead>
                  <tbody>{bars.map((b) => <tr key={b.key} className="border-t border-outline-variant/40"><td className="py-1">{b.label}</td><td className="text-right tabular-nums">{usd(b.value, 3)}</td><td className="text-right tabular-nums text-outline">{b.projected ? usd(b.projected, 3) : ''}</td></tr>)}</tbody></table>
              </div>
            ) : <Bars bars={bars} onPick={view === 'month' ? (k) => { setMonth(k); setView('day') } : undefined} />}
            {view === 'month' && <p className="text-[11px] text-outline mt-2">Click a month to see its days.</p>}
          </Card>

          <div className="grid lg:grid-cols-5 gap-4 items-start">
            {/* components */}
            <Card className="p-5 lg:col-span-3">
              <div className="flex items-center gap-2 mb-2"><Icon name="stacked_bar_chart" className="text-primary text-[18px]" /><h3 className="font-semibold text-sm">By component · {monthLabel(d.month)}</h3>
                <span className="ml-auto text-xs text-outline">click a row to see it by day</span></div>
              {d.components.length === 0 && <p className="text-xs text-outline">No costs recorded for this month yet.</p>}
              <table className="w-full text-sm">
                <thead className="text-xs text-outline text-left"><tr><th className="py-1">Component</th><th className="text-right">Usage</th><th className="text-right">Credits</th><th className="text-right">Net</th><th className="w-28 pl-3">Share</th></tr></thead>
                <tbody>
                  {d.components.map((c) => (
                    <tr key={c.component} onClick={() => { setComp(c.component); setView('day') }} className={`border-t border-outline-variant/40 cursor-pointer hover:bg-primary/[0.03] ${comp === c.component ? 'bg-primary/[0.05]' : ''}`}>
                      <td className="py-1.5 pr-2"><div className="font-medium text-on-surface">{c.component}</div>
                        <div className="text-[10px] text-outline">{c.source === 'App estimate' ? 'billed separately · app estimate' : 'Google Cloud bill'}</div></td>
                      <td className="text-right tabular-nums">{usd(c.cost, 3)}</td>
                      <td className="text-right tabular-nums text-status-approved">{c.credits ? usd(c.credits, 3) : ''}</td>
                      <td className="text-right tabular-nums font-semibold">{usd(c.net, 3)}</td>
                      <td className="pl-3"><div className="h-1.5 rounded-full bg-surface-container overflow-hidden"><div className="h-full bg-primary/80 rounded-full" style={{ width: `${Math.round(c.share * 100)}%` }} /></div>
                        <div className="text-[10px] text-outline">{Math.round(c.share * 100)}%</div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>

            {/* AI */}
            <Card className="p-5 lg:col-span-2">
              <div className="flex items-center gap-2 mb-2"><Icon name="smart_toy" className="text-primary text-[18px]" /><h3 className="font-semibold text-sm">AI spend · {monthLabel(d.month)}</h3></div>
              <div className="text-sm space-y-1 mb-3">
                {d.ai.google_bill.map((x) => <div key={x.component} className="flex justify-between"><span className="text-text-main">{x.component} <span className="text-[10px] text-outline">(Google bill)</span></span><b className="tabular-nums">{usd(x.net, 3)}</b></div>)}
                <div className="flex justify-between"><span className="text-text-main">Backup AI service <span className="text-[10px] text-outline">(estimate)</span></span><b className="tabular-nums">{usd(d.ai.backup, 3)}</b></div>
              </div>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-outline mb-1">By feature (app records)</div>
              {d.ai.by_feature.length === 0 && <p className="text-xs text-outline">No AI calls this month.</p>}
              {d.ai.by_feature.map((f) => {
                const top = Math.max(...d.ai.by_feature.map((x) => x.cost), 0.0001)
                return (
                  <div key={f.feature} className="py-1" title={Object.entries(f.by_provider).map(([k, v]) => `${k}: ${usd(v, 4)}`).join('\n')}>
                    <div className="flex justify-between text-xs"><span className="text-on-surface">{f.feature}</span><span className="tabular-nums">{usd(f.cost, 3)} · {f.calls} calls</span></div>
                    <div className="h-1.5 rounded-full bg-surface-container overflow-hidden mt-0.5"><div className="h-full bg-primary/70 rounded-full" style={{ width: `${f.cost / top * 100}%` }} /></div>
                  </div>
                )
              })}
              <p className="text-[11px] text-outline mt-2">{d.ai.note}</p>
            </Card>
          </div>

          {d.skus.length > 0 && (
            <details className="bg-white rounded-xl border border-outline-variant shadow-sm">
              <summary className="px-5 py-3 text-sm font-semibold cursor-pointer">Top cost items (SKUs) · {monthLabel(d.month)}</summary>
              <table className="w-full text-xs mx-5 mb-4" style={{ width: 'calc(100% - 2.5rem)' }}>
                <thead className="text-outline text-left"><tr><th className="py-1">Component</th><th>Item</th><th className="text-right">Usage</th><th className="text-right">Net</th></tr></thead>
                <tbody>{d.skus.map((s, i) => <tr key={i} className="border-t border-outline-variant/40"><td className="py-1 pr-2">{s.component}</td><td className="pr-2 text-text-main">{s.sku}</td><td className="text-right tabular-nums">{usd(s.cost, 3)}</td><td className="text-right tabular-nums font-medium">{usd(s.net, 3)}</td></tr>)}</tbody>
              </table>
            </details>
          )}
          <p className="text-[11px] text-outline">Google publishes billing data several times a day; costs usually appear within 24 hours, so today's numbers are still filling in. The backup AI service isn't on the Google bill, so it comes from the app's own per-call records. Forecast = spent so far + the average of the last 7 days × days left.</p>
        </>
      )}

      <SetupCard onSaved={() => { qc.invalidateQueries({ queryKey: ['cloud-costs'] }); refetch() }} connected={!!d?.google_ok} table={d?.table} />
    </div>
  )
}

function SetupCard({ onSaved, connected, table }: { onSaved: () => void; connected: boolean; table?: string }) {
  const { data } = useQuery({ queryKey: ['cost-settings'], queryFn: getCostSettings })
  const [f, setF] = useState<CostSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => { if (data) setF(data) }, [data])
  useEffect(() => { if (!connected) setOpen(true) }, [connected])
  async function save() {
    if (!f) return
    setMsg('')
    try { setF(await saveCostSettings(f)); setMsg('Saved.'); onSaved() } catch (e: any) { setMsg(String(e?.message ?? e)) }
  }
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="bg-white rounded-xl border border-outline-variant shadow-sm">
      <summary className="px-5 py-3 text-sm font-semibold cursor-pointer flex items-center gap-2">
        <Icon name="settings" className="text-[18px] text-primary" />Connect the Google Cloud bill · budget · free credits
        {connected ? <Badge className="bg-status-approved/10 text-status-approved">Connected</Badge> : <Badge className="bg-status-pending/10 text-status-pending">Not connected</Badge>}
      </summary>
      <div className="px-5 pb-5 text-sm">
        {f && (
          <div className="flex items-end gap-3 flex-wrap mb-3">
            <label className="text-xs text-outline flex flex-col gap-0.5">Billing dataset (project.dataset)
              <input value={f.dataset} onChange={(e) => setF({ ...f, dataset: e.target.value })} className="text-sm border border-outline-variant rounded-md px-2 py-1 w-72 text-on-surface" /></label>
            <label className="text-xs text-outline flex flex-col gap-0.5">Monthly budget (USD)
              <input value={f.budget_usd ?? ''} onChange={(e) => setF({ ...f, budget_usd: num(e.target.value) })} inputMode="decimal" placeholder="none" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-32 text-on-surface" /></label>
            <label className="text-xs text-outline flex flex-col gap-0.5">Free trial credit (USD)
              <input value={f.trial_credit_usd ?? ''} onChange={(e) => setF({ ...f, trial_credit_usd: num(e.target.value) })} inputMode="decimal" placeholder="e.g. 300" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-32 text-on-surface" /></label>
            <Button size="sm" onClick={save}>Save</Button>
            {msg && <span className={`text-xs ${msg === 'Saved.' ? 'text-status-approved' : 'text-status-rejected'}`}>{msg}</span>}
          </div>
        )}
        {connected && table && <p className="text-xs text-outline mb-2">Reading: <code>{table}</code></p>}
        <ol className="list-decimal ml-5 space-y-1 text-xs text-text-main">
          <li>Cloud Shell: create the dataset in the <b>US</b> multi-region (this also brings in last month's costs):<br /><code className="text-[11px]">bq --location=US mk --dataset ulink-claimflow:billing_export</code></li>
          <li>Google Cloud Console → <b>Billing</b> → <b>Billing export</b> → <b>BigQuery export</b> → <b>Standard usage cost</b> → <b>Edit settings</b> → project <code>ulink-claimflow</code>, dataset <code>billing_export</code> → Save.</li>
          <li>Let the app read it (Cloud Shell):<br /><code className="text-[11px]">gcloud projects add-iam-policy-binding ulink-claimflow --member=serviceAccount:529783101639-compute@developer.gserviceaccount.com --role=roles/bigquery.jobUser --condition=None</code><br />
            <code className="text-[11px]">gcloud projects add-iam-policy-binding ulink-claimflow --member=serviceAccount:529783101639-compute@developer.gserviceaccount.com --role=roles/bigquery.dataViewer --condition=None</code></li>
          <li>Wait a few hours for Google to create the table, then press <b>Refresh</b>. The table is found automatically.</li>
        </ol>
      </div>
    </details>
  )
}
