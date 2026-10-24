// art.js — themes, palettes and the cut-paper pop-up layers (inline SVG strings).

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hashStr(s) { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; }

/** Mix a hex color toward black (amt<0) or white (amt>0). */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, p = Math.abs(amt);
  r = Math.round(r + (t - r) * p); g = Math.round(g + (t - g) * p); b = Math.round(b + (t - b) * p);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Cut-paper primitive: flat fill + darker coloured edge band.
const ed = (fill, w = 1.3) => `fill="${fill}" stroke="${shade(fill, -0.28)}" stroke-width="${w}" stroke-linejoin="round"`;
const svg = (w, h, body, defs = '') =>
  `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMax meet" xmlns="http://www.w3.org/2000/svg">${defs ? `<defs>${defs}</defs>` : ''}${body}</svg>`;
const heartD = 'M0 .32C-.08 .24-.52-.04-.52-.3C-.52-.56-.2-.66 0-.42C.2-.66 .52-.56 .52-.3C.52-.04 .08 .24 0 .32Z';
const heart = (cx, cy, s, fill, rot = 0, cls = '') =>
  `<path class="${cls}" ${ed(fill, 1.3 / s)} transform="translate(${cx} ${cy}) rotate(${rot}) scale(${s})" d="${heartD}"/>`;
const star = (cx, cy, r, fill, pts = 5, inner = 0.45, rot = -90) => {
  let d = '';
  for (let i = 0; i < pts * 2; i++) {
    const a = (rot + (i * 180) / pts) * Math.PI / 180, rr = i % 2 ? r * inner : r;
    d += (i ? 'L' : 'M') + (cx + Math.cos(a) * rr).toFixed(1) + ' ' + (cy + Math.sin(a) * rr).toFixed(1);
  }
  return `<path ${ed(fill)} d="${d}Z"/>`;
};
const sparkle = (cx, cy, r, fill, cls = '') =>
  `<path class="${cls}" fill="${fill}" d="M${cx} ${cy - r}Q${cx + r * .18} ${cy - r * .18} ${cx + r} ${cy}Q${cx + r * .18} ${cy + r * .18} ${cx} ${cy + r}Q${cx - r * .18} ${cy + r * .18} ${cx - r} ${cy}Q${cx - r * .18} ${cy - r * .18} ${cx} ${cy - r}Z"/>`;

