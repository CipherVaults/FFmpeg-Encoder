'use strict';
// C2 (record 37 §4, §7, §12): the service-owned native file slot, the
// quarantine/settle path, the renderer diagnostics projection and the
// composition guards. Synthetic owners only: no device or native child runs.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), { createHash } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { registerIpc } = require('../src/ipc.cjs');
const { NativeBackendService } = require('../src/native-backend-service.cjs');
const { createNativeFileControls, createTestNativeFileControls, assertProductionNativeFileControls, NATIVE_MESSAGES } = require('../src/native-file-controls.cjs');

const repo = path.join(__dirname, '..');
const purpose = 'native-file-runtime';
const signal = () => new AbortController().signal;
const refused = { code: 'NATIVE_MEDIA_ADMISSION_REFUSED', message: NATIVE_MESSAGES.NATIVE_MEDIA_ADMISSION_REFUSED };
const unsettled = { code: 'NATIVE_OWNER_UNSETTLED', message: NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED };
const capabilities = async () => ({ profiles: PROFILES.map(p => ({ ...p, available: true, supportedBitDepths: [8, 10] })), versions: { ffmpeg: 'test', ffprobe: 'test' } });
const backends = () => new NativeBackendService({ discover: async () => { throw new Error('No discovery in this test.'); },
  createProbe: () => ({ initialize: async () => { throw new Error('No probe in this test.'); }, probe: async () => { throw new Error('No probe in this test.'); } }) });
const pins = dir => ({ ffmpeg: { file: path.join(dir, 'ffmpeg.exe'), sizeBytes: 10, sha256: 'a'.repeat(64) },
  ffprobe: { file: path.join(dir, 'ffprobe.exe'), sizeBytes: 10, sha256: 'b'.repeat(64) } });

async function owned(t) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ffenc-native-service-')), stateDir = path.join(dir, 'state');
  await fsp.mkdir(stateDir);
  const services = [];
  t.after(async () => { for (const s of services) await s.closeDiagnostics().catch(() => {}); await fsp.rm(dir, { recursive: true, force: true }); });
  const make = (options = {}) => {
    const s = new EncoderService({ ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir, inspectionCache: null,
      storageEligibility: { check: async () => ({ eligible: false }) }, capabilities, ...options });
    services.push(s); return s;
  };
  return { dir, stateDir, make };
}
// A stand-in for a job's runtime after its work: close() and the facts it then reports.
function stubRuntime(mode) {
  const r = { mode, closes: 0,
    async close() {
      r.closes++;
      if (r.mode === 'aggregate') throw new AggregateError([Object.assign(new Error('zq-private lease'), { code: 'NATIVE_FILE_UNSETTLED' })], 'zq-private aggregate');
      if (r.mode === 'plain') throw new Error('zq-private plain');
    },
    snapshot() {
      if (r.mode === 'snapshot-throws') throw new Error('zq-private snapshot');
      return Object.freeze({ busy: r.mode === 'busy', leaseHeld: r.mode === 'lease', leaseOwnershipUnknown: r.mode === 'unknown', sourceHeld: r.mode === 'source' });
    } };
  return r;
}
const reasons = async (s, reason) => (await s.getDiagnosticHistory({ limit: 200 })).events.filter(e => e.reason === reason);

