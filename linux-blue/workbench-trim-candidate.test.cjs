'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { CalibratedSourceSelector, CandidateTrimService, DEADLINE_MS } = require('./workbench-trim-candidate.cjs');
const identity = { canonicalPath: '/synthetic.mov', ino: '1', sparseDigest: 'synthetic-unit-identity' };
const fingerprint = 'f'.repeat(64);
const bindings = () => ({ sourceIdentity: structuredClone(identity), sourceProbeFingerprint: fingerprint,
  plan: { compatibilityPath: false, contract: { request: { resolution: 'source', audioPolicy: 'precision-flac', range: { startUs: 1013000, endUs: 3087000 } } } } });
const selector = () => new CalibratedSourceSelector(new OperationFamilySelector({ policyIdentity: 'unit-empty-catalog' }), identity, fingerprint);
test('candidate scope only narrows a genuine shared selector and never invents plan/token authority', () => {
  assert.throws(() => new CalibratedSourceSelector({}, identity, fingerprint), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  const s = selector(), b = bindings();
  assert.throws(() => s.select(b), { code: 'INVALID_ENCODE_OPERATION' });
  assert.throws(() => s.requireCurrent({}, b), { code: 'OPERATION_QUALIFICATION_STALE' });
  assert.throws(() => s.verifyCollectedSource({}, {}), { code: 'OPERATION_SOURCE_FAMILY_MISMATCH' });
  assert.deepEqual(s.orientationQualification({ request: { resolution: '720' } }), {});
});
test('different source, probe, request, audio or resize is refused before the shared selector', () => {
  for (const change of [b => b.sourceIdentity.ino = '2', b => b.sourceProbeFingerprint = 'b'.repeat(64),
    b => b.plan.contract.request.range.endUs++, b => b.plan.contract.request.resolution = '720',
    b => b.plan.contract.request.audioPolicy = 'precision-aac']) {
    const s = selector(), b = bindings(); change(b);
    assert.throws(() => s.select(b), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
    assert.throws(() => s.requireCurrent({}, b), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  }
});
test('candidate Start keeps baseline/ordinary and unqualified routes unavailable', () => {
  const s = new CandidateTrimService({ ffmpeg: '/unused/ffmpeg', ffprobe: '/unused/ffprobe', stateDir: '/unused/state' });
  assert.equal(DEADLINE_MS, 120000);
  assert.throws(() => s.startBatch({ planId: '00000000-0000-0000-0000-000000000000', fileIds: [] }), { code: 'STALE_PLAN' });
  const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
  for (const patch of [{ operation: 'remux' }, { sameFolder: true }, { settings: { ...settings, quality: 26 } }, {}]) {
    s.plan = { operation: 'encode', sameFolder: false, settings, entries: new Map(), ...patch };
    assert.throws(() => s.startBatch({ fileIds: ['synthetic-id'] }), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  }
});
