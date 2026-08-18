import { NavLink } from 'react-router-dom'
import { Logo } from './ui'
import { getRole } from '../lib/auth'

export function Sidebar() {
  const role = getRole()
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isSuper = role === 'super_admin'
  const main = [
    { to: '/inbox', label: 'Inbox', icon: 'inbox' },
    { to: '/new-claim', label: 'New Claim', icon: 'add_circle' },
    { to: '/ocr-demo', label: 'Claim Intake AI', icon: 'document_scanner' },
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/confirmation', label: 'Confirmation', icon: 'fact_check' },
    { to: '/notifications', label: 'Notifications', icon: 'notifications' },
  ]
  const admin = [
    ...(isSuper ? [{ to: '/admin/users', label: 'Users & Teams', icon: 'group' }] : []),
    { to: '/admin/roles', label: 'Roles', icon: 'admin_panel_settings' },
    { to: '/admin/channels', label: 'Channels', icon: 'hub' },
    { to: '/admin/routing', label: 'Routing Rules', icon: 'alt_route' },
    { to: '/admin/sla', label: 'SLA Policies', icon: 'timer' },
    { to: '/admin/reports', label: 'Reports', icon: 'analytics' },
    { to: '/admin/audit', label: 'Audit Log', icon: 'history' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ]
  const groups = [{ items: main }, ...(isAdmin ? [{ title: 'Admin', items: admin }] : [])]
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-outline-variant flex flex-col">
      <div className="h-16 flex items-center px-4 border-b border-outline-variant"><Logo size={34} /></div>
      <nav className="flex-1 overflow-y-auto py-2">
        {groups.map((g: any, i: number) => (
          <div key={i} className="mb-1">
            {g.title && <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-outline">{g.title}</div>}
            {g.items.map((n: any) => (
              <NavLink key={n.to} to={n.to}
                className={({ isActive }) => `relative flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${isActive ? 'text-primary font-semibold bg-primary/[0.07]' : 'text-text-main hover:bg-surface-container'}`}>
                {({ isActive }) => (<>
                  {isActive && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r bg-brand-accent" />}
                  <span className="material-symbols-outlined text-[20px]">{n.icon}</span>{n.label}
                </>)}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
      <div className="px-4 py-3 border-t border-outline-variant text-[10px] text-outline">Signed in as {role.replace('_', ' ')}</div>
    </aside>
  )
}
