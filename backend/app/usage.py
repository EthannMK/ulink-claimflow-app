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
import contextvars
import time
import uuid
from app.db import Collection

_log = Collection("ai_usage")

# Google's published Vertex AI prices, USD per 1,000,000 tokens, for the GLOBAL endpoint
# (regional endpoints cost 10% more). Output includes the model's "thinking" tokens.
# Rows: (model name prefix, valid from YYYY-MM-DD, input, output, cached input). Google does not
# offer a price API for Vertex, so update this table when Google changes its price list
# (cloud.google.com/vertex-ai/generative-ai/pricing). Checked 2026-10-03.
VERTEX_PRICES: list[tuple[str, str, float, float, float]] = [
    ("gemini-3.8-flash", "2000-01-01", 0.75, 3.75, 0.075), ("gemini-3.8-flash", "2027-01-01", 1.50, 7.50, 0.15),
    ("gemini-3.7-flash", "2000-01-01", 0.75, 3.75, 0.075), ("gemini-3.7-flash", "2027-01-01", 1.50, 7.50, 0.15),
    ("gemini-3.6-flash", "2000-01-01", 0.75, 3.75, 0.075), ("gemini-3.6-flash", "2027-01-01", 1.50, 7.50, 0.15),
    ("gemini-3.5-flash-lite", "2000-01-01", 0.30, 2.50, 0.03),
    ("gemini-3.5-flash", "2000-01-01", 1.50, 9.00, 0.15),
    ("gemini-3.1-flash-lite", "2000-01-01", 0.25, 1.50, 0.025),
]
# Any other model: priced like the main model (better to over- than under-estimate).
FALLBACK_PRICE = {"in": 0.75, "out": 3.75, "cached": 0.075}


def vertex_price(model: str, day: str = "") -> tuple[float, float, float]:
    """(input, output, cached input) USD per 1M tokens for a Vertex model on a given day."""
    from app.config import settings
    m = (model or "").lower().split("/")[-1]
    day = day or time.strftime("%Y-%m-%d", time.gmtime())
    best = None
    for prefix, start, p_in, p_out, p_c in VERTEX_PRICES:
        if m.startswith(prefix) and start <= day and (best is None or (len(prefix), start) > (len(best[0]), best[1])):
            best = (prefix, start, p_in, p_out, p_c)
    p = (best[2], best[3], best[4]) if best else (FALLBACK_PRICE["in"], FALLBACK_PRICE["out"], FALLBACK_PRICE["cached"])
    if (settings.vertex_location or "global") != "global":
        p = tuple(round(x * 1.1, 6) for x in p)
    return p


def _cost(provider: str, tokens_in: int, tokens_out: int, model: str = "", cached_in: int = 0) -> float:
    """USD for one call.
    Vertex: Google's price list above (input, output incl. thinking, cheaper cached input).
    OpenRouter: the live price of that exact model (model catalog, fetched if needed)."""
    if provider == "vertex":
        p_in, p_out, p_c = vertex_price(model)
        cached = min(max(cached_in or 0, 0), tokens_in)
        return round(((tokens_in - cached) * p_in + cached * p_c + tokens_out * p_out) / 1_000_000, 6)
    p_in, p_out = FALLBACK_PRICE["in"], FALLBACK_PRICE["out"]
    try:
        from app import model_catalog
        live = model_catalog.cached_price(provider, model) if model else None
        if live is None and model:
            model_catalog.list_models(provider)          # not loaded since the last restart -> load once
            live = model_catalog.cached_price(provider, model)
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


# ---- allowance periods -------------------------------------------------------
# Works like the usage limits of AI platforms: a limit applies to the CURRENT period. A period
# ends when the Super Admin resets the allowance, or automatically on the 1st of each month
# (Myanmar time) for users set to "monthly". Ending a period never deletes anything: every AI
# call stays in the usage log (AI Usage, Cloud costs) and the closed period is kept on the
# user as a summary (last 12) so you can see what they used before the reset.
PERIODS = ("none", "monthly")
_KEEP_PERIODS = 12


def _month() -> str:
    return _today()[:7]


def next_renewal(u: dict) -> str | None:
    """'YYYY-MM-01' of the next automatic renewal, or None."""
    if (u or {}).get("usage_period") != "monthly":
        return None
    y, m = map(int, _month().split("-"))
    y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return f"{y:04d}-{m:02d}-01"


