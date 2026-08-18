import { useNavigate } from 'react-router-dom'
import { Icon } from './ui'
import { getName, getRole, clearSession } from '../lib/auth'
export function TopBar() {
  const nav = useNavigate()
  const roleLabel: Record<string, string> = { super_admin: 'Super Admin', admin: 'Administrator', user: 'Agent' }
  const role = getRole(); const name = getName()
  function logout() { clearSession(); nav('/login') }
  return (
    <header className="h-16 bg-white border-b border-outline-variant flex items-center gap-4 px-6">
      <div className="flex-1 max-w-md">
        <div className="flex items-center gap-2 bg-surface-container rounded-lg px-3 py-2 focus-within:ring-2 focus-within:ring-primary/20">
          <Icon name="search" className="text-[20px] text-outline" />
          <input placeholder="Search claims, members, tickets…" className="bg-transparent outline-none text-sm w-full placeholder:text-outline" />
        </div>
      </div>
      <button className="relative w-9 h-9 rounded-lg hover:bg-surface-container grid place-items-center">
        <Icon name="notifications" className="text-[20px] text-text-main" />
        <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand-accent" />
      </button>
      <div className="flex items-center gap-2 pl-2 border-l border-outline-variant">
        <div className="w-8 h-8 rounded-full bg-primary text-white grid place-items-center text-sm font-semibold">{name[0]?.toUpperCase()}</div>
        <div className="leading-tight">
          <div className="text-sm font-medium text-on-surface">{name}</div>
          <div className="text-[11px] text-outline">{roleLabel[role] || role}</div>
        </div>
        <button onClick={logout} title="Sign out" className="ml-1 w-8 h-8 rounded-lg hover:bg-surface-container grid place-items-center text-text-main"><Icon name="logout" className="text-[18px]" /></button>
      </div>
    </header>
  )
}
