import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { runJD1, handoffToJD2, type JD1Note, type NoteField, type Section } from '../lib/jd1'
import { backendOn } from '../lib/auth'
import { PageTitle, Card, Button, Badge, Icon } from '../components/ui'
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

      <div className="grid grid-cols-12 gap-4">
        {/* upload */}
        <Card className="col-span-4 p-5 h-fit">
          <h3 className="font-semibold text-sm mb-2">Claim packet</h3>
          <label className="border-2 border-dashed border-outline-variant rounded-lg p-6 text-center block cursor-pointer hover:bg-surface-container/50">
            <Icon name="upload_file" className="text-[28px] text-outline" />
            <div className="text-sm text-text-main mt-1">Choose all documents for one claim</div>
            <div className="text-xs text-outline">PDFs & images — forms, reports, invoices, ID</div>
            <input type="file" multiple accept="image/*,application/pdf" className="hidden"
              onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setNote(null) }} />
          </label>
          {files.map((f) => <div key={f.name} className="text-xs flex items-center gap-2 mt-2"><Icon name="description" className="text-[15px] text-primary" />{f.name}</div>)}
          <div className="mt-4"><Button onClick={analyze}>{running ? 'Reading packet…' : 'Generate JD1 note'}</Button></div>
          {running && <p className="text-xs text-text-main mt-2">Classifying, reading digital + scanned pages, drafting the note… (can take up to a minute)</p>}
          {flash && <p className="text-xs text-status-rejected mt-2">{flash}</p>}
          {backendOn()
            ? <p className="text-xs text-status-approved mt-2 flex items-center gap-1"><Icon name="verified" className="text-[14px]" />Live AI — vision model reads scanned & Burmese pages.</p>
            : <p className="text-xs text-outline mt-2">Connect the backend to run the JD1 assistant.</p>}
        </Card>

        {/* results */}
        <div className="col-span-8 space-y-4">
          {!note && <Card className="p-8 text-center text-sm text-text-main">Upload a claim packet and generate the JD1 note to see it here.</Card>}

          {note && (<>
            <Card className="p-5">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge className="bg-status-ai/10 text-status-ai">Claim type: {note.claim_type || 'unknown'}</Badge>
                {note.provider === 'gemini'
                  ? <Badge className="bg-status-approved/10 text-status-approved">Live AI</Badge>
                  : <Badge className="bg-on-surface-variant/10 text-on-surface-variant">Stub</Badge>}
                <span className="text-xs text-text-main ml-auto">{note.documents.length} document(s)</span>
              </div>
              {note.checklist_missing.length > 0 && (
                <div className="mt-3 flex items-start gap-2 text-sm text-status-rejected">
                  <Icon name="warning" className="text-[18px]" />
                  <span>Missing mandatory: <b>{note.checklist_missing.join(', ')}</b></span>
                </div>
              )}
              <div className="mt-4 pt-3 border-t border-outline-variant/60 flex items-center gap-3 flex-wrap">
                <Button onClick={sendToJD2} disabled={sending || note.provider === 'stub'}>
                  <Icon name="send" className="text-[16px]" />{sending ? 'Sending…' : 'Approve & send to JD2'}
                </Button>
                <span className="text-xs text-outline">Confirm the fields above, then pass the validated note to JD2 for adjudication.</span>
              </div>
            </Card>

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
      </div>
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

## Summary
${n.notes || ''}
`
}
