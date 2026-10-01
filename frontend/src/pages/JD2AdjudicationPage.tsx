import { useEffect, useMemo, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  getJD2Queue, getJD2Item, decideJD2, updateJD2Note, deleteJD2Item, assignJD2, fetchDocBlobUrl, fetchDocFile,
  type JD2Item, type JD1Note, type NoteField, type FileNotes, type StoredDoc, type ReqField,
} from '../lib/jd1'
import type { PageDetail } from '../lib/review'
import { getRole, getUsername, getName } from '../lib/auth'
import { PageTitle, Card, Button, Badge, Icon } from '../components/ui'
import { SupportingReview } from '../components/SupportingReview'
import { DocReview } from '../components/DocReview'
import { AssignPicker } from '../components/AssignPicker'

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
  pending: { label: 'Waiting for JD2', cls: 'bg-status-pending/10 text-status-pending' },
  approved: { label: 'Approved', cls: 'bg-status-approved/10 text-status-approved' },
  partially_approved: { label: 'Partially approved', cls: 'bg-status-ai/10 text-status-ai' },
  rejected: { label: 'Rejected', cls: 'bg-status-rejected/10 text-status-rejected' },
}
const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—')

function pageNotesText(pageNotes: FileNotes[]): string {
  const parts: string[] = []
  for (const fn of pageNotes) {
    if (!fn.pages.length) continue
    parts.push(`=== ${fn.file || 'document'} ===`)
    for (const p of fn.pages) {
      const lines = [`Page ${p.page}${p.title ? ` — ${p.title}` : ''}`]
      if (p.summary) lines.push(p.summary)
      for (const it of p.items) lines.push(`${it.label}: ${it.value}`)
      for (const t of p.tables ?? []) {
        lines.push('', `[Table] ${t.title || ''}`.trim())
        if (t.columns.length) lines.push(t.columns.join(' | '))
        for (const r of t.rows) lines.push(r.join(' | '))
      }
      parts.push(lines.join('\n'))
    }
  }
  return parts.join('\n\n——————————\n\n')
}

/** One field row: editable input, or plain text once the claim is decided. */
function FieldRow({ label, f, readOnly, onChange }: { label: string; f?: NoteField; readOnly: boolean; onChange: (v: string) => void }) {
  const v = f?.value ?? ''
  return (
    <div className="py-1.5 border-b border-outline-variant/40 last:border-0">
      <div className="flex items-center gap-3">
        <span className="text-xs text-text-main w-44 shrink-0">{label}</span>
        {readOnly
          ? <span className="flex-1 min-w-0 text-sm text-on-surface break-words">{v || '—'}</span>
          : <input value={v} onChange={(e) => onChange(e.target.value)} placeholder="—"
              className="flex-1 min-w-0 text-sm border border-outline-variant rounded-md px-2 py-1 focus:border-primary outline-none" />}
      </div>
      {f?.remark && <p className="text-[11px] text-outline mt-0.5 ml-[11.75rem]">{f.remark}</p>}
    </div>
  )
}

function Section({ title, icon, children, right }: { title: string; icon: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon name={icon} className="text-primary text-[18px]" />
        <h3 className="font-semibold text-sm text-on-surface">{title}</h3>
        {right && <div className="ml-auto">{right}</div>}
      </div>
      {children}
    </Card>
  )
}

// ======================================================================================
export function JD2AdjudicationPage() {
  const { id } = useParams()
  return id ? <ClaimView id={id} /> : <QueueView />
}

