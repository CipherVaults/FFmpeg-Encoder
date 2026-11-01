'use strict';
// C3 (record 37 §3.2-§3.5, §7, §11, §12): main-only native file preparation.
// Synthetic owners, inspectors and policy rows only: no device, child process or
// encode runs, and Start still refuses native plans (C4 wires the job).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), fsp = require('node:fs/promises');
const path = require('node:path'), os = require('node:os'), { randomUUID, createHash } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { InspectionCache } = require('../src/inspection-cache.cjs');
const { reconstructInspection } = require('../src/inspection.cjs');
const { PROFILES } = require('../src/media.cjs');
const { createNativeFileControls, createTestNativeFileControls, NATIVE_MESSAGES } = require('../src/native-file-controls.cjs');
const { nativeDestinationAllowed } = require('../src/native-file-workspace.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY } = require('../src/provenance.cjs');
const { nativeRuntime, nativeBackends, nativeProbe, nativeInspection, nativePolicy } = require('./native-file-fixture.cjs');

const text = code => NATIVE_MESSAGES[code];
const refusal = code => ({ code, message: text(code) });
const joined = (...codes) => ({ code: codes[0], message: codes.map(text).join(' ') });
// Sync and async service methods alike.
const refuses = (fn, expected, label) => assert.rejects(async () => fn(), expected, label);
const ordinarySettings = { profileId: PROFILES[0].id, preset: PROFILES[0].defaultPreset, quality: PROFILES[0].quality.default };
const reasons = async (s, reason) => (await s.getDiagnosticHistory({ limit: 200 })).events.filter(e => e.reason === reason);
const defaultRows = (fx, runtime, files) => [nativePolicy({ runtime, native: fx.native, probe: files['a.mp4'] })];

async function harness(t, { devices, profileId = 'h264-qsv', discover = 'cached', files = { 'a.mp4': nativeProbe() }, policies = defaultRows,
  production = false, onInspect, cache, storage } = {}) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'ffenc-native-prepare-'));
  const stateDir = path.join(dir, 'state'), input = path.join(dir, 'input'), output = path.join(dir, 'output');
  for (const folder of [stateDir, input, output]) await fsp.mkdir(folder);
  const runtime = await nativeRuntime(dir), fx = nativeBackends(runtime, { devices });
  if (discover !== 'never') await fx.native.refresh();
  if (profileId) await fx.choose(profileId);
  for (const [name, probe] of Object.entries(files)) await fsp.writeFile(path.join(input, name), Buffer.alloc(Number(probe.format.size), 37));
  const nativeFiles = production ? createNativeFileControls({ runtime, stateDir, nativeBackends: fx.native })
    : createTestNativeFileControls({ runtime, stateDir, nativeBackends: fx.native, policies: policies(fx, runtime, files) });
  const counts = { capabilities: 0, inspect: 0, run: 0 }, h = { dir, stateDir, input, output, runtime, fx, counts, files };
  h.cache = cache ? await cache(h) : null;
  const s = h.s = new EncoderService({ ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir, inspectionCache: h.cache, inspectionWorkers: 1,
    storageEligibility: { check: async (...args) => storage ? storage(h, ...args) : { eligible: false } },
    capabilities: async () => { counts.capabilities++; return { profiles: PROFILES.map(p => ({ ...p, available: true, supportedBitDepths: [8, 10] })),
      versions: { ffmpeg: 'ffmpeg version 9.0.2-test', ffprobe: 'ffprobe version 9.0.2-test' } }; },
    inspect: async file => { counts.inspect++; return await onInspect?.(h, path.basename(file)) || nativeInspection(files[path.basename(file)]); },
    run: async () => { counts.run++; throw Object.assign(new Error('No child process in this test.'), { code: 'TEST_NO_CHILD' }); },
    nativeBackends: fx.native, nativeFiles, allowInjectedNativeFiles: true,
    ...(discover === 'refresh' ? { discoverBackends: async ({ signal }) => { await fx.native.refresh({ signal }); return { registry: null, display: null }; } } : {}) });
  t.after(async () => { await s.closeDiagnostics().catch(() => {}); await fsp.rm(dir, { recursive: true, force: true }); });
  h.folders = { input: await s.registerFolder(input, 'input'), output: await s.registerFolder(output, 'output') };
  h.request = (changes = {}) => ({ inputFolderId: h.folders.input.id, outputFolderId: h.folders.output.id,
    ...(fx.native.snapshot().selection ? fx.selected() : { selectionId: randomUUID(), revision: fx.native.snapshot().revision }), ...changes });
  // Capabilities are normally checked when the app opens, before native settings are checked.
  if (discover === 'cached') { await s.getCapabilities(); counts.capabilities = 0; }
  return h;
}

test('NS-03: on a computer with no native device, prepare refuses at readiness before any capability check, folder read or inspection', async t => {
  // Cases 1-2 with production controls: before discovery, then after a discovery that found no device.
  const h = await harness(t, { devices: [], discover: 'never', profileId: null, production: true });
  const revision = h.s.state.revision, readdir = fsp.readdir; let reads = 0;
  fsp.readdir = async (...args) => { reads++; return readdir(...args); };
  try {
    await assert.rejects(h.s.prepareNativeFileBatch(h.request()), joined('NATIVE_DISCOVERY_UNOBSERVED', 'NATIVE_FILE_POLICY_REQUIRED'));
    await h.fx.native.refresh();
    await assert.rejects(h.s.prepareNativeFileBatch(h.request()), joined('NATIVE_HARDWARE_UNAVAILABLE', 'NATIVE_FILE_POLICY_REQUIRED'));
  } finally { fsp.readdir = readdir; }
  assert.deepEqual(h.counts, { capabilities: 0, inspect: 0, run: 0 }); assert.equal(reads, 0);
  assert.equal(h.s.state.revision, revision, 'no state change was emitted'); assert.equal(h.s.state.phase, 'idle'); assert.equal(h.s.plan, null);
  assert.equal(Object.hasOwn(h.s.snapshot(), 'native'), false);
  // A host without composed native file controls, or without the backend service, refuses first.
  const bare = new EncoderService({ ffmpeg: 'x', ffprobe: 'y', stateDir: h.stateDir, inspectionCache: null });
  const hostless = new EncoderService({ ffmpeg: 'x', ffprobe: 'y', stateDir: h.stateDir, inspectionCache: null, nativeFiles: h.s.nativeFiles });
  for (const s of [bare, hostless]) await assert.rejects(s.prepareNativeFileBatch(h.request()), refusal('NATIVE_FILE_RUNTIME_UNAVAILABLE'));
});

