"""AI usage & cost endpoints.

- /api/usage/me         any signed-in user: their own spend, cap and remaining balance
- /api/usage/summary    Super Admin: totals, by model, by day, by user
- /api/usage/recent     Super Admin: latest individual AI calls
- /api/usage/openrouter Super Admin: live numbers from OpenRouter itself
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


@router.get("/summary")
def usage_summary(days: int = Query(30, ge=1, le=365), user=Depends(require_role(Role.super_admin))):
    return {"days": days, **usage.summary(days)}


@router.get("/recent")
def usage_recent(limit: int = Query(100, ge=1, le=500), user=Depends(require_role(Role.super_admin))):
    return {"items": usage.recent(limit)}


@router.get("/openrouter")
def openrouter_live(user=Depends(require_role(Role.super_admin))):
    """Live figures straight from OpenRouter. Each part degrades to an 'error' string
    rather than failing the whole request (e.g. when a key isn't configured yet)."""
    out: dict = {
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
