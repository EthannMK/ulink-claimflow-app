import { useState, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getMyUsage, getBilling, saveBilling, getUsageSummary, getUsageRecent, getUsageOptions, downloadUsageCsv, getProviderAccount, getUsageLimits, listUsers, type UsageSummary, type UsageFilters, type UserLimit } from '../lib/api'
import { getRole } from '../lib/auth'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'
import { LimitEditor } from '../components/LimitEditor'

const usd = (n: number | null | undefined, dp = 2) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(dp)}`)
const tok = (n: number | null | undefined) => (n === null || n === undefined ? '—' : Number(n).toLocaleString())
const num = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n))
const RANGES: [number, string][] = [[1, 'Today'], [7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days']]

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-outline">{label}</div>
      <div className="text-2xl font-bold font-display text-on-surface mt-1 leading-none">{value}</div>
      {sub && <div className="text-xs text-text-main mt-1.5">{sub}</div>}
    </Card>
  )
}

/** Allowance meter in client tokens. `usdLine` (Super Admin only) adds the real dollar amounts. */
function Meter({ label, spent, cap, hint, usdLine }: { label: string; spent: number; cap: number | null; hint: string; usdLine?: string }) {
  const pct = cap != null && cap > 0 ? Math.min(100, (spent / cap) * 100) : 0
  const tone = pct >= 100 ? 'bg-status-rejected' : pct >= 80 ? 'bg-status-pending' : 'bg-primary'
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs mb-1">
        <span className="font-semibold text-text-main">{label}</span>
        <span className="text-text-main">{tok(spent)} tokens {cap != null ? <>of <b>{tok(cap)}</b> · <span className="text-outline">{tok(Math.max(cap - spent, 0))} left</span></> : <span className="text-outline">· no limit</span>}</span>
      </div>
      {usdLine && <div className="text-[11px] text-outline text-right -mt-0.5 mb-1">{usdLine}</div>}
      {cap != null && (
        <div className="h-2 rounded-full bg-surface-container overflow-hidden" role="meter" aria-label={label} aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
          <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="text-[11px] text-outline mt-1">{cap != null && pct >= 100 ? <span className="text-status-rejected">Limit reached — AI features are paused. {hint}</span> : hint}</div>
    </div>
  )
}

/** The signed-in user's own allowance — shown to every role. */
function MyAllowance() {
  const { data, error } = useQuery({ queryKey: ['usage', 'me'], queryFn: getMyUsage, refetchInterval: 30_000 })
  if (error) return <Card className="p-4 text-sm text-status-rejected">{String((error as Error).message)}</Card>
  if (!data) return <Card className="p-4 text-sm text-outline">Loading your usage…</Card>
  return (
    <Card className="p-5 mb-5">
      <div className="flex items-center gap-2 mb-4"><Icon name="account_balance_wallet" className="text-primary" /><span className="font-semibold text-primary">My AI allowance</span>
        <span className="ml-auto text-xs text-outline">{data.requests} AI requests · {tok(data.used_tokens)} tokens used in total</span></div>
      <div className="grid grid-cols-2 gap-6">
        <Meter label="Today" spent={data.today_tokens} cap={data.daily_cap_tokens} hint="Resets at midnight (Myanmar time)."
          usdLine={data.today_usd != null ? `Super Admin view: ${usd(data.today_usd, 4)}${data.daily_cap_usd != null ? ` of ${usd(data.daily_cap_usd)}` : ''}` : undefined} />
        <Meter label="Total" spent={data.used_tokens} cap={data.cap_tokens} hint="Ask your administrator if you need more."
          usdLine={data.spent_usd != null ? `Super Admin view: ${usd(data.spent_usd, 4)}${data.cap_usd != null ? ` of ${usd(data.cap_usd)}` : ''} · real tokens ${num(data.real_tokens ?? 0)}` : undefined} />
      </div>
    </Card>
  )
}

const STATUS: Record<UserLimit['status'], [string, string]> = {
  total_reached: ['Total limit reached', 'bg-status-rejected/10 text-status-rejected'],
  daily_reached: ['Daily limit reached', 'bg-status-rejected/10 text-status-rejected'],
  near: ['Near a limit (80%+)', 'bg-status-pending/10 text-status-pending'],
  ok: ['OK', 'bg-status-approved/10 text-status-approved'],
}

/** Super Admin: the one rate that turns dollars into the tokens clients see. */
function TokenRate() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['usage', 'billing'], queryFn: getBilling })
  const [v, setV] = useState('')
  const [msg, setMsg] = useState('')
  const cur = data?.usd_per_1m_tokens
  async function save(rate: number) {
    setMsg('')
    try { await saveBilling(rate); setV(''); setMsg('Saved — every user now sees their allowance with this rate.'); qc.invalidateQueries({ queryKey: ['usage'] }) }
    catch (e: any) { setMsg(String(e?.message ?? e)) }
  }
  const actual = data?.actual.usd_per_1m_tokens
  return (
    <Card className="p-4 mb-4 text-sm">
      <div className="flex items-center gap-2 mb-1"><Icon name="currency_exchange" className="text-primary" /><span className="font-semibold text-primary">Client token rate</span></div>
      <div className="mb-2" />
      <div className="flex items-center gap-2 flex-wrap text-xs">
        <span>1,000,000 tokens =</span>
        <span className="font-semibold">${cur ?? '…'}</span>
        <span className="text-outline">→ change to $</span>
        <input value={v} onChange={(e) => setV(e.target.value)} placeholder={cur != null ? String(cur) : ''} inputMode="decimal" className="border border-outline-variant rounded-md px-2 py-1 w-24" />
        <Button size="sm" disabled={!v.trim() || isNaN(Number(v))} onClick={() => save(Number(v))}>Save rate</Button>
        {actual != null && (
          <span className="text-outline ml-2">Your real average so far: <b className="text-text-main">${actual}</b> per 1M tokens ({data?.actual.calls} calls)
            {actual !== cur && <button onClick={() => save(actual)} className="text-primary hover:underline ml-1">Use this</button>}</span>
        )}
      </div>
      {msg && <p className={`text-xs mt-1 ${msg.startsWith('Saved') ? 'text-status-approved' : 'text-status-rejected'}`}>{msg}</p>}
    </Card>
  )
}

/** Super Admin: every user's total & daily limits in one place, editable inline. */
function UserLimits() {
  const qc = useQueryClient()
  const { data, error } = useQuery({ queryKey: ['usage', 'limits'], queryFn: getUsageLimits, refetchInterval: 30_000 })
  const [edit, setEdit] = useState<string | null>(null)
  const cell = (spent: number, cap: number | null, tSpent: number | null, tCap: number | null) => cap == null
    ? <span className="text-text-main">{usd(spent, 2)} <span className="text-outline">· no limit</span><div className="text-[10px] text-outline">{num(tSpent ?? 0)} tokens</div></span>
    : <div className="w-40"><div className="flex justify-between"><span>{usd(spent, 2)} / {usd(cap)}</span></div>
        <div className="text-[10px] text-outline">{num(tSpent ?? 0)} / {num(tCap ?? 0)} tokens (what the user sees)</div>
        <div className="h-1.5 rounded-full bg-surface-container overflow-hidden mt-0.5"><div className={`h-full rounded-full ${spent >= cap ? 'bg-status-rejected' : spent / (cap || 1) >= 0.8 ? 'bg-status-pending' : 'bg-primary'}`} style={{ width: `${cap > 0 ? Math.min(100, (spent / cap) * 100) : 100}%` }} /></div></div>
  return (
    <Card className="p-4 mb-4">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold text-primary text-sm">User AI limits</div>
        <span className="text-[11px] text-outline">Every user · limits cover all AI providers and models combined · daily resets at midnight (Myanmar time)</span>
      </div>
      {error && <p className="text-xs text-status-rejected">{String((error as Error).message)}</p>}
      <table className="w-full text-xs mt-2">
        <thead className="text-outline text-left"><tr><th className="py-1">User</th><th>Role</th><th>Today / daily limit</th><th>Total / total limit</th><th>Status</th><th></th></tr></thead>
        <tbody>
          {(data ?? []).map((u) => (
            <Fragment key={u.id}>
              <tr className="border-t border-outline-variant">
                <td className="py-1.5 font-medium">{u.name}<div className="text-[10px] text-outline font-normal">{u.username}{u.active ? '' : ' · disabled'}</div></td>
                <td>{u.role.replace('_', ' ')}</td>
                <td>{cell(u.today_usd, u.daily_cap_usd, u.today_tokens, u.daily_cap_tokens)}</td>
                <td>{cell(u.spent_usd, u.cap_usd, u.used_tokens, u.cap_tokens)}</td>
                <td><Badge className={STATUS[u.status][1]}>{STATUS[u.status][0]}</Badge></td>
                <td className="text-right"><button onClick={() => setEdit(edit === u.id ? null : u.id)} className="text-primary hover:underline">Edit limits</button></td>
              </tr>
              {edit === u.id && (
                <tr className="bg-primary/[0.03]"><td colSpan={6} className="px-2 py-3">
                  <LimitEditor userId={u.id} name={u.name} total={u.cap_usd} daily={u.daily_cap_usd}
                    onDone={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['usage'] }); qc.invalidateQueries({ queryKey: ['users'] }) }} />
                </td></tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

/** Single-series daily cost bars with a hover tooltip, plus an optional table view. */
function DailyCost({ days }: { days: UsageSummary['by_day'] }) {
  const [hover, setHover] = useState<number | null>(null)
  const [asTable, setAsTable] = useState(false)
  const max = Math.max(0.0001, ...days.map((d) => d.cost_usd))
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div><div className="font-semibold text-primary text-sm">Estimated cost per day</div><div className="text-xs text-outline">USD, all providers</div></div>
        <button onClick={() => setAsTable(!asTable)} className="text-xs text-primary hover:underline">{asTable ? 'Show chart' : 'Show table'}</button>
      </div>
      {days.length === 0 ? <p className="text-sm text-outline py-8 text-center">No AI calls in this period yet.</p> : asTable ? (
        <table className="w-full text-xs"><thead className="text-outline text-left"><tr><th className="py-1">Day</th><th>Requests</th><th className="text-right">Cost</th></tr></thead>
          <tbody>{days.map((d) => <tr key={d.day} className="border-t border-outline-variant"><td className="py-1">{d.day}</td><td>{d.requests}</td><td className="text-right">{usd(d.cost_usd, 4)}</td></tr>)}</tbody></table>
      ) : (
        <div className="relative">
          <div className="text-[10px] text-outline mb-1">{usd(max, 4)}</div>
          <div className="h-36 flex items-end gap-[2px] border-b border-outline-variant">
            {days.map((d, i) => (
              <div key={d.day} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className={`w-full rounded-t ${hover === i ? 'bg-primary' : 'bg-primary/80'}`} style={{ height: `${Math.max(2, (d.cost_usd / max) * 100)}%` }} />
              </div>
            ))}
          </div>
          <div className="flex justify-between text-[10px] text-outline mt-1"><span>{days[0].day}</span>{days.length > 1 && <span>{days[days.length - 1].day}</span>}</div>
          {hover !== null && (
            <div className="absolute top-0 right-0 bg-white border border-outline-variant shadow-sm rounded-md px-2 py-1 text-xs text-text-main pointer-events-none">
              <b>{days[hover].day}</b> · {usd(days[hover].cost_usd, 4)} · {days[hover].requests} requests
            </div>
          )}
        </div>
      )}
    </Card>
  )
}

const EMPTY: UsageFilters = { days: 30, date_from: '', date_to: '', user: '', provider: '', model: '', feature: '', status: '' }
const fmtDT = (ts: number) => (ts ? new Date(ts * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')
const tokIO = (i: number, o: number) => `${num(i)} / ${num(o)}`
const dur = (s: number | null | undefined) => (s == null ? '—' : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${s.toFixed(1)}s`)

