import { useEffect, useState, useRef, Fragment } from 'react'
import { Card, Badge, Icon } from './ui'
import { confidenceCls } from '../lib/format'
import { reviewDoc, reviewDocPagesRange, type ReviewResult, type ReviewField, type PageDetail } from '../lib/review'

function mergePages(prev: PageDetail[], incoming: PageDetail[]): PageDetail[] {
  const map = new Map<number, PageDetail>()
  for (const p of prev) map.set(p.page, p)
  for (const p of incoming) map.set(p.page, p)
  return Array.from(map.values()).sort((a, b) => a.page - b.page)
}

const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

function pageToText(p: { page: number; title: string; summary: string; items: { label: string; value: string }[] }): string {
  const lines = [`Page ${p.page}${p.title ? ` — ${p.title}` : ''}`, '']
  if (p.summary) { lines.push(p.summary, '') }
  for (const it of p.items) lines.push(`${it.label}: ${it.value}`)
  return lines.join('\n').trim()
}

export function DocReview({ file, mapFields }: { file: File; mapFields?: { id: string; label: string; hint?: string; section?: string }[] }) {
  // preview (rendered lazily — only the page being viewed)
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [imgCache, setImgCache] = useState<Record<number, string>>({})
  const [imgUrl, setImgUrl] = useState('')       // for non-PDF image files
  const [numPages, setNumPages] = useState(1)
  const [page, setPage] = useState(0)
  const [rendering, setRendering] = useState(false)

  // extraction
  const [res, setRes] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [hover, setHover] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})

  // full detection (page-by-page, streamed in ranges)
  const [pageItems, setPageItems] = useState<PageDetail[]>([])
  const [pageProgress, setPageProgress] = useState({ done: 0, total: 0 })
  const [pageLoading, setPageLoading] = useState(false)
  const [pageErr, setPageErr] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const startedRef = useRef('')

  const hasMap = !!mapFields?.length
  const [mapped, setMapped] = useState(hasMap)
  const useMapped = mapped && hasMap
  const full = !useMapped

  // ---- load the document (metadata only — pages render on demand) ----
  useEffect(() => {
    let alive = true
    setPdfDoc(null); setImgCache({}); setImgUrl(''); setNumPages(1); setPage(0)
    setRes(null); setErr(''); setEdits({}); setHover(null)
    setPageItems([]); setPageProgress({ done: 0, total: 0 }); setPageErr(''); setPageLoading(false); setMapped(hasMap); startedRef.current = ''
    ;(async () => {
      try {
        if (isPdf(file)) {
          const pdfjs: any = await import('pdfjs-dist')
          pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
          const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
          if (!alive) return
          setPdfDoc(doc); setNumPages(doc.numPages)
        } else {
          const u = URL.createObjectURL(file); if (!alive) return
          setImgUrl(u); setNumPages(1)
        }
      } catch { if (alive) setErr('Could not open the document preview.') }
    })()
    return () => { alive = false }
  }, [file])

  // ---- render only the current page, cache it ----
  useEffect(() => {
    if (!pdfDoc || imgCache[page]) return
    let alive = true
    setRendering(true)
    ;(async () => {
      try {
        const pg = await pdfDoc.getPage(page + 1)
        const vp = pg.getViewport({ scale: 1.5 })
        const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
        await pg.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
        if (!alive) return
        const url = c.toDataURL('image/jpeg', 0.82)
        setImgCache((m) => ({ ...m, [page]: url }))
      } catch { /* ignore a single page render failure */ }
      finally { if (alive) setRendering(false) }
    })()
    return () => { alive = false }
  }, [pdfDoc, page, imgCache])

  // ---- required-fields extraction (independent of preview so its bar clears on its own) ----
  useEffect(() => {
    if (!hasMap) { setLoading(false); return }
    let alive = true
    setLoading(true); setErr(''); setRes(null); setEdits({})
    const fieldsArg = JSON.stringify(mapFields!.map((f) => ({ label: f.label, hint: f.hint || '', section: f.section || '' })))
    reviewDoc(file, fieldsArg)
      .then((r) => { if (alive) { if (r.error) setErr(r.error); setRes(r) } })
      .catch((e) => { if (alive) setErr(e?.message ?? 'Review failed') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [file, mapFields, hasMap])

  // ---- full detection: stream page ranges in parallel, show each batch as it lands ----
  useEffect(() => {
    if (!full) return
    const fileKey = `${file.name}:${file.size}:${file.lastModified}`
    if (startedRef.current === fileKey) return
    let alive = true

    // Whole-document fallback (used when we can't get a page count from PDF.js).
    const wholeDoc = () => {
      if (startedRef.current === fileKey) return
      startedRef.current = fileKey
      setPageItems([]); setPageErr(''); setPageLoading(true); setPageProgress({ done: 0, total: 0 })
      reviewDocPagesRange(file, 0, 0)
        .then((r) => { if (alive) { if (r.pages?.length) setPageItems((p) => mergePages(p, r.pages)); else if (r.error) setPageErr(r.error) } })
        .catch((e) => { if (alive) setPageErr(e?.message ?? 'Page analysis failed') })
        .finally(() => { if (alive) setPageLoading(false) })
    }

    // If PDF.js hasn't reported the page count yet, wait briefly, then fall back.
    if (isPdf(file) && !pdfDoc) {
      const t = setTimeout(() => { if (alive) wholeDoc() }, 6000)
      return () => { alive = false; clearTimeout(t) }
    }

    const total = isPdf(file) ? numPages : 1
    startedRef.current = fileKey
    setPageItems([]); setPageErr(''); setPageLoading(true); setPageProgress({ done: 0, total })
    const CH = 3
    const ranges: [number, number][] = []
    if (total <= 1) ranges.push([1, 1])
    else for (let s = 1; s <= total; s += CH) ranges.push([s, Math.min(CH, total - s + 1)])
    let remaining = ranges.length
    let anyOk = false
    ranges.forEach(([s, c]) => {
      reviewDocPagesRange(file, s, c)
        .then((r) => {
          if (!alive) return
          if (r.pages && r.pages.length) { anyOk = true; setPageItems((prev) => mergePages(prev, r.pages)) }
          setPageProgress((p) => ({ done: Math.min(p.done + c, total), total }))
        })
        .catch(() => {})
        .finally(() => { remaining -= 1; if (remaining === 0 && alive) { setPageLoading(false); if (!anyOk) setPageErr('No page detail returned — try again.') } })
    })
    return () => { alive = false }
  }, [full, file, pdfDoc, numPages])

  const curImg = imgUrl || imgCache[page]
  const display: ReviewField[] = res?.fields || []
  const pageBoxes = useMapped ? display.filter((f) => f.page === page && f.box.w > 0) : []
  function focusField(f: ReviewField) { setHover(f.id); if (f.box.w > 0 && f.page !== page) setPage(f.page) }

  async function copyPage(p: { page: number; title: string; summary: string; items: { label: string; value: string }[] }) {
    try { await navigator.clipboard.writeText(pageToText(p)); setCopied(p.page); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ }
  }
  async function copyAll() {
    if (!pageItems.length) return
    try { await navigator.clipboard.writeText(pageItems.map(pageToText).join('\n\n——————————\n\n')); setCopied(-1); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ }
  }

  return (
    <div>
      {hasMap && (
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <div className="flex items-center gap-1 bg-surface-container rounded-lg p-1 w-fit text-xs">
            <button onClick={() => setMapped(true)} className={`px-2.5 py-1 rounded-md ${useMapped ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>Required fields</button>
            <button onClick={() => setMapped(false)} className={`px-2.5 py-1 rounded-md ${full ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>Full detection</button>
          </div>
          {useMapped && res?.provider === 'hybrid' && <Badge className="bg-status-ai/10 text-status-ai">AI-assisted</Badge>}
          {full && <Badge className="bg-status-ai/10 text-status-ai">Page-by-page summary &amp; data</Badge>}
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 items-stretch">
        {/* left: document preview (only the current page is rendered) */}
        <div className="min-w-0">
          {numPages > 1 && (
            <div className="flex items-center gap-2 mb-2 text-xs">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40"><Icon name="chevron_left" className="text-[18px]" /></button>
              <span>Page {page + 1} / {numPages}</span>
              <button disabled={page >= numPages - 1} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40"><Icon name="chevron_right" className="text-[18px]" /></button>
              {rendering && <Icon name="autorenew" className="text-[14px] animate-spin text-outline" />}
            </div>
          )}
          <div className="relative border border-outline-variant rounded-lg overflow-hidden bg-surface-container">
            {curImg ? <img src={curImg} className="w-full block" alt="document" /> : <div className="h-64 grid place-items-center text-xs text-outline"><Icon name="autorenew" className="text-[16px] animate-spin mr-1" />Rendering page…</div>}
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

        {/* right: fields (Required) OR page-by-page analysis (Full) */}
        <div className="flex flex-col min-w-0 min-h-0">
          {useMapped ? (
            <>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold text-sm">Required fields</h4>
                {res && !err && !loading && <Badge className="bg-status-approved/10 text-status-approved">{display.length} field(s)</Badge>}
              </div>
              {loading && (
                <div className="mb-2">
                  <div className="h-1.5 bg-primary/15 rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full animate-pulse w-2/3" /></div>
                  <p className="text-xs text-text-main mt-1 flex items-center gap-1"><Icon name="autorenew" className="text-[14px] animate-spin" />Reading the document… (about 10–30s)</p>
                </div>
              )}
              {err && <Card className="p-3 text-xs text-status-rejected">{err}</Card>}
              {!loading && (
              <div className="space-y-1.5 flex-1 min-h-0 overflow-y-auto pr-1">
                {(() => { let lastSec = ''; return display.map((f) => {
                  const val = edits[f.id] ?? f.value
                  const has = val.trim() !== ''
                  const showSec = !!f.section && f.section !== lastSec
                  if (showSec) lastSec = f.section as string
                  return (
                    <Fragment key={f.id}>
                      {showSec && <div className="text-[11px] font-semibold uppercase tracking-wide text-primary/70 pt-2 pb-0.5">{f.section}</div>}
                      <div onMouseEnter={() => focusField(f)} onMouseLeave={() => setHover(null)}
                        className="p-2 rounded-md border"
                        style={{ borderColor: hover === f.id ? 'rgba(202,138,4,0.9)' : 'rgba(0,0,0,0.08)', backgroundColor: hover === f.id ? 'rgba(254,249,195,0.6)' : 'transparent' }}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-text-main truncate">{f.name}{f.box.w > 0 && f.page !== page && <span className="text-outline"> · p{f.page + 1}</span>}</span>
                          {has ? <Badge className={confidenceCls(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
                            : <Badge className="bg-on-surface-variant/10 text-on-surface-variant">—</Badge>}
                        </div>
                        <input value={val} onChange={(e) => setEdits({ ...edits, [f.id]: e.target.value })}
                          className="w-full text-sm border border-outline-variant rounded-md px-2 py-1 mt-1" placeholder="not found — enter manually" />
                      </div>
                    </Fragment>
                  )
                }) })()}
                {!err && display.length === 0 && <p className="text-xs text-outline">No fields.</p>}
              </div>
              )}
              <p className="text-[11px] text-outline mt-2">AI-extracted values — edit any field to correct.</p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="font-semibold text-sm">Full detection — page by page</h4>
                {pageItems.length > 0 && <Badge className="bg-status-approved/10 text-status-approved">{pageItems.length}{pageProgress.total ? ` / ${pageProgress.total}` : ''} page(s)</Badge>}
                {pageItems.length > 0 && (
                  <button onClick={copyAll} className="ml-auto text-xs text-primary flex items-center gap-1">
                    <Icon name={copied === -1 ? 'check' : 'content_copy'} className="text-[14px]" />{copied === -1 ? 'Copied' : 'Copy all'}
                  </button>
                )}
              </div>
              {pageLoading && (
                <div className="mb-2">
                  <div className="h-1.5 bg-primary/15 rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pageProgress.total ? Math.max(8, Math.round((pageProgress.done / pageProgress.total) * 100)) : 30}%` }} /></div>
                  <p className="text-xs text-text-main mt-1 flex items-center gap-1"><Icon name="autorenew" className="text-[14px] animate-spin" />Reading pages…{pageProgress.total ? ` ${pageProgress.done} / ${pageProgress.total}` : ''} (results appear as each batch finishes)</p>
                </div>
              )}
              {pageErr && pageItems.length === 0 && <Card className="p-3 text-xs text-status-rejected">{pageErr}</Card>}
              <div className="space-y-2 flex-1 min-h-0 overflow-y-auto pr-1">
                {pageItems.map((pg) => (
                  <div key={pg.page} className="border border-outline-variant/70 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <button onClick={() => { if (pg.page >= 1) setPage(pg.page - 1) }} title="Show this page" className="text-xs font-semibold text-primary flex items-center gap-1">
                        <Icon name="description" className="text-[14px]" />Page {pg.page}{pg.title ? ` · ${pg.title}` : ''}
                      </button>
                      <button onClick={() => copyPage(pg)} className="ml-auto text-xs text-primary flex items-center gap-1" title="Copy this page">
                        <Icon name={copied === pg.page ? 'check' : 'content_copy'} className="text-[14px]" />{copied === pg.page ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    {pg.summary && <p className="text-xs text-text-main mb-2 leading-relaxed">{pg.summary}</p>}
                    {pg.items.length > 0 && (
                      <div className="space-y-0.5">
                        {pg.items.map((it, j) => (
                          <div key={j} className="flex gap-2 text-xs">
                            <span className="text-outline w-40 shrink-0">{it.label}</span>
                            <span className="text-on-surface min-w-0 break-words">{it.value}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {!pageLoading && !pageErr && pageItems.length === 0 && <p className="text-xs text-outline">No page detail returned.</p>}
              </div>
              <p className="text-[11px] text-outline mt-2">Each page summarised with its key data — click a page to view it, or copy to paste elsewhere.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
