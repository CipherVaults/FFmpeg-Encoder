'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { registerIpc } = require('../src/ipc.cjs');

async function fixture(t, options = {}) {
  const parent = path.resolve(__dirname, '../artifacts/v0.7/diagnostic-service-tests');
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'case-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output');
  await fs.mkdir(input); await fs.mkdir(output);
  const service = new EncoderService({ ffmpeg: 'injected', ffprobe: 'injected', stateDir: path.join(root, 'state'),
    inspectionCache: null, storageEligibility: { check: async () => ({ eligible: false }) },
    capabilities: async () => ({ profiles: PROFILES.map(p => ({ ...p, available: true, supportedBitDepths: [8, 10] })), versions: {} }),
    inspect: async () => { throw Object.assign(new Error('Specific unsupported track'), { code: 'UNSUPPORTED_STREAM' }); }, ...options });
  t.after(async () => {
    await service.closeDiagnostics();
    assert.equal(path.dirname(await fs.realpath(root)), await fs.realpath(parent));
    await fs.rm(root, { recursive: true });
  });
  const prepare = async () => {
    const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
    return service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 } });
  };
  const records = async () => {
    const { events } = await service.getDiagnosticHistory({ limit: 200 });
    return Promise.all(events.map(async e => (await service.getDiagnosticRecord({ eventId: e.id })).event));
  };
  return { root, input, output, service, prepare, records };
}

test('unsupported-only preparation has durable file/reason evidence without needing a batch encode', async t => {
  const h = await fixture(t);
  await fs.writeFile(path.join(h.input, 'a.mp4'), 'Owned injected source');
  const prepared = await h.prepare();
  assert.equal(prepared.phase, 'ready');
  assert.equal(prepared.items[0].status, 'unsupported');
  const events = await h.records();
  const file = events.find(e => e.reason === 'FILE_INSPECTED');
  assert.equal(file.context.code, 'UNSUPPORTED_STREAM');
  assert.match(file.message, /Specific unsupported track/);
  assert.ok(events.some(e => e.reason === 'PREPARATION_FINISHED'));
  assert.ok(!events.some(e => e.reason === 'ENCODE_STARTED'));
  assert.equal(prepared.diagnostics.available, true);
});

test('empty-folder failure retains exact preparation reason; legacy unbounded logs are not recreated', async t => {
  const h = await fixture(t);
  assert.equal((await h.prepare()).phase, 'failed');
  const failure = (await h.records()).find(e => e.reason === 'PREPARATION_FAILED');
  assert.equal(failure.context.code, 'NO_INPUTS');
  await assert.rejects(fs.stat(path.join(h.root, 'state', 'logs')), { code: 'ENOENT' });
});

test('capability failure remains diagnosable with stderr and code', async t => {
  const h = await fixture(t, { capabilities: async () => { throw Object.assign(new Error('Initialization failed'), { code: 'TOOL_FAILED', stderr: 'owned diagnostic tail' }); } });
  await assert.rejects(h.service.getCapabilities(), { code: 'CAPABILITIES_FAILED' });
  const event = (await h.records()).find(e => e.reason === 'CAPABILITY_FAILED');
  assert.equal(event.context.code, 'TOOL_FAILED');
  assert.equal(event.stderr.text, 'owned diagnostic tail');
});

