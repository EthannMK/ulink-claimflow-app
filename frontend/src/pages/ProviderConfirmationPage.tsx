import { useQuery } from '@tanstack/react-query'
import { listConfirmations } from '../lib/api'
import { PageTitle, Card, Badge } from '../components/ui'

const statusCls: Record<string, string> = {
  Done: 'bg-status-approved/10 text-status-approved', Pending: 'bg-status-pending/10 text-status-pending',
  Fraud: 'bg-status-rejected/10 text-status-rejected', Closed: 'bg-on-surface-variant/10 text-on-surface-variant',
}
export function ProviderConfirmationPage() {
  const { data } = useQuery({ queryKey: ['conf'], queryFn: listConfirmations })
  return (
    <div>
      <PageTitle title="Provider / Clinic Confirmation" sub="Auto-filled from iAS/Freshdesk — replaces the manual Google Sheet." />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container text-on-surface-variant text-left">
            <tr>{['Input date','Assignee','Reason','Ticket','Member','Provider','Provider phone','Insurer','CSR','Status'].map(h =>
              <th key={h} className="px-3 py-3 font-semibold whitespace-nowrap">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(data ?? []).map(r => (
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
          </tbody>
        </table>
      </Card>
    </div>
  )
}
