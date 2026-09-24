#!/usr/bin/env python3
"""Turns the party programs in programme/ into data/programme.json.

Each page is split into passages of about 1,000 characters, never
across pages, so every passage can link to the exact PDF page. Every passage
gets an embedding, stored as int8 to keep the file small; the browser embeds
the person's opinion with the same model and finds the closest passages.

Needs `pdftotext` (poppler) and OPENROUTER_API_KEY. Run it again only when a
program changes:

    OPENROUTER_API_KEY=sk-or-... python3 scripts/build_programs.py
"""

from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

from embeddings import index_file
from passages import pack

ROOT = Path(__file__).resolve().parent.parent
PARTIES = ["afd", "bsw", "fdp", "gruene", "linke", "spd", "union"]

MIN_PASSAGE_CHARS = 200  # shorter leftovers are headings or page furniture


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


def passages(page: str) -> list[str]:
    return pack(paragraphs(page), MIN_PASSAGE_CHARS)


def main() -> None:
    chunks = []
    for party in PARTIES:
        for number, page in enumerate(pages(ROOT / "programme" / f"{party}.pdf"), start=1):
            chunks += [{"party": party, "page": number, "text": text} for text in passages(page)]
        print(f"{party}: {sum(c['party'] == party for c in chunks)} passages")

    out = index_file(chunks, [c["text"] for c in chunks])
    target = ROOT / "data" / "programme.json"
    target.parent.mkdir(exist_ok=True)
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
