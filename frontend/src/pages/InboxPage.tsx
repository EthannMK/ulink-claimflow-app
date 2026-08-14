import { useQuery } from '@tanstack/react-query'
import { listClaims } from '../lib/api'
const catColor: Record<string, string> = {
  new_claim: 'bg-status-ai/10 text-status-ai', log_request: 'bg-brand-accent/10 text-brand-accent',
  complaint: 'bg-status-rejected/10 text-status-rejected', query: 'bg-status-pending/10 text-status-pending',
}
export function InboxPage() {
  const { data, isLoading } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-primary mb-4">Omnichannel Inbox</h1>
      <div className="bg-white rounded-xl border border-outline-variant overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container text-on-surface-variant text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Reference</th>
              <th className="px-4 py-3 font-semibold">Channel</th>
              <th className="px-4 py-3 font-semibold">Member</th>
              <th className="px-4 py-3 font-semibold">Insurer</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Suggested</th>
              <th className="px-4 py-3 font-semibold">Docs</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-4 py-6 text-outline" colSpan={7}>Loading…</td></tr>}
            {data?.items.map((c) => (
              <tr key={c.id} className="border-t border-outline-variant hover:bg-surface-container/50">
                <td className="px-4 py-3 font-medium">{c.reference}</td>
                <td className="px-4 py-3 capitalize">{c.channel}</td>
                <td className="px-4 py-3">{c.memberName}</td>
                <td className="px-4 py-3">{c.insurer}</td>
                <td className="px-4 py-3">
                  <span className={`px-2 py-1 rounded-full text-xs ${catColor[c.category] ?? 'bg-surface-container'}`}>
                    {c.category.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-4 py-3 text-text-main">{c.suggestedAssignee ?? '—'}</td>
                <td className="px-4 py-3">{c.documentsComplete ? '✓' : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-outline mt-3">Sample screen wired to the mock API. Codex will build the rest from docs/screens.</p>
    </div>
  )
}
