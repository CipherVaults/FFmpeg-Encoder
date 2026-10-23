'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { DiagnosticJournal, NAMESPACE, LIMITS } = require('../src/diagnostics.cjs');
const parent = path.resolve(__dirname, '../artifacts/diagnostics-tests');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture(t, options = {}) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'run-'));
  t.after(async () => {
    const actual = await fs.realpath(root), allowed = await fs.realpath(parent);
    if (!actual.startsWith(allowed + path.sep) || !path.basename(actual).startsWith('run-')) throw new Error('Unsafe fixture cleanup.');
    await fs.rm(actual, { recursive: true });
  });
  const app = path.join(root, 'app'); await fs.mkdir(app);
  const directory = path.join(app, NAMESPACE), events = path.join(directory, 'events'), stderr = path.join(directory, 'stderr');
  const open = overrides => new DiagnosticJournal({ directory: app, versions: { app: '0.7.0', ffmpeg: '9.0.1' }, ...options, ...overrides });
  const eventPath = id => path.join(events, id + '.json');
  return { root, app, directory, events, stderr, open, eventPath };
}
const event = (reason = 'OUTPUT_VALIDATED', context = {}) => ({ stage: 'validation', reason, context });

test('durable ordered transitions and bounded ID-based reads survive reopening', async t => {
  const h = await fixture(t), journal = h.open();
  const start = await journal.startSession(); assert.equal(start.persisted, true);
  const writes = await Promise.all(Array.from({ length: 12 }, (_, n) => journal.append({ ...event(), jobId: 'job-' + n, context: { count: n } })));
  assert.deepEqual(writes.map(r => r.sequence), Array.from({ length: 12 }, (_, n) => n + 1));
  assert.ok(writes.every(r => r.persisted));
  const end = await journal.closeSession({ outcome: 'completed' }); assert.equal(end.persisted, true);
  const restored = h.open();
  const all = await restored.readSession(start.sessionId);
  assert.equal(all.session.outcome, 'completed'); assert.equal(all.session.events.length, 14);
  assert.equal(all.session.events[5].jobId, 'job-4');
  const page = await restored.readSession(start.sessionId, { limit: 3, afterSequence: 4 });
  assert.deepEqual(page.session.events.map(e => e.sequence), [5, 6, 7]); assert.equal(page.session.nextSequence, 7);
  assert.equal((await restored.list({ limit: 2 })).events.length, 2);
  assert.deepEqual(await fs.readdir(h.stderr), []);
  assert.ok((await fs.readdir(h.events)).every(n => n.endsWith('.json')));
  assert.equal((await journal.flush()).available, true);
});

test('opaque cursor visits all same-millisecond records across sessions without duplicates or gaps', async t => {
  const h = await fixture(t, { now: () => 123456 });
  for (let n = 0; n < 2; n++) {
    const journal = h.open(); await journal.startSession();
    await journal.append(event()); await journal.append(event()); await journal.closeSession();
  }
  const reader = h.open(), seen = []; let cursor;
  do {
    const page = await reader.list({ limit: 3, ...(cursor ? { cursor } : {}) });
    seen.push(...page.events.map(item => item.id)); cursor = page.nextCursor;
  } while (cursor);
  assert.equal(seen.length, 8); assert.equal(new Set(seen).size, 8);
  assert.deepEqual(new Set(seen), new Set((await reader.list({ limit: 200 })).events.map(item => item.id)));
  const first = await reader.list({ limit: 1 });
  assert.throws(() => reader.list({ cursor: first.nextCursor, before: 999999 }), /either/);
  assert.throws(() => reader.list({ cursor: 'C:\\secret\\file.json' }), /cursor/);
  assert.throws(() => reader.list({ cursor: Buffer.from(JSON.stringify([1, 0, '../path'])).toString('base64url') }), /cursor/);
  assert.throws(() => reader.list({ cursor: 'e30' }), /cursor/);
  assert.equal((await reader.list({ before: 123456 })).events.length, 0);
});

test('abandoned owner is recorded as interrupted without resuming or deleting work', async t => {
  const h = await fixture(t), first = h.open();
  const initial = await first.startSession();
  const last = await first.append({ stage: 'invocation', reason: 'CHILD_SPAWNED', context: { argv: ['-i', 'C:\\private\\original.mkv'] } });
  const next = h.open({ isOwnerAlive: () => false });
  const resumed = await next.startSession();
  assert.deepEqual(resumed.recovered, [{ sessionId: initial.sessionId, lastEventId: last.eventId }]);
  const prior = (await next.readSession(initial.sessionId)).session;
  assert.equal(prior.outcome, 'interrupted'); assert.equal(prior.events.at(-1).reason, 'SESSION_INTERRUPTED');
  assert.equal(prior.events.at(-1).context.lastEventId, last.eventId);
  assert.equal((await next.read(last.eventId)).event.reason, 'CHILD_SPAWNED');
});

test('live and uncertain previous owners are protected, including expired active sessions', async t => {
  let now = 100;
  const h = await fixture(t, { now: () => now, limits: { retentionMs: 100 } });
  const first = h.open(); const initial = await first.startSession();
  now = 1000;
  for (const answer of [true, null]) {
    const next = h.open({ isOwnerAlive: () => answer });
    const opened = await next.startSession();
    assert.deepEqual(opened.recovered, []);
    assert.equal((await next.readSession(initial.sessionId)).session.outcome, 'open');
    assert.ok(opened.status.notices.some(n => n.includes('protected')));
    await next.closeSession();
  }
});

test('cancellation and failed terminal outcomes remain distinguishable', async t => {
  const h = await fixture(t);
  for (const outcome of ['cancelled', 'failed']) {
    const journal = h.open(); const start = await journal.startSession();
    await journal.closeSession({ outcome });
    const last = (await journal.readSession(start.sessionId)).session.events.at(-1);
    assert.equal(last.outcome, outcome);
    assert.equal(last.severity, outcome === 'failed' ? 'error' : 'info');
  }
});

