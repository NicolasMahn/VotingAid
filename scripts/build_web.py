#!/usr/bin/env python3
"""Collects statements from the websites of the Bundestag fractions and the
federal parties into .cache/aussagen/web.json.

Only federal sites are used: fractions speak for the Bundestag group, the
federal party sites for the party as a whole; state associations are left
out. Pages come from each site's sitemaps or feed, pre-filtered by their listed
date and then by the date trafilatura finds in the page itself, so only pages published
since the 21st Bundestag first met are kept. Every site's robots.txt
allows these pages, and its Crawl-delay is respected. We keep short passages with a link back, never whole
pages on their own.

Needs trafilatura (scripts/requirements.txt):

    .venv/bin/python scripts/build_web.py && python3 scripts/build_statements.py
"""

from __future__ import annotations

import gzip
import hashlib
import json
import re
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from concurrent.futures import ThreadPoolExecutor
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse

import trafilatura

from passages import pack

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".cache" / "web"
OUT = ROOT / ".cache" / "aussagen" / "web.json"

SINCE = "2025-03-25"  # first sitting of the 21st Bundestag
MAX_PAGES_PER_SITE = 600  # the newest ones; enough for a year and a half
PAUSE_SECONDS = 1.5  # per site, unless its robots.txt asks for more; sites run in parallel
MIN_PASSAGE_CHARS = 300

# Each site lists its pages in sitemaps (found in robots.txt when not given)
# or, where the sitemap is missing or broken, in a paged RSS feed or paged
# listing pages.
SITES = [
    {"party": "union", "kind": "fraktion", "home": "https://www.cducsu.de/", "sitemaps": ["https://www.cducsu.de/sitemap.xml"]},
    {"party": "spd", "kind": "fraktion", "home": "https://www.spdfraktion.de/", "sitemaps": ["https://www.spdfraktion.de/sitemap.xml"]},
    {"party": "gruene", "kind": "fraktion", "home": "https://www.gruene-bundestag.de/"},
    # Formerly linksfraktion.de; its sitemaps end in 2018 and it asks for 10 s between requests.
    {"party": "linke", "kind": "fraktion", "home": "https://www.dielinkebt.de/", "max_pages": 300,
     "listing": "https://www.dielinkebt.de/presse/pressemitteilungen/news/seite-{page}/", "first_page": 1,
     "links": r'href="([^"]*/pressemitteilungen/detail/[^"]*)"', "listing_pages": 15},
    {"party": "afd", "kind": "fraktion", "home": "https://afdbundestag.de/"},
    {"party": "union", "kind": "partei", "home": "https://www.cdu.de/"},
    {"party": "spd", "kind": "partei", "home": "https://www.spd.de/", "sitemaps": ["https://www.spd.de/sitemap.xml"]},
    {"party": "gruene", "kind": "partei", "home": "https://www.gruene.de/"},
    {"party": "linke", "kind": "partei", "home": "https://www.die-linke.de/", "sitemaps": ["https://www.die-linke.de/sitemap.xml"]},
    {"party": "afd", "kind": "partei", "home": "https://www.afd.de/"},
    # No sitemap, and the feed cannot be paged: only its newest 100 posts.
    {"party": "fdp", "kind": "partei", "home": "https://www.fdp.de/", "feed": "https://www.fdp.de/rss.xml?page={page}", "first_page": 0},
    {"party": "bsw", "kind": "partei", "home": "https://bsw-vg.de/", "feed": "https://bsw-vg.de/feed/?paged={page}", "first_page": 1},
]

# Pages that are about people, events, downloads or the site itself rather than positions.
SKIP = re.compile(
    r"/(termine?|veranstaltung(en)?|events?|abgeordnete|personen|kontakt|impressum|datenschutz(erklaerung)?|jobs?"
    r"|stellen|karriere|shop|spenden?|mitglied|mitmachen|suche|search|en|tag|tags|kategorie|category|author|autor"
    r"|page|feed|login|presse/fotos|mediathek|video|podcast|sammlungen|fraktion|wir-im-bundestag|ueber-uns"
    r"|unterstuetzen|service|downloads|app|home|startseite|netiquette|transparenz|404)(/|$)|newsletter|\.pdf$",
    re.IGNORECASE,
)

