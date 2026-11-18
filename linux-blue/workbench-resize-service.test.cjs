'use strict';
const specimens = require('./test-fixtures/proportional-reports.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createResizeService, assertResizeReceipt, REPORT, REPORT_SHA } = require('./workbench-resize-service.cjs');
const previous = require('./workbench-long-range-service.cjs');
const { RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY, deriveCfrResizeFlacResources } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { RUNTIME_ID } = require('./runtime-av1.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const check = value => { const bytes = Buffer.from(JSON.stringify(value)); return assertResizeReceipt(bytes, sha(bytes)); };
async function syntheticReport() { return specimens.calibration('resize1080to720'); }
test('portable resize schema binds supplied test bytes while live pins and pending factories stay closed', async () => {
  assert.equal(REPORT_SHA, 'dd0637354ea1ca27e57c75958074423aff98f37ab6da00a3459a6dac2b206c32');
  const pending = previous.createProportionalServiceFactory({ kind: 'resize1080to720', report: REPORT, reportSha: null });
  await assert.rejects(pending.createService({ stateDir: '/must-not-exist', onChild() { assert.fail('child'); } }), /pending/);
  assert.throws(() => pending.assertReceipt(Buffer.from('{}')), /pending/);
  assert.throws(() => assertResizeReceipt(Buffer.from('{}')), /exact reviewed/);
  const bytes=specimens.bytes(await syntheticReport());assert.equal(assertResizeReceipt(bytes,sha(bytes)).status,'passed-pre-catalog-calibration');assert.throws(()=>assertResizeReceipt(bytes),/exact reviewed/);
});
test('resize receipt independently binds geometry, policy, clocks, resources and all evidence', async () => {
  const value = await syntheticReport(); assert.deepEqual(check(value), value);
  for (const mutate of [r => { delete r.geometry; }, r => { r.geometry.resolution = 'source'; },
    r => { r.geometry.outputWidth = 1920; }, r => { r.sources[0].probe.streams[0].width = 1280; },
    r => { r.resourcePolicy = 'cfr720p30-flac-resources-v1'; }, r => { r.cases[0].completeSource.video.properties.policy = 'cfr-sdr-range-flac-v2'; },
    r => { r.sources[0].probe.streams[0].time_base = '1/30000'; }, r => { r.sources[0].frozen.qualification.tolerances.videoTimestampUs++; },
    r => { r.cases[0].resources.budget.timeoutMs--; }, r => { r.cases[1].status = 'encoding'; }, r => { r.cases.pop(); },
    r => { r.cases[0].completeSource.video.frames--; }, r => { r.cases[0].pcmIdentity.outputHash = '0'.repeat(64); }]) {
    const bad = structuredClone(value); mutate(bad); assert.throws(() => check(bad), { code: 'LINUX_LONG_RANGE_SCOPE' });
  }
  const original = specimens.bytes(specimens.calibration('keep720'));
  assert.throws(() => assertResizeReceipt(original, sha(original)), /pre-catalog/);
  assert.equal(previous.assertLongRangeReceipt(original,sha(original)).status, 'passed-pre-catalog-calibration');
});
test('trusted factory rejects hidden or arbitrary configuration and snapshots pending state', async () => {
  const { createProportionalServiceFactory } = previous;
  for (const config of [{}, { kind: 'other', report: REPORT, reportSha: null },
    { kind: 'resize1080to720', report: REPORT, reportSha: null, runtime: 'other' },
    { kind: 'resize1080to720', report: 'relative', reportSha: null }])
    assert.throws(() => createProportionalServiceFactory(config), { code: 'LINUX_LONG_RANGE_SCOPE' });
  const hidden = { kind: 'resize1080to720', report: REPORT, get reportSha() { assert.fail('getter'); } };
  assert.throws(() => createProportionalServiceFactory(hidden), /inert/);
  const config = { kind: 'resize1080to720', report: REPORT, reportSha: null };
  const factory = createProportionalServiceFactory(config); config.reportSha = 'a'.repeat(64);
  await assert.rejects(factory.createService(), /pending/);
});
test('resize composition is separate, fixed, and absent from application entry points', async () => {
  for (const name of ['workbench-main.cjs', 'workbench-av1-service.cjs'])
    assert.ok(!(await fs.readFile(path.join(__dirname, name), 'utf8')).includes('workbench-resize-service'));
  const source = await fs.readFile(path.join(__dirname, 'workbench-resize-service.cjs'), 'utf8');
  assert.doesNotMatch(source, /process\.argv|process\.env|ipcMain|CalibratedSourceSelector/);
  assert.match(source, /kind: 'resize1080to720'/);
});