test('concurrent capability requests await device discovery and receive detached descriptions only', async t => {
  let entered, release;
  const entering = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const registry = { privateAuthority: true };
  const h = await fixture(t, { discoverBackends: async () => { entered(); await held; return { registry,
    display: { profiles: [{ state: 'unavailable', reason: 'MISSING_DEVICE' }] } }; } });
  const first = h.service.getCapabilities(); await entering;
  let finished = false; const second = h.service.getCapabilities().then(value => { finished = true; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(finished, false);
  release(); const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, b); assert.equal(h.service.nativeCapabilities, registry);
  a.backendDiscovery.profiles[0].state = 'invented';
  assert.equal(h.service.getRuntimeInformation().backendDiscovery.profiles[0].state, 'unavailable');
  assert.equal(JSON.stringify(b).includes('privateAuthority'), false);
});

test('cancellation during native discovery drains the task and cannot cache partial availability', async t => {
  let entered; const entering = new Promise(resolve => { entered = resolve; });
  const h = await fixture(t, { discoverBackends: async ({ signal }) => { entered();
    await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
    throw Object.assign(new Error('Discovery cancelled'), { code: 'CANCELLED' }); } });
  const request = h.service.getCapabilities(); const rejected = assert.rejects(request, { code: 'CAPABILITIES_FAILED' });
  await entering; await h.service.cancelCurrent(); await rejected;
  assert.equal(h.service.capabilityResult, null); assert.equal(h.service.nativeCapabilities, null);
  assert.equal(h.service.snapshot().phase, 'cancelled');
  h.service.discoverBackends = async () => ({ registry: {}, display: { profiles: [] } });
  assert.ok((await h.service.getCapabilities()).backendDiscovery);
});

test('failed durable startup retries and remains visibly incomplete rather than inventing persistence', async t => {
  let starts = 0;
  const diagnostics = { startSession: async () => ({ persisted: ++starts > 1, recovered: [] }), snapshot: () => ({ available: starts > 1 }),
    append: async () => ({ persisted: starts > 1 }), closeSession: async () => ({ persisted: true }) };
  const h = await fixture(t, { diagnostics });
  await h.service.initializeDiagnostics();
  assert.match(h.service.snapshot().diagnosticWarning, /incomplete/);
  const result = await h.service.recordIncident({ stage: 'admission', reason: 'RETRY_PROOF' });
  assert.equal(result.persisted, true); assert.equal(starts, 2);
  assert.match(h.service.snapshot().diagnosticWarning, /incomplete/, 'earlier lost history is not retroactively repaired');
});

test('diagnostic IPC rejects path requests and foreign frames without persisting arbitrary attack payloads', async t => {
  const h = await fixture(t);
  const handlers = new Map(), frame = { url: 'app://encoder/index.html' };
  const window = { isDestroyed: () => false, webContents: { mainFrame: frame } };
  const event = { sender: window.webContents, senderFrame: frame };
  registerIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn), removeHandler() {} }, window, service: h.service, dialog: {}, entryUrl: frame.url });
  const read = handlers.get('encoder:diagnostic-record');
  assert.equal((await read({ ...event, sender: {} }, { eventId: 'C:\\secret.txt' })).error.code, 'UNTRUSTED_SENDER');
  assert.equal((await read(event, { eventId: 'C:\\secret.txt' })).error.code, 'INVALID_DIAGNOSTIC_REQUEST');
  assert.equal((await read(event, { eventId: 'x', filename: 'C:\\secret.txt' })).error.code, 'INVALID_REQUEST');
  const events = await h.records();
  assert.ok(events.some(e => e.reason === 'REQUEST_REJECTED'));
  assert.equal(JSON.stringify(events).includes('secret.txt'), false);
});

test('rejected state-directory initialization recovers without replacing the service', async t => {
  const h = await fixture(t);
  // Block just the owned directory with an ordinary file, then remove that
  // known fixture obstruction. No global fs mock masks the real mkdir failure.
  await fs.writeFile(h.service.stateDir, 'owned obstruction');
  await assert.rejects(h.service.initializeDiagnostics());
  assert.match(h.service.snapshot().diagnosticWarning, /incomplete/);
  await fs.unlink(h.service.stateDir);
  assert.equal((await h.service.recordIncident({ stage: 'admission', reason: 'AFTER_MKDIR_RECOVERY' })).persisted, true);
  assert.ok((await h.records()).some(event => event.reason === 'AFTER_MKDIR_RECOVERY'));
});

test('inspection failure keeps its bounded child diagnostic in the file incident', async t => {
  const h = await fixture(t, { inspect: async () => { throw Object.assign(new Error('Inspection failed'),
    { code: 'INVALID_PROBE', stderr: 'x'.repeat(8000) + '\nprecise child failure' }); } });
  await fs.writeFile(path.join(h.input, 'a.mp4'), 'owned source');
  const state = await h.prepare();
  assert.equal(state.items[0].details.length, 4000);
  const event = (await h.records()).find(event => event.reason === 'FILE_INSPECTED');
  assert.match(event.stderr.text, /precise child failure/);
  assert.equal(event.stderr.text.length, 8022);
  assert.equal(event.stderr.truncated, false);
  assert.equal(event.context.code, 'INVALID_PROBE');
});

