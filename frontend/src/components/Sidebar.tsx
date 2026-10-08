import { NavLink } from 'react-router-dom'
import { Logo, Icon } from './ui'
import { getRole } from '../lib/auth'
import { useJD1Run } from '../lib/jd1Runner'

export function Sidebar({ collapsed = false, onToggle, mobileOpen = false, onClose }: { collapsed?: boolean; onToggle?: () => void; mobileOpen?: boolean; onClose?: () => void }) {
  const role = getRole()
  const isAdmin = role === 'admin' || role === 'super_admin'
  const isSuper = role === 'super_admin'
  const jd1 = useJD1Run()
  const main = [
    { to: '/inbox', label: 'Inbox', icon: 'inbox' },
    { to: '/new-claim', label: 'New Claim', icon: 'add_circle' },
    { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
    { to: '/confirmation', label: 'Confirmation', icon: 'fact_check', preview: true },
    { to: '/notifications', label: 'Notifications', icon: 'notifications', preview: true },
    { to: '/ai-usage', label: 'AI Usage', icon: 'monitoring' },
  ]
  const pipeline = [
    { to: '/jd1', label: 'JD1 · Doc Scan & Validation', icon: 'assignment_turned_in' },
    { to: '/jd2', label: 'JD2 · Review & Approve', icon: 'rule' },
  ]
  const admin = [
    ...(isSuper ? [{ to: '/admin/users', label: 'Users & Teams', icon: 'group' }] : []),
    ...(isSuper ? [{ to: '/admin/ai-providers', label: 'AI Providers & Models', icon: 'model_training' }] : []),
    ...(isSuper ? [{ to: '/admin/ai-prompts', label: 'AI Prompts', icon: 'terminal' }] : []),
    { to: '/admin/roles', label: 'Roles', icon: 'admin_panel_settings', preview: true },
    { to: '/admin/channels', label: 'Channels', icon: 'hub', preview: true },
    { to: '/admin/routing', label: 'Routing Rules', icon: 'alt_route', preview: true },
    { to: '/admin/sla', label: 'SLA Policies', icon: 'timer', preview: true },
    { to: '/admin/automations', label: 'Automations', icon: 'settings_suggest', preview: true },
    { to: '/admin/reports', label: 'Reports', icon: 'analytics', preview: true },
    { to: '/admin/audit', label: 'Audit Log', icon: 'history', preview: true },
    { to: '/settings', label: 'Settings', icon: 'settings' },
  ]
  const groups = [{ items: main }, { title: 'Claim pipeline', items: pipeline }, ...(isAdmin ? [{ title: 'Admin', items: admin }] : [])]
  const roleLabel: Record<string, string> = { super_admin: 'Super Admin', admin: 'Administrator', user: 'Agent' }
  const narrow = collapsed && !mobileOpen
  return (
    <>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" onClick={onClose} aria-hidden="true" />}
      <aside aria-label="Main navigation"
        className={`${mobileOpen ? 'fixed inset-y-0 left-0 z-40 flex shadow-xl' : 'hidden lg:flex'} ${narrow ? 'w-[68px]' : 'w-64'} shrink-0 bg-surface-container-lowest border-r border-outline-variant/80 flex-col transition-[width] duration-200`}>
        <div className={`h-16 flex items-center border-b border-outline-variant/80 ${narrow ? 'justify-center px-2' : 'px-4'}`}>
          <Logo size={32} showText={!narrow} />
          {mobileOpen && <button onClick={onClose} className="ml-auto w-8 h-8 grid place-items-center rounded-lg hover:bg-surface-container" aria-label="Close menu"><Icon name="close" className="text-[20px]" /></button>}
        </div>
        <nav className="flex-1 overflow-y-auto overflow-x-hidden py-3">
          {groups.map((g: any, i: number) => (
            <div key={i} className="mb-2">
              {g.title && (narrow
                ? <div className="mx-4 my-2 border-t border-outline-variant/70" />
                : <div className="px-5 pt-2 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.09em] text-outline">{g.title}</div>)}
              <div className={narrow ? 'px-2 grid gap-0.5' : 'px-3 grid gap-0.5'}>
                {g.items.map((n: any) => (
                  <NavLink key={n.to} to={n.to} title={narrow ? n.label + (n.preview ? ' (preview)' : '') : n.preview ? 'Concept screen — sample data, not connected yet' : undefined}
                    className={({ isActive }) => `group relative flex items-center gap-3 rounded-lg ${narrow ? 'justify-center h-10' : 'px-3 py-2'} text-[13.5px] transition-colors ${isActive ? 'text-primary font-semibold bg-primary/[0.08]' : 'text-text-main hover:bg-surface-container hover:text-on-surface'}`}>
                    {({ isActive }) => (<>
                      {isActive && <span className={`absolute ${narrow ? '-left-2' : '-left-3'} top-2 bottom-2 w-[3px] rounded-r bg-brand-accent`} />}
                      <span className={`material-symbols-outlined text-[20px] shrink-0 ${isActive ? '' : 'text-outline group-hover:text-on-surface-variant'}`} aria-hidden="true">{n.icon}</span>
                      {!narrow && <span className="truncate min-w-0">{n.label}</span>}
                      {!narrow && n.preview && <span className="ml-auto shrink-0 text-[9.5px] font-semibold uppercase tracking-wide rounded px-1.5 py-px bg-surface-container text-outline" title="Concept screen — sample data, not connected yet">Preview</span>}
                      {n.to === '/jd1' && jd1.status === 'running' && (narrow
                        ? <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary animate-pulse" title="A JD1 scan is running" />
                        : <span className="ml-auto text-[10px] font-semibold text-primary tabular-nums animate-pulse" title="A JD1 scan is running">{Math.round(jd1.pct)}%</span>)}
                      {n.to === '/jd1' && !jd1.consumed && jd1.status === 'done' && <span className={`${narrow ? 'absolute top-1.5 right-1.5' : 'ml-auto'} w-2 h-2 rounded-full bg-status-approved`} title="JD1 note ready" />}
                      {n.to === '/jd1' && !jd1.consumed && jd1.status === 'error' && <span className={`${narrow ? 'absolute top-1.5 right-1.5' : 'ml-auto'} w-2 h-2 rounded-full bg-status-rejected`} title="JD1 scan failed" />}
                    </>)}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className={`border-t border-outline-variant/80 ${narrow ? 'px-2 py-2' : 'px-4 py-2.5'} flex items-center gap-2 text-[11px] text-outline`}>
          {!narrow && <span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-status-approved" />{roleLabel[role] || role}</span>}
          {onToggle && !mobileOpen && (
            <button onClick={onToggle} className={`${narrow ? 'mx-auto' : 'ml-auto'} w-8 h-8 grid place-items-center rounded-lg hover:bg-surface-container text-text-main`}
              aria-label={narrow ? 'Expand the menu' : 'Collapse the menu'} title={narrow ? 'Expand the menu' : 'Collapse the menu'}>
              <Icon name={narrow ? 'left_panel_open' : 'left_panel_close'} className="text-[20px]" />
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