// ───────────────────────── Birthday
function bunting() {
  const P0 = [8, 12], P1 = [100, 58], P2 = [192, 12];
  const B = t => [0, 1].map(k => (1 - t) ** 2 * P0[k] + 2 * (1 - t) * t * P1[k] + t * t * P2[k]);
  const cols = ['#E8577A', '#F5B942', '#5BC0BE', '#8E6BD8', '#F28C5B'];
  let flags = '';
  for (let i = 0; i < 11; i++) {
    const t = 0.07 + i * 0.086, [x, y] = B(t), [x2, y2] = B(t + 0.01);
    const a = Math.atan2(y2 - y, x2 - x) * 180 / Math.PI;
    flags += `<path ${ed(cols[i % 5])} transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${a.toFixed(1)})" d="M-7.5 0H7.5L0 17Z"/>`;
  }
  return svg(200, 86, `
    <rect x="5.5" y="9" width="4" height="77" rx="2" ${ed('#B07A55')}/>
    <rect x="190.5" y="9" width="4" height="77" rx="2" ${ed('#B07A55')}/>
    <circle cx="7.5" cy="8" r="4" ${ed('#F5B942')}/><circle cx="192.5" cy="8" r="4" ${ed('#F5B942')}/>
    <path d="M8 12Q100 58 192 12" fill="none" stroke="#7A4E3A" stroke-width="1.2"/>${flags}`);
}
function balloons() {
  const b = (cx, cy, r, c, bx) => `
    <path d="M${cx} ${cy + r * 1.2}C${cx - 6} ${cy + r * 1.2 + 25} ${bx + 8} 96 ${bx} 132" fill="none" stroke="#9C8A80" stroke-width=".9"/>
    <ellipse cx="${cx}" cy="${cy}" rx="${r}" ry="${r * 1.18}" ${ed(c)}/>
    <ellipse cx="${cx - r * .38}" cy="${cy - r * .45}" rx="${r * .22}" ry="${r * .34}" fill="#fff" opacity=".45" transform="rotate(-25 ${cx - r * .38} ${cy - r * .45})"/>
    <path d="M${cx - 3} ${cy + r * 1.2 + 4}L${cx} ${cy + r * 1.16}L${cx + 3} ${cy + r * 1.2 + 4}Z" ${ed(c, .8)}/>`;
  return svg(200, 132, b(26, 34, 17, '#E8577A', 38) + b(52, 60, 15, '#5BC0BE', 40) + b(17, 82, 13, '#F5B942', 36) +
    b(174, 30, 17, '#8E6BD8', 160) + b(150, 58, 15, '#F5B942', 162) + b(184, 80, 13, '#E8577A', 164));
}
function drips(x0, x1, y, fill, seed) {
  const r = rng(seed);
  let d = `M${x0} ${y - 4}H${x1}V${y + 4}`;
  let x = x1;
  while (x > x0 + 6) {
    const w = 7 + r() * 8, h = 4 + r() * 12;
    d += `Q${x - w / 2 + 2} ${y + 4} ${x - w / 2} ${y + 4 + h}Q${x - w / 2 - 3} ${y + 7 + h} ${x - w} ${y + 4}`;
    x -= w;
  }
  return `<path ${ed(fill)} d="${d}V${y - 4}Z"/>`;
}
function cake() {
  const r = rng(7);
  let sprinkles = '';
  const sc = ['#E8577A', '#5BC0BE', '#F5B942', '#8E6BD8'];
  for (let i = 0; i < 22; i++)
    sprinkles += `<rect x="${52 + r() * 96}" y="${80 + r() * 24}" width="5" height="1.8" rx=".9" fill="${sc[i % 4]}" transform="rotate(${r() * 180} ${100} ${92})"/>`;
  sprinkles = '';
  for (let i = 0; i < 18; i++) {
    const x = 52 + r() * 96, y = 82 + r() * 22;
    sprinkles += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="5" height="1.8" rx=".9" fill="${sc[i % 4]}" transform="rotate(${(r() * 180).toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
  }
  let candles = '';
  [62, 81, 100, 119, 138].forEach((x, i) => {
    candles += `<g class="candle" data-i="${i}">
      <rect x="${x - 3}" y="34" width="6" height="32" rx="1.5" ${ed('#FFF9F2', 1)}/>
      <path d="M${x - 3} 40l6 -4M${x - 3} 48l6 -4M${x - 3} 56l6 -4M${x - 3} 64l6 -4" stroke="${sc[i % 4]}" stroke-width="2"/>
      <path d="M${x} 34v-4" stroke="#3a2a22" stroke-width="1.2"/>
      <g class="flame"><circle cx="${x}" cy="22" r="10" fill="#FFD36B" opacity=".28"/>
        <path d="M${x} 9Q${x + 6.5} 21 ${x} 30Q${x - 6.5} 21 ${x} 9Z" fill="#FF9E2C"/>
        <path d="M${x} 16Q${x + 3} 24 ${x} 29Q${x - 3} 24 ${x} 16Z" fill="#FFF3B0"/></g>
      <g class="smoke" opacity="0"><path d="M${x} 28c-4-6 4-8 0-14s4-8 0-12" fill="none" stroke="#bbb" stroke-width="1.6" stroke-linecap="round"/></g>
    </g>`;
  });
  return svg(200, 176, `
    <ellipse cx="100" cy="167" rx="94" ry="8" ${ed('#FFFFFF')}/>
    <rect x="22" y="108" width="156" height="58" rx="5" ${ed('#F4A6B8')}/>
    <rect x="150" y="108" width="28" height="58" rx="5" fill="#000" opacity=".06"/>
    ${[34, 52, 70, 88, 106, 124, 142, 160].map(x => `<circle cx="${x}" cy="140" r="3" fill="#FFF4EC"/>`).join('')}
    <path d="M22 156H178" stroke="#E8577A" stroke-width="3"/>
    ${drips(22, 178, 110, '#FFF8F0', 3)}
    <rect x="46" y="66" width="108" height="44" rx="5" ${ed('#FFF2DC')}/>
    <rect x="132" y="66" width="22" height="44" rx="5" fill="#000" opacity=".05"/>
    ${sprinkles}
    ${drips(46, 154, 68, '#E8577A', 9)}
    ${candles}`);
}
function gifts() {
  const g = (x, y, w, h, c, rib) => `
    <rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" ${ed(c)}/>
    <rect x="${x - 3}" y="${y - 8}" width="${w + 6}" height="10" rx="2" ${ed(shade(c, -.08))}/>
    <rect x="${x + w / 2 - 3}" y="${y - 8}" width="6" height="${h + 8}" fill="${rib}"/>
    <path d="M${x + w / 2} ${y - 8}c-12 -12 -16 2 0 0c16 2 12 -12 0 0Z" ${ed(rib)}/>`;
  return svg(200, 66, g(8, 26, 36, 40, '#5BC0BE', '#F5B942') + g(160, 34, 30, 32, '#8E6BD8', '#FFF4EC'));
}

