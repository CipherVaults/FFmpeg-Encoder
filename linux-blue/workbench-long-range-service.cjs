'use strict';
// Main-owned developer composition and helpers reused by the qualified app catalog.
// A new variant is not app authority; pending receipts cannot create a service/catalog.
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
const { deriveCfrFlacResources, FAMILY_ID, RESOURCE_POLICY, deriveCfrResizeFlacResources, RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY, FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY, deriveCfrFullResizeFlacResources, FULL_1440_RESIZE_FAMILY_ID, FULL_1440_RESIZE_RESOURCE_POLICY, deriveCfrFull1440ResizeFlacResources } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('./flac-timing-qualification.cjs');
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
function clockGuardedRunner(invoke, ffprobePath = PINS.ffprobe.path) {
  return async (executable, args, options) => {
    const result = await invoke(executable, args, options);
    if (!options?.onStdoutChunk && executable === ffprobePath && args.includes('-show_format') && args.includes('-show_streams') && result.exitCode === 0) {
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
function assertProportionalReceipt(bytes, expectedSha, config) {
  return assertProportionalReceiptForRuntime(bytes, expectedSha, config, RUNTIME_ID);
}
// Pure validation only; this creates no runtime, selector or service authority.
function assertProportionalReceiptForRuntime(bytes, expectedSha, config, expectedRuntimeIdentity) {
  need(typeof expectedSha === 'string' && /^[a-f0-9]{64}$/.test(expectedSha), 'Long-range qualification receipt is pending.');
  need(sha(bytes) === expectedSha, 'The exact reviewed long-range receipt is required.');
  let report; try { report = JSON.parse(bytes); } catch { need(false, 'Invalid long-range receipt JSON.'); }
  need(report?.status === 'passed-pre-catalog-calibration' && report.runtimeIdentity === expectedRuntimeIdentity
    && report.resourcePolicy === config.resourcePolicy && report.publicationAuthorized === false && report.catalogActivated === false
    && same(report.settings, SETTINGS) && !report.failure && !report.closeFailure,
  'A successful matching pre-catalog calibration is required.');
  if (config.resize) need(same(report.geometry, { sourceWidth: config.sourceWidth, sourceHeight: config.sourceHeight, resolution: '720', outputWidth: 1280, outputHeight: 720 }),
    'Resize calibration must prove its exact fixed source to 720p geometry.');
  need(report.census?.spawned > 0 && report.census.spawned === report.census.closed
    && report.census.live === 0 && report.census.maximum === 1, 'Calibration children must all be closed without overlap.');
  const sourceIds = config.full1440 ? ['full-1440-pattern', 'full-1440-heldout-tail'] : config.full ? ['full-long-pattern', 'full-heldout-tail'] : ['long-pattern', 'heldout-flipped'];
  const cases = config.full ? [
    { id: config.full1440 ? 'full-1440' : 'full-long', sourceId: sourceIds[0], range: null },
    { id: config.full1440 ? 'full-1440-heldout-audio-tail' : 'full-heldout-audio-tail', sourceId: sourceIds[1], range: null },
  ] : CASES;
  need(Array.isArray(report.sources) && report.sources.length === 2 && Array.isArray(report.cases) && report.cases.length === cases.length,
    'Both long and independent held-out sources and all expected cases are required.');
  for (const [index, id] of sourceIds.entries()) {
    const source = report.sources[index];
    need(source?.id === id && source.sourceExtentUs === (config.full1440 ? (index === 0 ? 12000000 : 7217000) : index === 0 ? 150000000 : config.full ? 43217000 : 11000000)
      && /^[a-f0-9]{64}$/.test(source.sha256) && typeof source.identity?.size === 'string', 'Calibration source record is incomplete.');
    assertQualifiedClocks(source.probe);
    if (config.resize) {
      const video = source.probe.streams.find(stream => stream.codec_type === 'video');
      need(video.width === config.sourceWidth && video.height === config.sourceHeight && video.sample_aspect_ratio === '1:1'
        && video.display_aspect_ratio === '16:9', 'Resize calibration requires its fixed square-pixel source geometry.');
    }
    if (config.full) {
      const video = source.probe.streams.find(stream => stream.codec_type === 'video'), audio = source.probe.streams.find(stream => stream.codec_type === 'audio');
      const videoUs = config.full1440 ? (index === 0 ? 12000000 : 7100000) : index === 0 ? 150000000 : 43100000,
        audioUs = config.full1440 ? (index === 0 ? 12000000 : 7217000) : index === 0 ? 150000000 : 43217000;
      need(Number(video.duration) * 1000000 === videoUs && Number(audio.duration) * 1000000 === audioUs
        && Number(source.probe.format?.duration) * 1000000 === source.sourceExtentUs
        && Number(video.duration_ts) === videoUs * 15360 / 1000000 && Number(audio.duration_ts) === audioUs * 48000 / 1000000
        && video.codec_name === 'h264' && video.profile === 'High' && audio.codec_name === 'pcm_s16le'
        && audio.sample_fmt === 's16' && audio.sample_rate === '48000' && audio.channels === 2 && audio.channel_layout === 'stereo',
      'Full calibration must retain actual complete video and audio-tail source extents.');
    }
    const expected = frozenQualifications(`${path.basename(path.dirname(config.report))}:${id}`, expectedRuntimeIdentity, source.probe);
    need(same(source.frozen, expected), 'Qualifications must equal the before-encode clock-derived bounds, not fitted output errors.');
  }
  need(report.sources[0].sha256 !== report.sources[1].sha256, 'Held-out source must be independent.');
  for (let i = 0; i < cases.length; i++) {
    const spec = cases[i], row = report.cases[i], source = report.sources.find(s => s.id === spec.sourceId);
    need(row?.id === spec.id && row.sourceId === spec.sourceId && same(row.range, spec.range)
      && row.status === 'passed' && row.validation?.valid === true, 'Every expected calibration case must have passed strict validation.');
    if (config.resize) need(row.completeSource?.video?.properties?.policy === config.familyId,
      'Resize evidence must belong to the distinct resize family.');
    const start = config.full ? 0 : spec.range.startUs, end = config.full ? source.sourceExtentUs : spec.range.endUs ?? source.sourceExtentUs;
    const count = rate => Math.ceil(end * rate / 1000000) - Math.ceil(start * rate / 1000000);
    const resources = config.full ? config.derive({ sourceExtentUs: source.sourceExtentUs, sourceBytes: source.identity.size })
      : config.derive({ sourceExtentUs: source.sourceExtentUs, selectedExtentUs: end - start, sourceBytes: source.identity.size });
    const videoFrames = config.full1440 ? (i === 0 ? 360 : 213) : config.full ? (i === 0 ? 4500 : 1293) : count(30);
    const audioSamples = config.full1440 ? (i === 0 ? 576000 : 346416) : config.full ? (i === 0 ? 7200000 : 2074416) : count(48000);
    if (config.full) need(row.validation.timing?.timeline === 'source-timestamps'
      && row.validation.timing.requested === null && row.validation.timing.resolved === null,
    'Full calibration must not invent a resolved interval or rebase source timestamps.');
    need(same(row.resources, resources) && Number.isSafeInteger(row.pipeBytes) && row.pipeBytes > 0
      && row.pipeBytes <= resources.resources.pipeBytes && Number.isSafeInteger(row.elapsedMs) && row.elapsedMs >= 0
      && row.elapsedMs <= resources.executionBudgetMs, 'Case resources must match the frozen source-derived policy.');
    need(row.frames === videoFrames && row.samples === audioSamples
      && /^[a-f0-9]{64}$/.test(row.pcmIdentity?.sourceHash) && row.pcmIdentity.sourceHash === row.pcmIdentity.outputHash
      && row.completeSource?.video?.frames === (config.full ? videoFrames : source.sourceExtentUs * 30 / 1000000)
      && row.completeSource?.audio?.length === 1
      && String(row.completeSource.audio[0].sampleCount) === String(config.full ? audioSamples : source.sourceExtentUs * 48000 / 1000000),
    'Full-source and selected decoded PCM/frame evidence is required.');
  }
  return report;
}
async function createProportionalService({ stateDir, onChild } = {}, config) {
  need(config.reportSha !== null, 'Long-range qualification receipt is pending.');
  const report = assertProportionalReceipt(await fs.readFile(config.report), config.reportSha, config);
  need(sha(await fs.readFile(path.resolve(__dirname, '../src/operation-runtime.cjs'))) === OBSERVER_SHA,
    'The exact reviewed runtime observer is required; no parity fallback.');
  await verifyAv1Tool('ffmpeg'); await verifyAv1Tool('ffprobe');
  const run = clockGuardedRunner(createAv1ProportionalRunner({ onChild }));
  const operationRuntime = new OperationRuntimeObserver({
    runtime: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, pin.path])),
    pins: Object.fromEntries(Object.entries(PINS).map(([kind, pin]) => [kind, { sizeBytes: pin.size, sha256: pin.sha256 }])), run,
  });
  const { qualification, timingQualification } = report.sources[0].frozen;
  const operationQualifications = new ClockQualifiedFamilySelector({ policyIdentity: config.policyIdentity, families: [{
    id: config.familyId, runtimeIdentity: RUNTIME_ID, environment: null, settings: SETTINGS, resourcePolicy: config.resourcePolicy,
    qualification, timingQualification, evidenceIds: report.sources.flatMap(s => [s.frozen.qualification.evidenceId, s.frozen.timingQualification.evidenceId]),
  }] });
  return new CandidateTrimService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path, stateDir,
    runtimeIdentity: RUNTIME_ID, run, inspectionWorkers: 1, operationRuntime, operationQualifications,
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    operationEvidenceBudget: null, operationDeadlineMs: 120000, operationTelemetry: true,
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }),
  });
}
// Only trusted main modules call this factory. It chooses one of four fixed
// families; no config reaches IPC, renderer, CLI or environment variables.
function createProportionalServiceFactory(configuration) {
  const keys = ['kind', 'report', 'reportSha'];
  need(configuration && Object.getPrototypeOf(configuration) === Object.prototype
    && Reflect.ownKeys(configuration).length === keys.length
    && keys.every(key => Object.hasOwn(Object.getOwnPropertyDescriptor(configuration, key) || {}, 'value')),
  'A complete inert main-owned service configuration is required.');
  const { kind, report, reportSha } = configuration;
  need(['keep720', 'resize1080to720', 'fullResize1080to720', 'fullResize1440to720'].includes(kind) && typeof report === 'string' && path.isAbsolute(report)
    && (reportSha === null || typeof reportSha === 'string' && /^[a-f0-9]{64}$/.test(reportSha)),
  'A fixed variant and exact or pending receipt are required.');
  const full1440 = kind === 'fullResize1440to720', full = full1440 || kind === 'fullResize1080to720', resize = kind !== 'keep720';
  const config = Object.freeze({ report, reportSha, resize, full, full1440, sourceWidth: full1440 ? 2560 : 1920, sourceHeight: full1440 ? 1440 : 1080,
    familyId: full1440 ? FULL_1440_RESIZE_FAMILY_ID : full ? FULL_RESIZE_FAMILY_ID : resize ? RESIZE_FAMILY_ID : FAMILY_ID, resourcePolicy: full1440 ? FULL_1440_RESIZE_RESOURCE_POLICY : full ? FULL_RESIZE_RESOURCE_POLICY : resize ? RESIZE_RESOURCE_POLICY : RESOURCE_POLICY,
    derive: full1440 ? deriveCfrFull1440ResizeFlacResources : full ? deriveCfrFullResizeFlacResources : resize ? deriveCfrResizeFlacResources : deriveCfrFlacResources,
    policyIdentity: full1440 ? 'blue-linux-full-1440-resize-clock-qualified-v1' : full ? 'blue-linux-full-resize-clock-qualified-v1' : resize ? 'blue-linux-resize-clock-qualified-v1' : 'blue-linux-long-range-clock-qualified-v1' });
  return Object.freeze({ createService: options => createProportionalService(options, config),
    assertReceipt: (bytes, expectedSha = config.reportSha) => assertProportionalReceipt(bytes, expectedSha, config) });
}
const original = createProportionalServiceFactory({ kind: 'keep720', report: REPORT, reportSha: REPORT_SHA });
const createLongRangeService = original.createService, assertLongRangeReceipt = original.assertReceipt;
module.exports = { createLongRangeService, assertLongRangeReceipt, assertQualifiedClocks, ClockQualifiedFamilySelector,
  REPORT, REPORT_SHA, CLOCKS, clockGuardedRunner, createProportionalServiceFactory, assertProportionalReceiptForRuntime };
