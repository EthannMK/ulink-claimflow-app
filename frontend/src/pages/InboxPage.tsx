import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { listClaims } from '../lib/api'
import { deleteTicket, assignTicket, downloadDocumentIndex } from '../lib/jd1'
import { AssignPicker } from '../components/AssignPicker'
import { getUsername, getName } from '../lib/auth'
import { canDeleteTickets } from '../components/DeleteTicketButton'
import { Card, Badge, Icon, Button, PageTitle, EmptyState, SkeletonRows } from '../components/ui'
import { channelIcon, categoryMeta, statusMeta, timeAgo } from '../lib/format'
import type { Claim } from '../lib/types'

const initials = (n: string) => n.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()
const tabs = [['all', 'All'], ['new_claim', 'New claims'], ['log_request', 'LOG'], ['complaint', 'Complaints'], ['payment_followup', 'Payments']] as [string, string][]
const CHANNELS: [string, string][] = [['email', 'Email'], ['facebook', 'Facebook'], ['viber', 'Viber'], ['telegram', 'Telegram'], ['webform', 'Web form'], ['phone', 'Phone']]
const DATES: [string, string][] = [['', 'Any date'], ['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['month', 'This month'], ['custom', 'Custom range…']]
const SORTS: [string, string][] = [['new', 'Newest first'], ['old', 'Oldest first'], ['amount_desc', 'Amount: high → low'], ['amount_asc', 'Amount: low → high'], ['member', 'Member A → Z']]
const DONE = ['approved', 'partially_approved', 'rejected', 'closed']
// every filter lives in the page address, so it survives opening a ticket and coming back (and can be shared)
const DEFAULTS: Record<string, string> = { tab: 'all', channel: 'all', status: 'all', who: 'all', q: '', date: '', from: '', to: '',
  insurer: '', docs: '', stage: '', min: '', max: '', sort: 'new' }
const ADVANCED = ['channel', 'insurer', 'docs', 'stage', 'min', 'max']

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
const received = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

/** [from, to) for a date choice, in the viewer's local time. */
function dateRange(f: Record<string, string>): [number, number] | null {
  const now = new Date(), today = dayStart(now).getTime(), day = 86_400_000
  switch (f.date) {
    case 'today': return [today, Infinity]
    case 'yesterday': return [today - day, today]
    case '7d': return [today - 6 * day, Infinity]
    case '30d': return [today - 29 * day, Infinity]
    case 'month': return [new Date(now.getFullYear(), now.getMonth(), 1).getTime(), Infinity]
    case 'custom': {
      const a = f.from ? new Date(f.from + 'T00:00:00').getTime() : -Infinity
      const b = f.to ? new Date(f.to + 'T00:00:00').getTime() + day : Infinity
      return [a, b]
    }
    default: return null
  }
}

/** The Received filter as YYYY-MM-DD dates for the server (local calendar days). */
function dateRangeISO(f: Record<string, string>): { date_from?: string; date_to?: string } | null {
  const r = dateRange(f)
  if (!r) return null
  const iso = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
  return { ...(isFinite(r[0]) ? { date_from: iso(r[0]) } : {}), ...(isFinite(r[1]) ? { date_to: iso(r[1] - 1) } : {}) }
}

function Sel({ value, onChange, options, label, className = '', def = options[0]?.[0] }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string; className?: string; def?: string }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
      className={`text-sm bg-white border rounded-lg px-3 py-2 ${value !== def ? 'border-primary/60 text-primary font-medium' : 'border-outline-variant'} ${className}`}>
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  )
}

