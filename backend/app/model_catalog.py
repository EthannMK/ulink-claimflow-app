"""Live model catalogs — asks each provider, in real time, which models it offers.

Super-Admin only (the routes that expose this require super_admin): provider/model
names are confidential. Results are cached for a few minutes so opening the settings
page is fast; `force=True` refreshes immediately.

- OpenRouter: GET https://openrouter.ai/api/v1/models  (every model, with live pricing)
- Vertex AI : GET https://{host}/v1beta1/publishers/google/models  (Google's published
              models, paged). Only Gemini generative models are returned, because the
              app calls them with generateContent — image/embedding models would fail.
Listing a model does not guarantee your project/region can call it — use test_model().
"""
from __future__ import annotations
import time
import httpx
from app.config import settings

_CACHE: dict[str, tuple[float, dict]] = {}
_TTL = 600  # seconds


def _num(v) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _openrouter() -> list[dict]:
    headers = {"Authorization": f"Bearer {settings.openrouter_api_key}"} if settings.openrouter_api_key else {}
    r = httpx.get("https://openrouter.ai/api/v1/models", headers=headers, timeout=30)
    r.raise_for_status()
    out = []
    for m in r.json().get("data", []) or []:
        mid = str(m.get("id") or "")
        if not mid:
            continue
        arch = m.get("architecture") or {}
        mods = arch.get("input_modalities") or []
        if not isinstance(mods, list):
            mods = [x.strip() for x in str(arch.get("modality", "")).split("->")[0].split("+")]
        pricing = m.get("pricing") or {}
        p_in, p_out = _num(pricing.get("prompt")), _num(pricing.get("completion"))
        out.append({
            "id": mid,
            "name": m.get("name") or mid,
            "vision": "image" in [str(x).lower() for x in mods],
            "context": m.get("context_length"),
            # OpenRouter prices are USD per token -> show USD per 1M tokens
            "price_in_per_1m": round(p_in * 1_000_000, 4) if p_in is not None else None,
            "price_out_per_1m": round(p_out * 1_000_000, 4) if p_out is not None else None,
            "free": (p_in == 0 and p_out == 0) or mid.endswith(":free"),
            "stage": "",
        })
    return out


def _vertex_token() -> str:
    from app.ai_provider import _vertex_token as tok
    return tok()


def _vertex() -> list[dict]:
    if not settings.vertex_project:
        raise RuntimeError("VERTEX_PROJECT is not set on the server")
    loc = settings.vertex_location or "us-central1"
    host = "aiplatform.googleapis.com" if loc == "global" else f"{loc}-aiplatform.googleapis.com"
    headers = {"Authorization": f"Bearer {_vertex_token()}", "x-goog-user-project": settings.vertex_project}
    raw: list[dict] = []
    last_err = ""
    for version in ("v1beta1", "v1"):
        raw, token = [], ""
        try:
            for _ in range(20):  # page through (safety cap)
                params = {"pageSize": 100, "listAllVersions": "true"}
                if token:
                    params["pageToken"] = token
                r = httpx.get(f"https://{host}/{version}/publishers/google/models", headers=headers, params=params, timeout=30)
                r.raise_for_status()
                body = r.json()
                raw.extend(body.get("publisherModels", []) or [])
                token = body.get("nextPageToken") or ""
                if not token:
                    break
            if raw:
                break
        except Exception as e:  # try the other API version
            last_err = str(e)[:200]
    if not raw and last_err:
        raise RuntimeError(last_err)
    seen: dict[str, dict] = {}
    for m in raw:
        mid = str(m.get("name", "")).split("/")[-1]
        if not mid.lower().startswith("gemini") or "embedding" in mid.lower():
            continue
        if mid in seen:
            continue
        seen[mid] = {
            "id": mid, "name": mid, "vision": True, "context": None,
            "price_in_per_1m": None, "price_out_per_1m": None, "free": False,
            "stage": _stage(str(m.get("launchStage") or "")),
        }
    return list(seen.values())


def _stage(raw: str) -> str:
    """GA / PUBLIC_PREVIEW / EXPERIMENTAL -> 'GA' / 'Public Preview' / 'Experimental'."""
    s = raw.replace("_", " ").strip()
    return s if len(s) <= 3 else s.title()


_FETCHERS = {"openrouter": _openrouter, "vertex": _vertex}


def cached_price(provider: str, model: str) -> tuple[float, float] | None:
    """Live USD-per-1M-token price for a model, from the last catalog fetch (no network).
    Used by the cost estimate so it reflects the provider's real current price."""
    hit = _CACHE.get(provider)
    if not hit:
        return None
    for m in hit[1].get("models", []):
        if m["id"] == model and m.get("price_in_per_1m") is not None and m.get("price_out_per_1m") is not None:
            return float(m["price_in_per_1m"]), float(m["price_out_per_1m"])
    return None


def list_models(provider: str, force: bool = False) -> dict:
    """{'provider', 'models': [...], 'fetched_at', 'error'} — never raises."""
    if provider not in _FETCHERS:
        return {"provider": provider, "models": [], "fetched_at": time.time(), "error": "Unknown provider"}
    hit = _CACHE.get(provider)
    if hit and not force and time.time() - hit[0] < _TTL:
        return hit[1]
    try:
        models = _FETCHERS[provider]()
        models.sort(key=lambda m: (not m["id"].lower().startswith(("gemini", "google/gemini")), m["id"]))
        res = {"provider": provider, "models": models, "fetched_at": time.time(), "error": ""}
        _CACHE[provider] = (time.time(), res)
        return res
    except Exception as e:
        stale = hit[1]["models"] if hit else []
        return {"provider": provider, "models": stale, "fetched_at": hit[0] if hit else time.time(),
                "error": f"Could not load the live model list: {str(e)[:200]}"}


def test_model(provider: str, model: str) -> dict:
    """Send a tiny prompt to one provider+model directly (no fallback) and report back."""
    from app import ai_provider
    reg = ai_provider._REGISTRY.get(provider)
    if not reg:
        return {"ok": False, "detail": "Unknown provider"}
    if not reg["available"]():
        return {"ok": False, "detail": ai_provider.PROVIDER_INFO.get(provider, {}).get("not_ready_hint", "Not set up")}
    t0 = time.time()
    try:
        txt, tok = reg["call"]([{"text": 'Reply with exactly: OK'}], model)
        ok = bool(txt and txt.strip())
        return {"ok": ok, "seconds": round(time.time() - t0, 2),
                "detail": "Model answered." if ok else "Model returned an empty reply.",
                "tokens": (tok.get("in", 0) + tok.get("out", 0))}
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        why = {400: "request rejected (model may not accept this input)", 401: "key not accepted",
               402: "no credit on the account", 403: "not allowed for this project/key",
               404: "model not found / not available in this region", 429: "rate-limited or quota reached"}.get(code, "provider error")
        return {"ok": False, "seconds": round(time.time() - t0, 2), "detail": f"HTTP {code}: {why}"}
    except Exception as e:
        return {"ok": False, "seconds": round(time.time() - t0, 2), "detail": str(e)[:200]}