function Sel({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="text-[11px] text-outline flex flex-col gap-0.5">
      {label}
      <select value={value} onChange={(e) => onChange(e.target.value)}
        className={`text-xs border rounded-md px-2 py-1.5 bg-white max-w-[11rem] ${value ? 'border-primary text-primary font-medium' : 'border-outline-variant text-text-main'}`}>
        <option value="">All</option>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  )
}

/** Clickable value: sets that dimension as a filter (drill-down). */
function Drill({ onClick, children, title }: { onClick: () => void; children: React.ReactNode; title?: string }) {
  return <button onClick={onClick} title={title ?? 'Filter the whole dashboard to this'} className="text-left hover:underline hover:text-primary">{children}</button>
}

function AdminDashboard() {
  const [f, setF] = useState<UsageFilters>(EMPTY)
  const [custom, setCustom] = useState(false)
  const [csvBusy, setCsvBusy] = useState(false)
  const set = (patch: Partial<UsageFilters>) => setF((x) => ({ ...x, ...patch }))
  const summary = useQuery({ queryKey: ['usage', 'summary', f], queryFn: () => getUsageSummary(f) })
  const recent = useQuery({ queryKey: ['usage', 'recent', f], queryFn: () => getUsageRecent(f, 200) })
  const opts = useQuery({ queryKey: ['usage', 'options'], queryFn: getUsageOptions })
  const orl = useQuery({ queryKey: ['usage', 'provider-account'], queryFn: getProviderAccount })
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const s = summary.data
  const acctOf = (username: string) => (users.data ?? []).find((u) => u.username === username)
  const nameOf = (username: string) => acctOf(username)?.name ?? username
  const labelOf = (pid: string) => opts.data?.providers.find((p) => p.id === pid)?.label ?? pid
  const refresh = () => { summary.refetch(); recent.refetch(); opts.refetch(); orl.refetch() }
  const filtered = !!(f.user || f.provider || f.model || f.feature || f.status || f.date_from || f.date_to)
  const periodLabel = f.date_from || f.date_to ? `${f.date_from || '…'} → ${f.date_to || '…'}` : RANGES.find(([d]) => d === f.days)?.[1] ?? `Last ${f.days} days`
  const maxModelCost = Math.max(0.0001, ...(s?.by_model ?? []).map((m) => m.cost_usd))

  async function exportCsv() {
    setCsvBusy(true)
    try { await downloadUsageCsv(f) } catch (e: any) { alert(String(e?.message ?? e)) } finally { setCsvBusy(false) }
  }

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-bold text-primary">All users · AI usage &amp; costs</h2>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={csvBusy}><Icon name="download" className="text-[16px]" />{csvBusy ? 'Exporting…' : 'Export CSV'}</Button>
          <Button variant="outline" size="sm" onClick={refresh}><Icon name="refresh" className="text-[16px]" />Refresh</Button>
        </div>
      </div>

      <TokenRate />
      <UserLimits />

      {/* one filter bar drives EVERY panel below */}
      <Card className="p-3 mb-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-[11px] text-outline">Period</span>
            <div className="flex bg-surface-container rounded-lg p-1">
              {RANGES.map(([d, label]) => (
                <button key={d} onClick={() => { setCustom(false); set({ days: d, date_from: '', date_to: '' }) }}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium ${!custom && !f.date_from && !f.date_to && f.days === d ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>{label}</button>
              ))}
              <button onClick={() => setCustom(true)} className={`px-2.5 py-1 rounded-md text-xs font-medium ${custom ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>Custom</button>
            </div>
          </div>
          {custom && (<>
            <label className="text-[11px] text-outline flex flex-col gap-0.5">From<input type="date" value={f.date_from} onChange={(e) => set({ date_from: e.target.value })} className="text-xs border border-outline-variant rounded-md px-2 py-1" /></label>
            <label className="text-[11px] text-outline flex flex-col gap-0.5">To<input type="date" value={f.date_to} onChange={(e) => set({ date_to: e.target.value })} className="text-xs border border-outline-variant rounded-md px-2 py-1" /></label>
          </>)}
          <Sel label="User" value={f.user} onChange={(v) => set({ user: v })} options={(opts.data?.users ?? []).map((u) => [u, nameOf(u)])} />
          <Sel label="Feature" value={f.feature} onChange={(v) => set({ feature: v })} options={(opts.data?.features ?? []).map((x) => [x, x])} />
          <Sel label="Provider" value={f.provider} onChange={(v) => set({ provider: v })} options={(opts.data?.providers ?? []).map((p) => [p.id, p.label])} />
          <Sel label="Model" value={f.model} onChange={(v) => set({ model: v })} options={(opts.data?.models ?? []).map((m) => [m, m])} />
          <Sel label="Status" value={f.status} onChange={(v) => set({ status: v as UsageFilters['status'] })} options={[['ok', 'Succeeded'], ['failed', 'Failed']]} />
          {filtered && <button onClick={() => { setF(EMPTY); setCustom(false) }} className="text-xs text-status-rejected hover:underline pb-1.5">Clear filters</button>}
        </div>
        <p className="text-[11px] text-outline mt-2">Showing <b>{periodLabel}</b>{filtered ? ' with filters applied' : ''}. Dates use your computer's timezone. Click any user, feature or model below to filter by it.</p>
      </Card>
      {summary.error && <p className="text-sm text-status-rejected mb-3">{String((summary.error as Error).message)}</p>}

      <div className="grid grid-cols-7 gap-3 mb-4">
        <Tile label="Estimated cost" value={usd(s?.total_cost_usd, 4)} sub="App-tracked estimate" />
        <Tile label="AI requests" value={s ? String(s.requests) : '—'} sub={s ? `${s.requests - s.failed} succeeded` : undefined} />
        <Tile label="Tokens in / out" value={s ? tokIO(s.tokens_in, s.tokens_out) : '—'} sub={s ? `${num(s.total_tokens)} total` : undefined} />
        <Tile label="Failed calls" value={s ? String(s.failed) : '—'} sub="Retried on the next provider" />
        <Tile label="Success rate" value={s ? `${s.success_rate}%` : '—'} />
        <Tile label="Active users" value={s ? String(s.active_users) : '—'} sub="Used AI in this view" />
        <Tile label="Avg AI response" value={s ? dur(s.avg_seconds) : '—'} sub="Time per AI call" />
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><Icon name="account_balance" className="text-primary" /><span className="font-semibold text-primary text-sm">{orl.data?.label ?? 'Provider'} account (live balance — not affected by filters)</span></div>
        {!orl.data ? <p className="text-xs text-outline">Loading…</p> : (
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><div className="text-xs text-outline">Account balance</div><div className="font-bold">{orl.data.credits?.balance_usd != null ? usd(orl.data.credits.balance_usd, 4) : '—'}</div>
              <div className="text-[11px] text-outline">{!orl.data.management_key_configured ? orl.data.management_key_hint : orl.data.credits?.error ?? ''}</div></div>
            <div><div className="text-xs text-outline">Total account usage</div><div className="font-bold">{usd(orl.data.credits?.total_usage_usd, 4)}</div></div>
            <div><div className="text-xs text-outline">This app's key: used</div><div className="font-bold">{usd(orl.data.key?.usage_usd, 4)}</div>
              <div className="text-[11px] text-outline">{!orl.data.api_key_configured ? orl.data.api_key_hint : orl.data.key?.error ?? ''}</div></div>
            <div><div className="text-xs text-outline">This app's key: limit</div><div className="font-bold">{orl.data.key ? (orl.data.key.limit_usd == null ? 'No limit' : usd(orl.data.key.limit_usd)) : '—'}</div></div>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <DailyCost days={s?.by_day ?? []} />
        <Card className="p-4">
          <div className="font-semibold text-primary text-sm">Usage by feature</div>
          <div className="text-xs text-outline mb-3">Which part of the app used the AI</div>
          <table className="w-full text-xs">
            <thead className="text-outline text-left"><tr><th className="py-1">Feature</th><th>Requests</th><th>Failed</th><th>Tokens in / out</th><th>Avg / max time</th><th className="text-right">Cost</th></tr></thead>
            <tbody>
              {(s?.by_feature ?? []).map((r) => (
                <tr key={r.feature} className="border-t border-outline-variant">
                  <td className="py-1.5 font-medium"><Drill onClick={() => set({ feature: r.feature })}>{r.feature}</Drill></td>
                  <td>{r.requests}</td><td>{r.failed || ''}</td><td>{tokIO(r.tokens_in, r.tokens_out)}</td><td>{dur(r.avg_seconds)} / {dur(r.max_seconds)}</td><td className="text-right">{usd(r.cost_usd, 4)}</td>
                </tr>
              ))}
              {s && s.by_feature.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-outline">No AI calls in this view.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>

      <Card className="p-4 mb-4">
        <div className="font-semibold text-primary text-sm">Usage by provider &amp; model</div>
        <div className="text-xs text-outline mb-3">Estimated cost, requests, tokens and when each model was used</div>
        <table className="w-full text-xs">
          <thead className="text-outline text-left"><tr><th className="py-1">Provider</th><th>Model</th><th>Requests</th><th>Failed</th><th>Tokens in / out</th><th>Avg / max time</th><th>First used</th><th>Last used</th><th className="w-36">Cost</th></tr></thead>
          <tbody>
            {(s?.by_model ?? []).map((m) => (
              <tr key={m.provider + m.model} className="border-t border-outline-variant">
                <td className="py-1.5 font-medium"><Drill onClick={() => set({ provider: m.provider })}>{m.provider_label || m.provider}</Drill></td>
                <td className="font-mono"><Drill onClick={() => set({ model: m.model })}>{m.model}</Drill></td>
                <td>{m.requests}</td><td>{m.failed || ''}</td><td>{tokIO(m.tokens_in, m.tokens_out)}</td><td>{dur(m.avg_seconds)} / {dur(m.max_seconds)}</td>
                <td className="whitespace-nowrap">{fmtDT(m.first_ts)}</td><td className="whitespace-nowrap">{fmtDT(m.last_ts)}</td>
                <td><div className="flex items-center gap-1.5"><div className="h-2 rounded bg-primary/80" style={{ width: `${Math.max(2, (m.cost_usd / maxModelCost) * 60)}px` }} />{usd(m.cost_usd, 4)}</div></td>
              </tr>
            ))}
            {s && s.by_model.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-outline">No AI calls in this view.</td></tr>}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 mb-4">
        <div className="font-semibold text-primary text-sm">Usage by user</div>
        <div className="text-xs text-outline mb-3">Each user's total, then every provider &amp; model they used, with first and last use</div>
        <table className="w-full text-xs">
          <thead className="text-outline text-left"><tr><th className="py-1">User</th><th>Provider · model</th><th>Requests</th><th>Failed</th><th>Tokens in / out</th><th>First used</th><th>Last used</th><th>Cost (this view)</th><th>Today / total limit</th></tr></thead>
          <tbody>
            {(s?.by_user ?? []).map((u) => {
              const acct = acctOf(u.user)
              const rows = (s?.by_user_model ?? []).filter((r) => r.user === u.user)
              return (
                <Fragment key={u.user}>
                  <tr className="border-t-2 border-outline-variant bg-surface-container/40 font-semibold">
                    <td className="py-1.5"><Drill onClick={() => set({ user: u.user })}>{nameOf(u.user)}</Drill><div className="text-[10px] text-outline font-normal">{u.user}</div></td>
                    <td className="text-outline font-normal">{rows.length} model{rows.length === 1 ? '' : 's'}</td>
                    <td>{u.requests}</td><td>{u.failed || ''}</td><td>{tokIO(u.tokens_in, u.tokens_out)}</td>
                    <td className="whitespace-nowrap font-normal">{fmtDT(u.first_ts)}</td><td className="whitespace-nowrap font-normal">{fmtDT(u.last_ts)}</td>
                    <td>{usd(u.cost_usd, 4)}</td>
                    <td className="font-normal whitespace-nowrap">
                      <div>Today {acct?.daily_cap_usd != null ? `${usd(acct.usage_today_usd, 2)} / ${usd(acct.daily_cap_usd)}` : <span className="text-outline">no limit</span>}</div>
                      <div>Total {acct?.usage_cap_usd != null ? `${usd(acct.usage_spent_usd, 2)} / ${usd(acct.usage_cap_usd)}` : <span className="text-outline">no limit</span>}</div>
                    </td>
                  </tr>
                  {rows.map((r) => (
                    <tr key={u.user + r.provider + r.model} className="border-t border-outline-variant/60">
                      <td />
                      <td><Drill onClick={() => set({ provider: r.provider })}>{r.provider_label || r.provider}</Drill> · <span className="font-mono"><Drill onClick={() => set({ model: r.model })}>{r.model}</Drill></span></td>
                      <td>{r.requests}</td><td>{r.failed || ''}</td><td>{tokIO(r.tokens_in, r.tokens_out)}</td>
                      <td className="whitespace-nowrap">{fmtDT(r.first_ts)}</td><td className="whitespace-nowrap">{fmtDT(r.last_ts)}</td>
                      <td>{usd(r.cost_usd, 4)}</td><td />
                    </tr>
                  ))}
                </Fragment>
              )
            })}
            {s && s.by_user.length === 0 && <tr><td colSpan={9} className="py-6 text-center text-outline">No AI calls in this view.</td></tr>}
          </tbody>
        </table>
        <p className="text-[11px] text-outline mt-2">Set or change limits in Users &amp; Teams.</p>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <div><div className="font-semibold text-primary text-sm">Call log</div>
            <div className="text-xs text-outline">Every AI call in this view, newest first (latest 200 shown — Export CSV for all)</div></div>
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="text-outline text-left sticky top-0 bg-white"><tr><th className="py-1">Date &amp; time</th><th>User</th><th>Feature</th><th>Provider · model</th><th>Tokens in / out</th><th>Time</th><th>Status</th><th className="text-right">Cost</th></tr></thead>
            <tbody>
              {(recent.data ?? []).map((e) => (
                <tr key={e.id} className="border-t border-outline-variant">
                  <td className="py-1.5 whitespace-nowrap">{fmtDT(e.ts)}</td>
                  <td><Drill onClick={() => set({ user: e.user })}>{nameOf(e.user) || '—'}</Drill></td>
                  <td><Drill onClick={() => set({ feature: e.feature })}>{e.feature}</Drill></td>
                  <td>{e.provider_label || labelOf(e.provider)} · <span className="font-mono">{e.model}</span></td>
                  <td>{tokIO(e.tokens_in, e.tokens_out)}</td>
                  <td className={(e.seconds ?? 0) >= 60 ? 'text-status-pending font-semibold' : ''}>{dur(e.seconds ?? null)}</td>
                  <td>{e.ok ? <Badge className="bg-status-approved/10 text-status-approved">OK</Badge> : <Badge className="bg-status-rejected/10 text-status-rejected">Failed</Badge>}</td>
                  <td className="text-right">{usd(e.cost_usd, 4)}</td>
                </tr>
              ))}
              {recent.data && recent.data.length === 0 && <tr><td colSpan={8} className="py-6 text-center text-outline">No AI calls in this view.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-[11px] text-outline mt-3">Costs are estimates from the tokens each provider reports, using the price table in <code>backend/app/usage.py</code>.</p>
    </>
  )
}

export function AiUsagePage() {
  const isSuper = getRole() === 'super_admin'
  return (
    <div>
      <PageTitle title="AI Usage" sub={isSuper ? 'Your own allowance, plus usage and costs across all users.' : 'How much of your AI allowance you have used.'} />
      <MyAllowance />
      {isSuper && <AdminDashboard />}
    </div>
  )
}
