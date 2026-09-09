'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { StorageEligibility } = require('../src/storage-eligibility.cjs');
const { readFileStamp } = require('../src/source-identity.cjs');

const windows = { skip: process.platform !== 'win32' };
async function fixture(t) {
  const base = path.resolve(__dirname, '..', 'artifacts');
  await fs.mkdir(base, { recursive: true });
  const directory = await fs.mkdtemp(path.join(base, 'storage-test-'));
  const file = path.join(directory, "filename '$(& echo x).mkv");
  await fs.writeFile(file, 'fixture');
  t.after(async () => {
    assert.equal(path.dirname(directory), base);
    assert.ok(path.basename(directory).startsWith('storage-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { file, stamp: await readFileStamp(file) };
}
function answer(options, extra = {}) {
  return { stdout: JSON.stringify({ root: JSON.parse(options.input).root, driveType: 'Fixed', isReady: true, format: 'NTFS', ...extra }), stderr: '' };
}

test('helper uses an absolute fixed executable, literal command and bounded stdin data, once per session volume', windows, async t => {
  const { file, stamp } = await fixture(t);
  let calls = 0;
  const helper = new StorageEligibility({ systemRoot: 'C:\\Windows', run: async (exe, args, options) => {
    calls++;
    assert.equal(exe.toLowerCase(), 'c:\\windows\\system32\\windowspowershell\\v1.0\\powershell.exe');
    assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
    assert.match(args[4], /\[Console\]::In\.ReadToEnd\(\)/);
    assert.match(args[4], /DriveInfo/);
    assert.ok(!args[4].includes(file));
    assert.ok(!args.includes('-ExecutionPolicy'));
    assert.deepEqual(JSON.parse(options.input), { root: path.parse(stamp.canonicalPath).root });
    assert.equal(options.timeoutMs, 5000);
    assert.equal(options.stdoutLimit, 8192);
    assert.equal(options.stderrLimit, 2048);
    return answer(options);
  } });
  assert.deepEqual(await helper.check(file, stamp), { eligible: true, reason: null });
  assert.equal((await helper.check(file, stamp)).eligible, true);
  assert.equal(calls, 1);
});

test('unsupported platform, UNC paths, missing identity and source changes do not invoke the helper', windows, async t => {
  const { file, stamp } = await fixture(t);
  const run = () => assert.fail('must not spawn');
  assert.equal((await new StorageEligibility({ platform: 'linux', run }).check(file, stamp)).eligible, false);
  const helper = new StorageEligibility({ run });
  assert.equal((await helper.check(file, { ...stamp, canonicalPath: '\\\\server\\share\\file.mkv' })).eligible, false);
  assert.equal((await helper.check(file, { ...stamp, ino: '0' })).eligible, false);
  await fs.appendFile(file, 'changed');
  assert.equal((await helper.check(file, stamp)).eligible, false);
});

test('mapped, removable, non-NTFS and unavailable drives remain uncached', windows, async t => {
  const { file, stamp } = await fixture(t);
  for (const extra of [{ driveType: 'Network' }, { driveType: 'Removable' }, { format: 'exFAT' }, { isReady: false }]) {
    const helper = new StorageEligibility({ run: async (_exe, _args, options) => answer(options, extra) });
    assert.equal((await helper.check(file, stamp)).eligible, false);
  }
});

test('malformed, conflicting and failed helper results are uncached without one retry per input', windows, async t => {
  const { file, stamp } = await fixture(t);
  for (const response of [
    async () => ({ stdout: '{broken', stderr: '' }),
    async (_exe, _args, options) => answer(options, { root: 'Z:\\' }),
    async (_exe, _args, options) => ({ ...answer(options), stderr: 'unexpected warning' }),
    async () => { throw Object.assign(new Error('timeout'), { code: 'TIMEOUT' }); },
  ]) {
    let calls = 0;
    const helper = new StorageEligibility({ run: async (...args) => { calls++; return response(...args); } });
    assert.equal((await helper.check(file, stamp)).eligible, false);
    assert.equal((await helper.check(file, stamp)).eligible, false);
    assert.equal(calls, 1);
  }
});

test('a mounted folder on a different device does not inherit root NTFS eligibility', windows, async t => {
  const { file, stamp } = await fixture(t);
  const original = fs.stat.bind(fs);
  t.mock.method(fs, 'stat', async (...args) => {
    const stat = await original(...args);
    if (args[0] === path.parse(stamp.canonicalPath).root) stat.dev += 1n;
    return stat;
  });
  assert.equal((await new StorageEligibility({ run: () => assert.fail('must not query mismatched root') }).check(file, stamp)).eligible, false);
});

test('source replacement during helper execution cannot create a reusable eligibility result', windows, async t => {
  const { file, stamp } = await fixture(t);
  const helper = new StorageEligibility({ run: async (_exe, _args, options) => { await fs.appendFile(file, 'changed'); return answer(options); } });
  assert.equal((await helper.check(file, stamp)).eligible, false);
  assert.equal(helper.memo.size, 0);
});

test('source disappearance after helper completion does not disable its whole volume for the session', windows, async t => {
  const { file, stamp } = await fixture(t);
  const helper = new StorageEligibility({ run: async (_exe, _args, options) => { await fs.unlink(file); return answer(options); } });
  assert.equal((await helper.check(file, stamp)).eligible, false);
  assert.equal(helper.memo.size, 0);
});

test('cancellation propagates and is never memoized as ordinary storage uncertainty', windows, async t => {
  const { file, stamp } = await fixture(t);
  const abort = new AbortController();
  const helper = new StorageEligibility({ run: async () => { abort.abort(); throw Object.assign(new Error('cancelled'), { code: 'CANCELLED' }); } });
  await assert.rejects(helper.check(file, stamp, { signal: abort.signal }), { code: 'CANCELLED' });
  assert.equal(helper.memo.size, 0);
  await assert.rejects(helper.check(file, stamp, { signal: abort.signal }), { code: 'CANCELLED' });
});

test('relative, UNC and traversing helper roots cannot become an executable search path', windows, async t => {
  const { file, stamp } = await fixture(t);
  for (const systemRoot of ['Windows', '\\\\server\\Windows', 'C:\\Windows\\..\\fake', 'C:\\Windows\n']) {
    const helper = new StorageEligibility({ systemRoot, run: () => assert.fail('must not execute a redirected root') });
    assert.equal((await helper.check(file, stamp)).eligible, false);
  }
});
