"""Live progress events for long AI jobs (e.g. a JD1 scan).

A streaming endpoint sets an emitter for the current request (a contextvar, so it
follows the work into its worker thread); code anywhere below it calls
`progress.emit(...)` to report a step. With no emitter set, every call is a no-op,
so the normal (non-streaming) endpoints are unaffected.

Wording rule: messages are shown to ordinary users, so they must NEVER contain AI
provider or model names — say "primary AI service" / "backup AI service".
"""
from __future__ import annotations
import contextvars
import time
from typing import Callable

_emit: contextvars.ContextVar[Callable[[dict], None] | None] = contextvars.ContextVar("progress_emit", default=None)
_text: contextvars.ContextVar[Callable[[str], None] | None] = contextvars.ContextVar("progress_text", default=None)


def set_emitter(fn: Callable[[dict], None] | None) -> None:
    _emit.set(fn)


def active() -> bool:
    return _emit.get() is not None


def emit(text: str, pct: float | None = None, kind: str = "step", **extra) -> None:
    """Report one step: text is shown in the activity log; pct (0-100) moves the bar."""
    fn = _emit.get()
    if fn:
        try:
            fn({"type": kind, "text": text, "pct": pct, "t": time.time(), **extra})
        except Exception:
            pass


def set_text_listener(fn: Callable[[str], None] | None) -> None:
    """Receives the AI's reply-so-far while it streams (used to detect which section it is writing)."""
    _text.set(fn)


def text(so_far: str) -> None:
    fn = _text.get()
    if fn:
        try:
            fn(so_far)
        except Exception:
            pass
