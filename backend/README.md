# Backend — Ulink ClaimFlow (Claude Code owns this)

FastAPI. Read ../CLAUDE.md and ../CONTRACT.md first.

## Run locally
```
python -m venv .venv
# Windows: .venv\Scripts\activate    macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```
Then open http://localhost:8000/docs for the interactive API, and http://localhost:8000/health.

## Architecture
Ports & adapters. External systems (channels, OCR, AI, iAS) live behind interfaces in
app/adapters — core code never calls them directly. Implement the endpoints/schemas in
../contracts/openapi.yaml so the frontend mock can be swapped for the real API unchanged.
