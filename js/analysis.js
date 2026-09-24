import { PARTIES } from './parties.js';
import { describePosition, positionOf } from './votes.js';

export const MODEL = '~typesafe/jev-latest';

// Shown to people as they are; Jev judges against the same wording.
export const LEVELS = [
  'Klarer Widerspruch',
  'Eher Widerspruch',
  'Teils, teils',
  'Eher Übereinstimmung',
  'Klare Übereinstimmung',
];

// Below this, a party is treated as silent on a topic rather than as
// disagreeing: Jev's match reading then says more about the excerpts we
// happened to find than about the party.
export const COVERED = 0.5;

// How far apart, on a 0–1 scale, program and votes must be to be flagged.
const DIVERGENCE = 0.5;

// Vote descriptions are written for the web and can run long.
const DESCRIPTION_CHARS = 1200;

// Programs and votes are judged in separate requests, so one cannot colour
// the reading of the other. For each party Jev answers three narrow
// questions: how well the evidence matches the opinion, whether it addresses
// the issue at all, and which excerpt or vote shows it best. Keys are
// namespaced by party (`spd_match`) so readTopic can split them back out.
function partyQuestions(short, evidence, candidates, coverage) {
  return {
    match: {
      type: 'score',
      instructions:
        `How well does ${evidence(short)} agree with the person's opinion? ` +
        'Judge only the material provided, not what you know about the party. ' +
        'If it does not address the opinion, choose the middle level.',
      criteria: LEVELS,
    },
    covered: {
      type: 'noul',
      instructions: coverage(short, evidence(short)),
    },
    source: {
      type: 'choice',
      instructions: `Which item best shows the position of ${short} on the person's opinion?`,
      criteria: Object.fromEntries(candidates.map((id) => [id, null])),
    },
  };
}

const takesClearPosition = (short, evidence) =>
  `${evidence} takes a clear position on the specific issue in the person's opinion.`;

function questionsFor(evidence, candidatesOf, coverage = takesClearPosition) {
  const questions = {};
  for (const { id, short } of PARTIES) {
    const candidates = candidatesOf(id);
    if (!candidates.length) continue;
    for (const [key, question] of Object.entries(partyQuestions(short, evidence, candidates, coverage))) {
      questions[`${id}_${key}`] = question;
    }
  }
  return questions;
}

/** The opinion plus the closest program passages of every party. */
export function buildProgramRequest(topic, opinion, passagesByParty) {
  const programs = Object.fromEntries(
    PARTIES.map(({ id, short }) => [short, passagesByParty[id].map(({ id: key, page, text }) => ({ id: key, page, text }))]),
  );
  return {
    model: MODEL,
    state: { person: { topic, opinion }, party_programs: programs },
    questions: questionsFor(
      (short) => `the program of ${short}, judged from its excerpts`,
      (party) => passagesByParty[party].map((passage) => passage.id),
    ),
  };
}

/**
 * The opinion plus the closest roll-call votes and how each party voted.
 * Parties are only asked about if they voted in at least one of them.
 */
export function buildVotesRequest(topic, opinion, votes) {
  const roll_call_votes = votes.map((vote) => ({
    id: vote.id,
    date: vote.date,
    title: vote.title,
    description: vote.description.slice(0, DESCRIPTION_CHARS),
    passed: vote.accepted,
    how_parties_voted: Object.fromEntries(
      PARTIES.map(({ id, short }) => [short, describePosition(positionOf(vote.results[id]))]),
    ),
  }));
  return {
    model: MODEL,
    state: {
      person: { topic, opinion },
      // Many votes are on a committee's recommendation to reject a motion,
      // where voting for it means voting against the motion itself.
      how_to_read:
        'A party voting "dafür" supports what the vote title says. If the title starts with ' +
        '"Ablehnung", voting "dafür" means rejecting the motion it names.',
      roll_call_votes,
    },
    questions: questionsFor(
      (short) => `how ${short} voted in these Bundestag roll-call votes`,
      (party) => votes.filter((vote) => positionOf(vote.results[party])).map((vote) => vote.id),
    ),
  };
}

export const STATEMENT_KINDS = {
  rede: 'Rede im Bundestag',
  fraktion: 'Website der Bundestagsfraktion',
  partei: 'Website der Bundespartei',
};

/**
 * The opinion plus, per party, the closest passages from speeches and the
 * fraction's and party's websites. `statementsByParty` maps party ids to
 * `{ doc, passage }` pairs.
 */
export function buildStatementsRequest(topic, opinion, statementsByParty) {
  const statements = Object.fromEntries(
    PARTIES.map(({ id, short }) => [
      short,
      (statementsByParty[id] ?? []).map(({ doc, passage }) => ({
        id: doc.id,
        kind: STATEMENT_KINDS[doc.kind],
        speaker: [doc.speaker, doc.role].filter(Boolean).join(', ') || null,
        date: doc.date,
        context: doc.title,
        text: passage,
      })),
    ]),
  );
  return {
    model: MODEL,
    state: {
      person: { topic, opinion },
      how_to_read:
        'Statements by individual politicians do not always match the party line. ' +
        'Speeches often argue against another party; judge what the speaker wants, not what they attack.',
      statements,
    },
    questions: questionsFor(
      (short) => `what politicians and official channels of ${short} have said in these statements`,
      (party) => (statementsByParty[party] ?? []).map(({ doc }) => doc.id),
      // Speeches often state a position by rebutting the other side rather than directly.
      (short, evidence) =>
        `${evidence} makes clear where ${short} stands on the issue in the person's opinion, ` +
        'either directly or by rejecting the opposite view.',
    ),
  };
}

const likeliest = (probabilities) =>
  Object.entries(probabilities).reduce((best, next) => (next[1] > best[1] ? next : best));

/**
 * Per party: `{ match: 0–1, level, covered: 0–1, source: item id }`, or null
 * when the party was not asked about (it did not take part in any vote).
 */
export function readTopic(answers) {
  return Object.fromEntries(
    PARTIES.map(({ id }) => {
      const match = answers[`${id}_match`];
      if (!match) return [id, null];
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

export const isCovered = (reading) => reading && reading.covered >= COVERED;

/**
 * A party's overall match across topics, 0–1, or null when it is silent on
 * all of them. Topics count by how clearly they are addressed, so one clear
 * topic outweighs several vague ones.
 */
export function overallMatch(readings) {
  let weighted = 0;
  let weight = 0;
  for (const reading of readings.filter(isCovered)) {
    weighted += reading.covered * reading.match;
    weight += reading.covered;
  }
  return weight ? weighted / weight : null;
}

/** Whether a party votes clearly differently from what its program says. */
export function diverges(program, votes) {
  return isCovered(program) && isCovered(votes) && Math.abs(program.match - votes.match) >= DIVERGENCE;
}
