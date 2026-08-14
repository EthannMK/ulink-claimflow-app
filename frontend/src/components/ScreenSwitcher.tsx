import { useNavigate, useLocation } from 'react-router-dom'
const items: [string, string][] = [
  ['/login', 'Login'], ['/inbox', 'Omnichannel Inbox'], ['/claim', 'Claim Workspace'],
  ['/log', 'LOG Workspace'], ['/adjudication', 'Medical Adjudication'], ['/confirmation', 'Provider Confirmation'],
  ['/dashboard', 'Dashboard'], ['/notifications', 'Notifications'], ['/profile', 'My Profile'],
  ['/admin/users', 'Users & Teams'], ['/admin/roles', 'Roles & Permissions'], ['/admin/routing', 'Routing Rules'],
  ['/admin/sla', 'SLA Policies'], ['/admin/reports', 'Reports & Analytics'], ['/admin/audit', 'Audit Log'],
  ['/admin/channels', 'Channel Connections'], ['/settings', 'Settings'],
]
export function ScreenSwitcher() {
  const nav = useNavigate(); const loc = useLocation()
  return (
    <div style={{ position: 'fixed', top: 12, right: 12, zIndex: 9999 }}>
      <select value={loc.pathname} onChange={(e) => nav(e.target.value)}
        style={{ fontFamily: 'Inter', fontSize: 12, padding: '6px 10px', borderRadius: 8,
          border: '1px solid #c2c7d0', background: '#fff', boxShadow: '0 2px 6px rgba(0,0,0,.12)' }}>
        {items.map(([to, label]) => <option key={to} value={to}>{label}</option>)}
      </select>
    </div>
  )
}
