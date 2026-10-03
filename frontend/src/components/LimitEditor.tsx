import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getBilling, getUsageLimits, saveAllowance, type AllowanceChange } from '../lib/api'
import { Button, Icon } from './ui'

const toNum = (s: string) => (s.trim() === '' ? null : Number(s.replace(/,/g, '')))
const fmtTok = (n: number | null | undefined) => (n == null ? '—' : Math.round(n).toLocaleString())
const fmtDate = (ts: number | null | undefined) => (ts ? new Date(ts * 1000).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '—')

/** A user's AI allowance, managed the way AI platforms do it: limits apply to the current
 *  period; a period renews automatically each month (optional) or when you reset it. Resetting
 *  starts again from 0 — the usage history is kept. Super Admin only. */
export function LimitEditor({ userId, name, onDone }: {
  userId: string; name: string; total?: number | null; daily?: number | null; onDone: () => void
}) {
  const { data: bill } = useQuery({ queryKey: ['usage', 'billing'], queryFn: getBilling })
  const { data: rows } = useQuery({ queryKey: ['usage', 'limits'], queryFn: getUsageLimits })
  const row = rows?.find((r) => r.id === userId)
  const rate = bill?.usd_per_1m_tokens ?? 0
  const [unit, setUnit] = useState<'tokens' | 'usd'>('tokens')
  const [t, setT] = useState<string | null>(null)
  const [d, setD] = useState<string | null>(null)
  const [period, setPeriod] = useState<'none' | 'monthly' | null>(null)
  const [resetTotal, setResetTotal] = useState(false)
  const [resetToday, setResetToday] = useState(false)
  const [reason, setReason] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [showHist, setShowHist] = useState(false)

  // what the boxes show before the admin types: the current limits in the chosen unit
  const show = (usd: number | null | undefined) => (usd == null ? '' : unit === 'usd' ? String(+usd.toFixed(4)) : rate ? String(Math.round(usd / rate * 1_000_000)) : '')
  const tVal = t ?? show(row?.cap_usd), dVal = d ?? show(row?.daily_cap_usd)
  const toUsd = (s: string) => { const n = toNum(s); return n == null ? null : unit === 'usd' ? n : rate ? +(n * rate / 1_000_000).toFixed(6) : NaN }
  const hint = (s: string) => {
    const n = toNum(s); if (n == null || isNaN(n) || !rate) return 'no limit'
    return unit === 'usd' ? `≈ ${fmtTok(n / rate * 1_000_000)} tokens` : `≈ $${(n * rate / 1_000_000).toFixed(4)}`
  }
  const per = period ?? row?.period ?? 'none'
  const anyReset = resetTotal || resetToday
  const summary = useMemo(() => {
    const out: string[] = []
    if (resetTotal) out.push(`used this period goes from ${fmtTok(row?.used_tokens)} to 0 tokens`)
    if (resetToday) out.push(`today's usage goes from ${fmtTok(row?.today_tokens)} to 0 tokens`)
    return out
  }, [resetTotal, resetToday, row])

  function switchUnit(u: 'tokens' | 'usd') {
    if (u === unit) return
    const conv = (s: string | null) => {
      if (s == null) return null
      const n = toNum(s); if (n == null || isNaN(n) || !rate) return s
      return u === 'usd' ? String(+(n * rate / 1_000_000).toFixed(4)) : String(Math.round(n / rate * 1_000_000))
    }
    setT(conv(t)); setD(conv(d)); setUnit(u)
  }

  async function save() {
    setMsg('')
    const tu = toUsd(tVal), du = toUsd(dVal)
    if ((tu !== null && (isNaN(tu) || tu < 0)) || (du !== null && (isNaN(du) || du < 0))) {
      setMsg(unit === 'usd' ? 'Enter amounts like 5 or 0.50, or leave the box empty for no limit.' : 'Enter whole token numbers like 5000000, or leave the box empty for no limit.'); return
    }
    if (anyReset && !confirm) { setConfirm(true); return }
    const body: AllowanceChange = {
      ...(t === null ? { keep_total: true } : tu === null ? { clear_total: true } : { total_usd: tu }),
      ...(d === null ? { keep_daily: true } : du === null ? { clear_daily: true } : { daily_usd: du }),
      ...(period ? { period } : {}),
      reset_total: resetTotal, reset_today: resetToday, reason: reason.trim(),
    }
    setBusy(true)
    try { await saveAllowance(userId, body); onDone() }
    catch (e: any) { setMsg(String(e?.message ?? e)); setConfirm(false) }
    finally { setBusy(false) }
  }

  if (!row) return <p className="text-xs text-outline">Loading {name}'s allowance…</p>
  const dailyOverTotal = (() => { const a = toUsd(tVal), b = toUsd(dVal); return a != null && b != null && !isNaN(a) && !isNaN(b) && b > a })()

  return (
    <div className="grid gap-3">
      {/* where they stand now */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-text-main">
        <span className="font-semibold text-on-surface">AI allowance · {name}</span>
        <span>This period: <b className="tabular-nums">{fmtTok(row.used_tokens)}</b>{row.cap_tokens != null ? <> of <b className="tabular-nums">{fmtTok(row.cap_tokens)}</b></> : ' · no limit'} tokens</span>
        <span>Today: <b className="tabular-nums">{fmtTok(row.today_tokens)}</b>{row.daily_cap_tokens != null ? <> of {fmtTok(row.daily_cap_tokens)}</> : ''}</span>
        <span className="text-outline">{row.period === 'monthly' ? `Renews on ${row.renews_on ? new Date(row.renews_on + 'T00:00:00').toLocaleDateString([], { day: 'numeric', month: 'short' }) : 'the 1st'}` : 'Does not renew automatically'}
          {row.period_start ? ` · counting since ${fmtDate(row.period_start)}` : ''}</span>
      </div>

      {/* limits + renewal */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-center gap-1 bg-surface-container rounded-md p-0.5 text-[11px]" role="group" aria-label="Unit">
          {(['tokens', 'usd'] as const).map((u) => (
            <button key={u} type="button" onClick={() => switchUnit(u)} className={`px-2 py-1 rounded ${unit === u ? 'bg-white shadow-sm text-primary font-semibold' : 'text-text-main'}`}>{u === 'tokens' ? 'Tokens' : 'USD'}</button>
          ))}
        </div>
        <label className="text-[11px] text-outline flex flex-col gap-0.5" htmlFor={`al-t-${userId}`}>Limit per period
          <input id={`al-t-${userId}`} value={tVal} onChange={(e) => setT(e.target.value)} placeholder="no limit" inputMode="decimal" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-36 tabular-nums text-on-surface" />
          <span className="h-3 text-[10px] text-primary">{hint(tVal)}</span></label>
        <label className="text-[11px] text-outline flex flex-col gap-0.5" htmlFor={`al-d-${userId}`}>Daily limit
          <input id={`al-d-${userId}`} value={dVal} onChange={(e) => setD(e.target.value)} placeholder="no limit" inputMode="decimal" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-36 tabular-nums text-on-surface" />
          <span className="h-3 text-[10px] text-primary">{hint(dVal)}</span></label>
        <label className="text-[11px] text-outline flex flex-col gap-0.5" htmlFor={`al-p-${userId}`}>Renews
          <select id={`al-p-${userId}`} value={per} onChange={(e) => setPeriod(e.target.value as 'none' | 'monthly')} className="text-sm border border-outline-variant rounded-md px-2 py-1 bg-white text-on-surface">
            <option value="none">Never (one-time allowance)</option>
            <option value="monthly">Every month, on the 1st</option>
          </select>
          <span className="h-3" /></label>
      </div>
      {dailyOverTotal && <p className="text-[11px] text-status-pending">The daily limit is higher than the period limit, so the period limit will stop them first.</p>}

      {/* reset */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={resetTotal} onChange={(e) => { setResetTotal(e.target.checked); setConfirm(false) }} />Reset usage to 0 (start a new period)</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked={resetToday} onChange={(e) => { setResetToday(e.target.checked); setConfirm(false) }} />Reset today's usage to 0</label>
        {anyReset && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (optional), e.g. new contract month" aria-label="Reason for the reset" className="text-xs border border-outline-variant rounded-md px-2 py-1 w-64" />}
      </div>

      {confirm && (
        <div className="rounded-md border border-status-pending/50 bg-status-pending/5 px-3 py-2 text-xs text-text-main">
          <b>Confirm reset for {name}:</b> {summary.join('; ')}. The new limits apply right away. Their usage history stays in AI Usage and Cloud costs.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={save} disabled={busy}>{busy ? 'Saving…' : confirm ? 'Confirm reset & save' : anyReset ? 'Reset & save' : 'Save allowance'}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
        {msg && <span className="text-xs text-status-rejected">{msg}</span>}
        {row.history.length > 0 && (
          <button type="button" onClick={() => setShowHist((v) => !v)} className="ml-auto text-xs text-primary hover:underline inline-flex items-center gap-1">
            <Icon name="history" className="text-[14px]" />{showHist ? 'Hide' : 'Show'} previous periods ({row.history.length})</button>
        )}
      </div>
      {showHist && (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-outline text-left"><tr><th className="py-1">Period</th><th className="text-right">Used</th><th className="text-right">Limit</th><th className="pl-3">Ended by</th></tr></thead>
            <tbody>{row.history.map((h, i) => (
              <tr key={i} className="border-t border-outline-variant/50">
                <td className="py-1">{fmtDate(h.start)} – {fmtDate(h.end)}</td>
                <td className="text-right tabular-nums">{fmtTok(h.used_tokens)}</td>
                <td className="text-right tabular-nums">{h.cap_tokens != null ? fmtTok(h.cap_tokens) : 'no limit'}</td>
                <td className="pl-3 text-text-main">{h.reason}{h.by && h.by !== 'system' ? ` · ${h.by}` : ''}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-outline">Users see tokens only. Limits cover every AI feature together; when one is reached, their AI features pause until the next day (daily) or the next period. Leave a box empty for no limit.</p>
    </div>
  )
}
