// hub.js — "The Booklet": closed cover ↔ two-page spread, driven by the real fold (or a simulated one).
import { fold, haptic } from './shared/kit.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const stage = $('#stage'), cover = $('#cover'), spread = $('#spread');
const reduceMQ = matchMedia('(prefers-reduced-motion: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');

// Card entrance order: across the spread, then down (01, 03, 02, 04).
$$('.page.left .card').forEach((c, i) => c.style.setProperty('--i', i * 2));
$$('.page.right .card').forEach((c, i) => c.style.setProperty('--i', i * 2 + 1));

/* ───────── Desktop phone frame ───────── */
function layout() {
  const desk = finePointer.matches && innerWidth >= 700 && innerHeight >= 520;
  root.classList.toggle('desk', desk);
  if (desk) {
    const open = fold.state.open;
    const W = open ? 626 : 466, H = open ? 890 : 678;
    const k = Math.min(1, (innerHeight - 120) / H, (innerWidth - 48) / W);
    stage.style.setProperty('--k', k.toFixed(4));
  }
  const s = fold.state;
  stage.dataset.dir = !desk && s.open && innerWidth > innerHeight ? 'h' : 'v';
}
addEventListener('resize', layout);

/* ───────── Unfold counter ───────── */
function renderCount(bump) {
  const n = fold.count;
  const html = n === 0 ? 'Not yet unfolded'
    : n === 1 ? 'You’ve unfolded <b>once</b>'
    : `You’ve unfolded <b>${n}</b> times`;
  $$('[data-count]').forEach(el => {
    el.innerHTML = html;
    if (bump) { const b = $('b', el); if (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); } }
  });
}