test('NS-03: a genuine backend with null or look-alike native file controls refuses before any work', async t => {
  for (const kind of ['null controls', 'plain look-alike controls']) await t.test(kind, async t => {
    const h = await harness(t), state = structuredClone(h.s.state), calls = { ...h.fx.calls };
    let begins = 0; const begin = h.s.begin.bind(h.s);
    h.s.begin = phase => { begins++; return begin(phase); };
    // Construction rejects look-alikes too; replace the dependency afterwards to
    // exercise the preparation gate's own brand check with a genuine backend.
    h.s.nativeFiles = kind === 'null controls' ? null : { ...h.s.nativeFiles };
    await assert.rejects(h.s.prepareNativeFileBatch(h.request()), {
      code: 'NATIVE_FILE_RUNTIME_UNAVAILABLE', message: 'Native file encoding is not available in this build.'
    });
    assert.equal(h.fx.calls.capture, 0, 'no selection was captured');
    assert.deepEqual(h.fx.calls, calls, 'no backend work started');
    assert.equal(begins, 0, 'no batch began');
    assert.deepEqual(h.counts, { capabilities: 0, inspect: 0, run: 0 });
    assert.deepEqual(h.s.state, state, 'service state is unchanged'); assert.equal(h.s.plan, null);
  });
});

test('NS-03: with a verified Intel selection, the empty production catalog still refuses first, with no work', async t => {
  const h = await harness(t, { production: true }), revision = h.s.state.revision;
  assert.equal(h.fx.native.snapshot().selection.probeVerified, true);
  await assert.rejects(h.s.prepareNativeFileBatch(h.request()), joined('NATIVE_FILE_POLICY_REQUIRED'));
  assert.deepEqual(h.counts, { capabilities: 0, inspect: 0, run: 0 }); assert.equal(h.s.state.revision, revision); assert.equal(h.s.plan, null);
  assert.equal(h.s.nativeFiles.policyCount, 0); assert.equal(h.fx.calls.probe, 1, 'only the settings check ran');
});

test('NS-04: the request is exactly four inert fields, and the folders must be distinct, local and ordinary', async t => {
  const h = await harness(t), good = h.request();
  let ran = false;
  const accessor = Object.defineProperty({ ...good, revision: undefined }, 'revision', { enumerable: true, get() { ran = true; return good.revision; } });
  const shapes = [null, undefined, 'request', 7, [], [good], Object.assign(Object.create({ inherited: true }), good), new (class Request {})(),
    { ...good, extra: 1 }, (({ revision, ...rest }) => rest)(good), Object.defineProperty({ ...good }, 'revision', { enumerable: false }),
    { ...good, [Symbol('extra')]: 1 }, accessor, new Proxy(good, { getOwnPropertyDescriptor() { throw new Error('trap'); } })];
  for (const [index, value] of shapes.entries()) await assert.rejects(h.s.prepareNativeFileBatch(value), refusal('INVALID_REQUEST'), String(index));
  assert.equal(ran, false, 'an accessor never runs');
  for (const key of ['inputFolderId', 'outputFolderId', 'selectionId'])
    for (const bad of ['folder', 7, null, 'g'.repeat(36), randomUUID().toUpperCase()]) await assert.rejects(h.s.prepareNativeFileBatch({ ...good, [key]: bad }), refusal('INVALID_ID'), key);
  for (const bad of [-1, 1.5, '0', NaN, Infinity, 2 ** 53, null]) await assert.rejects(h.s.prepareNativeFileBatch({ ...good, revision: bad }), refusal('INVALID_NATIVE_REQUEST'), String(bad));

  // Folder roles and lexical rules (cases 10 and 12). Registrations are set directly for paths a test cannot create.
  const folder = (role, folderPath) => { const id = randomUUID(); h.s.folders.set(id, { path: folderPath, role }); return id; };
  await assert.rejects(h.s.prepareNativeFileBatch({ ...good, inputFolderId: randomUUID() }), refusal('INVALID_FOLDER'));
  await assert.rejects(h.s.prepareNativeFileBatch({ ...good, inputFolderId: good.outputFolderId, outputFolderId: good.inputFolderId }), refusal('INVALID_FOLDER'));
  for (const same of [h.input, h.input.toUpperCase()])
    await assert.rejects(h.s.prepareNativeFileBatch({ ...good, outputFolderId: folder('output', same) }), refusal('NATIVE_FILE_SAME_FOLDER_UNSUPPORTED'));
  for (const remote of ['\\\\server\\share\\input', '\\\\?\\C:\\input', 'input'])
    await assert.rejects(h.s.prepareNativeFileBatch({ ...good, inputFolderId: folder('input', remote) }), refusal('NATIVE_FILE_SOURCE_PATH_UNSUPPORTED'), remote);
  const owned = path.join(h.stateDir, 'native-files');
  for (const bad of ['\\\\server\\share\\output', '\\\\?\\C:\\output', 'C:\\output:stream', 'C:\\out"put', 'C:\\out|put', owned, owned.toUpperCase(), path.join(owned, 'inside')])
    await assert.rejects(h.s.prepareNativeFileBatch({ ...good, outputFolderId: folder('output', bad) }), refusal('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED'), bad);
  assert.deepEqual(h.counts, { capabilities: 0, inspect: 0, run: 0 }); assert.equal(h.s.plan, null);

  // The runtime's destination rules, applied to each derived destination.
  for (const [file, allowed] of [['C:\\out\\a_h264-qsv.mkv', true], ['C:\\out\\a.mp4', false], ['C:\\out\\CON.mkv', false], ['C:\\out\\con.txt.mkv', false],
    ['C:\\out\\a.mkv.', false], ['C:\\out\\a:b.mkv', false], ['\\\\server\\share\\a.mkv', false], [path.join(owned, 'a.mkv'), false], ['C:\\out\\CON_h264-qsv.mkv', true]])
    assert.equal(nativeDestinationAllowed(file, owned), allowed, file);

  // After the folders are verified, a reparse ancestor of the output folder refuses with fixed text.
  // The fake link is shown only to the ordinary-path check, so the journal (which checks its own ancestors) still writes.
  const lstat = fsp.lstat, ancestor = path.dirname(h.folders.output.path);
  fsp.lstat = async (target, options) => { const stat = await lstat(target, options);
    return path.resolve(String(target)) === ancestor && /assertOrdinaryPath/.test(new Error().stack) ? Object.assign(Object.create(Object.getPrototypeOf(stat)), stat, { isSymbolicLink: () => true }) : stat; };
  let result;
  try { result = await h.s.prepareNativeFileBatch(h.request()); } finally { fsp.lstat = lstat; }
  assert.equal(result.phase, 'failed'); assert.equal(result.error, text('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED')); assert.equal(h.s.plan, null);
  assert.equal(h.counts.inspect, 0);
  const failed = (await reasons(h.s, 'PREPARATION_FAILED'))[0], record = (await h.s.getDiagnosticRecord({ eventId: failed.id })).event;
  assert.equal(record.message, text('NATIVE_FILE_OUTPUT_PATH_UNSUPPORTED')); assert.equal(record.context.nativePrivate, '[main-only]');
  const stored = JSON.parse(await fsp.readFile(path.join(h.stateDir, 'diagnostics-v1', 'events', failed.id + '.json'), 'utf8')).event;
  assert.equal(stored.context.nativePrivate.causeCode, 'ERR_ASSERTION');
  assert.ok(stored.context.nativePrivate.causeMessage.includes(ancestor), 'the main-only cause retains the refused ancestor');
  assert.ok(!JSON.stringify(record).includes(ancestor), 'the cause path stays main-only');
  // An output folder that disappeared after registration: fixed text, and the errno text stays main-only.
  await fsp.rm(h.output, { recursive: true });
  const gone = await h.s.prepareNativeFileBatch(h.request());
  assert.deepEqual([gone.phase, gone.error], ['failed', text('NATIVE_FILE_JOB_FAILED')]);
  const goneRecord = (await h.s.getDiagnosticRecord({ eventId: (await reasons(h.s, 'PREPARATION_FAILED'))[0].id })).event;
  const goneExport = await h.s.getDiagnosticExport({ eventIds: [goneRecord.id] });
  assert.equal(goneRecord.message, text('NATIVE_FILE_JOB_FAILED')); assert.equal(goneRecord.context.code, 'NATIVE_FILE_JOB_FAILED');
  assert.equal(goneExport.data.events[0].context.code, 'NATIVE_FILE_JOB_FAILED');
  assert.doesNotMatch(JSON.stringify([gone, goneRecord, goneExport]), /no such file|ENOENT|EACCES|EPERM/);
  const goneStored = JSON.parse(await fsp.readFile(path.join(h.stateDir, 'diagnostics-v1', 'events', goneRecord.id + '.json'), 'utf8')).event;
  assert.equal(goneStored.context.nativePrivate.code, 'ENOENT');
});

