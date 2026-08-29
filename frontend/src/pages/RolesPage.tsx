import { useState } from 'react'
import { PageTitle, Card, Icon, Button } from '../components/ui'
import { roleCaps, roleCols, roleMatrix } from '../mocks/admin'
import { usePersistent } from '../lib/persist'

const clone = (m: Record<string, boolean[]>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, [...v]]))

export function RolesPage() {
  const [saved, setSaved] = usePersistent<Record<string, boolean[]>>('settings.roles.v2', clone(roleMatrix))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Record<string, boolean[]>>(clone(saved))
  const [flash, setFlash] = useState('')

  const view = editing ? draft : saved
  function toggle(cap: string, i: number) {
    setDraft((m) => ({ ...m, [cap]: (m[cap] || roleMatrix[cap]).map((on, j) => j === i ? !on : on) }))
  }
  function startEdit() { setDraft(clone(saved)); setEditing(true); setFlash('') }
  function save() { setSaved(clone(draft)); setEditing(false); setFlash('Permissions saved ✓') }
  function cancel() { setEditing(false); setFlash('') }

  return (
    <div>
      <PageTitle title="Roles & Permissions" sub="What each role can see and do across the system. Edit, review, then save."
        action={editing
          ? <div className="flex gap-2"><Button variant="ghost" onClick={cancel}>Cancel</Button><Button onClick={save}>Save changes</Button></div>
          : <Button onClick={startEdit}><Icon name="edit" className="text-[16px]" />Edit permissions</Button>} />
      {flash && <div className="mb-3 text-sm text-status-approved flex items-center gap-1"><Icon name="check_circle" className="text-[18px]" />{flash}</div>}
      {editing && <div className="mb-3 text-xs text-status-pending flex items-center gap-1"><Icon name="edit" className="text-[16px]" />Editing — changes aren't applied until you click <b>Save changes</b>.</div>}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 font-semibold text-left">Capability</th>
              {roleCols.map((r) => <th key={r} className="px-3 py-3 font-semibold text-center">{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {roleCaps.map((cap) => (
              <tr key={cap} className="border-t border-outline-variant">
                <td className="px-4 py-2.5">{cap}</td>
                {(view[cap] || roleMatrix[cap]).map((on, i) => (
                  <td key={i} className="px-3 py-2.5 text-center">
                    {editing ? (
                      <button onClick={() => toggle(cap, i)} title="Toggle" className="grid place-items-center w-full">
                        {on ? <Icon name="check_circle" className="text-[18px] text-status-approved hover:opacity-70" />
                            : <Icon name="radio_button_unchecked" className="text-[18px] text-outline-variant hover:text-outline" />}
                      </button>
                    ) : (
                      on ? <Icon name="check_circle" className="text-[18px] text-status-approved" /> : <Icon name="remove" className="text-[16px] text-outline-variant" />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-outline mt-3">Saved in your browser now; enforced server-side (and gating real access) once the auth/RBAC backend is in.</p>
    </div>
  )
}