// ───────────────────────── Love
function bigHeart() {
  return svg(200, 194, `
    <rect x="92" y="150" width="16" height="44" rx="2" ${ed('#B51C33')}/>
    ${heart(100, 120, 172, '#C81D3A', 0, 'beat')}${heart(100, 113, 130, '#EF4B63')}${heart(100, 106, 90, '#FF8FA0')}${heart(100, 99, 50, '#FFD0D7')}
`);
}
function sideHearts() {
  const leaf = (x, y, r) => `<ellipse cx="${x}" cy="${y}" rx="7" ry="3" ${ed('#5AA469', .8)} transform="rotate(${r} ${x} ${y})"/>`;
  return svg(200, 124, `
    <path d="M34 66Q30 94 40 124" fill="none" stroke="#2F7A4A" stroke-width="3"/>${leaf(28, 96, -30)}${leaf(42, 104, 30)}
    <path d="M166 54Q172 90 160 124" fill="none" stroke="#2F7A4A" stroke-width="3"/>${leaf(172, 88, 30)}${leaf(160, 100, -30)}
    <path d="M14 98V124" stroke="#2F7A4A" stroke-width="2"/>
    ${heart(34, 52, 50, '#EF4B63', -12)}${heart(166, 42, 46, '#FF8FA0', 10)}${heart(14, 92, 20, '#C81D3A', -8)}${heart(188, 92, 16, '#EF4B63', 8)}`);
}
function grassHearts() {
  let d = 'M0 60V44';
  for (let x = 0; x < 200; x += 10) d += `Q${x + 5} ${34 + (x % 20 ? 4 : 0)} ${x + 10} 44`;
  const s = (x, h, c, sz) => `<path d="M${x} 60V${60 - h}" stroke="#2F7A4A" stroke-width="1.6"/>${heart(x, 60 - h - 4, sz, c)}`;
  return svg(200, 60, s(26, 30, '#D7263D', 14) + s(60, 20, '#FF8FA0', 11) + s(142, 26, '#EF4B63', 13) + s(176, 18, '#D7263D', 10) +
    `<path ${ed('#5AA469')} d="${d}V60Z"/>`);
}

