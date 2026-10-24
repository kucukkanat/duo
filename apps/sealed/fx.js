// fx.js — paper confetti, hearts, petals, wax crumbs and fireworks on one overlay canvas (dt-based).
const HEART = new Path2D('M0 .32C-.08 .24-.52-.04-.52-.3C-.52-.56-.2-.66 0-.42C.2-.66 .52-.56 .52-.3C.52-.04 .08 .24 0 .32Z');

export class FX {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.p = [];
    this.running = false;
    this.resize();
    addEventListener('resize', () => this.resize());
  }
  resize() {
    this.dpr = Math.min(2, devicePixelRatio || 1);
    this.w = innerWidth; this.h = innerHeight;
    this.c.width = this.w * this.dpr; this.c.height = this.h * this.dpr;
  }
  add(p) { this.p.push(p); if (!this.running) { this.running = true; this.last = performance.now(); requestAnimationFrame(t => this.tick(t)); } }

  /** Paper confetti: flat bits that flip in 3D and flutter down. */
  confetti(x, y, { n = 80, colors = ['#E8577A', '#F5B942', '#5BC0BE', '#8E6BD8', '#fff'], spread = Math.PI * 2, dir = -Math.PI / 2, speed = 520, shape = null } = {}) {
    for (let i = 0; i < n; i++) {
      const a = dir + (Math.random() - .5) * spread, s = speed * (.35 + Math.random() * .75);
      this.add({
        kind: shape || (Math.random() < .7 ? 'rect' : 'disc'), x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        w: 5 + Math.random() * 6, h: 3 + Math.random() * 4, rot: Math.random() * 6.3, vr: (Math.random() - .5) * 12,
        flip: Math.random() * 6.3, vf: 4 + Math.random() * 10, color: colors[(Math.random() * colors.length) | 0],
        life: 0, max: 2.6 + Math.random() * 1.6, drag: 1.8, g: 520,
      });
    }
  }
  hearts(x, y, n = 18, colors = ['#D7263D', '#F25C6E', '#FF8FA0', '#FFD0D7']) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 1.8, s = 120 + Math.random() * 260;
      this.add({ kind: 'heart', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: 10 + Math.random() * 14, rot: (Math.random() - .5) * .6, vr: (Math.random() - .5) * 2,
        flip: 0, vf: 3 + Math.random() * 3, color: colors[(Math.random() * colors.length) | 0], life: 0, max: 2.2 + Math.random(), drag: 2.2, g: -60 });
    }
  }
  petals(x, y, n = 16, colors = ['#E07A5F', '#F4A3B5', '#F2CC5B', '#FFFAF0', '#B49FDC']) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 2.4, s = 80 + Math.random() * 220;
      this.add({ kind: 'petal', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: 7 + Math.random() * 6, h: 4, rot: Math.random() * 6, vr: (Math.random() - .5) * 6,
        flip: Math.random() * 6, vf: 3 + Math.random() * 5, color: colors[(Math.random() * colors.length) | 0], life: 0, max: 3 + Math.random(), drag: 2.4, g: 160 });
    }
  }
  crumbs(x, y, color, n = 26) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.3, s = 80 + Math.random() * 260;
      this.add({ kind: 'crumb', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, w: 2 + Math.random() * 4, rot: Math.random() * 6, vr: (Math.random() - .5) * 20,
        flip: 0, vf: 0, color, life: 0, max: 1.1 + Math.random() * .6, drag: .6, g: 1100 });
    }
  }
  sparkles(x, y, n = 20, color = '#FFE9A8') {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * 6.3, s = 40 + Math.random() * 200;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: 1.5 + Math.random() * 2.5, color, life: 0, max: .8 + Math.random() * .8, drag: 2.5, g: 40, px: x, py: y });
    }
  }
  firework(x, y, color) {
    const n = 46, base = Math.random() * 6.3;
    for (let i = 0; i < n; i++) {
      const a = base + (i / n) * 6.283, s = 150 + Math.random() * 40;
      this.add({ kind: 'spark', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: 2, color, life: 0, max: 1.3 + Math.random() * .4, drag: 1.4, g: 90, px: x, py: y });
    }
  }
  emoji(x, y, ch, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - .5) * 2.2, s = 140 + Math.random() * 260;
      this.add({ kind: 'emoji', ch, x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, w: 16 + Math.random() * 14, rot: (Math.random() - .5), vr: (Math.random() - .5) * 6,
        flip: 0, vf: 0, life: 0, max: 1.6 + Math.random() * .6, drag: 1.2, g: 700 });
    }
  }

  tick(now) {
    const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    this.p = this.p.filter(p => p.life < p.max && p.y < this.h + 60);
    for (const p of this.p) {
      p.life += dt;
      p.vx *= 1 - p.drag * dt; p.vy *= 1 - p.drag * dt;
      p.vy += p.g * dt;
      if (p.kind === 'rect' || p.kind === 'petal') p.vx += Math.sin(p.life * 5 + p.flip) * 40 * dt; // flutter
      p.px = p.x; p.py = p.y;
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.rot += (p.vr || 0) * dt; p.flip += p.vf * dt;
      const fade = Math.min(1, (p.max - p.life) / .5);
      g.globalAlpha = Math.max(0, fade);
      if (p.kind === 'spark') {
        g.strokeStyle = p.color; g.lineWidth = p.w; g.lineCap = 'round';
        g.shadowColor = p.color; g.shadowBlur = 8;
        g.beginPath(); g.moveTo(p.x - p.vx * .04, p.y - p.vy * .04); g.lineTo(p.x, p.y); g.stroke();
        g.shadowBlur = 0;
        continue;
      }
      g.save();
      g.translate(p.x, p.y); g.rotate(p.rot);
      const sy = Math.cos(p.flip);
      if (p.kind === 'rect') {
        g.scale(1, sy);
        g.fillStyle = p.color; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        g.fillStyle = sy < 0 ? 'rgba(0,0,0,.18)' : 'rgba(255,255,255,.12)'; g.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      } else if (p.kind === 'disc') {
        g.scale(1, sy); g.fillStyle = p.color; g.beginPath(); g.arc(0, 0, p.w / 2, 0, 6.283); g.fill();
      } else if (p.kind === 'petal') {
        g.scale(1, .5 + .5 * Math.abs(sy)); g.fillStyle = p.color; g.beginPath(); g.ellipse(0, 0, p.w / 2, p.h / 2 + 1, 0, 0, 6.283); g.fill();
      } else if (p.kind === 'heart') {
        g.scale(p.w * (.8 + .2 * Math.abs(Math.cos(p.flip))), p.w); g.fillStyle = p.color; g.fill(HEART);
      } else if (p.kind === 'crumb') {
        g.fillStyle = p.color; g.beginPath(); g.moveTo(-p.w, -p.w * .4); g.lineTo(p.w * .6, -p.w * .7); g.lineTo(p.w * .8, p.w * .5); g.lineTo(-p.w * .3, p.w * .8); g.fill();
      } else if (p.kind === 'emoji') {
        g.font = `${p.w}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
        g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(p.ch, 0, 0);
      }
      g.restore();
    }
    g.globalAlpha = 1;
    if (this.p.length) requestAnimationFrame(t => this.tick(t));
    else { this.running = false; g.clearRect(0, 0, this.w, this.h); }
  }
}
