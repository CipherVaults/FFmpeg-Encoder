const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { ProgressParser, runTool, boundedToolStderr } = require('../src/process-runner.cjs');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = 0;
  child.kill = () => { child.kills++; return true; };
  return child;
}

test('explicit pipe accounting observes progress and truncated stderr bytes independently of text retention', async () => {
  const child = fakeChild(), observed = [];
  const promise = runTool('fixed.exe', [], { spawnImpl: () => child, onProgress() {},
    stdoutLimit: 1024, stderrLimit: 4, onOutputBytes: record => observed.push(record) });
  const progress = Buffer.from('out_time_us=1234\nprogress=end\n');
  const stderr = Buffer.from('diagnostic tail');
  child.stdout.emit('data', progress); child.stderr.emit('data', stderr); child.emit('close', 0);
  const result = await promise;
  assert.deepEqual(observed, [{ stream: 'stdout', bytes: progress.length }, { stream: 'stderr', bytes: stderr.length }]);
  assert.equal(result.stderrCapture.totalBytes, stderr.length); assert.equal(result.stderrCapture.truncated, true);
});

test('qualified progress limit waits for close; ordinary progress retains its prior long-running behavior', async () => {
  const counted = fakeChild(); let settled = false;
  const work = runTool('fixed.exe', [], { spawnImpl: () => counted, onProgress() {}, stdoutLimit: 4,
    onOutputBytes() {} }).finally(() => { settled = true; });
  const rejected = assert.rejects(work, { code: 'OUTPUT_LIMIT' });
  counted.stdout.emit('data', Buffer.from('progress=end\n')); await Promise.resolve();
  assert.equal(settled, false); assert.equal(counted.kills, 1); counted.emit('close', 0); await rejected;
  const ordinary = fakeChild();
  const ordinaryWork = runTool('fixed.exe', [], { spawnImpl: () => ordinary, onProgress() {}, stdoutLimit: 4 });
  ordinary.stdout.emit('data', Buffer.from('progress=end\n')); ordinary.emit('close', 0);
  assert.equal((await ordinaryWork).exitCode, 0); assert.equal(ordinary.kills, 0);
});

test('progress retains split records, accepts unknown values, and separates blocks', () => {
  const records = [];
  const parser = new ProgressParser(record => records.push(record));
  for (const character of 'out_time_us=1500000\nfps=24\nspeed=2.0x\ntotal_size=1024\nprogress=continue\nout_time_us=N/A\nspeed=N/A\nprogress=end\n') parser.push(character);
  assert.equal(records.length, 2);
  assert.equal(records[0].seconds, 1.5);
  assert.equal(records[0].speed, 2);
  assert.equal(records[0].bytes, 1024);
  assert.equal(records[1].seconds, null);
  assert.equal(records[1].fps, null);
  assert.equal(records[1].ended, true);
});

test('abort retains ownership until child closes, even with success exit', async () => {
  const child = fakeChild();
  const abort = new AbortController();
  let settled = false;
  const promise = runTool('fixed.exe', [], { signal: abort.signal, spawnImpl: () => child }).finally(() => { settled = true; });
  const rejection = assert.rejects(promise, { code: 'CANCELLED' });
  abort.abort();
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(child.kills, 1);
  child.emit('close', 0);
  await rejection;
});

for (const cancelled of [false, true]) test(`closed child retains its actual signal after ${cancelled ? 'cancellation' : 'abnormal exit'}`, async () => {
  const child = fakeChild(), abort = new AbortController();
  const pending = runTool('fixed.exe', [], { signal: abort.signal, spawnImpl: () => child });
  const rejected = assert.rejects(pending, { code: cancelled ? 'CANCELLED' : 'TOOL_FAILED', exitCode: null, exitSignal: 'SIGTERM' });
  if (cancelled) abort.abort();
  child.emit('close', null, 'SIGTERM');
  await rejected;
});

test('spawn failure is caught and settles after close', async () => {
  const child = fakeChild();
  const promise = runTool('missing.exe', [], { spawnImpl: () => child });
  const rejection = assert.rejects(promise, { code: 'SPAWN_FAILED' });
  child.emit('error', new Error('ENOENT'));
  child.emit('close', -4058);
  await rejection;
});

test('output limit terminates owned child without resolving early', async () => {
  const child = fakeChild();
  const promise = runTool('fixed.exe', [], { stdoutLimit: 4, spawnImpl: () => child });
  const rejection = assert.rejects(promise, { code: 'OUTPUT_LIMIT' });
  child.stdout.emit('data', Buffer.from('too much output'));
  assert.equal(child.kills, 1);
  child.emit('close', 1);
  await rejection;
});

