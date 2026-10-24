// seal.js — a photoreal-ish SVG wax seal that cracks along jagged lines and shatters into shards.
import { rng, hashStr, shade } from './art.js';

let UID = 0;
const TAU = Math.PI * 2;
const esc = s => String(s).replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

function smoothClosed(pts) {
  // Catmull-Rom → cubic Bézier, closed.
  const n = pts.length;
  let d = `M${pts[0][0].toFixed(2)} ${pts[0][1].toFixed(2)}`;
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${c1[0].toFixed(2)} ${c1[1].toFixed(2)} ${c2[0].toFixed(2)} ${c2[1].toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)}`;
  }
  return d + 'Z';
}

function blob(r, base, amp, drips) {
  const pts = [];
  const ph = [r() * TAU, r() * TAU, r() * TAU, r() * TAU];
  for (let i = 0; i < 72; i++) {
    const t = (i / 72) * TAU;
    let rr = base + amp * (2.2 * Math.sin(3 * t + ph[0]) + 1.5 * Math.sin(5 * t + ph[1]) + .9 * Math.sin(9 * t + ph[2]) + .5 * Math.sin(14 * t + ph[3]));
    for (const dr of drips) {
      let dt = Math.abs(t - dr.a); dt = Math.min(dt, TAU - dt);
      rr += dr.A * Math.exp(-((dt / dr.w) ** 2));
    }
    pts.push([Math.cos(t) * rr, Math.sin(t) * rr]);
  }
  return smoothClosed(pts);
}

export class Seal {
  constructor(host, { color = '#9E1B22', letter = 'S', seed = 1 } = {}) {
    this.host = host;
    this.color = color;
    this.uid = 'sl' + (++UID);
    this.build(color, letter, seed);
    this.crack = 0;
    this.offsets = this.shards.map(() => ({ x: 0, y: 0, r: 0, o: 1 }));
  }

  build(color, letter, seed) {
    const u = this.uid, r = rng(seed);
    const drips = Array.from({ length: 4 }, () => ({ a: r() * TAU, A: 4 + r() * 7, w: .12 + r() * .14 }));
    const outer = blob(r, 55, 1.2, drips.map(d => ({ ...d, A: d.A + 3 })));
    const body = blob(r, 50, .7, drips);
    const hi = shade(color, .38), lo = shade(color, -.5), mid = shade(color, -.12);

    // Jagged crack lines from a slightly off-centre origin.
    const N = 7, O = [r() * 6 - 3, r() * 6 - 3];
    const base = r() * TAU;
    this.lines = [];
    for (let i = 0; i < N; i++) {
      const a = base + (i / N) * TAU + (r() - .5) * .35;
      const pts = [O];
      for (const rad of [10, 19, 28, 38, 48, 58, 80]) {
        const aa = a + (r() - .5) * .38;
        pts.push([O[0] + Math.cos(aa) * rad, O[1] + Math.sin(aa) * rad]);
      }
      this.lines.push({ a, pts });
    }
    const wedges = this.lines.map((L, i) => {
      const L2 = this.lines[(i + 1) % N];
      let a2 = L2.a; if (a2 < L.a) a2 += TAU;
      const arc = [];
      for (let k = 0; k <= 6; k++) { const t = L.a + (a2 - L.a) * k / 6; arc.push([Math.cos(t) * 92, Math.sin(t) * 92]); }
      const pts = [...L.pts, ...arc, ...L2.pts.slice().reverse()];
      const mid = (L.a + a2) / 2;
      return { d: 'M' + pts.map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L') + 'Z', mid, cx: Math.cos(mid) * 30, cy: Math.sin(mid) * 30 };
    });
    this.wedges = wedges;
    const crackD = this.lines.map(L => 'M' + L.pts.slice(0, 7).map(p => p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join('L'));

    const L = esc(letter || '');
    this.host.innerHTML = `