def _close_period(u: dict, reason: str, by: str, reset_today: bool = True) -> dict:
    """Archive the current period on the user record and start a new one (does not save)."""
    hist = list(u.get("usage_periods") or [])
    hist.append({"start": u.get("usage_period_start") or u.get("created_at") or None, "end": time.time(),
                 "spent_usd": round(float(u.get("usage_spent_usd") or 0.0), 6),
                 "cap_usd": u.get("usage_cap_usd"), "daily_cap_usd": u.get("daily_cap_usd"),
                 "reason": reason, "by": by})
    u["usage_periods"] = hist[-_KEEP_PERIODS:]
    u["usage_spent_usd"] = 0.0
    if reset_today:
        u["usage_day_spent_usd"] = 0.0
    u["usage_period_start"] = time.time()
    u["usage_period_month"] = _month()
    return u


def roll_period(u: dict | None) -> dict | None:
    """Monthly allowances renew on the 1st: applied the first time the user is looked at."""
    if not u or u.get("usage_period") != "monthly":
        return u
    if u.get("usage_period_month") == _month():
        return u
    from app import store
    if not u.get("usage_period_month"):           # just switched to monthly: start counting now
        u["usage_period_month"] = _month()
        u.setdefault("usage_period_start", time.time())
        return store.update_user(u["id"], usage_period_month=u["usage_period_month"], usage_period_start=u["usage_period_start"]) or u
    _close_period(u, "monthly renewal", "system", reset_today=False)
    return store.update_user(u["id"], usage_spent_usd=0.0, usage_periods=u["usage_periods"],
                             usage_period_start=u["usage_period_start"], usage_period_month=u["usage_period_month"]) or u


_KEEP = object()


def set_allowance(uid: str, by: str, *, total_usd=_KEEP, daily_usd=_KEEP, period: str | None = None,
                  reset_total: bool = False, reset_today: bool = False, reason: str = "") -> dict:
    """One place for the Super Admin to change a user's allowance: new limits (None = no limit,
    _KEEP = unchanged), renewal (none / monthly) and an optional reset of what was used."""
    from app import store
    u = store.get_by_id(uid)
    if not u:
        raise KeyError(uid)
    for v in (total_usd, daily_usd):
        if v is not _KEEP and v is not None and (v < 0 or v > 1_000_000):
            raise ValueError("Limits must be between 0 and 1,000,000 USD")
    if period is not None and period not in PERIODS:
        raise ValueError("Renewal must be 'none' or 'monthly'")
    before = {"spent_usd": round(float(u.get("usage_spent_usd") or 0.0), 6), "today_usd": round(today_spent(u), 6),
              "cap_usd": u.get("usage_cap_usd"), "daily_cap_usd": u.get("daily_cap_usd"), "period": u.get("usage_period") or "none"}
    if reset_total:
        _close_period(u, (reason or "reset by admin").strip()[:200], by, reset_today=reset_today)
    elif reset_today:
        u["usage_day_spent_usd"] = 0.0
    if total_usd is not _KEEP:
        u["usage_cap_usd"] = None if total_usd is None else round(float(total_usd), 6)
    if daily_usd is not _KEEP:
        u["daily_cap_usd"] = None if daily_usd is None else round(float(daily_usd), 6)
    if period is not None:
        u["usage_period"] = period
        if period == "monthly":
            u["usage_period_month"] = _month()
            u.setdefault("usage_period_start", time.time())
    fields = {k: u.get(k) for k in ("usage_spent_usd", "usage_day_spent_usd", "usage_cap_usd", "daily_cap_usd",
                                    "usage_period", "usage_period_month", "usage_period_start", "usage_periods")}
    store.update_user(uid, **{k: v for k, v in fields.items() if v is not None})
    # update_user skips None values, so clear removed limits explicitly
    store.update_user(uid, clear_usage_cap=u["usage_cap_usd"] is None, clear_daily_cap=u["daily_cap_usd"] is None)
    return {"user": store.get_by_id(uid), "before": before}


def period_info(u: dict) -> dict:
    """What the user (and the Super Admin) are shown about the current allowance period."""
    hist = list((u or {}).get("usage_periods") or [])
    last = hist[-1] if hist else None
    return {"period": (u or {}).get("usage_period") or "none", "period_start": (u or {}).get("usage_period_start"),
            "renews_on": next_renewal(u or {}),
            "last_reset": None if not last else {"at": last.get("end"), "reason": last.get("reason", ""), "by": last.get("by", ""),
                                                 "used_tokens": to_tokens(last.get("spent_usd") or 0)}}


