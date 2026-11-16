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
  RESIZE_FAMILY_ID, RESIZE_RESOURCE_POLICY } = require('../src/operation-resource-budget.cjs');
const { inspectInput, inspectMetadata } = require('../src/inspection.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation, fingerprintEncodeSource, withEncodeOperationTelemetry, resolveEncodeOperationInvocation,
  validateEncodeOperationTelemetry, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { collectOperationEvidence } = require('../src/operation-evidence.cjs');
const { createStage, sealStage, retainSealedStage } = require('../src/outputs.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { PROFILES, describeRecipe } = require('../src/media.cjs');
const { generationDescriptionOf } = require('../src/provenance.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
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
// Two fixed, main-owned developer campaigns, not a caller-supplied geometry,
// runtime or qualification channel. Each has its own retained report namespace.
function campaign(kind = 'keep720') {
  assert.ok(['keep720', 'resize1080to720'].includes(kind), 'Unknown developer calibration campaign');
  const resize = kind === 'resize1080to720';
  return Object.freeze({ label: resize ? 'resize-calibration-' : 'long-range-calibration-',
    width: resize ? 1920 : 1280, height: resize ? 1080 : 720, resolution: resize ? '720' : 'source',
    familyId: resize ? RESIZE_FAMILY_ID : FAMILY_ID, resourcePolicy: resize ? RESIZE_RESOURCE_POLICY : RESOURCE_POLICY,
    derive: resize ? deriveCfrResizeFlacResources : deriveCfrFlacResources });
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
const errorRecord = error => ({ code: error.code, message: error.message,
  ...(error.evidenceDirectory ? { evidenceDirectory: error.evidenceDirectory } : {}),
  ...(error.cause ? { cause: { code: error.cause.code, message: error.cause.message } } : {}) });
async function runCampaign(kind) {
  const config = campaign(kind), sources = structuredClone(SOURCES);
  assert.equal(typeof config.derive, 'function', 'The matching reviewed resource planner is required');
  const space = await fs.statfs(__dirname, { bigint: true });
  assert.ok(space.bavail * space.bsize > 25n * 1024n ** 3n + 2n * 1024n ** 3n, 'Retain storage floor plus campaign allocation');
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts', config.label));
  const report = { root, status: 'preparing', runtimeIdentity: RUNTIME_ID, resourcePolicy: config.resourcePolicy,
    geometry: { sourceWidth: config.width, sourceHeight: config.height, resolution: config.resolution, outputWidth: 1280, outputHeight: 720 },
    publicationAuthorized: false, catalogActivated: false, settings: SETTINGS, sources: [], cases: [],
    census: { spawned: 0, closed: 0, live: 0, maximum: 0 }, totalPipeBytes: 0 };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30 * 60000);
  const invoke = createAv1ProportionalRunner({ onChild(child) {
    const c = report.census; c.spawned++; c.live++; c.maximum = Math.max(c.maximum, c.live);
    child.once('close', () => { c.closed++; c.live--; });
  } });
  let activeTelemetry, activeStage, activeCase, caseController, caseTimer;
  const run = async (executable, args, options = {}) => {
    assert.ok(report.census.spawned < 160, 'Campaign child ceiling');
    let ended = false;
    const encoding = args.includes('-progress');
    const result = await invoke(executable, args, { timeoutMs: 300000, stdoutLimit: 16 * 1024 * 1024,
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
    assert.equal(result.exitCode, 0); assert.equal(report.census.live, 0);
    if (encoding) assert.equal(ended, true, 'Terminal progress required');
    return result;
  };
  try {
    for (const spec of sources) {
      const source = path.join(root, `${spec.id}.mov`);
      await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n',
        '-f', 'lavfi', '-i', `testsrc2=size=${config.width}x${config.height}:rate=30:duration=${spec.seconds}`,
        '-f', 'lavfi', '-i', `aevalsrc=0.18*sin(2*PI*(${spec.frequency}*t+5.5*t*t))|0.18*sin(2*PI*(${spec.frequency + 219}*t+6.5*t*t)):s=48000:c=stereo:d=${spec.seconds}`,
        '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
        '-vf', `${spec.flip ? 'hflip,' : ''}setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
        '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p',
        '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=3:b-adapt=0:open-gop=0',
        '-fps_mode:v:0', 'passthrough', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709',
        '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv', '-c:a:0', 'pcm_s16le', '-sample_fmt:a:0', 's16',
        '-ar:a:0', '48000', '-channel_layout:a:0', 'stereo', '-t', String(spec.seconds), '-movflags', '+faststart', '-f', 'mov', source],
      { timeoutMs: 30000 + spec.seconds * 3000 * config.width * config.height / (1280 * 720) });
      const sourceHash = await fileHash(source), sourceIdentity = await readSourceIdentity(source);
      const inspection = await inspectInput(source, { ffprobe: PINS.ffprobe.path, signal: controller.signal, run });
      assert.equal(inspection.color.classification, 'sdr'); assert.equal(inspection.color.supported, true);
      const sourceVideo = inspection.probe.streams.find(s => s.codec_type === 'video');
      assert.equal(sourceVideo.width, config.width); assert.equal(sourceVideo.height, config.height);
      const observed = [inspection.probe.format.duration, ...inspection.probe.streams.map(s => s.duration)].map(micros);
      assert.ok(observed.every(value => value === spec.seconds * 1000000));
      const sourceExtentUs = Math.max(...observed);
      const frozen = frozenQualifications(`${path.basename(root)}:${spec.id}`, RUNTIME_ID, inspection.probe);
      await fs.writeFile(path.join(root, `${spec.id}-frozen-before-encode.json`), JSON.stringify(frozen, null, 2), { flag: 'wx' });
      report.sources.push({ id: spec.id, path: source, sha256: sourceHash, identity: sourceIdentity,
        sourceExtentUs, probe: inspection.probe, frozen });
      const runtimeVersion = (await run(PINS.ffmpeg.path, ['-version'])).stdout.split('\n')[0];
      const profile = PROFILES.find(row => row.id === SETTINGS.profileId), recipe = describeRecipe(SETTINGS);
      for (const requestSpec of spec.cases) {
        const start = requestSpec.range.startUs || 0, end = requestSpec.range.endUs ?? sourceExtentUs;
        const resources = config.derive({ sourceExtentUs, selectedExtentUs: end - start, sourceBytes: sourceIdentity.size });
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
          ? { evidenceId: `${path.basename(root)}:${spec.id}:owned-test-signal-identity`, runtimeIdentity: RUNTIME_ID,
            sourceEvidenceFingerprint: fingerprintEncodeSource(inspection.probe), videoIndex: sourceVideo.index } : null;
        const plan = withEncodeOperationTelemetry(buildEncodeOperation({ input: source, output: path.join(directory, 'prepared.mkv'),
          settings: SETTINGS, inspection, request, runtimeIdentity: RUNTIME_ID, outputId: randomUUID(), generationDescription,
          ...(orientation ? { identityOrientationQualification: orientation } : {}) }));
        const entry = activeCase = { id: requestSpec.id, sourceId: spec.id, range: requestSpec.range,
          resources, pipeBytes: 0, status: 'encoding', planFingerprint: plan.planFingerprint, startedAt: Date.now(),
          geometry: plan.expectedOutput.geometry, videoFilters: plan.expectedOutput.filters.video,
          identityOrientationInterpretation: orientation ? { ...orientation,
            basis: 'Owned unrotated test-signal construction with unchanged independently hashed source; no rotation tag is fabricated.' } : null };
        caseController = new AbortController();
        caseTimer = setTimeout(() => caseController.abort(), resources.executionBudgetMs);
        report.cases.push(entry);
        await fs.writeFile(path.join(directory, 'resources-before-encode.json'), JSON.stringify(resources, null, 2), { flag: 'wx' });
        const telemetry = activeTelemetry = await createOperationTelemetry({ stageDirectory: directory, runtimeIdentity: RUNTIME_ID,
          planFingerprint: plan.planFingerprint, streams: plan.instrumentation.streams,
          maxBytes: resources.resources.telemetryBytes, maxRecords: resources.resources.telemetryRecords });
        await assertTelemetryReady(telemetry);
        await run(PINS.ffmpeg.path, resolveEncodeOperationInvocation(plan, { output: stage.file, telemetry }), { timeoutMs: resources.budget.timeoutMs });
        await sealStage(stage);
        const telemetryEvidence = await collectOperationTelemetry(telemetry, { completion: { childClosed: true, exitCode: 0, cancelled: false }, signal: controller.signal });
        await closeOperationTelemetry(telemetry, { childClosed: true }); activeTelemetry = null;
        const outputProbe = await inspectMetadata(stage.file, { ffprobe: PINS.ffprobe.path, signal: controller.signal, run });
        for (const stream of outputProbe.streams) assert.equal(stream.time_base, frozen.expectedOutputTimeBase);
        const outputVideo = outputProbe.streams.find(s => s.codec_type === 'video');
        assert.equal(outputVideo.width, 1280); assert.equal(outputVideo.height, 720);
        assert.equal(outputVideo.sample_aspect_ratio, '1:1'); assert.equal(outputVideo.display_aspect_ratio, '16:9');
        entry.status = 'collecting-evidence';
        const collection = await collectOperationEvidence({ plan, sourceProbe: inspection.probe, outputProbe,
          sourcePath: source, outputPath: stage.file, stageDirectory: directory,
          ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path, run, signal: controller.signal,
          budget: resources.budget, timingQualification: frozen.timingQualification,
          sourcePolicy: { id: config.familyId, rate: 30, maximumExtentUs: sourceExtentUs } });
        entry.telemetry = validateEncodeOperationTelemetry(plan, telemetryEvidence, collection);
        entry.validation = validateEncodeOperationOutput(plan, outputProbe, { qualification: frozen.qualification, decodedEvidence: collection.decodedEvidence });
        assert.equal(entry.validation.valid, true, entry.validation.errors.join('; '));
        const video = collection.decodedEvidence.video, audio = collection.decodedEvidence.audio[0];
        assert.equal(video.sourceFrameCount, count(start, end, 30)); assert.equal(video.outputFrameCount, video.sourceFrameCount);
        assert.equal(audio.sourceSampleCount, count(start, end, 48000)); assert.equal(audio.outputSampleCount, audio.sourceSampleCount);
        assert.equal(audio.pcmIdentity.sourceHash, audio.pcmIdentity.outputHash);
        assert.equal(collection.completeSource.video.frames, spec.seconds * 30);
        assert.equal(Number(collection.completeSource.audio[0].sampleCount), spec.seconds * 48000);
        entry.frames = video.sourceFrameCount; entry.samples = audio.sourceSampleCount; entry.pcmIdentity = audio.pcmIdentity;
        entry.completeSource = collection.completeSource;
        await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', stage.file, '-map', '0', '-f', 'null', '-'], { timeoutMs: resources.budget.timeoutMs });
        assert.equal(await fileHash(source), sourceHash); assert.deepEqual(await readSourceIdentity(source), sourceIdentity);
        entry.elapsedMs = Date.now() - entry.startedAt; assert.ok(entry.elapsedMs <= resources.executionBudgetMs);
        await retainSealedStage(stage, 'Pre-catalog longer-range calibration; not published or registered.'); activeStage = null;
        entry.status = 'passed'; entry.output = stage.file; activeCase = null;
        clearTimeout(caseTimer); caseTimer = null; caseController = null;
      }
    }
    report.status = 'passed-pre-catalog-calibration';
  } catch (error) {
    report.status = 'failed-retained'; report.failure = errorRecord(error); process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    clearTimeout(caseTimer);
    if (activeTelemetry) await closeOperationTelemetry(activeTelemetry, { childClosed: report.census.live === 0 }).catch(error => { report.closeFailure = errorRecord(error); });
    if (activeStage) await retainSealedStage(activeStage, 'Failed longer-range calibration retained.').catch(() => {});
    if (report.census.live || report.census.spawned !== report.census.closed || report.census.maximum > 1 || report.closeFailure) {
      report.status = 'failed-retained'; report.closeFailure ||= { message: 'Unbalanced or overlapping children' }; process.exitCode = 1;
    }
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ root, status: report.status, census: report.census, totalPipeBytes: report.totalPipeBytes,
    cases: report.cases.map(({ id, status, frames, samples, elapsedMs, pipeBytes }) => ({ id, status, frames, samples, elapsedMs, pipeBytes })),
    failure: report.failure, closeFailure: report.closeFailure }, null, 2));
  return report;
}
const main = () => runCampaign('keep720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, runCampaign, campaign, micros, count, SOURCES };
