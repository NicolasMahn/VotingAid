// The results: one ranking that weighs programs, votes and statements, and
// per party a table of topics by source, each opening onto its evidence.
import {
  LEVELS,
  STATEMENT_KINDS,
  choiceOf,
  combinedScore,
  correctPersonVotes,
  diverges,
  isCovered,
  levelOf,
  overallScore,
  readVotes,
} from './analysis.js';
import { excerpt } from './excerpt.js';
import { PARTIES, programUrl } from './parties.js';
import { describePosition, positionOf } from './votes.js';

const CORRECTIONS_KEY = 'votingaid.voteCorrections';
const WEIGHTS_KEY = 'votingaid.weights';

const SOURCES = ['program', 'votes', 'statements'];
const SOURCE_NAMES = { program: 'Programm', votes: 'Abstimmungen', statements: 'Aussagen' };
const WEIGHTS = { 0: 'aus', 1: 'normal', 2: 'doppelt' };
const CHOICES = { yes: 'dafür', no: 'dagegen', skip: 'zählt nicht' };

const $ = (id) => document.getElementById(id);

// The last analysis, kept so weighing and correcting need no new requests.
let analysis = null;
let apiKey = null;
// Per opinion, how the person says they would vote where Jev read it wrong.
const corrections = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) ?? '{}');
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
  for (const topic of analysis.topics) applyCorrections(topic);
  render();
  $('results').scrollIntoView({ behavior: 'smooth' });
}

function applyCorrections(topic) {
  topic.person = correctPersonVotes(topic.jevVotes, corrections[topic.key] ?? {});
  topic.votes = readVotes(topic.person, topic.closeVotes);
}

function correct(topic, voteId, choice) {
  const own = (corrections[topic.key] ??= {});
  // Agreeing with Jev again removes the correction.
  if (choice === choiceOf(topic.jevVotes[voteId])) delete own[voteId];
  else own[voteId] = choice;
  localStorage.setItem(CORRECTIONS_KEY, JSON.stringify(corrections));
  applyCorrections(topic);
}

function render() {
  $('results').hidden = false;
  renderWeights();
  const scored = PARTIES.map((party) => {
    const bySource = Object.fromEntries(
      SOURCES.map((source) => [source, overallScore(analysis.topics.map((topic) => topic[source][party.id]))]),
    );
    return { party, overall: combinedScore(bySource, weights) };
  });
  // Parties that say nothing about any topic are not ranked: a missing
  // position is not a low score, and listing them last would suggest one.
  const ranked = scored.filter(({ overall }) => overall !== null).sort((a, b) => b.overall - a.overall);
  const silent = scored.filter(({ overall }) => overall === null);
  $('ranking').replaceChildren(...ranked.map(rankedParty));
  $('silent').hidden = !silent.length;
  $('silent-parties').replaceChildren(...silent.map(({ party }) => element('li', `party-${party.id}`, party.short)));
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

function rankedParty({ party, overall }) {
  const item = element('li', `party party-${party.id}`);
  item.dataset.party = party.id;
  const details = document.createElement('details');
  details.open = openParties.has(party.id);
  details.addEventListener('toggle', () => (details.open ? openParties.add(party.id) : openParties.delete(party.id)));
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
    const name = element('th', '', topic.topic);
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
      td.append(...evidence(topic, party, openSource));
      evidenceRow.append(td);
      body.append(evidenceRow);
    }
  });
  table.append(body);
  return table;
}

function evidence(topic, party, source) {
  const reading = topic[source][party.id];
  const nodes = [];
  if (isCovered(reading)) {
    const level = levelOf(reading.score);
    nodes.push(element('p', `verdict level-${level}`, `${SOURCE_NAMES[source]}: ${LEVELS[level]}`));
    if (source !== 'statements' && diverges(topic.program[party.id], topic.votes[party.id])) {
      nodes.push(element('p', 'divergence', 'Programm und Abstimmungen passen hier nicht zusammen.'));
    }
  }
  if (source === 'votes') {
    // Every vote that counts, plus the ones the person took out, so they can put them back.
    const skipped = Object.entries(corrections[topic.key] ?? {})
      .filter(([id, choice]) => choice === 'skip' && positionOf(analysis.votes.get(id)?.results[party.id]))
      .map(([id]) => id);
    // In Jev's order, so a correction does not move the vote just corrected.
    const shown = [...(reading?.sources ?? []), ...skipped].sort((a, b) => topic.jevVotes[b].clarity - topic.jevVotes[a].clarity);
    if (!shown.length) nodes.push(element('p', 'muted', `${party.short} hat über nichts Passendes abgestimmt.`));
    for (const id of shown) nodes.push(voteSource(topic, analysis.votes.get(id), party));
  } else if (!isCovered(reading)) {
    nodes.push(element('p', 'muted', source === 'program' ? 'Das Wahlprogramm bezieht dazu keine klare Position.' : 'Keine passende Aussage gefunden.'));
  } else if (source === 'program') {
    const passage = analysis.passages.get(reading.sources[0]);
    nodes.push(quote(topic, passage.text), link(programUrl(party.id, passage.page), `Wahlprogramm ${party.short}, Seite ${passage.page}`));
  } else {
    nodes.push(...statementSource(topic, analysis.statements.get(reading.sources[0])));
  }
  return nodes;
}

