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


def _cost(provider: str, tokens_in: int, tokens_out: int, model: str = "") -> float:
    """Estimated USD. Uses the provider's live price for this exact model when the
    model catalog has fetched it (OpenRouter publishes prices), else the table above."""
    p_in, p_out = PRICE_PER_1M_TOKENS.get(provider, {"in": 0.0, "out": 0.0}).values()
    try:
        from app.model_catalog import cached_price
        live = cached_price(provider, model) if model else None
        if live:
            p_in, p_out = live
    except Exception:
        pass
    return round((tokens_in / 1_000_000) * p_in + (tokens_out / 1_000_000) * p_out, 6)


class UsageCapExceeded(Exception):
    """Raised by check_cap() when a user's TOTAL or DAILY limit is reached.
    kind = "total" | "daily"."""
    def __init__(self, spent: float, cap: float, kind: str = "total"):
        self.spent = spent
        self.cap = cap
        self.kind = kind
        super().__init__(f"{kind} usage cap reached: ${spent:.4f} of ${cap:.4f} used")


def _today() -> str:
    from app.config import settings
    return _day(time.time(), settings.app_tz_offset_min)


def today_spent(u: dict) -> float:
    """What this user has spent today (local day, see APP_TZ_OFFSET_MIN) — all providers & models."""
    return float(u.get("usage_day_spent_usd") or 0.0) if u.get("usage_day") == _today() else 0.0


def check_cap(username: str) -> None:
    """Raise UsageCapExceeded if this user has reached their total or daily limit.
    Both limits count spend on EVERY provider and model combined. None = no limit."""
    if not username:
        return
    from app import store
    u = store.get_by_username(username)
    if not u:
        return
    cap = u.get("usage_cap_usd")
    if cap is not None:
        spent = float(u.get("usage_spent_usd") or 0.0)
        if spent >= float(cap):
            raise UsageCapExceeded(spent, float(cap), "total")
    daily = u.get("daily_cap_usd")
    if daily is not None:
        spent_today = today_spent(u)
        if spent_today >= float(daily):
            raise UsageCapExceeded(spent_today, float(daily), "daily")


def cap_message(e: "UsageCapExceeded") -> str:
    if e.kind == "daily":
        return (f"Your daily AI limit has been reached (${e.spent:.2f} of ${e.cap:.2f} today). "
                "It resets at midnight — or ask your administrator to raise it.")
    return (f"Your AI usage limit has been reached (${e.spent:.2f} of ${e.cap:.2f} used). "
            "Please contact your administrator to raise it.")


def record(username: str, provider: str, model: str, tokens_in: int, tokens_out: int,
           ok: bool, purpose: str = "", seconds: float = 0.0) -> float:
    """Log one AI call and (if it had a real cost) add it to the user's running
    total. Returns the cost in USD of this call (0.0 for free providers/failed calls)."""
    cost = _cost(provider, tokens_in or 0, tokens_out or 0, model) if ok else 0.0
    entry_id = uuid.uuid4().hex
    _log.put(entry_id, {
        "id": entry_id, "ts": time.time(), "user": username or "", "provider": provider or "",
        "model": model or "", "tokens_in": tokens_in or 0, "tokens_out": tokens_out or 0,
        "cost_usd": cost, "ok": bool(ok), "purpose": purpose, "seconds": round(float(seconds or 0.0), 2),
    })
    if username and cost:
        from app import store
        u = store.get_by_username(username)
        if u:
            new_spent = round(float(u.get("usage_spent_usd") or 0.0) + cost, 6)
            day = _today()
            new_day = round((today_spent(u) if u.get("usage_day") == day else 0.0) + cost, 6)
            store.update_user(u["id"], usage_spent_usd=new_spent, usage_day=day, usage_day_spent_usd=new_day)
    return cost


def my_usage(username: str) -> dict:
    """A single user's own spend/cap/remaining — what a normal (non-admin) user sees."""
    from app import store
    u = store.get_by_username(username) if username else None
    if not u:
        return {"spent_usd": 0.0, "cap_usd": None, "remaining_usd": None, "requests": 0, "tokens": 0,
                "today_usd": 0.0, "daily_cap_usd": None, "daily_remaining_usd": None}
    spent = float(u.get("usage_spent_usd") or 0.0)
    cap = u.get("usage_cap_usd")
    tday = today_spent(u)
    dcap = u.get("daily_cap_usd")
    entries = [e for e in _log.all() if e.get("user") == username]
    tokens = sum((e.get("tokens_in") or 0) + (e.get("tokens_out") or 0) for e in entries)
    return {
        "spent_usd": round(spent, 4),
        "cap_usd": cap,
        "remaining_usd": (round(max(float(cap) - spent, 0), 4) if cap is not None else None),
        "requests": len(entries),
        "tokens": tokens,
        "today_usd": round(tday, 4),
        "daily_cap_usd": dcap,
        "daily_remaining_usd": (round(max(float(dcap) - tday, 0), 4) if dcap is not None else None),
    }


