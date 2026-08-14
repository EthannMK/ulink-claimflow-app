import { useQuery } from '@tanstack/react-query'
import { listNotifs } from '../lib/api'
import { PageTitle, Card, Icon } from '../components/ui'
import { timeAgo } from '../lib/format'

export function NotificationsPage() {
  const { data } = useQuery({ queryKey: ['notifs'], queryFn: listNotifs })
  return (
    <div>
      <PageTitle title="Notifications" />
      <Card>
        {(data ?? []).map((n, i) => (
          <div key={n.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-outline-variant' : ''} ${n.unread ? 'bg-status-ai/5' : ''}`}>
            <div className="w-9 h-9 rounded-full bg-surface-container grid place-items-center">
              <Icon name={n.icon} className="text-[20px] text-primary" />
            </div>
            <div className="flex-1">
              <div className="text-sm text-on-surface">{n.text} <span className="text-primary font-medium">{n.ref}</span></div>
              <div className="text-xs text-outline">{timeAgo(n.at)}</div>
            </div>
            {n.unread && <span className="w-2 h-2 rounded-full bg-status-ai" />}
          </div>
        ))}
      </Card>
    </div>
  )
}
