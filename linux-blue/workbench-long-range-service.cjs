'use strict';
// Developer-only, main-owned composition. No application/renderer route imports
// this module. A pending receipt cannot create a service or family catalog.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { isDeepStrictEqual: same } = require('node:util');
const { CandidateTrimService } = require('./workbench-trim-candidate.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { describeEncodeOperationSource } = require('../src/encode-operation.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { openEvidenceStorage } = require('../src/operation-storage.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { deriveCfrFlacResources, FAMILY_ID, RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { PINS, RUNTIME_ID, verifyAv1Tool } = require('./runtime-av1.cjs');
const { createAv1ProportionalRunner } = require('./runtime-av1-operation.cjs');
const REPORT = path.join(__dirname, 'artifacts', 'long-range-calibration-sD4XVP', 'report.json');
const REPORT_SHA = 'dc5af4b1c949e0ac8e6261493f67de5230ec4173d21b73a705287d183add2a33';
const OBSERVER_SHA = '177f139bc1913051f9754673a21dd2ecb60f5dcba38f91785f84ab56d8159b1c';
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const CLOCKS = Object.freeze({ video: '1/15360', audio: '1/48000', output: '1/1000' });
const CASES = Object.freeze([
  { id: 'late-forty-seconds', sourceId: 'long-pattern', range: { startUs: 100000000, endUs: 140000000 } },
  { id: 'late-open-end', sourceId: 'long-pattern', range: { startUs: 130000000 } },
  { id: 'heldout-nonaligned', sourceId: 'heldout-flipped', range: { startUs: 413000, endUs: 8621000 } },
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function need(ok, message) { if (!ok) throw Object.assign(new Error(message), { code: 'LINUX_LONG_RANGE_SCOPE' }); }
function assertQualifiedClocks(probe) {
  need(Array.isArray(probe?.streams) && probe.streams.length === 2
    && probe.streams.filter(s => s.codec_type === 'video' && s.time_base === CLOCKS.video).length === 1
    && probe.streams.filter(s => s.codec_type === 'audio' && s.time_base === CLOCKS.audio).length === 1,
  'Only the independently calibrated source video/audio clocks are qualified.');
}
// Inspect the same complete metadata bytes the service will parse. This does
// not replace its duplicate-key/schema checks or accept a failed child result.
function clockGuardedRunner(invoke) {
  return async (executable, args, options) => {
    const result = await invoke(executable, args, options);
    if (!options?.onStdoutChunk && executable === PINS.ffprobe.path && args.includes('-show_format') && args.includes('-show_streams') && result.exitCode === 0) {
      let metadata; try { metadata = JSON.parse(result.stdout); } catch { need(false, 'Output metadata must be valid JSON.'); }
      if (metadata?.format?.format_name === 'matroska,webm')
        need(Array.isArray(metadata.streams) && metadata.streams.length > 0
          && metadata.streams.every(stream => stream.time_base === CLOCKS.output),
        'The calibrated Matroska output requires exactly 1/1000 stream clocks.');
    }
    return result;
  };
}
// These are clock-domain restrictions, not fixture identity or range bindings.
// Genuine shared tokens still bind the complete source, request and resources.
class ClockQualifiedFamilySelector extends OperationFamilySelector {
  select(options) {
    if (!options.plan?.compatibilityPath) assertQualifiedClocks(describeEncodeOperationSource(options.plan));
    return super.select(options);
  }
  requireCurrent(token, options) {
    assertQualifiedClocks(describeEncodeOperationSource(options.plan));
    return super.requireCurrent(token, options);
  }
}
// Pure validator accepts a digest only for deterministic testing. The service
// below never accepts a caller-selected receipt, digest, runtime or policy.
function assertLongRangeReceipt(bytes, expectedSha = REPORT_SHA) {
  need(typeof expectedSha === 'string' && /^[a-f0-9]{64}$/.test(expectedSha), 'Long-range qualification receipt is pending.');
  need(sha(bytes) === expectedSha, 'The exact reviewed long-range receipt is required.');
  let report; try { report = JSON.parse(bytes); } catch { need(false, 'Invalid long-range receipt JSON.'); }
  need(report?.status === 'passed-pre-catalog-calibration' && report.runtimeIdentity === RUNTIME_ID
    && report.resourcePolicy === RESOURCE_POLICY && report.publicationAuthorized === false && report.catalogActivated === false
    && same(report.settings, SETTINGS) && !report.failure && !report.closeFailure,
  'A successful matching pre-catalog calibration is required.');
  need(report.census?.spawned > 0 && report.census.spawned === report.census.closed
    && report.census.live === 0 && report.census.maximum === 1, 'Calibration children must all be closed without overlap.');
  need(Array.isArray(report.sources) && report.sources.length === 2 && Array.isArray(report.cases) && report.cases.length === 3,
    'Both long and independent held-out sources and all three cases are required.');
  for (const [index, id] of ['long-pattern', 'heldout-flipped'].entries()) {
    const source = report.sources[index];
    need(source?.id === id && source.sourceExtentUs === (index === 0 ? 150000000 : 11000000)
      && /^[a-f0-9]{64}$/.test(source.sha256) && typeof source.identity?.size === 'string', 'Calibration source record is incomplete.');
    assertQualifiedClocks(source.probe);
    const expected = frozenQualifications(`${path.basename(path.dirname(REPORT))}:${id}`, RUNTIME_ID, source.probe);
    need(same(source.frozen, expected), 'Qualifications must equal the before-encode clock-derived bounds, not fitted output errors.');
  }
  need(report.sources[0].sha256 !== report.sources[1].sha256, 'Held-out source must be independent.');
  for (let i = 0; i < CASES.length; i++) {
    const spec = CASES[i], row = report.cases[i], source = report.sources.find(s => s.id === spec.sourceId);
    need(row?.id === spec.id && row.sourceId === spec.sourceId && same(row.range, spec.range)
      && row.status === 'passed' && row.validation?.valid === true, 'Every expected calibration case must have passed strict validation.');
    const start = spec.range.startUs, end = spec.range.endUs ?? source.sourceExtentUs;
    const count = rate => Math.ceil(end * rate / 1000000) - Math.ceil(start * rate / 1000000);
    const resources = deriveCfrFlacResources({ sourceExtentUs: source.sourceExtentUs, selectedExtentUs: end - start, sourceBytes: source.identity.size });
    need(same(row.resources, resources) && Number.isSafeInteger(row.pipeBytes) && row.pipeBytes > 0
      && row.pipeBytes <= resources.resources.pipeBytes && Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0
      && row.elapsedMs <= resources.executionBudgetMs, 'Case resources must match the frozen source-derived policy.');
    need(row.frames === count(30) && row.samples === count(48000)
      && /^[a-f0-9]{64}$/.test(row.pcmIdentity?.sourceHash) && row.pcmIdentity.sourceHash === row.pcmIdentity.outputHash
      && row.completeSource?.video?.frames === source.sourceExtentUs * 30 / 1000000
      && row.completeSource?.audio?.length === 1
      && String(row.completeSource.audio[0].sampleCount) === String(source.sourceExtentUs * 48000 / 1000000),
    'Full-source and selected decoded PCM/frame evidence is required.');
  }
  return report;
}
async function createLongRangeService({ stateDir, onChild } = {}) {
  need(REPORT_SHA !== null, 'Long-range qualification receipt is pending.');
  const report = assertLongRangeReceipt(await fs.readFile(REPORT));
  need(sha(await fs.readFile(path.resolve(__dirname, '../src/operation-runtime.cjs'))) === OBSERVER_SHA,
    'The exact reviewed runtime observer is required; no parity fallback.');
  await verifyAv1Tool('ffmpeg'); await verifyAv1Tool('ffprobe');
  const run = clockGuardedRunner(createAv1ProportionalRunner({ onChild }));
  const operationRuntime = new OperationRuntimeObserver({
    runtime: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, pin.path])),
    pins: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, { sizeBytes: pin.size, sha256: pin.sha256 }])), run,
  });
  const { qualification, timingQualification } = report.sources[0].frozen;
  const operationQualifications = new ClockQualifiedFamilySelector({ policyIdentity: 'blue-linux-long-range-clock-qualified-v1', families: [{
    id: FAMILY_ID, runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS, resourcePolicy: RESOURCE_POLICY,
    qualification, timingQualification, evidenceIds: report.sources.flatMap(s => [s.frozen.qualification.evidenceId, s.frozen.timingQualification.evidenceId]),
  }] });
  return new CandidateTrimService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path, stateDir,
    runtimeIdentity: RUNTIME_ID, run, inspectionWorkers: 1, operationRuntime, operationQualifications,
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    operationEvidenceBudget: null, operationDeadlineMs: 120000, operationTelemetry: true,
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }),
  });
}
module.exports = { createLongRangeService, assertLongRangeReceipt, assertQualifiedClocks, ClockQualifiedFamilySelector,
  REPORT, REPORT_SHA, CLOCKS, clockGuardedRunner };
