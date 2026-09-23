import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildProgramRequest, buildVotesRequest, diverges, overallMatch, readTopic } from '../js/analysis.js';
import { closestPassages, loadIndex } from '../js/retrieval.js';
import { positionOf } from '../js/votes.js';
import { PARTIES } from '../js/parties.js';

test('topics a party is silent on do not count towards its match', () => {
  assert.equal(overallMatch([{ match: 1, covered: 0.9 }, { match: 0, covered: 0.2 }, null]), 1);
});

test('a party silent on every topic has no match rather than zero', () => {
  assert.equal(overallMatch([{ match: 0.5, covered: 0.1 }]), null);
});

test('clearly addressed topics weigh more than vaguely addressed ones', () => {
  assert.equal(overallMatch([{ match: 1, covered: 1 }, { match: 0, covered: 0.5 }]), 2 / 3);
});

test('every party gets a match, coverage and source question about its program', () => {
  const passages = Object.fromEntries(PARTIES.map(({ id }) => [id, [{ id: `${id}-0`, page: 1, text: 'x' }]]));
  const { questions } = buildProgramRequest('Rente', 'Die Rente soll steigen.', passages);
  assert.equal(Object.keys(questions).length, PARTIES.length * 3);
  assert.deepEqual(Object.keys(questions.spd_source.criteria), ['spd-0']);
});

test('parties that did not vote are not asked about votes', () => {
  const vote = {
    id: 'vote-1',
    date: '2025-06-01',
    title: 'Gesetz',
    description: 'x',
    accepted: true,
    results: { spd: { yes: 100 }, fdp: { no_show: 3 } },
  };
  const { questions } = buildVotesRequest('Rente', 'Die Rente soll steigen.', [vote]);
  assert.deepEqual(Object.keys(questions), ['spd_match', 'spd_covered', 'spd_source']);
});

test('answers are read back per party, and absent parties read as null', () => {
  const answers = {
    fdp_match: { score: 3, legend: { 0: '', 1: '', 2: '', 3: '', 4: '' } },
    fdp_covered: { noul: 0.8 },
    fdp_source: { probabilities: { a: 0.3, b: 0.7 } },
  };
  const readings = readTopic(answers);
  assert.deepEqual(readings.fdp, { match: 0.75, level: 3, covered: 0.8, source: 'b' });
  assert.equal(readings.spd, null);
});

test('a party voting against its own program is flagged', () => {
  assert.equal(diverges({ match: 1, covered: 0.9 }, { match: 0.25, covered: 0.9 }), true);
  assert.equal(diverges({ match: 1, covered: 0.9 }, { match: 0.25, covered: 0.2 }), false);
});

test('a party vote is united only when three quarters vote the same way', () => {
  assert.equal(positionOf({ yes: 80, no: 20 }).stance, 'dafür');
  assert.equal(positionOf({ yes: 60, no: 40 }).stance, 'gespalten');
  assert.equal(positionOf({ no_show: 5 }), null);
  assert.equal(positionOf(undefined), null);
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
