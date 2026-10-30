'use strict';

// Concept C "Kept Streams" candidate generator for FFmpeg Encoder.
// Original geometry authored for this candidate; it uses no imported logo,
// stock artwork, font, glyph or reference image. Writes ONLY into the folder
// that contains this script. Requires an existing ImageMagick 7 executable
// (set APP_ICON_MAGICK to override the default path). Usage: node build.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const dir = __dirname;
const magick = process.env.APP_ICON_MAGICK || 'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const C = Object.freeze({
  tile: '#1D2A2E',   // warm ink slate: the workbench surface that holds the streams
  rim: '#33464B',    // raised edge so the tile separates from dark taskbars
  video: '#F4AA45',  // amber: picture stream (widest)
  audio: '#5FC5AE',  // jade teal: sound stream
  text: '#FBF4E6',   // warm ivory: subtitle stream (thinnest, like caption text)
});

const T8 = Math.tan(Math.PI / 8); // tangent length factor for a 45 degree bend
const S = Math.SQRT1_2;
const f = n => {
  const r = Math.round(n * 1000) / 1000;
  return Object.is(r, -0) ? '0' : String(r);
};

// ---------------------------------------------------------------- master 256
// One shared centerline runs east, bends 45 degrees up, then bends back east.
// Every stream edge is a true parallel offset of that line (concentric arcs),
// so the three streams keep exactly the same width and spacing through the
// step. All streams end on the same two vertical cuts: they start and finish
// together.
const M = Object.freeze({
  bands: [{ key: 'video', w: 30 }, { key: 'audio', w: 22 }, { key: 'text', w: 14 }],
  gap: 11, J: 48, R: 56, x0: 50, x1: 206, corner: 6, rim: 4,
});

function offsetEdge(e, g, forward) {
  // e: offset from the centerline, positive = up. forward: west to east.
  const { yL, xA, J, R } = g;
  const t = R * T8, yR = yL - J, xB = xA + J;
  const cA = [xA - t, yL - R], cB = [xB + t, yR + R];
  const rA = R - e, rB = R + e;
  assert(rA > 0 && rB > 0, 'bend radius must stay positive for every edge');
  const a0 = [cA[0], yL - e], a1 = [cA[0] + rA * S, cA[1] + rA * S];
  const b0 = [cB[0] - rB * S, cB[1] - rB * S], b1 = [cB[0], yR - e];
  if (forward) {
    return `H${f(a0[0])}A${f(rA)} ${f(rA)} 0 0 0 ${f(a1[0])} ${f(a1[1])}` +
      `L${f(b0[0])} ${f(b0[1])}A${f(rB)} ${f(rB)} 0 0 1 ${f(b1[0])} ${f(b1[1])}`;
  }
  return `H${f(b1[0])}A${f(rB)} ${f(rB)} 0 0 0 ${f(b0[0])} ${f(b0[1])}` +
    `L${f(a1[0])} ${f(a1[1])}A${f(rA)} ${f(rA)} 0 0 1 ${f(a0[0])} ${f(a0[1])}`;
}

function masterBand(u, l, g, x0, x1, c) {
  const yL = g.yL, yR = g.yL - g.J;
  return `M${f(x0 + c)} ${f(yL - u)}` + offsetEdge(u, g, true) +
    `H${f(x1 - c)}A${c} ${c} 0 0 1 ${f(x1)} ${f(yR - u + c)}V${f(yR - l - c)}A${c} ${c} 0 0 1 ${f(x1 - c)} ${f(yR - l)}` +
    offsetEdge(l, g, false) +
    `H${f(x0 + c)}A${c} ${c} 0 0 1 ${f(x0)} ${f(yL - l - c)}V${f(yL - u + c)}A${c} ${c} 0 0 1 ${f(x0 + c)} ${f(yL - u)}Z`;
}

function ringPath(x, y, w, h, r, k) {
  // Even-odd ring: outer rounded square minus an inset rounded square.
  const rr = (X, Y, W, H, R) => `M${f(X + R)} ${f(Y)}H${f(X + W - R)}A${f(R)} ${f(R)} 0 0 1 ${f(X + W)} ${f(Y + R)}V${f(Y + H - R)}` +
    `A${f(R)} ${f(R)} 0 0 1 ${f(X + W - R)} ${f(Y + H)}H${f(X + R)}A${f(R)} ${f(R)} 0 0 1 ${f(X)} ${f(Y + H - R)}V${f(Y + R)}A${f(R)} ${f(R)} 0 0 1 ${f(X + R)} ${f(Y)}Z`;
  return rr(x, y, w, h, r) + rr(x + k, y + k, w - 2 * k, h - 2 * k, Math.max(0, r - k));
}

