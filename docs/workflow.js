// Fills each Jev task of workflow.html with the request the page actually
// sends, built by js/analysis.js from a small example, and shows it the way
// Jev meets it: what it reads, and each question with a made-up answer.
import {
  COVERED,
  buildMatchRequest,
  buildRelevanceRequest,
  buildVoteDirectionRequest,
  buildVoteRelevanceRequest,
  evidenceOf,
  relevantEvidence,
  relevantVotes,
} from '../js/analysis.js';

const TOPIC = 'Mindestlohn';
const OPINION = 'Der Mindestlohn soll auf 15 Euro steigen.';

const passages = [
  { id: 'spd-12', page: 7, text: 'Wir wollen den Mindestlohn auf 15 Euro anheben.' },
  { id: 'spd-31', page: 19, text: 'Die Mindestlohnkommission soll sich künftig an 60 Prozent des Medianlohns orientieren.' },
  { id: 'spd-40', page: 24, text: 'Gute Arbeit braucht starke Tarifverträge und Mitbestimmung.' },
];
const statements = [
  {
    doc: { id: 's42', kind: 'rede', speaker: 'Beispiel Rednerin', role: null, date: '2025-06-06', title: 'Mindestlohn' },
    passage: '15 Euro Mindestlohn jetzt!',
  },
  {
    doc: { id: 's77', kind: 'fraktion', speaker: null, role: null, date: '2025-05-12', title: 'Arbeit und Soziales' },
    passage: 'Wir stärken die Tarifbindung in Deutschland.',
  },
];
const votes = [
  { id: 'vote-1', date: '2022-06-03', title: 'Anhebung des Mindestlohns', description: 'Der Mindestlohn steigt auf 12 Euro.' },
  { id: 'vote-2', date: '2022-11-10', title: 'Bürgergeld-Gesetz', description: 'Das Bürgergeld ersetzt Hartz IV.' },
  // A vote on a recommendation to reject a motion: Jev judges the motion, the code turns the answer round.
  {
    id: 'hand-3',
    date: '2025-11-06',
    title: 'Ablehnung: Mindestlohn auf 15 Euro sofort',
    rejects: 'Mindestlohn auf 15 Euro sofort',
    description: 'Der Ausschuss empfiehlt, den Antrag „Mindestlohn auf 15 Euro sofort“ abzulehnen. Wer stimmt für diese Beschlussempfehlung? Ergebnis: angenommen.',
  },
];

// Made-up answers to step 1. The step 2 examples are built from the items
// that pass them, as the app does, so the panels tell one consistent story.
const EXAMPLE_RELEVANCE = { 'spd-12': 0.91, 'spd-31': 0.74, 'spd-40': 0.18, s42: 0.87, s77: 0.21, 'vote-1': 0.88, 'vote-2': 0.12, 'hand-3': 0.93 };
const relevanceAnswers = Object.fromEntries(Object.entries(EXAMPLE_RELEVANCE).map(([id, noul]) => [id, { noul }]));

const programEvidence = evidenceOf('program', { spd: passages });
const statementEvidence = evidenceOf('statements', { spd: statements });

const REQUESTS = {
  'program-relevance': buildRelevanceRequest('program', TOPIC, OPINION, programEvidence),
  'program-match': buildMatchRequest('program', TOPIC, OPINION, relevantEvidence(programEvidence, relevanceAnswers)),
  'vote-relevance': buildVoteRelevanceRequest(TOPIC, OPINION, votes),
  'vote-direction': buildVoteDirectionRequest(TOPIC, OPINION, relevantVotes(votes, relevanceAnswers)),
  'statements-relevance': buildRelevanceRequest('statements', TOPIC, OPINION, statementEvidence),
  'statements-match': buildMatchRequest('statements', TOPIC, OPINION, relevantEvidence(statementEvidence, relevanceAnswers)),
};

// Made-up answers to step 2: the first option is the likeliest.
const EXAMPLE_LEVELS = [0.02, 0.03, 0.1, 0.3, 0.55];
const exampleChoice = (count) => Array.from({ length: count }, (_, i) => (i === 0 ? 0.8 : 0.2 / (count - 1)));

