// audio.js — synthesized liquid sounds (no files): whoosh, glug, splash, tick.
export class Sfx {
  constructor(ac) {
    this.ac = ac;
    this.comp = ac.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.ratio.value = 4;
    this.master = ac.createGain(); this.master.gain.value = 0.8;
    this.master.connect(this.comp); this.comp.connect(ac.destination);
    try { this.rec = ac.createMediaStreamDestination(); this.comp.connect(this.rec); } catch { this.rec = null; }
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    this.lastGlug = 0;
  }
  get stream() { return this.rec?.stream || null; }

  env(g, t, a, peak, dec) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }
  noiseSrc(t, dur) {
    const s = this.ac.createBufferSource();
    s.buffer = this.noise; s.loop = true;
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.05);
    return s;
  }

  /** Filtered-noise sweep. dir=1 rising (burst), -1 falling (suck back). */
  whoosh(dir = 1, dur = 0.9, gain = 0.55) {
    const ac = this.ac, t = ac.currentTime;
    const src = this.noiseSrc(t, dur);
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    const f0 = dir > 0 ? 260 : 2600, f1 = dir > 0 ? 2800 : 220;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.45);
    bp.frequency.exponentialRampToValueAtTime(dir > 0 ? 500 : 120, t + dur);
    const g = ac.createGain(); this.env(g, t, dur * 0.18, gain, dur * 0.8);
    src.connect(bp); bp.connect(g); g.connect(this.master);
    // sub thump
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(dir > 0 ? 95 : 70, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.4);
    const og = ac.createGain(); this.env(og, t, 0.01, 0.5, 0.42);
    o.connect(og); og.connect(this.master); o.start(t); o.stop(t + 0.5);
  }

  /** A single liquid "bloop": sine with rising pitch (bubble resonance) + soft click. */
  glug(intensity = 1, when = 0) {
    const ac = this.ac, t = ac.currentTime + when;
    const f = 140 + Math.random() * 220;
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(f, t);
    o.frequency.exponentialRampToValueAtTime(f * (1.7 + Math.random() * 0.8), t + 0.07);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1200;
    const g = ac.createGain(); this.env(g, t, 0.006, 0.32 * intensity, 0.11);
    o.connect(lp); lp.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.16);
  }

  /** Throttled glug driven by flow rate. */
  flow(rate) {
    const now = this.ac.currentTime;
    if (rate < 0.5 || now - this.lastGlug < 0.07 + Math.random() * 0.12) return false;
    this.lastGlug = now;
    this.glug(Math.min(1, 0.35 + rate * 0.08));
    return true;
  }

  splash(gain = 0.45) {
    const ac = this.ac, t = ac.currentTime;
    const src = this.noiseSrc(t, 0.5);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
    const g = ac.createGain(); this.env(g, t, 0.005, gain, 0.35);
    src.connect(hp); hp.connect(g); g.connect(this.master);
    for (let i = 0; i < 6; i++) this.glug(0.9, 0.05 + i * (0.05 + Math.random() * 0.06));
  }

  tick(freq = 1100) {
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
    const g = ac.createGain(); this.env(g, t, 0.003, 0.12, 0.05);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.08);
  }
}
