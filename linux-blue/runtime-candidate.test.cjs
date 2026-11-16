'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PINS, createCandidateRunner } = require('./runtime-candidate.cjs');
function fake({ result, error } = {}) {
  const events = [];
  const run = createCandidateRunner({ verify: async kind => events.push(`verify:${kind}`),
    execute: async (file, args, options) => { events.push('execute'); if (error) throw error; return result || { exitCode: 0, options }; } });
  return { run, events };
}
test('candidate runner verifies exact selected artifact before and after child settlement', async () => {
  const h = fake();
  await h.run(PINS.ffmpeg.path, ['-version'], { timeoutMs: 1000 });
  assert.deepEqual(h.events, ['verify:ffmpeg', 'execute', 'verify:ffmpeg']);
  const failure = Object.assign(new Error('synthetic child failure'), { code: 'SYNTHETIC' }), f = fake({ error: failure });
  await assert.rejects(f.run(PINS.ffprobe.path, ['-version'], { timeoutMs: 1000 }), { code: 'SYNTHETIC' });
  assert.deepEqual(f.events, ['verify:ffprobe', 'execute', 'verify:ffprobe']);
});
test('candidate runner refuses other executables, malformed options and unbounded budgets before launch', async () => {
  const h = fake();
  await assert.rejects(h.run('/usr/bin/ffmpeg', [], { timeoutMs: 1000 }), { code: 'LINUX_CANDIDATE_INVOCATION' });
  for (const options of [{}, { timeoutMs: 0 }, { timeoutMs: 120001 }, { timeoutMs: 1, env: {} },
    { timeoutMs: 1, stdoutLimit: 128 * 1024 * 1024 + 1 }, { timeoutMs: 1, stderrLimit: 256 * 1024 + 1 },
    { timeoutMs: 1, onStdoutChunk: 'callback' }, { timeoutMs: 1, signal: {} }]) {
    await assert.rejects(h.run(PINS.ffmpeg.path, [], options), { code: 'LINUX_CANDIDATE_OPTIONS' });
  }
  await assert.rejects(h.run(PINS.ffmpeg.path, ['bad\0arg'], { timeoutMs: 1 }), { code: 'LINUX_CANDIDATE_INVOCATION' });
  assert.deepEqual(h.events, []);
});
test('candidate runner preserves bounded streaming callbacks and cancellation prevents spawn', async () => {
  const h = fake(), sink = async () => {}, observe = () => {};
  const result = await h.run(PINS.ffprobe.path, [], { timeoutMs: 120000, onStdoutChunk: sink, onOutputBytes: observe });
  assert.equal(result.options.onStdoutChunk, sink); assert.equal(result.options.onOutputBytes, observe);
  const c = fake(), controller = new AbortController(); controller.abort();
  await assert.rejects(c.run(PINS.ffmpeg.path, [], { timeoutMs: 1, signal: controller.signal }), { code: 'CANCELLED' });
  assert.deepEqual(c.events, ['verify:ffmpeg']);
});
test('candidate verification failure refuses execution and never substitutes the baseline', async () => {
  let calls = 0;
  const run = createCandidateRunner({ verify: async () => { throw Object.assign(new Error('candidate changed'), { code: 'CANDIDATE_CHANGED' }); },
    execute: async () => { calls++; } });
  await assert.rejects(run(PINS.ffmpeg.path, [], { timeoutMs: 1 }), { code: 'CANDIDATE_CHANGED' });
  assert.equal(calls, 0);
});
test('candidate runner retains child failure alongside a failed post-run integrity check', async () => {
  let checks = 0;
  const run = createCandidateRunner({ verify: async () => { if (++checks === 2) throw Object.assign(new Error('bytes changed'), { code: 'CHANGED' }); },
    execute: async () => { throw Object.assign(new Error('sink failed'), { code: 'STDOUT_SINK_FAILED' }); } });
  await assert.rejects(run(PINS.ffmpeg.path, [], { timeoutMs: 1000 }), error => {
    assert.equal(error.code, 'LINUX_CANDIDATE_CHANGED_AFTER_FAILURE');
    assert.equal(error.cause.code, 'STDOUT_SINK_FAILED');
    assert.deepEqual(error.postVerificationFailure, { code: 'CHANGED', message: 'bytes changed' });
    return true;
  });
});