test('hostile and oversized context cannot execute accessors or exceed persisted bounds', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  let executed = false;
  const context = { metadata: '🟩'.repeat(40000), children: Array.from({ length: 400 }, () => ({ title: 'secret'.repeat(300) })) };
  context.self = context;
  Object.defineProperty(context, 'dangerous', { enumerable: true, get() { executed = true; throw new Error('must not run'); } });
  context.toJSON = () => { executed = true; return { bad: true }; };
  Object.defineProperty(context, '__proto__', { enumerable: true, value: { polluted: true } });
  const saved = await journal.append({ ...event(), context, message: 'm'.repeat(100000), stderr: 'prefix-' + '🟩'.repeat(100000) + '-last' });
  assert.equal(saved.persisted, true); assert.equal(executed, false);
  const disk = await fs.stat(h.eventPath(saved.eventId)); assert.ok(disk.size <= LIMITS.eventBytes);
  const read = (await journal.read(saved.eventId)).event;
  assert.equal(read.contextTruncated, true); assert.equal(read.messageTruncated, true);
  assert.equal(read.stderr.truncated, true); assert.ok(read.stderr.text.endsWith('-last'));
  assert.ok(Buffer.byteLength(read.stderr.text) <= LIMITS.stderrBytes);
  assert.equal(read.stderr.sha256, digest(read.stderr.text));
  assert.equal({}.polluted, undefined);
});

test('request contracts reject paths, unknown fields, getters, invalid stages and unbounded pagination', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  assert.throws(() => journal.read('..\\private.txt'), /UUID/);
  assert.throws(() => journal.append({ ...event(), filename: 'anything' }), /request fields/);
  assert.throws(() => journal.append({ ...event(), stage: 'random-process' }), /stage/);
  assert.throws(() => journal.append({ ...event(), reason: 'FILE\nFAKE' }), /stage/);
  assert.throws(() => journal.append({ ...event(), jobId: 'C:\\secret' }), /correlation/);
  assert.throws(() => journal.list({ limit: 201 }), /pagination/);
  assert.throws(() => journal.closeSession({ outcome: 'completed', path: 'evil' }), /request fields/);
  assert.throws(() => journal.buildRedactedExport({ eventIds: [randomUUID()], path: 'evil' }), /request fields/);
  assert.throws(() => journal.startSession({ get versions() { throw new Error('accessor executed'); } }), /request fields/);
  const missing = await journal.read(randomUUID()); assert.equal(missing.event, null);
  assert.equal(missing.status.lastFailure.code, 'DIAGNOSTIC_NOT_FOUND');
});

test('closed expired sessions rotate while active records are retained', async t => {
  let now = 100;
  const h = await fixture(t, { now: () => now, limits: { retentionMs: 100 } });
  const old = h.open(); const first = await old.startSession(); await old.append(event()); await old.closeSession();
  now = 1000;
  const current = h.open(); const active = await current.startSession();
  assert.equal((await current.readSession(first.sessionId)).session, null);
  assert.equal((await current.readSession(active.sessionId)).session.outcome, 'open');
  assert.equal((await fs.readdir(h.events)).length, 1);
});

test('storage pressure removes oldest closed sessions but cannot evict an active session', async t => {
  const h = await fixture(t, { limits: { bytes: 6000, eventBytes: 4096, stderrBytes: 3000 } });
  const first = h.open(); const old = await first.startSession();
  assert.equal((await first.append({ ...event(), stderr: 'a'.repeat(2800) })).persisted, true);
  assert.equal((await first.closeSession()).persisted, true);
  const current = h.open(); const opened = await current.startSession();
  assert.equal((await current.append({ ...event(), stderr: 'b'.repeat(2800) })).persisted, true);
  assert.equal((await current.readSession(old.sessionId)).session, null);
  const failed = await current.append({ ...event(), stderr: 'c'.repeat(2800) });
  assert.equal(failed.persisted, false); assert.equal(failed.status.lastFailure.code, 'DIAGNOSTIC_STORAGE_LIMIT');
  assert.equal((await current.readSession(opened.sessionId)).session.outcome, 'open');
  const bytes = (await Promise.all((await fs.readdir(h.events)).map(n => fs.stat(path.join(h.events, n))))).reduce((n, s) => n + s.size, 0)
    + (await Promise.all((await fs.readdir(h.stderr)).map(n => fs.stat(path.join(h.stderr, n))))).reduce((n, s) => n + s.size, 0);
  assert.ok(bytes <= 6000);
});

async function fillJournal(journal, request = event()) {
  const saved = [];
  for (let n = 0; n < 40; n++) {
    const result = await journal.append(request);
    if (!result.persisted) {
      assert.equal(result.status.lastFailure.code, 'DIAGNOSTIC_STORAGE_LIMIT');
      assert.ok(saved.length > 0, 'The fixture must exercise a useful active journal before capacity is refused.');
      return saved;
    }
    saved.push(result);
  }
  assert.fail('The bounded fixture should reach ordinary incident capacity.');
}

async function journalUsage(h) {
  let bytes = 0, entries = 0;
  for (const directory of [h.events, h.stderr]) {
    for (const name of await fs.readdir(directory)) {
      bytes += (await fs.stat(path.join(directory, name))).size; entries++;
    }
  }
  return { bytes, entries };
}

