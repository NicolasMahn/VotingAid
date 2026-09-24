"""Embedding helpers shared by the build scripts. The defaults must match
js/retrieval.js; build_statements.py uses its own model and size."""

from __future__ import annotations

import base64
import json
import os
import urllib.request

EMBEDDING_MODEL = "voyageai/voyage-4-large"
DIMENSIONS = 512
BATCH = 100


def api_key() -> str:
    return os.environ.get("OPENROUTER_API_KEY") or os.environ["OPEN_ROUTER_KEY"]


def embed_batch(texts: list[str], key: str, model: str = EMBEDDING_MODEL, dimensions: int = DIMENSIONS) -> list[list[float]]:
    request = urllib.request.Request(
        "https://openrouter.ai/api/v1/embeddings",
        data=json.dumps({"model": model, "input": texts, "dimensions": dimensions}).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        data = json.load(response)["data"]
    return [item["embedding"] for item in sorted(data, key=lambda item: item["index"])]


def _quantise(vector: list[float]) -> bytes:
    # Cosine similarity ignores length, so each vector can use its own scale.
    scale = 127 / max(abs(x) for x in vector)
    return bytes(round(x * scale) & 0xFF for x in vector)


def embed_all(texts: list[str]) -> str:
    """All embeddings as one base64 string of int8 vectors, in input order."""
    key = api_key()
    vectors = bytearray()
    for start in range(0, len(texts), BATCH):
        for vector in embed_batch(texts[start : start + BATCH], key):
            vectors += _quantise(vector)
        print(f"embedded {min(start + BATCH, len(texts))} / {len(texts)}")
    return base64.b64encode(bytes(vectors)).decode()


def index_file(items: list[dict], texts: list[str]) -> dict:
    """The shape js/retrieval.js loads: items plus one vector per item."""
    return {"model": EMBEDDING_MODEL, "dimensions": DIMENSIONS, "chunks": items, "vectors": embed_all(texts)}
