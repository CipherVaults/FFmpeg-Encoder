'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { ENCODE_PRESERVATION_PRODUCER_PATHS } = require('../src/encode-preservation-producers.cjs');
const ROOT = path.resolve(__dirname, '..');
const parent = path.join(ROOT, 'artifacts/v0.7/o-acceptance-2026-10-23/catalog-activation');
function fixture() {
  fs.mkdirSync(parent, { recursive: true }); const root = path.join(parent, randomUUID()); fs.mkdirSync(root);
  for (const file of [...ENCODE_PRESERVATION_PRODUCER_PATHS, 'src/encode-preservation-catalog.cjs']) {
    const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(ROOT, file), target, fs.constants.COPYFILE_EXCL);
  }
  return { root, load: () => {
    const file = path.join(root, 'src/encode-preservation-catalog.cjs'); delete require.cache[require.resolve(file)]; return require(file);
  } };
}
test('fresh exact source staging activates only the reviewed fixed runtime/source class and immutable report', () => {
  const h = fixture(), catalog = h.load();
  assert.equal(catalog.ENCODE_PRESERVATION_POLICIES.length, 1);
  const policy = catalog.ENCODE_PRESERVATION_POLICIES[0];
  assert.equal(policy.sourceClass, require('../src/encode-preservation.cjs').SOURCE_CLASS);
  assert.equal(policy.runtimeIdentity, '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6');
  assert.ok(policy.evidenceIds[0].endsWith('5f66a152788f7db1ae27801d0b7a49dbf2779d9156d3258c9ea9c7aab0d1e0a2'));
  assert.ok(Object.isFrozen(policy) && Object.isFrozen(catalog.ENCODE_PRESERVATION_POLICIES));
});
test('fresh and cached factory loads fail closed after changed/mixed/omitted producer or hidden consent styling', () => {
  for (const file of ['src/encode-preservation.cjs', 'src/media.cjs', 'ui/renderer.js', 'ui/styles.css']) {
    const h = fixture(), catalog = h.load(); assert.equal(catalog.loadEncodePreservationPolicies().length, 1);
    fs.appendFileSync(path.join(h.root, file), '\n/* changed producer or hidden warning styling */\n');
    assert.equal(catalog.loadEncodePreservationPolicies().length, 0); assert.equal(h.load().ENCODE_PRESERVATION_POLICIES.length, 0);
  }
  const h = fixture(); fs.renameSync(path.join(h.root, 'ui/index.html'), path.join(h.root, 'ui/index.saved'));
  assert.equal(h.load().ENCODE_PRESERVATION_POLICIES.length, 0);
  const mixed = fixture(); fs.copyFileSync(path.join(ROOT, 'src/inspection.cjs'), path.join(mixed.root, 'src/media.cjs'));
  assert.equal(mixed.load().ENCODE_PRESERVATION_POLICIES.length, 0);
});
test('normalizing checkout line endings cannot silently renew the raw-byte qualification', () => {
  const h = fixture(), file = path.join(h.root, 'src/media.cjs'), before = fs.readFileSync(file, 'utf8');
  const changed = before.includes('\r\n') ? before.replace(/\r\n/g, '\n') : before.replace(/\n/g, '\r\n');
  assert.notEqual(changed, before); fs.writeFileSync(file, changed);
  assert.equal(h.load().ENCODE_PRESERVATION_POLICIES.length, 0);
});