test('upstream capture accounting survives inspection and capability journaling', async t => {
  const stderr = 'end of a much longer diagnostic';
  const stderrCapture = { totalBytes: 900000, truncated: true };
  const h = await fixture(t, { inspect: async () => { throw Object.assign(new Error('Inspection failed'),
    { code: 'INVALID_PROBE', stderr, stderrCapture }); } });
  await fs.writeFile(path.join(h.input, 'a.mp4'), 'owned source'); await h.prepare();
  const event = (await h.records()).find(event => event.reason === 'FILE_INSPECTED');
  assert.equal(event.stderr.truncated, true); assert.equal(event.stderr.totalBytes, 900000);
  const other = await fixture(t, { capabilities: async () => { throw Object.assign(new Error('Capability failed'),
    { code: 'TOOL_FAILED', stderr, stderrCapture }); } });
  await assert.rejects(other.service.getCapabilities());
  const cap = (await other.records()).find(event => event.reason === 'CAPABILITY_FAILED');
  assert.equal(cap.stderr.truncated, true); assert.equal(cap.stderr.totalBytes, 900000);
});

test('Help and exported incidents use only actually observed runtime versions, including partial failure', async t => {
  const h = await fixture(t, { capabilities: async () => { throw Object.assign(new Error('ffprobe could not launch'),
    { code: 'SPAWN_FAILED', runtimeVersions: { ffmpeg: 'ffmpeg version 9.0.2-full_build-www.gyan.dev Copyright test' } }); } });
  assert.equal(h.service.getRuntimeInformation().media.ffmpeg.status, 'not-yet-observed');
  await assert.rejects(h.service.getCapabilities());
  const info = h.service.getRuntimeInformation();
  assert.equal(info.appVersion, require('../package.json').version);
  assert.equal(info.media.ffmpeg.version, '9.0.2-full_build-www.gyan.dev');
  assert.equal(info.media.ffprobe.status, 'not-yet-observed');
  const event = (await h.records()).find(event => event.reason === 'RUNTIME_IDENTIFIED');
  const exported = await h.service.getDiagnosticExport({ eventIds: [event.id] });
  assert.equal(exported.data.events[0].context.runtimeVersions.ffmpeg, info.media.ffmpeg.version);
  assert.equal(Object.hasOwn(exported.data.events[0].context.runtimeVersions, 'ffprobe'), false);
});

test('main-owned App Settings persist without mutating a frozen prepared or running plan', async t => {
  const h = await fixture(t);
  const before = await h.service.getAppSettings();
  const plan = Object.freeze({ id: 'test-frozen-plan', settings: Object.freeze({ profileId: 'h265-cpu', quality: 25 }) });
  h.service.plan = plan; h.service.state.phase = 'running';
  const after = await h.service.saveAppSettings({ revision: before.revision,
    defaults: { ...before.defaults, rangeAudioPolicy: 'precision-flac', previewExpanded: true } });
  assert.equal(after.revision, before.revision + 1); assert.equal(h.service.plan, plan);
  assert.equal(h.service.snapshot().phase, 'running');
  const { AppSettings } = require('../src/app-settings.cjs');
  assert.deepEqual((await new AppSettings({ directory: h.service.stateDir }).load()).defaults, after.defaults);
  await assert.rejects(h.service.saveAppSettings({ revision: before.revision, defaults: before.defaults }), { code: 'APP_SETTINGS_REVISION_CONFLICT' });
  assert.equal((await h.service.resetAppSettings({ revision: after.revision })).defaults.rangeAudioPolicy, 'precision-aac');
  assert.equal(h.service.plan, plan);
});

test('shutdown waits for an owned settings write and its incident; a failed reset also drains', async t => {
  let finishSave, finishReceipt, failReset;
  const saveWait = new Promise(resolve => { finishSave = resolve; });
  const receiptWait = new Promise(resolve => { finishReceipt = resolve; });
  const resetWait = new Promise((resolve, reject) => { failReset = reject; });
  const h = await fixture(t, { appSettings: { save: () => saveWait, reset: () => resetWait } });
  h.service.recordIncident = () => receiptWait;
  const saving = h.service.saveAppSettings({});
  let closed = false;
  const closing = h.service.cancelCurrent().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false);
  finishSave({ revision: 1 });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, false, 'the diagnostic receipt is part of the owned operation');
  finishReceipt({ persisted: true }); await saving; await closing;
  assert.equal(h.service.appSettingsMutations.size, 0);
  const resetting = assert.rejects(h.service.resetAppSettings({}), /owned write failure/);
  const closingAgain = h.service.cancelCurrent();
  failReset(new Error('owned write failure'));
  await resetting; await closingAgain;
  assert.equal(h.service.appSettingsMutations.size, 0);
});
