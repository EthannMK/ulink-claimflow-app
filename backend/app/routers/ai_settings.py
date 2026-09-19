from fastapi import APIRouter, Depends
from pydantic import BaseModel
from app.models import Role
from app.security import require_role
from app import ai_provider

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
    """Which providers are enabled (config) and available (API key present)."""
    return {"providers": ai_provider.provider_status()}


@router.put("")
def update_ai_settings(payload: AiSettingsUpdate, user=Depends(require_role(Role.super_admin))):
    return ai_provider.save_settings([p.model_dump() for p in payload.providers])


# TEMPORARY local diagnostic — no auth. Remove before deploy. Never returns the key.
@router.get("/_debug")
def _debug():
    import httpx
    from app.config import settings
    out = {"providers": ai_provider.provider_status(), "groq_models": None, "groq_text_test": None}
    try:
        r = httpx.get("https://api.groq.com/openai/v1/models",
                      headers={"Authorization": f"Bearer {settings.groq_api_key}"}, timeout=30)
        out["groq_models"] = sorted(m["id"] for m in r.json().get("data", [])) if r.status_code == 200 else f"HTTP {r.status_code}: {r.text[:200]}"
    except Exception as e:
        out["groq_models"] = f"error: {str(e)[:200]}"
    try:
        txt = ai_provider._groq_call([{"text": 'Reply ONLY with JSON {"ok": true}'}], settings.groq_model)
        out["groq_text_test"] = txt[:200]
    except Exception as e:
        out["groq_text_test"] = f"error: {str(e)[:250]}"
    # list FREE vision models on OpenRouter so we can pick a valid one
    out["openrouter_free_vision"] = None
    try:
        r = httpx.get("https://openrouter.ai/api/v1/models", timeout=30)
        free = []
        for m in r.json().get("data", []):
            arch = m.get("architecture", {}) or {}
            mods = arch.get("input_modalities") or arch.get("modality", "")
            has_img = ("image" in mods) if isinstance(mods, list) else ("image" in str(mods))
            pricing = m.get("pricing", {}) or {}
            is_free = str(pricing.get("prompt", "1")) in ("0", "0.0") or str(m.get("id", "")).endswith(":free")
            if has_img and is_free:
                free.append(m.get("id"))
        out["openrouter_free_vision"] = sorted(free)
    except Exception as e:
        out["openrouter_free_vision"] = f"error: {str(e)[:200]}"
    # --- Vertex AI (GCP) test: confirm ADC auth works and list available models ---
    out["vertex_project"] = settings.vertex_project or "(not set)"
    out["vertex_location"] = settings.vertex_location
    out["vertex_model"] = settings.vertex_model
    out["vertex_test"] = None
    if settings.vertex_project:
        try:
            txt = ai_provider._vertex_call([{"text": 'Reply ONLY with JSON {"ok": true}'}], settings.vertex_model)
            out["vertex_test"] = f"model={settings.vertex_model}: {txt[:150]}"
        except Exception as e:
            out["vertex_test"] = f"error: {str(e)[:400]}"
        # list Gemini models the project can call on Vertex
        try:
            import google.auth, google.auth.transport.requests
            creds, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
            creds.refresh(google.auth.transport.requests.Request())
            loc = settings.vertex_location or "us-central1"
            host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
            r = httpx.get(f"https://{host}/v1/publishers/google/models",
                          headers={"Authorization": f"Bearer {creds.token}"}, timeout=30)
            if r.status_code == 200:
                out["vertex_models"] = sorted(
                    m.get("name", "").split("/")[-1] for m in r.json().get("publisherModels", [])
                    if "gemini" in m.get("name", "").lower())
            else:
                out["vertex_models"] = f"HTTP {r.status_code}: {r.text[:200]}"
        except Exception as e:
            out["vertex_models"] = f"error: {str(e)[:300]}"
    else:
        out["vertex_test"] = "VERTEX_PROJECT not set"

    # --- direct Gemini test: show the EXACT error the provider layer is hiding ---
    out["gemini_model"] = settings.gemini_model
    out["gemini_key_prefix"] = (settings.gemini_api_key[:4] + "…") if settings.gemini_api_key else "(none)"
    out["gemini_test"] = None
    if settings.gemini_api_key:
        try:
            url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
                   f"{settings.gemini_model}:generateContent?key={settings.gemini_api_key}")
            r = httpx.post(url, json={"contents": [{"parts": [{"text": "reply ok"}]}]}, timeout=30)
            out["gemini_test"] = f"HTTP {r.status_code}: {r.text[:400]}"
        except Exception as e:
            out["gemini_test"] = f"error: {str(e)[:400]}"
    else:
        out["gemini_test"] = "no GEMINI_API_KEY set"
    # list the models this key can actually see
    out["gemini_models"] = None
    if settings.gemini_api_key:
        try:
            r = httpx.get(f"https://generativelanguage.googleapis.com/v1beta/models?key={settings.gemini_api_key}", timeout=30)
            if r.status_code == 200:
                out["gemini_models"] = sorted(m.get("name", "").replace("models/", "") for m in r.json().get("models", []))
            else:
                out["gemini_models"] = f"HTTP {r.status_code}: {r.text[:300]}"
        except Exception as e:
            out["gemini_models"] = f"error: {str(e)[:300]}"

    out["openrouter_test"] = None
    if settings.openrouter_api_key:
        try:
            txt = ai_provider._openrouter_call([{"text": 'Reply ONLY with JSON {"ok": true}'}], settings.openrouter_model)
            out["openrouter_test"] = f"model={settings.openrouter_model}: {txt[:150]}"
        except Exception as e:
            out["openrouter_test"] = f"model={settings.openrouter_model} error: {str(e)[:250]}"
    else:
        out["openrouter_test"] = "no OPENROUTER_API_KEY set"
    return out
