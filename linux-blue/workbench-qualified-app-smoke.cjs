'use strict';
// Actual composed-factory proof, never application authority. No automatic run
// on import, no fake executor, no private qualification/catalog injection.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createQualifiedAv1WorkbenchService } = require('./workbench-av1-service.cjs');
const { PINS, RUNTIME_ID, createAv1ProportionalRunner } = require('./runtime-av1-operation.cjs');
const { FAMILY_ID, RESIZE_FAMILY_ID, FULL_RESIZE_FAMILY_ID } = require('../src/operation-resource-budget.cjs');
const { isProportionalFamilySelection } = require('../src/operation-family.cjs');
const { operationCostLimits } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const SOURCES = Object.freeze([
  Object.freeze({ id: 'keep', width: 1280, height: 720, videoUs: 6000000, audioUs: 6000000 }),
  Object.freeze({ id: 'resize', width: 1920, height: 1080, videoUs: 6000000, audioUs: 6117000 }),
]);
const RANGE = Object.freeze({ startUs: 613000, endUs: 3721000 });
const CHANGED = Object.freeze([
  Object.freeze({ id: 'keep-range', source: 'keep', family: FAMILY_ID, range: RANGE, resolution: 'source' }),
  Object.freeze({ id: 'resize-range', source: 'resize', family: RESIZE_FAMILY_ID, range: RANGE, resolution: '720' }),
  Object.freeze({ id: 'resize-full-tail', source: 'resize', family: FULL_RESIZE_FAMILY_ID, range: null, resolution: '720' }),
]);
function assertReady(service) {
  assert.equal(service.runtimeIdentity, RUNTIME_ID);
  assert.equal(service.linuxQualifiedEncodeStatus?.available, true, 'Qualified app controls are not activated; no media proof may start');
  assert.deepEqual([...service.linuxQualifiedEncodeStatus.familyIds].sort(), [FAMILY_ID, RESIZE_FAMILY_ID, FULL_RESIZE_FAMILY_ID].sort());
  assert.equal(service.linuxRemuxStatus?.available, false); assert.equal(service.remuxOperations, null);
  assert.equal(service.hdrOperations, null);
}
// Matches the previously passed workbench-execution-smoke ordinary fixture.
// MOV stereo PCM -> Matroska loses declared channel_layout and is NOT a
// supported ordinary-copy success; keep that conversion as a negative below.
function ordinaryGenerationArgs(destination) {
  return ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i',
    'testsrc2=size=320x180:rate=30,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.4', '-c:v', 'ffv1', '-level', '3',
    '-pix_fmt', '+yuv420p', '-c:a', 'pcm_s16le', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', destination];
}
const MIXED_INPUTS = Object.freeze([
  Object.freeze({ name: 'ordinary.mkv', source: 'ordinary' }),
  Object.freeze({ name: 'changed.mov', source: 'keep' }),
]);
function generationArgs(spec, destination) {
  assert.ok(SOURCES.includes(spec), 'Only fixed owned fixtures');
  return ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i',
    `testsrc2=size=${spec.width}x${spec.height}:rate=30:duration=${spec.videoUs / 1e6}`,
    '-f', 'lavfi', '-i', `aevalsrc=0.18*sin(2*PI*(661*t+5.5*t*t))|0.18*sin(2*PI*(887*t+6.5*t*t)):s=48000:c=stereo:d=${spec.audioUs / 1e6}`,
    '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
    '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p',
    '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=3:b-adapt=0:open-gop=0', '-fps_mode:v:0', 'passthrough',
    '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709', '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv',
    '-c:a:0', 'pcm_s16le', '-sample_fmt:a:0', 's16', '-ar:a:0', '48000', '-channel_layout:a:0', 'stereo',
    '-t', String(spec.audioUs / 1e6), '-movflags', '+faststart', '-f', 'mov', destination];
}
async function hashFile(file) { const hash = createHash('sha256'); for await (const b of createReadStream(file)) hash.update(b); return hash.digest('hex'); }
const count = (start, end, rate) => Number((BigInt(end) * BigInt(rate) + 999999n) / 1000000n - (BigInt(start) * BigInt(rate) + 999999n) / 1000000n);
async function main() {
  const space = await fs.statfs(__dirname, { bigint: true }); assert.ok(space.bavail * space.bsize > 27n * 1024n ** 3n);
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts', 'qualified-app-service-'));
  const stateDir = path.join(root, 'state'); await fs.mkdir(stateDir);
  const report = { root, status: 'preparing', runtimeIdentity: RUNTIME_ID, nativeWindowTested: false, cases: [], sources: [],
    census: { spawned: 0, closed: 0, live: 0, maximum: 0, encodes: 0 },
    limitations: ['Short owned synthetic app-factory composition proof, not native UI or new long-resource qualification.',
      'Ordinary MOV stereo PCM to Matroska loses declared channel layout and remains unsupported; explicit negative verifies refusal.',
      'Output action tokens are inspected; no desktop application is opened.', 'Accounting is the correlated evidence-stage receipt, not final whole-job byte recomputation.'] };
  let service, cancellation, cancelMode, activeSources = new Set(), observed;
  const controller = new AbortController();
  const timer = setTimeout(() => { controller.abort(); if (service) cancellation = service.cancelCurrent(); }, 30 * 60000);
  const onChild = child => {
    const c = report.census; c.spawned++; c.live++; c.maximum = Math.max(c.maximum, c.live);
    if (c.spawned > 350) { controller.abort(); if (service) cancellation = service.cancelCurrent(); }
    child.once('close', () => { c.closed++; c.live--; });
    if (child.spawnargs.includes('-progress')) c.encodes++;
    if (cancelMode === 'evidence' && child.spawnargs.includes('-show_frames') && activeSources.has(child.spawnargs[child.spawnargs.indexOf('-i') + 1]))
      child.stdout.once('data', bytes => {
        if (cancelMode !== 'evidence' || service.snapshot().progress?.stage !== 'evidence-collection' || c.live !== 1) return;
        cancelMode = null; observed = { kind: 'evidence', bytesObserved: bytes.length, childLive: true }; cancellation = service.cancelCurrent();
      });
  };
  const invoke = createAv1ProportionalRunner({ onChild });
  const run = async (tool, args, options = {}) => {
    assert.equal(controller.signal.aborted, false, 'Campaign deadline/child budget');
    const result = await invoke(tool, args, { timeoutMs: 120000, ...options, signal: controller.signal });
    assert.equal(result.exitCode, 0); assert.equal(report.census.live, 0); return result;
  };
  const pcmHash = async file => {
    const hash = createHash('sha256');
    await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-i', file, '-map', '0:a:0', '-c:a', 'pcm_s16le', '-f', 's16le', 'pipe:1'],
      { stdoutLimit: 8 * 1024 * 1024, onStdoutChunk: bytes => { hash.update(bytes); } });
    return hash.digest('hex');
  };
  try {
    service = await createQualifiedAv1WorkbenchService({ stateDir, onChild, outputAccess: new OutputAccess({
      openPath() { assert.fail('Do not open desktop applications'); }, showItemInFolder() { assert.fail('Do not reveal desktop files'); } }) });
    assertReady(service); // Must precede capabilities or generation children.
    service.on('update', snapshot => {
      const p = snapshot.progress;
      if (cancelMode === 'encode' && report.census.live === 1 && p?.stage === 'encoding' && p.frame > 0 && p.ended === false) {
        cancelMode = null; observed = { kind: 'encode', childLive: true, progress: structuredClone(p) }; cancellation = service.cancelCurrent();
      }
    });
    await service.initializeDiagnostics(); report.capabilities = await service.getCapabilities();
    for (const profile of report.capabilities.profiles.filter(p => p.hardware === 'CPU')) assert.equal(profile.available, true);
    const inputs = {};
    for (const spec of SOURCES) {
      const input = path.join(root, spec.id); await fs.mkdir(input); const source = path.join(input, `${spec.id}.mov`);
      await run(PINS.ffmpeg.path, generationArgs(spec, source));
      const p = JSON.parse((await run(PINS.ffprobe.path, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', source])).stdout);
      assert.equal(Number(p.streams[0].duration) * 1e6, spec.videoUs); assert.equal(Number(p.streams[1].duration) * 1e6, spec.audioUs);
      assert.equal(p.streams[0].time_base, '1/15360'); assert.equal(p.streams[1].time_base, '1/48000');
      inputs[spec.id] = { input, source, spec }; report.sources.push({ path: source, sha256: await hashFile(source), identity: await readSourceIdentity(source) });
    }
    const ordinaryInput = path.join(root, 'ordinary-input'); await fs.mkdir(ordinaryInput);
    const ordinarySource = path.join(ordinaryInput, 'ordinary.mkv');
    await run(PINS.ffmpeg.path, ordinaryGenerationArgs(ordinarySource));
    inputs.ordinary = { input: ordinaryInput, source: ordinarySource };
    report.sources.push({ path: ordinarySource, sha256: await hashFile(ordinarySource), identity: await readSourceIdentity(ordinarySource) });
    const mixed = path.join(root, 'mixed'); await fs.mkdir(mixed);
    for (const { name, source } of MIXED_INPUTS) {
      const file = path.join(mixed, name); await fs.copyFile(inputs[source].source, file, fs.constants.COPYFILE_EXCL);
      report.sources.push({ path: file, sha256: await hashFile(file), identity: await readSourceIdentity(file) });
    }
    async function prepare(name, sourceId, settings = SETTINGS, changes = null) {
      assert.equal(controller.signal.aborted, false);
      const input = sourceId === 'mixed' ? mixed : inputs[sourceId].input, output = path.join(root, name); await fs.mkdir(output);
      const inToken = await service.registerFolder(input, 'input'), outToken = await service.registerFolder(output, 'output');
      let plan = await service.prepareBatch({ inputFolderId: inToken.id, outputFolderId: outToken.id, settings });
      assert.equal(plan.phase, 'ready', JSON.stringify(plan));
      if (changes) {
        const ids = plan.items.filter(item => sourceId !== 'mixed' || item.name === 'changed.mov').map(item => item.id);
        plan = await service.updateFileOperations({ planId: plan.planId, draftId: plan.operationDraft.id, revision: plan.operationDraft.revision,
          fileIds: ids, overrides: { range: changes.range, resolution: changes.resolution, audioPolicy: 'precision-flac' } });
      }
      const entries = new Map(plan.items.map(item => [item.id, service.plan.entries.get(item.id)]));
      return { plan, entries, output, sourceId, changes, destinations: new Map(plan.items.map(item => [item.id, path.join(output, item.outputName)])) };
    }
    async function start(p) {
      activeSources = new Set([...p.entries.values()].map(e => e.file));
      // Canonical identities, rather than inferred names, identify evidence children.
      for (const e of p.entries.values()) if (e?.fingerprint?.canonicalPath) activeSources.add(e.fingerprint.canonicalPath);
      const began = Date.now(); service.startBatch({ planId: p.plan.planId, fileIds: p.plan.items.map(i => i.id) });
      await service.taskPromise; if (cancellation) { await cancellation; cancellation = null; }
      assert.equal(controller.signal.aborted, false); assert.equal(report.census.live, 0); assert.equal(service.busy, false);
      return { items: service.snapshot().items, elapsedMs: Date.now() - began };
    }
    async function verifyPublished(p, result) {
      const proofs = [];
      for (const item of result.items) {
        const entry = p.entries.get(item.id), destination = p.destinations.get(item.id);
        assert.equal(item.status, 'success', JSON.stringify(item)); assert.equal(item.outputDisposition?.published, true);
        assert.equal(item.sourceAssessment?.kind, 'unchanged'); assert.match(item.outputAccess?.outputId || '', /^[a-f0-9-]{36}$/);
        const probe = JSON.parse((await run(PINS.ffprobe.path, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', destination])).stdout);
        assert.equal(classifyMarker(probe).kind, 'generated');
        const expectedCodec = { 'h264-cpu': 'h264', 'h265-cpu': 'hevc', 'av1-cpu': 'av1' }[service.plan.settings.profileId];
        assert.equal(probe.streams.find(s => s.codec_type === 'video').codec_name, expectedCodec);
        if (entry.operationPlan.compatibilityPath) {
          assert.equal(await pcmHash(entry.fingerprint.canonicalPath), await pcmHash(destination));
          proofs.push({ id: item.id, mode: 'ordinary', outputAccess: item.outputAccess });
        } else {
          const q = service.operationQualifications.requireCurrent(entry.qualificationSelection, { ...entry.qualificationBindings,
            budget: service.operationEvidenceBudget, executionBudgetMs: service.operationDeadlineMs });
          assert.equal(isProportionalFamilySelection(q), true); assert.equal(q.sourcePolicy.id, p.changes.family);
          const limits = operationCostLimits(entry, q), evidence = entry.operationEvidence, v = evidence.decodedEvidence.video, a = evidence.decodedEvidence.audio[0];
          assert.equal(evidence.status, 'completed'); assert.equal(entry.telemetryValidation.valid, true);
          assert.equal(a.pcmIdentity.sourceHash, a.pcmIdentity.outputHash); assert.equal(a.sourceSampleCount, a.outputSampleCount);
          const spec = inputs[p.sourceId === 'mixed' ? 'keep' : p.sourceId].spec, range = item.operationRequest.range;
          assert.equal(v.sourceFrameCount, count(range?.startUs || 0, range?.endUs ?? spec.videoUs, 30));
          assert.equal(a.sourceSampleCount, count(range?.startUs || 0, range ? range.endUs ?? spec.videoUs : spec.audioUs, 48000));
          assert.equal(evidence.completeSource.video.frames, count(0, spec.videoUs, 30));
          assert.equal(Number(evidence.completeSource.audio[0].sampleCount), count(0, spec.audioUs, 48000));
          if (result.items.length === 1) assert.ok(result.elapsedMs <= limits.executionBudgetMs);
          assert.equal(v.outputFrameCount, v.sourceFrameCount); assert.equal(probe.streams[0].width, 1280); assert.equal(probe.streams[0].height, 720);
          if (!range) { assert.equal(item.timing.requested, null); assert.equal(item.timing.resolved, null); assert.equal(item.timing.timeline, 'source-timestamps'); }
          assert.deepEqual(item.evidenceStorage.final.violations, []);
          const reservation = JSON.parse(await fs.readFile(path.join(path.dirname(evidence.directory), 'storage-reservation.json')));
          assert.equal(reservation.forecastBytes, limits.evidenceReserveBytes);
          for (const stream of entry.operationTelemetryReceipt.streams) {
            assert.ok(stream.summary.bytes <= limits.telemetryBytes); assert.ok(BigInt(stream.summary.records) <= BigInt(limits.telemetryRecords));
          }
          const history = await service.getDiagnosticHistory({ limit: 200 });
          const events = await Promise.all(history.events.map(async row => (await service.getDiagnosticRecord({ eventId: row.id })).event));
          const accounting = events.find(event => event.reason === 'OPERATION_EVIDENCE_COLLECTED' && event.fileId === item.id)?.context;
          assert.ok(accounting && accounting.children <= limits.maxChildren && accounting.streamedBytes <= limits.evidenceBytes);
          assert.ok(accounting.pipeBytes.stdout + accounting.pipeBytes.stderr <= limits.pipeBytes);
          proofs.push({ id: item.id, family: q.sourcePolicy.id, frames: v.outputFrameCount, samples: a.outputSampleCount, limits, accounting, pcmIdentity: a.pcmIdentity, outputAccess: item.outputAccess });
        }
        await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', destination, '-map', '0', '-f', 'null', '-']);
      }
      return proofs;
    }
    async function publish(name, sourceId, settings, changes) {
      const p = await prepare(name, sourceId, settings, changes); assert.ok(p.plan.items.every(i => i.status === 'ready'));
      const result = await start(p), proofs = await verifyPublished(p, result);
      report.cases.push({ case: name, status: 'passed', ...result, proofs });
    }
    // Preserve the exact failed conversion as a negative contract regression,
    // rather than silently replacing the fixture and claiming broad support.
    const h264 = PROFILES.find(p => p.id === 'h264-cpu');
    const layoutLoss = await prepare('ordinary-mov-layout-loss-refused', 'keep',
      { profileId: h264.id, preset: h264.defaultPreset, quality: h264.quality.default });
    const refused = await start(layoutLoss), refusedItem = refused.items[0];
    assert.equal(refused.items.length, 1); assert.equal(refusedItem.status, 'failed');
    assert.equal(refusedItem.reasonCode, 'INVALID_OUTPUT'); assert.match(refusedItem.reason, /audio channel_layout changed/);
    assert.notEqual(refusedItem.outputDisposition?.published, true); assert.equal(refusedItem.outputAccess?.outputId, undefined);
    await assert.rejects(fs.stat(layoutLoss.destinations.get(refusedItem.id)), { code: 'ENOENT' });
    report.cases.push({ case: 'ordinary-mov-layout-loss-refused', status: 'passed', unsupportedConversion: true, ...refused });
    for (const profile of PROFILES.filter(p => p.hardware === 'CPU')) await publish(`ordinary-${profile.id}`, 'ordinary',
      { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default });
    for (const spec of CHANGED) await publish(spec.id, spec.source, SETTINGS, spec);
    await publish('mixed-ordinary-and-range', 'mixed', SETTINGS, CHANGED[0]);
    for (const kind of ['forged-family', 'forged-runtime', 'stale-family']) {
      const p = await prepare(kind, 'mixed', SETTINGS, CHANGED[0]);
      const entry = [...p.entries.values()].find(e => !e.operationPlan.compatibilityPath);
      if (kind === 'forged-family') entry.qualificationSelection = {};
      else if (kind === 'forged-runtime') entry.operationRuntimeToken = {};
      else service.operationQualifications.invalidate('Owned app proof stale selection');
      const before = report.census.spawned;
      assert.throws(() => service.startBatch({ planId: p.plan.planId, fileIds: p.plan.items.map(i => i.id) }));
      assert.equal(report.census.spawned, before); assert.ok(service.snapshot().items.every(i => i.status === 'ready'));
      report.cases.push({ case: kind, status: 'passed', childrenStarted: 0 });
    }
    const unsupported = await prepare('unsupported-setting', 'keep', { profileId: 'h264-cpu', preset: 'slow', quality: 25 }, CHANGED[0]);
    assert.notEqual(unsupported.plan.items[0].status, 'ready'); assert.ok(unsupported.plan.items[0].reason);
    const beforeUnsupported = report.census.spawned;
    assert.throws(() => service.startBatch({ planId: unsupported.plan.planId, fileIds: unsupported.plan.items.map(i => i.id) }));
    assert.equal(report.census.spawned, beforeUnsupported);
    report.cases.push({ case: 'unsupported-setting-per-file', status: 'passed', items: unsupported.plan.items });
    for (const mode of ['encode', 'evidence']) {
      const p = await prepare(`cancel-${mode}`, 'resize', SETTINGS, CHANGED[2]); observed = null; cancelMode = mode;
      const result = await start(p); assert.ok(observed); assert.equal(result.items[0].status, 'cancelled');
      assert.notEqual(result.items[0].outputDisposition?.published, true);
      assert.equal(result.items[0].cleanup?.retained, true);
      if (mode === 'evidence') { assert.equal(result.items[0].outputDisposition.kind, 'retained-unverified'); assert.equal(result.items[0].outputDisposition.validationCurrent, false); }
      await assert.rejects(fs.stat(p.destinations.get(p.plan.items[0].id)), { code: 'ENOENT' });
      report.cases.push({ case: `cancel-${mode}`, status: 'passed', observed, ...result });
      await publish(`recovery-${mode}`, 'resize', SETTINGS, CHANGED[2]);
    }
    const collision = await prepare('collision', 'keep', SETTINGS, CHANGED[0]);
    const destination = collision.destinations.get(collision.plan.items[0].id); await fs.writeFile(destination, 'owned collision sentinel', { flag: 'wx' });
    const prior = report.census.encodes, result = await start(collision);
    assert.equal(result.items[0].status, 'skipped'); assert.equal(report.census.encodes, prior);
    assert.equal(await fs.readFile(destination, 'utf8'), 'owned collision sentinel'); report.cases.push({ case: 'collision', status: 'passed', ...result });
    for (const source of report.sources) { assert.equal(await hashFile(source.path), source.sha256); assert.deepEqual(await readSourceIdentity(source.path), source.identity); }
    report.status = 'passed-composed-av1-workbench-service-proof';
  } catch (error) {
    report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1;
    if (service) report.failedSnapshot = service.snapshot();
  } finally {
    clearTimeout(timer); service?.closeAdmission();
    try { await service?.cancelCurrent(); if (cancellation) await cancellation; await service?.closeOperationResources();
      if (service) assert.equal((await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed')).persisted, true);
    } catch (error) { report.closureFailure = { code: error.code, message: error.message }; }
    if (report.census.live || report.census.spawned !== report.census.closed || report.census.maximum > 1)
      report.closureFailure ||= { message: 'Child ownership failed to settle sequentially' };
    if (report.closureFailure) { report.status = 'failed-retained'; process.exitCode = 1; }
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({ root, status: report.status, census: report.census, cases: report.cases.map(c => ({ case: c.case, status: c.status })), failure: report.failure }, null, 2));
  return report;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main, SOURCES, CHANGED, RANGE, assertReady, generationArgs, ordinaryGenerationArgs, MIXED_INPUTS, count };
