import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getJD2Queue, getJD2Item, decideJD2, updateJD2Note, fetchDocBlobUrl, type JD2Item, type JD1Note, type NoteField } from '../lib/jd1'
import { PageTitle, Card, Button, Badge, Icon } from '../components/ui'
import { SupportingReview } from '../components/SupportingReview'
import { confidenceCls } from '../lib/format'

const H_LABELS: Record<string, string> = {
  member_name: 'Member name', insurer: 'Insurer', claim_date: 'Claim date', company: 'Company / employer',
  nrc_passport: 'NRC / Passport', total_claim_amount: 'Total claim amount', treatment_date: 'Treatment date', claim_no: 'Claim no.',
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
const STATUS_META: Record<string, { label: string; cls: string }> = {
  pending: { label: 'Pending JD2', cls: 'bg-status-pending/10 text-status-pending' },
  approved: { label: 'Approved', cls: 'bg-status-approved/10 text-status-approved' },
  partially_approved: { label: 'Partial', cls: 'bg-status-ai/10 text-status-ai' },
  rejected: { label: 'Rejected', cls: 'bg-status-rejected/10 text-status-rejected' },
}

function roRow(label: string, f: NoteField) {
  const has = (f?.value ?? '').trim() !== ''
  return (
    <div key={label} className="py-1.5 border-b border-outline-variant/40 last:border-0">
      <div className="flex items-start gap-2">
        <span className="text-xs text-text-main w-40 shrink-0 pt-0.5">{label}</span>
        <span className="flex-1 min-w-0 text-sm text-on-surface break-words">{has ? f.value : '—'}</span>
        {has
          ? <Badge className={`shrink-0 ${confidenceCls(f.confidence)}`}>{Math.round(f.confidence * 100)}%</Badge>
          : <Badge className="shrink-0 bg-on-surface-variant/10 text-on-surface-variant">—</Badge>}
      </div>
      {f?.remark && <p className="text-xs text-outline mt-0.5 pl-1">{f.remark}</p>}
    </div>
  )
}

export function JD2AdjudicationPage() {
  const { id } = useParams()
  const nav = useNavigate()
  const [queue, setQueue] = useState<JD2Item[] | null>(null)
  const [item, setItem] = useState<JD2Item | null>(null)
  const [reasons, setReasons] = useState('')
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState('')
  const [draft, setDraft] = useState<JD1Note | null>(null)
  const [noteDirty, setNoteDirty] = useState(false)
  const [savingNote, setSavingNote] = useState(false)

  useEffect(() => {
    setFlash(''); setNoteDirty(false)
    if (id) { getJD2Item(id).then((it) => { setItem(it); setDraft(it.note); setReasons(it.reasons || '') }).catch((e) => setFlash(String(e?.message ?? e))) }
    else { getJD2Queue().then(setQueue).catch((e) => setFlash(String(e?.message ?? e))) }
  }, [id])

  function editJD2(sec: 'header' | 'section_b' | 'section_c', key: string, value: string) {
    setDraft((d) => { if (!d) return d; const c: any = structuredClone(d); c[sec][key] = { ...c[sec][key], value }; return c })
    setNoteDirty(true)
  }
  async function saveNote() {
    if (!item || !draft) return
    setSavingNote(true); setFlash('')
    try { const updated = await updateJD2Note(item.id, draft); setItem(updated); setDraft(updated.note); setNoteDirty(false) }
    catch (e: any) { setFlash('Save failed: ' + (e?.message ?? 'unknown')) }
    finally { setSavingNote(false) }
  }

  async function decide(decision: 'approve' | 'partial' | 'reject') {
    if (!item) return
    setBusy(true); setFlash('')
    try { const updated = await decideJD2(item.id, decision, reasons); setItem(updated); setDraft(updated.note); setNoteDirty(false) }
    catch (e: any) { setFlash('Decision failed: ' + (e?.message ?? 'unknown')) }
    finally { setBusy(false) }
  }

  async function previewDoc(docId: string) {
    if (!item) return
    try { const { url } = await fetchDocBlobUrl(item.id, docId); window.open(url, '_blank', 'noopener') }
    catch (e: any) { setFlash('Could not open document: ' + (e?.message ?? 'unknown')) }
  }
  async function downloadDoc(docId: string, name: string) {
    if (!item) return
    try {
      const { url, revoke } = await fetchDocBlobUrl(item.id, docId)
      const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(revoke, 5000)
    } catch (e: any) { setFlash('Could not download: ' + (e?.message ?? 'unknown')) }
  }

  // ---- queue view ----
  if (!id) {
    return (
      <div>
        <PageTitle title="JD2 · Adjudication" sub="Claims validated by JD1, waiting for the coverage decision. Open one to review the JD1 note and decide." />
        {flash && <p className="text-sm text-status-rejected mb-3">{flash}</p>}
        {!queue && <Card className="p-8 text-center text-sm text-text-main">Loading queue…</Card>}
        {queue && queue.length === 0 && (
          <Card className="p-10 text-center">
            <Icon name="inbox" className="text-[32px] text-outline" />
            <p className="text-sm text-text-main mt-2">Nothing in the JD2 queue yet. Complete a note in <b>JD1 · Intake & Validation</b> and click <b>Approve &amp; send to JD2</b>.</p>
          </Card>
        )}
        {queue && queue.length > 0 && (
          <Card className="p-0 overflow-hidden">
            <div className="grid grid-cols-12 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-outline bg-surface-container">
              <div className="col-span-3">Member</div><div className="col-span-2">Insurer</div>
              <div className="col-span-2">Type</div><div className="col-span-2">Amount</div>
              <div className="col-span-2">Status</div><div className="col-span-1"></div>
            </div>
            {queue.map((q) => (
              <button key={q.id} onClick={() => nav(`/jd2/${q.id}`)}
                className="grid grid-cols-12 px-4 py-3 text-sm items-center w-full text-left border-b border-outline-variant/40 last:border-0 hover:bg-surface-container/50">
                <div className="col-span-3 font-medium truncate">{q.member_name || '—'}</div>
                <div className="col-span-2 text-text-main truncate">{q.insurer || '—'}</div>
                <div className="col-span-2 text-text-main">{q.claim_type || '—'}</div>
                <div className="col-span-2 text-text-main">{q.claim_amount || '—'}</div>
                <div className="col-span-2"><Badge className={STATUS_META[q.status]?.cls}>{STATUS_META[q.status]?.label}</Badge></div>
                <div className="col-span-1 text-right text-primary"><Icon name="chevron_right" /></div>
              </button>
            ))}
          </Card>
        )}
      </div>
    )
  }

  // ---- single item view ----
  if (!item) return <Card className="p-8 text-center text-sm text-text-main">{flash || 'Loading…'}</Card>
  const n = item.note
  const decided = item.status !== 'pending'
  const amount = item.claim_amount || '—'
  const src = draft ?? n
  const edRow = (sec: 'header' | 'section_b' | 'section_c', key: string, label: string) => {
    const f = (src[sec] as any)[key] as NoteField
    if (decided) return roRow(label, f)
    const has = (f?.value ?? '').trim() !== ''
    return (
      <div key={label} className="py-1.5 border-b border-outline-variant/40 last:border-0">
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-main w-40 shrink-0">{label}</span>
          <input value={f?.value ?? ''} onChange={(e) => editJD2(sec, key, e.target.value)}
            className="flex-1 min-w-0 text-sm border border-outline-variant rounded-md px-2 py-1" />
          {has ? <Badge className={`shrink-0 ${confidenceCls(f.confidence)}`}>{Math.round(f.confidence * 100)}%</Badge>
            : <Badge className="shrink-0 bg-on-surface-variant/10 text-on-surface-variant">—</Badge>}
        </div>
        {f?.remark && <p className="text-xs text-outline mt-0.5 pl-1">{f.remark}</p>}
      </div>
    )
  }
  return (
    <div>
      <button onClick={() => nav('/jd2')} className="flex items-center gap-1 text-sm text-text-main mb-3 hover:text-primary">
        <Icon name="arrow_back" className="text-[18px]" /> Back to JD2 queue
      </button>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <h1 className="font-display text-2xl font-bold text-primary">JD2 Adjudication</h1>
        <Badge className="bg-status-approved/10 text-status-approved">{item.insurer || 'Insurer'}</Badge>
        <Badge className={STATUS_META[item.status]?.cls}>{STATUS_META[item.status]?.label}</Badge>
        <span className="text-sm text-text-main">{item.member_name} · {amount}</span>
        <span className="text-xs text-outline ml-auto">From JD1: {item.handed_by || '—'}</span>
      </div>

      <div className="space-y-4">
        {!decided && (
          <div className="flex items-center gap-2 bg-surface-container/60 rounded-lg px-3 py-2">
            <Icon name="edit_note" className="text-primary text-[18px]" />
            <span className="text-xs text-text-main flex-1">{noteDirty ? 'You have unsaved edits to this claim.' : 'You can edit any field before deciding. Work through the steps below, then record your decision.'}</span>
            <Button variant="outline" size="sm" onClick={saveNote} disabled={!noteDirty || savingNote}><Icon name="save" className="text-[15px]" />{savingNote ? 'Saving…' : 'Save changes'}</Button>
          </div>
        )}

        {/* Step 1 — AI summary */}
        {n.ai_summary && (
          <Card className="p-5 border-l-4 border-status-ai">
            <div className="flex items-center gap-2 mb-2">
              <Badge className="bg-status-ai/10 text-status-ai">Step 1</Badge>
              <Icon name="auto_awesome" className="text-status-ai text-[18px]" />
              <h3 className="font-semibold text-sm">AI summary from JD1</h3>
            </div>
            <div className="text-sm text-text-main leading-relaxed space-y-1">
              {n.ai_summary.split('\n').filter(Boolean).map((line, i) => {
                const [head, ...rest] = line.split(':'); const body = rest.join(':')
                return body ? <p key={i}><b className="text-on-surface">{head}:</b>{body}</p> : <p key={i}>{line}</p>
              })}
            </div>
          </Card>
        )}

        {/* Step 2 — Claimant Information */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3"><Badge className="bg-primary/10 text-primary">Step 2</Badge><h3 className="font-semibold text-sm">Claimant Information</h3></div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-0">
            {Object.keys(H_LABELS).map((k) => edRow('header', k, H_LABELS[k]))}
          </div>
        </Card>

        {/* Step 3 — Claim Information */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-3"><Badge className="bg-primary/10 text-primary">Step 3</Badge><h3 className="font-semibold text-sm">Claim Information</h3></div>
          <div>
            {Object.keys(B_LABELS).map((k) => edRow('section_b', k, B_LABELS[k]))}
          </div>
        </Card>

        {/* Step 4 — Invoices & reconciliation */}
        {n.invoices && n.invoices.count > 0 && (
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-3 flex-wrap">
              <Badge className="bg-primary/10 text-primary">Step 4</Badge>
              <Icon name="receipt_long" className="text-primary text-[18px]" />
              <h3 className="font-semibold text-sm">Invoices ({n.invoices.count})</h3>
              <Badge className={n.invoices.reconciled ? 'bg-status-approved/10 text-status-approved'
                : n.invoices.unreadable_count > 0 ? 'bg-status-pending/10 text-status-pending' : 'bg-status-rejected/10 text-status-rejected'}>
                {n.invoices.reconciled ? 'Reconciled' : n.invoices.unreadable_count > 0 ? 'Amounts unverified' : 'Mismatch'}
              </Badge>
            </div>
            {n.invoices.items.map((it) => (
              <div key={it.id} className="flex items-center gap-2 py-1.5 text-sm border-b border-outline-variant/40 last:border-0">
                <span className="flex-1 min-w-0 truncate" title={it.description}>{it.description || 'Invoice'}{it.provider ? ` · ${it.provider}` : ''}</span>
                <span className="font-medium shrink-0">{it.amount || '—'}</span>
                {it.audit && it.audit.length > 0 && (
                  <Badge className="bg-status-ai/10 text-status-ai shrink-0">edited</Badge>
                )}
              </div>
            ))}
            <div className="mt-3 pt-3 border-t border-outline-variant/60 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-text-main">Invoices total</span><b>{n.invoices.invoices_total || '—'}</b></div>
              <div className="flex justify-between"><span className="text-text-main">Claim form total</span><b>{n.invoices.claim_total || '—'}</b></div>
              <p className={`text-xs mt-1 ${n.invoices.reconciled ? 'text-status-approved' : n.invoices.unreadable_count > 0 ? 'text-status-pending' : 'text-status-rejected'}`}>{n.invoices.note}</p>
            </div>
          </Card>
        )}

        {/* Step 5 — Supporting-document intelligence */}
        <SupportingReview supporting={n.supporting} step="Step 5" />

        {/* Step 6 — Documents */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2"><Badge className="bg-primary/10 text-primary">Step 6</Badge><h3 className="font-semibold text-sm">Uploaded documents ({item.attachments?.length ?? 0})</h3></div>
          {(!item.attachments || item.attachments.length === 0) ? (
            <p className="text-xs text-outline">No files were attached to this handoff.</p>
          ) : item.attachments.map((a) => (
            <div key={a.id} className="flex items-center gap-2 py-1.5 text-sm border-b border-outline-variant/40 last:border-0">
              <Icon name="description" className="text-[16px] text-primary shrink-0" />
              <span className="truncate flex-1 min-w-0" title={a.name}>{a.name}</span>
              <span className="text-xs text-outline shrink-0">{a.size ? `${Math.max(1, Math.round(a.size / 1024))} KB` : ''}</span>
              <button onClick={() => previewDoc(a.id)} className="text-primary flex items-center gap-0.5 shrink-0" title="Preview in new tab"><Icon name="visibility" className="text-[16px]" />Preview</button>
              <button onClick={() => downloadDoc(a.id, a.name)} className="text-primary flex items-center gap-0.5 shrink-0" title="Download"><Icon name="download" className="text-[16px]" />Download</button>
            </div>
          ))}
          {n.documents.length > 0 && (
            <div className="mt-3 pt-3 border-t border-outline-variant/60">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-outline mb-1">Document types detected</div>
              <div className="flex flex-wrap gap-1.5">
                {n.documents.map((d, i) => <Badge key={i} className="bg-on-surface-variant/10 text-on-surface-variant">{d.doc_type}</Badge>)}
              </div>
            </div>
          )}
        </Card>

        {/* Step 6 — Policy Coverage Checking */}
        <Card className="p-5">
          <div className="flex items-center gap-2 mb-2"><Badge className="bg-primary/10 text-primary">Step 7</Badge><h3 className="font-semibold text-sm">Policy Coverage Checking</h3><Badge className="bg-status-pending/10 text-status-pending">JD2 decides</Badge></div>
          <div>
            {Object.keys(C_LABELS).map((k) => edRow('section_c', k, C_LABELS[k]))}
          </div>
        </Card>

        {/* Step 7 — Decision */}
        <Card className="p-5 border-l-4 border-primary">
          <div className="flex items-center gap-2 mb-2"><Badge className="bg-primary/10 text-primary">Step 8</Badge><Icon name="gavel" className="text-primary text-[20px]" /><h3 className="font-semibold text-sm">JD2 decision</h3></div>
          {n.checklist_missing.length > 0 && (
            <div className="text-xs text-status-rejected mb-2">JD1 flagged missing: {n.checklist_missing.join(', ')}</div>
          )}
          <label className="block text-xs text-text-main mb-1">Reasons / deductions</label>
          <textarea value={reasons} onChange={(e) => setReasons(e.target.value)} rows={4} disabled={decided}
            placeholder="e.g. Approved. Deduct supplement item (Livopat). Non-covered psychiatric drugs excluded…"
            className="w-full text-sm border border-outline-variant rounded-md px-3 py-2 disabled:bg-surface-container" />
          {!decided ? (
            <div className="flex gap-2 mt-3">
              <Button onClick={() => decide('approve')} disabled={busy}>Approve</Button>
              <Button variant="outline" onClick={() => decide('partial')} disabled={busy}>Partial</Button>
              <Button variant="ghost" onClick={() => decide('reject')} disabled={busy}>Reject</Button>
            </div>
          ) : (
            <div className="mt-3 text-sm">
              <div className="flex items-center gap-2"><Icon name="check_circle" className="text-status-approved text-[18px]" />
                <span className="font-semibold">{STATUS_META[item.status]?.label}</span></div>
              <p className="text-xs text-outline mt-1">Decided by {item.decided_by || '—'}{item.decided_at ? ` · ${new Date(item.decided_at).toLocaleString()}` : ''}</p>
              <div className="mt-3"><Button variant="outline" size="sm" onClick={() => nav('/jd2')}>Back to queue</Button></div>
            </div>
          )}
          {flash && <p className="text-xs text-status-rejected mt-2">{flash}</p>}
        </Card>
      </div>
    </div>
  )
}