for (const pressure of ['bytes', 'entries']) {
  test(`${pressure} exhaustion reserves durable close capacity and permits restart without clearing active records`, async t => {
    const limits = pressure === 'bytes' ? { bytes: 6000, eventBytes: 4096, stderrBytes: 1000 }
      : { bytes: 100000, eventBytes: 4096, entries: 7 };
    const h = await fixture(t, { limits }), first = h.open();
    const opened = await first.startSession(); assert.equal(opened.persisted, true);
    const saved = await fillJournal(first, pressure === 'bytes' ? { ...event(), stderr: 'x'.repeat(750) } : event());
    // The ordinary append fails, but no active record is rotated to make room.
    for (const result of saved) assert.equal((await first.read(result.eventId)).event.reason, 'OUTPUT_VALIDATED');
    assert.equal((await first.closeSession()).persisted, true);
    const completed = (await first.readSession(opened.sessionId)).session;
    assert.equal(completed.outcome, 'completed');
    assert.ok(completed.events.at(-1).loggingGap.failures >= 1, 'A durable close must retain evidence of the refused incident.');
    const next = h.open(), restarted = await next.startSession();
    assert.equal(restarted.persisted, true);
    assert.equal((await next.append(event('AFTER_RESTART'))).persisted, true);
    assert.equal((await next.closeSession()).persisted, true);
    const usage = await journalUsage(h);
    assert.ok(usage.bytes <= limits.bytes); assert.ok(usage.entries <= (limits.entries || LIMITS.entries));
  });
}

test('quota-filled abandoned owner receives a durable interruption before bounded rotation and new startup', async t => {
  const h = await fixture(t, { limits: { bytes: 100000, eventBytes: 4096, entries: 7 } });
  const first = h.open(), opened = await first.startSession();
  const saved = await fillJournal(first);
  const last = saved.at(-1);
  let interruption;
  const io = { ...fs, link: async (temporary, final) => {
    await fs.link(temporary, final);
    // Observe the actual published closure before startup may rotate this now
    // closed session. This is real journal I/O, not a mocked durable success.
    if (path.dirname(final) === h.events) {
      const envelope = JSON.parse(await fs.readFile(final, 'utf8'));
      if (envelope.event.type === 'session-interrupted') interruption = envelope.event;
    }
  } };
  const next = h.open({ isOwnerAlive: () => false, io }), resumed = await next.startSession();
  assert.equal(resumed.persisted, true);
  assert.deepEqual(resumed.recovered, [{ sessionId: opened.sessionId, lastEventId: last.eventId }]);
  assert.equal(interruption.sessionId, opened.sessionId);
  assert.equal(interruption.outcome, 'interrupted'); assert.equal(interruption.context.lastEventId, last.eventId);
  assert.match(interruption.message, /unknown; no files or jobs were resumed/);
  assert.equal((await next.append(event('AFTER_RECOVERY'))).persisted, true);
  assert.equal((await next.closeSession()).persisted, true);
  assert.ok((await journalUsage(h)).entries <= 7);
});

for (const alive of [true, null]) {
  test(`quota recovery preserves unknown files and ${alive === true ? 'live' : 'uncertain'} owners`, async t => {
    const h = await fixture(t, { limits: { bytes: 100000, eventBytes: 4096, entries: 8 } });
    const active = h.open(), initial = await active.startSession();
    const prior = await fs.readFile(h.eventPath(initial.eventId));
    const unknown = path.join(h.events, 'preserve-unknown.tmp'); await fs.writeFile(unknown, 'private foreign evidence');
    const next = h.open({ isOwnerAlive: () => alive }), opened = await next.startSession();
    assert.equal(opened.persisted, true); assert.deepEqual(opened.recovered, []);
    await fillJournal(next);
    assert.equal((await next.closeSession()).persisted, true);
    const restart = h.open({ isOwnerAlive: () => alive }), resumed = await restart.startSession();
    assert.equal(resumed.persisted, true); assert.deepEqual(resumed.recovered, []);
    assert.equal((await restart.readSession(initial.sessionId)).session.outcome, 'open');
    assert.deepEqual(await fs.readFile(h.eventPath(initial.eventId)), prior);
    assert.equal(await fs.readFile(unknown, 'utf8'), 'private foreign evidence');
    assert.equal((await restart.closeSession()).persisted, true);
    assert.ok((await journalUsage(h)).entries <= 8);
  });
}

test('unknown files count against the budget and never become cleanup authority', async t => {
  const h = await fixture(t, { limits: { bytes: 5000, eventBytes: 4096 } });
  const journal = h.open(); await journal.startSession();
  const unknown = path.join(h.events, 'not-a-record.tmp'); await fs.writeFile(unknown, Buffer.alloc(4500, 1));
  const failed = await journal.append(event()); assert.equal(failed.persisted, false);
  assert.equal(failed.status.lastFailure.code, 'DIAGNOSTIC_STORAGE_LIMIT');
  assert.equal((await fs.stat(unknown)).size, 4500);
});

test('partial, corrupt and unsupported records are preserved and reported as incomplete', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession(); await journal.closeSession();
  const id = randomUUID(); await fs.writeFile(h.eventPath(id), '{partial');
  const temporary = path.join(h.events, randomUUID() + '.tmp'); await fs.writeFile(temporary, 'partial');
  const next = h.open(); const status = (await next.list()).status;
  assert.equal(status.incomplete, true); assert.equal(status.notices.length, 2);
  assert.equal(await fs.readFile(h.eventPath(id), 'utf8'), '{partial');
  assert.equal(await fs.readFile(temporary, 'utf8'), 'partial');
});

