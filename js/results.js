// The results: one ranking that weighs programs, votes and statements, and
// per party a table of topics by source, each opening onto its evidence.
import { LEVELS, combinedScore, diverges, isCovered, levelOf, overallScore, readVotes } from './analysis.js';
import { excerpt } from './excerpt.js';
import { PARTIES, programUrl } from './parties.js';
import { describePosition, leanOf, positionOf } from './votes.js';

const WEIGHTS_KEY = 'votingaid.weights';

const SOURCES = ['program', 'votes', 'statements'];
const SOURCE_NAMES = { program: 'Programm', votes: 'Abstimmungen', statements: 'Aussagen' };
const WEIGHTS = { 0: 'aus', 1: 'normal', 2: 'doppelt' };
const WEBSITE_KINDS = { fraktion: 'Bundestagsfraktion', partei: 'Bundespartei' };
// Above this, a party voted as the person would: a mostly united vote in the
// same direction. Abstaining or splitting counts as neither.
const AGREES = 0.3;

const $ = (id) => document.getElementById(id);

// The last analysis, kept so weighing needs no new requests.
let analysis = null;
let apiKey = null;
const weights = { program: 1, votes: 1, statements: 1, ...JSON.parse(localStorage.getItem(WEIGHTS_KEY) ?? '{}') };
// What is open survives re-rendering: party ids, and per party one "topic:source" cell.
const openParties = new Set();
const openCells = new Map();
// Key sentences per topic and passage, fetched once when first opened.
const excerpts = new Map();

/** Shows a fresh analysis. The key is used to find the key sentences of quotes. */
export function showAnalysis(result, key) {
  analysis = result;
  apiKey = key;
  openParties.clear();
  openCells.clear();
  excerpts.clear();
  for (const topic of analysis.topics) topic.votes = readVotes(topic.voteDirections, topic.closeVotes);
  render();
  $('results').scrollIntoView({ behavior: 'smooth' });
}

/** Counts a topic anew after the person changed its weight; nothing on screen, nothing to do. */
export function reweigh(key, weight) {
  const topic = analysis?.topics.find((candidate) => candidate.key === key);
  if (!topic) return;
  topic.weight = weight;
  render();
}

function render() {
  $('results').hidden = false;
  renderWeights();
  const topicWeights = analysis.topics.map((topic) => topic.weight);
  const scored = PARTIES.map((party) => {
    const bySource = Object.fromEntries(
      SOURCES.map((source) => [source, overallScore(analysis.topics.map((topic) => topic[source][party.id]), topicWeights)]),
    );
    return { party, overall: combinedScore(bySource, weights) };
  });
  // Parties that say nothing about any topic are not ranked: a missing
  // position is not a low score, and listing them last would suggest one.
  const ranked = scored.filter(({ overall }) => overall !== null).sort((a, b) => b.overall - a.overall);
  const silent = scored.filter(({ overall }) => overall === null);
  $('ranking').replaceChildren(...ranked.map(rankedParty), ...silent.map(silentParty));
}

function renderWeights() {
  $('weights').replaceChildren(
    ...SOURCES.map((source) => {
      const row = element('div', 'weight');
      const group = element('div', 'segmented');
      group.setAttribute('role', 'group');
      group.setAttribute('aria-label', `Gewicht für ${SOURCE_NAMES[source]}`);
      const othersOff = SOURCES.every((other) => other === source || !weights[other]);
      for (const [value, label] of Object.entries(WEIGHTS)) {
        const button = element('button', '', label);
        button.type = 'button';
        button.setAttribute('aria-pressed', String(weights[source] === Number(value)));
        // At least one source has to count.
        button.disabled = value === '0' && othersOff;
        button.addEventListener('click', () => {
          weights[source] = Number(value);
          localStorage.setItem(WEIGHTS_KEY, JSON.stringify(weights));
          render();
        });
        group.append(button);
      }
      row.append(element('span', '', SOURCE_NAMES[source]), group);
      return row;
    }),
  );
}

/** A party with nothing on the person's topics: last, and visibly without a score. */
function silentParty({ party }) {
  const item = element('li', `party silent party-${party.id}`);
  const row = element('div', 'row');
  row.append(element('span', 'name', party.short), element('span', 'bar empty', 'nichts Passendes gefunden'), element('span', 'score', '–'));
  item.append(row);
  return item;
}

