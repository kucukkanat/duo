// Fold Booth: a retro photobooth for iPhone Duo.
// Closed = a booth viewfinder that shoots a 4-frame strip. Unfold = the strip feeds out of the crease,
// develops chemically, and the right page reveals your Mirror Twins (left-left / right-right faces).
import { fold, unlock, haptic, shareFile, toast, mountChrome } from '../../shared/kit.js';

const $ = s => document.querySelector(s);
const body = document.body;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
const M = () => (reduced.matches ? 0.05 : 1); // motion multiplier
const wait = ms => new Promise(r => setTimeout(r, ms));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

const FRAME_W = 600, FRAME_H = 750, SHOTS = 4;
const STYLE_NAMES = { bw: 'Classic B&W', warm: 'Warm Film', comic: 'Comic', holo: 'Holo' };

const state = {
  style: 'warm',
  started: false,
  demo: true,           // until a camera stream is live we render the stand-in model
  shooting: false,
  axis: 0.5,            // mirror line in mirrored-source space (0..1)
  axisUser: false,
  strip: null,          // { frames, style, axis, canvas, url, blob, developed, dismissed, pick }
  mode: 'cover',
  tiltX: 0, tiltY: 0, // holo foil
  liveCrop: null,
};

// ---------------------------------------------------------------- elements
const video = $('#video');
const live = $('#live');
const liveCtx = live.getContext('2d', { willReadFrequently: true });
const liveL = $('#liveL'), liveR = $('#liveR');
const twinL = $('#twinL'), twinR = $('#twinR');
const vf = $('#vf');
const stage = $('#stage');

// ---------------------------------------------------------------- audio (synthesized)
let ac = null, master = null, noiseBuf = null;
async function initAudio() {
  if (ac) return;
  try {
    const r = await unlock({ audio: true, motion: true });
    ac = r.audio;
    master = ac.createGain(); master.gain.value = 0.8; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ac = null; }
}
function tone(f, dur, { type = 'sine', vol = 0.18, at = 0, slide = 0 } = {}) {
  if (!ac) return;
  const t = ac.currentTime + at;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
}
function noise(dur, { at = 0, vol = 0.25, type = 'bandpass', f = 1200, q = 1, f2 = 0, attack = 0.005 } = {}) {
  if (!ac) return null;
  const t = ac.currentTime + at;
  const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const fl = ac.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(f, t); fl.Q.value = q;
  if (f2) fl.frequency.exponentialRampToValueAtTime(f2, t + dur);
  const g = ac.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(fl).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  return g;
}
const sfx = {
  beep: hi => { tone(hi ? 1320 : 880, hi ? 0.22 : 0.12, { type: 'square', vol: 0.07 }); tone(hi ? 2640 : 1760, 0.06, { vol: 0.03 }); },
  shutter: () => { noise(0.05, { type: 'highpass', f: 3000, vol: 0.5 }); noise(0.09, { at: 0.06, type: 'bandpass', f: 1800, q: 3, vol: 0.35 }); tone(140, 0.12, { vol: 0.25, slide: 60 }); },
  flash: () => tone(4200, 0.5, { vol: 0.025, slide: 9000 }),
  whoomp: () => { noise(0.6, { type: 'lowpass', f: 200, f2: 1600, vol: 0.4, attack: 0.15 }); tone(70, 0.5, { vol: 0.3, slide: 45 }); },
  swish: () => noise(0.45, { type: 'bandpass', f: 500, f2: 3000, q: 0.8, vol: 0.22, attack: 0.12 }),
  feed: steps => {
    if (!ac) return;
    for (let i = 0; i < steps; i++) {
      const at = i * 0.27;
      noise(0.18, { at, type: 'bandpass', f: 2600, q: 4, vol: 0.12, attack: 0.02 });
      tone(95, 0.2, { at, type: 'sawtooth', vol: 0.035, slide: 120 });
      noise(0.03, { at: at + 0.17, type: 'highpass', f: 4000, vol: 0.18 });
    }
  },
  chime: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, 0.9, { at: i * 0.09, vol: 0.06, type: 'triangle' })),
  pick: () => { tone(660, 0.12, { type: 'square', vol: 0.05 }); tone(990, 0.25, { at: 0.08, type: 'triangle', vol: 0.07 }); },
};

// ---------------------------------------------------------------- source: camera or stand-in model
const demo = document.createElement('canvas'); demo.width = 720; demo.height = 900;
const dctx = demo.getContext('2d');
function videoReady() { return !state.demo && video.readyState >= 2 && video.videoWidth > 0; }
function source() { return videoReady() ? { el: video, W: video.videoWidth, H: video.videoHeight } : { el: demo, W: demo.width, H: demo.height }; }

/** Draw the (selfie-mirrored) source cropped to cover w×h. Returns crop info for axis mapping. */
function drawSource(ctx, w, h) {
  const { el, W, H } = source();
  const a = w / h; let sw, sh;
  if (W / H > a) { sh = H; sw = H * a; } else { sw = W; sh = W / a; }
  const sx = (W - sw) / 2, sy = (H - sh) / 2;
  ctx.save(); ctx.translate(w, 0); ctx.scale(-1, 1);
  ctx.drawImage(el, sx, sy, sw, sh, 0, 0, w, h);
  ctx.restore();
  return { sx, sw, W };
}
const axisInCrop = (crop, m = state.axis) => clamp((m * crop.W - crop.sx) / crop.sw, 0.2, 0.8);

