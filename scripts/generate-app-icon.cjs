'use strict';

// Original Folded Frame artwork; ISC, Copyright (c) 2026 FFmpeg Encoder contributors.
// This asset-only generator never launches the app, downloads tools, or touches
// accepted builds. All generated files stay beside the owned source SVG.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const directory = path.join(root, 'assets', 'app-icon');
const sizes = Object.freeze([16, 20, 24, 32, 40, 48, 64, 128, 256]);
const configuredMagick = process.env.APP_ICON_MAGICK;
const defaultWindowsMagick = 'C:\\Program Files\\ImageMagick-7.1.1-Q16-HDRI\\magick.exe';
const magick = configuredMagick || (fs.existsSync(defaultWindowsMagick) ? defaultWindowsMagick : 'magick');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function opticalSource(size) {
  // Whole-pixel brackets make the tiny marks deliberate rather than relying on
  // fractional 256px coordinates. These preserve the same three-part silhouette.
  const grids = {
    16: { tile: 1, radius: 3, left: 4, top: 4, right: 12, bottom: 12, band: 2, corner: 1, gap: 1 },
    20: { tile: 1, radius: 4, left: 4, top: 4, right: 16, bottom: 16, band: 2, corner: 1, gap: 1 },
    24: { tile: 1, radius: 5, left: 5, top: 5, right: 19, bottom: 19, band: 2, corner: 2, gap: 2 },
    32: { tile: 1, radius: 7, left: 7, top: 7, right: 25, bottom: 25, band: 3, corner: 2, gap: 2 },
  };
  const grid = grids[size];
  if (!grid) return null;
  const { tile, radius, left: l, top: t, right: r, bottom: b, band: d, corner: c, gap } = grid;
  const split = size / 2;
  const fold = t + Math.round((b - t) * 0.43);
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="FFmpeg Encoder Folded Frame ${size} pixel optical source">
  <rect x="${tile}" y="${tile}" width="${size - 2 * tile}" height="${size - 2 * tile}" rx="${radius}" fill="#172A33"/>
  <path d="M${l + c} ${t}H${split}V${t + d}H${l + d}V${b - d}H${split}V${b}H${l + c}Q${l} ${b} ${l} ${b - c}V${t + c}Q${l} ${t} ${l + c} ${t}Z" fill="#F9F6EC"/>
  <path d="M${split} ${t}H${r - c}Q${r} ${t} ${r} ${t + c}V${fold}L${r - d} ${fold - d}V${t + d}H${split}Z" fill="#F4B54C"/>
  <path d="M${r - d} ${fold - d}L${r} ${fold}H${r - d}Z" fill="#D88D28"/>
  <path d="M${r - d} ${fold + gap}H${r}V${b - c}Q${r} ${b} ${r - c} ${b}H${split}V${b - d}H${r - d}Z" fill="#50C7BC"/>
</svg>\n`);
}

function runMagick(args, input) {
  const result = spawnSync(magick, args, {
    input, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 30000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr.toString('utf8') || 'ImageMagick failed.');
  return result.stdout;
}

function pngDimensions(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'IHDR');
  assert.equal(bytes[24], 8, 'Exported PNG must use 8-bit channels.');
  assert.equal(bytes[25], 6, 'Exported PNG must retain RGBA transparency.');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function makeIco(images) {
  // PNG image entries preserve all 32-bit alpha values and the exact exported
  // bytes. ICO represents 256px as zero in the one-byte dimensions fields.
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16;
    header[entry] = size === 256 ? 0 : size;
    header[entry + 1] = size === 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(bytes.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += bytes.length;
  });
  const ico = Buffer.concat([header, ...images.map(image => image.bytes)]);
  images.forEach(({ size, bytes }, index) => {
    const entry = 6 + index * 16;
    assert.equal(ico[entry] || 256, size);
    assert.equal(ico[entry + 1] || 256, size);
    const offset = ico.readUInt32LE(entry + 12);
    const length = ico.readUInt32LE(entry + 8);
    assert.deepEqual(ico.subarray(offset, offset + length), bytes);
  });
  return ico;
}

function writeAsset(name, bytes) {
  // Restrict generated names to this directory; no caller-selected output path.
  assert.equal(path.basename(name), name);
  fs.writeFileSync(path.join(directory, name), bytes);
  return { path: `assets/app-icon/${name}`, sizeBytes: bytes.length, sha256: sha256(bytes) };
}

function makeReviewSheet(images) {
  const rows = [{ y: 16, fill: '#FFFFFF', text: '#172A33', label: 'Light surface' },
    { y: 360, fill: '#172125', text: '#F9F6EC', label: 'Dark surface' }];
  const contents = ['<rect width="1100" height="1000" fill="#D9DEDF"/>'];
  const composites = [];
  for (const row of rows) {
    contents.push(`<rect x="16" y="${row.y}" width="1068" height="328" rx="12" fill="${row.fill}"/>`,
      `<text x="36" y="${row.y + 28}" font-size="15" fill="${row.text}">${row.label} / actual exported pixels</text>`);
    let x = 36;
    for (const size of sizes) {
      const cellWidth = Math.max(62, size + 22);
      const center = x + cellWidth / 2;
      composites.push({ size, x: center - size / 2, y: row.y + 44 + (256 - size) / 2, scale: 1 });
      contents.push(`<text x="${center}" y="${row.y + 314}" text-anchor="middle" font-size="12" fill="${row.text}">${size}px</text>`);
      x += cellWidth;
    }
  }
  contents.push('<text x="36" y="724" font-size="15" fill="#172A33">6x nearest-neighbor inspection / 16, 20, 24, 32px</text>');
  let x = 36;
  for (const size of [16, 20, 24, 32]) {
    // Raster enlargement below uses point filtering, so each source pixel is
    // explicit. This separate strip is not an alternative production icon.
    const scaled = size * 6;
    contents.push(`<rect x="${x - 8}" y="744" width="${scaled + 16}" height="${scaled + 16}" fill="#FFFFFF"/>`,
      `<text x="${x}" y="${780 + scaled}" font-size="13" fill="#172A33">${size}px enlarged</text>`);
    composites.push({ size, x, y: 752, scale: 6 });
    x += scaled + 52;
  }
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="1000" viewBox="0 0 1100 1000"><g font-family="sans-serif">${contents.join('')}</g></svg>`);
  const background = runMagick(['-background', 'none', 'svg:-', '-strip', 'png32:-'], svg);
  const args = ['png:-'];
  for (const item of composites) {
    assert(images.some(image => image.size === item.size));
    args.push('(', path.join(directory, `app-icon-${item.size}.png`));
    if (item.scale > 1) args.push('-filter', 'point', '-resize', `${item.scale * 100}%`);
    args.push(')', '-geometry', `+${item.x}+${item.y}`, '-composite');
  }
  args.push('-strip', 'png32:-');
  return runMagick(args, background);
}

