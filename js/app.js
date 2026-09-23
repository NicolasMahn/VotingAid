import { askJev, findApiKey, isApiKey, rememberApiKey } from './jev.js';
import { VOTES_PER_TOPIC, closest, closestPassages, embed, loadIndex } from './retrieval.js';
import {
  COVERED,
  LEVELS,
  buildProgramRequest,
  buildVotesRequest,
  diverges,
  overallMatch,
  readTopic,
} from './analysis.js';
import { PARTIES, programUrl } from './parties.js';
import { SUGGESTIONS } from './suggestions.js';
import { describePosition, positionOf } from './votes.js';

const STORAGE_KEY = 'votingaid.topics';
// Every topic is one embedding and two Jev requests on a shared, capped key.
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

async function analyseTopic(apiKey, programs, votes, { topic, opinion }) {
  const query = await embed(apiKey, programs, topic ? `${topic}: ${opinion}` : opinion);
  const passages = closestPassages(programs, query);
  const closeVotes = closest(votes.items, query, VOTES_PER_TOPIC);
  const [programAnswers, voteAnswers] = await Promise.all([
    askJev(apiKey, buildProgramRequest(topic, opinion, passages)),
    askJev(apiKey, buildVotesRequest(topic, opinion, closeVotes)),
  ]);
  return {
    topic: topic || opinion,
    program: readTopic(programAnswers.answers),
    votes: readTopic(voteAnswers.answers),
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
  $('status').textContent = 'Jev vergleicht deine Meinung mit Programmen und Abstimmungen…';
  try {
    const [programs, votes] = await Promise.all([programsReady, votesReady]);
    const topicResults = await Promise.all(topics.map((topic) => analyseTopic(apiKey, programs, votes, topic)));
    analysis = {
      topics: topicResults,
      passages: new Map(programs.items.map((item) => [item.id, item])),
      votes: new Map(votes.items.map((item) => [item.id, item])),
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

  const ranked = PARTIES.map((party) => ({
    party,
    overall: overallMatch(analysis.topics.map((topic) => topic[view][party.id])),
  })).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  $('ranking').replaceChildren(
    ...ranked.map(({ party, overall }) => {
      const item = element('li', `party party-${party.id}`);
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const bar = element('span', 'bar');
      const fill = document.createElement('span');
      fill.style.width = `${Math.round((overall ?? 0) * 100)}%`;
      bar.append(fill);
      summary.append(
        element('span', 'name', party.short),
        bar,
        element('span', 'percent', overall === null ? '–' : `${Math.round(overall * 100)} %`),
      );
      details.append(summary, element('p', 'muted', party.name));
      for (const topic of analysis.topics) details.append(finding(topic, party));
      item.append(details);
      return item;
    }),
  );
}

function finding(topic, party) {
  const reading = topic[view][party.id];
  const block = element('div', 'finding');
  block.append(element('p', 'finding-topic', topic.topic));
  if (!reading || reading.covered < COVERED) {
    const silence = view === 'program' ? 'Keine klare Position im Programm' : 'Keine passende Abstimmung';
    block.append(element('p', 'verdict silent', silence));
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
  } else {
    const vote = analysis.votes.get(reading.source);
    const date = new Date(vote.date).toLocaleDateString('de-DE');
    block.append(
      element('p', 'vote-title', `${vote.title} (${date}, ${vote.accepted ? 'angenommen' : 'abgelehnt'})`),
      element('p', 'vote-position', `${party.short}: ${describePosition(positionOf(vote.results[party.id]))}`),
      link(vote.url, 'Abstimmung auf abgeordnetenwatch.de'),
    );
  }
  return block;
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

const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
(saved.length ? saved : [{}]).forEach(addTopic);
