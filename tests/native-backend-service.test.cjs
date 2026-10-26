'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NativeBackendService } = require('../src/native-backend-service.cjs');
const { NativeCapabilityRegistry } = require('../src/backend-capabilities.cjs');
const { NATIVE_PROFILES, getNativeProfile } = require('../src/backend-adapters.cjs');

// Injected orchestration only: no file, process, device, runtime or media opens.
// Direct trusted test receipts exercise the registry seam, not native collectors.
function harness(options = {}) {
  let now = 1000, initialized = false, observation, suppliedObserve;
  const ids = { amf: randomUUID(), qsv: randomUUID() }, token = Object.freeze({ testOnly: true });
  const registry = new NativeCapabilityRegistry({ now: () => now });
  const calls = { discovery: 0, initialize: [], probe: [] };
  const device = backend => ({ id: ids[backend], backend, vendorId: backend === 'amf' ? '0x1002' : '0x8086',
    adapterIndex: backend === 'amf' ? 1 : 2, adapterIdentity: `${backend}:luid:00000000:00001234`, driverVersion: '32.0.1.2', runtimeVersion: initialized ? '1.35.0' : 'unresolved' });
  const environment = () => ({ schema: 1, evidenceId: randomUUID(), observedAt: ++now,
    runtime: { ffmpeg: { sha256: 'a'.repeat(64), version: 'ffmpeg version test' }, ffprobe: { sha256: 'b'.repeat(64), version: 'ffprobe version test' } },
    wrappers: Object.fromEntries(NATIVE_PROFILES.map(p => [p.encoder, 'present'])),
    inventory: { status: options.partial ? 'partial' : 'complete', devices: options.noDevices ? [] : [device('amf'), device('qsv')] } });
  function mint(cellId) {
    const ticket = registry.beginProbe({ cellId }), p = ticket.plan, profile = getNativeProfile(p.policy.profileId);
    observation = environment(); registry.observeDiscovery(observation);
    const receipt = ticket.issueReceipt({ outcome: 'verified', reason: 'VERIFIED', evidenceId: randomUUID(), environment: observation,
      lifecycle: { encode: 'closed', decode: 'closed' }, validation: {
        invocationId: p.invocationId, contributionHash: p.contributionHash, argvSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64),
        warningCaptureComplete: true, unexpectedWarnings: 0, modeSource: 'runtime-log', actualMode: p.settings.mode,
        actualEncoder: profile.encoder, actualAdapterIdentity: p.policy.device.adapterIdentity,
        output: { codec: profile.encodedCodec, bitDepth: p.policy.bitDepth, width: 320, height: 180, frames: 96, decodedFrames: 96,
          chroma: '4:2:0', signal: 'sdr', primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv', valid: true } } });
    return registry.completeProbe({ probeId: p.probeId, receipt });
  }
  const service = new NativeBackendService({ registry,
    discover: async request => {
      calls.discovery++; assert.equal(request.registry, registry);
      if (request.initialization !== undefined) { assert.equal(request.initialization, token); initialized = true; }
      observation = environment(); return { registry: options.foreignRegistry ? new NativeCapabilityRegistry() : registry, environment: observation };
    },
    createProbe: ({ registry: selected, observeEnvironment }) => {
      assert.equal(selected, registry); suppliedObserve = observeEnvironment;
      return {
        async initialize(request, context) {
          calls.initialize.push(request.cellId);
          if (options.initialize) return options.initialize(request, context, { token, registry });
          return { status: 'observed', initialization: token, invocations: [] };
        },
        async probe(request, context) {
          calls.probe.push(request.cellId);
          if (options.probe) return options.probe(request, context, { registry, mint });
          const cell = mint(request.cellId);
          return { status: 'verified', cell, cellId: cell.cellId, evidenceId: cell.evidenceId };
        },
      };
    },
  });
  const choose = (profileId = 'h265-qsv', changes = {}) => {
    const p = getNativeProfile(profileId);
    return service.select({ revision: service.snapshot().revision, profileId,
      settings: { ...p.operationalSeed, deviceId: ids[p.backend] }, bitDepth: 8, ...changes });
  };
  const selectedRequest = () => ({ selectionId: service.snapshot().selection.selectionId, revision: service.snapshot().revision });
  return { service, registry, calls, ids, choose, selectedRequest, observe: (...args) => suppliedObserve(...args), mint };
}
const code = expected => error => error.code === expected;

test('construction and snapshots perform no discovery, initialization or probe', () => {
  const h = harness(); assert.deepEqual(h.calls, { discovery: 0, initialize: [], probe: [] });
  const view = h.service.snapshot(); assert.equal(view.beta, true); assert.equal(view.fileExecutionReady, false); assert.equal(view.selection, null);
  assert.ok(view.native.profiles.every(p => !p.available)); assert.ok(Object.isFrozen(view));
});
test('QSV bootstrap refreshes the runtime cell before genuine exact-cell qualification', async () => {
  const h = harness(); await h.service.refresh(); const selected = h.choose(), preliminary = selected.selection.cell.cellId;
  assert.equal(selected.selection.cell.policy.device.runtimeVersion, 'unresolved');
  const result = await h.service.qualify(h.selectedRequest());
  assert.deepEqual(h.calls.initialize, [preliminary]); assert.equal(h.calls.probe.length, 1); assert.notEqual(h.calls.probe[0], preliminary);
  assert.equal(result.selection.cell.policy.device.runtimeVersion, '1.35.0'); assert.equal(result.selection.probeVerified, true);
  assert.equal(result.fileExecutionReady, false); assert.equal(result.busy, false);
  assert.equal(h.service.requireProbeVerified(h.selectedRequest()).cellId, result.selection.cell.cellId);
});
test('AMF observability gap schedules neither initializer nor media probe', async () => {
  const h = harness(); await h.service.refresh(); h.choose('h265-amf'); const out = await h.service.qualify(h.selectedRequest());
  assert.deepEqual(h.calls.initialize, []); assert.deepEqual(h.calls.probe, []); assert.equal(out.lastOutcome.reason, 'AMF_EFFECTIVE_PROPERTIES_UNOBSERVED');
  assert.equal(out.selection.probeVerified, false); assert.throws(() => h.service.requireProbeVerified(h.selectedRequest()), code('NATIVE_CAPABILITY_UNVERIFIED'));
});
test('complete missing hardware stays unavailable with zero probe calls', async () => {
  const h = harness({ noDevices: true }); const snapshot = await h.service.refresh();
  assert.ok(snapshot.native.profiles.every(p => p.reason === 'MISSING_DEVICE' && !p.available));
  assert.throws(() => h.choose(), code('NATIVE_DEVICE_UNAVAILABLE')); assert.equal(h.calls.initialize.length, 0); assert.equal(h.calls.probe.length, 0);
});
test('foreign registry discovery never replaces the owned session', async () => {
  const h = harness({ foreignRegistry: true }); await assert.rejects(h.service.refresh(), code('NATIVE_DISCOVERY_OWNER_MISMATCH'));
  assert.equal(h.service.snapshot().selection, null); assert.equal(h.service.snapshot().busy, false);
});
test('raw paths, argv, HDR transforms and stale revisions are refused before initialization', async () => {
  const h = harness(); await h.service.refresh();
  for (const extra of [{ argv: ['-y'] }, { path: 'C:\\input' }, { signal: 'hdr' }, { transformId: 'hdr' }]) assert.throws(() => h.choose('h265-qsv', extra), code('INVALID_NATIVE_REQUEST'));
  assert.throws(() => h.choose('h265-qsv', { revision: -1 }), code('STALE_NATIVE_SELECTION'));
  assert.equal(h.calls.initialize.length, 0);
});
test('accessors are refused without invoking their getters', async () => {
  const h = harness(); await h.service.refresh(); let reads = 0;
  const settings = { preset: 'medium', mode: 'icq', quality: 25, deviceId: h.ids.qsv };
  Object.defineProperty(settings, 'quality', { enumerable: true, get() { reads++; return 25; } });
  assert.throws(() => h.choose('h265-qsv', { settings }), code('INVALID_NATIVE_REQUEST')); assert.equal(reads, 0);
});
test('caller edits and JSON copies do not restore old selection authority', async () => {
  const h = harness(); await h.service.refresh(); const first = h.choose(); const old = { selectionId: first.selection.selectionId, revision: first.revision };
  h.choose('h265-qsv', { settings: { preset: 'slow', mode: 'cqp', quality: { i: 24, p: 25, b: 26 }, deviceId: h.ids.qsv } });
  await assert.rejects(h.service.qualify(old), code('STALE_NATIVE_SELECTION'));
  const restarted = harness(); await restarted.service.refresh(); assert.throws(() => restarted.service.requireProbeVerified(old), code('STALE_NATIVE_SELECTION'));
});
test('serialized verified status without a genuine registry receipt grants no probe authority', async () => {
  const h = harness({ probe: async () => ({ status: 'verified', cell: { state: 'verified', available: true } }) });
  await h.service.refresh(); h.choose(); await assert.rejects(h.service.qualify(h.selectedRequest()), code('NATIVE_CAPABILITY_UNVERIFIED'));
  assert.equal(h.service.snapshot().selection.probeVerified, false); assert.equal(h.service.snapshot().fileExecutionReady, false);
});
test('initialization failure cannot proceed to qualification', async () => {
  const h = harness({ initialize: async () => ({ status: 'untested', reason: 'INITIALIZATION_FAILED', initialization: null }) });
  await h.service.refresh(); h.choose(); const out = await h.service.qualify(h.selectedRequest());
  assert.equal(out.lastOutcome.reason, 'INITIALIZATION_FAILED'); assert.equal(h.calls.probe.length, 0); assert.equal(out.selection.probeVerified, false);
});
test('release failure latches the owner without admitting a new session operation', async () => {
  const h = harness({ initialize: async () => ({ status: 'untested', reason: 'INITIALIZATION_SLOT_UNRELEASED', slotReleaseFailure: 'injected' }) });
  await h.service.refresh(); h.choose(); await assert.rejects(h.service.qualify(h.selectedRequest()), code('NATIVE_OWNER_UNSETTLED'));
  assert.equal(h.service.snapshot().ownerBlock, 'INITIALIZATION_SLOT_UNRELEASED'); await assert.rejects(h.service.refresh(), code('NATIVE_OWNER_UNSETTLED')); assert.throws(() => h.choose(), code('NATIVE_OWNER_UNSETTLED'));
});
test('successful native evidence plus persistence failure does not activate the selection', async () => {
  const h = harness({ probe: async (r, c, helpers) => ({ status: 'verified', cell: helpers.mint(r.cellId), persistenceFailure: { code: 'INJECTED' } }) });
  await h.service.refresh(); h.choose(); await assert.rejects(h.service.qualify(h.selectedRequest()), code('NATIVE_PROBE_EVIDENCE_INCOMPLETE'));
  assert.equal(h.service.snapshot().selection.probeVerified, false); assert.throws(() => h.service.requireProbeVerified(h.selectedRequest()), code('NATIVE_CAPABILITY_UNVERIFIED'));
});
test('cancel invalidates choices immediately but stays busy until the owner drains', async () => {
  let close, sawAbort = false; const drained = new Promise(resolve => { close = resolve; });
  const h = harness({ initialize: async (r, c) => { c.signal.addEventListener('abort', () => { sawAbort = true; }); await drained; return { status: 'untested', reason: 'CANCELLED' }; } });
  await h.service.refresh(); h.choose(); const work = h.service.qualify(h.selectedRequest()); const rejected = assert.rejects(work, code('CANCELLED'));
  const cancelling = h.service.invalidate(); assert.equal(sawAbort, true); assert.equal(h.service.snapshot().selection, null); assert.equal(h.service.snapshot().busy, true);
  assert.throws(() => h.choose(), code('NATIVE_BACKEND_BUSY')); close(); await cancelling; await rejected;
  assert.equal(h.service.snapshot().busy, false); assert.equal(h.calls.probe.length, 0);
});
test('rejected owner without release facts cannot enable a second owner', async () => {
  const h = harness({ initialize: async () => { throw new Error('unconfirmed owner failure'); } });
  await h.service.refresh(); h.choose(); await assert.rejects(h.service.qualify(h.selectedRequest()), /unconfirmed/);
  assert.equal(h.service.snapshot().ownerBlock, 'NATIVE_OWNER_REJECTED_WITHOUT_RELEASE_REPORT'); await assert.rejects(h.service.refresh(), code('NATIVE_OWNER_UNSETTLED'));
});
test('fresh discovery revokes an earlier completed selection and exposes no persistent grants', async () => {
  const h = harness(); await h.service.refresh(); h.choose(); await h.service.qualify(h.selectedRequest()); const previous = h.selectedRequest();
  await h.service.refresh(); assert.equal(h.service.snapshot().selection, null); assert.throws(() => h.service.requireProbeVerified(previous), code('STALE_NATIVE_SELECTION'));
});
test('a prior genuine verified row cannot substitute for a repeated attempt', async () => {
  let attempts = 0;
  const h = harness({ probe: async (r, c, helpers) => {
    const cell = ++attempts === 1 ? helpers.mint(r.cellId) : helpers.registry.getCell({ cellId: r.cellId });
    return { status: 'verified', cell, cellId: cell.cellId, evidenceId: cell.evidenceId };
  } });
  await h.service.refresh(); h.choose(); await h.service.qualify(h.selectedRequest()); assert.equal(h.service.snapshot().selection.probeVerified, true);
  await assert.rejects(h.service.qualify(h.selectedRequest()), code('NATIVE_PROBE_EVIDENCE_STALE'));
  assert.equal(h.service.snapshot().selection.probeVerified, false); assert.throws(() => h.service.requireProbeVerified(h.selectedRequest()), code('NATIVE_CAPABILITY_UNVERIFIED'));
});
test('fresh registry evidence with a mismatched report ID is refused', async () => {
  const h = harness({ probe: async (r, c, helpers) => { const cell = helpers.mint(r.cellId); return { status: 'verified', cell, cellId: cell.cellId, evidenceId: randomUUID() }; } });
  await h.service.refresh(); h.choose(); await assert.rejects(h.service.qualify(h.selectedRequest()), code('NATIVE_PROBE_EVIDENCE_STALE'));
  assert.equal(h.service.snapshot().selection.probeVerified, false);
});
