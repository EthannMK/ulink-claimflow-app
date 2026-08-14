"""Ports (interfaces). Every external system is accessed ONLY through these.
Concrete adapters implement them; core logic depends on the interface, not the vendor."""
from __future__ import annotations
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime

@dataclass
class InboundMessage:
    """Normalized message from any channel."""
    channel: str            # email | facebook | viber | telegram | webform | phone
    external_id: str
    sender: str
    subject: str | None
    body: str
    attachments: list[str]  # storage keys/urls
    received_at: datetime

class ChannelAdapter(ABC):
    """Email, Facebook, Viber, Telegram, ... each normalizes to InboundMessage."""
    @abstractmethod
    def fetch(self) -> list[InboundMessage]: ...

class OcrProvider(ABC):
    @abstractmethod
    def extract_text(self, document_url: str) -> str: ...

class AiProvider(ABC):
    @abstractmethod
    def categorize(self, message: InboundMessage) -> str: ...
    @abstractmethod
    def extract_fields(self, text: str) -> list[dict]: ...
    @abstractmethod
    def summarize(self, text: str) -> str: ...

class IasAdapter(ABC):
    """The iAS claim system. API if available, else file/RPA-based implementation."""
    @abstractmethod
    def push_claim(self, claim: dict) -> str: ...
    @abstractmethod
    def get_payment_status(self, claim_id: str) -> str: ...
