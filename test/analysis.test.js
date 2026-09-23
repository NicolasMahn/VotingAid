import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTopicRequest, overallMatch, readTopic } from '../js/analysis.js';
import { closestPassages, loadIndex } from '../js/retrieval.js';
import { PARTIES } from '../js/parties.js';

test('programs that are silent on a topic do not count towards the match', () => {
  const readings = [
    { match: 1, covered: 0.9 },
    { match: 0, covered: 0.2 },
  ];
  assert.equal(overallMatch(readings), 1);
});

test('a party silent on every topic has no match rather than zero', () => {
  assert.equal(overallMatch([{ match: 0.5, covered: 0.1 }]), null);
});

test('clearly addressed topics weigh more than vaguely addressed ones', () => {
  const readings = [
    { match: 1, covered: 1 },
    { match: 0, covered: 0.5 },
  ];
  assert.equal(overallMatch(readings), 2 / 3);
});

test('every party gets a match, coverage and source question', () => {
  const passages = Object.fromEntries(PARTIES.map(({ id }) => [id, [{ id: `${id}-0`, page: 1, text: 'x' }]]));
  const { questions } = buildTopicRequest('Rente', 'Die Rente soll steigen.', passages);
  assert.equal(Object.keys(questions).length, PARTIES.length * 3);
  assert.deepEqual(Object.keys(questions.spd_source.criteria), ['spd-0']);
});

test('answers are read back per party', () => {
  const answers = {};
  for (const { id } of PARTIES) {
    answers[`${id}_match`] = { score: 3, legend: { 0: '', 1: '', 2: '', 3: '', 4: '' } };
    answers[`${id}_covered`] = { noul: 0.8 };
    answers[`${id}_source`] = { probabilities: { [`${id}-0`]: 0.3, [`${id}-1`]: 0.7 } };
  }
  assert.deepEqual(readTopic(answers).fdp, { match: 0.75, level: 3, covered: 0.8, source: 'fdp-1' });
});

test('retrieval returns the closest passages of each party', () => {
  const vectors = Int8Array.from([127, 0, 0, 127, 90, 90]);
  const index = loadIndex({
    model: 'test',
    dimensions: 2,
    chunks: [
      { party: 'spd', page: 1, text: 'a' },
      { party: 'spd', page: 2, text: 'b' },
      { party: 'fdp', page: 3, text: 'c' },
    ],
    vectors: Buffer.from(vectors.buffer).toString('base64'),
  });
  const closest = closestPassages(index, [0, 1], 1);
  assert.equal(closest.spd[0].page, 2);
  assert.equal(closest.fdp[0].page, 3);
});