function rankedParty({ party, overall }) {
  const item = element('li', `party party-${party.id}`);
  item.dataset.party = party.id;
  const details = document.createElement('details');
  details.open = openParties.has(party.id);
  details.addEventListener('toggle', () => {
    if (!details.open) return openParties.delete(party.id);
    openParties.add(party.id);
    prefetchQuotes(party);
  });
  const summary = document.createElement('summary');
  summary.append(element('span', 'name', party.short), scoreBar(overall), element('span', 'score', formatScore(overall)));
  details.append(summary, topicTable(party));
  item.append(details);
  return item;
}

/** Topics by source; each score opens its evidence in a row beneath. */
function topicTable(party) {
  const table = element('table', 'topics');
  const head = element('tr');
  head.append(element('td'), ...SOURCES.map((source) => element('th', weights[source] ? '' : 'off', SOURCE_NAMES[source])));
  table.append(element('thead'));
  table.tHead.append(head);
  const body = element('tbody');
  analysis.topics.forEach((topic, index) => {
    const row = element('tr');
    const name = element('th');
    name.append(element('span', '', topic.topic));
    name.title = topic.topic;
    name.scope = 'row';
    row.append(name);
    const cell = `${index}:`;
    for (const source of SOURCES) {
      const reading = topic[source][party.id];
      const td = element('td', weights[source] ? '' : 'off');
      const button = element('button', 'cell');
      button.type = 'button';
      if (isCovered(reading)) {
        button.textContent = formatScore(reading.score);
        button.classList.add(`level-${levelOf(reading.score)}`);
        button.setAttribute('aria-label', `${SOURCE_NAMES[source]}: ${formatScore(reading.score)}, ${LEVELS[levelOf(reading.score)]}`);
      } else {
        button.textContent = '–';
        button.setAttribute('aria-label', `${SOURCE_NAMES[source]}: nichts Passendes`);
      }
      const open = openCells.get(party.id) === cell + source;
      button.setAttribute('aria-expanded', String(open));
      button.addEventListener('click', () => {
        if (open) openCells.delete(party.id);
        else openCells.set(party.id, cell + source);
        render();
      });
      td.append(button);
      row.append(td);
    }
    body.append(row);
    const openSource = openCells.get(party.id)?.startsWith(cell) && openCells.get(party.id).slice(cell.length);
    if (openSource) {
      const evidenceRow = element('tr', 'evidence');
      const td = element('td');
      td.colSpan = SOURCES.length + 1;
      const card = element('div', 'evidence-card');
      card.append(...evidence(topic, party, openSource));
      td.append(card);
      evidenceRow.append(td);
      body.append(evidenceRow);
    }
  });
  table.append(body);
  return table;
}

function evidence(topic, party, source) {
  const reading = topic[source][party.id];
  if (!isCovered(reading)) {
    const none = {
      program: 'Das Wahlprogramm bezieht dazu keine klare Position.',
      votes: `${party.short} hat über nichts Passendes abgestimmt.`,
      statements: 'Keine passende Aussage gefunden.',
    };
    return [element('p', 'muted', none[source])];
  }
  const level = levelOf(reading.score);
  const nodes = [element('p', `verdict level-${level}`, LEVELS[level])];
  if (source !== 'statements' && diverges(topic.program[party.id], topic.votes[party.id])) {
    nodes.push(element('p', 'divergence', 'Programm und Abstimmungen passen hier nicht zusammen.'));
  }
  if (source === 'program') {
    const passage = analysis.passages.get(reading.sources[0]);
    nodes.push(quote(topic, passage.text, `Wahlprogramm, Seite ${passage.page}`, programUrl(party.id, passage.page)));
  } else if (source === 'statements') {
    const { doc, passage } = analysis.statements.get(reading.sources[0]);
    nodes.push(quote(topic, passage, statementCitation(doc), doc.url));
  } else {
    const list = element('ul', 'vote-list');
    list.append(...reading.sources.map((id) => voteItem(topic, analysis.votes.get(id), party)));
    nodes.push(list);
  }
  return nodes;
}

function statementCitation(doc) {
  if (doc.kind !== 'rede') return `${WEBSITE_KINDS[doc.kind]}, ${doc.source}, ${doc.date}`;
  const who = doc.role ? `${doc.speaker} (${doc.role})` : doc.speaker;
  return `${who}, Rede im Bundestag, ${doc.date}`;
}

