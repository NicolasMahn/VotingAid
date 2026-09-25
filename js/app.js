import { askJev, findApiKey, isApiKey, rememberApiKey } from './jev.js';
import { VOTES_PER_TOPIC, closest, closestPassages, embedOpinion, loadIndex, shorten } from './retrieval.js';
import { DOCS_PER_PARTY, closestDocuments, closestPassage, loadDocuments, loadStatements } from './statements.js';
import {
  LEVELS,
  STATEMENT_KINDS,
  buildProgramRequest,
  buildStatementsRequest,
  buildVotesRequest,
  diverges,
  isCovered,
  overallMatch,
  readTopic,
} from './analysis.js';
import { PARTIES, programUrl } from './parties.js';
import { SUGGESTIONS } from './suggestions.js';
import { describePosition, positionOf } from './votes.js';

const STORAGE_KEY = 'votingaid.topics';
// Every topic is one embedding and three Jev requests on a shared, capped key.
const MAX_TOPICS = 12;

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

// What each view calls a party that has nothing to say.
const SILENCE = {
  program: { all: 'Keine klare Position im Wahlprogramm zu deinen Themen:', one: 'Keine klare Position im Programm', where: 'im Programm' },
  votes: { all: 'Keine passende Abstimmung zu deinen Themen:', one: 'Keine passende Abstimmung', where: 'in Abstimmungen' },
  statements: { all: 'Keine passende Aussage zu deinen Themen:', one: 'Keine passende Aussage', where: 'in Aussagen' },
};

// The last analysis, kept so switching views needs no new requests.
let analysis = null;
let view = 'program';

function readTopics() {
  return [...topicList.children].map((item) => ({
    topic: item.querySelector('.topic-name').value.trim(),
    opinion: item.querySelector('.topic-opinion').value.trim(),
  }));
}

function saveTopics() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readTopics()));
}

