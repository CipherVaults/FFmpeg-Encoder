'use strict';

// Concept B "Kept Frame" candidate generator (original geometry; no imported
// artwork, fonts or reference images). Writes ONLY into this candidate folder.
// Usage: node build.cjs   (from any directory; needs ImageMagick 7)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const dir = __dirname;
const magick = process.env.APP_ICON_MAGICK || 'C:/Program Files/ImageMagick-7.1.1-Q16-HDRI/magick.exe';

const C = Object.freeze({
  ink: '#172A33',      // tile (unchanged from Folded Frame)
  ivory: '#F9F6EC',    // the source frame, intact
  amber: '#F4B54C',    // the transform: the band's working face
  teal: '#50C7BC',     // the output: the band's other face after the fold
  crease: '#2E978E',   // folded flap, the teal underside in shadow
});

// Rounded rectangle, clockwise, arcs only where r > 0.
function rr(x, y, w, h, r) {
  if (!r) return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
  return `M${x + r} ${y}H${x + w - r}A${r} ${r} 0 0 1 ${x + w} ${y + r}V${y + h - r}`
    + `A${r} ${r} 0 0 1 ${x + w - r} ${y + h}H${x + r}A${r} ${r} 0 0 1 ${x} ${y + h - r}`
    + `V${y + r}A${r} ${r} 0 0 1 ${x + r} ${y}Z`;
}

// One drawing routine for every size, so the optical sources are the same
// construction on whole-pixel grids rather than separate artwork.
//   tile  : inset t, radius tr
//   band  : output bracket from X1..X2, Y1..Y2, thickness b, outer corner rb
//   frame : source frame x,y,w,h, outer radius fr, band fb, window radius wr
function draw(n, g, label) {
  const { t, tr, X1, X2, Y1, Y2, b, rb, x, y, w, h, fr, fb, wr } = g;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}" viewBox="0 0 ${n} ${n}" role="img" aria-label="${label}">
  <rect x="${t}" y="${t}" width="${n - 2 * t}" height="${n - 2 * t}" rx="${tr}" fill="${C.ink}"/>
  <path d="M${X1} ${Y1}H${X2 - b}V${Y1 + b}H${X1}Z" fill="${C.amber}"/>
  <path d="M${X2} ${Y1 + b}V${Y2 - rb}A${rb} ${rb} 0 0 1 ${X2 - rb} ${Y2}H${X1}V${Y2 - b}H${X2 - b}V${Y1 + b}Z" fill="${C.teal}"/>
  <path d="M${X2 - b} ${Y1}L${X2} ${Y1 + b}H${X2 - b}Z" fill="${C.crease}"/>
  <path fill-rule="evenodd" d="${rr(x, y, w, h, fr)}${rr(x + fb, y + fb, w - 2 * fb, h - 2 * fb, wr)}" fill="${C.ivory}"/>
