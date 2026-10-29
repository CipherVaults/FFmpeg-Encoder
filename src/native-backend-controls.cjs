'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { NativeCapabilityRegistry } = require('./backend-capabilities.cjs');
const { NativeBackendService } = require('./native-backend-service.cjs');
const { NativeBackendProbe } = require('./backend-probe.cjs');
const { discoverNativeBackends } = require('./backend-discovery.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');

// Main's fixed composition. Construction creates no directory and launches no
// collector. Session versions originate in ordinary main-owned capabilities.
function createNativeBackendControls({ runtime, stateDir, acquireMediaSlot, retainInitialization,
  discover = discoverNativeBackends, Probe = NativeBackendProbe }) {
  const registry = new NativeCapabilityRegistry(), ownedRoot = path.resolve(stateDir, 'native-probes');
  let versions = null, display = null;
  const nativeBackends = new NativeBackendService({ registry,
    discover: async ({ signal, initialization, run }) => {
      if (!versions) throw Object.assign(new Error('Check the pinned runtime before native discovery.'), { code: 'NATIVE_RUNTIME_UNOBSERVED' });
      const result = await discover({ ffmpeg: runtime.ffmpeg, signal, registry, initialization, ...(run === undefined ? {} : { run }),
        runtime: Object.fromEntries(['ffmpeg', 'ffprobe'].map((name, index) => [name,
          { sha256: runtime.verified[index].sha256, version: versions[name] }])) });
      display = result.display; return result;
    },
    createProbe: ({ registry: ownerRegistry, observeEnvironment }) => {
      const probe = new Probe({ registry: ownerRegistry, ownedRoot,
        runtime: { ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe }, observeEnvironment,
        acquireMediaSlot: async request => {
          const slot = await acquireMediaSlot(request);
          try {
            if (request.signal?.aborted) throw Object.assign(new Error('Native initialization cancelled.'), { code: 'CANCELLED' });
            const stateRoot = path.resolve(stateDir);
            await assertOrdinaryPath(stateRoot, 'directory');
            const stateIdentity = await fs.lstat(stateRoot, { bigint: true });
            await fs.mkdir(ownedRoot).catch(error => { if (error.code !== 'EEXIST') throw error; });
            await assertOrdinaryPath(ownedRoot, 'directory');
            const currentState = await fs.lstat(stateRoot, { bigint: true });
            if (['dev', 'ino', 'birthtimeNs'].some(key => stateIdentity[key] !== currentState[key])) throw new Error('Native state directory changed during allocation.');
            if (request.signal?.aborted) throw Object.assign(new Error('Native initialization cancelled.'), { code: 'CANCELLED' });
            return slot;
          } catch (error) { await slot.release(); throw error; }
        } });
      return { async initialize(request, options) {
        const report = await probe.initialize(request, options);
        if (report.status === 'observed' || report.invocations?.length) {
          try {
            const retained = await retainInitialization(report);
            if (retained?.persisted !== true) throw new Error('Initializer capture persistence was not confirmed.');
          } catch (error) {
            return { ...report, initialization: null, status: 'untested',
              originalOutcome: { status: report.status, reason: report.reason || null, failure: report.failure || null },
              reason: report.status === 'observed' ? 'NATIVE_INITIALIZATION_NOT_RETAINED' : report.reason,
              persistenceFailure: { code: error.code || 'NATIVE_INITIALIZATION_NOT_RETAINED', message: 'Initializer capture persistence was not confirmed.' },
              failure: report.failure || { code: 'NATIVE_INITIALIZATION_NOT_RETAINED', message: 'Initializer capture persistence was not confirmed.' } };
          }
        }
        return report;
      }, probe: (request, options) => probe.probe(request, options) };
    } });
  return { nativeBackends, async discoverBackends({ signal, versions: observedVersions }) {
    versions = observedVersions;
    await nativeBackends.refresh({ signal });
    return { registry, display };
  } };
}

module.exports = { createNativeBackendControls };
