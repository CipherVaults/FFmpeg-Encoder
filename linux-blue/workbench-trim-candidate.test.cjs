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
const { createHash } = require('node:crypto');
const { createCalibratedTrimServiceFactory, assertCalibrationReceipt, assertCalibrationSource,
  REPORT, REPORT_SHA } = require('./workbench-trim-candidate.cjs');
const runtime = require('./runtime-candidate.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const configuration = () => ({ pins: runtime.PINS, runtimeIdentity: runtime.RUNTIME_ID,
  verifyTool: async () => {}, createRunner: () => async () => {}, report: REPORT,
  reportSha: REPORT_SHA, policyIdentity: 'unit-calibration-factory' });
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
test('original receipt and factory retain their exact independent candidate identity', () => {
  assert.ok(REPORT.endsWith('/flac-candidate-QY90Bo/report.json'));
  assert.equal(REPORT_SHA, 'da672b3b433d5b0be835c6743b4af677292cd190788f612e21d3ce8172415de1');
  assert.equal(typeof createCalibratedTrimServiceFactory(configuration()), 'function');
  assert.equal(typeof require('./workbench-trim-candidate.cjs').createTrimCandidateService, 'function');
});
test('trusted factory rejects incomplete configuration or a mismatched pair identity', () => {
  for (const change of [c => delete c.reportSha, c => c.extra = true, c => c.runtimeIdentity = 'a'.repeat(64),
    c => c.reportSha = 'invalid', c => c.report = 'relative/report.json', c => c.verifyTool = null,
    c => c.createRunner = null, c => c.policyIdentity = '', c => c.pins = {},
    c => c.pins = { ffmpeg: {}, ffprobe: {} }]) {
    const c = configuration(); change(c);
    assert.throws(() => createCalibratedTrimServiceFactory(c), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  }
  const c = configuration(); Object.defineProperty(c, 'report', { get() { assert.fail('getter evaluated'); } });
  assert.throws(() => createCalibratedTrimServiceFactory(c), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
});
test('receipt admission requires exact bytes, passed cases and both pair-bound qualifications', () => {
  const base = { status: 'passed-calibration-only', runtimeIdentity: runtime.RUNTIME_ID,
    cases: Array.from({ length: 3 }, () => ({ status: 'passed' })), source: { sha256: 'b'.repeat(64) },
    frozen: { qualification: { runtimeIdentity: runtime.RUNTIME_ID }, timingQualification: { runtimeIdentity: runtime.RUNTIME_ID } } };
  const bytes = Buffer.from(JSON.stringify(base)), config = { reportSha: sha(bytes), runtimeIdentity: runtime.RUNTIME_ID };
  assert.deepEqual(assertCalibrationReceipt(bytes, config), base);
  assert.throws(() => assertCalibrationReceipt(Buffer.concat([bytes, Buffer.from('\n')]), config), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  for (const change of [r => r.status = 'failed-retained', r => r.runtimeIdentity = 'c'.repeat(64),
    r => r.cases.pop(), r => r.cases[1].status = 'failed', r => r.cases = null,
    r => r.source.sha256 = 'bad', r => r.frozen.qualification.runtimeIdentity = 'd'.repeat(64),
    r => r.frozen.timingQualification.runtimeIdentity = 'd'.repeat(64), r => delete r.frozen]) {
    const row = structuredClone(base); change(row); const mutated = Buffer.from(JSON.stringify(row));
    assert.throws(() => assertCalibrationReceipt(mutated, { ...config, reportSha: sha(mutated) }), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
  }
  const invalid = Buffer.from('{bad');
  assert.throws(() => assertCalibrationReceipt(invalid, { ...config, reportSha: sha(invalid) }), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
});
test('source guard keeps byte equality, size ceiling and full before/after identity', () => {
  const bytes = Buffer.from('synthetic'), before = { size: String(bytes.length), ino: '1', mtimeNs: '1' };
  assert.doesNotThrow(() => assertCalibrationSource(before, bytes, { ...before }, sha(bytes)));
  for (const [start, data, after, expected] of [
    [before, Buffer.from('modified'), before, sha(bytes)],
    [before, bytes, { ...before, mtimeNs: '2' }, sha(bytes)],
    [{ ...before, size: String(16 * 1024 * 1024 + 1) }, bytes, before, sha(bytes)],
    [before, bytes, before, 'c'.repeat(64)]])
    assert.throws(() => assertCalibrationSource(start, data, after, expected), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
});
