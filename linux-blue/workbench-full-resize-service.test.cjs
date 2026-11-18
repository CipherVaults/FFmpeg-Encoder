'use strict';
const specimens = require('./test-fixtures/proportional-reports.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createFullResizeService, assertFullResizeReceipt, REPORT, REPORT_SHA } = require('./workbench-full-resize-service.cjs');
const range = require('./workbench-resize-service.cjs');
const { FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY, deriveCfrFullResizeFlacResources } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const sha = b => createHash('sha256').update(b).digest('hex');
const check = value => { const bytes = Buffer.from(JSON.stringify(value)); return assertFullResizeReceipt(bytes, sha(bytes)); };
async function synthetic() { return specimens.calibration('fullResize1080to720'); }
test('pending Full service refuses before files, runtime, storage or children', async () => {
  const pending = require('./workbench-long-range-service.cjs').createProportionalServiceFactory({
    kind: 'fullResize1080to720', report: path.resolve('/never-created/report.json'), reportSha: null });
  await assert.rejects(pending.createService({ stateDir: '/never-created', onChild() { assert.fail('child'); } }), /pending/);
  assert.throws(() => pending.assertReceipt(Buffer.from('{}')), /pending/);
});
test('portable Full schema cannot replace the pinned historical calibration', async () => {
  const bytes = specimens.bytes(await synthetic());
  assert.equal(REPORT_SHA, '197c1fc42a4108a9e5b2e4997588a828acd7c4c2aa8a7fe23772376e1535e871');
  assert.notEqual(sha(bytes),REPORT_SHA);assert.throws(()=>assertFullResizeReceipt(bytes),/exact reviewed/);assert.equal(assertFullResizeReceipt(bytes,sha(bytes)).cases.length,2);
});
test('Full receipt requires complete distinct source extents, family and null interval', async () => {
  const r = await synthetic(); assert.deepEqual(check(r), r);
  for (const mutate of [v => { v.cases[0].range = { startUs: 0 }; }, v => { v.cases[0].validation.timing.resolved = { startUs: 0, endUs: 150000000 }; },
    v => { v.cases[1].validation.timing.timeline = 'request-relative'; }, v => { v.cases[1].samples = 2068800; },
    v => { v.cases[1].completeSource.audio[0].sampleCount = '2068800'; }, v => { v.cases[1].frames++; },
    v => { v.sources[1].probe.streams[1].duration = '43.1'; }, v => { v.sources[1].sourceExtentUs = 43100000; },
    v => { v.cases[1].completeSource.video.properties.policy = 'cfr-sdr-range-resize-flac-v1'; },
    v => { v.resourcePolicy = 'cfr1080p30-to720p-flac-resources-v1'; }, v => { v.geometry.resolution = 'source'; },
    v => { v.cases[0].resources.budget.timeoutMs--; }, v => { v.sources[0].frozen.qualification.tolerances.durationUs++; },
    v => { v.cases[0].pcmIdentity.outputHash = '0'.repeat(64); }, v => { v.cases.pop(); }]) {
    const bad = structuredClone(r); mutate(bad); assert.throws(() => check(bad), { code: 'LINUX_LONG_RANGE_SCOPE' });
  }
  const old = specimens.bytes(specimens.calibration('resize1080to720'));
  assert.throws(() => assertFullResizeReceipt(old, sha(old)), /pre-catalog/);
  assert.equal(range.assertResizeReceipt(old,sha(old)).status, 'passed-pre-catalog-calibration');
});
test('Full composition is a fixed main-only third variant and does not activate an app', async () => {
  const text = await fs.readFile(path.join(__dirname, 'workbench-full-resize-service.cjs'), 'utf8');
  assert.match(text, /kind: 'fullResize1080to720'/); assert.doesNotMatch(text, /process\.argv|process\.env|ipcMain/);
  for (const filename of ['workbench-main.cjs', 'workbench-av1-service.cjs'])
    assert.ok(!(await fs.readFile(path.join(__dirname, filename), 'utf8')).includes('workbench-full-resize-service'));
});
