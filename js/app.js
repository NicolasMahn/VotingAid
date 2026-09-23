import { askJev, findApiKey, isApiKey, rememberApiKey } from './jev.js';
import { axisScores, buildRequest, readAnswers } from './reading.js';
import { STATEMENTS } from './statements.js';
import { STRINGS, pickLanguage } from './strings.js';
import { drawCompass, drawSocialBar } from './compass.js';

const STORAGE_KEY = 'compass.progress';
const $ = (id) => document.getElementById(id);

// Replies are kept in this browser so a reload or a closed tab loses nothing.
const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
const state = {
  language: pickLanguage(saved.language, navigator.language),
  index: Math.min(saved.index ?? 0, STATEMENTS.length - 1),
  replies: saved.replies ?? {},
  view: 'question',
  readings: null,
};

function save() {
  const { language, index, replies } = state;
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ language, index, replies }));
}

const t = () => STRINGS[state.language];
const answeredCount = () => STATEMENTS.filter((s) => state.replies[s.id]?.trim()).length;

function show(view) {
  state.view = view;
  for (const section of document.querySelectorAll('main > section')) section.hidden = section.id !== view;
  render();
}

function render() {
  const s = t();
  document.documentElement.lang = state.language;
  document.title = s.title;
  $('title').textContent = s.title;
  $('language').textContent = state.language === 'en' ? 'Deutsch' : 'English';
  $('privacy').textContent = s.privacy;
  for (const id of ['back', 'skip', 'retry', 'edit', 'restart']) $(id).textContent = s[id];
  $('finish-early').textContent = s.finishEarly;
  $('failure-back').textContent = s.back;
  $('key-prompt').textContent = s.keyPrompt;
  $('key-save').textContent = s.keySave;
  $('reading-text').textContent = s.reading;
  $('reply').placeholder = s.placeholder;
  $('hint').textContent = s.hint;

  if (state.view === 'question') renderQuestion();
  if (state.view === 'result') renderResult();
}

function renderQuestion() {
  const s = t();
  const statement = STATEMENTS[state.index];
  const isLast = state.index === STATEMENTS.length - 1;
  $('progress').textContent = `${state.index + 1} / ${STATEMENTS.length}`;
  $('statement').textContent = statement[state.language];
  $('reply').value = state.replies[statement.id] ?? '';
  $('back').disabled = state.index === 0;
  $('next').textContent = isLast ? s.finish : s.next;
  $('skip').hidden = isLast;
  $('finish-early').hidden = isLast || answeredCount() === 0;
}

function renderResult() {
  const s = t();
  const scores = axisScores(state.readings);
  drawCompass($('compass'), scores, s);
  drawSocialBar($('social'), scores.prog, s);
  $('compass').setAttribute('aria-label', describe(scores));
  $('scores').textContent = describe(scores);
  $('counted').textContent = s.counted(Object.keys(state.readings).length, STATEMENTS.length);

  $('readings').replaceChildren(
    ...STATEMENTS.filter((statement) => state.readings[statement.id]).map((statement) => {
      const reading = state.readings[statement.id];
      const item = document.createElement('li');
      const text = document.createElement('p');
      const reply = document.createElement('blockquote');
      const verdict = document.createElement('p');
      text.textContent = statement[state.language];
      reply.textContent = state.replies[statement.id];
      verdict.className = `verdict level-${reading.likeliest}`;
      verdict.textContent = `${s.levels[reading.likeliest]} · ${s.certainty(reading.probability)}`;
      item.append(text, reply, verdict);
      item.tabIndex = 0;
      item.addEventListener('click', () => goTo(STATEMENTS.indexOf(statement)));
      item.addEventListener('keydown', (event) => event.key === 'Enter' && goTo(STATEMENTS.indexOf(statement)));
      return item;
    }),
  );
}

function describe(scores) {
  const s = t();
  return Object.entries(scores)
    .filter(([, value]) => value)
    .map(([axis, { score, spread }]) => `${s.axisNames[axis]} ${oneDecimal(score)} ± ${oneDecimal(spread)}`)
    .join(' · ');
}

// Rounding first keeps a tiny negative score from showing as "-0.0".
const oneDecimal = (value) => (Math.round(value * 10) / 10 || 0).toFixed(1);

function keepReply() {
  state.replies[STATEMENTS[state.index].id] = $('reply').value;
  save();
}

function goTo(index) {
  state.index = index;
  save();
  show('question');
  $('reply').focus();
}

async function finish() {
  keepReply();
  if (answeredCount() === 0) {
    $('hint').textContent = t().noAnswers;
    return;
  }
  const apiKey = await findApiKey();
  if (!apiKey) {
    show('key');
    $('key-input').focus();
    return;
  }
  show('reading');
  try {
    const response = await askJev(apiKey, buildRequest(state.replies, state.language));
    state.readings = readAnswers(response.answers);
    show('result');
    window.scrollTo(0, 0);
  } catch (error) {
    $('failure-text').textContent = `${t().failed}: ${error.message}`;
    show('failure');
  }
}

$('next').addEventListener('click', () => {
  keepReply();
  if (state.index === STATEMENTS.length - 1) return finish();
  goTo(state.index + 1);
});
$('skip').addEventListener('click', () => {
  $('reply').value = '';
  keepReply();
  goTo(state.index + 1);
});
$('back').addEventListener('click', () => {
  keepReply();
  goTo(state.index - 1);
});
$('finish-early').addEventListener('click', finish);
$('reply').addEventListener('input', keepReply);
$('reply').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) $('next').click();
});

$('key-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const key = $('key-input').value.trim();
  if (!isApiKey(key)) return;
  rememberApiKey(key);
  finish();
});

$('retry').addEventListener('click', finish);
$('failure-back').addEventListener('click', () => goTo(state.index));
$('edit').addEventListener('click', () => goTo(0));
$('restart').addEventListener('click', () => {
  if (!confirm(t().restartConfirm)) return;
  state.replies = {};
  goTo(0);
});
$('language').addEventListener('click', () => {
  state.language = state.language === 'en' ? 'de' : 'en';
  save();
  render();
});

show('question');
