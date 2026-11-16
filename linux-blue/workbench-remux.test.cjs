'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { PINS } = require('./runtime.cjs');
const { RUNTIME_ID, SOURCE_PINS, checkRemuxSources, createRemuxRunner } = require('./workbench-remux.cjs');
const options = () => ({ runtime: Object.fromEntries(Object.entries(PINS).map(([k, v]) => [k, v.path])),
  pins: Object.fromEntries(Object.entries(PINS).map(([k, v]) => [k, { sizeBytes: v.size, sha256: v.sha256 }])) });

test('reviewed local dependency gate succeeds and absent/symlinked dependencies fail closed', async () => {
  assert.equal((await checkRemuxSources()).available, true);
  const root = await fs.mkdtemp(path.join(__dirname, 'artifacts/remux-gate-'));
  const absent = await checkRemuxSources(root); assert.equal(absent.available, false);
  assert.deepEqual(absent.missing, Object.keys(SOURCE_PINS));
  await fs.mkdir(path.join(root, 'src'));
  for (const file of Object.keys(SOURCE_PINS)) await fs.symlink(path.resolve(__dirname, '..', file), path.join(root, file));
  assert.deepEqual((await checkRemuxSources(root)).missing, Object.keys(SOURCE_PINS));
});
test('actual pinned pair accepts its exact Linux signed inode representation and genuine identity', async () => {
  const observer = new OperationRuntimeObserver(options());
  try {
    const token = await observer.observe({ hardware: 'CPU' }), snapshot = observer.snapshot(token);
    assert.equal(snapshot.runtimeIdentity, RUNTIME_ID); assert.equal(snapshot.environment, null);
    for (const key of Object.keys(PINS)) {
      const actual = await fs.lstat(PINS[key].path, { bigint: true });
      assert.notEqual(actual.ino, 0n); assert.equal(snapshot.tools[key].identity.ino, String(actual.ino));
    }
    await observer.requireCurrent(token);
  } finally { await observer.close(); }
});
test('zero, out-of-range negative and changed inode are refused without altering raw equality', async () => {
  const original = fs.lstat;
  function fakeInode(value) {
    fs.lstat = async (file, opts) => {
      const stat = await original(file, opts);
      if (file === PINS.ffmpeg.path && opts?.bigint) Object.defineProperty(stat, 'ino', { value, enumerable: true });
      return stat;
    };
  }
  for (const inode of [0n, -9223372036854775809n]) {
    const observer = new OperationRuntimeObserver(options());
    try { fakeInode(inode); await assert.rejects(observer.observe({ hardware: 'CPU' }), { code: 'OPERATION_RUNTIME_STALE' }); }
    finally { fs.lstat = original; await observer.close(); }
  }
  const observer = new OperationRuntimeObserver(options());
  try {
    const token = await observer.observe({ hardware: 'CPU' });
    fakeInode(BigInt(observer.snapshot(token).tools.ffmpeg.identity.ino) + 1n);
    await assert.rejects(observer.requireCurrent(token), { code: 'OPERATION_RUNTIME_STALE' });
  } finally { fs.lstat = original; await observer.close(); }
});
test('evidence boundary preserves binary FD3 sinks, budgets, cancellation and both child observers', async () => {
  const seen = [], child = {}, signal = new AbortController().signal, chunk = Buffer.from([0, 255]);
  const sink = async (bytes, pipe) => { seen.push([bytes, pipe]); };
  const output = value => seen.push(value);
  const run = createRemuxRunner({ verify: async kind => seen.push(kind), onChild: c => seen.push(['census', c]),
    execute: async (_file, args, opts) => {
      assert.deepEqual(args, ['pipe:3']); assert.equal(opts.signal, signal);
      assert.equal(opts.timeoutMs, 120000); assert.equal(opts.stdoutLimit, 64 * 1024 ** 2);
      assert.equal(opts.onStdoutChunk, sink); assert.equal(opts.onOutputBytes, output);
      opts.onChild(child); await opts.onStdoutChunk(chunk, 3); return { exitCode: 0 };
    } });
  await run(PINS.ffprobe.path, ['pipe:3'], { timeoutMs: 120000, stdoutLimit: 64 * 1024 ** 2,
    signal, onStdoutChunk: sink, onOutputBytes: output, onChild: c => seen.push(['observer', c]) });
  assert.deepEqual(seen, ['ffprobe', ['observer', child], ['census', child], [chunk, 3]]);
});
test('evidence boundary refuses wrong tools/unbounded time and preserves terminal copy/error semantics', async () => {
  let called = false;
  const run = createRemuxRunner({ verify: async () => {}, execute: async () => { called = true; return { exitCode: 0 }; } });
  await assert.rejects(run('ffmpeg', [], { timeoutMs: 1 }), { code: 'LINUX_REMUX_TOOL' });
  for (const timeoutMs of [0, -1, 600001, undefined]) await assert.rejects(run(PINS.ffmpeg.path, [], { timeoutMs }), { code: 'LINUX_REMUX_LIMIT' });
  assert.equal(called, false);
  await assert.rejects(run(PINS.ffmpeg.path, ['-c', 'copy'], { timeoutMs: 1000, onProgress() {} }), { code: 'LINUX_REMUX_INCOMPLETE' });
  for (const code of ['CANCELLED', 'TIMEOUT', 'TOOL_FAILED']) {
    const refused = createRemuxRunner({ verify: async () => {}, execute: async () => { throw Object.assign(Error(code), { code }); } });
    await assert.rejects(refused(PINS.ffmpeg.path, ['-c', 'copy'], { timeoutMs: 1000, onProgress() {} }), { code });
  }
});

