# CONTRACT — rules both agents follow

## Ownership (do not cross)
- **Codex → `frontend/` only.**
- **Claude Code → `backend/` only.**
- `contracts/` is shared. Changing it needs a note in the PR description; both sides update to match.
- Never edit the other agent's folder. Never push to `main` directly.

## Git workflow
- Branch per task: `codex/<screen>` or `claude/<feature>`.
- Small PRs (one screen or one feature). Descriptive commit messages.
- Open a PR → the human reviews & merges. `main` is protected.

## The seam: contracts/
- `contracts/openapi.yaml` is the single source of truth for API shapes.
- Frontend builds against a **mock** that matches it (`frontend/src/mocks`, `VITE_USE_MOCKS=true`).
- Backend implements the same endpoints. When real API is ready, flip `VITE_USE_MOCKS=false`.

## Conventions
- TypeScript on the frontend; type everything. Python type hints on the backend.
- Reuse shared components (`frontend/src/components`) — don't duplicate the sidebar/topbar.
- Colors/typography come from `docs/DESIGN.md` (already in `tailwind.config.js`). No hardcoded hex in components.
- All external systems (channels, OCR, AI, iAS) sit behind adapters in `backend/app/adapters` — core code never calls them directly.

## Definition of done (per screen/feature)
- Runs locally, no console errors, matches the Stitch design, uses mock/contract data, PR opened.
