import { askJev, findApiKey, isApiKey, rememberApiKey } from './jev.js';
import { VOTES_PER_TOPIC, closest, closestPassages, embedOpinion, loadIndex, shorten } from './retrieval.js';
import { DOCS_PER_PARTY, closestDocuments, closestPassage, loadDocuments, loadStatements } from './statements.js';
import {
  buildMatchRequest,
  buildRelevanceRequest,
  buildSourceRequest,
  buildVoteDirectionRequest,
  buildVoteRelevanceRequest,
  evidenceOf,
  readPartyAnswers,
  readVoteDirections,
  relevantEvidence,
  relevantVotes,
} from './analysis.js';
import { PARTIES, programUrl } from './parties.js';
import { element, link, reweigh, showAnalysis } from './results.js';
import { SUGGESTIONS } from './suggestions.js';
import { startTour } from './tour.js';

const STORAGE_KEY = 'votingaid.topics';
// Every topic is one embedding and three Jev requests on a shared, capped key.
const MAX_TOPICS = 12;
// How much a topic counts in the result; the button cycles through them.
const TOPIC_WEIGHTS = [1, 2, 4];

const $ = (id) => document.getElementById(id);
const topicList = $('topics');

// Loaded once in the background; analysing waits for them if needed.
const load = (url) =>
  fetch(url)
    .then((response) => response.json())
    .then(loadIndex);
const programsReady = load('data/programme.json');
const votesReady = load('data/abstimmungen.json');
const statementsReady = loadStatements();

function readTopics() {
  return [...topicList.children].map((item) => ({
    topic: item.querySelector('.topic-name').value.trim(),
    opinion: item.querySelector('.topic-opinion').value.trim(),
    weight: Number(item.dataset.weight),
  }));
}

function setWeight(item, weight) {
  item.dataset.weight = weight;
  item.querySelector('.weight').textContent = `Zählt ×${weight}`;
}

function saveTopics() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readTopics()));
}

function addTopic({ topic = '', opinion = '', weight = 1 } = {}) {
  const item = $('topic-template').content.firstElementChild.cloneNode(true);
  item.querySelector('.topic-name').value = topic;
  item.querySelector('.topic-opinion').value = opinion;
  setWeight(item, weight);
  item.querySelector('.suggest').addEventListener('click', () => suggest(item));
  item.querySelector('.weight').addEventListener('click', () => {
    const next = TOPIC_WEIGHTS[(TOPIC_WEIGHTS.indexOf(Number(item.dataset.weight)) + 1) % TOPIC_WEIGHTS.length];
    setWeight(item, next);
    saveTopics();
    // An analysis on screen counts the topic anew, without asking Jev again.
    const { topic: name, opinion: said } = readTopics()[[...topicList.children].indexOf(item)];
    reweigh(`${name}: ${said}`, next);
  });
  item.querySelector('.remove').addEventListener('click', () => {
    item.remove();
    if (!topicList.children.length) addTopic();
    updateButtons();
    saveTopics();
  });
  item.addEventListener('input', saveTopics);
  topicList.append(item);
  updateButtons();
  return item;
}

function updateButtons() {
  $('add').disabled = topicList.children.length >= MAX_TOPICS;
  for (const button of topicList.querySelectorAll('.remove')) {
    button.hidden = topicList.children.length === 1;
  }
}

function suggest(item) {
  const taken = new Set(readTopics().map(({ topic }) => topic));
  const free = SUGGESTIONS.filter((topic) => !taken.has(topic));
  item.querySelector('.topic-name').value = free[Math.floor(Math.random() * free.length)];
  // The old opinion belonged to the old topic.
  const opinion = item.querySelector('.topic-opinion');
  opinion.value = '';
  opinion.focus();
  saveTopics();
}

async function closestStatements(statements, query) {
  const numbersByParty = closestDocuments(statements, query);
  const docs = await loadDocuments(statements, Object.values(numbersByParty).flat());
  return Object.fromEntries(
    Object.entries(numbersByParty).map(([party, numbers]) => [
      party,
      numbers
        .map((number) => {
          const doc = docs.get(number);
          const { text, score } = closestPassage(statements, doc, query);
          return { doc, passage: text, score };
        })
        .sort((a, b) => b.score - a.score)
        .slice(0, DOCS_PER_PARTY),
    ]),
  );
}

