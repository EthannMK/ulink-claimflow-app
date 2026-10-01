import { useEffect, useState, useRef, useMemo, Fragment } from 'react'
import { Card, Badge, Icon } from './ui'
import { reviewDoc, reviewDocPagesRange, forgetPages, type ReviewResult, type ReviewField, type PageDetail, type PageTable } from '../lib/review'
import type { ReqField } from '../lib/jd1'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { refreshUsage } from '../lib/queryClient'
import { useQuery } from '@tanstack/react-query'
import { getConsistency } from '../lib/api'
import { findConflicts, applyValue, similarity, scriptOf, defaultInclude, type Conflict } from '../lib/consistency'

function mergePages(prev: PageDetail[], incoming: PageDetail[]): PageDetail[] {
  const map = new Map<number, PageDetail>()
  for (const p of prev) map.set(p.page, p)
  for (const p of incoming) map.set(p.page, p)
  return Array.from(map.values()).sort((a, b) => a.page - b.page)
}

/** Like mergePages, but never overwrites a page already on screen (it may have been edited). */
function mergeKeep(prev: PageDetail[], incoming: PageDetail[]): PageDetail[] {
  const have = new Set(prev.map((p) => p.page))
  return mergePages(prev, incoming.filter((p) => !have.has(p.page)))
}

/** Full-detection progress per file, kept outside React so leaving the page and coming
 *  back resumes where it was (the AI requests themselves are cached in lib/review.ts,
 *  so nothing is sent twice). */
interface Detect { pages: PageDetail[]; doneRanges: Set<string>; done: number; total: number; finished: boolean }
const DETECT = new Map<string, Detect>()
const fkey = (f: File) => `${f.name}:${f.size}:${f.lastModified}`

const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

function tableToTsv(t: PageTable): string {
  return [t.columns, ...t.rows].filter((r) => r.length).map((r) => r.map((c) => c.replace(/[\t\n]/g, ' ')).join('\t')).join('\n')
}
function pageToText(p: PageDetail): string {
  const lines = [`Page ${p.page}${p.title ? ` — ${p.title}` : ''}`, '']
  if (p.summary) { lines.push(p.summary, '') }
  for (const it of p.items) lines.push(`${it.label}: ${it.value}`)
  for (const t of p.tables ?? []) {
    lines.push('', `[Table] ${t.title || ''}`.trim())
    if (t.columns.length) lines.push(t.columns.join(' | '))
    for (const r of t.rows) lines.push(r.join(' | '))
  }
  return lines.join('\n').trim()
}
const isNumeric = (v: string) => /^[\s\d.,()%+-]+$/.test(v) && /\d/.test(v)

