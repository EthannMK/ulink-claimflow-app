import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { runJD1, handoffToJD2, draftClientMail, reconcileInvoices,
  type JD1Note, type NoteField, type Section, type InvoiceItem, type DraftMail } from '../lib/jd1'
import { backendOn, getName } from '../lib/auth'
import { PageTitle, Card, Button, Badge, Icon } from '../components/ui'
import { DocReview } from '../components/DocReview'
import { usePersistent } from '../lib/persist'
import { DEFAULT_INSURERS, FORM_LABELS, formTypesOf, fieldsFor, type InsurerConfig, type FormType } from '../lib/insurers'
import { confidenceCls } from '../lib/format'

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

function ConfBadge({ f }: { f: NoteField }) {
  const has = (f?.value ?? '').trim() !== ''
  return has
    ? <Badge className={confidenceCls(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
    : <Badge className="bg-on-surface-variant/10 text-on-surface-variant">—</Badge>
}

export function JD1ReviewPage() {
  const nav = useNavigate()
  const [files, setFiles] = useState<File[]>([])
  const [note, setNote] = useState<JD1Note | null>(null)
  const [running, setRunning] = useState(false)
  const [sending, setSending] = useState(false)
  const [flash, setFlash] = useState('')
  const [reviewIdx, setReviewIdx] = useState(0)
  const [insurers] = usePersistent<InsurerConfig[]>('settings.insurers.v3', DEFAULT_INSURERS)
  const [reviewInsurerId, setReviewInsurerId] = useState(insurers[0]?.id ?? '')
  const [reviewForm, setReviewForm] = useState<FormType>('claim')
  const [mail, setMail] = useState<DraftMail | null>(null)
  const [mailBusy, setMailBusy] = useState(false)
  const [invDraft, setInvDraft] = useState<Record<string, string>>({})
  const [menuOpen, setMenuOpen] = useState(false)
  const [templates] = usePersistent<{ id: string; name: string; channel: string; subject: string; bodyEn: string; bodyMm: string }[]>('settings.templates', [])

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
  }, [note])

  async function sendToJD2() {
    if (!note) return
    setSending(true); setFlash('')
    try { const item = await handoffToJD2(note); nav(`/jd2/${item.id}`) }
    catch (e: any) { setFlash('Send to JD2 failed: ' + (e?.message ?? 'unknown')) }
    finally { setSending(false) }
  }

  async function analyze() {
    if (!files.length) return
    setRunning(true); setFlash(''); setNote(null)
    try {
      if (!backendOn()) { setFlash('Backend is off — start the API and set VITE_USE_MOCKS=false to run the JD1 assistant.'); return }
      const n = await runJD1(files)
      setNote(n)
      if (n.notes && n.provider !== 'stub' && /error|HTTP \d/i.test(n.notes)) setFlash(n.notes)
    } catch (e: any) { setFlash('JD1 failed: ' + (e?.message ?? 'unknown')) }
    finally { setRunning(false) }
  }

  function editField(sec: 'section_a' | 'section_b' | 'section_c' | 'header', key: string, value: string) {
    if (!note) return
    const copy: any = structuredClone(note)
    copy[sec][key] = { ...copy[sec][key], value }
    setNote(copy)
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
    it.readable = /\d/.test(draft)
    copy.invoices = reconcileInvoices(copy.invoices)
    setNote(copy)
  }

  async function makeDraftMail() {
    if (!note) return
    setMailBusy(true); setFlash('')
    try { setMail(await draftClientMail(note)) }
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
              className="flex-1 text-sm border border-outline-variant rounded-md px-2 py-1" />
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
            <span className="text-text-main">{files.length ? 'Change files' : 'Upload claim packet (PDFs & images)'}</span>
            <input type="file" multiple accept="image/*,application/pdf" className="hidden"
              onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setNote(null); setReviewIdx(0) }} />
          </label>
          {files.length > 0 && <span className="text-xs text-outline">{files.length} file(s)</span>}
          <div className="flex-1" />
          <Button onClick={analyze} disabled={!files.length || running}>{running ? 'Reading packet…' : note ? 'Re-generate JD1 note' : 'Generate JD1 note'}</Button>
        </div>
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {files.map((f) => <span key={f.name} className="text-xs flex items-center gap-1 bg-surface-container rounded px-2 py-0.5"><Icon name="description" className="text-[13px] text-primary" />{f.name.length > 34 ? f.name.slice(0, 34) + '…' : f.name}</span>)}
          </div>
        )}
        {running && <p className="text-xs text-text-main mt-2">Reading the packet — classifying documents and drafting the note…</p>}
        {flash && <p className="text-xs text-status-rejected mt-2">{flash}</p>}
        {!backendOn() && <p className="text-xs text-outline mt-2">Connect the backend to run the JD1 assistant.</p>}
      </Card>

      {/* render + populated fields (half/half) — the primary review surface */}
      {files.length > 0 && (
        <Card className="p-5 mb-4">
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <Icon name="document_scanner" className="text-[18px] text-primary" />
            <h3 className="font-semibold text-sm">Document &amp; extracted fields</h3>
            <span className="text-xs text-outline">Rendering on the left, populated fields on the right — hover to highlight, edit to correct.</span>
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
            {files.map((f, i) => (
              <button key={f.name + i} onClick={() => setReviewIdx(i)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1 ${reviewIdx === i ? 'border-primary text-primary bg-primary/5' : 'border-outline-variant text-text-main hover:bg-surface-container'}`}>
                <Icon name="description" className="text-[14px]" />{f.name.length > 30 ? f.name.slice(0, 30) + '…' : f.name}
              </button>
            ))}
          </div>
          {files[reviewIdx] && (() => {
            const ins = insurers.find((i) => i.id === reviewInsurerId)
            const avail = ins ? formTypesOf(ins) : (['claim'] as FormType[])
            const active = avail.includes(reviewForm) ? reviewForm : (avail[0] ?? 'claim')
            return <DocReview key={reviewIdx + active + files[reviewIdx].name} file={files[reviewIdx]}
              mapFields={fieldsFor(ins, active).map((f) => ({ id: f.id, label: f.label, hint: f.aiHint, section: f.section }))} />
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
            <div className="relative">
              <Button onClick={() => setMenuOpen((o) => !o)}>
                <Icon name="alt_route" className="text-[16px]" />Choose action<Icon name="expand_more" className="text-[16px]" />
              </Button>
              {menuOpen && (
                <div className="absolute right-0 mt-1 w-64 bg-white border border-outline-variant rounded-lg shadow-lg z-20 overflow-hidden">
                  <button disabled={!note || sending} onClick={() => { setMenuOpen(false); sendToJD2() }}
                    className="w-full text-left px-3 py-2.5 text-sm hover:bg-surface-container flex items-start gap-2 disabled:opacity-40">
                    <Icon name="send" className="text-[16px] text-status-approved mt-0.5" />
                    <span><span className="font-medium block">Send to JD2</span><span className="text-xs text-outline">Pass the validated note for adjudication</span></span>
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
      <div className="space-y-4">
          {!note && !running && <p className="text-xs text-outline">The JD1 note will appear here after you generate it. The document and its extracted fields are shown above.</p>}

          {note && (<>
            <Card className="p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-status-ai/10 text-status-ai">Claim type: {note.claim_type || 'unknown'}</Badge>
                {note.provider === 'gemini'
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
              <h3 className="font-semibold text-sm mb-3">Header</h3>
              <div className="grid grid-cols-2 gap-x-4 gap-y-2">
                {Object.keys(H_LABELS).map((k) => {
                  const f = (note.header as any)[k] as NoteField
                  return (
                    <div key={k} className="flex items-center gap-2">
                      <label className="text-xs text-text-main w-32 shrink-0">{H_LABELS[k]}</label>
                      <input value={f.value} onChange={(e) => editField('header', k, e.target.value)}
                        className="flex-1 text-sm border border-outline-variant rounded-md px-2 py-1" />
                      <ConfBadge f={f} />
                    </div>
                  )
                })}
              </div>
              {note.header.ias_note && (
                <div className="mt-3 text-xs bg-surface-container rounded-md p-3">
                  <b className="text-text-main">iAS check:</b> <span className="text-text-main">{note.header.ias_note}</span>
                </div>
              )}
            </Card>

            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-1">A · Document checking</h3>
              {fieldRow('section_a', note.section_a, A_LABELS)}
            </Card>
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-1">B · Claim information</h3>
              {fieldRow('section_b', note.section_b, B_LABELS)}
            </Card>
            <Card className="p-5">
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-semibold text-sm">C · Rule checking</h3>
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

_iAS check: ${n.header.ias_note || '—'}_

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

## AI summary (for JD2)
${n.ai_summary || ''}

## Notes
${n.notes || ''}
`
}
