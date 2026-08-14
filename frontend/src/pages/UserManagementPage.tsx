import { useQuery } from '@tanstack/react-query'
import { listUsers } from '../lib/api'
import { PageTitle, Card, Badge, Button } from '../components/ui'

const roleCls: Record<string, string> = {
  admin: 'bg-primary/10 text-primary', jd1: 'bg-status-ai/10 text-status-ai',
  jd2: 'bg-secondary/10 text-secondary', jd3: 'bg-status-approved/10 text-status-approved',
  jd4: 'bg-status-pending/10 text-status-pending', csr: 'bg-brand-accent/10 text-brand-accent',
}
export function UserManagementPage() {
  const { data } = useQuery({ queryKey: ['users'], queryFn: listUsers })
  return (
    <div>
      <PageTitle title="Users & Teams" sub="Admin only" action={<Button>Invite user</Button>} />
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-container text-on-surface-variant text-left">
            <tr>{['Name','Email','Role','Team','Status'].map(h => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
          </thead>
          <tbody>
            {(data ?? []).map(u => (
              <tr key={u.id} className="border-t border-outline-variant hover:bg-surface-container/50">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-text-main">{u.email}</td>
                <td className="px-4 py-3"><Badge className={roleCls[u.role]}>{u.role.toUpperCase()}</Badge></td>
                <td className="px-4 py-3">{u.team}</td>
                <td className="px-4 py-3"><Badge className="bg-status-approved/10 text-status-approved">{u.active ? 'Active' : 'Disabled'}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
