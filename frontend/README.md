# Frontend — Ulink ClaimFlow (Codex owns this)

React + Vite + TypeScript + Tailwind. Read ../AGENTS.md and ../CONTRACT.md first.

## Run locally
```
npm install
npm run dev
```
Open the URL it prints (default http://localhost:5173). The Inbox is a working sample
wired to the mock API. Build the other screens from ../docs/screens/*.html.

## Where things live
- src/components/Layout.tsx  — shared sidebar + top bar (reuse it)
- src/pages/                 — one file per screen
- src/lib/api.ts             — mock API (shapes match ../contracts/openapi.yaml)
- src/mocks/                 — fake data
- src/router.tsx             — routes (placeholders already stubbed)
- tailwind.config.js         — theme tokens from ../docs/DESIGN.md
