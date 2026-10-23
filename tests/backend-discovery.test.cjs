'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverNativeBackends, wrapperObservations } = require('../src/backend-discovery.cjs');
const { NATIVE_PROFILES } = require('../src/backend-adapters.cjs');
const { captureNativeInitialization, nativeInitializationArgs } = require('../src/backend-observation.cjs');
const { createHash, randomUUID } = require('node:crypto');

const runtime = Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => [name, { sha256: 'a'.repeat(64), version: `${name} version 9.0.2` }]));
const listing = 'Encoders:\n' + NATIVE_PROFILES.map(profile => ` V....D ${profile.encoder} Native video`).join('\n');
const adapter = { description: 'Test AMD', backendCandidate: 'amf', software: false, adapterIndex: 0, vendorId: 0x1002,
  deviceId: 0x1234, luid: '00000000:00000001', umdVersion: '32.0.0.1' };

test('only a complete bounded actual wrapper listing produces present/absent observations', () => {
  assert.ok(Object.values(wrapperObservations({ stdout: listing })).every(value => value === 'present'));
  assert.equal(wrapperObservations({ stdout: 'Encoders:\n V....D libx264 Video' }).hevc_amf, 'absent');
  for (const result of [{ stdout: listing, stdoutCapture: { truncated: true } }, { stdout: 'hevc_amf' }, { stdout: 'Encoders:\n' }]) {
    assert.throws(() => wrapperObservations(result), { code: 'NATIVE_WRAPPER_DISCOVERY_INVALID' });
  }
});

test('device discovery never qualifies encoding or invents vendor runtime identity', async () => {
  const calls = [];
  const result = await discoverNativeBackends({ ffmpeg: 'fixed-executable', runtime,
    run: async (exe, args) => { calls.push({ exe, args }); return { stdout: listing }; },
    adapters: async () => ({ status: 'complete', adapters: [adapter] }) });
  assert.deepEqual(calls, [{ exe: 'fixed-executable', args: ['-hide_banner', '-encoders'] }]);
  assert.equal(result.display.profiles.find(p => p.profileId === 'h265-amf').state, 'discovered');
  assert.equal(result.display.profiles.find(p => p.profileId === 'h265-qsv').reason, 'MISSING_DEVICE');
  assert.ok(result.display.profiles.every(p => p.available === false));
  assert.deepEqual(result.display.cells, []);
  assert.match(result.display.limitations.join(' '), /initialization.*qualification/);
});

test('complete empty inventory differs from unavailable discovery and failed wrapper query', async () => {
  for (const status of ['complete', 'unavailable']) {
    const result = await discoverNativeBackends({ ffmpeg: 'fixed', runtime,
      run: async () => { throw new Error('failed wrapper query'); }, adapters: async () => ({ status, adapters: [] }) });
    assert.equal(result.display.profiles[0].reason, status === 'complete' ? 'MISSING_DEVICE' : 'DEVICE_DISCOVERY_INCOMPLETE');
    assert.ok(Object.values(result.display.wrappers).every(value => value === 'unobserved'));
    assert.ok(result.display.notices.length >= 1);
  }
});

test('descriptive discovery remains available for missing runtime identities without activating native support', async () => {
  const result = await discoverNativeBackends({ ffmpeg: 'fixed', runtime: { ffmpeg: null, ffprobe: null },
    run: async () => ({ stdout: listing }), adapters: async () => ({ status: 'complete', adapters: [adapter] }) });
  assert.ok(result.display.profiles.every(profile => profile.reason === 'MISSING_RUNTIME' && !profile.available));
});

test('cancelled wrapper/helper work cannot produce discovery evidence', async () => {
  const controller = new AbortController(); let helper = false;
  await assert.rejects(discoverNativeBackends({ ffmpeg: 'fixed', runtime, signal: controller.signal,
    run: async () => { controller.abort(); throw Object.assign(new Error('cancel'), { code: 'CANCELLED' }); },
    adapters: async () => { helper = true; } }), { code: 'CANCELLED' });
  assert.equal(helper, false);
});

