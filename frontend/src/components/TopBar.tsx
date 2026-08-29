import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon } from './ui'
import { getName, getRole, getAvatar, clearSession } from '../lib/auth'
import { usePersistent } from '../lib/persist'
import { timeAgo } from '../lib/format'
import type { Notif } from '../mocks/notifications'

export function TopBar() {
  const nav = useNavigate()
  const roleLabel: Record<string, string> = { super_admin: 'Super Admin', admin: 'Administrator', user: 'Agent' }
  const role = getRole(); const name = getName()
  const [avatar, setAvatar] = useState(getAvatar())
  const [menu, setMenu] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [notifs, setNotifs] = usePersistent<Notif[]>('notifs', [])
  const ref = useRef<HTMLDivElement>(null)
  const notifRef = useRef<HTMLDivElement>(null)
  const unread = notifs.filter((n) => n.unread).length

  useEffect(() => {
    const onAvatar = () => setAvatar(getAvatar())
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setMenu(false)
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false)
    }
    window.addEventListener('cf-avatar', onAvatar)
    document.addEventListener('mousedown', onClick)
    return () => { window.removeEventListener('cf-avatar', onAvatar); document.removeEventListener('mousedown', onClick) }
  }, [])

  function logout() { clearSession(); nav('/login') }

  return (
    <header className="h-16 bg-white border-b border-outline-variant flex items-center gap-4 px-6">
      <div className="max-w-md w-full">
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20">
          <Icon name="search" className="text-[20px] text-outline" />
          <input placeholder="Search claims, members, tickets…" className="bg-transparent outline-none text-sm w-full placeholder:text-outline" />
        </div>
      </div>

      <div className="relative ml-auto" ref={notifRef}>
        <button onClick={() => setNotifOpen((v) => !v)} title="Notifications" className="relative w-9 h-9 rounded-lg hover:bg-surface-container grid place-items-center">
          <Icon name="notifications" className="text-[20px] text-text-main" />
          {unread > 0 && <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-brand-accent text-white text-[9px] grid place-items-center">{unread}</span>}
        </button>
        {notifOpen && (
          <div className="absolute right-0 mt-1 w-80 bg-white border border-outline-variant rounded-lg shadow-lg z-20">
            <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant">
              <span className="text-sm font-semibold">Notifications</span>
              {unread > 0 && <button onClick={() => setNotifs(notifs.map((n) => ({ ...n, unread: false })))} className="text-xs text-primary">Mark all read</button>}
            </div>
            <div className="max-h-80 overflow-y-auto">
              {notifs.length === 0 && <p className="text-xs text-outline text-center py-6">No notifications.</p>}
              {notifs.slice(0, 6).map((n) => (
                <button key={n.id} onClick={() => setNotifs(notifs.map((x) => x.id === n.id ? { ...x, unread: false } : x))}
                  className={`w-full text-left flex items-start gap-2 px-3 py-2 hover:bg-surface-container ${n.unread ? 'bg-status-ai/5' : ''}`}>
                  <Icon name={n.icon} className="text-[18px] text-primary mt-0.5" />
                  <div className="flex-1"><div className="text-xs text-on-surface">{n.text} {n.ref && <span className="text-primary font-medium">{n.ref}</span>}</div>
                    <div className="text-[11px] text-outline">{timeAgo(n.at)}</div></div>
                  {n.unread && <span className="w-1.5 h-1.5 rounded-full bg-status-ai mt-1.5" />}
                </button>
              ))}
            </div>
            <button onClick={() => { setNotifOpen(false); nav('/notifications') }} className="w-full text-center text-xs text-primary py-2 border-t border-outline-variant hover:bg-surface-container">View all</button>
          </div>
        )}
      </div>

      <div className="relative" ref={ref}>
        <button onClick={() => setMenu((v) => !v)} className="flex items-center gap-2 pl-2 border-l border-outline-variant hover:bg-surface-container/60 rounded-lg py-1 pr-2">
          {avatar
            ? <img src={avatar} alt={name} className="w-8 h-8 rounded-full object-cover" />
            : <div className="w-8 h-8 rounded-full bg-primary text-white grid place-items-center text-sm font-semibold">{name[0]?.toUpperCase()}</div>}
          <div className="leading-tight text-left">
            <div className="text-sm font-medium text-on-surface">{name}</div>
            <div className="text-[11px] text-outline">{roleLabel[role] || role}</div>
          </div>
          <Icon name="expand_more" className="text-[18px] text-outline" />
        </button>
        {menu && (
          <div className="absolute right-0 mt-1 w-44 bg-white border border-outline-variant rounded-lg shadow-lg py-1 z-20">
            <button onClick={() => { setMenu(false); nav('/profile') }} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface-container"><Icon name="person" className="text-[18px] text-text-main" />My profile</button>
            <button onClick={() => { setMenu(false); nav('/profile') }} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface-container"><Icon name="lock" className="text-[18px] text-text-main" />Change password</button>
            <div className="border-t border-outline-variant/60 my-1" />
            <button onClick={logout} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface-container text-status-rejected"><Icon name="logout" className="text-[18px]" />Sign out</button>
          </div>
        )}
      </div>
    </header>
  )
}
