import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { getClaim } from '../lib/api'
import { Card, Badge, Icon, Button } from '../components/ui'
import { DeleteTicketButton } from '../components/DeleteTicketButton'
import { AssignPicker } from '../components/AssignPicker'
import { assignTicket, ticketDocUrl, getJD1Draft, type JD1Note } from '../lib/jd1'
import { backendOn } from '../lib/auth'
import { categoryMeta, statusMeta } from '../lib/format'
import type { Claim } from '../lib/types'

const DECIDED = ['approved', 'partially_approved', 'rejected', 'closed']
const when = (iso?: string | null) => iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''

/** The ticket's real progress, from what has actually happened to it. */
function progressOf(c: Claim, draft: JD1Note | null) {
  return [
    { label: 'Received', done: true, info: when(c.receivedAt) },
    { label: 'Documents saved', done: c.documents.length > 0, info: c.documents.length ? `${c.documents.length} file(s)` : 'No files kept with this ticket' },
    { label: 'Scanned in JD1', done: !!(c.jd1_saved_at || draft), info: c.jd1_saved_at ? `${when(c.jd1_saved_at)}${c.jd1_saved_by ? ` · ${c.jd1_saved_by}` : ''}` : draft ? 'JD1 note saved' : 'JD1 note not saved with this ticket' },
    { label: 'Sent to JD2', done: !!c.jd2_item_id, info: c.jd2_item_id ? 'With the JD2 adjudicator' : 'Not sent yet' },
    { label: 'Decided', done: DECIDED.includes(c.status), info: DECIDED.includes(c.status) ? statusMeta[c.status].label : 'Waiting for JD2' },
  ]
}
function replyFor(c: Claim, missing: string[]) {
  const name = c.memberName && c.memberName !== '—' ? c.memberName : 'member'
  if (missing.length) return `Dear ${name},\n\nThank you for your claim (ref. ${c.reference}). To process it with ${c.insurer || 'the insurer'}, please send us:\n${missing.map((m) => `- ${m}`).join('\n')}\n\nThank you,\nUlink Assist Myanmar`
  return `Dear ${name},\n\nThank you — we have received the documents for your claim (ref. ${c.reference}) and it is now under review. We will update you once ${c.insurer || 'the insurer'} has decided.\n\nThank you,\nUlink Assist Myanmar`
}
const HEADER_FIELDS: [Exclude<keyof JD1Note['header'], 'ias_note'>, string][] = [
  ['member_name', 'Member'], ['insurer', 'Insurer'], ['claim_no', 'Claim no.'], ['company', 'Company'],
  ['nrc_passport', 'NRC / passport'], ['claim_date', 'Claim date'], ['treatment_date', 'Treatment date'], ['total_claim_amount', 'Total claimed'],
]