export function InboxPage() {
  const { data, isLoading, refetch } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const nav = useNavigate()
  const [params, setParams] = useSearchParams()
  const f: Record<string, string> = Object.fromEntries(Object.keys(DEFAULTS).map((k) => [k, params.get(k) ?? DEFAULTS[k]]))
  const set = (patch: Record<string, string>) => setParams((prev) => {
    const n = new URLSearchParams(prev)
    for (const [k, v] of Object.entries(patch)) { if (v === DEFAULTS[k] || v === '') n.delete(k); else n.set(k, v) }
    return n
  }, { replace: true })
  const clearAll = () => setParams(new URLSearchParams(), { replace: true })
  const [more, setMore] = useState(() => ADVANCED.some((k) => params.get(k)))
  const { tab, q, who } = f
  const qc = useQueryClient()
  const me = getUsername(), myName = getName()
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [flash, setFlash] = useState('')
  const [exporting, setExporting] = useState(false)
  const canDelete = canDeleteTickets()   // Super Admin + Admin
  const all = data?.items ?? []
  const insurers = useMemo(() => Array.from(new Set(all.map((c) => c.insurer).filter((x) => x && x !== '—'))).sort(), [all])
  const people = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of all) if (c.assignee) m.set(c.assignee_username || c.assignee, c.assignee)
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]))
  }, [all])
  const mine = (c: Claim) => (c.assignee_username ? c.assignee_username === me : c.assignee === myName)

  /** every filter except the category tab — the tabs show how many tickets each would give */
  const base = useMemo(() => {
    const range = dateRange(f)
    const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const min = f.min ? Number(f.min) : null, max = f.max ? Number(f.max) : null
    return all.filter((c) => {
      if (f.channel !== 'all' && c.channel !== f.channel) return false
      if (f.status === 'open' ? DONE.includes(c.status) : f.status === 'done' ? !DONE.includes(c.status) : f.status !== 'all' && c.status !== f.status) return false
      if (who === 'mine' ? !mine(c) : who === 'unassigned' ? !!c.assignee : who.startsWith('u:') ? (c.assignee_username || c.assignee) !== who.slice(2) : false) return false
      if (f.insurer && c.insurer !== f.insurer) return false
      if (f.docs === 'complete' ? !c.documentsComplete : f.docs === 'missing' ? c.documentsComplete : false) return false
      if (f.stage === 'jd2' ? !c.jd2_item_id : f.stage === 'jd1' ? !!c.jd2_item_id : false) return false
      if (min != null && !isNaN(min) && (c.amount ?? -1) < min) return false
      if (max != null && !isNaN(max) && (c.amount == null || c.amount > max)) return false
      if (range) { const t = new Date(c.receivedAt).getTime(); if (t < range[0] || t >= range[1]) return false }
      if (words.length) {
        const hay = `${c.reference} ${c.memberName} ${c.insurer} ${c.policyNumber ?? ''} ${c.assignee ?? ''} ${c.summary ?? ''} ${c.channel} ${categoryMeta[c.category]?.label ?? ''} ${statusMeta[c.status]?.label ?? ''}`.toLowerCase()
        if (!words.every((w) => hay.includes(w))) return false
      }
      return true
    })
  }, [all, f.channel, f.status, who, f.insurer, f.docs, f.stage, f.min, f.max, f.date, f.from, f.to, q, me, myName])
  const counts = useMemo(() => {
    const m: Record<string, number> = { all: base.length }
    for (const c of base) m[c.category] = (m[c.category] ?? 0) + 1
    return m
  }, [base])
  const items = useMemo(() => {
    const out = base.filter((c) => tab === 'all' || c.category === tab)
    const t = (c: Claim) => new Date(c.receivedAt).getTime()
    const sorters: Record<string, (a: Claim, b: Claim) => number> = {
      new: (a, b) => t(b) - t(a), old: (a, b) => t(a) - t(b),
      amount_desc: (a, b) => (b.amount ?? -1) - (a.amount ?? -1), amount_asc: (a, b) => (a.amount ?? Infinity) - (b.amount ?? Infinity),
      member: (a, b) => a.memberName.localeCompare(b.memberName),
    }
    return out.sort(sorters[f.sort] ?? sorters.new)
  }, [base, tab, f.sort])
  const activeAdvanced = ADVANCED.filter((k) => f[k] !== DEFAULTS[k]).length
  const anyFilter = Object.keys(DEFAULTS).some((k) => k !== 'sort' && f[k] !== DEFAULTS[k])
  const routeFor = (c: any) => c.jd2_item_id ? `/jd2/${c.jd2_item_id}` : c.category === 'log_request' ? `/log/${c.id}` : `/claim/${c.id}`

  function toggleSel(id: string) {
    setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  }
  async function assign(id: string, username: string) {
    try { await assignTicket(id, username); refetch(); qc.invalidateQueries({ queryKey: ['claim', id] }) }
    catch (e: any) { setFlash('Assign failed: ' + (e?.message ?? 'unknown')) }
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
      <PageTitle title="Inbox" sub="Every claim and request from all channels, with AI-suggested category and assignee."
        action={<>
          {canDelete && <Button variant="outline" loading={exporting} title="CSV of every stored document with ticket ID, claim number, insurer, member, date and storage path — uses the insurer and date filters below"
            onClick={async () => { setExporting(true); try { await downloadDocumentIndex({ insurer: f.insurer, q: f.q, ...(dateRangeISO(f) ?? {}) }) } catch (e: any) { setFlash(String(e?.message ?? e)) } finally { setExporting(false) } }}>
            <Icon name="download" className="text-[18px]" />Document index</Button>}
          <Button onClick={() => nav('/new-claim')}><Icon name="add" className="text-[18px]" />New claim</Button>
        </>} />

      {/* tabs */}
      <div className="flex items-center gap-1 mb-3 bg-surface-container rounded-xl p-1 w-fit">
        {tabs.map(([k, label]) => (
          <button key={k} onClick={() => set({ tab: k })}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === k ? 'bg-white text-primary shadow-sm' : 'text-text-main hover:text-primary'}`}>
            {label} <span className={`ml-0.5 text-xs tabular-nums ${tab === k ? 'text-primary/70' : 'text-outline'}`}>{counts[k] ?? 0}</span></button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm text-outline flex-1 min-w-[16rem] max-w-md">
          <Icon name="search" className="text-[18px]" />
          <input value={q} onChange={(e) => set({ q: e.target.value })} placeholder="Search ref, member, policy, insurer, assignee, summary…" className="outline-none w-full text-text-main" />
          {q && <button onClick={() => set({ q: '' })} title="Clear search"><Icon name="close" className="text-[16px]" /></button>}
        </div>
        <Sel label="Status" value={f.status} onChange={(v) => set({ status: v })} options={[['all', 'All statuses'], ['open', 'Open (not decided)'], ['done', 'Decided / closed'],
          ...(Object.entries(statusMeta).map(([k, m]) => [k, m.label]) as [string, string][])]} />
        <Sel label="Assignee" value={who} onChange={(v) => set({ who: v })} options={[['all', "Everyone's tickets"], ['mine', 'Assigned to me'], ['unassigned', 'Unassigned'],
          ...people.map(([u, n]) => [`u:${u}`, n] as [string, string])]} />
        <Sel label="Received" value={f.date} onChange={(v) => set({ date: v, ...(v !== 'custom' ? { from: '', to: '' } : {}) })} options={DATES} />
        {f.date === 'custom' && (
          <span className="flex items-center gap-1 text-sm">
            <input type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} className="bg-white border border-outline-variant rounded-lg px-2 py-1.5" aria-label="From date" />
            <span className="text-outline">to</span>
            <input type="date" value={f.to} onChange={(e) => set({ to: e.target.value })} className="bg-white border border-outline-variant rounded-lg px-2 py-1.5" aria-label="To date" />
          </span>
        )}
        <Button variant="outline" onClick={() => setMore((v) => !v)} className={activeAdvanced ? '!border-primary/60 !text-primary' : ''}>
          <Icon name="tune" className="text-[18px]" />More filters{activeAdvanced ? ` · ${activeAdvanced}` : ''}
        </Button>
        <Sel label="Sort" value={f.sort} onChange={(v) => set({ sort: v })} options={SORTS} className="ml-auto" />
      </div>
      {more && (
        <div className="flex flex-wrap items-end gap-3 mb-2 bg-surface-container/50 border border-outline-variant/60 rounded-lg px-3 py-2.5">
          <label className="text-[11px] text-outline flex flex-col gap-0.5">Channel
            <Sel label="Channel" value={f.channel} onChange={(v) => set({ channel: v })} options={[['all', 'All channels'], ...CHANNELS]} /></label>
          <label className="text-[11px] text-outline flex flex-col gap-0.5">Insurer
            <Sel label="Insurer" value={f.insurer} onChange={(v) => set({ insurer: v })} options={[['', 'All insurers'], ...insurers.map((x) => [x, x] as [string, string])]} className="max-w-[14rem]" /></label>
          <label className="text-[11px] text-outline flex flex-col gap-0.5">Documents
            <Sel label="Documents" value={f.docs} onChange={(v) => set({ docs: v })} options={[['', 'Any'], ['complete', 'Complete'], ['missing', 'Missing documents']]} /></label>
          <label className="text-[11px] text-outline flex flex-col gap-0.5">Stage
            <Sel label="Stage" value={f.stage} onChange={(v) => set({ stage: v })} options={[['', 'Any'], ['jd1', 'Still in JD1'], ['jd2', 'Sent to JD2']]} /></label>
          <label className="text-[11px] text-outline flex flex-col gap-0.5">Amount (MMK)
            <span className="flex items-center gap-1">
              <input value={f.min} onChange={(e) => set({ min: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="min" className="w-24 text-sm bg-white border border-outline-variant rounded-lg px-2 py-1.5 text-text-main" />
              <span>–</span>
              <input value={f.max} onChange={(e) => set({ max: e.target.value.replace(/[^\d]/g, '') })} inputMode="numeric" placeholder="max" className="w-24 text-sm bg-white border border-outline-variant rounded-lg px-2 py-1.5 text-text-main" />
            </span></label>
        </div>
      )}
      <div className="flex items-center gap-3 mb-3 text-xs text-outline">
        <span>{isLoading ? 'Loading…' : `${items.length} of ${all.length} ticket${all.length === 1 ? '' : 's'}`}</span>
        {anyFilter && <button onClick={clearAll} className="text-primary hover:underline">Clear all filters</button>}
      </div>

      {flash && <p className="text-sm text-status-rejected mb-3">{flash}</p>}
      {canDelete && sel.size > 0 && (
        <div className="flex items-center gap-3 mb-3 bg-surface-container/60 rounded-lg px-3 py-2">
          <span className="text-sm text-text-main">{sel.size} selected</span>
          <Button variant="outline" size="sm" onClick={bulkDelete}><Icon name="delete" className="text-[16px] text-status-rejected" />Delete selected</Button>
          <button onClick={() => setSel(new Set())} className="text-xs text-outline">Clear</button>
        </div>
      )}

      <Card className="overflow-x-auto">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="sticky top-0 z-[1] bg-surface-container-low text-on-surface-variant text-left text-[11px] uppercase tracking-[0.06em] border-b border-outline-variant">
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
              <th className="px-4 py-3 font-semibold whitespace-nowrap">
                <button onClick={() => set({ sort: f.sort === 'old' ? 'new' : 'old' })} className="inline-flex items-center gap-0.5 uppercase" title="Sort by date received">
                  Received<Icon name={f.sort === 'old' ? 'arrow_upward' : 'arrow_downward'} className={`text-[14px] ${f.sort === 'new' || f.sort === 'old' ? '' : 'opacity-30'}`} /></button></th>
              <th className="px-4 py-3 font-semibold text-center">Docs</th>
              {canDelete && <th className="px-4 py-3 font-semibold text-center">Delete</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={canDelete ? 10 : 8}><SkeletonRows rows={6} cols={6} /></td></tr>}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={canDelete ? 10 : 8}>
                {all.length === 0
                  ? <EmptyState icon="inbox" title="No tickets yet">Tickets appear here when a claim arrives from a channel or a JD1 scan creates one.</EmptyState>
                  : <EmptyState icon="filter_alt_off" title="No tickets match these filters" action={<Button variant="outline" size="sm" onClick={clearAll}>Clear all filters</Button>}>Try a wider date range or fewer filters.</EmptyState>}
              </td></tr>
            )}
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
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <AssignPicker compact value={c.assignee_username} currentName={c.assignee} onChange={(u) => assign(c.id, u)}
                    disabled={DONE.includes(c.status)} />
                  {!c.assignee && c.suggestedAssignee && <div className="text-[10px] text-status-ai mt-0.5">AI suggests {c.suggestedAssignee}</div>}
                </td>
                <td className="px-4 py-3 whitespace-nowrap" title={new Date(c.receivedAt).toString()}>
                  <div className="text-text-main">{received(c.receivedAt)}</div>
                  <div className="text-[11px] text-outline">{timeAgo(c.receivedAt)}</div>
                </td>
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
