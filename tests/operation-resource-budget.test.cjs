'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { RESOURCE_POLICY, FAMILY_ID, deriveCfrFlacResources } = require('../src/operation-resource-budget.cjs');
const make = options => deriveCfrFlacResources({ sourceExtentUs: 150000000, selectedExtentUs: 40000000, sourceBytes: '100000000', ...options });
test('proportional forecasts include complete source PCM, selected telemetry and all pipe passes', () => {
  const r = make();
  assert.equal(RESOURCE_POLICY, 'cfr720p30-flac-resources-v1'); assert.equal(FAMILY_ID, 'cfr-sdr-range-flac-v2');
  assert.equal(r.budget.maxPcmBytes, 150 * 48000 * 4 + 192000);
  assert.equal(r.budget.maxRecords, 20000 + 150 * 256);
  assert.equal(r.budget.maxFrameBytes, r.budget.maxRecords * 1024);
  assert.equal(r.resources.telemetryRecords, 1024 + 40 * 256);
  assert.equal(r.resources.telemetryBytes, r.resources.telemetryRecords * 256);
  assert.ok(r.resources.evidenceBytes > r.budget.maxPcmBytes * 2);
  assert.ok(r.resources.evidenceReserveBytes > r.budget.maxSpoolBytes + r.resources.telemetryBytes * 2);
  assert.ok(r.executionBudgetMs > r.budget.timeoutMs && r.budget.timeoutMs > 120000);
  assert.ok(Object.isFrozen(r) && Object.isFrozen(r.budget) && Object.isFrozen(r.resources));
});
test('source extent, selection and file size each affect their relevant resource forecasts', () => {
  const base = make(), source = make({ sourceExtentUs: 300000000 }), selection = make({ selectedExtentUs: 80000000 });
  assert.ok(source.budget.maxPcmBytes > base.budget.maxPcmBytes && source.budget.maxRecords > base.budget.maxRecords);
  assert.ok(source.executionBudgetMs > base.executionBudgetMs);
  assert.ok(selection.resources.evidenceReserveBytes > base.resources.evidenceReserveBytes);
  assert.ok(selection.resources.telemetryRecords > base.resources.telemetryRecords);
  const largeShort = make({ sourceExtentUs: 10000000, selectedExtentUs: 1000000, sourceBytes: String(100 * 1024 ** 3) });
  const smallShort = make({ sourceExtentUs: 10000000, selectedExtentUs: 1000000, sourceBytes: '1000' });
  assert.ok(largeShort.executionBudgetMs > smallShort.executionBudgetMs);
  assert.ok(largeShort.budget.timeoutMs > smallShort.budget.timeoutMs);
});
test('forecasts round conservatively and fail capacity rather than clamp or disable limits', () => {
  const r = make({ sourceExtentUs: 150000001, selectedExtentUs: 40000001 });
  assert.equal(r.budget.maxRecords, 20000 + 151 * 256);
  assert.equal(r.budget.maxPcmBytes, (150 * 48000 + 1) * 4 + 192000);
  for (const patch of [{ sourceExtentUs: 0 }, { selectedExtentUs: 150000001 }, { sourceExtentUs: Infinity },
    { sourceExtentUs: Number.MAX_SAFE_INTEGER }, { selectedExtentUs: 1.5 }, { sourceBytes: '0' },
    { sourceBytes: '-1' }, { sourceBytes: '1e6' }, { sourceBytes: '9007199254740992' },
    { sourceExtentUs: 3600000000, selectedExtentUs: 3599000000 },
    { sourceBytes: '9007199254740991' }])
    assert.throws(() => make(patch), { code: 'OPERATION_RESOURCE_CAPACITY' });
});
