import { PageTitle, Card, Icon } from '../components/ui'
import { roleCaps, roleCols, roleMatrix } from '../mocks/admin'
export function RolesPage() {
  return (
    <div>
      <PageTitle title="Roles & Permissions" sub="What each role can see and do. Admin has full access; agents are scoped to their work." />
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
                {roleMatrix[cap].map((on, i) => (
                  <td key={i} className="px-4 py-2.5 text-center">
                    {on ? <Icon name="check_circle" className="text-[18px] text-status-approved" /> : <Icon name="remove" className="text-[18px] text-outline-variant" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
