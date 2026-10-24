// sim.js — 2D particle liquid: Clavet-style double-density relaxation on a spatial hash grid.
// Units: CSS px for positions, one "substep" (1/120 s) for time.

export class Fluid {
  constructor(max) {
    this.max = max;
    this.n = 0;
    const F = () => new Float32Array(max);
    this.x = F(); this.y = F(); this.px = F(); this.py = F(); this.vx = F(); this.vy = F();
    this.r = F(); this.g = F(); this.b = F();       // current color
    this.tr = F(); this.tg = F(); this.tb = F();    // "own" color the particle relaxes toward
    this.speed = F();
    this.cell = new Int32Array(max);
    this.sorted = new Int32Array(max);
    this.cellStart = new Int32Array(2);
    this.nbJ = new Int32Array(96); this.nbQ = new Float32Array(96);
    this.nbX = new Float32Array(96); this.nbY = new Float32Array(96);
    this.h = 14;
    this.W = 400; this.H = 600;           // world extent (may be a 2x "virtual" world while folding)
    this.wall = { on: false, axis: 0, pos: 0, gapC: 0, gapHalf: 0, thick: 4 };
    this.limit = Infinity;                // piston along wall axis (upper bound)
    this.k = 0.05; this.kNear = 0.16; this.rho0 = 2.4;
    this.visc = 0.25; this.viscB = 0.05;
    this.mix = 0.0035; this.selfRelax = 0.0012;
    this.crossings = 0;
  }