function drawDemo(t) {
  const c = dctx, W = demo.width, H = demo.height;
  // booth backdrop: smoky teal curtain with folds
  const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#3d5d63'); bg.addColorStop(1, '#16262b');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 14; i++) {
    const x = (i / 14) * W, g = c.createLinearGradient(x, 0, x + W / 14, 0);
    g.addColorStop(0, 'rgba(0,0,0,.18)'); g.addColorStop(0.5, 'rgba(255,255,255,.05)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
    c.fillStyle = g; c.fillRect(x, 0, W / 14, H);
  }
  const sway = Math.sin(t * 0.8) * 16, bob = Math.sin(t * 1.6) * 6, tilt = Math.sin(t * 0.8) * 0.03;
  const cx = W / 2 + sway, cy = 395 + bob;
  // in mirrored-source space the face center is 1 - cx/W
  state.demoCenter = 1 - cx / W;
  // shoulders (mustard sweater)
  c.fillStyle = '#d99a2b';
  c.beginPath(); c.moveTo(cx - 300, H); c.bezierCurveTo(cx - 290, 700, cx - 150, 650, cx, 655); c.bezierCurveTo(cx + 150, 650, cx + 290, 700, cx + 300, H); c.fill();
  c.fillStyle = '#b97c16'; c.beginPath(); c.moveTo(cx - 70, 652); c.quadraticCurveTo(cx, 720, cx + 70, 652); c.lineTo(cx + 60, 690); c.quadraticCurveTo(cx, 760, cx - 60, 690); c.fill();
  c.save(); c.translate(cx, cy); c.rotate(tilt);
  // neck
  const skin = '#eab48f', skinD = '#c98764';
  c.fillStyle = skinD; c.fillRect(-55, 140, 110, 140);
  // hair back
  c.fillStyle = '#2a1712';
  c.beginPath(); c.ellipse(0, -10, 205, 245, 0, 0, Math.PI * 2); c.fill();
  c.fillRect(-205, -10, 410, 210);
  // ears
  c.fillStyle = skinD; c.beginPath(); c.ellipse(-158, 20, 26, 42, 0, 0, Math.PI * 2); c.ellipse(158, 20, 26, 42, 0, 0, Math.PI * 2); c.fill();
  // gold hoop on one ear only (asymmetry makes the twins differ)
  c.strokeStyle = '#f0c24a'; c.lineWidth = 6; c.beginPath(); c.arc(-160, 75, 18, 0, Math.PI * 2); c.stroke();
  // face
  const fg = c.createRadialGradient(-40, -30, 20, 0, 10, 220); fg.addColorStop(0, '#f6cfae'); fg.addColorStop(0.7, skin); fg.addColorStop(1, skinD);
  c.fillStyle = fg; c.beginPath(); c.ellipse(0, 10, 158, 200, 0, 0, Math.PI * 2); c.fill();
  // side-swept fringe (heavier on one side)
  c.fillStyle = '#2a1712';
  c.beginPath(); c.moveTo(-170, 10); c.bezierCurveTo(-180, -170, 40, -250, 165, -110); c.bezierCurveTo(110, -150, 40, -120, -30, -60);
  c.bezierCurveTo(-90, -20, -120, -10, -150, 60); c.fill();
  c.fillStyle = 'rgba(255,255,255,.08)'; c.beginPath(); c.ellipse(-40, -150, 70, 18, -0.4, 0, Math.PI * 2); c.fill();
  // brows: one arched high (the skeptic), one relaxed
  c.strokeStyle = '#2a1712'; c.lineCap = 'round'; c.lineWidth = 11;
  c.beginPath(); c.moveTo(-100, -48); c.quadraticCurveTo(-65, -62, -30, -50); c.stroke();
  c.beginPath(); c.moveTo(32, -62); c.quadraticCurveTo(70, -92, 104, -66); c.stroke();
  // eyes with blink
  const blink = (t % 3.7) < 0.13;
  for (const ex of [-65, 68]) {
    if (blink) { c.lineWidth = 5; c.beginPath(); c.moveTo(ex - 24, -10); c.quadraticCurveTo(ex, 0, ex + 24, -10); c.stroke(); continue; }
    c.fillStyle = '#fff'; c.beginPath(); c.ellipse(ex, -12, 26, 17, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#5a3a22'; c.beginPath(); c.arc(ex + 3, -11, 12, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(ex + 3, -11, 6, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(ex + 7, -15, 3, 0, Math.PI * 2); c.fill();
    c.lineWidth = 4; c.strokeStyle = '#2a1712'; c.beginPath(); c.ellipse(ex, -12, 27, 18, 0, Math.PI * 1.05, Math.PI * 1.95); c.stroke();
  }
  // nose
  c.strokeStyle = skinD; c.lineWidth = 6; c.beginPath(); c.moveTo(4, 0); c.quadraticCurveTo(18, 55, -6, 66); c.stroke();
  // cheeks
  c.fillStyle = 'rgba(230,90,90,.22)'; c.beginPath(); c.ellipse(-90, 52, 34, 20, 0, 0, Math.PI * 2); c.ellipse(92, 52, 34, 20, 0, 0, Math.PI * 2); c.fill();
  // freckles on one cheek only
  c.fillStyle = 'rgba(120,60,30,.55)';
  for (const [fx, fy] of [[70, 36], [86, 46], [100, 34], [112, 52], [78, 58], [96, 64]]) { c.beginPath(); c.arc(fx, fy, 3.2, 0, Math.PI * 2); c.fill(); }
  // beauty mark
  c.fillStyle = '#3a2016'; c.beginPath(); c.arc(-58, 112, 4.5, 0, Math.PI * 2); c.fill();
  // lopsided smirk
  c.fillStyle = '#b8323f';
  c.beginPath(); c.moveTo(-58, 100); c.quadraticCurveTo(0, 128, 66, 86); c.quadraticCurveTo(10, 150, -58, 100); c.fill();
  c.strokeStyle = '#7d1a24'; c.lineWidth = 4; c.beginPath(); c.moveTo(-58, 100); c.quadraticCurveTo(0, 128, 66, 86); c.stroke();
  c.restore();
}

// ---------------------------------------------------------------- film styles (pixel processing)
const vigCache = new Map();
function vignette(w, h) {
  const k = w + 'x' + h; if (vigCache.has(k)) return vigCache.get(k);
  const v = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2, d = dx * dx * 0.75 + dy * dy * 0.55;
    const s = clamp((d - 0.25) / 1.1, 0, 1); v[y * w + x] = 1 - 0.42 * s * s * (3 - 2 * s);
  }
  if (vigCache.size > 8) vigCache.clear();
  vigCache.set(k, v); return v;
}
const lumCache = new Map();
function lumBuf(n) { if (!lumCache.has(n)) { if (lumCache.size > 6) lumCache.clear(); lumCache.set(n, new Float32Array(n)); } return lumCache.get(n); }

