const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ProgressParser, runTool, boundedToolStderr } = require('../src/process-runner.cjs');

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kills = 0;
  child.kill = () => { child.kills++; return true; };
  return child;
}

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
