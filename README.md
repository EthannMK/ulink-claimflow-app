# Ulink ClaimFlow

AI-powered omnichannel claims workspace for a TPA. Receives requests from Email,
Facebook, Viber, Telegram, Web forms and Phone; AI categorizes, assigns, extracts
document data, and assists JD1/JD2 through decision. This is a **monorepo**:

```
frontend/    React + Vite + TS + Tailwind   (owned by Codex)
backend/     FastAPI (Python)               (owned by Claude Code)
contracts/   OpenAPI spec + shared types    (the FE<->BE agreement)
docs/        DESIGN.md, PRD, Stitch screens
```

New here? Read **START-HERE.md**. Rules for agents: **CONTRACT.md**.
