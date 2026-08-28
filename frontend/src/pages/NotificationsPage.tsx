import { useEffect, useState } from 'react'
import { listNotifs } from '../lib/api'
import { PageTitle, Card, Icon, Button } from '../components/ui'
import { timeAgo } from '../lib/format'
import type { Notif } from '../mocks/notifications'

export function NotificationsPage() {
  const [items, setItems] = useState<Notif[]>([])
  useEffect(() => { listNotifs().then(setItems) }, [])
  const unreadCount = items.filter((n) => n.unread).length

  function markAll() { setItems((ns) => ns.map((n) => ({ ...n, unread: false }))) }
  function toggle(id: string) { setItems((ns) => ns.map((n) => n.id === id ? { ...n, unread: !n.unread } : n)) }

  return (
    <div>
      <PageTitle title="Notifications" sub={unreadCount ? `${unreadCount} unread` : 'All caught up'}
        action={<Button variant="outline" onClick={markAll} disabled={!unreadCount}><Icon name="done_all" className="text-[16px]" />Mark all read</Button>} />
      <Card>
        {items.map((n, i) => (
          <button key={n.id} onClick={() => toggle(n.id)}
            className={`w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-surface-container/50 ${i > 0 ? 'border-t border-outline-variant' : ''} ${n.unread ? 'bg-status-ai/5' : ''}`}>
            <div className="w-9 h-9 rounded-full bg-surface-container grid place-items-center">
              <Icon name={n.icon} className="text-[20px] text-primary" />
            </div>
            <div className="flex-1">
              <div className="text-sm text-on-surface">{n.text} <span className="text-primary font-medium">{n.ref}</span></div>
              <div className="text-xs text-outline">{timeAgo(n.at)}</div>
            </div>
            {n.unread
              ? <span className="w-2 h-2 rounded-full bg-status-ai" title="Unread" />
              : <Icon name="check" className="text-[16px] text-outline" />}
          </button>
        ))}
      </Card>
    </div>
  )
}
