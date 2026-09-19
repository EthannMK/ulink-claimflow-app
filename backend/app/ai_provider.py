"""Shared AI provider layer.

All AI features call `generate_text(parts)`; this picks the highest-priority ENABLED
and AVAILABLE provider that can handle the request and calls ONLY that one. It falls
through to the next provider only when a call fails (quota / rate-limit / error), so a
normal successful request makes exactly one API call — no added latency.

`parts` uses the Gemini-style neutral shape so existing callers don't change:
    [{"text": "..."}, {"inline_data": {"mime_type": "image/jpeg", "data": "<base64>"}}]

Provider/model priority is Super-Admin configuration (stored via the shared Collection).
API keys stay in environment variables/secrets — never in the settings DB.
"""
from __future__ import annotations
import time
import httpx
from app.config import settings
from app.db import Collection


def _post(url: str, headers: dict, payload: dict, timeout: int):
    """POST for the provider chain. On 429 (quota/rate-limit) we FAIL FAST and raise,
    so generate_text() falls straight through to the next provider instead of sleeping.
    503 (brief unavailability) gets one quick retry."""
    r = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    if r.status_code == 503:
        time.sleep(1)
        r = httpx.post(url, headers=headers, json=payload, timeout=timeout)
    r.raise_for_status()
    return r

# Single shared settings store (the ai-settings router imports these helpers).
settings_store = Collection("ai_settings")


def default_providers() -> list[dict]:
    # Vertex AI (GCP, paid via credit) FIRST — reliable, high quality, strong Burmese
    # vision, no free-tier caps. Then free fallbacks if Vertex is ever unavailable.
    return [
        {"provider": "vertex", "model": settings.vertex_model, "enabled": True, "priority": 1},
        {"provider": "groq", "model": settings.groq_model, "enabled": True, "priority": 2},
        {"provider": "openrouter", "model": settings.openrouter_model, "enabled": True, "priority": 3},
        {"provider": "gemini", "model": settings.gemini_model, "enabled": True, "priority": 4},
    ]


def get_settings() -> dict:
    doc = settings_store.get("providers")
    if not isinstance(doc, dict) or not doc.get("providers"):
        doc = {"providers": default_providers()}
        settings_store.put("providers", doc)
    return doc


def save_settings(providers: list[dict]) -> dict:
    providers = sorted(providers, key=lambda p: p.get("priority", 99))
    doc = {"providers": providers}
    settings_store.put("providers", doc)
    return doc


# ---- provider adapters -------------------------------------------------------
# Vertex AI uses Google Application Default Credentials (no API key). We cache the
# OAuth token and refresh it only when it is close to expiry.
_vertex_creds = None


def _vertex_token() -> str:
    global _vertex_creds
    import google.auth
    import google.auth.transport.requests
    if _vertex_creds is None:
        _vertex_creds, _ = google.auth.default(
            scopes=["https://www.googleapis.com/auth/cloud-platform"])
    if not _vertex_creds.valid:
        _vertex_creds.refresh(google.auth.transport.requests.Request())
    return _vertex_creds.token


def _vertex_available() -> bool:
    if not settings.vertex_project:
        return False
    try:
        import google.auth  # noqa: F401
        return True
    except Exception:
        return False


def _vertex_call(parts: list, model: str) -> str:
    loc = settings.vertex_location or "us-central1"
    mdl = model or settings.vertex_model
    host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    url = (f"https://{host}/v1/projects/{settings.vertex_project}/locations/{loc}"
           f"/publishers/google/models/{mdl}:generateContent")
    headers = {"Authorization": f"Bearer {_vertex_token()}", "Content-Type": "application/json"}
    r = _post(url, headers, {"contents": [{"role": "user", "parts": parts}]}, timeout=120)
    cands = r.json().get("candidates") or []
    if not cands:
        return ""
    return "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", []))


def _gemini_call(parts: list, model: str) -> str:
    url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
           f"{model or settings.gemini_model}:generateContent?key={settings.gemini_api_key}")
    r = _post(url, {}, {"contents": [{"parts": parts}]}, timeout=90)
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def _groq_call(parts: list, model: str) -> str:
    # OpenAI-compatible, text only. (Images are routed to a vision provider instead.)
    text = "\n\n".join(p["text"] for p in parts if isinstance(p, dict) and p.get("text"))
    r = _post(
        "https://api.groq.com/openai/v1/chat/completions",
        {"Authorization": f"Bearer {settings.groq_api_key}"},
        {"model": model or settings.groq_model,
         "messages": [{"role": "user", "content": text}],
         "temperature": 0.2},
        timeout=60,
    )
    return r.json()["choices"][0]["message"]["content"]


def _openrouter_call(parts: list, model: str) -> str:
    # OpenAI-compatible, multimodal (image_url data URIs). PDFs are not supported here.
    content: list[dict] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        if p.get("text"):
            content.append({"type": "text", "text": p["text"]})
        elif p.get("inline_data"):
            d = p["inline_data"]
            content.append({"type": "image_url", "image_url": {"url": f"data:{d.get('mime_type','image/jpeg')};base64,{d.get('data','')}"}})
    r = _post(
        "https://openrouter.ai/api/v1/chat/completions",
        {"Authorization": f"Bearer {settings.openrouter_api_key}"},
        {"model": model or settings.openrouter_model, "messages": [{"role": "user", "content": content}]},
        timeout=90,
    )
    return r.json()["choices"][0]["message"]["content"]


# name -> capabilities
_REGISTRY = {
    "vertex":     {"available": _vertex_available,                                                       "vision": True,  "call": _vertex_call},
    "gemini":     {"available": lambda: bool(settings.gemini_api_key),                                  "vision": True,  "call": _gemini_call},
    "groq":       {"available": lambda: bool(settings.groq_api_key),                                     "vision": False, "call": _groq_call},
    "openrouter": {"available": lambda: bool(settings.openrouter_api_key and settings.openrouter_model), "vision": True,  "call": _openrouter_call},
}


def any_available() -> bool:
    return any(reg["available"]() for reg in _REGISTRY.values())


def provider_status() -> list[dict]:
    """Diagnostic: which providers are enabled (config) and available (key present)."""
    out = []
    for spec in get_settings()["providers"]:
        reg = _REGISTRY.get(spec.get("provider"))
        out.append({
            "provider": spec.get("provider"), "model": spec.get("model", ""),
            "priority": spec.get("priority"), "enabled": spec.get("enabled", True),
            "available": bool(reg and reg["available"]()),
            "vision": bool(reg and reg["vision"]),
        })
    return out


def generate_text(parts: list) -> str:
    """Run the request against the first working provider (by priority). Returns the
    model's raw text output (callers parse JSON as needed), or '' if all fail."""
    need_vision = any(isinstance(p, dict) and p.get("inline_data") for p in (parts or []))
    ordered = sorted(
        [p for p in get_settings()["providers"] if p.get("enabled", True)],
        key=lambda p: p.get("priority", 99),
    )
    for spec in ordered:
        reg = _REGISTRY.get(spec.get("provider"))
        if not reg or not reg["available"]():
            continue
        if need_vision and not reg["vision"]:
            continue
        try:
            txt = reg["call"](parts, spec.get("model") or "")
            if txt and txt.strip():
                return txt
        except Exception:
            continue   # quota / rate-limit / error -> try the next provider
    return ""
