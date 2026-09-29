from fastapi import APIRouter, Depends, HTTPException
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
    providers = ai_provider.provider_status()
    ready = {p["provider"]: p["available"] for p in providers}
    return {
        "providers": providers,
        "openrouter_management_key_configured": bool(settings.openrouter_management_key),
        "keys": [
            {"name": "Vertex AI", "hint": "Google Cloud sign-in (no key needed)", "configured": ready.get("vertex", False)},
            {"name": "OpenRouter API key", "hint": "OPENROUTER_API_KEY — used to run the model", "configured": bool(settings.openrouter_api_key)},
            {"name": "OpenRouter management key", "hint": "OPENROUTER_MANAGEMENT_KEY — used only to read your account balance", "configured": bool(settings.openrouter_management_key)},
        ],
    }


@router.get("/models")
def available_models(provider: str, force: bool = False, user=Depends(require_role(Role.super_admin))):
    """Live list of models the provider offers right now (cached ~10 min; force=true refreshes)."""
    from app import model_catalog
    return model_catalog.list_models(provider, force=force)


class ModelTest(BaseModel):
    provider: str
    model: str


@router.post("/test-model")
def test_model(body: ModelTest, user=Depends(require_role(Role.super_admin))):
    """Send a tiny prompt to exactly this provider+model — confirms it really works before saving."""
    from app import model_catalog
    return model_catalog.test_model(body.provider, body.model.strip())


class FeatureModels(BaseModel):
    models: dict[str, dict[str, str]] = {}
    allow_free_for_documents: bool | None = None


def _feature_payload() -> dict:
    return {"models": ai_provider.get_feature_models(),
            "allow_free_for_documents": ai_provider.allow_free_for_documents(),
            "tasks": ai_provider.TASKS, "free_warning": ai_provider.FREE_MODEL_WARNING}


@router.get("/feature-models")
def get_feature_models(user=Depends(require_role(Role.super_admin))):
    """Which model each AI task uses (blank = the provider's main model) + the free-model guard."""
    return _feature_payload()


@router.put("/feature-models")
def put_feature_models(body: FeatureModels, user=Depends(require_role(Role.super_admin))):
    try:
        ai_provider.save_feature_models(body.models, body.allow_free_for_documents)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return _feature_payload()


@router.put("")
def update_ai_settings(payload: AiSettingsUpdate, user=Depends(require_role(Role.super_admin))):
    try:
        return ai_provider.save_settings([p.model_dump() for p in payload.providers])
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
