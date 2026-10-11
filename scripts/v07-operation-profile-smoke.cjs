'use strict';

// Parent-run qualification, not a benchmark: unchanged ordinary Tested Default
// settings, one known owned fixture, and actual per-profile output validation.
// No app/service capability is enabled by this script. Failed evidence stays.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { PROFILES, describeRecipe, outputPixelFormat, selectVideo } = require('../src/media.cjs');
const { createStage, sealStage } = require('../src/outputs.cjs');
const { generationDescriptionOf, classifyMarker } = require('../src/provenance.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { collectOperationEvidence, evidenceFailure } = require('../src/operation-evidence.cjs');
const { inspectMetadata } = require('../src/inspection.cjs');

const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const ORIGINAL = path.join(ROOT, 'artifacts/v0.7/encode-operation/01349687-ff85-4606-b3be-b2baec87d06b/report.json');
const CALIBRATION = path.join(ROOT, 'artifacts/v0.7/operation-evidence/rechecks/2026-10-11T07-21-37.056Z-5253e225-7644-46ce-b27f-471109c5c23c.json');
const AAC = path.join(ROOT, 'artifacts/v0.7/operation-evidence/4df34e92-9905-491a-95cd-0263a9e3018c/report.json');
const FLAC = path.join(ROOT, 'artifacts/v0.7/operation-evidence/7583094b-67b9-4e11-b85c-a5b4e011060b/report.json');
const SOURCE = path.join(OWNED, 'fixtures/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/vfr-offset-multitrack.mov');
const BIN = path.join(ROOT, '.tools/candidate-runtime/ffmpeg-9.0.2/bin');
const TOOLS = { ffmpeg: path.join(BIN, 'ffmpeg.exe'), ffprobe: path.join(BIN, 'ffprobe.exe') };
const PINS = { ffmpeg: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0', ffprobe: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3' };
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const SOURCE_SHA = 'db3532f3977964d37cc4edcff21db0f1040b23465e514daf2d6542dcb08c4dc8';
const ORIGINAL_SHA = '4942eaaf410e73ab31a96a534fd91f20d3b704d1ad449bd1184d6e0400f2c3b0';
const RETAINED_PROFILE_ID = '9c10a4a8-5c79-4841-abd1-647dc69c2d84';
const RETAINED_PROFILE_REPORT = path.join(ROOT, 'artifacts/v0.7/operation-profiles', RETAINED_PROFILE_ID, 'report.json');
const RETAINED_PROFILE_SHA = 'd72ed2a80b928e1903a55411dd3d67ab0cf36e2775512ba835c334c59befd169';
const RETAINED_OUTPUT = path.join(OWNED, 'outputs', `operation-profiles-${RETAINED_PROFILE_ID}`, '.ffmpeg-encoder-C6538F/encoded.mkv');
const RETAINED_VIDEO_SPOOL = path.join(OWNED, 'staging', `operation-profiles-${RETAINED_PROFILE_ID}`, 'operation-evidence-gc3O4o/selected-video.jsonl');
const MODULES = ['scripts/v07-operation-profile-smoke.cjs', 'src/encode-operation.cjs', 'src/operation-evidence.cjs',
  'src/operation-contract.cjs', 'src/inspection.cjs', 'src/media.cjs', 'src/provenance.cjs', 'src/outputs.cjs', 'src/process-runner.cjs', 'package.json'];
const REPORTS = [ORIGINAL, CALIBRATION, AAC, FLAC];
const LEASE = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000, maxFrameBytes: 16 * 1024 * 1024,
  maxPcmBytes: 32 * 1024 * 1024, maxRecords: 20000, maxSpoolBytes: 8 * 1024 * 1024 });
