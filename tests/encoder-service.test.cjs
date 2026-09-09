'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');

const artifactParent = path.resolve(__dirname, '..', 'artifacts', 'service-tests');
const defaultSettings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const failure = (code, message) => Object.assign(new Error(message), { code });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function inspection() {
  return {
    probe: { streams: [{
      index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p',
      width: 320, height: 180, color_transfer: 'bt709', color_primaries: 'bt709',
      color_space: 'bt709', color_range: 'tv', disposition: { default: 1 },
    }] },
    color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: 0, reasons: [] },
    duration: 2,
    summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 },
  };
}

async function harness(t, { names = ['a.mp4', 'b.mp4'], onEncode, onInspect, verify } = {}) {
  await fs.mkdir(artifactParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(artifactParent, 'run-'));
  const input = path.join(root, 'input');
  const output = path.join(root, 'output');
  const stateDir = path.join(root, 'state');
  await fs.mkdir(input);
  await fs.mkdir(output);
  for (const name of names) await fs.writeFile(path.join(input, name), `Original input ${name}`);
  t.after(async () => {
    // This unique tree contains only this test's fixtures and service outputs.
    // Resolve and check its boundary before deleting it; never clean a selected
    // real media directory or use a wildcard across other test runs.
    const actual = await fs.realpath(root);
    const parent = await fs.realpath(artifactParent);
    if (!actual.startsWith(parent + path.sep) || !path.basename(actual).startsWith('run-')) {
      throw new Error('Refusing to remove a path outside the owned test artifact tree.');
    }
    await fs.rm(actual, { recursive: true });
  });
  const calls = [];
  const inspections = [];
  let active = 0;
  let maximumActive = 0;
  const service = new EncoderService({
    ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir, inspectionWorkers: 1,
    capabilities: async () => ({
      profiles: PROFILES.map((profile) => ({ ...profile, available: true, supportedBitDepths: [8, 10] })),
      versions: { ffmpeg: 'test', ffprobe: 'test' },
    }),
    inspect: async (file, options) => {
      inspections.push(file);
      if (onInspect) await onInspect({ file, options, input, output, service });
      return inspection();
    },
    verify: verify || (() => ({ valid: true, errors: [] })),
    run: async (executable, args, options) => {
      if (executable === 'injected-ffprobe') return { stdout: '{}', stderr: '', exitCode: 0 };
      const file = args[args.indexOf('-i') + 1];
      const temporary = args.at(-1);
      const call = { file, temporary, args, options };
      calls.push(call);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (onEncode) await onEncode({ ...call, input, output, service, number: calls.length });
        if (options.signal.aborted) throw failure('CANCELLED', 'Child closed after cancellation.');
        await fs.writeFile(temporary, `Encoded output ${path.basename(file)}`);
        options.onProgress?.({ seconds: 2, speed: 1, fps: 30, bytes: 100, frame: 60, ended: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      } finally {
        active -= 1;
      }
    },
  });
  const inputFolder = await service.registerFolder(input, 'input');
  const outputFolder = await service.registerFolder(output, 'output');
  const request = { inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, settings: defaultSettings };
  return {
    root, input, output, stateDir, service, calls, inspections, request,
    maximumActive: () => maximumActive,
    prepare: () => service.prepareBatch(request),
    async finish(plan) {
      service.startBatch({ planId: plan.planId, fileIds: plan.items.filter((item) => item.status === 'ready').map((item) => item.id) });
      await service.taskPromise;
      return service.snapshot();
    },
  };
}

test('two selected jobs run sequentially, publish validated outputs, and leave an accurate recoverable result', async (t) => {
  const h = await harness(t);
  const plan = await h.prepare();
  assert.deepEqual(plan.items.map((item) => item.status), ['ready', 'ready']);
  const result = await h.finish(plan);
  assert.equal(result.phase, 'completed');
  assert.deepEqual(result.counts, { success: 2, failed: 0, skipped: 0, cancelled: 0, unprocessed: 0 });
  assert.equal(h.maximumActive(), 1);
  assert.deepEqual(h.calls.map((call) => path.basename(call.file)), ['a.mp4', 'b.mp4']);
  assert.deepEqual((await fs.readdir(h.output)).sort(), ['a_H265-CPU.mkv', 'b_H265-CPU.mkv']);
  assert.equal(await fs.readFile(path.join(h.input, 'a.mp4'), 'utf8'), 'Original input a.mp4');
  const log = JSON.parse(await fs.readFile(path.join(h.stateDir, 'logs', `${result.batchId}.json`), 'utf8'));
  assert.deepEqual(log.counts, result.counts);
  assert.equal(log.phase, 'completed');
});

test('a file-specific encode failure continues to the next selected input without publishing the failed output', async (t) => {
  const h = await harness(t, { onEncode: ({ number }) => {
    if (number === 1) throw failure('TOOL_FAILED', 'Corrupt input packet.');
  } });
  const result = await h.finish(await h.prepare());
  assert.equal(result.phase, 'completed');
  assert.deepEqual(result.counts, { success: 1, failed: 1, skipped: 0, cancelled: 0, unprocessed: 0 });
  assert.deepEqual(result.items.map((item) => item.status), ['failed', 'success']);
  assert.deepEqual(await fs.readdir(h.output), ['b_H265-CPU.mkv']);
});

test('a shared infrastructure failure stops remaining work and preserves explicit unprocessed counts', async (t) => {
  const h = await harness(t, { onEncode: () => { throw failure('ENOSPC', 'The output disk is full.'); } });
  const result = await h.finish(await h.prepare());
  assert.equal(result.phase, 'failed');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(result.counts, { success: 0, failed: 1, skipped: 0, cancelled: 0, unprocessed: 1 });
  assert.deepEqual(await fs.readdir(h.output), []);
});

test('cancellation waits for the owned child to close, prevents restart, and never starts the next queued file', async (t) => {
  const started = deferred();
  const closed = deferred();
  const h = await harness(t, { onEncode: async ({ number }) => {
    if (number === 1) { started.resolve(); await closed.promise; }
  } });
  const plan = await h.prepare();
  const start = { planId: plan.planId, fileIds: plan.items.map((item) => item.id) };
  const running = h.service.startBatch(start);
  await started.promise;
  let settled = false;
  const cancelling = h.service.cancelBatch({ batchId: running.batchId }).then((result) => { settled = true; return result; });
  await tick();
  assert.equal(settled, false);
  assert.equal(h.service.snapshot().phase, 'cancelling');
  assert.equal(h.service.busy, true);
  assert.throws(() => h.service.startBatch(start), { code: 'BUSY' });
  await assert.rejects(h.prepare(), { code: 'BUSY' });
  assert.equal(h.calls.length, 1);
  closed.resolve();
  const result = await cancelling;
  assert.equal(result.phase, 'cancelled');
  assert.deepEqual(result.counts, { success: 0, failed: 0, skipped: 0, cancelled: 1, unprocessed: 1 });
  assert.deepEqual(await fs.readdir(h.output), []);
  assert.equal(h.service.busy, false);
  const newPlan = await h.prepare();
  const completed = await h.finish(newPlan);
  assert.equal(completed.counts.success, 2);
  const revision = completed.revision;
  h.calls[0].options.onProgress({ seconds: 999, speed: 1, ended: true });
  assert.equal(h.service.snapshot().revision, revision);
  assert.notEqual(h.service.snapshot().progress?.seconds, 999);
});

test('cancelling preparation waits for inspection settlement and invalidates the incomplete plan', async (t) => {
  const inspecting = deferred();
  const inspected = deferred();
  const h = await harness(t, { onInspect: async ({ options }) => {
    inspecting.resolve();
    await inspected.promise;
    if (options.signal.aborted) throw failure('CANCELLED', 'Probe closed after cancellation.');
  } });
  const preparing = h.prepare();
  await inspecting.promise;
  let settled = false;
  const cancelled = h.service.cancelCurrent().then((result) => { settled = true; return result; });
  await tick();
  assert.equal(settled, false);
  assert.equal(h.service.busy, true);
  inspected.resolve();
  await preparing;
  const result = await cancelled;
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.planId, null);
  assert.equal(result.counts.unprocessed, 2);
  assert.equal(h.calls.length, 0);
  assert.equal(h.inspections.length, 1);
});