test('binary arguments are passed literally with shell disabled', async () => {
  const child = fakeChild();
  const promise = runTool('fixed.exe', ['a & b.mp4'], { spawnImpl: (exe, args, options) => {
    assert.equal(exe, 'fixed.exe');
    assert.deepEqual(args, ['a & b.mp4']);
    assert.equal(options.shell, false);
    assert.equal(options.windowsHide, true);
    return child;
  } });
  child.stdout.emit('data', Buffer.from('{"ok":true}'));
  child.emit('close', 0);
  assert.equal((await promise).stdout, '{"ok":true}');
});

test('bounded helper stdin is data, with literal arguments and no shell', async () => {
  const child = fakeChild();
  child.stdin = new EventEmitter();
  const data = JSON.stringify({ root: 'D:\\', literal: '$(do not execute)' });
  child.stdin.end = value => { assert.equal(value, data); };
  const promise = runTool('fixed-helper.exe', ['fixed code'], { input: data, spawnImpl: (_exe, _args, options) => {
    assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
    assert.equal(options.shell, false);
    return child;
  } });
  child.emit('close', 0);
  await promise;
});

test('invalid and oversized tool input reject before spawning', async () => {
  const spawnImpl = () => assert.fail('must not spawn');
  await assert.rejects(runTool('fixed.exe', [], { input: {}, spawnImpl }), { code: 'INVALID_INPUT' });
  await assert.rejects(runTool('fixed.exe', [], { input: Buffer.alloc(65537), spawnImpl }), { code: 'INPUT_LIMIT' });
});

test('stdin EPIPE terminates only the owned child and waits for close', async () => {
  const child = fakeChild();
  child.stdin = new EventEmitter();
  child.stdin.end = () => child.stdin.emit('error', Object.assign(new Error('closed pipe'), { code: 'EPIPE' }));
  let settled = false;
  const promise = runTool('fixed.exe', [], { input: 'data', spawnImpl: () => child }).finally(() => { settled = true; });
  const rejection = assert.rejects(promise, { code: 'PIPE_FAILED' });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(child.kills, 1);
  child.emit('close', 0);
  await rejection;
});

test('real child receives bounded UTF-8 input and closes cleanly', async () => {
  const value = JSON.stringify({ folder: 'العربية & literal' });
  const result = await runTool(process.execPath, ['-e', 'process.stdin.setEncoding("utf8");let data="";process.stdin.on("data",x=>data+=x);process.stdin.on("end",()=>process.stdout.write(data));'], { input: value });
  assert.equal(result.stdout, value);
});

test('cancelling a real stdin-fed child awaits its process exit', async () => {
  const abort = new AbortController();
  let owned;
  const promise = runTool(process.execPath, ['-e', 'process.stdin.resume();setInterval(()=>{},1000);'], {
    input: '{"root":"D:\\\\"}', signal: abort.signal,
    onChild: child => { owned = child; setImmediate(() => abort.abort()); },
  });
  await assert.rejects(promise, { code: 'CANCELLED' });
  assert.ok(owned);
  assert.throws(() => process.kill(owned.pid, 0), { code: 'ESRCH' });
});

test('successful stderr capture preserves UTF-8 split across arbitrary pipe chunks', async () => {
  const child = fakeChild();
  const text = 'alpha العربية 😀 終\n';
  const bytes = Buffer.from(text);
  const promise = runTool('fixed.exe', [], { stderrLimit: bytes.length, spawnImpl: () => child });
  for (const byte of bytes) child.stderr.emit('data', Buffer.from([byte]));
  child.emit('close', 0);
  const result = await promise;
  assert.equal(result.stderr, text);
  assert.deepEqual(result.stderrCapture, { totalBytes: bytes.length, truncated: false });
});

test('stderr retains a byte-bounded complete-code-point tail rather than a character-count suffix', async () => {
  for (const chunks of [[Buffer.from('prefix-ع😀終')], [...Buffer.from('prefix-ع😀終')].map(byte => Buffer.from([byte]))]) {
    const child = fakeChild();
    const promise = runTool('fixed.exe', [], { stderrLimit: 8, spawnImpl: () => child });
    for (const chunk of chunks) child.stderr.emit('data', chunk);
    child.emit('close', 0);
    const result = await promise;
    assert.equal(result.stderr, '😀終');
    assert.ok(Buffer.byteLength(result.stderr) <= 8);
    assert.deepEqual(result.stderrCapture, { totalBytes: Buffer.byteLength('prefix-ع😀終'), truncated: true });
  }
});

