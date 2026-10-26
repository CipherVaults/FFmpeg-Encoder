'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createNativeBackendControls } = require('../src/native-backend-controls.cjs');
const { NATIVE_PROFILES } = require('../src/backend-adapters.cjs');
function harness({ persisted = true, initialFailure = false } = {}) {
  const calls = [], deviceId = randomUUID(), token = {}, runtime = { ffmpeg: path.resolve('injected-ffmpeg'), ffprobe: path.resolve('injected-ffprobe'),
    verified: [{ sha256: 'a'.repeat(64) }, { sha256: 'b'.repeat(64) }] };
  const stateDir = path.resolve('artifacts/native-controls-tests', randomUUID());
  const environment = () => ({ schema: 1, evidenceId: randomUUID(), observedAt: Date.now(),
    runtime: { ffmpeg: { sha256: 'a'.repeat(64), version: 'ffmpeg version test' }, ffprobe: { sha256: 'b'.repeat(64), version: 'ffprobe version test' } },
    wrappers: Object.fromEntries(NATIVE_PROFILES.map(profile => [profile.encoder, 'present'])), inventory: { status: 'complete',
      devices: [{ id: deviceId, backend: 'qsv', vendorId: '0x8086', adapterIndex: 1, adapterIdentity: 'qsv:luid:00000000:00001234', driverVersion: '32.0.1.2', runtimeVersion: '1.35.0' }] } });
  class Probe {
    constructor(options) { calls.push('constructed'); assert.equal(options.ownedRoot, path.join(stateDir, 'native-probes')); }
    async initialize() { calls.push('initialize'); return initialFailure
      ? { status: 'untested', reason: 'INITIALIZATION_FAILED', failure: { code: 'INITIALIZATION_FAILED' }, invocations: [{ status: 'failed' }], initialization: null }
      : { status: 'observed', initialization: token }; }
    async probe() { calls.push('probe'); return { status: 'untested' }; }
  }
  const controls = createNativeBackendControls({ runtime, stateDir, Probe,
    acquireMediaSlot: () => { throw new Error('No real slot is used by this injected test.'); },
    retainInitialization: async report => { if (!initialFailure) assert.equal(report.initialization, token); calls.push('retained'); return { persisted }; },
    discover: async options => { calls.push('discovery'); assert.equal(options.ffmpeg, runtime.ffmpeg); assert.equal(options.runtime.ffmpeg.sha256, 'a'.repeat(64));
      if (options.initialization) { assert.equal(options.initialization, token); calls.push('bootstrap-consumed'); }
      return { registry: options.registry, environment: environment(), display: { profiles: [], devices: [{ id: deviceId, description: 'Injected Intel device' }] } };
    } });
  const refresh = () => controls.discoverBackends({ versions: { ffmpeg: 'ffmpeg version test', ffprobe: 'ffprobe version test' } });
  const choose = () => controls.nativeBackends.select({ revision: controls.nativeBackends.snapshot().revision, profileId: 'h264-qsv', bitDepth: 8,
    settings: { deviceId, preset: 'medium', mode: 'icq', quality: 25 } });
  return { calls, controls, refresh, choose };
}
test('real probe construction accepts the projected verified runtime without collectors or filesystem allocation', () => {
  const stateDir = path.resolve('artifacts/native-controls-tests', randomUUID());
  const controls = createNativeBackendControls({ stateDir,
    runtime: { ffmpeg: path.resolve('injected-ffmpeg'), ffprobe: path.resolve('injected-ffprobe'),
      verified: [{ sha256: 'a'.repeat(64) }, { sha256: 'b'.repeat(64) }], manifest: { extra: true } },
    acquireMediaSlot() { throw new Error('No acquisition during construction.'); },
    retainInitialization() { throw new Error('No retention during construction.'); },
    discover() { throw new Error('No discovery during construction.'); } });
  assert.equal(controls.nativeBackends.snapshot().fileExecutionReady, false);
  assert.equal(require('node:fs').existsSync(stateDir), false);
});
test('main composition is inert before capabilities and uses one registry with labeled opaque device choices', async () => {
  const h = harness(); assert.deepEqual(h.calls, ['constructed']);
  await assert.rejects(h.controls.nativeBackends.refresh(), { code: 'NATIVE_RUNTIME_UNOBSERVED' });
  const first = await h.refresh(), second = await h.refresh(); assert.equal(first.registry, second.registry);
  const state = h.controls.nativeBackends.snapshot(); assert.equal(state.devices[0].description, 'Injected Intel device');
  assert.equal(state.devices[0].adapterIndex, undefined); assert.equal(state.devices[0].adapterIdentity, undefined);
  assert.equal(state.fileExecutionReady, false);
});
test('initialization capture retention precedes bootstrap consumption and probe scheduling', async () => {
  const h = harness(); await h.refresh(); const selected = h.choose();
  await h.controls.nativeBackends.qualify({ selectionId: selected.selection.selectionId, revision: selected.revision });
  assert.ok(h.calls.indexOf('retained') < h.calls.indexOf('bootstrap-consumed'));
  assert.ok(h.calls.indexOf('bootstrap-consumed') < h.calls.indexOf('probe'));
});
test('unconfirmed initializer persistence cannot consume a bootstrap or schedule a probe', async () => {
  const h = harness({ persisted: false }); await h.refresh(); const selected = h.choose();
  const result = await h.controls.nativeBackends.qualify({ selectionId: selected.selection.selectionId, revision: selected.revision });
  assert.equal(result.lastOutcome.reason, 'NATIVE_INITIALIZATION_NOT_RETAINED');
  assert.ok(!h.calls.includes('bootstrap-consumed')); assert.ok(!h.calls.includes('probe')); assert.equal(result.fileExecutionReady, false);
});
test('a redirected state root is refused before creating a native directory in its destination', async t => {
  const fs = require('node:fs/promises'), root = path.resolve('artifacts/native-controls-tests', randomUUID());
  const redirected = path.join(root, 'redirected'), stateDir = path.join(root, 'state'); await fs.mkdir(redirected, { recursive: true });
  try { await fs.symlink(redirected, stateDir, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)
      || error.code === 'UNKNOWN' && error.errno === -4094 && error.syscall === 'symlink') {
    t.skip('Host refused creation of the real link fixture: ' + error.code + '/' + error.errno); return;
  } throw error; }
  let slotOptions, releases = 0;
  class Probe { constructor(options) { slotOptions = options; } initialize() {} probe() {} }
  createNativeBackendControls({ stateDir, Probe,
    runtime: { ffmpeg: path.resolve('injected-ffmpeg'), ffprobe: path.resolve('injected-ffprobe'), verified: [] },
    acquireMediaSlot: async () => ({ release: async () => { releases++; } }), retainInitialization() {} });
  await assert.rejects(slotOptions.acquireMediaSlot({ signal: new AbortController().signal }));
  assert.equal(releases, 1); assert.equal(require('node:fs').existsSync(path.join(redirected, 'native-probes')), false);
});
test('the production allocation callback releases its slot and performs no mkdir when the ancestor guard refuses', async () => {
  const fs = require('node:fs'), vm = require('node:vm'), { createRequire } = require('node:module');
  const filename = path.resolve(__dirname, '../src/native-backend-controls.cjs'), actualRequire = createRequire(filename), calls = [];
  let options;
  class Probe { constructor(value) { options = value; } initialize() {} probe() {} }
  const output = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: output, require(name) {
    if (name === 'node:fs/promises') return { mkdir: async () => { calls.push('mkdir'); } };
    if (name === './candidate-runtime.cjs') return { assertOrdinaryPath: async () => { calls.push('guard'); throw new Error('Injected redirected ancestor refusal'); } };
    if (name === './native-backend-service.cjs') return { NativeBackendService: class { constructor(value) { value.createProbe({ registry: value.registry, observeEnvironment() {} }); } } };
    return actualRequire(name);
  } }, { filename });
  output.exports.createNativeBackendControls({ stateDir: path.resolve('artifacts/native-controls-tests/injected-root'), Probe,
    runtime: { ffmpeg: path.resolve('injected-ffmpeg'), ffprobe: path.resolve('injected-ffprobe'), verified: [] },
    acquireMediaSlot: async () => ({ release: async () => { calls.push('release'); } }), retainInitialization() {} });
  await assert.rejects(options.acquireMediaSlot({ signal: new AbortController().signal }), /redirected ancestor refusal/);
  assert.deepEqual(calls, ['guard', 'release']);
});
test('failed initializer captures are retained, and persistence failure preserves their original outcome', async () => {
  for (const persisted of [true, false]) {
    const h = harness({ persisted, initialFailure: true }); await h.refresh(); const selected = h.choose();
    const result = await h.controls.nativeBackends.qualify({ selectionId: selected.selection.selectionId, revision: selected.revision });
    assert.ok(h.calls.includes('retained')); assert.ok(!h.calls.includes('bootstrap-consumed')); assert.ok(!h.calls.includes('probe'));
    assert.equal(result.lastOutcome.reason, 'INITIALIZATION_FAILED');
    assert.equal(result.lastOutcome.persistenceFailure, persisted ? undefined : 'NATIVE_INITIALIZATION_NOT_RETAINED');
  }
});
