import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { handoffToJD2, draftClientMail, reconcileInvoices, createTicketFromJD1, updateTicket, uploadTicketDoc, saveJD1Draft, getJD1Draft, fetchTicketFile,
  type JD1Note, type NoteField, type Section, type InvoiceItem, type DraftMail, type ReqField } from '../lib/jd1'
import type { PageDetail } from '../lib/review'
import { backendOn, getName } from '../lib/auth'
import { getClaim } from '../lib/api'
import { PageTitle, Card, Button, Badge, Icon } from '../components/ui'
import { DocReview, readInBackground, detectState } from '../components/DocReview'
import { JD1Progress } from '../components/JD1Progress'
import { jd1Runner, useJD1Run } from '../lib/jd1Runner'
import { useWorkspaceState, jd1Workspace } from '../lib/jd1Workspace'
import { SupportingReview } from '../components/SupportingReview'
import { usePersistent } from '../lib/persist'
import { DEFAULT_INSURERS, FORM_LABELS, formTypesOf, fieldsFor, type InsurerConfig, type FormType } from '../lib/insurers'

const A_LABELS: Record<string, string> = {
  document_complete: 'Document complete?', document_readable: 'Document readable?',
  missing_document: 'Missing document?', duplicate_document: 'Duplicate document?',
  incorrect_inconsistent: 'Incorrect / inconsistent info?',
}
const B_LABELS: Record<string, string> = {
  policy_member_eligibility: 'Policy / member eligibility', diagnosis: 'Diagnosis',
  treatment_procedure: 'Treatment / procedure', admission_discharge_dates: 'Admission / discharge dates',
  hospital_provider: 'Hospital / provider', claim_amount: 'Claim amount',
  prescription_medical_report: 'Prescription / medical report', invoice_receipt: 'Invoice / receipt',
}
const C_LABELS: Record<string, string> = {
  covered_status: 'Covered / Not / Unclear', exclusion_identified: 'Exclusion identified?',
  waiting_period_issue: 'Waiting-period issue?', policy_limit_issue: 'Policy-limit issue?',
  pre_existing_indicator: 'Pre-existing indicator?', duplicate_claim_indicator: 'Duplicate-claim indicator?',
  fraud_indicator: 'Fraud / suspicious?', need_investigation: 'Need further investigation?',
}
const H_LABELS: Record<string, string> = {
  member_name: 'Member name', insurer: 'Insurer', claim_date: 'Claim date', company: 'Company / employer',
  nrc_passport: 'NRC / Passport', total_claim_amount: 'Total claim amount', treatment_date: 'Treatment date', claim_no: 'Claim no.',
}

// AI confidence percentages are deliberately not shown (user decision) — officers check every value.
function ConfBadge(_: { f: NoteField }) { return null }

/** Two uploads with the same name (e.g. two phones' IMG_0001.jpg) would share page notes and
 *  overwrite each other in JD2 — give each its own name: scan.pdf, scan (2).pdf … */
function uniqueNames(list: File[]): File[] {
  const used = new Set<string>()
  return list.map((f) => {
    let name = f.name
    if (used.has(name.toLowerCase())) {
      const dot = f.name.lastIndexOf('.')
      const stem = dot > 0 ? f.name.slice(0, dot) : f.name, ext = dot > 0 ? f.name.slice(dot) : ''
      let i = 2
      while (used.has(`${stem} (${i})${ext}`.toLowerCase())) i++
      name = `${stem} (${i})${ext}`
    }
    used.add(name.toLowerCase())
    return name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified })
  })
}

/** The draft this browser saved last: { v: 2, ticketId, note, savedAt } (older drafts were a bare note). */
interface LocalDraft { v: 2; ticketId: string | null; note: JD1Note | null; savedAt: number }
function readLocalDraft(): LocalDraft | null {
  try {
    const raw = localStorage.getItem('jd1.note.draft'); if (!raw) return null
    const d = JSON.parse(raw)
    return d?.v === 2 ? d : { v: 2, ticketId: null, note: d, savedAt: 0 }
  } catch { return null }
}
const dropLocalDraft = () => { localStorage.removeItem('jd1.note.draft'); localStorage.removeItem('jd1.note.edits') }

