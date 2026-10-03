import { useEffect, useState } from 'react'
import { Outlet, Link, useLocation, Navigate } from 'react-router-dom'
import { backendOn, getToken } from '../lib/auth'
import { PageErrorBoundary } from './PageErrorBoundary'
import { useQuery } from '@tanstack/react-query'
import { getMySecurity } from '../lib/api'
import { Icon } from './ui'
import { Sidebar } from './Sidebar'
import { TopBar } from './TopBar'
import { ChatWidget } from './ChatWidget'
export function Layout() {
  const sec = useQuery({ queryKey: ['me', 'security'], queryFn: getMySecurity, staleTime: 60_000, enabled: !backendOn() || !!getToken() })
  const loc = useLocation()
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('cf-nav') === 'collapsed' } catch { return false } })
  const [mobileOpen, setMobileOpen] = useState(false)
  useEffect(() => { setMobileOpen(false) }, [loc.pathname])
  function toggleCollapsed() {
    setCollapsed((v) => { try { localStorage.setItem('cf-nav', v ? 'open' : 'collapsed') } catch { /* ignore */ } return !v })
  }
  // not signed in (or signed out in another tab): straight to the sign-in page
  if (backendOn() && !getToken()) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />
  return (
    <div className="h-screen flex bg-surface text-on-surface">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:bg-primary focus:text-white focus:px-3 focus:py-2 focus:rounded-lg">Skip to content</a>
      <Sidebar collapsed={collapsed} onToggle={toggleCollapsed} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onMenu={() => setMobileOpen(true)} />
        {sec.data?.default_password && (
          <div className="flex items-center gap-2 bg-status-rejected/10 text-status-rejected px-6 py-2 text-sm">
            <Icon name="lock_reset" className="text-[18px]" />
            <span className="flex-1">You're still using the built-in starter password for this account. Change it before sharing the system with anyone.</span>
            <Link to="/profile" className="font-semibold underline">Change password</Link>
          </div>
        )}
        <main id="main" className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[1680px] px-4 py-5 md:px-6 md:py-6 lg:px-8"><PageErrorBoundary resetKey={loc.pathname}><Outlet /></PageErrorBoundary></div>
        </main>
      </div>
      <ChatWidget />
    </div>
  )
}
