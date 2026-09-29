from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.models import Role
from app.security import require_role
from app import ai_provider
from app.config import settings

router = APIRouter(prefix="/api/ai-settings", tags=["ai-settings"])


class ProviderSetting(BaseModel):
    provider: str
    model: str = ""
    enabled: bool = True
    priority: int = 99


class AiSettingsUpdate(BaseModel):
    providers: list[ProviderSetting]


@router.get("")
def get_ai_settings(user=Depends(require_role(Role.super_admin))):
    return ai_provider.get_settings()


@router.get("/status")
def ai_status(user=Depends(require_role(Role.super_admin))):
    """Per provider: label, model, enabled (Settings), available (key/credentials
    present). Also whether the OpenRouter management key is configured — never
    the key itself."""
    return {
        "providers": ai_provider.provider_status(),
        "openrouter_management_key_configured": bool(settings.openrouter_management_key),
    }


@router.put("")
def update_ai_settings(payload: AiSettingsUpdate, user=Depends(require_role(Role.super_admin))):
    return ai_provider.save_settings([p.model_dump() for p in payload.providers])


# TEMPORARY local diagnostic — no auth. Remove before deploy. Never returns a key.
@router.get("/_debug")
def _debug():
    import httpx
    out: dict = {"providers": ai_provider.provider_status()}

    # --- Vertex AI: confirm ADC auth works and the configured model answers ---
    out["vertex_project"] = settings.vertex_project or "(not set)"
    out["vertex_location"] = settings.vertex_location
    out["vertex_model"] = settings.vertex_model
    if settings.vertex_project:
        try:
            txt, _tok = ai_provider._vertex_call([{"text": 'Reply ONLY with JSON {"ok": true}'}], settings.vertex_model)
            out["vertex_test"] = f"model={settings.vertex_model}: {txt[:150]}"
        except Exception as e:
            out["vertex_test"] = f"error: {str(e)[:400]}"
    else:
        out["vertex_test"] = "VERTEX_PROJECT not set"

    # --- OpenRouter: confirm the key + configured model answer, and list Gemini ids ---
    out["openrouter_model"] = settings.openrouter_model
    if settings.openrouter_api_key:
        try:
            txt, _tok = ai_provider._openrouter_call([{"text": 'Reply ONLY with JSON {"ok": true}'}], settings.openrouter_model)
            out["openrouter_test"] = f"model={settings.openrouter_model}: {txt[:150]}"
        except Exception as e:
            out["openrouter_test"] = f"model={settings.openrouter_model} error: {str(e)[:250]}"
    else:
        out["openrouter_test"] = "no OPENROUTER_API_KEY set"
    try:
        r = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
        out["openrouter_gemini_models"] = sorted(
            m.get("id", "") for m in r.json().get("data", []) if str(m.get("id", "")).startswith("google/gemini"))
    except Exception as e:
        out["openrouter_gemini_models"] = f"error: {str(e)[:200]}"
    out["openrouter_management_key_configured"] = bool(settings.openrouter_management_key)
    return out
