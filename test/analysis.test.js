import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMatchRequest,
  buildRelevanceRequest,
  buildVotesRequest,
  combinedScore,
  diverges,
  levelOf,
  overallScore,
  evidenceOf,
  readPartyAnswers,
  readPersonVotes,
  readVotes,
  relevantEvidence,
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

const passages = Object.fromEntries(
  PARTIES.map(({ id }) => [id, [{ id: `${id}-0`, page: 1, text: 'x' }, { id: `${id}-1`, page: 2, text: 'y' }]]),
);

test('first, every program excerpt is checked on its own for whether it addresses the demand', () => {
  const { questions } = buildRelevanceRequest('program', 'Rente', 'Die Rente soll steigen.', evidenceOf('program', passages));
  assert.equal(Object.keys(questions).length, PARTIES.length * 2);
  assert.equal(questions['spd-0'].type, 'noul');
});

test('only excerpts that address the demand are judged, and parties without any are not asked about', () => {
  const relevant = relevantEvidence(evidenceOf('program', passages), {
    'spd-0': { noul: 0.9 },
    'spd-1': { noul: 0.2 },
    'afd-0': { noul: 0.7 },
    'afd-1': { noul: 0.6 },
  });
  const { state, questions } = buildMatchRequest('program', 'Rente', 'Die Rente soll steigen.', relevant);
  assert.deepEqual(state.items.SPD.map(({ id }) => id), ['spd-0']);
  // One item needs no choice of source.
  assert.deepEqual(Object.keys(questions).sort(), ['afd_match', 'afd_source', 'spd_match']);

  const answers = {
    spd_match: { score: 3, legend: { 0: '', 1: '', 2: '', 3: '', 4: '' } },
    afd_match: { score: 0, legend: { 0: '', 1: '', 2: '', 3: '', 4: '' } },
    afd_source: { probabilities: { 'afd-0': 0.3, 'afd-1': 0.7 } },
  };
  const readings = readPartyAnswers(answers, relevant);
  assert.deepEqual(readings.spd, { score: 0.5, covered: 0.9, sources: ['spd-0'] });
  assert.deepEqual(readings.afd, { score: -1, covered: 0.7, sources: ['afd-1'] });
  assert.equal(levelOf(readings.spd.score), 3);
  assert.equal(readings.fdp, null);
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

test('sources are averaged by their weight, and silent or switched-off sources do not count', () => {
  const weights = { program: 1, votes: 2, statements: 1 };
  assert.equal(combinedScore({ program: 1, votes: -0.5, statements: null }, weights), 0);
  assert.equal(combinedScore({ program: 1, votes: -1, statements: null }, { ...weights, votes: 0 }), 1);
  assert.equal(combinedScore({ program: null, votes: null, statements: null }, weights), null);
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
