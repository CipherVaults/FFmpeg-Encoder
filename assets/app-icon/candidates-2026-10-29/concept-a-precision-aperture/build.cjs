'use strict';

// Concept A "Precision Aperture" candidate builder (design review only).
// Original geometry; no imported logo, font, stock art or raster. Writes only
// into this script's own folder. Uses Node built-ins and an existing
// ImageMagick 7 executable (APP_ICON_MAGICK or the default Windows path).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const out = __dirname;
const defaultMagick = 'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe';
const magick = process.env.APP_ICON_MAGICK || (fs.existsSync(defaultMagick) ? defaultMagick : 'magick');

const INK = '#172A33';
const IVORY = '#F9F6EC';
const AMBER = '#F4B54C';
const TEAL = '#50C7BC';

// Hand-tuned grids. 256 is the master; 16/24/32 are whole-pixel optical
// sources (tile edges, bracket edges, gap edges, square edges and the ring
// centre all fall on pixel boundaries; ring radii are whole pixels).
const GRIDS = {
  256: { tile: 8, rx: 52, c: 128, R: 66, r: 48, ra: 73, h: 6, o: 42, e: 88, t: 12, ro: 18, q: 20, qr: 4 },
  32: { tile: 1, rx: 7, c: 16, R: 9, r: 6, ra: 10, h: 1, o: 5, e: 11, t: 2, ro: 0, q: 3, qr: 0 },
  24: { tile: 1, rx: 5, c: 12, R: 7, r: 5, ra: 8, h: 1, o: 3, e: 8, t: 1, ro: 0, q: 2, qr: 0 },
  16: { tile: 1, rx: 3, c: 8, R: 5, r: 3, ra: 6, h: 0, o: 2, e: 5, t: 1, ro: 0, q: 1, qr: 0 },
};

const n = v => {
  const s = (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '');
  return s === '-0' ? '0' : s;
};

function bracket(x0, y0, dx, dy, len, t, ro) {
  // L-shaped corner mark; outer corner at (x0,y0), arms run inward. When the
  // outer corner is rounded (master only) the inner corner shares its centre
  // (radius ro - t), so the stroke keeps a constant width around the bend and
  // the bend stays concentric with the tile corner.
  const sweep = dx * dy > 0 ? 1 : 0;
  const ri = Math.max(0, ro - t);
  const start = ro > 0 ? `M${n(x0 + dx * ro)} ${n(y0)}` : `M${n(x0)} ${n(y0)}`;
  const close = ro > 0 ? `V${n(y0 + dy * ro)}A${ro} ${ro} 0 0 ${sweep} ${n(x0 + dx * ro)} ${n(y0)}Z` : 'Z';
  const inner = ri > 0
    ? `H${n(x0 + dx * (t + ri))}A${ri} ${ri} 0 0 ${1 - sweep} ${n(x0 + dx * t)} ${n(y0 + dy * (t + ri))}`
    : `H${n(x0 + dx * t)}`;
  return `${start}H${n(x0 + dx * len)}V${n(y0 + dy * t)}${inner}V${n(y0 + dy * len)}H${n(x0)}${close}`;
}

function ring(c, R, r, ra, h) {
  // Ring split at 12 and 3 o'clock by parallel-sided gaps of width 2h.
  // Returns [major 270-degree arc, calibrated 90-degree quadrant]. The
  // quadrant shares the inner radius but its outer radius ra is raised, like
  // the index band of a lens barrel standing proud of the scale.
  const so = Math.sqrt(R * R - h * h);
  const sa = Math.sqrt(ra * ra - h * h);
  const si = Math.sqrt(r * r - h * h);
  const major = `M${n(c + so)} ${n(c + h)}A${R} ${R} 0 1 1 ${n(c - h)} ${n(c - so)}`
    + `V${n(c - si)}A${r} ${r} 0 1 0 ${n(c + si)} ${n(c + h)}Z`;
  const quadrant = `M${n(c + h)} ${n(c - sa)}A${ra} ${ra} 0 0 1 ${n(c + sa)} ${n(c - h)}`
    + `H${n(c + si)}A${r} ${r} 0 0 0 ${n(c + h)} ${n(c - si)}Z`;
  return [major, quadrant];
}

function square(c, q, qr) {
  if (!qr) return `<rect x="${c - q}" y="${c - q}" width="${2 * q}" height="${2 * q}" fill="${TEAL}"/>`;
  return `<rect x="${c - q}" y="${c - q}" width="${2 * q}" height="${2 * q}" rx="${qr}" fill="${TEAL}"/>`;
}