def today_spent(u: dict) -> float:
    """What this user has spent today (local day, see APP_TZ_OFFSET_MIN) — all providers & models."""
    return float(u.get("usage_day_spent_usd") or 0.0) if u.get("usage_day") == _today() else 0.0


def check_cap(username: str) -> None:
    """Raise UsageCapExceeded if this user has reached their total or daily limit.
    Both limits count spend on EVERY provider and model combined. None = no limit."""
    if not username:
        return
    from app import store
    u = roll_period(store.get_by_username(username))
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


# ---- client billing in tokens ------------------------------------------------
# Limits are stored in USD (real cost). Everyone except the Super Admin sees them as
# "AI tokens" instead: tokens = USD / rate * 1,000,000, with ONE rate the Super Admin
# sets (e.g. 1M tokens = $0.15). A single fixed rate keeps the numbers stable for
# billing clients even though real prices differ between models and input/output.
DEFAULT_USD_PER_1M_TOKENS = 0.15


def _settings():
    from app.ai_provider import settings_store   # lazy: ai_provider imports this module
    return settings_store


def billing_rate() -> float:
    """USD per 1,000,000 client tokens."""
    try:
        r = float((_settings().get("billing") or {}).get("usd_per_1m_tokens") or 0)
    except Exception:
        r = 0.0
    return r if r > 0 else DEFAULT_USD_PER_1M_TOKENS


def save_billing_rate(rate: float) -> float:
    rate = float(rate)
    if not (0.001 <= rate <= 1000):
        raise ValueError("The rate must be between $0.001 and $1,000 per 1M tokens")
    _settings().put("billing", {"usd_per_1m_tokens": round(rate, 6)})
    return rate


def to_tokens(usd) -> int | None:
    return None if usd is None else int(round(float(usd) / billing_rate() * 1_000_000))


def actual_rate() -> dict:
    """What the real calls so far cost per 1M tokens (in+out) — helps pick the billing rate."""
    cost = tok = n = 0
    for e in _log.all():
        t = (e.get("tokens_in") or 0) + (e.get("tokens_out") or 0)
        if e.get("ok", True) and t and e.get("cost_usd"):
            cost += float(e["cost_usd"]); tok += t; n += 1
    return {"usd_per_1m_tokens": round(cost / tok * 1_000_000, 4) if tok else None, "calls": n, "tokens": tok}


def cap_message(e: "UsageCapExceeded") -> str:
    """Shown to the user, so it is in tokens (never dollars)."""
    used, cap = f"{to_tokens(e.spent):,}", f"{to_tokens(e.cap):,}"
    if e.kind == "daily":
        return (f"Your daily AI token limit has been reached ({used} of {cap} tokens today). "
                "It resets at midnight — or ask your administrator to raise it.")
    return (f"Your AI token limit has been reached ({used} of {cap} tokens used). "
            "Please contact your administrator to raise it.")


_tally: contextvars.ContextVar[list | None] = contextvars.ContextVar("usage_tally", default=None)


def start_tally() -> list:
    """Start adding up the cost of every AI call made in this context (e.g. one JD1 scan)."""
    t: list = []
    _tally.set(t)
    return t


def tally_tokens(t: list) -> int:
    """Client tokens charged for the calls collected by start_tally()."""
    return to_tokens(sum(t)) or 0


def record(username: str, provider: str, model: str, tokens_in: int, tokens_out: int,
           ok: bool, purpose: str = "", seconds: float = 0.0, cached_in: int = 0,
           billed_usd: float | None = None) -> float:
    """Log one AI call and (if it had a real cost) add it to the user's running
    total. Returns the cost in USD of this call (0.0 for free providers/failed calls).
    billed_usd = what the provider itself says it charged (OpenRouter) — used as-is."""
    if not ok:
        cost = 0.0
    elif billed_usd is not None and billed_usd >= 0:
        cost = round(float(billed_usd), 6)
    else:
        cost = _cost(provider, tokens_in or 0, tokens_out or 0, model, cached_in or 0)
    t = _tally.get()
    if t is not None:
        t.append(cost)
    entry_id = uuid.uuid4().hex
    _log.put(entry_id, {
        "id": entry_id, "ts": time.time(), "user": username or "", "provider": provider or "",
        "model": model or "", "tokens_in": tokens_in or 0, "tokens_out": tokens_out or 0,
        "cost_usd": cost, "ok": bool(ok), "purpose": purpose, "seconds": round(float(seconds or 0.0), 2),
        "cached_in": int(cached_in or 0), "cost_source": ("provider" if (ok and billed_usd is not None) else "price list"),
    })
    if username and cost:
        from app import store
        u = roll_period(store.get_by_username(username))
        if u:
            new_spent = round(float(u.get("usage_spent_usd") or 0.0) + cost, 6)
            day = _today()
            new_day = round((today_spent(u) if u.get("usage_day") == day else 0.0) + cost, 6)
            store.update_user(u["id"], usage_spent_usd=new_spent, usage_day=day, usage_day_spent_usd=new_day)
    return cost


