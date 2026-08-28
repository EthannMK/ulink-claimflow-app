import { useMemo, useState } from 'react'
import { PageTitle, Card, Badge, Icon } from '../components/ui'
import { mockAudit } from '../mocks/admin'

export function AuditPage() {
  const [q, setQ] = useState('')
  const [who, setWho] = useState('all')
  const rows = useMemo(() => mockAudit.filter((r) => {
    const okWho = who === 'all' || (who === 'ai' ? r.user === 'AI' : r.user !== 'AI')
    const hay = `${r.user} ${r.action} ${r.item}`.toLowerCase()
    return okWho && (q.trim() === '' || hay.includes(q.toLowerCase()))
  }), [q, who])

  return (
    <div>
      <PageTitle title="Audit Log" sub="Every action — AI and human — for traceability." />
      <div className="flex gap-2 mb-4">
        <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm">
          <Icon name="search" className="text-[18px] text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search action, item…" className="outline-none w-56" />
        </div>
        <select value={who} onChange={(e) => setWho(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          <option value="all">All actors</option><option value="ai">AI only</option><option value="human">People only</option>
        </select>
        <span className="ml-auto self-center text-xs text-outline">{rows.length} event(s)</span>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
            <tr>{['Time', 'User', 'Action', 'Item'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-outline-variant">
                <td className="px-4 py-3 text-text-main whitespace-nowrap">{r.time}</td>
                <td className="px-4 py-3">{r.user === 'AI' ? <Badge className="bg-status-ai/10 text-status-ai">AI</Badge> : r.user}</td>
                <td className="px-4 py-3">{r.action}</td>
                <td className="px-4 py-3 text-primary font-medium">{r.item}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-outline">No matching events.</td></tr>}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
