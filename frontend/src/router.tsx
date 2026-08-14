import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PlaceholderPage } from './pages/PlaceholderPage'
import { LoginPage } from './pages/LoginPage'
import { InboxPage } from './pages/InboxPage'
import { NewClaimPage } from './pages/NewClaimPage'
import { ClaimWorkspacePage } from './pages/ClaimWorkspacePage'
import { LogWorkspacePage } from './pages/LogWorkspacePage'
import { DashboardPage } from './pages/DashboardPage'
import { ProviderConfirmationPage } from './pages/ProviderConfirmationPage'
import { UserManagementPage } from './pages/UserManagementPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { MyProfilePage } from './pages/MyProfilePage'

const P = (t: string) => <PlaceholderPage title={t} />

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/inbox', element: <InboxPage /> },
      { path: '/new-claim', element: <NewClaimPage /> },
      { path: '/claim/:id', element: <ClaimWorkspacePage /> },
      { path: '/log/:id', element: <LogWorkspacePage /> },
      { path: '/adjudication/:id', element: P('Medical Adjudication') },
      { path: '/confirmation', element: <ProviderConfirmationPage /> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/profile', element: <MyProfilePage /> },
      { path: '/admin/users', element: <UserManagementPage /> },
      { path: '/admin/roles', element: P('Roles & Permissions') },
      { path: '/admin/routing', element: P('Routing Rules') },
      { path: '/admin/sla', element: P('SLA Policies') },
      { path: '/admin/reports', element: P('Reports & Analytics') },
      { path: '/admin/audit', element: P('Audit Log') },
      { path: '/admin/channels', element: P('Channel Connections') },
      { path: '/settings', element: P('Settings') },
    ],
  },
])