function master() {
  const total = M.bands.reduce((a, b) => a + b.w, 0) + M.gap * (M.bands.length - 1);
  const g = { yL: 128 + M.J / 2, xA: 128 - M.J / 2, J: M.J, R: M.R };
  const body = [
    '<title>FFmpeg Encoder — Kept Streams</title>',
    '<desc>Three parallel streams, amber picture, teal sound and ivory captions, rise through one shared step with unchanged widths and spacing on an ink rounded square.</desc>',
    `<rect x="8" y="8" width="240" height="240" rx="52" fill="${C.tile}"/>`,
    `<path fill-rule="evenodd" d="${ringPath(8, 8, 240, 240, 52, M.rim)}" fill="${C.rim}"/>`,
  ];
  let top = total / 2;
  for (const b of M.bands) {
    body.push(`<path d="${masterBand(top, top - b.w, g, M.x0, M.x1, M.corner)}" fill="${C[b.key]}"/>`);
    top -= b.w + M.gap;
  }
  return svgDoc(256, 'FFmpeg Encoder Kept Streams', body);
}

// ------------------------------------------------------------ optical sizes
// Whole-pixel sources. Every horizontal and vertical edge sits on a pixel
// boundary. 'stair' climbs one pixel per column (crisp 45 degree staircase,
// needed where gaps are 1px; a 45 degree vector edge there would blur the
// 1px gap away). 'shear' runs a 45 degree edge between integer vertices with
// a small quadratic bend, which stays clean once the gaps are 2px wide.
// Fields: tile [x, y, w, h, rx]; x0/x1 shared flat cuts; top = first row of
// the video stream on the left (low) run; bands = video/audio/text heights;
// J = rise in pixels; tA = first rising column.
const OPTICAL = Object.freeze({
  16: { tile: [1, 1, 14, 14, 3], rim: 1, x0: 3, x1: 13, top: 6, bands: [2, 2, 1], gap: 1, J: 3, tA: 7, mode: 'stair', foot: 1 },
  24: { tile: [1, 1, 22, 22, 5], rim: 1, x0: 5, x1: 19, top: 11, bands: [3, 2, 1], gap: 1, J: 5, tA: 10, mode: 'stair', foot: 1 },
  32: { tile: [1, 1, 30, 30, 7], rim: 1, x0: 6, x1: 26, top: 13, bands: [4, 3, 2], gap: 2, J: 6, tA: 13, mode: 'shear', bend: 2.5 },
});

function stairBand(x0, x1, y, h, tA, J, foot = 0) {
  // One pixel of rise per column. A 1px stream gets a one-row foot on its
  // rising columns so its diagonal stays edge-connected instead of dotted.
  const o = c => Math.max(0, Math.min(J, c - tA + 1));
  const top = c => y - o(c);
  const bot = c => y - o(c) + h + (foot && c >= tA && c <= tA + J - 1 ? foot : 0);
  let p = `M${x0} ${top(x0)}`;
  for (let c = x0 + 1; c < x1; c++) if (top(c) !== top(c - 1)) p += `H${c}V${top(c)}`;
  p += `H${x1}V${bot(x1 - 1)}`;
  for (let c = x1 - 1; c > x0; c--) if (bot(c) !== bot(c - 1)) p += `H${c}V${bot(c - 1)}`;
  return `${p}H${x0}Z`;
}

function shearBand(x0, x1, y, h, tA, J, r = 0) {
  // Straight 45 degree run between integer vertices; r softens each bend with
  // a short quadratic so the 32px mark echoes the master's rounded step.
  if (!r) return `M${x0} ${y}H${tA}L${tA + J} ${y - J}H${x1}V${y - J + h}H${tA + J}L${tA} ${y + h}H${x0}Z`;
  const d = r * Math.SQRT1_2;
  const bend = (vx, vy, inX, outX, outY) => `L${f(inX)} ${f(vy)}Q${vx} ${vy} ${f(outX)} ${f(outY)}`;
  const top = `M${x0} ${y}` + bend(tA, y, tA - r, tA + d, y - d) + `L${f(tA + J - d)} ${f(y - J + d)}Q${tA + J} ${y - J} ${f(tA + J + r)} ${y - J}H${x1}`;
  const yb = y + h, ybR = y - J + h;
  const bottom = `V${ybR}H${f(tA + J + r)}Q${tA + J} ${ybR} ${f(tA + J - d)} ${f(ybR + d)}L${f(tA + d)} ${f(yb - d)}Q${tA} ${yb} ${f(tA - r)} ${yb}H${x0}Z`;
  return top + bottom;
}

