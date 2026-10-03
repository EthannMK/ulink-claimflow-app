"""AI usage & cost endpoints.

- /api/usage/me         any signed-in user: their own spend, cap and remaining balance
- /api/usage/summary    Super Admin: totals + breakdowns by day, user, user x model, feature, model
- /api/usage/recent     Super Admin: individual calls (call log)
- /api/usage/options    Super Admin: values for the filter dropdowns
- /api/usage/export.csv Super Admin: the filtered call log as CSV
  (all four accept the same filters: dates/days, user, provider, model, feature, status)
- /api/usage/provider-account Super Admin: live numbers from OpenRouter itself
                        (key usage via OPENROUTER_API_KEY, account credits via
                        OPENROUTER_MANAGEMENT_KEY). Keys are never returned.
"""
import httpx
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from app.models import Role
from app.security import get_current_user, require_role
from app.config import settings
from app import usage

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/me")
def my_usage(user=Depends(get_current_user)):
    """Own allowance in tokens. Dollar amounts are included for the Super Admin only."""
    return usage.my_usage(user.get("username", ""), include_usd=user.get("role") == "super_admin")


@router.get("/me/history")
def my_history(limit: int = Query(50, ge=1, le=500), user=Depends(get_current_user)):
    """Own AI use, one row per scan / task, in client tokens. No provider or model names."""
    return {"items": usage.my_history(user.get("username", ""), limit, include_usd=user.get("role") == "super_admin")}


class _Billing(BaseModel):
    usd_per_1m_tokens: float


@router.get("/billing")
def get_billing(user=Depends(require_role(Role.super_admin))):
    """The client token rate (1M tokens = $X) + what real calls have cost so far."""
    return {"usd_per_1m_tokens": usage.billing_rate(), "default": usage.DEFAULT_USD_PER_1M_TOKENS,
            "actual": usage.actual_rate()}


@router.put("/billing")
def put_billing(body: _Billing, user=Depends(require_role(Role.super_admin))):
    try:
        usage.save_billing_rate(body.usd_per_1m_tokens)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    from app import audit
    audit.record("billing_rate", user.get("name") or user.get("username", ""),
                 detail=f"Client token rate set to ${body.usd_per_1m_tokens} per 1M tokens")
    return get_billing(user)


class _F:
    """Shared filter query params for every dashboard endpoint."""
    def __init__(self, days: int = Query(30, ge=1, le=3650), date_from: str = "", date_to: str = "",
                 tz_offset_min: int = Query(0, ge=-840, le=840), user: str = "", provider: str = "",
                 model: str = "", feature: str = "", status: str = Query("", pattern="^(|ok|failed)$")):
        self.v = dict(days=days, date_from=date_from, date_to=date_to, tz_offset_min=tz_offset_min,
                      user=user, provider=provider, model=model, feature=feature, status=status)


@router.get("/limits")
def usage_limits(user=Depends(require_role(Role.super_admin))):
    """All users with their total & daily AI limits and where they stand (all providers & models)."""
    return {"items": usage.limits_overview()}


class _Allowance(BaseModel):
    total_usd: float | None = None        # new TOTAL limit (USD); use clear_total for "no limit"
    daily_usd: float | None = None
    clear_total: bool = False
    clear_daily: bool = False
    keep_total: bool = False              # leave the total limit as it is
    keep_daily: bool = False
    period: str | None = None             # "none" | "monthly"; None = unchanged
    reset_total: bool = False             # start a new period: used-so-far back to 0 (history kept)
    reset_today: bool = False             # today's usage back to 0
    reason: str = ""