test('bounded preview refuses audio, chapters, omissions, other containers/targets and larger sources', () => {
  const { assessRemux } = require('../src/remux-contract.cjs');
  const { requirePreviewSource } = require('./workbench-remux.cjs');
  // Synthetic metadata facts only; no file/media equivalence is inferred.
  const probe = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264',
    width: 320, height: 180, pix_fmt: 'yuv420p', field_order: 'progressive',
    color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709',
    sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    time_base: '1/15360', duration: '1', start_time: '0', tags: {}, disposition: { default: 1 } }],
    format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: '1', size: '91154', nb_streams: 1,
      nb_programs: 0, nb_stream_groups: 0, tags: {} }, chapters: [], programs: [], stream_groups: [] };
  function assessment(change = () => {}, requestChange = {}) {
    const value = structuredClone(probe); change(value);
    return assessRemux({ probe: value, sourceFingerprint: 'a'.repeat(64), request: {
      fileId: 'synthetic', identityRevision: 0, draftRevision: 0, operation: 'remux', target: 'matroska',
      range: null, omissionRequestIds: [], ...requestChange } });
  }
  assert.doesNotThrow(() => requirePreviewSource(assessment(), '/synthetic.mp4'));
  for (const input of ['/synthetic.mov', '/synthetic.mkv', null]) assert.throws(() => requirePreviewSource(assessment(), input));
  for (const change of [p => { p.format.duration = '60.001'; }, p => { p.format.size = String(128 * 1024 ** 2 + 1); },
    p => { p.format.format_name = 'matroska,webm'; },
    p => p.chapters.push({ id: 0, time_base: '1/1000', start: 0, end: 500, tags: { title: 'Synthetic chapter' } }),
    p => p.streams.push({ index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp',
      sample_rate: '48000', channels: 1, channel_layout: 'mono', tags: {}, disposition: { default: 1 } })]) {
    assert.throws(() => requirePreviewSource(assessment(change), '/synthetic.mp4'));
  }
  assert.throws(() => requirePreviewSource(assessment(() => {}, { target: 'mp4' }), '/synthetic.mp4'));
  assert.throws(() => requirePreviewSource(assessment(() => {}, { omissionRequestIds: ['not-a-grant'] }), '/synthetic.mp4'));
});

test('source mismatch disables only remux composition without aborting the CPU workbench', async () => {
  const { createWorkbenchService } = require('./workbench-service.cjs');
  const original = fs.lstat;
  const stateDir = await fs.mkdtemp(path.join(__dirname, 'artifacts/remux-unavailable-'));
  let service;
  fs.lstat = async (file, options) => {
    if (file === path.resolve(__dirname, '../src/operation-runtime.cjs')) throw Object.assign(Error('test missing dependency'), { code: 'ENOENT' });
    return original(file, options);
  };
  try {
    service = await createWorkbenchService({ stateDir });
    assert.equal(service.linuxRemuxStatus.available, false); assert.equal(service.remuxOperations, null);
    assert.equal(service.operationRuntime, null);
    assert.equal(typeof service.run, 'function');
    await assert.rejects(service.prepareRemuxBatch({ target: 'matroska' }), { code: 'REMUX_CONTROLS_UNAVAILABLE' });
    assert.throws(() => service.startBatch({ planId: '00000000-0000-0000-0000-000000000000', fileIds: [] }), { code: 'STALE_PLAN' });
  } finally { fs.lstat = original; await service?.closeOperationResources(); }
});
