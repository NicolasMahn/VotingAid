import { PARTIES } from './parties.js';
import { leanOf } from './votes.js';

export const MODEL = '~typesafe/jev-latest';

// Every reading places a party on one scale, from -1 (it wants the opposite of
// what the person demands) to +1 (it wants the same). The page shows it as -10
// to +10, and in words by LEVELS, from contradiction to agreement.
export const LEVELS = [
  'Klarer Widerspruch',
  'Eher Widerspruch',
  'Teils, teils',
  'Eher Übereinstimmung',
  'Klare Übereinstimmung',
];
// What Jev judges programs and statements against. Bare labels left it free to
// read "Eher Widerspruch" as a weak verdict on a tangential remark.
const LEVEL_MEANINGS = [
  'Clear contradiction: the party clearly wants the opposite of what the person demands',
  'Leaning against: the party tends to oppose what the person demands',
  'Mixed: the party agrees in part, is ambivalent, or the material does not settle it',
  'Leaning towards: the party tends to support what the person demands',
  'Clear agreement: the party clearly wants what the person demands',
];

export const levelOf = (score) => Math.round(((score + 1) / 2) * (LEVELS.length - 1));

// Below this, a party is treated as silent on a topic rather than as
// disagreeing: its score then says more about the excerpts we happened to
// find than about the party.
export const COVERED = 0.5;

// How far apart program and votes must be to be flagged: a whole level of
// the five either side, e.g. "Eher Übereinstimmung" against "Eher Widerspruch".
const DIVERGENCE = 1;

// Vote descriptions are written for the web and can run long.
const DESCRIPTION_CHARS = 1200;

// Programs and statements are judged in two steps. First Jev checks, item by
// item and without judging agreement, whether an excerpt says anything about
// the person's specific demand. Only the excerpts that do are then shown to
// Jev to place the party. Judging agreement on excerpts that merely share the
// topic gave confident scores for parties that had said nothing to the point.

export const STATEMENT_KINDS = {
  rede: 'Rede im Bundestag',
  fraktion: 'Website der Bundestagsfraktion',
  partei: 'Website der Bundespartei',
};

// Each source as items per party id, in the shape Jev sees them.
const SOURCES = {
  program: {
    items: (passagesByParty) =>
      mapParties((id) => (passagesByParty[id] ?? []).map(({ id: key, page, text }) => ({ id: key, page, text }))),
    evidence: (short) => `the program of ${short}, judged from its excerpts`,
    howToRead: 'Excerpts from each party\'s program for the Bundestagswahl 2025.',
  },
  statements: {
    items: (statementsByParty) =>
      mapParties((id) =>
        (statementsByParty[id] ?? []).map(({ doc, passage }) => ({
          id: doc.id,
          kind: STATEMENT_KINDS[doc.kind],
          speaker: [doc.speaker, doc.role].filter(Boolean).join(', ') || null,
          date: doc.date,
          context: doc.title,
          text: passage,
        })),
      ),
    evidence: (short) => `what politicians and official channels of ${short} have said in these statements`,
    howToRead:
      'Statements by individual politicians do not always match the party line. ' +
      'Speeches often argue against another party; judge what the speaker wants, not what they attack.',
  },
};

const mapParties = (itemsOf) => Object.fromEntries(PARTIES.map(({ id }) => [id, itemsOf(id)]));
const byShortName = (itemsByParty) => Object.fromEntries(PARTIES.map(({ id, short }) => [short, itemsByParty[id] ?? []]));

/** The source's items for Jev, per party id. `source` is 'program' or 'statements'. */
export const evidenceOf = (source, found) => SOURCES[source].items(found);

/** Step one: per item, whether it addresses the person's specific demand at all. */
export function buildRelevanceRequest(source, topic, opinion, evidence) {
  const questions = {};
  for (const { id, short } of PARTIES) {
    for (const item of evidence[id]) {
      questions[item.id] = {
        type: 'noul',
        instructions:
          `Does item ${item.id} say what ${short} wants on the person's specific demand: for it, against it, ` +
          'or another way to the same end? Rejecting the opposite view counts. Sharing the wider topic ' +
          'does not, nor does a question or a remark in passing. Do not judge whether the party agrees ' +
          'with the person, only whether the item speaks to the demand.',
      };
    }
  }
  return {
    model: MODEL,
    state: { person: { topic, opinion }, how_to_read: SOURCES[source].howToRead, items: byShortName(evidence) },
    questions,
  };
}

/** The items that address the demand, per party id, each with its `relevance`. */
export function relevantEvidence(evidence, answers) {
  return mapParties((id) =>
    evidence[id]
      .map((item) => ({ ...item, relevance: answers[item.id]?.noul ?? 0 }))
      .filter(({ relevance }) => relevance >= COVERED),
  );
}

/** Step two: where each party stands, judged only from its relevant items. */
export function buildMatchRequest(source, topic, opinion, relevant) {
  const questions = {};
  for (const { id, short } of PARTIES) {
    const items = relevant[id];
    if (!items.length) continue;
    questions[`${id}_match`] = {
      type: 'score',
      instructions:
        `Where does ${short} stand on what the person demands, judging by ${SOURCES[source].evidence(short)}? ` +
        'Compare with the concrete demand, not the wider topic: a party that wants to restrict ' +
        'what the person wants to expand contradicts them, while a party that wants to go further ' +
        'in the same direction, or criticises a measure as too weak, agrees. Judge only the material ' +
        'provided, not what you know about the party.',
      criteria: LEVEL_MEANINGS,
    };
    if (items.length > 1) {
      questions[`${id}_source`] = {
        type: 'choice',
        instructions: `Which item best shows where ${short} stands on what the person demands?`,
        criteria: Object.fromEntries(items.map((item) => [item.id, null])),
      };
    }
  }
  const items = byShortName(mapParties((id) => relevant[id].map(({ relevance, ...item }) => item)));
  return {
    model: MODEL,
    state: { person: { topic, opinion }, how_to_read: SOURCES[source].howToRead, items },
    questions,
  };
}

