// Hinge Hockey — neon air hockey for iPhone Duo.
// Closed: you vs the AI on a portrait rink. Unfold: the rink cracks open along the crease,
// re-forms with goals on the short ends and a friend's paddle slams in across the gate.
import { fold, unlock, haptic, shareLink, encodeState, decodeState, toast, mountChrome, keepAwake } from '../../shared/kit.js';

const $ = s => document.querySelector(s);
const cv = $('#rink');
const ctx = cv.getContext('2d');
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const WIN = 7;
const H = 1 / 240; // fixed physics step
const C = { p1: '#19f0ff', p2: '#ff2bd6', ai: '#9d4bff', puck: '#f2ff7a', tube: '#6b5bff', gold: '#ffd23f', white: '#ffffff' };
const DIFFS = [
  { name: 'Rookie', speed: 560, react: 0.22, err: 0.55, strike: 0.85, bank: 0.1 },
  { name: 'Pro', speed: 900, react: 0.12, err: 0.28, strike: 1.05, bank: 0.3 },
  { name: 'Insane', speed: 1350, react: 0.05, err: 0.1, strike: 1.3, bank: 0.45 },
];
const FD = 'Teko, "Arial Narrow", ui-rounded, system-ui, sans-serif';
const FL = 'Orbitron, ui-rounded, system-ui, sans-serif';