def limits_overview() -> list[dict]:
    """Every user with both limits and where they stand — for the Super Admin."""
    from app import store
    out = []
    for u in store.list_users():
        spent, cap = float(u.get("usage_spent_usd") or 0.0), u.get("usage_cap_usd")
        tday, dcap = today_spent(u), u.get("daily_cap_usd")
        if cap is not None and spent >= float(cap):
            status = "total_reached"
        elif dcap is not None and tday >= float(dcap):
            status = "daily_reached"
        elif (cap is not None and float(cap) > 0 and round(spent / float(cap), 6) >= 0.8) or \
             (dcap is not None and float(dcap) > 0 and round(tday / float(dcap), 6) >= 0.8):
            status = "near"
        else:
            status = "ok"
        out.append({
            "id": u["id"], "username": u["username"], "name": u.get("name", ""), "role": u.get("role", ""),
            "active": u.get("active", True),
            "spent_usd": round(spent, 4), "cap_usd": cap,
            "remaining_usd": round(max(float(cap) - spent, 0), 4) if cap is not None else None,
            "today_usd": round(tday, 4), "daily_cap_usd": dcap,
            "daily_remaining_usd": round(max(float(dcap) - tday, 0), 4) if dcap is not None else None,
            "status": status,
        })
    order = {"total_reached": 0, "daily_reached": 1, "near": 2, "ok": 3}
    return sorted(out, key=lambda r: (order[r["status"]], -r["spent_usd"]))


def _day(ts: float, tz_offset_min: int) -> str:
    """Calendar day in the VIEWER's timezone (e.g. Myanmar = +390 min), so "today" matches their clock."""
    return time.strftime("%Y-%m-%d", time.gmtime(ts + tz_offset_min * 60))


def query(date_from: str = "", date_to: str = "", days: int = 30, tz_offset_min: int = 0,
          user: str = "", provider: str = "", model: str = "", feature: str = "", status: str = "") -> list[dict]:
    """Log entries matching every given filter. Dates are YYYY-MM-DD in the viewer's
    timezone; if no dates are given, the last `days` CALENDAR days are used
    (days=1 = today, days=7 = today + the 6 days before)."""
    out = []
    if not (date_from or date_to):
        date_from = _day(time.time() - (max(days, 1) - 1) * 86400, tz_offset_min)
    for e in _log.all():
        d = _day(e.get("ts", 0), tz_offset_min)
        if date_from and d < date_from:
            continue
        if date_to and d > date_to:
            continue
        if user and (e.get("user") or "") != user:
            continue
        if provider and e.get("provider") != provider:
            continue
        if model and e.get("model") != model:
            continue
        if feature and (e.get("purpose") or "") != feature:
            continue
        if status == "ok" and not e.get("ok", True):
            continue
        if status == "failed" and e.get("ok", True):
            continue
        out.append(e)
    return out


def _tok(e: dict) -> tuple[int, int]:
    return int(e.get("tokens_in") or 0), int(e.get("tokens_out") or 0)


def _group(entries: list[dict], keyf, seed) -> list[dict]:
    """Group entries -> requests, failed, tokens in/out, cost, first/last used (epoch)."""
    g: dict = {}
    for e in entries:
        k = keyf(e)
        row = g.get(k)
        if row is None:
            row = g[k] = {**seed(e), "requests": 0, "failed": 0, "tokens_in": 0, "tokens_out": 0,
                          "cost_usd": 0.0, "first_ts": e.get("ts", 0), "last_ts": e.get("ts", 0),
                          "_secs": 0.0, "_timed": 0, "avg_seconds": None, "max_seconds": None}
        ti, to = _tok(e)
        row["requests"] += 1
        row["failed"] += 0 if e.get("ok", True) else 1
        row["tokens_in"] += ti
        row["tokens_out"] += to
        row["cost_usd"] = round(row["cost_usd"] + (e.get("cost_usd") or 0.0), 6)
        row["first_ts"] = min(row["first_ts"], e.get("ts", 0))
        row["last_ts"] = max(row["last_ts"], e.get("ts", 0))
        sec = e.get("seconds")
        if sec:                                  # older entries have no timing
            row["_secs"] += float(sec)
            row["_timed"] += 1
            row["max_seconds"] = max(row["max_seconds"] or 0.0, float(sec))
    for row in g.values():
        if row["_timed"]:
            row["avg_seconds"] = round(row["_secs"] / row["_timed"], 1)
        row.pop("_secs"); row.pop("_timed")
    return sorted(g.values(), key=lambda r: (-r["cost_usd"], -r["requests"]))