test('NS-05: the token is captured after capabilities; a capability refresh that dropped the check says so (case 30)', async t => {
  const h = await harness(t, { discover: 'refresh' }), order = [];
  const capture = h.fx.native.captureFileSelection.bind(h.fx.native), capabilities = h.s.capabilities, begin = h.s.begin.bind(h.s);
  // A microtask queued right after a capture runs only after begin(): nothing can interleave (§3.2 step 6).
  h.fx.native.captureFileSelection = request => { order.push('capture'); const token = capture(request); queueMicrotask(() => order.push('microtask')); return token; };
  h.s.capabilities = async (...args) => { order.push('capabilities'); const value = await capabilities(...args); order.push('capabilities-done'); return value; };
  h.s.begin = phase => { order.push('begin:' + phase); return begin(phase); };
  await assert.rejects(h.s.prepareNativeFileBatch(h.request()), refusal('STALE_NATIVE_SELECTION'));
  assert.deepEqual(order, ['begin:checking', 'capabilities', 'capabilities-done', 'capture']);
  assert.equal(h.fx.native.snapshot().selection, null); assert.equal(h.s.plan, null); assert.equal(h.s.state.phase, 'idle'); assert.equal(h.counts.inspect, 0);
  // Checking the settings again, with capabilities now cached, prepares the batch.
  await h.fx.choose(); order.length = 0;
  const ready = await h.s.prepareNativeFileBatch(h.request());
  assert.equal(ready.phase, 'ready'); assert.deepEqual(order, ['capture', 'begin:preparing', 'microtask']);
  assert.equal(h.counts.capabilities, 1);
});

test('NS-05: a folder registration replaced during the capability await refuses before the capture', async t => {
  const h = await harness(t, { discover: 'uncached' }), capabilities = h.s.capabilities;
  let captures = 0; const capture = h.fx.native.captureFileSelection.bind(h.fx.native);
  h.fx.native.captureFileSelection = request => { captures++; return capture(request); };
  h.s.capabilities = async (...args) => { const value = await capabilities(...args); h.s.folders.set(h.folders.output.id, { path: h.output, role: 'output' }); return value; };
  await assert.rejects(h.s.prepareNativeFileBatch(h.request()), refusal('INVALID_FOLDER'));
  assert.equal(captures, 0); assert.equal(h.s.plan, null); assert.equal(h.counts.inspect, 0);
});

test('NS-05: a stale request, and selection changes while a native plan is ready, are refused', async t => {
  const h = await harness(t);
  await assert.rejects(h.s.prepareNativeFileBatch(h.request({ revision: h.fx.selected().revision + 1 })), refusal('STALE_NATIVE_SELECTION'));
  await assert.rejects(h.s.prepareNativeFileBatch(h.request({ selectionId: randomUUID() })), refusal('STALE_NATIVE_SELECTION'));
  assert.equal(h.counts.inspect, 0);
  const ready = await h.s.prepareNativeFileBatch(h.request());
  assert.equal(ready.phase, 'ready'); assert.deepEqual(ready.items.map(item => [item.status, item.beta]), [['ready', true]]);
  assert.equal(ready.operation, 'native-encode'); assert.deepEqual(Object.keys(ready.native).sort(), ['beta', 'label', 'profileId', 'settings']);
  const before = h.fx.native.snapshot(), planId = h.s.plan.id, probes = h.fx.calls.probe;
  await refuses(() => h.s.selectNativeBackend({ revision: before.revision, profileId: 'h264-qsv', settings: before.selection.request.settings, bitDepth: 8 }), refusal('NATIVE_FILE_PLAN_ACTIVE'));
  await refuses(() => h.s.refreshNativeBackends(), refusal('NATIVE_FILE_PLAN_ACTIVE'));
  await refuses(() => h.s.qualifyNativeBackend(h.fx.selected()), refusal('NATIVE_FILE_PLAN_ACTIVE'));
  assert.equal(h.fx.native.snapshot().revision, before.revision); assert.equal(h.s.plan.id, planId); assert.equal(h.fx.calls.probe, probes);
  assert.equal(h.s.state.phase, 'ready');
});

