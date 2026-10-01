import { useQuery } from '@tanstack/react-query'
import { getAssignees } from '../lib/jd1'
import { Icon } from './ui'

/** "Assigned to" dropdown used on the JD2 claim, the ticket page and the Inbox.
 *  The list comes from the server and works for every role (filtered by Settings →
 *  Assignment permissions). Value = username; `currentName` covers older data that only
 *  stored a display name. */
export function AssignPicker({ value, currentName, onChange, disabled, compact }: {
  value?: string | null; currentName?: string | null; onChange: (username: string) => void
  disabled?: boolean; compact?: boolean
}) {
  const { data, error } = useQuery({ queryKey: ['assignees'], queryFn: getAssignees, staleTime: 60_000 })
  const list = data ?? []
  const match = list.find((u) => u.username === value) ?? list.find((u) => u.name === currentName)
  const sel = match?.username ?? ''
  const orphan = !match && (value || currentName)   // assigned to someone you may not pick
  return (
    <label className={`inline-flex items-center gap-1 ${compact ? 'text-xs' : 'text-sm'}`} title={error ? String((error as Error).message) : 'Assign to a team member'}>
      <Icon name="person" className="text-[16px] text-outline" />
      <select value={orphan ? '__orphan' : sel} disabled={disabled} onChange={(e) => onChange(e.target.value === '__orphan' ? (value || '') : e.target.value)}
        className={`border border-outline-variant rounded-md bg-white ${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'} disabled:opacity-60`}>
        <option value="">Unassigned</option>
        {orphan && <option value="__orphan">{currentName || value}</option>}
        {list.map((u) => <option key={u.username} value={u.username}>{u.name}</option>)}
      </select>
    </label>
  )
}
