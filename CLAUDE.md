# CLAUDE.md — instructions for Claude Code (Backend)

You build the **backend only**. Read `CONTRACT.md` first.

## Your lane
- Work exclusively in `backend/`. Do NOT touch `frontend/`.
- Branch as `claude/<feature>`; open a Pull Request per feature.

## Architecture (ports & adapters)
- FastAPI. Core logic never talks to external systems directly — everything goes through
  adapters in `backend/app/adapters` implementing the base interfaces:
  - `ChannelAdapter` (Email, Facebook, Viber, Telegram) → normalize to `InboundMessage`
  - `OcrProvider` (Document AI / Textract / vision-LLM)
  - `AiProvider` (categorize, extract, summarize, recommend decision)
  - `IasAdapter` (the iAS claim system; API if available, else stub/RPA)
- Ingestion is event-driven: incoming message → queue → worker runs OCR/AI. Keep the API non-blocking.

## Contract
- Implement the endpoints and schemas in `contracts/openapi.yaml`. Keep responses matching exactly so the frontend mock can be swapped for real with no UI change.

## Data
- PostgreSQL for structured data (JSONB for variable extracted fields). Object storage for documents — never store files in the DB.

## Run / verify
- See `backend/README.md`. Provide a `/health` endpoint and typed Pydantic models.
