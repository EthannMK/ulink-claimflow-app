import { useState, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listUsers, createUser, deleteUser, updateUser } from '../lib/api'
import { getRole } from '../lib/auth'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'

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
  const [form, setForm] = useState({ username: '', name: '', email: '', role: 'user', password: '' })
  const [msg, setMsg] = useState('')
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
    const r = await createUser(form)
    if (r.ok) { setOpen(false); setForm({ username: '', name: '', email: '', role: 'user', password: '' }); setMsg(''); qc.invalidateQueries({ queryKey: ['users'] }) }
    else setMsg((await r.json().catch(() => ({}))).detail || 'Failed to create user')
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
    </div>
  )
}
