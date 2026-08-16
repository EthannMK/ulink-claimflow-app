import { PageTitle, Card, Button } from '../components/ui'
import { mockSla } from '../mocks/admin'
export function SlaPage() {
  return (
    <div>
      <PageTitle title="SLA Policies" sub="Target response / handling times per request type, with warning and breach thresholds." action={<Button>Add policy</Button>} />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
            <tr>{['Request category', 'Target', 'Warn at', 'Breach at', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {mockSla.map((r) => (
              <tr key={r.category} className="border-t border-outline-variant">
                <td className="px-4 py-3 font-medium">{r.category}</td>
                <td className="px-4 py-3">{r.target}</td>
                <td className="px-4 py-3 text-status-pending">{r.warn}</td>
                <td className="px-4 py-3 text-status-rejected">{r.breach}</td>
                <td className="px-4 py-3 text-right"><button className="text-xs text-primary">Edit</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
