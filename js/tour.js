// A short guided tour: the page dims, one control at a time is lifted out,
// and a bubble beside it says what it is for. Steps about results only come
// when there is a result on screen.

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
    results: true,
    text: 'Jede Partei bekommt einen Wert: −10 heißt, sie will das Gegenteil, +10, sie will dasselbe. Tipp auf eine Partei, um ihre Belege zu sehen.',
  },
  { target: '#toggle-weights', results: true, text: 'Hier stellst du ein, wie stark Programme, Abstimmungen und Aussagen zählen.' },
  { target: 'a.how', results: true, text: 'Wie das Ergebnis genau entsteht, zeigt der Ablauf, mit jedem Prompt an Jev.' },
];

const $ = (id) => document.getElementById(id);

let steps = [];
let index = 0;

/** Starts the tour at its first step. */
export function startTour() {
  const hasResults = !$('results').hidden;
  steps = STEPS.filter((step) => (!step.results || hasResults) && document.querySelector(step.target));
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
