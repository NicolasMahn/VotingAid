// The results: an overview that averages the three sources, and one view per
// source with the evidence behind every score.
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
import { PARTIES, programUrl } from './parties.js';
import { describePosition, positionOf } from './votes.js';

const CORRECTIONS_KEY = 'votingaid.voteCorrections';

const SOURCES = ['program', 'votes', 'statements'];
const SOURCE_NAMES = { program: 'Programm', votes: 'Abstimmungen', statements: 'Aussagen' };

// What each view calls a party that has nothing to say.
const SILENCE = {
  overview: { all: 'Zu deinen Themen findet sich nichts von:' },
  program: { all: 'Keine klare Position im Wahlprogramm zu deinen Themen:', one: 'Keine klare Position im Programm', where: 'im Programm' },
  votes: { all: 'Keine passende Abstimmung zu deinen Themen:', one: 'Keine passende Abstimmung', where: 'in Abstimmungen' },
  statements: { all: 'Keine passende Aussage zu deinen Themen:', one: 'Keine passende Aussage', where: 'in Aussagen' },
};

const CHOICES = { yes: 'dafür', no: 'dagegen', skip: 'zählt nicht' };

const $ = (id) => document.getElementById(id);

// The last analysis, kept so switching views and correcting votes need no new requests.
let analysis = null;
let view = 'overview';
// Per opinion, how the person says they would vote where Jev read it wrong.
const corrections = JSON.parse(localStorage.getItem(CORRECTIONS_KEY) ?? '{}');

/** Shows a fresh analysis, starting with the overview. */
export function showAnalysis(result) {
  analysis = result;
  for (const topic of analysis.topics) applyCorrections(topic);
  view = 'overview';
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
  for (const button of document.querySelectorAll('#views button')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === view));
  }
  for (const note of document.querySelectorAll('[data-note]')) note.hidden = note.dataset.note !== view;

  const scored = PARTIES.map((party) => ({ party, ...scoresOf(party) }));
  // Parties that say nothing about any topic are not ranked: a missing
  // position is not a low score, and listing them last would suggest one.
  const ranked = scored.filter(({ overall }) => overall !== null).sort((a, b) => b.overall - a.overall);
  const silent = scored.filter(({ overall }) => overall === null);

  $('ranking').replaceChildren(...ranked.map(rankedParty));
  $('silent').hidden = !silent.length;
  $('silent-text').textContent = SILENCE[view].all;
  $('silent-parties').replaceChildren(...silent.map(({ party }) => element('li', `party-${party.id}`, party.short)));
}

function scoresOf(party) {
  if (view === 'overview') {
    const bySource = Object.fromEntries(SOURCES.map((source) => [source, overallScore(readingsOf(party, source))]));
    return { overall: combinedScore(Object.values(bySource)), bySource };
  }
  const readings = readingsOf(party, view);
  return { overall: overallScore(readings), covered: readings.filter(isCovered).length };
}

const readingsOf = (party, source) => analysis.topics.map((topic) => topic[source][party.id]);

function rankedParty({ party, overall, covered, bySource }) {
  const item = element('li', `party party-${party.id}`);
  item.dataset.party = party.id;
  const details = document.createElement('details');
  const summary = document.createElement('summary');
  summary.append(element('span', 'name', party.short), scoreBar(overall), element('span', 'score', formatScore(overall)));
  const total = analysis.topics.length;
  if (bySource) {
    // One unbreakable part per source, so a narrow screen wraps between them.
    const line = element('span', 'coverage');
    SOURCES.forEach((source, i) => {
      if (i) line.append(' · ');
      line.append(element('span', 'nowrap', `${SOURCE_NAMES[source]} ${bySource[source] === null ? '–' : formatScore(bySource[source])}`));
    });
    summary.append(line);
  } else if (covered < total) {
    summary.append(element('span', 'coverage', `nur ${covered} von ${total} Themen ${SILENCE[view].where} behandelt`));
  }
  details.append(summary, element('p', 'muted', party.name));
  for (const topic of analysis.topics) details.append(view === 'overview' ? topicOverview(topic, party) : finding(topic, party));
  details.addEventListener('toggle', () => details.open && offerMore(details));
  item.append(details);
  return item;
}

/** One topic across all sources, each a link to its evidence. */
function topicOverview(topic, party) {
  const block = element('div', 'finding');
  block.append(element('p', 'finding-topic', topic.topic));
  const list = element('ul', 'source-scores');
  for (const source of SOURCES) {
    const reading = topic[source][party.id];
    const button = element('button', 'source-score quiet');
    button.type = 'button';
    button.append(element('span', '', SOURCE_NAMES[source]));
    if (isCovered(reading)) {
      const level = levelOf(reading.score);
      button.append(element('span', `level-${level}`, `${formatScore(reading.score)} · ${LEVELS[level]}`));
    } else {
      button.append(element('span', 'silent', 'nichts Passendes'));
    }
    button.addEventListener('click', () => showParty(source, party.id));
    const item = document.createElement('li');
    item.append(button);
    list.append(item);
  }
  block.append(list);
  return block;
}

