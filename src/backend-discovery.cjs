'use strict';

const { randomUUID } = require('node:crypto');
const { runTool, ToolError } = require('./process-runner.cjs');
const { queryWindowsAdapters } = require('./windows-adapters.cjs');
const { NativeCapabilityRegistry } = require('./backend-capabilities.cjs');
const { NATIVE_PROFILES } = require('./backend-adapters.cjs');

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
  registry = new NativeCapabilityRegistry() }) {
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
  const devices = inventory.adapters.filter(adapter => adapter.backendCandidate).map(adapter => ({
    id: randomUUID(), backend: adapter.backendCandidate, vendorId: '0x' + adapter.vendorId.toString(16).padStart(4, '0'),
    adapterIndex: adapter.adapterIndex, adapterIdentity: 'dxgi:' + adapter.luid,
    driverVersion: adapter.umdVersion || 'unresolved',
    // The DXGI UMD version is not the AMF/oneVPL runtime version. Only a later
    // real vendor initialization may fill this field; do not guess from a GPU.
    runtimeVersion: 'unresolved',
  }));
  const evidence = { schema: 1, evidenceId: randomUUID(), observedAt: Date.now(), runtime, wrappers,
    inventory: { status: inventory.status, devices } };
  const snapshot = registry.observeDiscovery(evidence);
  return { registry, display: { ...snapshot, wrappers, inventory: {
    status: inventory.status, source: inventory.source || 'Windows DXGI',
    adapters: inventory.adapters.map(({ description, adapterIndex, backendCandidate, software, umdVersion }) =>
      ({ description, adapterIndex, backendCandidate, software, umdVersion })),
    driverVersionScope: inventory.driverVersionScope || null,
  }, notices, limitations: ['AMF and QSV runtime initialization and exact-setting encode/decode qualification remain required.',
    'No native backend is enabled by this inventory. No fallback encoder is selected.'] } };
}

module.exports = { discoverNativeBackends, wrapperObservations };