def summary(tz_offset_min: int = 0, **filters) -> dict:
    """Aggregate view for the Super Admin dashboard — every panel honours the same filters."""
    entries = query(tz_offset_min=tz_offset_min, **filters)
    requests = len(entries)
    failed = sum(1 for e in entries if not e.get("ok", True))
    tin = sum(_tok(e)[0] for e in entries)
    tout = sum(_tok(e)[1] for e in entries)
    lbl = lambda e: _label(e.get("provider", ""))
    by_day = _group(entries, lambda e: _day(e.get("ts", 0), tz_offset_min),
                    lambda e: {"day": _day(e.get("ts", 0), tz_offset_min)})
    by_day.sort(key=lambda r: r["day"])
    return {
        "total_cost_usd": round(sum(e.get("cost_usd") or 0.0 for e in entries), 4),
        "total_tokens": tin + tout, "tokens_in": tin, "tokens_out": tout,
        "requests": requests, "failed": failed,
        "success_rate": round(100 * (requests - failed) / requests, 1) if requests else 100.0,
        "active_users": len({e.get("user") or "" for e in entries}),
        "avg_seconds": (round(sum(float(e["seconds"]) for e in entries if e.get("seconds")) /
                              max(1, sum(1 for e in entries if e.get("seconds"))), 1)
                        if any(e.get("seconds") for e in entries) else None),
        "by_day": by_day,
        "by_model": _group(entries, lambda e: (e.get("provider"), e.get("model")),
                           lambda e: {"provider": e.get("provider", ""), "provider_label": lbl(e), "model": e.get("model", "")}),
        "by_feature": _group(entries, lambda e: e.get("purpose") or "Other",
                             lambda e: {"feature": e.get("purpose") or "Other"}),
        "by_user": _group(entries, lambda e: e.get("user") or "(unknown)",
                          lambda e: {"user": e.get("user") or "(unknown)"}),
        "by_user_model": _group(entries, lambda e: (e.get("user") or "(unknown)", e.get("provider"), e.get("model")),
                                lambda e: {"user": e.get("user") or "(unknown)", "provider": e.get("provider", ""),
                                           "provider_label": lbl(e), "model": e.get("model", "")}),
    }


def options() -> dict:
    """Every distinct value ever logged, for the dashboard's filter dropdowns."""
    all_e = _log.all()
    return {
        "users": sorted({e.get("user") or "" for e in all_e} - {""}),
        "providers": [{"id": p, "label": _label(p)} for p in sorted({e.get("provider") or "" for e in all_e} - {""})],
        "models": sorted({e.get("model") or "" for e in all_e} - {""}),
        "features": sorted({e.get("purpose") or "Other" for e in all_e}),
    }


def recent(limit: int = 200, tz_offset_min: int = 0, **filters) -> list[dict]:
    """Individual calls matching the filters, newest first."""
    entries = sorted(query(tz_offset_min=tz_offset_min, **filters), key=lambda e: e.get("ts", 0), reverse=True)[:limit]
    return [{**e, "provider_label": _label(e.get("provider", "")), "feature": e.get("purpose") or "Other"} for e in entries]


def export_csv(tz_offset_min: int = 0, **filters) -> str:
    """All matching calls as CSV (local date/time), for Excel / audit."""
    import csv, io as _io
    buf = _io.StringIO()
    w = csv.writer(buf)
    w.writerow(["date_time_local", "user", "feature", "provider", "model", "status",
                "tokens_in", "tokens_out", "cost_usd_estimate", "seconds"])
    for e in sorted(query(tz_offset_min=tz_offset_min, **filters), key=lambda e: e.get("ts", 0)):
        ts = e.get("ts", 0) + tz_offset_min * 60
        ti, to = _tok(e)
        w.writerow([time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(ts)), e.get("user", ""), e.get("purpose") or "Other",
                    _label(e.get("provider", "")), e.get("model", ""), "ok" if e.get("ok", True) else "failed",
                    ti, to, e.get("cost_usd", 0.0), e.get("seconds", "")])
    return buf.getvalue()


def _label(provider: str) -> str:
    from app.ai_provider import provider_label
    return provider_label(provider)


def cap_http_error(e: "UsageCapExceeded"):
    """The HTTPException every AI endpoint returns when a user's cap is reached."""
    from fastapi import HTTPException
    return HTTPException(status_code=402, detail=cap_message(e))
