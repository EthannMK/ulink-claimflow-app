import { useEffect, useMemo, useRef, useState } from 'react'
import { getModelCatalog, testModel, type CatalogModel, type ModelCatalog, type ModelTestResult } from '../lib/api'
import { Icon } from './ui'

const price = (m: CatalogModel) =>
  m.free ? 'free' : m.price_in_per_1m != null ? `$${m.price_in_per_1m}/$${m.price_out_per_1m ?? '?'} per 1M` : ''

/** Searchable dropdown of the models a provider offers RIGHT NOW (fetched live from the
 *  provider via the backend — nothing hard-coded), plus Refresh and Test. */
export function ModelPicker({ provider, value, standard, onChange }: {
  provider: string; value: string; standard: string; onChange: (id: string) => void
}) {
  const [cat, setCat] = useState<ModelCatalog | null>(null)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [visionOnly, setVisionOnly] = useState(true)
  const [test, setTest] = useState<ModelTestResult | null>(null)
  const [testing, setTesting] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  function load(force = false) {
    setLoading(true)
    getModelCatalog(provider, force)
      .then(setCat)
      .catch((e) => setCat({ provider, models: [], fetched_at: Date.now() / 1000, error: String(e?.message ?? e) }))
      .finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [provider])
  useEffect(() => { setTest(null) }, [value])
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close)
  }, [])

  const models = cat?.models ?? []
  const current = models.find((m) => m.id === value)
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase()
    return models.filter((m) => (!visionOnly || m.vision) && (!t || m.id.toLowerCase().includes(t) || m.name.toLowerCase().includes(t)))
  }, [models, q, visionOnly])

  async function runTest() {
    setTesting(true); setTest(null)
    try { setTest(await testModel(provider, value)) } catch (e: any) { setTest({ ok: false, detail: String(e?.message ?? e) }) }
    finally { setTesting(false) }
  }

  return (
    <div ref={box} className="relative w-80">
      <button type="button" onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-2 border border-outline-variant rounded-md px-2 py-1.5 text-left bg-white hover:border-primary">
        <span className="min-w-0">
          <span className="block font-mono text-xs truncate">{value || 'Choose a model…'}</span>
          {current && <span className="block text-[11px] text-outline truncate">{current.name}{price(current) ? ` · ${price(current)}` : ''}</span>}
          {!current && value && cat && !loading && <span className="block text-[11px] text-status-pending">Not in the provider's current list — use Test to check it still works</span>}
        </span>
        <Icon name={open ? 'expand_less' : 'expand_more'} className="text-[18px] text-outline shrink-0" />
      </button>

      <div className="flex items-center gap-3 mt-1 text-[11px]">
        <span className="text-outline">{loading ? 'Loading live list…' : cat ? `${models.length} models available now` : ''}</span>
        <button type="button" onClick={() => load(true)} className="text-primary hover:underline inline-flex items-center gap-0.5"><Icon name="refresh" className="text-[13px]" />Refresh</button>
        <button type="button" onClick={runTest} disabled={!value || testing} className="text-primary hover:underline disabled:opacity-40 inline-flex items-center gap-0.5"><Icon name="play_arrow" className="text-[13px]" />{testing ? 'Testing…' : 'Test'}</button>
        {standard && value !== standard && <button type="button" onClick={() => onChange(standard)} className="text-primary hover:underline">Use standard</button>}
      </div>
      {test && <p className={`text-[11px] mt-1 ${test.ok ? 'text-status-approved' : 'text-status-rejected'}`}>{test.ok ? '✓' : '✗'} {test.detail}{test.seconds != null ? ` (${test.seconds}s)` : ''}</p>}
      {cat?.error && <p className="text-[11px] text-status-rejected mt-1">{cat.error}</p>}

      {open && (
        <div className="absolute z-20 mt-1 w-[28rem] bg-white border border-outline-variant rounded-lg shadow-lg">
          <div className="p-2 border-b border-outline-variant flex items-center gap-2">
            <Icon name="search" className="text-[16px] text-outline" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models…" className="flex-1 text-sm outline-none" />
            <label className="text-[11px] text-text-main flex items-center gap-1 whitespace-nowrap" title="Scanned claims are images — the model must accept images">
              <input type="checkbox" checked={visionOnly} onChange={(e) => setVisionOnly(e.target.checked)} />Reads images only
            </label>
          </div>
          <ul className="max-h-72 overflow-y-auto py-1" role="listbox">
            {shown.map((m) => (
              <li key={m.id} role="option" aria-selected={m.id === value}>
                <button type="button" onClick={() => { onChange(m.id); setOpen(false); setQ('') }}
                  className={`w-full text-left px-3 py-1.5 hover:bg-surface-container ${m.id === value ? 'bg-primary/[0.06]' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs truncate flex-1">{m.id}</span>
                    {m.id === standard && <span className="text-[10px] px-1.5 rounded bg-primary/10 text-primary">standard</span>}
                    {m.stage && <span className="text-[10px] px-1.5 rounded bg-surface-container text-text-main">{m.stage}</span>}
                    {!m.vision && <span className="text-[10px] px-1.5 rounded bg-status-pending/10 text-status-pending">text only</span>}
                  </div>
                  <div className="text-[11px] text-outline truncate">{m.name}{price(m) ? ` · ${price(m)}` : ''}{m.context ? ` · ${Math.round(m.context / 1000)}K context` : ''}</div>
                </button>
              </li>
            ))}
            {!loading && shown.length === 0 && <li className="px-3 py-4 text-xs text-outline text-center">No models match.</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
