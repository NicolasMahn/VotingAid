#!/usr/bin/env python3
"""Turns the party programs in programme/ into data/programme.json.

Each page is split into passages of roughly PASSAGE_CHARS characters, never
across pages, so every passage can link to the exact PDF page. Every passage
gets an embedding, stored as int8 to keep the file small; the browser embeds
the person's opinion with the same model and finds the closest passages.

Needs `pdftotext` (poppler) and OPENROUTER_API_KEY. Run it again only when a
program changes:

    OPENROUTER_API_KEY=sk-or-... python3 scripts/build_programs.py
"""

from __future__ import annotations

import base64
import json
import os
import re
import subprocess
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PARTIES = ["afd", "bsw", "fdp", "gruene", "linke", "spd", "union"]

# Must match js/retrieval.js.
EMBEDDING_MODEL = "openai/text-embedding-3-large"
DIMENSIONS = 512

PASSAGE_CHARS = 1000
MIN_PASSAGE_CHARS = 200  # shorter leftovers are headings or page furniture
BATCH = 100


def pages(pdf: Path) -> list[str]:
    text = subprocess.run(["pdftotext", str(pdf), "-"], capture_output=True, text=True, check=True).stdout
    return text.split("\f")


def paragraphs(page: str) -> list[str]:
    # Lines inside a paragraph are wrapped; blank lines and bullets start new ones.
    blocks = re.split(r"\n\s*\n|\n(?=[•●▪–-] )", page)
    cleaned = []
    for block in blocks:
        block = re.sub(r"(\w)-\n(\w)", r"\1\2", block)  # rejoin hyphenated words
        block = re.sub(r"\s+", " ", block).strip()
        if block:
            cleaned.append(block)
    return cleaned


def sentences(paragraph: str) -> list[str]:
    # Some programs have no blank lines at all, so a "paragraph" can be a page.
    if len(paragraph) <= PASSAGE_CHARS:
        return [paragraph]
    return re.split(r"(?<=[.!?])\s+(?=[A-ZÄÖÜ„•])", paragraph)


def passages(page: str) -> list[str]:
    result, current = [], ""
    for piece in (s for p in paragraphs(page) for s in sentences(p)):
        if current and len(current) + len(piece) > PASSAGE_CHARS:
            result.append(current)
            current = ""
        current = f"{current} {piece}".strip()
    if current:
        result.append(current)
    return [p for p in result if len(p) >= MIN_PASSAGE_CHARS]


def embed(texts: list[str], key: str) -> list[list[float]]:
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/embeddings",
        data=json.dumps({"model": EMBEDDING_MODEL, "input": texts, "dimensions": DIMENSIONS}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.load(response)["data"]
    return [item["embedding"] for item in sorted(data, key=lambda item: item["index"])]


def quantise(vector: list[float]) -> bytes:
    # Cosine similarity ignores length, so each vector can use its own scale.
    scale = 127 / max(abs(x) for x in vector)
    return bytes(round(x * scale) & 0xFF for x in vector)


def main() -> None:
    key = os.environ.get("OPENROUTER_API_KEY") or os.environ["OPEN_ROUTER_KEY"]
    chunks = []
    for party in PARTIES:
        for number, page in enumerate(pages(ROOT / "programme" / f"{party}.pdf"), start=1):
            chunks += [{"party": party, "page": number, "text": text} for text in passages(page)]
        print(f"{party}: {sum(c['party'] == party for c in chunks)} passages")

    vectors = bytearray()
    for start in range(0, len(chunks), BATCH):
        batch = chunks[start : start + BATCH]
        for vector in embed([c["text"] for c in batch], key):
            vectors += quantise(vector)
        print(f"embedded {start + len(batch)} / {len(chunks)}")

    out = {
        "model": EMBEDDING_MODEL,
        "dimensions": DIMENSIONS,
        "chunks": chunks,
        "vectors": base64.b64encode(bytes(vectors)).decode(),
    }
    target = ROOT / "data" / "programme.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
