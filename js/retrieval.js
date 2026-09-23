// Finds the program passages and Bundestag votes closest to an opinion. Both
// files and their int8 embeddings come from scripts/; the opinion is embedded
// with the same model at the same size.
const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

export const PASSAGES_PER_PARTY = 4;
export const VOTES_PER_TOPIC = 4;

/** Decodes a data/*.json file into its items plus one vector per item. */
export function loadIndex(file) {
  const bytes = Uint8Array.from(atob(file.vectors), (c) => c.charCodeAt(0));
  const all = new Int8Array(bytes.buffer);
  const { dimensions } = file;
  const items = file.chunks.map((chunk, i) => {
    const vector = all.subarray(i * dimensions, (i + 1) * dimensions);
    return { id: `${chunk.party}-${i}`, ...chunk, vector, norm: Math.hypot(...vector) };
  });
  return { model: file.model, dimensions, items };
}

export async function embed(apiKey, index, text) {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: index.model, input: text, dimensions: index.dimensions }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error?.message ?? response.statusText);
  return payload.data[0].embedding;
}

function similarity(query, queryNorm, passage) {
  let dot = 0;
  for (let i = 0; i < query.length; i++) dot += query[i] * passage.vector[i];
  return dot / (queryNorm * passage.norm);
}

/** The `count` items closest to `query`, closest first. */
export function closest(items, query, count) {
  const queryNorm = Math.hypot(...query);
  return items
    .map((item) => ({ item, score: similarity(query, queryNorm, item) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ item }) => item);
}

/** The closest passages of every party, as `{ [party]: passage[] }`. */
export function closestPassages(index, query, perParty = PASSAGES_PER_PARTY) {
  const byParty = Object.groupBy(index.items, (passage) => passage.party);
  return Object.fromEntries(
    Object.entries(byParty).map(([party, passages]) => [party, closest(passages, query, perParty)]),
  );
}
