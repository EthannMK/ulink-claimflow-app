import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from app.routers import health, claims, auth, users, scan, jd1, jd2, assistant, extract, review, audit, ai_settings, access_settings, usage, teams, prompts

import logging
from app.config import settings

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

# Production safety: on Cloud Run (K_SERVICE is set there) a real JWT secret is mandatory —
# with the development default anyone could forge a Super Admin login.
if os.getenv("K_SERVICE") and (settings.jwt_secret in ("", "dev-secret-change-me") or len(settings.jwt_secret) < 32):
    raise RuntimeError("JWT_SECRET must be set to a long random value (32+ characters) in production.")

app = FastAPI(title="Ulink ClaimFlow API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    # localhost (dev) + any *.vercel.app (deployed frontend) + optional exact origins via env
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?|https://([a-z0-9-]+\.)*vercel\.app",
    allow_methods=["*"], allow_headers=["*"], allow_credentials=True,
)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(scan.router)
app.include_router(jd1.router)
app.include_router(jd2.router)
app.include_router(assistant.router)
app.include_router(extract.router)
app.include_router(review.router)
app.include_router(claims.router)
app.include_router(audit.router)
app.include_router(ai_settings.router)
app.include_router(access_settings.router)
app.include_router(usage.router)
app.include_router(teams.router)
app.include_router(prompts.router)

# ---- serve the built frontend (single Cloud Run URL = API + web app) ----
# The Docker build drops the Vite build into /app/static. If present, serve it with SPA fallback.
STATIC_DIR = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "static"))
if os.path.isdir(STATIC_DIR):
    _INDEX = os.path.join(STATIC_DIR, "index.html")

    @app.get("/{full_path:path}")
    async def spa(full_path: str):
        # serve a real static file if it exists (assets, images), else the SPA entry point
        candidate = os.path.normpath(os.path.join(STATIC_DIR, full_path))
        if full_path and candidate.startswith(STATIC_DIR) and os.path.isfile(candidate):
            return FileResponse(candidate)
        return FileResponse(_INDEX)
