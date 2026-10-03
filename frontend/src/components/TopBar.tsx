import { useEffect, useRef, useState } from 'react'
import { jd1Runner } from '../lib/jd1Runner'
import { jd1Workspace } from '../lib/jd1Workspace'
import { clearChat } from './ChatWidget'
import { useNavigate } from 'react-router-dom'
import { Icon } from './ui'
import { getName, getRole, getAvatar, clearSession } from '../lib/auth'
import { usePersistent } from '../lib/persist'
import { timeAgo } from '../lib/format'
import { getTheme, setTheme, type ThemeChoice } from '../lib/theme'
import type { Notif } from '../mocks/notifications'

export function TopBar({ onMenu }: { onMenu?: () => void }) {
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
  const [q, setQ] = useState('')
  const [theme, setThemeState] = useState<ThemeChoice>(getTheme())
  useEffect(() => { const f = () => setThemeState(getTheme()); window.addEventListener('cf-theme', f); return () => window.removeEventListener('cf-theme', f) }, [])
  function search() { const t = q.trim(); nav(t ? `/inbox?q=${encodeURIComponent(t)}` : '/inbox') }

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

  function logout() {
    jd1Runner.cancel(); jd1Runner.clear(); jd1Workspace.clear(); clearChat()   // never leave one user's data for the next
    clearSession(); nav('/login')
  }

  return (
    <header className="h-16 shrink-0 bg-surface-container-lowest/95 backdrop-blur border-b border-outline-variant/80 flex items-center gap-3 px-4 md:px-6 sticky top-0 z-20">
      <button onClick={onMenu} className="lg:hidden w-9 h-9 grid place-items-center rounded-lg hover:bg-surface-container" aria-label="Open menu"><Icon name="menu" className="text-[22px]" /></button>
      <div className="max-w-md w-full">
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 h-9 focus-within:ring-2 focus-within:ring-primary/25">
          <Icon name="search" className="text-[20px] text-outline" />
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search() }}
            placeholder="Search tickets by ref, member, insurer…" aria-label="Search tickets"
            className="bg-transparent outline-none text-sm w-full placeholder:text-outline focus-visible:shadow-none" style={{ boxShadow: 'none' }} />
          {q && <kbd className="hidden sm:inline text-[10px] text-outline border border-outline-variant rounded px-1">Enter</kbd>}
        </div>
      </div>

      <div className="relative ml-auto" ref={notifRef}>
        <button onClick={() => setNotifOpen((v) => !v)} title="Notifications" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} aria-expanded={notifOpen} className="relative w-9 h-9 rounded-lg hover:bg-surface-container grid place-items-center">
          <Icon name="notifications" className="text-[20px] text-text-main" />
          {unread > 0 && <span className="absolute top-1 right-1 min-w-[15px] h-[15px] px-1 rounded-full bg-brand-accent text-white text-[9px] grid place-items-center">{unread}</span>}
        </button>
        {notifOpen && (
          <div className="absolute right-0 mt-1 w-80 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl z-20 overflow-hidden">
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
        <button onClick={() => setMenu((v) => !v)} aria-expanded={menu} aria-haspopup="menu" className="flex items-center gap-2 pl-2 border-l border-outline-variant hover:bg-surface-container/60 rounded-lg py-1 pr-2">
          {avatar
            ? <img src={avatar} alt={name} className="w-8 h-8 rounded-full object-cover" />
            : <div className="w-8 h-8 rounded-full bg-primary text-white grid place-items-center text-sm font-semibold">{name[0]?.toUpperCase()}</div>}
          <div className="leading-tight text-left hidden sm:block">
            <div className="text-sm font-medium text-on-surface">{name}</div>
            <div className="text-[11px] text-outline">{roleLabel[role] || role}</div>
          </div>
          <Icon name="expand_more" className="text-[18px] text-outline" />
        </button>
        {menu && (
          <div role="menu" className="absolute right-0 mt-1 w-56 bg-surface-container-lowest border border-outline-variant rounded-xl shadow-xl py-1 z-20">
            <div className="px-3 pt-2 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-outline">Appearance</div>
            <div className="px-3 pb-2 flex gap-1" role="group" aria-label="Appearance">
              {([['light', 'light_mode', 'Light'], ['dark', 'dark_mode', 'Dark'], ['system', 'computer', 'Auto']] as const).map(([k, ic, l]) => (
                <button key={k} onClick={() => setTheme(k)} aria-pressed={theme === k}
                  className={`flex-1 flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-[11px] border ${theme === k ? 'border-primary/50 bg-primary/[0.08] text-primary font-semibold' : 'border-outline-variant text-text-main hover:bg-surface-container'}`}>
                  <Icon name={ic} className="text-[18px]" />{l}</button>
              ))}
            </div>
            <div className="border-t border-outline-variant/60 my-1" />
            <button onClick={() => { setMenu(false); nav('/profile') }} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface-container"><Icon name="person" className="text-[18px] text-text-main" />My profile &amp; password</button>
            <div className="border-t border-outline-variant/60 my-1" />
            <button onClick={logout} className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-surface-container text-status-rejected"><Icon name="logout" className="text-[18px]" />Sign out</button>
          </div>
        )}
      </div>
    </header>
  )
}
