import { PageTitle, Card, Badge } from '../components/ui'
import { mockAudit } from '../mocks/admin'
export function AuditPage() {
  return (
    <div>
      <PageTitle title="Audit Log" sub="Every action — AI and human — for traceability." />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container text-on-surface-variant text-left">
            <tr>{['Time', 'User', 'Action', 'Item'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {mockAudit.map((r, i) => (
              <tr key={i} className="border-t border-outline-variant">
                <td className="px-4 py-3 text-text-main whitespace-nowrap">{r.time}</td>
                <td className="px-4 py-3">{r.user === 'AI' ? <Badge className="bg-status-ai/10 text-status-ai">AI</Badge> : r.user}</td>
                <td className="px-4 py-3">{r.action}</td>
                <td className="px-4 py-3 text-primary font-medium">{r.item}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
