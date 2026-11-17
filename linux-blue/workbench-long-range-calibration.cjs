'use strict';
// Pre-catalog qualification only. Reuse real shared builders and independent
// validators; no fixture hash or chosen output error creates family authority.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { PINS, RUNTIME_ID, createAv1ProportionalRunner } = require('./runtime-av1-operation.cjs');
const { deriveCfrFlacResources, FAMILY_ID, RESOURCE_POLICY, deriveCfrResizeFlacResources,
  RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY, FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY,
  deriveCfrFullResizeFlacResources, FULL_1440_RESIZE_FAMILY_ID, FULL_1440_RESIZE_RESOURCE_POLICY,
  deriveCfrFull1440ResizeFlacResources } = require('../src/operation-resource-budget.cjs');
const { inspectInput, inspectMetadata } = require('../src/inspection.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation, fingerprintEncodeSource, withEncodeOperationTelemetry, resolveEncodeOperationInvocation,
  validateEncodeOperationTelemetry, validateEncodeOperationOutput, describeEncodeOperationSource } = require('../src/encode-operation.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { collectOperationEvidence } = require('../src/operation-evidence.cjs');
const { createStage, sealStage, retainSealedStage } = require('../src/outputs.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { PROFILES, describeRecipe } = require('../src/media.cjs');
const { generationDescriptionOf } = require('../src/provenance.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { OperationFamilySelector, assertProportionalCollectionSelection } = require('../src/operation-family.cjs');
const { requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const SOURCES = Object.freeze([
  { id: 'long-pattern', seconds: 150, flip: false, frequency: 440, cases: [
    { id: 'late-forty-seconds', range: { startUs: 100000000, endUs: 140000000 } },
    { id: 'late-open-end', range: { startUs: 130000000 } },
  ] },
  { id: 'heldout-flipped', seconds: 11, flip: true, frequency: 523, cases: [
    { id: 'heldout-nonaligned', range: { startUs: 413000, endUs: 8621000 } },
  ] },
]);
const FULL_SOURCES = Object.freeze([
  { id: 'full-long-pattern', seconds: 150, audioSeconds: 150, flip: false, frequency: 440,
    cases: [{ id: 'full-long', range: null }] },
  { id: 'full-heldout-tail', seconds: 43.1, audioSeconds: 43.217, flip: true, frequency: 557,
    cases: [{ id: 'full-heldout-audio-tail', range: null }] },
]);
// The higher-resolution qualification varies only input pixel workload. Long
// extent arithmetic was already proved separately; do not repeat a 150s campaign
// merely to qualify this distinct geometry. A second content/audio-tail shape
// still has independently frozen clocks, counts and timing before encoding.
const FULL_1440_SOURCES = Object.freeze([
  { id: 'full-1440-pattern', seconds: 12, audioSeconds: 12, flip: false, frequency: 683,
    cases: [{ id: 'full-1440', range: null }] },
  { id: 'full-1440-heldout-tail', seconds: 7.1, audioSeconds: 7.217, flip: true, frequency: 907,
    cases: [{ id: 'full-1440-heldout-audio-tail', range: null }] },
]);
// Fixed, main-owned developer campaigns, not a caller-supplied geometry,
// runtime or qualification channel. Each has its own retained report namespace.
function campaign(kind = 'keep720') {
  assert.ok(['keep720', 'resize1080to720', 'fullResize1080to720', 'fullResize1440to720'].includes(kind), 'Unknown developer calibration campaign');
  const high1440 = kind === 'fullResize1440to720', full = high1440 || kind === 'fullResize1080to720', resize = kind !== 'keep720';
  return Object.freeze({ label: high1440 ? 'full-1440-calibration-' : full ? 'full-resize-calibration-' : resize ? 'resize-calibration-' : 'long-range-calibration-', full,
    width: high1440 ? 2560 : resize ? 1920 : 1280, height: high1440 ? 1440 : resize ? 1080 : 720, resolution: resize ? '720' : 'source',
    familyId: high1440 ? FULL_1440_RESIZE_FAMILY_ID : full ? FULL_RESIZE_FAMILY_ID : resize ? RESIZE_FAMILY_ID : FAMILY_ID,
    resourcePolicy: high1440 ? FULL_1440_RESIZE_RESOURCE_POLICY : full ? FULL_RESIZE_RESOURCE_POLICY : resize ? RESIZE_RESOURCE_POLICY : RESOURCE_POLICY,
    derive: high1440 ? deriveCfrFull1440ResizeFlacResources : full ? deriveCfrFullResizeFlacResources : resize ? deriveCfrResizeFlacResources : deriveCfrFlacResources });
}
function sourcesForCampaign(kind) { const config = campaign(kind); return structuredClone(kind === 'fullResize1440to720' ? FULL_1440_SOURCES : config.full ? FULL_SOURCES : SOURCES); }
function selectedCounts(config, spec, range, sourceExtentUs) {
  if (config.full) {
    assert.equal(range, null, 'Full is not a zero-to-end interval');
    return { frames: count(0, micros(spec.seconds), 30), samples: count(0, micros(spec.audioSeconds), 48000) };
  }
  const start = range.startUs || 0, end = range.endUs ?? sourceExtentUs;
  return { frames: count(start, end, 30), samples: count(start, end, 48000) };
}

async function fileHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function micros(value) {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(value));
  assert.ok(match, 'Exact nonnegative microsecond duration required');
  const result = BigInt(match[1]) * 1000000n + BigInt((match[2] || '').padEnd(6, '0'));
  assert.ok(result <= BigInt(Number.MAX_SAFE_INTEGER)); return Number(result);
}
const count = (start, end, rate) => Number((BigInt(end) * BigInt(rate) + 999999n) / 1000000n
  - (BigInt(start) * BigInt(rate) + 999999n) / 1000000n);
function fixtureTimeoutMs(seconds, width, height) {
  const timeout = Math.ceil(30000 + seconds * 3000 * width * height / (1280 * 720));
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 2147483647);
  return timeout;
}
// Settlement diagnostics are shallow inert strings, never recursive error graphs.
function settlementDiagnostic(error) {
  const diagnostic = error && Object.getOwnPropertyDescriptor(error, 'postVerificationFailure')?.value;
  if (!diagnostic || typeof diagnostic !== 'object') return undefined;
  const result = {};
  for (const [key, limit] of [['code', 128], ['message', 2048]]) {
    const value = Object.getOwnPropertyDescriptor(diagnostic, key)?.value;
    if (typeof value === 'string') result[key] = value.slice(0, limit);
  }
  return Object.keys(result).length ? result : undefined;
}
const errorRecord = error => ({ code: error.code, message: error.message,
  ...(settlementDiagnostic(error) ? { postVerificationFailure: settlementDiagnostic(error) } : {}),
  ...(error.evidenceDirectory ? { evidenceDirectory: error.evidenceDirectory } : {}),
  ...(error.cause ? { cause: { code: error.cause.code, message: error.cause.message } } : {}) });
// This local descriptor authorizes bounded experimental acquisition only. Its
// clock-derived bounds are preregistered, not measured catalog qualification.
function candidateSelector(kind, evidenceId, runtimeIdentity, sourceProbe) {
  assert.ok(['keep720', 'resize1080to720'].includes(kind), 'Fixed candidate range family required');
  const config = campaign(kind), frozen = frozenQualifications(evidenceId, runtimeIdentity, sourceProbe);
  const selector = new OperationFamilySelector({ policyIdentity: evidenceId, families: [{
    id: config.familyId, resourcePolicy: config.resourcePolicy, runtimeIdentity, environment: null,
    settings: SETTINGS, qualification: frozen.qualification, timingQualification: frozen.timingQualification,
    evidenceIds: [frozen.qualification.evidenceId, frozen.timingQualification.evidenceId] }] });
  return { selector, frozen };
}
const prepareCandidateKeep720Case = options => prepareCandidateCase('keep720', options);
const prepareCandidateResize1080to720Case = options => prepareCandidateCase('resize1080to720', options);
async function prepareCandidateCase(kind, options) {
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
  const { selector, frozen } = candidateSelector(kind, evidenceId, runtime.runtimeIdentity, sourceProbe);
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
const runCandidateKeep720Campaign = options => runCandidateCampaign('keep720', options);
const runCandidateResize1080to720Campaign = options => runCandidateCampaign('resize1080to720', options);
async function runCandidateCampaign(kind, options) {
  assert.ok(options && Object.getPrototypeOf(options) === Object.prototype);
  assert.deepEqual(Reflect.ownKeys(options), ['verifiedRuntime']);
  assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(options, 'verifiedRuntime'), 'value'));
  const runtime = requireCandidateCalibrationRuntime(options.verifiedRuntime);
  let report, failure;
  try { await runtime.requireCurrent(); report = await runConfiguredCampaign(kind, runtime); }
  catch (error) { failure = error; }
  try { await runtime.close(); }
  catch (error) {
    if (report) {
      report.status = 'failed-retained'; report.runtimeCloseFailure = errorRecord(error);
      try { await fs.writeFile(path.join(report.root, 'report.json'), JSON.stringify(report, null, 2)); }
      catch (saveError) { throw new AggregateError([error, saveError], 'Runtime closure and final report persistence failed'); }
    } else if (failure) throw new AggregateError([failure, error], 'Candidate campaign and runtime closure failed');
    else throw error;
  }
  if (failure) throw failure;
  return report;
}
const runCampaign = kind => runConfiguredCampaign(kind, null);
async function runConfiguredCampaign(kind, candidate) {
  if (candidate) { requireCandidateCalibrationRuntime(candidate); assert.ok(['keep720', 'resize1080to720'].includes(kind)); await candidate.requireCurrent(); }
  const pins = candidate ? candidate.pins : PINS, runtimeIdentity = candidate ? candidate.runtimeIdentity : RUNTIME_ID;
  const config = campaign(kind), sources = sourcesForCampaign(kind);
  assert.equal(typeof config.derive, 'function', 'The matching reviewed resource planner is required');
  const space = await fs.statfs(__dirname, { bigint: true });
  assert.ok(space.bavail * space.bsize > 25n * 1024n ** 3n + 2n * 1024n ** 3n, 'Retain storage floor plus campaign allocation');
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts', candidate ? `candidate-${kind}-calibration-` : config.label));
  const report = { root, status: 'preparing', runtimeIdentity, resourcePolicy: config.resourcePolicy,
    geometry: { sourceWidth: config.width, sourceHeight: config.height, resolution: config.resolution, outputWidth: 1280, outputHeight: 720 },
    publicationAuthorized: false, catalogActivated: false,
    ...(candidate ? { candidateRuntime: true, boundsClassification: 'preregistered-clock-derived-acceptance-bounds; measured only by this campaign, never automatic catalog authority' } : {}), settings: SETTINGS, sources: [], cases: [],
    children: [], census: { spawned: 0, closed: 0, live: 0, maximum: 0 }, totalPipeBytes: 0 };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30 * 60000);
  let currentChildRecord;
  const invoke = (candidate ? candidate.createRunner : createAv1ProportionalRunner)({ onChild(child) {
    const c = report.census; c.spawned++; c.live++; c.maximum = Math.max(c.maximum, c.live);
    const record = currentChildRecord;
    if (record) {
      record.stderr.available = Boolean(child.stderr?.on);
      const chunks = record.chunks;
      child.stderr?.on('data', bytes => {
        const chunk = Buffer.from(bytes), room = 256 * 1024 - record.stderr.retainedBytes;
        record.stderr.totalBytes += chunk.length;
        if (room > 0) { const kept = Buffer.from(chunk.subarray(0, room)); chunks.push(kept); record.stderr.retainedBytes += kept.length; }
        record.stderr.truncated = record.stderr.totalBytes > record.stderr.retainedBytes;
      });
    }
    child.once('close', (code, signal) => { c.closed++; c.live--; if (record) { record.closed = true; record.exitCode = code; record.signal = signal; } });
  } });
  let activeTelemetry, activeStage, activeCase, activeSelection, caseController, caseTimer;
  const run = async (executable, args, options = {}) => {
    if (candidate) await candidate.requireCurrent();
    if (activeSelection) await activeSelection.requireCurrent();
    assert.ok(report.census.spawned < 160, 'Campaign child ceiling');
    const remaining = await fs.statfs(root, { bigint: true });
    assert.ok(remaining.bavail * remaining.bsize >= 27n * 1024n ** 3n, 'Campaign free-space floor');
    const record = currentChildRecord = { sequence: report.children.length + 1, executable, args: [...args], closed: false,
      stderr: { available: false, totalBytes: 0, retainedBytes: 0, truncated: false }, chunks: [] };
    report.children.push(record);
    let ended = false, result, failure;
    const encoding = args.includes('-progress');
    try { result = await invoke(executable, args, { timeoutMs: 300000, stdoutLimit: 16 * 1024 * 1024,
      stderrLimit: 256 * 1024, ...options,
      signal: AbortSignal.any([controller.signal, ...(caseController ? [caseController.signal] : []), ...(options.signal ? [options.signal] : [])]),
      onOutputBytes(record) {
        report.totalPipeBytes += record.bytes;
        if (activeCase) {
          activeCase.pipeBytes += record.bytes;
          assert.ok(activeCase.pipeBytes <= activeCase.resources.resources.pipeBytes, 'Case aggregate pipe budget');
        }
        options.onOutputBytes?.(record);
      },
      ...(encoding ? { onProgress(value) { ended ||= value.ended === true; options.onProgress?.(value); } } : {}) });
    } catch (error) { failure = error; record.failure = errorRecord(error); }
    finally {
      currentChildRecord = null;
      const bytes = Buffer.concat(record.chunks); delete record.chunks;
      record.stderr.completeAtSave = record.closed && record.stderr.available;
      record.stderr.sha256 = createHash('sha256').update(bytes).digest('hex');
      record.stderr.path = path.join(root, `child-${String(record.sequence).padStart(3, '0')}.stderr`);
      try { await fs.writeFile(record.stderr.path, bytes, { flag: 'wx' }); }
      catch (error) { record.stderr.saveFailure = errorRecord(error); if (!failure) failure = error; }
    }
    if (failure) throw failure;
    assert.equal(result.exitCode, 0); assert.equal(report.census.live, 0);
    if (encoding) assert.equal(ended, true, 'Terminal progress required');
    return result;
  };
  try {
    for (const spec of sources) {
      const audioSeconds = spec.audioSeconds ?? spec.seconds, maximumSeconds = Math.max(spec.seconds, audioSeconds);
      const source = path.join(root, `${spec.id}.mov`);
      await run(pins.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n',
        '-f', 'lavfi', '-i', `testsrc2=size=${config.width}x${config.height}:rate=30:duration=${spec.seconds}`,
        '-f', 'lavfi', '-i', `aevalsrc=0.18*sin(2*PI*(${spec.frequency}*t+5.5*t*t))|0.18*sin(2*PI*(${spec.frequency + 219}*t+6.5*t*t)):s=48000:c=stereo:d=${audioSeconds}`,
        '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
        '-vf', `${spec.flip ? 'hflip,' : ''}setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
        '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p',
        '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=3:b-adapt=0:open-gop=0',
        '-fps_mode:v:0', 'passthrough', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709',
        '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv', '-c:a:0', 'pcm_s16le', '-sample_fmt:a:0', 's16',
        '-ar:a:0', '48000', '-channel_layout:a:0', 'stereo', '-t', String(maximumSeconds), '-movflags', '+faststart', '-f', 'mov', source],
      { timeoutMs: fixtureTimeoutMs(maximumSeconds, config.width, config.height) });
      const sourceHash = await fileHash(source), sourceIdentity = await readSourceIdentity(source);
      const inspection = await inspectInput(source, { ffprobe: pins.ffprobe.path, signal: controller.signal, run });
      assert.equal(inspection.color.classification, 'sdr'); assert.equal(inspection.color.supported, true);
      const sourceVideo = inspection.probe.streams.find(s => s.codec_type === 'video');
      assert.equal(sourceVideo.width, config.width); assert.equal(sourceVideo.height, config.height);
      const observed = [inspection.probe.format.duration, ...inspection.probe.streams.map(s => s.duration)].map(micros);
      const sourceAudio = inspection.probe.streams.find(s => s.codec_type === 'audio');
      assert.equal(micros(sourceVideo.duration), micros(spec.seconds));
      assert.equal(micros(sourceAudio.duration), micros(audioSeconds));
      assert.equal(micros(inspection.probe.format.duration), micros(maximumSeconds));
      const sourceExtentUs = Math.max(...observed);
      const frozen = frozenQualifications(`${path.basename(root)}:${spec.id}`, runtimeIdentity, inspection.probe);
      await fs.writeFile(path.join(root, `${spec.id}-frozen-before-encode.json`), JSON.stringify(frozen, null, 2), { flag: 'wx' });
      report.sources.push({ id: spec.id, path: source, sha256: sourceHash, identity: sourceIdentity,
        sourceExtentUs, probe: inspection.probe, frozen });
      const runtimeVersion = (await run(pins.ffmpeg.path, ['-version'])).stdout.split('\n')[0];
      const profile = PROFILES.find(row => row.id === SETTINGS.profileId), recipe = describeRecipe(SETTINGS);
      for (const requestSpec of spec.cases) {
        const expectedCounts = selectedCounts(config, spec, requestSpec.range, sourceExtentUs);
        let resources = config.full ? config.derive({ sourceExtentUs, sourceBytes: sourceIdentity.size })
          : config.derive({ sourceExtentUs, selectedExtentUs: (requestSpec.range.endUs ?? sourceExtentUs) - (requestSpec.range.startUs || 0), sourceBytes: sourceIdentity.size });
        const directory = path.join(root, requestSpec.id); await fs.mkdir(directory);
        const stage = activeStage = await createStage(directory);
        const request = resolveFileRequest({ fileId: requestSpec.id, identityRevision: 1, draftRevision: 1,
          operation: 'encode', overrides: { range: requestSpec.range, resolution: config.resolution, audioPolicy: 'precision-flac' } });
        const generationDescription = generationDescriptionOf({ version: 1, profileId: profile.id, codec: profile.codec,
          backend: profile.hardware, encoder: profile.encoder, preset: SETTINGS.preset, qualityMode: recipe.qualityMode,
          quality: 25, bitDepth: 8, encoderArgs: recipe.args, appVersion: require('../package.json').version,
          runtimeVersion, createdAt: new Date().toISOString() });
        const geometry = inspection.probe.mediaEvidence.streams.find(s => s.index === sourceVideo.index).geometry;
        const orientation = config.resolution === '720' && geometry.rotationSource === 'not-reported'
          ? { evidenceId: `${path.basename(root)}:${spec.id}:owned-test-signal-identity`, runtimeIdentity,
            sourceEvidenceFingerprint: fingerprintEncodeSource(inspection.probe), videoIndex: sourceVideo.index } : null;
        let orientationOptions = orientation ? { identityOrientationQualification: orientation } : {};
        if (candidate && kind === 'resize1080to720') {
          const prepared = candidateSelector(kind, `${path.basename(root)}:${spec.id}`, runtimeIdentity, inspection.probe);
          try {
            await candidate.requireCurrent();
            assert.deepEqual(await readSourceIdentity(source), sourceIdentity);
            orientationOptions = prepared.selector.orientationQualification({ inspection, request, runtimeIdentity, settings: SETTINGS });
          } finally { prepared.selector.invalidate('Pre-plan orientation scope closed.'); }
        }
        const plan = withEncodeOperationTelemetry(buildEncodeOperation({ input: source, output: path.join(directory, 'prepared.mkv'),
          settings: SETTINGS, inspection, request, runtimeIdentity, outputId: randomUUID(), generationDescription,
          ...orientationOptions }));
        if (candidate) {
          activeSelection = await prepareCandidateCase(kind, { verifiedRuntime: candidate, plan, sourceIdentity,
            evidenceId: `${path.basename(root)}:${spec.id}` });
          assert.deepEqual(activeSelection.frozen, frozen, 'Preregistered bounds must not change after plan construction');
          assert.deepEqual(activeSelection.resources, resources, 'Independent forecast and issued limits must agree');
          resources = activeSelection.resources;
        }
        if (config.full) {
          assert.equal(plan.contract.range.kind, 'full'); assert.equal(plan.contract.range.requested, null);
          assert.equal(plan.contract.range.resolved, undefined); assert.equal(plan.contract.range.timestampMapping, 'preserve-source');
          assert.ok(!plan.expectedOutput.filters.video.some(filter => /(?:^|,)(?:trim|setpts)=/.test(filter)), 'Full must not trim or rebase video');
        }
        const entry = activeCase = { id: requestSpec.id, sourceId: spec.id, range: requestSpec.range,
          resources, pipeBytes: 0, status: 'encoding', planFingerprint: plan.planFingerprint, startedAt: Date.now(),
          geometry: plan.expectedOutput.geometry, videoFilters: plan.expectedOutput.filters.video,
          identityOrientationInterpretation: orientationOptions.identityOrientationQualification ? { ...orientationOptions.identityOrientationQualification,
            basis: 'Owned unrotated test-signal construction with unchanged independently hashed source; no rotation tag is fabricated.' } : null };
        caseController = new AbortController();
        caseTimer = setTimeout(() => caseController.abort(), resources.executionBudgetMs);
        report.cases.push(entry);
        await fs.writeFile(path.join(directory, 'resources-before-encode.json'), JSON.stringify(resources, null, 2), { flag: 'wx' });
        const telemetry = activeTelemetry = await createOperationTelemetry({ stageDirectory: directory, runtimeIdentity,
          planFingerprint: plan.planFingerprint, streams: plan.instrumentation.streams,
          maxBytes: resources.resources.telemetryBytes, maxRecords: resources.resources.telemetryRecords });
        await assertTelemetryReady(telemetry);
        await run(pins.ffmpeg.path, resolveEncodeOperationInvocation(plan, { output: stage.file, telemetry }), { timeoutMs: resources.budget.timeoutMs });
        await sealStage(stage);
        const telemetryEvidence = await collectOperationTelemetry(telemetry, { completion: { childClosed: true, exitCode: 0, cancelled: false }, signal: controller.signal });
        await closeOperationTelemetry(telemetry, { childClosed: true }); activeTelemetry = null;
        const outputProbe = await inspectMetadata(stage.file, { ffprobe: pins.ffprobe.path, signal: controller.signal, run });
        for (const stream of outputProbe.streams) assert.equal(stream.time_base, frozen.expectedOutputTimeBase);
        const outputVideo = outputProbe.streams.find(s => s.codec_type === 'video');
        assert.equal(outputVideo.width, 1280); assert.equal(outputVideo.height, 720);
        assert.equal(outputVideo.sample_aspect_ratio, '1:1'); assert.equal(outputVideo.display_aspect_ratio, '16:9');
        entry.status = 'collecting-evidence';
        const collection = await collectOperationEvidence({ plan, sourceProbe: inspection.probe, outputProbe,
          sourcePath: source, outputPath: stage.file, stageDirectory: directory,
          ffmpeg: pins.ffmpeg.path, ffprobe: pins.ffprobe.path, run, signal: controller.signal,
          budget: resources.budget, timingQualification: activeSelection ? activeSelection.selection.timingQualification : frozen.timingQualification,
          sourcePolicy: activeSelection ? activeSelection.selection.sourcePolicy : { id: config.familyId, rate: 30, maximumExtentUs: sourceExtentUs },
          ...(activeSelection ? { familySelection: activeSelection.selection } : {}) });
        entry.telemetry = validateEncodeOperationTelemetry(plan, telemetryEvidence, collection);
        requireValidCampaignTelemetry(entry.telemetry);
        entry.validation = validateEncodeOperationOutput(plan, outputProbe, { qualification: frozen.qualification, decodedEvidence: collection.decodedEvidence });
        assert.equal(entry.validation.valid, true, entry.validation.errors.join('; '));
        const video = collection.decodedEvidence.video, audio = collection.decodedEvidence.audio[0];
        assert.equal(video.sourceFrameCount, expectedCounts.frames); assert.equal(video.outputFrameCount, video.sourceFrameCount);
        assert.equal(audio.sourceSampleCount, expectedCounts.samples); assert.equal(audio.outputSampleCount, audio.sourceSampleCount);
        assert.equal(audio.pcmIdentity.sourceHash, audio.pcmIdentity.outputHash);
        assert.equal(collection.completeSource.video.frames, count(0, micros(spec.seconds), 30));
        assert.equal(Number(collection.completeSource.audio[0].sampleCount), count(0, micros(audioSeconds), 48000));
        entry.frames = video.sourceFrameCount; entry.samples = audio.sourceSampleCount; entry.pcmIdentity = audio.pcmIdentity;
        entry.completeSource = collection.completeSource;
        await run(pins.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', stage.file, '-map', '0', '-f', 'null', '-'], { timeoutMs: resources.budget.timeoutMs });
        assert.equal(await fileHash(source), sourceHash); assert.deepEqual(await readSourceIdentity(source), sourceIdentity);
        entry.elapsedMs = Date.now() - entry.startedAt; assert.ok(entry.elapsedMs <= resources.executionBudgetMs);
        await retainSealedStage(stage, 'Pre-catalog longer-range calibration; not published or registered.'); activeStage = null;
        entry.status = 'passed'; entry.output = stage.file; activeCase = null;
        activeSelection?.close(); activeSelection = null;
        clearTimeout(caseTimer); caseTimer = null; caseController = null;
      }
    }
    report.status = 'passed-pre-catalog-calibration';
  } catch (error) {
    report.status = 'failed-retained'; report.failure = errorRecord(error); if (!candidate) process.exitCode = 1;
  } finally {
    activeSelection?.close();
    clearTimeout(timer);
    clearTimeout(caseTimer);
    if (activeTelemetry) await closeOperationTelemetry(activeTelemetry, { childClosed: report.census.live === 0 }).catch(error => { report.closeFailure = errorRecord(error); });
    if (activeStage) await retainSealedStage(activeStage, 'Failed longer-range calibration retained.').catch(() => {});
    if (report.census.live || report.census.spawned !== report.census.closed || report.census.maximum > 1 || report.closeFailure) {
      report.status = 'failed-retained'; report.closeFailure ||= { message: 'Unbalanced or overlapping children' }; if (!candidate) process.exitCode = 1;
    }
    report.diagnosticsComplete = report.children.every(row => row.closed && row.stderr.available && row.stderr.completeAtSave && !row.stderr.truncated && !row.stderr.saveFailure);
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ root, status: report.status, census: report.census, totalPipeBytes: report.totalPipeBytes,
    cases: report.cases.map(({ id, status, frames, samples, elapsedMs, pipeBytes }) => ({ id, status, frames, samples, elapsedMs, pipeBytes })),
    failure: report.failure, closeFailure: report.closeFailure }, null, 2));
  return report;
}
function requireValidCampaignTelemetry(result) {
  assert.equal(result?.valid, true, 'Valid encoder telemetry required');
  assert.ok(Array.isArray(result.streams) && result.streams.length === 2, 'Video and audio telemetry required');
  assert.deepEqual(result.streams.map(row => row.kind).sort(), ['audio', 'video']);
  for (const row of result.streams) assert.equal(String(row.unknownInputRecords), '0', 'Unknown telemetry input rows refused');
}
const main = () => runCampaign('keep720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { prepareCandidateResize1080to720Case, runCandidateResize1080to720Campaign, requireValidCampaignTelemetry, main, runCampaign, runCandidateKeep720Campaign, prepareCandidateKeep720Case, campaign, sourcesForCampaign, selectedCounts, fixtureTimeoutMs, micros, count, SOURCES, FULL_SOURCES };