// ---------- utils ----------
const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = t => 1 - Math.pow(1 - t, 3);
const seg = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const hexRGB = h => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgba = (h, a) => { const [r, g, b] = hexRGB(h); return `rgba(${r},${g},${b},${a})`; };
const mix = (h1, h2, t) => { const a = hexRGB(h1), b = hexRGB(h2); return '#' + a.map((v, i) => Math.round(lerp(v, b[i], t)).toString(16).padStart(2, '0')).join(''); };
const fmt = s => { s = Math.max(0, Math.round(s)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const rnd = (a, b) => a + Math.random() * (b - a);
function reflectInto(x, lo, hi) { // triangle-wave fold of a coordinate between two walls
  const w = hi - lo; if (w <= 0) return lo;
  let y = (x - lo) % (2 * w); if (y < 0) y += 2 * w;
  return lo + (y > w ? 2 * w - y : y);
}
const store = { get(k, d) { try { return localStorage.getItem(k) ?? d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, v); } catch {} } };

// ---------- state ----------
let vw = innerWidth, vh = innerHeight, dpr = 1;
const cur = { cx: 0, cy: 0, Wd: 400, L: 600, theta: 0, zoom: 1 };
let k = {};
const G = {
  mode: 'demo', two: false, diff: +store.get('hinge.diff', 1) || 0, score: [0, 0],
  flips: [{ v: 0, p: 0, t: 1 }, { v: 0, p: 0, t: 1 }],
  elapsed: 0, timer: 0, cd: null, morph: null, shake: 0, flood: 0, floodColor: C.p1,
  gate: 0, gatePulse: 0, p2Power: 1, crack: 0, leaveMix: 0, slam: true,
  timeScale: 1, slowmo: 0, msgs: [], challenge: null, net: [0, 0], over: null, lastSide: 1,
};
G.diff = clamp(G.diff | 0, 0, 2);
const puck = { u: 0, v: 0, vu: 0, vv: 0, last: 'bottom', trail: [], scoring: false, hidden: false };
const mkPad = side => ({ side, u: 0, v: 0, tu: null, tv: null, alpha: 1, scale: 1, ai: { t: 0, tgt: null, spd: 0, err: 0, aimSet: false, aimX: 0, strike: false } });
const bot = mkPad('bottom'), top = mkPad('top');
const pads = [bot, top];
const parts = [], rings = [], confetti = [];
let acc = 0;

function computeK() {
  const m = Math.min(cur.Wd, cur.L);
  const R = clamp(m * 0.085, 28, 54);
  k = { m, R, pr: R * 0.62, gw: clamp(m * 0.42, 150, 300), S: m / 450, W: cur.Wd, L: cur.L };
}
const human = p => G.mode !== 'demo' && (p.side === 'bottom' || G.two);
function padColor(p) {
  if (p.side === 'bottom') return C.p1;
  if (G.morph?.kind === 'leave') return mix(C.p2, C.ai, G.leaveMix);
  if (G.morph?.kind === 'join' && !G.slam) return C.ai;
  return G.two ? C.p2 : C.ai;
}
function clampPad(p, u, v) {
  const { R, W, L } = k;
  u = clamp(u, R, W - R);
  v = p.side === 'bottom' ? clamp(v, L / 2 + R * 0.4, L - R) : clamp(v, R, L / 2 - R * 0.4);
  return [u, v];
}

// ---------- layout ----------
function safe() {
  const cs = getComputedStyle($('#safe'));
  return { t: parseFloat(cs.paddingTop) || 0, r: parseFloat(cs.paddingRight) || 0, b: parseFloat(cs.paddingBottom) || 0, l: parseFloat(cs.paddingLeft) || 0 };
}
function targetLayout() {
  const s = fold.state, sa = safe(), two = s.open;
  const t = 54 + sa.t, b = 14 + sa.b, l = 12 + sa.l, r = 12 + sa.r;
  const aw = vw - l - r, ah = vh - t - b;
  const vert = two ? s.crease === 'horizontal' : ah >= aw;
  let theta, L, Wd;
  if (vert) { theta = 0; L = ah; Wd = aw; } else { theta = Math.PI / 2; L = aw; Wd = ah; }
  if (two) { Wd = Math.min(Wd, L * 1.8); L = Math.min(L, Wd * (vert ? 2.1 : 1.7)); }
  else { Wd = Math.min(Wd, L * 0.72); L = Math.min(L, Wd * 2.15); }
  return { cx: l + aw / 2, cy: t + ah / 2, Wd, L, theta, zoom: 1 };
}
function fitZoom(lay) {
  const c = Math.abs(Math.cos(lay.theta)), s = Math.abs(Math.sin(lay.theta));
  const w = lay.Wd * c + lay.L * s, h = lay.Wd * s + lay.L * c;
  return Math.min(1, (vw - 16) / w, (vh - 60) / h);
}
function resizeCanvas() {
  vw = innerWidth; vh = innerHeight; dpr = Math.min(devicePixelRatio || 1, 2);
  cv.width = Math.round(vw * dpr); cv.height = Math.round(vh * dpr);
  const t = targetLayout();
  cur.cx = t.cx; cur.cy = t.cy; cur.zoom = Math.min(cur.zoom, fitZoom(cur));
  if (G.morph) { G.morph.to = t; G.morph.from.cx = t.cx; G.morph.from.cy = t.cy; }
  layoutPanels();
}

// ---------- morph (the unfold moment) ----------
function normalize() {
  for (const e of [puck, bot, top]) { e.nu = e.u / cur.Wd; e.nv = e.v / cur.L; }
  puck.nvu = puck.vu / cur.Wd; puck.nvv = puck.vv / cur.L;
}
function denormalize() {
  for (const e of [puck, bot, top]) { e.u = e.nu * cur.Wd; e.v = e.nv * cur.L; }
  puck.vu = puck.nvu * cur.Wd; puck.vv = puck.nvv * cur.L;
}
function startMorph(to, kind) {
  if (G.morph) endMorphFx();
  const from = { ...cur };
  from.zoom = Math.min(from.zoom, fitZoom(from)); cur.zoom = from.zoom;
  const base = kind === 'join' ? 2.6 : kind === 'leave' ? 1.5 : 0.55;
  const dur = RM ? Math.min(base, 0.5) : base;
  G.morph = { from, to, t: 0, dur, kind, f: dur / base, fired: {}, prevMode: G.mode };
  normalize();
  puck.trail.length = 0;
  pointers.clear(); bot.tu = top.tu = bot.tv = top.tv = null;
  if (kind === 'join') {
    G.two = true; G.slam = false;
    sfx.whoosh(dur * 0.45, true);
    haptic(20);
    // AI paddle dissolves into motes sucked toward the crease
    computeK();
    for (let i = 0; i < (RM ? 20 : 90); i++) {
      const a = rnd(0, Math.PI * 2), r = rnd(0, k.R);
      const u = top.u + Math.cos(a) * r, v = top.v + Math.sin(a) * r;
      parts.push({ u, v, vu: rnd(-60, 60) + (k.W / 2 - u) * 0.8, vv: rnd(-40, 40) + (k.L / 2 - v) * 1.6, life: rnd(0.5, 1.1), max: 1.1, color: i % 3 ? C.ai : C.white, w: rnd(1.5, 3.5), mote: true });
    }
  } else if (kind === 'leave') {
    G.two = false;
    sfx.whoosh(dur * 0.6, false);
    haptic(20);
  }
  layoutPanels(); updateMenuText();
}
function endMorphFx() {
  top.alpha = 1; top.scale = 1; G.crack = 0; G.slam = true; G.p2Power = 1; G.leaveMix = 0;
  G.gate = G.two ? 1 : 0;
  if (G.morph) {
    Object.assign(cur, G.morph.to); computeK(); denormalize();
    for (const p of pads) { const c = clampPad(p, p.u, p.v); p.u = c[0]; p.v = c[1]; }
  }
  G.morph = null;
}
function morphStep(dt) {
  const M = G.morph; M.t += dt;
  const t = M.t, f = M.f, F = M.fired;
  const once = (key, at, fn) => { if (!F[key] && t >= at * f) { F[key] = 1; fn(); } };
  let g;
  if (M.kind === 'join') {
    g = ease(seg(t, 0.12 * f, 1.1 * f));
    G.crack = RM ? 0 : Math.sin(Math.PI * seg(t, 0.12 * f, 1.1 * f));
    top.alpha = t < 1.3 * f ? 1 - seg(t, 0, 0.38 * f) : 1;
    G.p2Power = t < 0.45 * f ? 1 - seg(t, 0, 0.38 * f) : seg(t, 1.0 * f, 1.5 * f);
    G.gate = seg(t, 1.15 * f, 1.45 * f);
    once('gate', 1.15, () => { sfx.zap(1); });
    once('slam', 1.3, () => {
      G.slam = true; top.nu = 0.5; top.nv = 0.22; top.alpha = 1;
      rings.push({ u: cur.Wd * 0.5, v: cur.L * 0.22, r0: 10, r1: k.m * 0.55, t: 0, dur: 0.7, color: C.p2, w: 5 });
      burst(cur.Wd * 0.5, cur.L * 0.22, C.p2, 40, 600);
      sfx.thump(); haptic(30); G.shake = Math.max(G.shake, 7);
    });
    if (G.slam) top.scale = 1 + 1.4 * (1 - easeOut(seg(t, 1.3 * f, 1.52 * f)));
    once('msg', 1.35, () => {
      addMsg({ text: 'PLAYER 2', sub: '— JOINED —', who: 'p2', color: C.p2, dur: 1.6, size: 0.15 });
      addMsg({ text: 'FACE-OFF', sub: 'MODE', who: 'p1', color: C.p1, dur: 1.6, size: 0.15 });
      sfx.chime();
    });
  } else if (M.kind === 'leave') {
    g = ease(seg(t, 0, 0.9 * f));
    G.crack = RM ? 0 : 0.5 * Math.sin(Math.PI * seg(t, 0, 0.9 * f));
    G.gate = 1 - seg(t, 0, 0.4 * f);
    G.leaveMix = seg(t, 0.2 * f, 0.9 * f);
    once('msg', 0.85, () => { addMsg({ text: 'AI TAKES OVER', who: 'screen', color: C.ai, dur: 1.3, size: 0.09 }); });
  } else {
    g = ease(seg(t, 0, M.dur));
  }
  const A = M.from, B = M.to;
  cur.cx = lerp(A.cx, B.cx, g); cur.cy = lerp(A.cy, B.cy, g);
  cur.Wd = lerp(A.Wd, B.Wd, g); cur.L = lerp(A.L, B.L, g);
  cur.theta = lerp(A.theta, B.theta, g); cur.zoom = Math.min(lerp(A.zoom, B.zoom, g), fitZoom(cur));
  computeK(); denormalize();
  if (t >= M.dur) {
    const kind = M.kind, prev = M.prevMode;
    endMorphFx();
    if (kind === 'join' && ['play', 'goal', 'countdown'].includes(prev)) {
      placeHome(); faceoff('center'); startCountdown([[0.35, 'READY'], [1.1, 'GO']]);
    }
    if (kind === 'leave' && prev === 'play') G.timeScale = 0.25;
    layoutPanels();
  }
}

// ---------- game flow ----------
function placeHome() {
  bot.u = k.W / 2; bot.v = k.L - k.R * 1.7;
  top.u = k.W / 2; top.v = k.R * 1.7;
  bot.tu = bot.tv = top.tu = top.tv = null;
}
function faceoff(where) {
  puck.u = k.W / 2; puck.vu = puck.vv = 0; puck.scoring = false; puck.hidden = false; puck.trail.length = 0;
  puck.v = where === 'center' ? k.L / 2 : where === 'bottom' ? k.L * 0.68 : k.L * 0.32;
  G.lastSide = Math.sign(puck.v - k.L / 2) || 1;
  rings.push({ u: puck.u, v: puck.v, r0: k.pr * 3, r1: k.pr, t: 0, dur: 0.35, color: C.puck, w: 3 });
}
function startCountdown(seq) { G.mode = 'countdown'; G.timer = 0; G.cd = seq.map(s => [...s]); }
function newGame() {
  G.score = [0, 0]; G.flips.forEach(f => { f.v = 0; f.p = 0; f.t = 1; });
  G.elapsed = 0; G.over = null; confetti.length = 0; G.timeScale = 1; G.slowmo = 0;
  placeHome(); faceoff('bottom');
  showPanel(null);
  startCountdown([[0, '3'], [0.6, '2'], [1.2, '1'], [1.8, 'GO']]);
  keepAwake();
}
function goal(scorer) { // 0 = bottom player scored, 1 = top scored
  puck.scoring = true;
  const defender = 1 - scorer;
  const color = scorer === 0 ? C.p1 : padColor(top);
  G.net[defender] = 1; G.flood = 1; G.floodColor = color;
  G.shake = RM ? 0 : 14;
  const gu = k.W / 2, gv = defender === 1 ? 0 : k.L;
  burst(gu, gv, color, RM ? 20 : 70, 900);
  rings.push({ u: gu, v: gv, r0: 10, r1: k.m * 0.8, t: 0, dur: 0.8, color, w: 6 });
  if (G.mode === 'demo') { G.timer = 0; G.demoGoal = true; return; }
  G.slowmo = RM ? 0 : 0.4;
  G.score[scorer]++;
  const fl = G.flips[scorer]; fl.p = fl.v; fl.v = G.score[scorer]; fl.t = 0;
  G.mode = 'goal'; G.timer = 0; G.conceder = defender;
  sfx.horn(scorer === 0 || G.two); haptic(40);
  const txt = G.two ? 'GOAL!' : scorer === 0 ? 'GOAL!' : 'AI SCORES';
  addMsg({ text: txt, who: 'both', color, dur: 1.4, size: 0.17, delay: 0.25 });
}
function endGame(winner) {
  G.mode = 'over'; G.over = { winner, time: G.elapsed };
  sfx.fanfare(winner === 0 || G.two);
  spawnConfetti(winner === 0 ? C.p1 : padColor(top));
  setTimeout(() => { if (G.mode === 'over') { fillOver(); showPanel('over'); } }, RM ? 200 : 1300);
}

// ---------- AI ----------
function aiStep(p, dt, d) {
  const { W, L, R, pr, S, gw } = k;
  const flip = p.side === 'bottom';
  const tl = (u, v) => (flip ? [W - u, L - v] : [u, v]);
  const [pu, pv] = tl(puck.u, puck.v);
  const pvu = flip ? -puck.vu : puck.vu, pvv = flip ? -puck.vv : puck.vv;
  let [mu, mv] = tl(p.u, p.v);
  const A = p.ai;
  const defV = R * 1.2 + L * 0.035;
  const reach = R + pr;
  const live = (G.mode === 'play' || G.mode === 'demo') && !puck.scoring;
  A.t -= dt;
  if (pv > L / 2 + pr) A.aimSet = false;
  if (A.t <= 0 || A.strike) {
    A.t = d.react * rnd(0.7, 1.3);
    let tgt, spd = d.speed * S;
    A.strike = false;
    const sp = Math.hypot(pvu, pvv);
    if (!live) {
      tgt = [W / 2, defV + R * 0.4]; spd *= 0.6;
    } else if (pvv < -80 * S && pv > defV && !(pv < L / 2 && sp < 380 * S)) {
      // incoming: predict where it crosses my defence line, with wall bounces
      const t = (pv - defV) / -pvv;
      if (Math.random() < 0.5) A.err = rnd(-1, 1) * d.err * R;
      const u = reflectInto(pu + pvu * t, pr, W - pr) + A.err;
      // keep between puck and goal: favour the goal-mouth side
      tgt = [lerp(u, W / 2, 0.15), defV];
      if (pv < L / 2 && t < 0.18) { tgt = [u, pv + R * 0.2]; spd *= d.strike; } // poke it
    } else if (pv < L / 2 + pr * 0.3) {
      if (!A.aimSet) {
        A.aimSet = true;
        const r = Math.random();
        A.aimX = r < d.bank / 2 ? -W / 2 : r < d.bank ? 1.5 * W : W / 2 + rnd(-0.3, 0.3) * gw;
      }
      let ax = A.aimX - pu, ay = L - pv; const n = Math.hypot(ax, ay) || 1; ax /= n; ay /= n;
      const stage = [pu - ax * reach * 1.15, pv - ay * reach * 1.15];
      const behind = mv < pv - reach * 0.35;
      const dStage = Math.hypot(mu - stage[0], mv - stage[1]);
      if (behind && dStage < R * 1.15) {
        tgt = [pu + ax * R * 1.6, pv + ay * R * 1.6]; spd = d.speed * S * d.strike * 1.6; A.strike = true;
      } else if (!behind) {
        let sx = mu < pu ? -1 : 1;
        if (pu + sx * reach * 1.2 < R || pu + sx * reach * 1.2 > W - R) sx = -sx;
        tgt = [pu + sx * reach * 1.2, pv - reach * 0.9];
      } else tgt = stage;
    } else {
      tgt = [lerp(W / 2, pu, 0.35), defV + R * 0.3];
      spd *= 0.75;
    }
    A.tgt = tgt; A.spd = spd;
  }
  let [tu, tv] = A.tgt || [W / 2, defV];
  tu = clamp(tu, R, W - R); tv = clamp(tv, R, L / 2 - R * 0.4);
  const dx = tu - mu, dy = tv - mv, dist = Math.hypot(dx, dy);
  if (dist > 0.01) {
    const step = Math.min(dist, A.spd * dt, A.strike ? 1e9 : dist * 14 * dt + 2);
    mu += (dx / dist) * step; mv += (dy / dist) * step;
  }
  return tl(mu, mv);
}

// ---------- physics ----------
function simulate(dt) {
  const ends = pads.map(p => {
    if (human(p)) return p.tu == null ? clampPad(p, p.u, p.v) : clampPad(p, p.tu, p.tv);
    const d = G.mode === 'demo' ? DIFFS[p.side === 'bottom' ? 0 : 1] : DIFFS[G.diff];
    return clampPad(p, ...aiStep(p, dt, d));
  });
  acc += dt;
  let n = Math.floor(acc / H);
  if (n > 48) { n = 48; acc = 0; }
  acc -= n * H;
  const s = pads.map(p => [p.u, p.v]);
  for (let i = 0; i < n; i++) {
    const a = i / n, b = (i + 1) / n;
    const segs = pads.map((p, j) => [lerp(s[j][0], ends[j][0], a), lerp(s[j][1], ends[j][1], a), lerp(s[j][0], ends[j][0], b), lerp(s[j][1], ends[j][1], b)]);
    stepPuck(H, segs);
  }
  pads.forEach((p, j) => { p.u = ends[j][0]; p.v = ends[j][1]; });
}
function stepPuck(h, segs) {
  if (puck.hidden) return;
  if (puck.scoring) {
    puck.u += puck.vu * h; puck.v += puck.vv * h; puck.vu *= 0.995; puck.vv *= 0.995;
    if (puck.v < -k.pr * 2.2 || puck.v > k.L + k.pr * 2.2) { puck.hidden = true; }
    return;
  }
  if (G.mode !== 'play' && G.mode !== 'demo') return;
  const fr = Math.exp(-0.16 * h); puck.vu *= fr; puck.vv *= fr;
  const du = puck.vu * h, dv = puck.vv * h, Rs = k.R + k.pr;
  let best = null;
  // CCD: swept circle vs swept circle (relative motion over this sub-step)
  segs.forEach((sg, j) => {
    const ru = puck.u - sg[0], rv = puck.v - sg[1];
    const wu = du - (sg[2] - sg[0]), wv = dv - (sg[3] - sg[1]);
    const c = ru * ru + rv * rv - Rs * Rs;
    let t = null;
    if (c < 0) t = 0;
    else {
      const a = wu * wu + wv * wv, b = 2 * (ru * wu + rv * wv);
      if (a > 1e-9 && b < 0) { const disc = b * b - 4 * a * c; if (disc >= 0) { const tt = (-b - Math.sqrt(disc)) / (2 * a); if (tt >= 0 && tt <= 1) t = tt; } }
    }
    if (t !== null && (!best || t < best.t)) best = { t, j };
  });
  if (best) {
    const sg = segs[best.j], t = best.t;
    puck.u += du * t; puck.v += dv * t;
    const qu = lerp(sg[0], sg[2], t), qv = lerp(sg[1], sg[3], t);
    let nx = puck.u - qu, ny = puck.v - qv; const d = Math.hypot(nx, ny) || 1; nx /= d; ny /= d;
    if (d < Rs) { puck.u = qu + nx * Rs; puck.v = qv + ny * Rs; }
    const pvu = (sg[2] - sg[0]) / h, pvv = (sg[3] - sg[1]) / h;
    const vn = (puck.vu - pvu) * nx + (puck.vv - pvv) * ny;
    if (vn < 0) {
      puck.vu -= 1.9 * vn * nx; puck.vv -= 1.9 * vn * ny;
      capSpeed();
      onHit(pads[best.j], -vn, puck.u - nx * k.pr, puck.v - ny * k.pr, nx, ny);
    }
    const rem = 1 - t; puck.u += puck.vu * h * rem; puck.v += puck.vv * h * rem;
  } else { puck.u += du; puck.v += dv; }
  walls();
  const side = Math.sign(puck.v - k.L / 2);
  if (side && side !== G.lastSide) {
    G.lastSide = side; G.gatePulse = 1;
    if (G.two) { rings.push({ u: puck.u, v: k.L / 2, r0: 4, r1: k.R * 1.6, t: 0, dur: 0.4, color: '#ffffff', w: 2 }); sfx.zap(0.3); }
  }
}
function capSpeed() {
  const max = 2300 * k.S, sp = Math.hypot(puck.vu, puck.vv);
  if (sp > max) { puck.vu *= max / sp; puck.vv *= max / sp; }
}
function walls() {
  const { W, L, pr, gw } = k, e = 0.9;
  let hit = 0;
  if (puck.u < pr) { puck.u = 2 * pr - puck.u; hit = Math.abs(puck.vu); puck.vu = Math.abs(puck.vu) * e; }
  else if (puck.u > W - pr) { puck.u = 2 * (W - pr) - puck.u; hit = Math.abs(puck.vu); puck.vu = -Math.abs(puck.vu) * e; }
  const inMouth = Math.abs(puck.u - W / 2) < gw / 2;
  if (!inMouth) {
    if (puck.v < pr) { puck.v = 2 * pr - puck.v; hit = Math.max(hit, Math.abs(puck.vv)); puck.vv = Math.abs(puck.vv) * e; }
    else if (puck.v > L - pr) { puck.v = 2 * (L - pr) - puck.v; hit = Math.max(hit, Math.abs(puck.vv)); puck.vv = -Math.abs(puck.vv) * e; }
  }
  for (const [x, y] of [[W / 2 - gw / 2, 0], [W / 2 + gw / 2, 0], [W / 2 - gw / 2, L], [W / 2 + gw / 2, L]]) {
    const dx = puck.u - x, dy = puck.v - y, d = Math.hypot(dx, dy);
    if (d < pr && d > 0) {
      const nx = dx / d, ny = dy / d; puck.u = x + nx * pr; puck.v = y + ny * pr;
      const vn = puck.vu * nx + puck.vv * ny;
      if (vn < 0) { puck.vu -= (1 + e) * vn * nx; puck.vv -= (1 + e) * vn * ny; hit = Math.max(hit, -vn); }
    }
  }
  if (hit > 120 * k.S) {
    const I = clamp(hit / (1800 * k.S), 0, 1);
    sfx.wall(I);
    sparks(puck.u, puck.v, C.puck, 2 + I * 8, 0, 0, 260 * I + 60);
  }
  if (puck.v < -k.pr * 0.3) goal(0);
  else if (puck.v > L + k.pr * 0.3) goal(1);
}
let lastHap = 0, lastHitSfx = 0;
function onHit(pad, impact, cu, cvv, nx, ny) {
  puck.last = pad.side;
  if (impact < 50 * k.S) return;
  const I = clamp(impact / (1700 * k.S), 0, 1);
  const color = padColor(pad);
  const now = performance.now();
  if (now - lastHitSfx > 45) { lastHitSfx = now; sfx.hit(I); }
  sparks(cu, cvv, color, 5 + I * (RM ? 6 : 24), -nx, -ny, 300 + I * 900);
  rings.push({ u: cu, v: cvv, r0: k.pr * 0.6, r1: k.R * (1.2 + I * 2.2), t: 0, dur: 0.3 + I * 0.25, color, w: 2 + I * 4 });
  if (I > 0.65 && !RM) G.shake = Math.max(G.shake, I * 4);
  if (human(pad) && now - lastHap > 70) { lastHap = now; haptic(I > 0.5 ? 18 : 8); }
}

// ---------- particles ----------
function sparks(u, v, color, n, dx, dy, speed) {
  for (let i = 0; i < n; i++) {
    let a = rnd(0, Math.PI * 2);
    if (dx || dy) a = Math.atan2(-dy, -dx) + rnd(-1.1, 1.1);
    const s = speed * rnd(0.3, 1);
    parts.push({ u, v, vu: Math.cos(a) * s, vv: Math.sin(a) * s, life: rnd(0.15, 0.45), max: 0.45, color: Math.random() < 0.3 ? C.white : color, w: rnd(1, 2.4) });
  }
}
function burst(u, v, color, n, speed) { sparks(u, v, color, n, 0, 0, speed); }
function spawnConfetti(color) {
  const cols = [color, C.gold, C.white, C.p2, C.p1];
  const n = RM ? 40 : 180;
  for (let i = 0; i < n; i++) {
    const fromSide = i % 2 ? -1 : 1;
    confetti.push({
      x: i < n / 2 ? rnd(0, vw) : (fromSide < 0 ? -10 : vw + 10), y: i < n / 2 ? rnd(-vh * 0.4, -10) : rnd(vh * 0.4, vh * 0.8),
      vx: i < n / 2 ? rnd(-40, 40) : -fromSide * rnd(200, 520), vy: i < n / 2 ? rnd(40, 160) : rnd(-700, -350),
      r: rnd(0, 6), vr: rnd(-8, 8), w: rnd(6, 11), h: rnd(3, 6), c: cols[i % cols.length], life: rnd(3, 5),
    });
  }
}
function addMsg(m) { G.msgs.push({ t: -(m.delay || 0), sub: '', size: 0.12, ...m }); }

// ---------- input ----------
const pointers = new Map();
function toRink(x, y) {
  let dx = x - cur.cx, dy = y - cur.cy;
  const c = Math.cos(-cur.theta), s = Math.sin(-cur.theta);
  const lx = (dx * c - dy * s) / cur.zoom, ly = (dx * s + dy * c) / cur.zoom;
  return [lx + cur.Wd / 2, ly + cur.L / 2];
}
function setTarget(side, x, y) {
  const [u, v] = toRink(x, y);
  const p = side === 'top' ? top : bot;
  p.tu = u; p.tv = v;
}
cv.addEventListener('pointerdown', e => {
  sfx.init();
  if (G.morph) return;
  const [, v] = toRink(e.clientX, e.clientY);
  const side = G.two && v < cur.L / 2 ? 'top' : 'bottom';
  pointers.set(e.pointerId, side);
  try { cv.setPointerCapture(e.pointerId); } catch {}
  setTarget(side, e.clientX, e.clientY);
});
cv.addEventListener('pointermove', e => {
  if (G.morph) return;
  const side = pointers.get(e.pointerId) || (e.pointerType === 'mouse' ? 'bottom' : null);
  if (side) setTarget(side, e.clientX, e.clientY);
});
const up = e => pointers.delete(e.pointerId);
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);
document.addEventListener('touchmove', e => { if (e.target === cv || e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', e => e.preventDefault());
document.addEventListener('dblclick', e => e.preventDefault());

// ---------- audio ----------
const sfx = (() => {
  let ac = null, master = null, noise = null, pending = false;
  const ok = () => ac && ac.state === 'running';
  function init() {
    if (ac || pending) return;
    pending = true;
    unlock({ audio: true }).then(r => {
      ac = r.audio; if (!ac) return;
      const comp = ac.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      master = ac.createGain(); master.gain.value = 0.8; master.connect(comp).connect(ac.destination);
      noise = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }).catch(() => {});
  }
  function env(g, t, a, peak, dec) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec); }
  function tone(type, f0, f1, peak, dec, delay = 0, a = 0.004) {
    const t = ac.currentTime + delay, o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.6);
    env(g, t, a, peak, dec); o.connect(g).connect(master); o.start(t); o.stop(t + a + dec + 0.05);
  }
  function hiss(f, q, peak, dec, delay = 0, a = 0.002, f1) {
    const t = ac.currentTime + delay, s = ac.createBufferSource(), bp = ac.createBiquadFilter(), g = ac.createGain();
    s.buffer = noise; s.loop = true; bp.type = 'bandpass'; bp.frequency.setValueAtTime(f, t); bp.Q.value = q;
    if (f1) bp.frequency.exponentialRampToValueAtTime(f1, t + a + dec);
    env(g, t, a, peak, dec); s.connect(bp).connect(g).connect(master); s.start(t, Math.random() * 0.5); s.stop(t + a + dec + 0.05);
  }
  return {
    init,
    hit(I) { if (!ok()) return; const f = 240 + I * 820; tone('triangle', f * 1.7, f, 0.25 + 0.45 * I, 0.12 + I * 0.05); tone('sine', f / 2, f / 2.6, 0.2 + 0.3 * I, 0.09); hiss(2400 + I * 3000, 1.2, 0.12 + I * 0.25, 0.035); },
    wall(I) { if (!ok()) return; tone('sine', 150 + I * 120, 90, 0.12 + I * 0.25, 0.08); hiss(1400, 2, 0.06 + I * 0.1, 0.03); },
    zap(I) { if (!ok()) return; tone('sawtooth', 300, 1500, 0.06 * I + 0.03, 0.18); tone('sine', 1200, 2400, 0.08 * I, 0.12); },
    thump() { if (!ok()) return; tone('sine', 140, 40, 0.9, 0.35); hiss(300, 0.8, 0.4, 0.25); tone('square', 880, 440, 0.06, 0.2, 0.02); },
    chime() { if (!ok()) return; [523, 659, 784, 1047].forEach((f, i) => tone('square', f, 0, 0.07, 0.22, i * 0.07)); [523, 1047].forEach((f, i) => tone('triangle', f, 0, 0.15, 0.6, 0.3 + i * 0.01)); },
    whoosh(dur, rising) {
      if (!ok()) return;
      hiss(rising ? 250 : 2600, 1.5, 0.35, dur, 0, dur * 0.4, rising ? 3200 : 220);
      tone('sawtooth', rising ? 80 : 320, rising ? 320 : 70, 0.12, dur, 0, dur * 0.3);
    },
    horn(good) {
      if (!ok()) return;
      const t = ac.currentTime, fs = good ? [196, 246.9, 293.7, 392] : [146.8, 174.6, 220];
      const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1500; lp.Q.value = 2;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.32, t + 0.04);
      g.gain.setValueAtTime(0.32, t + 0.9); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
      const lfo = ac.createOscillator(), lg = ac.createGain(); lfo.frequency.value = 5.5; lg.gain.value = 3; lfo.connect(lg);
      lp.connect(g).connect(master);
      fs.forEach((f, i) => { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = (i - 1) * 7; lg.connect(o.frequency); o.connect(lp); o.start(t); o.stop(t + 1.6); });
      lfo.start(t); lfo.stop(t + 1.6);
      hiss(900, 0.6, 0.18, 1.4, 0.05, 0.3);
      tone('sine', 90, 45, 0.7, 0.5);
    },
    beep(go) { if (!ok()) return; tone(go ? 'square' : 'sine', go ? 988 : 660, 0, go ? 0.18 : 0.22, go ? 0.35 : 0.14); },
    fanfare(good) { if (!ok()) return; (good ? [523, 659, 784, 1047, 1319] : [392, 370, 349, 330]).forEach((f, i) => { tone('square', f, 0, 0.08, 0.3, i * 0.12); tone('triangle', f, 0, 0.2, 0.5, i * 0.12); }); },
  };
})();