// ───────────────────────── Congrats
function burst() {
  let rays = '';
  const n = 22;
  for (let i = 0; i < n; i++) {
    const a1 = Math.PI + (i / n) * Math.PI, a2 = Math.PI + ((i + 1) / n) * Math.PI, R = i % 2 ? 92 : 100;
    rays += `<path fill="${i % 2 ? '#FFE7A0' : '#F3C13F'}" d="M100 104L${(100 + Math.cos(a1) * R).toFixed(1)} ${(104 + Math.sin(a1) * R).toFixed(1)}L${(100 + Math.cos(a2) * R).toFixed(1)} ${(104 + Math.sin(a2) * R).toFixed(1)}Z"/>`;
  }
  return svg(200, 104, `<g stroke="#D9A21E" stroke-width=".6">${rays}</g><path d="M30 104A70 70 0 0 1 170 104Z" fill="#1F2A44" opacity=".9"/>
    <path d="M44 104A56 56 0 0 1 156 104Z" fill="none" stroke="#D4A017" stroke-width="1.4" stroke-dasharray="2 3"/>
    ${star(70, 86, 5, '#F3C13F')}${star(100, 64, 7, '#F3C13F')}${star(130, 86, 5, '#F3C13F')}`);
}
function trophy() {
  return svg(100, 152, `
    <rect x="22" y="130" width="56" height="20" rx="3" ${ed('#5A3D18')}/>
    <rect x="36" y="135" width="28" height="9" rx="1.5" fill="url(#gold)" stroke="#9C6F00" stroke-width=".8"/>
    <path d="M42 104H58L62 130H38Z" fill="url(#gold)" stroke="#9C6F00" stroke-width="1.2"/>
    <path d="M19 32Q2 30 5 48Q8 64 26 66" fill="none" stroke="#C9971A" stroke-width="6" stroke-linecap="round"/>
    <path d="M81 32Q98 30 95 48Q92 64 74 66" fill="none" stroke="#C9971A" stroke-width="6" stroke-linecap="round"/>
    <path d="M16 18H84V36Q84 88 50 104Q16 88 16 36Z" fill="url(#gold)" stroke="#9C6F00" stroke-width="1.4"/>
    <path d="M26 22V40Q26 70 40 88" fill="none" stroke="#FFF6D0" stroke-width="4" stroke-linecap="round" opacity=".55"/>
    ${star(52, 52, 13, '#FFF6D0')}`,
    `<linearGradient id="gold" x1="0" x2="1"><stop offset="0" stop-color="#9C6F00"/><stop offset=".35" stop-color="#FFD75E"/><stop offset=".6" stop-color="#E0AE2A"/><stop offset="1" stop-color="#8A6100"/></linearGradient>`);
}
function starSticks() {
  const s = (x, h, c, r) => `<path d="M${x} 76V${76 - h}" stroke="#7A5A2A" stroke-width="1.6"/>${star(x, 76 - h, r, c)}`;
  return svg(200, 76, s(18, 50, '#F3C13F', 12) + s(44, 28, '#E8577A', 9) + s(158, 34, '#5BC0BE', 10) + s(184, 56, '#F3C13F', 13) +
    `<path d="M60 76Q100 60 140 76" fill="none" stroke="#C9971A" stroke-width="1"/>`);
}