// The page's CSS draws every 0–1 bar's threshold mark from this.
document.documentElement.style.setProperty('--covered', COVERED);

const decimal = (value, digits = 2) =>
  value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const percent = (value) => `${Math.round(value * 100)} %`;

const element = (name, className, ...children) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  node.append(...children.filter((child) => child !== null && child !== undefined));
  return node;
};

/** A 0–1 bar with the threshold marked. */
const meter = (value) => {
  const bar = element('span', 'meter', element('span', 'fill'), element('span', 'mark'));
  bar.style.setProperty('--value', value);
  return bar;
};

// Criteria read "Label: what it means"; the label is what a reader scans for.
const labelled = (text) => {
  const [label, ...rest] = text.split(': ');
  return rest.length ? [element('strong', '', label), ` ${rest.join(': ')}`] : [element('strong', '', text)];
};

/** One excerpt or vote as Jev reads it: its text, with the other fields as small facts. */
function item({ id, text, titel, beschreibung, ...fields }) {
  const facts = element('p', 'fields', element('code', '', id));
  for (const [key, value] of Object.entries(fields)) {
    if (value !== null) facts.append(element('span', '', element('i', '', key), ` ${value}`));
  }
  return element('li', 'item', facts, titel ? element('strong', '', titel) : null, element('p', '', text ?? beschreibung));
}

function material(value) {
  if (Array.isArray(value)) return element('ul', 'items', ...value.map(item));
  const groups = Object.entries(value).filter(([, items]) => items.length);
  return element(
    'div',
    'groups',
    ...groups.map(([party, items]) => element('div', '', element('p', 'party', party), material(items))),
  );
}

function state({ person, lesehinweis, ...rest }) {
  return [
    element(
      'div',
      'person-card',
      element('span', 'chip person', person.thema),
      element('p', '', `„${person.meinung}“`),
    ),
    element('p', 'hint', element('i', '', 'Lesehinweis'), ` ${lesehinweis}`),
    ...Object.values(rest).map(material),
  ];
}

/** How Jev would answer one question, drawn as the control it amounts to. */
function answer(key, { type, criteria }) {
  if (type === 'noul') {
    const value = EXAMPLE_RELEVANCE[key];
    const kept = value >= COVERED;
    return element(
      'div',
      'noul',
      meter(value),
      element('p', 'reading', element('strong', '', decimal(value)), element('span', kept ? 'kept' : 'dropped', kept ? 'bleibt' : 'fällt weg')),
    );
  }
  const options = Array.isArray(criteria) ? criteria : Object.entries(criteria).map(([id, meaning]) => meaning ?? id);
  const probabilities = type === 'score' ? EXAMPLE_LEVELS : exampleChoice(options.length);
  const likeliest = probabilities.indexOf(Math.max(...probabilities));
  const list = element(
    'ol',
    type,
    ...options.map((option, i) =>
      element(
        'li',
        i === likeliest ? 'picked' : '',
        element('span', 'option', ...labelled(option)),
        element('span', 'share', meter(probabilities[i]), percent(probabilities[i])),
      ),
    ),
  );
  if (type !== 'score') return list;
  const score = probabilities.reduce((sum, p, level) => sum + p * level, 0);
  return element('div', '', list, element('p', 'reading', 'Wert ', element('strong', '', decimal(score, 1)), ' auf der Skala 0 bis 4'));
}

const explainer = (name, text) => {
  const button = element('button', `term ${name === 'jev' ? 'jev' : 'voyage'}`, text);
  button.type = 'button';
  button.dataset.panel = name;
  return button;
};

const TYPES = { noul: 'Wahrscheinlichkeit', choice: 'Auswahl', score: 'Skala' };

