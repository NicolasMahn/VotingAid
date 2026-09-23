import { STATEMENTS } from './statements.js';

export const MODEL = '~typesafe/jev-latest';

// Jev allows about 32k tokens of state. 46 replies at this length stay well
// below that, and nobody needs more to say where they stand.
export const MAX_REPLY_LENGTH = 600;

// The SapplyValues answer scale. Jev returns a score from 0 to 4 on it, which
// we map to -1…1 like the original quiz.
const LEVELS = ['Strongly disagree', 'Disagree', 'Neutral or unsure', 'Agree', 'Strongly agree'];
const CENTER = (LEVELS.length - 1) / 2;

const toAgreement = (level) => (level - CENTER) / CENTER;

/**
 * One request for every statement the person replied to. Skipped statements
 * are left out entirely, so they cannot pull a score towards neutral.
 * `replies` maps statement ids to text; `language` picks the wording the
 * person saw, so Jev reads the reply against the same sentence.
 */
export function buildRequest(replies, language = 'en') {
  const answered = STATEMENTS.filter((s) => replies[s.id]?.trim());
  const questions = Object.fromEntries(
    answered.map((s) => [
      s.id,
      {
        type: 'score',
        instructions:
          `How strongly does the person agree with statement ${s.id} ("${s.en}")? ` +
          'Judge only their own reply to that statement, not your views and not their other replies.',
        criteria: LEVELS,
      },
    ]),
  );
  const state = {
    replies: answered.map((s) => ({
      id: s.id,
      statement: s[language],
      reply: replies[s.id].trim().slice(0, MAX_REPLY_LENGTH),
    })),
  };
  return { model: MODEL, state, questions };
}

/**
 * Turns one Score answer into an agreement from -1 to 1, plus how unsure Jev
 * is about it (the variance of its probabilities on that same scale).
 */
export function readAnswer(answer) {
  const agreement = toAgreement(answer.score);
  const levels = Object.entries(answer.probabilities).map(([level, p]) => [Number(level), p]);
  const variance = levels.reduce((sum, [level, p]) => sum + p * (toAgreement(level) - agreement) ** 2, 0);
  const [likeliest, probability] = levels.reduce((best, next) => (next[1] > best[1] ? next : best));
  return { agreement, variance, likeliest, probability };
}

/**
 * Axis scores from -10 to 10, computed like SapplyValues, but only over the
 * statements that were answered. The spread treats each reading as
 * independent, so it shows how sure Jev is of what you wrote, not how
 * consistent your views are.
 */
export function axisScores(readings) {
  const totals = {};
  for (const statement of STATEMENTS) {
    const reading = readings[statement.id];
    if (!reading) continue;
    for (const [axis, effect] of Object.entries(statement.effects)) {
      const t = (totals[axis] ??= { sum: 0, weight: 0, variance: 0 });
      t.sum += reading.agreement * effect;
      t.weight += Math.abs(effect);
      t.variance += reading.variance * effect ** 2;
    }
  }
  return Object.fromEntries(
    ['right', 'auth', 'prog'].map((axis) => {
      const t = totals[axis];
      if (!t) return [axis, null];
      return [axis, { score: (10 * t.sum) / t.weight, spread: (10 * Math.sqrt(t.variance)) / t.weight }];
    }),
  );
}

export function readAnswers(answers) {
  return Object.fromEntries(Object.entries(answers).map(([id, answer]) => [id, readAnswer(answer)]));
}