  setH(h) {
    this.h = h;
    // Rest density of a hex lattice with spacing h/2.3 (neighbors only).
    const s = h / 2.3;
    let rho = 0;
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      if (!i && !j) continue;
      const x = (i + (j & 1) * 0.5) * s, y = j * s * Math.sqrt(3) / 2;
      const q = 1 - Math.hypot(x, y) / h;
      if (q > 0) rho += q * q;
    }
    this.rho0 = rho;
  }

  add(x, y, vx, vy, r, g, b) {
    if (this.n >= this.max) return -1;
    const i = this.n++;
    this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y;
    this.vx[i] = vx; this.vy[i] = vy;
    this.r[i] = this.tr[i] = r; this.g[i] = this.tg[i] = g; this.b[i] = this.tb[i] = b;
    this.speed[i] = 0;
    return i;
  }

  /** Remove particle i by swapping with the last one. */
  remove(i) {
    const l = --this.n;
    if (i === l) return;
    for (const a of [this.x, this.y, this.px, this.py, this.vx, this.vy, this.r, this.g, this.b, this.tr, this.tg, this.tb, this.speed]) a[i] = a[l];
  }

  /** Drop a fraction of particles, spread uniformly. */
  thin(frac) {
    const target = Math.floor(this.n * (1 - frac));
    while (this.n > target) this.remove((Math.random() * this.n) | 0);
  }

  buildGrid() {
    const n = this.n, h = this.h, inv = 1 / h;
    const cols = Math.max(1, Math.ceil(this.W * inv) + 1), rows = Math.max(1, Math.ceil(this.H * inv) + 1);
    this.cols = cols; this.rows = rows;
    const nc = cols * rows;
    if (this.cellStart.length < nc + 1) this.cellStart = new Int32Array(nc + 1);
    const cs = this.cellStart; cs.fill(0, 0, nc + 1);
    const x = this.x, y = this.y, cell = this.cell;
    for (let i = 0; i < n; i++) {
      let cx = (x[i] * inv) | 0, cy = (y[i] * inv) | 0;
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
      const c = cy * cols + cx;
      cell[i] = c; cs[c + 1]++;
    }
    for (let c = 0; c < nc; c++) cs[c + 1] += cs[c];
    // Counting sort (use a cursor copy in the cell array's spare space).
    if (!this.cursor || this.cursor.length < nc) this.cursor = new Int32Array(nc);
    const cur = this.cursor; cur.set(cs.subarray(0, nc));
    const sorted = this.sorted;
    for (let i = 0; i < n; i++) sorted[cur[cell[i]]++] = i;
  }

  /**
   * One substep. g = gravity (px/substep^2). ptr = {x,y,vx,vy,active,radius} pointer stir.
   */
  step(gx, gy, ptr) {
    const n = this.n, h = this.h;
    const x = this.x, y = this.y, px = this.px, py = this.py, vx = this.vx, vy = this.vy;
    const maxV = 0.55 * h, maxV2 = maxV * maxV;
    const pr = ptr && ptr.active ? ptr.radius : 0, pr2 = pr * pr;
    for (let i = 0; i < n; i++) {
      let ux = vx[i] + gx, uy = vy[i] + gy;
      if (pr) {
        const dx = x[i] - ptr.x, dy = y[i] - ptr.y, d2 = dx * dx + dy * dy;
        if (d2 < pr2) {
          const d = Math.sqrt(d2) + 1e-4, f = 1 - d / pr;
          ux += (ptr.vx - ux) * 0.3 * f + dx / d * 0.09 * h * f * f;
          uy += (ptr.vy - uy) * 0.3 * f + dy / d * 0.09 * h * f * f;
        }
      }
      const v2 = ux * ux + uy * uy;
      if (v2 > maxV2) { const s = maxV / Math.sqrt(v2); ux *= s; uy *= s; }
      ux *= 0.9985; uy *= 0.9985;
      vx[i] = ux; vy[i] = uy;
      px[i] = x[i]; py[i] = y[i];
      x[i] += ux; y[i] += uy;
    }
    this.buildGrid();
    this.relax();
    this.collide();
    const sp = this.speed, invh = 1 / h;
    for (let i = 0; i < n; i++) {
      const ux = x[i] - px[i], uy = y[i] - py[i];
      vx[i] = ux; vy[i] = uy;
      const s = Math.sqrt(ux * ux + uy * uy) * invh;
      sp[i] += (s - sp[i]) * 0.25;
    }
  }

  relax() {
    const n = this.n, h = this.h, h2 = h * h, inv = 1 / h;
    const x = this.x, y = this.y, r = this.r, g = this.g, b = this.b;
    const tr = this.tr, tg = this.tg, tb = this.tb;
    const cs = this.cellStart, sorted = this.sorted, cols = this.cols, rows = this.rows;
    const nbJ = this.nbJ, nbQ = this.nbQ, nbX = this.nbX, nbY = this.nbY;
    const k = this.k, kN = this.kNear, rho0 = this.rho0, mix = this.mix, sr = this.selfRelax;
    const half = 0.5 * h, vx = this.vx, vy = this.vy, visc = this.visc, vb = this.viscB / h;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      let cx = (xi * inv) | 0, cy = (yi * inv) | 0;
      if (cx < 0) cx = 0; else if (cx >= cols) cx = cols - 1;
      if (cy < 0) cy = 0; else if (cy >= rows) cy = rows - 1;
      const x0 = cx > 0 ? cx - 1 : 0, x1 = cx < cols - 1 ? cx + 1 : cx;
      const y0 = cy > 0 ? cy - 1 : 0, y1 = cy < rows - 1 ? cy + 1 : cy;
      let cnt = 0, rho = 0, rhoN = 0;
      for (let yy = y0; yy <= y1; yy++) {
        const row = yy * cols;
        const s0 = cs[row + x0], s1 = cs[row + x1 + 1];
        for (let s = s0; s < s1; s++) {
          const j = sorted[s];
          if (j === i) continue;
          const dx = x[j] - xi, dy = y[j] - yi, d2 = dx * dx + dy * dy;
          if (d2 < h2) {
            const d = Math.sqrt(d2);
            if (d < 1e-5) continue;
            const q = 1 - d * inv;
            rho += q * q; rhoN += q * q * q;
            nbJ[cnt] = j; nbQ[cnt] = q; nbX[cnt] = dx / d; nbY[cnt] = dy / d;
            if (++cnt === 96) break;
          }
        }
        if (cnt === 96) break;
      }
      let P = k * (rho - rho0);
      if (P < -0.02) P = -0.02;
      const PN = kN * rhoN;
      let dxi = 0, dyi = 0;
      let ri = r[i], gi = g[i], bi = b[i];
      const vxi = vx[i], vyi = vy[i];
      for (let m = 0; m < cnt; m++) {
        const q = nbQ[m], j = nbJ[m];
        const D = (P * q + PN * q * q) * half;
        const ux = nbX[m] * D, uy = nbY[m] * D;
        x[j] += ux; y[j] += uy; dxi -= ux; dyi -= uy;
        if (visc) {
          const u = (vxi - vx[j]) * nbX[m] + (vyi - vy[j]) * nbY[m];
          if (u > 0) {
            const I = q * (visc * u + vb * u * u) * 0.5;
            const ix = nbX[m] * I, iy = nbY[m] * I;
            x[j] += ix; y[j] += iy; dxi -= ix; dyi -= iy;
          }
        }
        const mq = mix * q;
        ri += (r[j] - ri) * mq; gi += (g[j] - gi) * mq; bi += (b[j] - bi) * mq;
      }
      x[i] = xi + dxi; y[i] = yi + dyi;
      r[i] = ri + (tr[i] - ri) * sr; g[i] = gi + (tg[i] - gi) * sr; b[i] = bi + (tb[i] - bi) * sr;
    }
  }

  collide() {
    const n = this.n, h = this.h, rad = 0.32 * h;
    const x = this.x, y = this.y, px = this.px, py = this.py;
    const w = this.wall;
    const ax = w.axis ? y : x, qa = w.axis ? x : y, pax = w.axis ? py : px;
    const maxX = Math.min(this.W, w.axis === 0 ? this.limit : Infinity) - rad;
    const maxY = Math.min(this.H, w.axis === 1 ? this.limit : Infinity) - rad;
    const lo = w.pos - w.thick - rad, hi = w.pos + w.thick + rad;
    const open = w.gapHalf > rad * 1.5;
    const g0 = w.gapC - w.gapHalf + rad, g1 = w.gapC + w.gapHalf - rad;
    let cross = 0;
    for (let i = 0; i < n; i++) {
      // World box
      if (x[i] < rad) x[i] = rad + Math.random() * 0.01; else if (x[i] > maxX) x[i] = maxX - Math.random() * 0.01;
      if (y[i] < rad) y[i] = rad + Math.random() * 0.01; else if (y[i] > maxY) y[i] = maxY - Math.random() * 0.01;
      if (!w.on) continue;
      const a = ax[i], pa = pax[i];
      if (a > lo && a < hi) {
        const q = qa[i];
        const inGap = open && q > g0 && q < g1;
        if (!inGap) {
          const prevIn = pa > lo && pa < hi;
          if (prevIn && open) qa[i] = q < w.gapC ? g0 : g1;
          else ax[i] = pa < w.pos ? lo : hi;
        }
      }
      if ((pa < w.pos) !== (ax[i] < w.pos)) cross++;
    }
    this.crossings += cross;
  }
}
