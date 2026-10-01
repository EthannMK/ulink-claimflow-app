import { Outlet, Link, useLocation } from 'react-router-dom'
import { PageErrorBoundary } from './PageErrorBoundary'
import { useQuery } from '@tanstack/react-query'
import { getMySecurity } from '../lib/api'
import { Icon } from './ui'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ChatWidget } from './ChatWidget'
export function Layout() {
  const sec = useQuery({ queryKey: ['me', 'security'], queryFn: getMySecurity, staleTime: 60_000 })
  const loc = useLocation()
  return (
    <div className="h-screen flex bg-surface">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        {sec.data?.default_password && (
          <div className="flex items-center gap-2 bg-status-rejected/10 text-status-rejected px-6 py-2 text-sm">
            <Icon name="lock_reset" className="text-[18px]" />
            <span className="flex-1">You're still using the built-in starter password for this account. Change it before sharing the system with anyone.</span>
            <Link to="/profile" className="font-semibold underline">Change password</Link>
          </div>
        )}
        <main className="flex-1 overflow-y-auto p-6"><PageErrorBoundary resetKey={loc.pathname}><Outlet /></PageErrorBoundary></main>
      </div>
      <ChatWidget />
    </div>
  )
}