test('abort during adapter discovery waits for helper closure and publishes no partial evidence', async () => {
  const controller = new AbortController();
  let enterHelper, closeHelper, observed = 0, settled = false;
  const entered = new Promise(resolve => { enterHelper = resolve; });
  const closed = new Promise(resolve => { closeHelper = resolve; });
  const result = discoverNativeBackends({ ffmpeg: 'fixed', runtime, signal: controller.signal,
    run: async () => ({ stdout: listing }),
    adapters: async ({ signal }) => {
      assert.equal(signal, controller.signal);
      enterHelper();
      await closed;
      return { status: 'partial', adapters: [adapter] };
    },
    registry: { observeDiscovery: () => { observed++; throw new Error('Cancelled observation must not be admitted'); } },
  });
  // An abort requests termination; it must not release the owning operation
  // before the discovery helper's promise reports its closed lifecycle.
  result.then(() => { settled = true; }, () => { settled = true; });
  await entered;
  controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  assert.equal(observed, 0);
  closeHelper();
  await assert.rejects(result, { code: 'CANCELLED' });
  assert.equal(observed, 0);
});

test('partial adapter evidence never claims that missing devices are conclusively absent', async () => {
  const result = await discoverNativeBackends({ ffmpeg: 'fixed', runtime,
    run: async () => ({ stdout: listing }),
    adapters: async () => ({ status: 'partial', adapters: [adapter] }) });
  assert.equal(result.display.inventory.status, 'partial');
  assert.equal(result.display.profiles.find(profile => profile.profileId === 'h265-amf').state, 'untested');
  assert.equal(result.display.profiles.find(profile => profile.profileId === 'h265-qsv').reason, 'DEVICE_DISCOVERY_INCOMPLETE');
  assert.ok(result.display.profiles.every(profile => profile.available === false));
  assert.deepEqual(result.display.cells, []);
});

test('unchanged complete rediscovery keeps bounded session handles; restart/removal never restore them', async () => {
  const options = { ffmpeg: 'fixed', runtime, run: async () => ({ stdout: listing }),
    adapters: async () => ({ status: 'complete', adapters: [adapter] }) };
  const first = await discoverNativeBackends(options), device = first.environment.inventory.devices[0];
  const second = await discoverNativeBackends({ ...options, registry: first.registry });
  assert.equal(second.environment.inventory.devices[0].id, device.id);
  assert.notEqual(second.environment.evidenceId, first.environment.evidenceId);
  const restarted = await discoverNativeBackends(options);
  assert.notEqual(restarted.environment.inventory.devices[0].id, device.id);
  await discoverNativeBackends({ ...options, registry: first.registry, adapters: async () => ({ status: 'complete', adapters: [] }) });
  const returned = await discoverNativeBackends({ ...options, registry: first.registry });
  assert.notEqual(returned.environment.inventory.devices[0].id, device.id);
});

test('explicit captured initialization binds an API observation only, survives unchanged refresh and expires on driver change', async () => {
  const intel = { ...adapter, description: 'Test Intel', vendorId: 0x8086, backendCandidate: 'qsv' };
  const options = { ffmpeg: 'fixed', runtime, run: async () => ({ stdout: listing }),
    adapters: async () => ({ status: 'complete', adapters: [intel] }) };
  const first = await discoverNativeBackends(options), registry = first.registry, device = first.environment.inventory.devices[0];
  const request = { operation: 'encode', profileId: 'h265-qsv', settings: { preset: 'medium', mode: 'icq', quality: 25, deviceId: device.id },
    bitDepth: 8, transformId: 'none-v1', signal: 'sdr', container: 'matroska' };
  const old = registry.ensureCell(request), after = await discoverNativeBackends({ ...options, registry });
  const argv = nativeInitializationArgs(first.environment, device.id);
  const stderr = '[AVHWDeviceContext @ aaaa] [verbose] Selecting d3d11va adapter 0\n'
    + '[AVHWDeviceContext @ aaaa] [info] Using device 8086:1234 (Test Intel).\n'
    + '[AVHWDeviceContext @ bbbb] [verbose] Initialize MFX session: implementation version is 2.12\n';
  const initialization = captureNativeInitialization({ before: first.environment, after: after.environment, deviceId: device.id, stderr,
    stderrCapture: { totalBytes: Buffer.byteLength(stderr), truncated: false }, invocation: { kind: 'initialization', invocationId: randomUUID(),
      executableSha256: runtime.ffmpeg.sha256, argv, argvSha256: createHash('sha256').update(JSON.stringify(argv)).digest('hex'), close: { code: 0, signal: null } } });
  await assert.rejects(discoverNativeBackends({ ...options, registry, initialization: JSON.parse(JSON.stringify(initialization)) }), { code: 'NATIVE_INITIALIZATION_UNTRUSTED' });
  const initialized = await discoverNativeBackends({ ...options, registry, initialization });
  assert.equal(initialized.environment.inventory.devices[0].runtimeVersion, 'mfx-api:2.12');
  assert.equal(registry.getCell({ cellId: old.cellId }).state, 'stale');
  const cell = registry.ensureCell(request); assert.equal(cell.state, 'discovered'); assert.equal(cell.available, false);
  assert.match(initialized.display.initializationObservation.assurance.runtime, /API-major-minor/);
  await assert.rejects(discoverNativeBackends({ ...options, registry, initialization }), { code: 'NATIVE_INITIALIZATION_UNTRUSTED' });
  const stable = await discoverNativeBackends({ ...options, registry });
  assert.equal(stable.environment.inventory.devices[0].id, device.id);
  assert.equal(stable.environment.inventory.devices[0].runtimeVersion, 'mfx-api:2.12');
  const changed = await discoverNativeBackends({ ...options, registry,
    adapters: async () => ({ status: 'complete', adapters: [{ ...intel, umdVersion: '32.0.0.2' }] }) });
  assert.equal(changed.environment.inventory.devices[0].id, device.id);
  assert.equal(changed.environment.inventory.devices[0].runtimeVersion, 'unresolved');
  assert.equal(registry.getCell({ cellId: cell.cellId }).reason, 'DRIVER_CHANGED');
});