// ---------- update ----------
function update(dt) {
  computeK();
  if (G.morph) morphStep(dt);
  else {
    const ts = G.slowmo > 0 ? 0.2 : G.timeScale;
    G.slowmo = Math.max(0, G.slowmo - dt);
    G.timeScale = Math.min(1, G.timeScale + dt * 0.9);
    const sdt = dt * ts;
    if (G.mode === 'play') G.elapsed += dt;
    simulate(sdt);
    G.timer += dt;
    if (G.mode === 'countdown') {
      while (G.cd.length && G.timer >= G.cd[0][0]) {
        const [, label] = G.cd.shift(); const go = label === 'GO';
        addMsg({ text: label, who: 'both', color: go ? C.puck : C.white, dur: go ? 0.6 : 0.55, size: go ? 0.2 : 0.22, pop: true });
        sfx.beep(go);
        if (go) { G.mode = 'play'; haptic(12); }
      }
    } else if (G.mode === 'goal' && G.timer > 1.7) {
      if (G.score[0] >= WIN || G.score[1] >= WIN) endGame(G.score[0] >= WIN ? 0 : 1);
      else { G.mode = 'play'; faceoff(G.conceder === 0 ? 'bottom' : 'top'); }
    } else if (G.mode === 'demo' && G.demoGoal && G.timer > 1) { G.demoGoal = false; faceoff('center'); }
    // demo: nudge a stalled puck
    if (G.mode === 'demo' && !puck.scoring && Math.hypot(puck.vu, puck.vv) < 20 * k.S && G.timer > 3) { puck.vu = rnd(-300, 300) * k.S; puck.vv = rnd(-300, 300) * k.S; G.timer = 0; }
  }
  // effects
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]; p.life -= dt;
    if (p.life <= 0) { parts.splice(i, 1); continue; }
    p.u += p.vu * dt; p.v += p.vv * dt; const dr = Math.exp((p.mote ? -1.2 : -4) * dt); p.vu *= dr; p.vv *= dr;
  }
  for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > rings[i].dur) rings.splice(i, 1); }
  for (let i = G.msgs.length - 1; i >= 0; i--) { G.msgs[i].t += dt; if (G.msgs[i].t > G.msgs[i].dur) G.msgs.splice(i, 1); }
  for (const f of G.flips) f.t = Math.min(1, f.t + dt / 0.32);
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i]; c.life -= dt;
    if (c.life <= 0 || c.y > vh + 40) { confetti.splice(i, 1); continue; }
    c.vy += 520 * dt; c.vx *= Math.exp(-1.6 * dt); c.vy *= Math.exp(-1.2 * dt);
    c.x += c.vx * dt + Math.sin(c.life * 6 + c.r) * 0.6; c.y += c.vy * dt; c.r += c.vr * dt;
  }
  G.shake *= Math.exp(-7 * dt); if (G.shake < 0.2) G.shake = 0;
  G.flood = Math.max(0, G.flood - dt / 0.9);
  G.net = G.net.map(n => Math.max(0, n - dt / 1.4));
  G.gatePulse = Math.max(0, G.gatePulse - dt / 0.5);
  // trail
  if (!puck.hidden && !G.morph) { puck.trail.push([puck.u, puck.v]); if (puck.trail.length > 16) puck.trail.shift(); }
  else if (puck.trail.length) puck.trail.shift();
}