function showParty(source, partyId) {
  view = source;
  render();
  const details = document.querySelector(`[data-party="${partyId}"] details`);
  if (!details) return; // silent in this source
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function finding(topic, party) {
  const reading = topic[view][party.id];
  const block = element('div', 'finding');
  block.append(element('p', 'finding-topic', topic.topic));
  if (!isCovered(reading)) block.append(element('p', 'verdict silent', SILENCE[view].one));
  else {
    const level = levelOf(reading.score);
    block.append(element('p', `verdict level-${level}`, `${formatScore(reading.score)} · ${LEVELS[level]}`));
    if (view !== 'statements' && diverges(topic.program[party.id], topic.votes[party.id])) {
      block.append(element('p', 'divergence', 'Programm und Abstimmungen passen hier nicht zusammen'));
    }
  }
  if (view === 'program' && isCovered(reading)) {
    const passage = analysis.passages.get(reading.sources[0]);
    block.append(quote(passage.text), link(programUrl(party.id, passage.page), `Wahlprogramm ${party.short}, Seite ${passage.page}`));
  } else if (view === 'statements' && isCovered(reading)) {
    block.append(...statementSource(analysis.statements.get(reading.sources[0])));
  } else if (view === 'votes') {
    // Every vote that counts, plus the ones the person took out, so they can put them back.
    const skipped = Object.entries(corrections[topic.key] ?? {})
      .filter(([id, choice]) => choice === 'skip' && positionOf(analysis.votes.get(id)?.results[party.id]))
      .map(([id]) => id);
    // In Jev's order, so a correction does not move the vote the person just corrected.
    const shown = [...(reading?.sources ?? []), ...skipped].sort((a, b) => topic.jevVotes[b].clarity - topic.jevVotes[a].clarity);
    for (const id of shown) block.append(voteSource(topic, analysis.votes.get(id), party));
  }
  return block;
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
      keepInView(party.id, vote.id, () => render());
    });
    choices.append(button);
  }
  if (choice !== jev) choices.append(element('span', 'muted', `Jev schätzte: ${CHOICES[jev]}`));

  block.append(
    element('p', 'vote-title', `${vote.title} (${vote.date}, ${vote.accepted ? 'angenommen' : 'abgelehnt'})`),
    choices,
    element('p', 'vote-position', `${party.short}: ${describePosition(positionOf(vote.results[party.id]))}`),
    link(vote.url, 'Abstimmung auf abgeordnetenwatch.de'),
  );
  return block;
}

/** Re-renders, then brings the same vote of the same party back to where it was on screen. */
function keepInView(partyId, voteId, update) {
  const selector = `[data-party="${partyId}"] [data-vote="${voteId}"]`;
  const before = document.querySelector(selector).getBoundingClientRect().top;
  const open = [...document.querySelectorAll('#ranking details[open]')].map((d) => d.parentElement.dataset.party);
  update();
  for (const id of open) {
    const details = document.querySelector(`[data-party="${id}"] details`);
    if (details) details.open = true;
  }
  const moved = document.querySelector(selector);
  if (moved) window.scrollBy(0, moved.getBoundingClientRect().top - before);
}

/** The quote, who said it, when and where, and a link to the full source. */
function statementSource({ doc, passage }) {
  const who = [doc.speaker, doc.role].filter(Boolean).join(', ');
  const meta = [who, STATEMENT_KINDS[doc.kind], doc.date].filter(Boolean).join(' · ');
  const nodes = [quote(passage), element('p', 'statement-meta', meta)];
  if (doc.kind === 'rede' && doc.title) nodes.push(element('p', 'statement-context', `Debatte: ${shortened(doc.title, 160)}`));
  const label = doc.kind === 'rede' ? `${doc.source} (PDF)` : `${doc.source}: ${doc.title}`;
  nodes.push(link(doc.url, label));
  return nodes;
}

// Quotes are cut to a few lines; offerMore adds a button where that hides text.
const quote = (text) => element('blockquote', 'clamped', text);

function offerMore(details) {
  for (const block of details.querySelectorAll('blockquote.clamped:not([data-checked])')) {
    block.dataset.checked = '';
    if (block.scrollHeight <= block.clientHeight + 1) continue;
    const more = element('button', 'more quiet', 'Ganzen Abschnitt lesen');
    more.type = 'button';
    more.addEventListener('click', () => {
      block.classList.remove('clamped');
      more.remove();
    });
    block.after(more);
  }
}

/** A bar from the middle: left for contradiction, right for agreement. */
function scoreBar(score) {
  const bar = element('span', 'bar');
  const fill = document.createElement('span');
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

for (const button of document.querySelectorAll('#views button')) {
  button.addEventListener('click', () => {
    view = button.dataset.view;
    render();
  });
}