export function DocReview({ file, mapFields, initialPages, initialFieldValues, onSavePages, onSaveFields, onUserEdit, autoDetect = true, savedLabel = 'Kept with note', readOnly = false }: {
  file: File
  mapFields?: { id: string; label: string; hint?: string; section?: string }[]
  initialPages?: PageDetail[]
  onSavePages?: (pages: PageDetail[]) => void
  /** receives the Required fields (with the officer's edits) so they travel to JD2 */
  onSaveFields?: (fields: ReqField[]) => void
  /** officer's earlier corrections to Required fields (field name -> value), re-applied after reading */
  initialFieldValues?: Record<string, string>
  /** called on every change the officer makes (not on AI results) — drives "Unsaved changes" */
  onUserEdit?: () => void
  /** false = never start AI reading by itself (JD2 shows JD1's saved notes, no extra cost) */
  autoDetect?: boolean
  savedLabel?: string
  /** decided claims: show everything, change nothing */
  readOnly?: boolean
}) {
  // preview (rendered lazily — only the page being viewed)
  const [pdfDoc, setPdfDoc] = useState<any>(null)
  const [imgCache, setImgCache] = useState<Record<number, string>>({})
  const [imgUrl, setImgUrl] = useState('')       // for non-PDF image files
  const [numPages, setNumPages] = useState(1)
  const [page, setPage] = useState(0)
  const [pageInput, setPageInput] = useState('1')   // Adobe-style "go to page" box
  const [rendering, setRendering] = useState(false)

  // extraction
  const [res, setRes] = useState<ReviewResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [previewErr, setPreviewErr] = useState('')
  const [fillTick, setFillTick] = useState(0)   // bumps "Read the missing pages"
  const [hover, setHover] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})

  // full detection (page-by-page, streamed in ranges)
  const [pageItems, setPageItems] = useState<PageDetail[]>([])
  const [pageProgress, setPageProgress] = useState({ done: 0, total: 0 })
  const [pageLoading, setPageLoading] = useState(false)
  const [pageErr, setPageErr] = useState('')
  const [copied, setCopied] = useState<number | null>(null)
  const [usingSaved, setUsingSaved] = useState(false)   // true while showing previously-saved notes (not fresh AI)
  const startedRef = useRef('')
  const fillRef = useRef<number[] | null>(null)   // "Read the missing pages": only these pages, keep the rest
  const initialPagesRef = useRef(initialPages)
  useEffect(() => { initialPagesRef.current = initialPages }, [initialPages])
  const pageItemsRef = useRef<PageDetail[]>([])
  useEffect(() => { pageItemsRef.current = pageItems }, [pageItems])
  const onSavePagesRef = useRef(onSavePages)
  useEffect(() => { onSavePagesRef.current = onSavePages }, [onSavePages])

  const hasMap = !!mapFields?.length
  const mapKey = useMemo(() => JSON.stringify((mapFields ?? []).map((f) => ({ label: f.label, hint: f.hint || '', section: f.section || '' }))), [mapFields])
  const initialFieldsRef = useRef(initialFieldValues)
  useEffect(() => { initialFieldsRef.current = initialFieldValues }, [initialFieldValues])
  const onUserEditRef = useRef(onUserEdit)
  useEffect(() => { onUserEditRef.current = onUserEdit }, [onUserEdit])
  const userEdit = () => onUserEditRef.current?.()
  const [mapped, setMapped] = useState(hasMap)
  const useMapped = mapped && hasMap
  const full = !useMapped

  // ---- load the document (metadata only — pages render on demand) ----
  useEffect(() => {
    let alive = true
    setPdfDoc(null); setImgCache({}); setImgUrl(''); setNumPages(1); setPage(0)
    setRes(null); setErr(''); setPreviewErr(''); setEdits({}); setHover(null)
    const seed = initialPagesRef.current
    const det = DETECT.get(fkey(file))
    setPageProgress({ done: 0, total: 0 }); setPageErr(''); setPageLoading(false); setMapped(hasMap); startedRef.current = ''
    if (det && !det.finished) {
      // came back while full detection was still running — show what we have and resume
      setPageItems(mergeKeep(seed ?? [], det.pages)); setUsingSaved(false)
      setPageProgress({ done: det.done, total: det.total }); setPageLoading(true)
    } else if (seed && seed.length) {
      // saved notes + any batches that finished while this view was closed
      setPageItems(det?.finished ? mergeKeep(seed, det.pages) : seed); setUsingSaved(true)
    } else { setPageItems([]); setUsingSaved(false) }
    ;(async () => {
      try {
        if (isPdf(file)) {
          const pdfjs: any = await import('pdfjs-dist')
          pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl   // shipped with the app
          const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
          if (!alive) return
          setPdfDoc(doc); setNumPages(doc.numPages)
        } else {
          const u = URL.createObjectURL(file); if (!alive) return
          setImgUrl(u); setNumPages(1)
        }
      } catch { if (alive) setPreviewErr('Could not open the document preview — the AI reading still works. Try reloading the page.') }
    })()
    return () => {
      alive = false
      if (pageItemsRef.current.length) onSavePagesRef.current?.(pageItemsRef.current)
      const r = resRef.current
      if (r?.fields?.length) {
        const ed = editsRef.current
        onSaveFieldsRef.current?.(r.fields.map((f) => { const v = ed[f.id] ?? f.value; return { name: f.name, value: v, section: f.section || '', page: f.page, ai_value: v !== f.value ? f.value : '' } }))
      }
    }
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
    reviewDoc(file, mapKey)
      .then((r) => {
        if (!alive) return
        if (r.error) setErr(r.error)
        setRes(r)
        const prev = initialFieldsRef.current   // keep what the officer corrected before
        if (prev) {
          const e: Record<string, string> = {}
          for (const f of r.fields || []) if (prev[f.name] !== undefined && prev[f.name] !== f.value) e[f.id] = prev[f.name]
          setEdits(e)
        }
      })
      .catch((e) => { if (alive) setErr(e?.message ?? 'Review failed') })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [file, mapKey, hasMap])

  // ---- full detection: stream page ranges in parallel, show each batch as it lands ----
  useEffect(() => {
    if (!full || usingSaved || !autoDetect) return
    const fileKey = fkey(file)
    const det0 = DETECT.get(fileKey)
    if (det0?.finished && !fillRef.current) {
      // already read (maybe while this tab was hidden) — just show it, nothing to send
      if (det0.pages.length) setPageItems((prev) => mergeKeep(prev, det0.pages))
      setPageLoading(false); setPageProgress({ done: det0.done, total: det0.total })
      startedRef.current = fileKey
      return
    }
    let alive = true
    // re-attach to a run that is still going (the requests are cached, nothing is sent twice)
    const resuming = !!det0 && !det0.finished
    const filling = fillRef.current

    // Whole-document fallback (used when we can't get a page count from PDF.js).
    const wholeDoc = () => {
      startedRef.current = fileKey
      if (!DETECT.has(fileKey)) DETECT.set(fileKey, { pages: [], doneRanges: new Set(), done: 0, total: 0, finished: false })
      const det = DETECT.get(fileKey)!
      if (!resuming) setPageItems([])
      setPageErr(''); setPageLoading(true); setPageProgress({ done: 0, total: 0 })
      reviewDocPagesRange(file, 0, 0)
        .then((r) => {
          if (r.pages?.length) { det.pages = mergePages(det.pages, r.pages); det.finished = true }
          else DETECT.delete(fileKey)   // nothing came back — let the next attempt start fresh
          if (alive) { if (r.pages?.length) setPageItems((p) => mergeKeep(p, r.pages)); else setPageErr(r.error || 'No page detail returned — try again.') }
        })
        .catch((e) => { DETECT.delete(fileKey); if (alive) setPageErr(e?.message ?? 'Page analysis failed') })
        .finally(() => { if (alive) setPageLoading(false) })
    }

    // a whole-document read is already running -> stay on it (don't start page batches too)
    if (resuming && det0!.total === 0) { wholeDoc(); return () => { alive = false } }

    // If PDF.js hasn't reported the page count yet, wait briefly, then fall back.
    if (isPdf(file) && !pdfDoc) {
      const t = setTimeout(() => { if (alive) wholeDoc() }, 6000)
      return () => { alive = false; clearTimeout(t) }
    }

    const total = isPdf(file) ? numPages : 1
    startedRef.current = fileKey
    if (filling) DETECT.set(fileKey, { pages: pageItemsRef.current, doneRanges: new Set(), done: total - filling.length, total, finished: false })
    if (!DETECT.has(fileKey)) DETECT.set(fileKey, { pages: [], doneRanges: new Set(), done: 0, total, finished: false })
    const det = DETECT.get(fileKey)!
    det.total = total
    if (!resuming && !filling) setPageItems([])
    setPageErr(''); setPageLoading(true); setPageProgress({ done: det.done, total })
    const CH = 3
    const ranges: [number, number][] = []
    if (filling) {
      // group the missing pages into runs of up to 3 consecutive pages
      for (const pg of filling) {
        const last = ranges[ranges.length - 1]
        if (last && last[0] + last[1] === pg && last[1] < CH) last[1] += 1
        else ranges.push([pg, 1])
      }
      fillRef.current = null
    } else if (total <= 1) ranges.push([1, 1])
    else for (let s = 1; s <= total; s += CH) ranges.push([s, Math.min(CH, total - s + 1)])
    let remaining = ranges.length
    let anyOk = false
    ranges.forEach(([s, c]) => {
      const rk = `${s}:${c}`
      reviewDocPagesRange(file, s, c)
        .then((r) => {
          refreshUsage()   // each finished batch shows in the allowance straight away
          // record progress even if the page was left meanwhile (counted once per range)
          if (!det.doneRanges.has(rk)) { det.doneRanges.add(rk); det.done = Math.min(det.done + c, total); det.pages = mergePages(det.pages, r.pages ?? []) }
          if (r.pages && r.pages.length) anyOk = true
          if (!alive) return
          if (r.pages && r.pages.length) setPageItems((prev) => mergeKeep(prev, r.pages))
          setPageProgress({ done: det.done, total })
        })
        .catch(() => {})
        .finally(() => {
          remaining -= 1
          if (remaining === 0) {
            if (anyOk) det.finished = true; else DETECT.delete(fileKey)   // failed runs can be retried
            if (alive) { setPageLoading(false); if (!anyOk) setPageErr('No page detail returned — try again.') }
          }
        })
    })
    return () => { alive = false }
  }, [full, file, pdfDoc, numPages, usingSaved, fillTick])

  // Keep the JD1 note's page_notes in sync with what's on screen — the original AI read if
  // untouched, or JD1's edited version if changed. Debounced: syncing on every streamed AI
  // batch and every keystroke meant a full note clone + localStorage write each time, which
  // visibly slowed the page down. This waits for a short quiet period instead — the
  // file-change cleanup above still flushes immediately if you navigate away inside that window.
  useEffect(() => {
    if (!pageItems.length) return
    const t = setTimeout(() => { onSavePagesRef.current?.(pageItems) }, 300)
    return () => clearTimeout(t)
  }, [pageItems])

  // Required fields → parent (so JD2 gets them, with JD1's edits). Debounced like page notes.
  const resRef = useRef<ReviewResult | null>(null)
  useEffect(() => { resRef.current = res }, [res])
  const editsRef = useRef<Record<string, string>>({})
  useEffect(() => { editsRef.current = edits }, [edits])
  const onSaveFieldsRef = useRef(onSaveFields)
  useEffect(() => { onSaveFieldsRef.current = onSaveFields }, [onSaveFields])
  useEffect(() => {
    if (!res?.fields?.length) return
    const t = setTimeout(() => {
      onSaveFieldsRef.current?.(res.fields.map((f) => {
        const v = edits[f.id] ?? f.value
        return { name: f.name, value: v, section: f.section || '', page: f.page, ai_value: v !== f.value ? f.value : '' }
      }))
    }, 500)
    return () => clearTimeout(t)
  }, [res, edits])

  // keep the page-number box in sync when the page changes via arrows / clicks
  useEffect(() => { setPageInput(String(page + 1)) }, [page])
  function commitPageInput() {
    const n = parseInt(pageInput, 10)
    if (!isNaN(n) && n >= 1 && n <= numPages) setPage(n - 1)
    else setPageInput(String(page + 1))
  }

  const curImg = imgUrl || imgCache[page]
  const curPage = pageItems.find((p) => p.page === page + 1)   // Full-detection result for the page on screen
  const display: ReviewField[] = res?.fields || []
  const pageBoxes = useMapped ? display.filter((f) => f.page === page && f.box.w > 0) : []

  async function copyPage(p: { page: number; title: string; summary: string; items: { label: string; value: string }[] }) {
    try { await navigator.clipboard.writeText(pageToText(p)); setCopied(p.page); setTimeout(() => setCopied(null), 1500) } catch { /* ignore */ }
  }
  function updatePageTitle(pg: number, title: string) {
    userEdit()
    setPageItems((prev) => prev.map((p) => (p.page === pg ? { ...p, title } : p)))
  }
  function updatePageSummary(pg: number, summary: string) {
    userEdit()
    setPageItems((prev) => prev.map((p) => (p.page === pg ? { ...p, summary } : p)))
  }
  function updateTableCell(pg: number, ti: number, ri: number, ci: number, value: string) {
    userEdit()
    setPageItems((prev) => prev.map((p) => (p.page !== pg ? p : {
      ...p, tables: (p.tables ?? []).map((t, i) => (i !== ti ? t : { ...t, rows: t.rows.map((r, j) => (j !== ri ? r : r.map((c, k) => (k === ci ? value : c)))) })),
    })))
  }
  const [copiedTable, setCopiedTable] = useState('')
  async function copyTable(key: string, t: PageTable) {
    try { await navigator.clipboard.writeText(tableToTsv(t)); setCopiedTable(key); setTimeout(() => setCopiedTable(''), 1500) } catch { /* ignore */ }
  }
  function readMissing() {
    const have = new Set(pageItems.map((p) => p.page))
    const missing = Array.from({ length: numPages }, (_, i) => i + 1).filter((p) => !have.has(p))
    if (!missing.length) return
    fillRef.current = missing
    startedRef.current = ''
    setUsingSaved(false)
    setFillTick((t) => t + 1)   // re-run the reader even when nothing else changed
  }
  // ---- handwriting variants across pages ("use the clearest value") ----
  const { data: consistency } = useQuery({ queryKey: ['settings', 'consistency'], queryFn: getConsistency, staleTime: 60_000 })
  const [dismissed, setDismissed] = useState<Set<string>>(new Set())
  const conflicts: Conflict[] = useMemo(() => (
    !consistency?.enabled || pageLoading || pageItems.length < 2 ? [] : findConflicts(pageItems, consistency.fields).filter((c) => !dismissed.has(c.id))
  ), [consistency, pageLoading, pageItems, dismissed])
  // per banner: which variants will be replaced (the officer can untick any)
  const [include, setInclude] = useState<Record<string, Set<string>>>({})
  const includeFor = (c: Conflict) => include[c.id] ?? defaultInclude(c)
  function toggleInclude(c: Conflict, norm: string) {
    setInclude((m) => { const cur = new Set(m[c.id] ?? defaultInclude(c)); cur.has(norm) ? cur.delete(norm) : cur.add(norm); return { ...m, [c.id]: cur } })
  }
  function applyEverywhere(c: Conflict, value: string) {
    userEdit()
    const chosen = c.variants.findIndex((v) => v.value === value)
    // "use this instead": the old best becomes one of the readings to replace
    const inc = chosen === c.best || chosen < 0 ? includeFor(c)
      : new Set([...includeFor(c), c.variants[c.best].norm].filter((n) => n !== c.variants[chosen].norm))
    setPageItems((prev) => applyValue(prev, c, value, inc))
    setDismissed((d) => new Set(d).add(c.id))
  }
  function restoreItem(pg: number, idx: number) {
    userEdit()
    setPageItems((prev) => prev.map((p) => (p.page !== pg ? p : { ...p, items: p.items.map((it, j) => (j === idx ? { ...it, value: it.ai_value || it.value, ai_value: '' } : it)) })))
  }
  function updatePageItemValue(pg: number, idx: number, value: string) {
    userEdit()
    setPageItems((prev) => prev.map((p) => (p.page === pg ? { ...p, items: p.items.map((it, j) => (j === idx ? { ...it, value, ai_value: it.ai_value || it.value } : it)) } : p)))
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
        <div className="min-w-0 self-start sticky top-2">
          {numPages > 1 && (
            <div className="flex items-center gap-1.5 mb-2 text-xs">
              <button disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="disabled:opacity-40"><Icon name="chevron_left" className="text-[18px]" /></button>
              <span>Page</span>
              <input
                value={pageInput}
                onChange={(e) => setPageInput(e.target.value.replace(/[^0-9]/g, ''))}
                onKeyDown={(e) => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur(); commitPageInput() } }}
                onBlur={commitPageInput}
                className="w-10 text-center border border-outline-variant rounded-md px-1 py-0.5"
                aria-label="Go to page"
              />
              <span>/ {numPages}</span>
              <button disabled={page >= numPages - 1} onClick={() => setPage((p) => p + 1)} className="disabled:opacity-40"><Icon name="chevron_right" className="text-[18px]" /></button>
              {rendering && <Icon name="autorenew" className="text-[14px] animate-spin text-outline" />}
            </div>
          )}
          <div className="relative border border-outline-variant rounded-lg overflow-hidden bg-surface-container">
            {curImg ? <img src={curImg} className="w-full block" alt="document" /> : previewErr ? <div className="h-64 grid place-items-center text-xs text-status-rejected px-4 text-center">{previewErr}</div> : <div className="h-64 grid place-items-center text-xs text-outline"><Icon name="autorenew" className="text-[16px] animate-spin mr-1" />Rendering page…</div>}
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
        <fieldset disabled={readOnly} className="flex flex-col min-w-0 min-h-0 border-0 p-0 m-0">
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
                  const showSec = !!f.section && f.section !== lastSec
                  if (showSec) lastSec = f.section as string
                  return (
                    <Fragment key={f.id}>
                      {showSec && <div className="text-[11px] font-semibold uppercase tracking-wide text-primary/70 pt-2 pb-0.5">{f.section}</div>}
                      <div className={`p-2 rounded-md border ${val !== f.value ? 'border-primary/40 bg-primary/[0.03]' : 'border-outline-variant/60'}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-text-main truncate">{f.name}</span>
                          {f.page > 0 && f.page !== page && <button onClick={() => setPage(f.page)} className="text-[11px] text-primary shrink-0">page {f.page + 1}</button>}
                        </div>
                        <input value={val} onChange={(e) => { userEdit(); setEdits((m) => ({ ...m, [f.id]: e.target.value })) }}
                          className="w-full text-sm border border-outline-variant rounded-md px-2 py-1 mt-1" placeholder="not found — enter manually" />
                        {val !== f.value && <p className="text-[11px] text-outline mt-0.5">AI read: “{f.value || 'nothing'}”
                          <button onClick={() => { userEdit(); setEdits((m) => { const n = { ...m }; delete n[f.id]; return n }) }} className="ml-2 text-primary hover:underline">Restore</button></p>}
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
              <div className="flex items-center gap-2 mb-2 flex-wrap">
                <h4 className="font-semibold text-sm">Full detection — page by page</h4>
                {pageItems.length > 0 && <Badge className="bg-status-approved/10 text-status-approved">{pageItems.length}{pageProgress.total ? ` / ${pageProgress.total}` : ''} page(s)</Badge>}
                {usingSaved && <Badge className="bg-status-pending/10 text-status-pending">Saved notes</Badge>}
                <div className="ml-auto flex items-center gap-3">
                  {usingSaved && autoDetect && (
                    <button onClick={() => { DETECT.delete(fkey(file)); forgetPages(file); setUsingSaved(false); setPageItems([]); startedRef.current = '' }}
                      className="text-xs text-outline flex items-center gap-1" title="Discard and re-run AI detection">
                      <Icon name="autorenew" className="text-[14px]" />Re-run AI
                    </button>
                  )}
                  {onSavePages && pageItems.length > 0 && (
                    <span className="text-xs text-status-approved flex items-center gap-1" title="Kept with the JD1 note automatically as you edit — no extra save needed">
                      <Icon name="check_circle" className="text-[14px]" />{savedLabel}
                    </span>
                  )}
                  {pageItems.length > 0 && (
                    <button onClick={copyAll} className="text-xs text-primary flex items-center gap-1">
                      <Icon name={copied === -1 ? 'check' : 'content_copy'} className="text-[14px]" />{copied === -1 ? 'Copied' : 'Copy all'}
                    </button>
                  )}
                </div>
              </div>
              {pageLoading && (
                <div className="mb-2">
                  <div className="h-1.5 bg-primary/15 rounded-full overflow-hidden"><div className="h-full bg-primary rounded-full transition-all" style={{ width: `${pageProgress.total ? Math.max(8, Math.round((pageProgress.done / pageProgress.total) * 100)) : 30}%` }} /></div>
                  <p className="text-xs text-text-main mt-1 flex items-center gap-1"><Icon name="autorenew" className="text-[14px] animate-spin" />Reading pages…{pageProgress.total ? ` ${pageProgress.done} / ${pageProgress.total}` : ''} (results appear as each batch finishes)</p>
                </div>
              )}
              {autoDetect && !pageLoading && numPages > 1 && pageItems.length > 0 && pageItems.length < numPages && (
                <div className="flex items-center gap-2 bg-status-pending/10 rounded-lg px-3 py-2 mb-2 text-xs">
                  <Icon name="info" className="text-[16px] text-status-pending shrink-0" />
                  <span className="flex-1 text-text-main">Only {pageItems.length} of {numPages} pages have detail. Your edits are kept — this reads just the missing pages.</span>
                  <button onClick={readMissing} className="font-semibold text-primary hover:underline shrink-0">Read the {numPages - pageItems.length} missing page(s)</button>
                </div>
              )}
              {conflicts.map((c) => {
                const best = c.variants[c.best]
                return (
                  <div key={c.id} className="bg-status-pending/10 rounded-lg px-3 py-2 mb-2 text-xs">
                    <div className="flex items-start gap-2">
                      <Icon name="draw" className="text-[16px] text-status-pending shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="text-text-main"><b>{c.title}</b> is read differently on different pages — usually handwriting. Best reading: <b>{best.value}</b>
                          <span className="text-outline"> ({best.printed ? 'printed' : 'handwritten'}{best.unclear && !best.clear ? ', unclear' : ''}, page {best.pages.join(', ')})</span></div>
                        <ul className="mt-1 space-y-0.5">
                          {c.variants.map((v, i) => {
                            const isBest = i === c.best
                            const other = !isBest && scriptOf(v.value) !== scriptOf(best.value)
                            const far = !isBest && !other && similarity(v.norm, best.norm) < 0.5
                            const on = includeFor(c).has(v.norm)
                            return (
                              <li key={v.norm} className="flex items-start gap-2">
                                {isBest ? <Icon name="star" className="text-[14px] text-primary mt-0.5" />
                                  : <input type="checkbox" className="mt-0.5" checked={on} onChange={() => toggleInclude(c, v.norm)} title="Replace this reading" />}
                                <span className="font-medium">“{v.value}”</span>
                                <span className="text-outline whitespace-nowrap">{v.hw ? 'handwritten' : 'printed'}{v.unclear ? ', unclear' : ''} · page {v.pages.join(', ')}</span>
                                {other && <span className="text-text-main">{scriptOf(v.value) === 'my' ? 'Burmese spelling' : 'English spelling'} — likely the same name</span>}
                                {far && <span className="text-status-rejected">looks like a different person — unticked, check it</span>}
                                {!isBest && <button onClick={() => applyEverywhere(c, v.value)} className="text-primary hover:underline whitespace-nowrap">use this instead</button>}
                              </li>
                            )
                          })}
                        </ul>
                      </div>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        <button onClick={() => applyEverywhere(c, best.value)} disabled={includeFor(c).size === 0}
                          className="font-semibold text-primary hover:underline disabled:opacity-40">Use “{best.value}” for the ticked ({includeFor(c).size})</button>
                        <button onClick={() => setDismissed((d) => new Set(d).add(c.id))} className="text-outline hover:underline">Keep as read</button>
                      </div>
                    </div>
                  </div>
                )
              })}
              {!autoDetect && pageItems.length === 0 && <Card className="p-3 text-xs text-text-main">JD1 did not run full detection on this file, so there are no page-by-page notes. The document itself is on the left.</Card>}
              {pageErr && pageItems.length === 0 && <Card className="p-3 text-xs text-status-rejected">{pageErr}</Card>}
              <div className="flex-1 min-h-0 overflow-y-auto pr-1">
                {curPage ? (
                  <div className="border border-outline-variant/70 rounded-lg p-3">
                    <div className="flex items-center gap-2 mb-1.5">
                      <Icon name="description" className="text-[14px] text-primary shrink-0" />
                      <span className="text-xs text-outline shrink-0">Page {curPage.page} ·</span>
                      <input value={curPage.title} onChange={(e) => updatePageTitle(curPage.page, e.target.value)} placeholder="title"
                        className="flex-1 min-w-0 text-xs font-semibold text-primary border border-outline-variant/50 rounded px-1.5 py-0.5 bg-transparent" />
                      <button onClick={() => copyPage(curPage)} className="text-xs text-primary flex items-center gap-1 shrink-0" title="Copy this page">
                        <Icon name={copied === curPage.page ? 'check' : 'content_copy'} className="text-[14px]" />{copied === curPage.page ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <textarea value={curPage.summary} onChange={(e) => updatePageSummary(curPage.page, e.target.value)} placeholder="page summary"
                      rows={Math.min(14, Math.max(5, Math.ceil((curPage.summary || '').length / 75) + (curPage.summary || '').split('\n').length))}
                      className="w-full text-[13px] text-text-main leading-relaxed mb-2 border border-outline-variant/60 rounded-md px-2.5 py-2 resize-y min-h-[7rem]" />
                    {curPage.items.length > 0 && (
                      <div className="space-y-1">
                        {curPage.items.map((it, j) => (
                          <div key={j} className="flex gap-2 text-xs items-start">
                            <span className="text-outline w-40 shrink-0 pt-1.5">{it.label}
                              {it.hw && <span className="ml-1 text-[10px] px-1 rounded bg-surface-container text-text-main" title="The AI says this value is handwritten">handwritten</span>}
                              {it.unclear && <span className="ml-1 text-[10px] px-1 rounded bg-status-pending/15 text-status-pending" title="Hard to read — written exactly as the AI saw it">unclear</span>}
                            </span>
                            <div className="flex-1 min-w-0">
                              <input value={it.value} onChange={(e) => updatePageItemValue(curPage.page, j, e.target.value)}
                                className="w-full text-on-surface border border-outline-variant/60 rounded-md px-2 py-1" />
                              {it.ai_value && it.ai_value !== it.value && (
                                <p className="text-[11px] text-outline mt-0.5">AI read on this page: “{it.ai_value}”{it.hw ? ' (handwritten' + (it.unclear ? ', unclear)' : ')') : ''}
                                  <button onClick={() => restoreItem(curPage.page, j)} className="ml-2 text-primary hover:underline">Restore</button></p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {(curPage.tables ?? []).map((t, ti) => {
                      const key = `${curPage.page}-${ti}`
                      const cols = t.columns.length ? t.columns : (t.rows[0] ?? []).map((_, i) => `Column ${i + 1}`)
                      return (
                        <div key={ti} className="mt-3">
                          <div className="flex items-center gap-2 mb-1">
                            <Icon name="table_chart" className="text-[15px] text-primary" />
                            <span className="text-xs font-semibold text-text-main">{t.title || 'Table'}</span>
                            <span className="text-[11px] text-outline">{t.rows.length} row{t.rows.length === 1 ? '' : 's'}</span>
                            <button onClick={() => copyTable(key, t)} className="ml-auto text-xs text-primary flex items-center gap-1" title="Copy — paste straight into Excel">
                              <Icon name={copiedTable === key ? 'check' : 'content_copy'} className="text-[14px]" />{copiedTable === key ? 'Copied' : 'Copy table'}
                            </button>
                          </div>
                          <div className="overflow-auto max-h-96 border border-outline-variant/70 rounded-md">
                            <table className="w-full text-[11px] border-collapse">
                              <thead className="sticky top-0 bg-surface-container">
                                <tr><th className="px-1.5 py-1 text-left text-outline font-medium w-6">#</th>{cols.map((c, ci) => <th key={ci} className="px-1.5 py-1 text-left font-semibold text-text-main whitespace-nowrap">{c}</th>)}</tr>
                              </thead>
                              <tbody>
                                {t.rows.map((r, ri) => (
                                  <tr key={ri} className="border-t border-outline-variant/40 odd:bg-white even:bg-surface-container/30">
                                    <td className="px-1.5 text-outline">{ri + 1}</td>
                                    {cols.map((_, ci) => (
                                      <td key={ci} className="p-0">
                                        <input value={r[ci] ?? ''} onChange={(e) => updateTableCell(curPage.page, ti, ri, ci, e.target.value)}
                                          className={`w-full min-w-[4rem] bg-transparent px-1.5 py-1 focus:bg-white focus:outline focus:outline-1 focus:outline-primary ${isNumeric(r[ci] ?? '') ? 'text-right tabular-nums' : ''}`} />
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : pageLoading ? (
                  <p className="text-xs text-outline flex items-center gap-1"><Icon name="autorenew" className="text-[14px] animate-spin" />Reading this page…</p>
                ) : (
                  <p className="text-xs text-outline">No detail for this page{numPages > 1 ? ' yet — use the page box on the left to move between pages.' : '.'}</p>
                )}
              </div>
              <p className="text-[11px] text-outline mt-2">Use the page box on the left (◀ ▶ or type a number + Enter) — the document and its detected data change together. Edit any field to correct it. “Copy all” exports every page.</p>
            </>
          )}
        </fieldset>
      </div>
    </div>
  )
}
