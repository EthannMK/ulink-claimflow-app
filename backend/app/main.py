from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, claims, auth, users, scan, jd1, jd2

app = FastAPI(title="Ulink ClaimFlow API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["*"], allow_headers=["*"], allow_credentials=True,
)
app.include_router(health.router)
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(scan.router)
app.include_router(jd1.router)
app.include_router(jd2.router)
app.include_router(claims.router)
