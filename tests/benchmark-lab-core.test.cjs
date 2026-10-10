'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const core = require('../scripts/benchmark-lab-core.cjs');

async function fixture(t) {
  const owned = path.resolve(__dirname, '..', 'artifacts');
  await fs.mkdir(owned, { recursive: true });
  const directory = await fs.mkdtemp(path.join(owned, 'benchmark-core-test-'));
  t.after(async () => {
    assert.equal(path.dirname(directory), owned);
    assert.ok(path.basename(directory).startsWith('benchmark-core-test-'));
    await fs.rm(directory, { recursive: true, force: true });
  });
  return directory;
}

test('identities are canonical, content-based and changed by meaningful fields', () => {
  const a = { quality: 29, preset: 'p7', options: { multipass: 'fullres', tune: 'uhq' } };
  const b = { options: { tune: 'uhq', multipass: 'fullres' }, preset: 'p7', quality: 29 };
  assert.equal(core.configurationId(a), core.configurationId(b));
  assert.notEqual(core.configurationId(a), core.configurationId({ ...a, quality: 30 }));
  assert.notEqual(core.windowId({ sourceId: 's', startPts: '4500000', count: 720 }), core.windowId({ sourceId: 's', startPts: '4500001', count: 720 }));
  assert.equal(core.sourceId('A'.repeat(64)), core.sourceId('a'.repeat(64)));
  assert.throws(() => core.sourceId('not-a-hash'), { code: 'INVALID_SOURCE_HASH' });
  assert.throws(() => core.canonicalJson({ bad: undefined }), { code: 'IDENTITY_NOT_JSON_SAFE' });
  assert.throws(() => core.canonicalJson({ bad: Infinity }), { code: 'IDENTITY_NOT_JSON_SAFE' });
  assert.throws(() => core.canonicalJson(Array(1)), { code: 'IDENTITY_NOT_JSON_SAFE' });
});

test('immutable records publish atomically and never replace existing evidence', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'result.json');
  await core.writeJsonExclusive(file, { value: 'first' });
  await assert.rejects(core.writeJsonExclusive(file, { value: 'replacement' }), { code: 'EEXIST' });
  assert.deepEqual(await core.readJson(file), { value: 'first' });
  const names = await fs.readdir(directory);
  assert.deepEqual(names, ['result.json']);
});

test('concurrent immutable publication has exactly one winner and whole JSON', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'result.json');
  const values = Array.from({ length: 8 }, (_, n) => ({ n, payload: String(n).repeat(500) }));
  const results = await Promise.allSettled(values.map(value => core.writeJsonExclusive(file, value)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const winner = await core.readJson(file);
  assert.ok(values.some(value => core.canonicalJson(value) === core.canonicalJson(winner)));
  assert.deepEqual(await fs.readdir(directory), ['result.json']);
});

test('atomic ledger replacement survives transient Windows denial without deleting valid state', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'ledger.json');
  await core.writeJsonExclusive(file, { accumulatedMs: 123 });
  const delays = []; let attempts = 0;
  await core.replaceJsonAtomic(file, { accumulatedMs: 456 }, {
    wait: async ms => delays.push(ms),
    rename: async (temporary, destination) => {
      assert.deepEqual(await core.readJson(destination), { accumulatedMs: 123 });
      assert.deepEqual(await core.readJson(temporary), { accumulatedMs: 456 });
      if (attempts++ < 2) throw Object.assign(new Error('sharing denial'), { code: 'EPERM' });
      await fs.rename(temporary, destination);
    },
  });
  assert.equal(attempts, 3); assert.deepEqual(delays, [20, 40]);
  assert.deepEqual(await core.readJson(file), { accumulatedMs: 456 });
  assert.deepEqual(await fs.readdir(directory), ['ledger.json']);
});

test('persistent or unrelated rename failures preserve the last valid ledger and fail boundedly', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'ledger.json');
  await core.writeJsonExclusive(file, { accumulatedMs: 123 });
  for (const code of ['EACCES', 'EINVAL']) {
    let attempts = 0; const delays = [];
    await assert.rejects(core.replaceJsonAtomic(file, { accumulatedMs: 456 }, {
      wait: async ms => delays.push(ms),
      rename: async () => { attempts++; throw Object.assign(new Error('denied'), { code }); },
    }), { code });
    assert.equal(attempts, code === 'EACCES' ? 7 : 1);
    assert.equal(delays.reduce((sum, n) => sum + n, 0), code === 'EACCES' ? 1260 : 0);
    assert.deepEqual(await core.readJson(file), { accumulatedMs: 123 });
    assert.deepEqual(await fs.readdir(directory), ['ledger.json']);
  }
});

