import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyIndices, sentencesOf } from '../js/excerpt.js';

test('key sentences are the closest ones, shown in reading order', () => {
  assert.deepEqual(keyIndices([0.1, 0.9, 0.2, 0.8]), [1, 3]);
});

test('sentences split at sentence ends, not at abbreviations in lower case', () => {
  assert.deepEqual(sentencesOf('Wir wollen z. B. mehr Wohnungen. Die Mieten sollen sinken!'), [
    'Wir wollen z. B. mehr Wohnungen.',
    'Die Mieten sollen sinken!',
  ]);
});

test('an ordinal does not end a sentence', () => {
  assert.equal(sentencesOf('Ab dem 1. Januar gilt das. Dann kommt mehr.').length, 2);
});

test('bullets start a new sentence and are dropped', () => {
  assert.deepEqual(sentencesOf('Wir wollen mehr Wohnungen. ✔ Wir fordern einen Mietendeckel ✔ Mieten einfrieren'), [
    'Wir wollen mehr Wohnungen.',
    'Wir fordern einen Mietendeckel',
    'Mieten einfrieren',
  ]);
});
