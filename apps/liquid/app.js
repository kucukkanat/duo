// Liquid Fold — glowing liquid that bursts through the crease when the phone unfolds.
import { fold, unlock, haptic as kitHaptic, shareFile, recordCanvas, videoExt, toast, mountChrome, keepAwake } from '../../shared/kit.js';
import { Fluid } from './sim.js';
import { GLRenderer, CanvasRenderer, hex } from './render.js';
import { Sfx } from './audio.js';

const $ = s => document.querySelector(s);
// Haptics only after the first user gesture (avoids blocked-vibrate console errors on auto events).
const haptic = p => { if (!navigator.userActivation || navigator.userActivation.hasBeenActive) kitHaptic(p); };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const easeOut = t => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
const easeInOut = t => { t = clamp(t, 0, 1); return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
const easeOutBack = t => { t = clamp(t, 0, 1); const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const NOADAPT = /[?&]noadapt/.test(location.search);
const coarse = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- themes (see DESIGN.md)
const THEMES = [
  { id: 'lava', name: 'Lava', body: ['#ff4a12', '#ff7a1a', '#ffb02e'], hot: '#ffd25a', crustC: '#2a0703', bg: ['#1a0604', '#040101'], glowC: '#ff5a1f', glow: 1.1, iri: 0.05, metal: 0, crust: 0.85, pops: ['#ffe36b', '#ff2a00', '#ffffff'] },
  { id: 'mercury', name: 'Mercury', body: ['#c8d0da', '#aab4c0', '#e8edf3'], hot: '#ffffff', crustC: '#4a5260', bg: ['#161a22', '#030405'], glowC: '#9fb4d0', glow: 0.35, iri: 0.18, metal: 1, crust: 0, pops: ['#ffd27a', '#8fd3ff', '#ff9fd0'] },
  { id: 'ocean', name: 'Ocean', body: ['#0a84ff', '#00c2ff', '#1a4dff'], hot: '#4ff0ff', crustC: '#02163f', bg: ['#031a33', '#01040b'], glowC: '#19b4ff', glow: 0.9, iri: 0.3, metal: 0, crust: 0, pops: ['#3ff2c0', '#ffffff', '#7a5cff'] },
  { id: 'aurora', name: 'Aurora', body: ['#38ff9c', '#00e1ff', '#9d6bff'], hot: '#9effd2', crustC: '#2b1268', bg: ['#0c0a26', '#020108'], glowC: '#5affc0', glow: 1.0, iri: 0.6, metal: 0, crust: 0, pops: ['#ff6bd5', '#fff36b', '#38ff9c'] },
  { id: 'neon', name: 'Neon', body: ['#ff2bd6', '#00f0ff', '#b14bff'], hot: '#ff9df0', crustC: '#3a0050', bg: ['#14041f', '#000000'], glowC: '#ff3be0', glow: 1.3, iri: 0.4, metal: 0, crust: 0, pops: ['#b6ff00', '#00f0ff', '#ffea00'] },
];
for (const t of THEMES) {
  t.bodyC = t.body.map(hex); t.hotC = hex(t.hot); t.crustC = hex(t.crustC);
  t.bg0 = hex(t.bg[0]); t.bg1 = hex(t.bg[1]); t.glowC = hex(t.glowC); t.popC = t.pops.map(hex);
}
let themeIdx = 0;
try { const i = THEMES.findIndex(t => t.id === localStorage.getItem('liquid.theme')); if (i >= 0) themeIdx = i; } catch {}
let theme = THEMES[themeIdx];

// ---------------------------------------------------------------- renderer
const canvas = $('#gl');
let R, isGL = true;
try { R = new GLRenderer(canvas); }
catch (e) { isGL = false; R = new CanvasRenderer(canvas); }

// ---------------------------------------------------------------- simulation setup
let W = innerWidth, H = innerHeight;
const startOpen = fold.state.open;
const area = W * H * (startOpen ? 0.5 : 1);
let budget = coarse ? 2300 : 3000;
const MAX = 4200;
const F = new Fluid(MAX);
{
  const fill = 0.25, a = area * fill / budget, s = Math.sqrt(2 * a / Math.sqrt(3));
  F.setH(clamp(2.3 * s, 9, 30));
}
const h = F.h;
const G = 0.011 * h;            // gravity, px / substep^2
const GAP = 2.1 * h;
const splatR = 1.2 * h;

function themeColor(x, y, out, th = theme) {
  const t = 0.5 + 0.5 * Math.sin(x * 0.011 + y * 0.007 + 1.3) * Math.cos(y * 0.013 - x * 0.004);
  const u = 0.5 + 0.5 * Math.sin(x * 0.021 - y * 0.017 + 4.0);
  const [a, b, c] = th.bodyC;
  for (let k = 0; k < 3; k++) out[k] = lerp(lerp(a[k], b[k], t), c[k], u * u * 0.8);
  return out;
}

function seed(region) {
  const [x0, y0, x1, y1] = region;
  const s = h / 2.3, rowH = s * 0.866, c = [0, 0, 0];
  F.n = 0;
  for (let r = 0; F.n < budget; r++) {
    const y = y1 - 4 - r * rowH;
    if (y < y0 + 4) break;
    for (let x = x0 + 4 + (r & 1) * s / 2; x < x1 - 4 && F.n < budget; x += s) {
      themeColor(x, y, c);
      F.add(x + (Math.random() - 0.5) * 0.3, y, 0, 0, c[0], c[1], c[2]);
    }
  }
}

// world/wall geometry ---------------------------------------------------
let mode = 'closed';         // closed | unfolding | open | folding
let anim = null;             // active transition
const st = { cam: [0, 0, W, H], wallGrow: 1, flash: 0, reveal: 1, time: 0, light: [-0.3, -0.95], theme, splatR };
let camAnim = null;
let simT = 0;                 // simulation clock (ms); transitions run on it so slow frames don't skip the show
let shake = 0;
let gOverride = null;        // {x,y,w}

function axisFor(state) { return state.crease === 'horizontal' ? 1 : 0; }
function setWall(axis, W, H, gapHalf) {
  Object.assign(F.wall, { on: true, axis, pos: axis ? H / 2 : W / 2, gapC: axis ? W / 2 : H / 2, gapHalf, thick: 3.5 });
}

F.W = W; F.H = H;
if (startOpen) {
  const ax = axisFor(fold.state);
  setWall(ax, W, H, GAP);
  seed(ax ? [0, 0, W, H / 2] : [0, 0, W / 2, H]);
  mode = 'open';
} else seed([0, 0, W, H]);

// Map every particle from an old (oW x oH) world into `region` of the new one,
// keeping pooled depth proportional (area-preserving). Returns the matching camera rect.
function remap(oW, oH, region) {
  const [rx0, ry0, rx1, ry1] = region;
  const kx = (rx1 - rx0) / oW, s = 1 / kx, rad = 0.4 * h;
  for (let i = 0; i < F.n; i++) {
    F.x[i] = rx0 + F.x[i] * kx;
    F.y[i] = Math.max(ry0 + rad + Math.random(), ry1 - (oH - F.y[i]) * s);
    F.px[i] = F.x[i]; F.py[i] = F.y[i];
    F.vx[i] *= kx; F.vy[i] *= s;
  }
  return [rx0, ry1 - s * oH, rx1, ry1];
}

// ---------------------------------------------------------------- sparks (spray droplets)
const SP = { max: 600, n: 0, x: new Float32Array(600), y: new Float32Array(600), vx: new Float32Array(600), vy: new Float32Array(600), life: new Float32Array(600), r: new Float32Array(600), g: new Float32Array(600), b: new Float32Array(600) };
function spark(x, y, vx, vy, c) {
  if (SP.n >= SP.max) return;
  const i = SP.n++;
  SP.x[i] = x; SP.y[i] = y; SP.vx[i] = vx; SP.vy[i] = vy; SP.life[i] = 0.7 + Math.random() * 0.3;
  SP.r[i] = c[0]; SP.g[i] = c[1]; SP.b[i] = c[2];
}
function updateSparks(dt, gx, gy) {
  for (let i = 0; i < SP.n; i++) {
    SP.vx[i] += gx * dt; SP.vy[i] += gy * dt;
    SP.vx[i] *= 0.99; SP.vy[i] *= 0.99;
    SP.x[i] += SP.vx[i] * dt; SP.y[i] += SP.vy[i] * dt;
    SP.life[i] -= dt * 1.1;
    if (SP.life[i] <= 0) {
      const l = --SP.n;
      SP.x[i] = SP.x[l]; SP.y[i] = SP.y[l]; SP.vx[i] = SP.vx[l]; SP.vy[i] = SP.vy[l]; SP.life[i] = SP.life[l];
      SP.r[i] = SP.r[l]; SP.g[i] = SP.g[l]; SP.b[i] = SP.b[l]; i--;
    }
  }
}

// ---------------------------------------------------------------- audio
let sfx = null, sfxP = null;
function ensureAudio() {
  if (!sfxP) sfxP = unlock({ audio: true }).then(({ audio }) => { if (audio && !sfx) sfx = new Sfx(audio); return sfx; }).catch(() => null);
  return sfxP;
}

// ---------------------------------------------------------------- fold transitions
function finishTransition() {
  if (!anim) return;
  if (anim.kind === 'unfold') {
    F.wall.gapHalf = GAP; st.wallGrow = 1; st.reveal = 1; st.flash = 0; gOverride = null;
    mode = 'open';
  } else if (anim.kind === 'fold') {
    squeezeStragglers();
    F.wall.on = false; F.limit = Infinity; F.W = W; F.H = H; gOverride = null;
    mode = 'closed';
  }
  anim = null; camAnim = null; st.cam = [0, 0, W, H];
}

function beginUnfold(prev, state) {
  finishTransition();
  const oW = F.W, oH = F.H;
  W = innerWidth; H = innerHeight;
  const ax = axisFor(state);
  F.W = W; F.H = H; F.limit = Infinity;
  const region = ax ? [0, 0, W, H / 2] : [0, 0, W / 2, H];
  const camFrom = remap(oW, oH, region);
  setWall(ax, W, H, 0);
  st.wallGrow = 0; st.reveal = 0.08;
  if (!reduced) camAnim = { from: camFrom, to: [0, 0, W, H], t0: simT, dur: 650 };
  st.cam = reduced ? [0, 0, W, H] : camFrom.slice();
  anim = { kind: 'unfold', t0: simT, burst: false };
  mode = 'unfolding';
  hideHint();
}

function burst() {
  const w = F.wall, ax = w.axis;
  const dir = [ax ? 0 : 1, ax ? 1 : 0];
  const gx = ax ? w.gapC : w.pos, gy = ax ? w.pos : w.gapC;
  for (let i = 0; i < F.n; i++) {
    const dx = F.x[i] - gx, dy = F.y[i] - gy, d = Math.hypot(dx, dy);
    const near = Math.max(0, 1 - d / (8 * h));
    const kick = (0.06 + near * 0.4) * h;
    F.vx[i] += dir[0] * kick + (Math.random() - 0.5) * 0.05 * h;
    F.vy[i] += dir[1] * kick + (Math.random() - 0.5) * 0.05 * h;
  }
  const cnt = reduced ? 70 : 150;
  for (let k = 0; k < cnt; k++) {
    const sp = 250 + Math.random() * 700, a = (Math.random() - 0.5) * 1.6;
    const c = theme.popC[k % 3].map((v, j) => lerp(v, theme.bodyC[k % 3][j], 0.5));
    const vx = dir[0] * Math.cos(a) * sp - dir[1] * Math.sin(a) * sp;
    const vy = dir[1] * Math.cos(a) * sp + dir[0] * Math.sin(a) * sp - (ax ? 0 : 120);
    spark(gx + (Math.random() - 0.5) * 6, gy + (Math.random() - 0.5) * GAP, vx, vy, c);
  }
  if (!reduced) shake = 9;
  gOverride = { x: dir[0] * 2.4, y: dir[1] * 2.4, w: 1 };
  haptic([12, 40, 20]);
  if (sfx) { sfx.whoosh(1, 0.9); sfx.splash(); }
}

function beginFold(prev, state) {
  finishTransition();
  const oW = F.W, oH = F.H, ax = F.wall.axis;
  W = innerWidth; H = innerHeight;
  if (!F.wall.on) { F.W = W; F.H = H; st.cam = [0, 0, W, H]; mode = 'closed'; return; }
  const region = ax ? [0, 0, W, 2 * H] : [0, 0, 2 * W, H];
  // map the gap center too
  const s = oW / (region[2] - region[0]);
  const gapC = ax ? F.wall.gapC / oW * W : H - (oH - F.wall.gapC) * s;
  const camFrom = remap(oW, oH, region);
  F.W = region[2]; F.H = region[3];
  Object.assign(F.wall, { on: true, axis: ax, pos: ax ? H : W, gapC, gapHalf: GAP });
  F.limit = ax ? 2 * H : 2 * W;
  st.cam = reduced ? [0, 0, W, H] : camFrom.slice();
  if (!reduced) camAnim = { from: camFrom, to: [0, 0, W, H], t0: simT, dur: 700 };
  anim = { kind: 'fold', t0: simT, from: F.limit, to: (ax ? H : W) + 3.5 + 0.4 * h };
  gOverride = { x: ax ? 0 : -1.4, y: ax ? -1.4 : 0, w: 0.8 };
  mode = 'folding';
  if (sfx) { sfx.whoosh(-1, 1.0, 0.45); for (let i = 0; i < 5; i++) sfx.glug(0.7, 0.2 + i * 0.12); }
  haptic(15);
}

function squeezeStragglers() {
  const w = F.wall, ax = w.axis, rad = 0.4 * h;
  const pa = ax ? F.y : F.x, qa = ax ? F.x : F.y;
  for (let i = 0; i < F.n; i++) {
    if (pa[i] > w.pos - w.thick - rad) {
      pa[i] = w.pos - w.thick - rad - Math.random() * 3 * h;
      qa[i] = w.gapC + (Math.random() - 0.5) * 2 * w.gapHalf;
      (ax ? F.py : F.px)[i] = pa[i] + 0.3 * h; (ax ? F.px : F.py)[i] = qa[i];
    }
  }
}

function updateTransition(now) {
  if (camAnim) {
    const t = (now - camAnim.t0) / camAnim.dur, e = easeInOut(t);
    for (let k = 0; k < 4; k++) st.cam[k] = lerp(camAnim.from[k], camAnim.to[k], e);
    if (t >= 1) { st.cam = camAnim.to.slice(); camAnim = null; }
  }
  if (!anim) return;
  const t = now - anim.t0;
  if (anim.kind === 'unfold') {
    st.wallGrow = easeOut(t / 260);
    st.reveal = lerp(0.08, 1, easeOut((t - 150) / 700));
    if (t >= 280) {
      if (!anim.burst) { anim.burst = true; burst(); }
      F.wall.gapHalf = GAP * easeOutBack((t - 280) / 260);
      st.flash = Math.exp(-(t - 280) / 140) * (reduced ? 0.4 : 1);
      if (gOverride) gOverride.w = t < 650 ? 1 : 1 - easeInOut((t - 650) / 650);
    }
    if (t >= 1300) finishTransition();
  } else {
    const e = easeInOut(t / 900);
    F.limit = lerp(anim.from, anim.to, e);
    if (t >= 1050) finishTransition();
  }
}

fold.on((state, prev, kind) => {
  if (kind === 'init') return;
  if (kind === 'fold') {
    if (state.open && !(prev && prev.open)) beginUnfold(prev, state);
    else if (!state.open && prev && prev.open) beginFold(prev, state);
    else onResize();
    updateHint();
  } else onResize();
});

function onResize() {
  const nW = innerWidth, nH = innerHeight;
  if (nW === W && nH === H) { sizeCanvas(); return; }
  finishTransition();
  const kx = nW / W, ky = nH / H;
  for (let i = 0; i < F.n; i++) { F.x[i] *= kx; F.y[i] *= ky; F.px[i] = F.x[i]; F.py[i] = F.y[i]; }
  W = nW; H = nH; F.W = W; F.H = H; st.cam = [0, 0, W, H];
  if (F.wall.on) { F.wall.axis = axisFor(fold.state); F.wall.pos = F.wall.axis ? H / 2 : W / 2; F.wall.gapC = F.wall.axis ? W / 2 : H / 2; }
  sizeCanvas();
}

// ---------------------------------------------------------------- canvas sizing / quality
let renderQ = 1;
function sizeCanvas() {
  const dpr = Math.min(devicePixelRatio || 1, 2) * renderQ;
  R.resize(innerWidth, innerHeight, dpr, 0.55 * Math.min(1, renderQ + 0.1));
}
sizeCanvas();
addEventListener('resize', sizeCanvas);

// ---------------------------------------------------------------- gravity input
let gAngle = Math.PI / 2;          // puck: direction of "down"
let sensor = null;                 // {x,y} smoothed from device orientation
let sensorLive = false;
function onOrient(e) {
  if (e.beta == null || e.gamma == null) return;
  const D = Math.PI / 180, b = e.beta * D, g = e.gamma * D;
  let dx = Math.cos(b) * Math.sin(g), dy = Math.sin(b);
  const ang = -((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * D;
  const sx = dx * Math.cos(ang) - dy * Math.sin(ang), sy = dx * Math.sin(ang) + dy * Math.cos(ang);
  if (!sensor) sensor = { x: sx, y: sy };
  sensor.x += (sx - sensor.x) * 0.35; sensor.y += (sy - sensor.y) * 0.35;
  if (!sensorLive) { sensorLive = true; document.body.classList.add('has-tilt'); }
}
addEventListener('deviceorientation', onOrient);

function userGravity() {
  if (sensorLive && sensor) return [sensor.x, sensor.y];
  return [Math.cos(gAngle), Math.sin(gAngle)];
}

// puck
const puck = $('#puck'), knob = puck.querySelector('.knob');
function drawPuck() {
  const [gx, gy] = userGravity();
  const a = Math.atan2(gy, gx), r = 22;
  knob.style.transform = `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)`;
  puck.setAttribute('aria-valuenow', String(Math.round(((a * 180 / Math.PI) + 360) % 360)));
}
function puckAt(e) {
  const b = puck.getBoundingClientRect();
  const dx = e.clientX - (b.left + b.width / 2), dy = e.clientY - (b.top + b.height / 2);
  if (Math.hypot(dx, dy) > 4) gAngle = Math.atan2(dy, dx);
}
puck.addEventListener('pointerdown', e => { e.stopPropagation(); puck.setPointerCapture(e.pointerId); puck.classList.add('drag'); puckAt(e); ensureAudio(); });
puck.addEventListener('pointermove', e => { if (puck.hasPointerCapture(e.pointerId)) puckAt(e); });
puck.addEventListener('pointerup', () => puck.classList.remove('drag'));
puck.addEventListener('dblclick', () => { gAngle = Math.PI / 2; });
addEventListener('keydown', e => {
  if (e.key === 'ArrowLeft') gAngle += 0.12;
  else if (e.key === 'ArrowRight') gAngle -= 0.12;
  else if (e.key === 'ArrowDown') gAngle = Math.PI / 2;
  else if (e.key === 'ArrowUp') gAngle = -Math.PI / 2;
});

// ---------------------------------------------------------------- touch: stir + double-tap color burst
const ptr = { x: 0, y: 0, vx: 0, vy: 0, active: false, radius: 4.2 * h, lx: 0, ly: 0, lt: 0, id: null };
let lastTap = { t: 0, x: 0, y: 0 };
function toSim(cx, cy) {
  const c = st.cam;
  return [c[0] + cx / innerWidth * (c[2] - c[0]), c[1] + cy / innerHeight * (c[3] - c[1])];
}
canvas.addEventListener('pointerdown', e => {
  ensureAudio();
  canvas.setPointerCapture(e.pointerId);
  const [x, y] = toSim(e.clientX, e.clientY);
  Object.assign(ptr, { x, y, lx: x, ly: y, vx: 0, vy: 0, active: true, lt: performance.now(), id: e.pointerId });
  const now = performance.now();
  if (now - lastTap.t < 320 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 50) {
    colorBurst(x, y); lastTap.t = 0;
  } else lastTap = { t: now, x: e.clientX, y: e.clientY };
});
canvas.addEventListener('pointermove', e => {
  if (!ptr.active || e.pointerId !== ptr.id) return;
  const [x, y] = toSim(e.clientX, e.clientY);
  const now = performance.now(), dt = Math.max(4, now - ptr.lt) / (1000 / 120);
  const vx = clamp((x - ptr.x) / dt, -0.6 * h, 0.6 * h), vy = clamp((y - ptr.y) / dt, -0.6 * h, 0.6 * h);
  ptr.vx = lerp(ptr.vx, vx, 0.6); ptr.vy = lerp(ptr.vy, vy, 0.6);
  ptr.x = x; ptr.y = y; ptr.lt = now;
});
const endPtr = e => { if (e.pointerId === ptr.id) ptr.active = false; };
canvas.addEventListener('pointerup', endPtr);
canvas.addEventListener('pointercancel', endPtr);
canvas.addEventListener('contextmenu', e => e.preventDefault());

let popIdx = 0;
function colorBurst(x, y) {
  const c = theme.popC[popIdx++ % theme.popC.length];
  const want = 110, room = Math.min(want, Math.floor(budget * 1.2) - F.n);
  for (let k = 0; k < room; k++) {
    const a = Math.random() * 6.283, r = Math.sqrt(Math.random()) * 2.6 * h;
    const i = F.add(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.cos(a) * 0.15 * h, Math.sin(a) * 0.15 * h - 0.1 * h, c[0], c[1], c[2]);
    if (i < 0) break;
  }
  // recolor the closest particles too, so it works when the budget is full
  const r2 = (3.5 * h) ** 2;
  for (let i = 0; i < F.n; i++) {
    const dx = F.x[i] - x, dy = F.y[i] - y;
    if (dx * dx + dy * dy < r2) { F.r[i] = F.tr[i] = c[0]; F.g[i] = F.tg[i] = c[1]; F.b[i] = F.tb[i] = c[2]; F.vy[i] -= 0.15 * h; }
  }
  for (let k = 0; k < (reduced ? 16 : 40); k++) {
    const a = Math.random() * 6.283, sp = 120 + Math.random() * 380;
    spark(x, y, Math.cos(a) * sp, Math.sin(a) * sp - 150, c);
  }
  haptic(8);
  if (sfx) { sfx.glug(1); sfx.glug(0.8, 0.07); sfx.tick(1500); }
}

// ---------------------------------------------------------------- themes UI
const chips = $('#chips');
THEMES.forEach((t, i) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'chip'; b.setAttribute('role', 'radio');
  b.style.setProperty('--a', t.body[0]); b.style.setProperty('--b', t.body[2]); b.style.setProperty('--c', t.hot);
  b.innerHTML = `<i></i><span>${t.name}</span>`;
  b.addEventListener('click', () => setTheme(i, true));
  chips.appendChild(b);
});
function setTheme(i, user) {
  themeIdx = (i + THEMES.length) % THEMES.length; theme = THEMES[themeIdx]; st.theme = theme;
  [...chips.children].forEach((b, k) => { b.classList.toggle('on', k === themeIdx); b.setAttribute('aria-checked', String(k === themeIdx)); });
  document.documentElement.style.setProperty('--glow', theme.glowC.map(v => v * 255 | 0).join(','));
  const c = [0, 0, 0];
  for (let k = 0; k < F.n; k++) { themeColor(F.x[k], F.y[k], c); F.tr[k] = c[0]; F.tg[k] = c[1]; F.tb[k] = c[2]; }
  F.selfRelax = 0.06; setTimeout(() => (F.selfRelax = 0.0012), 900);
  try { localStorage.setItem('liquid.theme', theme.id); } catch {}
  if (user) { haptic(6); ensureAudio().then(s => s && s.tick(700 + themeIdx * 180)); for (let k = 0; k < 25; k++) colorRipple(); }
}
function colorRipple() {
  const i = (Math.random() * F.n) | 0;
  spark(F.x[i], F.y[i], (Math.random() - 0.5) * 200, -100 - Math.random() * 300, theme.popC[i % 3]);
}
// swipe on the chip bar / dock cycles themes
{
  let sx = null;
  const dock = $('#dock');
  dock.addEventListener('pointerdown', e => { sx = e.clientX; });
  dock.addEventListener('pointerup', e => { if (sx != null && Math.abs(e.clientX - sx) > 60) setTheme(themeIdx + (e.clientX < sx ? 1 : -1), true); sx = null; });
}
setTheme(themeIdx, false);
for (let k = 0; k < F.n; k++) { F.r[k] = F.tr[k]; F.g[k] = F.tg[k]; F.b[k] = F.tb[k]; }

// ---------------------------------------------------------------- pour / unlock
const pour = $('#pour');
$('#pourBtn').addEventListener('click', async () => {
  haptic();
  const aP = ensureAudio();
  await unlock({ motion: true }).catch(() => ({}));
  await aP;
  pour.classList.add('gone');
  setTimeout(() => (pour.hidden = true), 500);
  keepAwake();
  if (sfx) { sfx.whoosh(1, 0.6, 0.3); sfx.glug(0.8, 0.1); sfx.glug(0.7, 0.22); }
  // kick the liquid so the tap feels physical
  for (let i = 0; i < F.n; i++) F.vy[i] -= (0.2 + Math.random() * 0.2) * h;
  setTimeout(() => {
    if (!sensorLive) toast(coarse ? 'No tilt sensor — drag the puck to pour' : 'Drag the puck (or ← →) to tilt');
  }, 1200);
});

// ---------------------------------------------------------------- hint
const hint = $('#hint');
function updateHint() { hint.classList.toggle('show', !fold.state.open && mode === 'closed'); }
function hideHint() { hint.classList.remove('show'); }
hint.addEventListener('click', () => { if (!fold.state.physical) { haptic(); ensureAudio().then(() => fold.toggle(true)); } });
setTimeout(updateHint, 1200);

// ---------------------------------------------------------------- recording
const recBtn = $('#rec'), recBadge = $('#recbadge');
let recState = 'idle', recBlob = null, recCanvas = null, rctx = null, recT0 = 0;
recBtn.addEventListener('click', async () => {
  haptic();
  if (recState === 'ready' && recBlob) {
    const r = await shareFile(recBlob, `liquid-fold.${videoExt(recBlob)}`, { title: 'Liquid Fold', text: 'I poured liquid through my phone’s crease · Duo Lab' });
    if (r !== 'cancelled') { recState = 'idle'; recBlob = null; setRecUI(); }
    return;
  }
  if (recState !== 'idle') return;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast('Recording isn’t supported here'); return; }
  await ensureAudio();
  const maxW = 1080, k = Math.min(1, maxW / canvas.width);
  recCanvas = recCanvas || document.createElement('canvas');
  recCanvas.width = Math.round(canvas.width * k) & ~1; recCanvas.height = Math.round(canvas.height * k) & ~1;
  rctx = recCanvas.getContext('2d');
  composite();
  recState = 'rec'; recT0 = performance.now(); setRecUI();
  try {
    recBlob = await recordCanvas(recCanvas, 6000, { fps: 60, audioStream: sfx?.stream || null });
    recState = 'ready'; toast('Clip ready — tap Share');
    haptic([10, 50, 10]);
  } catch (e) { recState = 'idle'; toast('Recording failed'); }
  setRecUI();
});
function setRecUI() {
  recBtn.dataset.state = recState;
  recBtn.setAttribute('aria-label', recState === 'ready' ? 'Share the recorded clip' : recState === 'rec' ? 'Recording' : 'Record a 6 second clip');
  recBtn.querySelector('span').textContent = recState === 'ready' ? 'Share clip' : recState === 'rec' ? '6s' : 'Rec 6s';
  recBadge.hidden = recState !== 'rec';
  document.body.classList.toggle('recording', recState === 'rec');
}
function composite() {
  if (!rctx) return;
  const w = recCanvas.width, hh = recCanvas.height;
  rctx.drawImage(canvas, 0, 0, w, hh);
  const fs = Math.max(12, Math.round(w * 0.032));
  rctx.font = `600 ${fs}px ui-rounded, "SF Pro Rounded", system-ui, sans-serif`;
  rctx.textAlign = 'right'; rctx.textBaseline = 'bottom';
  rctx.shadowColor = 'rgba(0,0,0,.6)'; rctx.shadowBlur = fs * 0.5;
  rctx.fillStyle = 'rgba(255,255,255,.82)';
  rctx.fillText('Duo Lab · Liquid Fold', w - fs, hh - fs);
  rctx.shadowBlur = 0;
}

// ---------------------------------------------------------------- main loop + adaptive quality
let emaSim = 3;
let last = performance.now(), acc = 0, emaDelta = 16.7, emaWork = 4, lastAdapt = performance.now() + 2500;
const SUB = 1000 / 120;
let paused = false;
document.addEventListener('visibilitychange', () => { paused = document.hidden; last = performance.now(); });

function frame(now) {
  requestAnimationFrame(frame);
  let dt = now - last; last = now;
  if (paused) return;
  emaDelta += (Math.min(dt, 250) - emaDelta) * 0.05;
  if (dt > 100) dt = SUB * 3;
  const t0 = performance.now();
  st.time = now / 1000;

  updateTransition(simT);
  // gravity
  let [ux, uy] = userGravity();
  if (gOverride) { ux = lerp(ux, gOverride.x, gOverride.w); uy = lerp(uy, gOverride.y, gOverride.w); }
  const gx = ux * G, gy = uy * G;
  // light comes from "up"
  const gl = Math.hypot(ux, uy) || 1;
  const lx = -ux / gl - 0.25, ly = -uy / gl, ll = Math.hypot(lx, ly) || 1;
  st.light[0] = lerp(st.light[0], lx / ll, 0.1); st.light[1] = lerp(st.light[1], ly / ll, 0.1);

  acc += dt;
  let steps = Math.min(3, Math.floor(acc / SUB));
  acc -= steps * SUB; if (acc > SUB * 2) acc = 0;
  F.crossings = 0;
  const ts = performance.now();
  for (let s = 0; s < steps; s++) F.step(gx, gy, ptr);
  if (steps) emaSim += ((performance.now() - ts) / steps * 2 - emaSim) * 0.1;
  simT += steps * SUB;
  if (ptr.active) { ptr.vx *= 0.85; ptr.vy *= 0.85; }
  if (sfx && F.wall.on && mode !== 'folding') sfx.flow(F.crossings / Math.max(1, steps) * 0.5);
  updateSparks(dt / 1000, ux * 900, uy * 900);

  // camera shake
  const cam = st.cam;
  let saved = null;
  if (shake > 0.05) {
    saved = cam.slice();
    const k = (cam[2] - cam[0]) / innerWidth, ox = (Math.random() - 0.5) * shake * k, oy = (Math.random() - 0.5) * shake * k;
    cam[0] += ox; cam[2] += ox; cam[1] += oy; cam[3] += oy;
    shake *= Math.pow(0.0001, dt / 400);
  }
  R.render(F, SP, st);
  if (saved) st.cam = saved;
  if (recState === 'rec') {
    composite();
    const left = Math.max(0, 6 - (now - recT0) / 1000);
    recBadge.querySelector('b').textContent = left.toFixed(1);
    recBtn.style.setProperty('--p', String(1 - left / 6));
  }
  drawPuck();

  const work = performance.now() - t0;
  emaWork += (work - emaWork) * 0.05;
  adapt(now);
}

function adapt(now) {
  if (NOADAPT || now - lastAdapt < 1400 || mode === 'unfolding' || mode === 'folding') return;
  if (emaDelta <= 20 && emaSim <= 9) return;
  lastAdapt = now;
  const cpuBound = emaSim > 9 || emaWork > emaDelta * 0.6;
  if (cpuBound && F.n > 900) { F.thin(0.12); budget = Math.max(900, F.n); }
  else if (renderQ > 0.5) { renderQ = renderQ > 0.8 ? 0.75 : renderQ > 0.65 ? 0.6 : 0.5; sizeCanvas(); }
  else if (F.n > 700) { F.thin(0.1); budget = F.n; }
}

window.__liquid = {
  get n() { return F.n; }, get emaDelta() { return emaDelta; }, get emaWork() { return emaWork; }, get emaSim() { return emaSim; },
  get mode() { return mode; }, get budget() { return budget; }, get renderQ() { return renderQ; },
  get gl() { return isGL; }, get prof() { return R.prof; }, get simT() { return simT; }, get h() { return h; }, F, st,
  setGravity(a) { gAngle = a; },
};

mountChrome();
requestAnimationFrame(frame);