test('malicious payloads and stale identities cannot start an unprepared or replacement plan', async (t) => {
  const h = await harness(t);
  await assert.rejects(h.service.prepareBatch({ ...h.request, args: ['-y'] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(h.service.prepareBatch({ ...h.request, settings: { ...defaultSettings, executable: 'cmd.exe' } }), { code: 'INVALID_SETTINGS' });
  await assert.rejects(h.service.prepareBatch({ ...h.request, inputFolderId: '../input' }), { code: 'INVALID_ID' });
  const first = await h.prepare();
  const second = await h.prepare();
  assert.throws(() => h.service.startBatch({ planId: first.planId, fileIds: first.items.map((item) => item.id) }), { code: 'STALE_PLAN' });
  assert.throws(() => h.service.startBatch({ planId: second.planId, fileIds: [randomUUID()] }), { code: 'INVALID_SELECTION' });
  assert.throws(() => h.service.startBatch({ planId: second.planId, fileIds: [second.items[0].id, second.items[0].id] }), { code: 'INVALID_SELECTION' });
  await assert.rejects(h.service.cancelBatch({ batchId: randomUUID() }), { code: 'STALE_BATCH' });
  assert.equal(h.calls.length, 0);
});

test('duplicate output stems require choosing one input and keep the other explicitly unprocessed', async (t) => {
  const h = await harness(t, { names: ['same.mp4', 'same.mkv'] });
  const plan = await h.prepare();
  assert.deepEqual(plan.items.map((item) => item.status), ['conflict', 'conflict']);
  assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: plan.items.map((item) => item.id) }), { code: 'OUTPUT_CONFLICT' });
  h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] });
  await h.service.taskPromise;
  const result = h.service.snapshot();
  assert.deepEqual(result.counts, { success: 1, failed: 0, skipped: 0, cancelled: 0, unprocessed: 1 });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(await fs.readdir(h.output), ['same_H265-CPU.mkv']);
});

