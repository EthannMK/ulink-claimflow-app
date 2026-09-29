import { useEffect, useMemo, useState, Fragment } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listUsers, createUser, deleteUser, updateUser, listTeams, saveTeam, removeTeam, type Team } from '../lib/api'
import { getRole, getUsername } from '../lib/auth'
import { PageTitle, Card, Badge, Button, Icon } from '../components/ui'
import { LimitEditor } from '../components/LimitEditor'
import type { User } from '../lib/types'

const ROLES: [string, string, string][] = [
  ['user', 'User', 'Works claims — JD1 scan, JD2, inbox'],
  ['admin', 'Admin', 'Everything except managing users & AI settings'],
  ['super_admin', 'Super Admin', 'Full access incl. users, AI providers, limits'],
]
const roleCls: Record<string, string> = {
  super_admin: 'bg-brand-accent/10 text-brand-accent', admin: 'bg-primary/10 text-primary', user: 'bg-status-ai/10 text-status-ai',
}
const roleLabel = (r: string) => ROLES.find(([v]) => v === r)?.[1] ?? r
const EMPTY_FORM = { username: '', name: '', email: '', role: 'user', password: '', team: '', cap: '', daily: '' }
const input = 'w-full text-sm border border-outline-variant rounded-md px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-primary/20'
const errText = async (r: Response, fallback: string) => (await r.json().catch(() => ({}))).detail || fallback
const money = (n?: number | null) => `$${Number(n ?? 0).toFixed(2)}`

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return <label className="block"><span className="block text-xs font-medium text-text-main mb-1">{label}</span>{children}{hint && <span className="block text-[11px] text-outline mt-0.5">{hint}</span>}</label>
}

