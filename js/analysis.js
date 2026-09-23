import { PARTIES } from './parties.js';

export const MODEL = '~typesafe/jev-latest';

// Shown to people as they are; Jev judges against the same wording.
export const LEVELS = [
  'Klarer Widerspruch',
  'Eher Widerspruch',
  'Teils, teils',
  'Eher Übereinstimmung',
  'Klare Übereinstimmung',
];

// Below this, a program is treated as silent on a topic rather than as
// disagreeing: Jev's match reading then says more about the excerpts we
// happened to find than about the party.
export const COVERED = 0.5;

/**
 * One request per topic: the opinion plus the closest passages of every
 * program. For each party Jev answers three narrow questions: how well the
 * program matches, whether it addresses the issue at all, and which passage
 * shows it best. Keys are namespaced by party (`spd_match`).
 */
export function buildTopicRequest(topic, opinion, passagesByParty) {
  const programs = Object.fromEntries(
    PARTIES.map(({ id, short }) => [
      short,
      passagesByParty[id].map(({ id: passageId, page, text }) => ({ id: passageId, page, text })),
    ]),
  );
  const questions = {};
  for (const { id, short } of PARTIES) {
    questions[`${id}_match`] = {
      type: 'score',
      instructions:
        `How well does the program of ${short} agree with the person's opinion? ` +
        `Judge only the ${short} excerpts, not what you know about the party. ` +
        'If they do not address the opinion, choose the middle level.',
      criteria: LEVELS,
    };
    questions[`${id}_covered`] = {
      type: 'noul',
      instructions: `The ${short} excerpts take a clear position on the specific issue in the person's opinion.`,
    };
    questions[`${id}_source`] = {
      type: 'choice',
      instructions: `Which ${short} excerpt best shows the party's position on the person's opinion?`,
      criteria: Object.fromEntries(passagesByParty[id].map((p) => [p.id, null])),
    };
  }
  return {
    model: MODEL,
    state: { person: { topic, opinion }, party_programs: programs },
    questions,
  };
}

const likeliest = (probabilities) =>
  Object.entries(probabilities).reduce((best, next) => (next[1] > best[1] ? next : best));

/** Per party: `{ match: 0–1, level, covered: 0–1, source: passage id }`. */
export function readTopic(answers) {
  return Object.fromEntries(
    PARTIES.map(({ id }) => {
      const match = answers[`${id}_match`];
      const topLevel = Object.keys(match.legend).length - 1;
      return [
        id,
        {
          match: match.score / topLevel,
          level: Math.round(match.score),
          covered: answers[`${id}_covered`].noul,
          source: likeliest(answers[`${id}_source`].probabilities)[0],
        },
      ];
    }),
  );
}

/**
 * A party's overall match across topics, 0–1, or null when its program is
 * silent on all of them. Topics count by how clearly the program addresses
 * them, so one well-covered topic outweighs several vague ones.
 */
export function overallMatch(readings) {
  let weighted = 0;
  let weight = 0;
  for (const { match, covered } of readings) {
    if (covered < COVERED) continue;
    weighted += covered * match;
    weight += covered;
  }
  return weight ? weighted / weight : null;
}
