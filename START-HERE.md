# Ulink ClaimFlow — Start Here

This is the project foundation. Two AI coding agents build it in parallel:
- **Codex** builds the **frontend/** (from the Stitch screens in `docs/screens/`)
- **Claude Code** builds the **backend/** (API + integrations)

## One-time setup on your computer
1. Install **Node.js (LTS)** — https://nodejs.org
2. Install **Git** — https://git-scm.com
3. Install **GitHub Desktop** — https://desktop.github.com

## Put this project on GitHub
1. github.com → **+** → **New repository** → name `ulink-claimflow` → **Private** → **Create**.
2. Open **GitHub Desktop** → **File → Add local repository** → select this folder.
3. Click **Publish repository**. That's your first push.
4. After this, "push/pull" = the **Push** / **Fetch** buttons in GitHub Desktop.

## Connect the agents
- **Codex:** connect your GitHub, pick `ulink-claimflow`, tell it: "Work only in `frontend/`, follow AGENTS.md."
- **Claude Code:** clone the repo, it follows CLAUDE.md, works only in `backend/`.

## Give tasks (examples)
- Codex: "Build the Omnichannel Inbox screen in frontend from docs/screens/omnichannel_inbox.html, using the shared Layout and mock data. Open a PR."
- Claude Code: "Build the email channel adapter in backend following contracts/openapi.yaml. Open a PR."

## Approve work
Each task returns as a **Pull Request** on GitHub. Review, then **Merge**.

## Run it locally
- Frontend: `cd frontend` → `npm install` → `npm run dev` → open the shown URL.
- Backend: see `backend/README.md`.
