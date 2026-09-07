const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ProgressParser, runTool } = require('../src/process-runner.cjs');

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
