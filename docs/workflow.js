// Fills each Jev task of workflow.html with the prompt the page actually
// sends, built by js/analysis.js from a small example.
import {
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

const passage = { id: 'spd-12', page: 7, text: 'Wir wollen den Mindestlohn auf 15 Euro anheben.' };
const statement = {
  doc: { id: 's42', kind: 'rede', speaker: 'Beispiel Rednerin', role: null, date: '2025-06-06', title: 'Mindestlohn' },
  passage: '15 Euro Mindestlohn jetzt!',
};
const vote = { id: 'vote-1', date: '2022-06-03', title: 'Anhebung des Mindestlohns', description: 'Der Mindestlohn steigt auf 12 Euro.' };

const programEvidence = evidenceOf('program', { spd: [passage] });
const statementEvidence = evidenceOf('statements', { spd: [statement] });
const allRelevant = (evidence) => relevantEvidence(evidence, { [passage.id]: { noul: 1 }, [statement.doc.id]: { noul: 1 } });

const REQUESTS = {
  'program-relevance': buildRelevanceRequest('program', TOPIC, OPINION, programEvidence),
  'program-match': buildMatchRequest('program', TOPIC, OPINION, allRelevant(programEvidence)),
  'vote-relevance': buildVoteRelevanceRequest(TOPIC, OPINION, [vote]),
  'vote-direction': buildVoteDirectionRequest(TOPIC, OPINION, relevantVotes([vote], { [vote.id]: { noul: 1 } })),
  'statements-relevance': buildRelevanceRequest('statements', TOPIC, OPINION, statementEvidence),
  'statements-match': buildMatchRequest('statements', TOPIC, OPINION, allRelevant(statementEvidence)),
};

const element = (name, className, text) => {
  const node = document.createElement(name);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** A question as Jev gets it: its type, its instructions, and its answer options. */
function question([key, { type, instructions, criteria }]) {
  const block = element('div', 'question');
  block.append(element('p', 'meta', `${key} · ${type}`), element('p', '', instructions));
  const options = Array.isArray(criteria) ? criteria : Object.entries(criteria ?? {}).map(([k, v]) => v ?? k);
  if (options.length) {
    const list = element('ol', 'criteria');
    list.append(...options.map((option) => element('li', '', option)));
    block.append(list);
  }
  return block;
}

function prompt(request) {
  const nodes = [
    element('p', 'muted', 'So fragt die Seite Jev, hier für „Der Mindestlohn soll auf 15 Euro steigen.“ Die Fragen sind englisch, wie Jev sie bekommt.'),
    element('p', 'meta', 'Lesehinweis'),
    element('p', 'how', request.state.how_to_read),
    ...Object.entries(request.questions).map(question),
  ];
  // The whole request, to see everything Jev is given.
  const whole = element('details', 'request');
  whole.append(element('summary', '', 'Ganze Anfrage als JSON'), element('pre', '', JSON.stringify(request, null, 2)));
  return [...nodes, whole];
}

const panel = document.getElementById('panel');
panel.querySelector('.close').addEventListener('click', () => panel.close());
// A click on the backdrop lands on the dialog element itself.
panel.addEventListener('click', (event) => event.target === panel && panel.close());

for (const card of document.querySelectorAll('.card')) {
  card.addEventListener('click', () => {
    const name = card.dataset.panel;
    document.getElementById('panel-title').textContent = card.querySelector('strong').textContent;
    const body = REQUESTS[name] ? prompt(REQUESTS[name]) : [document.getElementById(name).content.cloneNode(true)];
    document.getElementById('panel-body').replaceChildren(...body);
    panel.showModal();
  });
}