// ───────────────────────── Party
function skyline(seed, h, base, winOn, winOff, minH, maxH, winColors) {
  const r = rng(seed);
  let x = -2, body = '';
  while (x < 200) {
    const w = 14 + r() * 16, bh = minH + r() * (maxH - minH);
    body += `<rect x="${x.toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${w.toFixed(1)}" height="${bh.toFixed(1)}" ${ed(base, .8)}/>`;
    if (r() < .25) body += `<rect x="${(x + w / 2 - .6).toFixed(1)}" y="${(h - bh - 10).toFixed(1)}" width="1.2" height="10" fill="${base}"/>`;
    for (let wy = h - bh + 6; wy < h - 6; wy += 7)
      for (let wx = x + 3; wx < x + w - 5; wx += 5.5) {
        const on = r() < winOn;
        body += `<rect class="${on && r() < .2 ? 'blink' : ''}" x="${wx.toFixed(1)}" y="${wy.toFixed(1)}" width="2.8" height="3.6" fill="${on ? winColors[(r() * winColors.length) | 0] : winOff}"/>`;
      }
    x += w + 1 + r() * 2;
  }
  return svg(200, h, body);
}
function marquee() {
  let bulbs = '';
  let k = 0;
  for (let x = 26; x <= 174; x += 9.25) { bulbs += `<circle class="bulb b${k++ % 2}" cx="${x}" cy="13" r="2.6"/><circle class="bulb b${k % 2}" cx="${x}" cy="59" r="2.6"/>`; }
  for (let y = 22; y <= 50; y += 9.3) { bulbs += `<circle class="bulb b${k++ % 2}" cx="25" cy="${y}" r="2.6"/><circle class="bulb b${k % 2}" cx="175" cy="${y}" r="2.6"/>`; }
  return svg(200, 100, `
    <rect x="44" y="60" width="5" height="40" ${ed('#2A1C49')}/><rect x="151" y="60" width="5" height="40" ${ed('#2A1C49')}/>
    <rect x="18" y="6" width="164" height="60" rx="9" ${ed('#FF4FD8')}/>
    <rect x="30" y="18" width="140" height="36" rx="5" fill="#1A0F33"/>
    <text x="100" y="46" text-anchor="middle" font-family="Fraunces, Georgia, serif" font-weight="900" font-size="25" letter-spacing="5" fill="#3EF0FF" class="neon">PARTY</text>
    ${bulbs}`);
}

// ───────────────────────── Thank you
function leaves() {
  let s = '';
  const cols = ['#6A9A5B', '#86B36E', '#4F7D45', '#9CC48A'];
  for (let a = -78, i = 0; a <= 78; a += 13, i++)
    s += `<g transform="translate(100 150) rotate(${a})"><path ${ed(cols[i % 4])} d="M0 -14C16 -40 14 -96 0 -130C-14 -96 -16 -40 0 -14Z"/><path d="M0 -18V-122" stroke="${shade(cols[i % 4], -.3)}" stroke-width=".9"/></g>`;
  return svg(200, 150, s);
}
function flower(cx, cy, r, c, center = '#F6C945') {
  let p = '';
  for (let i = 0; i < 6; i++) p += `<ellipse cx="${cx}" cy="${cy - r * .62}" rx="${r * .42}" ry="${r * .66}" ${ed(c, 1)} transform="rotate(${i * 60} ${cx} ${cy})"/>`;
  return `<g class="bloom">${p}<circle cx="${cx}" cy="${cy}" r="${r * .34}" ${ed(center, 1)}/></g>`;
}
function bouquet() {
  const fl = [[66, 64, 18, '#E07A5F'], [100, 40, 20, '#F2CC5B', '#B5651D'], [134, 62, 18, '#F4A3B5'], [82, 96, 15, '#FFFAF0'], [120, 96, 15, '#F2A07B'], [100, 74, 15, '#B49FDC']];
  const stems = fl.map(f => `<path d="M100 172Q${(f[0] + 100) / 2} ${(f[1] + 172) / 2 + 10} ${f[0]} ${f[1]}" fill="none" stroke="#3F6B35" stroke-width="2.4"/>`).join('');
  const lf = (x, y, r) => `<ellipse cx="${x}" cy="${y}" rx="12" ry="4.5" ${ed('#6A9A5B', .9)} transform="rotate(${r} ${x} ${y})"/>`;
  return svg(200, 176, stems + lf(70, 116, -35) + lf(130, 114, 35) + lf(58, 92, -60) + fl.map(f => flower(...f)).join('') + `
    <path ${ed('#C9A27A')} d="M58 120H142L114 176H86Z"/><path d="M58 120L86 176" stroke="#A88158" stroke-width="1"/>
    <path d="M100 140c-16-14-20 4 0 0c20 4 16-14 0 0Z" ${ed('#E07A5F')}/><path d="M100 140l-8 18M100 140l8 18" stroke="#E07A5F" stroke-width="3" stroke-linecap="round"/>`);
}
function pots() {
  const pot = (x, c) => `
    <path ${ed('#4F7D45')} d="M${x + 17} 40C${x + 4} 30 ${x + 2} 14 ${x + 8} 6C${x + 14} 16 ${x + 18} 28 ${x + 17} 40Z"/>
    <path ${ed('#6A9A5B')} d="M${x + 17} 40C${x + 30} 30 ${x + 34} 18 ${x + 28} 10C${x + 20} 20 ${x + 16} 30 ${x + 17} 40Z"/>
    ${flower(x + 8, 8, 6, c)}
    <path ${ed('#C96F4A')} d="M${x} 38H${x + 34}L${x + 30} 62H${x + 4}Z"/><rect x="${x - 2}" y="36" width="38" height="6" rx="1" ${ed('#D98760')}/>`;
  return svg(200, 62, pot(6, '#F4A3B5') + pot(160, '#F2CC5B'));
}

