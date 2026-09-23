// Draws the result as SVG. All colors come from css/theme.css through the
// class names, so this file only knows geometry.
const SIZE = 200;
const UNIT = SIZE / 20; // one point on a -10…10 axis
const MIN_SPREAD = 3; // keep a very confident reading visible as a halo

const NS = 'http://www.w3.org/2000/svg';

function el(name, attributes, text) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text) node.textContent = text;
  return node;
}

const toX = (score) => SIZE / 2 + score * UNIT;
const toY = (score) => SIZE / 2 - score * UNIT;

/** The economic (x) and authority (y) axes; `scores` comes from axisScores. */
export function drawCompass(svg, scores, t) {
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${SIZE}`);
  const half = SIZE / 2;
  for (const [cls, x, y] of [
    ['auth-left', 0, 0],
    ['auth-right', half, 0],
    ['lib-left', 0, half],
    ['lib-right', half, half],
  ]) {
    svg.append(el('rect', { class: `quadrant ${cls}`, x, y, width: half, height: half }));
  }
  for (let i = UNIT * 2; i < SIZE; i += UNIT * 2) {
    svg.append(el('line', { class: 'grid', x1: i, y1: 0, x2: i, y2: SIZE }));
    svg.append(el('line', { class: 'grid', x1: 0, y1: i, x2: SIZE, y2: i }));
  }
  svg.append(el('line', { class: 'axis', x1: half, y1: 0, x2: half, y2: SIZE }));
  svg.append(el('line', { class: 'axis', x1: 0, y1: half, x2: SIZE, y2: half }));

  svg.append(el('text', { class: 'label', x: half, y: 10, 'text-anchor': 'middle' }, t.auth));
  svg.append(el('text', { class: 'label', x: half, y: SIZE - 4, 'text-anchor': 'middle' }, t.lib));
  svg.append(el('text', { class: 'label', x: 4, y: half - 4 }, t.left));
  svg.append(el('text', { class: 'label', x: SIZE - 4, y: half - 4, 'text-anchor': 'end' }, t.right));

  const { right, auth } = scores;
  if (!right || !auth) return;
  const cx = toX(right.score);
  const cy = toY(auth.score);
  svg.append(
    el('ellipse', {
      class: 'spread',
      cx,
      cy,
      rx: Math.max(right.spread * UNIT, MIN_SPREAD),
      ry: Math.max(auth.spread * UNIT, MIN_SPREAD),
    }),
  );
  svg.append(el('circle', { class: 'you', cx, cy, r: 4 }));
}

/** The social axis as a bar, conservative on the left. */
export function drawSocialBar(svg, prog, t) {
  const height = 26;
  svg.replaceChildren();
  svg.setAttribute('viewBox', `0 0 ${SIZE} ${height}`);
  const gradient = el('linearGradient', { id: 'social-gradient' });
  gradient.append(el('stop', { class: 'conservative-stop', offset: 0 }));
  gradient.append(el('stop', { class: 'progressive-stop', offset: 1 }));
  const defs = el('defs', {});
  defs.append(gradient);
  svg.append(defs);
  svg.append(el('rect', { class: 'social-bar', x: 0, y: 0, width: SIZE, height: 12, rx: 6 }));
  svg.append(el('text', { class: 'label', x: 0, y: height - 1 }, t.conservative));
  svg.append(el('text', { class: 'label', x: SIZE, y: height - 1, 'text-anchor': 'end' }, t.progressive));
  if (!prog) return;
  const cx = toX(prog.score);
  const halfWidth = Math.max(prog.spread * UNIT, MIN_SPREAD);
  svg.append(el('rect', { class: 'spread', x: cx - halfWidth, y: 0, width: 2 * halfWidth, height: 12, rx: 6 }));
  svg.append(el('circle', { class: 'you', cx, cy: 6, r: 4 }));
}
