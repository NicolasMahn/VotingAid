import { QUERY_MODEL } from './retrieval.js';

// The statements database (data/aussagen/, built by scripts/build_statements.py)
// is too large to load whole. The browser loads a compact index up front, one
// party byte and one binary vector per document, finds the closest documents
// by Hamming distance, and only then fetches their shards.

export const DOCS_PER_PARTY = 3;
const BASE = 'data/aussagen/';

const POPCOUNT = Uint8Array.from({ length: 256 }, (_, byte) => byte.toString(2).replaceAll('0', '').length);

export async function loadStatements() {
  const [meta, buffer] = await Promise.all([
    fetch(`${BASE}index.json`).then((response) => response.json()),
    fetch(`${BASE}index.bin`).then((response) => response.arrayBuffer()),
  ]);
  if (meta.model !== QUERY_MODEL) throw new Error(`${meta.model} was built with a different model`);
  return { meta, index: new Uint8Array(buffer) };
}

/** One bit per dimension, set where the value is positive, first dimension first. */
export function toBits(vector) {
  const bits = new Uint8Array(vector.length / 8);
  vector.forEach((value, i) => {
    if (value > 0) bits[i >> 3] |= 1 << (7 - (i & 7));
  });
  return bits;
}

/** The numbers of the `perParty` documents closest to `query`, per party id. */
export function closestDocuments({ meta, index }, query, perParty = DOCS_PER_PARTY) {
  const bits = toBits(query.slice(0, meta.dimensions));
  const stride = 1 + bits.length;
  const byParty = {};
  for (let number = 0; number < meta.count; number++) {
    const offset = number * stride;
    let distance = 0;
    for (let i = 0; i < bits.length; i++) distance += POPCOUNT[bits[i] ^ index[offset + 1 + i]];
    (byParty[meta.parties[index[offset]]] ??= []).push({ number, distance });
  }
  return Object.fromEntries(
    Object.entries(byParty).map(([party, scored]) => [
      party,
      scored
        .sort((a, b) => a.distance - b.distance)
        .slice(0, perParty)
        .map(({ number }) => number),
    ]),
  );
}

/** The documents with these numbers, fetching each shard once. */
export async function loadDocuments({ meta }, numbers) {
  const shards = [...new Set(numbers.map((number) => Math.floor(number / meta.shardSize)))];
  const loaded = await Promise.all(shards.map((shard) => fetch(`${BASE}docs/${shard}.json`).then((r) => r.json())));
  const byId = new Map(loaded.flat().map((doc) => [doc.id, doc]));
  return new Map(numbers.map((number) => [number, byId.get(`s${number}`)]));
}

/** The passage of a document closest to `query`, using its int8 passage vectors. */
export function closestPassage({ meta }, doc, query) {
  const size = meta.passageDimensions;
  const short = query.slice(0, size);
  const vectors = new Int8Array(Uint8Array.from(atob(doc.vectors), (c) => c.charCodeAt(0)).buffer);
  let best = 0;
  let bestScore = -Infinity;
  doc.passages.forEach((_, p) => {
    const vector = vectors.subarray(p * size, (p + 1) * size);
    let dot = 0;
    for (let i = 0; i < size; i++) dot += short[i] * vector[i];
    const score = dot / Math.hypot(...vector);
    if (score > bestScore) [best, bestScore] = [p, score];
  });
  return doc.passages[best];
}