/** The vote, how the person would vote in it, which they can correct, and how the party voted. */
function voteSource(topic, vote, party) {
  const block = element('div', 'vote');
  block.dataset.vote = vote.id;
  const choice = choiceOf(topic.person[vote.id]);
  const jev = choiceOf(topic.jevVotes[vote.id]);
  if (choice === 'skip') block.classList.add('skipped');

  const choices = element('div', 'choices');
  choices.setAttribute('role', 'group');
  choices.setAttribute('aria-label', `Wie würdest du bei „${vote.title}“ abstimmen?`);
  choices.append(element('span', 'muted', 'Du:'));
  for (const [value, label] of Object.entries(CHOICES)) {
    const button = element('button', 'quiet', label);
    button.type = 'button';
    button.setAttribute('aria-pressed', String(value === choice));
    button.addEventListener('click', () => {
      correct(topic, vote.id, value);
      keepInView(`[data-party="${party.id}"] [data-vote="${vote.id}"]`, render);
    });
    choices.append(button);
  }
  if (choice !== jev) choices.append(element('span', 'muted', `Jev schätzte: ${CHOICES[jev]}`));

  block.append(
    link(vote.url, `${vote.title} (${vote.date}, ${vote.accepted ? 'angenommen' : 'abgelehnt'})`),
    choices,
    element('p', 'vote-position', `${party.short}: ${describePosition(positionOf(vote.results[party.id]))}`),
  );
  return block;
}

/** Re-renders, then scrolls so the element matching `selector` stays where it was on screen. */
function keepInView(selector, update) {
  const before = document.querySelector(selector).getBoundingClientRect().top;
  update();
  const moved = document.querySelector(selector);
  if (moved) window.scrollBy(0, moved.getBoundingClientRect().top - before);
}

/** The quote, who said it, when and where, and a link to the full source. */
function statementSource(topic, { doc, passage }) {
  const who = [doc.speaker, doc.role].filter(Boolean).join(', ');
  const meta = [who, STATEMENT_KINDS[doc.kind], doc.date].filter(Boolean).join(' · ');
  const label = doc.kind === 'rede' ? `${doc.source}: ${shortened(doc.title, 120)}` : `${doc.source}: ${doc.title}`;
  return [quote(topic, passage), element('p', 'statement-meta', meta), link(doc.url, label)];
}

/**
 * The passage's key sentences, with a button for the whole passage. Until
 * they are found, and if that fails, the passage shows cut to a few lines.
 */
function quote(topic, text) {
  const block = element('blockquote', 'clamped', text);
  const id = `${topic.key}\n${text}`;
  if (!excerpts.has(id)) excerpts.set(id, excerpt(apiKey, topic.query, text).catch(() => null));
  excerpts.get(id).then((found) => found && showKeySentences(block, found));
  return block;
}

function showKeySentences(block, { sentences, key }) {
  const whole = key.length === sentences.length;
  block.classList.remove('clamped');
  const parts = [];
  sentences.forEach((sentence, i) => {
    if (!key.includes(i)) {
      if (parts.at(-1) !== '…') parts.push('…');
      return;
    }
    parts.push(sentence);
  });
  block.textContent = parts.join(' ');
  if (whole || block.nextElementSibling?.classList.contains('more')) return;
  const more = element('button', 'more quiet', 'Ganzen Abschnitt lesen');
  more.type = 'button';
  more.addEventListener('click', () => {
    // The whole passage, with the key sentences marked.
    block.replaceChildren(
      ...sentences.flatMap((sentence, i) => [key.includes(i) ? element('mark', '', sentence) : sentence, ' ']),
    );
    more.remove();
  });
  block.after(more);
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

function shortened(text, length) {
  if (text.length <= length) return text;
  return `${text.slice(0, text.lastIndexOf(' ', length))} …`;
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
