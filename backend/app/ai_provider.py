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
from app import request_ctx, usage, progress
from app.usage import UsageCapExceeded  # re-exported so callers only need ai_provider

__all__ = ["generate_text", "any_available", "provider_status", "get_settings",
           "save_settings", "default_providers", "UsageCapExceeded", "PROVIDER_LABELS",
           "provider_label"]

# Provider/model details are CONFIDENTIAL: they live only here on the server and are
# returned only by Super-Admin endpoints — never hard-coded in the frontend bundle,
# never in user-facing messages.
PROVIDER_INFO = {
    "vertex": {
        "label": "Vertex AI (Google Cloud)",
        "description": "Google Cloud's AI platform. Billed to your GCP credit. Main provider — reads Burmese handwriting and scanned PDFs directly.",
        "standard_model": "gemini-3.6-flash",
        "not_ready_hint": "VERTEX_PROJECT is not set on the server.",
    },
    "openrouter": {
        "label": "OpenRouter",
        "description": "A marketplace that gives access to many AI models through one API key. Backup if Vertex AI is unavailable.",
        "standard_model": "google/gemini-3.6-flash",
        "not_ready_hint": "OPENROUTER_API_KEY is not set on the server.",
    },
}
PROVIDER_LABELS = {k: v["label"] for k, v in PROVIDER_INFO.items()}


def provider_label(name: str) -> str:
    return PROVIDER_LABELS.get(name, name)


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


# ---- streaming variants (used only when a live-progress listener is active) ----
# They return the same (text, usage) as the normal calls, but read the reply as it
# is generated and pass the text-so-far to on_text() — that is what lets the JD1
# page show which section the AI is writing. Thought/"thinking" parts are skipped.

def _sse_payloads(resp):
    """Yield the JSON payload of each server-sent-event 'data:' line."""
    for line in resp.iter_lines():
        if not line or line.startswith(":"):
            continue
        if line.startswith("data:"):
            data = line[5:].strip()
            if data == "[DONE]":
                break
            yield data


def _parse_vertex_stream(payloads, on_text) -> tuple[str, dict]:
    import json as _json
    out, tok = "", {"in": 0, "out": 0}
    for data in payloads:
        try:
            j = _json.loads(data)
        except Exception:
            continue
        if j.get("error"):
            raise RuntimeError(str(j["error"])[:200])
        for c in (j.get("candidates") or [])[:1]:
            for part in (c.get("content") or {}).get("parts", []) or []:
                if part.get("text") and not part.get("thought"):
                    out += part["text"]
                    on_text(out)
        um = j.get("usageMetadata")
        if um:
            tok = {"in": int(um.get("promptTokenCount") or 0), "out": int(um.get("candidatesTokenCount") or 0)}
    return out, tok


def _parse_openrouter_stream(payloads, on_text) -> tuple[str, dict]:
    import json as _json
    out, tok = "", {"in": 0, "out": 0}
    for data in payloads:
        try:
            j = _json.loads(data)
        except Exception:
            continue
        if j.get("error"):
            raise RuntimeError(str(j["error"])[:200])
        for ch in (j.get("choices") or [])[:1]:
            piece = (ch.get("delta") or {}).get("content")
            if piece:
                out += piece
                on_text(out)
        u = j.get("usage")
        if u:
            tok = {"in": int(u.get("prompt_tokens") or 0), "out": int(u.get("completion_tokens") or 0)}
    return out, tok


def _vertex_stream(parts: list, model: str, on_text) -> tuple[str, dict]:
    loc = settings.vertex_location or "us-central1"
    mdl = model or settings.vertex_model
    host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    url = (f"https://{host}/v1/projects/{settings.vertex_project}/locations/{loc}"
           f"/publishers/google/models/{mdl}:streamGenerateContent?alt=sse")
    headers = {"Authorization": f"Bearer {_vertex_token()}", "Content-Type": "application/json"}
    with httpx.stream("POST", url, headers=headers, json={"contents": [{"role": "user", "parts": parts}]}, timeout=180) as r:
        r.raise_for_status()
        return _parse_vertex_stream(_sse_payloads(r), on_text)


def _openrouter_stream(parts: list, model: str, on_text) -> tuple[str, dict]:
    content: list[dict] = []
    for p in parts:
        if not isinstance(p, dict):
            continue
        if p.get("text"):
            content.append({"type": "text", "text": p["text"]})
        elif p.get("inline_data"):
            d = p["inline_data"]
            content.append({"type": "image_url", "image_url": {"url": f"data:{d.get('mime_type','image/jpeg')};base64,{d.get('data','')}"}})
    payload = {"model": model or settings.openrouter_model, "messages": [{"role": "user", "content": content}],
               "stream": True, "usage": {"include": True}}
    with httpx.stream("POST", "https://openrouter.ai/api/v1/chat/completions",
                      headers={"Authorization": f"Bearer {settings.openrouter_api_key}"}, json=payload, timeout=180) as r:
        r.raise_for_status()
        return _parse_openrouter_stream(_sse_payloads(r), on_text)


