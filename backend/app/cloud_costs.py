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


# ---------------------------------------------------------------- settings
def default_dataset() -> str:
    return f"{project_id() or 'ulink-claimflow'}.billing_export"


def get_settings() -> dict:
    d = _settings.get(_DOC) or {}
    return {"dataset": (d.get("dataset") or default_dataset()).strip(),
            "budget_usd": d.get("budget_usd"), "trial_credit_usd": d.get("trial_credit_usd")}


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
    meta = _bq(f"""
        SELECT ANY_VALUE(currency) AS currency, FORMAT_TIMESTAMP('%Y-%m-%dT%H:%M:%SZ', MAX(export_time)) AS updated,
               SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c WHERE c.type = 'PROMOTION'), 0)) AS promo
        FROM `{table}`""", {})
    return {"table": table, "day_rows": day_rows, "sku_rows": sku_rows, "month_rows": month_rows,
            "meta": meta[0] if meta else {}}


def _app_ai(months: list[str]) -> list[dict]:
    """Backup-AI calls (not on the Google bill) + every AI call by feature, from the usage log."""
    from app import usage
    from app.ai_provider import provider_label
    first = f"{months[0][:4]}-{months[0][4:]}-01"
    out = []
    for e in usage.query(date_from=first, date_to="9999-12-31", tz_offset_min=settings.app_tz_offset_min):
        day = usage._day(e.get("ts", 0), settings.app_tz_offset_min)
        out.append({"day": day, "month": day[:7].replace("-", ""), "provider": e.get("provider", ""),
                    "provider_label": provider_label(e.get("provider", "")), "feature": e.get("purpose") or "Other",
                    "cost": float(e.get("cost_usd") or 0.0), "tokens": int((e.get("tokens_in") or 0) + (e.get("tokens_out") or 0))})
    return out


def build(month: str, today: date, google: dict | None, google_error: str, app_rows: list[dict],
          months: list[str], cfg: dict) -> dict:
    """Pure function: turn raw rows into the dashboard (unit-tested without Google)."""
    y, m = int(month[:4]), int(month[4:])
    n_days = calendar.monthrange(y, m)[1]
    days = [f"{y:04d}-{m:02d}-{d:02d}" for d in range(1, n_days + 1)]
    is_current = (today.year, today.month) == (y, m)
    is_future = (y, m) > (today.year, today.month)

    comp: dict[str, dict] = {}      # component -> totals
    day_comp: dict[tuple[str, str], float] = {}

    def add(component: str, source: str, day: str | None, cost: float, cred: float):
        c = comp.setdefault(component, {"component": component, "source": source, "cost": 0.0, "credits": 0.0})
        c["cost"] += cost; c["credits"] += cred
        if day:
            day_comp[(day, component)] = day_comp.get((day, component), 0.0) + cost + cred

    if google:
        for r in google["day_rows"]:
            add(r["component"] or "Other", "Google Cloud bill", r["day"], _num(r["cost"]), _num(r["credits"]))
    for r in app_rows:
        if r["month"] == month and r["provider"] == "openrouter" and r["cost"]:
            add(OTHER_AI, "App estimate", r["day"], r["cost"], 0.0)

    components = sorted(({**c, "net": c["cost"] + c["credits"]} for c in comp.values()), key=lambda c: -c["cost"])
    total_cost = sum(c["cost"] for c in components)
    total_credits = sum(c["credits"] for c in components)
    mtd_net = total_cost + total_credits
    for c in components:
        c["share"] = (c["cost"] / total_cost) if total_cost else 0.0

    by_day = []
    for d in days:
        parts = {c: v for (dd, c), v in day_comp.items() if dd == d and abs(v) > 1e-9}
        by_day.append({"day": d, "net": sum(parts.values()), "components": parts,
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
        forecast = {"net": round(projected, 4), "pace_per_day": round(pace, 4), "days_left": left,
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
    for r in app_rows:
        if r["provider"] == "openrouter" and r["month"] in mon:
            mon[r["month"]]["other"] += r["cost"]
    by_month = []
    for mm in months:
        x = mon[mm]
        x["net"] = x["google"] + x["credits"] + x["other"]
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
    trial = cfg.get("trial_credit_usd")
    return {
        "month": month, "is_current": is_current, "currency": meta.get("currency") or "USD",
        "google_ok": google is not None, "google_error": google_error, "table": (google or {}).get("table", ""),
        "updated": meta.get("updated"),
        "totals": {"cost": round(total_cost, 4), "credits": round(total_credits, 4), "net": round(mtd_net, 4),
                   "last_month_net": round(prev["net"], 4) if prev else None},
        "forecast": forecast,
        "budget": None if budget in (None, "") else {
            "amount": budget, "used_pct": round(mtd_net / budget * 100, 1) if budget else None,
            "forecast_pct": round(forecast["net"] / budget * 100, 1) if (budget and forecast) else None},
        "credits_info": None if trial in (None, "") else {
            "trial_total": trial, "used": round(promo_used, 4), "left": round(max(trial - promo_used, 0), 4),
            "days_left_at_pace": (round(max(trial - promo_used, 0) / forecast["pace_per_day"]) if forecast and forecast["pace_per_day"] > 0 else None)},
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
    google, err = None, ""
    try:
        google = _google(month, months)
    except SetupNeeded as e:
        err = str(e)
    except Exception as e:   # never break the page — show why
        log.warning("cloud costs: %s", e)
        err = f"Could not read the Google Cloud bill: {str(e)[:200]}"
    data = build(month, today, google, err, _app_ai(months), months, get_settings())
    data["fetched_at"] = datetime.now(timezone.utc).isoformat()
    if google:
        _CACHE[key] = (time.time(), data)
    return data
