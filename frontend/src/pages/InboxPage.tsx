import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listClaims } from '../lib/api'
import { Card, Badge, Icon, Button } from '../components/ui'
import { channelIcon, categoryMeta, statusMeta, timeAgo } from '../lib/format'
import { mockUsers } from '../mocks/users'

const nameOf = (id?: string | null) => mockUsers.find((u) => u.id === id)?.name ?? null
const initials = (n: string) => n.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()
const tabs = [['all', 'All'], ['new_claim', 'New claims'], ['log_request', 'LOG'], ['complaint', 'Complaints'], ['payment_followup', 'Payments']] as [string, string][]

export function InboxPage() {
  const { data, isLoading } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const nav = useNavigate()
  const [tab, setTab] = useState('all')
  const [channel, setChannel] = useState('all')
  const [q, setQ] = useState('')
  const items = useMemo(() => (data?.items ?? []).filter(
    (c) => (tab === 'all' || c.category === tab) && (channel === 'all' || c.channel === channel)
      && (q.trim() === '' || `${c.reference} ${c.memberName} ${c.insurer} ${c.policyNumber ?? ''}`.toLowerCase().includes(q.toLowerCase()))
  ), [data, tab, channel, q])
  const routeFor = (c: any) => c.category === 'log_request' ? `/log/${c.id}` : `/claim/${c.id}`

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
        <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-2 text-sm text-outline">
          <Icon name="search" className="text-[18px]" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search ref, member, insurer…" className="outline-none w-48 text-text-main" />
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 font-semibold">Request</th>
              <th className="px-4 py-3 font-semibold">Member</th>
              <th className="px-4 py-3 font-semibold">Insurer</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Assignee</th>
              <th className="px-4 py-3 font-semibold">Age</th>
              <th className="px-4 py-3 font-semibold text-center">Docs</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-4 py-6 text-outline" colSpan={8}>Loading…</td></tr>}
            {items.map((c) => (
              <tr key={c.id} onClick={() => nav(routeFor(c))} className="border-t border-outline-variant hover:bg-primary/[0.03] cursor-pointer transition-colors">
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
                  {nameOf(c.assignee) ?? (
                    <span className="inline-flex items-center gap-1 text-status-ai text-xs bg-status-ai/10 px-2 py-1 rounded-full"><Icon name="smart_toy" className="text-[14px]" />{nameOf(c.suggestedAssignee) ?? 'Unassigned'}</span>)}
                </td>
                <td className="px-4 py-3 text-text-main">{timeAgo(c.receivedAt)}</td>
                <td className="px-4 py-3 text-center">{c.documentsComplete
                  ? <Icon name="check_circle" className="text-[18px] text-status-approved" />
                  : <Icon name="pending" className="text-[18px] text-status-pending" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