# name -> capabilities
_REGISTRY = {
    "vertex":     {"available": _vertex_available,                                                       "vision": True,
                   "call": _vertex_call, "stream": _vertex_stream},
    "openrouter": {"available": lambda: bool(settings.openrouter_api_key and settings.openrouter_model), "vision": True,
                   "call": _openrouter_call, "stream": _openrouter_stream},
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
            "description": PROVIDER_INFO.get(name, {}).get("description", ""),
            "standard_model": PROVIDER_INFO.get(name, {}).get("standard_model", ""),
            "not_ready_hint": PROVIDER_INFO.get(name, {}).get("not_ready_hint", ""),
            "priority": spec.get("priority"), "enabled": spec.get("enabled", True),
            "available": bool(reg and reg["available"]()),
            "vision": bool(reg and reg["vision"]),
        })
    return out


def _why(e: Exception) -> str:
    """Short, user-safe failure reason — never includes URLs/hostnames (they'd reveal the provider)."""
    if isinstance(e, httpx.HTTPStatusError):
        code = e.response.status_code
        return {401: "not authorised", 402: "out of credit", 403: "not allowed", 404: "model not available",
                408: "timed out", 429: "busy / rate-limited", 500: "service error", 502: "service error",
                503: "temporarily unavailable", 504: "timed out"}.get(code, f"error {code}")
    if isinstance(e, httpx.TimeoutException):
        return "timed out"
    return "connection problem"


def generate_text(parts: list) -> str:
    """Run the request against the first working provider (by priority). Returns the
    model's raw text output (callers parse JSON as needed), or '' if all fail.

    Raises UsageCapExceeded (before making any call) if the requesting user — set via
    app.request_ctx.set_user() at the top of the router endpoint — has a per-user USD
    usage cap configured and has already reached it.

    When a live-progress listener is active (app.progress), the reply is streamed so
    the caller can report what the AI is doing; otherwise behaviour is unchanged."""
    who = request_ctx.get_user()
    feature = request_ctx.get_feature()
    usage.check_cap(who)   # raises UsageCapExceeded; deliberately not caught here

    need_vision = any(isinstance(p, dict) and p.get("inline_data") for p in (parts or []))
    ordered = sorted(
        [p for p in get_settings()["providers"] if p.get("enabled", True)],
        key=lambda p: p.get("priority", 99),
    )
    live = progress.active()
    import time as _t
    attempt = 0
    for spec in ordered:
        name = spec.get("provider")
        reg = _REGISTRY.get(name)
        if not reg or not reg["available"]():
            continue
        if need_vision and not reg["vision"]:
            continue
        model = spec.get("model") or ""
        role = "primary AI service" if attempt == 0 else "backup AI service"
        attempt += 1
        t0 = _t.time()
        got_text = [False]

        def on_text(so_far: str, _t0=t0):
            if not got_text[0]:
                got_text[0] = True
                progress.emit(f"AI started writing its answer after {(_t.time() - _t0):.0f}s", kind="step")
            progress.text(so_far)

        try:
            if live:
                progress.emit(f"Sent to the {role} — the AI is reading the documents…", kind="step")
                try:
                    txt, tok = reg["stream"](parts, model, on_text)
                    if not (txt and txt.strip()) and not got_text[0]:
                        raise ValueError("empty stream")
                except (httpx.HTTPStatusError, httpx.TimeoutException):
                    raise
                except Exception:
                    if got_text[0]:
                        raise
                    # streaming itself didn't work (no text at all) -> same provider, normal call
                    progress.emit("Live view unavailable for this request — waiting for the full answer…")
                    txt, tok = reg["call"](parts, model)
            else:
                txt, tok = reg["call"](parts, model)
            secs = _t.time() - t0
            if txt and txt.strip():
                print(f"[ai] {name} OK {secs:.1f}s (vision={need_vision}, live={live})", flush=True)
                usage.record(who, name, model, tok.get("in", 0), tok.get("out", 0), ok=True, purpose=feature, seconds=secs)
                progress.emit(f"AI finished in {secs:.0f}s — read {tok.get('in', 0):,} tokens, wrote {tok.get('out', 0):,}",
                              kind="step", ai_seconds=round(secs, 1))
                return txt
            print(f"[ai] {name} EMPTY {secs:.1f}s", flush=True)
            usage.record(who, name, model, 0, 0, ok=False, purpose=feature, seconds=secs)
            progress.emit(f"The {role} returned an empty answer after {secs:.0f}s — trying the next one", kind="warn")
        except Exception as e:
            secs = _t.time() - t0
            print(f"[ai] {name} FAIL {secs:.1f}s: {str(e)[:160]}", flush=True)
            usage.record(who, name, model, 0, 0, ok=False, purpose=feature, seconds=secs)
            progress.emit(f"The {role} did not answer ({_why(e)}) after {secs:.0f}s — trying the next one", kind="warn")
            continue   # quota / rate-limit / error -> try the next provider
    print("[ai] ALL PROVIDERS FAILED", flush=True)
    progress.emit("No AI service could answer right now", kind="warn")
    return ""