export function JD1ReviewPage() {
  const nav = useNavigate()
  const run = useJD1Run()          // the scan runs outside this page — see lib/jd1Runner.ts
  const running = run.status === 'running'
  // working state lives in jd1Workspace so it survives visiting other pages mid-scan
  const [files, setFiles] = useWorkspaceState<File[]>('files', () => (run.status === 'running' || !run.consumed ? run.files : []))
  const [note, setNote] = useWorkspaceState<JD1Note | null>('note', null)
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState('')
  const [reviewIdx, setReviewIdx] = useWorkspaceState('reviewIdx', 0)
  const [insurers] = usePersistent<InsurerConfig[]>('settings.insurers.v3', DEFAULT_INSURERS)
  const [reviewInsurerId, setReviewInsurerId] = useWorkspaceState('reviewInsurerId', insurers[0]?.id ?? '')
  const [reviewForm, setReviewForm] = useWorkspaceState<FormType>('reviewForm', 'claim')
  const [mail, setMail] = useWorkspaceState<DraftMail | null>('mail', null)
  const [mailBusy, setMailBusy] = useState(false)
  const [invDraft, setInvDraft] = useWorkspaceState<Record<string, string>>('invDraft', {})
  const [menuOpen, setMenuOpen] = useState(false)
  const [templates] = usePersistent<{ id: string; name: string; channel: string; subject: string; bodyEn: string; bodyMm: string }[]>('settings.templates', [])
  const [dirty, setDirty] = useWorkspaceState('dirty', false)
  const [savedAt, setSavedAt] = useWorkspaceState('savedAt', '')
  const [ticketId, setTicketId] = useWorkspaceState<string | null>('ticketId', null)
  const [ticketRef, setTicketRef] = useWorkspaceState('ticketRef', '')
  // full detection + required fields per file — kept even before the note exists, so
  // whatever JD1 reviewed always travels to JD2 (it used to be dropped if detection ran first)
  const [pagesByFile, setPagesByFile] = useWorkspaceState<Record<string, PageDetail[]>>('pagesByFile', {})
  const [fieldsByFile, setFieldsByFile] = useWorkspaceState<Record<string, ReqField[]>>('fieldsByFile', {})
  const [sendStep, setSendStep] = useState('')
  const sentRef = useRef(false)   // after a successful send, late saves from the viewer are ignored
  const filesRef = useRef(files); filesRef.current = files
  // ---- every document is read for JD2, not only the one on screen ----------------------
  // Once the note exists, each file's full detection (and required fields) is read in the
  // background, one file at a time. Opening a file meanwhile joins the same read (nothing twice).
  const [bgState, setBgState] = useState<Record<string, 'queued' | 'reading' | 'done' | 'failed'>>({})
  const [, setTick] = useState(0)
  const bgGen = useRef(0)
  const filesKey = files.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|')
  const workKey = `${ticketId ?? ''}#${filesKey}`   // "this ticket with these files"
  const noteReady = !!note && run.status !== 'running'
  useEffect(() => {
    if (!noteReady || !files.length) return
    const gen = ++bgGen.current
    const ins = insurers.find((i) => i.id === reviewInsurerId)
    const avail = ins ? formTypesOf(ins) : (['claim'] as FormType[])
    const active = avail.includes(reviewForm) ? reviewForm : (avail[0] ?? 'claim')
    const map = fieldsFor(ins, active).map((f) => ({ label: f.label, hint: f.aiHint, section: f.section }))
    const todo = files.filter((f) => !(pagesByFile[f.name]?.length || note?.page_notes?.some((fn) => fn.file === f.name && fn.pages.length)))
    const todoFields = new Set(files.filter((f) => !fieldsByFile[f.name]?.length && !note?.required_fields?.some((ff) => ff.file === f.name && ff.fields.length)).map((f) => f.name))
    if (!todo.length && !todoFields.size) return
    setBgState((m) => ({ ...m, ...Object.fromEntries(todo.map((f) => [f.name, m[f.name] === 'done' ? 'done' : 'queued'])) }))
    ;(async () => {
      for (const f of files) {
        const needPages = todo.includes(f), needFields = todoFields.has(f.name)
        if (!needPages && !needFields) continue
        if (gen !== bgGen.current) return                       // new files or a new scan: stop
        if (needPages) setBgState((m) => ({ ...m, [f.name]: 'reading' }))
        await readInBackground(f, {
          wantPages: needPages, mapFields: needFields ? map : undefined,
          onPages: (pages) => { if (gen === bgGen.current) savePageNotes(f, pages) },
          onFields: (list) => { if (gen === bgGen.current && !sentRef.current && filesRef.current.includes(f)) setFieldsByFile((m) => (m[f.name]?.length ? m : { ...m, [f.name]: list })) },
        })
        if (gen !== bgGen.current) return
        if (needPages) setBgState((m) => ({ ...m, [f.name]: detectState(f).finished ? 'done' : 'failed' }))
      }
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteReady, filesKey])
  // refresh the per-file progress chips while anything is being read
  const anyReading = Object.values(bgState).some((v) => v === 'reading' || v === 'queued')
  useEffect(() => {
    if (!anyReading) return
    const t = setInterval(() => setTick((x) => x + 1), 1500)
    return () => clearInterval(t)
  }, [anyReading])
  // ---- keep every uploaded file with its Inbox ticket (Cloud Storage) as soon as the ticket exists,
  //      so documents are never lost if the claim isn't sent to JD2 the same day
  const [savedDocs, setSavedDocs] = useWorkspaceState<Record<string, 'saving' | 'saved' | 'failed'>>('savedDocs', {})
  const [uploadedKey, setUploadedKey] = useWorkspaceState('uploadedKey', '')   // these files are already on the server
  const savingFor = useRef('')
  useEffect(() => {
    if (!ticketId || !files.length) return
    const key = `${ticketId}|${filesKey}`
    if (savingFor.current === key || uploadedKey === key) return
    savingFor.current = key
    ;(async () => {
      let ok = true
      for (const f of files) {
        if (savingFor.current !== key) return
        setSavedDocs((m) => ({ ...m, [f.name]: 'saving' }))
        try { await uploadTicketDoc(ticketId, f); setSavedDocs((m) => ({ ...m, [f.name]: 'saved' })) }
        catch { ok = false; setSavedDocs((m) => ({ ...m, [f.name]: 'failed' })) }
      }
      if (ok && savingFor.current === key) setUploadedKey(key)
    })()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId, filesKey])
  const savedCount = files.filter((f) => savedDocs[f.name] === 'saved').length
  const docRead = (f: File) => !!(pagesByFile[f.name]?.length || note?.page_notes?.some((fn) => fn.file === f.name && fn.pages.length)) && !detectState(f).running
  const unreadDocs = files.filter((f) => !docRead(f))

  // ---- JD1's work is also kept with the ticket on the server, so anyone can open the ticket
  //      later ("Continue in JD1") and carry on — not only in the browser that scanned it
  const [ticketSync, setTicketSync] = useState<'' | 'saving' | 'saved' | 'failed'>('')
  async function syncToTicket(n: JD1Note | null = note, tid: string | null = ticketId) {
    if (!n || !tid || sentRef.current) return
    setTicketSync('saving')
    try { await saveJD1Draft(tid, noteForJD2(n)); setTicketSync('saved') } catch { setTicketSync('failed') }
  }
  // every document read in the background -> save the complete work with the ticket once
  const allRead = !!note && files.length > 0 && unreadDocs.length === 0
  const [syncedKey, setSyncedKey] = useWorkspaceState('syncedKey', '')
  useEffect(() => {
    if (!allRead || !ticketId || syncedKey === workKey) return
    setSyncedKey(workKey); syncToTicket()
  }, [allRead, ticketId, workKey])   // eslint-disable-line react-hooks/exhaustive-deps

  const [params, setParams] = useSearchParams()
  const openTicket = params.get('ticket')
  const [opening, setOpening] = useState('')
  const restoring = useRef(false)   // the open below was started by restoring this browser's draft (not a click)
  useEffect(() => {
    if (!openTicket) return
    if (openTicket === ticketId && files.length) { setParams({}, { replace: true }); return }   // already open here
    if (note && dirty && ticketId !== openTicket && !window.confirm('You have unsaved JD1 work open. Open the other ticket anyway? Unsaved changes here will be lost.')) { setParams({}, { replace: true }); return }
    if (running) { setFlash('A scan is still running — wait for it to finish (or cancel it) before opening another ticket.'); setParams({}, { replace: true }); return }
    let alive = true
    const fromRestore = restoring.current; restoring.current = false
    const local = readLocalDraft()
    ;(async () => {
      setOpening('Opening the ticket…'); setFlash('')
      try {
        const t = await getClaim(openTicket)
        if (!t || t.jd2_item_id) {
          if (local?.ticketId === openTicket) dropLocalDraft()   // that draft is finished (sent) or gone — forget it
          if (fromRestore) return                                // just show an empty page
          if (!t) throw new Error('Ticket not found')
          alive = false; nav(`/jd2/${t.jd2_item_id}`, { replace: true }); return   // already with JD2 — continue there
        }
        const server = await getJD1Draft(openTicket)
        // this browser's copy wins if it is newer than the server's (e.g. the last server save failed)
        const newerHere = local?.ticketId === openTicket && local.note && local.savedAt > (t.jd1_saved_at ? Date.parse(t.jd1_saved_at) : 0)
        const draft = newerHere ? local!.note : server
        const docs = t.documents ?? []
        if (!draft && docs.length === 0) {
          resetWorkspace(); setFiles([])
          setTicketId(t.id); setTicketRef(t.reference); setRescanFor(t.id)
          setFlash(`${t.reference} was scanned before files and JD1 work were saved on the server, so there is nothing to reopen. Upload the documents again and generate the note — it will update this ticket.`)
          return
        }
        const loaded: File[] = []
        for (let i = 0; i < docs.length; i++) {
          if (!alive) return
          setOpening(`Loading document ${i + 1} of ${docs.length}: ${docs[i].name}`)
          loaded.push(await fetchTicketFile(t.id, docs[i]))
        }
        if (!alive) return
        resetWorkspace()
        const fk = loaded.map((f) => `${f.name}:${f.size}:${f.lastModified}`).join('|')
        savingFor.current = `${t.id}|${fk}`; setUploadedKey(`${t.id}|${fk}`)   // already on the server
        setSyncedKey(`${t.id}#${fk}`)                                          // already saved there too
        setSavedDocs(Object.fromEntries(loaded.map((f) => [f.name, 'saved' as const])))
        setFiles(loaded)
        setTicketId(t.id); setTicketRef(t.reference); setRescanFor(t.id)
        setNote(draft)
        setPagesByFile(Object.fromEntries((draft?.page_notes || []).map((fn) => [fn.file, fn.pages])))
        setFieldsByFile(Object.fromEntries((draft?.required_fields || []).map((ff) => [ff.file, ff.fields])))
        setSavedAt(draft ? `opened from ${t.reference}` : '')
        if (!draft) setFlash(`Opened ${t.reference}'s documents. Generate the JD1 note to continue — it will update this ticket.`)
      } catch (e: any) { if (alive) setFlash('Could not open the ticket: ' + (e?.message ?? 'unknown')) }
      finally { if (alive) { setOpening(''); setParams({}, { replace: true }) } }
    })()
    return () => { alive = false }
  }, [openTicket])   // eslint-disable-line react-hooks/exhaustive-deps

  // invoice amounts JD1 corrected (description -> amount): re-applied after a re-generate
  const [invEdits, setInvEdits] = useWorkspaceState<Record<string, string>>('invEdits', {})
  // note fields JD1 changed by hand ("section.key" -> value): kept when the note is re-generated
  const [noteEdits, setNoteEdits] = useWorkspaceState<Record<string, string>>('noteEdits', {})

  // after a ticket was opened (or needs re-scanning), "Change files" keeps adding to that ticket
  const [rescanFor, setRescanFor] = useWorkspaceState<string | null>('rescanFor', null)

  /** Clear everything that belongs to one claim (files and ticket are set by the caller). */
  function resetWorkspace() {
    bgGen.current++; setBgState({}); sentRef.current = false
    setNote(null); setReviewIdx(0); setPagesByFile({}); setFieldsByFile({}); setNoteEdits({}); setInvEdits({}); setInvDraft({})
    setMail(null); setDirty(false); setSavedAt(''); setSavedDocs({}); setTicketSync(''); setFlash('')
    savingFor.current = ''; setUploadedKey(''); setSyncedKey('')
  }
  /** Start a different claim: an empty JD1 page not linked to any ticket. */
  function startNewClaim() {
    if (running) return
    if (dirty && !window.confirm('You have unsaved changes on this claim. Start a new claim anyway?')) return
    resetWorkspace(); setFiles([]); setTicketId(null); setTicketRef(''); setRescanFor(null)
    localStorage.removeItem('jd1.note.draft'); localStorage.removeItem('jd1.note.edits'); jd1Runner.clear()
  }
  function onPickFiles(list: File[]) {
    const keep = !!ticketId && rescanFor === ticketId   // more/other documents for the ticket that is open
    // (the ticket's server copies are named "image (2).jpg" the same way, so notes stay matched)
    const named = keep ? uniqueNames([...files, ...list]).slice(files.length) : uniqueNames(list)
    resetWorkspace(); setFiles(named); localStorage.removeItem('jd1.note.edits')
    if (!keep) { setTicketId(null); setTicketRef(''); setRescanFor(null) }
  }

  // restore a locally-saved draft on first load — only on an empty page, and a ticket's draft
  // is reopened from the server (never laid over other files or another ticket)
  useEffect(() => {
    if (jd1Runner.get().status === 'running' || !jd1Runner.get().consumed) return   // a scan result is on its way instead
    if (jd1Workspace.has('note') || files.length || ticketId) return   // coming back to the page — keep what was on screen
    if (new URLSearchParams(location.search).get('ticket')) return   // opening a ticket's saved work instead (below)
    try {
      const raw = localStorage.getItem('jd1.note.draft')
      if (raw) {
        const saved = JSON.parse(raw)
        if (saved?.v === 2) {
          if (saved.ticketId) { restoring.current = true; setParams({ ticket: saved.ticketId }, { replace: true }); return }
          if (!saved.note) return
        }
        const n: JD1Note = saved?.v === 2 ? saved.note : saved
        setNote(n); setSavedAt('restored'); setDirty(false)
        setPagesByFile(Object.fromEntries((n.page_notes || []).map((fn) => [fn.file, fn.pages])))
        setFieldsByFile(Object.fromEntries((n.required_fields || []).map((ff) => [ff.file, ff.fields])))
        setNoteEdits(JSON.parse(localStorage.getItem('jd1.note.edits') || '{}'))
      }
    } catch { /* ignore corrupt draft */ }
  }, [])

  /** One Save for everything: note fields, full-detection edits and required-field edits. */
  function saveDraft() {
    if (!note) return
    try {
      const full = noteForJD2(note)
      localStorage.setItem('jd1.note.draft', JSON.stringify({ v: 2, ticketId, note: full, savedAt: Date.now() } satisfies LocalDraft))
      localStorage.setItem('jd1.note.edits', JSON.stringify(noteEdits))
      setNote(full); setDirty(false); setSavedAt(new Date().toLocaleTimeString())
      syncToTicket(full)
    }
    catch { setFlash('Could not save draft (storage full).') }
  }
  function discardDraft() {
    localStorage.removeItem('jd1.note.draft'); localStorage.removeItem('jd1.note.edits')
    setDirty(false); setSavedAt(''); setNote(null); setNoteEdits({})
  }

  // auto-detect the insurer from the selected file's name
  useEffect(() => {
    const f = files[reviewIdx]; if (!f) return
    const n = f.name.toLowerCase()
    const hit = insurers.find((i) => {
      const name = i.name.toLowerCase(); const tok = name.split(/\s+/)[0]
      return n.includes(name) || (tok.length >= 3 && n.includes(tok))
    })
    if (hit) setReviewInsurerId(hit.id)
  }, [reviewIdx, files, insurers])

  // default the form type from the detected claim type (LOG vs reimbursement/claim)
  useEffect(() => {
    if (note?.claim_type) setReviewForm(note.claim_type.toUpperCase() === 'LOG' ? 'log' : 'claim')
  }, [note?.claim_type])

  /** The note exactly as JD2 should receive it: + every file's full detection and required fields. */
  function noteForJD2(n: JD1Note): JD1Note {
    const copy: JD1Note = structuredClone(n)
    const notes = new Map((copy.page_notes || []).map((fn) => [fn.file, fn.pages]))
    for (const [file, pages] of Object.entries(pagesByFile)) if (pages.length) notes.set(file, pages)
    copy.page_notes = [...notes].filter(([, pages]) => pages.length).map(([file, pages]) => ({ file, pages }))
    const fields = new Map((copy.required_fields || []).map((ff) => [ff.file, ff.fields]))
    for (const [file, list] of Object.entries(fieldsByFile)) if (list.length) fields.set(file, list)
    copy.required_fields = [...fields].map(([file, list]) => ({ file, fields: list }))
    return copy
  }

  async function sendToJD2() {
    if (!note) return
    setSending(true); setFlash(''); setSendStep('')
    try {
      const { item, failed } = await handoffToJD2(noteForJD2(note), files, ticketId, setSendStep)
      sentRef.current = true
      localStorage.removeItem('jd1.note.draft')
      nav(`/jd2/${item.id}`, { state: { justSent: true, failed } })
      setTimeout(() => jd1Workspace.clear(), 0)   // the next claim starts on a clean JD1 page
    }
    catch (e: any) { setFlash('Send to JD2 failed: ' + (e?.message ?? 'unknown')) }
    finally { setSending(false); setSendStep('') }
  }

  /** What JD1 corrected by hand — sent with a re-generate so the new note uses it. */
  function correctionsText(): string {
    const lines: string[] = []
    for (const [file, list] of Object.entries(fieldsByFile))
      for (const f of list) if (f.ai_value && f.value !== f.ai_value) lines.push(`${f.name}: ${f.value}   (${file})`)
    for (const [file, pages] of Object.entries(pagesByFile))
      for (const p of pages) for (const it of p.items)
        if (it.ai_value && it.value !== it.ai_value) lines.push(`${it.label}: ${it.value}   (${file}, page ${p.page})`)
    for (const [k, v] of Object.entries(invEdits)) lines.push(`Invoice "${k}" amount: ${v}   (JD1 note)`)
    for (const [k, v] of Object.entries(noteEdits)) lines.push(`${k.split('.').pop()!.replace(/_/g, ' ')}: ${v}   (JD1 note)`)
    return lines.join('\n')
  }

  function analyze() {
    if (!files.length || running) return
    setFlash('')
    if (!backendOn()) { setFlash('Backend is off — start the API and set VITE_USE_MOCKS=false to run the JD1 assistant.'); return }
    jd1Runner.start(files, correctionsText(), JSON.stringify({ t: ticketId, f: filesKey }))   // the current note stays until the new one arrives   // runs in the background; the effect below applies the result
  }

  // apply a finished scan — also when it finished while you were on another page
  useEffect(() => {
    if (run.consumed) return
    if (run.status === 'error') { setFlash('JD1 failed: ' + run.error); jd1Runner.consume(); return }
    if (run.status !== 'done' || !run.note) return
    const n = run.note
    jd1Runner.consume()
    let ctx: { t: string | null; f: string } | null = null
    try { ctx = run.context ? JSON.parse(run.context) : null } catch { /* old format */ }
    // you opened another claim (other files, or a different ticket) while it ran — a ticket that was
    // only created meanwhile for these same files is fine
    if (ctx && files.length && (ctx.f !== filesKey || (ctx.t && ticketId && ctx.t !== ticketId))) {
      setFlash('A scan you started for other documents finished — it was not applied to this claim. Generate the note again if you need it.')
      return
    }
    const failed = !n.ai_summary && !Object.values(n.header ?? {}).some((v: any) => typeof v === 'object' && v?.value)
    if (failed) {   // the AI could not read the packet: keep what is on screen, don't touch the ticket
      setFlash((n.notes || 'The AI could not read the documents.') + ' Nothing was changed — please try Generate again.')
      return
    }
    if (!files.length && run.files.length) setFiles(run.files)
    // keep everything JD1 corrected: hand-edited note fields, full detection, required fields
    const merged: any = structuredClone(n)
    for (const [k, v] of Object.entries(noteEdits)) {
      const [sec, key] = k.split('.')
      if (merged[sec]) merged[sec][key] = { ...(merged[sec][key] ?? { confidence: 0, remark: '' }), value: v }
    }
    if (merged.invoices?.items?.length && Object.keys(invEdits).length) {
      for (const it of merged.invoices.items) {
        const v = invEdits[it.description || it.provider || it.id]
        if (v !== undefined && v !== it.amount) { it.audit = [...(it.audit || []), { field: 'amount', old: it.amount, new: v, by: getName(), at: new Date().toISOString() }]; it.amount = v; it.readable = /\d/.test(v) }
      }
      merged.invoices = reconcileInvoices(merged.invoices)
    }
    const kept = noteForJD2(merged as JD1Note)
    const hasEdits = Object.keys(noteEdits).length > 0 || Object.keys(pagesByFile).length > 0 || Object.keys(fieldsByFile).length > 0
    setNote(kept); setDirty(hasEdits); setSavedAt(''); localStorage.removeItem('jd1.note.draft')
    if (n.notes && n.provider !== 'stub' && /error|HTTP \d/i.test(n.notes)) setFlash(n.notes)
    // auto-create (or update) the Inbox ticket — best-effort, never blocks the note
    ;(async () => {
      try {
        const complete = n.checklist_missing.length === 0
        const summary = (n.ai_summary || n.notes || '').split('\n')[0].slice(0, 200)
        if (ticketId) { await updateTicket(ticketId, { documentsComplete: complete, summary }); syncToTicket(kept, ticketId) }
        else { const t = await createTicketFromJD1(n); setTicketId(t.id); setTicketRef(t.reference); syncToTicket(kept, t.id) }
      } catch { /* ignore ticket errors */ }
    })()
  }, [run.status, run.consumed])

  function savePageNotes(file: File, pages: PageDetail[]) {
    // the very same file must still be open — another ticket may have a file with the same name
    if (sentRef.current || !filesRef.current.includes(file)) return
    const fileName = file.name
    setPagesByFile((m) => ({ ...m, [fileName]: pages }))
    // functional update: never overwrite note edits typed after these pages arrived
    setNote((n) => n && { ...n, page_notes: [...(n.page_notes ?? []).filter((fn) => fn.file !== fileName), { file: fileName, pages }] })
  }

  function editField(sec: 'section_a' | 'section_b' | 'section_c' | 'header', key: string, value: string) {
    if (!note) return
    setNote((n) => { if (!n) return n; const copy: any = structuredClone(n); copy[sec][key] = { ...copy[sec][key], value }; return copy })
    setDirty(true)
    setNoteEdits((m) => ({ ...m, [`${sec}.${key}`]: value }))
  }

  // JD1 corrects an invoice amount — record the original→new audit trail, then re-reconcile.
  function commitInvoiceAmount(id: string) {
    if (!note) return
    const draft = invDraft[id]
    if (draft === undefined) return
    const copy: JD1Note = structuredClone(note)
    const it = copy.invoices.items.find((i) => i.id === id)
    setInvDraft((d) => { const n = { ...d }; delete n[id]; return n })
    if (!it || it.amount === draft) return
    it.audit = [...(it.audit || []), { field: 'amount', old: it.amount, new: draft, by: getName(), at: new Date().toISOString() }]
    it.amount = draft
    setInvEdits((m) => ({ ...m, [it.description || it.provider || it.id]: draft }))
    it.readable = /\d/.test(draft)
    copy.invoices = reconcileInvoices(copy.invoices)
    setNote(copy); setDirty(true)
  }

  async function makeDraftMail() {
    if (!note) return
    setMailBusy(true); setFlash('')
    try {
      setMail(await draftClientMail(note))
      if (ticketId) { try { await updateTicket(ticketId, { status: 'awaiting_docs' }) } catch { /* ignore */ } }
    }
    catch (e: any) { setFlash('Draft mail failed: ' + (e?.message ?? 'unknown')) }
    finally { setMailBusy(false) }
  }

  function download() {
    if (!note) return
    const blob = new Blob([toMarkdown(note)], { type: 'text/markdown' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `JD1_Process_Note_${(note.header.member_name.value || 'claim').replace(/\s+/g, '_')}.md`
    a.click()
  }

  const fieldRow = (sec: 'section_a' | 'section_b' | 'section_c', obj: Section, labels: Record<string, string>) => (
    Object.keys(labels).map((k) => {
      const f = obj[k] ?? { value: '', confidence: 0, remark: '' }
      return (
        <div key={k} className="py-2 border-b border-outline-variant/40 last:border-0">
          <div className="flex items-center gap-2">
            <label className="text-xs text-text-main w-52 shrink-0">{labels[k]}</label>
            <input value={f.value} onChange={(e) => editField(sec, k, e.target.value)}
              className="flex-1 min-w-0 text-sm border border-outline-variant rounded-md px-2 py-1" />
            <ConfBadge f={f} />
          </div>
          {f.remark && <p className="text-xs text-outline mt-1 pl-1">{f.remark}</p>}
        </div>
      )
    })
  )

  return (
    <div>
      <PageTitle title="JD1 Assistant" sub="Upload a full claim packet. The AI classifies each document, reads digital and scanned pages, and drafts the JD1 Process Note (A / B / C) for review."
        action={note ? <Button variant="outline" onClick={download}><Icon name="download" className="text-[16px]" />Download note</Button> : undefined} />

      {/* compact upload bar */}
      <Card className="p-4 mb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <label className="flex items-center gap-2 px-3 py-2 rounded-lg border-2 border-dashed border-outline-variant cursor-pointer hover:bg-surface-container/50 text-sm">
            <Icon name="upload_file" className="text-[20px] text-primary" />
            <span className="text-text-main">{files.length ? (ticketRef && rescanFor === ticketId ? `Change files (stays on ${ticketRef})` : 'Change files') : ticketRef && rescanFor === ticketId ? `Upload the documents for ${ticketRef}` : 'Upload claim packet (PDFs & images)'}</span>
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" disabled={running || !!opening}
              onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ''; if (l.length) onPickFiles(l) }} />
          </label>
          {(ticketRef || files.length > 0) && !running && (
            <Button variant="ghost" size="sm" onClick={startNewClaim} title="Clear this page and start a different claim"><Icon name="add" className="text-[16px]" />New claim</Button>
          )}
          {files.length > 0 && <span className="text-xs text-outline">{files.length} file(s)</span>}
          {ticketRef && <span className="text-xs text-primary flex items-center gap-1"><Icon name="confirmation_number" className="text-[14px]" />Ticket {ticketRef}</span>}
          <div className="flex-1" />
          <Button onClick={analyze} disabled={!files.length || running}>{running ? 'Reading packet…' : note ? 'Re-generate JD1 note' : 'Generate JD1 note'}</Button>
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {files.map((f) => <span key={f.name} className="text-xs flex items-center gap-1 bg-surface-container rounded px-2 py-0.5"><Icon name="description" className="text-[13px] text-primary" />{f.name.length > 34 ? f.name.slice(0, 34) + '…' : f.name}</span>)}
          </div>
        )}
        {flash && <p className="text-xs text-status-rejected mt-2">{flash}</p>}
        {opening && <p className="text-xs text-primary mt-2 flex items-center gap-1"><Icon name="autorenew" className="text-[14px] animate-spin" />{opening}</p>}
        {ticketId && ticketSync && !opening && (
          <p className={`text-xs mt-2 flex items-center gap-1 ${ticketSync === 'failed' ? 'text-status-rejected' : 'text-outline'}`}>
            <Icon name={ticketSync === 'saved' ? 'cloud_done' : ticketSync === 'failed' ? 'cloud_off' : 'cloud_upload'} className="text-[14px]" />
            {ticketSync === 'saved' ? `JD1 work saved with ticket ${ticketRef || ''} — it can be reopened from the ticket` : ticketSync === 'failed' ? 'Could not save JD1 work with the ticket — press Save draft to try again' : 'Saving JD1 work with the ticket…'}
          </p>
        )}
        {sendStep && <p className="text-xs text-primary mt-2 flex items-center gap-1"><Icon name="autorenew" className="text-[14px] animate-spin" />{sendStep}</p>}
        {!backendOn() && <p className="text-xs text-outline mt-2">Connect the backend to run the JD1 assistant.</p>}
      </Card>

      {run.status !== 'idle' && run.steps.length > 0 && <JD1Progress run={run} />}

      {/* render + populated fields (half/half) — the primary review surface */}
      {files.length > 0 && (
        <Card className="p-5 mb-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Icon name="document_scanner" className="text-[18px] text-primary" />
            <h3 className="font-semibold text-sm">Document &amp; extracted fields</h3>
            <span className="text-xs text-outline">Document on the left, what the AI read on the right — edit any value to correct it, then press Save.</span>
            <div className="ml-auto flex items-center gap-2 text-xs">
              <span className="text-text-main">Insurer (auto-detected):</span>
              <select value={reviewInsurerId} onChange={(e) => setReviewInsurerId(e.target.value)} className="border border-outline-variant rounded-md px-2 py-1" title="Detected from the file name — change if wrong">
                {insurers.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
              </select>
              {(() => {
                const ins = insurers.find((i) => i.id === reviewInsurerId)
                const avail = ins ? formTypesOf(ins) : (['claim'] as FormType[])
                if (avail.length <= 1) return avail.length === 1 ? <Badge className="bg-primary/10 text-primary">{FORM_LABELS[avail[0]]}</Badge> : null
                const active = avail.includes(reviewForm) ? reviewForm : avail[0]
                return (
                  <div className="flex items-center gap-1 bg-surface-container rounded-lg p-0.5">
                    {avail.map((t) => (
                      <button key={t} onClick={() => setReviewForm(t)}
                        className={`px-2 py-1 rounded-md ${active === t ? 'bg-white text-primary shadow-sm' : 'text-text-main'}`}>{FORM_LABELS[t]}</button>
                    ))}
                  </div>
                )
              })()}
            </div>
          </div>
          <div className="flex gap-2 flex-wrap mb-3">
            {files.map((f, i) => {
              const d = detectState(f), read = docRead(f), st = bgState[f.name]
              return (
                <button key={f.name + i} onClick={() => setReviewIdx(i)} title={f.name}
                  className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 ${reviewIdx === i ? 'border-primary text-primary bg-primary/5' : 'border-outline-variant text-text-main hover:bg-surface-container'}`}>
                  <Icon name="description" className="text-[14px]" />{f.name.length > 30 ? f.name.slice(0, 30) + '…' : f.name}
                  {read ? <Icon name="check_circle" className="text-[14px] text-status-approved" />
                    : d.running ? <span className="text-[10px] text-primary tabular-nums">{d.total ? `${d.done}/${d.total}` : 'reading'}</span>
                    : st === 'failed' ? <Icon name="error" className="text-[14px] text-status-rejected" />
                    : note ? <Icon name="schedule" className="text-[14px] text-outline" /> : null}
                </button>
              )
            })}
            {ticketId && (
              <span className="text-[11px] text-outline self-center inline-flex items-center gap-1" title="The uploaded files are kept with the Inbox ticket">
                <Icon name={savedCount === files.length ? 'cloud_done' : files.some((f) => savedDocs[f.name] === 'failed') ? 'cloud_off' : 'cloud_upload'}
                  className={`text-[14px] ${savedCount === files.length ? 'text-status-approved' : files.some((f) => savedDocs[f.name] === 'failed') ? 'text-status-rejected' : 'text-primary'}`} />
                {savedCount === files.length ? `Files saved with ticket ${ticketRef || ''}` : files.some((f) => savedDocs[f.name] === 'failed') ? 'Some files could not be saved — they will be sent with JD2' : `Saving files ${savedCount}/${files.length}…`}
              </span>
            )}
            {note && files.length > 1 && (
              <span className="text-[11px] text-outline self-center">
                {unreadDocs.length ? `Reading every document for JD2 · ${files.length - unreadDocs.length} of ${files.length} done` : `All ${files.length} documents read for JD2`}
              </span>
            )}
          </div>
          {files[reviewIdx] && (() => {
            const ins = insurers.find((i) => i.id === reviewInsurerId)
            const avail = ins ? formTypesOf(ins) : (['claim'] as FormType[])
            const active = avail.includes(reviewForm) ? reviewForm : (avail[0] ?? 'claim')
            const doc = files[reviewIdx]
            return <DocReview key={reviewIdx + active + files[reviewIdx].name} file={files[reviewIdx]}
              mapFields={fieldsFor(ins, active).map((f) => ({ id: f.id, label: f.label, hint: f.aiHint, section: f.section }))}
              initialPages={pagesByFile[files[reviewIdx].name] ?? note?.page_notes?.find((fn) => fn.file === files[reviewIdx].name)?.pages}
              onSavePages={(pages) => savePageNotes(doc, pages)}
              initialFieldValues={Object.fromEntries((fieldsByFile[files[reviewIdx].name] ?? note?.required_fields?.find((ff) => ff.file === files[reviewIdx].name)?.fields ?? []).map((f) => [f.name, f.value]))}
              onUserEdit={() => setDirty(true)}
              onSaveFields={(list) => { if (!sentRef.current && filesRef.current.includes(doc)) setFieldsByFile((m) => ({ ...m, [doc.name]: list })) }} />
          })()}
        </Card>
      )}

      {/* next-step action bar */}
      {files.length > 0 && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-3 flex-wrap">
            <Icon name="bolt" className="text-primary text-[18px]" />
            <div className="text-sm font-semibold">Next step</div>
            <span className="text-xs text-outline flex-1">Fields stay editable until you send. {note ? 'Choose where this claim goes.' : 'Generate the JD1 note to enable Send to JD2.'}</span>
            <Button variant="outline" onClick={analyze} disabled={!files.length || running}>
              <Icon name={running ? 'autorenew' : 'auto_awesome'} className={`text-[16px] ${running ? 'animate-spin' : ''}`} />{running ? 'Reading…' : note ? 'Re-generate note' : 'Generate JD1 note'}
            </Button>
            {!note && dirty && <span className="text-xs text-status-pending flex items-center gap-1" title="Your edits are kept while you work and go into the note when you generate it"><Icon name="edit" className="text-[13px]" />Edits kept — generate the note to save them</span>}
            {note && (
              <div className="flex items-center gap-2">
                {dirty ? <span className="text-xs text-status-pending flex items-center gap-1"><Icon name="edit" className="text-[13px]" />Unsaved changes</span>
                  : savedAt ? <span className="text-xs text-status-approved flex items-center gap-1"><Icon name="check_circle" className="text-[13px]" />{savedAt === 'restored' ? 'Restored draft' : `Saved · ${savedAt}`}</span> : null}
                <Button variant={dirty ? 'primary' : 'outline'} onClick={saveDraft} disabled={!dirty} title="Saves the note, full-detection edits and required-field edits"><Icon name="save" className="text-[16px]" />Save all changes</Button>
                {(savedAt || dirty) && <button onClick={discardDraft} className="text-xs text-status-rejected" title="Discard the saved draft and clear the note">Discard</button>}
              </div>
            )}
            <div className="relative">
              <Button onClick={() => setMenuOpen((o) => !o)}>
                <Icon name={sending ? 'autorenew' : 'alt_route'} className={`text-[16px] ${sending ? 'animate-spin' : ''}`} />{sending ? 'Sending to JD2…' : 'Choose action'}<Icon name="expand_more" className="text-[16px]" />
              </Button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-64 bg-white border border-outline-variant rounded-lg shadow-lg z-20 overflow-hidden">
                  <button disabled={!note || sending} onClick={() => { setMenuOpen(false); sendToJD2() }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-surface-container flex items-start gap-2 disabled:opacity-40">
                    <Icon name="send" className="text-[16px] text-status-approved mt-0.5" />
                    <span><span className="font-medium block">Send to JD2</span>
                      {note && !note.header?.member_name?.value && (note.documents ?? []).every((d) => d.doc_type === 'Other') && (
                        <span className="block text-xs text-status-rejected font-medium">These files don't look like a claim (no member or claim documents found) — check before sending.</span>
                      )}
                      <span className="text-xs text-outline">{unreadDocs.length
                        ? `${unreadDocs.length} document${unreadDocs.length > 1 ? 's are' : ' is'} still being read — wait a moment so JD2 gets the page notes, or send now and read it in JD2`
                        : 'Pass the validated note, page notes and required fields for every document'}</span></span>
                  </button>
                  <button disabled={!note || mailBusy} onClick={() => { setMenuOpen(false); makeDraftMail() }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-surface-container flex items-start gap-2 border-t border-outline-variant/60 disabled:opacity-40">
                    <Icon name="mail" className="text-[16px] text-primary mt-0.5" />
                    <span><span className="font-medium block">Return to client</span><span className="text-xs text-outline">Draft an email requesting documents</span></span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* JD1 note details */}
      {note && savedAt === 'restored' && files.length === 0 && (
        <div className="flex items-center gap-2 bg-status-pending/10 rounded-lg px-3 py-2 mb-4 text-xs">
          <Icon name="history" className="text-[16px] text-status-pending" />
          <span className="text-text-main flex-1">This is a note restored from a previous session — you haven't uploaded a file this time. If it looks wrong or blank (e.g. a failed attempt), discard it and upload fresh.</span>
          <button onClick={discardDraft} className="text-status-rejected font-medium shrink-0">Discard</button>
        </div>
      )}
      <div className="space-y-4">
          {!note && !running && <p className="text-xs text-outline">The JD1 note will appear here after you generate it. The document and its extracted fields are shown above.</p>}

          {note && (<>
            <Card className="p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-status-ai/10 text-status-ai">Claim type: {note.claim_type || 'unknown'}</Badge>
                {note.provider && note.provider !== 'stub'
                  ? <Badge className="bg-status-approved/10 text-status-approved">Live AI</Badge>
                  : <Badge className="bg-on-surface-variant/10 text-on-surface-variant">Stub</Badge>}
                <span className="ml-auto flex items-center gap-2">
                  <Badge className="bg-primary/10 text-primary">{note.files_count} file(s)</Badge>
                  <Badge className="bg-status-ai/10 text-status-ai">{note.document_count} document(s)</Badge>
                </span>
              </div>
              <p className="text-xs text-outline mt-1">{note.files_count} file(s) uploaded, containing {note.document_count} distinct document(s) detected by the AI.</p>

              {/* document completeness checklist */}
              {note.checklist_required && note.checklist_required.length > 0 && (
                <div className="mt-3">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-outline mb-1.5">Document completeness</div>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                    {note.checklist_required.map((doc) => {
                      const missing = note.checklist_missing.includes(doc)
                      return (
                        <div key={doc} className="flex items-center gap-1.5 text-sm">
                          <Icon name={missing ? 'cancel' : 'check_circle'}
                            className={`text-[16px] ${missing ? 'text-status-rejected' : 'text-status-approved'}`} />
                          <span className={missing ? 'text-status-rejected' : 'text-text-main'}>{doc}</span>
                        </div>
                      )
                    })}
                  </div>
                  {note.checklist_missing.length > 0 && (
                    <p className="text-xs text-status-rejected mt-1.5">Missing {note.checklist_missing.length} required document(s) — request from client before adjudication.</p>
                  )}
                </div>
              )}

            </Card>

            {/* AI summary (adjudicator brief) */}
            {note.ai_summary && (
              <Card className="p-5 border-l-4 border-status-ai">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="auto_awesome" className="text-status-ai text-[18px]" />
                  <h3 className="font-semibold text-sm">AI summary for JD2</h3>
                </div>
                <div className="text-sm text-text-main leading-relaxed space-y-1">
                  {note.ai_summary.split('\n').filter(Boolean).map((line, i) => {
                    const [head, ...rest] = line.split(':')
                    const body = rest.join(':')
                    return body
                      ? <p key={i}><b className="text-on-surface">{head}:</b>{body}</p>
                      : <p key={i}>{line}</p>
                  })}
                </div>
              </Card>
            )}

            {/* invoices + reconciliation */}
            {note.invoices && note.invoices.count > 0 && (
              <Card className="p-5">
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  <Icon name="receipt_long" className="text-primary text-[18px]" />
                  <h3 className="font-semibold text-sm">Invoices ({note.invoices.count})</h3>
                  <Badge className={note.invoices.reconciled
                    ? 'bg-status-approved/10 text-status-approved'
                    : note.invoices.unreadable_count > 0 ? 'bg-status-pending/10 text-status-pending' : 'bg-status-rejected/10 text-status-rejected'}>
                    {note.invoices.reconciled ? 'Reconciled' : note.invoices.unreadable_count > 0 ? 'Verify amounts' : 'Mismatch'}
                  </Badge>
                </div>
                <div className="space-y-2">
                  {note.invoices.items.map((it: InvoiceItem) => {
                    const edited = it.audit && it.audit.length > 0
                    return (
                      <div key={it.id} className="border border-outline-variant/60 rounded-md p-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-text-main flex-1 truncate" title={it.description}>
                            {it.description || 'Invoice'}{it.provider ? ` · ${it.provider}` : ''}{it.date ? ` · ${it.date}` : ''}
                            {it.page ? <span className="text-outline"> · p{it.page}</span> : null}
                          </span>
                          <input value={invDraft[it.id] ?? it.amount}
                            onChange={(e) => setInvDraft((d) => ({ ...d, [it.id]: e.target.value }))}
                            onBlur={() => commitInvoiceAmount(it.id)}
                            placeholder={it.readable ? '' : 'amount not readable — enter'}
                            className={`w-40 text-sm text-right border rounded-md px-2 py-1 ${it.readable ? 'border-outline-variant' : 'border-status-pending bg-status-pending/5'}`} />
                        </div>
                        {edited && (
                          <p className="text-[11px] text-outline mt-1">
                            <Icon name="history" className="text-[12px] align-middle" /> original AI value: <b>{it.amount_original || '(blank)'}</b>
                            {' · '}edited by {it.audit[it.audit.length - 1].by} at {new Date(it.audit[it.audit.length - 1].at as string).toLocaleString()}
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="mt-3 pt-3 border-t border-outline-variant/60 text-sm space-y-1">
                  <div className="flex justify-between"><span className="text-text-main">Invoices total</span><b>{note.invoices.invoices_total || '—'}</b></div>
                  <div className="flex justify-between"><span className="text-text-main">Claim form total</span><b>{note.invoices.claim_total || '—'}</b></div>
                  <p className={`text-xs mt-1 ${note.invoices.reconciled ? 'text-status-approved' : note.invoices.unreadable_count > 0 ? 'text-status-pending' : 'text-status-rejected'}`}>{note.invoices.note}</p>
                </div>
              </Card>
            )}

            <SupportingReview supporting={note.supporting} />

            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-3">Documents in packet</h3>
              {note.documents.map((d, i) => (
                <div key={i} className="flex items-center gap-2 py-1.5 text-sm border-b border-outline-variant/40 last:border-0">
                  <Icon name="description" className="text-[16px] text-primary" />
                  <span className="truncate flex-1" title={d.name}>{d.name}</span>
                  <Badge className="bg-on-surface-variant/10 text-on-surface-variant">{d.doc_type}</Badge>
                  <Badge className={d.read_method === 'native' ? 'bg-status-approved/10 text-status-approved' : 'bg-status-pending/10 text-status-pending'}>
                    {d.read_method === 'native' ? 'digital text' : 'vision OCR'}{d.pages ? ` · ${d.pages}p` : ''}
                  </Badge>
                </div>
              ))}
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-3">Claimant Information</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {Object.keys(H_LABELS).map((k) => {
                  const f = (note.header as any)[k] as NoteField
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <label className="text-xs text-text-main w-32 shrink-0">{H_LABELS[k]}</label>
                      <input value={f.value} onChange={(e) => editField('header', k, e.target.value)}
                        className="flex-1 min-w-0 text-sm border border-outline-variant rounded-md px-2 py-1" />
                      <ConfBadge f={f} />
                    </div>
                  )
                })}
              </div>
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-1">Document Checking</h3>
              {fieldRow('section_a', note.section_a, A_LABELS)}
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-1">Claim Information</h3>
              {fieldRow('section_b', note.section_b, B_LABELS)}
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-sm">Policy Coverage Checking</h3>
                <Badge className="bg-status-pending/10 text-status-pending">JD1 flags · JD2/JD3 decide</Badge>
              </div>
              {fieldRow('section_c', note.section_c, C_LABELS)}
            </Card>

            {note.notes && <Card className="p-5"><h3 className="font-semibold text-sm mb-2">Summary</h3><p className="text-sm text-text-main leading-relaxed">{note.notes}</p></Card>}
          </>)}
      </div>

      {/* draft email to client — review-and-copy, never auto-sent */}
      {mail && (
        <div className="fixed inset-0 bg-black/40 grid place-items-center z-50 p-4" onClick={() => setMail(null)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-3">
              <Icon name="mail" className="text-primary text-[20px]" />
              <h3 className="font-semibold">Draft email to client</h3>
              <Badge className="bg-status-pending/10 text-status-pending">Draft — not sent</Badge>
              <button onClick={() => setMail(null)} className="ml-auto text-outline hover:text-text-main"><Icon name="close" /></button>
            </div>
            {mail.reason && <p className="text-xs text-outline mb-2">Suggested because: {mail.reason}</p>}
            {templates.length > 0 && (
              <div className="mb-3">
                <label className="block text-xs text-text-main mb-1">Apply a reply template</label>
                <select className="w-full text-sm border border-outline-variant rounded-md px-3 py-2"
                  onChange={(e) => {
                    const t = templates.find((x) => x.id === e.target.value); if (!t) return
                    const fill = (s: string) => (s || '')
                      .replace(/\{\{\s*member\s*\}\}/gi, note?.header.member_name.value || '')
                      .replace(/\{\{\s*claim_no\s*\}\}/gi, note?.header.claim_no.value || '')
                      .replace(/\{\{\s*insurer\s*\}\}/gi, note?.header.insurer.value || '')
                    setMail({ ...mail, subject: fill(t.subject) || mail.subject, body: fill(t.bodyEn) || mail.body })
                  }}>
                  <option value="">— choose a template —</option>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.channel ? ` (${t.channel})` : ''}</option>)}
                </select>
              </div>
            )}
            <label className="block text-xs text-text-main mb-1">Subject</label>
            <input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })}
              className="w-full text-sm border border-outline-variant rounded-md px-3 py-2 mb-3" />
            <label className="block text-xs text-text-main mb-1">Body</label>
            <textarea value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} rows={12}
              className="w-full text-sm border border-outline-variant rounded-md px-3 py-2 font-mono" />
            <div className="flex items-center gap-2 mt-3">
              <Button onClick={() => { navigator.clipboard?.writeText(`Subject: ${mail.subject}\n\n${mail.body}`); setFlash('Draft copied to clipboard.') }}>
                <Icon name="content_copy" className="text-[16px]" />Copy
              </Button>
              <Button variant="outline" onClick={() => setMail(null)}>Close</Button>
              <span className="text-xs text-outline">Review, edit, then send from your own mailbox. Ulink does not send it for you.</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function toMarkdown(n: JD1Note): string {
  const row = (label: string, f: NoteField) => `- **${label}:** ${f.value || '—'}${f.remark ? `  \n  _${f.remark}_` : ''}`
  const sec = (labels: Record<string, string>, obj: Section) => Object.keys(labels).map((k) => row(labels[k], obj[k] ?? { value: '', confidence: 0, remark: '' })).join('\n')
  return `# JD1 Process – Documents and Policy Validation

**Claim type:** ${n.claim_type}
${Object.keys(H_LABELS).map((k) => row(H_LABELS[k], (n.header as any)[k])).join('\n')}

**Documents:** ${n.documents.map((d) => `${d.name} (${d.doc_type})`).join('; ')}
**Missing mandatory:** ${n.checklist_missing.join(', ') || 'none'}

## A. Document checking
${sec(A_LABELS, n.section_a)}

## B. Claim information
${sec(B_LABELS, n.section_b)}

## C. Rule / checking (JD1 flags — JD2/JD3 decide)
${sec(C_LABELS, n.section_c)}

## Invoices & reconciliation
${n.invoices && n.invoices.count
  ? n.invoices.items.map((i) => `- ${i.description || 'Invoice'}: ${i.amount || '(amount not readable)'}${i.audit && i.audit.length ? `  \n  _original AI value: ${i.audit[0].old || '(blank)'}, corrected by ${i.audit[i.audit.length - 1].by}_` : ''}`).join('\n')
    + `\n\n**Invoices total:** ${n.invoices.invoices_total || '—'}  \n**Claim total:** ${n.invoices.claim_total || '—'}  \n**Reconciliation:** ${n.invoices.note}`
  : 'No invoices detected.'}

## Supporting documents
${n.supporting && (n.supporting.documents.length || n.supporting.checks.length)
  ? [
      ...n.supporting.checks.map((c) => `- [${c.status}] ${c.label}: ${c.detail}`),
      ...n.supporting.documents.map((d) => `- ${d.doc_type}${d.name ? ` (${d.name})` : ''}: ${d.summary}${d.flags.length ? `  \n  _flags: ${d.flags.join(', ')}_` : ''}`),
    ].join('\n')
  : 'No supporting documents analysed.'}

## AI summary (for JD2)
${n.ai_summary || ''}

## Notes
${n.notes || ''}
`
}