<svg class="seal-svg" viewBox="-80 -80 160 160" overflow="visible" aria-hidden="true">
 <defs>
  <radialGradient id="${u}g" cx=".36" cy=".3" r=".8"><stop offset="0" stop-color="${hi}"/><stop offset=".42" stop-color="${color}"/><stop offset="1" stop-color="${lo}"/></radialGradient>
  <radialGradient id="${u}o" cx=".4" cy=".35" r=".75"><stop offset="0" stop-color="${shade(color, .15)}"/><stop offset="1" stop-color="${shade(color, -.55)}"/></radialGradient>
  <radialGradient id="${u}p" cx=".62" cy=".66" r=".7"><stop offset="0" stop-color="${shade(color, .1)}"/><stop offset=".7" stop-color="${mid}"/><stop offset="1" stop-color="${shade(color, -.3)}"/></radialGradient>
  <radialGradient id="${u}s" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".85"/><stop offset=".35" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
  <filter id="${u}bev" x="-25%" y="-25%" width="150%" height="150%" color-interpolation-filters="sRGB">
   <feGaussianBlur in="SourceAlpha" stdDeviation="3.2" result="b"/>
   <feSpecularLighting in="b" surfaceScale="5" specularConstant=".85" specularExponent="18" lighting-color="#fff" result="s"><feDistantLight azimuth="225" elevation="38"/></feSpecularLighting>
   <feComposite in="s" in2="SourceAlpha" operator="in" result="sp"/>
   <feComposite in="SourceGraphic" in2="sp" operator="arithmetic" k1="0" k2="1" k3=".5" k4="0"/>
  </filter>
  <filter id="${u}in" x="-20%" y="-20%" width="140%" height="140%" color-interpolation-filters="sRGB">
   <feGaussianBlur in="SourceAlpha" stdDeviation="1.6" result="b"/>
   <feOffset in="b" dx="2.2" dy="2.6" result="o1"/>
   <feComposite in="SourceAlpha" in2="o1" operator="arithmetic" k2="1" k3="-1" result="d1"/>
   <feFlood flood-color="#000" flood-opacity=".75"/><feComposite in2="d1" operator="in" result="sh"/>
   <feOffset in="b" dx="-1.6" dy="-1.8" result="o2"/>
   <feComposite in="SourceAlpha" in2="o2" operator="arithmetic" k2="1" k3="-1" result="d2"/>
   <feFlood flood-color="#fff" flood-opacity=".42"/><feComposite in2="d2" operator="in" result="hl"/>
   <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="sh"/><feMergeNode in="hl"/></feMerge>
  </filter>
  <clipPath id="${u}cb"><path d="${body}"/></clipPath>
  ${wedges.map((w, i) => `<clipPath id="${u}c${i}"><path d="${w.d}"/></clipPath>`).join('')}
  <g id="${u}body">
   <g filter="url(#${u}bev)">
    <path d="${outer}" fill="url(#${u}o)"/>
    <path d="${body}" fill="url(#${u}g)"/>
    <circle cx="1" cy="-.5" r="35" fill="url(#${u}p)" filter="url(#${u}in)"/>
   </g>
   <circle cx="1" cy="-.5" r="30.5" fill="none" stroke="${shade(color, -.45)}" stroke-width="1.1" stroke-dasharray="1.2 2.2" opacity=".75"/>
   <circle cx="1" cy="-.5" r="28" fill="none" stroke="${shade(color, .25)}" stroke-width=".5" opacity=".5"/>
   <text x="1" y="-.5" dy=".35em" text-anchor="middle" font-family="Fraunces, 'Iowan Old Style', Georgia, serif" font-weight="700" font-style="italic" font-size="38" fill="${shade(color, -.22)}" filter="url(#${u}in)">${L}</text>
   <g clip-path="url(#${u}cb)"><g class="gloss"><ellipse cx="-20" cy="-24" rx="26" ry="15" fill="url(#${u}s)" transform="rotate(-35 -20 -24)"/><ellipse cx="-27" cy="-30" rx="5" ry="2.6" fill="#fff" opacity=".7" transform="rotate(-35 -27 -30)"/></g></g>
  </g>
 </defs>
 <g class="shards">${wedges.map((w, i) => `<g class="shard"><use href="#${u}body" clip-path="url(#${u}c${i})"/></g>`).join('')}</g>
 <use class="whole" href="#${u}body"/>
 <g class="cracks" fill="none" stroke-linecap="round" stroke-linejoin="round">
  ${crackD.map(d => `<path d="${d}" pathLength="1" stroke="${shade(color, -.72)}" stroke-width="1.7" stroke-dasharray="1 1" stroke-dashoffset="1"/><path d="${d}" transform="translate(.9 .9)" pathLength="1" stroke="${hi}" stroke-width=".6" opacity=".7" stroke-dasharray="1 1" stroke-dashoffset="1"/>`).join('')}
 </g>