</svg>
`;
}

const GRIDS = {
  // 256 master: content box x 40..216, y 52..204 (centred on 128,128).
  256: { t: 8, tr: 52, X1: 104, X2: 216, Y1: 52, Y2: 204, b: 24, rb: 24, x: 40, y: 86, w: 114, h: 84, fr: 16, fb: 22, wr: 4 },
  // Optical sources: every edge on a whole pixel; >= 1px clearance between the
  // source frame and the band; band >= 2px so amber and teal stay distinct.
  32: { t: 1, tr: 7, X1: 13, X2: 27, Y1: 6, Y2: 26, b: 3, rb: 3, x: 5, y: 11, w: 14, h: 10, fr: 2, fb: 3, wr: 0 },
  24: { t: 1, tr: 5, X1: 10, X2: 20, Y1: 5, Y2: 19, b: 2, rb: 2, x: 4, y: 8, w: 11, h: 8, fr: 1.5, fb: 2, wr: 0 },
  16: { t: 1, tr: 3, X1: 7, X2: 14, Y1: 2, Y2: 14, b: 2, rb: 2, x: 2, y: 5, w: 8, h: 6, fr: 1, fb: 2, wr: 0 },
};

function checkGrid(n, g) {
  const { X1, X2, Y1, Y2, b, x, y, w, h, fb } = g;
  assert(y >= Y1 + b + (n < 256 ? 1 : 8), `${n}: frame must clear the top arm`);
  assert(y + h <= Y2 - b - (n < 256 ? 1 : 8), `${n}: frame must clear the bottom arm`);
  assert(x + w <= X2 - b - 1, `${n}: frame must clear the output side`);
  assert(x < X1 && x + w > X1, `${n}: frame must sit across the band opening`);
  assert(w - 2 * fb >= 2 && h - 2 * fb >= 2, `${n}: frame window must stay open`);
  if (n < 256) for (const v of [X1, X2, Y1, Y2, b, x, y, w, h, fb]) assert(Number.isInteger(v), `${n}: whole-pixel geometry`);
}

function run(args, input) {
  const r = spawnSync(magick, args, { input, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, String(r.stderr) || 'ImageMagick failed');
  return r.stdout;
}

const clearFringe = ['-channel', 'A', '-fx', 'u < 1.5/255 ? 0 : u', '+channel'];

function write(name, bytes) {
  assert.equal(path.basename(name), name);
  fs.writeFileSync(path.join(dir, name), bytes);
  return name;
}

function main() {
  const written = [];
  const svgs = {};
  for (const [size, g] of Object.entries(GRIDS)) {
    const n = Number(size);
    checkGrid(n, g);
    const label = n === 256 ? 'FFmpeg Encoder candidate B, Kept Frame' : `FFmpeg Encoder candidate B, Kept Frame, ${n} pixel optical source`;
    const svg = draw(n, g, label);
    assert(!/<(?:script|foreignObject|image|use|text|filter|style|a)\b|href|url\(|<!DOCTYPE/i.test(svg), 'static geometry only');
    svgs[n] = svg;
    written.push(write(n === 256 ? 'icon.svg' : `icon-${n}.svg`, svg));
  }

  // 256 and 48 come from the master via a 1024px intermediate (Lanczos).
  const master = run(['-background', 'none', '-density', '384', 'svg:-', '-resize', '1024x1024!', '-colorspace', 'sRGB', 'png32:-'], Buffer.from(svgs[256]));
  for (const n of [256, 48]) {
    const png = run(['png:-', '-filter', 'Lanczos', '-resize', `${n}x${n}!`, '-colorspace', 'sRGB', ...clearFringe, '-strip', 'png32:-'], master);
    written.push(write(`icon-${n}.png`, png));
  }
  // Optical sizes: 8x supersample of the whole-pixel source, then an exact Box
  // average, so each pixel's coverage equals the geometry's true area.
  for (const n of [32, 24, 16]) {
    const png = run(['-background', 'none', '-density', String(96 * 8), 'svg:-', '-filter', 'Box', '-resize', `${n}x${n}!`, '-colorspace', 'sRGB', ...clearFringe, '-strip', 'png32:-'], Buffer.from(svgs[n]));
    written.push(write(`icon-${n}.png`, png));
  }

  // Review sheet: actual pixels plus nearest-neighbour enlargements on both surfaces.
  const W = 1240, PH = 330;
  const panels = [{ y: 16, fill: '#101318', text: '#B1BDCB', label: 'Dark surface #101318' },
    { y: 16 + PH + 16, fill: '#F3F5F7', text: '#4D6057', label: 'Light surface #F3F5F7' }];
  const H = 16 + 2 * (PH + 16);
  const bg = [`<rect width="${W}" height="${H}" fill="#C9CFD4"/>`];
  const comps = [];
  for (const p of panels) {
    bg.push(`<rect x="16" y="${p.y}" width="${W - 32}" height="${PH}" rx="12" fill="${p.fill}"/>`,
      `<text x="40" y="${p.y + 28}" font-size="14" fill="${p.text}">${p.label} / actual exported pixels, then enlarged 32px x6, 24px x8, 16px x12</text>`);
    const mid = p.y + 52 + 128;
    let x = 40;
    for (const n of [256, 48, 32, 24, 16]) {
      comps.push({ file: `icon-${n}.png`, x, y: mid - n / 2, scale: 1 });
      bg.push(`<text x="${x + n / 2}" y="${p.y + PH - 14}" text-anchor="middle" font-size="12" fill="${p.text}">${n}px</text>`);
      x += n + (n === 256 ? 36 : 26);
    }
    x = 568;
    for (const [n, s] of [[32, 6], [24, 8], [16, 12]]) {
      comps.push({ file: `icon-${n}.png`, x, y: mid - 96, scale: s });
      bg.push(`<text x="${x + 96}" y="${p.y + PH - 14}" text-anchor="middle" font-size="12" fill="${p.text}">${n}px x${s}</text>`);
      x += 192 + 30;
    }
  }
  const sheetSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g font-family="sans-serif">${bg.join('')}</g></svg>`;
  const base = run(['-background', 'none', 'svg:-', 'png32:-'], Buffer.from(sheetSvg));
  const args = ['png:-'];
  for (const c of comps) {
    args.push('(', path.join(dir, c.file));
    if (c.scale > 1) args.push('-filter', 'point', '-resize', `${c.scale * 100}%`);
    args.push(')', '-geometry', `+${c.x}+${c.y}`, '-composite');
  }
  args.push('-strip', 'png32:-');
  written.push(write('preview-sheet.png', run(args, base)));
  console.log(JSON.stringify({ written }, null, 2));
}

if (require.main === module) main();
