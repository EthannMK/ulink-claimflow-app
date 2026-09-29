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
import threading
import time
from typing import Callable

_emit: contextvars.ContextVar[Callable[[dict], None] | None] = contextvars.ContextVar("progress_emit", default=None)
_text: contextvars.ContextVar[Callable[[str], None] | None] = contextvars.ContextVar("progress_text", default=None)
_cancel: contextvars.ContextVar[threading.Event | None] = contextvars.ContextVar("progress_cancel", default=None)


class Cancelled(BaseException):
    """The user cancelled this job. A BaseException on purpose, so the many
    `except Exception` fallbacks (e.g. "try the next AI service") don't swallow it."""


def set_cancel_event(ev: threading.Event | None) -> None:
    _cancel.set(ev)


def check() -> None:
    """Raise Cancelled if the user cancelled the current job. Called on every progress
    event and every streamed chunk, so a cancel stops the AI within a second or two
    (leaving the streaming block closes the connection to the AI service)."""
    ev = _cancel.get()
    if ev is not None and ev.is_set():
        raise Cancelled()


def set_emitter(fn: Callable[[dict], None] | None) -> None:
    _emit.set(fn)


def active() -> bool:
    return _emit.get() is not None


def emit(text: str, pct: float | None = None, kind: str = "step", **extra) -> None:
    """Report one step: text is shown in the activity log; pct (0-100) moves the bar."""
    check()
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
    check()
    fn = _text.get()
    if fn:
        try:
            fn(so_far)
        except Exception:
            pass