test('startup rejects foreign over-budget storage before reading event contents', async t => {
  const h = await fixture(t, { limits: { bytes: 5000, eventBytes: 4096 } });
  await fs.mkdir(h.events, { recursive: true }); await fs.mkdir(h.stderr);
  const foreign = path.join(h.stderr, 'preserve-unknown.txt'); await fs.writeFile(foreign, Buffer.alloc(5001));
  let opened = false;
  const io = { ...fs, open: async (...args) => { opened = true; return fs.open(...args); } };
  const result = await h.open({ io }).startSession();
  assert.equal(result.persisted, false); assert.equal(result.status.lastFailure.code, 'DIAGNOSTIC_STORAGE_LIMIT');
  assert.equal(opened, false); assert.equal((await fs.stat(foreign)).size, 5001);
});

test('foreign folders in the journal remain untouched and do not evade storage accounting', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const unknown = path.join(h.events, 'unknown-directory'); await fs.mkdir(unknown);
  await fs.writeFile(path.join(unknown, 'keep.txt'), 'untouched');
  const result = await journal.append(event());
  assert.equal(result.persisted, false); assert.equal(result.status.lastFailure.code, 'UNSAFE_DIAGNOSTIC_FILE');
  assert.equal(await fs.readFile(path.join(unknown, 'keep.txt'), 'utf8'), 'untouched');
});

test('altered event and stderr content cannot be silently treated as original evidence', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const a = await journal.append({ ...event(), stderr: 'original error' });
  await fs.writeFile(path.join(h.stderr, a.eventId + '.txt'), 'replacement');
  const tail = await journal.read(a.eventId); assert.equal(tail.event.stderr.unavailable, true);
  assert.equal(tail.status.incomplete, true);
  const envelope = JSON.parse(await fs.readFile(h.eventPath(a.eventId), 'utf8'));
  envelope.event.reason = 'FAKE_SUCCESS'; envelope.digest = digest(JSON.stringify(envelope.event));
  await fs.writeFile(h.eventPath(a.eventId), JSON.stringify(envelope));
  const changed = await journal.read(a.eventId); assert.equal(changed.event, null);
  assert.equal(changed.status.lastFailure.code, 'DIAGNOSTIC_FILE_CHANGED');
});

test('hard-linked diagnostic files are rejected without modifying either name', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const saved = await journal.append(event()), outside = path.join(h.root, 'preserved.json');
  await fs.link(h.eventPath(saved.eventId), outside);
  const read = await journal.read(saved.eventId); assert.equal(read.event, null);
  assert.equal(read.status.lastFailure.code, 'UNSAFE_DIAGNOSTIC_FILE');
  assert.equal((await fs.stat(outside)).nlink, 2);
  assert.equal((await h.open().list()).status.incomplete, true);
});

test('a reparse-point directory reported by lstat cannot redirect journal creation', async t => {
  const h = await fixture(t), outside = path.join(h.root, 'unrelated'); await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'preserve.txt'), 'untouched');
  // This Windows environment rejects creation of real test junctions with
  // UNKNOWN. Exercise the reparse decision explicitly without claiming an
  // OS-created junction fixture; the ordinary-directory replacement is real.
  await fs.mkdir(h.directory);
  const io = { ...fs, lstat: async filename => {
    const stat = await fs.lstat(filename);
    if (filename === h.directory) stat.isSymbolicLink = () => true;
    return stat;
  } };
  const result = await h.open({ io }).startSession();
  assert.equal(result.persisted, false); assert.equal(result.status.lastFailure.code, 'UNSAFE_DIAGNOSTIC_PATH');
  assert.deepEqual(await fs.readdir(outside), ['preserve.txt']);
  assert.deepEqual(await fs.readdir(h.directory), []);
});

test('replaced namespace identity blocks subsequent writes into a new ordinary directory', async t => {
  const h = await fixture(t), journal = h.open(); const start = await journal.startSession();
  const saved = path.join(h.app, 'saved-diagnostics'); await fs.rename(h.directory, saved); await fs.mkdir(h.directory);
  const result = await journal.append(event());
  assert.equal(result.persisted, false); assert.equal(result.status.lastFailure.code, 'DIAGNOSTIC_PATH_CHANGED');
  assert.deepEqual(await fs.readdir(h.directory), []);
  assert.equal((await fs.readdir(path.join(saved, 'events'))).length, 1);
  assert.equal(journal.snapshot().sessionId, start.sessionId);
});

test('publication and sync failures are truthful, preserve prior records, and allow explicit retry', async t => {
  const h = await fixture(t); let broken = true;
  const io = { ...fs, link: async (...args) => { if (broken) throw Object.assign(new Error('private path must not escape'), { code: 'EIO' }); return fs.link(...args); } };
  const journal = h.open({ io });
  const first = await journal.startSession(); assert.equal(first.persisted, false);
  assert.equal(first.status.lastFailure.code, 'EIO'); assert.ok(!JSON.stringify(first.status).includes('must not escape'));
  assert.equal((await journal.append(event())).status.lastFailure.code, 'DIAGNOSTIC_SESSION_NOT_PERSISTED');
  broken = false;
  const retry = await journal.startSession(); assert.equal(retry.persisted, true); assert.equal(retry.sessionId, first.sessionId);
  const good = await journal.append(event()); assert.equal(good.persisted, true);
  broken = true;
  assert.equal((await journal.closeSession()).persisted, false);
  assert.equal((await journal.read(good.eventId)).event.reason, 'OUTPUT_VALIDATED');
  broken = false; assert.equal((await journal.closeSession()).persisted, true);
  assert.equal(journal.snapshot().incomplete, true);
  assert.equal((await h.open().list()).status.incomplete, true);
});

test('failed file sync cannot publish a transition or leave a false successful start', async t => {
  const h = await fixture(t);
  const io = { ...fs, open: async (...args) => {
    const handle = await fs.open(...args);
    if (args[1] === 'wx') handle.sync = async () => { throw Object.assign(new Error('sync failed'), { code: 'EIO' }); };
    return handle;
  } };
  const journal = h.open({ io }); const start = await journal.startSession();
  assert.equal(start.persisted, false); assert.deepEqual(await fs.readdir(h.events), []);
  assert.equal((await journal.closeSession()).status.lastFailure.code, 'DIAGNOSTIC_SESSION_NOT_PERSISTED');
});

