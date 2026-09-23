import { askJev, findApiKey, isApiKey, rememberApiKey } from './jev.js';
import { closestPassages, embed, loadIndex } from './retrieval.js';
import { COVERED, LEVELS, buildTopicRequest, overallMatch, readTopic } from './analysis.js';
import { PARTIES, programUrl } from './parties.js';
import { SUGGESTIONS } from './suggestions.js';

const STORAGE_KEY = 'votingaid.topics';
// Every topic is one embedding and one Jev request on a shared, capped key.
const MAX_TOPICS = 12;

const $ = (id) => document.getElementById(id);
const topicList = $('topics');

// Loaded once in the background; analysing waits for it if it is not there yet.
const indexReady = fetch('data/programme.json')
  .then((response) => response.json())
  .then(loadIndex);

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

async function analyseTopic(apiKey, index, { topic, opinion }) {
  const query = await embed(apiKey, index, topic ? `${topic}: ${opinion}` : opinion);
  const passages = closestPassages(index, query);
  const response = await askJev(apiKey, buildTopicRequest(topic, opinion, passages));
  return { topic: topic || opinion, readings: readTopic(response.answers) };
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
  $('results').replaceChildren();
  $('status').textContent = 'Jev vergleicht deine Meinung mit den Programmen…';
  try {
    const index = await indexReady;
    const results = await Promise.all(topics.map((topic) => analyseTopic(apiKey, index, topic)));
    showResults(index, results);
    $('status').textContent = '';
  } catch (error) {
    $('status').textContent = `Das hat nicht geklappt: ${error.message}`;
  } finally {
    $('analyse').disabled = false;
  }
}

function showResults(index, results) {
  const passages = new Map(index.passages.map((passage) => [passage.id, passage]));
  const ranked = PARTIES.map((party) => ({
    party,
    overall: overallMatch(results.map(({ readings }) => readings[party.id])),
  })).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));

  $('results').replaceChildren(
    ...ranked.map(({ party, overall }) => {
      const item = document.createElement('li');
      item.className = `party party-${party.id}`;
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const bar = document.createElement('span');
      const fill = document.createElement('span');
      bar.className = 'bar';
      fill.style.width = `${Math.round((overall ?? 0) * 100)}%`;
      bar.append(fill);
      summary.append(
        element('span', 'name', party.short),
        bar,
        element('span', 'percent', overall === null ? '–' : `${Math.round(overall * 100)} %`),
      );
      details.append(summary, element('p', 'muted', party.name));
      for (const { topic, readings } of results) {
        details.append(finding(topic, readings[party.id], passages.get(readings[party.id].source), party));
      }
      item.append(details);
      return item;
    }),
  );
}

function finding(topic, reading, passage, party) {
  const block = element('div', 'finding');
  block.append(element('p', 'finding-topic', topic));
  if (reading.covered < COVERED) {
    block.append(element('p', 'verdict silent', 'Keine klare Position im Programm'));
    return block;
  }
  block.append(element('p', `verdict level-${reading.level}`, LEVELS[reading.level]));
  const quote = element('blockquote', '', passage.text);
  const link = element('a', '', `Wahlprogramm ${party.short}, Seite ${passage.page}`);
  link.href = programUrl(party.id, passage.page);
  link.target = '_blank';
  link.rel = 'noopener';
  block.append(quote, link);
  return block;
}

function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  node.textContent = text;
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

const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
(saved.length ? saved : [{}]).forEach(addTopic);
