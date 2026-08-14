import os
from dotenv import load_dotenv
load_dotenv()

class Settings:
    database_url: str = os.getenv("DATABASE_URL", "")
    ocr_provider: str = os.getenv("OCR_PROVIDER", "stub")
    ai_provider: str = os.getenv("AI_PROVIDER", "stub")
    ias_base_url: str = os.getenv("IAS_BASE_URL", "")

settings = Settings()