const matrix = PROFILES.flatMap(profile => ['precision-aac', 'precision-flac'].map(audio => ({
  id: `${profile.id}:${audio}`, profile, audio, settings: { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default },
})));
assert.deepEqual(PROFILES.map(profile => profile.id), ['h264-cpu', 'h265-cpu', 'av1-cpu', 'h264-nvidia', 'h265-nvidia', 'av1-nvidia']);
const controller = new AbortController(), children = new Set(), mediaInputs = new Set([SOURCE]), pendingEncodes = new Map();
const allowed = new Set([...REPORTS, SOURCE, ...Object.values(TOOLS), ...MODULES.map(file => path.join(ROOT, file))]);
let report, reportFile, outputRoot, evidenceRoot, lease, leaseIdentity;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'mtimeNs', 'ctimeNs', 'size', 'nlink'].map(key => [key, String(stat[key])]));
const same = (a, b) => a.dev !== 0n && a.ino !== 0n && ['dev', 'ino', 'birthtimeNs', 'mtimeNs', 'ctimeNs', 'size', 'nlink'].every(key => a[key] === b[key]);
const inside = (root, file) => { const relative = path.relative(root, file); return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`); };
async function save() {
  const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= 32 * 1024 * 1024);
  const temporary = reportFile + '.' + randomUUID() + '.tmp', handle = await fs.open(temporary, 'wx');
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  await fs.rename(temporary, reportFile);
}
async function receipt(file) {
  assert.ok(allowed.has(file) || outputRoot && inside(outputRoot, file), 'Exact known or newly owned read scope');
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size <= 256n * 1024n ** 2n);
  assert.equal(await fs.realpath(file), path.resolve(file));
  const handle = await fs.open(file, 'r'), hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
  try {
    assert.ok(same(before, await handle.stat({ bigint: true })));
    for (let at = 0; at < Number(before.size);) {
      if (controller.signal.aborted) throw Object.assign(new Error('Cancelled'), { code: 'CANCELLED' });
      const chunk = await handle.read(buffer, 0, Math.min(buffer.length, Number(before.size) - at), at);
      assert.ok(chunk.bytesRead > 0); hash.update(buffer.subarray(0, chunk.bytesRead)); at += chunk.bytesRead;
    }
    assert.ok(same(before, await handle.stat({ bigint: true })) && same(before, await fs.lstat(file, { bigint: true })));
    return { path: file, sha256: hash.digest('hex'), bytes: Number(before.size), identity: identity(before) };
  } finally { await handle.close(); }
}
async function acquire() {
  lease = await fs.open(LEASE, 'wx+'); await lease.writeFile(JSON.stringify({ schema: 1, token: report.id, pid: process.pid,
    purpose: 'operation-profile-qualification', startedAt: report.startedAt }));
  await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
}
async function release() {
  if (!lease) return;
  try {
    assert.equal(children.size, 0, 'Drain every child before releasing the media slot');
    const named = await fs.lstat(LEASE, { bigint: true });
    assert.ok(named.isFile() && !named.isSymbolicLink() && named.nlink === 1n && named.size < 8192n && same(named, leaseIdentity) && same(named, await lease.stat({ bigint: true })));
    const bytes = Buffer.alloc(Number(named.size)), read = await lease.read(bytes, 0, bytes.length, 0), value = JSON.parse(bytes);
    assert.equal(read.bytesRead, bytes.length); assert.equal(value.token, report.id); assert.equal(value.pid, process.pid);
    await lease.close(); lease = null; assert.ok(same(named, await fs.lstat(LEASE, { bigint: true }))); await fs.unlink(LEASE); report.leaseReleased = true;
  } catch (error) { report.leaseRetained = evidenceFailure(error); }
  finally { await lease?.close().catch(() => {}); lease = null; }
}
async function run(executable, argv, options = {}) {
  assert.ok(Object.values(TOOLS).includes(executable)); assert.equal(children.size, 0); assert.ok(report.invocations.length < report.bounds.maxChildren);
  assert.ok(!argv.includes('-y'), 'Never overwrite evidence');
  const version = argv.length === 1 && argv[0] === '-version';
  const encode = !version && executable === TOOLS.ffmpeg && argv.at(-1) !== 'pipe:1';
  if (!version) assert.ok(argv.includes('-i') && mediaInputs.has(argv[argv.indexOf('-i') + 1]), 'Only exact owned inputs');
  if (encode) {
    assert.deepEqual(argv, pendingEncodes.get(argv.at(-1)), 'Only the exact genuine prepared encode argv may run');
    assert.ok(inside(outputRoot, argv.at(-1)) && argv.includes('-n'));
    await fs.access(argv.at(-1)).then(() => { throw new Error('Output exists; refusing replay over evidence.'); }, error => { if (error.code !== 'ENOENT') throw error; });
    pendingEncodes.delete(argv.at(-1));
  } else if (!version && executable === TOOLS.ffmpeg) {
    assert.equal(argv.at(-1), 'pipe:1'); assert.ok(['pcm_s16le', 'pcm_s32le'].includes(argv[argv.indexOf('-c:a') + 1]));
    assert.ok(['s16le', 's32le'].includes(argv[argv.indexOf('-f') + 1]) && !argv.includes('-c:v') && !argv.includes('-filter:a'), 'PCM decode only');
  }
  const item = { executable, argv, purpose: version ? 'version' : encode ? 'encode' : 'output-evidence', status: 'running', startedAt: new Date().toISOString() };
  report.invocations.push(item); await save(); const started = process.hrtime.bigint();
  try {
    const result = await runTool(executable, argv, { ...options, signal: controller.signal,
      timeoutMs: Math.min(options.timeoutMs || 120000, 120000), stdoutLimit: Math.min(options.stdoutLimit || 1024 * 1024, 32 * 1024 * 1024), stderrLimit: 256 * 1024,
      onChild: child => { children.add(child); item.pid = child.pid; report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
        child.once('close', (code, signal) => { children.delete(child); item.closed = { code, signal }; }); } });
    Object.assign(item, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr, stderrCapture: result.stderrCapture,
      stdoutCapture: result.stdoutCapture, ...(options.onStdoutChunk ? {} : { stdout: result.stdout }) });
    assert.equal(result.exitCode, 0); assert.equal(result.stderrCapture.truncated, false);
    if (encode) report.completedEncodes++;
    return result;
  } catch (error) { item.status = 'failed'; item.failure = evidenceFailure(error); throw error; }
  finally { item.elapsedMs = Number(process.hrtime.bigint() - started) / 1e6; item.finishedAt = new Date().toISOString(); await save(); }
}
async function context() {
  const buffers = await Promise.all(REPORTS.map(async file => { const stat = await fs.lstat(file); assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size < 16 * 1024 * 1024); return fs.readFile(file); }));
  assert.equal(sha(buffers[0]), ORIGINAL_SHA);
  const [original, calibrated, aac, flac] = buffers.map(bytes => JSON.parse(bytes));
  assert.equal(calibrated.status, 'retained-contract-and-interior-timelines-checked');
  assert.equal(calibrated.retainedReports.find(item => item.path === ORIGINAL).sha256, ORIGINAL_SHA);
  assert.equal(aac.status, 'passed');
  const passedAac = aac.cases.find(item => item.id === 'aac-held-out-late-vfr'), passedFlac = flac.cases.find(item => item.id === 'flac-held-out-late-vfr');
  for (const item of [passedAac, passedFlac]) { assert.equal(item.status, 'passed'); assert.equal(item.validation.valid, true); assert.equal(item.collection.status, 'completed'); }
  assert.equal(flac.status, 'failed', 'The earlier AAC failure remains historical, even though its separate FLAC cell passed');
  for (const record of [aac, flac]) {
    assert.equal(record.sourceBefore.sha256, SOURCE_SHA);
    assert.equal(record.retainedReports.find(item => item.path === ORIGINAL).sha256, ORIGINAL_SHA);
    assert.deepEqual(record.interiorClockCalibration.qualification, calibrated.calibration.qualification);
  }
  const inspection = original.sourceEvidence.timeline.inspection;
  assert.equal(original.artifacts[SOURCE].sha256, SOURCE_SHA); assert.equal(selectVideo(inspection.probe).pix_fmt, 'yuv420p');
  assert.equal(inspection.color.classification, 'sdr');
  return { inspection, interior: calibrated.calibration.qualification, qualifications: {
    'precision-aac': passedAac.qualification, 'precision-flac': passedFlac.qualification },
  reports: REPORTS.map((file, i) => ({ path: file, sha256: sha(buffers[i]) })) };
}
function makePlan(cell, output, id, ctx, time) {
  const recipe = describeRecipe(cell.settings), pixelFormat = outputPixelFormat(cell.profile, selectVideo(ctx.inspection.probe));
  assert.equal(pixelFormat, 'yuv420p', 'This matrix is 8-bit only; no implicit depth conversion');
  const description = generationDescriptionOf({ version: 1, profileId: cell.profile.id, codec: cell.profile.codec, backend: cell.profile.hardware,
    encoder: cell.profile.encoder, preset: cell.settings.preset, qualityMode: recipe.qualityMode, quality: cell.settings.quality, bitDepth: 8,
    encoderArgs: recipe.args, appVersion: require('../package.json').version, runtimeVersion: 'FFmpeg 9.0.2', createdAt: time });
  assert.ok(description);
  const request = resolveFileRequest({ fileId: cell.id, identityRevision: 1, draftRevision: 1, operation: 'encode',
    overrides: { range: { startUs: 15013000, endUs: 17087000 }, audioPolicy: cell.audio } });
  const plan = buildEncodeOperation({ input: SOURCE, output, settings: cell.settings, inspection: ctx.inspection, request,
    outputId: id, generationDescription: description, runtimeIdentity: RUNTIME });
  assert.equal(plan.compatibilityPath, false); assert.equal(plan.contract.geometry.filterRequired, false);
  assert.ok(plan.expectedOutput.timestampOrigins && plan.args.includes('-copyts'));
  return { plan, description };
}
async function main() {
  const args = process.argv.slice(2), planOnly = args.length === 1 && args[0] === '--plan-only';
  if (args.length === 1 && args[0] === '--retained-video-plan-only') return inspectRetainedVideo(true);
  if (args.length === 2 && args[0] === '--parent-granted-media-slot' && args[1] === '--inspect-retained-video') return inspectRetainedVideo(false);
  const single = args.length === 3 && args[1] === '--case' ? args[2] : null;
  if (!planOnly) assert.deepEqual(args, single ? ['--parent-granted-media-slot', '--case', single] : ['--parent-granted-media-slot']);
  const cells = single ? matrix.filter(cell => cell.id === single) : matrix; assert.ok(cells.length > 0);
  const ctx = await context();
  if (planOnly) {
    const plans = cells.map(cell => ({ id: cell.id, settings: cell.settings,
      plan: makePlan(cell, path.join(OWNED, 'staging/not-executed-profile-plan/encoded.mkv'), '00000000-0000-4000-8000-000000000001', ctx, '2026-10-11T00:00:00.000Z').plan }));
    console.log(JSON.stringify({ status: 'planned-only', writes: 0, children: 0, cases: plans.map(item => ({ id: item.id, settings: item.settings,
      fingerprint: item.plan.planFingerprint, encoder: item.plan.args[item.plan.args.indexOf('-c:v:0') + 1], requirements: item.plan.qualificationRequirements })) })); return;
  }
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/operation-profiles', id);
  outputRoot = path.join(OWNED, 'outputs', `operation-profiles-${id}`); evidenceRoot = path.join(OWNED, 'staging', `operation-profiles-${id}`);
  report = { schema: 1, id, status: 'running', startedAt: new Date().toISOString(), purpose: 'Six ordinary Tested Default profiles, exact late SDR range, actual AAC/FLAC output contracts',
    runtimeIdentity: RUNTIME, outputRoot, evidenceRoot, source: SOURCE, bounds: { cases: cells.length, encodes: cells.length,
      maxChildren: 2 + cells.reduce((sum, cell) => sum + (cell.audio === 'precision-aac' ? 10 : 14), 0), maxConcurrentChildren: 1,
      maxWallSeconds: 1200, forecastNewFBytes: 128 * 1024 * 1024, marginFBytes: 128 * 1024 * 1024, budget: BUDGET },
    completedEncodes: 0, maxConcurrentChildren: 0, invocations: [], cases: [],
    limitations: ['Qualification only; elapsed time and output bytes are diagnostic, never performance or perceptual benchmark evidence.',
      'Only owned 320x180 progressive 8-bit SDR VFR source, 15.013..17.087 s range, Matroska, 48k stereo/44.1k mono are covered.',
      'No resize, 10-bit, HDR, arbitrary AAC gaps, audio-copy ranges, subtitle/chapter transformation, Archive recipe, hardware fallback or service admission.',
      'Full source/output decoding is explicitly budgeted. No telemetry shortcut or large-archive responsiveness claim.',
      'Calibration fixes tolerances before candidates. Each encoder must pass actual decoded timing/provenance; a coded cadence difference is a failure to investigate, never an automatic widening.',
      'No output publication or cleanup. First meaningful failure stops this run and retains all completed/partial evidence.'] };
  await fs.mkdir(directory, { recursive: true }); reportFile = path.join(directory, 'report.json'); await save();
  const deadline = setTimeout(() => controller.abort(), 1200000); deadline.unref(); const stop = () => controller.abort(); process.once('SIGINT', stop); process.once('SIGTERM', stop);
  try {
    await acquire();
    const d = await fs.statfs(ROOT, { bigint: true }), f = await fs.statfs(OWNED, { bigint: true });
    report.freeSpace = { D: String(d.bavail * d.bsize), F: String(f.bavail * f.bsize) };
    assert.ok(d.bavail * d.bsize >= 25n * 1024n ** 3n && f.bavail * f.bsize >= 256n * 1024n ** 2n);
    await fs.mkdir(outputRoot); await fs.mkdir(evidenceRoot);
    report.modules = []; for (const file of MODULES) report.modules.push(await receipt(path.join(ROOT, file)));
    report.retainedReports = []; for (const file of REPORTS) { const value = await receipt(file); assert.equal(value.sha256, ctx.reports.find(item => item.path === file).sha256); report.retainedReports.push(value); }
    report.sourceBefore = await receipt(SOURCE); assert.equal(report.sourceBefore.sha256, SOURCE_SHA);
    report.runtime = {};
    for (const name of ['ffmpeg', 'ffprobe']) {
      const binary = await receipt(TOOLS[name]); assert.equal(binary.sha256, PINS[name]); const version = await run(TOOLS[name], ['-version']);
      assert.match(version.stdout, new RegExp(`${name} version 9\\.0\\.2`)); report.runtime[name] = { ...binary, version: version.stdout };
    }
    assert.equal(sha(JSON.stringify(['ffmpeg', 'ffprobe'].map(name => ({ sizeBytes: report.runtime[name].bytes, sha256: report.runtime[name].sha256 })))), RUNTIME);
    report.frozenInteriorQualification = ctx.interior; report.frozenEndpointQualifications = ctx.qualifications;
    for (const cell of cells) {
      const item = { id: cell.id, settings: cell.settings, status: 'running', outputId: randomUUID() }; report.cases.push(item); await save();
      try {
        item.stage = await createStage(outputRoot);
        const built = makePlan(cell, item.stage.file, item.outputId, ctx, new Date().toISOString()); item.plan = built.plan; item.generationDescription = built.description;
        pendingEncodes.set(item.stage.file, item.plan.args);
        await run(TOOLS.ffmpeg, item.plan.args); await sealStage(item.stage); mediaInputs.add(item.stage.file);
        item.outputBefore = await receipt(item.stage.file); item.probe = await inspectMetadata(item.stage.file, { ffprobe: TOOLS.ffprobe, run, signal: controller.signal });
        item.marker = classifyMarker(item.probe); assert.equal(item.marker.kind, 'generated'); assert.equal(item.marker.outputId, item.outputId);
        assert.deepEqual(item.marker.previousGeneration, built.description);
        item.qualification = { ...structuredClone(ctx.qualifications[cell.audio]), evidenceId: `${id}:${cell.id}` };
        item.qualificationRationale = 'Applying the previously calibrated clock/container/audio bounds to this independently observed encoder output; not deriving a pass tolerance from the candidate.';
        item.collection = await collectOperationEvidence({ plan: item.plan, sourceProbe: ctx.inspection.probe, outputProbe: item.probe,
          sourcePath: SOURCE, outputPath: item.stage.file, stageDirectory: evidenceRoot, ffmpeg: TOOLS.ffmpeg, ffprobe: TOOLS.ffprobe,
          run, signal: controller.signal, budget: BUDGET, timingQualification: ctx.interior });
        item.validation = validateEncodeOperationOutput(item.plan, item.probe, { qualification: item.qualification, decodedEvidence: item.collection.decodedEvidence });
        assert.equal(item.validation.valid, true, item.validation.errors.join('; '));
        item.outputAfter = await receipt(item.stage.file); assert.deepEqual(item.outputAfter, item.outputBefore); await sealStage(item.stage);
        item.status = 'passed';
      } catch (error) {
        item.status = controller.signal.aborted ? 'cancelled' : 'failed'; item.failure = evidenceFailure(error);
        if (error.evidenceReceipt) item.collection = error.evidenceReceipt;
        throw error;
      } finally { item.finishedAt = new Date().toISOString(); await save(); }
    }
    report.sourceAfter = await receipt(SOURCE); assert.deepEqual(report.sourceAfter, report.sourceBefore);
    for (const before of report.retainedReports) assert.deepEqual(await receipt(before.path), before);
    report.status = 'passed-bounded-profile-cells';
  } catch (error) { report.status = controller.signal.aborted ? 'cancelled' : 'failed'; report.failure = evidenceFailure(error); process.exitCode = 1; }
  finally {
    clearTimeout(deadline); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    if (report.sourceBefore && !report.sourceAfter) {
      // After cancellation, do not begin another full read. Persist a bounded
      // identity observation and say explicitly that no post-run hash exists.
      try {
        const stat = await fs.lstat(SOURCE, { bigint: true });
        report.sourceAfterFailure = { identity: identity(stat), ordinaryFile: stat.isFile() && !stat.isSymbolicLink(),
          unchangedMetadata: JSON.stringify(identity(stat)) === JSON.stringify(report.sourceBefore.identity),
          fullPostRunHashPerformed: false };
      } catch (error) { report.sourceAfterFailure = { failure: evidenceFailure(error), fullPostRunHashPerformed: false }; }
    }
    report.finishedAt = new Date().toISOString(); await release(); await save();
    console.log(JSON.stringify({ report: reportFile, status: report.status, encodes: report.completedEncodes, children: report.invocations.length,
      cases: report.cases.map(({ id, status, failure }) => ({ id, status, failure })) }));
  }
}
if (require.main === module) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
