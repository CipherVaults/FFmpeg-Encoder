'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PINS, RUNTIME_ID, createAv1OperationRunner, createAv1ProportionalRunner, PROPORTIONAL_LIMITS } = require('./runtime-av1-operation.cjs');
function fake({ result, error, verify } = {}) {
  const events = [];
  const run = createAv1OperationRunner({ verify: verify || (async kind => events.push(`verify:${kind}`)),
    execute: async (file, args, options) => { events.push('execute'); if (error) throw error; return result || { exitCode: 0, file, args, options }; } });
  return { run, events };
}
test('operation runner uses the AV1 pair identity, never the earlier candidate', () => {
  assert.equal(PINS, require('./runtime-av1.cjs').PINS);
  assert.equal(RUNTIME_ID, require('./runtime-av1.cjs').RUNTIME_ID);
  assert.notEqual(RUNTIME_ID, require('./runtime-candidate.cjs').RUNTIME_ID);
});
test('checks full runtime verifier before and after successful child settlement', async () => {
  const h = fake();
  const result = await h.run(PINS.ffprobe.path, ['-version'], { timeoutMs: 1000 });
  assert.equal(result.options.timeoutMs, 1000);
  assert.deepEqual(h.events, ['verify:ffprobe', 'execute', 'verify:ffprobe']);
});
test('retains streamed evidence callbacks and both child observers', async () => {
  const events = [], child = {}, chunk = Buffer.from('evidence');
  const sink = async value => { assert.equal(value, chunk); events.push('sink'); };
  const output = () => events.push('bytes'), progress = () => events.push('progress');
  const run = createAv1OperationRunner({ verify: async () => {}, onChild: value => { assert.equal(value, child); events.push('owner'); },
    execute: async (_file, _args, options) => {
      assert.equal(options.onStdoutChunk, sink); assert.equal(typeof options.onOutputBytes, 'function');
      assert.equal(options.onProgress, progress); assert.equal(options.stdoutLimit, 128 * 1024 * 1024);
      options.onChild(child); await options.onStdoutChunk(chunk); options.onOutputBytes(8); options.onProgress({ ended: true });
      return { exitCode: 0 };
    } });
  await run(PINS.ffmpeg.path, ['-c:v:0', 'libx265'], { timeoutMs: 120000, stdoutLimit: 128 * 1024 * 1024,
    onStdoutChunk: sink, onOutputBytes: output, onProgress: progress, onChild: () => events.push('request') });
  assert.deepEqual(events, ['owner', 'request', 'sink', 'bytes', 'progress']);
});
test('progress-mode stdout accounting remains active without a caller byte observer', async () => {
  const h = fake();
  const result = await h.run(PINS.ffmpeg.path, ['-progress', 'pipe:1'], {
    timeoutMs: 1000, stdoutLimit: 64, onProgress() {},
  });
  assert.equal(typeof result.options.onOutputBytes, 'function');
  assert.equal(result.options.stdoutLimit, 64);
  assert.doesNotThrow(() => result.options.onOutputBytes({ stream: 'stdout', bytes: 65 }));
});
test('rejects path substitution and malformed arguments before any verification', async () => {
  const h = fake();
  for (const file of ['/usr/bin/ffmpeg', 'ffmpeg', require('./runtime-candidate.cjs').PINS.ffmpeg.path])
    await assert.rejects(h.run(file, [], { timeoutMs: 1 }), { code: 'LINUX_AV1_OPERATION_INVOCATION' });
  for (const args of [null, ['bad\0arg'], [1], new Array(1), ['x'.repeat(16385)], Array(513).fill('x')])
    await assert.rejects(h.run(PINS.ffmpeg.path, args, { timeoutMs: 1 }), { code: 'LINUX_AV1_OPERATION_INVOCATION' });
  assert.deepEqual(h.events, []);
});
test('rejects loader, process and unbounded options before any verification', async () => {
  const h = fake();
  for (const options of [null, {}, { timeoutMs: 0 }, { timeoutMs: -1 }, { timeoutMs: 120001 },
    { timeoutMs: Infinity }, { timeoutMs: 1.5 }, { timeoutMs: 1, env: {} }, { timeoutMs: 1, shell: false },
    { timeoutMs: 1, cwd: '/tmp' }, { timeoutMs: 1, stdoutLimit: 128 * 1024 * 1024 + 1 },
    { timeoutMs: 1, stderrLimit: 256 * 1024 + 1 }, { timeoutMs: 1, onStdoutChunk: 'sink' },
    { timeoutMs: 1, onChild: true }, { timeoutMs: 1, signal: {} }, Object.create({ timeoutMs: 1 })])
    await assert.rejects(h.run(PINS.ffmpeg.path, [], options), { code: 'LINUX_AV1_OPERATION_OPTIONS' });
  assert.deepEqual(h.events, []);
});
test('rejects accessor arguments and options without evaluating them', async () => {
  const h = fake(), args = [], options = { timeoutMs: 1 };
  Object.defineProperty(args, '0', { get() { assert.fail('argument getter executed'); } });
  Object.defineProperty(options, 'onProgress', { enumerable: true, get() { assert.fail('option getter executed'); } });
  await assert.rejects(h.run(PINS.ffmpeg.path, args, { timeoutMs: 1 }), { code: 'LINUX_AV1_OPERATION_INVOCATION' });
  await assert.rejects(h.run(PINS.ffmpeg.path, [], options), { code: 'LINUX_AV1_OPERATION_OPTIONS' });
  assert.deepEqual(h.events, []);
});
test('GPU execution is refused while existing CPU codecs remain available', async () => {
  const h = fake();
  for (const args of [['-c:v:0', 'hevc_nvenc'], ['-codec:v', 'h264_qsv'], ['-vcodec', 'av1_amf'],
    ['-hwaccel', 'cuda'], ['-hwaccel_output_format', 'cuda'], ['-init_hw_device', 'vulkan'], ['-filter_hw_device', 'gpu']])
    await assert.rejects(h.run(PINS.ffmpeg.path, args, { timeoutMs: 1 }), { code: 'LINUX_AV1_OPERATION_GPU_UNTESTED' });
  assert.deepEqual(h.events, []);
  for (const codec of ['copy', 'ffv1', 'libx264', 'libx265', 'libsvtav1'])
    await h.run(PINS.ffmpeg.path, ['-c:v:0', codec], { timeoutMs: 1 });
});
test('pre-aborted call never spawns and verifier failure has no fallback', async () => {
  const h = fake(), controller = new AbortController(); controller.abort();
  await assert.rejects(h.run(PINS.ffmpeg.path, [], { timeoutMs: 1, signal: controller.signal }), { code: 'CANCELLED' });
  assert.deepEqual(h.events, ['verify:ffmpeg']);
  const f = fake({ verify: async () => { throw Object.assign(new Error('codec changed'), { code: 'DEPENDENCY_CHANGED' }); } });
  await assert.rejects(f.run(PINS.ffmpeg.path, [], { timeoutMs: 1 }), { code: 'DEPENDENCY_CHANGED' });
  assert.deepEqual(f.events, []);
});
test('cancellation, timeout and sink failures remain errors after post-verification', async () => {
  for (const code of ['CANCELLED', 'TIMEOUT', 'STDOUT_SINK_FAILED']) {
    const h = fake({ error: Object.assign(new Error(code), { code }) });
    await assert.rejects(h.run(PINS.ffmpeg.path, [], { timeoutMs: 1 }), { code });
    assert.deepEqual(h.events, ['verify:ffmpeg', 'execute', 'verify:ffmpeg']);
  }
});
test('post-run integrity failure retains both errors when the process also fails', async () => {
  for (const failed of [false, true]) {
    let checks = 0;
    const h = fake({ verify: async () => { if (++checks === 2) throw Object.assign(new Error('changed'), { code: 'CHANGED' }); },
      ...(failed ? { error: Object.assign(new Error('sink failed'), { code: 'STDOUT_SINK_FAILED' }) } : {}) });
    await assert.rejects(h.run(PINS.ffprobe.path, [], { timeoutMs: 1 }), error => {
      assert.equal(error.code, failed ? 'LINUX_AV1_OPERATION_CHANGED_AFTER_FAILURE' : 'CHANGED');
      if (failed) { assert.equal(error.cause.code, 'STDOUT_SINK_FAILED'); assert.deepEqual(error.postVerificationFailure, { code: 'CHANGED', message: 'changed' }); }
      return true;
    });
  }
});
test('invocation values cannot be changed during asynchronous verification', async () => {
  const args = ['-version'], options = { timeoutMs: 1000 };
  const h = fake({ verify: async () => { args[0] = '-bad'; options.timeoutMs = 0; } });
  const result = await h.run(PINS.ffmpeg.path, args, options);
  assert.deepEqual(result.args, ['-version']); assert.equal(result.options.timeoutMs, 1000);
});
test('process results are not promoted to operation or publication acceptance', async () => {
  const result = { exitCode: 3, stderr: 'failed' }, h = fake({ result });
  assert.equal(await h.run(PINS.ffmpeg.path, [], { timeoutMs: 1 }), result);
  assert.deepEqual(h.events, ['verify:ffmpeg', 'execute', 'verify:ffmpeg']);
});
test('separate proportional runner accepts bounded derived resources without widening the original runner', async () => {
  const events = [], options = { timeoutMs: 120001, stdoutLimit: 128 * 1024 * 1024 + 1, onProgress() {} };
  const execute = async (_file, _args, actual) => {
    events.push('execute'); assert.equal(actual.timeoutMs, options.timeoutMs);
    assert.equal(actual.stdoutLimit, options.stdoutLimit); assert.equal(typeof actual.onOutputBytes, 'function');
    return { exitCode: 0 };
  };
  const run = createAv1ProportionalRunner({ verify: async kind => events.push(kind), execute });
  await run(PINS.ffmpeg.path, ['-c:v:0', 'libx265'], options);
  assert.deepEqual(events, ['ffmpeg', 'execute', 'ffmpeg']);
  await assert.rejects(createAv1OperationRunner({ verify: async () => {}, execute })(PINS.ffmpeg.path, [], options),
    { code: 'LINUX_AV1_OPERATION_OPTIONS' });
  assert.deepEqual(PROPORTIONAL_LIMITS, { timeoutMs: 2147483647, stdoutLimit: 1024 * 1024 * 1024, stderrLimit: 256 * 1024 });
});
test('proportional runner still refuses unbounded resources and unknown options before launch', async () => {
  let launches = 0;
  const run = createAv1ProportionalRunner({ verify: async () => {}, execute: async () => { launches++; } });
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 2147483648 }, { timeoutMs: Infinity },
    { timeoutMs: 1, stdoutLimit: 1024 * 1024 * 1024 + 1 }, { timeoutMs: 1, stderrLimit: 256 * 1024 + 1 },
    { timeoutMs: 1, env: {} }, { timeoutMs: 1, resourcePolicy: 'untrusted' }])
    await assert.rejects(run(PINS.ffmpeg.path, [], options), { code: 'LINUX_AV1_OPERATION_OPTIONS' });
  assert.equal(launches, 0);
});
