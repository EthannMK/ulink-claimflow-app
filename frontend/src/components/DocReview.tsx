import { useEffect, useState } from 'react'
import { Card, Badge, Icon } from './ui'
import { confidenceCls } from '../lib/format'
import { reviewDoc, type ReviewResult } from '../lib/review'

async function renderPdfPages(file: File): Promise<string[]> {
  const pdfjs: any = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const n = Math.min(pdf.numPages, 15); const imgs: string[] = []
  for (let i = 1; i <= n; i++) {
    const page = await pdf.getPage(i); const vp = page.getViewport({ scale: 2 })
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
    imgs.push(c.toDataURL('image/png'))
  }
  return imgs
}
const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

export function DocReview({ file }: { file: File }) {
  const [imgs, setImgs] = useState<string[]>([])
  const [res, setRes] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [page, setPage] = useState(0)
  const [hover, setHover] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})

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
  const pageFields = (res?.fields || []).filter((f) => f.page === page)

  return (
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
          {pageFields.map((f) => (
            <div key={f.id}
              onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)}
              title={`${f.name}: ${f.value}`}
              style={{ position: 'absolute', left: `${f.box.x * 100}%`, top: `${f.box.y * 100}%`, width: `${f.box.w * 100}%`, height: `${f.box.h * 100}%` }}
              className={`rounded-[2px] cursor-pointer transition-colors ${hover === f.id ? 'bg-primary/30 ring-2 ring-primary' : 'bg-brand-accent/15 ring-1 ring-brand-accent/50'}`} />
          ))}
        </div>
      </div>

      {/* right: extracted fields */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <h4 className="font-semibold text-sm">Extracted fields</h4>
          {res && !err && <Badge className="bg-status-approved/10 text-status-approved">{res.fields.length} field(s)</Badge>}
        </div>
        {loading && <p className="text-xs text-text-main">Reading the document with Document AI…</p>}
        {err && <Card className="p-3 text-xs text-status-rejected">{err}</Card>}
        {!loading && !err && pageFields.length === 0 && <p className="text-xs text-outline">No fields detected on this page.</p>}
        <div className="space-y-1.5 max-h-[32rem] overflow-y-auto pr-1">
          {pageFields.map((f) => (
            <div key={f.id} onMouseEnter={() => setHover(f.id)} onMouseLeave={() => setHover(null)}
              className={`p-2 rounded-md border ${hover === f.id ? 'border-primary bg-primary/5' : 'border-outline-variant/50'}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-text-main truncate">{f.name}</span>
                <Badge className={confidenceCls(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
              </div>
              <input value={edits[f.id] ?? f.value} onChange={(e) => setEdits({ ...edits, [f.id]: e.target.value })}
                className="w-full text-sm border border-outline-variant rounded-md px-2 py-1 mt-1" />
            </div>
          ))}
        </div>
        <p className="text-[11px] text-outline mt-2">Hover a field to highlight where it was read from (and vice-versa). Edit any value to correct it.</p>
      </div>
    </div>
  )
}