test('transient ledger publication retries accrue once; exhausted publication catches up at end', async t => {
  const directory = await fixture(t);
  let sample = { wallMs: 10000, monotonicMs: 100 };
  let mode = 'success', attempts = 0;
  const ledger = core.createActiveTimeLedger(path.join(directory, 'ledger.json'), {
    limitMs: 10000, now: () => sample,
    atomicReplaceOptions: { wait: async () => {}, rename: async (from, to) => {
      attempts++;
      if (mode === 'exhausted' || mode === 'transient' && attempts < 3)
        throw Object.assign(new Error('sharing denial'), { code: 'EPERM' });
      await fs.rename(from, to);
    } },
  });
  await ledger.begin(); attempts = 0; mode = 'transient';
  sample = { wallMs: 11000, monotonicMs: 1100 };
  assert.equal((await ledger.heartbeat()).accumulatedMs, 1000);
  assert.equal(attempts, 3);
  sample = { wallMs: 12000, monotonicMs: 2100 }; mode = 'exhausted'; attempts = 0;
  await assert.rejects(ledger.heartbeat(), { code: 'EPERM' });
  assert.equal(attempts, 7);
  assert.equal((await ledger.snapshot()).accumulatedMs, 1000);
  mode = 'success'; sample = { wallMs: 13000, monotonicMs: 3100 };
  assert.equal((await ledger.end()).accumulatedMs, 3000);
  assert.deepEqual(await fs.readdir(directory), ['ledger.json']);
});

test('failure-state persistence cannot prevent stopping and awaiting an actual owned child', async t => {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: 'ignore' });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const closed = once(child, 'close'); const events = [];
  const original = new Error('ledger heartbeat denied');
  core.failClosedAccounting(original, {
    stopOwnedWork: error => { assert.equal(error, original); events.push('stop'); child.kill(); },
    persistFailure: () => { events.push('persist'); throw new Error('state rename denied'); },
    reportFailure: error => events.push(error.message),
  });
  await closed;
  assert.equal(core.defaultPidAlive(child.pid), false);
  assert.deepEqual(events, ['stop', 'persist', 'state rename denied']);
});

test('final accounting and lock release run even when heartbeat or ledger closure rejects', async () => {
  for (const endFails of [false, true]) {
    const events = [];
    await assert.rejects(core.finalizeAccounting({
      pendingHeartbeat: Promise.reject(new Error('heartbeat failed')),
      endInterval: async () => { events.push('end'); if (endFails) throw new Error('end failed'); },
      releaseLock: async () => { events.push('release'); },
    }), { message: endFails ? 'end failed' : 'heartbeat failed' });
    assert.deepEqual(events, ['end', 'release']);
  }
});

test('interrupted attempts stay incomplete; attempt and result paths cannot be reused', async t => {
  const directory = await fixture(t);
  const run = core.runId({ windowId: 'w', configurationId: 'c', runtimeHash: 'r' });
  const attempt = await core.createAttempt(directory, run, { attemptId: 'attempt-one' });
  assert.equal((await core.readJson(path.join(attempt.directory, 'attempt.json'))).status, 'incomplete');
  await assert.rejects(core.createAttempt(directory, run, { attemptId: 'attempt-one' }), { code: 'EEXIST' });
  await assert.rejects(core.createAttempt(directory, '../outside'), { code: 'INVALID_PATH_COMPONENT' });
  await assert.rejects(core.completeAttempt(attempt.directory, { runId: run, status: 'complete', validity: { valid: false } }), { code: 'INVALID_COMPLETION' });
  const resume = await core.inspectResume(await core.readJson(path.join(attempt.directory, 'attempt.json')), { sourceHash: 's', configurationHash: 'c', runtimeHash: 'r' });
  assert.equal(resume.accepted, false);
  await core.completeAttempt(attempt.directory, { runId: run, status: 'failed', validity: { valid: false }, stderr: 'explicit retained failure' });
  await assert.rejects(core.completeAttempt(attempt.directory, { runId: run, status: 'failed' }), { code: 'EEXIST' });
});

