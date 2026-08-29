import { useMemo, useState } from 'react'
import { PageTitle, Card, Badge, Icon, Button } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'
import type { ConfirmationRecord } from '../mocks/confirmations'

const statusCls: Record<string, string> = {
  Done: 'bg-status-approved/10 text-status-approved', Pending: 'bg-status-pending/10 text-status-pending',
  Fraud: 'bg-status-rejected/10 text-status-rejected', Closed: 'bg-on-surface-variant/10 text-on-surface-variant',
}
const FIELDS: [keyof ConfirmationRecord, string][] = [
  ['inputDate', 'Input date'], ['assignee', 'Assignee'], ['reason', 'Reason'], ['ticket', 'Ticket'],
  ['claim', 'Claim'], ['member', 'Member'], ['provider', 'Provider'], ['providerPhone', 'Provider phone'],
  ['insurer', 'Insurer'], ['csr', 'CSR'],
]
const empty = (): ConfirmationRecord => ({ id: genId(), inputDate: new Date().toISOString().slice(0, 10), assignee: '', reason: '', ticket: '', claim: '', member: '', provider: '', providerPhone: '', insurer: '', csr: '', status: 'Pending' })

export function ProviderConfirmationPage() {
  const [rows, setRows] = usePersistent<ConfirmationRecord[]>('confirmations', [])
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const [form, setForm] = useState<ConfirmationRecord | null>(null)

  const filtered = useMemo(() => rows.filter((r) => {
    const okS = status === 'all' || r.status === status
    const hay = `${r.member} ${r.provider} ${r.insurer} ${r.ticket} ${r.assignee} ${r.claim}`.toLowerCase()
    return okS && (q.trim() === '' || hay.includes(q.toLowerCase()))
  }), [rows, q, status])

  function save() {
    if (!form) return
    setRows((rs) => rs.some((r) => r.id === form.id) ? rs.map((r) => r.id === form.id ? form : r) : [form, ...rs])
    setForm(null)
  }
  const inp = 'w-full text-sm border border-outline-variant rounded-md px-2 py-1.5'

  return (
    <div>
      <PageTitle title="Provider / Clinic Confirmation" sub="The CSR confirmation register (replaces the manual Google Sheet). Add records, import them, or feed them from claims."
        action={<Button onClick={() => setForm(empty())}><Icon name="add" className="text-[16px]" />Add record</Button>} />

      {form && (
        <Card className="p-4 mb-4">
          <div className="grid grid-cols-3 gap-3">
            {FIELDS.map(([k, label]) => (
              <div key={k}><label className="block text-xs text-text-main mb-1">{label}</label>
                <input className={inp} value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></div>
            ))}
            <div><label className="block text-xs text-text-main mb-1">Status</label>
              <select className={inp} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
                <option>Pending</option><option>Done</option><option>Fraud</option><option>Closed</option></select></div>
          </div>
          <div className="flex gap-2 mt-3"><Button size="sm" onClick={save}>Save record</Button><Button size="sm" variant="ghost" onClick={() => setForm(null)}>Cancel</Button></div>
        </Card>
      )}

      <div className="flex gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm">
          <Icon name="search" className="text-[18px] text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search member, provider, ticket…" className="outline-none w-56" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          <option value="all">All statuses</option><option>Done</option><option>Pending</option><option>Fraud</option><option>Closed</option>
        </select>
        <span className="ml-auto self-center text-xs text-outline">{filtered.length} of {rows.length} record(s)</span>
      </div>

      {rows.length === 0 ? (
        <Card className="p-10 text-center"><Icon name="fact_check" className="text-[32px] text-outline" />
          <p className="text-sm text-text-main mt-2">No confirmation records yet. Click <b>Add record</b>, or import a CSV/Excel from <b>Reports</b>.</p></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
              <tr>{[...FIELDS.map((f) => f[1]), 'Status', ''].map(h => <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.id} className="border-t border-outline-variant hover:bg-surface-container/50">
                  {FIELDS.map(([k]) => <td key={k} className="px-3 py-3 whitespace-nowrap">{(r as any)[k] || '—'}</td>)}
                  <td className="px-3 py-3"><Badge className={statusCls[r.status]}>{r.status}</Badge></td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button onClick={() => setForm(r)} className="text-xs text-primary mr-3">Edit</button>
                    <button onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))} className="text-xs text-status-rejected">Delete</button>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan={FIELDS.length + 2} className="px-3 py-6 text-center text-outline">No matching records.</td></tr>}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
