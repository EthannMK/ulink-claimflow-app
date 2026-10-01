"""Infrastructure + AI cost dashboard (Super Admin only).

Two sources, kept apart so nothing is counted twice:
  * Google Cloud bill — the official "Billing export to BigQuery" table (Cloud Run, Vertex AI,
    Firestore, Cloud Storage, Cloud Build, Artifact Registry, Secret Manager, BigQuery, …).
    Google writes it several times a day; costs usually appear within ~24 hours.
  * Backup AI service (OpenRouter) — not on the Google bill, so it comes from the app's own
    per-call usage log (estimated from live prices).

Everything is grouped by component, by day (local time, APP_TZ_OFFSET_MIN) and by month, and
the current month gets a forecast from the recent daily pace.
"""
from __future__ import annotations
import calendar
import logging
import re
import threading
import time
from datetime import date, datetime, timedelta, timezone

import httpx

from app.config import settings
from app.db import Collection, project_id

log = logging.getLogger("claimflow.costs")
_settings = Collection("app_settings")
_DOC = "cloud_costs"
_CACHE: dict[str, tuple[float, dict]] = {}
_CACHE_SECONDS = 15 * 60
_TABLE_CACHE: dict[str, str] = {}
OTHER_AI = "Backup AI service (OpenRouter)"
DEFAULT_TRIAL_USD = 300.0
AI_RE = re.compile(r"vertex|gemini|ai platform|generative", re.I)


# ---------------------------------------------------------------- settings
def default_dataset() -> str:
    return f"{project_id() or 'ulink-claimflow'}.billing_export"


def get_settings() -> dict:
    d = _settings.get(_DOC) or {}
    return {"dataset": (d.get("dataset") or default_dataset()).strip(),
            "budget_usd": d.get("budget_usd"),
            # Google's standard free trial is $300; there is no Google API that returns the remaining balance
            "trial_credit_usd": d.get("trial_credit_usd") if d.get("trial_credit_usd") not in (None, "") else DEFAULT_TRIAL_USD}


def save_settings(dataset: str, budget_usd: float | None, trial_credit_usd: float | None) -> dict:
    dataset = (dataset or "").strip() or default_dataset()
    if not re.fullmatch(r"[A-Za-z0-9_.:-]+\.[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)?", dataset):
        raise ValueError("Enter the dataset as project.dataset (or a full project.dataset.table name)")
    for v in (budget_usd, trial_credit_usd):
        if v is not None and (v < 0 or v > 1_000_000):
            raise ValueError("Amounts must be between 0 and 1,000,000")
    doc = {"dataset": dataset, "budget_usd": budget_usd, "trial_credit_usd": trial_credit_usd}
    _settings.put(_DOC, doc)
    _CACHE.clear(); _TABLE_CACHE.clear()
    return doc


# ---------------------------------------------------------------- BigQuery (REST, no extra library)
class SetupNeeded(Exception):
    """Billing data can't be read yet — the message says what to do."""


_creds = None
_lock = threading.Lock()


def _token() -> str:
    global _creds
    import google.auth
    import google.auth.transport.requests
    with _lock:
        if _creds is None:
            _creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
        if not _creds.valid:
            _creds.refresh(google.auth.transport.requests.Request())
        return _creds.token


def _explain(r: httpx.Response, what: str) -> str:
    try:
        msg = r.json().get("error", {}).get("message", "")
    except Exception:
        msg = r.text[:200]
    if r.status_code == 403:
        return (f"{what}: permission denied. Give the app's service account the roles "
                f"'BigQuery Job User' and 'BigQuery Data Viewer' (see the setup steps). ({msg[:160]})")
    if r.status_code == 404:
        return (f"{what}: not found — check the dataset name, and that Billing export to BigQuery is "
                f"switched on (the table appears a few hours after you enable it). ({msg[:160]})")
    return f"{what} failed (HTTP {r.status_code}): {msg[:200]}"


