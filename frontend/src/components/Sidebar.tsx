import { NavLink } from 'react-router-dom'
const groups: { title?: string; items: { to: string; label: string; icon: string }[] }[] = [
  { items: [
    { to: '/inbox', label: 'Inbox', icon: 'inbox' },
    { to: '/new-claim', label: 'New Claim', icon: 'add_circle' },
    { to: '/ocr-demo', label: 'Claim Intake AI', icon: 'document_scanner' },
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/confirmation', label: 'Confirmation', icon: 'fact_check' },
    { to: '/notifications', label: 'Notifications', icon: 'notifications' },
  ]},
  { title: 'Admin', items: [
    { to: '/admin/users', label: 'Users & Teams', icon: 'group' },
    { to: '/admin/roles', label: 'Roles', icon: 'admin_panel_settings' },
    { to: '/admin/channels', label: 'Channels', icon: 'hub' },
    { to: '/admin/routing', label: 'Routing Rules', icon: 'alt_route' },
    { to: '/admin/sla', label: 'SLA Policies', icon: 'timer' },
    { to: '/admin/reports', label: 'Reports', icon: 'analytics' },
    { to: '/admin/audit', label: 'Audit Log', icon: 'history' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ]},
]
export function Sidebar() {
  return (
    <aside className="w-60 shrink-0 bg-white border-r border-outline-variant flex flex-col">
      <div className="h-16 flex items-center gap-2 px-4 border-b border-outline-variant">
        <div className="w-9 h-9 rounded-lg bg-primary text-white grid place-items-center font-display font-bold shrink-0">U</div>
        <span className="font-display font-bold text-primary text-[15px] leading-tight">Ulink ClaimFlow</span>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {groups.map((g, i) => (
          <div key={i} className="mb-1">
            {g.title && <div className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-outline">{g.title}</div>}
            {g.items.map((n) => (
              <NavLink key={n.to} to={n.to}
                className={({ isActive }) => `flex items-center gap-3 px-4 py-2.5 text-sm ${isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-text-main hover:bg-surface-container'}`}>
                <span className="material-symbols-outlined text-[20px]">{n.icon}</span>{n.label}
              </NavLink>
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
