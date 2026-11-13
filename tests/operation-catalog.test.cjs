'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');

// Record 47 Q2a: one CPU cell plus one NVIDIA cell per measured driver, each
// from its own retained manifest, all with the same frozen pre-encode bounds.
test('the production family catalog holds one CPU cell and one NVIDIA cell per measured driver', () => {
  assert.equal(FAMILIES.length, 5);
  assert.deepEqual(FAMILIES.map(item => [item.id, item.settings.profileId, item.environment?.driverVersion ?? null]),
    [['short-sdr-range-v1', 'h265-cpu', null], ['short-sdr-range-v1', 'h265-nvidia', '621.01'], ['short-sdr-range-v1', 'h265-nvidia', '621.14'],
      ['full-sdr-resize-copy-v1', 'h265-cpu', null], ['full-sdr-resize-copy-v1', 'h265-nvidia', '621.14']]);
  const [, old, current] = FAMILIES;
  assert.deepEqual(current.environment, { ...old.environment, driverVersion: '621.14' });
  for (const key of ['id', 'runtimeIdentity', 'settings', 'budget', 'executionBudgetMs']) assert.deepEqual(current[key], old[key], key);
  assert.deepEqual(current.qualification.tolerances, old.qualification.tolerances);
  assert.deepEqual({ ...current.timingQualification, evidenceId: null }, { ...old.timingQualification, evidenceId: null });
  const prefix = 'sdr-range-20261112:h265-nvidia:91cd933c82437553';
  assert.deepEqual(current.evidenceIds, ['endpoints', 'interior', 'A', 'B', 'C', 'D', 'D-keep', 'E'].map(suffix => `${prefix}:${suffix}`));
  assert.equal(current.qualification.evidenceId, `${prefix}:endpoints`); assert.equal(current.timingQualification.evidenceId, `${prefix}:interior`);
  assert.ok(Object.isFrozen(current) && Object.isFrozen(current.environment));
  assert.match(POLICY_ID, /b794beab835636c75048f52f8e82c8260e6c1c733179e18d6d028e99fb06c82c\+91cd933c82437553dd8046bc5a61511ebb167fa43918414b1cbcdb1dbdf52a90\+48fb030eef87f19cd616e0044c73bc9c3da40b6d3060ba1ba69a2c25b5ad2811$/);
  // The selector accepts the catalog: no two cells share an exact runtime/environment/settings tuple.
  assert.doesNotThrow(() => new OperationFamilySelector({ families: FAMILIES, policyIdentity: POLICY_ID }));
});

// Record 47 Q2b: the whole-file copied-audio cells come from one retained
// manifest, keep their frozen copy bounds and share runtime/settings/budget
// with the matching range cell; only their family and measured scope differ.
test('the whole-file copied-audio cells carry only their frozen copy bounds and evidence ids', () => {
  const full = FAMILIES.filter(item => item.id === 'full-sdr-resize-copy-v1');
  assert.equal(full.length, 2);
  for (const cell of full) {
    const range = FAMILIES.find(item => item.id === 'short-sdr-range-v1' && JSON.stringify(item.settings) === JSON.stringify(cell.settings)
      && JSON.stringify(item.environment) === JSON.stringify(cell.environment));
    assert.ok(range, cell.settings.profileId);
    for (const key of ['runtimeIdentity', 'settings', 'environment', 'budget', 'executionBudgetMs']) assert.deepEqual(cell[key], range[key], key);
    assert.equal(cell.qualification.containerDuration, 'matroska-copy-end-plus-codec-delay');
    assert.deepEqual(cell.qualification.tolerances, { videoTimestampUs: 1067, audioTimestampUs: 1042, avSyncUs: 2109, durationUs: 1088, sampleCount: 0 });
    // Every copy bound is at most the corresponding range bound: nothing was widened.
    for (const [key, value] of Object.entries(cell.qualification.tolerances)) assert.ok(value <= range.qualification.tolerances[key], key);
    assert.deepEqual({ ...cell.timingQualification, evidenceId: null }, { evidenceId: null, runtimeIdentity: range.runtimeIdentity, videoDurationUs: 1067, audioTimelineUs: 1042, aac: null });
    const prefix = `full-copy-20261112:${cell.settings.profileId}:48fb030eef87f19c`;
    assert.deepEqual(cell.evidenceIds, ['endpoints', 'interior', 'A', 'E'].map(suffix => `${prefix}:${suffix}`));
    assert.equal(cell.qualification.evidenceId, `${prefix}:endpoints`); assert.equal(cell.timingQualification.evidenceId, `${prefix}:interior`);
    assert.ok(Object.isFrozen(cell) && Object.isFrozen(cell.qualification.tolerances));
  }
});