// ───────────────────────── Secret
function night() {
  const r = rng(42);
  let stars = '';
  for (let i = 0; i < 16; i++) stars += sparkle(+(10 + r() * 180).toFixed(1), +(8 + r() * 70).toFixed(1), 1.5 + r() * 3, '#FFE9A8', 'twinkle');
  return svg(200, 152, `
    ${stars}
    <path mask="url(#moon)" ${ed('#F6E7B0')} d="M150 18a20 20 0 1 0 0.01 0Z"/>
    <path ${ed('#24335E')} d="M0 152V112L28 82L52 104L88 58L118 98L146 70L174 94L200 82V152Z"/>
    <path fill="#EDF1FF" opacity=".75" d="M88 58L80 68L86 66L90 70L96 66Z"/><path fill="#EDF1FF" opacity=".75" d="M146 70L140 77L146 76L152 76Z"/>`,
    `<mask id="moon"><rect width="200" height="152" fill="#fff"/><circle cx="160" cy="31" r="18" fill="#000"/></mask>`);
}
function door() {
  return svg(100, 152, `
    <rect x="4" y="142" width="92" height="10" rx="1" ${ed('#2A2250')}/>
    <path ${ed('#3A2F6B')} d="M12 144V60A38 38 0 0 1 88 60V144Z"/>
    <path ${ed('#4A3D85')} d="M22 144V64A28 28 0 0 1 78 64V144Z"/>
    <path d="M50 36V144" stroke="#3A2F6B" stroke-width="1.2"/>
    <circle class="glow" cx="50" cy="96" r="22" fill="#FFD36B" opacity=".22"/>
    <g class="keyhole"><circle cx="50" cy="90" r="7.5" fill="#FFD36B"/><path d="M45.5 92H54.5L57.5 114H42.5Z" fill="#FFD36B"/></g>
    ${sparkle(14, 30, 4, '#FFE9A8', 'twinkle')}${sparkle(88, 22, 3, '#FFE9A8', 'twinkle')}`);
}
function bushes() {
  const r = rng(5);
  let b = '';
  for (let x = 4; x < 200; x += 15 + r() * 10) b += `<circle cx="${x.toFixed(1)}" cy="${(48 - r() * 18).toFixed(1)}" r="${(10 + r() * 10).toFixed(1)}" ${ed(r() < .5 ? '#0C1530' : '#16244F')}/>`;
  return svg(200, 56, b + `<rect y="46" width="200" height="10" fill="#0C1530"/>`);
}