function iconSvg(size) {
  const g = GRIDS[size];
  assert(g, `no grid for ${size}`);
  const S = size;
  const len = g.e - g.o;
  const [major, quadrant] = ring(g.c, g.R, g.r, g.ra, g.h);
  const label = size === 256 ? 'FFmpeg Encoder Precision Aperture' : `FFmpeg Encoder Precision Aperture ${size} pixel optical source`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${label}">
  <rect x="${g.tile}" y="${g.tile}" width="${S - 2 * g.tile}" height="${S - 2 * g.tile}" rx="${g.rx}" fill="${INK}"/>
  <path d="${bracket(g.o, g.o, 1, 1, len, g.t, g.ro)}" fill="${IVORY}"/>
  <path d="${bracket(S - g.o, S - g.o, -1, -1, len, g.t, g.ro)}" fill="${IVORY}"/>
  <path d="${major}" fill="${IVORY}"/>
  <path d="${quadrant}" fill="${AMBER}"/>
  ${square(g.c, g.q, g.qr)}
</svg>
`;
}

function run(args, input) {
  const res = spawnSync(magick, args, { input, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  if (res.error) throw res.error;
  assert.equal(res.status, 0, res.stderr.toString('utf8') || 'ImageMagick failed');
  return res.stdout;
}

function write(name, bytes) {
  assert.equal(path.basename(name), name);
  fs.writeFileSync(path.join(out, name), bytes);
}

const STATIC_GUARD = /<(?:script|foreignObject|image|use|text|style|filter|a)\b|(?:href|style)\s*=|url\(|<!DOCTYPE/i;

function rasterize(svgBytes, size, filter = 'Lanczos') {
  // Render at 4x-ish via density, then Lanczos to the target, clearing the
  // one-level alpha fringe outside the tile (same approach as the shipped
  // generator).
  const big = run(['-background', 'none', '-density', String(Math.round(96 * 1024 / Number(/width="(\d+)"/.exec(svgBytes)[1]))),
    'svg:-', '-resize', '1024x1024!', '-colorspace', 'sRGB', '-strip', 'png32:-'], svgBytes);
  return run(['png:-', '-filter', filter, '-resize', `${size}x${size}!`, '-colorspace', 'sRGB',
    '-channel', 'A', '-fx', 'u < 1.5/255 ? 0 : u', '+channel', '-strip', 'png32:-'], big);
}

function previewSheet() {
  const W = 1120;
  const rowH = 360;
  const rows = [
    { y: 0, fill: '#101318', text: '#EDF0F4', sub: '#B1BDCB', label: 'Dark surface #101318' },
    { y: rowH, fill: '#F3F5F7', text: '#1C2925', sub: '#4D6057', label: 'Light surface #F3F5F7' },
  ];
  const parts = [`<rect width="${W}" height="${2 * rowH}" fill="#000000"/>`];
  const comps = [];
  for (const row of rows) {
    parts.push(`<rect x="0" y="${row.y}" width="${W}" height="${rowH}" fill="${row.fill}"/>`,
      `<text x="32" y="${row.y + 30}" font-size="15" fill="${row.text}">Precision Aperture / ${row.label} / native pixels</text>`);
    const base = row.y + 52;
    comps.push({ file: 'icon-256.png', x: 32, y: base, scale: 1 });
    parts.push(`<text x="160" y="${base + 284}" text-anchor="middle" font-size="12" fill="${row.sub}">256</text>`);
    const natives = [[48, 330], [32, 400], [24, 452], [16, 496]];
    for (const [s, x] of natives) {
      comps.push({ file: `icon-${s}.png`, x, y: base + 128 - s / 2, scale: 1 });
      parts.push(`<text x="${x + s / 2}" y="${base + 284}" text-anchor="middle" font-size="12" fill="${row.sub}">${s}</text>`);
    }
    // Taskbar-like strip: 24px icons with neighbours spacing, as Windows shows them.
    parts.push(`<text x="330" y="${base + 30}" font-size="12" fill="${row.sub}">taskbar-scale strip (24 / 32)</text>`);
    comps.push({ file: 'icon-24.png', x: 330, y: base + 42, scale: 1 });
    comps.push({ file: 'icon-32.png', x: 366, y: base + 38, scale: 1 });
    comps.push({ file: 'icon-16.png', x: 410, y: base + 46, scale: 1 });
    // Nearest-neighbour enlargements of the optical sizes.
    const enl = [[16, 8, 560], [24, 6, 714], [32, 6, 886]];
    for (const [s, k, x] of enl) {
      comps.push({ file: `icon-${s}.png`, x, y: base + 16, scale: k });
      parts.push(`<text x="${x + (s * k) / 2}" y="${base + 284}" text-anchor="middle" font-size="12" fill="${row.sub}">${s}px x${k} (point)</text>`);
    }
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${2 * rowH}" viewBox="0 0 ${W} ${2 * rowH}"><g font-family="sans-serif">${parts.join('')}</g></svg>`);
  const bg = run(['-background', 'none', 'svg:-', '-strip', 'png32:-'], svg);
  const args = ['png:-'];
  for (const c of comps) {
    args.push('(', path.join(out, c.file));
    if (c.scale > 1) args.push('-filter', 'point', '-resize', `${c.scale * 100}%`);
    args.push(')', '-geometry', `+${Math.round(c.x)}+${Math.round(c.y)}`, '-composite');
  }
  args.push('-strip', 'png32:-');
  return run(args, bg);
}

function main() {
  const master = Buffer.from(iconSvg(256));
  assert(!STATIC_GUARD.test(master.toString('utf8')));
  write('icon.svg', master);
  write('icon-256.png', rasterize(master, 256));
  write('icon-48.png', rasterize(master, 48));
  for (const s of [32, 24, 16]) {
    const svg = Buffer.from(iconSvg(s));
    assert(!STATIC_GUARD.test(svg.toString('utf8')));
    write(`icon-${s}.svg`, svg);
    // Area averaging keeps whole-pixel edges exact (no Lanczos ringing).
    write(`icon-${s}.png`, rasterize(svg, s, 'Box'));
  }
  write('preview-sheet.png', previewSheet());
  console.log('built', fs.readdirSync(out).join(', '));
}

if (require.main === module) main();
module.exports = { iconSvg, GRIDS };