# Pages that list teasers, or ask for money, rather than state a position.
NOT_A_STATEMENT = re.compile(r"Online-Spende|Bankverbindung|^%PDF")

# Consent banners and embed placeholders that trafilatura keeps as text.
BOILERPLATE = re.compile(
    r"Platzhalterinhalt|Cookie|Datenschutzerklärung|Inhalt entsperren|externe[rn]? Inhalt|Klicken Sie auf die Schaltfläche",
    re.IGNORECASE,
)

HEADERS = {"User-Agent": "VotingAid (github.com/NicolasMahn/VotingAid)"}


def get(url: str, retry: bool = True) -> bytes | None:
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as response:
            body = response.read()
    except urllib.error.HTTPError as error:
        if retry and (error.code == 429 or error.code >= 500):
            time.sleep(30)  # throttled or briefly down: back off once
            return get(url, retry=False)
        print(f"  skipped {url}: {error}")
        return None
    except Exception as error:  # a missing sitemap or a dead page is not fatal
        print(f"  skipped {url}: {error}")
        return None
    # Some servers send gzipped sitemaps without saying so.
    return gzip.decompress(body) if body[:2] == b"\x1f\x8b" else body


def sitemap_entries(url: str, pause: float, depth: int = 0) -> list[tuple[str, str]]:
    """(url, lastmod) pairs, following sitemap indexes."""
    body = get(url)
    if not body or depth > 3:
        return []
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        return []
    ns = {"s": "http://www.sitemaps.org/schemas/sitemap/0.9"}
    entries = []
    for sitemap in root.findall("s:sitemap", ns):
        lastmod = sitemap.findtext("s:lastmod", "", ns)
        if not lastmod or lastmod[:10] >= SINCE:
            time.sleep(pause)
            entries += sitemap_entries(sitemap.findtext("s:loc", "", ns).strip(), pause, depth + 1)
    for page in root.findall("s:url", ns):
        entries.append((page.findtext("s:loc", "", ns).strip(), page.findtext("s:lastmod", "", ns)[:10]))
    return entries


def feed_entries(template: str, first_page: int, pause: float) -> list[tuple[str, str]]:
    """(url, date) pairs from a paged RSS feed, newest first, back to SINCE."""
    entries, number = [], first_page
    while True:
        body = get(template.format(page=number))
        # Some feeds start with blank lines, which XML does not allow before the declaration.
        items = ET.fromstring(body.lstrip()).iter("item") if body else []
        found = [(item.findtext("link", "").strip(), parsedate_to_datetime(item.findtext("pubDate")).date().isoformat()) for item in items]
        new = [entry for entry in found if entry not in entries]
        entries += new
        # Past its last page, a feed may repeat itself instead of ending.
        if not new or new[-1][1] < SINCE:
            return entries
        number += 1
        time.sleep(pause)


def listing_entries(site: dict, pause: float) -> list[tuple[str, str]]:
    """Article links from paged listing pages, newest first; dates come from the articles."""
    links = []
    for number in range(site["first_page"], site["first_page"] + site["listing_pages"]):
        body = get(site["listing"].format(page=number))
        found = re.findall(site["links"], (body or b"").decode(errors="ignore"))
        if not found:
            break
        links += [urljoin(site["home"], link) for link in found]
        time.sleep(pause)
    return [(link, "") for link in dict.fromkeys(links)]


