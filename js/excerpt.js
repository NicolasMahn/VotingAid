import { cosine, embedTexts } from './retrieval.js';

// Passages run to about 1,000 characters. The page shows the sentences
// closest to the person's opinion first, word for word, rather than a
// generated summary that could put words in a party's mouth.

const KEY_SENTENCES = 2;

// A sentence ends after a word of two or more letters, so "z. B." does not
// end one; ordinals like "1. Januar" do not either. Bullets, common in
// programs, start a new one and are dropped.
const SENTENCE_END = /(?<=\p{L}{2}[.!?]|[)"“”][.!?])\s+(?=[A-ZÄÖÜ„])|\s*[✔✓•●▪]\s*/u;

/** A passage split into sentences. */
export const sentencesOf = (text) => text.split(SENTENCE_END).filter(Boolean);

/** The indices of the `count` highest scores, in reading order. */
export function keyIndices(scores, count = KEY_SENTENCES) {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, count)
    .map(({ index }) => index)
    .sort((a, b) => a - b);
}

/** `{ sentences, key }`: the passage's sentences and which of them to show first. */
export async function excerpt(apiKey, query, text) {
  const sentences = sentencesOf(text);
  if (sentences.length <= KEY_SENTENCES) return { sentences, key: sentences.map((_, i) => i) };
  const vectors = await embedTexts(apiKey, sentences);
  return { sentences, key: keyIndices(vectors.map((vector) => cosine(query, vector))) };
}