test('held initialization receipts reject every intervening observation, including restored removal, partial, driver and runtime states', async () => {
  const intel = { ...adapter, description: 'Test Intel', vendorId: 0x8086, backendCandidate: 'qsv' };
  for (const transition of ['unchanged', 'partial', 'removed-returned', 'driver-restored', 'runtime-restored']) {
    const options = { ffmpeg: 'fixed', runtime, run: async () => ({ stdout: listing }),
      adapters: async () => ({ status: 'complete', adapters: [intel] }) };
    const before = await discoverNativeBackends(options), registry = before.registry;
    const after = await discoverNativeBackends({ ...options, registry }), deviceId = before.environment.inventory.devices[0].id;
    const argv = nativeInitializationArgs(before.environment, deviceId);
    const stderr = '[AVHWDeviceContext @ aaaa] [verbose] Selecting d3d11va adapter 0\n'
      + '[AVHWDeviceContext @ aaaa] [info] Using device 8086:1234 (Test Intel).\n'
      + '[AVHWDeviceContext @ bbbb] [verbose] Initialize MFX session: implementation version is 2.12\n';
    const initialization = captureNativeInitialization({ before: before.environment, after: after.environment, deviceId, stderr,
      stderrCapture: { totalBytes: Buffer.byteLength(stderr), truncated: false }, invocation: { kind: 'initialization', invocationId: randomUUID(),
        executableSha256: runtime.ffmpeg.sha256, argv, argvSha256: createHash('sha256').update(JSON.stringify(argv)).digest('hex'), close: { code: 0, signal: null } } });
    const intermediate = transition === 'partial' ? { adapters: async () => ({ status: 'partial', adapters: [intel] }) }
      : transition === 'removed-returned' ? { adapters: async () => ({ status: 'complete', adapters: [] }) }
        : transition === 'driver-restored' ? { adapters: async () => ({ status: 'complete', adapters: [{ ...intel, umdVersion: '32.0.0.2' }] }) }
          : transition === 'runtime-restored' ? { runtime: { ...runtime, ffmpeg: { ...runtime.ffmpeg, sha256: 'f'.repeat(64) } } } : {};
    await discoverNativeBackends({ ...options, registry, ...intermediate });
    if (transition !== 'unchanged') await discoverNativeBackends({ ...options, registry });
    await assert.rejects(discoverNativeBackends({ ...options, registry, initialization }), { code: 'NATIVE_INITIALIZATION_STALE' }, transition);
    assert.ok(registry.snapshot().profiles.every(profile => !profile.available));
    await assert.rejects(discoverNativeBackends({ ...options, registry, initialization }), { code: 'NATIVE_INITIALIZATION_UNTRUSTED' });
  }
});
