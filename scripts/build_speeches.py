#!/usr/bin/env python3
"""Extracts every Bundestag speech since March 2025 into .cache/aussagen/reden.json,
one item per speaker turn, split into passages.

The plenary protocols come as XML from bundestag.de/services/opendata. Each
paragraph is attributed to whoever holds the floor: a <p klasse="redner">
hands it to a member, a <name> hands it to the chair. Only members with a
party are kept. Government members speak with a role instead of a fraction,
so their party comes from the MdB master data; members of the government who
are not in the Bundestag are left out, since they speak for the government.

Speeches in public parliamentary debates may be reproduced freely (§ 48 UrhG).

    python3 scripts/build_speeches.py && python3 scripts/build_statements.py
"""

from __future__ import annotations

import io
import json
import re
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime
from pathlib import Path

from passages import pack

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "bundestag"
OUT = ROOT / ".cache" / "aussagen" / "reden.json"

# The open-data list of plenary protocols of the 21st Bundestag.
LISTING = "https://www.bundestag.de/ajax/filterlist/de/services/opendata/1058442-1058442"
MASTER_DATA = "https://www.bundestag.de/resource/blob/472878/MdB-Stammdaten.zip"
PROTOCOL_PDF = "https://dserver.bundestag.de/btp/21/{number}.pdf"

# Short remarks ("Vielen Dank!") carry no position.
MIN_PASSAGE_CHARS = 300

FRACTIONS = {
    "afd": "afd",
    "bündnis 90/die grünen": "gruene",
    "cdu/csu": "union",
    "die linke": "linke",
    "spd": "spd",
}
PARTIES = {
    "afd": "afd",
    "bündnis 90/die grünen": "gruene",
    "cdu": "union",
    "csu": "union",
    "die linke.": "linke",
    "die linke": "linke",
    "spd": "spd",
    "fdp": "fdp",
    "bsw": "bsw",
}


def fetch(url: str) -> bytes:
    time.sleep(1)  # be gentle with bundestag.de
    request = urllib.request.Request(url, headers={"User-Agent": "VotingAid (github.com/NicolasMahn/VotingAid)"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def protocol_urls() -> list[str]:
    urls, offset = [], 0
    while True:
        page = fetch(f"{LISTING}?limit=20&noFilterSet=true&offset={offset}").decode()
        # Each file is linked twice on the page.
        found = list(dict.fromkeys(re.findall(r'href="(https://www\.bundestag\.de/resource/blob/\d+/21\d{3}\.xml)"', page)))
        if not found:
            return urls
        urls += found
        offset += len(found)


def protocol(url: str) -> ET.Element:
    cached = CACHE / url.rsplit("/", 1)[1]
    if not cached.exists():
        cached.parent.mkdir(parents=True, exist_ok=True)
        cached.write_bytes(fetch(url))
    return ET.parse(cached).getroot()


def party_by_member() -> dict[str, str]:
    with zipfile.ZipFile(io.BytesIO(fetch(MASTER_DATA))) as archive:
        root = ET.fromstring(archive.read("MDB_STAMMDATEN.XML"))
    parties = {}
    for member in root.iter("MDB"):
        party = PARTIES.get((member.findtext("BIOGRAFISCHE_ANGABEN/PARTEI_KURZ") or "").strip().lower())
        if party:
            parties[member.findtext("ID")] = party
    return parties


def normalise(label: str | None) -> str:
    return re.sub(r"\s+", " ", (label or "").replace("\xa0", " ")).strip().lower()


def speaker(redner: ET.Element, parties: dict[str, str]) -> dict | None:
    name = redner.find("name")
    fraction = normalise(name.findtext("fraktion"))
    party = FRACTIONS.get(fraction) or parties.get(redner.get("id"))
    if not party:
        return None
    full_name = " ".join(filter(None, (name.findtext("titel"), name.findtext("vorname"), name.findtext("nachname"))))
    return {"party": party, "speaker": full_name, "role": name.findtext("rolle/rolle_lang")}


def agenda_title(item: ET.Element) -> str:
    # The agenda item's heading paragraphs have classes starting with "T_".
    titles = [re.sub(r"\s+", " ", "".join(p.itertext())).strip() for p in item.findall("p") if (p.get("klasse") or "").startswith("T_")]
    return " ".join(titles)[:300]


def speeches(root: ET.Element, parties: dict[str, str]) -> list[dict]:
    number = f"21{int(root.get('sitzung-nr')):03d}"
    date = datetime.strptime(root.get("sitzung-datum"), "%d.%m.%Y").date().isoformat()
    source = {
        "kind": "rede",
        "date": date,
        "source": f"Plenarprotokoll 21/{int(root.get('sitzung-nr'))}",
        "url": PROTOCOL_PDF.format(number=number),
    }
    items = []
    for agenda_item in root.iter("tagesordnungspunkt"):
        title = agenda_title(agenda_item)
        for speech in agenda_item.iter("rede"):
            current, paragraphs, segments = None, [], []
            for child in speech:
                if child.tag == "p" and child.get("klasse") == "redner":
                    segments.append((current, paragraphs))
                    current, paragraphs = speaker(child.find("redner"), parties), []
                elif child.tag == "name":  # the chair takes the floor
                    segments.append((current, paragraphs))
                    current, paragraphs = None, []
                elif child.tag == "p" and current:
                    text = re.sub(r"\s+", " ", "".join(child.itertext())).strip()
                    if text:
                        paragraphs.append(text)
            segments.append((current, paragraphs))
            for who, texts in segments:
                passages = pack(texts, MIN_PASSAGE_CHARS) if who else []
                if passages:
                    items.append({**source, **who, "title": title, "passages": passages})
    return items


def main() -> None:
    parties = party_by_member()
    items = []
    for url in protocol_urls():
        items += speeches(protocol(url), parties)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items, ensure_ascii=False), encoding="utf-8")
    counts = {party: sum(item["party"] == party for item in items) for party in sorted({i["party"] for i in items})}
    print(f"wrote {len(items)} speeches: {counts}")


if __name__ == "__main__":
    main()