const grain = document.createElement('canvas'); grain.width = grain.height = 160;
{
  const g = grain.getContext('2d'), id = g.createImageData(160, 160);
  for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (Math.random() - 0.5) * 200; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; }
  g.putImageData(id, 0, 0);
}
const S = x => x * x * (3 - 2 * x);

function processStyle(ctx, w, h, style, t, { cell = 6, seed = Math.random() } = {}) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data, vig = vignette(w, h);
  const n = w * h;
  if (style === 'bw') {
    for (let i = 0, p = 0; p < n; p++, i += 4) {
      let x = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
      x = S(S(x)) * 0.55 + x * 0.45; x *= vig[p]; x = 0.025 + x * 0.96;
      d[i] = x * 250; d[i + 1] = x * 252; d[i + 2] = x * 255 + 2;
    }
  } else if (style === 'warm') {
    for (let i = 0, p = 0; p < n; p++, i += 4) {
      let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      r = l + (r - l) * 0.9; g = l + (g - l) * 0.9; b = l + (b - l) * 0.9;
      r = S(r) * 0.4 + r * 0.6; g = S(g) * 0.4 + g * 0.6; b = S(b) * 0.4 + b * 0.6;
      const v = vig[p];
      d[i] = (0.07 + (r * 1.07) * 0.9) * v * 255; d[i + 1] = (0.05 + g * 0.88) * v * 255; d[i + 2] = (0.07 + b * 0.72) * v * 255;
    }
  } else if (style === 'comic') {
    const L = lumBuf(n);
    for (let i = 0, p = 0; p < n; p++, i += 4) L[p] = 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
    const inv = 0.70710678 / cell;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x, i = p * 4;
      let ink = false;
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const a = L[p - w - 1], b = L[p - w], c2 = L[p - w + 1], e = L[p - 1], f = L[p + 1], g = L[p + w - 1], hh = L[p + w], k = L[p + w + 1];
        const gx = c2 + 2 * f + k - a - 2 * e - g, gy = g + 2 * hh + k - a - 2 * b - c2;
        ink = Math.abs(gx) + Math.abs(gy) > 190;
      }
      if (ink) { d[i] = 22; d[i + 1] = 18; d[i + 2] = 26; continue; }
      const l = L[p];
      if (l > 222) { d[i] = 255; d[i + 1] = 246; d[i + 2] = 224; continue; }
      // saturate + posterize to 4 levels per channel
      let r = d[i], g = d[i + 1], b = d[i + 2];
      r = l + (r - l) * 1.7; g = l + (g - l) * 1.7; b = l + (b - l) * 1.7;
      r = Math.round(clamp(r, 0, 255) / 85) * 85; g = Math.round(clamp(g, 0, 255) / 85) * 85; b = Math.round(clamp(b, 0, 255) / 85) * 85;
      if (r + g + b < 40) { r = 22; g = 18; b = 26; } // deep shadows become ink
      // crisp 45° halftone: dot radius grows with darkness
      const u = (x + y) * inv, v = (x - y) * inv;
      const fu = u - Math.floor(u) - 0.5, fv = v - Math.floor(v) - 0.5;
      const dd = Math.sqrt(fu * fu + fv * fv) * 2;
      const rad = (1 - l / 255) * 1.15;
      if (dd < rad) { r *= 0.42; g *= 0.4; b *= 0.5; }
      else if (r + g + b > 600) { r = 255; g = 246; b = 224; }
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
  } else if (style === 'holo') {
    for (let i = 0, p = 0; p < n; p++, i += 4) {
      let r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255;
      const l = 0.3 * r + 0.59 * g + 0.11 * b;
      r = l + (r - l) * 0.55; g = l + (g - l) * 0.55; b = l + (b - l) * 0.55;
      const v = vig[p] * 0.25 + 0.75;
      d[i] = S(r) * 215 * v + 6; d[i + 1] = S(g) * 220 * v + 8; d[i + 2] = S(b) * 235 * v + 16;
    }
  }
  ctx.putImageData(img, 0, 0);

  ctx.save();
  if (style === 'warm') {
    // orange light leak + dust & scratches
    const lx = w * (0.92 + Math.sin(t * 0.5) * 0.05), ly = h * 0.08;
    const lg = ctx.createRadialGradient(lx, ly, 0, lx, ly, w * 0.75);
    lg.addColorStop(0, 'rgba(255,150,60,.55)'); lg.addColorStop(0.45, 'rgba(255,90,40,.18)'); lg.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
    let r = seed * 9973;
    const rnd = () => (r = (r * 16807 + 11) % 2147483647) / 2147483647;
    const sc = w / 480;
    for (let k = 0; k < 14; k++) {
      ctx.fillStyle = rnd() < 0.7 ? 'rgba(20,10,5,.55)' : 'rgba(255,250,235,.6)';
      ctx.beginPath(); ctx.ellipse(rnd() * w, rnd() * h, (0.6 + rnd() * 1.8) * sc, (0.6 + rnd() * 1.2) * sc, rnd() * 3, 0, 7); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,248,230,.35)'; ctx.lineWidth = 0.8 * sc;
    for (let k = 0; k < 2; k++) { const x = rnd() * w; ctx.beginPath(); ctx.moveTo(x, rnd() * h * 0.3); ctx.lineTo(x + (rnd() - 0.5) * 6, h * (0.6 + rnd() * 0.4)); ctx.stroke(); }
    ctx.fillStyle = 'rgba(20,10,5,.4)';
    ctx.beginPath(); ctx.moveTo(rnd() * w, rnd() * h); for (let k = 0; k < 5; k++) ctx.lineTo(rnd() * w * 0.05 + w * 0.3, rnd() * h * 0.05 + h * 0.6); ctx.lineWidth = 0.6 * sc; ctx.strokeStyle = 'rgba(20,10,5,.35)'; ctx.stroke();
  }
  if (style === 'holo') {
    const ang = (state.tiltX * 2.2 + 35) * Math.PI / 180 + Math.sin(t * 0.4) * 0.25;
    const phase = ((((state.tiltY / 60) + t * 0.08) % 1) + 1) % 1;
    const L = Math.hypot(w, h) / 2, cx = w / 2, cy = h / 2, dx = Math.cos(ang) * L, dy = Math.sin(ang) * L;
    const lg = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    const cols = ['#ff9ad5', '#9be7ff', '#c8ffb0', '#fff3a1'];
    for (let k = 0; k <= 12; k++) lg.addColorStop(k / 12, cols[(k + Math.floor(phase * 4)) % 4]);
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = 0.6; ctx.fillStyle = lg; ctx.fillRect(0, 0, w, h);
    // specular band
    const off = (phase * 2 - 0.5);
    const sg = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
    const a0 = clamp(off - 0.12, 0, 1), a1 = clamp(off, 0, 1), a2 = clamp(off + 0.12, 0, 1);
    sg.addColorStop(0, 'rgba(255,255,255,0)'); sg.addColorStop(a0, 'rgba(255,255,255,0)'); sg.addColorStop(a1, 'rgba(255,255,255,.55)'); sg.addColorStop(a2, 'rgba(255,255,255,0)'); sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.45; ctx.fillStyle = sg; ctx.fillRect(0, 0, w, h);
    // fine diffraction lines
    ctx.globalCompositeOperation = 'soft-light'; ctx.globalAlpha = 0.35; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let x = -h; x < w; x += 5) { ctx.moveTo(x, 0); ctx.lineTo(x + h, h); } ctx.stroke();
  }
  if (style !== 'comic') {
    ctx.globalCompositeOperation = 'overlay'; ctx.globalAlpha = style === 'holo' ? 0.18 : 0.32;
    const pat = ctx.createPattern(grain, 'repeat');
    ctx.translate(-Math.random() * 160, -Math.random() * 160);
    ctx.fillStyle = pat; ctx.fillRect(0, 0, w + 160, h + 160);
  }
  ctx.restore();
}

