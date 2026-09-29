import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getMyUsage, getUsageSummary, getUsageRecent, getOpenRouterLive, listUsers, type UsageSummary } from '../lib/api'
import { getRole } from '../lib/auth'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'

const usd = (n: number | null | undefined, dp = 2) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(dp)}`)
const num = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}K` : String(n))
const PROVIDER_NAME: Record<string, string> = { vertex: 'Vertex AI', openrouter: 'OpenRouter' }
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

/** The signed-in user's own allowance — shown to every role. */
function MyAllowance() {
  const { data, error } = useQuery({ queryKey: ['usage', 'me'], queryFn: getMyUsage, refetchInterval: 30_000 })
  if (error) return <Card className="p-4 text-sm text-status-rejected">{String((error as Error).message)}</Card>
  if (!data) return <Card className="p-4 text-sm text-outline">Loading your usage…</Card>
  const capped = data.cap_usd !== null
  const pct = capped && data.cap_usd! > 0 ? Math.min(100, (data.spent_usd / data.cap_usd!) * 100) : 0
  const tone = pct >= 100 ? 'bg-status-rejected' : pct >= 80 ? 'bg-status-pending' : 'bg-primary'
  return (
    <Card className="p-5 mb-5">
      <div className="flex items-center gap-2 mb-3"><Icon name="account_balance_wallet" className="text-primary" /><span className="font-semibold text-primary">My AI allowance</span></div>
      <div className="grid grid-cols-4 gap-4">
        <div><div className="text-xs text-outline">Spent</div><div className="text-xl font-bold font-display">{usd(data.spent_usd, 4)}</div></div>
        <div><div className="text-xs text-outline">Limit</div><div className="text-xl font-bold font-display">{capped ? usd(data.cap_usd) : 'No limit'}</div></div>
        <div><div className="text-xs text-outline">Remaining balance</div><div className="text-xl font-bold font-display">{capped ? usd(data.remaining_usd, 4) : '—'}</div></div>
        <div><div className="text-xs text-outline">AI requests · tokens</div><div className="text-xl font-bold font-display">{data.requests} · {num(data.tokens)}</div></div>
      </div>
      {capped && (
        <div className="mt-4" role="meter" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label="Share of AI limit used">
          <div className="h-2 rounded-full bg-surface-container overflow-hidden"><div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} /></div>
          <div className="text-xs text-text-main mt-1.5">
            {pct >= 100 ? 'Limit reached — AI features are paused for your account. Ask your administrator to raise it.' : `${pct.toFixed(0)}% of your limit used.`}
          </div>
        </div>
      )}
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

function AdminDashboard() {
  const [days, setDays] = useState(30)
  const summary = useQuery({ queryKey: ['usage', 'summary', days], queryFn: () => getUsageSummary(days) })
  const recent = useQuery({ queryKey: ['usage', 'recent'], queryFn: () => getUsageRecent(50) })
  const orl = useQuery({ queryKey: ['usage', 'openrouter'], queryFn: getOpenRouterLive })
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const s = summary.data
  const refresh = () => { summary.refetch(); recent.refetch(); orl.refetch() }
  const capOf = (username: string) => (users.data ?? []).find((u) => u.username === username)
  const maxModelCost = Math.max(0.0001, ...(s?.by_model ?? []).map((m) => m.cost_usd))

  return (
    <>
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display text-lg font-bold text-primary">All users · AI usage & costs</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-surface-container rounded-lg p-1">
            {RANGES.map(([d, label]) => (
              <button key={d} onClick={() => setDays(d)} className={`px-3 py-1 rounded-md text-xs font-medium ${days === d ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>{label}</button>
            ))}
          </div>
          <Button variant="outline" size="sm" onClick={refresh}><Icon name="refresh" className="text-[16px]" />Refresh</Button>
        </div>
      </div>
      {summary.error && <p className="text-sm text-status-rejected mb-3">{String((summary.error as Error).message)}</p>}

      <div className="grid grid-cols-5 gap-3 mb-4">
        <Tile label="Estimated cost" value={usd(s?.total_cost_usd, 4)} sub="App-tracked estimate" />
        <Tile label="AI requests" value={s ? String(s.requests) : '—'} sub={s ? `${s.requests - s.failed} succeeded` : undefined} />
        <Tile label="Tokens" value={s ? num(s.total_tokens) : '—'} sub="Input + output" />
        <Tile label="Failed calls" value={s ? String(s.failed) : '—'} sub="Retried on the next provider" />
        <Tile label="Success rate" value={s ? `${s.success_rate}%` : '—'} />
      </div>

      <Card className="p-4 mb-4">
        <div className="flex items-center gap-2 mb-2"><Icon name="account_balance" className="text-primary" /><span className="font-semibold text-primary text-sm">OpenRouter account (live from OpenRouter)</span></div>
        {!orl.data ? <p className="text-xs text-outline">Loading…</p> : (
          <div className="grid grid-cols-4 gap-4 text-sm">
            <div><div className="text-xs text-outline">Account balance</div><div className="font-bold">{orl.data.credits?.balance_usd != null ? usd(orl.data.credits.balance_usd, 4) : '—'}</div>
              <div className="text-[11px] text-outline">{!orl.data.management_key_configured ? 'Needs OPENROUTER_MANAGEMENT_KEY' : orl.data.credits?.error ?? ''}</div></div>
            <div><div className="text-xs text-outline">Total account usage</div><div className="font-bold">{usd(orl.data.credits?.total_usage_usd, 4)}</div></div>
            <div><div className="text-xs text-outline">This app's key: used</div><div className="font-bold">{usd(orl.data.key?.usage_usd, 4)}</div>
              <div className="text-[11px] text-outline">{!orl.data.api_key_configured ? 'Needs OPENROUTER_API_KEY' : orl.data.key?.error ?? ''}</div></div>
            <div><div className="text-xs text-outline">This app's key: limit</div><div className="font-bold">{orl.data.key ? (orl.data.key.limit_usd == null ? 'No limit' : usd(orl.data.key.limit_usd)) : '—'}</div></div>
          </div>
        )}
        <p className="text-[11px] text-outline mt-2">Vertex AI spend is billed by Google Cloud — check exact figures in the GCP Billing console. The app's own estimates above cover both providers.</p>
      </Card>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <DailyCost days={s?.by_day ?? []} />
        <Card className="p-4">
          <div className="font-semibold text-primary text-sm">Usage by provider & model</div>
          <div className="text-xs text-outline mb-3">Estimated cost, requests and tokens</div>
          <table className="w-full text-xs">
            <thead className="text-outline text-left"><tr><th className="py-1">Provider</th><th>Model</th><th>Req.</th><th>Tokens</th><th className="w-28">Cost</th></tr></thead>
            <tbody>
              {(s?.by_model ?? []).map((m) => (
                <tr key={m.provider + m.model} className="border-t border-outline-variant" title={`${usd(m.cost_usd, 4)} · ${m.requests} requests`}>
                  <td className="py-1.5 font-medium">{PROVIDER_NAME[m.provider] ?? m.provider}</td>
                  <td className="font-mono">{m.model}</td><td>{m.requests}</td><td>{num(m.tokens)}</td>
                  <td><div className="flex items-center gap-1.5"><div className="h-2 rounded bg-primary/80" style={{ width: `${Math.max(2, (m.cost_usd / maxModelCost) * 60)}px` }} />{usd(m.cost_usd, 4)}</div></td>
                </tr>
              ))}
              {s && s.by_model.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-outline">No AI calls yet.</td></tr>}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Card className="p-4">
          <div className="font-semibold text-primary text-sm mb-3">Usage by user</div>
          <table className="w-full text-xs">
            <thead className="text-outline text-left"><tr><th className="py-1">User</th><th>Requests</th><th>Spent (period)</th><th>Limit</th></tr></thead>
            <tbody>
              {(s?.by_user ?? []).map((u) => {
                const acct = capOf(u.user)
                return (
                  <tr key={u.user} className="border-t border-outline-variant">
                    <td className="py-1.5 font-medium">{acct?.name ?? u.user}</td><td>{u.requests}</td><td>{usd(u.cost_usd, 4)}</td>
                    <td>{acct?.usage_cap_usd != null ? <Badge className={Number(acct.usage_spent_usd) >= acct.usage_cap_usd ? 'bg-status-rejected/10 text-status-rejected' : 'bg-surface-container'}>{usd(acct.usage_spent_usd, 2)} / {usd(acct.usage_cap_usd)}</Badge> : <span className="text-outline">No limit</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="text-[11px] text-outline mt-2">Set or change limits in Users &amp; Teams.</p>
        </Card>
        <Card className="p-4">
          <div className="font-semibold text-primary text-sm mb-3">Latest AI calls</div>
          <div className="max-h-72 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="text-outline text-left sticky top-0 bg-white"><tr><th className="py-1">When</th><th>User</th><th>Provider · model</th><th>Tokens</th><th className="text-right">Cost</th></tr></thead>
              <tbody>
                {(recent.data ?? []).map((e) => (
                  <tr key={e.id} className="border-t border-outline-variant">
                    <td className="py-1.5 whitespace-nowrap">{new Date(e.ts * 1000).toLocaleString()}</td>
                    <td>{e.user || '—'}</td>
                    <td>{PROVIDER_NAME[e.provider] ?? e.provider} · <span className="font-mono">{e.model}</span>{!e.ok && <Badge className="ml-1 bg-status-rejected/10 text-status-rejected">failed</Badge>}</td>
                    <td>{num(e.tokens_in + e.tokens_out)}</td><td className="text-right">{usd(e.cost_usd, 4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
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
