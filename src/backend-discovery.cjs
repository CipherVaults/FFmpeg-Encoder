'use strict';

const { randomUUID, createHash } = require('node:crypto');
const { runTool, ToolError } = require('./process-runner.cjs');
const { queryWindowsAdapters } = require('./windows-adapters.cjs');
const { NativeCapabilityRegistry } = require('./backend-capabilities.cjs');
const { NATIVE_PROFILES } = require('./backend-adapters.cjs');
const { bindDiscoveryInventory, consumeNativeInitialization } = require('./backend-observation.cjs');

// Session-only handles survive ordinary rediscovery, never restart or removal
// from a complete inventory. Driver/ordinal/runtime remain independently bound
// and invalidate cells; changing a descriptor must not silently change its ID.
const sessions = new WeakMap();
const runtimeKey = (runtime, adapter) => createHash('sha256').update(JSON.stringify({ runtime,
  identity: { luid: adapter.luid, adapterIndex: adapter.adapterIndex, vendorId: adapter.vendorId,
    deviceId: adapter.deviceId, description: adapter.description, driver: adapter.umdVersion } })).digest('hex');

// Discovery is deliberately separate from qualification. A compiled wrapper or
// DXGI adapter never enables an encoder, chooses a substitute, or proves that a
// driver accepted a rate-control mode. The registry retains that distinction.
function wrapperObservations(result) {
  if (result?.stdoutCapture?.truncated || typeof result?.stdout !== 'string'
      || Buffer.byteLength(result.stdout) > 1024 * 1024 || !/^Encoders:\s*$/m.test(result.stdout)) {
    throw new ToolError('NATIVE_WRAPPER_DISCOVERY_INVALID', 'The complete encoder inventory was not observed.');
  }
  const names = new Set([...result.stdout.matchAll(/^\s*V[.A-Z]{5}\s+([a-zA-Z0-9_]+)\s+/gm)].map(match => match[1]));
  if (!names.size) throw new ToolError('NATIVE_WRAPPER_DISCOVERY_INVALID', 'The video encoder inventory was empty or malformed.');
  return Object.fromEntries(NATIVE_PROFILES.map(profile => [profile.encoder, names.has(profile.encoder) ? 'present' : 'absent']));
}

async function discoverNativeBackends({ ffmpeg, runtime, signal, run = runTool, adapters = queryWindowsAdapters,
  registry = new NativeCapabilityRegistry(), initialization = null }) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Backend discovery cancelled.');
  let wrappers = Object.fromEntries(NATIVE_PROFILES.map(profile => [profile.encoder, 'unobserved']));
  const notices = [];
  try {
    wrappers = wrapperObservations(await run(ffmpeg, ['-hide_banner', '-encoders'],
      { signal, timeoutMs: 20000, stdoutLimit: 1024 * 1024, stderrLimit: 8192 }));
  } catch (error) {
    if (signal?.aborted || error.code === 'CANCELLED') throw error;
    notices.push('Encoder-wrapper discovery is incomplete. ' + String(error.message).slice(0, 1024));
  }
  // Serial with the FFmpeg observation and the existing capability operation.
  // Shutdown uses the same abort signal and waits for the helper's close event.
  const inventory = await adapters({ run, signal });
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Backend discovery cancelled.');
  if (inventory.status !== 'complete') notices.push(inventory.reason || 'Adapter enumeration is incomplete.');
  const prior = sessions.get(registry) || new Map(), current = inventory.status === 'complete' ? new Map()
    : new Map([...prior].map(([identity, row]) => [identity, { ...row, runtimeVersion: 'unresolved' }]));
  const initialized = initialization === null ? null : consumeNativeInitialization(initialization, { owner: registry, runtime, inventory,
    currentDevices: [...prior].map(([adapterIdentity, row]) => ({ adapterIdentity, id: row.id })) });
  const devices = inventory.adapters.filter(adapter => adapter.backendCandidate).map(adapter => {
    if (typeof adapter.luid !== 'string' || !/^[0-9a-f]{8}:[0-9a-f]{8}$/.test(adapter.luid)) throw new ToolError('NATIVE_DEVICE_DISCOVERY_INVALID', 'A validated DXGI LUID is required for a device handle.');
    const identity = 'dxgi:' + adapter.luid, key = runtimeKey(runtime, adapter), previous = prior.get(identity);
    const row = { id: previous?.id || randomUUID(), key,
      // This is only an actual captured initializer's scoped API observation.
      // An incomplete inventory or changed binary/driver/ordinal discards it.
      runtimeVersion: inventory.status === 'complete' && previous?.key === key ? previous.runtimeVersion : 'unresolved' };
    if (initialized?.adapterIdentity === identity) row.runtimeVersion = initialized.runtimeVersion;
    current.set(identity, row);
    if (current.size > 32) throw new ToolError('NATIVE_DEVICE_DISCOVERY_LIMIT', 'The bounded session device table is full; no handle was evicted or authorized.');
    return { id: row.id, backend: adapter.backendCandidate, vendorId: '0x' + adapter.vendorId.toString(16).padStart(4, '0'),
      adapterIndex: adapter.adapterIndex, adapterIdentity: identity, driverVersion: adapter.umdVersion || 'unresolved', runtimeVersion: row.runtimeVersion };
  });
  const evidence = { schema: 1, evidenceId: randomUUID(), observedAt: Date.now(), runtime, wrappers,
    inventory: { status: inventory.status, devices } };
  const snapshot = registry.observeDiscovery(evidence);
  bindDiscoveryInventory(evidence, inventory, registry); sessions.set(registry, current);
  return { registry, environment: evidence, display: { ...snapshot, wrappers, inventory: {
    status: inventory.status, source: inventory.source || 'Windows DXGI',
    adapters: inventory.adapters.map(({ description, adapterIndex, backendCandidate, software, umdVersion }) =>
      ({ description, adapterIndex, backendCandidate, software, umdVersion })),
    driverVersionScope: inventory.driverVersionScope || null,
  }, notices, ...(initialized ? { initializationObservation: { runtimeVersion: initialized.runtimeVersion, assurance: initialized.assurance } } : {}),
  limitations: ['AMF and QSV runtime initialization and exact-setting encode/decode qualification remain required.',
    'AMF_EFFECTIVE_PROPERTIES_UNOBSERVED: the pinned CLI has no complete same-component RC/quality/preset/runtime readback producer.',
    'QSV API-version and derived-device log observations have bounded assurance; no vendor DLL build/hash or atomic encoder LUID query is claimed.',
    'No native backend is enabled by this inventory. No fallback encoder is selected.'] } };
}

module.exports = { discoverNativeBackends, wrapperObservations };