/** One vote: whether the party voted towards the demand, what it was, and how the party voted. */
function voteItem(topic, vote, party) {
  const position = positionOf(vote.results[party.id]);
  const agreement = topic.voteDirections[vote.id].lean * leanOf(vote.results[party.id]);
  const [kind, mark, label] =
    agreement > AGREES
      ? ['agree', '✓', 'für die Forderung']
      : agreement < -AGREES
        ? ['disagree', '✗', 'gegen die Forderung']
        : ['neutral', '~', 'weder dafür noch dagegen'];
  const item = element('li', `vote ${kind}`);
  const badge = element('span', 'badge', mark);
  badge.setAttribute('aria-label', `${party.short} stimmte ${label}`);
  const text = element('div');
  // How the party voted, not how the person would: that is theirs to judge.
  // Votes by show of hands record each fraction's stance, not its members' votes.
  const how = vote.show_of_hands ? 'per Handzeichen' : describePosition(position);
  const meta = element('p', 'vote-meta', `${party.short} ${position.stance} · ${vote.date}${vote.show_of_hands ? ' · per Handzeichen' : ''}`);
  meta.title = how;
  text.append(sourceLink(vote.url, vote.title), meta);
  item.append(badge, text);
  return item;
}

/**
 * A quote in the party's own words: its key sentences, with […] where text
 * is left out, and the source beneath. The whole passage is one tap away.
 * Until the key sentences are found, and if that fails, the passage shows
 * whole, cut to a few lines.
 */
// Quotes inside a quote take single marks.
const inner = (text) => text.replaceAll('„', '‚').replaceAll('“', '‘');

function keySentences(topic, text) {
  const id = `${topic.key}\n${text}`;
  if (!excerpts.has(id)) excerpts.set(id, excerpt(apiKey, topic.query, text).catch(() => null));
  return excerpts.get(id);
}

/** Starts finding the key sentences of a party's quotes, so they are ready when opened. */
function prefetchQuotes(party) {
  for (const topic of analysis.topics) {
    const program = topic.program[party.id];
    if (isCovered(program)) keySentences(topic, analysis.passages.get(program.sources[0]).text);
    const said = topic.statements[party.id];
    if (isCovered(said)) keySentences(topic, analysis.statements.get(said.sources[0]).passage);
  }
}

function quote(topic, text, citation, url) {
  const figure = element('figure', 'quote');
  // Placeholder lines until the key sentences are there; the passage itself would jump.
  const block = element('blockquote', 'loading');
  block.append(element('span'), element('span'), element('span'));
  const caption = element('figcaption');
  caption.append(sourceLink(url, citation));
  figure.append(block, caption);
  keySentences(topic, text).then((found) => {
    if (found) return showKeySentences(block, caption, found);
    block.className = 'clamped';
    block.textContent = `„${inner(text)}“`;
  });
  return figure;
}

function showKeySentences(block, caption, { sentences, key }) {
  block.className = '';
  const parts = [];
  sentences.forEach((sentence, i) => {
    if (key.includes(i)) parts.push(inner(sentence));
    else if (parts.at(-1) !== '[…]') parts.push('[…]');
  });
  block.textContent = `„${parts.join(' ')}“`;
  if (key.length === sentences.length) return;
  const whole = element('button', 'text-button', 'Ganzer Abschnitt');
  whole.type = 'button';
  whole.addEventListener('click', () => {
    // The whole passage, with the key sentences marked.
    block.replaceChildren('„', ...sentences.flatMap((sentence, i) => [i ? ' ' : '', key.includes(i) ? element('mark', '', inner(sentence)) : inner(sentence)]), '“');
    whole.remove();
  });
  caption.append(whole);
}

/** A link that reads as a source, not as a call to action. */
function sourceLink(href, text) {
  const node = link(href, `${text} ↗`);
  node.className = 'source';
  return node;
}

/** A bar from the middle: left for contradiction, right for agreement. */
function scoreBar(score) {
  const bar = element('span', 'bar');
  const fill = element('span', score < 0 ? 'against' : '');
  fill.style.left = `${50 + Math.min(score, 0) * 50}%`;
  fill.style.width = `${Math.abs(score) * 50}%`;
  bar.append(fill);
  return bar;
}

/** -1–1 as -10 to +10, with a real minus sign. */
function formatScore(score) {
  const points = Math.round(score * 10);
  if (points > 0) return `+${points}`;
  return points < 0 ? `−${-points}` : '0';
}

export function link(href, text) {
  const node = element('a', '', text);
  node.href = href;
  node.target = '_blank';
  node.rel = 'noopener';
  return node;
}

export function element(name, className, text) {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

$('toggle-weights').addEventListener('click', () => {
  const open = $('weights').hidden;
  $('weights').hidden = !open;
  $('toggle-weights').setAttribute('aria-expanded', String(open));
});