// Questions Jev has answered in the running analysis, shown while it works.
let answered = 0;

/** askJev, counting the questions it answers for the waiting screen. */
async function ask(apiKey, request) {
  const response = await askJev(apiKey, request);
  answered += Object.keys(request.questions).length;
  $('thinking-count').textContent = `Jev hat ${answered.toLocaleString('de-DE')} Fragen beantwortet.`;
  return response;
}

/**
 * Where each party stands in one source: first which items are to the point,
 * then only those are judged, and alongside, which of them to quote.
 */
async function judge(apiKey, source, topic, opinion, found) {
  const evidence = evidenceOf(source, found);
  const relevance = await ask(apiKey, buildRelevanceRequest(source, topic, opinion, evidence));
  const relevant = relevantEvidence(evidence, relevance.answers);
  if (!Object.values(relevant).some((items) => items.length)) return readPartyAnswers({}, relevant);
  const sourceRequest = buildSourceRequest(source, topic, opinion, relevant);
  const [match, quote] = await Promise.all([
    ask(apiKey, buildMatchRequest(source, topic, opinion, relevant)),
    // Nothing to choose when every party has at most one relevant item.
    Object.keys(sourceRequest.questions).length ? ask(apiKey, sourceRequest) : { answers: {} },
  ]);
  return readPartyAnswers(match.answers, relevant, quote.answers);
}

/** How the person would vote: first which votes decide the demand, then which way a yes goes in those. */
async function judgeVotes(apiKey, topic, opinion, votes) {
  const relevance = await ask(apiKey, buildVoteRelevanceRequest(topic, opinion, votes));
  const relevant = relevantVotes(votes, relevance.answers);
  if (!relevant.length) return {};
  const { answers } = await ask(apiKey, buildVoteDirectionRequest(topic, opinion, relevant));
  return readVoteDirections(relevant, answers);
}

async function analyseTopic(apiKey, { programs, votes, statements }, { topic, opinion, weight }) {
  const query = await embedOpinion(apiKey, topic, opinion);
  const passages = closestPassages(programs, shorten(query, programs));
  const closeVotes = closest(votes.items, shorten(query, votes), VOTES_PER_TOPIC);
  const found = await closestStatements(statements, query);
  const [programReadings, voteDirections, statementReadings] = await Promise.all([
    judge(apiKey, 'program', topic, opinion, passages),
    judgeVotes(apiKey, topic, opinion, closeVotes),
    judge(apiKey, 'statements', topic, opinion, found),
  ]);
  return {
    topic: topic || opinion,
    // Key sentences are cached per opinion.
    key: `${topic}: ${opinion}`,
    weight,
    query,
    program: programReadings,
    statements: statementReadings,
    voteDirections,
    closeVotes,
    found: Object.values(found).flat(),
  };
}

async function analyse() {
  const topics = readTopics().filter(({ opinion }) => opinion);
  if (!topics.length) {
    $('status').textContent = 'Schreib zuerst zu mindestens einem Thema deine Meinung.';
    return;
  }
  const apiKey = await findApiKey();
  if (!apiKey) {
    $('key').hidden = false;
    $('key-input').focus();
    return;
  }

  $('analyse').disabled = true;
  $('results').hidden = true;
  $('status').textContent = '';
  answered = 0;
  $('thinking-count').textContent = 'Jev sucht passende Stellen …';
  $('thinking').hidden = false;
  $('thinking').scrollIntoView({ behavior: 'smooth', block: 'center' });
  try {
    const [programs, votes, statements] = await Promise.all([programsReady, votesReady, statementsReady]);
    const sources = { programs, votes, statements };
    const topicResults = await Promise.all(topics.map((topic) => analyseTopic(apiKey, sources, topic)));
    showAnalysis({
      topics: topicResults,
      passages: new Map(programs.items.map((item) => [item.id, item])),
      votes: new Map(votes.items.map((item) => [item.id, item])),
      statements: new Map(topicResults.flatMap((topic) => topic.found).map((found) => [found.doc.id, found])),
    }, apiKey);
    $('status').textContent = '';
  } catch (error) {
    $('status').textContent = `Das hat nicht geklappt: ${error.message}`;
  } finally {
    $('analyse').disabled = false;
    $('thinking').hidden = true;
  }
}