test('resume requires current source, configuration, runtime and actual output identity', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'candidate.bin');
  await fs.writeFile(file, 'synthetic fixture, not encoded media');
  const expected = { sourceHash: 'source-one', configurationHash: 'config-one', runtimeHash: 'runtime-one', windowId: 'window-one' };
  const record = { ...expected, status: 'complete', validity: { valid: true }, output: { path: file, bytes: (await fs.stat(file)).size, sha256: await core.sha256File(file) } };
  assert.equal((await core.inspectResume(record, expected)).accepted, true);
  for (const key of Object.keys(expected)) {
    const result = await core.inspectResume(record, { ...expected, [key]: 'changed' });
    assert.equal(result.accepted, false);
    assert.ok(result.reasons.includes(`${key}-mismatch`));
  }
  await fs.writeFile(file, 'Synthetic fixture, not encoded media'); // Same byte count, different content.
  assert.ok((await core.inspectResume(record, expected)).reasons.includes('output-hash-mismatch'));
});

test('live process lock rejects another owner; authoritative dead PID permits recovery', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'process.lock');
  const alive = new Set([101, 202]);
  const isPidAlive = pid => alive.has(pid);
  const first = await core.acquireOwnershipLock(file, { pid: 101, isPidAlive });
  await assert.rejects(core.acquireOwnershipLock(file, { pid: 202, isPidAlive }), { code: 'LOCK_LIVE' });
  alive.delete(101);
  const recovered = await core.acquireOwnershipLock(file, { pid: 202, isPidAlive });
  assert.notEqual(first.token, recovered.token);
  await assert.rejects(first.release(), { code: 'LOCK_CHANGED' });
  await recovered.release();
  await recovered.release();
  await assert.rejects(fs.stat(file), { code: 'ENOENT' });
});

test('corrupt ownership is never treated as a stale lock', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'process.lock');
  await fs.writeFile(file, '{broken');
  await assert.rejects(core.acquireOwnershipLock(file), { code: 'LOCK_UNCERTAIN' });
  assert.equal(await fs.readFile(file, 'utf8'), '{broken');
});

test('real child PID is respected while live and recovered only after close', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'real-child.lock');
  const moduleFile = require.resolve('../scripts/benchmark-lab-core.cjs');
  const child = spawn(process.execPath, ['-e', `
    const core = require(process.env.CORE_FILE);
    core.acquireOwnershipLock(process.env.LOCK_FILE).then(() => {
      process.stdout.write('ready\\n');
      setInterval(() => {}, 1000);
    }).catch(error => { process.stderr.write(String(error)); process.exit(1); });
  `], { env: { ...process.env, CORE_FILE: moduleFile, LOCK_FILE: file }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const closed = once(child, 'close');
  const [ready] = await once(child.stdout, 'data');
  assert.equal(String(ready).trim(), 'ready');
  const persisted = await core.readJson(file);
  assert.equal(persisted.pid, child.pid);
  await assert.rejects(core.acquireOwnershipLock(file), { code: 'LOCK_LIVE' });
  child.kill();
  await closed;
  const recovered = await core.acquireOwnershipLock(file);
  assert.equal(recovered.pid, process.pid);
  await recovered.release();
});

