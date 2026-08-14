import { lazy, Suspense } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { Layout } from './components/Layout'
import { PlaceholderPage } from './pages/PlaceholderPage'

// Eager sample screen; others are placeholders for Codex to build.
import { InboxPage } from './pages/InboxPage'

const P = (title: string) => <PlaceholderPage title={title} />

export const router = createBrowserRouter([
  { path: '/', element: <Navigate to="/inbox" replace /> },
  { path: '/login', element: P('login_ulink_assist') },
  {
    element: <Layout />,
    children: [
      { path: '/inbox', element: <InboxPage /> },
      { path: '/claim/:id', element: P('claim_workspace_intake') },
      { path: '/log/:id', element: P('log_request_workspace') },
      { path: '/adjudication/:id', element: P('medical_adjudication_workspace') },
      { path: '/confirmation', element: P('provider_confirmation_tracker') },
      { path: '/dashboard', element: P('kpi_dashboard_executive_view') },
      { path: '/notifications', element: P('notifications_center') },
      { path: '/profile', element: P('my_profile_preferences') },
      { path: '/admin/users', element: P('user_management_admin') },
      { path: '/admin/roles', element: P('roles_permissions_admin') },
      { path: '/admin/routing', element: P('routing_assignment_rules') },
      { path: '/admin/sla', element: P('sla_policies_admin') },
      { path: '/admin/reports', element: P('reports_analytics_admin') },
      { path: '/admin/audit', element: P('audit_log_admin') },
      { path: '/admin/channels', element: P('channel_connections_admin') },
      { path: '/settings', element: P('settings_business_rules') },
    ],
  },
])