/* ───────── Sound: a soft paper "fwip" (only once audio has been unlocked by a tap) ───────── */
let ac = null;
addEventListener('pointerdown', () => {
  if (ac) return;
  try { ac = new (window.AudioContext || window.webkitAudioContext)(); ac.resume(); } catch {}
}, { capture: true, passive: true });
function fwip(open = true) {
  if (!ac || ac.state !== 'running') return;
  const t = ac.currentTime, dur = open ? 0.55 : 0.32;
  const buf = ac.createBuffer(1, Math.ceil(ac.sampleRate * dur), ac.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const src = ac.createBufferSource(); src.buffer = buf;
  const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.9;
  bp.frequency.setValueAtTime(open ? 700 : 2600, t);
  bp.frequency.exponentialRampToValueAtTime(open ? 3200 : 500, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(open ? 0.22 : 0.3, t + 0.05);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(bp).connect(g).connect(ac.destination);
  src.start(t);
  if (!open) { // a soft thump when the covers meet
    const o = ac.createOscillator(), og = ac.createGain();
    o.frequency.setValueAtTime(140, t + 0.28); o.frequency.exponentialRampToValueAtTime(60, t + 0.42);
    og.gain.setValueAtTime(0.0001, t); og.gain.setValueAtTime(0.0001, t + 0.27);
    og.gain.exponentialRampToValueAtTime(0.35, t + 0.29); og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(og).connect(ac.destination); o.start(t + 0.26); o.stop(t + 0.55);
  }
}

/* ───────── 3D doors ───────── */
let doors = null;
function clearDoors() { doors?.wrap.remove(); doors = null; }
function buildDoors() {
  clearDoors();
  const W = stage.clientWidth;
  const wrap = document.createElement('div');
  wrap.className = 'doors'; wrap.setAttribute('aria-hidden', 'true');
  const out = { wrap };
  for (const side of ['l', 'r']) {
    const cast = document.createElement('div'); cast.className = 'cast ' + side;
    const door = document.createElement('div'); door.className = 'door ' + side;
    const front = document.createElement('div'); front.className = 'face front';
    const clone = cover.cloneNode(true);
    clone.removeAttribute('id'); $$('[id]', clone).forEach(n => n.removeAttribute('id'));
    clone.classList.add('clone'); clone.inert = true;
    clone.style.width = W + 'px'; clone.style.left = side === 'l' ? '0' : -W / 2 + 'px';
    const shade = document.createElement('div'); shade.className = 'shade';
    front.append(clone, shade);
    const back = document.createElement('div'); back.className = 'face back';
    const edge = document.createElement('div'); edge.className = 'edge';
    door.append(front, back, edge);
    wrap.append(cast, door);
    out[side] = { door, shade, cast };
  }
  stage.append(wrap);
  doors = out;
  return out;
}
function setDoorAngle(a) { // a in degrees, 0 = closed, positive = open
  if (!doors) buildDoors();
  doors.l.door.style.transform = `rotateY(${-a}deg)`;
  doors.r.door.style.transform = `rotateY(${a}deg)`;
  const s = Math.min(1, a / 90);
  doors.l.shade.style.opacity = doors.r.shade.style.opacity = (s * 0.5).toFixed(3);
  doors.l.cast.style.opacity = doors.r.cast.style.opacity = (0.85 * (1 - s * 0.6)).toFixed(3);
}

let anims = [];
function stopAnims() { anims.forEach(a => a.cancel()); anims = []; }
const run = (el, kf, opt) => { const a = el.animate(kf, { fill: 'forwards', ...opt }); anims.push(a); return a; };

function playOpen(from = 0) {
  stopAnims();
  root.classList.remove('peek', 'revealing');
  haptic(); fwip(true);
  if (reduceMQ.matches) {
    clearDoors();
    run(spread, [{ opacity: 0 }, { opacity: 1 }], { duration: 220, fill: 'none' });
    return;
  }
  const d = buildDoors();
  const p = from / 168, dur = 1400 * (1 - p * 0.4), delay = from ? 0 : 80;
  const ease = from ? 'cubic-bezier(.25,.6,.2,1)' : 'cubic-bezier(.5,.05,.2,1)';
  void spread.offsetWidth;
  root.classList.add('revealing');
  run(d.l.door, [{ transform: `rotateY(${-from}deg)` }, { transform: 'rotateY(-168deg)' }], { duration: dur, delay, easing: ease });
  run(d.r.door, [{ transform: `rotateY(${from}deg)` }, { transform: 'rotateY(168deg)' }], { duration: dur, delay, easing: ease });
  for (const side of [d.l, d.r]) {
    run(side.shade, [{ opacity: Math.min(.5, p) }, { opacity: .55, offset: .45 }, { opacity: .25 }], { duration: dur, delay, easing: ease });
    run(side.cast, [{ opacity: .85 * (1 - p), transform: 'translateX(0)' }, { opacity: 0, transform: `translateX(${side === d.l ? -45 : 45}%)` }], { duration: dur * 0.75, delay: delay + 40, easing: 'ease-out' });
  }
  run(d.wrap, [{ opacity: 1 }, { opacity: 1, offset: .78 }, { opacity: 0 }], { duration: dur + delay, easing: 'linear' });
  run(spread, [{ filter: 'brightness(.45)', transform: 'scale(.965)' }, { filter: 'brightness(1)', transform: 'none' }], { duration: 900, delay: 120, easing: 'cubic-bezier(.2,.7,.2,1)', fill: 'none' });
  const burst = $('.burst', spread);
  run(burst, [{ opacity: 0, transform: 'translateX(-50%) scaleX(.2)' }, { opacity: 1, transform: 'translateX(-50%) scaleX(1)', offset: .25 }, { opacity: 0, transform: 'translateX(-50%) scaleX(2.2)' }], { duration: 900, easing: 'ease-out', fill: 'none' });
  const done = anims[0].finished;
  done.then(() => { clearDoors(); stopAnims(); }).catch(() => {});
  setTimeout(() => root.classList.remove('revealing'), 2000);
}

function playClose() {
  stopAnims();
  root.classList.remove('revealing');
  haptic(); fwip(false);
  if (reduceMQ.matches) { clearDoors(); return; }
  root.classList.add('peek');
  const d = buildDoors();
  const dur = 640, ease = 'cubic-bezier(.55,0,.85,.35)';
  setDoorAngle(150);
  run(d.l.door, [{ transform: 'rotateY(-150deg)' }, { transform: 'rotateY(0deg)' }], { duration: dur, easing: ease });
  run(d.r.door, [{ transform: 'rotateY(150deg)' }, { transform: 'rotateY(0deg)' }], { duration: dur, easing: ease });
  for (const side of [d.l, d.r]) {
    run(side.shade, [{ opacity: .5 }, { opacity: 0 }], { duration: dur, easing: ease });
    run(side.cast, [{ opacity: 0 }, { opacity: .85 }], { duration: dur, easing: ease });
  }
  run(spread, [{ filter: 'brightness(1)' }, { filter: 'brightness(.4)' }], { duration: dur, easing: ease, fill: 'none' });
  anims[0].finished.then(() => {
    clearDoors(); stopAnims();
    root.classList.remove('peek');
    root.classList.remove('thud'); void cover.offsetWidth; root.classList.add('thud');
    haptic();
    setTimeout(() => root.classList.remove('thud'), 400);
  }).catch(() => {});
}

/* ───────── Fold state ───────── */
let isOpen = null;
let dragFrom = 0;
function setOpen(open, animate) {
  const was = isOpen;
  isOpen = open;
  root.classList.toggle('is-open', open);
  cover.inert = open; spread.inert = !open;
  if (open) cover.scrollTop = 0;
  if (!animate || was === null || was === open) { clearDoors(); root.classList.remove('peek'); return; }
  if (open) { playOpen(dragFrom); dragFrom = 0; } else playClose();
}

function syncToggles(s) {
  $('#foldBtn').hidden = !s.open || s.physical;
  const dt = $('#deskToggle');
  dt.innerHTML = s.open ? '<span class="ico" aria-hidden="true">◧</span> Fold the phone' : '<span class="ico" aria-hidden="true">◫</span> Unfold the phone';
  const live = $('#live');
  const short = Math.min(s.width, s.height);
  live.textContent = `Right now: ${s.width} × ${s.height} → ${s.physical ? 'open, detected from the screen size' : s.open ? 'open (simulated)' : `closed (short side ${short} < 560)`}.`;
}

fold.on((s, prev, kind) => {
  layout();
  syncToggles(s);
  if (kind === 'init') { renderCount(false); setOpen(s.open, false); return; }
  if (kind !== 'fold') return;
  renderCount(s.open && prev && !prev.open);
  if (s.open !== isOpen) setOpen(s.open, true);
});

function toggleFold(force) { haptic(); askMotion(); fold.toggle(force); }
$('#unfoldBtn').addEventListener('click', () => toggleFold(true));
$('#foldBtn').addEventListener('click', () => toggleFold(false));
$('#deskToggle').addEventListener('click', () => toggleFold());

/* ───────── Pull from the spine ───────── */
let drag = null;
cover.addEventListener('pointerdown', e => {
  if (isOpen || e.button > 0 || e.target.closest('a, button')) return;
  drag = { x: e.clientX, y: e.clientY, id: e.pointerId, active: false, a: 0 };
});
cover.addEventListener('pointermove', e => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.active) {
    if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.2) { if (Math.abs(dy) > 16) drag = null; return; }
    drag.active = true;
    try { cover.setPointerCapture(e.pointerId); } catch {}
    stopAnims();
    root.classList.add('peek');
    buildDoors();
    haptic();
  }
  const scale = (stage.getBoundingClientRect().width || 1) / stage.clientWidth;
  const p = Math.min(1, Math.abs(dx) / scale / (stage.clientWidth * 0.42));
  drag.a = 80 * (1 - Math.pow(1 - p, 1.6));
  setDoorAngle(drag.a);
  if (p > 0.35 && !drag.ticked) { drag.ticked = true; haptic(); }
  if (p < 0.35) drag.ticked = false;
});
function endDrag() {
  if (!drag) return;
  const d = drag; drag = null;
  if (!d.active) return;
  if (d.a > 80 * 0.42) { dragFrom = d.a; askMotion(); fold.toggle(true); return; }
  // spring back
  const from = d.a;
  stopAnims();
  const ease = 'cubic-bezier(.3,1.5,.5,1)';
  run(doors.l.door, [{ transform: `rotateY(${-from}deg)` }, { transform: 'rotateY(0)' }], { duration: 420, easing: ease });
  run(doors.r.door, [{ transform: `rotateY(${from}deg)` }, { transform: 'rotateY(0)' }], { duration: 420, easing: ease })
    .finished.then(() => { clearDoors(); stopAnims(); root.classList.remove('peek'); }).catch(() => {});
}
cover.addEventListener('pointerup', endDrag);
cover.addEventListener('pointercancel', endDrag);

