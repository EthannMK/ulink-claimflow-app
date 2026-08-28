import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { listConfirmations } from '../lib/api'
import { PageTitle, Card, Badge, Icon } from '../components/ui'

const statusCls: Record<string, string> = {
  Done: 'bg-status-approved/10 text-status-approved', Pending: 'bg-status-pending/10 text-status-pending',
  Fraud: 'bg-status-rejected/10 text-status-rejected', Closed: 'bg-on-surface-variant/10 text-on-surface-variant',
}
export function ProviderConfirmationPage() {
  const { data } = useQuery({ queryKey: ['conf'], queryFn: listConfirmations })
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('all')
  const rows = useMemo(() => (data ?? []).filter((r) => {
    const okS = status === 'all' || r.status === status
    const hay = `${r.member} ${r.provider} ${r.insurer} ${r.ticket} ${r.assignee}`.toLowerCase()
    return okS && (q.trim() === '' || hay.includes(q.toLowerCase()))
  }), [data, q, status])

  return (
    <div>
      <PageTitle title="Provider / Clinic Confirmation" sub="Auto-filled from iAS/Freshdesk — replaces the manual Google Sheet." />
      <div className="flex gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm">
          <Icon name="search" className="text-[18px] text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search member, provider, ticket…" className="outline-none w-56" />
        </div>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          <option value="all">All statuses</option><option>Done</option><option>Pending</option><option>Fraud</option><option>Closed</option>
        </select>
        <span className="ml-auto self-center text-xs text-outline">{rows.length} record(s)</span>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
            <tr>{['Input date','Assignee','Reason','Ticket','Member','Provider','Provider phone','Insurer','CSR','Status'].map(h =>
              <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-outline-variant hover:bg-surface-container/50">
                <td className="px-3 py-3">{r.inputDate}</td>
                <td className="px-3 py-3">{r.assignee}</td>
                <td className="px-3 py-3">{r.reason}</td>
                <td className="px-3 py-3 text-primary font-medium">{r.ticket}</td>
                <td className="px-3 py-3">{r.member}</td>
                <td className="px-3 py-3">{r.provider}</td>
                <td className="px-3 py-3">{r.providerPhone}</td>
                <td className="px-3 py-3">{r.insurer}</td>
                <td className="px-3 py-3">{r.csr}</td>
                <td className="px-3 py-3"><Badge className={statusCls[r.status]}>{r.status}</Badge></td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={10} className="px-3 py-6 text-center text-outline">No matching records.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
