import { useState } from 'react'
import { PageTitle, Card, Icon, Button } from '../components/ui'
import { roleCaps, roleCols, roleMatrix } from '../mocks/admin'

export function RolesPage() {
  const [matrix, setMatrix] = useState<Record<string, boolean[]>>(() =>
    Object.fromEntries(Object.entries(roleMatrix).map(([k, v]) => [k, [...v]])))
  const [saved, setSaved] = useState(false)

  function toggle(cap: string, i: number) {
    setMatrix((m) => ({ ...m, [cap]: m[cap].map((on, j) => j === i ? !on : on) }))
    setSaved(false)
  }
  function reset() { setMatrix(Object.fromEntries(Object.entries(roleMatrix).map(([k, v]) => [k, [...v]]))); setSaved(false) }

  return (
    <div>
      <PageTitle title="Roles & Permissions" sub="Click a cell to grant or revoke. Admin has full access; agents are scoped to their work."
        action={<div className="flex gap-2"><Button variant="outline" onClick={reset}>Reset</Button><Button onClick={() => setSaved(true)}>Save changes</Button></div>} />
      {saved && <div className="mb-3 text-sm text-status-approved flex items-center gap-1"><Icon name="check_circle" className="text-[18px]" />Permissions saved.</div>}
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container/70 text-on-surface-variant text-xs uppercase tracking-wide">
            <tr>
              <th className="px-4 py-3 font-semibold text-left">Capability</th>
              {roleCols.map((r) => <th key={r} className="px-4 py-3 font-semibold text-center">{r}</th>)}
            </tr>
          </thead>
          <tbody>
            {roleCaps.map((cap) => (
              <tr key={cap} className="border-t border-outline-variant">
                <td className="px-4 py-2.5">{cap}</td>
                {matrix[cap].map((on, i) => (
                  <td key={i} className="px-4 py-2.5 text-center">
                    <button onClick={() => toggle(cap, i)} title="Toggle" className="grid place-items-center w-full">
                      {on
                        ? <Icon name="check_circle" className="text-[18px] text-status-approved hover:opacity-70" />
                        : <Icon name="radio_button_unchecked" className="text-[18px] text-outline-variant hover:text-outline" />}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-outline mt-3">POC: changes are held in the browser. When hosted, these persist to the backend and drive what each role can access.</p>
    </div>
  )
}
