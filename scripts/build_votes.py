#!/usr/bin/env python3
"""Turns the Bundestag's roll-call votes into data/abstimmungen.json.

The votes come from the abgeordnetenwatch.de API (CC0). Only roll-call votes
("namentliche Abstimmungen") are recorded per member, so this is a small,
contested subset of everything the Bundestag decides. Each vote is counted per
party and embedded like a program passage, so the browser can find the votes
closest to an opinion.

Raw API responses are cached in .cache/, so a rerun only fetches new votes:

    OPENROUTER_API_KEY=sk-or-... python3 scripts/build_votes.py
"""

from __future__ import annotations

import html
import json
import re
import time
import urllib.request
from collections import Counter
from pathlib import Path

from embeddings import index_file

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "abgeordnetenwatch"
API = "https://www.abgeordnetenwatch.de/api/v2"

# abgeordnetenwatch ids of the Bundestag periods, newest first.
LEGISLATURES = {161: "2025–2029", 132: "2021–2025"}

# The API allows 30 requests per minute.
PAUSE_SECONDS = 2.1

# Fraction labels look like "SPD (Bundestag 2025 - 2029)"; groups like
# "BSW (Gruppe)" count as their party.
FRACTION_PREFIXES = {
    "afd": "afd",
    "bsw": "bsw",
    "fdp": "fdp",
    "bündnis 90": "gruene",
    "die linke": "linke",
    "spd": "spd",
    "cdu/csu": "union",
}


def fetch(url: str, cache_name: str | None = None) -> dict:
    cached = CACHE / f"{cache_name}.json" if cache_name else None
    if cached and cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    time.sleep(PAUSE_SECONDS)
    request = urllib.request.Request(url, headers={"User-Agent": "VotingAid (github.com/NicolasMahn/VotingAid)"})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = json.load(response)
    if cached:
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    return data


def party_of(fraction_label: str) -> str | None:
    label = fraction_label.lower()
    return next((party for prefix, party in FRACTION_PREFIXES.items() if label.startswith(prefix)), None)


def plain_text(markup: str | None) -> str:
    text = re.sub(r"<[^>]+>", " ", markup or "")
    return re.sub(r"\s+", " ", html.unescape(text)).strip()


def count_by_party(votes: list[dict]) -> dict[str, dict[str, int]]:
    counts: dict[str, Counter] = {}
    for vote in votes:
        party = party_of((vote.get("fraction") or {}).get("label", ""))
        if party:
            counts.setdefault(party, Counter())[vote["vote"]] += 1
    return {party: dict(counter) for party, counter in counts.items()}


def main() -> None:
    items = []
    for legislature, period in LEGISLATURES.items():
        # The list is fetched fresh so new votes show up; each vote is cached.
        polls = fetch(f"{API}/polls?field_legislature={legislature}&range_end=1000")["data"]
        print(f"Bundestag {period}: {len(polls)} votes")
        for poll in polls:
            detail = fetch(f"{API}/polls/{poll['id']}?related_data=votes", f"poll-{poll['id']}")["data"]
            items.append(
                {
                    "id": f"vote-{poll['id']}",
                    "title": poll["label"],
                    "date": poll["field_poll_date"],
                    "period": period,
                    "accepted": poll["field_accepted"],
                    "description": plain_text(poll["field_intro"]),
                    "url": poll["abgeordnetenwatch_url"],
                    "results": count_by_party(detail["related_data"]["votes"]),
                }
            )

    items.sort(key=lambda item: item["date"], reverse=True)
    out = index_file(items, [f"{item['title']}. {item['description']}" for item in items])
    target = ROOT / "data" / "abstimmungen.json"
    target.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {target.relative_to(ROOT)} ({target.stat().st_size / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