// ───────────────────────── Theme table
// Layer: x (center %), w (width in u), d (depth row 0..3), ar is derived from viewBox.
export const THEMES = {
  b: {
    name: 'Birthday', icon: '🎂', font: 'serif',
    pal: { wall: '#FBEADF', floor: '#F6DCCB', ink: '#5E2338', accent: '#E8577A', env: '#F1E3CF', liner: '#FFF4EC', linerInk: '#E8577A', table: '#2A1A1E' },
    liner: 'stripes',
    h: 'Happy Birthday!', m: 'Another lap around the sun. Make a wish, then blow out every candle.',
    layers: () => [
      { svg: bunting(), x: 50, w: 96, d: 0 },
      { svg: balloons(), x: 50, w: 84, d: 0 },
      { svg: cake(), x: 50, w: 54, d: 1, tap: 'candles' },
      { svg: gifts(), x: 50, w: 92, d: 2 },
    ],
  },
  l: {
    name: 'Love', icon: '💌', font: 'serif',
    pal: { wall: '#FCE6E8', floor: '#F7D3D8', ink: '#6E1229', accent: '#D7263D', env: '#F4E0DE', liner: '#FFF1F2', linerInk: '#F25C6E', table: '#2B1219' },
    liner: 'hearts',
    h: 'You have my heart', m: 'Every ordinary day is better with you in it. This is your reminder.',
    layers: () => [
      { svg: bigHeart(), x: 50, w: 56, d: 0, tap: 'heart' },
      { svg: sideHearts(), x: 50, w: 86, d: 1, tap: 'heart' },
      { svg: grassHearts(), x: 50, w: 96, d: 2 },
    ],
  },
  c: {
    name: 'Congrats', icon: '🏆', font: 'serif',
    pal: { wall: '#FFF6E2', floor: '#F4E5C0', ink: '#4A3200', accent: '#C9971A', env: '#F2E9D3', liner: '#1F2A44', linerInk: '#D4A017', table: '#1B1A22' },
    liner: 'foil',
    h: 'You did it!', m: 'All that hard work, all those late nights. Take a bow. You earned every bit of this.',
    layers: () => [
      { svg: burst(), x: 50, w: 92, d: 0 },
      { svg: trophy(), x: 50, w: 30, d: 1, tap: 'confetti' },
      { svg: starSticks(), x: 50, w: 96, d: 2, tap: 'confetti' },
    ],
  },
  p: {
    name: 'Party invite', icon: '🪩', font: 'display',
    pal: { wall: '#1A0F33', floor: '#22143F', ink: '#FBEFFF', accent: '#FF4FD8', env: '#2A1C49', liner: '#1A0F33', linerInk: '#3EF0FF', table: '#0B0716' },
    liner: 'neon', dark: true,
    h: "You're invited!", m: 'Saturday, 9pm till late. Dress code: sparkle. Bring your best moves.',
    layers: () => [
      { svg: skyline(11, 112, '#3A2A6E', .35, '#2A1D55', 46, 108, ['#FFD36B', '#FFE9A8']), x: 50, w: 100, d: 0, tap: 'firework' },
      { svg: skyline(23, 96, '#170C33', .3, '#120828', 26, 86, ['#FF4FD8', '#3EF0FF', '#FFD36B']), x: 50, w: 100, d: 1, tap: 'firework' },
      { svg: marquee(), x: 50, w: 54, d: 2, tap: 'firework' },
    ],
  },
  t: {
    name: 'Thank you', icon: '💐', font: 'serif',
    pal: { wall: '#EDF2E4', floor: '#E0E9D2', ink: '#284425', accent: '#E07A5F', env: '#EEE8DA', liner: '#F7F3EA', linerInk: '#6A9A5B', table: '#17201A' },
    liner: 'botanical',
    h: 'Thank you', m: 'For showing up, for the kindness, for all the little things you never had to do.',
    layers: () => [
      { svg: leaves(), x: 50, w: 68, d: 0 },
      { svg: bouquet(), x: 50, w: 56, d: 1, tap: 'petals' },
      { svg: pots(), x: 50, w: 96, d: 2, tap: 'petals' },
    ],
  },
  s: {
    name: 'Secret', icon: '🗝️', font: 'serif',
    pal: { wall: '#0E1931', floor: '#13213F', ink: '#ECE6FF', accent: '#B9A4FF', env: '#1C2440', liner: '#0E1931', linerInk: '#FFD36B', table: '#06080F' },
    liner: 'stars', dark: true,
    h: 'Just between us', m: "Some things are only for you. Read this once, smile, and keep it in your pocket.",
    layers: () => [
      { svg: night(), x: 50, w: 76, d: 0 },
      { svg: door(), x: 50, w: 30, d: 1, tap: 'keyhole' },
      { svg: bushes(), x: 50, w: 100, d: 2 },
    ],
  },
};
export const THEME_KEYS = Object.keys(THEMES);