function question([key, spec]) {
  // For a recommendation to reject, the answer is about the motion; the app turns it round.
  const turned = spec.type === 'choice' && votes.find((vote) => vote.id === key)?.rejects;
  return element(
    'li',
    'question',
    element('p', 'fields', element('code', '', key), element('span', 'type', `${spec.type} · ${TYPES[spec.type]}`)),
    element('p', '', spec.instructions),
    element('div', 'answer', element('span', 'example', 'Beispielantwort'), answer(key, spec)),
    turned ? element('p', 'muted', 'Ein Ja zur Empfehlung lehnt diesen Antrag ab. Die App dreht die Antwort deshalb um: Hin wird zu weg.') : null,
  );
}

function prompt(request) {
  return [
    element('p', 'muted', 'So bekommt Jev die Aufgabe, gebaut vom Code der App für ein Beispiel. Die Antworten sind ausgedacht.'),
    element('p', 'meta', 'Jev liest'),
    ...state(request.state),
    element('p', 'meta', 'Jev antwortet'),
    element('ol', 'questions', ...Object.entries(request.questions).map(question)),
    explainer('jev', 'Jev erklärt'),
    element(
      'details',
      'request',
      element('summary', '', 'Ganze Anfrage als JSON'),
      element('pre', '', JSON.stringify(request, null, 2)),
    ),
  ].filter(Boolean);
}

/**
 * What Jev is, and the three kinds of question the app asks it, each with a
 * made-up answer drawn like in the steps. The questions and options are the
 * app's own, taken from the requests above.
 */
function jevExplained() {
  const kinds = [
    ['Ja oder nein', 'Sagt der Auszug etwas zur Forderung?', 'spd-12', REQUESTS['program-relevance'].questions['spd-12'],
      'Ab 0,5 hält Jev ein Ja für wahrscheinlicher als ein Nein. Darunter fällt der Beleg weg.'],
    ['Eine von mehreren', 'Wohin führt ein Ja: zur Forderung hin oder weg?', 'vote-1', REQUESTS['vote-direction'].questions['vote-1'], null],
    ['Auf einer Skala', 'Wo steht die Partei zur Forderung?', 'spd_match', REQUESTS['program-match'].questions.spd_match, null],
  ];
  return [
    element('p', 'lead-in', 'Jev ist ein Entscheidungsmodell von TypeSafe. Es schreibt keinen Text, sondern beantwortet fest gestellte Fragen mit Wahrscheinlichkeiten.'),
    element(
      'ol',
      'questions',
      ...kinds.map(([name, asked, key, spec, note]) =>
        element(
          'li',
          'question',
          element('p', 'kind', name),
          element('p', '', asked),
          element('div', 'answer', element('span', 'example', 'Beispielantwort'), answer(key, spec)),
          note ? element('p', 'muted', note) : null,
        ),
      ),
    ),
    element(
      'dl',
      'facts',
      element('dt', '', 'Gut für'),
      element('dd', '', 'Jede Partei bekommt dieselbe Frage, und die Antworten lassen sich vergleichen. Schnell und günstig, ohne erfundene Begründungen.'),
      element('dt', '', 'Grenze'),
      element('dd', '', 'Jev urteilt nur über das, was es liest: die gefundenen Auszüge, nicht das ganze Programm.'),
    ),
  ];
}

// Panels built here rather than from a template.
const PANELS = { jev: { title: 'Jev erklärt', build: jevExplained } };

const panel = document.getElementById('panel');
panel.querySelector('.close').addEventListener('click', () => panel.close());
// A click on the backdrop lands on the dialog element itself.
panel.addEventListener('click', (event) => event.target === panel && panel.close());

// Cards, the explainer buttons, and links inside the panel all open a panel by name.
document.addEventListener('click', (event) => {
  const trigger = event.target.closest('[data-panel]');
  if (!trigger) return;
  const name = trigger.dataset.panel;
  const template = document.getElementById(name);
  document.getElementById('panel-title').textContent =
    trigger.querySelector('strong')?.textContent ?? template?.dataset.title ?? PANELS[name].title;
  const body = REQUESTS[name] ? prompt(REQUESTS[name]) : PANELS[name] ? PANELS[name].build() : [template.content.cloneNode(true)];
  document.getElementById('panel-body').replaceChildren(...body);
  if (!panel.open) panel.showModal();
  panel.scrollTop = 0;
});
