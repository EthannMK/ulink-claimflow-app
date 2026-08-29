import { PageTitle, Card, Icon, Button } from '../components/ui'
import { roleCaps, roleCols, roleMatrix } from '../mocks/admin'
import { usePersistent } from '../lib/persist'

export function RolesPage() {
  const [matrix, setMatrix] = usePersistent<Record<string, boolean[]>>('roles',
    Object.fromEntries(Object.entries(roleMatrix).map(([k, v]) => [k, [...v]])))

  function toggle(cap: string, i: number) {
    setMatrix((m) => ({ ...m, [cap]: (m[cap] || roleMatrix[cap]).map((on, j) => j === i ? !on : on) }))
  }
  function reset() { setMatrix(Object.fromEntries(Object.entries(roleMatrix).map(([k, v]) => [k, [...v]]))) }

  return (
    <div>
      <PageTitle title="Roles & Permissions" sub="Click a cell to grant or revoke. Changes are saved automatically."
        action={<Button variant="outline" onClick={reset}>Reset to defaults</Button>} />
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
                {(matrix[cap] || roleMatrix[cap]).map((on, i) => (
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
      <p className="text-xs text-outline mt-3">Saved in your browser now; moves to shared server storage (and starts enforcing access) with the database layer.</p>
    </div>
  )
}
