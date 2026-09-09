'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { InspectionCache } = require('../src/inspection-cache.cjs');
const { PROFILES, buildEncodeArgs } = require('../src/media.cjs');

const parent = path.resolve(__dirname, '../artifacts/reuse-service-tests');
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const failure = (code, message) => Object.assign(new Error(message), { code });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

async function harness(t, { names = ['a.mp4', 'b.mp4'], onProbe } = {}) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(root, 'input');
  const output = path.join(root, 'output');
  const stateDir = path.join(root, 'state');
  await fs.mkdir(input); await fs.mkdir(output);
  for (const name of names) await fs.writeFile(path.join(input, name), `Stable fixture bytes ${name}`);
  t.after(async () => {
    const resolved = await fs.realpath(root);
    if (!resolved.startsWith((await fs.realpath(parent)) + path.sep) || !path.basename(resolved).startsWith('run-')) throw new Error('Unsafe test cleanup');
    await fs.rm(resolved, { recursive: true });
  });
  const calls = [];
  let capabilityCalls = 0;
  async function open({ eligible = true, hash = 'a'.repeat(64) } = {}) {
    const cache = new InspectionCache({ directory: path.join(stateDir, 'cache'), ffprobeHash: hash });
    const service = new EncoderService({
      ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir, inspectionCache: cache, inspectionWorkers: 1,
      storageEligibility: { check: async () => ({ eligible, reason: eligible ? null : 'Injected unsupported storage.' }) },
      capabilities: async () => {
        capabilityCalls++;
        return { profiles: PROFILES.map(p => ({ ...p, available: true, supportedBitDepths: [8, 10] })), versions: {} };
      },
      run: async (executable, args, options) => {
        const file = args.at(-1);
        calls.push({ file, args });
        await onProbe?.({ file, args, options });
        if (options.signal.aborted) throw failure('CANCELLED', 'Owned probe closed.');
        const data = args.includes('-show_frames')
          ? { frames: [{ media_type: 'video', stream_index: 0, best_effort_timestamp_time: '0', color_transfer: 'bt709' }] }
          : { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p', color_transfer: 'bt709', disposition: { default: 1 } }], format: { duration: '2', tags: { title: 'Preserved' } }, chapters: [] };
        return { stdout: JSON.stringify(data), stderr: '', exitCode: 0 };
      },
    });
    const inputToken = await service.registerFolder(input, 'input');
    const outputToken = await service.registerFolder(output, 'output');
    return { service, cache, prepare: (overrides = {}) => service.prepareBatch({ inputFolderId: inputToken.id, outputFolderId: outputToken.id, settings: { ...settings, ...overrides } }) };
  }
  return { input, output, stateDir, calls, open, capabilityCalls: () => capabilityCalls };
}

test('real cache survives service restart; profile-independent evidence does not cache plan or hardware authority', async t => {
  const h = await harness(t);
  const first = await h.open();
  const cold = await first.prepare();
  assert.equal(cold.phase, 'ready');
  assert.equal(h.calls.length, 4);
  assert.equal(cold.preparation.reused, 0);
  const argsBefore = [...first.service.plan.entries.values()].map(entry => buildEncodeArgs({ input: entry.file, output: entry.destination, settings, probe: entry.inspection.probe, colorEvidence: entry.inspection.color }));
  const restarted = await h.open();
  const warm = await restarted.prepare();
  assert.equal(h.calls.length, 4, 'valid hits launch zero metadata/frame calls');
  assert.equal(warm.preparation.reused, 2);
  assert.equal(warm.preparation.resolved, 2);
  assert.equal(warm.preparation.active, 0);
  assert.deepEqual(warm.items.map(i => i.summary), cold.items.map(i => i.summary));
  assert.notEqual(warm.planId, cold.planId);
  assert.equal(h.capabilityCalls(), 2, 'availability is current per service, never sourced from disk cache');
  const argsAfter = [...restarted.service.plan.entries.values()].map(entry => buildEncodeArgs({ input: entry.file, output: entry.destination, settings, probe: entry.inspection.probe, colorEvidence: entry.inspection.color }));
  assert.deepEqual(argsAfter, argsBefore);
  const changedProfile = await restarted.prepare({ profileId: 'h264-cpu', preset: 'slower', quality: 24 });
  assert.equal(changedProfile.preparation.reused, 2);
  assert.equal(h.calls.length, 4);
  assert.ok(changedProfile.items.every(i => i.outputName.endsWith('_H264-CPU.mkv')));
});