test('NS-01: only the current running native file job may take the native file slot, once, for its one purpose', async t => {
  const s = (await owned(t)).make(), job = {};
  const refuse = (owner, request, label) => {
    const before = s.nativeMediaSlot;
    assert.throws(() => s.acquireNativeFileSlot(owner, request), refused, label); assert.equal(s.nativeMediaSlot, before, label);
  };
  s.nativeFileJob = job;
  refuse(job, { signal: signal(), purpose }, 'idle, never begun');
  for (const phase of ['checking', 'native-checking', 'preparing', 'cancelling', 'ready', 'completed']) { s.begin(phase); refuse(job, { signal: signal(), purpose }, phase); }
  s.begin('running');
  for (const [owner, label] of [[{}, 'another owner'], [null, 'null owner'], [undefined, 'no owner'], ['job', 'string owner']]) refuse(owner, { signal: signal(), purpose }, label);
  s.nativeFileJob = null; refuse(null, { signal: signal(), purpose }, 'no current job, null owner'); refuse({}, { signal: signal(), purpose }, 'no current job'); s.nativeFileJob = job;
  for (const bad of ['native-backend-capability', 'native-backend-initialization', 'NATIVE-FILE-RUNTIME', undefined]) refuse(job, { signal: signal(), purpose: bad }, String(bad));
  refuse(job, undefined, 'no request');
  const aborted = new AbortController(); aborted.abort(); refuse(job, { signal: aborted.signal, purpose }, 'aborted request signal');
  s.controller.abort(); refuse(job, { signal: signal(), purpose }, 'aborted service controller'); s.begin('running');
  s.nativeMediaSlot = {}; refuse(job, { signal: signal(), purpose }, 'slot held by a backend check'); s.nativeMediaSlot = null;
  s.closeAdmission(); refuse(job, { signal: signal(), purpose }, 'admission closed'); s.admissionClosed = false;

  const first = s.acquireNativeFileSlot(job, { signal: signal(), purpose });
  assert.ok(s.nativeMediaSlot); assert.deepEqual(Object.keys(first), ['release']);
  refuse(job, { signal: signal(), purpose }, 'a second holder');
  assert.throws(() => s.requireIdle(), { code: 'BUSY' });
  await first.release(); assert.equal(s.nativeMediaSlot, null);
  const second = s.acquireNativeFileSlot(job, { signal: signal(), purpose }), held = s.nativeMediaSlot;
  await first.release(); assert.equal(s.nativeMediaSlot, held, 'a stale release never frees a later holder');
  await second.release(); await second.release(); assert.equal(s.nativeMediaSlot, null);
  // Not an IPC or preload surface.
  for (const file of ['src/ipc.cjs', 'preload.js']) assert.doesNotMatch(fs.readFileSync(path.join(repo, file), 'utf8'), /acquireNativeFileSlot|settleNativeFileRuntime|nativeFileJob|nativeFileRuntime/, file);
});

test('NS-02: the backend check slot still refuses the native file purpose and is byte-identical', async t => {
  const s = (await owned(t)).make();
  for (const phase of ['native-checking', 'running']) {
    s.begin(phase); assert.throws(() => s.acquireNativeMediaSlot({ signal: signal(), purpose }), { code: 'NATIVE_MEDIA_ADMISSION_REFUSED' }, phase); assert.equal(s.nativeMediaSlot, null);
  }
  assert.throws(() => s.acquireNativeMediaSlot({ signal: signal(), purpose: 'native-backend-capability' }), { code: 'NATIVE_MEDIA_ADMISSION_REFUSED' }, 'backend purpose while running');
  s.begin('native-checking'); s.nativeFileJob = {};
  const slot = s.acquireNativeMediaSlot({ signal: signal(), purpose: 'native-backend-capability' });
  assert.throws(() => s.acquireNativeFileSlot(s.nativeFileJob, { signal: signal(), purpose }), refused, 'file slot during a backend check');
  await slot.release(); assert.equal(s.nativeMediaSlot, null);
  const source = EncoderService.prototype.acquireNativeMediaSlot.toString().replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(source).digest('hex'), '08469024666eb6bb1f05136c800f4e81bcffd9947b73ffcf2c9facc8171b20f2');
});