def _find_table(dataset: str) -> str:
    """dataset 'proj.ds' -> 'proj.ds.gcp_billing_export_v1_XXXX' (the standard usage cost table)."""
    if dataset.count(".") == 2:
        return dataset
    if dataset in _TABLE_CACHE:
        return _TABLE_CACHE[dataset]
    proj, ds = dataset.split(".", 1)
    r = httpx.get(f"https://bigquery.googleapis.com/bigquery/v2/projects/{proj}/datasets/{ds}/tables",
                  params={"maxResults": 1000}, headers={"Authorization": f"Bearer {_token()}"}, timeout=30)
    if r.status_code != 200:
        raise SetupNeeded(_explain(r, f"Reading dataset {dataset}"))
    names = [t["tableReference"]["tableId"] for t in r.json().get("tables", [])]
    std = sorted(n for n in names if n.startswith("gcp_billing_export_v1_"))
    if not std:
        raise SetupNeeded(f"Dataset {dataset} exists but has no billing table yet. If you just switched on "
                          "the export, Google needs a few hours to create it.")
    _TABLE_CACHE[dataset] = f"{proj}.{ds}.{std[0]}"
    return _TABLE_CACHE[dataset]


def _bq(sql: str, params: dict[str, str]) -> list[dict]:
    job_project = project_id()
    if not job_project:
        raise SetupNeeded("No Google Cloud project is configured for the app (GOOGLE_CLOUD_PROJECT / VERTEX_PROJECT).")
    body = {"query": sql, "useLegacySql": False, "timeoutMs": 45000, "parameterMode": "NAMED",
            "queryParameters": [{"name": k, "parameterType": {"type": "STRING"}, "parameterValue": {"value": v}}
                                for k, v in params.items()]}
    h = {"Authorization": f"Bearer {_token()}"}
    r = httpx.post(f"https://bigquery.googleapis.com/bigquery/v2/projects/{job_project}/queries", json=body, headers=h, timeout=60)
    if r.status_code != 200:
        raise SetupNeeded(_explain(r, "Billing query"))
    d = r.json()
    t0 = time.time()
    while not d.get("jobComplete") and time.time() - t0 < 50:
        ref = d["jobReference"]
        time.sleep(1)
        r = httpx.get(f"https://bigquery.googleapis.com/bigquery/v2/projects/{ref['projectId']}/queries/{ref['jobId']}",
                      params={"location": ref.get("location", ""), "timeoutMs": 10000}, headers=h, timeout=30)
        if r.status_code != 200:
            raise SetupNeeded(_explain(r, "Billing query"))
        d = r.json()
    if not d.get("jobComplete"):
        raise SetupNeeded("The billing query took too long — press Refresh in a minute.")
    fields = [f["name"] for f in d.get("schema", {}).get("fields", [])]
    return [{fields[i]: c.get("v") for i, c in enumerate(row.get("f", []))} for row in d.get("rows", []) or []]


def _num(v) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


# ---------------------------------------------------------------- the dashboard
def _tz() -> str:
    m = settings.app_tz_offset_min
    sign = "+" if m >= 0 else "-"
    return f"{sign}{abs(m) // 60:02d}:{abs(m) % 60:02d}"


def _local_today() -> date:
    return (datetime.now(timezone.utc) + timedelta(minutes=settings.app_tz_offset_min)).date()


def _month_list(month: str, n: int) -> list[str]:
    y, m = int(month[:4]), int(month[4:])
    out = []
    for _ in range(n):
        out.append(f"{y:04d}{m:02d}")
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return list(reversed(out))