/* ───────── Foil catches the light (tilt on phones, pointer on desktop, slow drift otherwise) ───────── */
let lastInput = 0, fx = 50;
function setSheen(v) { fx = Math.max(-10, Math.min(110, v)); root.style.setProperty('--fx', fx.toFixed(1) + '%'); }
let motionAsked = false;
async function askMotion() {
  if (motionAsked) return; motionAsked = true;
  try {
    if (window.DeviceOrientationEvent?.requestPermission) {
      if (await DeviceOrientationEvent.requestPermission() !== 'granted') return;
    }
  } catch { return; }
  addEventListener('deviceorientation', e => {
    if (e.gamma == null) return;
    lastInput = performance.now();
    setSheen(50 + e.gamma * 2.2 + ((e.beta ?? 45) - 45) * 0.8);
  });
}
if (!window.DeviceOrientationEvent?.requestPermission) askMotion(); // Android etc: no prompt needed
addEventListener('pointermove', e => {
  if (e.pointerType !== 'mouse') return;
  lastInput = performance.now();
  setSheen((e.clientX / innerWidth) * 100);
}, { passive: true });
let lastDrift = 0;
(function drift(t) {
  if (!isOpen && t - lastInput > 2500 && t - lastDrift > 50 && !document.hidden && !reduceMQ.matches) {
    lastDrift = t;
    setSheen(50 + Math.sin(t / 2600) * 38);
  }
  requestAnimationFrame(drift);
})(0);

