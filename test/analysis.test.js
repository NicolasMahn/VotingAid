import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProgramRequest,
  buildVotesRequest,
  combinedScore,
  correctPersonVotes,
  diverges,
  levelOf,
  overallScore,
  readPartyAnswers,
  readPersonVotes,
  readVotes,
} from '../js/analysis.js';
import { closestPassages, loadIndex } from '../js/retrieval.js';
import { leanOf, positionOf } from '../js/votes.js';
import { PARTIES } from '../js/parties.js';

test('topics a party is silent on do not count towards its score', () => {
  assert.equal(overallScore([{ score: 1, covered: 0.9 }, { score: -1, covered: 0.2 }, null]), 1);
});

test('a party silent on every topic has no score rather than zero', () => {
  assert.equal(overallScore([{ score: 0, covered: 0.1 }]), null);
});

test('clearly addressed topics weigh more than vaguely addressed ones', () => {
  assert.equal(overallScore([{ score: 1, covered: 1 }, { score: -1, covered: 0.5 }]), 1 / 3);
});

test('every party gets a match, coverage and source question about its program', () => {
  const passages = Object.fromEntries(PARTIES.map(({ id }) => [id, [{ id: `${id}-0`, page: 1, text: 'x' }]]));
  const { questions } = buildProgramRequest('Rente', 'Die Rente soll steigen.', passages);
  assert.equal(Object.keys(questions).length, PARTIES.length * 3);
  assert.deepEqual(Object.keys(questions.spd_source.criteria), ['spd-0']);
});

test('answers are read back per party on a scale from -1 to 1, and absent parties read as null', () => {
  const answers = {
    fdp_match: { score: 3, legend: { 0: '', 1: '', 2: '', 3: '', 4: '' } },
    fdp_covered: { noul: 0.8 },
    fdp_source: { probabilities: { a: 0.3, b: 0.7 } },
  };
  const readings = readPartyAnswers(answers);
  assert.deepEqual(readings.fdp, { score: 0.5, covered: 0.8, sources: ['b'] });
  assert.equal(levelOf(readings.fdp.score), 3);
  assert.equal(readings.spd, null);
});

const vote = (id, results) => ({ id, date: '2025-06-01', title: id, description: 'x', accepted: true, results });

test('Jev judges votes without seeing how the parties voted', () => {
  const request = buildVotesRequest('Rente', 'Die Rente soll steigen.', [vote('vote-1', { spd: { yes: 100 } })]);
  assert.deepEqual(Object.keys(request.questions), ['vote-1']);
  assert.doesNotMatch(JSON.stringify(request.state), /results|100/);
});

test('parties that voted the same way get the same score, and parties that voted against get the opposite', () => {
  const votes = [
    vote('vote-1', { spd: { yes: 100 }, union: { yes: 180, no_show: 20 }, afd: { no: 120 }, linke: { abstain: 40 } }),
    vote('vote-2', { spd: { no: 100 }, union: { no: 200 }, afd: { yes: 120 } }),
  ];
  const person = readPersonVotes({
    'vote-1': { probabilities: { yes: 0.9, no: 0, bundled: 0.05, unrelated: 0.05 } },
    'vote-2': { probabilities: { yes: 0.02, no: 0.03, bundled: 0.05, unrelated: 0.9 } },
  });
  const readings = readVotes(person, votes);
  assert.deepEqual(readings.spd, readings.union);
  assert.equal(readings.spd.score, 1);
  assert.equal(readings.afd.score, -1);
  assert.equal(readings.linke.score, 0);
  // vote-2 does not decide the demand, so it neither counts nor shows as a source.
  assert.deepEqual(readings.spd.sources, ['vote-1']);
  assert.equal(readings.fdp, null);
});

test('a correction by the person overrides Jev, and a skipped vote no longer counts', () => {
  const votes = [vote('vote-1', { spd: { yes: 100 } }), vote('vote-2', { spd: { no: 100 } })];
  const person = { 'vote-1': { lean: 1, clarity: 0.9 }, 'vote-2': { lean: 1, clarity: 0.9 } };
  assert.equal(readVotes(person, votes).spd.score, 0);
  const corrected = correctPersonVotes(person, { 'vote-2': 'no', 'vote-9': 'yes' });
  assert.equal(readVotes(corrected, votes).spd.score, 1);
  assert.deepEqual(readVotes(correctPersonVotes(person, { 'vote-1': 'skip' }), votes).spd.sources, ['vote-2']);
  assert.equal(Object.hasOwn(corrected, 'vote-9'), false);
});

test('the overview averages the sources that say something', () => {
  assert.equal(combinedScore([1, null, 0]), 0.5);
  assert.equal(combinedScore([null, null]), null);
});

test('a party voting against its own program is flagged', () => {
  assert.equal(diverges({ score: 1, covered: 0.9 }, { score: -0.5, covered: 0.9 }), true);
  assert.equal(diverges({ score: 1, covered: 0.9 }, { score: -0.5, covered: 0.2 }), false);
});

test('a party vote is united only when three quarters vote the same way', () => {
  assert.equal(positionOf({ yes: 80, no: 20 }).stance, 'dafür');
  assert.equal(positionOf({ yes: 60, no: 40 }).stance, 'gespalten');
  assert.equal(positionOf({ no_show: 5 }), null);
  assert.equal(positionOf(undefined), null);
});

test('a split or abstaining party leans less than a united one', () => {
  assert.equal(leanOf({ yes: 60, no: 40 }), 0.2);
  assert.equal(leanOf({ abstain: 10 }), 0);
  assert.equal(leanOf({ no_show: 5 }), null);
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
