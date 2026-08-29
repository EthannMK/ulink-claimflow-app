import { useState } from 'react'
import { Icon, Card, Button } from './ui'
import { extractDoc } from '../lib/api'

const LABELS: Record<string, string> = {
  name: 'Name', category: 'Category', condition: 'When', action: 'Then',
  limit: 'Limit', subLimit: 'Sub-limit', waiting: 'Waiting', copay: 'Co-pay',
}

export function AiExtract({ kind, onAdd }: { kind: 'rules' | 'benefits'; onAdd: (items: any[]) => void }) {
  const [busy, setBusy] = useState(false)
  const [items, setItems] = useState<any[] | null>(null)
  const [err, setErr] = useState('')

  async function pick(f: File) {
    setBusy(true); setErr(''); setItems(null)
    try { setItems(await extractDoc(kind, f)) }
    catch (e: any) { setErr(e?.message ?? 'Extraction failed') }
    finally { setBusy(false) }
  }
  function setField(i: number, key: string, val: string) {
    setItems((its) => its!.map((it, j) => j === i ? { ...it, [key]: val } : it))
  }

  return (
    <div className="mt-2">
      <label className="inline-flex items-center gap-1 text-xs text-status-ai cursor-pointer hover:underline">
        <Icon name="auto_awesome" className="text-[14px]" />{busy ? 'AI reading document…' : 'Extract with AI from a document'}
        <input type="file" accept=".pdf,image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.currentTarget.value = '' }} />
      </label>
      {err && <p className="text-xs text-status-rejected mt-1">{err}</p>}
      {items && (
        <Card className="p-3 mt-2 bg-surface-container/40">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold">AI extracted {items.length} item(s) — <span className="text-status-ai">review & fix</span> before adding</span>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => { onAdd(items); setItems(null) }} disabled={items.length === 0}>Add all</Button>
              <button onClick={() => setItems(null)} className="text-xs text-outline">Discard</button>
            </div>
          </div>
          {items.length === 0 && <p className="text-xs text-outline">The AI didn't find anything in that document. Try a clearer file or add entries manually.</p>}
          <div className="space-y-2 max-h-72 overflow-y-auto">
            {items.map((it, i) => (
              <div key={i} className="bg-white rounded-md border border-outline-variant/50 p-2 flex flex-wrap gap-2">
                {Object.keys(it).map((k) => (
                  <div key={k} className="flex flex-col">
                    <label className="text-[10px] text-outline uppercase">{LABELS[k] || k}</label>
                    <input value={String(it[k] ?? '')} onChange={(e) => setField(i, k, e.target.value)}
                      className="text-xs border border-outline-variant rounded px-1.5 py-1 min-w-[120px]" />
                  </div>
                ))}
                <button onClick={() => setItems((its) => its!.filter((_, j) => j !== i))} className="text-xs text-status-rejected self-end mb-1">remove</button>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-outline mt-2">Anything you fix here is saved when you click Add all. You can edit again in the list afterwards.</p>
        </Card>
      )}
    </div>
  )
}