export function UserManagementPage() {
  const qc = useQueryClient()
  const isSuper = getRole() === 'super_admin'
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const teams = useQuery({ queryKey: ['teams'], queryFn: listTeams })
  const [tab, setTab] = useState<'users' | 'teams'>('users')
  const [q, setQ] = useState('')
  const [roleFilter, setRoleFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY_FORM)
  const [msg, setMsg] = useState('')
  const [notice, setNotice] = useState('')
  const [panel, setPanel] = useState<{ id: string; kind: 'edit' | 'limits' | 'password' | 'delete' } | null>(null)
  const refresh = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['teams'] }); qc.invalidateQueries({ queryKey: ['usage'] }) }
  const togglePanel = (id: string, kind: 'edit' | 'limits' | 'password' | 'delete') => setPanel((p) => (p?.id === id && p.kind === kind ? null : { id, kind }))

  const list = useMemo(() => (users.data ?? []).filter((u) =>
    (!roleFilter || u.role === roleFilter) &&
    (!q.trim() || `${u.name} ${u.username ?? ''} ${u.email}`.toLowerCase().includes(q.trim().toLowerCase()))), [users.data, q, roleFilter])
  const teamsOf = (username?: string) => (teams.data ?? []).filter((t) => username && t.members.includes(username)).map((t) => t.name)

  // one-time move of teams that used to be saved only in this browser
  useEffect(() => {
    if (!isSuper || !teams.data || teams.data.length) return
    let local: Team[] = []
    try { local = JSON.parse(localStorage.getItem('ulink:teams.v2') || '[]') } catch { /* ignore */ }
    if (!local.length) return
    Promise.all(local.map((t) => saveTeam({ name: t.name, lead: t.lead, members: t.members }).catch(() => null)))
      .then((saved) => {
        localStorage.removeItem('ulink:teams.v2')
        const n = saved.filter(Boolean).length
        if (n) { setNotice(`Moved ${n} team(s) that were only saved in this browser to the server — they're now shared with everyone.`); refresh() }
      })
  }, [isSuper, teams.data])

  async function submit() {
    setMsg('')
    const { team, cap, daily, ...rest } = form
    if (!rest.username.trim() || !rest.name.trim()) { setMsg('Username and full name are required.'); return }
    if (rest.password.length < 8) { setMsg('Password must be at least 8 characters.'); return }
    const capNum = cap.trim() === '' ? null : Number(cap)
    const dayNum = daily.trim() === '' ? null : Number(daily)
    if ([capNum, dayNum].some((v) => v !== null && (isNaN(v) || v < 0))) { setMsg('AI limits must be dollar amounts (e.g. 5 or 0.50), or blank for no limit.'); return }
    const r = await createUser({ ...rest, usage_cap_usd: capNum, daily_cap_usd: dayNum })
    if (!r.ok) { setMsg(await errText(r, 'Failed to create user')); return }
    if (team) {
      const t = teams.data?.find((x) => x.id === team)
      if (t) await saveTeam({ ...t, members: Array.from(new Set([...t.members, rest.username.trim()])) }).catch(() => {})
    }
    setNotice(`User ${rest.username.trim()} created. Share their username and password with them privately.`)
    setOpen(false); setForm(EMPTY_FORM); refresh()
  }

  return (
    <div>
      <PageTitle title="Users & Teams" sub={isSuper ? 'Create accounts, set roles and AI limits, and organise people into teams.' : 'View only — user management is restricted to Super Admin.'}
        action={isSuper && tab === 'users' ? <Button onClick={() => { setOpen(!open); setMsg('') }}><Icon name={open ? 'close' : 'person_add'} className="text-[18px]" />{open ? 'Close' : 'Add user'}</Button> : undefined} />

      {notice && (
        <div className="flex items-center gap-2 bg-status-approved/10 text-status-approved rounded-lg px-3 py-2 mb-4 text-sm">
          <Icon name="check_circle" className="text-[18px]" /><span className="flex-1">{notice}</span>
          <button onClick={() => setNotice('')}><Icon name="close" className="text-[16px]" /></button>
        </div>
      )}

      <div className="flex items-center gap-1 mb-4 bg-surface-container rounded-xl p-1 w-fit" role="tablist">
        {([['users', `Users (${users.data?.length ?? 0})`], ['teams', `Teams (${teams.data?.length ?? 0})`]] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium ${tab === k ? 'bg-white text-primary shadow-sm' : 'text-text-main hover:text-primary'}`}>{l}</button>
        ))}
      </div>

      {tab === 'users' && (<>
        {open && isSuper && (
          <Card className="p-5 mb-4">
            <div className="font-semibold text-primary mb-3">Add a user</div>
            <div className="grid grid-cols-4 gap-3">
              <Field label="Username" hint="Used to sign in. Letters/numbers, no spaces."><input className={input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value.replace(/\s/g, '') })} /></Field>
              <Field label="Full name"><input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
              <Field label="Email"><input className={input} type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
              <Field label="Password" hint="At least 8 characters."><input className={input} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
              <Field label="Role" hint={ROLES.find(([v]) => v === form.role)?.[2]}>
                <select className={input} value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  {ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Team (optional)">
                <select className={input} value={form.team} onChange={(e) => setForm({ ...form, team: e.target.value })}>
                  <option value="">— none —</option>{(teams.data ?? []).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
              <Field label="Total AI limit (USD)" hint="Blank = no limit"><input className={input} inputMode="decimal" value={form.cap} onChange={(e) => setForm({ ...form, cap: e.target.value })} placeholder="e.g. 5" /></Field>
              <Field label="Daily AI limit (USD)" hint="Resets at midnight"><input className={input} inputMode="decimal" value={form.daily} onChange={(e) => setForm({ ...form, daily: e.target.value })} placeholder="e.g. 1" /></Field>
            </div>
            <div className="flex items-center gap-2 mt-4">
              <Button size="sm" onClick={submit}><Icon name="person_add" className="text-[16px]" />Create user</Button>
              <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setForm(EMPTY_FORM); setMsg('') }}>Cancel</Button>
              {msg && <span className="text-xs text-status-rejected">{msg}</span>}
            </div>
          </Card>
        )}

        <div className="flex items-center gap-2 mb-3">
          <div className="flex items-center gap-2 bg-white border border-outline-variant rounded-lg px-3 py-1.5 text-sm w-72">
            <Icon name="search" className="text-[18px] text-outline" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, username, email…" className="outline-none flex-1" />
          </div>
          <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="text-sm bg-white border border-outline-variant rounded-lg px-3 py-1.5">
            <option value="">All roles</option>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <span className="text-xs text-outline ml-auto">{list.length} of {users.data?.length ?? 0} users</span>
        </div>

        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-surface-container/70 text-on-surface-variant text-left text-xs uppercase tracking-wide">
              <tr>{['User', 'Role', 'Status', 'Teams', ...(isSuper ? ['AI spend / limits'] : []), ''].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
            </thead>
            <tbody>
              {users.isLoading && <tr><td colSpan={6} className="px-4 py-6 text-outline">Loading…</td></tr>}
              {list.map((u) => {
                const me = !!u.username && u.username === getUsername()
                return (
                  <Fragment key={u.id}>
                    <tr className={`border-t border-outline-variant ${u.active ? '' : 'opacity-60'} hover:bg-surface-container/40`}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-semibold">{u.name.split(' ').map((x) => x[0]).join('').slice(0, 2).toUpperCase()}</div>
                          <div><div className="font-medium">{u.name}{me && <span className="text-[10px] text-outline ml-1">(you)</span>}</div>
                            <div className="text-xs text-outline">{u.username} · {u.email || 'no email'}</div></div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Badge className={roleCls[u.role] || 'bg-surface-container'}>{roleLabel(u.role)}</Badge></td>
                      <td className="px-4 py-3">{u.active
                        ? <Badge className="bg-status-approved/10 text-status-approved">Active</Badge>
                        : <Badge className="bg-on-surface-variant/10 text-on-surface-variant">Disabled</Badge>}</td>
                      <td className="px-4 py-3 text-xs text-text-main">{teamsOf(u.username).join(', ') || <span className="text-outline">—</span>}</td>
                      {isSuper && <td className="px-4 py-3 whitespace-nowrap text-xs">
                        {([['Today', u.usage_today_usd, u.daily_cap_usd], ['Total', u.usage_spent_usd, u.usage_cap_usd]] as const).map(([label, spent, cap]) => (
                          <div key={label} className="leading-5">
                            <span className="text-outline w-10 inline-block">{label}</span>
                            {cap != null
                              ? <Badge className={Number(spent ?? 0) >= cap ? 'bg-status-rejected/10 text-status-rejected' : 'bg-surface-container'}>{money(spent)} / {money(cap)}</Badge>
                              : <span className="text-text-main">{money(spent)} <span className="text-outline">· no limit</span></span>}
                          </div>
                        ))}
                      </td>}
                      <td className="px-4 py-3 text-right whitespace-nowrap text-xs">
                        {isSuper && (
                          <div className="inline-flex items-center gap-3">
                            <button onClick={() => togglePanel(u.id, 'edit')} className="text-primary hover:underline">Edit</button>
                            <button onClick={() => togglePanel(u.id, 'limits')} className="text-primary hover:underline">AI limits</button>
                            <button onClick={() => togglePanel(u.id, 'password')} className="text-primary hover:underline">Password</button>
                            {!me && <button onClick={() => togglePanel(u.id, 'delete')} className="text-status-rejected hover:underline">Delete</button>}
                          </div>
                        )}
                      </td>
                    </tr>
                    {isSuper && panel?.id === u.id && (
                      <tr className="bg-primary/[0.03]"><td colSpan={6} className="px-4 py-3">
                        {panel.kind === 'edit' && <EditUser u={u} isMe={me} onDone={(n) => { setPanel(null); if (n) setNotice(n); refresh() }} />}
                        {panel.kind === 'limits' && <LimitEditor userId={u.id} name={u.name} total={u.usage_cap_usd} daily={u.daily_cap_usd} onDone={() => { setPanel(null); refresh() }} />}
                        {panel.kind === 'password' && <ResetPassword u={u} onDone={(n) => { setPanel(null); if (n) setNotice(n) }} />}
                        {panel.kind === 'delete' && <ConfirmDelete u={u} onDone={(n) => { setPanel(null); if (n) setNotice(n); refresh() }} />}
                      </td></tr>
                    )}
                  </Fragment>
                )
              })}
              {!users.isLoading && list.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-outline">No users match.</td></tr>}
            </tbody>
          </table>
        </Card>
      </>)}

      {tab === 'teams' && <TeamsTab isSuper={isSuper} users={users.data ?? []} teams={teams.data ?? []} onChange={refresh} setNotice={setNotice} />}
    </div>
  )
}

function EditUser({ u, isMe, onDone }: { u: User; isMe: boolean; onDone: (notice?: string) => void }) {
  const [f, setF] = useState({ name: u.name, email: u.email, role: u.role as string, active: u.active })
  const [msg, setMsg] = useState('')
  async function save() {
    if (!f.name.trim()) { setMsg('Name is required.'); return }
    const r = await updateUser(u.id, { name: f.name.trim(), email: f.email.trim(), role: f.role, active: f.active })
    if (r.ok) onDone(`Saved changes to ${u.username}.`); else setMsg(await errText(r, 'Failed'))
  }
  return (
    <div>
      <div className="grid grid-cols-4 gap-3 items-end">
        <Field label="Full name"><input className={input} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><input className={input} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Role"><select className={input} value={f.role} disabled={isMe} onChange={(e) => setF({ ...f, role: e.target.value })}>{ROLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field label="Account"><label className="flex items-center gap-2 text-sm py-1.5">
          <input type="checkbox" checked={f.active} disabled={isMe} onChange={(e) => setF({ ...f, active: e.target.checked })} />{f.active ? 'Active — can sign in' : 'Disabled — cannot sign in'}</label></Field>
      </div>
      {isMe && <p className="text-[11px] text-outline mt-1">You can't change your own role or disable your own account.</p>}
      <div className="flex items-center gap-2 mt-3"><Button size="sm" onClick={save}>Save changes</Button><Button size="sm" variant="ghost" onClick={() => onDone()}>Cancel</Button>{msg && <span className="text-xs text-status-rejected">{msg}</span>}</div>
    </div>
  )
}

function ResetPassword({ u, onDone }: { u: User; onDone: (notice?: string) => void }) {
  const [pw, setPw] = useState('')
  const [msg, setMsg] = useState('')
  async function save() {
    if (pw.length < 8) { setMsg('At least 8 characters.'); return }
    const r = await updateUser(u.id, { password: pw })
    if (r.ok) onDone(`Password for ${u.username} was changed. Share it with them privately.`); else setMsg(await errText(r, 'Failed'))
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className="text-xs text-text-main">New password for <b>{u.name}</b>:</span>
      <input type="text" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="at least 8 characters" className="text-sm border border-outline-variant rounded-md px-2 py-1 w-56" />
      <Button size="sm" onClick={save}>Set password</Button><Button size="sm" variant="ghost" onClick={() => onDone()}>Cancel</Button>
      {msg && <span className="text-xs text-status-rejected">{msg}</span>}
    </div>
  )
}

function ConfirmDelete({ u, onDone }: { u: User; onDone: (notice?: string) => void }) {
  const [msg, setMsg] = useState('')
  async function go() {
    const r = await deleteUser(u.id)
    if (r.ok) onDone(`Deleted ${u.username}.`); else setMsg(await errText(r, 'Failed'))
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Icon name="warning" className="text-status-rejected text-[18px]" />
      <span className="text-sm">Delete <b>{u.name}</b> ({u.username}) permanently? Tip: <i>Edit → Disabled</i> blocks sign-in but keeps their history.</span>
      <Button size="sm" onClick={go}>Yes, delete</Button><Button size="sm" variant="ghost" onClick={() => onDone()}>Cancel</Button>
      {msg && <span className="text-xs text-status-rejected">{msg}</span>}
    </div>
  )
}

function TeamsTab({ isSuper, users, teams, onChange, setNotice }: {
  isSuper: boolean; users: User[]; teams: Team[]; onChange: () => void; setNotice: (s: string) => void
}) {
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  async function create() {
    setMsg('')
    if (!name.trim()) { setMsg('Enter a team name.'); return }
    try { await saveTeam({ name: name.trim(), lead: '', members: [] }); setName(''); setNotice(`Team "${name.trim()}" created — now tick its members below.`); onChange() }
    catch (e: any) { setMsg(String(e?.message ?? e)) }
  }
  return (
    <div>
      {isSuper && (
        <Card className="p-4 mb-4 flex items-center gap-2 flex-wrap">
          <Icon name="group_add" className="text-primary" />
          <input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') create() }}
            placeholder="New team name (e.g. JD1 Intake)" className="text-sm border border-outline-variant rounded-md px-2.5 py-1.5 w-72" />
          <Button size="sm" onClick={create}>Create team</Button>
          {msg && <span className="text-xs text-status-rejected">{msg}</span>}
          <span className="text-[11px] text-outline ml-auto">Teams are saved on the server and shared with everyone.</span>
        </Card>
      )}
      {teams.length === 0 ? (
        <Card className="p-10 text-center text-sm text-text-main"><Icon name="groups" className="text-[32px] text-outline" /><p className="mt-2">No teams yet.{isSuper ? ' Create one above, then tick its members.' : ''}</p></Card>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {teams.map((t) => <TeamCard key={t.id} team={t} users={users} isSuper={isSuper} onChange={onChange} />)}
        </div>
      )}
    </div>
  )
}

function TeamCard({ team, users, isSuper, onChange }: { team: Team; users: User[]; isSuper: boolean; onChange: () => void }) {
  const [t, setT] = useState(team)
  const [renaming, setRenaming] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setT(team) }, [team])
  async function persist(next: Team) {
    setT(next); setMsg('')
    try { await saveTeam(next); onChange() } catch (e: any) { setMsg(String(e?.message ?? e)); setT(team) }
  }
  const toggle = (username: string) => {
    const members = t.members.includes(username) ? t.members.filter((m) => m !== username) : [...t.members, username]
    persist({ ...t, members, lead: members.includes(t.lead) ? t.lead : '' })
  }
  return (
    <Card className="p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary grid place-items-center"><Icon name="groups" className="text-[20px]" /></div>
        {renaming
          ? <input autoFocus defaultValue={t.name} onBlur={(e) => { setRenaming(false); if (e.target.value.trim() && e.target.value.trim() !== t.name) persist({ ...t, name: e.target.value.trim() }) }}
              onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') setRenaming(false) }}
              className="flex-1 text-sm font-semibold border border-outline-variant rounded-md px-2 py-1" />
          : <div className="font-semibold text-sm flex-1">{t.name}</div>}
        <Badge className="bg-surface-container">{t.members.length} member{t.members.length === 1 ? '' : 's'}</Badge>
        {isSuper && !renaming && <button onClick={() => setRenaming(true)} className="text-xs text-primary hover:underline">Rename</button>}
        {isSuper && <button onClick={() => setConfirmDel(!confirmDel)} className="text-xs text-status-rejected hover:underline">Delete</button>}
      </div>
      {confirmDel && (
        <div className="flex items-center gap-2 bg-status-rejected/5 rounded-md px-2 py-1.5 mb-2 text-xs">
          <span className="flex-1">Delete team "{t.name}"? Users are not deleted.</span>
          <Button size="sm" onClick={async () => { try { await removeTeam(t.id); onChange() } catch (e: any) { setMsg(String(e?.message ?? e)) } }}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmDel(false)}>Cancel</Button>
        </div>
      )}
      <div className="flex items-center gap-2 mb-2 text-xs">
        <span className="text-text-main w-20">Team lead</span>
        <select value={t.lead} disabled={!isSuper} onChange={(e) => persist({ ...t, lead: e.target.value })} className="border border-outline-variant rounded px-2 py-1">
          <option value="">— none —</option>
          {users.filter((u) => u.username && t.members.includes(u.username)).map((u) => <option key={u.id} value={u.username}>{u.name}</option>)}
        </select>
        {t.members.length === 0 && <span className="text-outline">tick members first</span>}
      </div>
      <div className="text-xs text-text-main mb-1.5">Members</div>
      <div className="flex flex-wrap gap-1.5">
        {users.map((u) => {
          const on = !!u.username && t.members.includes(u.username)
          return (
            <button key={u.id} disabled={!isSuper || !u.username} onClick={() => u.username && toggle(u.username)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${on ? 'bg-primary text-white border-primary' : 'bg-white border-outline-variant text-text-main hover:border-primary'} disabled:cursor-default`}>
              {on && <Icon name="check" className="text-[12px] mr-0.5 align-middle" />}{u.name}
            </button>
          )
        })}
      </div>
      {msg && <p className="text-xs text-status-rejected mt-2">{msg}</p>}
    </Card>
  )
}
