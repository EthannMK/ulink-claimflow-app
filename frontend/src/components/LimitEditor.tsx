import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { updateUser, getBilling } from '../lib/api'
import { Button } from './ui'

const toNum = (s: string) => (s.trim() === '' ? null : Number(s))

/** Edit a user's TOTAL and DAILY AI limits (USD). Blank = no limit. Both limits count
 *  spend on every AI provider and model combined. Super Admin only. */
export function LimitEditor({ userId, name, total, daily, onDone }: {
  userId: string; name: string; total: number | null | undefined; daily: number | null | undefined; onDone: () => void
}) {
  const [t, setT] = useState(total != null ? String(total) : '')
  const [d, setD] = useState(daily != null ? String(daily) : '')
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const { data: bill } = useQuery({ queryKey: ['usage', 'billing'], queryFn: getBilling })
  const asTok = (s: string) => { const n = toNum(s); return n == null || isNaN(n) || !bill ? '' : `≈ ${Math.round(n / bill.usd_per_1m_tokens * 1_000_000).toLocaleString()} tokens` }

  async function send(body: Record<string, unknown>) {
    setBusy(true); setMsg('')
    try {
      const r = await updateUser(userId, body)
      if (r.ok) onDone()
      else setMsg((await r.json().catch(() => ({}))).detail || 'Failed')
    } finally { setBusy(false) }
  }
  function save() {
    const tn = toNum(t), dn = toNum(d)
    if ((tn !== null && (isNaN(tn) || tn < 0)) || (dn !== null && (isNaN(dn) || dn < 0))) { setMsg('Enter dollar amounts like 5 or 0.50 — or leave blank for no limit'); return }
    if (tn !== null && dn !== null && dn > tn) { setMsg('The daily limit is higher than the total limit — the total will stop them first.') }
    send({
      ...(tn === null ? { clear_usage_cap: true } : { usage_cap_usd: tn }),
      ...(dn === null ? { clear_daily_cap: true } : { daily_cap_usd: dn }),
    })
  }

  return (
    <div>
      <div className="flex items-end gap-3 flex-wrap">
        <span className="text-xs text-text-main pb-1.5">AI limits for <b>{name}</b>:</span>
        <label className="text-[11px] text-outline flex flex-col gap-0.5">Total limit (USD)
          <input value={t} onChange={(e) => setT(e.target.value)} placeholder="no limit" inputMode="decimal" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-28" />
          <span className="h-3 text-[10px] text-primary">{asTok(t)}</span></label>
        <label className="text-[11px] text-outline flex flex-col gap-0.5">Daily limit (USD)
          <input value={d} onChange={(e) => setD(e.target.value)} placeholder="no limit" inputMode="decimal" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-28" />
          <span className="h-3 text-[10px] text-primary">{asTok(d)}</span></label>
        <Button size="sm" onClick={save} disabled={busy}>Save limits</Button>
        <Button size="sm" variant="outline" onClick={() => send({ reset_usage: true })} disabled={busy} title="Sets both 'spent in total' and 'spent today' back to $0">Reset spent to $0</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {msg && <p className="text-xs text-status-rejected mt-1">{msg}</p>}
      <p className="text-[11px] text-outline mt-1">Leave a box blank for no limit. Limits cover every AI provider and model together. When either limit is reached, this user's AI features (JD1 scan, full detection, assistant, extraction) pause — the daily one resets at midnight (Myanmar time).</p>
    </div>
  )
}
