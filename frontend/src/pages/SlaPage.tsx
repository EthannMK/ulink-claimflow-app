import { useState } from 'react'
import { PageTitle, Card, Button, Icon } from '../components/ui'
import { usePersistent } from '../lib/persist'

interface Sla { category: string; target: string; warn: string; breach: string }

export function SlaPage() {
  const [rows, setRows] = usePersistent<Sla[]>('sla', [])
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState<Sla>({ category: '', target: '', warn: '', breach: '' })
  const [adding, setAdding] = useState(false)
  const inp = 'text-sm border border-outline-variant rounded-md px-2 py-1 w-full'

  function startEdit(i: number) { setEditing(i); setDraft({ ...rows[i] }); setAdding(false) }
  function saveEdit() { if (editing === null) return; setRows((rs) => rs.map((r, j) => j === editing ? draft : r)); setEditing(null) }
  function addRow() { if (!draft.category.trim()) return; setRows((rs) => [...rs, draft]); setDraft({ category: '', target: '', warn: '', breach: '' }); setAdding(false) }
  function remove(i: number) { setRows((rs) => rs.filter((_, j) => j !== i)); if (editing === i) setEditing(null) }

  return (
    <div>
      <PageTitle title="SLA Policies" sub="Target response / handling times per request type, with warning and breach thresholds."
        action={<Button onClick={() => { setAdding((v) => !v); setEditing(null); setDraft({ category: '', target: '', warn: '', breach: '' }) }}><Icon name="add" className="text-[16px]" />Add policy</Button>} />
      {rows.length === 0 && !adding ? (
        <Card className="p-10 text-center"><Icon name="timer" className="text-[32px] text-outline" /><p className="text-sm text-text-main mt-2">No SLA policies yet. Click <b>Add policy</b>.</p></Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
              <tr>{['Request category', 'Target', 'Warn at', 'Breach at', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {adding && (
                <tr className="border-t border-outline-variant bg-primary/[0.03]">
                  <td className="px-4 py-2"><input className={inp} placeholder="Category" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></td>
                  <td className="px-4 py-2"><input className={inp} placeholder="24 h" value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} /></td>
                  <td className="px-4 py-2"><input className={inp} placeholder="18 h" value={draft.warn} onChange={(e) => setDraft({ ...draft, warn: e.target.value })} /></td>
                  <td className="px-4 py-2"><input className={inp} placeholder="24 h" value={draft.breach} onChange={(e) => setDraft({ ...draft, breach: e.target.value })} /></td>
                  <td className="px-4 py-2 text-right"><Button size="sm" onClick={addRow}>Save</Button></td>
                </tr>
              )}
              {rows.map((r, i) => editing === i ? (
                <tr key={i} className="border-t border-outline-variant bg-primary/[0.03]">
                  <td className="px-4 py-2"><input className={inp} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} /></td>
                  <td className="px-4 py-2"><input className={inp} value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} /></td>
                  <td className="px-4 py-2"><input className={inp} value={draft.warn} onChange={(e) => setDraft({ ...draft, warn: e.target.value })} /></td>
                  <td className="px-4 py-2"><input className={inp} value={draft.breach} onChange={(e) => setDraft({ ...draft, breach: e.target.value })} /></td>
                  <td className="px-4 py-2 text-right"><Button size="sm" onClick={saveEdit}>Save</Button></td>
                </tr>
              ) : (
                <tr key={i} className="border-t border-outline-variant">
                  <td className="px-4 py-3 font-medium">{r.category}</td>
                  <td className="px-4 py-3">{r.target}</td>
                  <td className="px-4 py-3 text-status-pending">{r.warn}</td>
                  <td className="px-4 py-3 text-status-rejected">{r.breach}</td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <button onClick={() => startEdit(i)} className="text-xs text-primary mr-3">Edit</button>
                    <button onClick={() => remove(i)} className="text-xs text-status-rejected">Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