</svg>`;
    this.svg = this.host.firstElementChild;
    this.shards = [...this.svg.querySelectorAll('.shard')];
    this.whole = this.svg.querySelector('.whole');
    this.cracks = [...this.svg.querySelectorAll('.cracks path')];
    this.gloss = this.svg.querySelector('.gloss');
  }

  setGloss(x, y) { this.gloss.setAttribute('transform', `translate(${(x * 14).toFixed(2)} ${(y * 14).toFixed(2)})`); }

  /** 0..1 progressive crack while dragging. dir = drag direction in radians (cracks race toward it first). */
  setCrack(p, dir = null) {
    this.crack = p;
    this.whole.style.display = p > .015 ? 'none' : '';
    this.cracks.forEach((c, k) => {
      const i = k >> 1;
      let bias = 0;
      if (dir != null) { let d = Math.abs(this.lines[i].a - dir) % TAU; d = Math.min(d, TAU - d); bias = (1 - d / Math.PI) * .35; }
      const q = Math.max(0, Math.min(1, p * 1.35 + bias - .12 - i * .03));
      c.setAttribute('stroke-dashoffset', (1 - q).toFixed(3));
    });
    this.shards.forEach((s, i) => {
      const w = this.wedges[i], k = Math.max(0, p - .15) * 3.2;
      s.setAttribute('transform', `translate(${(Math.cos(w.mid) * k).toFixed(2)} ${(Math.sin(w.mid) * k).toFixed(2)})`);
      s.style.opacity = '';
    });
  }

  setBroken() {
    this.setCrack(1);
    this.shards.forEach((s, i) => {
      const w = this.wedges[i], k = 2.4 + (i % 3);
      s.setAttribute('transform', `translate(${(Math.cos(w.mid) * k).toFixed(2)} ${(Math.sin(w.mid) * k).toFixed(2)}) rotate(${(i % 2 ? 4 : -3)} ${w.cx} ${w.cy})`);
      s.style.opacity = i === 2 || i === 5 ? '0' : '1';
    });
    this.broken = true;
  }

  /** Shards burst outward then fall with gravity, spin and one bounce. Resolves when done. */
  shatter({ reduced = false } = {}) {
    this.setCrack(1);
    const floorY = 150;
    const parts = this.shards.map((s, i) => {
      const w = this.wedges[i], sp = 90 + Math.random() * 120;
      return { s, w, x: 0, y: 0, vx: Math.cos(w.mid) * sp + (Math.random() - .5) * 40, vy: Math.sin(w.mid) * sp - 120 - Math.random() * 90, r: 0, vr: (Math.random() - .5) * 720, bounced: false };
    });
    if (reduced) { this.shards.forEach(s => (s.style.opacity = '0')); this.cracks.forEach(c => (c.style.opacity = '0')); return Promise.resolve(); }
    const dur = 1.15;
    return new Promise(res => {
      let last = performance.now(), t = 0;
      const step = now => {
        const dt = Math.min(.05, (now - last) / 1000); last = now; t += dt;
        for (const p of parts) {
          p.vy += 980 * dt; p.vx *= 1 - .6 * dt;
          p.x += p.vx * dt; p.y += p.vy * dt; p.r += p.vr * dt;
          if (!p.bounced && p.y > floorY) { p.y = floorY; p.vy *= -.32; p.vr *= .5; p.bounced = true; }
          p.s.setAttribute('transform', `translate(${p.x.toFixed(1)} ${p.y.toFixed(1)}) rotate(${p.r.toFixed(1)} ${p.w.cx.toFixed(1)} ${p.w.cy.toFixed(1)})`);
          p.s.style.opacity = String(Math.max(0, Math.min(1, (dur - t) / .35)));
        }
        this.cracks.forEach(c => (c.style.opacity = String(Math.max(0, 1 - t * 6))));
        if (t < dur) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }

  /** Reform the seal (reverse of broken). */
  heal() {
    this.cracks.forEach(c => (c.style.opacity = ''));
    return new Promise(res => {
      const t0 = performance.now(), D = 700;
      const from = this.shards.map((s, i) => ({ w: this.wedges[i], k: 3 + (i % 3) + (this.broken ? 0 : 60), miss: i === 2 || i === 5 }));
      const step = now => {
        const t = Math.min(1, (now - t0) / D), e = 1 - (1 - t) ** 3;
        this.shards.forEach((s, i) => {
          const f = from[i], k = f.miss ? (1 - e) * 40 : f.k * (1 - e);
          s.setAttribute('transform', `translate(${(Math.cos(f.w.mid) * k).toFixed(2)} ${(Math.sin(f.w.mid) * k - (f.miss ? (1 - e) * 30 : 0)).toFixed(2)})`);
          s.style.opacity = f.miss ? String(e) : '1';
        });
        this.cracks.forEach(c => c.setAttribute('stroke-dashoffset', String(e)));
        if (t < 1) requestAnimationFrame(step);
        else { this.broken = false; this.crack = 0; this.whole.style.display = ''; res(); }
      };
      requestAnimationFrame(step);
    });
  }

  reset() {
    this.broken = false;
    this.cracks.forEach(c => { c.style.opacity = ''; });
    this.setCrack(0);
  }
}

export function sealSeed(letter, color) { return hashStr(letter + color); }
