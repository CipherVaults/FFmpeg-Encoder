 'use strict';
// Experimental acquisition authority only. No catalog/service activation or import-time work.
const assert = require('node:assert/strict');
const { requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { describeEncodeOperationSource, fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { OperationFamilySelector, assertProportionalCollectionSelection } = require('../src/operation-family.cjs');
const { UHD_FULL_FAMILY_ID, UHD_FULL_RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const SETTINGS = Object.freeze({profileId:'h265-cpu',preset:'slow',quality:25});
function candidateSelector(evidenceId,runtimeIdentity,sourceProbe) {
 const frozen=frozenQualifications(evidenceId,runtimeIdentity,sourceProbe);
 const selector=new OperationFamilySelector({policyIdentity:evidenceId,families:[{
 id:UHD_FULL_FAMILY_ID,resourcePolicy:UHD_FULL_RESOURCE_POLICY,runtimeIdentity,environment:null,settings:SETTINGS,
 qualification:frozen.qualification,timingQualification:frozen.timingQualification,
 evidenceIds:[frozen.qualification.evidenceId,frozen.timingQualification.evidenceId]}]});
 return {selector,frozen};
}
async function prepareUhdFullCase(options) {
  assert.ok(options && Object.getPrototypeOf(options) === Object.prototype);
  const keys = ['verifiedRuntime', 'plan', 'sourceIdentity', 'evidenceId'];
  assert.deepEqual(Reflect.ownKeys(options).sort(), [...keys].sort());
  for (const key of keys) assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(options, key), 'value'), 'Inert case fields required');
  const runtime = requireCandidateCalibrationRuntime(options.verifiedRuntime);
  const { plan, evidenceId } = options;
  const sourceProbe = describeEncodeOperationSource(plan);
  const identityKeys = ['canonicalPath', 'dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs', 'sparseDigest'];
  assert.ok(options.sourceIdentity && [Object.prototype, null].includes(Object.getPrototypeOf(options.sourceIdentity)));
  assert.deepEqual(Reflect.ownKeys(options.sourceIdentity).sort(), [...identityKeys].sort());
  for (const key of identityKeys) { const d = Object.getOwnPropertyDescriptor(options.sourceIdentity, key);
    assert.ok(d.enumerable && Object.hasOwn(d, 'value') && typeof d.value === 'string', 'Inert source identity required'); }
  const sourceIdentity = Object.freeze({ ...options.sourceIdentity });
  await runtime.requireCurrent();
  assert.deepEqual(await readSourceIdentity(sourceIdentity.canonicalPath), sourceIdentity, 'Candidate source changed before selection');
  const { selector, frozen } = candidateSelector(evidenceId, runtime.runtimeIdentity, sourceProbe);
  const bindings = { plan, sourceIdentity, sourceProbeFingerprint: fingerprintEncodeSource(sourceProbe),
    runtimeIdentity: runtime.runtimeIdentity, environment: null, settings: SETTINGS, budget: null, executionBudgetMs: 120000 };
  const token = selector.select(bindings), selection = selector.requireCurrent(token, bindings);
  const preflight = () => assertProportionalCollectionSelection(selection, { plan, sourcePath: sourceIdentity.canonicalPath,
    sourceProbe, budget: selection.budget, timingQualification: selection.timingQualification, sourcePolicy: selection.sourcePolicy });
  preflight();
  const resources = Object.freeze({ budget: selection.budget, resources: selection.resources, executionBudgetMs: selection.executionBudgetMs });
  return Object.freeze({ selection, resources, frozen,
    boundsClassification: 'preregistered-clock-derived-acceptance-bounds; not measured production qualification',
    async requireCurrent() {
      await runtime.requireCurrent();
      assert.deepEqual(await readSourceIdentity(sourceIdentity.canonicalPath), sourceIdentity, 'Candidate source changed since selection');
      selector.requireCurrent(token, bindings); preflight(); return selection;
    },
    close() { selector.invalidate('Developer calibration case closed.'); },
  });
}

module.exports={candidateSelector,prepareUhdFullCase};
