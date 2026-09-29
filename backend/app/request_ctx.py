"""Per-request context so the shared AI provider layer can attribute usage/cost
to whichever signed-in user triggered the call, without threading a `user`
parameter through every adapter function signature.

Each router endpoint that triggers an AI call sets this once, at the top,
from the `user` it already gets via Depends(get_current_user). ai_provider.
generate_text() reads it back automatically to check/record usage.

Safe with FastAPI: sync endpoints run via anyio's threadpool, which copies
the current contextvars Context into the worker thread, and async endpoints
share the Context naturally. The one place that does NOT get this for free
is a manually created concurrent.futures.ThreadPoolExecutor (see
routers/review.py's _page_analysis) — that spot explicitly copies the
context itself before submitting work.
"""
from __future__ import annotations
import contextvars

_user: contextvars.ContextVar[str] = contextvars.ContextVar("ai_ctx_user", default="")


def set_user(username: str) -> None:
    _user.set(username or "")


def get_user() -> str:
    return _user.get()