test('zero-byte capture and malformed UTF-8 remain bounded and truthfully truncated', async () => {
  for (const [stderrLimit, bytes, expected] of [[0, Buffer.from('anything'), ''], [4, Buffer.from([255, 255, 255]), '�']]) {
    const child = fakeChild();
    const promise = runTool('fixed.exe', [], { stderrLimit, spawnImpl: () => child });
    child.stderr.emit('data', bytes);
    child.emit('close', 0);
    const result = await promise;
    assert.equal(result.stderr, expected);
    assert.ok(Buffer.byteLength(result.stderr) <= stderrLimit);
    assert.deepEqual(result.stderrCapture, { totalBytes: bytes.length, truncated: true });
  }
});

for (const outcome of ['nonzero', 'abort', 'output-limit', 'pipe-error']) {
  test(`stderr capture survives ${outcome}, including bytes received before close`, async () => {
    const child = fakeChild();
    const abort = new AbortController();
    const promise = runTool('fixed.exe', [], { stderrLimit: 8, stdoutLimit: 1, signal: abort.signal, spawnImpl: () => child });
    const code = { nonzero: 'TOOL_FAILED', abort: 'CANCELLED', 'output-limit': 'OUTPUT_LIMIT', 'pipe-error': 'PIPE_FAILED' }[outcome];
    const rejection = assert.rejects(promise, error => {
      assert.equal(error.code, code);
      assert.equal(error.stderr, '😀終');
      assert.deepEqual(error.stderrCapture, { totalBytes: Buffer.byteLength('prefix-ع😀終'), truncated: true });
      return true;
    });
    child.stderr.emit('data', Buffer.from('prefix-ع'));
    if (outcome === 'abort') abort.abort();
    if (outcome === 'output-limit') child.stdout.emit('data', Buffer.from('too much'));
    if (outcome === 'pipe-error') child.stdout.emit('error', new Error('pipe broke'));
    child.stderr.emit('data', Buffer.from('😀終'));
    child.emit('close', outcome === 'nonzero' ? 1 : 0);
    await rejection;
  });
}

test('pre-spawn failures have an explicitly empty capture, and invalid bounds never spawn', async () => {
  const spawnImpl = () => assert.fail('must not spawn');
  const abort = new AbortController(); abort.abort();
  for (const options of [{ signal: abort.signal }, { input: {} }, { stderrLimit: -1 }, { stderrLimit: NaN }, { stderrLimit: 0.5 }]) {
    await assert.rejects(runTool('fixed.exe', [], { ...options, spawnImpl }), error => {
      assert.equal(error.stderr, '');
      assert.deepEqual(error.stderrCapture, { totalBytes: 0, truncated: false });
      return true;
    });
  }
  await assert.rejects(runTool('fixed.exe', [], { spawnImpl: () => { throw new Error('launch failed'); } }), error => {
    assert.equal(error.code, 'SPAWN_FAILED');
    assert.deepEqual(error.stderrCapture, { totalBytes: 0, truncated: false });
    return true;
  });
});

test('wrapper bounds preserve upstream byte counts and never invent complete capture for legacy errors', () => {
  const source = { stderr: 'ع😀終', stderrCapture: { totalBytes: 10000, truncated: true } };
  assert.deepEqual(boundedToolStderr(source, 8), { stderr: '😀終', stderrTruncated: true, stderrCapture: { totalBytes: 10000, truncated: true } });
  assert.deepEqual(boundedToolStderr({ stderr: 'legacy tail' }, 6), { stderr: 'y tail', stderrTruncated: true });
  assert.equal(source.stderr, 'ع😀終');
});

