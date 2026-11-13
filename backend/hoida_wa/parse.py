"""Small, deliberately exact command vocabulary for English and Finnish replies."""

from dataclasses import dataclass
import re
import unicodedata
from typing import Literal


@dataclass(frozen=True)
class Command:
    kind: Literal["link", "approve", "stop", "choose", "status", "help", "new_errand"]
    code: str | None = None
    n: int | None = None
    text: str | None = None


def parse_command(text: str) -> Command:
    original = text.strip()
    normalized = unicodedata.normalize("NFKC", original).casefold().replace("\ufe0f", "").strip()
    if "?" in normalized and all(unicodedata.category(c).startswith("P") for c in normalized):
        return Command("status")
    while normalized and (normalized[0].isspace() or unicodedata.category(normalized[0]).startswith("P")):
        normalized = normalized[1:]
    while normalized and (normalized[-1].isspace() or unicodedata.category(normalized[-1]).startswith("P")):
        normalized = normalized[:-1]
    match = re.fullmatch(r"(?:link|linkki)\s+((?:[0-9]\s*){6})", normalized)
    if match:
        return Command("link", code=re.sub(r"\s", "", match[1]))
    if normalized in {"yes", "ok", "approve", "kyllä", "joo", "👍", "👍🏻", "👍🏼", "👍🏽", "👍🏾", "👍🏿"}:
        return Command("approve")
    if normalized in {"stop", "no", "cancel", "ei", "lopeta"}:
        return Command("stop")
    if re.fullmatch(r"[1-9]", normalized):
        return Command("choose", n=int(normalized))
    if normalized in {"status", "tila"}:
        return Command("status")
    if normalized in {"help", "apua", "hi", "hello", "moi", "hei"}:
        return Command("help")
    return Command("new_errand", text=original)
