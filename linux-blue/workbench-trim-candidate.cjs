'use strict';
// Developer-only service qualification. Not imported by either application entry.
// This admits only a byte-identical copy of the retained synthetic calibration
// source and its three measured requests, not the broader shared family schema.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const { EncoderService } = require('../src/encoder-service.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { PINS, RUNTIME_ID, verifyCandidateTool, createCandidateRunner } = require('./runtime-candidate.cjs');
const { BUDGET, SETTINGS, SPECS } = require('./workbench-flac-calibration.cjs');
const REPORT = path.join(__dirname, 'artifacts', 'flac-candidate-QY90Bo', 'report.json');
const REPORT_SHA = 'da672b3b433d5b0be835c6743b4af677292cd190788f612e21d3ce8172415de1';
const OBSERVER_SHA = '177f139bc1913051f9754673a21dd2ecb60f5dcba38f91785f84ab56d8159b1c';
const DEADLINE_MS = 120000;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Object.assign(new Error(message), { code: 'LINUX_TRIM_CANDIDATE_SCOPE' }); };

class CalibratedSourceSelector {
  #selector; #source; #probe;
  constructor(selector, sourceIdentity, probeFingerprint) {
    if (!(selector instanceof OperationFamilySelector)) fail('A genuine shared family selector is required.');
    this.#selector = selector; this.#source = structuredClone(sourceIdentity); this.#probe = probeFingerprint;
  }
  #scope(options) {
    const request = options.plan?.contract?.request;
    if (!isDeepStrictEqual(options.sourceIdentity, this.#source)
        || options.sourceProbeFingerprint !== this.#probe
        || request?.resolution !== 'source' || request.audioPolicy !== 'precision-flac'
        || !SPECS.some(spec => isDeepStrictEqual(spec.range, request.range)))
      fail('Only the retained calibration source and three measured trim requests are admitted to this developer proof.');
  }
  select(options) {
    if (!options.plan?.compatibilityPath) this.#scope(options);
    return this.#selector.select(options);
  }
  requireCurrent(token, options) { this.#scope(options); return this.#selector.requireCurrent(token, options); }
  verifyCollectedSource(token, evidence) { return this.#selector.verifyCollectedSource(token, evidence); }
  invalidate(reason) { return this.#selector.invalidate(reason); }
  // No orientation override or resize admission is supplied by this narrow proof.
  orientationQualification() { return {}; }
}
class CandidateTrimService extends EncoderService {
  startBatch(request) {
    this.requireIdle();
    if (!this.plan || !Array.isArray(request?.fileIds) || !request.fileIds.length) return super.startBatch(request);
    if (this.plan.operation !== 'encode' || this.plan.sameFolder
        || !isDeepStrictEqual(this.plan.settings, SETTINGS)) fail('This developer service starts only the measured CPU trim tuple in a separate output folder.');
    for (const id of request.fileIds) {
      const entry = this.plan.entries.get(id);
      if (!entry?.qualificationSelection || !entry.operationRuntimeToken || !entry.operationPlan.instrumentation
          || entry.operationPlan.compatibilityPath || ['native', 'vendor', 'hdr', 'remux', 'encodePreservation'].some(key => entry[key]))
        fail('Only a genuinely prepared, instrumented candidate trim may start.');
    }
    return super.startBatch(request);
  }
}
async function createTrimCandidateService({ stateDir, source, onChild } = {}) {
  const observer = path.resolve(__dirname, '../src/operation-runtime.cjs');
  if (sha(await fs.readFile(observer)) !== OBSERVER_SHA) fail('The reviewed local runtime observer is absent; no source-parity fallback is permitted.');
  const bytes = await fs.readFile(REPORT);
  if (sha(bytes) !== REPORT_SHA) fail('The retained Linux calibration receipt changed.');
  const report = JSON.parse(bytes);
  if (report.status !== 'passed-calibration-only' || report.runtimeIdentity !== RUNTIME_ID
      || report.cases.length !== 3 || report.cases.some(row => row.status !== 'passed')) fail('Complete matching calibration evidence is required.');
  const before = await readSourceIdentity(source);
  if (BigInt(before.size) > 16n * 1024n * 1024n || sha(await fs.readFile(source)) !== report.source.sha256
      || !isDeepStrictEqual(before, await readSourceIdentity(source))) fail('Only an unchanged copy of the retained synthetic source may be used.');
  await verifyCandidateTool('ffmpeg'); await verifyCandidateTool('ffprobe');
  const run = createCandidateRunner({ onChild });
  const operationRuntime = new OperationRuntimeObserver({
    runtime: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, pin.path])),
    pins: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, { sizeBytes: pin.size, sha256: pin.sha256 }])), run,
  });
  const { qualification, timingQualification } = report.frozen;
  const selector = new OperationFamilySelector({ policyIdentity: 'blue-linux-trim-service-candidate-v1', families: [{
    id: 'short-sdr-range-flac-v1', runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS,
    qualification, timingQualification, evidenceIds: [qualification.evidenceId, timingQualification.evidenceId],
    budget: BUDGET, executionBudgetMs: DEADLINE_MS,
  }] });
  return new CandidateTrimService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path, stateDir,
    runtimeIdentity: RUNTIME_ID, run, inspectionWorkers: 1,
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    operationRuntime, operationQualifications: new CalibratedSourceSelector(selector, before, fingerprintEncodeSource(report.source.probe)),
    operationEvidenceBudget: BUDGET, operationDeadlineMs: DEADLINE_MS, operationTelemetry: true,
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }),
  });
}
module.exports = { createTrimCandidateService, CandidateTrimService, CalibratedSourceSelector, REPORT, REPORT_SHA, DEADLINE_MS };