test('redacted exports omit free text, location metadata and device IDs with stable path aliases', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const secret = 'AhmedPrivate', input = 'C:\\Users\\' + secret + '\\capture.mkv';
  const one = await journal.append({ stage: 'invocation', reason: 'INVOCATION_FAILED', severity: 'error',
    message: 'Located at +30.0444+031.2357/ for ' + secret, stderr: 'GPS +30.0444+031.2357/ ' + input,
    context: { inputPath: input, encoder: 'hevc_nvenc', codec: 'hevc', GPS: '+30.0444+031.2357/',
      probe: { format: { tags: { 'com.apple.quicktime.location.ISO6709': '+30.0444+031.2357/' } },
        streams: [{ codec_name: 'hevc', width: 1920, height: 1080, tags: { location: secret } }] },
      identity: { dev: 991, ino: 992, sparseDigest: secret, ctimeNs: '12345' },
      argv: ['-i', input, '-c:v', 'hevc_nvenc', '-preset', 'p7', '-metadata', 'location=+30.0444+031.2357/', '-n', 'D:\\Output\\' + secret + '.mkv'] } });
  const two = await journal.append(event('SOURCE_VALIDATED', { inputPath: input.toUpperCase(), location: secret, preset: 'slow' }));
  const exported = await journal.buildRedactedExport({ eventIds: [one.eventId, two.eventId] });
  assert.ok(exported.data); assert.ok(!exported.json.includes(secret)); assert.ok(!exported.json.includes('30.0444'));
  assert.ok(!exported.json.includes('ISO6709')); assert.ok(!exported.json.includes('location='));
  assert.equal(exported.data.events[0].context.inputPath, '[PATH_001]');
  assert.equal(exported.data.events[1].context.inputPath, '[PATH_001]');
  assert.equal(exported.data.events[0].context.identity.dev, '[DEVICE_001]'); assert.equal(exported.data.events[0].context.identity.ino, '[FILE_001]');
  assert.equal(exported.data.events[0].context.argv.at(-1), '[PATH_002]');
  assert.equal(exported.data.events[0].context.encoder, 'hevc_nvenc');
  assert.ok((await journal.read(one.eventId)).event.stderr.text.includes(secret));
  assert.equal((await fs.readdir(h.directory)).length, 2); // No implicit export file or upload.
});

test('redacted source-change and disposition evidence preserves diagnosis without leaking private identity or locations', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const expected = { canonicalPath: 'F:\\PrivateFolder\\Original.mkv', dev: '872381929', ino: '972378199', size: '123456789',
    mtimeNs: '17777777777777', ctimeNs: '18888888888888', birthtimeNs: '16666666666666', sparseDigest: 'sha256-sparse-v1:' + 'a'.repeat(64) };
  const actual = { ...expected, ctimeNs: '19999999999999' };
  const diagnostic = { version: 1, stage: 'handle-to-path-after-sampling', checkpoint: 'after-encode', changedFields: ['ctimeNs'],
    expected, actual, comparison: 'sparse-identity' };
  const warning = { code: 'SOURCE_CTIME_ONLY', message: 'GPS +30.0444+031.2357/ private description' };
  const one = await journal.append({ ...event('SOURCE_ASSESSED'), batchId: 'private-batch-name', fileId: 'private-file-name', context: {
    sourceIdentityDiagnostic: diagnostic, sourceAssessment: { kind: 'ctime-only', diagnostic, warning },
    outputDisposition: { kind: 'retained-completed', published: false, validationCurrent: true, file: 'D:\\PrivateFolder\\staged.mkv' },
    cleanup: { retained: true, completed: true, validationCurrent: true, reason: 'PrivateFolder secret reason', directory: 'D:\\PrivateFolder' },
    warnings: [warning, '+30.0444+031.2357/'], status: 'success', outcome: 'saved-with-warning' } });
  const changed = { ...diagnostic, changedFields: ['ino', 'sparseDigest', 'untrusted +30.0444+031.2357/'],
    actual: { ...actual, ino: '18823176', sparseDigest: 'sha256-sparse-v1:' + 'b'.repeat(64) } };
  const two = await journal.append({ ...event('SOURCE_CHANGED'), fileId: 'private-file-name', context: {
    sourceAssessment: { kind: 'changed', reason: 'observed-source-change', diagnostic: changed },
    outputDisposition: { kind: 'retained-changed-stage', published: false, validationCurrent: false } } });
  const exported = await journal.buildRedactedExport({ eventIds: [one.eventId, two.eventId] });
  const [first, second] = exported.data.events;
  assert.equal(first.context.sourceAssessment.kind, 'ctime-only');
  assert.deepEqual(first.context.sourceIdentityDiagnostic.changedFields, ['ctimeNs']);
  assert.equal(first.context.sourceIdentityDiagnostic.stage, 'handle-to-path-after-sampling');
  assert.equal(first.context.sourceIdentityDiagnostic.checkpoint, 'after-encode');
  assert.equal(first.context.sourceIdentityDiagnostic.comparison, 'sparse-identity');
  const comparison = first.context.sourceIdentityDiagnostic;
  assert.equal(comparison.expected.ctimeNs, '18888888888888'); assert.equal(comparison.actual.ctimeNs, '19999999999999');
  assert.equal(comparison.expected.dev, comparison.actual.dev); assert.equal(comparison.expected.ino, comparison.actual.ino);
  assert.equal(comparison.expected.sparseDigest, comparison.actual.sparseDigest);
  assert.notEqual(second.context.sourceAssessment.diagnostic.expected.ino, second.context.sourceAssessment.diagnostic.actual.ino);
  assert.notEqual(second.context.sourceAssessment.diagnostic.expected.sparseDigest, second.context.sourceAssessment.diagnostic.actual.sparseDigest);
  assert.equal(first.context.outputDisposition.kind, 'retained-completed'); assert.equal(first.context.outputDisposition.validationCurrent, true);
  assert.deepEqual(first.context.warnings[0], { code: 'SOURCE_CTIME_ONLY' });
  assert.equal(first.fileId, second.fileId);
  assert.ok(!exported.json.includes('PrivateFolder')); assert.ok(!exported.json.includes('private-file-name'));
  assert.ok(!exported.json.includes('30.0444')); assert.ok(!exported.json.includes(expected.dev));
  assert.ok(!exported.json.includes(expected.sparseDigest));
});