// ---------- render ----------
let dotPattern = null;
function makePattern() {
  const t = document.createElement('canvas'); t.width = t.height = 22;
  const c = t.getContext('2d');
  c.fillStyle = 'rgba(80,100,255,.22)'; c.beginPath(); c.arc(11, 11, 1.1, 0, Math.PI * 2); c.fill();
  dotPattern = ctx.createPattern(t, 'repeat');
}
function glow(path, color, w, I = 1) {
  if (I <= 0.01) return;
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.strokeStyle = color;
  ctx.globalAlpha = 0.05 * I; ctx.lineWidth = w * 10; ctx.stroke(path);
  ctx.globalAlpha = 0.1 * I; ctx.lineWidth = w * 5; ctx.stroke(path);
  ctx.globalAlpha = 0.3 * I; ctx.lineWidth = w * 2.2; ctx.stroke(path);
  ctx.globalAlpha = 0.95 * I; ctx.lineWidth = w; ctx.stroke(path);
  ctx.strokeStyle = '#fff'; ctx.globalAlpha = 0.65 * I; ctx.lineWidth = Math.max(0.6, w * 0.35); ctx.stroke(path);
  ctx.restore();
}
function rrPath(x, y, w, h, r) { const p = new Path2D(); p.roundRect ? p.roundRect(x, y, w, h, r) : p.rect(x, y, w, h); return p; }
function halfBorder(isTop) {
  const { W, L, gw } = k, cr = Math.min(W, L) * 0.07, p = new Path2D();
  const ey = isTop ? 0 : L, my = L / 2, dir = isTop ? 1 : -1;
  p.moveTo(0, my); p.lineTo(0, ey + dir * cr); p.arcTo(0, ey, cr, ey, cr); p.lineTo(W / 2 - gw / 2, ey);
  p.moveTo(W / 2 + gw / 2, ey); p.lineTo(W - cr, ey); p.arcTo(W, ey, W, ey + dir * cr, cr); p.lineTo(W, my);
  return p;
}
function flick(power, i, n) { const on = power * n - i; return on >= 1 ? 1 : on <= 0 ? 0 : (Math.random() < on ? 0.9 : 0.12); }

