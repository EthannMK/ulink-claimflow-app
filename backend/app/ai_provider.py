"""Shared AI provider layer.

All AI features call `generate_text(parts)`; this picks the highest-priority ENABLED
and AVAILABLE provider that can handle the request and calls ONLY that one. It falls
through to the next provider only when a call fails (quota / rate-limit / error), so a
normal successful request makes exactly one API call — no added latency.

`parts` uses the Gemini-style neutral shape so existing callers don't change:
    [{"text": "..."}, {"inline_data": {"mime_type": "image/jpeg", "data": "<base64>"}}]

Provider/model priority is Super-Admin configuration (stored via the shared Collection).
API keys stay in environment variables/secrets — never in the settings DB.

Two providers are wired in, both running the same Gemini model by default
(gemini-3.6-flash): Vertex AI (primary, paid via GCP credit) and OpenRouter
(backup, via its marketplace). Groq and the direct Gemini API / AI Studio were
removed on purpose. Every call is logged (with
whatever token counts the provider reports) via app.usage, and attributed to
whichever user triggered it via app.request_ctx — that's what powers the Usage
dashboard and per-user cost caps.
"""
from __future__ import annotations
import time
import httpx
from app.config import settings
from app.db import Collection
from app import request_ctx, usage
from app.usage import UsageCapExceeded  # re-exported so callers only need ai_provider

__all__ = ["generate_text", "any_available", "provider_status", "get_settings",
           "save_settings", "default_providers", "UsageCapExceeded", "PROVIDER_LABELS"]

# Human-friendly display names for the Settings UI — keep provider (the internal id)
# and model (the specific model string) clearly separate everywhere they're shown.
PROVIDER_LABELS = {
    "vertex": "Vertex AI (Google Cloud)",
    "openrouter": "OpenRouter",
}


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
    # vision, no free-tier caps. OpenRouter is the backup if Vertex is ever unavailable.
    return [
        {"provider": "vertex", "model": settings.vertex_model, "enabled": True, "priority": 1},
        {"provider": "openrouter", "model": settings.openrouter_model, "enabled": True, "priority": 2},
    ]


def get_settings() -> dict:
    doc = settings_store.get("providers")
    if not isinstance(doc, dict) or not doc.get("providers"):
        doc = {"providers": default_providers()}
        settings_store.put("providers", doc)
        return doc
    # Self-heal: drop any provider no longer registered (e.g. a removed one like the
    # old Groq entry) from a previously-saved settings doc, so a stale doc can never
    # reference a provider that no longer exists.
    cleaned = [p for p in doc["providers"] if p.get("provider") in PROVIDER_LABELS]
    if len(cleaned) != len(doc["providers"]):
        doc = {"providers": cleaned or default_providers()}
        settings_store.put("providers", doc)
    return doc


def save_settings(providers: list[dict]) -> dict:
    providers = [p for p in providers if p.get("provider") in PROVIDER_LABELS]
    providers = sorted(providers, key=lambda p: p.get("priority", 99))
    doc = {"providers": providers}
    settings_store.put("providers", doc)
    return doc


# ---- provider adapters -------------------------------------------------------
# Each _xxx_call returns (text, usage_dict) where usage_dict has "in"/"out" token
# counts as reported by that provider (0 if the provider doesn't report them).

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


def _vertex_call(parts: list, model: str) -> tuple[str, dict]:
    loc = settings.vertex_location or "us-central1"
    mdl = model or settings.vertex_model
    host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    url = (f"https://{host}/v1/projects/{settings.vertex_project}/locations/{loc}"
           f"/publishers/google/models/{mdl}:generateContent")
    headers = {"Authorization": f"Bearer {_vertex_token()}", "Content-Type": "application/json"}
    r = _post(url, headers, {"contents": [{"role": "user", "parts": parts}]}, timeout=120)
    body = r.json()
    cands = body.get("candidates") or []
    txt = "".join(p.get("text", "") for p in cands[0].get("content", {}).get("parts", [])) if cands else ""
    um = body.get("usageMetadata") or {}
    return txt, {"in": int(um.get("promptTokenCount") or 0), "out": int(um.get("candidatesTokenCount") or 0)}



def _openrouter_call(parts: list, model: str) -> tuple[str, dict]:
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
    body = r.json()
    txt = body["choices"][0]["message"]["content"]
    u = body.get("usage") or {}
    return txt, {"in": int(u.get("prompt_tokens") or 0), "out": int(u.get("completion_tokens") or 0)}


# name -> capabilities
_REGISTRY = {
    "vertex":     {"available": _vertex_available,                                                       "vision": True, "call": _vertex_call},
    "openrouter": {"available": lambda: bool(settings.openrouter_api_key and settings.openrouter_model), "vision": True, "call": _openrouter_call},
}


def any_available() -> bool:
    return any(reg["available"]() for reg in _REGISTRY.values())


def provider_status() -> list[dict]:
    """Diagnostic: which providers are enabled (config) and available (key present)."""
    out = []
    for spec in get_settings()["providers"]:
        name = spec.get("provider")
        reg = _REGISTRY.get(name)
        out.append({
            "provider": name, "label": PROVIDER_LABELS.get(name, name), "model": spec.get("model", ""),
            "priority": spec.get("priority"), "enabled": spec.get("enabled", True),
            "available": bool(reg and reg["available"]()),
            "vision": bool(reg and reg["vision"]),
        })
    return out


def generate_text(parts: list) -> str:
    """Run the request against the first working provider (by priority). Returns the
    model's raw text output (callers parse JSON as needed), or '' if all fail.

    Raises UsageCapExceeded (before making any call) if the requesting user — set via
    app.request_ctx.set_user() at the top of the router endpoint — has a per-user USD
    usage cap configured and has already reached it."""
    who = request_ctx.get_user()
    usage.check_cap(who)   # raises UsageCapExceeded; deliberately not caught here

    need_vision = any(isinstance(p, dict) and p.get("inline_data") for p in (parts or []))
    ordered = sorted(
        [p for p in get_settings()["providers"] if p.get("enabled", True)],
        key=lambda p: p.get("priority", 99),
    )
    import time as _t
    for spec in ordered:
        name = spec.get("provider")
        reg = _REGISTRY.get(name)
        if not reg or not reg["available"]():
            continue
        if need_vision and not reg["vision"]:
            continue
        model = spec.get("model") or ""
        t0 = _t.time()
        try:
            txt, tok = reg["call"](parts, model)
            if txt and txt.strip():
                print(f"[ai] {name} OK {(_t.time()-t0):.1f}s (vision={need_vision})", flush=True)
                usage.record(who, name, model, tok.get("in", 0), tok.get("out", 0), ok=True)
                return txt
            print(f"[ai] {name} EMPTY {(_t.time()-t0):.1f}s", flush=True)
            usage.record(who, name, model, 0, 0, ok=False)
        except Exception as e:
            print(f"[ai] {name} FAIL {(_t.time()-t0):.1f}s: {str(e)[:160]}", flush=True)
            usage.record(who, name, model, 0, 0, ok=False)
            continue   # quota / rate-limit / error -> try the next provider
    print("[ai] ALL PROVIDERS FAILED", flush=True)
    return ""