def robots_rules(home: str) -> tuple[list[str], float]:
    """The sitemaps a site's robots.txt lists, and the pause it asks for."""
    robots = (get(home + "robots.txt") or b"").decode(errors="ignore")
    sitemaps = re.findall(r"(?im)^sitemap:\s*(\S+)", robots)
    delays = [float(d) for d in re.findall(r"(?im)^crawl-delay:\s*([\d.]+)", robots)]
    return sitemaps, max([PAUSE_SECONDS, *delays])


def page(url: str, pause: float) -> dict:
    cached = CACHE / (hashlib.sha1(url.encode()).hexdigest() + ".json")
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))
    time.sleep(pause)
    body = get(url)
    try:
        # The default balance, not favor_precision: on some sites precision picks
        # the consent banner over the article.
        document = trafilatura.bare_extraction(body.decode("utf-8", errors="replace"), with_metadata=True) if body else None
    except Exception as error:  # one broken page must not stop the site
        print(f"  skipped {url}: {error}")
        document = None
    if not document:
        return {}  # not cached, so a temporary failure is retried next run
    fields = document.as_dict()
    result = {key: fields.get(key) for key in ("title", "author", "date", "text")}
    cached.parent.mkdir(parents=True, exist_ok=True)
    cached.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")
    return result


def collect(site: dict) -> list[dict]:
    listed, pause = robots_rules(site["home"])
    if "feed" in site:
        entries = feed_entries(site["feed"], site["first_page"], pause)
    elif "listing" in site:
        entries = listing_entries(site, pause)
    else:
        entries = [entry for sitemap in site.get("sitemaps") or listed for entry in sitemap_entries(sitemap, pause)]
    host = urlparse(site["home"]).netloc
    domain = host.removeprefix("www.")
    # Pages without a date in the listing are kept for now and filtered by their own date.
    # Listings come newest first; a stable sort keeps that order where dates are missing.
    candidates = sorted(
        dict.fromkeys((url, date) for url, date in entries if urlparse(url).netloc.removeprefix("www.") == domain
                      and not SKIP.search(urlparse(url).path) and (not date or date >= SINCE)),
        key=lambda entry: entry[1],
        reverse=True,
    )[: site.get("max_pages", MAX_PAGES_PER_SITE)]
    items = []
    for url, _ in candidates:
        result = page(url, pause)
        date = result.get("date") or ""
        if date < SINCE:
            continue
        text = result.get("text") or ""
        if NOT_A_STATEMENT.search(text) or text.count("Weiterlesen") >= 2:
            continue
        paragraphs = [line.strip() for line in text.split("\n") if line.strip()]
        passages = pack([p for p in paragraphs if not BOILERPLATE.search(p)], MIN_PASSAGE_CHARS)
        if passages:
            items.append({
                "kind": site["kind"],
                "party": site["party"],
                # Page metadata names photographers as often as authors, so the
                # source is the fraction or party; press releases name the speaker in the text.
                "speaker": None,
                "role": None,
                "date": date,
                "source": domain,
                "title": result.get("title") or "",
                "url": url,
                "passages": passages,
            })
    print(f"{host}: {len(entries)} listed, {len(candidates)} fetched, {len(items)} pages kept (pause {pause:g} s)")
    return items


def collect_safely(site: dict) -> list[dict]:
    # One site failing costs that site, not the whole run; its pages stay cached.
    try:
        return collect(site)
    except Exception as error:
        print(f"{site['home']}: failed, {error!r}")
        return []


def main() -> None:
    with ThreadPoolExecutor(max_workers=len(SITES)) as pool:
        items = [item for site_items in pool.map(collect_safely, SITES) for item in site_items]
    # Fractions and parties often publish the same press release twice.
    unique = list({"\n".join(item["passages"]): item for item in items}.values())
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(unique, ensure_ascii=False), encoding="utf-8")
    counts = {party: sum(item["party"] == party for item in unique) for party in sorted({i["party"] for i in unique})}
    print(f"wrote {len(unique)} pages: {counts}")


if __name__ == "__main__":
    main()
