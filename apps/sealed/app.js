// Sealed — a wax-sealed pop-up card you send as a link.
// No hash → Maker. #<encoded> → Recipient.
import { fold, unlock, haptic, shareLink, encodeState, decodeState, toast, mountChrome } from '../../shared/kit.js';
import { THEMES, THEME_KEYS, SEAL_COLORS, EMOJI, linerCSS } from './art.js';
import { Seal, sealSeed } from './seal.js';
import { sfx, setAudio } from './audio.js';
import { FX } from './fx.js';

const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const fx = new FX(document.querySelector('canvas.fx'));
const app = document.getElementById('app');
const wait = ms => new Promise(r => setTimeout(r, reduced ? Math.min(ms, 40) : ms));
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
const easeOut = t => 1 - (1 - t) ** 3;
const easeInOut = t => (t < .5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
function tween(ms, fn, ease = easeOut) {
  return new Promise(res => {
    if (reduced) { fn(1, 1); res(); return; }
    const t0 = performance.now();
    const f = now => { const t = Math.min(1, (now - t0) / ms); fn(ease(t), t); t < 1 ? requestAnimationFrame(f) : res(); };
    requestAnimationFrame(f);
  });
}
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

// ───────────────────────── audio / motion unlock (tap-gated on iOS)
let audioReady = false, motionReady = false;
async function ensureAudio() {
  if (audioReady) return; audioReady = true;
  try { const { audio } = await unlock({ audio: true }); setAudio(audio); } catch {}
}
async function ensureMotion() {
  if (motionReady) return; motionReady = true;
  const { motion } = await unlock({ motion: true }).catch(() => ({}));
  if (motion) addEventListener('deviceorientation', onOrient);
}
addEventListener('pointerdown', ensureAudio, { capture: true });
addEventListener('click', ensureMotion, { capture: true });

// Tilt: shared smoothed vector (-1..1) from gyro or mouse.
const tilt = { x: 0, y: 0, tx: 0, ty: 0 };
let baseBeta = null;
function onOrient(e) {
  if (e.beta == null) return;
  if (baseBeta == null) baseBeta = e.beta;
  tilt.tx = clamp((e.gamma || 0) / 25, -1, 1);
  tilt.ty = clamp((e.beta - baseBeta) / 25, -1, 1);
}
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  tilt.tx = clamp((e.clientX / innerWidth - .5) * 2, -1, 1);
  tilt.ty = clamp((e.clientY / innerHeight - .5) * 2, -1, 1);
});

// ───────────────────────── data
const DEFAULT = { t: 'b', h: '', m: '', f: '', e: ['🎈', '🥳'], c: 0, i: '' };
function normalize(d) {
  const o = { ...DEFAULT };
  if (!d || typeof d !== 'object') return o;
  o.t = THEME_KEYS.includes(d.t) ? d.t : 'b';
  o.h = String(d.h ?? '').slice(0, 40);
  o.m = String(d.m ?? '').slice(0, 200);
  o.f = String(d.f ?? '').slice(0, 24);
  o.e = Array.isArray(d.e) ? d.e.filter(x => typeof x === 'string' && x.length <= 8).slice(0, 3) : [];
  o.c = Number.isInteger(d.c) && d.c >= 0 && d.c < SEAL_COLORS.length ? d.c : 0;
  o.i = String(d.i ?? '').slice(0, 2);
  return o;
}
const letterOf = d => ([...(d.i || d.f || 'S').trim()][0] || 'S').toUpperCase();
const headlineOf = d => d.h.trim() || THEMES[d.t].h;
const messageOf = d => d.m.trim() || THEMES[d.t].m;

