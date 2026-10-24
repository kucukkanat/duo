// kit.js — small helpers every Duo Lab app shares.
import { fold } from './fold.js';
export { fold };

/** One tap unlocks audio, motion sensors and the haptic trick (iOS requires a user gesture). */
export async function unlock({ motion = false, audio = false } = {}) {
  const out = { motion: false, audio: null };
  if (audio) {
    const AC = window.AudioContext || window.webkitAudioContext;
    out.audio = new AC();
    await out.audio.resume().catch(() => {});
  }
  if (motion) {
    try {
      const reqs = [window.DeviceMotionEvent, window.DeviceOrientationEvent]
        .filter(E => E && typeof E.requestPermission === 'function')
        .map(E => E.requestPermission());
      const res = await Promise.all(reqs);
      out.motion = res.every(r => r === 'granted');
    } catch { out.motion = false; }
    if (!(window.DeviceMotionEvent && typeof DeviceMotionEvent.requestPermission === 'function')) {
      out.motion = 'DeviceMotionEvent' in window;
    }
  }
  return out;
}

/** Haptic tick. Uses navigator.vibrate where it exists, else the iOS <input switch> trick (tap-gated). */
let hapticLabel;
export function haptic(pattern = 10) {
  // Both paths need prior user activation; skip silently before the first tap.
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  if (navigator.vibrate) { navigator.vibrate(pattern); return; }
  try {
    if (!hapticLabel) {
      hapticLabel = document.createElement('label');
      hapticLabel.setAttribute('aria-hidden', 'true');
      hapticLabel.style.cssText = 'position:fixed;left:-9999px;opacity:0;pointer-events:none';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.setAttribute('switch', '');
      hapticLabel.appendChild(input);
      document.body.appendChild(hapticLabel);
    }
    hapticLabel.click();
  } catch {}
}

/** Share a Blob as a file (falls back to download). */
export async function shareFile(blob, filename, { title = 'Duo Lab', text = '' } = {}) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title, text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return 'downloaded';
}

/** Share a URL (falls back to clipboard). */
export async function shareLink(url, { title = 'Duo Lab', text = '' } = {}) {
  if (navigator.share) {
    try { await navigator.share({ url, title, text }); return 'shared'; }
    catch (e) { if (e.name === 'AbortError') return 'cancelled'; }
  }
  try { await navigator.clipboard.writeText(url); toast('Link copied'); return 'copied'; }
  catch { prompt('Copy this link', url); return 'prompted'; }
}

/** Record a canvas for `ms` milliseconds -> Blob (mp4 on Safari, webm elsewhere). */
export function recordCanvas(canvas, ms = 6000, { fps = 60, audioStream = null } = {}) {
  const stream = canvas.captureStream(fps);
  audioStream?.getAudioTracks().forEach(t => stream.addTrack(t));
  const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm']
    .find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
  const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 6e6 } : undefined);
  const chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  return new Promise(resolve => {
    rec.onstop = () => resolve(new Blob(chunks, { type: rec.mimeType || type || 'video/webm' }));
    rec.start(250);
    setTimeout(() => rec.stop(), ms);
  });
}
export const videoExt = blob => (blob.type.includes('mp4') ? 'mp4' : 'webm');

/** Compact URL-hash state: JSON -> deflate-raw -> base64url. */
export async function encodeState(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  if (!window.CompressionStream) return 'j' + b64u(bytes);
  const cs = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return 'z' + b64u(new Uint8Array(await new Response(cs).arrayBuffer()));
}
export async function decodeState(str) {
  if (!str) return null;
  try {
    const bytes = unb64u(str.slice(1));
    if (str[0] === 'j') return JSON.parse(new TextDecoder().decode(bytes));
    const ds = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return JSON.parse(await new Response(ds).text());
  } catch { return null; }
}
const b64u = b => btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

/** Transient toast message. */
export function toast(msg, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'duo-toast';
  el.textContent = msg;
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, ms);
}

/**
 * Standard chrome for every app: back-to-hub link + "simulate fold" pill on non-foldables.
 * Call once after DOM is ready.
 */
export function mountChrome({ back = '../../' } = {}) {
  const bar = document.createElement('nav');
  bar.className = 'duo-chrome';
  bar.innerHTML = `<a class="duo-back" href="${back}" aria-label="Back to Duo Lab">‹ Duo Lab</a>
    <button class="duo-fold-toggle" type="button"></button>`;
  document.body.appendChild(bar);
  const btn = bar.querySelector('.duo-fold-toggle');
  fold.on(s => {
    btn.hidden = s.physical;
    btn.textContent = s.open ? '◧ Fold' : '◫ Unfold';
    btn.setAttribute('aria-pressed', String(s.open));
  });
  btn.addEventListener('click', () => { haptic(); fold.toggle(); });
}

/** Wake lock that survives visibility changes. */
export async function keepAwake() {
  let lock;
  const get = async () => { try { lock = await navigator.wakeLock?.request('screen'); } catch {} };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && get());
  await get();
  return () => lock?.release();
}

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  const swUrl = new URL('../sw.js', import.meta.url);
  navigator.serviceWorker.register(swUrl, { scope: new URL('../', import.meta.url).pathname }).catch(() => {});
}