test('export accepts only selected distinct IDs and does not use caller-provided filesystem authority', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const first = await journal.append(event('FIRST')), second = await journal.append(event('SECOND'));
  assert.throws(() => journal.buildRedactedExport({ eventIds: [first.eventId, first.eventId] }), /distinct/);
  assert.throws(() => journal.buildRedactedExport({ eventIds: ['C:\\anything.json'] }), /UUID/);
  const result = await journal.buildRedactedExport({ eventIds: [second.eventId] });
  assert.equal(result.data.events.length, 1); assert.equal(result.data.events[0].reason, 'SECOND');
  const missing = await journal.buildRedactedExport({ eventIds: [randomUUID()] }); assert.equal(missing.data, null);
});

test('initial mkdir failures can be retried after each partial initialization boundary', async t => {
  for (const destination of ['directory', 'events', 'stderr']) {
    const h = await fixture(t); let broken = true;
    const io = { ...fs, mkdir: async (...args) => {
      if (broken && args[0] === h[destination]) throw Object.assign(new Error('private startup location'), { code: 'EACCES' });
      return fs.mkdir(...args);
    } };
    const journal = h.open({ io });
    const failed = await journal.startSession();
    assert.equal(failed.persisted, false); assert.equal(failed.status.lastFailure.code, 'EACCES');
    assert.equal((await journal.append(event())).status.lastFailure.code, 'DIAGNOSTIC_SESSION_NOT_PERSISTED');
    broken = false;
    const started = await journal.startSession();
    assert.equal(started.persisted, true); assert.equal(started.sessionId, failed.sessionId);
    assert.equal(started.status.available, true); assert.equal(started.status.incomplete, true);
    const records = (await journal.readSession(started.sessionId)).session.events;
    assert.equal(records.length, 1); assert.equal(records[0].loggingGap.lastCode, 'DIAGNOSTIC_SESSION_NOT_PERSISTED');
    const exported = await journal.buildRedactedExport({ eventIds: [started.eventId] });
    assert.equal(exported.data.coverage.journalKnownIncomplete, true);
    assert.equal(exported.data.coverage.selectedCaptureComplete, false);
    assert.ok(!exported.json.includes('private startup location'));
  }
});

test('recovery bounds actual bytes when files grow after storage accounting and retries without a partial index', async t => {
  const h = await fixture(t, { limits: { eventBytes: 8192 } }), writer = h.open();
  const started = await writer.startSession();
  const first = await writer.append({ ...event('FIRST'), message: 'x'.repeat(1800) });
  const second = await writer.append({ ...event('SECOND'), message: 'y'.repeat(1800) });
  const third = await writer.append({ ...event('THIRD'), message: 'z'.repeat(1800) });
  await writer.closeSession();
  const reads = new Map();
  const io = { ...fs, lstat: async filename => {
    const stat = await fs.lstat(filename);
    if (path.dirname(filename) === h.events) {
      const count = (reads.get(filename) || 0) + 1; reads.set(filename, count);
      // Simulate the size race between accounting and opening each record,
      // without allocating a large adversarial tree or claiming OS races.
      if (count === 1) stat.size = 1;
    }
    return stat;
  } };
  const reader = h.open({ io, limits: { bytes: 5000, eventBytes: 8192 } });
  const failed = await reader.list();
  assert.deepEqual(failed.events, []); assert.equal(failed.status.lastFailure.code, 'DIAGNOSTIC_STORAGE_LIMIT');
  assert.equal((await fs.readdir(h.events)).length, 5);
  // Remove only exact fixture-owned events to resolve the simulated pressure.
  // A retry must not retain either deleted record from its failed scan.
  await fs.unlink(h.eventPath(first.eventId)); await fs.unlink(h.eventPath(second.eventId));
  const retried = await reader.list();
  assert.deepEqual(new Set(retried.events.map(e => e.id)), new Set([started.eventId, third.eventId,
    ...(await h.open().list()).events.filter(e => e.type === 'session-end').map(e => e.id)]));
});

