'use strict';
// Retained-AAC proof through the actual workbench. Generated sources only.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWorkbenchRunner, createWorkbenchService } = require('./workbench-service.cjs');
const { PINS } = require('./runtime.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function smoke() {
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts/workbench-aac-'));
  const stateDir = path.join(root, 'state'); await fs.mkdir(stateDir);
  const census = { spawned: 0, closed: 0, live: 0, maximum: 0 };
  const cases = []; let service, passed = false, cancellation, cancelAudio = false;
  const onChild = child => {
    census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
    child.once('close', () => { census.closed++; census.live--; });
    if (cancelAudio && child.spawnargs.some(arg => /^pcm_/.test(arg))
        && service.snapshot().progress?.stage === 'evidence-collection') {
      cancelAudio = false; cancellation = service.cancelCurrent();
    }
  };
  const run = createWorkbenchRunner({ onChild });
  try {
    service = await createWorkbenchService({ stateDir, onChild }); assert.equal(service.linuxRemuxStatus.available, true);
    await service.initializeDiagnostics();
    async function generate(label, rate, channels) {
      const input = path.join(root, label); await fs.mkdir(input);
      const source = path.join(input, 'synthetic.mp4');
      await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i',
        'testsrc2=size=320x180:rate=30,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
        '-f', 'lavfi', '-i', `sine=frequency=440:sample_rate=${rate}`, '-t', '1',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', '+yuv420p',
        '-c:a', 'aac', '-b:a', '128k', '-ac', String(channels), '-ar', String(rate),
        '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=Synthetic AAC',
        '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', source]);
      return { input, source, hash: digest(await fs.readFile(source)) };
    }
    async function prepare(fixture, label) {
      const output = path.join(root, label); await fs.mkdir(output);
      const input = await service.registerFolder(fixture.input, 'input'), out = await service.registerFolder(output, 'output');
      const plan = await service.prepareRemuxBatch({ inputFolderId: input.id, outputFolderId: out.id, target: 'mp4' });
      assert.equal(plan.phase, 'ready'); assert.equal(plan.items[0].status, 'ready', JSON.stringify(plan.items[0]));
      return { plan, destination: path.join(output, plan.items[0].outputName) };
    }
    async function start(h) {
      service.startBatch({ planId: h.plan.planId, fileIds: [h.plan.items[0].id] }); await service.taskPromise;
      if (cancellation) { await cancellation; cancellation = null; }
      assert.equal(census.live, 0); return service.snapshot().items[0];
    }
    const pcm = async file => (await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror',
      '-i', file, '-map', '0:a:0', '-c:a', 'pcm_f32le', '-f', 'hash', '-hash', 'sha256', '-'])).stdout.trim();
    const audioTiming = async file => {
      const probe = JSON.parse((await run(PINS.ffprobe.path, ['-v', 'error', '-select_streams', 'a:0',
        '-show_streams', '-show_packets', '-of', 'json', file])).stdout);
      const stream = probe.streams[0], first = probe.packets[0], last = probe.packets.at(-1);
      return { timeBase: stream.time_base, sampleRate: stream.sample_rate, channels: stream.channels,
        durationTicks: stream.duration_ts, startTicks: stream.start_pts, packetCount: probe.packets.length,
        firstPts: first.pts, lastPts: last.pts, lastDuration: last.duration,
        firstSkip: first.side_data_list?.find(row => row.side_data_type === 'Skip Samples') || null };
    };
    let last;
    for (const [label, rate, channels] of [['mono-48k', 48000, 1], ['stereo-48k', 48000, 2], ['mono-44k1', 44100, 1], ['stereo-44k1', 44100, 2]]) {
      const fixture = await generate(label, rate, channels), h = await prepare(fixture, label + '-out');
      const item = await start(h); assert.equal(item.status, 'success', JSON.stringify(item));
      assert.equal(item.outputDisposition.published, true);
      const evidence = service.plan.entries.get(item.id).operationEvidence;
      assert.equal(evidence.status, 'completed'); assert.equal(evidence.verificationClaim.completeAudioDecoded, true);
      const timing = await audioTiming(fixture.source); assert.deepEqual(await audioTiming(h.destination), timing);
      const inputPcm = await pcm(fixture.source), outputPcm = await pcm(h.destination); assert.equal(outputPcm, inputPcm);
      await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', h.destination, '-map', '0', '-f', 'null', '-']);
      assert.equal(digest(await fs.readFile(fixture.source)), fixture.hash);
      cases.push({ label, rate, channels, passed: true, pcmEqual: true, sourceUnchanged: true, audioTiming: timing,
        evidence: evidence.directory, comparisons: evidence.comparisons, verificationClaim: evidence.verificationClaim }); last = fixture;
    }
    const rejectedOutput = path.join(root, 'aac-to-mkv-refused'); await fs.mkdir(rejectedOutput);
    const rejectedFolder = await service.registerFolder(rejectedOutput, 'output');
    const rejectedInput = await service.registerFolder(last.input, 'input');
    const rejected = await service.prepareRemuxBatch({ inputFolderId: rejectedInput.id, outputFolderId: rejectedFolder.id, target: 'matroska' });
    assert.equal(rejected.items[0].status, 'unsupported'); assert.equal(rejected.items[0].reasonCode, 'LINUX_REMUX_ENVELOPE');
    assert.throws(() => service.startBatch({ planId: rejected.planId, fileIds: [rejected.items[0].id] }), { code: 'LINUX_WORKBENCH_ROUTE_UNAVAILABLE' });
    assert.deepEqual(await fs.readdir(rejectedOutput), []);
    cases.push({ label: 'aac-to-mkv-refused-before-start', passed: true });
    const stopped = await prepare(last, 'cancel-audio'); cancelAudio = true;
    const cancelled = await start(stopped); assert.equal(cancelAudio, false, 'Must reach actual PCM evidence child');
    assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled)); await assert.rejects(fs.stat(stopped.destination), { code: 'ENOENT' });
    const retry = await prepare(last, 'retry'); assert.equal((await start(retry)).status, 'success');
    assert.equal(digest(await fs.readFile(last.source)), last.hash);
    cases.push({ label: 'cancel-during-audio-evidence-and-retry', passed: true }); passed = true;
  } catch (error) {
    cases.push({ label: 'failure', code: error.code, message: error.message, stack: error.stack }); process.exitCode = 1;
  } finally {
    await service?.cancelCurrent(); await service?.closeOperationResources(); await service?.closeDiagnostics(passed ? 'completed' : 'failed');
    assert.equal(census.live, 0); assert.equal(census.spawned, census.closed);
    const report = { passed, root, census, cases };
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
}
if (require.main === module) smoke().catch(error => { console.error(error); process.exitCode = 1; });
