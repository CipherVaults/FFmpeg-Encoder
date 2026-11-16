'use strict';
// Node-only integration proof. Creates its own synthetic source; takes no media
// path or renderer arguments. Generated artifacts stay local and are retained.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWorkbenchRunner, createWorkbenchService } = require('./workbench-service.cjs');
const { PINS } = require('./runtime.cjs');
const { PROFILES } = require('../src/media.cjs');
const { AppearanceSettings } = require('../src/appearance.cjs');
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');

async function smoke() {
  const parent = path.join(__dirname, 'artifacts');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'workbench-smoke-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output'), stateDir = path.join(root, 'state');
  for (const directory of [input, output, stateDir]) await fs.mkdir(directory);
  const source = path.join(input, 'synthetic.mkv');
  const census = { spawned: 0, closed: 0, live: 0, maximum: 0 };
  const onChild = child => {
    census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
    child.once('close', () => { census.closed++; census.live--; });
  };
  const run = createWorkbenchRunner({ onChild });
  let service, passed = false;
  try {
    await run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error', '-n',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30,format=yuv420p,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000', '-t', '0.4',
      '-c:v', 'ffv1', '-level', '3', '-pix_fmt', '+yuv420p', '-c:a', 'pcm_s16le',
      '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', source]);
    const before = await hash(source);
    service = await createWorkbenchService({ stateDir, onChild });
    await service.initializeDiagnostics();
    const capabilities = await service.getCapabilities();
    const cpu = capabilities.profiles.filter(profile => profile.hardware === 'CPU');
    assert.equal(cpu.length, 3);
    for (const profile of cpu) { assert.equal(profile.available, true, profile.reason); assert.deepEqual(profile.supportedBitDepths, [8, 10]); }
    assert.ok(capabilities.profiles.filter(profile => profile.hardware !== 'CPU').every(profile => !profile.available
      && profile.checks.every(check => check.code === 'LINUX_WORKBENCH_GPU_UNTESTED')));
    assert.ok(capabilities.recipes.every(recipe => !recipe.available));
    assert.equal(capabilities.vendorProfiles.length, 6);
    assert.ok(capabilities.vendorProfiles.every(profile => !profile.available));
    const inFolder = await service.registerFolder(input, 'input'), outFolder = await service.registerFolder(output, 'output');
    const profile = PROFILES.find(item => item.id === 'h264-cpu');
    const request = { inputFolderId: inFolder.id, outputFolderId: outFolder.id,
      settings: { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default } };
    const plan = await service.prepareBatch(request);
    assert.equal(plan.phase, 'ready', plan.error);
    assert.equal(plan.items.length, 1); assert.equal(plan.items[0].status, 'ready', plan.items[0].reason);
    assert.equal(plan.preparation.inspected, 1); assert.equal(plan.preparation.reused, 0);
    const count = census.spawned;
    assert.throws(() => service.startBatch({ planId: '00000000-0000-0000-0000-000000000000', fileIds: [plan.items[0].id] }), { code: 'STALE_PLAN' });
    assert.equal(census.spawned, count); assert.deepEqual(await fs.readdir(output), []);
    const remuxRequest = { inputFolderId: inFolder.id, outputFolderId: outFolder.id, target: 'matroska' };
    if (service.linuxRemuxStatus.available) {
      const remux = await service.prepareRemuxBatch(remuxRequest);
      assert.equal(remux.items[0].status, 'unsupported'); // FFV1/PCM MKV is outside the Linux preview.
    } else await assert.rejects(service.prepareRemuxBatch(remuxRequest), { code: 'REMUX_CONTROLS_UNAVAILABLE' });
    const repeat = await service.prepareBatch(request);
    assert.equal(repeat.preparation.inspected, 1); assert.equal(repeat.preparation.reused, 0);
    const same = await service.registerFolder(input, 'output');
    const refused = await service.prepareBatch({ ...request, outputFolderId: same.id });
    assert.equal(refused.phase, 'failed'); assert.match(refused.error, /NTFS/);
    const appearance = new AppearanceSettings({ directory: stateDir });
    const initial = await appearance.load();
    const changed = await appearance.set({ theme: initial.theme === 'dark' ? 'light' : 'dark' });
    assert.equal(changed.persistence.persisted, true);
    await appearance.flush();
    assert.equal((await new AppearanceSettings({ directory: stateDir }).load()).theme, changed.theme);
    const abort = new AbortController();
    await assert.rejects(run(PINS.ffmpeg.path, ['-hide_banner', '-nostdin', '-v', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30', '-t', '3600', '-progress', 'pipe:1', '-f', 'null', '-'],
    { signal: abort.signal, onProgress() { abort.abort(); } }), { code: 'CANCELLED' });
    assert.equal(census.live, 0); assert.equal(census.spawned, census.closed); assert.equal(census.maximum, 1);
    assert.equal(await hash(source), before); assert.deepEqual(await fs.readdir(output), []);
    passed = true;
    console.log(JSON.stringify({ passed, scope: 'actual-workbench-service-inspection-and-settings',
      cpu: cpu.map(row => ({ id: row.id, supportedBitDepths: row.supportedBitDepths })),
      gpuUntested: true, staleStartRefused: true, remuxRefused: true, sameFolderRefused: true,
      freshInspectionRepeated: true, appearancePersistence: true, actualCancellation: true,
      sourceUnchanged: true, outputUnchanged: true, versions: capabilities.versions, census, artifactDirectory: root }, null, 2));
  } finally {
    service?.closeAdmission(); await service?.cancelCurrent(); await service?.closeOperationResources();
    if (service) assert.equal((await service.closeDiagnostics(passed ? 'completed' : 'failed')).persisted, true);
    if (!passed) console.error(JSON.stringify({ passed, census, artifactDirectory: root }));
  }
}
smoke().catch(error => { console.error(error); process.exitCode = 1; });
