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
// Trusted main-module composition only. No application entry or IPC accepts this
// configuration. Snapshot it before any asynchronous work; receipts remain exact
// bytes and each runtime retains its own identity, runner and evidence policy.
function createCalibratedTrimServiceFactory(configuration) {
  const keys = ['pins', 'runtimeIdentity', 'verifyTool', 'createRunner', 'report', 'reportSha', 'policyIdentity'];
  if (!configuration || Object.getPrototypeOf(configuration) !== Object.prototype
      || Reflect.ownKeys(configuration).length !== keys.length
      || !keys.every(key => Object.hasOwn(configuration, key)
        && Object.hasOwn(Object.getOwnPropertyDescriptor(configuration, key), 'value')))
    fail('A complete inert main-owned trim configuration is required.');
  const { pins, runtimeIdentity, verifyTool, createRunner, report, reportSha, policyIdentity } = configuration;
  if (!pins || Object.keys(pins).length !== 2 || !['ffmpeg', 'ffprobe'].every(kind => {
    const pin = pins[kind];
    return pin && typeof pin.path === 'string' && path.isAbsolute(pin.path) && Number.isSafeInteger(pin.size) && pin.size > 0
      && /^[a-f0-9]{64}$/.test(pin.sha256);
  }) || pins.ffmpeg.path === pins.ffprobe.path || typeof verifyTool !== 'function' || typeof createRunner !== 'function'
      || typeof report !== 'string' || !path.isAbsolute(report) || !/^[a-f0-9]{64}$/.test(reportSha)
      || typeof policyIdentity !== 'string' || !/^[A-Za-z0-9._:+-]{1,256}$/.test(policyIdentity))
    fail('The trusted trim composition needs fixed paired pins, receipt, verifier and runner.');
  const pair = Object.freeze(Object.fromEntries(['ffmpeg', 'ffprobe'].map(kind => [kind, Object.freeze({ ...pins[kind] })])));
  if (runtimeIdentity !== sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(kind => ({ sizeBytes: pair[kind].size, sha256: pair[kind].sha256 })))))
    fail('The trim configuration runtime identity must match the exact executable pair.');
  const config = Object.freeze({ pins: pair, runtimeIdentity, verifyTool, createRunner, report, reportSha, policyIdentity });
  return options => createCalibratedTrimService(options, config);
}
function assertCalibrationReceipt(bytes, { reportSha, runtimeIdentity }) {
  if (sha(bytes) !== reportSha) fail('The retained Linux calibration receipt changed.');
  let report;
  try { report = JSON.parse(bytes); } catch { fail('The retained calibration receipt is not valid JSON.'); }
  if (report?.status !== 'passed-calibration-only' || report.runtimeIdentity !== runtimeIdentity
      || !Array.isArray(report.cases) || report.cases.length !== 3 || report.cases.some(row => row?.status !== 'passed')
      || !report.source || !/^[a-f0-9]{64}$/.test(report.source.sha256)
      || report.frozen?.qualification?.runtimeIdentity !== runtimeIdentity
      || report.frozen?.timingQualification?.runtimeIdentity !== runtimeIdentity)
    fail('Complete matching calibration evidence is required.');
  return report;
}
function assertCalibrationSource(before, bytes, after, expectedHash) {
  if (BigInt(before.size) > 16n * 1024n * 1024n || sha(bytes) !== expectedHash
      || !isDeepStrictEqual(before, after)) fail('Only an unchanged copy of the retained synthetic source may be used.');
}
async function createCalibratedTrimService({ stateDir, source, onChild } = {}, config) {
  const { pins, runtimeIdentity, verifyTool, createRunner } = config;
  const observer = path.resolve(__dirname, '../src/operation-runtime.cjs');
  if (sha(await fs.readFile(observer)) !== OBSERVER_SHA) fail('The reviewed local runtime observer is absent; no source-parity fallback is permitted.');
  const report = assertCalibrationReceipt(await fs.readFile(config.report), config);
  const before = await readSourceIdentity(source);
  // Keep the source-size check before reading bytes, as in the original proof.
  if (BigInt(before.size) > 16n * 1024n * 1024n) fail('Only an unchanged copy of the retained synthetic source may be used.');
  assertCalibrationSource(before, await fs.readFile(source), await readSourceIdentity(source), report.source.sha256);
  await verifyTool('ffmpeg'); await verifyTool('ffprobe');
  const run = createRunner({ onChild });
  const operationRuntime = new OperationRuntimeObserver({
    runtime: Object.fromEntries(Object.entries(pins).map(([kind, pin]) => [kind, pin.path])),
    pins: Object.fromEntries(Object.entries(pins).map(([kind, pin]) => [kind, { sizeBytes: pin.size, sha256: pin.sha256 }])), run,
  });
  const { qualification, timingQualification } = report.frozen;
  const selector = new OperationFamilySelector({ policyIdentity: config.policyIdentity, families: [{
    id: 'short-sdr-range-flac-v1', runtimeIdentity, environment: null, settings: SETTINGS,
    qualification, timingQualification, evidenceIds: [qualification.evidenceId, timingQualification.evidenceId],
    budget: BUDGET, executionBudgetMs: DEADLINE_MS,
  }] });
  return new CandidateTrimService({ ffmpeg: pins.ffmpeg.path, ffprobe: pins.ffprobe.path, stateDir,
    runtimeIdentity, run, inspectionWorkers: 1,
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    operationRuntime, operationQualifications: new CalibratedSourceSelector(selector, before, fingerprintEncodeSource(report.source.probe)),
    operationEvidenceBudget: BUDGET, operationDeadlineMs: DEADLINE_MS, operationTelemetry: true,
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }),
  });
}
const createTrimCandidateService = createCalibratedTrimServiceFactory({
  pins: PINS, runtimeIdentity: RUNTIME_ID, verifyTool: verifyCandidateTool, createRunner: createCandidateRunner,
  report: REPORT, reportSha: REPORT_SHA, policyIdentity: 'blue-linux-trim-service-candidate-v1',
});
module.exports = { createTrimCandidateService, createCalibratedTrimServiceFactory, assertCalibrationReceipt,
  assertCalibrationSource, CandidateTrimService, CalibratedSourceSelector, REPORT, REPORT_SHA, DEADLINE_MS };
