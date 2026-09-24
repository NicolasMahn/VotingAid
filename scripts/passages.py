"""Splits text into passages of about PASSAGE_CHARS characters, shared by the
build scripts so programs, speeches and web pages are cut the same way."""

from __future__ import annotations

import re

PASSAGE_CHARS = 1000


def sentences(paragraph: str) -> list[str]:
    # Some sources have no paragraph breaks at all, so one can be a page long.
    if len(paragraph) <= PASSAGE_CHARS:
        return [paragraph]
    return re.split(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ„•])", paragraph)


def pack(paragraphs: list[str], min_chars: int) -> list[str]:
    """Joins paragraphs into passages, drops the ones shorter than `min_chars`."""
    result, current = [], ""
    for piece in (s for p in paragraphs for s in sentences(p)):
        if current and len(current) + len(piece) > PASSAGE_CHARS:
            result.append(current)
            current = ""
        current = f"{current} {piece}".strip()
    if current:
        result.append(current)
    return [p for p in result if len(p) >= min_chars]
