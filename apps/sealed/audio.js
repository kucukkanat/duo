// audio.js — synthesized paper, wax and ink sounds (Web Audio, no files).
let ctx = null, noiseBuf = null, master = null;

export function setAudio(c) {
  if (!c || ctx) return;
  ctx = c;
  master = ctx.createGain();
  master.gain.value = .9;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp).connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
}
export const hasAudio = () => !!ctx;

function noise({ dur = .2, type = 'bandpass', f = 1500, f2 = null, q = 1, gain = .4, attack = .003, at = 0 }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  src.playbackRate.value = .8 + Math.random() * .4;
  const flt = ctx.createBiquadFilter();
  flt.type = type; flt.Q.value = q;
  flt.frequency.setValueAtTime(f, t);
  if (f2) flt.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(flt).connect(g).connect(master);
  src.start(t, Math.random() * .5, dur + .05);
}
function tone({ f = 440, f2 = null, dur = .2, type = 'sine', gain = .2, at = 0, attack = .004 }) {
  if (!ctx) return;
  const t = ctx.currentTime + at;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f, t);
  if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + .05);
}

export const sfx = {
  /** Little crackle while dragging (k = progress 0..1). */
  creak(k) {
    noise({ dur: .035 + Math.random() * .03, type: 'bandpass', f: 2200 + k * 2600, q: 5, gain: .12 + k * .2 });
    if (Math.random() < .5) noise({ dur: .02, type: 'highpass', f: 5000, gain: .08, at: .02 });
  },
  /** Wax seal snapping. */
  crack() {
    noise({ dur: .09, type: 'highpass', f: 2400, gain: .9, attack: .001 });
    noise({ dur: .22, type: 'bandpass', f: 900, f2: 300, q: 1.4, gain: .55, at: .01 });
    tone({ f: 140, f2: 55, dur: .2, gain: .5 });
    for (let i = 0; i < 6; i++) noise({ dur: .03, type: 'bandpass', f: 3000 + Math.random() * 3000, q: 6, gain: .2, at: .08 + i * .045 + Math.random() * .03 });
  },
  /** Crumbs of wax hitting paper. */
  tinkle() { for (let i = 0; i < 5; i++) noise({ dur: .025, type: 'bandpass', f: 3500 + Math.random() * 2500, q: 8, gain: .12, at: .35 + i * .07 + Math.random() * .05 }); },
  /** Stiff paper unfolding. */
  paper(len = .55) {
    noise({ dur: len, type: 'bandpass', f: 700, f2: 2600, q: .7, gain: .28, attack: .08 });
    noise({ dur: len * .7, type: 'highpass', f: 3500, gain: .07, attack: .1, at: .05 });
  },
  /** A pop-up layer snapping upright. */
  pop(i = 0) {
    tone({ f: 260 + i * 45, f2: 120, dur: .13, gain: .22 });
    noise({ dur: .05, type: 'bandpass', f: 1800, q: 2, gain: .15 });
  },
  nib() { noise({ dur: .018, type: 'highpass', f: 4200 + Math.random() * 1500, gain: .05 + Math.random() * .03 }); },
  blow() { noise({ dur: .55, type: 'lowpass', f: 1200, f2: 300, gain: .45, attack: .05 }); },
  thunk() {
    tone({ f: 150, f2: 60, dur: .25, gain: .55 });
    noise({ dur: .12, type: 'lowpass', f: 600, gain: .4 });
  },
  chime() {
    [784, 988, 1175, 1568].forEach((f, i) => tone({ f, dur: .9, type: 'triangle', gain: .07, at: i * .07, attack: .01 }));
  },
  boom() {
    noise({ dur: .6, type: 'lowpass', f: 800, f2: 120, gain: .5, attack: .005 });
    for (let i = 0; i < 8; i++) noise({ dur: .03, type: 'bandpass', f: 2000 + Math.random() * 3000, q: 5, gain: .1, at: .25 + Math.random() * .5 });
  },
  tap() { tone({ f: 520, f2: 300, dur: .08, gain: .12 }); },
};