// ---------------------------------------------------------------- twins
function drawTwins(src, axisFrac, cl, cr) {
  const W = src.width, H = src.height, ax = axisFrac * W;
  const hw = Math.max(8, Math.floor(Math.min(ax, W - ax)));
  for (const [cv, left] of [[cl, true], [cr, false]]) {
    if (cv.width !== hw * 2 || cv.height !== H) { cv.width = hw * 2; cv.height = H; }
    const c = cv.getContext('2d');
    const sx = left ? ax - hw : ax;
    // the kept half goes on its own side; its mirror fills the other side
    c.drawImage(src, sx, 0, hw, H, left ? 0 : hw, 0, hw, H);
    c.save(); c.translate(hw * 2, 0); c.scale(-1, 1);
    c.drawImage(src, sx, 0, hw, H, left ? 0 : hw, 0, hw, H);
    c.restore();
  }
}

// ---------------------------------------------------------------- live render loop
function sizeLive() {
  const r = vf.getBoundingClientRect();
  if (!r.width || !r.height) return;
  const k = 440 / Math.max(r.width, r.height);
  const w = Math.max(60, Math.round(r.width * k)), h = Math.max(60, Math.round(r.height * k));
  if (live.width !== w || live.height !== h) { live.width = w; live.height = h; }
}
let grainTick = 0;
function loop(now) {
  requestAnimationFrame(loop);
  try { frame(now / 1000); } catch (e) { if (!loop.warned) { loop.warned = true; console.warn('booth frame', e); } }
}
function frame(t) {
  if (!videoReady()) drawDemo(t);
  if (state.demo && !state.axisUser && state.demoCenter) state.axis = state.demoCenter;
  if (state.mode !== 'reveal') {
    sizeLive();
    state.liveCrop = drawSource(liveCtx, live.width, live.height);
    processStyle(liveCtx, live.width, live.height, state.style, t, { cell: 5, seed: Math.floor(t * 12) + 1 });
    if (state.mode === 'live') {
      const a = axisInCrop(state.liveCrop);
      $('#axis').style.left = (a * 100) + '%';
      drawTwins(live, a, liveL, liveR);
    }
  }
  grainTick++;
}

// ---------------------------------------------------------------- start (curtain parts)
async function start() {
  if (state.started) return;
  state.started = true;
  initAudio().then(() => sfx.swish());
  haptic();
  stage.classList.add('open');
  try {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no camera');
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } }, audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    state.demo = false; state.axis = 0.5;
    stream.getVideoTracks()[0]?.addEventListener('ended', () => { state.demo = true; });
  } catch {
    state.demo = true;
    $('#vfTag').textContent = '● DEMO MODEL';
    toast('No camera, so meet our stand-in model ✦', 2600);
  }
}
$('#enter').addEventListener('click', start);
stage.addEventListener('click', e => { if (e.target.classList.contains('drape')) start(); });

