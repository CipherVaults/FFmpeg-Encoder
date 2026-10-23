'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, randomUUID } = require('node:crypto');
const { verifySourceCatalogSeals } = require('../src/source-catalog-seals.cjs');
const parent = path.resolve(__dirname, '../artifacts/v0.7/o-acceptance-2026-10-23/catalog-unit');
function fixture() {
  fs.mkdirSync(parent, { recursive: true }); const root = path.join(parent, randomUUID()); fs.mkdirSync(root); fs.mkdirSync(path.join(root, 'src'));
  const pins = {};
  for (let i = 0; i < 16; i++) {
    const name = 'src/module-' + i + '.cjs', bytes = Buffer.from(`'use strict';\r\n// inert producer ${i}\r\n`);
    fs.writeFileSync(path.join(root, name), bytes, { flag: 'wx' }); pins[name] = createHash('sha256').update(bytes).digest('hex');
  }
  return { root, pins };
}
test('raw executed-byte seals refuse absent, altered, mixed and newline-normalized producers', () => {
  const h = fixture(); assert.equal(verifySourceCatalogSeals(h.pins, h.root), true);
  const file = path.join(h.root, 'src/module-0.cjs'), before = fs.readFileSync(file);
  for (const value of [Buffer.from('changed'), Buffer.from(before.toString().replace(/\r\n/g, '\n')), fs.readFileSync(path.join(h.root, 'src/module-1.cjs'))]) {
    fs.writeFileSync(file, value); assert.equal(verifySourceCatalogSeals(h.pins, h.root), false);
  }
  fs.writeFileSync(file, before); assert.equal(verifySourceCatalogSeals(h.pins, h.root), true);
  fs.renameSync(file, file + '.saved'); assert.equal(verifySourceCatalogSeals(h.pins, h.root), false);
});
test('actual extra hardlink and modeled ancestor junction cannot substitute for ordinary reviewed producers', () => {
  const h = fixture(), file = path.join(h.root, 'src/module-0.cjs');
  fs.linkSync(file, path.join(h.root, 'extra-link')); assert.equal(verifySourceCatalogSeals(h.pins, h.root), false);
  const ordinary = fixture(), sourceDir = path.join(ordinary.root, 'src'), stub = Object.create(fs);
  stub.lstatSync = (file, options) => file === sourceDir ? { isDirectory: () => true, isSymbolicLink: () => true } : fs.lstatSync(file, options);
  const context = { module: { exports: {} }, __dirname: path.resolve(__dirname, '../src'), process,
    require: name => name === 'node:fs' ? stub : require(name) };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../src/source-catalog-seals.cjs'), 'utf8'), context);
  assert.equal(context.module.exports.verifySourceCatalogSeals(ordinary.pins, ordinary.root), false);
  // The junction above is injected evidence, not a new native-link success.
});
test('a linked/nonregular resource, path escape or incomplete pin set remains refused', () => {
  const h = fixture();
  assert.equal(verifySourceCatalogSeals({ ...h.pins, '../escape': 'a'.repeat(64) }, h.root), false);
  assert.equal(verifySourceCatalogSeals({ ...h.pins, 'src/encode-preservation-catalog.cjs': 'bad' }, h.root), false);
  assert.equal(verifySourceCatalogSeals({}, h.root), false);
  fs.renameSync(path.join(h.root, 'src/module-0.cjs'), path.join(h.root, 'src/saved.cjs'));
  fs.mkdirSync(path.join(h.root, 'src/module-0.cjs')); assert.equal(verifySourceCatalogSeals(h.pins, h.root), false);
});
