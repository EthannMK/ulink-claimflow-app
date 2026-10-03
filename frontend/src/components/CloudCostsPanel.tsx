import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getCloudCosts, getCostSettings, saveCostSettings, saveCostCurrency, type CloudCosts, type CostSettings } from '../lib/api'
import { Card, Badge, Button, Icon } from './ui'

// Every amount from the server is USD; CUR converts it to the currency the page shows.
let CUR = { code: 'USD', rate: 1 }
function minorUnits(code: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: code }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return 2 }
}
/** Format a USD amount in the page's currency. Small amounts keep more decimals. */
const usd = (n: number | null | undefined, dp = 2) => {
  if (n == null || !isFinite(n)) return '—'
  const v = n * CUR.rate
  const minor = minorUnits(CUR.code)
  const digits = Math.abs(v) < 1 ? Math.max(dp, minor) : Math.min(dp, minor)
  try {
    return new Intl.NumberFormat('en', { style: 'currency', currency: CUR.code, currencyDisplay: CUR.code === 'USD' ? 'symbol' : 'code',
      minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v)
  } catch { return `${CUR.code} ${v.toFixed(digits)}` }
}
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
  const [refreshErr, setRefreshErr] = useState('')
  const { data, error, isLoading, refetch } = useQuery({ queryKey: ['cloud-costs', month], queryFn: () => getCloudCosts(month), staleTime: 5 * 60_000 })
  useEffect(() => { setComp('') }, [month])

  async function refresh() {
    setRefreshing(true)
    setRefreshErr('')
    try { const d = await getCloudCosts(month, true); qc.setQueryData(['cloud-costs', month], d) }
    catch (e: any) { setRefreshErr('Refresh failed: ' + (e?.message ?? 'unknown')) }
    finally { setRefreshing(false) }
  }

  const d = data as CloudCosts | undefined
  CUR = d?.currency_info ? { code: d.currency_info.code, rate: d.currency_info.rate } : { code: 'USD', rate: 1 }
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

  const maxForecast = d ? Math.max(0.0001, ...d.components.map((c) => c.forecast ?? c.cost)) : 1

  async function pickCurrency(code: string, rate?: number | null) {
    setRefreshErr('')
    try { await saveCostCurrency(code, rate ?? null); await qc.invalidateQueries({ queryKey: ['cloud-costs'] }) }
    catch (e: any) { setRefreshErr(String(e?.message ?? e)) }
  }

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
        {d && <CurrencyPicker info={d.currency_info} onPick={pickCurrency} />}
        <Button variant="outline" size="sm" className="ml-auto" onClick={refresh} disabled={refreshing} title="Re-reads the Google Cloud bill, the backup AI billing and the app's records">
          <Icon name="refresh" className={`text-[16px] ${refreshing ? 'animate-spin' : ''}`} />{refreshing ? 'Refreshing…' : 'Refresh all sources'}</Button>
      </div>

      {d && <SourceStatus d={d} />}
      {d?.bill_native && d.currency_info && (
        <p className="text-[11px] text-outline">
          Google Cloud console for {monthLabel(d.month)}: <b className="text-text-main">{fmtNative(d.bill_native.cost, d.bill_native.currency)}</b> usage,
          {' '}{fmtNative(-d.bill_native.credits, d.bill_native.currency)} credits, you pay <b className="text-text-main">{fmtNative(d.bill_native.net, d.bill_native.currency)}</b>.
          {' '}{currencyNote(d)}
        </p>
      )}
      {refreshErr && <p className="text-xs text-status-rejected">{refreshErr}</p>}
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
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
            <Tile label={d.is_current ? 'Real cost this month' : 'Real cost in month'} value={usd(d.totals.cost)}
              sub={`you pay ${usd(d.totals.net)} after ${usd(-d.totals.credits)} credits`} />
            <Tile label="Forecast month end" value={d.forecast ? usd(d.forecast.gross) : '—'}
              sub={d.forecast ? `real cost · ${usd(d.forecast.gross_pace_per_day, 3)}/day · you pay ≈ ${usd(d.forecast.net)}` : 'only for the current month'} />
            <Tile label="Last month" value={usd(d.totals.last_month_gross)} sub={d.totals.last_month_net != null ? `you paid ${usd(d.totals.last_month_net)}` : undefined} />
            <Tile label="Monthly budget" value={d.budget ? usd(d.budget.amount, 0) : 'not set'}
              sub={d.budget ? `${d.budget.used_pct ?? 0}% used${d.budget.forecast_pct != null ? ` · forecast ${d.budget.forecast_pct}%` : ''}` : 'optional — set it below'}
              tone={d.budget?.forecast_pct != null ? (d.budget.forecast_pct >= 100 ? 'bad' : d.budget.forecast_pct >= 80 ? 'warn' : 'ok') : undefined} />
            <Tile label="Google free credits left" value={d.credits_info ? usd(d.credits_info.left) : '—'}
              sub={d.credits_info ? `${usd(d.credits_info.used)} of ${usd(d.credits_info.trial_total, 0)} used${d.credits_info.days_left_at_pace ? ` · ~${d.credits_info.days_left_at_pace} days at this pace` : ''}` : 'shown once the bill is connected'} />
            <Tile label="Backup AI balance" value={d.sources.backup_ai.credits_left != null ? usd(d.sources.backup_ai.credits_left) : '—'}
              sub={d.sources.backup_ai.usage_total != null ? `${usd(d.sources.backup_ai.usage_total)} used of ${usd(d.sources.backup_ai.credits_total)} topped up` : 'live from the provider'}
              tone={d.sources.backup_ai.credits_left != null && d.sources.backup_ai.credits_left < 2 ? 'warn' : undefined} />
          </div>

          <PricingCard d={d} />

          {/* chart */}
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <Icon name="bar_chart" className="text-primary text-[18px]" />
              <h3 className="font-semibold text-sm">{view === 'day' ? `Daily cost · ${monthLabel(d.month)}${comp ? ` · ${comp}` : ''}` : 'Monthly cost'}</h3>
              <span className="text-xs text-outline">net, after credits · {CUR.code}</span>
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
                <span className="ml-auto text-xs text-outline">real cost · click a row to see it by day</span></div>
              {d.components.length === 0 && <p className="text-xs text-outline">No costs recorded for this month yet.</p>}
              {d.is_current && d.components.length > 0 && (
                <div className="flex items-center gap-3 text-[11px] text-text-main mb-1">
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm bg-primary/80" />Spent so far</span>
                  <span className="flex items-center gap-1"><span className="w-3 h-2 rounded-sm" style={{ background: STRIPES, border: '1px dashed rgb(0 51 102 / 0.45)' }} />Forecast for the rest of the month</span>
                </div>
              )}
              <table className="w-full text-sm">
                <thead className="text-xs text-outline text-left"><tr><th className="py-1">Component</th><th className="text-right">Spent</th>{d.is_current && <th className="text-right">Forecast</th>}<th className="text-right">Credits</th><th className="text-right">You pay</th><th className="w-32 pl-3">{d.is_current ? 'Spent vs forecast' : 'Share'}</th></tr></thead>
                <tbody>
                  {d.components.map((c) => (
                    <tr key={c.component} onClick={() => { setComp(c.component); setView('day') }} className={`border-t border-outline-variant/40 cursor-pointer hover:bg-primary/[0.03] ${comp === c.component ? 'bg-primary/[0.05]' : ''}`}>
                      <td className="py-1.5 pr-2"><div className="font-medium text-on-surface">{c.component}</div>
                        <div className="text-[10px] text-outline">{c.source === 'Google Cloud bill' ? 'Google Cloud bill' : `billed separately · ${c.source}`}</div></td>
                      <td className="text-right tabular-nums">{usd(c.cost, 3)}</td>
                      {d.is_current && <td className="text-right tabular-nums text-text-main" title={c.pace_per_day != null ? `about ${usd(c.pace_per_day, 3)} a day lately` : undefined}>{c.forecast != null ? usd(c.forecast, 3) : '—'}</td>}
                      <td className="text-right tabular-nums text-status-approved">{c.credits ? usd(c.credits, 3) : ''}</td>
                      <td className="text-right tabular-nums font-semibold">{usd(c.net, 3)}</td>
                      <td className="pl-3">{d.is_current && c.forecast != null ? <SpentVsForecast spent={c.cost} forecast={c.forecast} max={maxForecast} /> : (<>
                        <div className="h-1.5 rounded-full bg-surface-container overflow-hidden"><div className="h-full bg-primary/80 rounded-full" style={{ width: `${Math.round(c.share * 100)}%` }} /></div>
                        <div className="text-[10px] text-outline">{Math.round(c.share * 100)}%</div></>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {d.credits_info && d.credits_info.by_type.length > 0 && (
                <div className="mt-3 pt-3 border-t border-outline-variant/60">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-outline mb-1">Credits applied this month</div>
                  {d.credits_info.by_type.map((c, i) => (
                    <div key={i} className="flex justify-between text-xs py-0.5"><span className="text-text-main">{c.name || c.type} <span className="text-outline">· {c.type}</span></span><span className="tabular-nums text-status-approved">{usd(c.amount, 3)}</span></div>
                  ))}
                </div>
              )}
            </Card>

            {/* AI */}
            <Card className="p-5 lg:col-span-2">
              <div className="flex items-center gap-2 mb-2"><Icon name="smart_toy" className="text-primary text-[18px]" /><h3 className="font-semibold text-sm">AI spend · {monthLabel(d.month)}</h3></div>
              <div className="text-sm space-y-1 mb-3">
                {d.ai.google_bill.map((x) => <div key={x.component} className="flex justify-between"><span className="text-text-main">{x.component} <span className="text-[10px] text-outline">(Google bill)</span></span><b className="tabular-nums">{usd(x.net, 3)}</b></div>)}
                <div className="flex justify-between"><span className="text-text-main">Backup AI service <span className="text-[10px] text-outline">({d.sources.backup_ai.ok ? 'provider billing' : 'estimate'})</span></span><b className="tabular-nums">{usd(d.ai.backup, 3)}</b></div>
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
          <p className="text-[11px] text-outline">Google publishes billing data several times a day; costs usually appear within 24 hours, so today's numbers are still filling in. The backup AI service is read from its own billing (last 30 complete days); newer days use the app's per-call records until it reports them. Forecast = spent so far + the average of the last 7 days × days left. “Real cost” is before free credits — price on it, because credits run out.</p>
        </>
      )}

      <SetupCard onSaved={() => { qc.invalidateQueries({ queryKey: ['cloud-costs'] }); refetch() }} connected={!!d?.google_ok} table={d?.table} cur={CUR} />
    </div>
  )
}

function SetupCard({ onSaved, connected, table, cur }: { onSaved: () => void; connected: boolean; table?: string; cur: { code: string; rate: number } }) {
  const { data } = useQuery({ queryKey: ['cost-settings'], queryFn: getCostSettings })
  const [f, setF] = useState<CostSettings | null>(null)
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  useEffect(() => { if (data) setF(data) }, [data])
  useEffect(() => { if (!connected) setOpen(true) }, [connected])
  async function save() {
    if (!f) return
    setMsg('')
    const b = num(budgetText)
    if (b != null && !(b >= 0)) { setMsg('Enter the budget as a number'); return }
    try { setF(await saveCostSettings({ ...f, budget_usd: b == null ? null : +(b / cur.rate).toFixed(4) })); setMsg('Saved.'); onSaved() } catch (e: any) { setMsg(String(e?.message ?? e)) }
  }
  const num = (s: string) => (s.trim() === '' ? null : Number(s))
  // the budget is stored in USD; it is typed and shown in the page's currency
  const [budgetText, setBudgetText] = useState('')
  useEffect(() => { if (data) setBudgetText(data.budget_usd == null ? '' : String(+(data.budget_usd * cur.rate).toFixed(2))) }, [data, cur.rate])
  return (
    <details open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)} className="bg-white rounded-xl border border-outline-variant shadow-sm">
      <summary className="px-5 py-3 text-sm font-semibold cursor-pointer flex items-center gap-2">
        <Icon name="settings" className="text-[18px] text-primary" />Connect the Google Cloud bill · budget
        {connected ? <Badge className="bg-status-approved/10 text-status-approved">Connected</Badge> : <Badge className="bg-status-pending/10 text-status-pending">Not connected</Badge>}
      </summary>
      <div className="px-5 pb-5 text-sm">
        {f && (
          <div className="flex items-end gap-3 flex-wrap mb-3">
            <label className="text-xs text-outline flex flex-col gap-0.5">Billing dataset (project.dataset)
              <input value={f.dataset} onChange={(e) => setF({ ...f, dataset: e.target.value })} className="text-sm border border-outline-variant rounded-md px-2 py-1 w-72 text-on-surface" /></label>
            <label className="text-xs text-outline flex flex-col gap-0.5">Monthly budget ({cur.code})
              <input value={budgetText} onChange={(e) => setBudgetText(e.target.value)} inputMode="decimal" placeholder="none" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-32 text-on-surface" /></label>
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

function Chip({ ok, label, detail }: { ok: boolean; label: string; detail: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1 border ${ok ? 'border-status-approved/30 bg-status-approved/5' : 'border-status-pending/40 bg-status-pending/5'}`} title={detail}>
      <Icon name={ok ? 'check_circle' : 'schedule'} className={`text-[14px] ${ok ? 'text-status-approved' : 'text-status-pending'}`} />
      <b className="font-semibold text-on-surface">{label}</b><span className="text-text-main truncate max-w-[22rem]">{detail}</span>
    </span>
  )
}

/** Where each number comes from, and how fresh it is. */
function SourceStatus({ d }: { d: CloudCosts }) {
  const g = d.sources.google, o = d.sources.backup_ai
  return (
    <div className="flex flex-wrap gap-2">
      <Chip ok={g.ok} label="Google Cloud bill" detail={g.ok ? `data as of ${g.updated ? new Date(g.updated).toLocaleString() : '—'}` : 'not connected yet'} />
      <Chip ok={o.ok} label="Backup AI billing" detail={o.ok ? `live · checked ${o.checked ? new Date(o.checked).toLocaleTimeString() : ''} · ${o.covered_days} days reported` : (o.error || 'using the app estimate')} />
      <Chip ok label="App records" detail={`live · ${new Date(d.fetched_at).toLocaleTimeString()}`} />
    </div>
  )
}

/** What the platform really costs per user / per scan — the numbers to price from. */
function PricingCard({ d }: { d: CloudCosts }) {
  const p = d.pricing
  const under = p.break_even_per_1m_tokens != null && p.token_rate != null && p.token_rate < p.break_even_per_1m_tokens
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Icon name="sell" className="text-primary text-[18px]" /><h3 className="font-semibold text-sm">What it costs you · for pricing</h3>
        <span className="text-xs text-outline">{monthLabel(d.month)} · real cost before credits</span>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <div><div className="text-[11px] uppercase tracking-wide text-outline">All-in cost</div><div className="text-xl font-bold tabular-nums">{usd(p.all_in_cost)}</div><div className="text-[11px] text-text-main">infrastructure + all AI</div></div>
        <div><div className="text-[11px] uppercase tracking-wide text-outline">Per JD1 note</div><div className="text-xl font-bold tabular-nums">{usd(p.per_jd1_note, 3)}</div><div className="text-[11px] text-text-main">{p.jd1_notes} notes this month</div></div>
        <div><div className="text-[11px] uppercase tracking-wide text-outline">Break-even per 1M client tokens</div><div className={`text-xl font-bold tabular-nums ${under ? 'text-status-rejected' : ''}`}>{usd(p.break_even_per_1m_tokens, 3)}</div>
          <div className="text-[11px] text-text-main">your token rate: {usd(p.token_rate, 4)}{under ? ' — below cost' : ''}</div></div>
        <div><div className="text-[11px] uppercase tracking-wide text-outline">AI records → real bill</div><div className="text-xl font-bold tabular-nums">×{p.ai_scale}</div><div className="text-[11px] text-text-main">how far the app's estimate is from the bill</div></div>
      </div>
      {p.users.length === 0 ? <p className="text-xs text-outline">No AI use recorded this month.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-outline text-left"><tr><th className="py-1">User</th><th className="text-right">AI calls</th><th className="text-right">JD1 notes</th><th className="text-right">AI cost</th><th className="text-right">Infra share</th><th className="text-right">Total</th><th className="text-right">Per note</th><th className="text-right">Client tokens</th></tr></thead>
            <tbody>
              {p.users.map((u) => (
                <tr key={u.user} className="border-t border-outline-variant/40">
                  <td className="py-1.5"><div className="font-medium">{u.name}</div><div className="text-[10px] text-outline">{u.user}</div></td>
                  <td className="text-right tabular-nums">{u.calls}</td><td className="text-right tabular-nums">{u.jd1_notes}</td>
                  <td className="text-right tabular-nums">{usd(u.ai, 3)}</td><td className="text-right tabular-nums text-text-main">{usd(u.infra, 3)}</td>
                  <td className="text-right tabular-nums font-semibold">{usd(u.total, 3)}</td><td className="text-right tabular-nums">{usd(u.per_note, 3)}</td>
                  <td className="text-right tabular-nums text-text-main">{u.client_tokens != null ? u.client_tokens.toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-outline mt-2">{p.basis} Charge more than the break-even to cover support and margin.</p>
    </Card>
  )
}

function fmtNative(v: number, code: string) {
  try { return new Intl.NumberFormat('en', { style: 'currency', currency: code, currencyDisplay: 'code' }).format(v) } catch { return `${code} ${v.toFixed(2)}` }
}

function currencyNote(d: CloudCosts) {
  const c = d.currency_info
  if (c.code === c.bill) return 'This page shows the same currency.'
  if (c.code === 'USD') return `This page shows USD, converted at Google's rate (1 USD = ${c.bill_rate ?? '?'} ${c.bill}).`
  return `This page shows ${c.code}.`
}

/** Spent so far (solid) + the rest of the month's forecast (striped), on a shared scale. */
function SpentVsForecast({ spent, forecast, max }: { spent: number; forecast: number; max: number }) {
  const s = Math.max(spent, 0) / max * 100
  const f = Math.max(forecast - spent, 0) / max * 100
  return (
    <div>
      <div className="h-2 rounded-full bg-surface-container overflow-hidden flex">
        <div className="h-full bg-primary/80" style={{ width: `${s}%` }} />
        <div className="h-full" style={{ width: `${f}%`, background: STRIPES }} />
      </div>
      <div className="text-[10px] text-outline">{forecast > 0 ? `${Math.round(Math.max(spent, 0) / forecast * 100)}% of forecast` : '—'}</div>
    </div>
  )
}

/** Which currency the page shows. The bill's own currency uses Google's rate; others use a free
 *  daily rate unless the Super Admin fixes one (useful for MMK, where the market rate differs). */
function CurrencyPicker({ info, onPick }: { info: CloudCosts['currency_info']; onPick: (code: string, rate?: number | null) => void }) {
  const [rate, setRate] = useState(info.manual_rate != null ? String(info.manual_rate) : '')
  useEffect(() => { setRate(info.manual_rate != null ? String(info.manual_rate) : '') }, [info.code, info.manual_rate])
  const fixed = info.code !== 'USD' && info.code !== info.bill
  const src = info.source === 'google' ? "Google's rate" : info.source === 'live' ? 'daily market feed' : info.source === 'manual' ? 'your fixed rate' : info.source === 'unavailable' ? 'no rate found — set one' : ''
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <select value={info.auto ? '' : info.code} onChange={(e) => onPick(e.target.value)} title="Currency for every amount on this page"
        className="bg-white border border-outline-variant rounded-lg px-2 py-2 text-sm">
        <option value="">{info.bill ? `${info.bill} (bill currency)` : 'Bill currency'}</option>
        {info.options.filter((c) => c !== info.bill).map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      {info.code !== 'USD' && (
        <span className="text-[11px] text-outline whitespace-nowrap" title={info.live_date ? `Rates updated ${info.live_date}` : undefined}>
          1 USD = {+info.rate.toFixed(4)} {info.code}{src ? ` · ${src}` : ''}
        </span>
      )}
      {fixed && (
        <span className="flex items-center gap-1">
          <input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" placeholder="own rate"
            className="w-24 text-xs border border-outline-variant rounded-md px-2 py-1" title={`Fix your own rate: ${info.code} per 1 USD`} />
          <Button size="sm" variant="outline" onClick={() => onPick(info.code, rate.trim() ? Number(rate) : null)}>{rate.trim() ? 'Use rate' : 'Use daily rate'}</Button>
        </span>
      )}
    </div>
  )
}
