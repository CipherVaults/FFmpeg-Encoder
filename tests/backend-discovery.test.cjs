'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { discoverNativeBackends, wrapperObservations } = require('../src/backend-discovery.cjs');
const { NATIVE_PROFILES } = require('../src/backend-adapters.cjs');

const runtime = Object.fromEntries(['ffmpeg', 'ffprobe'].map(name => [name, { sha256: 'a'.repeat(64), version: `${name} version 9.0.2` }]));
const listing = 'Encoders:\n' + NATIVE_PROFILES.map(profile => ` V....D ${profile.encoder} Native video`).join('\n');
const adapter = { description: 'Test AMD', backendCandidate: 'amf', software: false, adapterIndex: 0, vendorId: 0x1002, luid: '00000000:00000001', umdVersion: '32.0.0.1' };

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
  assert.equal(result.display.profiles.find(profile => profile.profileId === 'h265-amf').state, 'discovered');
  assert.equal(result.display.profiles.find(profile => profile.profileId === 'h265-qsv').reason, 'DEVICE_DISCOVERY_INCOMPLETE');
  assert.ok(result.display.profiles.every(profile => profile.available === false));
  assert.deepEqual(result.display.cells, []);
});