function scene(time) {
  const { W, L, R, pr, gw, m } = k;
  const topC = padColor(top);
  const cr = Math.min(W, L) * 0.07;
  const rink = rrPath(0, 0, W, L, cr);
  // nets (outside the rink, behind each mouth)
  for (const [isTop, color, nI] of [[true, topC, G.net[1]], [false, C.p1, G.net[0]]]) {
    const ey = isTop ? 0 : L, dir = isTop ? -1 : 1, depth = Math.min(26, m * 0.06);
    const net = new Path2D();
    net.moveTo(W / 2 - gw / 2, ey); net.lineTo(W / 2 - gw / 2 + 10, ey + dir * depth); net.lineTo(W / 2 + gw / 2 - 10, ey + dir * depth); net.lineTo(W / 2 + gw / 2, ey);
    for (let i = 1; i < 8; i++) { const x = W / 2 - gw / 2 + 8 + (gw - 16) * i / 8; net.moveTo(x, ey); net.lineTo(x, ey + dir * depth); }
    const pw = isTop ? G.p2Power : 1;
    if (nI > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rgba(color, 0.45 * nI); ctx.fill(net); ctx.restore(); }
    glow(net, color, 1.2, (0.25 + nI * 1.2) * pw);
  }
  // ice
  ctx.save();
  ctx.clip(rink);
  const ice = ctx.createLinearGradient(0, 0, 0, L);
  ice.addColorStop(0, '#060a1c'); ice.addColorStop(0.5, '#0c1236'); ice.addColorStop(1, '#060a1c');
  ctx.fillStyle = ice; ctx.fillRect(0, 0, W, L);
  ctx.globalCompositeOperation = 'lighter';
  const tint = (y, color, a) => { const g = ctx.createRadialGradient(W / 2, y, 0, W / 2, y, Math.max(W, L) * 0.55); g.addColorStop(0, rgba(color, a)); g.addColorStop(1, rgba(color, 0)); ctx.fillStyle = g; ctx.fillRect(0, 0, W, L); };
  tint(L, C.p1, 0.16); tint(0, topC, 0.16 * (0.25 + 0.75 * G.p2Power));
  ctx.globalAlpha = 1; ctx.fillStyle = dotPattern; ctx.fillRect(0, 0, W, L);
  // diagonal glass sheen
  const sh = ctx.createLinearGradient(0, 0, W, L);
  sh.addColorStop(0.3, 'rgba(255,255,255,0)'); sh.addColorStop(0.42, 'rgba(160,180,255,.05)'); sh.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = sh; ctx.fillRect(0, 0, W, L);
  if (G.flood > 0) { ctx.fillStyle = rgba(G.floodColor, 0.5 * G.flood * G.flood); ctx.fillRect(0, 0, W, L); }
  ctx.restore();

  // markings: bottom half (always lit), top half powers up line by line
  const ml = Math.max(1.6, m * 0.005);
  const crease = isTop => { const p = new Path2D(); const y = isTop ? 0 : L; p.arc(W / 2, y, gw * 0.55, isTop ? 0 : Math.PI, isTop ? Math.PI : Math.PI * 2); return p; };
  const fo = (x, y) => { const p = new Path2D(); p.arc(x, y, m * 0.085, 0, Math.PI * 2); p.moveTo(x + 3, y); p.arc(x, y, 3, 0, Math.PI * 2); return p; };
  glow(halfBorder(false), C.p1, ml * 1.6, 1);
  glow(crease(false), C.p1, ml, 0.7);
  glow(fo(W * 0.25, L * 0.75), C.p1, ml * 0.8, 0.45);
  glow(fo(W * 0.75, L * 0.75), C.p1, ml * 0.8, 0.45);
  const P = G.p2Power;
  glow(halfBorder(true), topC, ml * 1.6, flick(P, 0, 4));
  glow(crease(true), topC, ml, 0.7 * flick(P, 1, 4));
  glow(fo(W * 0.25, L * 0.25), topC, ml * 0.8, 0.45 * flick(P, 2, 4));
  glow(fo(W * 0.75, L * 0.25), topC, ml * 0.8, 0.45 * flick(P, 3, 4));
  // goal mouths + posts
  for (const [y, color, pw] of [[0, topC, P], [L, C.p1, 1]]) {
    const mouth = new Path2D(); mouth.moveTo(W / 2 - gw / 2, y); mouth.lineTo(W / 2 + gw / 2, y);
    ctx.save(); ctx.setLineDash([6, 8]); glow(mouth, color, ml * 0.8, 0.35 * pw); ctx.restore();
    const posts = new Path2D(); posts.arc(W / 2 - gw / 2, y, 3.5, 0, 7); posts.moveTo(W / 2 + gw / 2 + 3.5, y); posts.arc(W / 2 + gw / 2, y, 3.5, 0, 7);
    glow(posts, '#ffffff', 3, 0.8 * Math.max(pw, 0.3));
  }
  // centre circle + line + gate
  const cc = new Path2D(); cc.arc(W / 2, L / 2, m * 0.16, 0, Math.PI * 2);
  glow(cc, C.tube, ml, 0.55);
  const line = new Path2D(); line.moveTo(0, L / 2); line.lineTo(W, L / 2);
  glow(line, C.tube, ml * 1.2, 0.5 + G.gatePulse * 0.8);
  if (G.gate > 0.01) {
    const gI = G.gate, half = (W / 2) * easeOut(gI), pulse = G.gatePulse;
    const gl = new Path2D(); gl.moveTo(W / 2 - half, L / 2); gl.lineTo(W / 2 + half, L / 2);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const band = ctx.createLinearGradient(0, L / 2 - R * 0.9, 0, L / 2 + R * 0.9);
    band.addColorStop(0, rgba(topC, 0)); band.addColorStop(0.5, rgba('#ffffff', 0.08 + pulse * 0.2)); band.addColorStop(1, rgba(C.p1, 0));
    ctx.fillStyle = band; ctx.globalAlpha = gI; ctx.fillRect(W / 2 - half, L / 2 - R * 0.9, half * 2, R * 1.8);
    ctx.restore();
    glow(gl, '#ffffff', ml * (1.6 + pulse * 2), gI);
    ctx.save(); ctx.setLineDash([m * 0.03, m * 0.05]); ctx.lineDashOffset = -time * m * 0.25;
    const g1 = new Path2D(); g1.moveTo(W / 2 - half, L / 2 - ml * 3.5); g1.lineTo(W / 2 + half, L / 2 - ml * 3.5);
    const g2 = new Path2D(); g2.moveTo(W / 2 + half, L / 2 + ml * 3.5); g2.lineTo(W / 2 - half, L / 2 + ml * 3.5);
    glow(g1, topC, ml * 0.9, gI * 0.9); glow(g2, C.p1, ml * 0.9, gI * 0.9);
    ctx.restore();
    // pylons
    const py = new Path2D(); py.rect(-2, L / 2 - R * 0.45, 4, R * 0.9); py.rect(W - 2, L / 2 - R * 0.45, 4, R * 0.9);
    glow(py, '#ffffff', 2.5, gI * (0.8 + pulse));
  }

  drawScoreboard();

  // rings
  for (const r of rings) {
    const q = r.t / r.dur, p = new Path2D(); p.arc(r.u, r.v, lerp(r.r0, r.r1, easeOut(q)), 0, Math.PI * 2);
    glow(p, r.color, r.w * (1 - q) + 0.6, (1 - q) * 0.9);
  }
  // trail
  if (puck.trail.length > 1 && !puck.hidden) {
    const tc = puck.last === 'bottom' ? C.p1 : topC;
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'butt'; ctx.lineJoin = 'round';
    const n = puck.trail.length;
    // tapered ribbon: outer coloured haze, then a hot white core
    for (const [col, wMul, aMul] of [[tc, 1.7, 0.22], [tc, 0.9, 0.35], ['#ffffff', 0.32, 0.55]]) {
      ctx.strokeStyle = col;
      for (let i = 1; i < n; i++) {
        const q = i / n, [a, b] = puck.trail[i - 1], [c, d] = puck.trail[i];
        if (Math.hypot(c - a, d - b) < 0.5) continue;
        ctx.globalAlpha = q * q * aMul; ctx.lineWidth = pr * wMul * q;
        ctx.beginPath(); ctx.moveTo(a, b); ctx.lineTo(c, d); ctx.stroke();
      }
    }
    ctx.restore();
  }
  // pads + puck
  for (const p of pads) drawPad(p, padColor(p));
  if (!puck.hidden) drawPuck();
  // sparks / motes
  ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.lineCap = 'round';
  for (const s of parts) {
    const a = clamp(s.life / s.max, 0, 1);
    ctx.globalAlpha = a; ctx.strokeStyle = s.color; ctx.lineWidth = s.w;
    ctx.beginPath(); ctx.moveTo(s.u, s.v); ctx.lineTo(s.u - s.vu * 0.03, s.v - s.vv * 0.03); ctx.stroke();
  }
  ctx.restore();
}
function reflOffset(d) { return [Math.sin(cur.theta) * d, Math.cos(cur.theta) * d]; } // "screen-down" in rink space
function drawPad(p, color) {
  if (p.alpha <= 0.01) return;
  const R = k.R * p.scale, { u, v } = p;
  ctx.save();
  ctx.globalAlpha = p.alpha;
  ctx.globalCompositeOperation = 'lighter';
  const pool = ctx.createRadialGradient(u, v, R * 0.6, u, v, R * 2.8);
  pool.addColorStop(0, rgba(color, 0.28)); pool.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = pool; ctx.beginPath(); ctx.arc(u, v, R * 2.8, 0, 7); ctx.fill();
  // reflection on glassy ice
  const [ox, oy] = reflOffset(R * 0.55);
  const refl = new Path2D(); refl.arc(u + ox, v + oy, R * 0.92, 0, 7);
  ctx.restore();
  glow(refl, color, R * 0.06, 0.18 * p.alpha);
  ctx.save(); ctx.globalAlpha = p.alpha;
  const body = ctx.createRadialGradient(u - R * 0.3, v - R * 0.3, R * 0.1, u, v, R);
  body.addColorStop(0, '#1a1f45'); body.addColorStop(1, '#03040c');
  ctx.fillStyle = body; ctx.beginPath(); ctx.arc(u, v, R, 0, 7); ctx.fill();
  ctx.restore();
  const ring = new Path2D(); ring.arc(u, v, R * 0.9, 0, 7);
  glow(ring, color, R * 0.11, p.alpha);
  const knob = new Path2D(); knob.arc(u, v, R * 0.42, 0, 7);
  ctx.save(); ctx.globalAlpha = p.alpha; ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rgba(color, 0.22); ctx.fill(knob); ctx.restore();
  glow(knob, color, R * 0.06, p.alpha * 0.9);
  ctx.save(); ctx.globalAlpha = p.alpha * 0.9; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(u - R * 0.12, v - R * 0.12, R * 0.08, 0, 7); ctx.fill(); ctx.restore();
}
function drawPuck() {
  const { pr, S } = k, { u, v } = puck;
  const sp = Math.hypot(puck.vu, puck.vv), st = clamp(sp / (2300 * S), 0, 1);
  const tc = puck.last === 'bottom' ? C.p1 : padColor(top);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  const pool = ctx.createRadialGradient(u, v, pr * 0.5, u, v, pr * 3.2);
  pool.addColorStop(0, rgba(C.puck, 0.35)); pool.addColorStop(0.5, rgba(tc, 0.12)); pool.addColorStop(1, rgba(tc, 0));
  ctx.fillStyle = pool; ctx.beginPath(); ctx.arc(u, v, pr * 3.2, 0, 7); ctx.fill();
  const [ox, oy] = reflOffset(pr * 0.6);
  ctx.globalAlpha = 0.15; ctx.fillStyle = C.puck; ctx.beginPath(); ctx.arc(u + ox, v + oy, pr * 0.9, 0, 7); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(u, v); ctx.rotate(Math.atan2(puck.vv, puck.vu)); ctx.scale(1 + st * 0.55, 1 - st * 0.18);
  const body = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
  body.addColorStop(0, '#ffffff'); body.addColorStop(0.55, '#fbffd8'); body.addColorStop(1, C.puck);
  ctx.fillStyle = body; ctx.beginPath(); ctx.arc(0, 0, pr, 0, 7); ctx.fill();
  const ring = new Path2D(); ring.arc(0, 0, pr * 0.62, 0, 7);
  ctx.strokeStyle = rgba(tc, 0.8); ctx.lineWidth = pr * 0.14; ctx.stroke(ring);
  ctx.restore();
  const outer = new Path2D(); outer.arc(u, v, pr, 0, 7);
  glow(outer, C.puck, pr * 0.08, 0.6);
}
function facingRotate(who) {
  if (who === 'p2') ctx.rotate(Math.PI);
  else if (who === 'screen') ctx.rotate(-cur.theta);
}
function flapTile(x, y, w, h, f, color, alpha) {
  const r = h * 0.12;
  ctx.save(); ctx.globalAlpha = alpha;
  ctx.fillStyle = 'rgba(8,10,26,.88)'; ctx.fill(rrPath(x - w / 2, y - h / 2, w, h, r));
  ctx.strokeStyle = rgba(color, 0.55); ctx.lineWidth = 1.2; ctx.stroke(rrPath(x - w / 2, y - h / 2, w, h, r));
  ctx.font = `600 ${h * 1.02}px ${FD}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const dy = h * 0.07;
  const digit = (val, clipTop, sy = 1) => {
    ctx.save(); ctx.beginPath(); ctx.rect(x - w / 2, clipTop ? y - h / 2 : y, w, h / 2); ctx.clip();
    ctx.translate(x, y); ctx.scale(1, sy);
    ctx.shadowColor = color; ctx.shadowBlur = h * 0.3; ctx.fillStyle = '#ffffff'; ctx.fillText(String(val), 0, dy);
    ctx.shadowBlur = 0; ctx.globalAlpha *= 0.35; ctx.fillStyle = color; ctx.fillText(String(val), 0, dy);
    ctx.restore();
  };
  const q = f.t;
  if (q >= 1) { digit(f.v, true); digit(f.v, false); }
  else {
    digit(f.v, true); digit(f.p, false);
    ctx.save();
    if (q < 0.5) { ctx.fillStyle = 'rgba(8,10,26,1)'; const sy = 1 - q * 2; ctx.fillRect(x - w / 2, y - (h / 2) * sy, w, (h / 2) * sy); digit(f.p, true, sy); }
    else { const sy = (q - 0.5) * 2; ctx.fillStyle = 'rgba(8,10,26,1)'; ctx.fillRect(x - w / 2, y, w, (h / 2) * sy); digit(f.v, false, sy); }
    ctx.restore();
  }
  ctx.fillStyle = 'rgba(0,0,0,.85)'; ctx.fillRect(x - w / 2, y - 0.8, w, 1.6);
  ctx.restore();
}
function label(text, x, y, size, color, align = 'center', alpha = 0.8) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.font = `700 ${size}px ${FL}`; ctx.textAlign = align; ctx.textBaseline = 'middle';
  ctx.shadowColor = color; ctx.shadowBlur = size * 0.8; ctx.fillStyle = color; ctx.fillText(text, x, y); ctx.restore();
}
function drawScoreboard() {
  const { W, L, m } = k;
  const th = clamp(m * 0.11, 40, 64), tw = th * 0.74;
  const topC = padColor(top);
  const nm = (G.name || 'YOU').toUpperCase();
  const topName = G.two ? 'P2' : G.mode === 'demo' ? 'AI' : 'AI·' + DIFFS[G.diff].name.toUpperCase();
  const a = G.mode === 'demo' ? 0.35 : 0.95;
  if (!G.two) {
    // stacked tiles on the right of the centre line, upright to the screen
    ctx.save(); ctx.translate(W - tw / 2 - 14, L / 2); facingRotate('screen');
    const vertical = Math.abs(Math.sin(cur.theta)) < 0.5;
    const off = th / 2 + 8;
    const [ax, ay, bx, by] = vertical ? [0, -off, 0, off] : [off, 0, -off, 0];
    flapTile(ax, ay, tw, th, G.flips[1], topC, a * G.p2Power + 0.05);
    flapTile(bx, by, tw, th, G.flips[0], C.p1, a);
    if (G.mode !== 'demo') {
      const lx = vertical ? -tw / 2 - 8 : 0;
      label(topName, lx, vertical ? ay : ay - th / 2 - 10, 9, topC, vertical ? 'right' : 'center');
      label(nm, lx, vertical ? by : by - th / 2 - 10, 9, C.p1, vertical ? 'right' : 'center');
      label(fmt(G.elapsed), lx, 0, 11, '#c9c6ff', vertical ? 'right' : 'center', 0.6);
    }
    ctx.restore();
  } else {
    // each player gets their own [mine | theirs] board facing them
    for (const who of ['p1', 'p2']) {
      ctx.save();
      if (who === 'p1') ctx.translate(W - tw * 1.2 - 16, L / 2 + th * 0.5 + 32); else { ctx.translate(tw * 1.2 + 16, L / 2 - th * 0.5 - 32); ctx.rotate(Math.PI); }
      const mine = who === 'p1' ? 0 : 1, col = who === 'p1' ? C.p1 : topC, ocol = who === 'p1' ? topC : C.p1;
      const pw = who === 'p2' ? G.p2Power : 1;
      flapTile(-tw * 0.58, 0, tw, th, G.flips[mine], col, a * pw);
      flapTile(tw * 0.58, 0, tw, th, G.flips[1 - mine], ocol, a * pw * 0.8);
      label(who === 'p1' ? nm.slice(0, 5) : 'P2', -tw * 0.58, th / 2 + 12, 8, col, 'center', 0.75 * pw);
      label(fmt(G.elapsed), tw * 0.58, th / 2 + 12, 10, '#c9c6ff', 'center', 0.55 * pw);
      ctx.restore();
    }
  }
}
function drawMsgs() {
  const { W, L } = k;
  for (const msg of G.msgs) {
    if (msg.t < 0) continue;
    const t = msg.t, d = msg.dur;
    const alpha = seg(t, 0, 0.1) * (1 - seg(t, d - 0.3, d));
    const targets = msg.who === 'both' ? (G.two ? ['p1', 'p2'] : ['screen']) : [msg.who];
    for (const who of targets) {
      const span = who === 'screen' && Math.abs(Math.sin(cur.theta)) > 0.5 ? L : W;
      const [x, y] = who === 'p1' ? [W / 2, L * 0.75] : who === 'p2' ? [W / 2, L * 0.25] : [W / 2, L / 2];
      ctx.save(); ctx.translate(x, y); facingRotate(who);
      const sweep = msg.pop ? 0 : (1 - easeOut(seg(t, 0, 0.4))) * span * 0.7 - ease(seg(t, d - 0.35, d)) * span * 0.7;
      const sc = msg.pop ? 1 + (1 - easeOut(seg(t, 0, 0.25))) * 0.8 : 1;
      ctx.translate(sweep, 0); ctx.scale(sc, sc);
      let size = msg.size * k.m;
      ctx.font = `900 italic ${size}px ${FL}`;
      const tw = ctx.measureText(msg.text).width;
      if (tw > span * 0.88) { size *= (span * 0.88) / tw; ctx.font = `900 italic ${size}px ${FL}`; }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = alpha;
      // speed streaks
      if (!msg.pop) {
        ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = rgba(msg.color, 0.25 * (1 - seg(t, 0.2, 0.7)));
        for (let i = -2; i <= 2; i++) ctx.fillRect(-span * 0.5, i * size * 0.18 - 1, span, 2);
        ctx.restore();
      }
      ctx.shadowColor = msg.color; ctx.shadowBlur = size * 0.5;
      ctx.fillStyle = msg.color; ctx.fillText(msg.text, 0, 0);
      ctx.shadowBlur = size * 0.15; ctx.fillStyle = '#ffffff'; ctx.globalAlpha = alpha * 0.85; ctx.fillText(msg.text, 0, 0);
      if (msg.sub) {
        const ss = size * 0.36; ctx.font = `700 ${ss}px ${FL}`; ctx.shadowBlur = ss; ctx.fillStyle = msg.color; ctx.globalAlpha = alpha;
        ctx.fillText(msg.sub.split('').join(' '), 0, size * 0.85);
      }
      ctx.restore();
    }
  }
}
function render(now) {
  const time = now / 1000;
  const { W, L } = k;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#03040a'; ctx.fillRect(0, 0, vw, vh);
  // synthwave backdrop: horizon glow + receding grid
  const bg = ctx.createRadialGradient(cur.cx, cur.cy, 0, cur.cx, cur.cy, Math.max(vw, vh) * 0.75);
  bg.addColorStop(0, 'rgba(70,40,160,.30)'); bg.addColorStop(0.6, 'rgba(30,10,60,.12)'); bg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, vw, vh);
  ctx.save(); ctx.strokeStyle = 'rgba(120,90,255,.07)'; ctx.lineWidth = 1;
  const gs = 36, off = (time * 12) % gs;
  ctx.beginPath();
  for (let x = -off; x < vw; x += gs) { ctx.moveTo(x, 0); ctx.lineTo(x, vh); }
  for (let y = -off; y < vh; y += gs) { ctx.moveTo(0, y); ctx.lineTo(vw, y); }
  ctx.stroke(); ctx.restore();

  const sh = RM ? 0 : G.shake;
  ctx.translate(cur.cx + rnd(-sh, sh), cur.cy + rnd(-sh, sh));
  ctx.rotate(cur.theta); ctx.scale(cur.zoom, cur.zoom); ctx.translate(-W / 2, -L / 2);
  const gap = G.crack * Math.min(42, k.m * 0.08);
  if (gap > 0.5) {
    for (const half of [0, 1]) {
      ctx.save();
      ctx.translate(0, half ? gap / 2 : -gap / 2);
      ctx.beginPath(); half ? ctx.rect(-200, L / 2, W + 400, L) : ctx.rect(-200, -L, W + 400, L * 1.5); ctx.clip();
      scene(time);
      ctx.restore();
    }
    // white-hot fissure
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const fz = ctx.createLinearGradient(0, L / 2 - gap, 0, L / 2 + gap);
    fz.addColorStop(0, 'rgba(255,43,214,0)'); fz.addColorStop(0.35, 'rgba(255,43,214,.5)'); fz.addColorStop(0.5, 'rgba(255,255,255,.95)'); fz.addColorStop(0.65, 'rgba(25,240,255,.5)'); fz.addColorStop(1, 'rgba(25,240,255,0)');
    ctx.fillStyle = fz; ctx.fillRect(-W * 0.2, L / 2 - gap, W * 1.4, gap * 2);
    ctx.globalAlpha = G.crack; ctx.fillStyle = '#ffffff'; ctx.fillRect(-W * 0.1, L / 2 - 1.5, W * 1.2, 3);
    ctx.restore();
  } else scene(time);
  drawMsgs();

  // confetti in screen space
  if (confetti.length) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (const c of confetti) {
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.r); ctx.scale(1, Math.cos(c.r * 2.3));
      ctx.globalAlpha = clamp(c.life, 0, 1); ctx.fillStyle = c.c; ctx.shadowColor = c.c; ctx.shadowBlur = 8;
      ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h); ctx.restore();
    }
  }
}

// ---------- UI panels ----------
const menu = $('#menu'), over = $('#over');
const nameIn = [$('#name'), $('#name2')];
G.name = store.get('hinge.name', '');
nameIn.forEach(i => {
  i.value = G.name; i.placeholder = 'Alex';
  i.addEventListener('input', () => { G.name = i.value.trim().slice(0, 12); store.set('hinge.name', G.name); nameIn.forEach(o => o !== i && (o.value = i.value)); });
  i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
});
const over2 = $('#over2');
function showPanel(which) {
  menu.hidden = which !== 'menu'; over.hidden = which !== 'over';
  over2.hidden = !(which === 'over' && G.two);
  if (which) layoutPanels();
}
function layoutPanels() {
  // 2P: each panel sits in its player's half, facing them, clear of the crease.
  const t = targetLayout();
  const spine = Math.abs(Math.sin(t.theta)) > 0.5; // goals left/right, players at the short ends
  const CL = 30; // keep clear of the crease
  for (const w of [menu, over, over2]) {
    const p = w.firstElementChild, pw = p.offsetWidth || 330, ph = p.offsetHeight || 480;
    const isP2 = w === over2;
    let rot = 0, tx = 0, ty = 0, sc;
    if (!G.two) sc = Math.min(1, (vw - 24) / pw, (vh - 76) / ph);
    else if (spine) {
      const hw = vw / 2 - CL - 10, hh = vh - 24;
      rot = isP2 ? -90 : 90; tx = (isP2 ? 1 : -1) * (CL / 2 + vw / 4); sc = Math.min(1, hw / ph, hh / pw);
    } else {
      const hw = vw - 24, hh = vh / 2 - CL - 10;
      rot = isP2 ? 180 : 0; ty = (isP2 ? -1 : 1) * (CL / 2 + vh / 4); sc = Math.min(1, hw / pw, hh / ph);
    }
    p.style.setProperty('--rot', rot + 'deg');
    p.style.setProperty('--tx', tx.toFixed(1) + 'px');
    p.style.setProperty('--ty', ty.toFixed(1) + 'px');
    p.style.setProperty('--s', sc.toFixed(3));
  }
}
function updateMenuText() {
  $('#modeHint').textContent = G.two ? '2 players · face to face across the crease' : 'You vs the AI · first to 7';
  $('#tip').textContent = G.two ? 'Each player owns a half. Fold it and the AI takes over.' : 'Unfold mid-game and a friend’s paddle drops in.';
  $('#play').textContent = G.two ? 'Face off · 2P' : 'Face off';
}
const diffBtns = [...document.querySelectorAll('#diff button')];
function setDiff(d) {
  G.diff = d; store.set('hinge.diff', d);
  diffBtns.forEach(b => b.setAttribute('aria-checked', String(+b.dataset.d === d)));
}
diffBtns.forEach(b => b.addEventListener('click', () => { if (!b.disabled) { setDiff(+b.dataset.d); haptic(); sfx.init(); } }));
$('#play').addEventListener('click', () => { sfx.init(); haptic(); newGame(); });
for (const id of ['#rematch', '#rematch2']) $(id).addEventListener('click', () => { sfx.init(); haptic(); newGame(); });
$('#toMenu').addEventListener('click', () => { G.mode = 'demo'; G.score = [0, 0]; G.flips.forEach(f => { f.v = f.p = 0; f.t = 1; }); faceoff('center'); showPanel('menu'); });
$('#share').addEventListener('click', async () => {
  haptic();
  const [a, b] = G.score, t = Math.round(G.over?.time || G.elapsed);
  const st = { n: G.name || 'A friend', a, b, t, d: G.diff, w: a > b ? 1 : 0, m: G.two ? 2 : 1 };
  const url = location.href.split('#')[0] + '#c=' + await encodeState(st);
  const ai = DIFFS[G.diff].name;
  const text = G.two ? `We just played face to face on Hinge Hockey (${a}–${b}). Now beat the ${ai} AI.`
    : st.w ? `I beat the ${ai} AI ${a}–${b} in ${fmt(t)} on Hinge Hockey. Your move.`
      : `The ${ai} AI beat me ${a}–${b} on Hinge Hockey. Can you take it down?`;
  await shareLink(url, { title: 'Hinge Hockey challenge', text });
});
function fillOver() {
  const [a, b] = G.score, w = G.over.winner;
  const res = $('#result');
  res.textContent = G.two ? (w === 0 ? 'YOU WIN' : 'YOU LOSE') : w === 0 ? 'YOU WIN' : 'AI WINS';
  res.style.setProperty('--hue', w === 0 ? C.p1 : G.two ? '#8d8aa8' : C.ai);
  $('#final').textContent = `${a}–${b} · ${fmt(G.over.time)}`;
  const r2 = $('#result2');
  r2.textContent = w === 1 ? 'YOU WIN' : 'YOU LOSE';
  r2.style.setProperty('--hue', w === 1 ? C.p2 : '#8d8aa8');
  $('#final2').textContent = `${b}–${a} · ${fmt(G.over.time)}`;
  $('#vs2').textContent = `vs ${G.name || 'Player 1'}`;
  const beat = $('#beat'), ch = G.challenge;
  beat.hidden = true;
  if (ch && !G.two && ch.d === G.diff) {
    const mine = a - b, theirs = ch.a - ch.b;
    beat.hidden = false;
    if (w === 0 && (mine > theirs || (mine === theirs && G.over.time < ch.t) || !ch.w)) beat.textContent = `You beat ${ch.n}'s ${ch.a}–${ch.b}! Send it back.`;
    else if (w === 0) beat.textContent = `Won — but ${ch.n}'s ${ch.a}–${ch.b} in ${fmt(ch.t)} still stands.`;
    else beat.textContent = `${ch.n}'s ${ch.a}–${ch.b} survives. Rematch?`;
  }
  $('#share').textContent = 'Challenge a friend';
}
async function readHash() {
  const m = location.hash.match(/c=([^&]+)/);
  if (!m) return;
  const c = await decodeState(m[1]);
  if (!c || typeof c !== 'object') return;
  const ch = { n: String(c.n || 'A friend').slice(0, 12), a: clamp(c.a | 0, 0, WIN), b: clamp(c.b | 0, 0, WIN), t: Math.max(0, c.t | 0), d: clamp(c.d | 0, 0, 2), w: c.w ? 1 : 0 };
  G.challenge = ch;
  setDiff(ch.d);
  diffBtns.forEach(b => (b.disabled = +b.dataset.d !== ch.d));
  const el = $('#chal');
  el.textContent = ch.w ? `Beat ${ch.n}'s ${ch.a}–${ch.b} in ${fmt(ch.t)}` : `${ch.n} lost ${ch.a}–${ch.b} to the ${DIFFS[ch.d].name} AI. Avenge them.`;
  el.hidden = false;
  layoutPanels();
}

