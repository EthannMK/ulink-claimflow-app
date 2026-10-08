import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { deleteTicket } from '../lib/jd1'
import { getRole } from '../lib/auth'
import { Button, Icon } from './ui'

/** Super Admin and Admin can delete Inbox tickets (normal users can't). */
export const canDeleteTickets = () => ['super_admin', 'admin'].includes(getRole())

/** "Delete ticket" button for a ticket's own page: confirms, deletes, goes back to the Inbox. */
export function DeleteTicketButton({ id, reference }: { id: string; reference: string }) {
  const nav = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  if (!canDeleteTickets()) return null
  async function run() {
    if (!window.confirm(`Delete ticket ${reference} permanently?\n\nThis cannot be undone and is recorded in the audit log.`)) return
    setBusy(true); setErr('')
    try {
      await deleteTicket(id)
      qc.removeQueries({ queryKey: ['claim', id] })
      qc.invalidateQueries({ queryKey: ['claims'] })
      nav('/inbox')
    } catch (e: any) { setErr(e?.message ?? 'Delete failed'); setBusy(false) }
  }
  return (
    <span className="inline-flex items-center gap-2">
      {err && <span className="text-xs text-status-rejected">{err}</span>}
      <Button variant="outline" onClick={run} disabled={busy} className="text-status-rejected border-status-rejected/40 hover:bg-status-rejected/5">
        <Icon name="delete" className="text-[18px]" />{busy ? 'Deleting…' : 'Delete ticket'}
      </Button>
    </span>
  )
}
