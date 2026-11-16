'use strict';
// Real shared-service CPU proof on generated media only. No user path arguments.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWorkbenchService, createWorkbenchRunner } = require('./workbench-service.cjs');
const { PINS } = require('./runtime.cjs');
const { PROFILES } = require('../src/media.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = async file => digest(await fs.readFile(file));

async function smoke() {
  const parent = path.join(__dirname, 'artifacts'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'workbench-execution-'));
  const input = path.join(root, 'input'), stateDir = path.join(root, 'state');
  await fs.mkdir(input); await fs.mkdir(stateDir);
  const source = path.join(input, 'synthetic.mkv');
  let service, cancelEncode = false, cancellation, passed = false;
  const census = { spawned: 0, closed: 0, live: 0, maximum: 0, encodes: 0 };
  const isEncode = args => args.includes('-c:v:0') && /[/\\]\.ffmpeg-encoder-[^/\\]+[/\\]encoded\.mkv$/.test(args.at(-1));
  const onChild = child => {
    census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
    child.once('close', () => { census.closed++; census.live--; });
    if (isEncode(child.spawnargs)) {
      census.encodes++;
      if (cancelEncode) { cancelEncode = false; cancellation = service.cancelCurrent(); }
    }
  };
  const run = createWorkbenchRunner({ onChild });
  const results = [];
  try {
    await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i',
      'testsrc2=size=320x180:rate=30,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.4', '-c:v', 'ffv1', '-level', '3',
      '-pix_fmt', '+yuv420p', '-c:a', 'pcm_s16le', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', source]);
    const originalBytes = await fs.readFile(source), originalHash = digest(originalBytes);
    service = await createWorkbenchService({ stateDir, onChild }); await service.initializeDiagnostics();
    await service.getCapabilities();
    const inFolder = await service.registerFolder(input, 'input');
    async function prepare(name, profileId = 'h264-cpu', overrides) {
      const output = path.join(root, name); await fs.mkdir(output);
      const folder = await service.registerFolder(output, 'output');
      const profile = PROFILES.find(row => row.id === profileId);
      const plan = await service.prepareBatch({ inputFolderId: inFolder.id, outputFolderId: folder.id,
        settings: { profileId, preset: profile.defaultPreset, quality: profile.quality.default },
        ...(overrides ? { batchOverrides: overrides } : {}) });
      assert.equal(plan.phase, 'ready', plan.error);
      return { plan, output, destination: path.join(output, plan.items[0].outputName) };
    }
    async function start(plan) {
      service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] });
      await service.taskPromise; if (cancellation) { await cancellation; cancellation = null; }
      assert.equal(census.live, 0); return service.snapshot().items[0];
    }
    const packetHash = async file => (await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error',
      '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:a:0', '-c:a', 'copy', '-f', 'hash', '-hash', 'sha256', '-'])).stdout.trim();
    const originalAudio = await packetHash(source);
    for (const profile of PROFILES.filter(row => row.hardware === 'CPU')) {
      const h = await prepare(profile.id, profile.id); assert.equal(h.plan.items[0].status, 'ready', h.plan.items[0].reason);
      const item = await start(h.plan); assert.equal(item.status, 'success', JSON.stringify(item));
      assert.equal(item.outputDisposition.published, true); assert.equal(item.sourceAssessment.kind, 'unchanged');
      const probe = JSON.parse((await run(PINS.ffprobe.path, ['-v', 'error', '-count_frames', '-show_streams', '-show_format', '-of', 'json', h.destination])).stdout);
      const video = probe.streams.find(row => row.codec_type === 'video');
      assert.equal(video.codec_name, { H264: 'h264', H265: 'hevc', AV1: 'av1' }[profile.codec]);
      assert.equal(Number(video.nb_read_frames), 12); assert.equal(video.width, 320); assert.equal(video.height, 180);
      assert.equal(classifyMarker(probe).kind, 'generated');
      await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', h.destination, '-map', '0', '-f', 'null', '-']);
      assert.equal(await packetHash(h.destination), originalAudio);
      assert.equal(await sha(source), originalHash);
      results.push({ case: profile.id, status: item.status, frames: 12, fullDecode: true, copiedAudioHash: true });
    }
    const stopped = await prepare('cancel'); cancelEncode = true;
    const cancelled = await start(stopped.plan); assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));
    await assert.rejects(fs.stat(stopped.destination), { code: 'ENOENT' });
    const retry = await prepare('retry'); assert.equal((await start(retry.plan)).status, 'success');
    results.push({ case: 'cancel-then-retry', passed: true });

    const changed = await prepare('changed-source'), beforeChanged = census.encodes;
    await fs.appendFile(source, 'deliberate synthetic source change');
    const changedResult = await start(changed.plan);
    assert.equal(changedResult.status, 'failed'); assert.equal(changedResult.reasonCode, 'INPUT_CHANGED');
    assert.equal(census.encodes, beforeChanged); await assert.rejects(fs.stat(changed.destination), { code: 'ENOENT' });
    await fs.writeFile(source, originalBytes); results.push({ case: 'changed-before-start', passed: true });

    const collision = await prepare('collision'), beforeCollision = census.encodes;
    await fs.writeFile(collision.destination, 'existing synthetic race winner');
    assert.equal((await start(collision.plan)).status, 'skipped'); assert.equal(census.encodes, beforeCollision);
    assert.equal(await fs.readFile(collision.destination, 'utf8'), 'existing synthetic race winner');
    results.push({ case: 'existing-output', passed: true });

    const originalRun = service.run;
    const race = await prepare('publication-race');
    service.run = async (file, args, options) => {
      const result = await originalRun(file, args, options);
      if (isEncode(args)) await fs.writeFile(race.destination, 'synthetic competitor after encode');
      return result;
    };
    const raceItem = await start(race.plan); service.run = originalRun;
    assert.equal(raceItem.status, 'skipped'); assert.equal(raceItem.outputDisposition.kind, 'retained-completed');
    assert.equal(await fs.readFile(race.destination, 'utf8'), 'synthetic competitor after encode');
    assert.ok((await fs.stat(raceItem.outputDisposition.file)).size > 0);
    results.push({ case: 'publication-race-retained', passed: true });

    const missing = await prepare('missing-after-encode'), preserved = path.join(root, 'preserved-synthetic.mkv');
    service.run = async (file, args, options) => {
      const result = await originalRun(file, args, options);
      if (isEncode(args)) await fs.rename(source, preserved);
      return result;
    };
    const missingItem = await start(missing.plan); service.run = originalRun;
    assert.equal(missingItem.reasonCode, 'SOURCE_CHECK_INCOMPLETE', JSON.stringify(missingItem));
    assert.equal(missingItem.sourceAssessment.kind, 'incomplete');
    assert.equal(missingItem.outputDisposition.kind, 'retained-completed');
    await assert.rejects(fs.stat(missing.destination), { code: 'ENOENT' });
    assert.equal(await sha(preserved), originalHash); await fs.rename(preserved, source);
    results.push({ case: 'missing-after-valid-completion', passed: true });

    const range = await prepare('range-refused');
    range.plan = await service.updateFileOperations({ planId: range.plan.planId,
      draftId: range.plan.operationDraft.id, revision: range.plan.operationDraft.revision,
      fileIds: [range.plan.items[0].id], overrides: { range: { startUs: 0, endUs: 200000 } } });
    assert.equal(range.plan.items[0].reasonCode, 'OPERATION_QUALIFICATION_REQUIRED');
    assert.throws(() => service.startBatch({ planId: range.plan.planId, fileIds: [range.plan.items[0].id] }), { code: 'LINUX_WORKBENCH_ROUTE_UNAVAILABLE' });
    results.push({ case: 'changed-operation-refused', passed: true });
    assert.equal(await sha(source), originalHash); assert.equal(census.spawned, census.closed); assert.equal(census.maximum, 1);
    passed = true;
    console.log(JSON.stringify({ passed, results, census, sourceHash: originalHash,
      limits: 'Bounded synthetic ordinary CPU proof; not general fidelity, GPU, changed-operation or release qualification.', artifactDirectory: root }, null, 2));
  } finally {
    service?.closeAdmission(); await service?.cancelCurrent(); await service?.closeOperationResources();
    if (service) assert.equal((await service.closeDiagnostics(passed ? 'completed' : 'failed')).persisted, true);
    if (!passed) console.error(JSON.stringify({ passed, census, results, artifactDirectory: root }));
  }
}
smoke().catch(error => { console.error(error); process.exitCode = 1; });