test('parent death never authorizes recovery while its real detached child survives', async t => {
  let childPid;
  const parent = spawn(process.execPath, ['-e', `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      detached: true, windowsHide: true, stdio: 'ignore'
    });
    child.unref();
    process.stdout.write(String(child.pid));
  `], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => {
    if (parent.exitCode === null && parent.signalCode === null) parent.kill();
    if (childPid && core.defaultPidAlive(childPid)) process.kill(childPid);
  });
  let stdout = '';
  parent.stdout.on('data', chunk => { stdout += chunk; });
  const [parentExit] = await once(parent, 'close');
  assert.equal(parentExit, 0);
  childPid = Number(stdout);
  assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
  assert.equal(core.defaultPidAlive(parent.pid), false);
  assert.equal(core.defaultPidAlive(childPid), true);
  const command = { sequence: 1, label: 'independent-child', parentPid: parent.pid, pid: childPid, status: 'running' };
  await assert.rejects(core.assertNoLiveRecordedChildren([command]), { code: 'RECORDED_CHILD_LIVE' });
  process.kill(childPid);
  const deadline = Date.now() + 5000;
  while (core.defaultPidAlive(childPid) && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  // Authoritative PID disappearance proves actual child termination; an
  // elapsed observation timeout alone would not permit interruption recovery.
  assert.equal(core.defaultPidAlive(childPid), false);
  const interrupted = await core.assertNoLiveRecordedChildren([command]);
  assert.equal(interrupted.length, 1);
  assert.equal(interrupted[0].status, 'interrupted');
  assert.equal(interrupted[0].interruptionReason, 'recorded-child-authoritatively-dead');
  assert.equal(Object.hasOwn(interrupted[0], 'code'), false);
  assert.equal(Object.hasOwn(interrupted[0], 'exitCode'), false);
  assert.equal(command.status, 'running'); // Evidence input is not mutated.
});

test('missing command PID is interrupted and terminal commands are not reclassified', async () => {
  const records = [
    { sequence: 1, status: 'running' },
    { sequence: 2, status: 'running', pid: 0, code: 0, exitCode: 0, signal: null },
    { sequence: 3, status: 'success', pid: process.pid, code: 0 },
  ];
  const interrupted = await core.assertNoLiveRecordedChildren(records);
  assert.equal(interrupted.length, 2);
  assert.ok(interrupted.every(record => record.status === 'interrupted' && record.interruptionReason === 'recorded-pid-missing'));
  assert.ok(interrupted.every(record => !Object.hasOwn(record, 'exitCode') && !Object.hasOwn(record, 'code')));
  await assert.rejects(core.assertNoLiveRecordedChildren([{ status: 'running', pid: 123 }], { isPidAlive: () => undefined }), { code: 'RECORDED_CHILD_UNKNOWN' });
});

test('active time persists across sessions and excludes a closed waiting interval', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'ledger.json');
  let sample = { wallMs: 1_000_000, monotonicMs: 5000 };
  const opts = { limitMs: 20_000, pid: 111, isPidAlive: () => true, now: () => sample };
  const first = core.createActiveTimeLedger(file, opts);
  await first.begin('pilot');
  sample = { wallMs: 1_004_000, monotonicMs: 9000 };
  assert.equal((await first.heartbeat()).accumulatedMs, 4000);
  sample = { wallMs: 1_005_000, monotonicMs: 10_000 };
  await first.end('awaiting-Ahmed');
  sample = { wallMs: 2_005_000, monotonicMs: 55 };
  const resumed = core.createActiveTimeLedger(file, opts);
  await resumed.begin('held-out');
  sample = { wallMs: 2_011_000, monotonicMs: 6055 };
  const closed = await resumed.end();
  assert.equal(closed.accumulatedMs, 11_000);
  assert.equal(closed.remainingMs, 9000);
  assert.equal(closed.intervals.length, 2);
  assert.equal(closed.intervals[0].reason, 'awaiting-Ahmed');
});

test('crash recovery requires dead owner and charges unknown time conservatively', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'ledger.json');
  let sample = { wallMs: 100_000, monotonicMs: 100 };
  let alive = true;
  const first = core.createActiveTimeLedger(file, { limitMs: 30_000, pid: 123, isPidAlive: () => alive, now: () => sample });
  await first.begin();
  sample = { wallMs: 102_000, monotonicMs: 2100 };
  await first.heartbeat();
  const resumed = core.createActiveTimeLedger(file, { limitMs: 30_000, pid: 456, isPidAlive: pid => pid === 123 && alive, now: () => sample });
  await assert.rejects(resumed.recoverDeadOwner(), { code: 'LEDGER_OWNER_LIVE' });
  alive = false;
  sample = { wallMs: 120_000, monotonicMs: 500 };
  const recovered = await resumed.recoverDeadOwner();
  assert.equal(recovered.accumulatedMs, 20_000);
  assert.equal(recovered.open, null);
  assert.equal(recovered.intervals[0].recovery.policy, 'conservative-wall-gap');
  assert.equal(recovered.intervals[0].recovery.withinHeartbeatBound, false);
});