const likeliest = (probabilities) =>
  Object.entries(probabilities).reduce((best, next) => (next[1] > best[1] ? next : best))[0];

/**
 * Per party: `{ score: -1–1, covered: 0–1, sources: [item id] }`, or null
 * when none of its items addressed the demand. Covered is how clearly its
 * most relevant item does.
 */
export function readPartyAnswers(answers, relevant) {
  return mapParties((id) => {
    const match = answers[`${id}_match`];
    if (!match || !relevant[id].length) return null;
    const topLevel = Object.keys(match.legend).length - 1;
    const source = answers[`${id}_source`];
    return {
      score: (2 * match.score) / topLevel - 1,
      covered: Math.max(...relevant[id].map(({ relevance }) => relevance)),
      sources: [source ? likeliest(source.probabilities) : relevant[id][0].id],
    };
  });
}

/**
 * The opinion plus the closest roll-call votes. Jev is asked how the person
 * would vote in each, without seeing how the parties voted; the parties are
 * then compared with that in readVotes. Asking Jev per party instead made it
 * judge the same vote differently for parties that voted the same way.
 */
export function buildVotesRequest(topic, opinion, votes) {
  return {
    model: MODEL,
    state: {
      person: { topic, opinion },
      how_to_read:
        'Voting yes means voting for what the title names, whatever the result: descriptions often ' +
        'report that a motion was rejected, which is how others voted, not what the motion wants. ' +
        'If a title starts with "Ablehnung", voting yes means rejecting the motion it names.',
      roll_call_votes: votes.map(({ id, date, title, description }) => ({
        id,
        date,
        title,
        description: description.slice(0, DESCRIPTION_CHARS),
      })),
    },
    questions: Object.fromEntries(
      votes.map(({ id, title }) => [
        id,
        {
          type: 'choice',
          instructions:
            `How would the person, given their opinion, vote in roll-call vote ${id} ("${title}")? ` +
            'Judge by what the vote mainly decides, not by its topic or by side effects.',
          criteria: {
            yes: 'Yes: mainly, the vote puts into practice what the person demands, or goes in that direction',
            no: 'No: mainly, the vote does the opposite of what the person demands, or blocks it',
            // Omnibus laws touch many demands; voting against one says little about any of them.
            bundled: 'Either: the vote touches the demand, but decides mostly other things, so the person could vote either way',
            unrelated: 'Neither: the vote does not decide anything the person demands or opposes',
          },
        },
      ]),
    ),
  };
}

/**
 * How the person would vote in each vote: `{ lean: -1–1, clarity: 0–1 }`,
 * where lean is +1 for a clear yes and clarity is how likely the vote decides
 * the demand at all.
 */
export function readPersonVotes(answers) {
  return Object.fromEntries(
    Object.entries(answers).map(([id, { probabilities: { yes = 0, no = 0 } }]) => {
      const clarity = yes + no;
      return [id, { lean: clarity ? (yes - no) / clarity : 0, clarity }];
    }),
  );
}

/**
 * Per party, the same shape as readPartyAnswers: each vote the party took part
 * in counts by how clearly it decides the demand, and agrees as far as the
 * party voted the way the person would. `sources` are those votes, clearest first.
 */
export function readVotes(person, votes) {
  const relevant = votes.filter((vote) => person[vote.id]?.clarity >= COVERED);
  return Object.fromEntries(
    PARTIES.map(({ id }) => {
      const voted = relevant
        .map((vote) => ({ vote, party: leanOf(vote.results[id]), ...person[vote.id] }))
        .filter(({ party }) => party !== null)
        .sort((a, b) => b.clarity - a.clarity);
      if (!voted.length) return [id, null];
      const weight = voted.reduce((sum, { clarity }) => sum + clarity, 0);
      const agreement = voted.reduce((sum, { clarity, lean, party }) => sum + clarity * lean * party, 0);
      return [id, { score: agreement / weight, covered: voted[0].clarity, sources: voted.map(({ vote }) => vote.id) }];
    }),
  );
}

export const isCovered = (reading) => reading?.covered >= COVERED;

/**
 * A party's overall score across topics, -1–1, or null when it is silent on
 * all of them. Topics count by how clearly they are addressed, so one clear
 * topic outweighs several vague ones.
 */
export function overallScore(readings) {
  let weighted = 0;
  let weight = 0;
  for (const reading of readings.filter(isCovered)) {
    weighted += reading.covered * reading.score;
    weight += reading.covered;
  }
  return weight ? weighted / weight : null;
}

/** Whether a party votes clearly differently from what its program says. */
export function diverges(program, votes) {
  return isCovered(program) && isCovered(votes) && Math.abs(program.score - votes.score) >= DIVERGENCE;
}

/**
 * The weighted mean of the sources that say something, or null when none
 * does. `scores` and `weights` are keyed by source.
 */
export function combinedScore(scores, weights) {
  let weighted = 0;
  let total = 0;
  for (const [source, score] of Object.entries(scores)) {
    if (score === null || !weights[source]) continue;
    weighted += weights[source] * score;
    total += weights[source];
  }
  return total ? weighted / total : null;
}
