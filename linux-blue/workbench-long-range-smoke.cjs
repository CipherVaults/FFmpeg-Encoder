'use strict';
// Genuine shared-service proof. No application imports this developer route.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const longComposition = require('./workbench-long-range-service.cjs');
const { PINS, createAv1ProportionalRunner } = require('./runtime-av1-operation.cjs');
const { operationCostLimits } = require('../src/encoder-service.cjs');
const { isProportionalFamilySelection } = require('../src/operation-family.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const { count } = require('./workbench-long-range-calibration.cjs');
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
function smokeProfile(kind = 'keep720') {
  assert.ok(['keep720', 'resize1080to720'].includes(kind), 'Unknown developer service campaign');
  const resize = kind === 'resize1080to720';
  return Object.freeze({ label: resize ? 'resize-service-' : 'long-range-service-',
    width: resize ? 1920 : 1280, height: resize ? 1080 : 720, resolution: resize ? '720' : 'source',
    passedStatus: resize ? 'passed-developer-resize-service-proof' : 'passed-developer-long-range-service-proof',
    scope: resize ? 'Developer-only 1080p30→720p SDR H264/PCM QuickTime range to H265 CPU slow25 precision-FLAC; not Full resize, arbitrary real-media orientation, pixel quality or native acceptance.'
      : 'Developer-only 720p30 SDR H264/PCM QuickTime to H265 CPU slow25 precision-FLAC; not any-length or resize completion.' });
}
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function isSourceEvidence(child, source) {
  const args = child.spawnargs;
  return args.includes('-show_frames') && args[args.indexOf('-i') + 1] === source;
}
async function selectCaseFolders(service, inputPath, outputPath) {
  // Main intentionally retains only one current token per role. Register the
  // active case, not two inputs whose first token is immediately invalidated.
  const input = await service.registerFolder(inputPath, 'input');
  const output = await service.registerFolder(outputPath, 'output');
  return { inputFolderId: input.id, outputFolderId: output.id };
}
async function runServiceCampaign(kind) {
  const config = smokeProfile(kind);
  const composition = config.resolution === '720' ? require('./workbench-resize-service.cjs') : longComposition;
  const createService = config.resolution === '720' ? composition.createResizeService : composition.createLongRangeService;
  const space = await fs.statfs(__dirname, { bigint: true });
  assert.ok(space.bavail * space.bsize > 27n * 1024n ** 3n, 'Storage floor plus campaign allocation');
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts', config.label));
  const stateDir = path.join(root, 'state'); await fs.mkdir(stateDir);
  const report = { root, status: 'preparing', cases: [], sources: [], appActivated: false,
    scope: config.scope, geometry: { sourceWidth: config.width, sourceHeight: config.height, resolution: config.resolution, outputWidth: 1280, outputHeight: 720 },
    census: { spawned: 0, closed: 0, live: 0, maximum: 0, encodes: 0 } };
  const controller = new AbortController();
  let service, cancellation, cancelMode = null, activeSource = null, cancellationObserved = null;
  const timer = setTimeout(() => { controller.abort(); if (service) cancellation = service.cancelCurrent(); }, 45 * 60000);
  const onChild = child => {
    const c = report.census; c.spawned++; c.live++; c.maximum = Math.max(c.maximum, c.live);
    child.once('close', () => { c.closed++; c.live--; });
    if (child.spawnargs.includes('-progress') && /[/\\]\.ffmpeg-encoder-[^/\\]+[/\\]encoded\.mkv$/.test(child.spawnargs.at(-1))) c.encodes++;
    if (cancelMode === 'evidence' && isSourceEvidence(child, activeSource)) {
      child.stdout.once('data', chunk => {
        const progress = service.snapshot().progress;
        if (cancelMode !== 'evidence' || report.census.live !== 1 || progress?.stage !== 'evidence-collection') return;
        cancelMode = null;
        cancellationObserved = { kind: 'complete-source-evidence', bytesObserved: chunk.length, childLive: true, stage: progress.stage };
        cancellation = service.cancelCurrent();
      });
    }
  };
  const invoke = createAv1ProportionalRunner({ onChild });
  const run = (tool, args, options = {}) => invoke(tool, args, { timeoutMs: 300000, ...options,
    signal: AbortSignal.any([controller.signal, ...(options.signal ? [options.signal] : [])]) });
  try {
    assert.match(composition.REPORT_SHA || '', /^[a-f0-9]{64}$/, 'The new calibration is still pending');
    const bytes = await fs.readFile(composition.REPORT);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), composition.REPORT_SHA);
    const calibration = JSON.parse(bytes);
    assert.equal(calibration.status, 'passed-pre-catalog-calibration');
    const long = calibration.sources.find(row => row.id === 'long-pattern');
    assert.equal(await hashFile(long.path), long.sha256);
    const longInput = path.join(root, 'long-input'); await fs.mkdir(longInput);
    const longSource = path.join(longInput, 'different-name-long-source.mov');
    await fs.copyFile(long.path, longSource, fs.constants.COPYFILE_EXCL);
    assert.equal(await hashFile(longSource), long.sha256);
    report.sources.push({ id: 'long-copy', path: longSource, original: long.path, sha256: long.sha256, extentUs: 150000000 });

    // Fresh content was not present in the pinned calibration report. A genuine
    // source-shaped family must admit it without a fixture hash or range list.
    const freshInput = path.join(root, 'fresh-input'); await fs.mkdir(freshInput);
    const freshSource = path.join(freshInput, 'fresh-vflip-997.mov');
    await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n',
      '-f', 'lavfi', '-i', `testsrc2=size=${config.width}x${config.height}:rate=30:duration=10`,
      '-f', 'lavfi', '-i', 'aevalsrc=0.18*sin(2*PI*(997*t+7*t*t))|0.18*sin(2*PI*(1216*t+9*t*t)):s=48000:c=stereo:d=10',
      '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
      '-vf', 'vflip,setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p',
      '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=3:b-adapt=0:open-gop=0',
      '-fps_mode:v:0', 'passthrough', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709', '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv',
      '-c:a:0', 'pcm_s16le', '-sample_fmt:a:0', 's16', '-ar:a:0', '48000', '-channel_layout:a:0', 'stereo', '-t', '10', '-movflags', '+faststart', '-f', 'mov', freshSource]);
    const freshHash = await hashFile(freshSource);
    assert.ok(calibration.sources.every(row => row.sha256 !== freshHash));
    report.sources.push({ id: 'fresh-heldout', path: freshSource, sha256: freshHash, extentUs: 10000000 });
    service = await createService({ stateDir, onChild });
    service.on('update', snapshot => {
      const p = snapshot.progress;
      if (cancelMode === 'encode' && report.census.live === 1 && p?.stage === 'encoding' && p.frame > 0 && p.ended === false) {
        cancelMode = null; cancellationObserved = { kind: 'encode', childLive: true, progress: structuredClone(p) };
        cancellation = service.cancelCurrent();
      }
    });
    await service.initializeDiagnostics(); report.capabilities = await service.getCapabilities();
    async function prepare(name, which, range) {
      assert.equal(controller.signal.aborted, false, 'Campaign deadline expired');
      const output = path.join(root, name); await fs.mkdir(output);
      const folders = await selectCaseFolders(service, which === 'long' ? longInput : freshInput, output);
      let plan = await service.prepareBatch({ ...folders, settings: SETTINGS });
      plan = await service.updateFileOperations({ planId: plan.planId, draftId: plan.operationDraft.id, revision: plan.operationDraft.revision,
        fileIds: [plan.items[0].id], overrides: { range, resolution: config.resolution, audioPolicy: 'precision-flac' } });
      assert.equal(plan.phase, 'ready', JSON.stringify(plan)); assert.equal(plan.items[0].status, 'ready', JSON.stringify(plan.items[0]));
      const entry = service.plan.entries.get(plan.items[0].id);
      const qualified = service.operationQualifications.requireCurrent(entry.qualificationSelection, {
        ...entry.qualificationBindings, budget: service.operationEvidenceBudget, executionBudgetMs: service.operationDeadlineMs });
      assert.equal(isProportionalFamilySelection(qualified), true); assert.equal(qualified.proportional, true);
      if (config.resolution === '720') {
        const orientation = entry.operationPlan.expectedOutput.orientationQualification;
        assert.ok(orientation, 'Owned generated source absence must use the genuine family orientation qualification');
        assert.equal(orientation.sourceEvidenceFingerprint, entry.qualificationBindings.sourceProbeFingerprint);
        assert.equal(orientation.runtimeIdentity, service.runtimeIdentity);
      }
      const limits = operationCostLimits(entry, qualified);
      assert.deepEqual(limits, { ...qualified.resources, executionBudgetMs: qualified.executionBudgetMs });
      await fs.writeFile(path.join(output, 'resources-before-start.json'), JSON.stringify({ limits, budget: qualified.budget, sourcePolicy: qualified.sourcePolicy }, null, 2), { flag: 'wx' });
      return { plan, entry, output, limits, qualified, destination: path.join(output, plan.items[0].outputName), which, range };
    }
    async function start(prepared) {
      activeSource = prepared.which === 'long' ? longSource : freshSource;
      const started = Date.now(); service.startBatch({ planId: prepared.plan.planId, fileIds: [prepared.plan.items[0].id] });
      await service.taskPromise; if (cancellation) { await cancellation; cancellation = null; }
      assert.equal(report.census.live, 0); assert.equal(service.busy, false);
      prepared.elapsedMs = Date.now() - started; assert.ok(prepared.elapsedMs <= prepared.limits.executionBudgetMs);
      return service.snapshot().items[0];
    }
    async function publish(name, which, range) {
      const p = await prepare(name, which, range), item = await start(p), entry = p.entry;
      assert.equal(item.status, 'success', JSON.stringify(item)); assert.equal(item.outputDisposition.published, true);
      assert.equal(item.sourceAssessment.kind, 'unchanged'); assert.equal(entry.operationEvidence.status, 'completed');
      assert.equal(entry.telemetryValidation.valid, true);
      const extent = which === 'long' ? 150000000 : 10000000, startUs = range.startUs || 0, endUs = range.endUs ?? extent;
      const e = entry.operationEvidence, v = e.decodedEvidence.video, a = e.decodedEvidence.audio[0];
      assert.equal(e.completeSource.video.frames, count(0, extent, 30));
      assert.equal(Number(e.completeSource.audio[0].sampleCount), count(0, extent, 48000));
      assert.equal(v.sourceFrameCount, count(startUs, endUs, 30)); assert.equal(v.outputFrameCount, v.sourceFrameCount);
      assert.equal(a.sourceSampleCount, count(startUs, endUs, 48000)); assert.equal(a.outputSampleCount, a.sourceSampleCount);
      assert.equal(a.pcmIdentity.sourceHash, a.pcmIdentity.outputHash);
      const reservation = JSON.parse(await fs.readFile(path.join(path.dirname(e.directory), 'storage-reservation.json')));
      assert.equal(reservation.forecastBytes, p.limits.evidenceReserveBytes);
      assert.equal(item.evidenceStorage.final.status, 'completed'); assert.deepEqual(item.evidenceStorage.final.violations, []);
      const history = await service.getDiagnosticHistory({ limit: 200 });
      const events = await Promise.all(history.events.map(async row => (await service.getDiagnosticRecord({ eventId: row.id })).event));
      const event = events.find(row => row.reason === 'OPERATION_EVIDENCE_COLLECTED' && row.fileId === item.id);
      assert.ok(event, 'Correlated service resource accounting must be retained');
      const accounting = event.context;
      assert.ok(accounting.children > 0 && accounting.children <= p.limits.maxChildren);
      assert.ok(accounting.streamedBytes > 0 && accounting.streamedBytes <= p.limits.evidenceBytes);
      assert.ok(accounting.pipeBytes.stdout + accounting.pipeBytes.stderr <= p.limits.pipeBytes);
      for (const stream of entry.operationTelemetryReceipt.streams) {
        assert.ok(stream.summary.bytes <= p.limits.telemetryBytes);
        assert.ok(BigInt(stream.summary.records) <= BigInt(p.limits.telemetryRecords));
      }
      const probe = JSON.parse((await run(PINS.ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', p.destination])).stdout);
      assert.equal(classifyMarker(probe).kind, 'generated');
      const video = probe.streams.find(stream => stream.codec_type === 'video');
      assert.equal(video.width, 1280); assert.equal(video.height, 720);
      assert.equal(video.sample_aspect_ratio, '1:1'); assert.equal(video.display_aspect_ratio, '16:9');
      await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', p.destination, '-map', '0', '-f', 'null', '-']);
      report.cases.push({ case: name, status: 'passed', item, elapsedMs: p.elapsedMs, limits: p.limits,
        frames: v.sourceFrameCount, samples: a.sourceSampleCount, pcmIdentity: a.pcmIdentity,
        accounting, reservation, evidenceDirectory: e.directory, geometry: entry.operationPlan.expectedOutput.geometry,
        orientationQualification: entry.operationPlan.expectedOutput.orientationQualification });
    }
    await publish('long-late-forty', 'long', { startUs: 100000000, endUs: 140000000 });
    await publish('long-open-end', 'long', { startUs: 130000000 });
    await publish('fresh-independent-nonaligned', 'fresh', { startUs: 613000, endUs: 8721000 });
    for (const mode of ['encode', 'evidence']) {
      const p = await prepare(`cancel-${mode}`, 'long', { startUs: 130000000, endUs: 132000000 });
      cancellationObserved = null; cancelMode = mode;
      const item = await start(p);
      assert.ok(cancellationObserved, 'Cancellation needs observed active child work, not a pre-spawn signal');
      assert.equal(item.status, 'cancelled', JSON.stringify(item));
      await assert.rejects(fs.stat(p.destination), { code: 'ENOENT' });
      assert.notEqual(item.outputDisposition?.published, true);
      if (mode === 'encode') assert.equal(item.cleanup.retained, true);
      else assert.equal(item.outputDisposition.kind, 'retained-unverified');
      report.cases.push({ case: `real-${mode}-cancelled-no-publication`, status: 'passed', item, observed: cancellationObserved });
      await publish(`fresh-success-after-${mode}-cancel`, 'fresh', { startUs: 1013000, endUs: 3087000 });
    }
    const collision = await prepare('collision', 'fresh', { startUs: 1013000, endUs: 3087000 });
    await fs.writeFile(collision.destination, 'owned existing output', { flag: 'wx' });
    const prior = report.census.encodes, item = await start(collision);
    assert.equal(item.status, 'skipped'); assert.equal(report.census.encodes, prior);
    assert.equal(await fs.readFile(collision.destination, 'utf8'), 'owned existing output');
    report.cases.push({ case: 'existing-output-preserved', status: 'passed', item });
    for (const source of report.sources) {
      assert.equal(await hashFile(source.path), source.sha256);
      if (source.original) assert.equal(await hashFile(source.original), source.sha256);
    }
    report.status = config.passedStatus;
  } catch (error) {
    report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1;
    if (service) report.failedSnapshot = service.snapshot();
  } finally {
    clearTimeout(timer); service?.closeAdmission();
    try { await service?.cancelCurrent(); await service?.closeOperationResources();
      if (service) assert.equal((await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed')).persisted, true);
    } catch (error) { report.closureFailure = { code: error.code, message: error.message }; process.exitCode = 1; }
    if (report.census.live || report.census.spawned !== report.census.closed || report.census.maximum !== 1) {
      report.closureFailure ||= { message: 'Unbalanced or overlapping children' }; process.exitCode = 1;
    }
    if (report.closureFailure) report.status = 'failed-retained';
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ root, status: report.status, cases: report.cases.map(({ case: name, status, frames, samples }) => ({ name, status, frames, samples })),
    census: report.census, failure: report.failure, closureFailure: report.closureFailure }, null, 2));
  return report;
}
const main = () => runServiceCampaign('keep720');
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, runServiceCampaign, smokeProfile, isSourceEvidence, selectCaseFolders };
