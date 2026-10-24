// fold.js — unfold detection for iPhone Duo (and a simulated fold everywhere else).
//
// Safari exposes the fold ONLY as a viewport resize: cover screen ≈ 466×678 CSS px
// (portrait), inner screen ≈ 890×626 (LANDSCAPE: the phone opens like a book, 164.6mm
// wide × 117.8mm tall, crease running vertically down the middle like a spine).
// We key on the short side of the viewport crossing a threshold.
// Normal phones (≤ 440px short side) are "closed"; they can toggle a simulated fold.
//
// Usage:
//   import { fold } from '/shared/fold.js';
//   fold.on(state => { state.open; state.simulated; state.crease /* 'vertical'|'horizontal'|null */ });
//   fold.toggle();   // simulate on non-foldables
//
// Sets <html data-fold="open|closed" data-crease="vertical|horizontal"> and CSS vars
// --crease-x / --crease-y (px, center of the inner screen) for layouts.

const OPEN_MIN_SHORT_SIDE = 560; // between cover (~466) and inner (~626)
const listeners = new Set();
let simulated = false;
let last = null;

function measure() {
  const w = window.innerWidth, h = window.innerHeight;
  const physicalOpen = Math.min(w, h) >= OPEN_MIN_SHORT_SIDE && Math.max(w, h) <= 1100 &&
    matchMedia('(pointer: coarse)').matches;
  const open = physicalOpen || simulated;
  return {
    open,
    physical: physicalOpen,
    simulated: simulated && !physicalOpen,
    width: w,
    height: h,
    // Book fold: natural open pose is landscape with a vertical spine. If the user
    // rotates the open phone to portrait, the crease becomes horizontal.
    crease: open ? (w >= h ? 'vertical' : 'horizontal') : null,
  };
}

function apply(state) {
  const root = document.documentElement;
  root.dataset.fold = state.open ? 'open' : 'closed';
  root.dataset.foldSource = state.physical ? 'device' : state.simulated ? 'simulated' : 'none';
  if (state.crease) root.dataset.crease = state.crease; else delete root.dataset.crease;
  root.style.setProperty('--crease-x', state.width / 2 + 'px');
  root.style.setProperty('--crease-y', state.height / 2 + 'px');
}

let timer = 0;
function update(force = false) {
  clearTimeout(timer);
  timer = setTimeout(() => {
    const s = measure();
    const changed = !last || s.open !== last.open || s.crease !== last.crease;
    const resized = last && (s.width !== last.width || s.height !== last.height);
    const prev = last;
    last = s;
    apply(s);
    if (changed || force) {
      if (s.open && prev && !prev.open) bumpCount();
      listeners.forEach(fn => fn(s, prev, 'fold'));
    } else if (resized) {
      listeners.forEach(fn => fn(s, prev, 'resize'));
    }
  }, force ? 0 : 60);
}

function bumpCount() {
  try { localStorage.setItem('duo.unfolds', String(fold.count + 1)); } catch {}
}

// Ignore keyboard-only (visualViewport) height changes: we listen to window resize only.
window.addEventListener('resize', () => update());
window.addEventListener('orientationchange', () => update());

export const fold = {
  get state() { return last || measure(); },
  get open() { return this.state.open; },
  get count() { try { return +localStorage.getItem('duo.unfolds') || 0; } catch { return 0; } },
  /** Subscribe; callback(state, prevState, kind) fires immediately and on every fold change. */
  on(fn) { listeners.add(fn); fn(this.state, null, 'init'); return () => listeners.delete(fn); },
  /** Simulate unfolding on devices that can't physically fold. */
  toggle(force) {
    simulated = typeof force === 'boolean' ? force : !simulated;
    update(true);
  },
  get canFold() { return this.state.physical || Math.min(innerWidth, innerHeight) < OPEN_MIN_SHORT_SIDE; },
};

last = measure();
apply(last);
