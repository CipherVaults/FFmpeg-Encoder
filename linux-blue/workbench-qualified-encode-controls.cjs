'use strict';
// Main-only controls: preserved three-family fallback plus qualified four-family app.
// Ordinary inspection/compatibility execution must retain its separate runner.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const keep = require('./workbench-long-range-service.cjs');
const resize = require('./workbench-resize-service.cjs');
const full = require('./workbench-full-resize-service.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { PINS, RUNTIME_ID, verifyAv1Tool } = require('./runtime-av1.cjs');
const { createAv1ProportionalRunner } = require('./runtime-av1-operation.cjs');
const { FAMILY_ID, RESOURCE_POLICY, RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY, FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY, FULL_1440_RESIZE_FAMILY_ID, FULL_1440_RESIZE_RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const OBSERVER_SHA = '177f139bc1913051f9754673a21dd2ecb60f5dcba38f91785f84ab56d8159b1c';
const SERVICE_PROOFS = Object.freeze({
  fullResize1440to720: Object.freeze({ report: path.join(__dirname, 'artifacts', 'full-1440-service-QbU79l', 'report.json'),
    sha256: '44b2dda7486b274e5afd94b4bdb69c757667b4ba02261e131e5a97152d816be5' }),
  keep720: Object.freeze({ report: path.join(__dirname, 'artifacts', 'long-range-service-eQZdcB', 'report.json'),
    sha256: '6d0d49b83ec5bf01a5c5aca977f412e83a8205dd6ad1e43ee558e5a5701e8039' }),
  resize1080to720: Object.freeze({ report: path.join(__dirname, 'artifacts', 'resize-service-BbTuXB', 'report.json'),
    sha256: '48b8ec4e3e1a7277072bdd8d4bffd4c0a820b24a60d2f49aee6ef48f5f8f1381' }),
  fullResize1080to720: Object.freeze({ report: path.join(__dirname, 'artifacts', 'full-resize-service-pgkknH', 'report.json'),
    sha256: '77e03609a3806ce1f3d7d8041791ae82f07043f3c9dcd0b5ebe854742da49a9b' }),
});
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function need(ok, message) { if (!ok) throw Object.assign(new Error(message), { code: 'LINUX_QUALIFIED_CONTROLS' }); }
const casesFor = (full, full1440) => [...(full1440 ? ['full-1440', 'full-1440-calibrated-audio-tail', 'fresh-independent-full-1440-audio-tail'] : full ? ['full-long', 'full-calibrated-audio-tail', 'fresh-independent-full-audio-tail']
  : ['long-late-forty', 'long-open-end', 'fresh-independent-nonaligned']), 'real-encode-cancelled-no-publication',
  'fresh-success-after-encode-cancel', 'real-evidence-cancelled-no-publication', 'fresh-success-after-evidence-cancel', 'existing-output-preserved'];
// Pure receipt-checking seam only. It cannot construct controls or replace the
// fixed builder's paths, hashes, validators, runtime or family catalog.
function assertServiceProof(bytes, kind, expectedSha, evidenceIds) {
  need(Object.hasOwn(SERVICE_PROOFS, kind) && typeof expectedSha === 'string' && /^[a-f0-9]{64}$/.test(expectedSha), 'Service proof is pending or unknown.');
  need(sha(bytes) === expectedSha, 'Exact accepted service proof bytes are required.');
  let report; try { report = JSON.parse(bytes); } catch { need(false, 'Invalid service proof JSON.'); }
  const full1440 = kind === 'fullResize1440to720', full = full1440 || kind === 'fullResize1080to720', resized = kind !== 'keep720';
  const status = full1440 ? 'passed-developer-full-1440-service-proof' : full ? 'passed-developer-full-resize-service-proof' : resized ? 'passed-developer-resize-service-proof' : 'passed-developer-long-range-service-proof';
  need(report?.status === status && report.appActivated === false && !report.failure && !report.closureFailure
    && report.census?.spawned > 0 && report.census.spawned === report.census.closed && report.census.live === 0
    && report.census.maximum === 1 && report.census.encodes === 7, 'A settled successful service proof is required.');
  if (resized) need(same(report.geometry, { sourceWidth: full1440 ? 2560 : 1920, sourceHeight: full1440 ? 1440 : 1080, resolution: '720', outputWidth: 1280, outputHeight: 720 }), 'Service proof geometry differs.');
  const names = casesFor(full, full1440);
  need(Array.isArray(report.cases) && report.cases.length === names.length && report.cases.every((row, i) => row.case === names[i] && row.status === 'passed'), 'Every expected service lifecycle case must pass.');
  need(Array.isArray(evidenceIds) && evidenceIds.length === 4 && new Set(evidenceIds).size === 4, 'Exact retained calibration identities are required.');
  for (const [i, row] of report.cases.entries()) {
    const item = row.item;
    if ([0, 1, 2, 4, 6].includes(i)) {
      const a = row.accounting, l = row.limits, pcm = row.pcmIdentity;
      if (full1440) need(row.frames === (i === 0 ? 360 : i === 1 ? 213 : 120)
        && row.samples === (i === 0 ? 576000 : i === 1 ? 346416 : 197616), '1440 service proof must retain its complete video/audio-tail counts.');
      need(item?.status === 'success' && item.outputDisposition?.published === true && item.sourceAssessment?.kind === 'unchanged'
        && item.operationRequest?.resolution === (resized ? '720' : 'source') && item.operationRequest.audioPolicy === 'precision-flac'
        && a?.status === 'completed' && a.failure === null && same(a.evidenceIds, evidenceIds) && a.sourceIdentityDisposition === 'unchanged'
        && a.telemetryValidation?.valid === true && Number.isSafeInteger(row.frames) && row.frames > 0
        && Number.isSafeInteger(row.samples) && row.samples > 0 && pcm?.format === 's16le-interleaved'
        && /^[a-f0-9]{64}$/.test(pcm.sourceHash) && pcm.sourceHash === pcm.outputHash
        && pcm.sourceBytes === row.samples * 4 && pcm.outputBytes === pcm.sourceBytes,
      'Successful service outputs need correlated complete evidence and exact PCM.');
      need(l && Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0 && row.elapsedMs <= l.executionBudgetMs
        && Number.isSafeInteger(a.children) && a.children > 0 && a.children <= l.maxChildren
        && a.streamedBytes > 0 && a.streamedBytes <= l.evidenceBytes
        && a.pipeBytes?.stdout >= 0 && a.pipeBytes.stderr >= 0 && a.pipeBytes.stdout + a.pipeBytes.stderr <= l.pipeBytes
        && row.reservation?.forecastBytes === l.evidenceReserveBytes && row.reservation.reservedBytes >= l.evidenceReserveBytes
        && item.evidenceStorage?.final?.recordPersisted === true && same(item.evidenceStorage.final.violations, []),
      'Service proof resource accounting or storage settlement is incomplete.');
      if (full) need(item.operationRequest.range === null && item.timing?.timeline === 'source-timestamps'
        && item.timing.requested === null && item.timing.resolved === null, 'Full service proof cannot borrow range authority.');
      else need(item.operationRequest.range !== null && item.timing?.timeline === 'request-relative', 'Range service proof cannot borrow Full authority.');
      if (resized) need(row.geometry?.output?.width === 1280 && row.geometry.output.height === 720
        && row.orientationQualification?.runtimeIdentity === RUNTIME_ID, 'Resize output geometry/runtime evidence is required.');
    } else if (i === 3 || i === 5) {
      need(item?.status === 'cancelled' && row.observed?.childLive === true && item.outputDisposition?.published !== true
        && item.cleanup?.retained === true, 'Live cancellation must settle without accepted publication.');
      if (i === 3) need(row.observed.kind === 'encode' && row.observed.progress?.ended === false, 'Encode cancellation must be observed before completion.');
      else need(row.observed.kind === 'complete-source-evidence' && row.observed.bytesObserved > 0
        && item.outputDisposition?.kind === 'retained-unverified' && item.outputDisposition.validationCurrent === false,
      'Evidence cancellation must retain an explicitly unverified stage.');
    } else need(item?.status === 'skipped', 'Collision must skip without replacing the destination.');
  }
  return report;
}
async function buildQualifiedEncodeControls({ stateDir, onChild } = {}, include1440) {
  // The fourth composition must not become a dependency of the preserved three-family route.
  const full1440 = include1440 ? require('./workbench-full-1440-service.cjs') : null;
  if (include1440) need(full1440.REPORT_SHA !== null && SERVICE_PROOFS.fullResize1440to720.report !== null
    && SERVICE_PROOFS.fullResize1440to720.sha256 !== null, '1440 calibration and actual service qualification are pending.');
  // This first gate deliberately precedes ALL receipt/runtime/storage reads.
  need(full.REPORT_SHA !== null && SERVICE_PROOFS.fullResize1080to720.report !== null
    && SERVICE_PROOFS.fullResize1080to720.sha256 !== null, 'Full calibration and actual service qualification are pending.');
  need(typeof stateDir === 'string' && path.isAbsolute(stateDir) && (onChild === undefined || typeof onChild === 'function'), 'Main-owned state directory and child observer required.');
  const definitions = [
    ['keep720', keep, keep.assertLongRangeReceipt, FAMILY_ID, RESOURCE_POLICY],
    ['resize1080to720', resize, resize.assertResizeReceipt, RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY],
    ['fullResize1080to720', full, full.assertFullResizeReceipt, FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY],
  ];
  if (include1440) definitions.push(['fullResize1440to720', full1440, full1440.assertFull1440Receipt, FULL_1440_RESIZE_FAMILY_ID, FULL_1440_RESIZE_RESOURCE_POLICY]);
  const families = [];
  for (const [kind, module, validate, id, resourcePolicy] of definitions) {
    const calibration = validate(await fs.readFile(module.REPORT));
    const evidenceIds = calibration.sources.flatMap(s => [s.frozen.qualification.evidenceId, s.frozen.timingQualification.evidenceId]);
    const proof = SERVICE_PROOFS[kind];
    assertServiceProof(await fs.readFile(proof.report), kind, proof.sha256, evidenceIds);
    const { qualification, timingQualification } = calibration.sources[0].frozen;
    families.push({ id, resourcePolicy, runtimeIdentity: RUNTIME_ID, settings: SETTINGS, environment: null,
      qualification, timingQualification, evidenceIds });
  }
  need(sha(await fs.readFile(path.resolve(__dirname, '../src/operation-runtime.cjs'))) === OBSERVER_SHA, 'Exact reviewed observer bytes are required.');
  await verifyAv1Tool('ffmpeg'); await verifyAv1Tool('ffprobe');
  const operationQualifications = new keep.ClockQualifiedFamilySelector({ policyIdentity: include1440 ? 'blue-linux-qualified-encode-1440-v1' : 'blue-linux-qualified-encode-v1', families });
  const operationRuntime = new OperationRuntimeObserver({
    runtime: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, pin.path])),
    pins: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, { sizeBytes: pin.size, sha256: pin.sha256 }])),
    run: keep.clockGuardedRunner(createAv1ProportionalRunner({ onChild })),
  });
  return { controls: { operationQualifications, operationRuntime, operationEvidenceBudget: null, operationDeadlineMs: 120000,
    operationTelemetry: true, operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }) },
  status: Object.freeze({ available: true, runtimeIdentity: RUNTIME_ID, familyIds: Object.freeze(families.map(f => f.id)),
    scope: 'Qualified CPU H265 slow25 SDR FLAC families only; ordinary CPU runner remains separate.' }) };
}
// Fixed main-owned exports, never caller-selected families or receipt paths.
const createQualifiedEncodeControls = options => buildQualifiedEncodeControls(options, false);
const create1440QualifiedEncodeControls = options => buildQualifiedEncodeControls(options, true);
module.exports = { create1440QualifiedEncodeControls, createQualifiedEncodeControls, assertServiceProof, SERVICE_PROOFS };