$('add').addEventListener('click', () => {
  addTopic().querySelector('.topic-name').focus();
  saveTopics();
});
$('analyse').addEventListener('click', analyse);
$('key').addEventListener('submit', (event) => {
  event.preventDefault();
  const key = $('key-input').value.trim();
  if (!isApiKey(key)) return;
  rememberApiKey(key);
  $('key').hidden = true;
  analyse();
});

function fillSources(votes) {
  $('program-list').replaceChildren(
    ...PARTIES.map(({ id, short, name, renamed, program }) => {
      const item = element('li', `party-${id}`);
      let fullName = name;
      if (renamed) {
        const done = new Date().toISOString().slice(0, 10) >= renamed.from;
        fullName = done ? `${renamed.to} (früher ${name})` : `${name} (ab ${renamed.from}: ${renamed.to})`;
      }
      const text = element('div');
      text.append(element('p', 'program-title', `${short}: ${program.title}`), element('p', 'muted', `${fullName}. ${program.adopted}.`));
      const pdf = link(programUrl(id), 'PDF');
      pdf.className = 'pdf';
      pdf.title = `${program.pages} Seiten, ${program.megabytes.toLocaleString('de-DE')} MB`;
      item.append(text, pdf);
      return item;
    }),
  );
  const dates = votes.items.map((vote) => vote.date).sort();
  const hands = votes.items.filter((vote) => vote.show_of_hands).length;
  $('votes-meta').replaceChildren(
    `${votes.items.length - hands} namentliche Abstimmungen von ${dates[0]} bis ${dates.at(-1)}, pro Fraktion ausgezählt, von `,
    link('https://www.abgeordnetenwatch.de/api', 'abgeordnetenwatch.de'),
    ` (Lizenz CC0), und ${hands} Abstimmungen per Handzeichen seit 2025-03-25 aus den Plenarprotokollen, ` +
      'bei denen nur feststeht, wie jede Fraktion gestimmt hat. FDP und BSW sind seit 2025-03-25 nicht mehr im Bundestag.',
  );
}

$('open-sources').addEventListener('click', () => $('sources').showModal());
$('close-sources').addEventListener('click', () => $('sources').close());
// A click on the backdrop lands on the dialog element itself.
$('sources').addEventListener('click', (event) => event.target === $('sources') && $('sources').close());
votesReady.then(fillSources);
statementsReady.then(({ meta }) => {
  const { rede, fraktion, partei } = meta.counts;
  $('statements-meta').replaceChildren(
    `${rede.toLocaleString('de-DE')} Redebeiträge aus den `,
    link('https://www.bundestag.de/services/opendata', 'Plenarprotokollen des Bundestags'),
    ` und ${(fraktion + partei).toLocaleString('de-DE')} Seiten von Websites der Bundestagsfraktionen und ` +
      `Bundesparteien, bis ${meta.to}. Reden aus öffentlichen Debatten des Bundestags dürfen mit Quellenangabe wiedergegeben werden (§ 48 UrhG); ` +
      'von Websites zeigen wir nur kurze Auszüge mit Link.',
  );
  // Some sites only reach back a few months, so each shows its own range.
  $('website-list').replaceChildren(
    ...Object.entries(meta.websites).map(([source, { party, count, from }]) =>
      element('li', `party-${party}`, `${source}: ${count.toLocaleString('de-DE')} Seiten seit ${from}`),
    ),
  );
});

const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
(saved.length ? saved : [{}]).forEach(addTopic);

for (const button of document.querySelectorAll('.tour-button')) button.addEventListener('click', () => startTour(button.dataset.tour));
