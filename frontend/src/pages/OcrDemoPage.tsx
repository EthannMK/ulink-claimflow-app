import { useState } from 'react'
import Tesseract from 'tesseract.js'
import { PageTitle, Card, Button, Badge, Icon } from '../components/ui'
import { confidenceCls } from '../lib/format'

// ---------- config (would come from backend, per insurer + claim type) ----------
type Item = { type: string; mandatory: boolean }
type Field = { key: string; demo: string; match?: 'policy' | 'amount' | 'date'; conf: number }

const CHECKLISTS: Record<string, Item[]> = {
  'New claim (reimbursement)': [
    { type: 'Claim form', mandatory: true },
    { type: 'Invoice / bill', mandatory: true },
    { type: 'Medical report', mandatory: true },
    { type: 'ID copy', mandatory: true },
    { type: 'Referral letter', mandatory: false },
  ],
  'LOG request': [
    { type: 'LOG / pre-authorization form', mandatory: true },
    { type: 'Medical report', mandatory: true },
    { type: 'ID copy', mandatory: true },
    { type: 'Cost estimate', mandatory: false },
  ],
}
const INSURER_FIELDS: Record<string, Field[]> = {
  'AYA Sompo': [
    { key: 'Claimant name', demo: 'Thein Nyunt', conf: 0.93 },
    { key: 'NRC / Passport', demo: '9/xxx(N)xxxxxx', conf: 0.78 },
    { key: 'Policy number', demo: 'AYA/YGN/AYH/25000366', match: 'policy', conf: 0.9 },
    { key: 'Policy holder', demo: 'CARE International', conf: 0.86 },
    { key: 'Product', demo: 'AYA Health Insurance', conf: 0.88 },
    { key: 'Type of patient', demo: 'Inpatient', conf: 0.9 },
    { key: 'Treatment date', demo: '2026-05-31', match: 'date', conf: 0.84 },
    { key: 'Hospital', demo: '', conf: 0.55 },
    { key: 'Diagnosis', demo: '', conf: 0.5 },
    { key: 'Claimed amount', demo: '', match: 'amount', conf: 0.7 },
  ],
  'MGEN': [
    { key: 'Member name', demo: 'Sithu Shwe Ba', conf: 0.92 },
    { key: 'Policy number', demo: 'MG-100234', match: 'policy', conf: 0.9 },
    { key: 'Employer', demo: 'Norwegian Refugee Council', conf: 0.85 },
    { key: 'Date of birth', demo: '1990-05-22', conf: 0.8 },
    { key: 'Contact number', demo: '09-xxxxxxxxx', conf: 0.82 },
    { key: 'Email', demo: '', conf: 0.6 },
    { key: 'Treatment date', demo: '2026-05-19', match: 'date', conf: 0.84 },
    { key: 'Hospital', demo: '', conf: 0.55 },
    { key: 'Diagnosis', demo: '', conf: 0.5 },
    { key: 'Claimed amount', demo: '', match: 'amount', conf: 0.7 },
  ],
}
const INSURERS = Object.keys(INSURER_FIELDS)

function classify(t: string): string {
  const s = t.toLowerCase()
  if (/(letter of guarantee|guarantee|pre-?auth|\blog\b)/.test(s)) return 'LOG / pre-authorization form'
  if (/(claim form|claim notification|reimbursement|claim submission)/.test(s)) return 'Claim form'
  if (/(invoice|receipt|\bbill\b|\btotal\b|charges|amount due)/.test(s)) return 'Invoice / bill'
  if (/(diagnosis|discharge|medical|doctor|hospital|treatment|physician)/.test(s)) return 'Medical report'
  if (/(nrc|passport|national registration|identity card)/.test(s)) return 'ID copy'
  if (/referral/.test(s)) return 'Referral letter'
  if (/(estimate|estimated cost)/.test(s)) return 'Cost estimate'
  return 'Other / unclassified'
}
function scan(text: string) {
  return {
    amounts: text.match(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g) ?? [],
    dates: text.match(/\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b/g) ?? [],
    policies: text.match(/\b[A-Z]{2,5}\/[A-Z0-9\/]{3,}\b|\b[A-Z]{2,4}[-\/]?\d{4,}\b/g) ?? [],
  }
}
async function pdfToImages(file: File, onStage: (s: string) => void): Promise<string[]> {
  const pdfjs: any = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const n = Math.min(pdf.numPages, 6); const imgs: string[] = []
  for (let i = 1; i <= n; i++) {
    onStage(`Rendering ${file.name} — page ${i}/${n}…`)
    const page = await pdf.getPage(i); const vp = page.getViewport({ scale: 2 })
    const c = document.createElement('canvas'); c.width = vp.width; c.height = vp.height
    await page.render({ canvasContext: c.getContext('2d')!, viewport: vp }).promise
    imgs.push(c.toDataURL('image/png'))
  }
  return imgs
}
const isPdf = (f: File) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')

