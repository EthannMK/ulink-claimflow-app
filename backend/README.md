# Backend — Ulink ClaimFlow (FastAPI)

POC backend: **document scan (OCR/AI)** + **user control with 3 roles**.

## Roles
- **super_admin** — full access, incl. user management (create/edit/delete users)
- **admin** — everything except user management
- **user** — work claims / run document scan

## Seed accounts (POC only — change before real use)
| username | password | role |
|---|---|---|
| superadmin | super123 | super_admin |
| admin | admin123 | admin |
| jd1 | user123 | user |

## Run locally
```
python -m venv .venv
# Windows: .venv\Scripts\activate   macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
copy .env.example .env      # (macOS/Linux: cp .env.example .env)
uvicorn app.main:app --reload
```
Open http://localhost:8000/docs — click **Authorize**, log in with a seed account, and try the endpoints.

## Document scan
`POST /api/scan` (auth required) — upload an image/PDF page; returns extracted text, fields (with confidence), a summary and the document type.

- Default `OCR_PROVIDER=stub` works with **no API key** (returns sample data) so the POC runs immediately.
- For real reading, set in `.env`: `OCR_PROVIDER=gemini` and `GEMINI_API_KEY=<key from Google AI Studio>` (free tier). Gemini is a vision model → OCR + field extraction + summary in one call.
- For production-grade OCR/handwriting, add a `DocumentAiProvider` in `app/adapters/ocr.py` the same way and switch `OCR_PROVIDER`.

## Endpoints
- `POST /auth/login` → JWT
- `GET /api/me` → current user
- `GET /api/users` → list (admin + super_admin)
- `POST/PUT/DELETE /api/users` → manage users (super_admin only)
- `POST /api/scan` → document scan
- `GET /api/claims` → sample claims
