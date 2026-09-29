import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-secret-change-me")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
    ocr_provider: str = os.getenv("OCR_PROVIDER", "stub")
    # Shared AI provider layer — API keys stay in env/secrets, NEVER in the settings DB.
    # Two providers, both running the same Gemini model by default (gemini-3.6-flash):
    # Vertex AI (primary, paid via GCP credit) and OpenRouter (backup). Groq and the
    # direct Gemini API / AI Studio were removed on purpose.
    openrouter_api_key: str = os.getenv("OPENROUTER_API_KEY", "")
    # Provisioning/management key (OpenRouter's separate "management" API key) — used
    # only to create/monitor scoped OpenRouter keys with their own credit limit (e.g.
    # for a demo tester). NOT the key used to make completions calls (that's
    # OPENROUTER_API_KEY above). Optional — features that need it degrade cleanly
    # when it isn't set.
    openrouter_management_key: str = os.getenv("OPENROUTER_MANAGEMENT_KEY", "")
    # NOTE: verify this model id against OpenRouter's own catalog in Settings > AI
    # Providers before relying on it — OpenRouter's newest Gemini listings are often
    # paid-only, not on the free tier.
    openrouter_model: str = os.getenv("OPENROUTER_MODEL", "google/gemini-3.6-flash")
    # Vertex AI (GCP) — paid Gemini via the project's billing/credit. No API key: uses
    # the service account on Cloud Run, or `gcloud auth application-default login`
    # locally.
    vertex_project: str = os.getenv("VERTEX_PROJECT", "")
    vertex_location: str = os.getenv("VERTEX_LOCATION", "global")
    vertex_model: str = os.getenv("VERTEX_MODEL", "gemini-3.6-flash")
    # Google Document AI (Form Parser) — for the field-highlight review view
    docai_project: str = os.getenv("DOCAI_PROJECT", "")
    docai_location: str = os.getenv("DOCAI_LOCATION", "asia-southeast1")
    docai_processor_id: str = os.getenv("DOCAI_PROCESSOR_ID", "")
    # Document AI is only used for field-highlight boxes; OFF by default for speed.
    # Set USE_DOCAI=1 to re-enable on-document highlighting.
    use_docai: bool = os.getenv("USE_DOCAI", "0").lower() in ("1", "true", "yes")
    # Daily AI limits reset at local midnight in this timezone (minutes from UTC;
    # Myanmar = +390 = UTC+6:30).
    app_tz_offset_min: int = int(os.getenv("APP_TZ_OFFSET_MIN", "390"))

settings = Settings()