def _google(month: str, months: list[str]) -> dict:
    """All Google Cloud numbers for the month (+ monthly history) from the billing export."""
    table = _find_table(get_settings()["dataset"])
    credits = "IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)"
    tz = _tz()
    day_rows = _bq(f"""
        SELECT FORMAT_DATE('%Y-%m-%d', DATE(usage_start_time, '{tz}')) AS day, service.description AS component,
               SUM(cost) AS cost, SUM({credits}) AS credits
        FROM `{table}` WHERE invoice.month = @m GROUP BY day, component""", {"m": month})
    sku_rows = _bq(f"""
        SELECT service.description AS component, sku.description AS sku, SUM(cost) AS cost, SUM({credits}) AS credits
        FROM `{table}` WHERE invoice.month = @m GROUP BY component, sku ORDER BY cost DESC LIMIT 25""", {"m": month})
    month_rows = _bq(f"""
        SELECT invoice.month AS month, service.description AS component, SUM(cost) AS cost, SUM({credits}) AS credits
        FROM `{table}` WHERE invoice.month >= @first AND invoice.month <= @last GROUP BY month, component""",
        {"first": months[0], "last": months[-1]})
    credit_rows = _bq(f"""
        SELECT c.type AS type, c.name AS name, SUM(c.amount) AS amount
        FROM `{table}`, UNNEST(credits) c WHERE invoice.month = @m GROUP BY type, name ORDER BY amount""", {"m": month})
    meta = _bq(f"""
        SELECT ANY_VALUE(currency) AS currency, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(export_time)) AS updated,
               SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c WHERE c.type = 'PROMOTION'), 0)) AS promo
        FROM `{table}`""", {})
    return {"table": table, "day_rows": day_rows, "sku_rows": sku_rows, "month_rows": month_rows, "credit_rows": credit_rows,
            "meta": meta[0] if meta else {}}


def _openrouter_live() -> tuple[dict | None, str]:
    """Real spend from OpenRouter itself: account credits/usage + per-day activity for the last
    30 completed UTC days (needs the management key). Days it doesn't cover yet use the app's estimate."""
    key = settings.openrouter_management_key
    if not key:
        return None, "No OpenRouter management key on the server — using the app's own estimate."
    h = {"Authorization": f"Bearer {key}"}
    out: dict = {"checked": datetime.now(timezone.utc).isoformat(), "by_day": {}, "requests": {}, "days": []}
    try:
        r = httpx.get("https://openrouter.ai/api/v1/credits", headers=h, timeout=20)
        if r.status_code == 200:
            d = r.json().get("data", {}) or {}
            out["credits_total"], out["usage_total"] = _num(d.get("total_credits")), _num(d.get("total_usage"))
        a = httpx.get("https://openrouter.ai/api/v1/activity", headers=h, timeout=30)
        if a.status_code != 200:
            return (out if "usage_total" in out else None), f"OpenRouter activity not available (HTTP {a.status_code}) — recent days use the app's estimate."
        for row in a.json().get("data", []) or []:
            day = str(row.get("date", ""))[:10]
            if not day:
                continue
            out["by_day"][day] = out["by_day"].get(day, 0.0) + _num(row.get("usage"))
            out["requests"][day] = out["requests"].get(day, 0) + int(_num(row.get("requests")))
        out["days"] = sorted(out["by_day"])
        return out, ""
    except Exception as e:
        return None, f"Could not reach OpenRouter billing ({str(e)[:120]}) — using the app's estimate."


def _app_ai(months: list[str]) -> list[dict]:
    """Backup-AI calls (not on the Google bill) + every AI call by feature, from the usage log."""
    from app import usage
    from app.ai_provider import provider_label
    first = f"{months[0][:4]}-{months[0][4:]}-01"
    out = []
    for e in usage.query(date_from=first, date_to="9999-12-31", tz_offset_min=settings.app_tz_offset_min):
        day = usage._day(e.get("ts", 0), settings.app_tz_offset_min)
        out.append({"day": day, "month": day[:7].replace("-", ""), "provider": e.get("provider", ""), "user": e.get("user") or "",
                    "provider_label": provider_label(e.get("provider", "")), "feature": e.get("purpose") or "Other",
                    "cost": float(e.get("cost_usd") or 0.0), "tokens": int((e.get("tokens_in") or 0) + (e.get("tokens_out") or 0))})
    return out