function optical(size, o = OPTICAL[size]) {
  const [tx, ty, tw, th, tr] = o.tile;
  const body = [`<rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="${tr}" fill="${C.tile}"/>`];
  if (o.rim) body.push(`<path fill-rule="evenodd" d="${ringPath(tx, ty, tw, th, tr, o.rim)}" fill="${C.rim}"/>`);
  const keys = ['video', 'audio', 'text'];
  let y = o.top;
  o.bands.forEach((h, i) => {
    const d = o.mode === 'stair' ? stairBand(o.x0, o.x1, y, h, o.tA, o.J, h === 1 ? (o.foot || 0) : 0)
      : shearBand(o.x0, o.x1, y, h, o.tA, o.J, o.bend || 0);
    body.push(`<path d="${d}" fill="${C[keys[i]]}"/>`);
    y += h + o.gap;
  });
  return svgDoc(size, `FFmpeg Encoder Kept Streams ${size} pixel optical source`, body);
}

function svgDoc(size, label, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${label}">\n` +
    body.map(s => `  ${s}`).join('\n') + '\n</svg>\n';
}

// ---------------------------------------------------------------- rendering
function run(args, input) {
  const r = spawnSync(magick, args, { input, windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  if (r.error) throw r.error;
  assert.equal(r.status, 0, r.stderr ? r.stderr.toString('utf8') : 'ImageMagick failed');
  return r.stdout;
}

function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes[25], 6, 'PNG must be RGBA');
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

const written = [];
function write(name, data) {
  assert.equal(path.basename(name), name, 'output names stay inside this folder');
  fs.writeFileSync(path.join(dir, name), data);
  written.push({ name, bytes: data.length, sha256: sha256(Buffer.from(data)) });
}

function checkStatic(svg) {
  assert(!/<(?:script|foreignObject|image|use|text|style|filter|linearGradient|radialGradient|pattern|mask|clipPath)\b|(?:href|style)\s*=|url\(|<!DOCTYPE|@import/i.test(svg),
    'SVG must be static filled geometry only');
}

const fringe = ['-channel', 'A', '-fx', 'u < 1.5/255 ? 0 : u', '+channel'];

function main() {
  const src = master();
  checkStatic(src);
  write('icon.svg', src);
  for (const [size, k] of [[256, 4], [48, 16]]) {
    // Supersample the master by an integer factor, then box-average: true
    // area coverage without the dark ringing Lanczos leaves beside the streams.
    const hi = run(['-background', 'none', '-density', String(96 * size * k / 256), 'svg:-', '-resize', `${size * k}x${size * k}!`, '-colorspace', 'sRGB', '-strip', 'png32:-'], Buffer.from(src));
    const png = run(['png:-', '-filter', 'Box', '-resize', `${size}x${size}!`, '-colorspace', 'sRGB', ...fringe, '-strip', 'png32:-'], hi);
    assert.deepEqual(pngSize(png), [size, size]);
    write(`icon-${size}.png`, png);
  }
  for (const size of [16, 24, 32]) {
    const svg = optical(size);
    checkStatic(svg);
    write(`icon-${size}.svg`, svg);
    // 8x supersample, then an exact box average: whole-pixel edges stay crisp
    // and the 45 degree shear edges receive true area coverage.
    const hi = run(['-background', 'none', '-density', String(96 * 8), 'svg:-', '-resize', `${size * 8}x${size * 8}!`, '-colorspace', 'sRGB', '-strip', 'png32:-'], Buffer.from(svg));
    const png = run(['png:-', '-filter', 'Box', '-resize', `${size}x${size}!`, '-colorspace', 'sRGB', ...fringe, '-strip', 'png32:-'], hi);
    assert.deepEqual(pngSize(png), [size, size]);
    write(`icon-${size}.png`, png);
  }
  const sheetPng = sheet();
  assert.deepEqual(pngSize(sheetPng), [1120, 980]);
  write('preview-sheet.png', sheetPng);
  console.log(JSON.stringify({ renderer: run(['-version']).toString().split(/\r?\n/)[0], written }, null, 2));
}

// ------------------------------------------------------------- review sheet
function sheet() {
  const W = 1120, H = 980;
  const rows = [
    { y: 16, fill: '#101318', ink: '#EDF0F4', label: 'Dark surface #101318 (app dark background), actual pixels', bar: '#202020', barLabel: 'Windows dark taskbar #202020' },
    { y: 336, fill: '#F3F5F7', ink: '#1C2925', label: 'Light surface #F3F5F7, actual pixels', bar: '#E9ECEF', barLabel: 'Windows light taskbar #E9ECEF' },
  ];
  const parts = [`<rect width="${W}" height="${H}" fill="#C9CFD3"/>`];
  const comps = [];
  for (const r of rows) {
    parts.push(`<rect x="16" y="${r.y}" width="${W - 32}" height="304" rx="12" fill="${r.fill}"/>`,
      `<text x="36" y="${r.y + 30}" font-size="15" fill="${r.ink}">${r.label}</text>`);
    // 256 at the right; small sizes in a row on a shared baseline area.
    const big = { x: W - 32 - 24 - 256, y: r.y + 24 };
    comps.push({ file: 'icon-256.png', x: big.x, y: big.y });
    parts.push(`<text x="${big.x + 128}" y="${r.y + 296}" text-anchor="middle" font-size="12" fill="${r.ink}">256</text>`);
    let x = 44;
    const mid = r.y + 120;
    for (const s of [16, 24, 32, 48]) {
      comps.push({ file: `icon-${s}.png`, x, y: mid - s / 2 });
      parts.push(`<text x="${x + s / 2}" y="${mid + 48}" text-anchor="middle" font-size="12" fill="${r.ink}">${s}</text>`);
      x += s + 40;
    }
    // Taskbar strip at actual pixels: 24 (100% scale) and 32 (~133-150%).
    const bx = 44, by = r.y + 200;
    parts.push(`<rect x="${bx}" y="${by}" width="500" height="48" fill="${r.bar}"/>`,
      `<text x="${bx}" y="${by + 70}" font-size="12" fill="${r.ink}">${r.barLabel}: 24px and 32px beside neutral placeholders</text>`);
    const ph = r.bar === '#202020' ? '#5A5F66' : '#9AA3AD';
    for (const [i, s] of [[0, 24], [1, 24], [2, 24], [3, 32], [4, 24]]) {
      const cx = bx + 40 + i * 52, cy = by + 24;
      if (i === 1 || i === 3) comps.push({ file: `icon-${s}.png`, x: cx - s / 2, y: cy - s / 2 });
      else parts.push(`<rect x="${cx - 10}" y="${cy - 10}" width="20" height="20" rx="4" fill="${ph}"/>`);
    }
  }
  parts.push(`<text x="36" y="${666}" font-size="15" fill="#1C2925">8x nearest-neighbour inspection of the exported 16, 24, 32 and 48px PNGs</text>`);
  let x = 36;
  for (const s of [16, 24, 32]) {
    const k = 8;
    parts.push(`<rect x="${x - 6}" y="680" width="${s * k + 12}" height="${s * k + 12}" fill="#F3F5F7"/>`);
    comps.push({ file: `icon-${s}.png`, x, y: 686, scale: k });
    x += s * k + 36;
  }
  parts.push(`<rect x="${x - 6}" y="680" width="${48 * 4 + 12}" height="${48 * 4 + 12}" fill="#101318"/>`,
    `<text x="${x}" y="${680 + 48 * 4 + 32}" font-size="12" fill="#1C2925">48 at 4x on dark</text>`);
  comps.push({ file: 'icon-48.png', x, y: 686, scale: 4 });
  const bg = run(['-background', 'none', 'svg:-', '-strip', 'png32:-'],
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><g font-family="Segoe UI, sans-serif">${parts.join('')}</g></svg>`));
  const args = ['png:-'];
  for (const c of comps) {
    args.push('(', path.join(dir, c.file));
    if (c.scale) args.push('-filter', 'point', '-resize', `${c.scale * 100}%`);
    args.push(')', '-geometry', `+${Math.round(c.x)}+${Math.round(c.y)}`, '-composite');
  }
  args.push('-strip', 'png32:-');
  return run(args, bg);
}

if (require.main === module) main();
module.exports = { master, optical, OPTICAL, C, run };