test('NS-05: the captured token is checked again before the plan becomes ready', async t => {
  // The selection is invalidated while files are inspected (step 8).
  const h = await harness(t, { files: { 'a.mp4': nativeProbe(), 'a.mkv': nativeProbe(), 'b.mp4': nativeProbe() },
    onInspect: async h => { await h.fx.native.invalidate(); } });
  const mark = h.s.markConflicts.bind(h.s); let admitted;
  h.s.markConflicts = () => { mark(); admitted = h.s.state.items.map(item => item.status).sort(); };
  const result = await h.s.prepareNativeFileBatch(h.request());
  assert.equal(result.phase, 'failed'); assert.equal(result.error, text('NATIVE_FILE_SELECTION_STALE')); assert.equal(result.planId, null); assert.equal(h.s.plan, null);
  assert.deepEqual(admitted, ['conflict', 'conflict', 'ready'], 'both admitted statuses reached the step-8 check');
  assert.deepEqual(result.items.map(item => [item.status, item.reason]), Array.from({ length: 3 }, () => ['unprocessed', text('NATIVE_FILE_SELECTION_STALE')]));
  const finished = (await h.s.getDiagnosticRecord({ eventId: (await reasons(h.s, 'PREPARATION_FINISHED'))[0].id })).event;
  assert.equal(finished.context.phase, 'failed');
  assert.deepEqual(finished.context.items, result.items.map(item => ({ id: item.id, status: item.status, reason: item.reason })));
  const failed = (await reasons(h.s, 'PREPARATION_FAILED'))[0];
  assert.equal((await h.s.getDiagnosticRecord({ eventId: failed.id })).event.context.nativePrivate, '[main-only]');
  assert.match(fs.readFileSync(path.join(h.stateDir, 'diagnostics-v1', 'events', failed.id + '.json'), 'utf8'), /"code":"NATIVE_FILE_SELECTION_STALE".*"causeCode":"NATIVE_FILE_SELECTION_STALE"/s);
});

test('NS-06: an AMF selection is refused at readiness even with an exact AMF row and reference; nothing is substituted', async t => {
  const h = await harness(t, { profileId: 'h264-amf' });
  const view = h.fx.native.snapshot();
  assert.equal(view.selection.request.profileId, 'h264-amf'); assert.equal(view.selection.probeVerified, false); assert.equal(h.fx.calls.probe, 0);
  assert.deepEqual(h.s.nativeFiles.readiness(view).reasons.map(r => r.code), ['AMF_EFFECTIVE_PROPERTIES_UNOBSERVED'], 'the AMF row matches; CAPABILITY_UNVERIFIED is hidden');
  await assert.rejects(h.s.prepareNativeFileBatch(h.request()), joined('AMF_EFFECTIVE_PROPERTIES_UNOBSERVED'));
  assert.throws(() => h.fx.native.captureFileSelection(h.fx.selected()), { code: 'NATIVE_CAPABILITY_UNVERIFIED' });
  assert.deepEqual(h.counts, { capabilities: 0, inspect: 0, run: 0 }); assert.equal(h.s.plan, null);
  assert.equal(h.fx.native.snapshot().selection.request.profileId, 'h264-amf', 'no Intel, CPU or NVIDIA substitution');
});

test('NS-07a: a policy row without a reference never admits a file', async t => {
  // Only a reference-less row: refused at readiness, before any work.
  const bare = await harness(t, { policies: (fx, runtime, files) => [nativePolicy({ runtime, native: fx.native, probe: files['a.mp4'], reference: false })] });
  await assert.rejects(bare.s.prepareNativeFileBatch(bare.request()), joined('NATIVE_FILE_REFERENCE_REQUIRED'));
  assert.deepEqual(bare.counts, { capabilities: 0, inspect: 0, run: 0 });
  // A referenced row for another source opens the gate, but this file's own row has no reference.
  const files = { 'a.mp4': nativeProbe(), 'b.mp4': nativeProbe({ index: 3 }), 'c.mp4': nativeProbe({ index: 5 }) };
  const h = await harness(t, { files, policies: (fx, runtime) => [nativePolicy({ runtime, native: fx.native, probe: files['a.mp4'], id: 'row-a' }),
    nativePolicy({ runtime, native: fx.native, probe: files['b.mp4'], id: 'row-b', reference: false })] });
  const ready = await h.s.prepareNativeFileBatch(h.request()), byName = Object.fromEntries(ready.items.map(item => [item.name, item]));
  assert.equal(byName['a.mp4'].status, 'ready');
  assert.deepEqual([byName['b.mp4'].status, byName['b.mp4'].reasonCode, byName['b.mp4'].reason, byName['b.mp4'].nativeReasons],
    ['unsupported', 'NATIVE_FILE_REFERENCE_REQUIRED', text('NATIVE_FILE_REFERENCE_REQUIRED'), ['NATIVE_FILE_REFERENCE_REQUIRED']]);
  assert.deepEqual([byName['c.mp4'].status, byName['c.mp4'].reasonCode, byName['c.mp4'].nativeReasons],
    ['unsupported', 'NATIVE_FILE_POLICY_REQUIRED', ['NATIVE_FILE_POLICY_REQUIRED']]);
  assert.deepEqual([...h.s.plan.entries.keys()], [byName['a.mp4'].id]);
  assert.equal(h.s.plan.entries.get(byName['a.mp4'].id).policyId, 'row-a');
  for (const name of ['b.mp4', 'c.mp4']) assert.throws(() => h.s.getEncodingDetails({ planId: ready.planId, fileId: byName[name].id }), { code: 'UNPREPARED_FILE' });
});