@router.put("/limits/{uid}")
def put_allowance(uid: str, body: _Allowance, user=Depends(require_role(Role.super_admin))):
    """Change a user's AI allowance in one step: limits, monthly renewal and/or reset of usage.
    Resetting never deletes the usage log; the closed period is kept on the user (last 12)."""
    from app import audit
    total = usage._KEEP if body.keep_total else (None if body.clear_total else body.total_usd)
    daily = usage._KEEP if body.keep_daily else (None if body.clear_daily else body.daily_usd)
    try:
        res = usage.set_allowance(uid, user.get("name") or user.get("username", ""), total_usd=total, daily_usd=daily,
                                  period=body.period, reset_total=body.reset_total, reset_today=body.reset_today,
                                  reason=body.reason)
    except KeyError:
        raise HTTPException(status_code=404, detail="User not found")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    u, b = res["user"], res["before"]
    parts = []
    if body.reset_total:
        parts.append(f"usage reset to 0 (was {usage.to_tokens(b['spent_usd']):,} tokens)")
    elif body.reset_today:
        parts.append("today's usage reset to 0")
    if not body.keep_total:
        parts.append(f"total limit {usage.to_tokens(u.get('usage_cap_usd')) if u.get('usage_cap_usd') is not None else 'none'}")
    if not body.keep_daily:
        parts.append(f"daily limit {usage.to_tokens(u.get('daily_cap_usd')) if u.get('daily_cap_usd') is not None else 'none'}")
    if body.period:
        parts.append(f"renews {'monthly' if body.period == 'monthly' else 'never'}")
    audit.record("ai_allowance", user.get("name") or user.get("username", ""),
                 detail=f"{u['username']}: " + "; ".join(parts) + (f" — {body.reason.strip()[:200]}" if body.reason.strip() else ""), ref=uid)
    row = next((r for r in usage.limits_overview() if r["id"] == uid), None)
    return row or {}


@router.get("/summary")
def usage_summary(f: _F = Depends(), user=Depends(require_role(Role.super_admin))):
    return {"filters": f.v, **usage.summary(**f.v)}


@router.get("/recent")
def usage_recent(limit: int = Query(200, ge=1, le=2000), f: _F = Depends(), user=Depends(require_role(Role.super_admin))):
    return {"items": usage.recent(limit=limit, **f.v)}


@router.get("/options")
def usage_options(user=Depends(require_role(Role.super_admin))):
    return usage.options()


@router.get("/export.csv")
def usage_export(f: _F = Depends(), user=Depends(require_role(Role.super_admin))):
    from fastapi.responses import Response
    return Response(usage.export_csv(**f.v), media_type="text/csv",
                    headers={"Content-Disposition": 'attachment; filename="ai-usage.csv"'})


@router.get("/provider-account")
def provider_account(user=Depends(require_role(Role.super_admin))):
    """Live figures straight from OpenRouter. Each part degrades to an 'error' string
    rather than failing the whole request (e.g. when a key isn't configured yet)."""
    from app.ai_provider import provider_label
    out: dict = {
        "label": provider_label("openrouter"),
        "api_key_hint": "Needs OPENROUTER_API_KEY",
        "management_key_hint": "Needs OPENROUTER_MANAGEMENT_KEY",
        "api_key_configured": bool(settings.openrouter_api_key),
        "management_key_configured": bool(settings.openrouter_management_key),
        "key": None, "credits": None,
    }
    # Usage/limit of the API key the app actually calls with.
    if settings.openrouter_api_key:
        try:
            r = httpx.get("https://openrouter.ai/api/v1/key",
                          headers={"Authorization": f"Bearer {settings.openrouter_api_key}"}, timeout=20)
            if r.status_code == 200:
                d = r.json().get("data", {}) or {}
                out["key"] = {
                    "label": d.get("label", ""), "usage_usd": d.get("usage"), "limit_usd": d.get("limit"),
                    "limit_remaining_usd": d.get("limit_remaining"), "is_free_tier": d.get("is_free_tier"),
                }
            else:
                out["key"] = {"error": f"HTTP {r.status_code}"}
        except Exception as e:
            out["key"] = {"error": str(e)[:200]}
    # Whole-account balance — needs the management (provisioning) key.
    if settings.openrouter_management_key:
        try:
            r = httpx.get("https://openrouter.ai/api/v1/credits",
                          headers={"Authorization": f"Bearer {settings.openrouter_management_key}"}, timeout=20)
            if r.status_code == 200:
                d = r.json().get("data", {}) or {}
                total, used = d.get("total_credits"), d.get("total_usage")
                out["credits"] = {
                    "total_credits_usd": total, "total_usage_usd": used,
                    "balance_usd": (round(float(total) - float(used), 4) if total is not None and used is not None else None),
                }
            else:
                out["credits"] = {"error": f"HTTP {r.status_code}"}
        except Exception as e:
            out["credits"] = {"error": str(e)[:200]}
    return out