interface DocResult { name: string; type: string; confidence: number }
const STEPS = ['Received', 'Documents checked', 'Data extracted', 'Summary ready', 'JD1 review']

export function OcrDemoPage() {
  const [insurer, setInsurer] = useState('AYA Sompo')
  const [claimType, setClaimType] = useState('New claim (reimbursement)')
  const [files, setFiles] = useState<File[]>([])
  const [running, setRunning] = useState(false)
  const [stage, setStage] = useState(''); const [progress, setProgress] = useState(0)
  const [docs, setDocs] = useState<DocResult[] | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [draft, setDraft] = useState('')
  const [flash, setFlash] = useState('')

  async function analyze() {
    if (!files.length) return
    setRunning(true); setDocs(null); setProgress(0); setFlash('')
    const results: DocResult[] = []; let allText = ''
    try {
      for (let fi = 0; fi < files.length; fi++) {
        const f = files[fi]
        const images = isPdf(f) ? await pdfToImages(f, setStage) : [URL.createObjectURL(f)]
        let text = ''; const confs: number[] = []
        for (let i = 0; i < images.length; i++) {
          setStage(`Reading ${f.name} — page ${i + 1}/${images.length}…`)
          const res: any = await Tesseract.recognize(images[i], 'eng', {
            logger: (m: any) => { if (m.status === 'recognizing text') setProgress(Math.round(((fi + (i + m.progress) / images.length) / files.length) * 100)) },
          })
          text += (res.data.text || '') + '\n'; confs.push(res.data.confidence ?? 0)
        }
        allText += text + '\n'
        results.push({ name: f.name, type: classify(text), confidence: Math.round(confs.reduce((a, b) => a + b, 0) / Math.max(1, confs.length)) })
      }
      // seed insurer fields, overlay any OCR hits
      const found = scan(allText); const seeded: Record<string, string> = {}
      INSURER_FIELDS[insurer].forEach((f) => {
        let v = f.demo
        if (f.match === 'policy' && found.policies[0]) v = found.policies[0]
        if (f.match === 'amount' && found.amounts[0]) v = found.amounts[0] + ' MMK'
        if (f.match === 'date' && found.dates[0]) v = found.dates[0]
        seeded[f.key] = v
      })
      setValues(seeded); setDocs(results)
      const missing = CHECKLISTS[claimType].filter((c) => c.mandatory && !new Set(results.map((r) => r.type)).has(c.type))
      const who = seeded['Claimant name'] || seeded['Member name'] || 'Member'
      setDraft(`Dear ${who},\n\nThank you for your claim submission. To continue processing, please send us the following document(s):\n- ${missing.map((m) => m.type).join('\n- ')}\n\nOnce received, we will proceed with your claim.\n\nBest regards,\nUlink Assist`)
    } catch (e: any) {
      setFlash('OCR failed: ' + (e?.message ?? 'unknown error'))
    } finally { setRunning(false); setStage('') }
  }

  const checklist = CHECKLISTS[claimType]
  const foundTypes = new Set((docs ?? []).map((d) => d.type))
  const missingMandatory = checklist.filter((c) => c.mandatory && !foundTypes.has(c.type))
  const complete = docs !== null && missingMandatory.length === 0
  const who = values['Claimant name'] || values['Member name'] || 'the member'
  const summary = docs ? `${values['Type of patient'] || 'Reimbursement'} claim for ${who} — policy ${values['Policy number'] || '—'} (${insurer}). `
    + `${docs.length} document(s) uploaded; ${missingMandatory.length} mandatory document(s) missing. `
    + `Claimed amount: ${values['Claimed amount'] || '—'}.` : ''

  return (
    <div>
      <PageTitle title="Claim Intake AI" sub="Upload a claim's documents. The AI counts them, checks the checklist, extracts the fields, summarizes, and suggests the next step — ready for JD1 to confirm." />

      {docs && (
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full ${i < 4 ? 'bg-status-approved/10 text-status-approved' : 'bg-status-ai/10 text-status-ai'}`}>
                <Icon name={i < 4 ? 'check_circle' : 'radio_button_checked'} className="text-[14px]" />{s}
              </span>
              {i < STEPS.length - 1 && <Icon name="chevron_right" className="text-[16px] text-outline" />}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {/* upload */}
        <Card className="col-span-4 p-5 h-fit">
          <h3 className="font-semibold text-sm mb-2">1. Insurer</h3>
          <select value={insurer} onChange={(e) => setInsurer(e.target.value)} className="w-full text-sm border border-outline-variant rounded-md px-2 py-2 mb-3">
            {INSURERS.map((k) => <option key={k}>{k}</option>)}
          </select>
          <h3 className="font-semibold text-sm mb-2">2. Claim type</h3>
          <select value={claimType} onChange={(e) => setClaimType(e.target.value)} className="w-full text-sm border border-outline-variant rounded-md px-2 py-2 mb-3">
            {Object.keys(CHECKLISTS).map((k) => <option key={k}>{k}</option>)}
          </select>
          <h3 className="font-semibold text-sm mb-2">3. Upload documents</h3>
          <label className="border-2 border-dashed border-outline-variant rounded-lg p-6 text-center block cursor-pointer hover:bg-surface-container/50">
            <Icon name="upload_file" className="text-[28px] text-outline" />
            <div className="text-sm text-text-main mt-1">Choose one or more images / PDFs</div>
            <input type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => { setFiles(Array.from(e.target.files ?? [])); setDocs(null) }} />
          </label>
          {files.map((f) => <div key={f.name} className="text-xs flex items-center gap-2 mt-2"><Icon name="description" className="text-[15px] text-primary" />{f.name}</div>)}
          <div className="mt-4"><Button onClick={analyze}>{running ? 'Analyzing…' : 'Analyze documents'}</Button></div>
          {running && <p className="text-xs text-text-main mt-2">{stage} {progress > 0 && `(${progress}%)`}</p>}
          {flash && <p className="text-xs text-status-rejected mt-2">{flash}</p>}
          <p className="text-xs text-outline mt-2">Front-end demo. The backend classifies and extracts far more accurately with a vision model.</p>
        </Card>

        {/* results */}
        <div className="col-span-8 space-y-4">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Document checklist</h3>
              {docs && <span className="text-xs text-text-main">{docs.length} uploaded · {foundTypes.size} type(s) recognised</span>}
            </div>
            {checklist.map((c) => {
              const has = foundTypes.has(c.type)
              return (
                <div key={c.type} className="flex items-center gap-2 py-1.5 text-sm border-b border-outline-variant/40 last:border-0">
                  <Icon name={has ? 'check_circle' : (c.mandatory ? 'cancel' : 'remove_circle')} className={`text-[18px] ${has ? 'text-status-approved' : (c.mandatory ? 'text-status-rejected' : 'text-outline')}`} />
                  <span className={has ? 'text-on-surface' : 'text-text-main'}>{c.type}</span>
                  <Badge className={c.mandatory ? 'bg-status-rejected/10 text-status-rejected' : 'bg-on-surface-variant/10 text-on-surface-variant'}>{c.mandatory ? 'Mandatory' : 'Optional'}</Badge>
                  <span className="ml-auto text-xs">{has ? <span className="text-status-approved">Submitted</span> : <span className="text-text-main">Missing</span>}</span>
                </div>
              )
            })}
          </Card>

          {docs && (
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-3">Extracted claim data <span className="text-status-ai font-normal">· AI ({insurer})</span> — JD1 can edit</h3>
              <div className="grid grid-cols-2 gap-3">
                {INSURER_FIELDS[insurer].map((f) => (
                  <div key={f.key}>
                    <label className="block text-xs text-text-main mb-1">{f.key}</label>
                    <div className="flex items-center gap-2">
                      <input value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                        className="flex-1 text-sm border border-outline-variant rounded-md px-2 py-1" />
                      <Badge className={confidenceCls(f.conf)}>{Math.round(f.conf * 100)}%</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {docs && (
            <Card className="p-5">
              <h3 className="font-semibold text-sm mb-2">Claim summary</h3>
              <p className="text-sm text-text-main leading-relaxed">{summary}</p>
            </Card>
          )}

          {docs && (
            <Card className="p-5 border-l-4 border-primary">
              <div className="flex items-center gap-2 mb-2"><Icon name="smart_toy" className="text-status-ai text-[20px]" /><h3 className="font-semibold text-sm">AI-suggested next step</h3></div>
              {complete ? (
                <>
                  <p className="text-sm text-on-surface mb-3">All mandatory documents are present. Confirm the data above and pass the claim to JD2 for data entry &amp; adjudication.</p>
                  <Button onClick={() => setFlash('Claim confirmed and passed to JD2. ✓')}>Confirm data &amp; pass to JD2</Button>
                </>
              ) : (
                <>
                  <p className="text-sm text-on-surface mb-2">Missing mandatory: <b>{missingMandatory.map((m) => m.type).join(', ')}</b>. Draft below to request them (JD1 can edit before sending).</p>
                  <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={6} className="w-full text-sm border border-outline-variant rounded-md px-3 py-2 font-sans" />
                  <div className="flex gap-2 mt-3">
                    <Button onClick={() => setFlash('Request for missing documents sent to the member. ✓')}>Send request to member</Button>
                    <Button variant="outline" onClick={() => setFlash('Draft saved.')}>Save draft</Button>
                  </div>
                </>
              )}
              {flash && <p className="text-sm text-status-approved mt-3">{flash}</p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