/* ───────── Launch an app with a View Transition ───────── */
document.addEventListener('click', e => {
  const a = e.target.closest('a.card, .toc a');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0) return;
  e.preventDefault();
  haptic();
  const href = a.href;
  const tint = getComputedStyle(a).getPropertyValue('--tint').trim();
  const name = $('h2, .nm', a)?.textContent || '';
  const go = () => { location.href = href; };
  if (!document.startViewTransition || reduceMQ.matches) return go();
  const from = $('.plate', a) || a;
  from.style.viewTransitionName = 'launch';
  const vt = document.startViewTransition(() => {
    from.style.viewTransitionName = '';
    const veil = document.createElement('div');
    veil.className = 'launch-veil';
    veil.style.setProperty('--tint', tint);
    veil.innerHTML = `<span></span>`;
    veil.firstChild.textContent = name;
    stage.append(veil);
  });
  vt.finished.then(go, go);
});
addEventListener('pageshow', () => { $$('.launch-veil').forEach(v => v.remove()); $$('[style*="view-transition-name"]').forEach(n => n.style.viewTransitionName = ''); });

/* ───────── How it works ───────── */
const how = $('#how');
$$('[data-how]').forEach(b => b.addEventListener('click', () => { syncToggles(fold.state); how.showModal(); }));
how.addEventListener('click', e => { if (e.target === how) how.close(); });

/* ───────── Add to Home Screen coach mark (iOS Safari, not installed) ───────── */
(function coachMark() {
  const ua = navigator.userAgent;
  const iOS = /iP(hone|ad|od)/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const standalone = navigator.standalone || matchMedia('(display-mode: standalone)').matches;
  let dismissed = false;
  try { dismissed = localStorage.getItem('duo.coach') === '1'; } catch {}
  if (!iOS || standalone || dismissed) return;
  const coach = $('#coach');
  const hide = () => { coach.hidden = true; root.classList.remove('coached'); };
  setTimeout(() => { coach.hidden = false; root.classList.add('coached'); setTimeout(hide, 12000); }, 1400);
  $('.x', coach).addEventListener('click', () => {
    hide();
    try { localStorage.setItem('duo.coach', '1'); } catch {}
  });
})();

layout();