// tilt drives the holo foil (pointer as fallback)
addEventListener('deviceorientation', e => { if (e.gamma != null) { state.tiltX = e.gamma; state.tiltY = e.beta || 0; } });
addEventListener('pointermove', e => {
  if (e.pointerType === 'mouse') { state.tiltX = (e.clientX / innerWidth - 0.5) * 60; state.tiltY = (e.clientY / innerHeight - 0.5) * 60; }
});

// ---------------------------------------------------------------- styles
function setStyle(s) {
  state.style = s;
  document.querySelectorAll('#styles button').forEach(b => b.setAttribute('aria-checked', String(b.dataset.style === s)));
}
document.querySelectorAll('#styles button').forEach(b => b.addEventListener('click', () => {
  if (state.shooting) return;
  setStyle(b.dataset.style); haptic(); tone(1200, 0.05, { type: 'square', vol: 0.03 });
}));
setStyle('warm');

// ---------------------------------------------------------------- shooting
const countdown = $('#countdown');
const flash = $('#flash');
const bulbs = [...document.querySelectorAll('#bulbs i')];

async function shoot() {
  if (state.shooting) return;
  if (!state.started) { await start(); await wait(700 * M()); }
  else initAudio();
  state.shooting = true;
  body.classList.add('shooting'); body.classList.remove('ready');
  $('#vfTag').classList.add('rec');
  bulbs.forEach(b => b.classList.remove('on'));
  const frames = [];
  let axis = 0.5;
  for (let i = 0; i < SHOTS; i++) {
    const per = i === 0 ? 700 : 550;
    for (const n of [3, 2, 1]) {
      countdown.innerHTML = `<b style="animation-duration:${per}ms">${n}</b>`;
      sfx.beep(n === 1); haptic();
      await wait(per);
    }
    countdown.innerHTML = '';
    // flash: white bloom, capture while the face is lit, then fade
    flash.getAnimations().forEach(a => a.cancel());
    const fa = flash.animate([{ opacity: 0 }, { opacity: 1, offset: 0.06 }, { opacity: 1, offset: 0.16 }, { opacity: 0 }],
      { duration: reduced.matches ? 300 : 750, easing: 'ease-out' });
    sfx.shutter(); sfx.flash(); haptic([20]);
    await wait(90);
    const fc = document.createElement('canvas'); fc.width = FRAME_W; fc.height = FRAME_H;
    const fctx = fc.getContext('2d', { willReadFrequently: true });
    const crop = drawSource(fctx, FRAME_W, FRAME_H);
    processStyle(fctx, FRAME_W, FRAME_H, state.style, performance.now() / 1000, { cell: 7, seed: Math.random() });
    if (i === 0) axis = axisInCrop(crop);
    frames.push(fc);
    bulbs[i].classList.add('on');
    await fa.finished.catch(() => {});
    await wait(250);
  }
  state.shooting = false;
  body.classList.remove('shooting');
  $('#vfTag').classList.remove('rec');
  await finishStrip(frames, axis);
}
$('#shutter').addEventListener('click', () => { haptic(); shoot(); });

