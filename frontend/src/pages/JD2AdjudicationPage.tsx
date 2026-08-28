import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getJD2Queue, getJD2Item, decideJD2, type JD2Item, type NoteField, type Section } from '../lib/jd1'
import { PageTitle, Card, Button, Badge, Icon } from '../components/ui'
import { confidenceCls } from '../lib/format'

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
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-main w-52 shrink-0">{label}</span>
        <span className="flex-1 text-sm text-on-surface">{has ? f.value : '—'}</span>
        {has
          ? <Badge className={confidenceCls(f.confidence)}>{Math.round(f.confidence * 100)}%</Badge>
          : <Badge className="bg-on-surface-variant/10 text-on-surface-variant">—</Badge>}
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

  useEffect(() => {
    setFlash('')
    if (id) { getJD2Item(id).then((it) => { setItem(it); setReasons(it.reasons || '') }).catch((e) => setFlash(String(e?.message ?? e))) }
    else { getJD2Queue().then(setQueue).catch((e) => setFlash(String(e?.message ?? e))) }
  }, [id])

  async function decide(decision: 'approve' | 'partial' | 'reject') {
    if (!item) return
    setBusy(true); setFlash('')
    try { const updated = await decideJD2(item.id, decision, reasons); setItem(updated) }
    catch (e: any) { setFlash('Decision failed: ' + (e?.message ?? 'unknown')) }
    finally { setBusy(false) }
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

      <div className="grid grid-cols-12 gap-4">
        {/* JD1 note (read-only) */}
        <div className="col-span-7 space-y-4">
          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-3">JD1 note — claim information (B)</h3>
            {Object.keys(B_LABELS).map((k) => roRow(B_LABELS[k], (n.section_b as Section)[k]))}
          </Card>
          <Card className="p-5">
            <div className="flex items-center gap-2 mb-2">
              <h3 className="font-semibold text-sm">JD1 flags — rule checking (C)</h3>
              <Badge className="bg-status-pending/10 text-status-pending">JD2 decides</Badge>
            </div>
            {Object.keys(C_LABELS).map((k) => roRow(C_LABELS[k], (n.section_c as Section)[k]))}
          </Card>
          {n.header.ias_note && (
            <Card className="p-4 text-xs text-text-main"><b>iAS check (JD1):</b> {n.header.ias_note}</Card>
          )}
        </div>

        {/* decision panel */}
        <div className="col-span-5 space-y-4">
          <Card className="p-5 border-l-4 border-primary">
            <div className="flex items-center gap-2 mb-2"><Icon name="gavel" className="text-primary text-[20px]" /><h3 className="font-semibold text-sm">JD2 decision</h3></div>
            {n.checklist_missing.length > 0 && (
              <div className="text-xs text-status-rejected mb-2">JD1 flagged missing: {n.checklist_missing.join(', ')}</div>
            )}
            <label className="block text-xs text-text-main mb-1">Reasons / deductions</label>
            <textarea value={reasons} onChange={(e) => setReasons(e.target.value)} rows={5} disabled={decided}
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
            <p className="text-xs text-outline mt-3">POC: JD2 records the decision. Coverage rules, deductions and the Table of Benefits plug in here once available.</p>
          </Card>

          <Card className="p-5">
            <h3 className="font-semibold text-sm mb-2">Packet ({n.documents.length})</h3>
            {n.documents.map((d, i) => (
              <div key={i} className="flex items-center gap-2 py-1 text-xs border-b border-outline-variant/40 last:border-0">
                <Icon name="description" className="text-[14px] text-primary" />
                <span className="truncate flex-1" title={d.name}>{d.name}</span>
                <Badge className="bg-on-surface-variant/10 text-on-surface-variant">{d.doc_type}</Badge>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  )
}
