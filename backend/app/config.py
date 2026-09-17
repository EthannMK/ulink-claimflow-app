import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    jwt_secret: str = os.getenv("JWT_SECRET", "dev-secret-change-me")
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
    ocr_provider: str = os.getenv("OCR_PROVIDER", "stub")
    gemini_api_key: str = os.getenv("GEMINI_API_KEY", "")
    gemini_model: str = os.getenv("GEMINI_MODEL", "gemini-3.6-flash")
    # Google Document AI (Form Parser) — for the field-highlight review view
    docai_project: str = os.getenv("DOCAI_PROJECT", "")
    docai_location: str = os.getenv("DOCAI_LOCATION", "asia-southeast1")
    docai_processor_id: str = os.getenv("DOCAI_PROCESSOR_ID", "")
    # Document AI is only used for field-highlight boxes; OFF by default for speed.
    # Set USE_DOCAI=1 to re-enable on-document highlighting.
    use_docai: bool = os.getenv("USE_DOCAI", "0").lower() in ("1", "true", "yes")

settings = Settings()