function addTopic({ topic = '', opinion = '' } = {}) {
  const item = $('topic-template').content.firstElementChild.cloneNode(true);
  item.querySelector('.topic-name').value = topic;
  item.querySelector('.topic-opinion').value = opinion;
  item.querySelector('.suggest').addEventListener('click', () => suggest(item));
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
  const free = Object.keys(SUGGESTIONS).filter((topic) => !taken.has(topic));
  const topic = free[Math.floor(Math.random() * free.length)];
  item.querySelector('.topic-name').value = topic;
  const opinion = item.querySelector('.topic-opinion');
  opinion.value = SUGGESTIONS[topic].replace('…', ' ');
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

async function analyseTopic(apiKey, { programs, votes, statements }, { topic, opinion }) {
  const query = await embedOpinion(apiKey, topic, opinion);
  const passages = closestPassages(programs, shorten(query, programs));
  const closeVotes = closest(votes.items, shorten(query, votes), VOTES_PER_TOPIC);
  const found = await closestStatements(statements, query);
  const [programAnswers, voteAnswers, statementAnswers] = await Promise.all([
    askJev(apiKey, buildProgramRequest(topic, opinion, passages)),
    askJev(apiKey, buildVotesRequest(topic, opinion, closeVotes)),
    askJev(apiKey, buildStatementsRequest(topic, opinion, found)),
  ]);
  return {
    topic: topic || opinion,
    program: readTopic(programAnswers.answers),
    votes: readTopic(voteAnswers.answers),
    statements: readTopic(statementAnswers.answers),
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
  $('status').textContent = 'Jev vergleicht deine Meinung mit Programmen, Abstimmungen und Aussagen…';
  try {
    const [programs, votes, statements] = await Promise.all([programsReady, votesReady, statementsReady]);
    const sources = { programs, votes, statements };
    const topicResults = await Promise.all(topics.map((topic) => analyseTopic(apiKey, sources, topic)));
    analysis = {
      topics: topicResults,
      passages: new Map(programs.items.map((item) => [item.id, item])),
      votes: new Map(votes.items.map((item) => [item.id, item])),
      statements: new Map(topicResults.flatMap((topic) => topic.found).map((found) => [found.doc.id, found])),
    };
    showResults();
    $('status').textContent = '';
  } catch (error) {
    $('status').textContent = `Das hat nicht geklappt: ${error.message}`;
  } finally {
    $('analyse').disabled = false;
  }
}

function showResults() {
  $('results').hidden = false;
  for (const button of document.querySelectorAll('#views button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  $('votes-note').hidden = view !== 'votes';
  $('statements-note').hidden = view !== 'statements';

  const scored = PARTIES.map((party) => {
    const readings = analysis.topics.map((topic) => topic[view][party.id]);
    return { party, overall: overallMatch(readings), covered: readings.filter(isCovered).length };
  });
  // Parties that say nothing about any topic are not ranked: a missing
  // position is not a low match, and listing them last would suggest one.
  const ranked = scored.filter(({ overall }) => overall !== null).sort((a, b) => b.overall - a.overall);
  const silent = scored.filter(({ overall }) => overall === null);

  $('ranking').replaceChildren(...ranked.map((entry) => rankedParty(entry)));
  $('silent').hidden = !silent.length;
  $('silent-text').textContent = SILENCE[view].all;
  $('silent-parties').replaceChildren(
    ...silent.map(({ party }) => element('li', `party-${party.id}`, party.short)),
  );
}

function rankedParty({ party, overall, covered }) {
  const item = element('li', `party party-${party.id}`);
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  const bar = element('span', 'bar');
  const fill = document.createElement('span');
  fill.style.width = `${Math.round(overall * 100)}%`;
  bar.append(fill);
  summary.append(element('span', 'name', party.short), bar, element('span', 'percent', `${Math.round(overall * 100)} %`));
  // The percentage is a scale from contradiction (0) to agreement (100), which
  // a bare number does not say: 27 % read as partial support.
  const level = Math.round(overall * (LEVELS.length - 1));
  const note = element('span', 'coverage');
  note.append(element('span', `level-${level}`, LEVELS[level]));
  const total = analysis.topics.length;
  if (covered < total) note.append(` · nur ${covered} von ${total} Themen ${SILENCE[view].where} behandelt`);
  summary.append(note);
  details.append(summary, element('p', 'muted', party.name));
  for (const topic of analysis.topics) details.append(finding(topic, party));
  item.append(details);
  return item;
}

function finding(topic, party) {
  const reading = topic[view][party.id];
  const block = element('div', 'finding');
  block.append(element('p', 'finding-topic', topic.topic));
  if (!isCovered(reading)) {
    block.append(element('p', 'verdict silent', SILENCE[view].one));
    return block;
  }
  block.append(element('p', `verdict level-${reading.level}`, LEVELS[reading.level]));
  if (diverges(topic.program[party.id], topic.votes[party.id])) {
    block.append(element('p', 'divergence', 'Programm und Abstimmungen passen hier nicht zusammen'));
  }
  if (view === 'program') {
    const passage = analysis.passages.get(reading.source);
    block.append(
      element('blockquote', '', passage.text),
      link(programUrl(party.id, passage.page), `Wahlprogramm ${party.short}, Seite ${passage.page}`),
    );
  } else if (view === 'votes') {
    const vote = analysis.votes.get(reading.source);
    block.append(
      element('p', 'vote-title', `${vote.title} (${vote.date}, ${vote.accepted ? 'angenommen' : 'abgelehnt'})`),
      element('p', 'vote-position', `${party.short}: ${describePosition(positionOf(vote.results[party.id]))}`),
      link(vote.url, 'Abstimmung auf abgeordnetenwatch.de'),
    );
  } else {
    block.append(...statementSource(analysis.statements.get(reading.source)));
  }
  return block;
}

/** The quote, who said it, when and where, and a link to the full source. */
function statementSource({ doc, passage }) {
  const who = [doc.speaker, doc.role].filter(Boolean).join(', ');
  const meta = [who, STATEMENT_KINDS[doc.kind], doc.date].filter(Boolean).join(' · ');
  const nodes = [element('blockquote', '', passage), element('p', 'statement-meta', meta)];
  if (doc.kind === 'rede' && doc.title) nodes.push(element('p', 'statement-context', `Debatte: ${shortened(doc.title, 160)}`));
  const label = doc.kind === 'rede' ? `${doc.source} (PDF)` : `${doc.source}: ${doc.title}`;
  nodes.push(link(doc.url, label));
  return nodes;
}

function shortened(text, length) {
  if (text.length <= length) return text;
  return `${text.slice(0, text.lastIndexOf(' ', length))} …`;
}

function link(href, text) {
  const node = element('a', '', text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener';
  return node;
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
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
for (const button of document.querySelectorAll('#views button')) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    showResults();
  });
}

function fillSources(votes) {
  $('program-list').replaceChildren(
    ...PARTIES.map(({ id, short, program }) => {
      const item = element('li', `party-${id}`);
      item.append(
        element('p', 'program-title', `${short}: ${program.title}`),
        element('p', 'muted', program.adopted),
        link(programUrl(id), `PDF herunterladen (${program.pages} Seiten, ${program.megabytes.toLocaleString('de-DE')} MB)`),
      );
      return item;
    }),
  );
  const dates = votes.items.map((vote) => vote.date).sort();
  $('votes-meta').replaceChildren(
    `${votes.items.length} namentliche Abstimmungen von ${dates[0]} bis ${dates.at(-1)}, pro Partei ausgezählt. ` +
      'Quelle: ',
    link('https://www.abgeordnetenwatch.de/api', 'abgeordnetenwatch.de'),
    ' (Lizenz CC0). FDP und BSW sind seit 2025 nicht mehr im Bundestag.',
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
      `Bundesparteien, bis ${meta.to}. Reden im Bundestag dürfen frei wiedergegeben werden (§ 48 UrhG); ` +
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