test('one changed input alone misses; destination existence and runtime identity remain fresh', async t => {
  const h = await harness(t);
  const first = await h.open(); await first.prepare();
  await fs.appendFile(path.join(h.input, 'a.mp4'), ' new completed bytes');
  const second = await h.open();
  const changed = await second.prepare();
  assert.equal(changed.preparation.reused, 1);
  assert.deepEqual(h.calls.slice(4).map(c => path.basename(c.file)), ['a.mp4', 'a.mp4']);
  await fs.writeFile(path.join(h.output, 'b_H265-CPU.mkv'), 'Protected existing output');
  const third = await h.open();
  const skipped = await third.prepare();
  assert.deepEqual(skipped.items.map(i => i.status), ['ready', 'skipped']);
  assert.equal(h.calls.length, 6);
  const newRuntime = await h.open({ hash: 'b'.repeat(64) });
  await newRuntime.prepare();
  assert.equal(h.calls.length, 8, 'new inspector hash invalidates a; b remains safely skipped');
});

test('unsupported storage uses fresh inspection despite a populated valid cache', async t => {
  const h = await harness(t, { names: ['a.mp4'] });
  await (await h.open()).prepare();
  const unsupported = await h.open({ eligible: false });
  const result = await unsupported.prepare();
  assert.equal(result.items[0].status, 'ready');
  assert.equal(result.preparation.reused, 0);
  assert.equal(h.calls.length, 4);
  assert.match(result.preparation.notice, /unsupported storage/);
});

test('corrupt persisted evidence misses on restart and never approves a source', async t => {
  const h = await harness(t, { names: ['a.mp4'] });
  const first = await h.open(); await first.prepare();
  const [record] = await fs.readdir(first.cache.directory);
  await fs.writeFile(path.join(first.cache.directory, record), '{"supported":true');
  const restarted = await h.open();
  const result = await restarted.prepare();
  assert.equal(result.items[0].status, 'ready');
  assert.equal(result.preparation.reused, 0);
  assert.equal(h.calls.length, 4, 'fresh metadata and frames establish the new result');
});

test('failed decoded windows are retried rather than persisted as reusable results', async t => {
  let broken = true;
  const h = await harness(t, { names: ['a.mp4'], onProbe: ({ args }) => { if (broken && args.includes('-show_frames')) throw failure('TIMEOUT', 'Injected frame timeout.'); } });
  const first = await h.open();
  assert.equal((await first.prepare()).items[0].status, 'unsupported');
  broken = false;
  const result = await (await h.open()).prepare();
  assert.equal(result.items[0].status, 'ready');
  assert.equal(result.preparation.reused, 0);
  assert.equal(h.calls.length, 4);
});

test('cancellation retains only completed evidence, owns the probe until close, then resumes exactly the missing file', async t => {
  const started = deferred(); const closed = deferred(); let block = true;
  const h = await harness(t, { onProbe: async ({ file }) => { if (block && path.basename(file) === 'b.mp4') { started.resolve(); await closed.promise; } } });
  const first = await h.open();
  const preparing = first.prepare();
  await started.promise;
  let settled = false;
  const cancellation = first.service.cancelCurrent().then(() => { settled = true; });
  await new Promise(r => setImmediate(r));
  assert.equal(settled, false);
  await assert.rejects(first.prepare(), { code: 'BUSY' });
  closed.resolve(); await cancellation;
  assert.equal((await preparing).phase, 'cancelled');
  block = false;
  const before = h.calls.length;
  const result = await (await h.open()).prepare();
  assert.equal(result.preparation.reused, 1);
  assert.deepEqual(h.calls.slice(before).map(c => path.basename(c.file)), ['b.mp4', 'b.mp4']);
  assert.equal(result.items.every(i => i.status === 'ready'), true);
});
