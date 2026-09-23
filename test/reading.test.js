import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_REPLY_LENGTH, axisScores, buildRequest, readAnswer } from '../js/reading.js';
import { STATEMENTS } from '../js/statements.js';

const certain = (level) => ({
  score: level,
  probabilities: Object.fromEntries([0, 1, 2, 3, 4].map((l) => [l, l === level ? 1 : 0])),
});

test('only statements with a reply are sent to Jev', () => {
  const body = buildRequest({ sapply_000: 'yes', sapply_001: '   ', sapply_002: '' });
  assert.deepEqual(Object.keys(body.questions), ['sapply_000']);
  assert.deepEqual(body.state.replies.map((r) => r.id), ['sapply_000']);
});

test('replies are sent with the statement in the language the person saw', () => {
  const body = buildRequest({ sapply_000: 'ja' }, 'de');
  assert.equal(body.state.replies[0].statement, STATEMENTS[0].de);
});

test('long replies are cut to the limit', () => {
  const body = buildRequest({ sapply_000: 'a'.repeat(MAX_REPLY_LENGTH + 50) });
  assert.equal(body.state.replies[0].reply.length, MAX_REPLY_LENGTH);
});

test('a certain answer maps onto the SapplyValues scale with no spread', () => {
  assert.deepEqual(readAnswer(certain(4)), { agreement: 1, variance: 0, likeliest: 4, probability: 1 });
  assert.equal(readAnswer(certain(1)).agreement, -0.5);
});

test('a split answer carries its uncertainty', () => {
  const reading = readAnswer({ score: 2.5, probabilities: { 0: 0, 1: 0, 2: 0.5, 3: 0.5, 4: 0 } });
  assert.equal(reading.agreement, 0.25);
  assert.equal(reading.variance, 0.0625);
});

test('agreeing with every right-wing statement scores fully right', () => {
  const readings = Object.fromEntries(
    STATEMENTS.filter((s) => s.effects.right).map((s) => [s.id, readAnswer(certain(s.effects.right > 0 ? 4 : 0))]),
  );
  const scores = axisScores(readings);
  assert.equal(scores.right.score, 10);
  assert.equal(scores.right.spread, 0);
  assert.equal(scores.auth, null);
});

test('skipped statements do not pull a score towards the centre', () => {
  const [first] = STATEMENTS.filter((s) => s.effects.auth === 1);
  const scores = axisScores({ [first.id]: readAnswer(certain(4)) });
  assert.equal(scores.auth.score, 10);
});
