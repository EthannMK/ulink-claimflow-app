import { useState } from 'react'
import { PageTitle, Card, Icon, Button } from '../components/ui'
import { timeAgo } from '../lib/format'
import { usePersistent, genId } from '../lib/persist'
import type { Notif } from '../mocks/notifications'

export function NotificationsPage() {
  const [items, setItems] = usePersistent<Notif[]>('notifs', [])
  const [adding, setAdding] = useState(false)
  const [text, setText] = useState('')
  const [ref, setRef] = useState('')
  const unreadCount = items.filter((n) => n.unread).length

  function add() {
    if (!text.trim()) return
    setItems([{ id: genId(), icon: 'notifications', text: text.trim(), ref: ref.trim(), at: new Date().toISOString(), unread: true }, ...items])
    setText(''); setRef(''); setAdding(false)
  }
  function markAll() { setItems(items.map((n) => ({ ...n, unread: false }))) }
  function toggle(id: string) { setItems(items.map((n) => n.id === id ? { ...n, unread: !n.unread } : n)) }
  function remove(id: string) { setItems(items.filter((n) => n.id !== id)) }

  return (
    <div>
      <PageTitle title="Notifications" sub={unreadCount ? `${unreadCount} unread` : 'All caught up'}
        action={<div className="flex gap-2">
          <Button variant="outline" onClick={markAll} disabled={!unreadCount}><Icon name="done_all" className="text-[16px]" />Mark all read</Button>
          <Button onClick={() => setAdding((v) => !v)}><Icon name="add" className="text-[16px]" />New notification</Button>
        </div>} />

      {adding && (
        <Card className="p-4 mb-4">
          <div className="flex items-center gap-2 flex-wrap">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Notification message" className="flex-1 min-w-[240px] text-sm border border-outline-variant rounded-md px-2 py-1.5" />
            <input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Reference (optional)" className="w-40 text-sm border border-outline-variant rounded-md px-2 py-1.5" />
            <Button size="sm" onClick={add}>Add</Button>
            <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Button>
          </div>
        </Card>
      )}

      {items.length === 0 ? (
        <Card className="p-10 text-center"><Icon name="notifications_off" className="text-[32px] text-outline" /><p className="text-sm text-text-main mt-2">No notifications yet.</p></Card>
      ) : (
        <Card>
          {items.map((n, i) => (
            <div key={n.id} className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-outline-variant' : ''} ${n.unread ? 'bg-status-ai/5' : ''}`}>
              <button onClick={() => toggle(n.id)} className="w-9 h-9 rounded-full bg-surface-container grid place-items-center shrink-0" title="Toggle read">
                <Icon name={n.icon} className="text-[20px] text-primary" />
              </button>
              <div className="flex-1">
                <div className="text-sm text-on-surface">{n.text} {n.ref && <span className="text-primary font-medium">{n.ref}</span>}</div>
                <div className="text-xs text-outline">{timeAgo(n.at)}</div>
              </div>
              {n.unread && <span className="w-2 h-2 rounded-full bg-status-ai" title="Unread" />}
              <button onClick={() => remove(n.id)} className="text-xs text-status-rejected hover:underline">Delete</button>
            </div>
          ))}
        </Card>
      )}
    </div>
  )
}
