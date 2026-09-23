// Finds the passages of each program closest to an opinion. The passages and
// their int8 embeddings come from scripts/build_programs.py; the opinion is
// embedded with the same model at the same size.
const ENDPOINT = 'https://openrouter.ai/api/v1/embeddings';

export const PASSAGES_PER_PARTY = 4;

/** Decodes data/programme.json into passages plus one vector per passage. */
export function loadIndex(programme) {
  const bytes = Uint8Array.from(atob(programme.vectors), (c) => c.charCodeAt(0));
  const all = new Int8Array(bytes.buffer);
  const { dimensions } = programme;
  const passages = programme.chunks.map((chunk, i) => {
    const vector = all.subarray(i * dimensions, (i + 1) * dimensions);
    return { ...chunk, id: `${chunk.party}-${i}`, vector, norm: Math.hypot(...vector) };
  });
  return { model: programme.model, dimensions, passages };
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

/** The closest passages of every party, as `{ [party]: passage[] }`. */
export function closestPassages(index, query, perParty = PASSAGES_PER_PARTY) {
  const queryNorm = Math.hypot(...query);
  const byParty = {};
  for (const passage of index.passages) {
    (byParty[passage.party] ??= []).push({ passage, score: similarity(query, queryNorm, passage) });
  }
  return Object.fromEntries(
    Object.entries(byParty).map(([party, scored]) => [
      party,
      scored
        .sort((a, b) => b.score - a.score)
        .slice(0, perParty)
        .map(({ passage }) => passage),
    ]),
  );
}