test('NS-16a: a quarantined native file owner refuses idle work with its own code, retries single-flight and is released once', async t => {
  const h = await owned(t), s = h.make(), runtime = stubRuntime('aggregate'), job = {};
  s.nativeFileRuntime = runtime; s.nativeFileJob = job;
  const updates = []; s.on('update', () => updates.push(s.nativeFileRuntime));
  const modes = ['aggregate', 'plain', 'lease', 'unknown', 'source', 'slot', 'busy', 'snapshot-throws'];
  for (const mode of modes) {
    runtime.mode = mode; s.nativeMediaSlot = mode === 'slot' ? {} : null;
    const before = runtime.closes;
    assert.throws(() => s.requireIdle(), unsettled, mode);
    const flight = s.nativeSettle; assert.ok(flight, mode);
    assert.throws(() => s.selectNativeBackend({}), unsettled, mode + ' through a public channel');
    assert.equal(s.nativeSettle, flight, mode + ' joins the same settle');
    assert.equal(await flight, false, mode); assert.equal(runtime.closes, before + 1, mode);
    assert.equal(s.nativeFileRuntime, runtime, mode); assert.equal(s.nativeFileJob, job, mode); assert.equal(s.nativeSettle, null, mode);
  }
  assert.deepEqual(updates, [], 'no state emission while quarantined');
  // While a job is running the honest code is BUSY, and nothing is settled.
  s.nativeMediaSlot = null; s.begin('running'); updates.length = 0; const running = runtime.closes;
  assert.throws(() => s.requireIdle(), { code: 'BUSY' }); assert.equal(s.nativeSettle, null); assert.equal(runtime.closes, running);
  s.begin('completed'); updates.length = 0;
  // Shutdown keeps its own code first.
  s.closeAdmission(); assert.throws(() => s.requireIdle(), { code: 'SHUTTING_DOWN' }); assert.equal(s.nativeSettle, null); s.admissionClosed = false;

  runtime.mode = 'settled'; const closes = runtime.closes;
  assert.throws(() => s.requireIdle(), unsettled);
  assert.equal(await s.nativeSettle, true); assert.equal(runtime.closes, closes + 1);
  assert.equal(s.nativeFileRuntime, null); assert.equal(s.nativeFileJob, null);
  assert.deepEqual(updates, [null], 'one state emission, after the owner was dropped');
  s.requireIdle(); assert.equal(s.nativeSettle, null); assert.equal(await s.settleNativeFileRuntime(), true); assert.equal(runtime.closes, closes + 1);

  assert.equal((await reasons(s, 'NATIVE_RUNTIME_CLOSE_FAILED')).length, modes.length);
  const settled = await reasons(s, 'NATIVE_RUNTIME_SETTLED'); assert.equal(settled.length, 1);
  const failed = (await reasons(s, 'NATIVE_RUNTIME_CLOSE_FAILED')).map(e => e.id).reverse();
  const records = await Promise.all(failed.map(async id => (await s.getDiagnosticRecord({ eventId: id })).event));
  assert.deepEqual(records.map(e => Object.hasOwn(e.context, 'nativePrivate')), modes.map(m => ['aggregate', 'plain', 'snapshot-throws'].includes(m)));
  assert.ok(records.every(e => e.stage === 'recovery' && e.context.settled === false && (!Object.hasOwn(e.context, 'nativePrivate') || e.context.nativePrivate === '[main-only]')));
  // The facts are recorded whether close resolved or rejected.
  assert.deepEqual(records.map(e => Object.entries(e.context).filter(([k, v]) => k !== 'settled' && v === true).map(([k]) => k)),
    [[], [], ['leaseHeld'], ['leaseOwnershipUnknown'], ['sourceHeld'], ['slotHeld'], ['busy'], []]);
  assert.ok(records.slice(0, 2).every(e => Object.hasOwn(e.context, 'leaseHeld')), 'a rejected close still records the snapshot facts');
  assert.doesNotMatch(JSON.stringify(records), /zq-private/);
  // The persisted main-only record keeps the aggregate's member codes.
  const persisted = fs.readFileSync(path.join(h.stateDir, 'diagnostics-v1', 'events', failed[0] + '.json'), 'utf8');
  assert.match(persisted, /"memberCodes":\["NATIVE_FILE_UNSETTLED"\]/); assert.match(persisted, /zq-private aggregate/);
});

test('NS-16a: shutdown settles the native file owner before invalidating backend selections and reports one that stays unsettled', async t => {
  const h = await owned(t);
  for (const mode of ['lease', 'settled']) {
    const order = [], runtime = stubRuntime(mode), close = runtime.close;
    runtime.close = async () => { order.push('close'); return close(); };
    const s = h.make({ nativeBackends: { invalidate: async () => { order.push('invalidate'); } } });
    s.nativeFileRuntime = runtime; s.nativeFileJob = {};
    if (mode === 'lease') {
      await assert.rejects(s.closeOperationResources(), error => error instanceof AggregateError
        && error.errors.length === 1 && error.errors[0].code === 'NATIVE_OWNER_UNSETTLED');
      assert.equal(s.nativeFileRuntime, runtime);
    } else { await s.closeOperationResources(); assert.equal(s.nativeFileRuntime, null); assert.equal(s.nativeFileJob, null); }
    assert.deepEqual(order, ['close', 'invalidate'], mode);
  }
});

