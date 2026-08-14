# AGENTS.md — instructions for Codex (Frontend)

You build the **frontend only**. Read `CONTRACT.md` first.

## Your lane
- Work exclusively in `frontend/`. Do NOT touch `backend/` or `contracts/`.
- Branch as `codex/<screen-name>`; open a Pull Request per screen.

## What to build
- Convert each Stitch screen in `docs/screens/*.html` into a React + TypeScript page.
- Use the shared `Layout` (`frontend/src/components/Layout.tsx`) — do not re-create the sidebar/top bar.
- Style with Tailwind using the theme already in `tailwind.config.js` (from `docs/DESIGN.md`). No raw hex.
- Get data from the mock API layer (`frontend/src/lib/api.ts`) and mock data (`frontend/src/mocks`), whose shapes match `contracts/openapi.yaml`. Do not call a real backend yet.

## Screens to build (routes already stubbed in src/router.tsx)
login, omnichannel_inbox, claim_workspace_intake, log_request_workspace,
medical_adjudication_workspace, provider_confirmation_tracker,
kpi_dashboard_executive_view, notifications_center, my_profile_preferences,
user_management_admin, roles_permissions_admin, routing_assignment_rules,
sla_policies_admin, reports_analytics_admin, audit_log_admin,
channel_connections_admin, settings_business_rules

## Performance (required)
- Lazy-load routes (React.lazy). Virtualize long tables (inbox). Debounce search.
- Cache data with TanStack Query. Lazy-load the document viewer.

## Run / verify
- `cd frontend && npm install && npm run dev`, then check the screen in the browser.