function main() {
  assert(fs.statSync(directory).isDirectory());
  assert(!fs.lstatSync(directory).isSymbolicLink(), 'Asset directory must not be a link.');
  const sourcePath = path.join(directory, 'app-icon.svg');
  assert(!fs.lstatSync(sourcePath).isSymbolicLink(), 'SVG source must be a regular file.');
  const source = fs.readFileSync(sourcePath);
  const sourceText = source.toString('utf8');
  assert(!/<(?:script|foreignObject|image|use)\b|(?:href|style)\s*=|url\(|<!DOCTYPE/i.test(sourceText), 'Source SVG must contain self-contained static geometry.');
  const version = runMagick(['-version']).toString('utf8').split(/\r?\n/)[0];
  const master = runMagick(['-background', 'none', '-density', '384', 'svg:-', '-resize', '1024x1024!', '-colorspace', 'sRGB', '-strip', 'png32:-'], source);
  const assets = [];
  const images = sizes.map(size => {
    const optical = opticalSource(size);
    let raster = master;
    if (optical) {
      assets.push({ ...writeAsset(`app-icon-${size}.svg`, optical), width: size, height: size, purpose: 'whole-pixel optical source' });
      raster = runMagick(['-background', 'none', '-density', '384', 'svg:-', '-colorspace', 'sRGB', '-strip', 'png32:-'], optical);
    }
    // Clear the one-level alpha fringe Lanczos may leave in fully transparent
    // corners, while retaining the useful anti-aliasing of the tile and mark.
    const bytes = runMagick(['png:-', '-filter', 'Lanczos', '-resize', `${size}x${size}!`, '-colorspace', 'sRGB',
      '-channel', 'A', '-fx', 'u < 1.5/255 ? 0 : u', '+channel', '-strip', 'png32:-'], raster);
    assert.deepEqual(pngDimensions(bytes), { width: size, height: size });
    assets.push({ ...writeAsset(`app-icon-${size}.png`, bytes), width: size, height: size, opticalAdjustment: Boolean(optical) });
    return { size, bytes };
  });
  assets.push({ ...writeAsset('app-icon.ico', makeIco(images)), sizes, encoding: 'PNG entries; 32-bit RGBA; Windows Vista and newer' });
  const review = makeReviewSheet(images);
  assert.deepEqual(pngDimensions(review), { width: 1100, height: 1000 });
  assets.push({ ...writeAsset('review-sheet.png', review), width: 1100, height: 1000, purpose: 'design review only; not packaged' });
  const generator = fs.readFileSync(__filename);
  const manifest = {
    schemaVersion: 1,
    design: 'Folded Frame',
    license: 'ISC',
    source: { path: 'assets/app-icon/app-icon.svg', sizeBytes: source.length, sha256: sha256(source), viewBox: [0, 0, 256, 256] },
    provenance: ['PROVENANCE.md', 'LICENSE.txt'].map(name => {
      const bytes = fs.readFileSync(path.join(directory, name));
      return { path: `assets/app-icon/${name}`, sizeBytes: bytes.length, sha256: sha256(bytes) };
    }),
    generator: { path: 'scripts/generate-app-icon.cjs', sha256: sha256(generator), command: 'node scripts/generate-app-icon.cjs' },
    renderer: { tool: version, masterPixels: 1024, opticalPixels: [16, 20, 24, 32], downsample: 'Lanczos', colorspace: 'sRGB', png: '8-bit RGBA' },
    assets,
    validation: { dimensions: 'checked from PNG IHDR', ico: 'directory sizes and exact embedded PNG bytes checked', nativeIntegration: 'not performed by this generator' },
  };
  writeAsset('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  console.log(JSON.stringify({ source: manifest.source, renderer: manifest.renderer, assets }, null, 2));
}

if (require.main === module) main();