test('an input changed after preview is rejected before encoding while other inputs can continue', async (t) => {
  const h = await harness(t);
  const plan = await h.prepare();
  await fs.appendFile(path.join(h.input, 'a.mp4'), 'Changed after preview');
  const result = await h.finish(plan);
  assert.deepEqual(result.items.map((item) => item.status), ['failed', 'success']);
  assert.match(result.items[0].reason, /changed since preview/i);
  assert.deepEqual(h.calls.map((call) => path.basename(call.file)), ['b.mp4']);
});

test('an input changed during encoding prevents publication and cleans the owned partial output', async (t) => {
  const h = await harness(t, { names: ['a.mp4'], onEncode: ({ file }) => fs.appendFile(file, 'Changed during encode') });
  const result = await h.finish(await h.prepare());
  assert.equal(result.counts.failed, 1);
  assert.match(result.items[0].reason, /changed while/i);
  assert.deepEqual(await fs.readdir(h.output), []);
});

test('an output that appears after preview is skipped without encoding or changing its bytes', async (t) => {
  const h = await harness(t, { names: ['a.mp4'] });
  const plan = await h.prepare();
  const destination = path.join(h.output, 'a_H265-CPU.mkv');
  await fs.writeFile(destination, 'Existing protected bytes');
  const result = await h.finish(plan);
  assert.equal(result.counts.skipped, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(await fs.readFile(destination, 'utf8'), 'Existing protected bytes');
});

test('an output publication race preserves the competitor and removes only the app-owned temporary file', async (t) => {
  const h = await harness(t, { names: ['a.mp4'], onEncode: ({ output }) => fs.writeFile(path.join(output, 'a_H265-CPU.mkv'), 'Publication race winner') });
  const result = await h.finish(await h.prepare());
  assert.equal(result.counts.skipped, 1);
  assert.match(result.items[0].reason, /publication race/i);
  assert.equal(await fs.readFile(path.join(h.output, 'a_H265-CPU.mkv'), 'utf8'), 'Publication race winner');
  assert.deepEqual(await fs.readdir(h.output), ['a_H265-CPU.mkv']);
});

test('a disappeared output folder is a shared failure and stops the remaining queue', async (t) => {
  const h = await harness(t);
  const plan = await h.prepare();
  await fs.rename(h.output, path.join(h.root, 'temporarily-unavailable-output'));
  const result = await h.finish(plan);
  assert.equal(result.phase, 'failed');
  assert.deepEqual(result.counts, { success: 0, failed: 1, skipped: 0, cancelled: 0, unprocessed: 1 });
  assert.equal(h.calls.length, 0);
});
