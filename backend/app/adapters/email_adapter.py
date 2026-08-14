"""STUB email channel adapter. Claude Code: implement real IMAP/inbound-parse here."""
from datetime import datetime
from .base import ChannelAdapter, InboundMessage

class EmailAdapter(ChannelAdapter):
    def fetch(self) -> list[InboundMessage]:
        return [InboundMessage(
            channel="email", external_id="demo-1", sender="member@example.com",
            subject="Claim submission", body="Please find my claim attached.",
            attachments=[], received_at=datetime.utcnow(),
        )]
