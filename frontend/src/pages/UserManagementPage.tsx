import { useState, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listUsers, createUser, deleteUser, updateUser } from '../lib/api'
import { getRole } from '../lib/auth'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'
import { usePersistent, genId } from '../lib/persist'

interface Team { id: string; name: string; lead: string; members: string[] } // members = usernames

const roleCls: Record<string, string> = {
  super_admin: 'bg-brand-accent/10 text-brand-accent', admin: 'bg-primary/10 text-primary',
  jd1: 'bg-status-ai/10 text-status-ai', jd2: 'bg-secondary/10 text-secondary',
  jd3: 'bg-status-approved/10 text-status-approved', jd4: 'bg-status-pending/10 text-status-pending',
  csr: 'bg-brand-accent/10 text-brand-accent', user: 'bg-status-ai/10 text-status-ai',
}
export function UserManagementPage() {
  const qc = useQueryClient()
  const isSuper = getRole() === 'super_admin'
  const { data } = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ username: '', name: '', email: '', role: 'user', password: '', team: '' })
  const [msg, setMsg] = useState('')
  const [teams, setTeams] = usePersistent<Team[]>('teams', [])
  const [teamName, setTeamName] = useState('')
  const [resetId, setResetId] = useState<string | null>(null)
  const [newPw, setNewPw] = useState('')
  const [resetMsg, setResetMsg] = useState('')

  async function resetPassword(id: string) {
    setResetMsg('')
    if (newPw.length < 6) { setResetMsg('Min 6 characters'); return }
    const r = await updateUser(id, { password: newPw })
    if (r.ok) { setResetId(null); setNewPw(''); setResetMsg('') }
    else setResetMsg((await r.json().catch(() => ({}))).detail || 'Failed')
  }
  async function submit() {
    const { team, ...payload } = form
    const r = await createUser(payload)
    if (r.ok) {
      if (team) setTeams((ts) => ts.map((t) => t.id === team ? { ...t, members: Array.from(new Set([...t.members, form.username])) } : t))
      setOpen(false); setForm({ username: '', name: '', email: '', role: 'user', password: '', team: '' }); setMsg(''); qc.invalidateQueries({ queryKey: ['users'] })
    } else setMsg((await r.json().catch(() => ({}))).detail || 'Failed to create user')
  }
  function toggleMember(teamId: string, username: string) {
    setTeams((ts) => ts.map((t) => t.id === teamId ? { ...t, members: t.members.includes(username) ? t.members.filter((m) => m !== username) : [...t.members, username] } : t))
  }
  async function remove(id: string) {
    const r = await deleteUser(id); if (r.ok) qc.invalidateQueries({ queryKey: ['users'] })
  }
  return (
    <div>
      <PageTitle title="Users & Teams" sub={isSuper ? 'Super Admin — manage users' : 'View only (user management is restricted to Super Admin)'}
        action={isSuper ? <Button onClick={() => setOpen(!open)}><Icon name="person_add" className="text-[18px]" /> Invite user</Button> : undefined} />

      {open && isSuper && (
        <Card className="p-4 mb-4 grid grid-cols-5 gap-2 items-end">
          {(['username', 'name', 'email', 'password'] as const).map((k) => (
            <div key={k}><label className="block text-xs text-text-main mb-1 capitalize">{k}</label>
              <input value={(form as any)[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full text-sm border border-outline-variant rounded-md px-2 py-1.5" /></div>
          ))}
          <div><label className="block text-xs text-text-main mb-1">Role</label>
            <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className="w-full text-sm border border-outline-variant rounded-md px-2 py-1.5">
              <option value="user">user</option><option value="admin">admin</option><option value="super_admin">super_admin</option></select></div>
          <div><label className="block text-xs text-text-main mb-1">Team</label>
            <select value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })} className="w-full text-sm border border-outline-variant rounded-md px-2 py-1.5">
              <option value="">— none —</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></div>
          <div className="col-span-5 flex items-center gap-2"><Button size="sm" onClick={submit}>Create</Button><Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>{msg && <span className="text-xs text-status-rejected">{msg}</span>}</div>
        </Card>
      )}

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
            <tr>{['Name', 'Email', 'Role', 'Status', ''].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(data ?? []).map((u: any) => (
              <Fragment key={u.id}>
              <tr className="border-t border-outline-variant hover:bg-surface-container/50">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-text-main">{u.email}</td>
                <td className="px-4 py-3"><Badge className={roleCls[u.role] || 'bg-surface-container'}>{String(u.role).replace('_', ' ').toUpperCase()}</Badge></td>
                <td className="px-4 py-3"><Badge className="bg-status-approved/10 text-status-approved">{u.active ? 'Active' : 'Disabled'}</Badge></td>
                <td className="px-4 py-3 text-right whitespace-nowrap">{isSuper && <>
                  <button onClick={() => { setResetId(resetId === u.id ? null : u.id); setNewPw(''); setResetMsg('') }} className="text-xs text-primary hover:underline mr-3">Reset password</button>
                  <button onClick={() => remove(u.id)} className="text-xs text-status-rejected hover:underline">Delete</button>
                </>}</td>
              </tr>
              {isSuper && resetId === u.id && (
                <tr className="bg-primary/[0.03]">
                  <td colSpan={5} className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-text-main">New password for <b>{u.name}</b>:</span>
                      <input type="text" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="min 6 characters"
                        className="text-sm border border-outline-variant rounded-md px-2 py-1 w-56" />
                      <Button size="sm" onClick={() => resetPassword(u.id)}>Set password</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setResetId(null); setNewPw('') }}>Cancel</Button>
                      {resetMsg && <span className="text-xs text-status-rejected">{resetMsg}</span>}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Teams */}
      <div className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold text-primary">Teams</h2>
          {isSuper && (
            <div className="flex items-center gap-2">
              <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="New team name (e.g. JD1 Intake)" className="text-sm border border-outline-variant rounded-md px-2 py-1.5 w-56" />
              <Button size="sm" onClick={() => { if (teamName.trim()) { setTeams([...teams, { id: genId(), name: teamName.trim(), lead: '', members: [] }]); setTeamName('') } }}><Icon name="group_add" className="text-[16px]" />Create team</Button>
            </div>
          )}
        </div>
        {teams.length === 0 ? (
          <Card className="p-8 text-center text-sm text-text-main"><Icon name="groups" className="text-[28px] text-outline" /><p className="mt-1">No teams yet. Create one, then map users to it.</p></Card>
        ) : (
          <div className="grid grid-cols-2 gap-4">
            {teams.map((t) => (
              <Card key={t.id} className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon name="groups" className="text-[18px]" /></div>
                  <div className="font-semibold text-sm flex-1">{t.name}</div>
                  <Badge className="bg-surface-container">{t.members.length} member(s)</Badge>
                  {isSuper && <button onClick={() => setTeams(teams.filter((x) => x.id !== t.id))} className="text-xs text-status-rejected">Delete</button>}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <label className="text-xs text-text-main">Team lead:</label>
                  <select value={t.lead} onChange={(e) => setTeams(teams.map((x) => x.id === t.id ? { ...x, lead: e.target.value } : x))} className="text-xs border border-outline-variant rounded px-1.5 py-1">
                    <option value="">—</option>{(data ?? []).filter((u: any) => t.members.includes(u.username)).map((u: any) => <option key={u.id} value={u.username}>{u.name}</option>)}
                  </select>
                </div>
                <div className="text-xs text-text-main mb-1">Members:</div>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {(data ?? []).map((u: any) => (
                    <label key={u.id} className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" disabled={!isSuper} checked={t.members.includes(u.username)} onChange={() => toggleMember(t.id, u.username)} />{u.name}
                    </label>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
