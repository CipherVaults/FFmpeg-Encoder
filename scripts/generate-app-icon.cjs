'use strict';

// Assemble the owner-selected Gauge from the exact reviewed PNG exports.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const root = path.resolve(__dirname, '..');
const reviewDirectory = path.join(root, 'assets', 'logo-gauge-2026-11-14');
const outputDirectory = path.join(root, 'assets', 'app-icon');
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

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

function readReviewedImage(name, hashes) {
  const filename = path.join(reviewDirectory, name);
  assert(fs.lstatSync(filename).isFile(), `${name} must be a regular file.`);
  const bytes = fs.readFileSync(filename);
  assert.equal(sha256(bytes), hashes[name], `${name} differs from the reviewed asset.`);
  return bytes;
}

function main() {
  const args = process.argv.slice(2);
  assert(args.length === 0 || (args.length === 1 && args[0] === '--check'),
    'Usage: node scripts/generate-app-icon.cjs [--check]');
  const { hashes } = JSON.parse(fs.readFileSync(path.join(reviewDirectory, 'verification.json'), 'utf8'));
  const svg = readReviewedImage('gauge-win-midtone-256.svg', hashes);
  const images = sizes.map(size => {
    const name = `gauge-win-midtone-${size}.png`;
    const bytes = readReviewedImage(name, hashes);
    assert.deepEqual(pngDimensions(bytes), { width: size, height: size });
    return { name, size, bytes };
  });
  const outputs = new Map([
    ['app-icon.svg', svg],
    ['app-icon-256.png', images.find(image => image.size === 256).bytes],
    ['app-icon.ico', makeIco(images)],
  ]);
  assert(fs.lstatSync(outputDirectory).isDirectory(), 'Asset directory must be a real directory.');
  const describe = (filename, bytes) => ({ path: filename, sizeBytes: bytes.length, sha256: sha256(bytes) });
  const manifest = {
    schemaVersion: 1,
    design: 'Gauge, mid-tone Windows variant',
    license: 'ISC',
    verification: 'assets/logo-gauge-2026-11-14/verification.json',
    source: describe('assets/logo-gauge-2026-11-14/gauge-win-midtone-256.svg', svg),
    icoEntries: images.map(({ name, size, bytes }) => ({
      ...describe(`assets/logo-gauge-2026-11-14/${name}`, bytes), width: size, height: size,
    })),
    generator: describe('scripts/generate-app-icon.cjs', fs.readFileSync(__filename)),
    assets: [...outputs].map(([name, bytes]) => describe(`assets/app-icon/${name}`, bytes)),
  };
  outputs.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'));
  for (const name of outputs.keys()) {
    const filename = path.join(outputDirectory, name);
    const stat = fs.lstatSync(filename, { throwIfNoEntry: false });
    assert(stat === undefined || stat.isFile(), `${name} must be a regular file.`);
  }
  for (const [name, bytes] of outputs) {
    const filename = path.join(outputDirectory, name);
    if (args[0] === '--check') {
      assert.deepEqual(fs.readFileSync(filename), bytes, `${name} differs from the reviewed Gauge assembly.`);
    } else {
      fs.writeFileSync(filename, bytes);
    }
  }
  console.log(JSON.stringify(manifest.assets, null, 2));
}

if (require.main === module) main();
