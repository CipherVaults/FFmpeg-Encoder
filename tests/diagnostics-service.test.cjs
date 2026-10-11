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
  assert.equal(event.context.code, 'INVALID_PROBE');
});
