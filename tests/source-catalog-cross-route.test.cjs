'use strict';

// The existing source-catalog-seals implementation is deliberately unchanged.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash, randomUUID } = require('node:crypto');
const { verifySourceCatalogSeals } = require('../src/source-catalog-seals.cjs');
const { ENCODE_PRESERVATION_PRODUCER_PATHS } = require('../src/encode-preservation-producers.cjs');
const ROOT = path.resolve(__dirname, '..');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t) {
  const parent = path.join(ROOT, 'artifacts/v0.7/p-completion-2026-10-23/qualification-maintenance-fixtures');
  fs.mkdirSync(parent, { recursive: true }); const root = path.join(parent, randomUUID()); fs.mkdirSync(root);
  const pins = {};
  for (let index = 0; index < 16; index++) {
    const relative = 'src/module-' + index + '.cjs', file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const bytes = Buffer.from(`ordinary generic producer ${index}\r\n`);
    fs.writeFileSync(file, bytes, { flag: 'wx' }); pins[relative] = sha(bytes);
  }
  t.diagnostic('Retained synthetic cross-route seal fixture ' + root);
  return { root, pins };
}

test('generic source reader still accepts its original ordinary source scope', t => {
  const h = fixture(t); assert.equal(verifySourceCatalogSeals(h.pins, h.root), true);
});

for (const relative of ['resources/hdr-content-configurations.json',
  'resources/hdr-sdr-content-configurations.json', 'resources/hdr-content-producers.json']) {
  test('generic reader never gains HDR resource authority for ' + relative, t => {
    const h = fixture(t), bytes = Buffer.from('{"schema":1,"synthetic":true}\r\n');
    const file = path.join(h.root, relative); fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, bytes, { flag: 'wx' });
    // All bytes/digests exist and match, and the pin count remains in the valid range.
    // Only the reader's fixed path policy should cause this refusal.
    assert.equal(verifySourceCatalogSeals({ ...h.pins, [relative]: sha(bytes) }, h.root), false);
  });
}

test('Full closure adds only operation naming and cannot hash itself or borrow HDR resources', () => {
  const expected = [
    'main.js', 'preload.js', 'package.json', 'resources/candidate-binary-manifest.json',
    'src/candidate-runtime.cjs', 'src/diagnostics.cjs', 'src/encode-operation.cjs',
    'src/encode-preservation.cjs', 'src/encode-preservation-producers.cjs', 'src/encode-preservation-workspace.cjs',
    'src/encoder-service.cjs', 'src/inspection.cjs', 'src/inspection-cache.cjs', 'src/ipc.cjs', 'src/local-protocol.cjs',
    'src/media.cjs', 'src/media-evidence.cjs', 'src/operation-contract.cjs', 'src/operation-controls.cjs',
    'src/operation-draft.cjs', 'src/operation-names.cjs', 'src/operation-runtime.cjs', 'src/outputs.cjs', 'src/output-access.cjs',
    'src/process-runner.cjs', 'src/provenance.cjs', 'src/source-catalog-seals.cjs', 'src/source-identity.cjs',
    'src/storage-eligibility.cjs', 'ui/index.html', 'ui/renderer.js', 'ui/styles.css',
  ].sort();
  assert.equal(expected.length, 32);
  assert.deepEqual([...ENCODE_PRESERVATION_PRODUCER_PATHS].sort(), expected);
  assert.ok(Object.isFrozen(ENCODE_PRESERVATION_PRODUCER_PATHS));
  for (const forbidden of ['src/encode-preservation-catalog.cjs', 'src/hdr-catalog.cjs',
    'resources/hdr-content-producers.json', 'resources/hdr-content-configurations.json',
    'resources/hdr-sdr-content-configurations.json']) {
    assert.ok(!ENCODE_PRESERVATION_PRODUCER_PATHS.includes(forbidden));
  }
});

function syntheticFull(pins, maintenance = 'b'.repeat(64)) {
  let source = fs.readFileSync(path.join(ROOT, 'src/encode-preservation-catalog.cjs'), 'utf8');
  const mapPattern = /const PRODUCERS = Object\.freeze\(\{[\s\S]*?\}\);/g;
  const maintenancePattern = /const MAINTENANCE_EVIDENCE = (null|'[a-f0-9]+');/g;
  assert.equal([...source.matchAll(mapPattern)].length, 1);
  assert.equal([...source.matchAll(maintenancePattern)].length, 1);
  source = source.replace(mapPattern, 'const PRODUCERS = Object.freeze(' + JSON.stringify(pins) + ');')
    .replace(maintenancePattern, 'const MAINTENANCE_EVIDENCE = ' + JSON.stringify(maintenance) + ';');
  let verifierCalls = 0;
  const context = { module: { exports: {} }, require: name => {
    if (name === './encode-preservation-producers.cjs') return { ENCODE_PRESERVATION_PRODUCER_PATHS };
    assert.equal(name, './source-catalog-seals.cjs');
    // Isolate membership enforcement: an approving byte verifier must never
    // compensate for a missing/extra producer in this catalog's own closure.
    return { verifySourceCatalogSeals: () => { verifierCalls++; return true; } };
  } };
  vm.runInNewContext(source, context);
  const initial = context.module.exports.ENCODE_PRESERVATION_POLICIES;
  const fresh = context.module.exports.loadEncodePreservationPolicies();
  return { initial: JSON.parse(JSON.stringify(initial)), fresh: JSON.parse(JSON.stringify(fresh)), verifierCalls };
}

test('synthetic activated Full route requires every exact producer key before its byte verifier', () => {
  const pins = Object.fromEntries(ENCODE_PRESERVATION_PRODUCER_PATHS.map(relative => [relative, 'a'.repeat(64)]));
  const valid = syntheticFull(pins);
  assert.equal(valid.initial.length, 1); assert.deepEqual(valid.fresh, valid.initial);
  assert.equal(valid.initial[0].id, 'full-encode-linked-tmcd-v1');
  assert.equal(valid.verifierCalls, 2);
  for (const missing of ENCODE_PRESERVATION_PRODUCER_PATHS) {
    const incomplete = { ...pins }; delete incomplete[missing];
    const result = syntheticFull(incomplete);
    assert.deepEqual(result.initial, [], missing); assert.deepEqual(result.fresh, [], missing);
    assert.equal(result.verifierCalls, 0, missing);
  }
  for (const extra of ['src/encode-preservation-catalog.cjs', 'resources/hdr-sdr-content-configurations.json', 'src/unreviewed.cjs']) {
    const result = syntheticFull({ ...pins, [extra]: 'a'.repeat(64) });
    assert.deepEqual(result.initial, [], extra); assert.deepEqual(result.fresh, [], extra);
    assert.equal(result.verifierCalls, 0, extra);
  }
  const pending = syntheticFull(pins, null);
  assert.deepEqual(pending.initial, []); assert.deepEqual(pending.fresh, []);
  assert.equal(pending.verifierCalls, 0);
});