test('evidenced terminal timestamp bounds crash tail without resetting the allowance', async t => {
  const directory = await fixture(t);
  const file = path.join(directory, 'ledger.json');
  let sample = { wallMs: 100_000, monotonicMs: 100 };
  const first = core.createActiveTimeLedger(file, { limitMs: 5000, pid: 123, isPidAlive: () => false, now: () => sample });
  await first.begin();
  sample = { wallMs: 102_000, monotonicMs: 2100 };
  await first.heartbeat();
  sample = { wallMs: 9_000_000, monotonicMs: 10 };
  const resumed = core.createActiveTimeLedger(file, { limitMs: 5000, pid: 456, isPidAlive: () => false, now: () => sample });
  await assert.rejects(resumed.recoverDeadOwner({ lastActiveWallMs: 103_000 }), { code: 'RECOVERY_EVIDENCE_REQUIRED' });
  const recovered = await resumed.recoverDeadOwner({ lastActiveWallMs: 103_000, evidence: 'Persisted child-close event at terminal timestamp.' });
  assert.equal(recovered.accumulatedMs, 3000);
  await resumed.begin();
  sample = { wallMs: 9_003_000, monotonicMs: 3010 };
  const over = await resumed.end();
  assert.equal(over.accumulatedMs, 6000);
  assert.equal(over.budgetExceeded, true);
  await assert.rejects(resumed.begin(), { code: 'ACTIVE_BUDGET_EXCEEDED' });
});

test('clock discontinuities fail closed and leave the last valid heartbeat intact', async t => {
  const directory = await fixture(t);
  let sample = { wallMs: 10_000, monotonicMs: 100 };
  const ledger = core.createActiveTimeLedger(path.join(directory, 'ledger.json'), { limitMs: 10_000, pid: 100, isPidAlive: () => true, clockToleranceMs: 100, now: () => sample });
  await ledger.begin();
  sample = { wallMs: 20_000, monotonicMs: 200 };
  await assert.rejects(ledger.heartbeat(), { code: 'CLOCK_INCONSISTENT' });
  const state = await ledger.snapshot();
  assert.equal(state.accumulatedMs, 0);
  assert.equal(state.open.lastSample.wallMs, 10_000);
});

test('growth and free-space reservations fail before planned work', async t => {
  const directory = await fixture(t);
  await fs.mkdir(path.join(directory, 'nested'));
  await fs.writeFile(path.join(directory, 'nested', 'bytes.bin'), Buffer.alloc(32));
  assert.equal(await core.directoryBytes(directory), 32);
  const options = { campaignRoot: directory, workspacePath: directory, maxGrowthBytes: 64, minFreeBytes: 0, additionalBytes: 16 };
  assert.equal((await core.assertResourceEnvelope(options)).growthBytes, 32);
  await assert.rejects(core.assertResourceEnvelope({ ...options, additionalBytes: 33 }), { code: 'CAMPAIGN_GROWTH_EXCEEDED' });
  await assert.rejects(core.assertResourceEnvelope({ ...options, minFreeBytes: Number.MAX_SAFE_INTEGER }), { code: 'FREE_SPACE_FLOOR' });
});

test('growth scan tolerates only the root heartbeat temporary being atomically renamed', async t => {
  const directory = await fixture(t);
  const name = '.active-time.json.16055ef4-c4ea-4002-b75c-09ac4c36d800.tmp';
  const temporary = path.join(directory, name), ledger = path.join(directory, 'active-time.json');
  await fs.writeFile(ledger, Buffer.alloc(32)); await fs.writeFile(temporary, Buffer.alloc(32));
  let renamed = false;
  const bytes = await core.directoryBytes(directory, { lstat: async file => {
    if (file === temporary) { await fs.rename(temporary, ledger); renamed = true; }
    return fs.lstat(file);
  } });
  assert.equal(renamed, true); assert.equal(bytes, 32);
  const lost = path.join(directory, 'video.mkv'); await fs.writeFile(lost, 'media');
  const missing = Object.assign(new Error('lost'), { code: 'ENOENT' });
  await assert.rejects(core.directoryBytes(directory, { lstat: file => file === lost ? Promise.reject(missing) : fs.lstat(file) }), { code: 'ENOENT' });
  await fs.mkdir(path.join(directory, 'nested'));
  const nested = path.join(directory, 'nested', name); await fs.writeFile(nested, 'not-ledger');
  await assert.rejects(core.directoryBytes(directory, { lstat: file => file === nested ? Promise.reject(missing) : fs.lstat(file) }), { code: 'ENOENT' });
});
