// Two short guided tours, one for writing the topics and one for reading the
// result: the page dims, one control at a time is lifted out, and a bubble
// beside it says what it is for.

const STEPS = [
  { target: '.topic .topic-name', text: 'Wähl ein Thema, zum Beispiel „Mindestlohn“.' },
  { target: '.topic .suggest', text: 'Keine Idee? Der Würfel schlägt ein Thema vor.' },
  {
    target: '.topic .topic-opinion',
    text: 'Schreib in einem Satz, was passieren soll. Je konkreter, desto besser: „Der Mindestlohn soll auf 15 Euro steigen.“',
  },
  { target: '.topic .weight', text: 'Ist dir ein Thema besonders wichtig? Lass es doppelt oder vierfach zählen.' },
  { target: '#add', text: 'Nimm ruhig mehrere Themen, dann wird das Ergebnis aussagekräftiger.' },
  { target: '#analyse', text: 'Jev vergleicht deine Sätze mit Wahlprogrammen, Abstimmungen im Bundestag und Aussagen.' },
  {
    target: '#ranking > li:first-child',
    tour: 'results',
    text: 'Jede Partei bekommt einen Wert: −10 heißt, sie will das Gegenteil von dir, +10, sie will dasselbe.',
  },
  {
    target: '#ranking > li:first-child',
    tour: 'results',
    text: 'Tipp auf eine Partei für ihre Werte je Thema und Quelle, dann auf einen Wert für die Belege. Ein Strich heißt, die Quelle sagt dazu nichts Klares.',
  },
  { target: '#ranking > li.silent', tour: 'results', text: 'Grau am Ende stehen Parteien, die zu deinen Themen nichts Passendes gesagt haben. Sie haben keinen Wert, keinen schlechten.' },
  { target: '#toggle-weights', tour: 'results', text: 'Hier stellst du ein, wie stark Programme, Abstimmungen und Aussagen zählen.' },
  { target: 'a.how', tour: 'results', text: 'Wie das Ergebnis genau entsteht, zeigt der Ablauf, mit jedem Prompt an Jev.' },
];

const $ = (id) => document.getElementById(id);

let steps = [];
let index = 0;

/** Starts one of the tours, 'input' or 'results', at its first step. */
export function startTour(tour) {
  steps = STEPS.filter((step) => (step.tour ?? 'input') === tour && document.querySelector(step.target));
  index = 0;
  $('tour').hidden = false;
  document.addEventListener('keydown', onKey);
  addEventListener('resize', place);
  addEventListener('scroll', place, { passive: true });
  show();
}

function stop() {
  $('tour').hidden = true;
  document.removeEventListener('keydown', onKey);
  removeEventListener('resize', place);
  removeEventListener('scroll', place);
}

function go(step) {
  if (step < 0) return;
  if (step >= steps.length) return stop();
  index = step;
  show();
}

function show() {
  const step = steps[index];
  $('tour-text').textContent = step.text;
  $('tour-count').textContent = `${index + 1} von ${steps.length}`;
  $('tour-back').disabled = index === 0;
  $('tour-next').textContent = index === steps.length - 1 ? 'Fertig' : 'Weiter';
  document.querySelector(step.target).scrollIntoView({ block: 'center', behavior: 'smooth' });
  place();
  $('tour-next').focus({ preventScroll: true });
}

/** Lifts the step's control out of the dimmed page and sets the bubble beneath it, or above if there is no room. */
function place() {
  if ($('tour').hidden) return;
  const box = document.querySelector(steps[index].target).getBoundingClientRect();
  const pad = 6;
  const spot = $('tour-spot');
  spot.style.top = `${box.top - pad}px`;
  spot.style.left = `${box.left - pad}px`;
  spot.style.width = `${box.width + 2 * pad}px`;
  spot.style.height = `${box.height + 2 * pad}px`;

  const bubble = $('tour-bubble');
  const margin = 12;
  const below = box.bottom + pad + margin;
  const fitsBelow = below + bubble.offsetHeight < innerHeight;
  bubble.style.top = `${fitsBelow ? below : Math.max(margin, box.top - pad - margin - bubble.offsetHeight)}px`;
  const left = Math.min(Math.max(margin, box.left), innerWidth - bubble.offsetWidth - margin);
  bubble.style.left = `${left}px`;
}

function onKey(event) {
  if (event.key === 'Escape') stop();
  else if (event.key === 'ArrowRight') go(index + 1);
  else if (event.key === 'ArrowLeft') go(index - 1);
}

$('tour-next').addEventListener('click', () => go(index + 1));
$('tour-back').addEventListener('click', () => go(index - 1));
$('tour-close').addEventListener('click', stop);
// A click on the dimmed page ends the tour, as closing a dialog would.
$('tour').addEventListener('click', (event) => event.target === $('tour') && stop());
