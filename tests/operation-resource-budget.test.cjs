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

test('1080p resize charges pixel-derived decode and scaling time but not PCM or record bytes', () => {
  const { deriveCfrResizeFlacResources, RESIZE_RESOURCE_POLICY, RESIZE_FAMILY_ID } = require('../src/operation-resource-budget.cjs');
  const options = { sourceExtentUs: 150000000, selectedExtentUs: 40000000, sourceBytes: '100000000' };
  const base = make(), resized = deriveCfrResizeFlacResources(options);
  assert.equal(RESIZE_RESOURCE_POLICY, 'cfr1080p30-to720p-flac-resources-v1');
  assert.equal(RESIZE_FAMILY_ID, 'cfr-sdr-range-resize-flac-v1');
  const extra = 150 * (3375 - 1500) + 40 * 3375;
  assert.equal(resized.budget.timeoutMs, base.budget.timeoutMs + extra);
  assert.equal(resized.executionBudgetMs, base.executionBudgetMs + 2 * extra);
  assert.deepEqual(resized.resources, base.resources);
  assert.deepEqual({ ...resized.budget, timeoutMs: base.budget.timeoutMs }, base.budget);
  assert.ok(Object.isFrozen(resized) && Object.isFrozen(resized.budget));
  const fractional = deriveCfrResizeFlacResources({ ...options, sourceExtentUs: 150000001, selectedExtentUs: 40000001 });
  assert.equal(fractional.budget.timeoutMs - resized.budget.timeoutMs, 3375 + 3375 + 15000);
  for (const patch of [{ selectedExtentUs: 150000001 }, { sourceBytes: '9007199254740991' }, { sourceExtentUs: Number.MAX_SAFE_INTEGER }])
    assert.throws(() => deriveCfrResizeFlacResources({ ...options, ...patch }), { code: 'OPERATION_RESOURCE_CAPACITY' });
});

test('Full resize budgets all observed source extent without a caller-selected interval', () => {
  const { FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY, deriveCfrFullResizeFlacResources, deriveCfrResizeFlacResources } = require('../src/operation-resource-budget.cjs');
  assert.equal(FULL_RESIZE_FAMILY_ID, 'cfr-sdr-full-resize-flac-v1');
  assert.equal(FULL_RESIZE_RESOURCE_POLICY, 'cfr1080p30-full-to720p-flac-resources-v1');
  const options = { sourceExtentUs: 151250000, sourceBytes: '100000000' };
  const full = deriveCfrFullResizeFlacResources(options);
  assert.deepEqual(full, deriveCfrResizeFlacResources({ ...options, selectedExtentUs: options.sourceExtentUs }));
  assert.deepEqual(full, deriveCfrFullResizeFlacResources({ ...options, selectedExtentUs: 1 }));
  assert.equal(full.budget.maxPcmBytes, 151.25 * 48000 * 4 + 192000);
  assert.ok(full.resources.telemetryRecords >= 151.25 * 256);
  assert.ok(Object.isFrozen(full) && Object.isFrozen(full.resources));
  for (const patch of [{ sourceExtentUs: 0 }, { sourceExtentUs: Number.MAX_SAFE_INTEGER }, { sourceBytes: '9007199254740991' }])
    assert.throws(() => deriveCfrFullResizeFlacResources({ ...options, ...patch }), { code: 'OPERATION_RESOURCE_CAPACITY' });
});
