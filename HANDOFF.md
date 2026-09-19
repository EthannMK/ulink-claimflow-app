# Ulink ClaimFlow — Build Handoff

**Purpose:** hand this file to a new Claude session to continue building. It captures the product, the architecture, what is DONE, and precise specs for what is REMAINING. Read this first, then ask the user which item to tackle.

> Working style the user expects: **one step at a time**, wait for the user's result before the next step. The user is a beginner. Local commands run in **PowerShell**; git/deploy runs in **Google Cloud Shell**. **Never** ask the user to paste API keys/secrets/tokens into chat. Guide, don't dump.

---

## 1. Product

**Ulink ClaimFlow** — an AI claims-processing + omnichannel-helpdesk platform for **Ulink Assist Myanmar** (a TPA processing ~2,500 health claims/month; insurers: AYA Sompo, MGEN, AMI, Daiichi). Built by PEN|PRO for the client. A POC meeting is upcoming.

Core flow: a claim packet (PDFs/images, often **scanned + handwritten Burmese**) is uploaded → auto-creates a **ticket** in the Inbox → **JD1 (Doc Scan & Validation)** reads it, validates fields, checks the document checklist, extracts invoices → hands off to **JD2 (Review & Approve)** for adjudication.

---

## 2. Architecture

- **Frontend:** React 18 + Vite + TypeScript + Tailwind. Hooks: `usePersistent` (localStorage), `useEditable`. `pdfjs-dist` renders PDF pages client-side. react-query.
- **Backend:** FastAPI, Pydantic v2, JWT (python-jose), bcrypt, httpx, pypdf, **pymupdf** (rasterizes scanned PDFs to JPEG for vision), google-cloud-firestore, google-cloud-storage, google-auth.
- **Hosting:** single Docker container on **Cloud Run** (region `asia-southeast1`). GitHub `EthannMK/ulink-claimflow-app` → Cloud Build → Cloud Run service **`ulink-api`**.
- **Repos/paths:** canonical working copy is `D:\ClaudeData\Ulink\ulink-claimflow` (matches GitHub). NOTE: `C:\Users\User\ulink-claimflow-app` is NOT accessible to Claude — always work in the D: copy.

### Shared AI provider layer (KEY DESIGN) — `backend/app/ai_provider.py`
All AI features call **`generate_text(parts)`**. `parts` uses a neutral Gemini-style shape:
```
[{"text": "..."}, {"inline_data": {"mime_type": "image/jpeg", "data": "<base64>"}}]
```
`generate_text` picks the **highest-priority ENABLED + AVAILABLE** provider that can handle the request (vision-capable if any `inline_data` present), and calls **only that one**. It falls through to the next provider **only on failure** (quota/rate-limit/error) — so a normal request makes exactly one API call (no added latency). Retry policy in `_post`: **fail fast on 429** (so fallback is instant), one quick retry on 503.