test('NS-08: sources outside the contract are unsupported with their reasons; generated, uncertain and legacy files get no permission', async t => {
  const files = {
    'ok.mp4': nativeProbe(),
    'wide.mp4': nativeProbe({ edit: p => Object.assign(p.streams[0], { width: 1920, height: 1080 }) }),
    'hevc.mp4': nativeProbe({ edit: p => Object.assign(p.streams[0], { codec_name: 'hevc', profile: 'Main', width: 1920, color_transfer: 'smpte2084' }) }),
    'gen.mp4': nativeProbe({ edit: p => { p.format.tags = { [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: randomUUID() }; } }),
    'odd.mp4': nativeProbe({ edit: p => { p.format.tags = { [MARKER_KEY]: '2', [OUTPUT_ID_KEY]: randomUUID() }; } }),
    'clip_H264-CPU.mp4': nativeProbe() };
  const h = await harness(t, { files, policies: (fx, runtime) => [nativePolicy({ runtime, native: fx.native, probe: files['ok.mp4'] })] });
  const ready = await h.s.prepareNativeFileBatch(h.request()), byName = Object.fromEntries(ready.items.map(item => [item.name, item]));
  assert.equal(byName['ok.mp4'].status, 'ready');
  assert.deepEqual([byName['wide.mp4'].status, byName['wide.mp4'].reasonCode, byName['wide.mp4'].reason, byName['wide.mp4'].nativeReasons],
    ['unsupported', 'NATIVE_FILE_SOURCE_GEOMETRY', text('NATIVE_FILE_SOURCE_GEOMETRY'), ['NATIVE_FILE_SOURCE_GEOMETRY']]);
  assert.deepEqual(byName['hevc.mp4'].nativeReasons, ['NATIVE_FILE_SOURCE_CODEC', 'NATIVE_FILE_SOURCE_GEOMETRY', 'NATIVE_FILE_SOURCE_COLOR']);
  assert.ok(ready.items.every(item => (item.nativeReasons || []).length <= 16));
  assert.equal(byName['gen.mp4'].status, 'generated'); assert.equal(byName['odd.mp4'].status, 'provenance-issue'); assert.equal(byName['clip_H264-CPU.mp4'].status, 'ambiguous');
  await refuses(() => h.s.reencodeOutputs({ planId: ready.planId, fileIds: [byName['gen.mp4'].id] }), refusal('NATIVE_FILE_SOURCE_PERMISSION_REQUIRED'));
  await refuses(() => h.s.treatAsOriginal({ planId: ready.planId, fileId: byName['clip_H264-CPU.mp4'].id }), refusal('NATIVE_FILE_SOURCE_PERMISSION_REQUIRED'));
  assert.equal(h.s.plan.id, ready.planId); assert.equal(h.s.plan.reencodeAuthorizations.size, 0); assert.equal(h.s.plan.overrides.size, 0);
  assert.deepEqual([...h.s.plan.entries.keys()], [byName['ok.mp4'].id]);
});

test('NS-19: while a native plan is ready, saved settings keep it, options and Start are fixed, a new folder drops it and Cancel revokes it', async t => {
  const h = await harness(t);
  let ready = await h.s.prepareNativeFileBatch(h.request());
  const planId = ready.planId, item = ready.items[0];
  // A forged selection is refused without changing the ready plan.
  const entry = h.s.plan.entries.get(item.id), selection = entry.selection;
  entry.selection = { ...selection };
  await refuses(() => h.s.startBatch({ planId, fileIds: [item.id] }), refusal('NATIVE_FILE_SELECTION_STALE'));
  entry.selection = selection;
  assert.equal(h.s.state.phase, 'ready'); assert.deepEqual(h.s.snapshot().items.map(i => i.status), ['ready']); assert.equal(h.s.plan.id, planId);
  // Case 20: saving or resetting ordinary encoder settings keeps the native plan.
  await h.s.saveSettings(ordinarySettings); await h.s.resetProfile({ profileId: ordinarySettings.profileId });
  assert.equal(h.s.plan.id, planId); assert.equal(h.s.snapshot().items[0].status, 'ready'); assert.equal(h.s.state.encodingSettingsStale, false);
  // Native file options are fixed.
  const draftId = randomUUID(), fixed = refusal('NATIVE_FILE_OPTIONS_FIXED');
  await refuses(() => h.s.updateFileOperations({ planId, draftId, revision: 0, fileIds: [item.id], overrides: {} }), fixed);
  await refuses(() => h.s.updateBatchOperationDefaults({ planId, draftId, revision: 0, overrides: {} }), fixed);
  await refuses(() => h.s.applyAppDefaultsToBatch({ planId, draftId, revision: 0, resetFileOverrides: false }), fixed);
  await refuses(() => h.s.reprepareEncodingSettings({ planId, draftId, revision: 0, settings: ordinarySettings }), fixed);
  await refuses(() => h.s.setRemuxOmissions({ planId, draftId, revision: 0, decisionIds: [] }), fixed);
  await refuses(() => h.s.setEncodePreservationDecisions({ planId, draftId, revision: 0, decisionIds: [] }), fixed);
  assert.equal(h.s.plan.id, planId);
  // Case 21: choosing the output folder again drops the plan.
  h.folders.output = await h.s.registerFolder(h.output, 'output');
  assert.deepEqual([h.s.plan, h.s.state.phase, h.s.state.items.length], [null, 'idle', 0]);
  // Cancel revokes a ready plan, its tokens and contracts.
  ready = await h.s.prepareNativeFileBatch(h.request());
  const revoked = ready.planId, file = ready.items[0];
  const cancelled = await h.s.cancelCurrent();
  assert.deepEqual([cancelled.phase, cancelled.planId, h.s.plan], ['cancelled', null, null]);
  assert.deepEqual(cancelled.items.map(i => [i.status, i.reason]), [['cancelled', 'Prepared native file batch cancelled. Prepare again to create new authority.']]);
  assert.equal((await reasons(h.s, 'PREPARED_NATIVE_CANCELLED')).length, 1);
  await refuses(() => h.s.startBatch({ planId: revoked, fileIds: [file.id] }), { code: 'STALE_PLAN' });
  assert.throws(() => h.s.getEncodingDetails({ planId: revoked, fileId: file.id }), { code: 'STALE_PLAN' });
  // Native selection changes are allowed again, and a later ordinary batch carries no native state (case 24).
  await h.s.refreshNativeBackends();
  const ordinary = await h.s.prepareBatch({ inputFolderId: h.folders.input.id, outputFolderId: h.folders.output.id, settings: ordinarySettings });
  assert.equal(ordinary.operation, 'encode'); assert.equal(Object.hasOwn(ordinary, 'native'), false); assert.equal(ordinary.phase, 'ready');
  assert.ok(ordinary.items.every(i => !Object.hasOwn(i, 'beta')));
});

test('NS-09c: no token, policy, hash, stage path, argv, executable or destination reaches a snapshot or the details', async t => {
  const files = { 'a.mp4': nativeProbe(), 'b.mp4': nativeProbe({ index: 3 }), 'c.mp4': nativeProbe({ index: 5 }) };
  const h = await harness(t, { files, policies: (fx, runtime) => [nativePolicy({ runtime, native: fx.native, probe: files['a.mp4'], id: 'row-a' }),
    nativePolicy({ runtime, native: fx.native, probe: files['b.mp4'], id: 'row-b', reference: false })],
  onInspect: async (_, name) => { if (name === 'c.mp4') throw Object.assign(new Error('ffprobe failed: C:\\zq-secret\\c.mp4'), { code: 'INVALID_PROBE', stderr: 'zq-secret stderr\n' }); } });
  const seen = []; h.s.on('update', snapshot => seen.push(snapshot));
  const ready = await h.s.prepareNativeFileBatch(h.request()), byName = Object.fromEntries(ready.items.map(item => [item.name, item]));
  assert.deepEqual([byName['c.mp4'].status, byName['c.mp4'].reasonCode, byName['c.mp4'].reason], ['unsupported', 'INVALID_PROBE', text('INVALID_PROBE')]);
  const entry = h.s.plan.entries.get(byName['a.mp4'].id), request = { planId: ready.planId, fileId: byName['a.mp4'].id };
  const selectionEvidenceId = entry.selection.evidenceId;
  assert.deepEqual(entry.evidenceIds, ['synthetic-fixture-not-hardware-proof']); assert.ok(Object.isFrozen(entry.evidenceIds));
  const details = h.s.getEncodingDetails(request);
  assert.deepEqual(Object.keys(details).sort(), ['beta', 'contractId', 'encoderArgs', 'expectedOutput', 'kind', 'label', 'notice', 'profileId', 'settings']);
  assert.equal(details.kind, 'native-description'); assert.deepEqual(details.encoderArgs, [...entry.contract.encoderContribution.args]);
  assert.ok(Object.isFrozen(entry.details)); details.encoderArgs.push('-tampered');
  entry.selection = { ...entry.selection };
  await refuses(() => h.s.startBatch({ planId: ready.planId, fileIds: [byName['a.mp4'].id] }), refusal('NATIVE_FILE_SELECTION_STALE'));
  assert.deepEqual(h.s.getEncodingDetails(request), { ...details, encoderArgs: details.encoderArgs.slice(0, -1) }, 'identical before and after Start');
  const atReady = h.s.snapshot();
  await h.s.cancelCurrent();
  // A failed native preparation as well (the selection is dropped mid-batch).
  const failing = await harness(t, { onInspect: async h => { await h.fx.native.invalidate(); } }), failedSeen = [];
  failing.s.on('update', snapshot => failedSeen.push(snapshot));
  const failed = await failing.s.prepareNativeFileBatch(failing.request());

  const keys = new Set(['executable', 'destination', 'args', 'argv', 'contract', 'policy', 'policyId', 'policyCount', 'sourceSha256', 'sourceProbeFingerprint',
    'nativeCellKey', 'evidenceId', 'evidenceIds', 'selectionEvidenceId', 'cellKey', 'cellId', 'runtimeIdentity', 'reference', 'token', 'nativeSelection', 'selection', 'nativePrivate',
    'ownedRoot', 'details', 'stderr', 'sourceIdentityDiagnostic', 'generationDescription', 'outputId', 'fingerprint']);
  const strings = ['native-file-selection', 'row-a', 'row-b', 'synthetic-reference', 'synthetic-fixture', '-init_hw_device', '-filter_hw_device', '-hide_banner',
    'native-files', '.ffmpeg-encoder-', 'ffenc_', 'zq-secret', 'injected-ffmpeg', selectionEvidenceId, ...entry.evidenceIds, h.runtime.ffmpeg.file, failing.runtime.ffmpeg.file];
  const scan = (value, where, trail = '') => {
    if (typeof value === 'string') {
      assert.doesNotMatch(value, /[a-f0-9]{64}/i, `${where}${trail}`);
      for (const marker of strings) assert.ok(!value.includes(marker), `${where}${trail}: ${marker}`);
    } else if (value && typeof value === 'object') for (const [key, inner] of Object.entries(value)) {
      assert.ok(!keys.has(key), `${where}${trail}.${key}`); scan(inner, where, `${trail}.${key}`);
    }
  };
  assert.ok(seen.length > 4 && failedSeen.length > 2);
  for (const [index, snapshot] of [...seen, ready, atReady, h.s.snapshot()].entries()) scan(snapshot, 'snapshot ' + index);
  for (const [index, snapshot] of [...failedSeen, failed, failing.s.snapshot()].entries()) scan(snapshot, 'failed snapshot ' + index);
  scan(details, 'details');
  assert.equal(failed.error, text('NATIVE_FILE_SELECTION_STALE'));
  // Renderer-readable diagnostics hold the refused file's detail as main-only.
  const records = await Promise.all((await reasons(h.s, 'FILE_INSPECTED')).map(async e => (await h.s.getDiagnosticRecord({ eventId: e.id })).event));
  const record = records.find(e => e.fileId === byName['c.mp4'].id), inspected = record;
  assert.ok(records.filter(e => e.fileId !== byName['c.mp4'].id).every(e => !Object.hasOwn(e.context, 'nativePrivate') || e.context.nativePrivate === '[main-only]'));
  assert.equal(record.context.nativePrivate, '[main-only]'); assert.deepEqual(record.stderr, { withheld: true, bytes: Buffer.byteLength('zq-secret stderr\n') });
  assert.equal(record.message, text('INVALID_PROBE')); assert.doesNotMatch(JSON.stringify(record), /zq-secret/);
  assert.match(fs.readFileSync(path.join(h.stateDir, 'diagnostics-v1', 'events', inspected.id + '.json'), 'utf8'), /zq-secret/);
});

test('NS-09c: a native-owned capability failure publishes fixed text and keeps its message and stderr main-only', async t => {
  const h = await harness(t, { discover: 'uncached' }), seen = [];
  const message = 'spawn failed: ' + h.runtime.ffmpeg.file, stderr = h.stateDir + ' private capability stderr';
  h.s.capabilities = async () => { throw Object.assign(new Error(message), { code: 'EACCES', stderr }); };
  h.s.on('update', snapshot => seen.push(snapshot));
  const native = h.s.prepareNativeFileBatch(h.request());
  // An ordinary joiner cannot change the policy of the native-owned check.
  const ordinary = h.s.getCapabilities();
  await assert.rejects(native, refusal('CAPABILITIES_FAILED'));
  await assert.rejects(ordinary, { code: 'CAPABILITIES_FAILED', message: text('NATIVE_FILE_JOB_FAILED') });
  assert.equal(h.s.snapshot().error, text('NATIVE_FILE_JOB_FAILED')); assert.ok(seen.length >= 2);
  for (const snapshot of seen) assert.ok(snapshot.error === null || snapshot.error === text('NATIVE_FILE_JOB_FAILED'));
  const event = (await reasons(h.s, 'CAPABILITY_FAILED'))[0];
  const record = (await h.s.getDiagnosticRecord({ eventId: event.id })).event;
  const exported = await h.s.getDiagnosticExport({ eventIds: [event.id] });
  assert.equal(record.message, text('NATIVE_FILE_JOB_FAILED')); assert.equal(record.context.nativePrivate, '[main-only]');
  assert.equal(record.context.code, 'NATIVE_FILE_JOB_FAILED'); assert.equal(exported.data.events[0].context.code, 'NATIVE_FILE_JOB_FAILED');
  assert.doesNotMatch(JSON.stringify([record, exported]), /ENOENT|EACCES|EPERM/);
  assert.deepEqual(record.stderr, { withheld: true, bytes: Buffer.byteLength(stderr) });
  assert.doesNotMatch(JSON.stringify(record), /private capability stderr|ffmpeg\.exe/);
  const stored = JSON.parse(await fsp.readFile(path.join(h.stateDir, 'diagnostics-v1', 'events', event.id + '.json'), 'utf8')).event;
  // The original message is main-only; stderr keeps its own bounded, hashed tail like every native event.
  assert.equal(stored.context.nativePrivate.message, message); assert.equal(Object.hasOwn(stored.context.nativePrivate, 'stderr'), false);
  assert.equal(stored.context.nativePrivate.code, 'EACCES');
  assert.equal(stored.stderr.sha256, createHash('sha256').update(stderr).digest('hex'));
  const session = await h.s.diagnostics.readSession(event.sessionId, { limit: 200 });
  assert.deepEqual(session.session.events.find(e => e.id === event.id), record);
});

test('NS-09c: a native joiner keeps an ordinary capability failure ordinary, and public arguments cannot select native policy', async t => {
  const h = await harness(t, { discover: 'uncached' }), seen = [];
  const message = 'ordinary capability failure: ' + h.runtime.ffmpeg.file, stderr = h.input + ' ordinary stderr';
  let release; const barrier = new Promise(resolve => { release = resolve; });
  h.s.capabilities = async () => { await barrier; throw Object.assign(new Error(message), { code: 'SPAWN_FAILED', stderr }); };
  // Start an ordinary check at the idle seam, immediately before native asks
  // for capabilities, so it joins the check rather than starting another one.
  const idle = h.s.requireIdle.bind(h.s); let armed = true, ordinary;
  h.s.requireIdle = () => { idle(); if (armed) { armed = false; ordinary = h.s.getCapabilities(true); } };
  h.s.on('update', snapshot => seen.push(snapshot));
  const native = h.s.prepareNativeFileBatch(h.request());
  const refused = assert.rejects(native, refusal('CAPABILITIES_FAILED'));
  const ordinaryRefused = assert.rejects(ordinary, { code: 'CAPABILITIES_FAILED', message });
  release(); await Promise.all([refused, ordinaryRefused]);
  assert.equal(h.s.state.error, message); assert.ok(seen.some(snapshot => snapshot.error === message));
  const event = (await reasons(h.s, 'CAPABILITY_FAILED'))[0];
  const record = (await h.s.getDiagnosticRecord({ eventId: event.id })).event;
  assert.equal(record.message, message); assert.equal(record.stderr.text, stderr);
  assert.equal(Object.hasOwn(record.context, 'nativePrivate'), false);
});

const cacheInspection = (h, name) => reconstructInspection(h.files[name], { version: 1, mode: 'frames', windows: [{ error: null,
  frames: [{ media_type: 'video', stream_index: h.files[name].streams[0].index, best_effort_timestamp_time: '0', color_transfer: 'bt709' }] }] });
const cacheFor = h => new InspectionCache({ directory: path.join(h.stateDir, 'cache'), ffprobeHash: 'a'.repeat(64) });
const blockedCacheFor = async h => {
  const parent = path.join(h.dir, 'cache-parent-file'); await fsp.writeFile(parent, 'regular file, not a directory');
  return new InspectionCache({ directory: path.join(parent, 'cache'), ffprobeHash: 'a'.repeat(64) });
};

test('NS-09c: every native preparation notice uses fixed text with caching enabled', async t => {
  for (const source of ['inspection-cache warning', 'identity reason', 'service cache warning']) await t.test(source, async t => {
    const h = await harness(t, { cache: source === 'inspection-cache warning' ? blockedCacheFor : cacheFor,
      storage: h => source === 'identity reason' ? { eligible: false, reason: 'EACCES: identity at ' + h.input } : { eligible: true },
      onInspect: cacheInspection }), seen = [];
    if (source === 'service cache warning') h.s.cacheWarning = 'ENOENT: service cache at ' + h.stateDir;
    h.s.on('update', snapshot => seen.push(snapshot));
    const ready = await h.s.prepareNativeFileBatch(h.request());
    assert.equal(ready.phase, 'ready'); assert.equal(ready.items[0].status, 'ready');
    assert.ok(h.s.inspectionCache instanceof InspectionCache); assert.equal(h.counts.inspect, 1);
    assert.equal(ready.preparation.notice, 'Inspection reuse is unavailable; using fresh inspection.');
    for (const snapshot of [...seen, ready]) {
      const notice = snapshot.preparation?.notice;
      if (notice) assert.equal(notice, text('NATIVE_FILE_INSPECTION_REUSE_UNAVAILABLE'));
      assert.doesNotMatch(notice || '', /EACCES|ENOENT|ENOTDIR|[A-Za-z]:[\\/]/);
    }
    if (source === 'inspection-cache warning') {
      assert.match(h.cache.warning, /ENOTDIR|EEXIST/); assert.ok(h.cache.warning.includes(path.join(h.dir, 'cache-parent-file')));
    }
    // Ordinary callers retain the original diagnostic notice.
    await h.s.cancelCurrent();
    const ordinary = await h.s.prepareBatch({ inputFolderId: h.folders.input.id, outputFolderId: h.folders.output.id, settings: ordinarySettings });
    assert.equal(ordinary.phase, 'ready');
    assert.match(ordinary.preparation.notice, source === 'identity reason' ? /EACCES: identity/ : source === 'service cache warning' ? /ENOENT: service cache/ : /ENOTDIR|EEXIST/);
  });
});

test('NS-09c: every native prepare and cancel diagnostic record withholds source, folder, cache and state paths', async t => {
  const files = { 'a.mp4': nativeProbe(), 'b.mp4': nativeProbe({ edit: p => { p.streams[0].width = 1920; } }), 'c.mp4': nativeProbe() };
  const h = await harness(t, { files, cache: blockedCacheFor, storage: () => ({ eligible: true }),
    onInspect: (h, name) => { if (name === 'c.mp4') throw Object.assign(new Error('Cannot inspect ' + path.join(h.input, name)),
      { code: 'INVALID_PROBE', stderr: h.output + ' private stderr' }); return cacheInspection(h, name); } });
  const before = new Set((await h.s.getDiagnosticHistory({ limit: 200 })).events.map(e => e.id));
  const ready = await h.s.prepareNativeFileBatch(h.request());
  assert.deepEqual(ready.items.map(item => item.status), ['ready', 'unsupported', 'unsupported']);
  await h.s.cancelCurrent();
  const events = (await h.s.getDiagnosticHistory({ limit: 200 })).events.filter(e => !before.has(e.id));
  assert.ok(events.some(e => e.reason === 'PREPARATION_STARTED')); assert.ok(events.some(e => e.reason === 'PREPARED_NATIVE_CANCELLED'));
  const paths = [h.dir, h.input, h.output, h.stateDir, h.cache.directory, h.runtime.ffmpeg.file, h.runtime.ffprobe.file];
  const scan = value => {
    if (typeof value === 'string') for (const marker of paths) assert.ok(!value.toLowerCase().includes(marker.toLowerCase()), value);
    else if (value && typeof value === 'object') Object.values(value).forEach(scan);
  };
  const session = (await h.s.diagnostics.readSession(events[0].sessionId, { limit: 200 })).session;
  for (const event of events) {
    const record = (await h.s.getDiagnosticRecord({ eventId: event.id })).event;
    assert.ok(record); scan(record);
    assert.deepEqual(session.events.find(e => e.id === event.id), record);
    if (['FILE_INSPECTED', 'PREPARATION_STARTED'].includes(event.reason)) {
      assert.equal(record.context.nativePrivate, '[main-only]');
      for (const key of ['file', 'input', 'output']) assert.equal(Object.hasOwn(record.context, key), false);
      const stored = JSON.parse(await fsp.readFile(path.join(h.stateDir, 'diagnostics-v1', 'events', event.id + '.json'), 'utf8')).event;
      if (event.reason === 'FILE_INSPECTED') assert.ok(stored.context.nativePrivate.file.startsWith(h.input + path.sep));
      else assert.deepEqual(stored.context.nativePrivate, { input: h.input, output: h.output });
    }
  }
});

test('NS-19: every update belongs to the new preparation in both native/CPU directions', async t => {
  for (const firstNative of [true, false]) await t.test(firstNative ? 'native then CPU' : 'CPU then native', async t => {
    const h = await harness(t), seen = [];
    const cpu = () => h.s.prepareBatch({ inputFolderId: h.folders.input.id, outputFolderId: h.folders.output.id, settings: ordinarySettings });
    const native = () => h.s.prepareNativeFileBatch(h.request());
    h.s.on('update', snapshot => seen.push(snapshot));
    const assertUpdates = (native, ready) => {
      assert.ok(seen.length > 2); assert.equal(seen[0].phase, 'preparing'); assert.deepEqual(seen[0].items, []);
      assert.equal(seen[0].planId, null); assert.equal(seen[0].operationDraft, null);
      for (const snapshot of [...seen, ready]) {
        assert.ok(snapshot.planId === null || snapshot.planId === ready.planId, 'only the new plan is displayed');
        assert.equal(snapshot.encodingSettingsStale, false);
        if (native) assert.equal(snapshot.operationDraft, null);
        else if (snapshot.operationDraft) assert.equal(snapshot.operationDraft.id, ready.operationDraft.id);
        assert.equal(snapshot.operation, native ? 'native-encode' : 'encode');
        assert.deepEqual(snapshot.settings, native ? null : ordinarySettings);
        assert.equal(Object.hasOwn(snapshot, 'native'), native);
        if (native) assert.deepEqual(snapshot.native, ready.native);
        assert.ok(snapshot.items.every(item => native ? !Object.hasOwn(item, 'operationRequest') : !Object.hasOwn(item, 'beta')));
      }
    };
    const first = await (firstNative ? native() : cpu()); assertUpdates(firstNative, first);
    if (firstNative) {
      seen.length = 0; await h.s.cancelCurrent();
      assert.ok(seen.length); assert.ok(seen.every(snapshot => snapshot.operation === 'native-encode' && Object.hasOwn(snapshot, 'native')));
    }
    seen.length = 0;
    h.s.state.encodingSettingsStale = true;
    const second = await (firstNative ? cpu() : native()); assertUpdates(!firstNative, second);
    assert.equal(second.phase, 'ready');
  });
});

test('NS-19: an early native failure clears the previous ordinary draft', async t => {
  const h = await harness(t), seen = [];
  const previous = await h.s.prepareBatch({ inputFolderId: h.folders.input.id, outputFolderId: h.folders.output.id, settings: ordinarySettings });
  assert.ok(previous.operationDraft); assert.ok(previous.planId);
  await fsp.unlink(path.join(h.input, 'a.mp4'));
  h.s.on('update', snapshot => seen.push(snapshot));
  const failed = await h.s.prepareNativeFileBatch(h.request());
  assert.equal(failed.phase, 'failed'); assert.equal(failed.error, text('NO_INPUTS'));
  assert.equal(failed.planId, null); assert.equal(failed.operationDraft, null); assert.equal(h.s.plan, null);
  for (const snapshot of [...seen, h.s.snapshot()]) {
    assert.equal(snapshot.operationDraft, null); assert.notEqual(snapshot.planId, previous.planId);
  }
});