// ---------------------------------------------------------------- strip
const dateStamp = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, '0')}·${String(d.getMonth() + 1).padStart(2, '0')}·${d.getFullYear()}`;
};
function buildStrip(frames, style) {
  const P = 34, G = 26, foot = 190;
  const W = FRAME_W + P * 2, H = P + frames.length * FRAME_H + (frames.length - 1) * G + foot;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  x.fillStyle = style === 'bw' ? '#f8f7f3' : '#f6f0e1'; x.fillRect(0, 0, W, H);
  // paper fibre
  x.globalAlpha = 0.06; x.fillStyle = x.createPattern(grain, 'repeat'); x.fillRect(0, 0, W, H); x.globalAlpha = 1;
  frames.forEach((f, i) => {
    const y = P + i * (FRAME_H + G);
    x.drawImage(f, P, y);
    x.strokeStyle = 'rgba(0,0,0,.25)'; x.lineWidth = 2; x.strokeRect(P + 1, y + 1, FRAME_W - 2, FRAME_H - 2);
  });
  const fy = H - foot + 30;
  x.textAlign = 'center';
  x.fillStyle = '#7a1020'; x.font = `400 78px ${cssVar('--f-cond')}`;
  x.fillText('FOLD BOOTH', W / 2, fy + 70);
  x.fillStyle = '#16121a'; x.font = `500 24px ${cssVar('--f-mono')}`;
  x.fillText(`✦ ${dateStamp()} · ${STYLE_NAMES[style].toUpperCase()} ✦`, W / 2, fy + 118);
  return c;
}
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const toBlob = c => new Promise(r => c.toBlob(r, 'image/png'));

async function finishStrip(frames, axis) {
  const canvas = buildStrip(frames, state.style);
  const blob = await toBlob(canvas);
  if (state.strip?.url) URL.revokeObjectURL(state.strip.url);
  const url = URL.createObjectURL(blob);
  state.strip = { frames, style: state.style, axis, canvas, blob, url, developed: false, dismissed: false, pick: null };
  const thumb = $('#thumb');
  thumb.querySelector('img').src = url; thumb.disabled = false;
  thumb.classList.remove('pop'); void thumb.offsetWidth; thumb.classList.add('pop');
  $('#stripImg').src = url;
  body.classList.toggle('holo-strip', state.style === 'holo');
  if (fold.open) {
    await enterReveal(true);
  } else {
    body.classList.add('ready');
    sfx.chime(); haptic();
  }
}

// ---------------------------------------------------------------- modes & the unfold moment
function setMode(m) {
  state.mode = m; body.dataset.mode = m;
  requestAnimationFrame(sizeLive);
}
const vertical = () => (fold.state.crease || 'vertical') === 'vertical';
let revealToken = 0;

function flare() {
  $('#flare').animate([{ opacity: 0 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], { duration: 900 * M() + 50, easing: 'ease-out' });
}
function swingIn(el, delay = 0) {
  const v = vertical();
  return el.animate([
    { transform: v ? 'rotateY(-95deg)' : 'rotateX(95deg)', opacity: 0.3, filter: 'brightness(.4)' },
    { transform: 'none', opacity: 1, filter: 'brightness(1)' },
  ], { duration: 650 * M() + 1, delay: delay * M(), easing: 'cubic-bezier(.2,.9,.25,1.05)', fill: 'backwards' });
}

async function enterLive() {
  setMode('live');
  body.classList.remove('ready');
  flare(); sfx.whoomp(); haptic();
  swingIn($('#twinPage'));
  $('#camPage').animate([{ transform: 'scale(1.06)', filter: 'brightness(1.4)' }, { transform: 'none', filter: 'none' }],
    { duration: 600 * M() + 1, easing: 'ease-out' });
  document.querySelectorAll('.twin-live figure').forEach((f, i) =>
    f.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }], { duration: 500 * M() + 1, delay: (350 + i * 160) * M(), easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'backwards' }));
}

async function enterReveal(develop) {
  const s = state.strip; if (!s) return;
  const token = ++revealToken;
  s.dismissed = false;
  setMode('reveal');
  body.classList.remove('ready');
  $('#axisRange').value = String(s.axis * 100);
  drawTwins(s.frames[0], s.axis, twinL, twinR);
  document.querySelectorAll('.twin').forEach(t => t.classList.toggle('picked', t.dataset.twin === s.pick));
  const v = vertical(), m = M();
  const wrap = $('#stripWrap'), img = $('#stripImg'), curl = $('#stripCurl');
  const actions = $('#revealPage .actions'), question = $('#revealPage .question');
  [wrap, img, curl, actions, question, ...document.querySelectorAll('.twin, .gloss')].forEach(e => e.getAnimations().forEach(a => a.cancel()));

  flare(); sfx.whoomp(); haptic();
  swingIn($('#revealPage'));

  if (!develop) {
    wrap.animate([{ transform: v ? 'translateX(60%)' : 'translateY(60%)', opacity: 0 }, { transform: 'none', opacity: 1 }],
      { duration: 550 * m + 1, easing: 'cubic-bezier(.2,.9,.3,1)' });
    document.querySelectorAll('.twin').forEach((t, i) => t.animate([{ transform: 'scaleX(0)' }, { transform: 'none' }],
      { duration: 450 * m + 1, delay: (200 + i * 120) * m, easing: 'cubic-bezier(.3,1.3,.5,1)', fill: 'backwards' }));
    return;
  }

  // 1) feed out of the crease slot in jerky printer steps (300 → 1700ms)
  const off = v ? x => `translateX(${x}%)` : x => `translateY(${x}%)`;
  const steps = [115, 92, 92, 66, 66, 42, 42, 20, 20, 0];
  const kf = steps.map((p, i) => ({ transform: off(p), offset: i / (steps.length - 1) }));
  setTimeout(() => token === revealToken && sfx.feed(5), 300 * m);
  wrap.animate(kf, { duration: 1400 * m + 1, delay: 300 * m, easing: 'linear', fill: 'backwards' });
  curl.animate([{ transform: 'perspective(900px) rotateY(-24deg) rotate(0deg) skewY(-2deg)' }, { transform: 'perspective(900px) rotateY(-7deg) rotate(-1.5deg)' }],
    { duration: 900 * m + 1, delay: 1500 * m, easing: 'cubic-bezier(.3,1.4,.5,1)', fill: 'backwards' });

  // 2) chemical develop: blank paper → cyan ghost → sepia/contrast → final (1700 → 4200ms)
  img.animate([
    { filter: 'grayscale(1) brightness(2.4) contrast(.08)' },
    { filter: 'grayscale(1) sepia(1) hue-rotate(150deg) saturate(.8) brightness(1.75) contrast(.22)', offset: 0.3 },
    { filter: 'sepia(.85) hue-rotate(-8deg) saturate(1.3) brightness(1.15) contrast(1.35)', offset: 0.68 },
    { filter: 'sepia(.15) brightness(1) contrast(1.05)', offset: 0.88 },
    { filter: 'none' },
  ], { duration: 2500 * m + 1, delay: 1700 * m, easing: 'ease-in-out', fill: 'backwards' });
  const gloss = curl.querySelector('.gloss');
  if (state.strip.style !== 'holo') {
    gloss.animate([{ opacity: 0.9, backgroundPosition: '0 100%' }, { opacity: 0.9, backgroundPosition: '0 -200%' }],
      { duration: 1600 * m + 1, delay: 2300 * m, easing: 'ease-in-out' });
  }

  // 3) twins unfold from their mirror axis (2600 → 3400ms), caption + chime (3600), actions (4200)
  document.querySelectorAll('.twin').forEach((t, i) => t.animate([
    { transform: 'scaleX(0)', filter: 'brightness(2)' }, { transform: 'scaleX(1.04)', offset: 0.7 }, { transform: 'none', filter: 'none' },
  ], { duration: 700 * m + 1, delay: (2600 + i * 180) * m, easing: 'cubic-bezier(.3,1,.5,1)', fill: 'backwards' }));
  setTimeout(() => token === revealToken && haptic(), 2600 * m);
  question.animate([{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'none' }], { duration: 500 * m + 1, delay: 3600 * m, fill: 'backwards' });
  setTimeout(() => { if (token === revealToken) { sfx.chime(); haptic(); } }, 3600 * m);
  actions.animate([{ opacity: 0, transform: 'translateY(24px)' }, { opacity: 1, transform: 'none' }],
    { duration: 500 * m + 1, delay: 4200 * m, easing: 'cubic-bezier(.2,.9,.3,1.2)', fill: 'backwards' });
  s.developed = true;
}

function foldMoment() {
  revealToken++;
  setMode('cover');
  if (state.strip && state.strip.developed) body.classList.remove('ready');
  else if (state.strip) body.classList.add('ready');
  // a quick curtain swish closes over the booth and reopens
  sfx.swish(); haptic();
  if (state.started && !reduced.matches) {
    stage.classList.add('swish'); stage.classList.remove('open');
    setTimeout(() => stage.classList.add('open'), 430);
    setTimeout(() => stage.classList.remove('swish'), 900);
  }
  $('#thumb').classList.remove('pop'); void $('#thumb').offsetWidth; if (state.strip) $('#thumb').classList.add('pop');
}

fold.on((s, prev, kind) => {
  if (kind === 'resize') { sizeLive(); return; }
  if (kind === 'init') {
    if (s.open) setMode(state.strip && !state.strip.dismissed ? 'reveal' : 'live');
    else setMode('cover');
    return;
  }
  if (s.open && !prev?.open) {
    if (state.strip && !state.strip.dismissed && !state.shooting) enterReveal(!state.strip.developed);
    else enterLive();
  } else if (!s.open && prev?.open) {
    foldMoment();
  } else {
    sizeLive();
  }
});

// ---------------------------------------------------------------- interactions
$('#thumb').addEventListener('click', () => {
  if (!state.strip) return;
  haptic();
  if (fold.open) { enterReveal(!state.strip.developed); return; }
  if (fold.state.physical || !fold.canFold) { toast('Unfold to develop your strip ✦'); return; }
  fold.toggle(true);
});
$('#retake').addEventListener('click', () => {
  if (state.strip) state.strip.dismissed = true;
  haptic(); enterLive();
});
$('#axisRange').addEventListener('input', e => {
  const s = state.strip; if (!s) return;
  s.axis = +e.target.value / 100;
  drawTwins(s.frames[0], s.axis, twinL, twinR);
});
document.querySelectorAll('.twin').forEach(t => t.addEventListener('click', () => {
  const s = state.strip; if (!s) return;
  s.pick = s.pick === t.dataset.twin ? null : t.dataset.twin;
  document.querySelectorAll('.twin').forEach(o => o.classList.toggle('picked', o.dataset.twin === s.pick));
  if (s.pick) { sfx.pick(); haptic(); toast(`Team ${s.pick} ✦`); }
}));

// drag the mirror line on the live viewfinder
let dragging = false;
function setAxisFromEvent(e) {
  const r = vf.getBoundingClientRect(), c = state.liveCrop; if (!c) return;
  const f = clamp((e.clientX - r.left) / r.width, 0.25, 0.75);
  state.axis = (f * c.sw + c.sx) / c.W; state.axisUser = true;
}
vf.addEventListener('pointerdown', e => {
  if (state.mode !== 'live' || state.shooting) return;
  dragging = true; vf.setPointerCapture(e.pointerId); setAxisFromEvent(e); haptic();
});
vf.addEventListener('pointermove', e => dragging && setAxisFromEvent(e));
vf.addEventListener('pointerup', () => { dragging = false; });
vf.addEventListener('pointercancel', () => { dragging = false; });

// ---------------------------------------------------------------- share
function roundRect(x, X, Y, W, H, r) { x.beginPath(); x.roundRect ? x.roundRect(X, Y, W, H, r) : x.rect(X, Y, W, H); }
async function composePoster() {
  const s = state.strip;
  try { await Promise.all(['400 100px Anton', 'italic 500 40px "Playfair Display"', '500 20px "DM Mono"'].map(f => document.fonts.load(f))); } catch {}
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
  const x = c.getContext('2d');
  const cond = cssVar('--f-cond'), serif = cssVar('--f-serif'), mono = cssVar('--f-mono');
  // velvet backdrop
  x.fillStyle = '#2c040c'; x.fillRect(0, 0, W, H);
  for (let i = 0; i < 26; i++) {
    const fx = (i / 26) * W, fw = W / 26, g = x.createLinearGradient(fx, 0, fx + fw, 0);
    g.addColorStop(0, '#2c040c'); g.addColorStop(0.35, '#7a1020'); g.addColorStop(0.55, '#a21d30'); g.addColorStop(1, '#2c040c');
    x.fillStyle = g; x.fillRect(fx, 0, fw + 1, H);
  }
  const spot = x.createRadialGradient(W / 2, 300, 50, W / 2, 700, 1300);
  spot.addColorStop(0, 'rgba(255,200,150,.25)'); spot.addColorStop(0.5, 'rgba(0,0,0,0)'); spot.addColorStop(1, 'rgba(0,0,0,.65)');
  x.fillStyle = spot; x.fillRect(0, 0, W, H);

  // brass marquee header
  const mx = 120, my = 70, mw = W - 240, mh = 190;
  const brass = x.createLinearGradient(mx, my, mx + mw, my + mh);
  [['#fff3c4', 0], ['#c9a24a', 0.2], ['#7a5a1c', 0.4], ['#f3dc8e', 0.55], ['#a37b2a', 0.75], ['#fff0b8', 0.9], ['#8a6420', 1]].forEach(([col, o]) => brass.addColorStop(o, col));
  x.fillStyle = brass; roundRect(x, mx - 10, my - 10, mw + 20, mh + 20, 28); x.fill();
  const inner = x.createLinearGradient(0, my, 0, my + mh); inner.addColorStop(0, '#3a0a10'); inner.addColorStop(1, '#12010a');
  x.fillStyle = inner; roundRect(x, mx, my, mw, mh, 20); x.fill();
  for (let i = 0; i < 26; i++) { // bulbs
    const t = i / 26, per = 2 * (mw + mh);
    let d = t * per, bx, by;
    if (d < mw) { bx = mx + d; by = my + 16; } else if ((d -= mw) < mh) { bx = mx + mw - 16; by = my + d; }
    else if ((d -= mh) < mw) { bx = mx + mw - d; by = my + mh - 16; } else { d -= mw; bx = mx + 16; by = my + mh - d; }
    const bg = x.createRadialGradient(bx, by, 0, bx, by, 14); bg.addColorStop(0, '#fffbe6'); bg.addColorStop(0.35, '#ffd27a'); bg.addColorStop(1, 'rgba(255,170,60,0)');
    x.fillStyle = bg; x.beginPath(); x.arc(bx, by, 14, 0, 7); x.fill();
  }
  x.textAlign = 'center'; x.textBaseline = 'alphabetic';
  x.font = `400 112px ${cond}`; x.fillStyle = '#fff';
  x.shadowColor = '#ff7a2c'; x.shadowBlur = 40; x.fillText('FOLD  BOOTH', W / 2, my + 140); x.shadowBlur = 12; x.fillText('FOLD  BOOTH', W / 2, my + 140);
  x.shadowBlur = 0;

  // the strip, tilted with a curl shadow
  const sc = s.canvas, sh = 1330, sw = sh * sc.width / sc.height, sx = 70, sy = 330;
  x.save(); x.translate(sx + sw / 2, sy + sh / 2); x.rotate(-3 * Math.PI / 180);
  x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = 50; x.shadowOffsetY = 26; x.shadowOffsetX = 10;
  x.drawImage(sc, -sw / 2, -sh / 2, sw, sh);
  x.shadowColor = 'transparent';
  const curl = x.createLinearGradient(-sw / 2, 0, sw / 2, 0);
  curl.addColorStop(0, 'rgba(0,0,0,.2)'); curl.addColorStop(0.15, 'rgba(0,0,0,0)'); curl.addColorStop(0.45, 'rgba(255,255,255,.12)'); curl.addColorStop(0.8, 'rgba(0,0,0,0)'); curl.addColorStop(1, 'rgba(0,0,0,.25)');
  x.fillStyle = curl; x.fillRect(-sw / 2, -sh / 2, sw, sh);
  x.restore();

  // twins, editorial
  const tl = document.createElement('canvas'), tr = document.createElement('canvas');
  drawTwins(s.frames[0], s.axis, tl, tr);
  const colX = sx + sw + 70, colW = W - colX - 70;
  const tw = colW, th = 600;
  const twins = [[tl, 'LEFTY', 340], [tr, 'RIGHTY', 1010]];
  twins.forEach(([cv, label, ty], i) => {
    x.save(); x.translate(colX + tw / 2, ty + th / 2); x.rotate((i ? 2 : -1.5) * Math.PI / 180);
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = 40; x.shadowOffsetY = 20;
    x.fillStyle = '#f6f0e1'; x.fillRect(-tw / 2 - 16, -th / 2 - 16, tw + 32, th + 32);
    x.shadowColor = 'transparent';
    // cover-fit the twin into tw×th
    const k = Math.max(tw / cv.width, th / cv.height), dw = cv.width * k, dh = cv.height * k;
    x.save(); x.beginPath(); x.rect(-tw / 2, -th / 2, tw, th); x.clip();
    x.drawImage(cv, -dw / 2, -dh / 2, dw, dh); x.restore();
    if (s.pick && label.toLowerCase() === s.pick.toLowerCase()) {
      x.save(); x.rotate(-0.2); x.strokeStyle = '#c3122a'; x.lineWidth = 7; x.fillStyle = 'rgba(255,255,255,.35)';
      x.font = `400 64px ${cond}`; const mw2 = x.measureText("IT'S ME").width + 40;
      x.fillRect(-mw2 / 2, th / 4 - 60, mw2, 84); x.strokeRect(-mw2 / 2, th / 4 - 60, mw2, 84);
      x.fillStyle = '#c3122a'; x.fillText("IT'S ME", 0, th / 4 + 6); x.restore();
    }
    x.restore();
    // giant condensed label
    x.save(); x.font = `400 168px ${cond}`; x.textAlign = i ? 'right' : 'left';
    x.fillStyle = i ? '#ffd84a' : '#f6f0e1';
    x.shadowColor = 'rgba(0,0,0,.45)'; x.shadowBlur = 18; x.shadowOffsetY = 6;
    if (i) x.fillText(label, W - 40, ty + 140); else x.fillText(label, colX - 40, ty + th + 40);
    x.restore();
  });

  // caption + brand
  x.textAlign = 'center';
  x.font = `italic 500 64px ${serif}`; x.fillStyle = '#ffe9c9';
  x.fillText('which twin are you?', W / 2, 1772);
  x.fillStyle = 'rgba(243,220,142,.8)'; x.fillRect(W / 2 - 160, 1808, 320, 2);
  x.font = `500 28px ${mono}`; x.fillStyle = '#f3dc8e';
  x.fillText('Duo Lab · Fold Booth', W / 2, 1866);

  // grain
  x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.18; x.fillStyle = x.createPattern(grain, 'repeat'); x.fillRect(0, 0, W, H);
  return c;
}

$('#share').addEventListener('click', async e => {
  if (!state.strip) return;
  const b = e.currentTarget; b.disabled = true; haptic();
  try {
    const blob = await toBlob(await composePoster());
    const r = await shareFile(blob, 'fold-booth-twins.png', { title: 'Fold Booth', text: 'Which twin am I? Lefty or Righty ✦ Duo Lab' });
    if (r === 'downloaded') toast('Poster saved ✦');
  } catch { toast('Could not share, sorry'); }
  b.disabled = false;
});
$('#saveStrip').addEventListener('click', async () => {
  if (!state.strip) return;
  haptic();
  const r = await shareFile(state.strip.blob, 'fold-booth-strip.png', { title: 'Fold Booth strip', text: 'Fresh from the Fold Booth ✦' });
  if (r === 'downloaded') toast('Strip saved ✦');
});

// ---------------------------------------------------------------- boot
mountChrome();
requestAnimationFrame(loop);
// debug/test hook (harmless): window.__booth exposes state
window.__booth = { state, composePoster };
