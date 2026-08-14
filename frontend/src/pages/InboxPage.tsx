import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { listClaims } from '../lib/api'
import { PageTitle, Card, Badge, Icon } from '../components/ui'
import { channelIcon, categoryMeta, statusMeta, timeAgo } from '../lib/format'
import { mockUsers } from '../mocks/users'

const nameOf = (id?: string | null) => mockUsers.find((u) => u.id === id)?.name ?? null

export function InboxPage() {
  const { data, isLoading } = useQuery({ queryKey: ['claims'], queryFn: listClaims })
  const nav = useNavigate()
  const [channel, setChannel] = useState('all')
  const [category, setCategory] = useState('all')
  const items = useMemo(() => (data?.items ?? []).filter(
    (c) => (channel === 'all' || c.channel === channel) && (category === 'all' || c.category === category)
  ), [data, channel, category])

  const routeFor = (c: any) => c.category === 'log_request' ? `/log/${c.id}`
    : c.category === 'new_claim' ? `/claim/${c.id}` : `/claim/${c.id}`

  return (
    <div>
      <PageTitle title="Omnichannel Inbox" sub="All channels in one place. AI categorizes and suggests an assignee." />
      <div className="flex gap-2 mb-4">
        <select value={channel} onChange={(e) => setChannel(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          <option value="all">All channels</option><option value="email">Email</option><option value="facebook">Facebook</option>
          <option value="viber">Viber</option><option value="webform">Web form</option><option value="phone">Phone</option>
        </select>
        <select value={category} onChange={(e) => setCategory(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-2">
          <option value="all">All types</option><option value="new_claim">New claim</option><option value="log_request">LOG</option>
          <option value="query">Query</option><option value="complaint">Complaint</option><option value="payment_followup">Payment follow-up</option>
        </select>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container text-on-surface-variant text-left">
            <tr>
              <th className="px-4 py-3 font-semibold">Channel</th>
              <th className="px-4 py-3 font-semibold">Reference</th>
              <th className="px-4 py-3 font-semibold">Member</th>
              <th className="px-4 py-3 font-semibold">Insurer</th>
              <th className="px-4 py-3 font-semibold">Category</th>
              <th className="px-4 py-3 font-semibold">Status</th>
              <th className="px-4 py-3 font-semibold">Assignee</th>
              <th className="px-4 py-3 font-semibold">Age</th>
              <th className="px-4 py-3 font-semibold">Docs</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td className="px-4 py-6 text-outline" colSpan={9}>Loading…</td></tr>}
            {items.map((c) => (
              <tr key={c.id} onClick={() => nav(routeFor(c))} className="border-t border-outline-variant hover:bg-surface-container/50 cursor-pointer">
                <td className="px-4 py-3"><Icon name={channelIcon[c.channel]} className="text-[20px] text-text-main" /></td>
                <td className="px-4 py-3 font-medium text-primary">{c.reference}</td>
                <td className="px-4 py-3">{c.memberName}</td>
                <td className="px-4 py-3">{c.insurer}</td>
                <td className="px-4 py-3"><Badge className={categoryMeta[c.category].cls}>{categoryMeta[c.category].label}</Badge></td>
                <td className="px-4 py-3"><Badge className={statusMeta[c.status].cls}>{statusMeta[c.status].label}</Badge></td>
                <td className="px-4 py-3">
                  {nameOf(c.assignee) ?? (
                    <span className="inline-flex items-center gap-1 text-status-ai">
                      <Icon name="smart_toy" className="text-[16px]" /> {nameOf(c.suggestedAssignee) ?? 'Unassigned'}
                    </span>)}
                </td>
                <td className="px-4 py-3 text-text-main">{timeAgo(c.receivedAt)}</td>
                <td className="px-4 py-3">{c.documentsComplete
                  ? <Icon name="check_circle" className="text-[18px] text-status-approved" />
                  : <Icon name="pending" className="text-[18px] text-status-pending" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-outline mt-3">The robot icon marks an AI-suggested assignee you can accept or reassign. Click a row to open the workspace.</p>
    </div>
  )
}
