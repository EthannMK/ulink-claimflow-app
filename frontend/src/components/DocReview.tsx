import { useEffect, useMemo, useState } from 'react'
import { Card, Badge, Icon } from './ui'
import { confidenceCls } from '../lib/format'
import { reviewDoc, type ReviewResult, type ReviewField } from '../lib/review'

async function renderPdfPages(file: File): Promise<string[]> {
  const pdfjs: any = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const n = Math.min(pdf.numPages, 30); const imgs: string[] = []
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i); const vp = page.getViewport({ scale: 2 })
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
    imgs.push(c.toDataURL('image/png'))
  }
  return imgs
}
const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

// best-match a configured field label to a Document-AI form key (the printed question)
function bestMatch(label: string, raw: ReviewField[]): ReviewField | null {
  const nl = norm(label); const lw = new Set(nl.split(' ').filter(Boolean))
  let best: ReviewField | null = null; let score = 0
  for (const r of raw) {
    const nr = norm(r.name); if (!nr) continue
    let s = 0
    if (nr === nl) s = 100
    else if (nr.includes(nl) || nl.includes(nr)) s = 60
    else { const rw = nr.split(' '); const shared = rw.filter((w) => lw.has(w)).length; s = shared ? (shared * 20) / Math.max(lw.size, rw.length) * 3 : 0 }
    if (s > score) { score = s; best = r }
  }
  return score >= 30 ? best : null
}

export function DocReview({ file, mapFields }: { file: File; mapFields?: { id: string; label: string }[] }) {
  const [imgs, setImgs] = useState<string[]>([])
  const [res, setRes] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [mapped, setMapped] = useState(true)

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(''); setRes(null); setImgs([]); setPage(0); setEdits({}); setHover(null)
    ;(async () => {
      try {
        const previews = isPdf(file) ? await renderPdfPages(file) : [URL.createObjectURL(file)]
        if (!alive) return; setImgs(previews)
        const r = await reviewDoc(file); if (!alive) return
        if (r.error) setErr(r.error)
        setRes(r)
      } catch (e: any) { if (alive) setErr(e?.message ?? 'Review failed') }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [file])

  const pageCount = Math.max(imgs.length, res?.pages ?? 1)
  const useMapped = mapped && !!mapFields?.length

  // display fields: either the mapped-to-insurer fields, or the raw detected ones
  const display: ReviewField[] = useMemo(() => {
    const raw = res?.fields || []
    if (!useMapped) return raw
    return (mapFields || []).map((mf) => {
      const m = bestMatch(mf.label, raw)
      return { id: mf.id, name: mf.label, value: m?.value || '', confidence: m?.value ? m.confidence : 0, page: m?.page ?? 0, box: m?.box || { x: 0, y: 0, w: 0, h: 0 } }
    })
  }, [res, mapFields, useMapped])

  const pageBoxes = display.filter((f) => f.page === page && f.box.w > 0)

  function focusField(f: ReviewField) { setHover(f.id); if (f.box.w > 0 && f.page !== page) setPage(f.page) }

  return (
    <div>
      {mapFields?.length ? (
        <div className="flex items-center gap-1 mb-3 bg-surface-container rounded-lg p-1 w-fit text-xs">
          <button onClick={() => setMapped(true)} className={`px-2.5 py-1 rounded-md ${mapped ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>Insurer fields</button>
          <button onClick={() => setMapped(false)} className={`px-2.5 py-1 rounded-md ${!mapped ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>All detected</button>
        </div>
      ) : null}

      <div className="grid grid-cols-2 gap-4">
        {/* left: document with highlights */}
        <div>
          {pageCount > 1 && (
            <div className="flex items-center gap-2 mb-2 text-xs">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40"><Icon name="chevron_left" className="text-[18px]" /></button>
              <span>Page {page + 1} / {pageCount}</span>
              <button disabled={page >= pageCount - 1} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40"><Icon name="chevron_right" className="text-[18px]" /></button>
            </div>
          )}
          <div className="relative border border-outline-variant rounded-lg overflow-hidden bg-surface-container">
            {imgs[page] ? <img src={imgs[page]} className="w-full block" alt="document" /> : <div className="h-64 grid place-items-center text-xs text-outline">Rendering…</div>}
            {pageBoxes.map((f) => {
              const on = hover === f.id
              return (
                <div key={f.id} onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)} title={`${f.name}: ${f.value}`}
                  style={{
                    position: 'absolute', left: `${f.box.x * 100}%`, top: `${f.box.y * 100}%`, width: `${f.box.w * 100}%`, height: `${f.box.h * 100}%`,
                    backgroundColor: on ? 'rgba(253,224,71,0.55)' : 'rgba(253,224,71,0.22)',
                    border: on ? '2px solid rgba(202,138,4,0.95)' : '1px solid rgba(234,179,8,0.6)',
                    borderRadius: 2, cursor: 'pointer', transition: 'background-color .1s',
                  }} />
              )
            })}
          </div>
        </div>

        {/* right: fields */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <h4 className="font-semibold text-sm">{useMapped ? 'Insurer fields' : 'Detected fields'}</h4>
            {res && !err && <Badge className="bg-status-approved/10 text-status-approved">{display.length} field(s)</Badge>}
          </div>
          {loading && <p className="text-xs text-text-main">Reading the document with Document AI…</p>}
          {err && <Card className="p-3 text-xs text-status-rejected">{err}</Card>}
          <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
            {display.map((f) => {
              const val = edits[f.id] ?? f.value
              const has = val.trim() !== ''
              return (
                <div key={f.id} onMouseEnter={() => focusField(f)} onMouseLeave={() => setHover(null)}
                  className="p-2 rounded-md border"
                  style={{ borderColor: hover === f.id ? 'rgba(202,138,4,0.9)' : 'rgba(0,0,0,0.08)', backgroundColor: hover === f.id ? 'rgba(254,249,195,0.6)' : 'transparent' }}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-text-main truncate">{f.name}{f.box.w > 0 && f.page !== page && <span className="text-outline"> · p{f.page + 1}</span>}</span>
                    {has ? <Badge className={confidenceCls(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
                      : <Badge className="bg-on-surface-variant/10 text-on-surface-variant">—</Badge>}
                  </div>
                  <input value={val} onChange={(e) => setEdits({ ...edits, [f.id]: e.target.value })}
                    className="w-full text-sm border border-outline-variant rounded-md px-2 py-1 mt-1" placeholder={useMapped ? 'not found — enter manually' : ''} />
                </div>
              )
            })}
            {!loading && !err && display.length === 0 && <p className="text-xs text-outline">No fields.</p>}
          </div>
          <p className="text-[11px] text-outline mt-2">Hover a field to highlight where it was read from. Fields follow this insurer's setup; switch to “All detected” to see everything the parser found.</p>
        </div>
      </div>
    </div>
  )
}