// ---------------------------------- queue ---------------------------------------------
const FILTERS = [['all', 'All'], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned'], ['pending', 'Waiting'], ['decided', 'Decided']] as const

function QueueView() {
  const nav = useNavigate()
  const [queue, setQueue] = useState<JD2Item[] | null>(null)
  const [flash, setFlash] = useState('')
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const isSuper = getRole() === 'super_admin'
  const me = getUsername(), myName = getName()
  const load = () => getJD2Queue().then(setQueue).catch((e) => setFlash(String(e?.message ?? e)))
  useEffect(() => { load() }, [])

  const mine = (x: JD2Item) => (x.assignee_username ? x.assignee_username === me : x.assignee === myName)
  const items = useMemo(() => (queue ?? []).filter((x) =>
    (filter === 'all' || (filter === 'mine' && mine(x)) || (filter === 'unassigned' && !x.assignee)
      || (filter === 'pending' && x.status === 'pending') || (filter === 'decided' && x.status !== 'pending'))
    && (!q.trim() || `${x.member_name} ${x.insurer} ${x.ticket_ref ?? ''} ${x.assignee ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  ), [queue, filter, q])
  const count = (k: string) => (queue ?? []).filter((x) => k === 'all' || (k === 'mine' && mine(x)) || (k === 'unassigned' && !x.assignee)
    || (k === 'pending' && x.status === 'pending') || (k === 'decided' && x.status !== 'pending')).length

  async function remove(ids: string[]) {
    if (!window.confirm(`Delete ${ids.length} claim(s) permanently? The linked Inbox ticket is deleted too. This is recorded in the audit log.`)) return
    try { await Promise.all(ids.map((x) => deleteJD2Item(x))); setSel(new Set()); load() }
    catch (e: any) { setFlash('Delete failed: ' + (e?.message ?? 'unknown')) }
  }
  async function assign(item: JD2Item, username: string) {
    try { const up = await assignJD2(item.id, username); setQueue((qq) => (qq ?? []).map((x) => (x.id === up.id ? { ...x, assignee: up.assignee, assignee_username: up.assignee_username } : x))) }
    catch (e: any) { setFlash('Assign failed: ' + (e?.message ?? 'unknown')) }
  }

  return (
    <div>
      <PageTitle title="JD2 · Review & Approve" sub="Claims checked by JD1, waiting for the coverage decision. Open a claim to review the documents and decide." />
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="flex items-center gap-1 bg-surface-container rounded-xl p-1">
          {FILTERS.map(([k, label]) => (
            <button key={k} onClick={() => setFilter(k)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium ${filter === k ? 'bg-white text-primary shadow-sm' : 'text-text-main hover:text-primary'}`}>
              {label} <span className="text-[11px] text-outline">{queue ? count(k) : ''}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm ml-auto">
          <Icon name="search" className="text-[18px] text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Member, insurer, ticket…" className="outline-none w-52" />
        </div>
      </div>
      {flash && <p className="text-sm text-status-rejected mb-3">{flash}</p>}
      {isSuper && sel.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-surface-container/60 rounded-lg px-3 py-2">
          <span className="text-sm text-text-main">{sel.size} selected</span>
          <Button variant="outline" size="sm" onClick={() => remove([...sel])}><Icon name="delete" className="text-[16px] text-status-rejected" />Delete selected</Button>
          <button onClick={() => setSel(new Set())} className="text-xs text-outline">Clear</button>
        </div>
      )}
      {!queue && !flash && <Card className="p-8 text-center text-sm text-text-main">Loading queue…</Card>}
      {queue && items.length === 0 && (
        <Card className="p-10 text-center">
          <Icon name="inbox" className="text-[32px] text-outline" />
          <p className="text-sm text-text-main mt-2">{queue.length === 0
            ? <>Nothing in JD2 yet. In <b>JD1 · Doc Scan</b>, generate the note and choose <b>Send to JD2</b>.</>
            : 'No claims match this filter.'}</p>
        </Card>
      )}
      {items.length > 0 && (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
              <tr>
                {isSuper && <th className="pl-4 py-3 w-8"><input type="checkbox" checked={sel.size === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((x) => x.id)) : new Set())} /></th>}
                <th className="px-4 py-3 font-semibold">Member</th>
                <th className="px-4 py-3 font-semibold">Insurer</th>
                <th className="px-4 py-3 font-semibold">Amount</th>
                <th className="px-4 py-3 font-semibold">Assigned to</th>
                <th className="px-4 py-3 font-semibold">Sent by</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-2 py-3 w-16"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((x) => (
                <tr key={x.id} onClick={() => nav(`/jd2/${x.id}`)} className="border-t border-outline-variant hover:bg-primary/[0.03] cursor-pointer">
                  {isSuper && <td className="pl-4" onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(x.id)} onChange={() => setSel((s) => { const n = new Set(s); n.has(x.id) ? n.delete(x.id) : n.add(x.id); return n })} /></td>}
                  <td className="px-4 py-3"><div className="font-semibold text-primary">{x.member_name || '—'}</div>
                    <div className="text-[11px] text-outline">{x.ticket_ref || '—'} · {x.claim_type || 'claim'}</div></td>
                  <td className="px-4 py-3 text-text-main">{x.insurer || '—'}</td>
                  <td className="px-4 py-3 text-text-main whitespace-nowrap">{x.claim_amount || '—'}</td>
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <AssignPicker compact value={x.assignee_username} currentName={x.assignee} disabled={x.status !== 'pending'} onChange={(u) => assign(x, u)} />
                  </td>
                  <td className="px-4 py-3 text-xs text-text-main">{x.handed_by || '—'}<div className="text-outline">{fmtDate(x.created_at)}</div></td>
                  <td className="px-4 py-3"><Badge className={STATUS_META[x.status]?.cls}>{STATUS_META[x.status]?.label}</Badge></td>
                  <td className="px-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    {isSuper && <button onClick={() => remove([x.id])} title="Delete claim" className="w-8 h-8 rounded-lg inline-grid place-items-center text-status-rejected hover:bg-status-rejected/10"><Icon name="delete" className="text-[17px]" /></button>}
                    <Icon name="chevron_right" className="text-primary align-middle" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------- one claim -----------------------------------------
type Tab = 'overview' | 'documents' | 'fields' | 'checks' | 'decision'

function ClaimView({ id }: { id: string }) {
  const nav = useNavigate()
  const loc = useLocation() as { state?: { justSent?: boolean; failed?: string[] } }
  const qc = useQueryClient()
  const [item, setItem] = useState<JD2Item | null>(null)
  const [draft, setDraft] = useState<JD1Note | null>(null)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reasons, setReasons] = useState('')
  const [flash, setFlash] = useState('')
  const [ok, setOk] = useState(loc.state?.justSent ? 'Sent to JD2. The Inbox ticket is now “Ready for review”.' : '')
  const [tab, setTab] = useState<Tab>('overview')
  const [ver, setVer] = useState(0)   // bumps on Discard so the document viewer reloads the saved notes
  const isSuper = getRole() === 'super_admin'

  useEffect(() => {
    setItem(null); setFlash(''); setDirty(false)
    getJD2Item(id).then((it) => { setItem(it); setDraft(it.note); setReasons(it.reasons || '') }).catch((e) => setFlash(String(e?.message ?? e)))
  }, [id])
  useEffect(() => {   // warn before leaving with unsaved edits
    const h = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = '' } }
    window.addEventListener('beforeunload', h); return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  if (!item || !draft) return <Card className="p-8 text-center text-sm text-text-main">{flash || 'Loading claim…'}</Card>
  const decided = item.status !== 'pending'
  const n = draft
  const pageFiles = (n.page_notes || []).filter((fn) => fn.pages.length)
  const fieldFiles = (n.required_fields || []).filter((ff) => ff.fields.length)

  function change(mut: (d: JD1Note) => void) {
    if (decided) return
    setDraft((d) => { if (!d) return d; const c: JD1Note = structuredClone(d); mut(c); return c })
    setDirty(true); setOk('')
  }
  const setField = (sec: 'header' | 'section_b' | 'section_c', key: string, value: string) =>
    change((c) => { const s = c[sec] as any; s[key] = { ...(s[key] ?? { confidence: 0, remark: '' }), value } })
  function setPages(file: string, pages: PageDetail[]) {
    const cur = (draft?.page_notes || []).find((fn) => fn.file === file)?.pages ?? []
    if (decided || JSON.stringify(cur) === JSON.stringify(pages)) return   // nothing changed (e.g. viewer just opened)
    change((c) => {
      const list = c.page_notes ? [...c.page_notes] : []
      const i = list.findIndex((fn) => fn.file === file)
      if (i >= 0) list[i] = { file, pages }; else list.push({ file, pages })
      c.page_notes = list
    })
  }
  const setReqField = (file: string, idx: number, value: string) =>
    change((c) => { const ff = (c.required_fields || []).find((x) => x.file === file); if (ff) ff.fields[idx] = { ...ff.fields[idx], value } })

  async function save() {
    if (!item || !draft) return
    setSaving(true); setFlash('')
    try { const up = await updateJD2Note(item.id, draft); setItem(up); setDraft(up.note); setDirty(false); setOk('Changes saved.'); qc.invalidateQueries({ queryKey: ['claims'] }) }
    catch (e: any) { setFlash('Save failed: ' + (e?.message ?? 'unknown')) }
    finally { setSaving(false) }
  }
  function discard() { if (item) { setDraft(item.note); setDirty(false); setVer((v) => v + 1) } }
  async function decide(decision: 'approve' | 'partial' | 'reject') {
    if (!item) return
    if (decision !== 'approve' && !reasons.trim()) { setFlash('Please write the reasons / deductions first.'); return }
    if (!window.confirm(`Record the decision “${decision === 'approve' ? 'Approve' : decision === 'partial' ? 'Partially approve' : 'Reject'}”? The claim becomes read-only afterwards.`)) return
    setBusy(true); setFlash('')
    try {
      if (dirty) { const up = await updateJD2Note(item.id, draft!); setDraft(up.note); setDirty(false) }
      const up = await decideJD2(item.id, decision, reasons); setItem(up); setOk('Decision recorded. The Inbox ticket was updated.')
      qc.invalidateQueries({ queryKey: ['claims'] })
    } catch (e: any) { setFlash('Decision failed: ' + (e?.message ?? 'unknown')) }
    finally { setBusy(false) }
  }
  async function reassign(username: string) {
    if (!item) return
    try { const up = await assignJD2(item.id, username); setItem({ ...item, assignee: up.assignee, assignee_username: up.assignee_username }); qc.invalidateQueries({ queryKey: ['claims'] }) }
    catch (e: any) { setFlash('Assign failed: ' + (e?.message ?? 'unknown')) }
  }
  async function remove() {
    if (!item || !window.confirm('Delete this claim permanently? The linked Inbox ticket is deleted too. This is recorded in the audit log.')) return
    try { await deleteJD2Item(item.id); qc.invalidateQueries({ queryKey: ['claims'] }); nav('/jd2') }
    catch (e: any) { setFlash('Delete failed: ' + (e?.message ?? 'unknown')) }
  }
  function downloadNotes() {
    const blob = new Blob([pageNotesText(n.page_notes || [])], { type: 'text/plain' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob)
    a.download = `Full_Detection_${(item!.member_name || 'claim').replace(/\s+/g, '_')}.txt`; a.click()
  }

  const TABS: [Tab, string, string, number | null][] = [
    ['overview', 'Overview', 'dashboard', null],
    ['documents', 'Documents & full detection', 'description', item.attachments?.length ?? 0],
    ['fields', 'Required fields', 'checklist', fieldFiles.reduce((a, f) => a + f.fields.length, 0)],
    ['checks', 'Invoices & checks', 'receipt_long', n.invoices?.count ?? 0],
    ['decision', decided ? 'Decision' : 'Coverage & decision', 'gavel', null],
  ]

  return (
    <div>
      <button onClick={() => nav('/jd2')} className="flex items-center gap-1 text-sm text-text-main mb-3 hover:text-primary">
        <Icon name="arrow_back" className="text-[18px]" /> JD2 queue
      </button>

      {/* header */}
      <Card className="p-4 mb-3">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center shrink-0"><Icon name="gavel" /></div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="font-display text-xl font-bold text-primary">{item.member_name || 'Claim'}</h1>
              <Badge className={STATUS_META[item.status]?.cls}>{STATUS_META[item.status]?.label}</Badge>
              {item.insurer && <Badge className="bg-surface-container text-text-main">{item.insurer}</Badge>}
              {item.claim_type && <Badge className="bg-surface-container text-text-main capitalize">{item.claim_type}</Badge>}
            </div>
            <div className="text-sm text-text-main mt-0.5">
              <b>{item.claim_amount || '—'}</b>
              <span className="text-outline"> · Ticket {item.ticket_ref || '—'} · from JD1 {item.handed_by || '—'} · {fmtDate(item.created_at)}</span>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <AssignPicker value={item.assignee_username} currentName={item.assignee} disabled={decided} onChange={reassign} />
            {item.ticket_id && <Button variant="outline" size="sm" onClick={() => nav('/inbox')} title="See this claim's ticket in the Inbox"><Icon name="inbox" className="text-[16px]" />Inbox</Button>}
            {isSuper && <Button variant="ghost" size="sm" onClick={remove}><Icon name="delete" className="text-[16px] text-status-rejected" />Delete</Button>}
          </div>
        </div>
      </Card>

      {loc.state?.failed && loc.state.failed.length > 0 && (
        <div className="mb-3 text-xs bg-status-pending/10 text-text-main rounded-lg px-3 py-2 flex gap-2">
          <Icon name="warning" className="text-[16px] text-status-pending" />
          <span>These documents could not be attached: {loc.state.failed.join(', ')}. The note and the other files arrived.</span>
        </div>
      )}

      {/* save bar */}
      <div className="sticky top-0 z-10 mb-3">
        {decided ? (
          <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2 text-xs text-text-main">
            <Icon name="lock" className="text-[16px] text-outline" />Decided by {item.decided_by || '—'} · {fmtDate(item.decided_at)} — this claim is read-only.
          </div>
        ) : (
          <div className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${dirty ? 'bg-status-pending/10' : 'bg-surface-container/70'}`}>
            <Icon name={dirty ? 'edit' : 'edit_note'} className={`text-[16px] ${dirty ? 'text-status-pending' : 'text-primary'}`} />
            <span className="flex-1 text-text-main">{dirty ? 'You have unsaved changes.' : 'Everything JD1 found is below — edit any value, then save. Decide on the last tab.'}</span>
            {dirty && <button onClick={discard} className="text-outline hover:underline">Discard</button>}
            <Button size="sm" onClick={save} disabled={!dirty || saving}><Icon name="save" className="text-[15px]" />{saving ? 'Saving…' : 'Save changes'}</Button>
          </div>
        )}
        {ok && <p className="text-xs text-status-approved mt-1 flex items-center gap-1"><Icon name="check_circle" className="text-[14px]" />{ok}</p>}
        {flash && <p className="text-xs text-status-rejected mt-1">{flash}</p>}
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 mb-3 bg-surface-container rounded-xl p-1 w-fit flex-wrap">
        {TABS.map(([k, label, icon, cnt]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium flex items-center gap-1.5 ${tab === k ? 'bg-white text-primary shadow-sm' : 'text-text-main hover:text-primary'}`}>
            <Icon name={icon} className="text-[16px]" />{label}{cnt != null && <span className="text-[11px] text-outline">{cnt}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="space-y-3">
          {n.ai_summary && (
            <Section title="AI summary from JD1" icon="auto_awesome">
              <div className="text-sm text-text-main leading-relaxed space-y-1">
                {n.ai_summary.split('\n').filter(Boolean).map((line, i) => {
                  const [head, ...rest] = line.split(':'); const body = rest.join(':')
                  return body && head.length < 40 ? <p key={i}><b className="text-on-surface">{head}:</b>{body}</p> : <p key={i}>{line}</p>
                })}
              </div>
            </Section>
          )}
          {(n.checklist_required?.length ?? 0) > 0 && (
            <Section title="Required documents" icon="fact_check"
              right={n.checklist_missing.length ? <Badge className="bg-status-rejected/10 text-status-rejected">{n.checklist_missing.length} missing</Badge> : <Badge className="bg-status-approved/10 text-status-approved">All present</Badge>}>
              <div className="flex flex-wrap gap-1.5">
                {n.checklist_required.map((d) => {
                  const miss = n.checklist_missing.includes(d)
                  return <span key={d} className={`text-xs px-2 py-1 rounded-full flex items-center gap-1 ${miss ? 'bg-status-rejected/10 text-status-rejected' : 'bg-status-approved/10 text-status-approved'}`}>
                    <Icon name={miss ? 'cancel' : 'check_circle'} className="text-[14px]" />{d}</span>
                })}
              </div>
            </Section>
          )}
          <div className="grid lg:grid-cols-2 gap-3">
            <Section title="Claimant" icon="person">
              {Object.keys(H_LABELS).map((k) => <FieldRow key={k} label={H_LABELS[k]} f={(n.header as any)[k]} readOnly={decided} onChange={(v) => setField('header', k, v)} />)}
            </Section>
            <Section title="Claim" icon="medical_information">
              {Object.keys(B_LABELS).map((k) => <FieldRow key={k} label={B_LABELS[k]} f={n.section_b[k]} readOnly={decided} onChange={(v) => setField('section_b', k, v)} />)}
            </Section>
          </div>
        </div>
      )}

      {tab === 'documents' && (
        <DocumentsTab key={ver} item={item} note={n} decided={decided} onPages={setPages} onDownloadNotes={downloadNotes} pageFiles={pageFiles} />
      )}

      {tab === 'fields' && (
        <div className="space-y-3">
          {fieldFiles.length === 0 && <Card className="p-6 text-sm text-text-main text-center">JD1 did not open <b>Required fields</b> for these documents, so there is nothing here. The claim details are on the Overview tab.</Card>}
          {fieldFiles.map((ff) => <RequiredFields key={ff.file} file={ff.file} fields={ff.fields} readOnly={decided} onChange={(i, v) => setReqField(ff.file, i, v)} />)}
        </div>
      )}

      {tab === 'checks' && (
        <div className="space-y-3">
          {n.invoices && n.invoices.count > 0 ? (
            <Section title={`Invoices (${n.invoices.count})`} icon="receipt_long"
              right={<Badge className={n.invoices.reconciled ? 'bg-status-approved/10 text-status-approved' : n.invoices.unreadable_count > 0 ? 'bg-status-pending/10 text-status-pending' : 'bg-status-rejected/10 text-status-rejected'}>
                {n.invoices.reconciled ? 'Reconciled' : n.invoices.unreadable_count > 0 ? 'Amounts unverified' : 'Mismatch'}</Badge>}>
              <table className="w-full text-sm">
                <thead className="text-xs text-outline text-left"><tr><th className="py-1">Invoice</th><th>Provider</th><th>Date</th><th className="text-right">Amount</th></tr></thead>
                <tbody>
                  {n.invoices.items.map((it) => (
                    <tr key={it.id} className="border-t border-outline-variant/40">
                      <td className="py-1.5 pr-2">{it.description || 'Invoice'}{it.audit?.length ? <Badge className="ml-1 bg-status-ai/10 text-status-ai">edited by JD1</Badge> : null}</td>
                      <td className="pr-2 text-text-main">{it.provider || '—'}</td>
                      <td className="pr-2 text-text-main">{it.date || '—'}</td>
                      <td className="text-right font-medium tabular-nums">{it.amount || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="mt-3 pt-3 border-t border-outline-variant/60 text-sm space-y-1">
                <div className="flex justify-between"><span className="text-text-main">Invoices total</span><b>{n.invoices.invoices_total || '—'}</b></div>
                <div className="flex justify-between"><span className="text-text-main">Claim form total</span><b>{n.invoices.claim_total || '—'}</b></div>
                <p className={`text-xs ${n.invoices.reconciled ? 'text-status-approved' : 'text-status-pending'}`}>{n.invoices.note}</p>
              </div>
            </Section>
          ) : <Card className="p-5 text-sm text-text-main">No invoices were listed by JD1.</Card>}
          <SupportingReview supporting={n.supporting} />
        </div>
      )}

      {tab === 'decision' && (
        <div className="grid lg:grid-cols-2 gap-3 items-start">
          <Section title="Policy coverage checking" icon="policy" right={<Badge className="bg-status-pending/10 text-status-pending">JD2 decides</Badge>}>
            {Object.keys(C_LABELS).map((k) => <FieldRow key={k} label={C_LABELS[k]} f={n.section_c[k]} readOnly={decided} onChange={(v) => setField('section_c', k, v)} />)}
          </Section>
          <Card className="p-5 border-l-4 border-primary">
            <div className="flex items-center gap-2 mb-2"><Icon name="gavel" className="text-primary text-[20px]" /><h3 className="font-semibold text-sm">JD2 decision</h3></div>
            {n.checklist_missing.length > 0 && <div className="text-xs text-status-rejected mb-2">JD1 flagged missing: {n.checklist_missing.join(', ')}</div>}
            <label className="block text-xs text-text-main mb-1">Reasons / deductions</label>
            <textarea value={reasons} onChange={(e) => setReasons(e.target.value)} rows={6} disabled={decided}
              placeholder="e.g. Approved. Deduct supplement item (Livopat). Non-covered drugs excluded…"
              className="w-full text-sm border border-outline-variant rounded-md px-3 py-2 disabled:bg-surface-container" />
            {!decided ? (
              <div className="flex gap-2 mt-3 flex-wrap">
                <Button onClick={() => decide('approve')} disabled={busy}><Icon name="check" className="text-[16px]" />Approve</Button>
                <Button variant="outline" onClick={() => decide('partial')} disabled={busy}>Partially approve</Button>
                <Button variant="ghost" onClick={() => decide('reject')} disabled={busy} className="text-status-rejected">Reject</Button>
              </div>
            ) : (
              <div className="mt-3 text-sm">
                <div className="flex items-center gap-2"><Icon name="check_circle" className="text-status-approved text-[18px]" /><span className="font-semibold">{STATUS_META[item.status]?.label}</span></div>
                <p className="text-xs text-outline mt-1">Decided by {item.decided_by || '—'} · {fmtDate(item.decided_at)}</p>
              </div>
            )}
            <p className="text-[11px] text-outline mt-2">Partial and reject need a reason. Unsaved edits are saved together with the decision.</p>
          </Card>
        </div>
      )}
    </div>
  )
}

/** Documents tab: pick a file → the same viewer JD1 used (page preview + page-by-page notes),
 *  showing JD1's saved notes. It never starts AI reading by itself, so opening it costs nothing. */
function DocumentsTab({ item, note, decided, onPages, onDownloadNotes, pageFiles }: {
  item: JD2Item; note: JD1Note; decided: boolean; pageFiles: FileNotes[]
  onPages: (file: string, pages: PageDetail[]) => void; onDownloadNotes: () => void
}) {
  const docs = item.attachments ?? []
  const [selId, setSelId] = useState(docs[0]?.id ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [err, setErr] = useState('')
  const sel = docs.find((d) => d.id === selId)
  useEffect(() => {
    if (!sel) return
    let alive = true; setFile(null); setErr('')
    fetchDocFile(item.id, sel).then((f) => { if (alive) setFile(f) }).catch((e) => { if (alive) setErr(String(e?.message ?? e)) })
    return () => { alive = false }
  }, [selId])
  async function open(d: StoredDoc, download: boolean) {
    try {
      const { url, revoke } = await fetchDocBlobUrl(item.id, d.id)
      if (download) { const a = document.createElement('a'); a.href = url; a.download = d.name; document.body.appendChild(a); a.click(); a.remove() }
      else window.open(url, '_blank', 'noopener')
      setTimeout(revoke, 60_000)
    } catch (e: any) { setErr(String(e?.message ?? e)) }
  }
  const notesOnly = pageFiles.filter((fn) => !docs.some((d) => d.name === fn.file))
  return (
    <div className="space-y-3">
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {docs.length === 0 && <span className="text-sm text-text-main">No document files were attached to this claim.</span>}
          {docs.map((d) => {
            const hasNotes = pageFiles.some((fn) => fn.file === d.name)
            return (
              <div key={d.id} className={`flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${d.id === selId ? 'border-primary bg-primary/5' : 'border-outline-variant'}`}>
                <button onClick={() => setSelId(d.id)} className={`flex items-center gap-1 ${d.id === selId ? 'text-primary font-semibold' : 'text-text-main'}`} title={d.name}>
                  <Icon name="description" className="text-[15px]" />{d.name.length > 34 ? d.name.slice(0, 34) + '…' : d.name}
                  <span className="text-outline font-normal">{d.size ? `· ${(d.size / 1024 / 1024).toFixed(1)} MB` : ''}{hasNotes ? ' · notes' : ''}</span>
                </button>
                <button onClick={() => open(d, false)} title="Open in a new tab" className="text-primary ml-1"><Icon name="open_in_new" className="text-[15px]" /></button>
                <button onClick={() => open(d, true)} title="Download" className="text-primary"><Icon name="download" className="text-[15px]" /></button>
              </div>
            )
          })}
          {pageFiles.length > 0 && <button onClick={onDownloadNotes} className="ml-auto text-xs text-primary flex items-center gap-1"><Icon name="download" className="text-[15px]" />All page notes (.txt)</button>}
        </div>
        {note.documents.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2 items-center">
            <span className="text-[11px] uppercase tracking-wide text-outline mr-1">Detected</span>
            {note.documents.map((d, i) => <Badge key={i} className="bg-surface-container text-text-main">{d.doc_type}</Badge>)}
          </div>
        )}
      </Card>
      {err && <Card className="p-3 text-xs text-status-rejected">{err}</Card>}
      {sel && !file && !err && <Card className="p-8 text-center text-sm text-text-main"><Icon name="autorenew" className="text-[16px] animate-spin align-middle mr-1" />Opening {sel.name}…</Card>}
      {sel && file && (
        <Card className="p-4">
          <DocReview key={sel.id} file={file} autoDetect={false} readOnly={decided}
            initialPages={pageFiles.find((fn) => fn.file === sel.name)?.pages}
            savedLabel={decided ? 'Read-only' : 'Press “Save changes” to keep edits'}
            onSavePages={(pages) => onPages(sel.name, pages)} />
        </Card>
      )}
      {notesOnly.map((fn) => (
        <Card key={fn.file} className="p-4">
          <div className="text-sm font-semibold mb-2">{fn.file} <span className="text-xs text-outline font-normal">· notes only (file not attached)</span></div>
          <pre className="text-xs whitespace-pre-wrap text-text-main max-h-96 overflow-auto">{pageNotesText([fn])}</pre>
        </Card>
      ))}
    </div>
  )
}

function RequiredFields({ file, fields, readOnly, onChange }: { file: string; fields: ReqField[]; readOnly: boolean; onChange: (i: number, v: string) => void }) {
  const groups: [string, { f: ReqField; i: number }[]][] = []
  fields.forEach((f, i) => {
    const sec = f.section || 'Fields'
    const g = groups.find(([s]) => s === sec)
    if (g) g[1].push({ f, i }); else groups.push([sec, [{ f, i }]])
  })
  const filled = fields.filter((f) => f.value.trim()).length
  return (
    <Section title={file} icon="checklist" right={<span className="text-xs text-outline">{filled} of {fields.length} filled</span>}>
      <div className="grid lg:grid-cols-2 gap-x-8">
        {groups.map(([sec, list]) => (
          <div key={sec} className="mb-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-primary/70 pt-1 pb-0.5">{sec}</div>
            {list.map(({ f, i }) => (
              <div key={i} className="flex items-center gap-3 py-1 border-b border-outline-variant/40 last:border-0">
                <span className="text-xs text-text-main w-44 shrink-0">{f.name}</span>
                {readOnly
                  ? <span className="flex-1 text-sm">{f.value || '—'}</span>
                  : <input value={f.value} onChange={(e) => onChange(i, e.target.value)} placeholder="not found"
                      className={`flex-1 min-w-0 text-sm border rounded-md px-2 py-1 outline-none focus:border-primary ${f.value.trim() ? 'border-outline-variant' : 'border-status-pending/60 bg-status-pending/5'}`} />}
                <span className="text-[10px] text-outline w-8 text-right">{f.page ? `p${f.page + 1}` : ''}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </Section>
  )
}
