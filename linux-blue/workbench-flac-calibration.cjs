'use strict';
// Local, synthetic pre-activation calibration. No catalog registration or output publication.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { PINS } = require('./runtime.cjs');
const { RUNTIME_ID, createRemuxRunner } = require('./workbench-remux.cjs');
const { inspectInput, inspectMetadata } = require('../src/inspection.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation, withEncodeOperationTelemetry, resolveEncodeOperationInvocation,
  validateEncodeOperationTelemetry, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { collectOperationEvidence } = require('../src/operation-evidence.cjs');
const { createStage, sealStage, retainSealedStage } = require('../src/outputs.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { PROFILES, describeRecipe } = require('../src/media.cjs');
const { generationDescriptionOf } = require('../src/provenance.cjs');
// Reuse only this pure pre-encode clock derivation, never its Windows main or evidence.
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000,
  maxFrameBytes: 8 * 1024 * 1024, maxPcmBytes: 128 * 1024 * 1024,
  maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const SPECS = Object.freeze([
  { label: 'head-half-second', range: { startUs: 0, endUs: 500000 } },
  { label: 'nonaligned-interior', range: { startUs: 1013000, endUs: 3087000 } },
  { label: 'held-out-open-end', range: { startUs: 2000000 } },
]);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const errorRecord = (error, depth = 0) => ({ code: error.code, message: error.message,
  ...(error.evidenceDirectory ? { evidenceDirectory: error.evidenceDirectory } : {}),
  ...(error.cause && depth < 3 ? { cause: errorRecord(error.cause, depth + 1) } : {}),
  ...(error.postVerificationFailure ? { postVerificationFailure: error.postVerificationFailure } : {}) });

async function calibrate({ pins = PINS, runtimeIdentity = RUNTIME_ID,
  createRunner = createRemuxRunner, label = 'flac-calibration-' } = {}) {
  // Main-only developer seam. No CLI, renderer or IPC accepts runtime selection.
  assert.ok(['flac-calibration-', 'flac-candidate-'].includes(label));
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts', label));
  const report = { root, runtimeIdentity, status: 'preparing', settings: SETTINGS,
    sourceEnvelope: 'Synthetic QuickTime H264 High 720p30 SDR, PCM16 stereo48k, four seconds; original geometry',
    publicationAuthorized: false, catalogActivated: false, cases: [],
    census: { spawned: 0, closed: 0, live: 0, maximum: 0 } };
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 600000);
  const invoke = createRunner({ onChild(child) { const c = report.census; c.spawned++; c.live++; c.maximum = Math.max(c.maximum, c.live);
    child.once('close', () => { c.closed++; c.live--; }); } });
  const run = async (executable, args, options = {}) => {
    assert.ok(report.census.spawned < 100, 'Calibration child budget');
    let ended = false;
    const encoding = args.includes('-progress');
    const result = await invoke(executable, args, { timeoutMs: 120000, stdoutLimit: 16 * 1024 * 1024,
      stderrLimit: 256 * 1024, ...options, signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]),
      ...(encoding ? { onProgress(value) { ended ||= value.ended === true; options.onProgress?.(value); } } : {}) });
    assert.equal(result.exitCode, 0); assert.equal(report.census.live, 0);
    if (encoding) assert.equal(ended, true, 'Canonical encode must close after terminal progress');
    return result;
  };
  let activeTelemetry, activeStage;
  try {
    const source = path.join(root, 'synthetic-720p30.mov');
    await run(pins.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n',
      '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=4',
      '-f', 'lavfi', '-i', 'aevalsrc=0.18*sin(2*PI*(440*t+5.5*t*t))|0.18*sin(2*PI*(659*t+6.5*t*t)):s=48000:c=stereo:d=4',
      '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
      '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p',
      '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=3:b-adapt=0:open-gop=0',
      '-fps_mode:v:0', 'passthrough', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709',
      '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv', '-c:a:0', 'pcm_s16le', '-sample_fmt:a:0', 's16',
      '-ar:a:0', '48000', '-channel_layout:a:0', 'stereo', '-t', '4', '-movflags', '+faststart', '-f', 'mov', source]);
    const sourceHash = sha(await fs.readFile(source)), sourceIdentity = await readSourceIdentity(source);
    const inspection = await inspectInput(source, { ffprobe: pins.ffprobe.path, signal: controller.signal, run });
    assert.equal(inspection.color.classification, 'sdr'); assert.equal(inspection.color.supported, true);
    report.source = { path: source, sha256: sourceHash, identity: sourceIdentity, probe: inspection.probe };
    const runtimeVersion = (await run(pins.ffmpeg.path, ['-version'])).stdout.split('\n')[0];
    const profile = PROFILES.find(row => row.id === SETTINGS.profileId), recipe = describeRecipe(SETTINGS);
    // Save bounds before encoding any candidate; held-out case cannot widen them.
    const frozen = frozenQualifications(path.basename(root), runtimeIdentity, inspection.probe);
    report.frozen = frozen;
    await fs.writeFile(path.join(root, 'frozen-before-encode.json'), JSON.stringify(frozen, null, 2), { flag: 'wx' });
    for (const spec of SPECS) {
      const directory = path.join(root, spec.label); await fs.mkdir(directory);
      const stage = activeStage = await createStage(directory);
      const request = resolveFileRequest({ fileId: spec.label, identityRevision: 1, draftRevision: 1, operation: 'encode',
        overrides: { range: spec.range, resolution: 'source', audioPolicy: 'precision-flac' } });
      const generationDescription = generationDescriptionOf({ version: 1, profileId: profile.id, codec: profile.codec,
        backend: profile.hardware, encoder: profile.encoder, preset: SETTINGS.preset, qualityMode: recipe.qualityMode,
        quality: 25, bitDepth: 8, encoderArgs: recipe.args, appVersion: require('../package.json').version,
        runtimeVersion, createdAt: new Date().toISOString() });
      const plan = withEncodeOperationTelemetry(buildEncodeOperation({ input: source, output: path.join(directory, 'prepared.mkv'),
        settings: SETTINGS, inspection, request, runtimeIdentity, outputId: randomUUID(), generationDescription }));
      const entry = { label: spec.label, range: spec.range, planFingerprint: plan.planFingerprint, status: 'encoding' };
      report.cases.push(entry);
      const telemetry = activeTelemetry = await createOperationTelemetry({ stageDirectory: directory, runtimeIdentity,
        planFingerprint: plan.planFingerprint, streams: plan.instrumentation.streams, maxBytes: BUDGET.maxFrameBytes, maxRecords: BUDGET.maxRecords });
      await assertTelemetryReady(telemetry);
      await run(pins.ffmpeg.path, resolveEncodeOperationInvocation(plan, { output: stage.file, telemetry }));
      await sealStage(stage);
      const telemetryEvidence = await collectOperationTelemetry(telemetry, { completion: { childClosed: true, exitCode: 0, cancelled: false }, signal: controller.signal });
      await closeOperationTelemetry(telemetry, { childClosed: true }); activeTelemetry = null;
      entry.status = 'collecting-evidence';
      const outputProbe = await inspectMetadata(stage.file, { ffprobe: pins.ffprobe.path, signal: controller.signal, run });
      for (const stream of outputProbe.streams) assert.equal(stream.time_base, frozen.expectedOutputTimeBase);
      const collection = await collectOperationEvidence({ plan, sourceProbe: inspection.probe, outputProbe, sourcePath: source,
        outputPath: stage.file, stageDirectory: directory, ffmpeg: pins.ffmpeg.path, ffprobe: pins.ffprobe.path, run,
        signal: controller.signal, budget: BUDGET, timingQualification: frozen.timingQualification,
        sourcePolicy: { id: 'short-sdr-range-flac-v1', rate: 30, maximumExtentUs: 120000000 } });
      entry.telemetry = validateEncodeOperationTelemetry(plan, telemetryEvidence, collection);
      entry.validation = validateEncodeOperationOutput(plan, outputProbe, { qualification: frozen.qualification, decodedEvidence: collection.decodedEvidence });
      assert.equal(entry.validation.valid, true, entry.validation.errors.join('; '));
      const audio = collection.decodedEvidence.audio[0];
      assert.equal(audio.sourceSampleCount, audio.outputSampleCount);
      assert.equal(audio.pcmIdentity.sourceHash, audio.pcmIdentity.outputHash);
      entry.pcmIdentity = audio.pcmIdentity; entry.samples = audio.sourceSampleCount;
      entry.completeSource = collection.completeSource;
      assert.equal(collection.completeSource.video.frames, 120);
      assert.equal(Number(collection.completeSource.audio[0].sampleCount), 192000);
      await run(pins.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', stage.file, '-map', '0', '-f', 'null', '-']);
      assert.equal(sha(await fs.readFile(source)), sourceHash);
      assert.deepEqual(await readSourceIdentity(source), sourceIdentity);
      await retainSealedStage(stage, 'Linux pre-activation calibration; not published or registered.'); activeStage = null;
      entry.status = 'passed'; entry.output = stage.file;
    }
    report.status = 'passed-calibration-only';
  } catch (error) {
    report.status = 'failed-retained'; report.failure = errorRecord(error); process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    if (activeTelemetry) await closeOperationTelemetry(activeTelemetry, { childClosed: report.census.live === 0 }).catch(error => { report.closeFailure = errorRecord(error); });
    if (activeStage) await retainSealedStage(activeStage, 'Failed Linux pre-activation calibration retained.').catch(() => {});
    assert.equal(report.census.live, 0); assert.equal(report.census.spawned, report.census.closed);
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ root, status: report.status, census: report.census, cases: report.cases.map(row => ({ label: row.label, status: row.status })), failure: report.failure }, null, 2));
  return report;
}
if (require.main === module) calibrate().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { calibrate, BUDGET, SETTINGS, SPECS };
