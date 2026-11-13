"""Pure webhook parsing and verification, independent of a web framework."""

from dataclasses import dataclass, field
import hashlib
import hmac
from typing import Literal, Mapping


@dataclass(frozen=True)
class IncomingMessage:
    from_number: str
    message_id: str
    kind: Literal["text", "audio", "image", "interactive", "other"] = "other"
    text: str | None = None
    media_id: str | None = None
    mime_type: str | None = None
    caption: str | None = None
    reply_id: str | None = None
    timestamp: str | None = None


@dataclass(frozen=True)
class MessageStatus:
    message_id: str
    status: str
    recipient_id: str | None = None
    timestamp: str | None = None
    errors: list[dict] = field(default_factory=list)


@dataclass
class ParsedWebhook:
    messages: list[IncomingMessage] = field(default_factory=list)
    statuses: list[MessageStatus] = field(default_factory=list)


def parse_webhook(payload: dict) -> ParsedWebhook:
    result = ParsedWebhook()
    for entry in payload.get("entry", []) or []:
        for change in entry.get("changes", []) or []:
            value = change.get("value") or {}
            for message in value.get("messages", []) or []:
                kind = message.get("type", "other")
                if kind not in {"text", "audio", "image", "interactive"}:
                    kind = "other"
                data = message.get(kind) or {}
                reply = data.get("button_reply") or data.get("list_reply") or {}
                result.messages.append(IncomingMessage(
                    from_number=message.get("from", ""), message_id=message.get("id", ""),
                    kind=kind, text=data.get("body") if kind == "text" else reply.get("title"),
                    media_id=data.get("id") if kind in {"audio", "image"} else None,
                    mime_type=data.get("mime_type"), caption=data.get("caption"),
                    reply_id=reply.get("id"), timestamp=message.get("timestamp"),
                ))
            for status in value.get("statuses", []) or []:
                result.statuses.append(MessageStatus(
                    message_id=status.get("id", ""), status=status.get("status", ""),
                    recipient_id=status.get("recipient_id"), timestamp=status.get("timestamp"),
                    errors=status.get("errors") or [],
                ))
    return result


def verify_signature(raw_body: bytes, header_value: str, app_secret: str) -> bool:
    if not app_secret or not header_value or not header_value.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(app_secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected.encode(), header_value.encode())


def verify_challenge(params: Mapping[str, str], verify_token: str) -> str | None:
    token = params.get("hub.verify_token", "")
    if (verify_token and params.get("hub.mode") == "subscribe"
            and hmac.compare_digest(token.encode(), verify_token.encode())):
        return params.get("hub.challenge")
    return None
