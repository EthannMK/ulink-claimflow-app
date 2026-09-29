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
from fastapi import APIRouter, Depends, Query
from app.models import Role
from app.security import get_current_user, require_role
from app.config import settings
from app import usage

router = APIRouter(prefix="/api/usage", tags=["usage"])


@router.get("/me")
def my_usage(user=Depends(get_current_user)):
    return usage.my_usage(user.get("username", ""))


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