**Provider priority (default, `default_providers()`):**
1. **vertex** — Vertex AI on GCP (paid via the user's $300 credit). Vision. **Primary.**
2. **groq** — free, fast, TEXT only (no vision). Model `qwen/qwen3.8-27b`.
3. **openrouter** — free vision fallback (`qwen/qwen3.8-27b:free`). Often 429 (free daily cap).
4. **gemini** — Google AI Studio key. Vision. Free tier is only ~20 req/day, so it's LAST.

Provider config is stored via `Collection("ai_settings")` (Firestore or in-memory). **API keys/creds stay in env/secrets — NEVER in the settings DB.** Adapters translate the neutral parts to each API: `_vertex_call`, `_gemini_call`, `_groq_call` (text-only), `_openrouter_call` (multimodal `image_url`).

**Vertex specifics:** uses **Application Default Credentials** (no API key). Locally: `gcloud auth application-default login`. On Cloud Run: the service account (needs role **Vertex AI User** + the **Vertex AI API / aiplatform.googleapis.com** enabled). Endpoint host: `{LOCATION}-aiplatform.googleapis.com`, or `aiplatform.googleapis.com` when `LOCATION == "global"`.

### Firestore/Storage abstraction
- `backend/app/db.py` — `Collection(name)` backed by Firestore, **falls back to in-memory** if no creds (so local dev works but does NOT persist across restarts). `USE_FIRESTORE=0` forces memory.
- `backend/app/storage.py` — GCS-or-memory blob store (put/get/delete/mode).
- `backend/app/audit.py` + `routers/audit.py` — audit log (`Collection("audit")`).

---

## 3. Environment variables (`backend/.env`)

```
JWT_SECRET=<random>
JWT_EXPIRE_MINUTES=480
OCR_PROVIDER=gemini            # legacy flag; the shared layer now drives AI. Leave as is.
GEMINI_API_KEY=<AI Studio key> # fallback provider only
GEMINI_MODEL=gemini-3.6-flash
GROQ_API_KEY=<groq key>
GROQ_MODEL=qwen/qwen3.8-27b
OPENROUTER_API_KEY=<openrouter key>
OPENROUTER_MODEL=qwen/qwen3.8-27b:free
VERTEX_PROJECT=ulink-claimflow
VERTEX_LOCATION=global         # 'global' serves gemini-3.6-flash; asia-southeast1 only serves up to 2.5-flash
VERTEX_MODEL=gemini-3.6-flash  # best Burmese vision; confirmed working on the global endpoint
```
Frontend `.env`: `VITE_USE_MOCKS=false`, `VITE_API_BASE_URL=http://127.0.0.1:8000`.

**Model/region note:** Singapore (`asia-southeast1`) does NOT serve `gemini-3.6-flash` (404). The user chose **global + gemini-3.6-flash** for best Burmese quality, accepting that requests may be processed outside Singapore. If strict data residency is later required: use `asia-southeast1` + `gemini-2.5-flash` (weaker Burmese) or `gemini-2.5-pro` (better, slower).

---

## 4. Run locally

Backend (PowerShell window #1):
```
cd D:\ClaudeData\Ulink\ulink-claimflow\backend
.\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```
Frontend (PowerShell window #2):
```
cd D:\ClaudeData\Ulink\ulink-claimflow\frontend
npm run dev            # http://localhost:5173
```
**Diagnostic (TEMPORARY, unauth):** `GET http://127.0.0.1:8000/api/ai-settings/_debug` returns provider status + live test of each provider (never returns keys). **MUST be removed before production deploy** — see `routers/ai_settings.py`, the `_debug` function.

---

## 5. DONE this phase

- Shared AI provider layer with priority + instant fail-over; Vertex AI added as primary (paid, $300 credit, `gemini-3.6-flash` global). No more free-tier quota walls.
- **Migrated ALL direct-Gemini call sites** to the shared layer: `routers/review.py` (fields + full detection), `adapters/jd1.py` (note + client mail), `adapters/ocr.py`, `routers/assistant.py`, `routers/extract.py`.
- **Model names removed from user-facing output** — provider labels are now `"ai"`; errors say "The AI service is busy right now. Please try again." (no "Gemini HTTP 503" leaks).
- **Full-detection speed fixes:** page endpoints now offload blocking AI work via `run_in_threadpool` (true parallelism — previously async endpoints serialized the "parallel" ranges); rasterization lowered to **120 DPI, JPEG quality 72**; frontend batch size **CH 6→3** for more parallelism.
- **Prompt improvements:** full-detection prompt now reads handwriting fully, transcribes Burmese handwritten notes verbatim, and reads TABLES/VOUCHERS/hand-drawn bills row-by-row; asks for more label/value detail.
- Note generation no longer returns an all-missing checklist on failure — it tells the user to retry.
- Requirements updated: `google-auth==2.34.0`, `requests==2.32.3` (needed for Vertex ADC token).

Earlier phases (already shipped): insurer schemas split by form type (Claim/LOG; AMI = LOG only), supporting-doc handling, invoice extraction + reconciliation, draft-client-mail endpoint, JD1 ticket redesign, JD2 handoff with all fields + AI summary + invoices.

---

## 6. REMAINING — user's requested backlog (specs)

Priority order suggested for the POC. Confirm with the user before starting each.

### A. Full Detection — Adobe-style per-page navigation (HIGH)
Currently all page results render stacked in one panel; the PDF render and the results are not synced.
**Want:** a single page selector (a small box to type a page number + Enter, plus ◀ ▶ arrows) that controls **BOTH** the PDF rendering (left) and the shown page result (right) together — like Adobe's page selector. Required Fields view does NOT need this.
- File: `frontend/src/components/DocReview.tsx`. There's already `page`/`setPage` state and per-page PDF rendering for the Required view; reuse it for Full detection so left render + right result both key off `page`. Show one `PageDetail` at a time (find by `page`), with a "Page [n] / [total]" control. Keep the streamed loading (results still arrive in batches; just display the current page's when ready).

### B. Editable full-detection notes + save (HIGH)
JD1 should be able to **edit** the extracted full-detection text per page and **save** it with the ticket.
- Backend: extend the ticket/JD1 model to store an editable `page_notes` (list of {page,title,summary,items} or a single combined text). Add a save endpoint (see `routers/jd1.py`). 
- Frontend: make the Full detection result fields editable (reuse `useEditable`), with a Save button that persists to the ticket.

### C. JD2 receives the full-detection note as a file (HIGH)
When a ticket is handed to JD2, JD2 should get the full-detection note as a downloadable **notepad/.txt** (or shown in a panel + download).
- Backend `routers/jd2.py`: include the saved `page_notes` in the JD2 item; add a `GET /api/jd2/{id}/full-detection.txt` (or reuse the documents download pattern already there: `GET /api/jd2/{id}/documents/{doc_id}`) that returns the notes as text/plain.
- Frontend `pages/JD2AdjudicationPage.tsx`: show the note + a Download button.

### D. Inbox status after JD1/JD2 create (HIGH — currently broken)
After creating/handing off from JD1 or JD2, the ticket should appear in the **Inbox** with the correct status. This is NOT happening — investigate the ticket-create/update + status wiring.
- Look at where tickets are created (JD1 upload auto-create → status "Awaiting documents") and where JD2 handoff updates status. Ensure both write to the same store the Inbox reads (`Collection`), and that the Inbox query includes the new statuses. Likely a store/status-key mismatch. Files: `routers/jd1.py`, `routers/jd2.py`, the inbox/tickets router, and the Inbox page component.

### E. Assignment — proper flow (HIGH — currently broken)
Clicking **Assign** should prompt for the team-member to assign to (a picker of user names), then assign. Who-can-assign-whom is controlled from **Settings**.
- Backend already has `PUT /api/jd2/{id}/assign` (adds `assignee`). Add: a users list endpoint for the picker (or reuse `store.py`), and a Settings-driven permission map (role → can assign to whom). 
- Frontend: replace the current assign control with a name-picker modal; gate options by the Settings permission map. Files: `pages/JD2AdjudicationPage.tsx`, Settings page, `store.py`.

### F. Delete tickets — button outside + bulk (MEDIUM — like Freshdesk)
Delete button should be **outside** (visible in the ticket row/queue, not buried), and **bulk delete** (multi-select) allowed. Super-admin only; logged to audit.
- Backend already has `DELETE /api/jd2/{id}` (super_admin, deletes blobs + linked claim + `audit.record`). Confirm a bulk variant or call it per-id. 
- Frontend: add row-level checkboxes + a bulk Delete action + a visible per-row delete; confirm dialog. Files: Inbox/queue page, `pages/JD2AdjudicationPage.tsx`.

### G. AI results more specific/detailed (MEDIUM)
Make extracted notes and summaries richer. The full-detection prompt was already strengthened (section 5). If more is needed, also strengthen `_gemini_values` prompt (`routers/review.py`) and the JD1 note prompt (`adapters/jd1.py` — the big prompt built in `read_packet`). Consider raising per-call output token limits where the adapter supports it.

### H. Overall "works like Freshdesk" (ONGOING)
Inbox = ticket list with status, assignee, filters, bulk actions, per-ticket detail with the doc + AI results + next-step. Use D/E/F above as the concrete pieces.

### I. Performance — CPU/RAM (LOW, at deploy)
If speed still matters after the parallelism fix, bump the Cloud Run service resources:
```
gcloud run services update ulink-api --region asia-southeast1 --cpu 2 --memory 2Gi
```
(pymupdf rasterization is CPU-bound; 2 vCPU / 2 GiB helps concurrent page batches.) Also consider `--concurrency` and min instances to avoid cold starts during the demo.

---

## 7. Deploy (when ready)

**Before deploy:** remove the temporary `_debug` endpoint in `routers/ai_settings.py`. Ensure the Cloud Run **service account** has role **Vertex AI User** and the project has **aiplatform.googleapis.com** enabled (already enabled for `ulink-claimflow`). Set the same env vars on the service (`VERTEX_PROJECT`, `VERTEX_LOCATION=global`, `VERTEX_MODEL=gemini-3.6-flash`) — no Vertex key needed; the SA authenticates automatically.

Push (PowerShell, from D:):
```
cd D:\ClaudeData\Ulink\ulink-claimflow
git add -A
git commit -m "Vertex AI provider + speed & prompt fixes"
git push origin main
```
Deploy (Cloud Shell): `git pull`, then the existing Cloud Build → Cloud Run deploy to service **`ulink-api`**. (There was a duplicate service `ulink-claimflow-app` — it was deleted; deploy only to `ulink-api`.)

---

## 8. Key files map

```
backend/app/
  ai_provider.py        # shared AI layer: providers, priority, adapters, generate_text()
  config.py             # env-driven Settings (incl. VERTEX_*, GROQ_*, OPENROUTER_*)
  db.py                 # Firestore-or-memory Collection
  storage.py            # GCS-or-memory blobs
  audit.py              # audit log
  routers/
    ai_settings.py      # GET/PUT /api/ai-settings, /status, _debug (REMOVE _debug before deploy)
    review.py           # /api/review (fields) + /api/review/pages (full detection)
    jd1.py              # JD1 note/ticket endpoints
    jd2.py              # JD2 adjudication: assign, note, delete, documents, handoff
    assistant.py        # in-app help assistant
    extract.py          # rules/benefits extraction for Settings
    audit.py
  adapters/
    jd1.py              # packet reader; pdf_text_by_page, pdf_page_images (rasterize), read_packet, draft_client_mail
    ocr.py              # OCR provider (now AIProvider via shared layer)
    docai.py            # Document AI (OFF by default; USE_DOCAI=1 to enable highlight boxes)
frontend/src/
  components/DocReview.tsx     # Required fields + Full detection viewer (item A/B here)
  lib/review.ts               # reviewDoc + reviewDocPagesRange (streamed ranges)
  pages/JD1ReviewPage.tsx     # JD1 UI
  pages/JD2AdjudicationPage.tsx  # JD2 UI (items C/E/F here)
  lib/insurers.ts, lib/jd1.ts # insurer schemas + JD1 API calls
```

## 9. Gotchas learned
- Async FastAPI endpoints doing blocking httpx **serialize** — always `run_in_threadpool` the AI calls for parallelism.
- `gemini-3.6-flash` is NOT on Vertex `asia-southeast1` (404); use `global`.
- Vertex needs `google-auth` **and** `requests` installed; token via ADC.
- The AI Studio key format `AQ.Ab8...` IS valid (new format) — it's not wrong; its problem was the 20/day free cap.
- Windows Notepad can silently save `.env.txt`; verify with `Select-String -Path .env -Pattern VERTEX`.
- Do NOT re-enable Document AI to fix AI issues (user directive); it's only for highlight boxes.