test('exports distinguish truncation, missing stderr, intentional redaction and unrelated journal gaps', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const truncated = await journal.append({ ...event(), message: 'm'.repeat(10000),
    context: { reason: 'r'.repeat(10000) }, stderr: 's'.repeat(LIMITS.stderrBytes + 1) });
  const exported = await journal.buildRedactedExport({ eventIds: [truncated.eventId] });
  assert.deepEqual(exported.data.events[0].capture, { messageTruncated: true, contextTruncated: true,
    stderrTruncated: true, stderrUnavailable: false, stderrUpstreamUnknown: true, loggingGap: false, complete: false });
  assert.equal(exported.data.coverage.scope, 'selected-events-only');
  assert.equal(exported.data.coverage.selectedCaptureComplete, false);
  assert.equal(exported.data.coverage.intentionalPrivacyRedaction, true);
  assert.equal(exported.data.coverage.journalKnownIncomplete, false);
  const missing = await journal.append({ ...event('MISSING_STDERR'), stderr: 'private detail' });
  await fs.unlink(path.join(h.stderr, missing.eventId + '.txt'));
  const unavailable = await journal.buildRedactedExport({ eventIds: [missing.eventId] });
  assert.equal(unavailable.data.events[0].capture.stderrUnavailable, true);
  assert.equal(unavailable.data.coverage.selectedCaptureComplete, false);
  assert.equal(unavailable.data.coverage.journalKnownIncomplete, true);
  const intact = await journal.append(event('INTACT'));
  const subset = await journal.buildRedactedExport({ eventIds: [intact.eventId] });
  assert.equal(subset.data.coverage.selectedCaptureComplete, true);
  assert.equal(subset.data.coverage.journalKnownIncomplete, true);
  assert.equal(subset.data.coverage.selectedEvents, 1); assert.equal(subset.data.coverage.exportedEvents, 1);
  assert.ok(!unavailable.json.includes('private detail'));
});

test('ISO6709 location values cannot escape through allowlisted context or argument fields', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const location = '+30.0444+031.2357/';
  const saved = await journal.append(event('LOCATION_TEST', { reason: location, profile: 'GPS:30.0444',
    argv: ['-preset', location, '-metadata:s:v:0', 'location=' + location], codec: 'hevc', width: 1920 }));
  const exported = await journal.buildRedactedExport({ eventIds: [saved.eventId] });
  assert.equal(exported.data.events[0].context.reason, '[omitted]');
  assert.equal(exported.data.events[0].context.profile, '[omitted]');
  assert.equal(exported.data.events[0].context.codec, 'hevc');
  assert.ok(!exported.json.includes('30.0444')); assert.ok(!exported.json.includes('031.2357'));
});

test('export snapshots selected IDs and rejects accessors without executing them', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const first = await journal.append(event('FIRST')), second = await journal.append(event('SECOND'));
  const ids = [second.eventId], pending = journal.buildRedactedExport({ eventIds: ids });
  ids[0] = first.eventId;
  assert.equal((await pending).data.events[0].id, second.eventId);
  let executed = false;
  const hostile = [];
  Object.defineProperty(hostile, 0, { get() { executed = true; return first.eventId; } });
  assert.throws(() => journal.buildRedactedExport({ eventIds: hostile }), /plain list/);
  assert.equal(executed, false);
  const sparse = new Array(1); assert.throws(() => journal.buildRedactedExport({ eventIds: sparse }), /plain list/);
});

test('queued append snapshots stderr and malformed persisted completeness descriptors are preserved but refused', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const request = { ...event(), stderr: 'selected diagnostic detail' };
  const pending = journal.append(request); request.stderr = 'unselected private detail';
  const saved = await pending;
  assert.equal((await journal.read(saved.eventId)).event.stderr.text, 'selected diagnostic detail');
  for (const field of ['messageTruncated', 'contextTruncated']) {
    const id = randomUUID(), envelope = JSON.parse(await fs.readFile(h.eventPath(saved.eventId), 'utf8'));
    envelope.event.id = id; envelope.event[field] = '+30.0444+031.2357/';
    envelope.digest = digest(JSON.stringify(envelope.event));
    await fs.writeFile(h.eventPath(id), JSON.stringify(envelope));
    const restored = h.open(), all = await restored.list();
    assert.equal(all.status.incomplete, true); assert.ok(!all.events.some(e => e.id === id));
    assert.equal((await restored.buildRedactedExport({ eventIds: [id] })).data, null);
    assert.ok((await fs.stat(h.eventPath(id))).isFile());
  }
});

test('upstream stderr truncation and total byte counts survive reopening and privacy-safe export', async t => {
  const h = await fixture(t, { limits: { stderrBytes: 1000 } }), journal = h.open(); await journal.startSession();
  const privateTail = 'last private child detail';
  const capture = { totalBytes: 8000, truncated: true };
  const pending = journal.append({ ...event('UPSTREAM_TAIL'), stderr: privateTail, stderrCapture: capture });
  capture.totalBytes = 1; capture.truncated = false;
  const saved = await pending;
  const reopened = h.open(), read = (await reopened.read(saved.eventId)).event;
  assert.equal(read.stderr.text, privateTail); assert.equal(read.stderr.bytes, Buffer.byteLength(privateTail));
  assert.equal(read.stderr.truncated, true); assert.equal(read.stderr.totalBytes, 8000);
  const exported = await reopened.buildRedactedExport({ eventIds: [saved.eventId] });
  assert.equal(exported.data.coverage.selectedCaptureComplete, false);
  assert.equal(exported.data.events[0].capture.stderrTruncated, true);
  assert.equal(exported.data.events[0].stderr.totalBytes, 8000);
  assert.equal(exported.data.events[0].stderr.omitted, true); assert.ok(!exported.json.includes(privateTail));
  const full = 'y'.repeat(1100);
  const ownTail = await journal.append({ ...event('JOURNAL_TAIL'), stderr: full,
    stderrCapture: { totalBytes: Buffer.byteLength(full), truncated: false } });
  const ownRead = (await h.open().read(ownTail.eventId)).event;
  assert.equal(ownRead.stderr.bytes, 1000); assert.equal(ownRead.stderr.totalBytes, 1100); assert.equal(ownRead.stderr.truncated, true);
  const legacy = await journal.append({ ...event('LEGACY_DESCRIPTOR'), stderr: 'old schema remains readable' });
  const legacyRead = (await h.open().read(legacy.eventId)).event;
  assert.equal(Object.hasOwn(legacyRead.stderr, 'totalBytes'), false); assert.equal(legacyRead.stderr.truncated, false);
  const legacyExport = await journal.buildRedactedExport({ eventIds: [legacy.eventId] });
  assert.equal(legacyExport.data.events[0].capture.stderrUpstreamUnknown, true);
  assert.equal(legacyExport.data.coverage.selectedCaptureComplete, false);
});