// ---------- boot ----------
function loop(now) {
  const dt = Math.min(0.05, Math.max(0, (now - last) / 1000)); last = now;
  update(dt);
  render(now);
  requestAnimationFrame(loop);
}
let last = performance.now();
document.addEventListener('visibilitychange', () => { last = performance.now(); });

resizeCanvas();
makePattern();
setDiff(G.diff);
fold.on((s, prev, kind) => {
  if (kind === 'init') {
    G.two = s.open; Object.assign(cur, targetLayout()); computeK();
    placeHome(); faceoff('center'); puck.vu = 260 * k.S; puck.vv = 340 * k.S;
    G.gate = G.two ? 1 : 0;
    updateMenuText();
    return;
  }
  resizeCanvas();
  const to = targetLayout();
  if (prev && s.open && !prev.open) startMorph(to, 'join');
  else if (prev && !s.open && prev.open) startMorph(to, 'leave');
  else startMorph(to, 'resize');
});
addEventListener('resize', resizeCanvas);
mountChrome();
showPanel('menu');
readHash();
document.fonts?.load?.(`600 40px ${FD}`).catch(() => {});
document.fonts?.load?.(`900 40px ${FL}`).catch(() => {});
requestAnimationFrame(loop);
// expose for testing
if (/[?&]debug\b/.test(location.search)) window.__hockey = { G, puck, bot, top, cur, k: () => k, newGame };