async function ordinaryBatch(t, compose, settings) {
  const h = await owned(t), input = path.join(h.dir, 'input'), output = path.join(h.dir, 'output');
  await fsp.mkdir(input); await fsp.mkdir(output); await fsp.writeFile(path.join(input, 'a.mp4'), 'Original input a.mp4');
  const nativeBackends = backends(), calls = [];
  const s = h.make({ nativeBackends, inspectionWorkers: 1, storageEligibility: { check: async () => ({ eligible: true, reason: null }) },
    ...(compose ? { nativeFiles: createNativeFileControls({ runtime: pins(h.dir), stateDir: h.stateDir, nativeBackends }) } : {}),
    inspect: async () => ({ probe: { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 180,
      color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', disposition: { default: 1 } }] },
      color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: 0, reasons: [] }, duration: 2,
      summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 } }),
    verify: () => ({ valid: true, errors: [] }),
    run: async (executable, args, options) => {
      if (executable === 'injected-ffprobe') {
        const encode = calls.find(call => call.args.at(-1) === args.at(-1)), tags = {};
        for (let i = 0; i < (encode?.args.length || 0); i++) if (encode.args[i] === '-metadata') { const v = encode.args[i + 1], at = v.indexOf('='); tags[v.slice(0, at)] = v.slice(at + 1); }
        return { stdout: JSON.stringify({ format: { tags } }), stderr: '', exitCode: 0 };
      }
      calls.push({ executable, args });
      await fsp.writeFile(args.at(-1), 'Encoded output');
      options.onProgress?.({ seconds: 2, speed: 1, fps: 30, bytes: 100, frame: 60, ended: true });
      return { stdout: '', stderr: '', exitCode: 0 };
    } });
  const a = await s.registerFolder(input, 'input'), b = await s.registerFolder(output, 'output');
  const plan = await s.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings });
  s.startBatch({ planId: plan.planId, fileIds: plan.items.filter(item => item.status === 'ready').map(item => item.id) }); await s.taskPromise;
  const text = JSON.stringify({ calls, statuses: s.snapshot().items.map(item => item.status), phase: s.snapshot().phase });
  return { s, value: JSON.parse(text.split(JSON.stringify(h.dir).slice(1, -1)).join('<root>')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '<time>').replace(/\.ffmpeg-encoder-[A-Za-z0-9]{6}/g, '.ffmpeg-encoder-<stage>')) };
}

// Every ordinary encode profile (CPU and NVIDIA) at its defaults. Non-encode
// operations are outside NS-18 and are covered by the P04 recheck.
test('NS-18: an ordinary batch is unchanged by composed native file controls, argv included, for every ordinary profile', async t => {
  assert.equal(PROFILES.length, 6);
  for (const profile of PROFILES) {
    const settings = { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default };
    const without = await ordinaryBatch(t, false, settings), withControls = await ordinaryBatch(t, true, settings);
    assert.equal(without.value.calls.length, 1, profile.id); assert.deepEqual(without.value.statuses, ['success'], profile.id);
    assert.ok(without.value.calls[0].args.includes(profile.defaultPreset), profile.id);
    assert.deepEqual(withControls.value, without.value, profile.id);
    for (const { s } of [without, withControls]) {
      assert.equal(s.nativeMediaSlot, null); assert.equal(s.nativeFileRuntime, null); assert.equal(s.nativeFileJob, null);
      assert.equal(Object.hasOwn(s.snapshot(), 'native'), false);
    }
    assert.equal(withControls.s.nativeFiles.policyCount, 0); assert.equal(without.s.nativeFiles, null);
  }
});

test('NS-20: only the controls module names the test factory, and only the service constructor names the allowance', () => {
  const files = [path.join(repo, 'main.js'), path.join(repo, 'preload.js')];
  const walk = dir => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(c?js|mjs)$/.test(entry.name)) files.push(full); } };
  walk(path.join(repo, 'src'));
  const using = pattern => files.filter(file => pattern.test(fs.readFileSync(file, 'utf8'))).map(file => path.relative(repo, file).replace(/\\/g, '/')).sort();
  assert.deepEqual(using(/createTestNativeFileControls/), ['src/native-file-controls.cjs']);
  assert.deepEqual(using(/allowInjectedNativeFiles/), ['src/encoder-service.cjs']);
  const service = fs.readFileSync(path.join(repo, 'src/encoder-service.cjs'), 'utf8');
  const start = service.indexOf('  constructor({'), end = service.indexOf('  async operationStore()');
  const positions = [...service.matchAll(/allowInjectedNativeFiles/g)].map(m => m.index);
  assert.ok(start > 0 && end > start && service.indexOf('  constructor({', start + 1) === -1);
  assert.ok(positions.length === 2 && positions.every(p => p > start && p < end), 'the allowance appears only in the service constructor');
});