test('stderr capture accepts exact complete evidence and rejects malformed or inconsistent upstream claims', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const stderr = 'é';
  const complete = await journal.append({ ...event(), stderr, stderrCapture: { totalBytes: 2, truncated: false } });
  const exported = await journal.buildRedactedExport({ eventIds: [complete.eventId] });
  assert.equal(exported.data.coverage.selectedCaptureComplete, true);
  assert.equal(exported.data.events[0].stderr.totalBytes, 2);
  const replacement = await journal.append({ ...event('INVALID_UTF8_CAPTURE'), stderr: '\uFFFD', stderrCapture: { totalBytes: 1, truncated: false } });
  const replacementRead = (await h.open().read(replacement.eventId)).event;
  assert.equal(replacementRead.stderr.bytes, 3); assert.equal(replacementRead.stderr.totalBytes, 1);
  assert.equal(replacementRead.stderr.truncated, false);
  for (const descriptor of [null, [], {}, { totalBytes: -1, truncated: true }, { totalBytes: 1, truncated: true },
    { totalBytes: 3, truncated: false }, { totalBytes: 2, truncated: 'false' },
    { totalBytes: Number.MAX_SAFE_INTEGER + 1, truncated: true }, { totalBytes: 2, truncated: false, path: 'private' }]) {
    assert.throws(() => journal.append({ ...event(), stderr, stderrCapture: descriptor }), { code: 'INVALID_DIAGNOSTIC_REQUEST' });
  }
  assert.throws(() => journal.append({ ...event(), stderrCapture: { totalBytes: 0, truncated: false } }), { code: 'INVALID_DIAGNOSTIC_REQUEST' });
  let executed = false;
  assert.throws(() => journal.append({ ...event(), stderr, stderrCapture: { truncated: false,
    get totalBytes() { executed = true; return 2; } } }), { code: 'INVALID_DIAGNOSTIC_REQUEST' });
  assert.equal(executed, false);
});

test('corrupt persisted stderr totals are preserved but cannot claim complete capture', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const saved = await journal.append({ ...event(), stderr: 'original detail', stderrCapture: { totalBytes: 15, truncated: false } });
  for (const totalBytes of [0, 16, '15', Number.MAX_SAFE_INTEGER + 1]) {
    const id = randomUUID(), envelope = JSON.parse(await fs.readFile(h.eventPath(saved.eventId), 'utf8'));
    envelope.event.id = id; envelope.event.stderr.totalBytes = totalBytes;
    envelope.digest = digest(JSON.stringify(envelope.event));
    await fs.writeFile(h.eventPath(id), JSON.stringify(envelope));
    const reopened = h.open(), records = await reopened.list();
    assert.ok(!records.events.some(entry => entry.id === id)); assert.equal(records.status.incomplete, true);
    assert.equal((await reopened.buildRedactedExport({ eventIds: [id] })).data, null);
    assert.ok((await fs.stat(h.eventPath(id))).isFile());
  }
});

test('historical production assessment keys remain reviewable through redacted export', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  const assessment = { kind: 'changed', diagnostic: { changedFields: ['ino'], expected: { ino: 'private-old-id', canonicalPath: 'C:\\private\\before.mp4' }, actual: { ino: 'private-new-id', canonicalPath: 'C:\\private\\after.mp4' } } };
  const saved = await journal.append(event('SOURCE_ASSESSED', { assessment }));
  const exported = await journal.buildRedactedExport({ eventIds: [saved.eventId] });
  const shared = exported.data.events[0].context.assessment;
  assert.equal(shared.kind, 'changed'); assert.deepEqual(shared.diagnostic.changedFields, ['ino']);
  assert.notEqual(shared.diagnostic.expected.ino, shared.diagnostic.actual.ino);
  assert.equal(exported.json.includes('private'), false); await journal.closeSession();
});

test('deep and node-bounded context remains readable and exportable with truthful truncation', async t => {
  const h = await fixture(t), journal = h.open(); await journal.startSession();
  let deep = { source: { kind: 'unchanged' } }; for (let n = 0; n < 15; n++) deep = { source: deep };
  const broad = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [String(i), Array.from({ length: 100 }, () => null)]));
  for (const context of [deep, broad]) {
    const saved = await journal.append(event('BOUNDED_CONTEXT', context)); assert.equal(saved.persisted, true);
    const reopened = h.open(); const read = await reopened.read(saved.eventId);
    assert.ok(read.event); assert.equal(read.event.contextTruncated, true);
    const exported = await reopened.buildRedactedExport({ eventIds: [saved.eventId] });
    assert.ok(exported.data); assert.equal(exported.data.coverage.selectedCaptureComplete, false);
  }
  await journal.closeSession();
});

test('key byte reservation keeps near-budget ASCII and multibyte contexts readable after truncation', async t => {
  const h = await fixture(t, { limits: { eventBytes: 4096 } }), journal = h.open(); await journal.startSession();
  for (const key of ['k'.repeat(128), '😀'.repeat(64)]) {
    const saved = await journal.append(event('KEY_BUDGET', { source: 'x'.repeat(1898), [key]: 'v' }));
    assert.equal(saved.persisted, true);
    const reopened = h.open(), read = await reopened.read(saved.eventId);
    assert.ok(read.event); assert.equal(read.event.contextTruncated, true);
    assert.equal(Object.hasOwn(read.event.context, key), false);
    const exported = await reopened.buildRedactedExport({ eventIds: [saved.eventId] });
    assert.ok(exported.data); assert.equal(exported.data.coverage.selectedCaptureComplete, false);
  }
  await journal.closeSession();
});
