'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');

// Record 47 Q2a: one CPU cell plus one NVIDIA cell per measured driver, each
// from its own retained manifest, all with the same frozen pre-encode bounds.
test('the production family catalog holds one CPU cell and one NVIDIA cell per measured driver', () => {
  assert.equal(FAMILIES.length, 3);
  assert.deepEqual(FAMILIES.map(item => [item.settings.profileId, item.environment?.driverVersion ?? null]),
    [['h265-cpu', null], ['h265-nvidia', '621.01'], ['h265-nvidia', '621.14']]);
  const [, old, current] = FAMILIES;
  assert.deepEqual(current.environment, { ...old.environment, driverVersion: '621.14' });
  for (const key of ['id', 'runtimeIdentity', 'settings', 'budget', 'executionBudgetMs']) assert.deepEqual(current[key], old[key], key);
  assert.deepEqual(current.qualification.tolerances, old.qualification.tolerances);
  assert.deepEqual({ ...current.timingQualification, evidenceId: null }, { ...old.timingQualification, evidenceId: null });
  const prefix = 'sdr-range-20261112:h265-nvidia:91cd933c82437553';
  assert.deepEqual(current.evidenceIds, ['endpoints', 'interior', 'A', 'B', 'C', 'D', 'D-keep', 'E'].map(suffix => `${prefix}:${suffix}`));
  assert.equal(current.qualification.evidenceId, `${prefix}:endpoints`); assert.equal(current.timingQualification.evidenceId, `${prefix}:interior`);
  assert.ok(Object.isFrozen(current) && Object.isFrozen(current.environment));
  assert.match(POLICY_ID, /b794beab835636c75048f52f8e82c8260e6c1c733179e18d6d028e99fb06c82c\+91cd933c82437553dd8046bc5a61511ebb167fa43918414b1cbcdb1dbdf52a90$/);
  // The selector accepts the catalog: no two cells share an exact runtime/environment/settings tuple.
  assert.doesNotThrow(() => new OperationFamilySelector({ families: FAMILIES, policyIdentity: POLICY_ID }));
});
