'use strict';
// Actual Linux workbench service proof, using generated media only.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWorkbenchRunner, createWorkbenchService } = require('./workbench-service.cjs');
const { PINS } = require('./runtime.cjs');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function smoke() {
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts/workbench-remux-'));
  const input = path.join(root, 'input'), stateDir = path.join(root, 'state');
  await fs.mkdir(input); await fs.mkdir(stateDir);
  const source = path.join(input, 'synthetic.mp4');
  const census = { spawned: 0, closed: 0, live: 0, maximum: 0 };
  const cases = []; let service, passed = false, cancellation, cancelEvidence = false;
  const onChild = child => {
    census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
    child.once('close', () => { census.closed++; census.live--; });
    if (cancelEvidence && service.snapshot().progress?.stage === 'evidence-collection') {
      cancelEvidence = false; cancellation = service.cancelCurrent();
    }
  };
  const run = createWorkbenchRunner({ onChild });
  try {
    await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i',
      'testsrc2=size=320x180:rate=30,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '23', '-pix_fmt', '+yuv420p',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', source]);
    const original = await fs.readFile(source), sourceHash = digest(original);
    service = await createWorkbenchService({ stateDir, onChild }); assert.equal(service.linuxRemuxStatus.available, true);
    await service.initializeDiagnostics();
    const folder = await service.registerFolder(input, 'input');
    async function prepare(name) {
      const output = path.join(root, name); await fs.mkdir(output);
      const out = await service.registerFolder(output, 'output');
      await service.prepareRemuxBatch({ inputFolderId: folder.id, outputFolderId: out.id, target: 'matroska' });
      await service.taskPromise; const plan = service.snapshot();
      assert.equal(plan.phase, 'ready', JSON.stringify(plan));
      assert.equal(plan.items[0].status, 'ready', JSON.stringify(plan.items[0]));
      return { plan, output, destination: path.join(output, plan.items[0].outputName) };
    }
    async function start(h) {
      service.startBatch({ planId: h.plan.planId, fileIds: [h.plan.items[0].id] });
      await service.taskPromise; if (cancellation) { await cancellation; cancellation = null; }
      assert.equal(census.live, 0); return service.snapshot().items[0];
    }
    const first = await prepare('positive');
    const item = await start(first); assert.equal(item.status, 'success', JSON.stringify(item));
    const entry = service.plan.entries.get(item.id);
    assert.equal(entry.operationEvidence.status, 'completed'); assert.equal(item.outputDisposition.published, true);
    assert.equal(digest(await fs.readFile(source)), sourceHash);
    await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', first.destination, '-map', '0', '-f', 'null', '-']);
    cases.push({ case: 'video-only-mp4-mkv', passed: true, evidence: entry.operationEvidence.directory,
      verificationMethod: item.verificationMethod, runtimeGroup: entry.operationRuntimeGroup });
    const stopped = await prepare('cancel-evidence'); cancelEvidence = true;
    const cancelled = await start(stopped); assert.equal(cancelEvidence, false); assert.equal(cancelled.status, 'cancelled', JSON.stringify(cancelled));
    await assert.rejects(fs.stat(stopped.destination), { code: 'ENOENT' });
    const retry = await prepare('retry'); assert.equal((await start(retry)).status, 'success');
    cases.push({ case: 'evidence-cancel-then-retry', passed: true });
    const changed = await prepare('changed-source'); await fs.appendFile(source, 'synthetic mutation');
    const changedItem = await start(changed); assert.equal(changedItem.status, 'failed'); assert.equal(changedItem.reasonCode, 'INPUT_CHANGED');
    await assert.rejects(fs.stat(changed.destination), { code: 'ENOENT' }); await fs.writeFile(source, original);
    cases.push({ case: 'source-change-refused', passed: true });
    const conflict = await prepare('existing-output'); await fs.writeFile(conflict.destination, 'synthetic competitor');
    assert.equal((await start(conflict)).status, 'skipped'); assert.equal(await fs.readFile(conflict.destination, 'utf8'), 'synthetic competitor');
    cases.push({ case: 'existing-output-preserved', passed: true });
    const runtime = service.operationRuntime, invoke = runtime.invoke.bind(runtime);
    const copying = args => args[args.indexOf('-c') + 1] === 'copy' && args.includes('-progress');
    const tampered = await prepare('tamper');
    runtime.invoke = async (token, tool, args, options) => {
      const result = await invoke(token, tool, args, options);
      if (tool === 'ffmpeg' && copying(args)) await fs.writeFile(args.at(-1), 'invalid synthetic output');
      return result;
    };
    const tamperItem = await start(tampered); runtime.invoke = invoke;
    assert.equal(tamperItem.status, 'failed'); await assert.rejects(fs.stat(tampered.destination), { code: 'ENOENT' });
    cases.push({ case: 'tampered-output-refused', passed: true, code: tamperItem.reasonCode });
    const race = await prepare('publication-race');
    runtime.invoke = async (token, tool, args, options) => {
      const result = await invoke(token, tool, args, options);
      if (tool === 'ffmpeg' && copying(args)) await fs.writeFile(race.destination, 'synthetic race winner');
      return result;
    };
    const raceItem = await start(race); runtime.invoke = invoke;
    assert.equal(raceItem.status, 'skipped'); assert.equal(raceItem.outputDisposition.kind, 'retained-completed');
    assert.equal(await fs.readFile(race.destination, 'utf8'), 'synthetic race winner');
    cases.push({ case: 'publication-race-retained', passed: true, code: raceItem.reasonCode });
    assert.equal(digest(await fs.readFile(source)), sourceHash); passed = true;
  } catch (error) {
    cases.push({ case: 'failure', code: error.code, message: error.message, stack: error.stack }); process.exitCode = 1;
  } finally {
    await service?.cancelCurrent(); await service?.closeOperationResources(); await service?.closeDiagnostics(passed ? 'completed' : 'failed');
    assert.equal(census.live, 0); assert.equal(census.spawned, census.closed);
    const report = { passed, root, census, cases };
    await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  }
}
if (require.main === module) smoke().catch(error => { console.error(error); process.exitCode = 1; });
