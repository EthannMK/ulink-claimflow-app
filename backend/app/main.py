from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import health, claims, users

app = FastAPI(title="Ulink ClaimFlow API", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["http://localhost:5173"],
    allow_methods=["*"], allow_headers=["*"],
)
app.include_router(health.router)
app.include_router(claims.router)
app.include_router(users.router)