// A real Readable with an injected child exercises pause/resume without
// launching a helper process or media executable.
function streamingChild() {
  const child = fakeChild();
  child.stdout = new PassThrough();
  return child;
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('binary streaming preserves arbitrary bytes and reports complete byte accounting without text capture', async () => {
  const child = streamingChild();
  const observed = [];
  const promise = runTool('fixed.exe', [], { spawnImpl: () => child, stdoutLimit: 8,
    onStdoutChunk: chunk => { assert.ok(Buffer.isBuffer(chunk)); observed.push(Buffer.from(chunk)); } });
  child.stdout.write(Buffer.from([0, 255, 128, 0xc3]));
  child.stdout.write(Buffer.from([0xa9, 0, 13, 10]));
  await tick();
  child.emit('close', 0);
  const result = await promise;
  assert.deepEqual(Buffer.concat(observed), Buffer.from([0, 255, 128, 0xc3, 0xa9, 0, 13, 10]));
  assert.equal(result.stdout, '');
  assert.deepEqual(result.stdoutCapture, { totalBytes: 8, truncated: false, streamed: true });
});

test('binary streaming applies actual backpressure until the async sink drains', async () => {
  const child = streamingChild();
  const first = deferred(), second = deferred();
  const observed = [];
  let concurrent = 0, maximum = 0;
  const promise = runTool('fixed.exe', [], { spawnImpl: () => child, onStdoutChunk: async bytes => {
    observed.push(bytes.toString()); maximum = Math.max(maximum, ++concurrent);
    await (observed.length === 1 ? first.promise : second.promise); concurrent--;
  } });
  child.stdout.write(Buffer.from('one'));
  await tick();
  assert.equal(child.stdout.isPaused(), true);
  child.stdout.write(Buffer.from('two'));
  await tick();
  assert.deepEqual(observed, ['one']);
  first.resolve(); await tick();
  assert.deepEqual(observed, ['one', 'two']);
  assert.equal(child.stdout.isPaused(), true);
  assert.equal(maximum, 1);
  second.resolve(); await tick();
  assert.equal(child.stdout.isPaused(), false);
  child.emit('close', 0);
  assert.equal((await promise).stdoutCapture.totalBytes, 6);
});

test('binary streaming requires both child close and pending sink completion', async () => {
  const child = streamingChild(); const gate = deferred(); let settled = false;
  const promise = runTool('fixed.exe', [], { spawnImpl: () => child, onStdoutChunk: () => gate.promise })
    .finally(() => { settled = true; });
  child.stdout.write(Buffer.from([1, 2])); await tick();
  child.emit('close', 0); await tick();
  assert.equal(settled, false);
  gate.resolve();
  assert.deepEqual((await promise).stdoutCapture, { totalBytes: 2, truncated: false, streamed: true });
});

test('binary streaming finishes a synchronous sink but still waits for child close', async () => {
  const child = streamingChild(); let settled = false;
  const promise = runTool('fixed.exe', [], { spawnImpl: () => child, onStdoutChunk: () => {} })
    .finally(() => { settled = true; });
  child.stdout.write(Buffer.from('data')); await tick();
  assert.equal(settled, false);
  child.emit('close', 0); await promise;
});

for (const afterClose of [false, true]) {
  test(`binary streaming rejects sink failure ${afterClose ? 'after' : 'before'} child close`, async () => {
    const child = streamingChild(); const gate = deferred(); let settled = false;
    const promise = runTool('fixed.exe', [], { spawnImpl: () => child, onStdoutChunk: () => gate.promise })
      .finally(() => { settled = true; });
    const rejection = assert.rejects(promise, error => {
      assert.equal(error.code, 'STDOUT_SINK_FAILED');
      assert.equal(error.cause.message, 'sink failed');
      assert.deepEqual(error.stdoutCapture, { totalBytes: 3, truncated: true, streamed: true });
      return true;
    });
    child.stdout.write(Buffer.from([0, 255, 0])); await tick();
    if (afterClose) child.emit('close', 0);
    gate.reject(new Error('sink failed')); await tick();
    if (!afterClose) {
      assert.equal(settled, false); assert.equal(child.kills, 1); child.emit('close', 0);
    } else assert.equal(child.kills, 0);
    await rejection;
  });
}

test('binary streaming catches synchronous consumer throws and drains discarded pipe data', async () => {
  const child = streamingChild(); let calls = 0;
  const promise = runTool('fixed.exe', [], { spawnImpl: () => child, onStdoutChunk: () => {
    calls++; throw new Error('sync failure');
  } });
  const rejection = assert.rejects(promise, { code: 'STDOUT_SINK_FAILED' });
  child.stdout.write(Buffer.from('first')); child.stdout.write(Buffer.from('second')); await tick();
  assert.equal(calls, 1); assert.equal(child.kills, 1); assert.equal(child.stdout.isPaused(), false);
  child.emit('close', 0); await rejection;
});

test('binary streaming refuses the chunk crossing the total limit and preserves lost-byte evidence', async () => {
  const child = streamingChild(); const observed = [];
  const promise = runTool('fixed.exe', [], { stdoutLimit: 4, spawnImpl: () => child,
    onStdoutChunk: bytes => observed.push(Buffer.from(bytes)) });
  const rejection = assert.rejects(promise, error => {
    assert.equal(error.code, 'OUTPUT_LIMIT');
    assert.deepEqual(error.stdoutCapture, { totalBytes: 6, truncated: true, streamed: true }); return true;
  });
  child.stdout.write(Buffer.from([1, 2, 3])); await tick();
  child.stdout.write(Buffer.from([4, 5, 6])); await tick();
  assert.deepEqual(Buffer.concat(observed), Buffer.from([1, 2, 3])); assert.equal(child.kills, 1);
  child.emit('close', 0); await rejection;
});

for (const afterClose of [false, true]) {
  test(`binary streaming cancellation ${afterClose ? 'after' : 'before'} close waits for pending sink`, async () => {
    const child = streamingChild(); const gate = deferred(); const abort = new AbortController(); let settled = false;
    const promise = runTool('fixed.exe', [], { signal: abort.signal, spawnImpl: () => child, onStdoutChunk: () => gate.promise })
      .finally(() => { settled = true; });
    const rejection = assert.rejects(promise, { code: 'CANCELLED' });
    child.stdout.write(Buffer.from([1])); await tick();
    if (afterClose) child.emit('close', 0);
    abort.abort(); await tick(); assert.equal(settled, false);
    if (!afterClose) { assert.equal(child.kills, 1); child.emit('close', 0); }
    gate.resolve(); await rejection;
  });
}

test('binary streaming timeout while sink is pending retains ownership until close and drain', async () => {
  const child = streamingChild(); const gate = deferred(); let settled = false;
  const promise = runTool('fixed.exe', [], { timeoutMs: 5, spawnImpl: () => child, onStdoutChunk: () => gate.promise })
    .finally(() => { settled = true; });
  const rejection = assert.rejects(promise, { code: 'TIMEOUT' });
  child.stdout.write(Buffer.from('pending'));
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(child.kills, 1); assert.equal(settled, false);
  child.emit('close', 0); gate.resolve(); await rejection;
});

for (const pipe of ['stdout', 'stderr']) {
  test(`binary streaming ${pipe} failure terminates and waits for drain`, async () => {
    const child = streamingChild(); const gate = deferred(); let settled = false;
    const promise = runTool('fixed.exe', [], { spawnImpl: () => child, onStdoutChunk: () => gate.promise })
      .finally(() => { settled = true; });
    const rejection = assert.rejects(promise, { code: 'PIPE_FAILED' });
    child.stdout.write(Buffer.from('pending')); await tick();
    child[pipe].emit('error', new Error('broken')); child.emit('close', 0); await tick();
    assert.equal(settled, false); assert.equal(child.kills, 1);
    gate.resolve(); await rejection;
  });
}

test('binary streaming rejects invalid mode/bounds before spawn and records actual spawn failures', async () => {
  const spawnImpl = () => assert.fail('must not spawn');
  for (const options of [
    { onStdoutChunk: true }, { onStdoutChunk: () => {}, onProgress: () => {} },
    { onStdoutChunk: () => {}, stdoutLimit: -1 }, { onStdoutChunk: () => {}, stdoutLimit: Infinity },
  ]) await assert.rejects(runTool('fixed.exe', [], { ...options, spawnImpl }));
  await assert.rejects(runTool('fixed.exe', [], { onStdoutChunk: () => {}, spawnImpl: () => { throw new Error('missing'); } }), error => {
    assert.equal(error.code, 'SPAWN_FAILED');
    assert.deepEqual(error.stdoutCapture, { totalBytes: 0, truncated: false, streamed: true }); return true;
  });
  const child = streamingChild();
  const promise = runTool('fixed.exe', [], { onStdoutChunk: () => {}, spawnImpl: () => child });
  const rejection = assert.rejects(promise, { code: 'SPAWN_FAILED' });
  child.emit('error', new Error('missing')); assert.equal(child.kills, 1);
  child.emit('close', -1); await rejection;
});

test('binary streaming nonzero exits preserve complete stdout capture but never count as validation success', async () => {
  const child = streamingChild(); const gate = deferred();
  const promise = runTool('fixed.exe', [], { onStdoutChunk: () => gate.promise, spawnImpl: () => child });
  const rejection = assert.rejects(promise, error => {
    assert.equal(error.code, 'TOOL_FAILED'); assert.equal(error.exitCode, 2);
    assert.deepEqual(error.stdoutCapture, { totalBytes: 2, truncated: false, streamed: true }); return true;
  });
  child.stdout.write(Buffer.from([1, 2])); await tick(); child.emit('close', 2); gate.resolve(); await rejection;
});
