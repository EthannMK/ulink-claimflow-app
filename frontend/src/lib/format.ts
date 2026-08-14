import type { Channel, Category, Status } from './types'

export const channelIcon: Record<Channel, string> = {
  email: 'mail', facebook: 'thumb_up', viber: 'chat', telegram: 'send', webform: 'language', phone: 'call',
}
export const categoryMeta: Record<Category, { label: string; cls: string }> = {
  new_claim: { label: 'New claim', cls: 'bg-status-ai/10 text-status-ai' },
  log_request: { label: 'LOG', cls: 'bg-brand-accent/10 text-brand-accent' },
  query: { label: 'Query', cls: 'bg-status-pending/10 text-status-pending' },
  complaint: { label: 'Complaint', cls: 'bg-status-rejected/10 text-status-rejected' },
  payment_followup: { label: 'Payment follow-up', cls: 'bg-secondary/10 text-secondary' },
  document_submission: { label: 'Documents', cls: 'bg-on-surface-variant/10 text-on-surface-variant' },
}
export const statusMeta: Record<Status, { label: string; cls: string }> = {
  new: { label: 'New', cls: 'bg-status-ai/10 text-status-ai' },
  in_progress: { label: 'In progress', cls: 'bg-status-pending/10 text-status-pending' },
  awaiting_docs: { label: 'Awaiting docs', cls: 'bg-status-pending/10 text-status-pending' },
  ready_for_review: { label: 'Ready for review', cls: 'bg-status-ai/10 text-status-ai' },
  approved: { label: 'Approved', cls: 'bg-status-approved/10 text-status-approved' },
  partially_approved: { label: 'Partial', cls: 'bg-status-approved/10 text-status-approved' },
  rejected: { label: 'Rejected', cls: 'bg-status-rejected/10 text-status-rejected' },
  closed: { label: 'Closed', cls: 'bg-on-surface-variant/10 text-on-surface-variant' },
}
export function timeAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 60000
  if (d < 60) return `${Math.max(1, Math.round(d))}m ago`
  if (d < 1440) return `${Math.round(d / 60)}h ago`
  return `${Math.round(d / 1440)}d ago`
}
export function confidenceCls(c: number): string {
  if (c >= 0.85) return 'bg-status-approved/10 text-status-approved'
  if (c >= 0.7) return 'bg-status-pending/10 text-status-pending'
  return 'bg-status-rejected/10 text-status-rejected'
}
