import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listClaims } from '../lib/api'
import { deleteTicket } from '../lib/jd1'
import { canDeleteTickets } from '../components/DeleteTicketButton'
import { Card, Badge, Icon, Button } from '../components/ui'
import { channelIcon, categoryMeta, statusMeta, timeAgo } from '../lib/format'

const initials = (n: string) => n.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()
const tabs = [['all', 'All'], ['new_claim', 'New claims'], ['log_request', 'LOG'], ['complaint', 'Complaints'], ['payment_followup', 'Payments']] as [string, string][]

export function InboxPage() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const nav = useNavigate()
  const [tab, setTab] = useState('all')
  const [channel, setChannel] = useState('all')
  const [status, setStatus] = useState('all')
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState('')
  const canDelete = canDeleteTickets()   // Super Admin + Admin
  const items = useMemo(() => (data?.items ?? []).filter(
    (c) => (tab === 'all' || c.category === tab) && (channel === 'all' || c.channel === channel)
      && (status === 'all' || c.status === status)
      && (q.trim() === '' || `${c.reference} ${c.memberName} ${c.insurer} ${c.policyNumber ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  ), [data, tab, channel, status, q])
  const routeFor = (c: any) => c.jd2_item_id ? `/jd2/${c.jd2_item_id}` : c.category === 'log_request' ? `/log/${c.id}` : `/claim/${c.id}`

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function removeTicket(id: string) {
    if (!window.confirm('Delete this ticket permanently? This cannot be undone and is recorded in the audit log.')) return
    try { await deleteTicket(id); setSel((s) => { const n = new Set(s); n.delete(id); return n }); refetch() }
    catch (e: any) { setFlash('Delete failed: ' + (e?.message ?? 'unknown')) }
  }
  async function bulkDelete() {
    if (sel.size === 0) return
    if (!window.confirm(`Delete ${sel.size} ticket(s) permanently? This is recorded in the audit log.`)) return
    try {
      await Promise.all(Array.from(sel).map((x) => deleteTicket(x)))
      setSel(new Set()); refetch()
    } catch (e: any) { setFlash('Bulk delete failed: ' + (e?.message ?? 'unknown')) }
  }

  return (
    <div>
      <div className="flex items-start justify-between mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary tracking-tight">Omnichannel Inbox</h1>
          <p className="text-sm text-text-main mt-1">All channels in one place — AI categorizes and suggests an assignee.</p>
        </div>
        <Button onClick={() => nav('/new-claim')}><Icon name="add" className="text-[18px]" /> New Claim</Button>
      </div>

      {/* tabs */}
      <div className="flex items-center gap-1 mb-3 bg-surface-container rounded-xl p-1 w-fit">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === k ? 'bg-white text-primary shadow-sm' : 'text-text-main hover:text-primary'}`}>{label}</button>
        ))}
      </div>

      <div className="flex gap-2 mb-4">
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          <option value="all">All channels</option><option value="email">Email</option><option value="facebook">Facebook</option>
          <option value="viber">Viber</option><option value="webform">Web form</option><option value="phone">Phone</option>
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          <option value="all">All statuses</option>
          <option value="new">New</option><option value="in_progress">In progress</option>
          <option value="awaiting_docs">Awaiting documents</option><option value="ready_for_review">Ready for review</option>
          <option value="approved">Approved</option><option value="partially_approved">Partially approved</option>
          <option value="rejected">Rejected</option><option value="closed">Closed</option>
        </select>
        <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm text-outline">
          <Icon name="search" className="text-[18px]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, member, insurer…" className="outline-none w-48 text-text-main" />
        </div>
      </div>

      {flash && <p className="text-sm text-status-rejected mb-3">{flash}</p>}
      {canDelete && sel.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-surface-container/60 rounded-lg px-3 py-2">
          <span className="text-sm text-text-main">{sel.size} selected</span>
          <Button variant="outline" size="sm" onClick={bulkDelete}><Icon name="delete" className="text-[16px] text-status-rejected" />Delete selected</Button>
          <button onClick={() => setSel(new Set())} className="text-xs text-outline">Clear</button>
        </div>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
            <tr>
              {canDelete && (
                <th className="px-4 py-3 font-semibold w-8">
                  <input type="checkbox" checked={items.length > 0 && sel.size === items.length} onChange={(e) => setSel(e.target.checked ? new Set(items.map((c) => c.id)) : new Set())} />
                </th>
              )}
              <th className="px-4 py-3 font-semibold">Request</th>
              <th className="px-4 py-3 font-semibold">Member</th>
              <th className="px-4 py-3 font-semibold">Insurer</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Assignee</th>
              <th className="px-4 py-3 font-semibold">Age</th>
              <th className="px-4 py-3 font-semibold text-center">Docs</th>
              {canDelete && <th className="px-4 py-3 font-semibold text-center">Delete</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-4 py-6 text-outline" colSpan={canDelete ? 10 : 8}>Loading…</td></tr>}
            {items.map((c) => (
              <tr key={c.id} onClick={() => nav(routeFor(c))} className="border-t border-outline-variant hover:bg-primary/[0.03] cursor-pointer transition-colors">
                {canDelete && (
                  <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={sel.has(c.id)} onChange={() => toggleSel(c.id)} />
                  </td>
                )}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-8 h-8 rounded-lg bg-surface-container grid place-items-center shrink-0"><Icon name={channelIcon[c.channel]} className="text-[18px] text-primary" /></div>
                    <div>
                      <div className="font-semibold text-primary">{c.reference}</div>
                      <div className="text-xs text-outline capitalize">{c.channel}</div>
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-full bg-secondary/15 text-secondary grid place-items-center text-[11px] font-semibold">{initials(c.memberName)}</div>
                    {c.memberName}
                  </div>
                </td>
                <td className="px-4 py-3 text-text-main">{c.insurer}</td>
                <td className="px-4 py-3"><Badge className={categoryMeta[c.category].cls}>{categoryMeta[c.category].label}</Badge></td>
                <td className="px-4 py-3"><Badge className={statusMeta[c.status].cls}>{statusMeta[c.status].label}</Badge></td>
                <td className="px-4 py-3">
                  {c.assignee ?? (
                    <span className="inline-flex items-center gap-1 text-status-ai text-xs bg-status-ai/10 px-2 py-1 rounded-full"><Icon name="smart_toy" className="text-[14px]" />{c.suggestedAssignee ?? 'Unassigned'}</span>)}
                </td>
                <td className="px-4 py-3 text-text-main">{timeAgo(c.receivedAt)}</td>
                <td className="px-4 py-3 text-center">{c.documentsComplete
                  ? <Icon name="check_circle" className="text-[18px] text-status-approved" />
                  : <Icon name="pending" className="text-[18px] text-status-pending" />}</td>
                {canDelete && (
                  <td className="px-4 py-3 text-center" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => removeTicket(c.id)} title={`Delete ticket ${c.reference}`}
                      className="w-8 h-8 rounded-lg grid place-items-center text-status-rejected hover:bg-status-rejected/10 transition-colors">
                      <Icon name="delete" className="text-[18px]" />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
