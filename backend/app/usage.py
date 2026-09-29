"""Per-call AI usage logging + per-user USD cost caps.

Every generate_text() call (regardless of which provider actually served it)
is logged here with the tokens that provider reported and an estimated USD
cost. A user's cumulative spend is cached on their own user record
(`usage_spent_usd`) so checking a cap is a single cheap read, not a full log
scan every time.

This is entirely independent of any provider's own billing/limits — it is
our own estimate, used only to stop a demo/testing account before it can run
up real spend on Vertex AI (or any other provider). Nothing here is sent to
any provider.
"""
from __future__ import annotations
import time
import uuid
from app.db import Collection

_log = Collection("ai_usage")

# Approximate list pricing, USD per 1,000,000 tokens. Edit these to match your
# actual billing — this only drives the in-app cap/estimate shown in the
# Usage dashboard, it is never sent anywhere. Providers with no real charge
# (a free tier) are priced at 0 so they never count against anyone's cap.
PRICE_PER_1M_TOKENS: dict[str, dict[str, float]] = {
    "vertex":     {"in": 0.10, "out": 0.40},   # Vertex AI — paid via your GCP credit
    "openrouter": {"in": 0.10, "out": 0.40},   # depends on the model/key you use — treat as paid once on a real key
}


def _cost(provider: str, tokens_in: int, tokens_out: int) -> float:
    p = PRICE_PER_1M_TOKENS.get(provider, {"in": 0.0, "out": 0.0})
    return round((tokens_in / 1_000_000) * p["in"] + (tokens_out / 1_000_000) * p["out"], 6)


class UsageCapExceeded(Exception):
    """Raised by check_cap() when a user has a usage_cap_usd set and has reached it."""
    def __init__(self, spent: float, cap: float):
        self.spent = spent
        self.cap = cap
        super().__init__(f"Usage cap reached: ${spent:.4f} of ${cap:.4f} used")


def check_cap(username: str) -> None:
    """Raise UsageCapExceeded if this user has a cap set and has reached it.
    No-op for an unknown user or one with no cap configured (cap=None means unlimited)."""
    if not username:
        return
    from app import store
    u = store.get_by_username(username)
    if not u:
        return
    cap = u.get("usage_cap_usd")
    if cap is None:
        return
    spent = float(u.get("usage_spent_usd") or 0.0)
    if spent >= float(cap):
        raise UsageCapExceeded(spent, float(cap))


def record(username: str, provider: str, model: str, tokens_in: int, tokens_out: int,
           ok: bool, purpose: str = "") -> float:
    """Log one AI call and (if it had a real cost) add it to the user's running
    total. Returns the cost in USD of this call (0.0 for free providers/failed calls)."""
    cost = _cost(provider, tokens_in or 0, tokens_out or 0) if ok else 0.0
    entry_id = uuid.uuid4().hex
    _log.put(entry_id, {
        "id": entry_id, "ts": time.time(), "user": username or "", "provider": provider or "",
        "model": model or "", "tokens_in": tokens_in or 0, "tokens_out": tokens_out or 0,
        "cost_usd": cost, "ok": bool(ok), "purpose": purpose,
    })
    if username and cost:
        from app import store
        u = store.get_by_username(username)
        if u:
            new_spent = round(float(u.get("usage_spent_usd") or 0.0) + cost, 6)
            store.update_user(u["id"], usage_spent_usd=new_spent)
    return cost


def my_usage(username: str) -> dict:
    """A single user's own spend/cap/remaining — what a normal (non-admin) user sees."""
    from app import store
    u = store.get_by_username(username) if username else None
    if not u:
        return {"spent_usd": 0.0, "cap_usd": None, "remaining_usd": None, "requests": 0, "tokens": 0}
    spent = float(u.get("usage_spent_usd") or 0.0)
    cap = u.get("usage_cap_usd")
    entries = [e for e in _log.all() if e.get("user") == username]
    tokens = sum((e.get("tokens_in") or 0) + (e.get("tokens_out") or 0) for e in entries)
    return {
        "spent_usd": round(spent, 4),
        "cap_usd": cap,
        "remaining_usd": (round(max(float(cap) - spent, 0), 4) if cap is not None else None),
        "requests": len(entries),
        "tokens": tokens,
    }


def summary(days: int = 30) -> dict:
    """Aggregate view for the Super Admin usage dashboard."""
    cutoff = time.time() - days * 86400
    entries = [e for e in _log.all() if e.get("ts", 0) >= cutoff]
    total_cost = round(sum(e.get("cost_usd") or 0.0 for e in entries), 4)
    total_tokens = sum((e.get("tokens_in") or 0) + (e.get("tokens_out") or 0) for e in entries)
    requests = len(entries)
    failed = sum(1 for e in entries if not e.get("ok", True))
    success_rate = round(100 * (requests - failed) / requests, 1) if requests else 100.0

    by_model: dict[str, dict] = {}
    by_day: dict[str, dict] = {}
    by_user: dict[str, dict] = {}
    for e in entries:
        key = f"{e.get('provider', '')}:{e.get('model', '')}"
        m = by_model.setdefault(key, {"provider": e.get("provider", ""), "model": e.get("model", ""),
                                       "requests": 0, "tokens": 0, "cost_usd": 0.0})
        m["requests"] += 1
        m["tokens"] += (e.get("tokens_in") or 0) + (e.get("tokens_out") or 0)
        m["cost_usd"] = round(m["cost_usd"] + (e.get("cost_usd") or 0.0), 6)

        day = time.strftime("%Y-%m-%d", time.gmtime(e.get("ts", 0)))
        d = by_day.setdefault(day, {"day": day, "requests": 0, "cost_usd": 0.0})
        d["requests"] += 1
        d["cost_usd"] = round(d["cost_usd"] + (e.get("cost_usd") or 0.0), 6)

        uname = e.get("user") or "(unknown)"
        ub = by_user.setdefault(uname, {"user": uname, "requests": 0, "cost_usd": 0.0})
        ub["requests"] += 1
        ub["cost_usd"] = round(ub["cost_usd"] + (e.get("cost_usd") or 0.0), 6)

    return {
        "total_cost_usd": total_cost, "total_tokens": total_tokens, "requests": requests,
        "failed": failed, "success_rate": success_rate,
        "by_model": sorted(by_model.values(), key=lambda x: -x["cost_usd"]),
        "by_day": sorted(by_day.values(), key=lambda x: x["day"]),
        "by_user": sorted(by_user.values(), key=lambda x: -x["cost_usd"]),
    }


def recent(limit: int = 200) -> list[dict]:
    """Most recent raw log entries, newest first — for a detail table."""
    entries = sorted(_log.all(), key=lambda e: e.get("ts", 0), reverse=True)
    return entries[:limit]


def cap_http_error(e: "UsageCapExceeded"):
    """The HTTPException every AI endpoint returns when a user's cap is reached."""
    from fastapi import HTTPException
    return HTTPException(
        status_code=402,
        detail=(f"Your AI usage limit has been reached (${e.spent:.2f} of ${e.cap:.2f} used). "
                "Please contact your administrator to raise it."),
    )
