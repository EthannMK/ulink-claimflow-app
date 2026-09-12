import { useEffect, useState } from 'react'
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

export function DocReview({ file, mapFields }: { file: File; mapFields?: { id: string; label: string; hint?: string; section?: string }[] }) {
  const [imgs, setImgs] = useState<string[]>([])
  const [res, setRes] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [mapped, setMapped] = useState(true)
  const hasMap = !!mapFields?.length

  useEffect(() => {
    let alive = true
    setLoading(true); setErr(''); setRes(null); setImgs([]); setPage(0); setEdits({}); setHover(null)
    ;(async () => {
      try {
        const previews = isPdf(file) ? await renderPdfPages(file) : [URL.createObjectURL(file)]
        if (!alive) return; setImgs(previews)
        const fieldsArg = hasMap ? JSON.stringify(mapFields!.map((f) => ({ label: f.label, hint: f.hint || '', section: f.section || '' }))) : ''
        const r = await reviewDoc(file, fieldsArg); if (!alive) return
        if (r.error) setErr(r.error)
        setRes(r)
      } catch (e: any) { if (alive) setErr(e?.message ?? 'Review failed') }
      finally { if (alive) setLoading(false) }
    })()
    return () => { alive = false }
  }, [file, mapFields])

  const pageCount = Math.max(imgs.length, res?.pages ?? 1)
  const useMapped = mapped && hasMap
  const display: ReviewField[] = (useMapped ? res?.fields : res?.all_fields) || res?.fields || []
  const pageBoxes = display.filter((f) => f.page === page && f.box.w > 0)
  function focusField(f: ReviewField) { setHover(f.id); if (f.box.w > 0 && f.page !== page) setPage(f.page) }

  return (
    <div>
      {hasMap && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1 w-fit text-xs">
            <button onClick={() => setMapped(true)} className={`px-2.5 py-1 rounded-md ${mapped ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>Insurer fields</button>
            <button onClick={() => setMapped(false)} className={`px-2.5 py-1 rounded-md ${!mapped ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>All detected</button>
          </div>
          {res?.provider === 'hybrid' && <Badge className="bg-status-ai/10 text-status-ai">Gemini values · Document AI highlights</Badge>}
        </div>
      )}

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
          {loading && (
            <div className="mb-2">
              <div className="h-1.5 bg-primary/15 rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full animate-pulse w-2/3" /></div>
              <p className="text-xs text-text-main mt-1 flex items-center gap-1"><Icon name="autorenew" className="text-[14px] animate-spin" />Reading with Gemini + Document AI… (about 10–30s)</p>
            </div>
          )}
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
          <p className="text-[11px] text-outline mt-2">Values read by Gemini (better on handwriting & Burmese); highlight location from Document AI. Hover to locate; edit to correct.</p>
        </div>
      </div>
    </div>
  )
}