test('NS-20: the service and the startup assertion accept only genuine controls; injected ones need the exact test allowance', async t => {
  const h = await owned(t), nativeBackends = backends(), options = { runtime: pins(h.dir), stateDir: h.stateDir, nativeBackends };
  const production = createNativeFileControls(options), injected = createTestNativeFileControls({ ...options, policies: [] });
  const composition = { code: 'INVALID_NATIVE_FILE_COMPOSITION', message: NATIVE_MESSAGES.INVALID_NATIVE_FILE_COMPOSITION };
  for (const [nativeFiles, extra, label] of [[injected, {}, 'injected'], [injected, { allowInjectedNativeFiles: 'true' }, 'string allowance'],
    [injected, { allowInjectedNativeFiles: 1 }, 'numeric allowance'], [{ ...production }, { allowInjectedNativeFiles: true }, 'copied production'],
    [Object.create(production), { allowInjectedNativeFiles: true }, 'inherited production'], [{ policyCount: 0 }, {}, 'look-alike'], ['production', {}, 'string'], [false, {}, 'false']]) {
    assert.throws(() => h.make({ nativeBackends, nativeFiles, ...extra }), composition, label);
  }
  assert.equal(h.make({ nativeBackends, nativeFiles: production }).nativeFiles, production);
  assert.equal(h.make({ nativeBackends, nativeFiles: injected, allowInjectedNativeFiles: true }).nativeFiles, injected);
  assert.equal(h.make({ nativeBackends }).nativeFiles, null); assert.equal(h.make({ nativeBackends, nativeFiles: null }).nativeFiles, null);
  // main.js's startup assertion: the production brand with the fixed empty catalog only.
  assert.equal(assertProductionNativeFileControls(production), production);
  for (const bad of [injected, { ...production }, Object.create(production), { policyCount: 0 }, null, undefined])
    assert.throws(() => assertProductionNativeFileControls(bad), { code: 'INVALID_NATIVE_FILE_COMPOSITION' });
});

test('NS-09b: renderer-readable diagnostics withhold native private detail and stderr text; the journal and redacted export keep their roles', async t => {
  const h = await owned(t), s = h.make();
  const nativeStderr = 'zq-secret native stderr\n', big = Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['big' + i, 'x'.repeat(5000)]));
  await s.recordIncident({ stage: 'encoding', reason: 'NATIVE_FILE_JOB_FAILED', severity: 'error', message: NATIVE_MESSAGES.NATIVE_FILE_JOB_FAILED,
    context: { nativePrivate: { code: 'EACCES', message: 'zq-secret C:\\private\\clip.mkv', causeCode: null }, profileId: 'h264-qsv', ...big }, stderr: nativeStderr });
  await s.recordIncident({ stage: 'encoding', reason: 'ENCODE_FAILED', severity: 'error', context: { code: 'ENCODE_FAILED' }, stderr: 'ordinary stderr tail\n' });
  const nativeId = (await reasons(s, 'NATIVE_FILE_JOB_FAILED'))[0].id, ordinaryId = (await reasons(s, 'ENCODE_FAILED'))[0].id;

  const handlers = new Map(), frame = { url: 'app://encoder/index.html' }, window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  registerIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler() {} }, window, service: s, dialog: {}, entryUrl: frame.url });
  const envelope = await handlers.get('encoder:diagnostic-record')({ sender: window.webContents, senderFrame: frame }, { eventId: nativeId });
  assert.equal(envelope.ok, true); const record = envelope.value.event;
  assert.equal(record.context.nativePrivate, '[main-only]'); assert.equal(record.context.profileId, 'h264-qsv'); assert.equal(record.contextTruncated, true);
  assert.deepEqual(record.stderr, { withheld: true, bytes: Buffer.byteLength(nativeStderr) });
  assert.equal(record.message, NATIVE_MESSAGES.NATIVE_FILE_JOB_FAILED);
  assert.doesNotMatch(JSON.stringify(record), /zq-secret|EACCES/);

  const session = (await s.diagnostics.readSession(record.sessionId, { limit: 200 })).session;
  assert.deepEqual(session.events.find(e => e.id === nativeId), record);
  assert.doesNotMatch(JSON.stringify(session), /zq-secret|EACCES/);
  // Ordinary events are not projected.
  assert.equal(session.events.find(e => e.id === ordinaryId).stderr.text, 'ordinary stderr tail\n');
  assert.equal((await s.getDiagnosticRecord({ eventId: ordinaryId })).event.stderr.text, 'ordinary stderr tail\n');

  const exported = JSON.stringify(await s.getDiagnosticExport({ eventIds: [nativeId, ordinaryId] }));
  assert.doesNotMatch(exported, /zq-secret|EACCES|nativePrivate|ordinary stderr tail/);
  // The persisted journal stays the main-only audit record.
  const journal = path.join(h.stateDir, 'diagnostics-v1');
  assert.match(fs.readFileSync(path.join(journal, 'events', nativeId + '.json'), 'utf8'), /EACCES/);
  assert.equal(fs.readFileSync(path.join(journal, 'stderr', nativeId + '.txt'), 'utf8'), nativeStderr);
});