def build(month: str, today: date, google: dict | None, google_error: str, app_rows: list[dict],
          months: list[str], cfg: dict, orl: dict | None = None, orl_error: str = "", users: dict | None = None,
          token_rate: float | None = None) -> dict:
    """Pure function: turn raw rows into the dashboard (unit-tested without Google)."""
    y, m = int(month[:4]), int(month[4:])
    n_days = calendar.monthrange(y, m)[1]
    days = [f"{y:04d}-{m:02d}-{d:02d}" for d in range(1, n_days + 1)]
    is_current = (today.year, today.month) == (y, m)
    is_future = (y, m) > (today.year, today.month)

    comp: dict[str, dict] = {}      # component -> totals
    day_comp: dict[tuple[str, str], float] = {}
    day_gross: dict[str, float] = {}

    def add(component: str, source: str, day: str | None, cost: float, cred: float):
        c = comp.setdefault(component, {"component": component, "source": source, "cost": 0.0, "credits": 0.0})
        c["cost"] += cost; c["credits"] += cred
        if day:
            day_comp[(day, component)] = day_comp.get((day, component), 0.0) + cost + cred
            day_gross[day] = day_gross.get(day, 0.0) + cost

    if google:
        for r in google["day_rows"]:
            add(r["component"] or "Other", "Google Cloud bill", r["day"], _num(r["cost"]), _num(r["credits"]))
    # backup AI: OpenRouter's own numbers for the days it reports, the app's estimate for the rest
    real_days = set((orl or {}).get("days", []))
    est_by_day: dict[str, float] = {}
    for r in app_rows:
        if r["provider"] == "openrouter" and r["cost"]:
            est_by_day[r["day"]] = est_by_day.get(r["day"], 0.0) + r["cost"]
    used_real = used_est = False
    for d in days:
        if d in real_days:
            v = (orl or {})["by_day"].get(d, 0.0); used_real = used_real or v > 0
        else:
            v = est_by_day.get(d, 0.0); used_est = used_est or v > 0
        if v:
            add(OTHER_AI, "OpenRouter billing" if d in real_days else "App estimate", d, v, 0.0)
    if OTHER_AI in comp:
        comp[OTHER_AI]["source"] = ("OpenRouter billing + app estimate for recent days" if used_real and used_est
                                    else "OpenRouter billing" if used_real else "App estimate")

    components = sorted(({**c, "net": c["cost"] + c["credits"]} for c in comp.values()), key=lambda c: -c["cost"])
    total_cost = sum(c["cost"] for c in components)
    total_credits = sum(c["credits"] for c in components)
    mtd_net = total_cost + total_credits
    for c in components:
        c["share"] = (c["cost"] / total_cost) if total_cost else 0.0

    by_day = []
    for d in days:
        parts = {c: v for (dd, c), v in day_comp.items() if dd == d and abs(v) > 1e-9}
        by_day.append({"day": d, "net": sum(parts.values()), "gross": day_gross.get(d, 0.0), "components": parts,
                       "future": is_future or (is_current and d > today.isoformat())})

    # ---- forecast: recent 7-day pace for the days that are left (current month only)
    forecast = None
    if is_current:
        past = [x["net"] for x in by_day if x["day"] < today.isoformat()]
        recent = past[-7:] if past else []
        pace = (sum(recent) / len(recent)) if recent else 0.0
        elapsed = today.day
        run_rate = mtd_net / elapsed * n_days if elapsed else mtd_net
        left = n_days - today.day
        projected = mtd_net + pace * left
        gross_by_day = {x["day"]: x["gross"] for x in by_day}
        rg = [gross_by_day[d] for d in days if d < today.isoformat()][-7:]
        gpace = (sum(rg) / len(rg)) if rg else 0.0
        forecast = {"net": round(projected, 4), "pace_per_day": round(pace, 4), "days_left": left,
                    "gross": round(total_cost + gpace * left, 4), "gross_pace_per_day": round(gpace, 4),
                    "low": round(min(projected, run_rate), 4), "high": round(max(projected, run_rate), 4),
                    "method": "month-to-date + average of the last 7 days × days left"}
        for x in by_day:
            if x["future"]:
                x["projected"] = round(pace, 4)

    # ---- months (history + this month's forecast)
    mon: dict[str, dict] = {mm: {"month": mm, "google": 0.0, "other": 0.0, "credits": 0.0} for mm in months}
    if google:
        for r in google["month_rows"]:
            if r["month"] in mon:
                mon[r["month"]]["google"] += _num(r["cost"]); mon[r["month"]]["credits"] += _num(r["credits"])
    for d, v in est_by_day.items():
        if d not in real_days and d.replace("-", "")[:6] in mon:
            mon[d.replace("-", "")[:6]]["other"] += v
    for d in real_days:
        if d.replace("-", "")[:6] in mon:
            mon[d.replace("-", "")[:6]]["other"] += (orl or {})["by_day"].get(d, 0.0)
    by_month = []
    for mm in months:
        x = mon[mm]
        x["net"] = x["google"] + x["credits"] + x["other"]
        x["gross"] = x["google"] + x["other"]
        if forecast and mm == month:
            x["forecast"] = forecast["net"]
        by_month.append(x)
    prev = next((x for x in by_month if x["month"] == _month_list(month, 2)[0]), None)

    # ---- AI view: Google AI (from the bill) + backup AI + every call by feature (app log)
    ai_google = [c for c in components if c["source"] == "Google Cloud bill" and re.search(r"vertex|gemini|ai platform|generative", c["component"], re.I)]
    feats: dict[str, dict] = {}
    for r in app_rows:
        if r["month"] != month:
            continue
        f = feats.setdefault(r["feature"], {"feature": r["feature"], "calls": 0, "tokens": 0, "cost": 0.0, "by_provider": {}})
        f["calls"] += 1; f["tokens"] += r["tokens"]; f["cost"] += r["cost"]
        f["by_provider"][r["provider_label"]] = f["by_provider"].get(r["provider_label"], 0.0) + r["cost"]
    ai = {"google_bill": [{"component": c["component"], "net": c["net"]} for c in ai_google],
          "backup": next((c["net"] for c in components if c["component"] == OTHER_AI), 0.0),
          "by_feature": sorted(feats.values(), key=lambda f: -f["cost"]),
          "note": "Feature split is the app's own estimate per AI call; the Google figures are the real bill."}

    budget = cfg.get("budget_usd")
    meta = (google or {}).get("meta", {})
    promo_used = -_num(meta.get("promo"))
    trial = cfg.get("trial_credit_usd") if cfg.get("trial_credit_usd") not in (None, "") else DEFAULT_TRIAL_USD
    credit_types = [{"type": (r.get("type") or "OTHER").replace("_", " ").title(), "name": r.get("name") or "", "amount": _num(r.get("amount"))}
                    for r in (google or {}).get("credit_rows", [])]

    # ---- what each user really costs you (for pricing): AI from the records, scaled to the real
    #      AI bill, plus a share of the rest of the infrastructure in proportion to AI use
    ai_bill_gross = sum(c["cost"] for c in components if c["component"] == OTHER_AI or (c["source"] == "Google Cloud bill" and AI_RE.search(c["component"])))
    infra_gross = sum(c["cost"] for c in components if c["source"] == "Google Cloud bill" and not AI_RE.search(c["component"]))
    month_rows = [r for r in app_rows if r["month"] == month]
    est_total = sum(r["cost"] for r in month_rows)
    factor = (ai_bill_gross / est_total) if (google is not None and est_total > 0 and ai_bill_gross > 0) else 1.0
    per_user: dict[str, dict] = {}
    for r in month_rows:
        who = r.get("user") or "(system)"
        u = per_user.setdefault(who, {"user": who, "calls": 0, "jd1_notes": 0, "est": 0.0})
        u["calls"] += 1; u["est"] += r["cost"]; u["jd1_notes"] += 1 if r.get("feature") == "JD1 note" else 0
    rows_u = []
    for u in per_user.values():
        share = (u["est"] / est_total) if est_total else 0.0
        ai_c, infra_c = u["est"] * factor, infra_gross * share
        rows_u.append({**u, "name": (users or {}).get(u["user"], u["user"]), "ai": round(ai_c, 4), "infra": round(infra_c, 4),
                       "total": round(ai_c + infra_c, 4), "per_note": round((ai_c + infra_c) / u["jd1_notes"], 4) if u["jd1_notes"] else None,
                       "client_tokens": int(round(u["est"] / token_rate * 1_000_000)) if token_rate else None})
    rows_u.sort(key=lambda x: -x["total"])
    notes_n = sum(u["jd1_notes"] for u in rows_u)
    all_in = ai_bill_gross + infra_gross if google is not None else est_total
    client_tokens = (est_total / token_rate * 1_000_000) if token_rate else 0
    pricing = {"users": rows_u, "ai_scale": round(factor, 3), "all_in_cost": round(all_in, 4), "jd1_notes": notes_n,
               "per_jd1_note": round(all_in / notes_n, 4) if notes_n else None,
               "token_rate": token_rate,
               "break_even_per_1m_tokens": round(all_in / client_tokens * 1_000_000, 4) if client_tokens else None,
               "basis": "Real cost before credits (credits run out, so price on this). AI is the app's per-call records scaled to the real AI bill; other infrastructure is shared in proportion to AI use."}
    return {
        "month": month, "is_current": is_current, "currency": meta.get("currency") or "USD",
        "google_ok": google is not None, "google_error": google_error, "table": (google or {}).get("table", ""),
        "updated": meta.get("updated"),
        "totals": {"cost": round(total_cost, 4), "credits": round(total_credits, 4), "net": round(mtd_net, 4),
                   "last_month_net": round(prev["net"], 4) if prev else None, "last_month_gross": round(prev["gross"], 4) if prev else None},
        "forecast": forecast,
        "budget": None if budget in (None, "") else {
            "amount": budget, "used_pct": round(mtd_net / budget * 100, 1) if budget else None,
            "forecast_pct": round(forecast["net"] / budget * 100, 1) if (budget and forecast) else None},
        "credits_info": None if google is None else {
            "trial_total": trial, "used": round(promo_used, 4), "left": round(max(trial - promo_used, 0), 4),
            "this_month": round(-total_credits, 4), "by_type": credit_types,
            "days_left_at_pace": (round(max(trial - promo_used, 0) / forecast["gross_pace_per_day"]) if forecast and forecast.get("gross_pace_per_day", 0) > 0 else None)},
        "sources": {
            "google": {"ok": google is not None, "error": google_error, "updated": meta.get("updated")},
            "backup_ai": {"ok": orl is not None, "error": orl_error, "checked": (orl or {}).get("checked"),
                           "credits_total": (orl or {}).get("credits_total"), "usage_total": (orl or {}).get("usage_total"),
                           "credits_left": (round((orl or {}).get("credits_total", 0) - (orl or {}).get("usage_total", 0), 4) if orl and "credits_total" in orl else None),
                           "covered_days": len(real_days)},
        },
        "pricing": pricing,
        "components": components, "by_day": by_day, "by_month": by_month,
        "skus": [{"component": r["component"], "sku": r["sku"], "cost": _num(r["cost"]), "credits": _num(r["credits"]),
                  "net": _num(r["cost"]) + _num(r["credits"])} for r in (google or {}).get("sku_rows", [])],
        "ai": ai,
    }


def overview(month: str = "", months_back: int = 6, refresh: bool = False) -> dict:
    today = _local_today()
    month = month if re.fullmatch(r"\d{6}", month or "") else f"{today.year:04d}{today.month:02d}"
    months = _month_list(month, max(2, min(months_back, 12)))
    key = f"{month}:{len(months)}"
    hit = _CACHE.get(key)
    if hit and not refresh and time.time() - hit[0] < _CACHE_SECONDS:
        return hit[1]
    if refresh:
        _TABLE_CACHE.clear()   # a billing table Google created since the last look is found now
    google, err = None, ""
    try:
        google = _google(month, months)
    except SetupNeeded as e:
        err = str(e)
    except Exception as e:   # never break the page — show why
        log.warning("cloud costs: %s", e)
        err = f"Could not read the Google Cloud bill: {str(e)[:200]}"
    orl, orl_err = _openrouter_live()
    from app import store, usage
    names = {u["username"]: u.get("name") or u["username"] for u in store.list_users()}
    data = build(month, today, google, err, _app_ai(months), months, get_settings(), orl, orl_err, names, usage.billing_rate())
    data["fetched_at"] = datetime.now(timezone.utc).isoformat()
    if google:
        _CACHE[key] = (time.time(), data)
    return data