export const SEAL_COLORS = [
  { name: 'Crimson', c: '#9E1B22' },
  { name: 'Gold', c: '#B8862B' },
  { name: 'Navy', c: '#1F3A68' },
  { name: 'Forest', c: '#2F5D3A' },
  { name: 'Plum', c: '#5B2A5E' },
  { name: 'Onyx', c: '#26252B' },
];

export const EMOJI = ['🎂', '🎈', '🎉', '🎁', '🥳', '💖', '💌', '🌹', '😘', '🏆', '⭐', '🍾', '🥂', '🪩', '🎶', '🌙', '🔮', '🗝️', '🌸', '🌻', '🍀', '🐶', '🐱', '🦄', '🔥', '✨', '🍕', '☕'];

/** Envelope liner pattern as a CSS background (data-URI SVG). */
export function linerCSS(t) {
  const { liner: bg, linerInk: ink } = THEMES[t].pal;
  const e = s => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
  const tile = {
    stripes: `<svg xmlns='http://www.w3.org/2000/svg' width='24' height='24'><rect width='24' height='24' fill='${bg}'/><path d='M-6 30L30 -6M-18 18L18 -18M6 42L42 6' stroke='${ink}' stroke-width='5' opacity='.85'/></svg>`,
    hearts: `<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><rect width='28' height='28' fill='${bg}'/><path transform='translate(7 8) scale(9)' fill='${ink}' d='${heartD}'/><path transform='translate(21 22) scale(7)' fill='${ink}' opacity='.6' d='${heartD}'/></svg>`,
    foil: `<svg xmlns='http://www.w3.org/2000/svg' width='30' height='30'><rect width='30' height='30' fill='${bg}'/><path d='M15 3l3 9h9l-7 5 3 9-8-6-8 6 3-9-7-5h9z' fill='none' stroke='${ink}' stroke-width='1.2'/></svg>`,
    neon: `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><rect width='22' height='22' fill='${bg}'/><path d='M0 11h22M11 0v22' stroke='${ink}' stroke-width='1' opacity='.5'/><circle cx='11' cy='11' r='2.4' fill='#FF4FD8'/></svg>`,
    botanical: `<svg xmlns='http://www.w3.org/2000/svg' width='36' height='36'><rect width='36' height='36' fill='${bg}'/><g fill='${ink}' opacity='.8'><path d='M8 30C6 20 12 12 20 8C18 18 14 26 8 30Z'/><path d='M26 22c4-2 8 0 9 3-4 1-7 0-9-3z'/><circle cx='28' cy='8' r='2.5' fill='#E07A5F'/></g></svg>`,
    stars: `<svg xmlns='http://www.w3.org/2000/svg' width='34' height='34'><rect width='34' height='34' fill='${bg}'/><path fill='${ink}' d='M9 3q1 5 6 6q-5 1-6 6q-1-5-6-6q5-1 6-6z'/><circle cx='26' cy='24' r='1.4' fill='${ink}'/><circle cx='22' cy='8' r='.9' fill='#fff'/></svg>`,
  }[THEMES[t].liner];
  return e(tile);
}
