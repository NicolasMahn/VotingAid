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
// Jev is asked in German, like the material it reads. What it judges
// programs and statements against: bare labels left it free to read
// "Eher Widerspruch" as a weak verdict on a tangential remark.
const LEVEL_MEANINGS = [
  'Klarer Widerspruch: Die Partei will klar das Gegenteil dessen, was die Person fordert',
  'Eher Widerspruch: Die Partei lehnt eher ab, was die Person fordert',
  'Teils, teils: Die Partei stimmt teilweise zu, ist unentschieden, oder das Material entscheidet es nicht',
  'Eher Übereinstimmung: Die Partei unterstützt eher, was die Person fordert',
  'Klare Übereinstimmung: Die Partei will klar, was die Person fordert',
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
      mapParties((id) => (passagesByParty[id] ?? []).map(({ id: key, page, text }) => ({ id: key, seite: page, text }))),
    evidence: (short) => `dem Wahlprogramm von ${short}, nach diesen Auszügen`,
    howToRead: 'Auszüge aus den Wahlprogrammen der Parteien zur Bundestagswahl 2025.',
  },
  statements: {
    items: (statementsByParty) =>
      mapParties((id) =>
        (statementsByParty[id] ?? []).map(({ doc, passage }) => ({
          id: doc.id,
          art: STATEMENT_KINDS[doc.kind],
          sprecher: [doc.speaker, doc.role].filter(Boolean).join(', ') || null,
          datum: doc.date,
          kontext: doc.title,
          text: passage,
        })),
      ),
    evidence: (short) => `dem, was Politikerinnen, Politiker und offizielle Kanäle von ${short} in diesen Aussagen sagen`,
    howToRead:
      'Aussagen einzelner Politikerinnen und Politiker entsprechen nicht immer der Parteilinie. Reden ' +
      'argumentieren oft gegen eine andere Partei: Beurteile, was die sprechende Person will, nicht was sie angreift.',
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
          `Sagt ${item.id}, was ${short} zur konkreten Forderung der Person will: dafür, dagegen oder ein ` +
          'anderer Weg zum selben Ziel? Die Gegenposition zurückzuweisen zählt. Nur das weitere Thema zu ' +
          'teilen zählt nicht, ebenso wenig eine Frage oder eine Nebenbemerkung. Beurteile nicht, ob die ' +
          'Partei der Person zustimmt, nur ob der Auszug etwas zur Forderung sagt.',
      };
    }
  }
  return {
    model: MODEL,
    state: { person: { thema: topic, meinung: opinion }, lesehinweis: SOURCES[source].howToRead, auszuege: byShortName(evidence) },
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
        `Wo steht ${short} zu dem, was die Person fordert, nach ${SOURCES[source].evidence(short)}? ` +
        'Vergleiche mit der konkreten Forderung, nicht mit dem weiteren Thema: Eine Partei, die ' +
        'einschränken will, was die Person ausweiten will, widerspricht ihr; eine Partei, die in dieselbe ' +
        'Richtung weiter gehen will oder eine Maßnahme als zu schwach kritisiert, stimmt ihr zu. Beurteile ' +
        'nur das vorliegende Material, nicht was du sonst über die Partei weißt.',
      criteria: LEVEL_MEANINGS,
    };
    if (items.length > 1) {
      questions[`${id}_source`] = {
        type: 'choice',
        instructions: `Welcher Auszug zeigt am besten, wo ${short} zur Forderung der Person steht?`,
        criteria: Object.fromEntries(items.map((item) => [item.id, null])),
      };
    }
  }
  const items = byShortName(mapParties((id) => relevant[id].map(({ relevance, ...item }) => item)));
  return {
    model: MODEL,
    state: { person: { thema: topic, meinung: opinion }, lesehinweis: SOURCES[source].howToRead, auszuege: items },
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

// Votes take the same two steps, with a different second question. Jev
// first checks, vote by vote, whether a vote decides the person's specific
// demand at all; then, for the votes that do, which way a yes goes relative
// to the demand. Neither step sees how the parties voted: they are compared
// in readVotes, so parties that voted alike score alike.

const VOTES_HOW_TO_READ =
  'Mit Ja stimmen heißt, für das zu stimmen, was der Titel nennt, unabhängig vom Ergebnis: ' +
  'Beschreibungen berichten oft, dass ein Antrag abgelehnt wurde; das sagt, wie andere abgestimmt ' +
  'haben, nicht was der Antrag will. Beginnt ein Titel mit „Ablehnung“, heißt ein Ja, den genannten ' +
  'Antrag abzulehnen.';

const voteState = (topic, opinion, votes) => ({
  person: { thema: topic, meinung: opinion },
  lesehinweis: VOTES_HOW_TO_READ,
  namentliche_abstimmungen: votes.map(({ id, date, title, description }) => ({
    id,
    datum: date,
    titel: title,
    beschreibung: description.slice(0, DESCRIPTION_CHARS),
  })),
});

/** Step one for votes: per vote, whether it decides the person's specific demand at all. */
export function buildVoteRelevanceRequest(topic, opinion, votes) {
  return {
    model: MODEL,
    state: voteState(topic, opinion, votes),
    questions: Object.fromEntries(
      votes.map(({ id, title }) => [
        id,
        {
          type: 'noul',
          instructions:
            `Entscheidet die namentliche Abstimmung ${id} („${title}“) etwas über die konkrete Forderung der ` +
            'Person, dafür oder dagegen? Das zählt nur, wenn die Forderung das ist, worüber hauptsächlich ' +
            'abgestimmt wird. Nur das weitere Thema zu teilen zählt nicht, ebenso wenig ein Gesetz, das ' +
            'hauptsächlich anderes regelt. Beurteile nicht, wie die Person abstimmen würde, nur ob es in der ' +
            'Abstimmung um die Forderung geht.',
        },
      ]),
    ),
  };
}

/** The votes that decide the demand, each with its `relevance`. */
export function relevantVotes(votes, answers) {
  return votes
    .map((vote) => ({ ...vote, relevance: answers[vote.id]?.noul ?? 0 }))
    .filter(({ relevance }) => relevance >= COVERED);
}

/** Step two for votes: which way a yes goes, relative to the person's demand. */
export function buildVoteDirectionRequest(topic, opinion, votes) {
  return {
    model: MODEL,
    state: voteState(topic, opinion, votes),
    questions: Object.fromEntries(
      votes.map(({ id, title }) => [
        id,
        {
          type: 'choice',
          instructions: `Geht ein Ja in der namentlichen Abstimmung ${id} („${title}“) in Richtung dessen, was die Person fordert, oder davon weg?`,
          criteria: {
            hin: 'In Richtung: Ein Ja setzt um, was die Person fordert, oder geht in diese Richtung',
            weg: 'Davon weg: Ein Ja bewirkt das Gegenteil dessen, was die Person fordert, oder blockiert es',
          },
        },
      ]),
    ),
  };
}

/**
 * How the person would vote in each relevant vote: `{ lean: -1–1, clarity: 0–1 }`,
 * where lean is +1 for a clear yes and clarity is how clearly the vote decides
 * the demand.
 */
export function readVoteDirections(relevant, answers) {
  return Object.fromEntries(
    relevant.map(({ id, relevance }) => {
      const { hin = 0, weg = 0 } = answers[id]?.probabilities ?? {};
      return [id, { lean: hin + weg ? (hin - weg) / (hin + weg) : 0, clarity: relevance }];
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