// ───────────────────────── the card + envelope controller
class Sealed {
  constructor(host, data, { full = false } = {}) {
    this.host = host;
    this.full = full;
    this.data = data;
    this.state = 'sealed';
    this.layers = [];
    this.run = 0;
    this.root = h('div', 'sealed' + (full ? ' full' : ''));
    host.appendChild(this.root);
    this.card = h('div', 'card');
    this.cover = h('div', 'cover');
    this.root.append(this.card, this.cover);
    this.applyTheme();
    this.buildCard();
    this.buildEnv();
    this.showEnvInstant();
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  applyTheme() {
    const th = THEMES[this.data.t];
    this.root.dataset.theme = this.data.t;
    this.root.classList.toggle('dark', !!th.pal.dark || !!th.dark);
    const s = this.root.style;
    for (const [k, v] of Object.entries(th.pal)) s.setProperty('--' + k, v);
    s.setProperty('--liner-img', linerCSS(this.data.t));
    s.setProperty('--wax', SEAL_COLORS[this.data.c].c);
  }

  // ── inside of the card
  buildCard() {
    const d = this.data, th = THEMES[d.t];
    this.card.innerHTML = '';
    const wall = h('div', 'wall'), floor = h('div', 'floor'), scene = h('div', 'scene');
    wall.append(h('div', 'tex'), h('div', 'deco'));
    floor.append(h('div', 'tex'));
    this.headline = h('h1', 'headline');
    wall.append(this.headline);
    const note = h('div', 'note');
    this.msg = h('p', 'msg');
    this.sig = h('p', 'sig');
    note.append(this.msg, this.sig);
    this.hint = h('p', 'hint');
    this.cta = h('div', 'cta');
    this.card.append(wall, floor, h('div', 'crease'), scene, note, this.hint, this.cta);
    this.scene = scene;
    this.buildLayers();
    this.setText(d);
    scene.addEventListener('pointerdown', e => this.onLayerTap(e));
  }

  buildLayers() {
    const d = this.data, th = THEMES[d.t];
    this.scene.innerHTML = '';
    const defs = th.layers();
    const em = d.e.slice(0, 3);
    const pos = [[82], [15, 85], [14, 86, 70]][em.length - 1] || [];
    const stand = [[9], [9, 13], [9, 13, 4]][em.length - 1] || [];
    em.forEach((ch, k) => defs.push({ sticker: ch, x: pos[k], w: 14, d: 3, stand: stand[k] }));
    const shadows = h('div', 'shadows');
    this.scene.append(shadows);
    this.layers = defs.map((L, i) => {
      const el = h('div', 'layer d' + L.d);
      el.style.setProperty('--x', L.x);
      el.style.setProperty('--w', L.w);
      el.style.setProperty('--d', L.d);
      if (L.sticker) {
        el.classList.add('sticker-layer');
        el.style.setProperty('--stand', L.stand);
        const st = h('div', 'sticker'); const sp = h('span'); sp.textContent = L.sticker; st.append(sp);
        el.append(st, h('div', 'stand'));
      } else el.innerHTML = L.svg;
      const sh = h('div', 'lshadow d' + L.d);
      sh.style.setProperty('--x', L.x); sh.style.setProperty('--w', L.w * .92); sh.style.setProperty('--d', L.d);
      shadows.append(sh);
      this.scene.append(el);
      return { el, sh, def: L, i, p: 0, v: 0, target: 0, delay: 0, popped: false, ph: Math.random() * 6 };
    });
    this.lit = 5;
  }

  setText(d) {
    this.data = d;
    const mk = (el, str, cls) => {
      el.textContent = '';
      el.dataset.text = str;
      str.split(/(\s+)/).forEach(w => {
        if (!w) return;
        if (/^\s+$/.test(w)) { el.append(document.createTextNode(' ')); return; }
        const word = h('span', 'word');
        for (const ch of w) { const s = h('span', cls); s.textContent = ch; word.append(s); }
        el.append(word);
      });
    };
    mk(this.headline, headlineOf(d), 'ch');
    mk(this.msg, messageOf(d), 'ch');
    this.sig.textContent = d.f.trim() ? '— ' + d.f.trim() : '';
    if (this.textShown) this.showTextInstant();
  }

  showTextInstant() {
    this.textShown = true;
    this.card.classList.add('text-instant', 'text-on');
    this.card.querySelectorAll('.ch').forEach(s => s.classList.add('on'));
    this.sig.classList.add('on');
  }
  hideText() {
    this.textShown = false;
    this.typing = null;
    this.card.classList.remove('text-on', 'text-instant', 'cta-on');
    this.card.querySelectorAll('.ch.on').forEach(s => s.classList.remove('on'));
    this.sig.classList.remove('on');
    this.caret?.remove();
  }
  async revealText(run) {
    this.card.classList.remove('text-instant');
    this.card.classList.add('text-on');
    const hs = [...this.headline.querySelectorAll('.ch')];
    hs.forEach((s, i) => { s.style.animationDelay = (i * 45) + 'ms'; s.classList.add('on'); });
    await wait(Math.min(1400, hs.length * 45 + 300));
    if (run !== this.run) return;
    if (this.data.t === 's' && !this.keyOpen) { this.setHint('Tap the keyhole to read it'); return; }
    await this.typeMessage(run);
  }
  async typeMessage(run) {
    const ms = [...this.msg.querySelectorAll('.ch')];
    this.caret = this.caret || h('span', 'caret');
    this.msg.append(this.caret);
    await new Promise(res => {
      let i = 0, acc = 0, last = performance.now();
      const step = now => {
        if (run !== this.run) { this.caret.remove(); return res(); }
        acc += (now - last) / 1000 * (reduced ? 1e4 : 38); last = now;
        while (acc >= 1 && i < ms.length) {
          ms[i].classList.add('on');
          ms[i].after(this.caret);
          if (i % 2 === 0) sfx.nib();
          i++; acc -= 1;
          if (/[.,!?]/.test(ms[i - 1].textContent)) acc -= 5; // pause on punctuation
        }
        if (i < ms.length) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
    if (run !== this.run) return;
    await wait(250);
    this.caret.remove();
    this.sig.classList.add('on');
    this.textShown = true;
  }
  setHint(t) { this.hint.textContent = t; this.hint.classList.toggle('on', !!t); }

  // ── envelope
  buildEnv() {
    const d = this.data;
    this.cover.innerHTML = '';
    const desk = h('div', 'desk');
    const wrap = h('div', 'env-wrap');
    const env = h('div', 'env');
    env.innerHTML = `
      <div class="env-back"><div class="inside"></div>
        <svg class="pocket" viewBox="0 0 100 120" preserveAspectRatio="none" aria-hidden="true">
          <defs><linearGradient id="pk${this.run}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".2"/><stop offset="1" stop-color="#000" stop-opacity=".06"/></linearGradient></defs>
          <path d="M0 0L47 62Q50 65 53 62L100 0V120H0Z" fill="var(--env)"/>
          <path d="M0 0L47 62Q50 65 53 62L100 0" fill="none" stroke="rgba(0,0,0,.12)" stroke-width=".5" vector-effect="non-scaling-stroke"/>
          <path d="M0 120L46 70Q50 66 54 70L100 120Z" fill="url(#pk${this.run})"/>
          <path d="M0 120L46 70Q50 66 54 70L100 120" fill="none" stroke="rgba(0,0,0,.16)" stroke-width="1" vector-effect="non-scaling-stroke"/>
        </svg><div class="tex"></div>
        <div class="address"><span class="for">For you</span><span class="from"></span></div>
      </div>
      <div class="flap"><div class="face out"><div class="tex"></div></div><div class="face in"></div></div>
      <div class="seal-host"><div class="halo"></div><div class="seal-shadow"></div><div class="seal"></div></div>`;
    wrap.append(env);
    const ui = h('div', 'cover-ui');
    ui.innerHTML = `<div class="prompt-wrap"><p class="prompt"></p><p class="sub"></p></div>
      <div class="after"><button class="duo-btn reseal" type="button">Reseal?</button><a class="make" href="./">Make your own Sealed card</a></div>`;
    this.cover.append(desk, wrap, ui);
    this.env = env; this.wrap = wrap; this.desk = desk; this.ui = ui;
    this.flap = env.querySelector('.flap');
    this.sealHost = env.querySelector('.seal-host');
    env.querySelector('.from').textContent = d.f.trim() ? 'from ' + d.f.trim() : '';
    this.buildSeal();
  }
  buildSeal() {
    const d = this.data, color = SEAL_COLORS[d.c].c, L = letterOf(d);
    this.seal = new Seal(this.sealHost.querySelector('.seal'), { color, letter: L, seed: sealSeed(L, color) });
    this.root.style.setProperty('--wax', color);
  }
  setFlap(a) {
    this.flapA = a;
    this.flap.style.transform = `rotateX(${a.toFixed(2)}deg)`;
    this.flap.classList.toggle('flipped', a > 90);
  }

  showEnvInstant() {
    this.run++;
    this.state = 'sealed';
    this.root.dataset.state = 'sealed';
    this.cover.style.display = '';
    this.cover.classList.remove('gone', 'fade');
    this.wrap.classList.remove('away');
    this.setFlap(0);
    this.seal.reset();
    this.sealHost.style.opacity = '';
    this.card.style.visibility = 'hidden';
    this.layers.forEach(L => { L.p = 0; L.v = 0; L.target = 0; });
    this.hideText();
  }
  showCardInstant() {
    this.run++;
    this.state = 'open';
    this.root.dataset.state = 'open';
    this.cover.style.display = 'none';
    this.card.style.visibility = '';
    this.layers.forEach(L => { L.p = 1; L.v = 0; L.target = 1; L.popped = true; });
    this.showTextInstant();
  }

  rise(stagger = 110) {
    const now = performance.now();
    this.layers.forEach((L, i) => { L.target = 1; L.delay = now + i * stagger; L.popped = false; });
  }
  flatten(stagger = 70) {
    const now = performance.now(), n = this.layers.length;
    this.layers.forEach((L, i) => { L.target = 0; L.delay = now + (n - 1 - i) * stagger; });
  }

  loop(now) {
    if (!this.root.isConnected) return;
    const dt = Math.min(.04, (now - (this.last || now)) / 1000); this.last = now;
    tilt.x += (tilt.tx - tilt.x) * Math.min(1, dt * 6);
    tilt.y += (tilt.ty - tilt.y) * Math.min(1, dt * 6);
    // Card layers: underdamped springs + idle sway + tilt parallax.
    if (this.card.style.visibility !== 'hidden') {
      const k = 170, c = 12.5;
      const u = this.unit || (this.unit = this.measureU());
      for (const L of this.layers) {
        if (now >= L.delay) {
          for (let s = 0; s < 2; s++) {
            const a = k * (L.target - L.p) - c * L.v;
            L.v += a * dt / 2; L.p += L.v * dt / 2;
          }
          if (L.target === 1 && !L.popped && L.p > .55) { L.popped = true; sfx.pop(L.i); }
        }
        const p = clamp(L.p, -.15, 1.2);
        const sway = reduced ? 0 : Math.sin(now / 1000 * .9 + L.ph) * 1.4 * clamp(p);
        const tx = tilt.x * (L.def.d + 1) * u * 1.1;
        L.el.style.transform = `translate3d(${tx.toFixed(2)}px,0,0) rotateX(${((1 - p) * -84).toFixed(2)}deg) rotateY(${(sway + tilt.x * 3).toFixed(2)}deg)`;
        L.sh.style.transform = `translateX(${(tx * .6).toFixed(2)}px) scaleY(${clamp(p, 0, 1.15).toFixed(3)})`;
        L.sh.style.opacity = (clamp(p) * .9).toFixed(3);
      }
    }
    // Envelope: idle breathing + tilt, specular follows tilt.
    if (this.cover.style.display !== 'none' && (this.state === 'sealed' || this.state === 'broken')) {
      const br = reduced ? 0 : Math.sin(now / 1000 * 1.3) * .6;
      this.env.style.transform = `rotateX(${(-tilt.y * 5 + br).toFixed(2)}deg) rotateY(${(tilt.x * 5).toFixed(2)}deg)`;
      this.seal.setGloss(tilt.x + Math.sin(now / 2400) * .15, tilt.y);
      this.env.style.setProperty('--sx', (-tilt.x * 8).toFixed(1) + 'px');
      this.env.style.setProperty('--sy', (10 - tilt.y * 6).toFixed(1) + 'px');
    }
    requestAnimationFrame(this.loop);
  }
  measureU() {
    const r = this.root.getBoundingClientRect();
    return Math.min(r.width / 100, r.height * .0062) || 4;
  }

  sealCenter() {
    const r = this.sealHost.getBoundingClientRect();
    return [r.left + r.width / 2, r.top + r.height / 2, r.width];
  }

  // ── the hero sequence
  async open() {
    if (this.state === 'opening' || this.state === 'open') return;
    const run = ++this.run;
    this.state = 'opening';
    this.root.dataset.state = 'opening';
    tilt.tx = tilt.ty = 0;
    this.env.style.transition = 'transform .25s';
    this.env.style.transform = '';
    this.unit = this.measureU();
    this.card.style.visibility = '';
    this.layers.forEach(L => { L.p = 0; L.v = 0; L.target = 0; });
    this.hideText();
    this.setHint('');
    // 0ms — crack!
    const [cx, cy, sw] = this.sealCenter();
    sfx.crack(); haptic(30); sfx.tinkle();
    this.sealHost.classList.remove('flash'); void this.sealHost.offsetWidth; this.sealHost.classList.add('flash');
    if (!reduced) fx.crumbs(cx, cy, SEAL_COLORS[this.data.c].c, Math.round(sw / 4));
    this.seal.shatter({ reduced });
    await wait(250);
    if (run !== this.run) return;
    // 250ms — flap swings open in 3D
    sfx.paper(.6); haptic();
    tween(780, e => this.setFlap(e * 178), easeInOut);
    await wait(470);
    if (run !== this.run) return;
    // ~720ms — envelope drops away, desk fades
    this.env.style.transition = '';
    this.wrap.classList.add('away');
    this.cover.classList.add('fade');
    if (this.full) document.documentElement.classList.toggle('light-ui', !this.root.classList.contains('dark'));
    await wait(300);
    if (run !== this.run) return;
    // ~1000ms — pop-ups rise from the crease
    this.rise();
    sfx.paper(.45);
    await wait(650);
    if (run !== this.run) return;
    this.cover.style.display = 'none';
    this.flourish();
    await this.revealText(run);
    if (run !== this.run) return;
    this.card.classList.add('cta-on');
    this.idleHint();
    this.state = 'open';
    this.root.dataset.state = 'open';
    this.onSettled?.();
  }

  async close() {
    if (this.state === 'sealed' || this.state === 'broken' || this.state === 'closing') return;
    const run = ++this.run;
    this.state = 'closing';
    this.root.dataset.state = 'closing';
    if (this.full) document.documentElement.classList.remove('light-ui');
    this.card.classList.add('text-fade');
    this.setHint('');
    this.flatten();
    sfx.paper(.4); haptic();
    await wait(560);
    if (run !== this.run) return;
    this.hideText();
    this.card.classList.remove('text-fade');
    this.cover.style.display = '';
    this.seal.setBroken();
    this.sealHost.style.opacity = '';
    this.setFlap(178);
    void this.cover.offsetWidth;
    this.cover.classList.remove('fade');
    this.wrap.classList.remove('away');
    await wait(380);
    if (run !== this.run) return;
    sfx.paper(.35);
    await tween(560, e => this.setFlap(178 * (1 - e)), easeInOut);
    if (run !== this.run) return;
    haptic(15);
    this.card.style.visibility = 'hidden';
    this.state = 'broken';
    this.root.dataset.state = 'broken';
    this.onSettled?.();
  }

  async reseal() {
    if (this.state !== 'broken') return;
    this.state = 'resealing';
    sfx.thunk(); haptic(25);
    this.sealHost.classList.remove('stamp'); void this.sealHost.offsetWidth; this.sealHost.classList.add('stamp');
    await this.seal.heal();
    this.state = 'sealed';
    this.root.dataset.state = 'sealed';
    this.onSettled?.();
  }

  flourish() {
    if (reduced) return;
    const r = this.root.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height * .5;
    const t = this.data.t;
    if (t === 'c') { fx.confetti(cx, cy, { n: 140, colors: ['#D4A017', '#F3C13F', '#FFF6D0', '#1F2A44', '#E8577A'], spread: 1.6 }); sfx.chime(); }
    if (t === 'b') fx.confetti(cx, cy, { n: 70, spread: 1.4, speed: 420 });
    if (t === 'l') fx.hearts(cx, cy, 22);
    if (t === 'p') { this.fireworks(3); }
    if (t === 't') fx.petals(cx, r.top + r.height * .35, 22);
    if (t === 's') fx.sparkles(cx, r.top + r.height * .38, 30);
  }
  fireworks(n) {
    const r = this.root.getBoundingClientRect();
    for (let i = 0; i < n; i++) setTimeout(() => {
      if (this.state !== 'open' && this.state !== 'opening') return;
      fx.firework(r.left + r.width * (.2 + Math.random() * .6), r.top + r.height * (.18 + Math.random() * .2), ['#FF4FD8', '#3EF0FF', '#FFD36B', '#B9A4FF'][(Math.random() * 4) | 0]);
      sfx.boom();
    }, i * 520);
  }
  idleHint() {
    const t = this.data.t;
    const m = { b: 'Make a wish: tap the candles', l: 'Tap a heart', c: 'Tap the trophy', p: 'Tap the skyline', t: 'Tap the flowers', s: this.keyOpen ? '' : 'Tap the keyhole to read it' }[t];
    this.setHint(m);
  }

  onLayerTap(e) {
    if (this.state !== 'open' && this.state !== 'opening') return;
    const el = e.target.closest('.layer');
    if (!el) return;
    const L = this.layers.find(l => l.el === el);
    if (!L) return;
    L.v -= 2.2; // a little boing
    haptic(); sfx.tap();
    const x = e.clientX, y = e.clientY;
    if (L.def.sticker) { fx.emoji(x, y, L.def.sticker, 9); return; }
    switch (L.def.tap) {
      case 'candles': this.blowCandle(el, x); break;
      case 'heart': fx.hearts(x, y, 14); el.classList.remove('beat'); void el.offsetWidth; el.classList.add('beat'); break;
      case 'confetti': fx.confetti(x, y, { n: 60, colors: ['#D4A017', '#F3C13F', '#FFF6D0', '#E8577A', '#5BC0BE'] }); sfx.chime(); break;
      case 'firework': {
        const r = this.root.getBoundingClientRect();
        fx.firework(x, Math.min(y - 60, r.top + r.height * .3), ['#FF4FD8', '#3EF0FF', '#FFD36B'][(Math.random() * 3) | 0]); sfx.boom(); break;
      }
      case 'petals': fx.petals(x, y, 14); break;
      case 'keyhole': {
        fx.sparkles(x, y, 26);
        sfx.chime();
        if (!this.keyOpen) {
          this.keyOpen = true;
          this.root.classList.add('unlocked');
          this.setHint('');
          const run = this.run;
          this.typeMessage(run).then(() => { if (run === this.run) { this.card.classList.add('cta-on'); this.idleHint(); } });
        }
        break;
      }
    }
  }
  blowCandle(el, x) {
    const lit = [...el.querySelectorAll('.candle:not(.out)')];
    if (!lit.length) { el.querySelectorAll('.candle').forEach(c => c.classList.remove('out')); this.lit = 5; return; }
    let best = lit[0], bd = 1e9;
    for (const c of lit) { const r = c.getBoundingClientRect(); const d = Math.abs(r.left + r.width / 2 - x); if (d < bd) { bd = d; best = c; } }
    best.classList.add('out');
    sfx.blow();
    if (--this.lit <= 0) {
      const r = this.root.getBoundingClientRect();
      setTimeout(() => { fx.confetti(r.left + r.width / 2, r.top + r.height * .45, { n: 160, spread: 2.2, speed: 600 }); sfx.chime(); haptic(40); this.setHint('Wish made ✨  Tap again to relight'); }, 300);
    }
  }

  // ── drag to tear (recipient cover)
  attachDrag(onBreak) {
    let drag = null, lastStep = 0;
    const env = this.env;
    env.addEventListener('pointerdown', e => {
      if (this.state !== 'sealed' && this.state !== 'broken') return;
      const [cx, cy, sw] = this.sealCenter();
      if (Math.hypot(e.clientX - cx, e.clientY - cy) > sw * .85) return;
      e.preventDefault();
      env.setPointerCapture?.(e.pointerId);
      const er = this.env.getBoundingClientRect();
      drag = { cx, cy, id: e.pointerId, max: Math.max(120, er.width * .42), moved: false, p: 0 };
      lastStep = 0;
      this.sealHost.classList.add('held');
      this.sealHost.style.transition = 'none';
    });
    env.addEventListener('pointermove', e => {
      if (!drag || e.pointerId !== drag.id) return;
      const dx = e.clientX - drag.cx, dy = e.clientY - drag.cy, dist = Math.hypot(dx, dy);
      if (dist > 8) drag.moved = true;
      const p = clamp((dist - 8) / drag.max);
      drag.p = p;
      if (this.state === 'sealed') this.seal.setCrack(p, Math.atan2(dy, dx));
      const pull = Math.min(1, dist / drag.max);
      this.sealHost.style.transform = `translate(calc(-50% + ${(dx * .14 * pull).toFixed(1)}px), calc(-50% + ${(dy * .14 * pull).toFixed(1)}px)) scale(${(1 + p * .05).toFixed(3)}) rotate(${(dx * .03 * p).toFixed(1)}deg)`;
      this.setFlap(p * 12);
      const step = Math.floor(p * 10);
      if (step > lastStep) { lastStep = step; haptic(8 + step); sfx.creak(p); }
      if (p >= 1) {
        drag = null;
        this.sealHost.classList.remove('held');
        this.sealHost.style.transition = '';
        this.sealHost.style.transform = '';
        onBreak();
      }
    });
    const end = e => {
      if (!drag || e.pointerId !== drag.id) return;
      const d = drag; drag = null;
      this.sealHost.classList.remove('held');
      this.sealHost.style.transition = '';
      this.sealHost.style.transform = '';
      if (!d.moved) { this.onSealTap?.(); return; }
      const from = d.p, fa = this.flapA || 0;
      tween(380, e2 => { if (this.state === 'sealed') this.seal.setCrack(from * (1 - e2)); if (this.state === 'sealed' || this.state === 'broken') this.setFlap(fa * (1 - e2)); });
    };
    env.addEventListener('pointerup', end);
    env.addEventListener('pointercancel', end);
  }

  destroy() { this.run++; this.root.remove(); }
}

// ───────────────────────── Recipient
async function recipient(data) {
  document.title = 'Sealed: something for you ✉️';
  const stage = h('div', 'stage rcp');
  app.append(stage);
  const card = new Sealed(stage, data, { full: true });
  card.buildCta = () => {};
  const cta = h('a', 'duo-btn cta-btn', 'Make your own Sealed card');
  cta.href = './';
  cta.addEventListener('click', () => { haptic(); });
  const again = h('button', 'ghost-link', 'Fold it closed again');
  again.type = 'button';
  again.addEventListener('click', () => { haptic(); if (fold.state.open && !fold.state.physical) fold.toggle(false); else { wantOpen = false; reconcile(); } });
  card.cta.append(cta, again);

  const prompt = card.ui.querySelector('.prompt'), sub = card.ui.querySelector('.sub');
  const setPrompt = () => {
    const openScreen = fold.state.open;
    prompt.textContent = card.state === 'broken' ? 'The seal is broken' : openScreen ? 'Tap the seal to break it' : 'Unfold to break the seal';
    sub.textContent = card.state === 'broken' ? '' : openScreen ? 'or drag it outward' : 'or drag the seal outward to tear it open';
    card.ui.classList.toggle('broken', card.state === 'broken');
  };
  setPrompt();

  let wantOpen = false, busy = false;
  async function reconcile() {
    if (busy) return;
    if (wantOpen && (card.state === 'sealed' || card.state === 'broken')) { busy = true; await card.open(); busy = false; }
    else if (!wantOpen && card.state === 'open') { busy = true; await card.close(); busy = false; setPrompt(); }
    else return;
    reconcile();
  }
  const breakIt = () => {
    if (!fold.state.open) fold.toggle(true); // simulated unfold — the fold listener opens it
    else { wantOpen = true; reconcile(); }
  };
  card.attachDrag(breakIt);
  card.onSealTap = () => {
    if (fold.state.open) { breakIt(); return; }
    haptic(); sfx.tap();
    card.sealHost.classList.remove('wobble'); void card.sealHost.offsetWidth; card.sealHost.classList.add('wobble');
    card.ui.classList.remove('nudge'); void card.ui.offsetWidth; card.ui.classList.add('nudge');
  };
  card.ui.querySelector('.reseal').addEventListener('click', async () => { await card.reseal(); setPrompt(); });
  card.ui.querySelector('.make').addEventListener('click', () => haptic());

  fold.on((s, prev, kind) => {
    if (kind === 'init') return;
    again.hidden = s.physical;
    if (kind !== 'fold') { card.unit = 0; return; }
    card.unit = 0;
    if (s.open && !prev?.open) wantOpen = true;
    else if (!s.open && prev?.open) wantOpen = false;
    setPrompt();
    reconcile();
  });
}

// ───────────────────────── Maker
function loadDraft() { try { return normalize(JSON.parse(localStorage.getItem('sealed.draft'))); } catch { return { ...DEFAULT }; } }
function saveDraft(d) { try { localStorage.setItem('sealed.draft', JSON.stringify(d)); } catch {} }

async function maker() {
  let data = loadDraft();
  const stage = h('div', 'stage maker');
  stage.innerHTML = `
  <div class="mk-scroll">
    <header class="mk-head"><div class="brand"><span class="mark"></span>Sealed</div><p>A pop-up card, pressed with wax, sent as a link.</p></header>
    <section class="pv">
      <div class="pv-tabs" role="tablist"><button type="button" data-v="env" role="tab">Envelope</button><button type="button" data-v="card" role="tab">Inside</button></div>
      <div class="pv-box"></div>
      <p class="pv-tip"></p>
    </section>
    <form class="mk-form" autocomplete="off" onsubmit="return false">
      <fieldset><legend>Occasion</legend><div class="themes"></div></fieldset>
      <label class="fld"><span>Headline <em class="cnt" data-for="h"></em></span><input name="h" maxlength="40" enterkeyhint="next"></label>
      <label class="fld"><span>Message <em class="cnt" data-for="m"></em></span><textarea name="m" maxlength="200" rows="4"></textarea></label>
      <label class="fld"><span>From</span><input name="f" maxlength="24" placeholder="Your name" enterkeyhint="done"></label>
      <fieldset><legend>Pop-ups <em class="cnt e-cnt"></em></legend><div class="emojis"></div></fieldset>
      <fieldset><legend>Wax seal</legend><div class="wax-row"><div class="wax"></div><label class="initial"><span>Initial</span><input name="i" maxlength="2" autocapitalize="characters"></label></div></fieldset>
      <div class="sent" hidden><span>Your card is sealed.</span> <a class="open-link" href="#">Open it ↗</a></div>
    </form>
  </div>
  <div class="mk-bar"><button type="button" class="duo-btn ghost preview">Preview</button><button type="button" class="duo-btn send"><span class="drop"></span>Seal &amp; send</button></div>`;
  app.append(stage);
  const $ = s => stage.querySelector(s);
  const box = $('.pv-box');
  let ctrl = new Sealed(box, data);
  let view = 'env';

  const themes = $('.themes');
  THEME_KEYS.forEach(k => {
    const b = h('button', 'theme', `<i>${THEMES[k].icon}</i><span>${THEMES[k].name}</span>`);
    b.type = 'button'; b.dataset.t = k;
    b.style.setProperty('--a', THEMES[k].pal.accent);
    b.addEventListener('click', () => { haptic(); sfx.tap(); data.t = k; rebuild(true); sync(); });
    themes.append(b);
  });
  const emojis = $('.emojis');
  EMOJI.forEach(e => {
    const b = h('button', 'emo'); b.type = 'button'; b.textContent = e; b.dataset.e = e;
    b.addEventListener('click', () => {
      const i = data.e.indexOf(e);
      if (i >= 0) data.e.splice(i, 1);
      else if (data.e.length >= 3) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); toast('Up to 3 pop-ups'); haptic(); return; }
      else data.e.push(e);
      haptic(); sfx.pop(data.e.length);
      rebuildLayers(); sync();
    });
    emojis.append(b);
  });
  const wax = $('.wax');
  SEAL_COLORS.forEach((c, i) => {
    const b = h('button', 'swatch'); b.type = 'button'; b.title = c.name; b.setAttribute('aria-label', c.name + ' wax');
    b.style.setProperty('--c', c.c);
    b.addEventListener('click', () => { data.c = i; haptic(); sealChanged(); sync(); });
    wax.append(b);
  });
  const inputs = { h: $('[name=h]'), m: $('[name=m]'), f: $('[name=f]'), i: $('[name=i]') };
  for (const k of Object.keys(inputs)) inputs[k].value = data[k];
  for (const k of ['h', 'm', 'f']) inputs[k].addEventListener('input', () => {
    data[k] = inputs[k].value;
    ctrl.setText(data);
    if (k === 'f') { ctrl.env.querySelector('.from').textContent = data.f.trim() ? 'from ' + data.f.trim() : ''; if (!data.i) sealChanged(true); }
    if (k !== 'f' && view === 'env') setView('card');
    sync();
  });
  inputs.i.addEventListener('input', () => { data.i = inputs.i.value.trim(); sealChanged(); sync(); });

  function sync() {
    themes.querySelectorAll('.theme').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === data.t)));
    emojis.querySelectorAll('.emo').forEach(b => { const i = data.e.indexOf(b.dataset.e); b.classList.toggle('on', i >= 0); b.dataset.n = i >= 0 ? i + 1 : ''; });
    wax.querySelectorAll('.swatch').forEach((b, i) => b.setAttribute('aria-pressed', String(i === data.c)));
    inputs.h.placeholder = THEMES[data.t].h;
    inputs.m.placeholder = THEMES[data.t].m;
    inputs.i.placeholder = letterOf({ ...data, i: '' });
    $('[data-for=h]').textContent = `${[...data.h].length}/40`;
    $('[data-for=m]').textContent = `${[...data.m].length}/200`;
    $('.e-cnt').textContent = `${data.e.length}/3`;
    stage.dataset.theme = data.t;
    stage.style.setProperty('--accent', THEMES[data.t].pal.accent);
    $('.mk-bar .drop').style.background = SEAL_COLORS[data.c].c;
    saveDraft(data);
  }
  function setView(v, animate = true) {
    if (v === view && animate) return;
    view = v;
    stage.querySelectorAll('.pv-tabs button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.v === v)));
    $('.pv-tip').textContent = v === 'env' ? 'This is what they see first.' : 'Unfolded: the pop-up rises from the crease.';
    if (v === 'card') { if (animate && !reduced) ctrl.open(); else ctrl.showCardInstant(); }
    else if (animate && !reduced && ctrl.state === 'open') ctrl.close().then(() => ctrl.state === 'broken' && view === 'env' && ctrl.reseal());
    else ctrl.showEnvInstant();
  }
  function rebuild(replay) {
    ctrl.destroy();
    ctrl = new Sealed(box, data);
    if (view === 'card') {
      ctrl.showCardInstant();
      if (replay) { ctrl.layers.forEach(L => { L.p = 0; L.target = 0; }); ctrl.rise(80); }
    }
  }
  function rebuildLayers() {
    if (view !== 'card') setView('card');
    ctrl.buildLayers();
    ctrl.layers.forEach(L => { L.p = 0; });
    ctrl.rise(60);
  }
  function sealChanged(quiet) {
    ctrl.buildSeal();
    if (quiet) return;
    if (view !== 'env') setView('env', false);
    ctrl.sealHost.classList.remove('stamp'); void ctrl.sealHost.offsetWidth; ctrl.sealHost.classList.add('stamp');
    sfx.thunk();
  }
  stage.querySelectorAll('.pv-tabs button').forEach(b => b.addEventListener('click', () => { haptic(); setView(b.dataset.v); }));
  // Tapping the preview envelope's seal opens it too.
  box.addEventListener('click', e => { if (view === 'env' && e.target.closest('.seal-host')) setView('card'); });

  async function link() {
    const enc = await encodeState({ t: data.t, h: data.h.trim(), m: data.m.trim(), f: data.f.trim(), e: data.e, c: data.c, i: data.i });
    return location.href.split('#')[0] + '#' + enc;
  }
  $('.preview').addEventListener('click', async () => { haptic(); location.hash = (await link()).split('#')[1]; });
  $('.send').addEventListener('click', async () => {
    const url = await link();
    if (url.length > 600) { toast('A little too long for a link. Trim the message.'); return; }
    setView('env', false);
    ctrl.sealHost.classList.remove('stamp'); void ctrl.sealHost.offsetWidth; ctrl.sealHost.classList.add('stamp');
    sfx.thunk(); haptic(30);
    $('.pv').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'nearest' });
    await wait(650);
    const r = await shareLink(url, { title: 'Sealed', text: 'Something sealed for you. Unfold to open ✉️' });
    const sent = $('.sent'); sent.hidden = false; $('.open-link').href = url;
    if (r === 'shared') toast('Sealed & sent ✉️');
  });

  // The maker's own unfold moment: unfolding breaks the preview seal and the pop-up rises.
  fold.on((s, prev, kind) => {
    stage.classList.toggle('wide', s.open);
    ctrl.unit = 0;
    if (kind === 'fold') setView(s.open ? 'card' : 'env');
  });
  setView(fold.state.open ? 'card' : 'env', false);
  sync();
}

// ───────────────────────── boot
mountChrome();
window.addEventListener('hashchange', () => location.reload());
const hash = location.hash.slice(1);
if (hash) {
  const raw = await decodeState(hash);
  if (raw) recipient(normalize(raw));
  else { maker(); toast("That card couldn't be unsealed. Make a new one?"); }
} else maker();