def my_usage(username: str, include_usd: bool = False) -> dict:
    """A user's own allowance. Everyone gets it in client tokens; only the Super Admin
    (include_usd=True) also gets the dollar amounts and real token counts."""
    from app import store
    u = roll_period(store.get_by_username(username)) if username else None
    spent = float((u or {}).get("usage_spent_usd") or 0.0)
    cap = (u or {}).get("usage_cap_usd")
    tday = today_spent(u) if u else 0.0
    dcap = (u or {}).get("daily_cap_usd")
    entries = [e for e in _log.all() if e.get("user") == username] if u else []
    rem = max(float(cap) - spent, 0) if cap is not None else None
    drem = max(float(dcap) - tday, 0) if dcap is not None else None
    out = {
        "requests": len(entries),
        "used_tokens": to_tokens(spent), "cap_tokens": to_tokens(cap), "remaining_tokens": to_tokens(rem),
        "today_tokens": to_tokens(tday), "daily_cap_tokens": to_tokens(dcap), "daily_remaining_tokens": to_tokens(drem),
        **period_info(u or {}),
    }
    if include_usd:
        out.update({
            "spent_usd": round(spent, 4), "cap_usd": cap, "remaining_usd": round(rem, 4) if rem is not None else None,
            "today_usd": round(tday, 4), "daily_cap_usd": dcap, "daily_remaining_usd": round(drem, 4) if drem is not None else None,
            "real_tokens": sum((e.get("tokens_in") or 0) + (e.get("tokens_out") or 0) for e in entries),
            "usd_per_1m_tokens": billing_rate(),
        })
    return out


def my_history(username: str, limit: int = 50, include_usd: bool = False) -> list[dict]:
    """A user's own AI use, newest first, one row per use: calls of the same task made within a
    few minutes of each other (e.g. all page batches of one full detection) are one row.
    Only the task name and the client tokens charged — never the provider, model or dollars
    (dollars are added for the Super Admin only)."""
    if not username:
        return []
    entries = sorted((e for e in _log.all() if e.get("user") == username), key=lambda e: e.get("ts", 0))
    gap = 180
    rows: list[dict] = []
    open_by_task: dict[str, dict] = {}
    for e in entries:
        task = e.get("purpose") or "Other"
        r = open_by_task.get(task)
        if not r or e.get("ts", 0) - r["last_ts"] > gap:
            r = {"task": task, "first_ts": e.get("ts", 0), "last_ts": e.get("ts", 0), "calls": 0, "failed": 0, "usd": 0.0}
            rows.append(r)
            open_by_task[task] = r
        r["last_ts"] = e.get("ts", 0)
        r["calls"] += 1
        r["failed"] += 0 if e.get("ok", True) else 1
        r["usd"] += float(e.get("cost_usd") or 0.0)
    out = []
    for r in reversed(rows[-limit:]):
        item = {"task": r["task"], "when": r["first_ts"], "ended": r["last_ts"], "steps": r["calls"],
                "tokens": to_tokens(r["usd"]) or 0,
                # a failed try followed by a successful backup try is still a finished task
                "status": "ok" if r["calls"] > r["failed"] else "failed"}
        if include_usd:
            item["usd"] = round(r["usd"], 6)
        out.append(item)
    return out


def limits_overview() -> list[dict]:
    """Every user with both limits and where they stand — for the Super Admin."""
    from app import store
    out = []
    for u in store.list_users():
        u = roll_period(u)
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
            "used_tokens": to_tokens(spent), "cap_tokens": to_tokens(cap), "today_tokens": to_tokens(tday),
            "daily_cap_tokens": to_tokens(dcap),
            **period_info(u),
            "history": [{"start": h.get("start"), "end": h.get("end"), "reason": h.get("reason", ""), "by": h.get("by", ""),
                         "spent_usd": h.get("spent_usd"), "used_tokens": to_tokens(h.get("spent_usd") or 0),
                         "cap_usd": h.get("cap_usd"), "cap_tokens": to_tokens(h.get("cap_usd"))}
                        for h in reversed(u.get("usage_periods") or [])],
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
