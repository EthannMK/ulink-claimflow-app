import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { InboxPage } from './pages/InboxPage'
import { NewClaimPage } from './pages/NewClaimPage'
import { JD1ReviewPage } from './pages/JD1ReviewPage'
import { JD2AdjudicationPage } from './pages/JD2AdjudicationPage'
import { ClaimWorkspacePage } from './pages/ClaimWorkspacePage'
import { LogWorkspacePage } from './pages/LogWorkspacePage'
import { AdjudicationPage } from './pages/AdjudicationPage'
import { DashboardPage } from './pages/DashboardPage'
import { ProviderConfirmationPage } from './pages/ProviderConfirmationPage'
import { NotificationsPage } from './pages/NotificationsPage'
import { MyProfilePage } from './pages/MyProfilePage'
import { UserManagementPage } from './pages/UserManagementPage'
import { RolesPage } from './pages/RolesPage'
import { RoutingPage } from './pages/RoutingPage'
import { SlaPage } from './pages/SlaPage'
import { ReportsPage } from './pages/ReportsPage'
import { AuditPage } from './pages/AuditPage'
import { ChannelsPage } from './pages/ChannelsPage'
import { SettingsPage } from './pages/SettingsPage'

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/login" replace /> },
  { path: '/login', element: <LoginPage /> },
  {
    element: <Layout />,
    children: [
      { path: '/inbox', element: <InboxPage /> },
      { path: '/new-claim', element: <NewClaimPage /> },
      { path: '/jd1', element: <JD1ReviewPage /> },
      { path: '/jd2', element: <JD2AdjudicationPage /> },
      { path: '/jd2/:id', element: <JD2AdjudicationPage /> },
      { path: '/claim/:id', element: <ClaimWorkspacePage /> },
      { path: '/log/:id', element: <LogWorkspacePage /> },
      { path: '/adjudication/:id', element: <AdjudicationPage /> },
      { path: '/confirmation', element: <ProviderConfirmationPage /> },
      { path: '/dashboard', element: <DashboardPage /> },
      { path: '/notifications', element: <NotificationsPage /> },
      { path: '/profile', element: <MyProfilePage /> },
      { path: '/admin/users', element: <UserManagementPage /> },
      { path: '/admin/roles', element: <RolesPage /> },
      { path: '/admin/routing', element: <RoutingPage /> },
      { path: '/admin/sla', element: <SlaPage /> },
      { path: '/admin/reports', element: <ReportsPage /> },
      { path: '/admin/audit', element: <AuditPage /> },
      { path: '/admin/channels', element: <ChannelsPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
])