function SectionHead({ icon, title, tone = 'primary', extra }: { icon: string; title: string; tone?: string; extra?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className={`w-7 h-7 rounded-lg bg-${tone}/10 text-${tone} grid place-items-center`}><Icon name={icon} className="text-[16px]" /></div>
      <h3 className="font-semibold text-on-surface text-sm">{title}</h3>
      {extra && <span className="ml-auto text-xs text-status-ai font-medium">{extra}</span>}
    </div>
  )
}
export function ClaimWorkspacePage() {
  const { id } = useParams(); const nav = useNavigate()
  const [docErr, setDocErr] = useState('')
  async function openDoc(docId: string, name: string, download: boolean) {
    if (!id) return
    setDocErr('')
    try {
      const { url, revoke } = await ticketDocUrl(id, docId)
      if (download) { const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove() }
      else window.open(url, '_blank', 'noopener')
      setTimeout(revoke, 60_000)
    } catch (e: any) { setDocErr(String(e?.message ?? e)) }
  }
  const [flash, setFlash] = useState('')
  const { data: c, isLoading, refetch } = useQuery({ queryKey: ['claim', id], queryFn: () => getClaim(id!) })
  const { data: draft = null } = useQuery({
    queryKey: ['jd1-draft', id], enabled: !!id && backendOn(), retry: false,
    queryFn: () => getJD1Draft(id!).catch(() => null),
  })
  const [copied, setCopied] = useState(false)
  const qc = useQueryClient()
  async function assign(username: string) {
    if (!c) return
    try { await assignTicket(c.id, username); await refetch(); qc.invalidateQueries({ queryKey: ['claims'] }); setFlash(username ? 'Assigned. ✓' : 'Unassigned.') }
    catch (e: any) { setFlash('Assign failed: ' + (e?.message ?? 'unknown')) }
  }
  if (isLoading) return <p className="text-outline">Loading…</p>
  if (!c) return <p className="text-outline">Claim not found.</p>
  const progress = progressOf(c, draft)
  const nextIdx = progress.findIndex((p) => !p.done)
  const required = c.checklist_required?.length ? c.checklist_required : draft?.checklist_required ?? []
  const missing = c.checklist_required?.length ? c.checklist_missing ?? [] : draft?.checklist_missing ?? []
  const summary = draft?.ai_summary || c.summary
  const nextHint = nextIdx === 1 || nextIdx === 2
    ? (c.documents.length ? 'Open it in JD1 to read the documents and save the note.' : 'This ticket was scanned before files were kept on the server — re-scan the documents in JD1 (they will be added to this ticket).')
    : nextIdx === 3 ? 'Open it in JD1, check the note and press Send to JD2.' : nextIdx === 4 ? 'JD2 is reviewing this claim.' : ''

  return (
    <div>
      <button onClick={() => nav('/inbox')} className="flex items-center gap-1 text-sm text-text-main mb-3 hover:text-primary"><Icon name="arrow_back" className="text-[18px]" /> Back to inbox</button>
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary grid place-items-center"><Icon name="description" /></div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-2xl font-bold text-primary tracking-tight">{c.reference}</h1>
            <Badge className={categoryMeta[c.category].cls}>{categoryMeta[c.category].label}</Badge>
            <Badge className={statusMeta[c.status].cls}>{statusMeta[c.status].label}</Badge>
          </div>
          <div className="text-sm text-text-main">{c.memberName} · {c.insurer}{c.amount ? ` · ${c.amount.toLocaleString()} MMK` : ''}</div>
        </div>
        <div className="ml-auto flex gap-2">
          <DeleteTicketButton id={c.id} reference={c.reference} />
          <AssignPicker value={c.assignee_username} currentName={c.assignee} onChange={assign} />
          {c.jd2_item_id
            ? <Button onClick={() => nav(`/jd2/${c.jd2_item_id}`)}><Icon name="gavel" className="text-[16px]" />Open in JD2</Button>
            : <Button onClick={() => nav(`/jd1?ticket=${c.id}`)} title="Open this ticket's documents and JD1 work in JD1"><Icon name="document_scanner" className="text-[16px]" />Continue in JD1</Button>}
        </div>
      </div>
      {flash && <div className="mb-4 text-sm text-status-approved flex items-center gap-1"><Icon name="check_circle" className="text-[18px]" />{flash}</div>}

      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-3 p-4 h-fit">
          <SectionHead icon="folder" title="Documents" />
          {c.documents.length === 0 && <p className="text-xs text-outline">No documents yet.</p>}
          {docErr && <p className="text-xs text-status-rejected mb-2">{docErr}</p>}
          <div className="space-y-2">
            {c.documents.map((d) => (
              <div key={d.id} className="flex items-center gap-2 p-2 rounded-lg bg-surface-container hover:bg-surface-container/70">
                <div className="w-8 h-8 rounded-lg bg-white grid place-items-center shrink-0"><Icon name="description" className="text-[18px] text-primary" /></div>
                <div className="min-w-0 flex-1"><div className="text-sm truncate" title={d.name}>{d.name}</div>
                  <div className="text-xs text-outline"><span className="font-mono">{d.id.includes('-D') ? d.id : ''}</span>{d.id.includes('-D') ? ' · ' : ''}{d.size ? `${(d.size / 1024 / 1024).toFixed(1)} MB` : `${d.pages ?? 1} page(s)`}{d.uploaded_by ? ` · ${d.uploaded_by}` : ''}</div></div>
                {d.url?.startsWith('/api/') && (<>
                  <button onClick={() => openDoc(d.id, d.name, false)} title="Open" aria-label={`Open ${d.name}`} className="text-primary"><Icon name="open_in_new" className="text-[16px]" /></button>
                  <button onClick={() => openDoc(d.id, d.name, true)} title="Download" aria-label={`Download ${d.name}`} className="text-primary"><Icon name="download" className="text-[16px]" /></button>
                </>)}
              </div>
            ))}
          </div>
        </Card>

        <div className="col-span-5 space-y-4">
          <Card className="p-4">
            <SectionHead icon="timeline" title="Progress" />
            <ol className="space-y-2">
              {progress.map((p, i) => (
                <li key={p.label} className="flex items-start gap-2 text-sm">
                  <Icon name={p.done ? 'check_circle' : i === nextIdx ? 'pending' : 'radio_button_unchecked'} className={`text-[18px] mt-px ${p.done ? 'text-status-approved' : i === nextIdx ? 'text-status-pending' : 'text-outline-variant'}`} />
                  <div className="min-w-0"><div className={p.done || i === nextIdx ? 'text-on-surface' : 'text-outline'}>{p.label}</div>
                    <div className="text-xs text-outline">{p.info}</div></div>
                </li>
              ))}
            </ol>
            {nextHint && <p className="text-xs text-status-pending mt-3 flex items-start gap-1"><Icon name="arrow_forward" className="text-[14px] mt-px" />Next: {nextHint}</p>}
          </Card>
          <Card className="p-4">
            <SectionHead icon="data_object" title="Claim details" extra={draft ? 'from the JD1 note' : undefined} />
            {draft ? (
              <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                {HEADER_FIELDS.map(([k, label]) => (
                  <div key={k} className="contents"><dt className="text-xs text-text-main pt-0.5">{label}</dt><dd className="text-on-surface break-words">{draft.header?.[k]?.value || <span className="text-outline">—</span>}</dd></div>
                ))}
              </dl>
            ) : c.extracted.length ? (
              <dl className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-1.5 text-sm">
                {c.extracted.map((f) => <div key={f.key} className="contents"><dt className="text-xs text-text-main pt-0.5">{f.key}</dt><dd className="text-on-surface break-words">{f.value}</dd></div>)}
              </dl>
            ) : <p className="text-xs text-outline">No JD1 note saved with this ticket yet.</p>}
            {!c.jd2_item_id && <p className="text-xs text-outline mt-3">To change these, use <button className="text-primary hover:underline" onClick={() => nav(`/jd1?ticket=${c.id}`)}>Continue in JD1</button>.</p>}
          </Card>
        </div>

        <div className="col-span-4 space-y-4">
          <Card className="p-4">
            <SectionHead icon="checklist" title="Document checklist" tone="status-approved" />
            {required.length === 0 && <p className="text-xs text-outline">The checklist appears after JD1 reads the documents.</p>}
            {required.map((d) => {
              const have = !missing.includes(d)
              return (
                <div key={d} className="flex items-center gap-2 text-sm py-1">
                  <Icon name={have ? 'check_circle' : 'cancel'} className={`text-[18px] ${have ? 'text-status-approved' : 'text-status-rejected'}`} />
                  <span className={have ? 'text-on-surface' : 'text-text-main'}>{d}</span>
                </div>
              )
            })}
          </Card>
          <Card className="p-4">
            <SectionHead icon="notes" title="AI summary" tone="brand-accent" />
            {summary ? <p className="text-sm text-text-main leading-relaxed whitespace-pre-line">{summary}</p> : <p className="text-xs text-outline">No summary yet.</p>}
          </Card>
          <Card className="p-4">
            <SectionHead icon="reply" title="Draft reply" />
            <textarea key={`${c.id}-${missing.join('|')}`} rows={7} className="w-full text-sm border border-outline-variant rounded-md px-2 py-1 bg-surface" defaultValue={replyFor(c, missing)} id="ticket-reply" />
            <div className="flex flex-wrap items-center gap-2 mt-3">
              <Button size="sm" variant="outline" onClick={async () => {
                const t = (document.getElementById('ticket-reply') as HTMLTextAreaElement | null)?.value ?? ''
                try { await navigator.clipboard.writeText(t); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { setFlash('Could not copy — select the text and copy it.') }
              }}><Icon name={copied ? 'check' : 'content_copy'} className="text-[16px]" />{copied ? 'Copied' : 'Copy reply'}</Button>
              {c.jd2_item_id && <Button size="sm" variant="ghost" onClick={() => nav(`/jd2/${c.jd2_item_id}`)}>Open in JD2</Button>}
            </div>
            <p className="text-xs text-outline mt-2">Sending from ClaimFlow isn't connected yet — copy the reply and send it by email or Viber.</p>
          </Card>
        </div>
      </div>
    </div>
  )
}
