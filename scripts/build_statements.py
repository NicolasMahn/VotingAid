#!/usr/bin/env python3
"""Turns speeches and web pages into the statements database in data/aussagen/.

The unit of search is a document: one speaker's turn in a debate, or one web
page. The browser preloads a compact index (one party byte and one binary
vector per document), finds the closest documents per party by Hamming
distance, then fetches only their shards and picks the closest passage within
each using small int8 vectors.

Every passage is embedded once at DIMENSIONS; a document's vector is the mean
of its passages. OpenAI's v3 embeddings can be shortened by truncating and
renormalising, so the passage vectors are cut to PASSAGE_DIMENSIONS and the
browser does the same with the query. Embeddings are cached in
.cache/embeddings.sqlite, so a rerun only pays for new text.

    python3 scripts/build_statements.py
"""

from __future__ import annotations

import base64
import hashlib
import json
import math
import shutil
import sqlite3
import struct
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from embeddings import api_key, embed_batch

ROOT = Path(__file__).resolve().parent.parent
SOURCES = [ROOT / ".cache" / "aussagen" / "reden.json", ROOT / ".cache" / "aussagen" / "web.json"]
OUT = ROOT / "data" / "aussagen"
DB = ROOT / ".cache" / "embeddings.sqlite"

# Must match js/statements.js.
MODEL = "voyageai/voyage-4-large"
DIMENSIONS = 1024
PASSAGE_DIMENSIONS = 256
SHARD_SIZE = 10
PARTIES = ["afd", "bsw", "fdp", "gruene", "linke", "spd", "union"]

BATCH = 100
WORKERS = 4


def cached_embeddings(texts: list[str]) -> dict[str, list[float]]:
    db = sqlite3.connect(DB)
    db.execute("create table if not exists embeddings (key text primary key, vector blob)")
    key_of = {text: hashlib.sha1(f"{MODEL}|{DIMENSIONS}|{text}".encode()).hexdigest() for text in texts}
    found = {}
    for key, blob in db.execute("select key, vector from embeddings"):
        found[key] = blob
    missing = [text for text in dict.fromkeys(texts) if key_of[text] not in found]
    print(f"{len(texts) - len(missing)} passages cached, embedding {len(missing)}")

    key = api_key()
    batches = [missing[i : i + BATCH] for i in range(0, len(missing), BATCH)]

    def run(batch: list[str]) -> list[tuple[str, bytes]]:
        vectors = embed_batch(batch, key, MODEL, DIMENSIONS)
        return [(key_of[text], struct.pack(f"{DIMENSIONS}f", *vector)) for text, vector in zip(batch, vectors)]

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for done, rows in enumerate(pool.map(run, batches), start=1):
            db.executemany("insert or replace into embeddings values (?, ?)", rows)
            db.commit()
            found.update(rows)
            if done % 20 == 0 or done == len(batches):
                print(f"  {done} / {len(batches)} batches")
    db.close()
    return {text: struct.unpack(f"{DIMENSIONS}f", found[key_of[text]]) for text in texts}


def normalised(vector) -> list[float]:
    length = math.sqrt(sum(x * x for x in vector)) or 1
    return [x / length for x in vector]


def to_bits(vector) -> bytes:
    bits = bytearray(len(vector) // 8)
    for i, x in enumerate(vector):
        if x > 0:
            bits[i // 8] |= 1 << (7 - i % 8)
    return bytes(bits)


def to_int8(vector) -> bytes:
    scale = 127 / (max(abs(x) for x in vector) or 1)
    return bytes(round(x * scale) & 0xFF for x in vector)


def main() -> None:
    docs = [doc for path in SOURCES if path.exists() for doc in json.loads(path.read_text(encoding="utf-8"))]
    docs = [doc for doc in docs if doc["party"] in PARTIES]
    docs.sort(key=lambda doc: doc["date"], reverse=True)
    vectors = cached_embeddings([text for doc in docs for text in doc["passages"]])

    shutil.rmtree(OUT, ignore_errors=True)
    (OUT / "docs").mkdir(parents=True)
    index = bytearray()
    shard = []
    for number, doc in enumerate(docs):
        passage_vectors = [vectors[text] for text in doc["passages"]]
        mean = normalised([sum(column) / len(passage_vectors) for column in zip(*passage_vectors)])
        index += bytes([PARTIES.index(doc["party"])]) + to_bits(mean)
        short = b"".join(to_int8(normalised(v[:PASSAGE_DIMENSIONS])) for v in passage_vectors)
        shard.append({**doc, "id": f"s{number}", "vectors": base64.b64encode(short).decode()})
        if len(shard) == SHARD_SIZE or number == len(docs) - 1:
            (OUT / "docs" / f"{number // SHARD_SIZE}.json").write_text(
                json.dumps(shard, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
            )
            shard = []

    (OUT / "index.bin").write_bytes(bytes(index))
    dates = sorted(doc["date"] for doc in docs)
    meta = {
        "model": MODEL,
        "dimensions": DIMENSIONS,
        "passageDimensions": PASSAGE_DIMENSIONS,
        "shardSize": SHARD_SIZE,
        "parties": PARTIES,
        "count": len(docs),
        "from": dates[0],
        "to": dates[-1],
        "counts": {kind: sum(doc["kind"] == kind for doc in docs) for kind in ("rede", "fraktion", "partei")},
    }
    (OUT / "index.json").write_text(json.dumps(meta, ensure_ascii=False, indent=1), encoding="utf-8")
    size = sum(f.stat().st_size for f in OUT.rglob("*") if f.is_file())
    print(f"wrote {len(docs)} documents to {OUT.relative_to(ROOT)} ({size / 1e6:.0f} MB, index {len(index) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