test('NS-09b: the native marker survives every context bound, so stderr text stays withheld; ordinary events are unchanged', async t => {
  const h = await owned(t), s = h.make(), dense = 'C:' + '\\'.repeat(3900);
  const cases = {
    // Escaped JSON far over the bound: the whole context would otherwise be dropped.
    oversized: { nativePrivate: { code: 'EACCES', message: 'zq-secret C:\\private', causeCode: null }, ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['argv' + i, dense])) },
    // The reserved key written last behind fields that exhaust the key budget.
    last: { ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => ['big' + i, 'x'.repeat(5000)])), nativePrivate: { code: 'EACCES', message: 'zq-secret late', causeCode: null } },
    // An accessor is never run, but the event is still marked.
    accessor: Object.defineProperty({ profileId: 'h264-qsv' }, 'nativePrivate', { enumerable: true, get() { throw new Error('zq-secret getter ran'); } }),
  };
  for (const [name, context] of Object.entries(cases)) {
    const result = await s.recordIncident({ stage: 'encoding', reason: 'NATIVE_FILE_JOB_FAILED', context, stderr: 'zq-secret stderr ' + name });
    assert.equal(result.persisted, true, name);
  }
  await s.recordIncident({ stage: 'encoding', reason: 'ENCODE_FAILED', context: Object.fromEntries(Array.from({ length: 8 }, (_, i) => ['argv' + i, dense])), stderr: 'ordinary oversized tail' });
  const nativeIds = (await reasons(s, 'NATIVE_FILE_JOB_FAILED')).map(e => e.id).reverse(), ordinaryId = (await reasons(s, 'ENCODE_FAILED'))[0].id;
  const records = await Promise.all(nativeIds.map(async id => (await s.getDiagnosticRecord({ eventId: id })).event));
  for (const [index, record] of records.entries()) {
    const name = Object.keys(cases)[index];
    assert.equal(record.context.nativePrivate, '[main-only]', name); assert.equal(record.contextTruncated, true, name);
    assert.deepEqual(record.stderr, { withheld: true, bytes: Buffer.byteLength('zq-secret stderr ' + name) }, name);
  }
  assert.deepEqual(Object.keys(records[0].context), ['nativePrivate'], 'an oversized native context keeps only its marker');
  assert.equal(records[2].context.profileId, 'h264-qsv');
  const session = (await s.diagnostics.readSession(records[0].sessionId, { limit: 200 })).session;
  assert.doesNotMatch(JSON.stringify([records, session]), /zq-secret/);
  // The journal keeps the reserved detail in preference to other fields.
  assert.match(fs.readFileSync(path.join(h.stateDir, 'diagnostics-v1', 'events', nativeIds[1] + '.json'), 'utf8'), /zq-secret late/);
  // Ordinary events keep their existing behaviour: an oversized context is dropped and stderr text is shown.
  const ordinary = (await s.getDiagnosticRecord({ eventId: ordinaryId })).event;
  assert.equal(ordinary.context, null); assert.equal(ordinary.stderr.text, 'ordinary oversized tail');
});
