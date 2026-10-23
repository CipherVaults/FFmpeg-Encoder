'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { NativeCapabilityRegistry } = require('../src/backend-capabilities.cjs');
const { NATIVE_PROFILES, getNativeProfile, nativeContribution } = require('../src/backend-adapters.cjs');

// These are state-machine fixtures, NOT observations of AMD/Intel hardware.
// No file, process, encoder, device command, display or media is opened here.
const ids = { amf: randomUUID(), qsv: randomUUID() };
const device = backend => ({ id: ids[backend], backend, vendorId: backend === 'amf' ? '0x1002' : '0x8086',
  adapterIndex: backend === 'amf' ? 1 : 2, adapterIdentity: `${backend}:luid:00000000:00001234`, driverVersion: '32.0.1.2', runtimeVersion: '1.35.0' });
const observation = (changes = {}) => ({ schema: 1, evidenceId: randomUUID(), observedAt: 1000,
  runtime: { ffmpeg: { sha256: 'a'.repeat(64), version: 'ffmpeg version test-fixture' }, ffprobe: { sha256: 'b'.repeat(64), version: 'ffprobe version test-fixture' } },
  wrappers: Object.fromEntries(NATIVE_PROFILES.map(profile => [profile.encoder, 'present'])),
  inventory: { status: 'complete', devices: [device('amf'), device('qsv')] }, ...changes });
const request = (profileId = 'h265-qsv', changes = {}) => {
  const p = getNativeProfile(profileId);
  return { operation: 'encode', profileId, settings: { ...p.operationalSeed, deviceId: ids[p.backend] }, bitDepth: 8,
    transformId: 'none-v1', signal: 'sdr', container: 'matroska', ...changes };
};
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);
const clone = value => structuredClone(value);
function harness({ observed = observation(), maxCells } = {}) {
  let now = 1000;
  const registry = new NativeCapabilityRegistry({ now: () => now, ...(maxCells ? { maxCells } : {}) });
  registry.observeDiscovery(observed);
  return { registry, observed, time(value) { now = value; }, later(changes = {}) { now++; return { ...clone(observed), evidenceId: randomUUID(), observedAt: now, ...changes }; } };
}
function success(plan, environment, changes = {}) {
  const p = getNativeProfile(plan.policy.profileId);
  return { outcome: 'verified', reason: 'VERIFIED', evidenceId: randomUUID(), environment,
    lifecycle: { encode: 'closed', decode: 'closed' }, validation: {
      invocationId: plan.invocationId, contributionHash: plan.contributionHash, argvSha256: 'c'.repeat(64), fixtureSha256: 'd'.repeat(64),
      warningCaptureComplete: true, unexpectedWarnings: 0, modeSource: 'runtime-log', actualMode: plan.settings.mode,
      actualEncoder: p.encoder, actualAdapterIdentity: plan.policy.device.adapterIdentity,
      output: { codec: p.encodedCodec, bitDepth: plan.policy.bitDepth, width: 320, height: 180, frames: 96, decodedFrames: 96,
        chroma: '4:2:0', signal: 'sdr', primaries: 'bt709', transfer: 'bt709', matrix: 'bt709', range: 'tv', valid: true } }, ...changes };
}
function qualify(h, cell = h.registry.ensureCell(request())) {
  const ticket = h.registry.beginProbe({ cellId: cell.cellId });
  const receipt = ticket.issueReceipt(success(ticket.plan, h.later()));
  return h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt });
}

test('CPU-only, missing-runtime and incomplete discovery report useful negative states without probing or fallback', () => {
  const blank = new NativeCapabilityRegistry();
  assert.ok(blank.snapshot().profiles.every(profile => profile.state === 'untested' && profile.reason === 'DISCOVERY_NOT_OBSERVED'));
  for (const [observed, state, reason] of [
    [observation({ inventory: { status: 'complete', devices: [] } }), 'unavailable', 'MISSING_DEVICE'],
    [observation({ inventory: { status: 'partial', devices: [] } }), 'untested', 'DEVICE_DISCOVERY_INCOMPLETE'],
    [observation({ inventory: { status: 'unavailable', devices: [] } }), 'untested', 'DEVICE_DISCOVERY_INCOMPLETE'],
    [observation({ runtime: { ffmpeg: null, ffprobe: null } }), 'unavailable', 'MISSING_RUNTIME'],
  ]) {
    const { registry } = harness({ observed }), snapshot = registry.snapshot();
    assert.equal(snapshot.profiles.length, 6); assert.equal(snapshot.activeProbeId, null); assert.deepEqual(snapshot.cells, []);
    assert.ok(snapshot.profiles.every(profile => profile.state === state && profile.reason === reason && profile.available === false));
    rejects(() => registry.ensureCell(request()), reason === 'MISSING_RUNTIME' ? 'NATIVE_RUNTIME_UNAVAILABLE' : 'NATIVE_DEVICE_UNAVAILABLE');
  }
});

test('wrapper presence plus a discovered adapter never grants hardware support; absent and unknown wrappers stay distinct', () => {
  const observed = observation(); observed.wrappers.h264_amf = 'absent'; observed.wrappers.hevc_qsv = 'unobserved';
  const { registry } = harness({ observed });
  assert.equal(registry.snapshot().profiles.find(p => p.profileId === 'h264-amf').reason, 'UNSUPPORTED_CODEC');
  for (const [id, expected] of [['h264-amf', 'unavailable'], ['h265-qsv', 'untested'], ['av1-amf', 'discovered']]) {
    const cell = registry.ensureCell(request(id)); assert.equal(cell.state, expected); assert.equal(cell.available, false);
    rejects(() => registry.requireVerified({ cellId: cell.cellId, revision: cell.revision }), 'NATIVE_CAPABILITY_UNVERIFIED');
    if (expected !== 'discovered') {
      rejects(() => registry.beginProbe({ cellId: cell.cellId }), 'NATIVE_WRAPPER_UNAVAILABLE');
      assert.equal(registry.getCell({ cellId: cell.cellId }).state, expected);
    }
  }
  assert.ok(registry.snapshot().profiles.every(p => p.available === false));
});

test('cell key binds normalized exact quantizers, preset, mode, depth and operation transform without Cartesian discovery', () => {
  const { registry } = harness(), base = request('h265-amf'), cell = registry.ensureCell(base);
  assert.equal(registry.ensureCell({ ...base, settings: { ...base.settings, quality: { i: 24, p: 24 } } }).cellId, cell.cellId);
  const changes = [{ settings: { ...base.settings, quality: 25 } }, { settings: { ...base.settings, quality: { i: 23, p: 24 } } },
    { settings: { ...base.settings, preset: 'quality' } }, { settings: { ...base.settings, mode: 'qvbr', quality: 25 } },
    { bitDepth: 10 }, { transformId: 'scale-v1' }, { bitDepth: 10, signal: 'pq', transformId: 'preserve-pq-v1' }];
  for (const change of changes) assert.notEqual(registry.ensureCell({ ...base, ...change }).key, cell.key);
  assert.equal(registry.snapshot().cells.length, 8);
  rejects(() => registry.ensureCell({ ...base, operation: 'remux' }), 'UNSUPPORTED_BACKEND_OPERATION');
  rejects(() => registry.ensureCell(request('h264-qsv', { bitDepth: 10 })), 'UNSUPPORTED_NATIVE_DEPTH');
  rejects(() => registry.ensureCell({ ...base, argv: ['-y'] }), 'INVALID_BACKEND_EVIDENCE');
});

test('bounded probe plan uses canonical adapter contribution and exact native controls, without paths or arbitrary command input', () => {
  for (const id of ['h265-amf', 'av1-qsv']) {
    const h = harness(), req = request(id, { bitDepth: 10 }), cell = h.registry.ensureCell(req);
    const { plan, issueReceipt } = h.registry.beginProbe({ cellId: cell.cellId });
    assert.equal(typeof issueReceipt, 'function'); assert.equal(plan.fixture.frames, 96); assert.equal(plan.fixture.width, 320);
    assert.equal(plan.fixture.height, 180); assert.equal(plan.fixture.pixelFormat, 'yuv420p10le');
    assert.deepEqual(plan.contribution, nativeContribution(id, req.settings, { device: device(getNativeProfile(id).backend), bitDepth: 10, pipelineId: plan.policy.pipelineId }));
    assert.equal(plan.limits.encodeTimeoutMs, 30000); assert.equal(plan.limits.decodeTimeoutMs, 20000);
    assert.equal(plan.limits.maxOutputBytes, 32 * 1024 * 1024); assert.equal(plan.executable, undefined); assert.equal(plan.outputPath, undefined);
    assert.ok(Object.isFrozen(plan)); assert.ok(Object.isFrozen(plan.contribution.args));
    assert.equal(h.registry.getCell({ cellId: cell.cellId }).state, 'untested');
    rejects(() => h.registry.beginProbe({ cellId: cell.cellId }), 'PROBE_BUSY');
    assert.match(plan.scope, /not perceptual quality/);
  }
});

test('successful current main-owned receipt qualifies only that exact settings cell and revision', () => {
  const h = harness(), cell = h.registry.ensureCell(request());
  const verified = qualify(h, cell);
  assert.equal(verified.state, 'verified'); assert.equal(verified.available, true); assert.equal(verified.probeActive, false);
  assert.equal(verified.qualificationScope, 'exact-settings-96-frame-SDR-encode-decode');
  assert.equal(h.registry.requireVerified({ cellId: verified.cellId, revision: verified.revision }).evidenceId, verified.evidenceId);
  rejects(() => h.registry.requireVerified({ cellId: verified.cellId, revision: cell.revision }), 'NATIVE_CAPABILITY_UNVERIFIED');
  const other = h.registry.ensureCell(request('h265-qsv', { settings: { ...request().settings, quality: 26 } }));
  rejects(() => h.registry.requireVerified({ cellId: other.cellId, revision: other.revision }), 'NATIVE_CAPABILITY_UNVERIFIED');
  assert.ok(h.registry.snapshot().profiles.every(p => p.available === false), 'one cell is not a whole-profile acceptance claim');
});

test('an exact fresh observation already published by production discovery can complete the owned probe', () => {
  const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
  const after = h.later(); h.registry.observeDiscovery(after);
  const receipt = ticket.issueReceipt(success(ticket.plan, after));
  assert.equal(h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt }).state, 'verified');
});

test('plain JSON, foreign-registry and replayed receipts never become qualification authority', () => {
  const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
  const receipt = ticket.issueReceipt(success(ticket.plan, h.later()));
  rejects(() => h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt: clone(receipt) }), 'UNTRUSTED_NATIVE_RECEIPT');
  rejects(() => h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt: {} }), 'UNTRUSTED_NATIVE_RECEIPT');
  const foreign = harness(), foreignCell = foreign.registry.ensureCell(request()), other = foreign.registry.beginProbe({ cellId: foreignCell.cellId });
  rejects(() => foreign.registry.completeProbe({ probeId: other.plan.probeId, receipt }), 'UNTRUSTED_NATIVE_RECEIPT');
  const verified = h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt });
  rejects(() => h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt }), 'UNTRUSTED_NATIVE_RECEIPT');
  rejects(() => ticket.issueReceipt(success(ticket.plan, h.later())), 'PROBE_TICKET_EXPIRED');
  const restarted = harness();
  rejects(() => restarted.registry.requireVerified({ cellId: verified.cellId, revision: verified.revision }), 'UNKNOWN_CAPABILITY_CELL');
  assert.match(restarted.registry.snapshot().persistence, /do not restore/);
});

test('owned abandonment releases a cancelled collector without fabricating fresh discovery or granting evidence', () => {
  const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
  rejects(() => ticket.abandon({ reason: 'CANCELLED', lifecycle: { encode: 'running', decode: 'not-started' } }), 'PROBE_CHILD_NOT_CLOSED');
  assert.equal(h.registry.snapshot().activeProbeId, ticket.plan.probeId);
  rejects(() => ticket.abandon({ reason: 'VERIFIED', lifecycle: { encode: 'closed', decode: 'closed' } }), 'INVALID_BACKEND_EVIDENCE');
  const abandoned = ticket.abandon({ reason: 'CANCELLED', lifecycle: { encode: 'closed', decode: 'not-started' } });
  assert.equal(abandoned.state, 'untested'); assert.equal(abandoned.reason, 'CANCELLED');
  assert.equal(abandoned.evidenceId, null); assert.equal(h.registry.snapshot().activeProbeId, null);
  rejects(() => ticket.abandon({ reason: 'CANCELLED', lifecycle: { encode: 'closed', decode: 'closed' } }), 'PROBE_TICKET_EXPIRED');
  rejects(() => ticket.issueReceipt(success(ticket.plan, h.later())), 'PROBE_TICKET_EXPIRED');
});

test('abandonment preserves a known stale device state rather than relabeling it as merely untested', () => {
  const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
  h.registry.observeDiscovery(h.later({ inventory: { status: 'complete', devices: [] } }));
  const abandoned = ticket.abandon({ reason: 'PROBE_INTERRUPTED', lifecycle: { encode: 'not-started', decode: 'not-started' } });
  assert.equal(abandoned.state, 'stale'); assert.equal(abandoned.reason, 'DEVICE_CHANGED');
  assert.equal(h.registry.snapshot().activeProbeId, null);
});

test('post-probe discovery must be fresh and bind the exact binary pair, device, driver and runtime', () => {
  for (const mutate of [
    (observed, h) => ({ ...observed, evidenceId: h.observed.evidenceId }),
    observed => ({ ...observed, observedAt: 999 }),
    observed => ({ ...observed, runtime: { ...observed.runtime, ffmpeg: { ...observed.runtime.ffmpeg, sha256: 'f'.repeat(64) } } }),
    observed => ({ ...observed, runtime: { ...observed.runtime, ffprobe: { ...observed.runtime.ffprobe, sha256: 'e'.repeat(64) } } }),
    ...['driverVersion', 'runtimeVersion', 'adapterIdentity'].map(field => observed => ({ ...observed,
      inventory: { ...observed.inventory, devices: observed.inventory.devices.map(d => d.backend === 'qsv' ? { ...d, [field]: 'changed' } : d) } })),
    observed => ({ ...observed, inventory: { status: 'complete', devices: [device('amf')] } }),
  ]) {
    const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
    const receipt = ticket.issueReceipt(success(ticket.plan, mutate(h.later(), h)));
    rejects(() => h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt }), 'CAPABILITY_STALE');
    assert.equal(h.registry.getCell({ cellId: cell.cellId }).state, 'stale'); assert.equal(h.registry.snapshot().activeProbeId, null);
  }
});

test('partial inventory cannot begin, retain or complete verified native qualification', () => {
  const partial = observation(); partial.inventory.status = 'partial';
  const limited = harness({ observed: partial }), candidate = limited.registry.ensureCell(request());
  assert.equal(candidate.state, 'untested');
  rejects(() => limited.registry.beginProbe({ cellId: candidate.cellId }), 'NATIVE_DISCOVERY_INCOMPLETE');
  const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
  const after = h.later(); after.inventory.status = 'partial';
  const receipt = ticket.issueReceipt(success(ticket.plan, after));
  rejects(() => h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt }), 'CAPABILITY_STALE');
  assert.equal(h.registry.getCell({ cellId: cell.cellId }).available, false);
  const active = harness(), verified = qualify(active), changed = active.later(); changed.inventory.status = 'partial';
  active.registry.observeDiscovery(changed);
  rejects(() => active.registry.requireVerified({ cellId: verified.cellId, revision: verified.revision }), 'NATIVE_CAPABILITY_UNVERIFIED');
  assert.equal(active.registry.getCell({ cellId: verified.cellId }).state, 'stale');
});

test('changed discovery revokes verified cells and in-flight epochs, without declaring child closure', () => {
  const h = harness(), verified = qualify(h);
  const next = h.later(); next.inventory.devices[1].driverVersion = 'new-driver';
  h.registry.observeDiscovery(next);
  const stale = h.registry.getCell({ cellId: verified.cellId }); assert.equal(stale.reason, 'DRIVER_CHANGED'); assert.equal(stale.state, 'stale');
  rejects(() => h.registry.requireVerified({ cellId: verified.cellId, revision: verified.revision }), 'NATIVE_CAPABILITY_UNVERIFIED');
  const newer = h.registry.ensureCell(request()); assert.notEqual(newer.key, verified.key);
  const ticket = h.registry.beginProbe({ cellId: newer.cellId });
  h.registry.observeDiscovery({ ...clone(next), evidenceId: randomUUID(), observedAt: next.observedAt });
  assert.equal(h.registry.snapshot().activeProbeId, ticket.plan.probeId);
  rejects(() => h.registry.beginProbe({ cellId: newer.cellId }), 'PROBE_BUSY');
  const receipt = ticket.issueReceipt(success(ticket.plan, { ...clone(next), evidenceId: randomUUID(), observedAt: next.observedAt }));
  rejects(() => h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt }), 'CAPABILITY_STALE');
});

test('cancellation and resource/interruption failures stay untested; a running child prevents receipt issuance', () => {
  for (const reason of ['CANCELLED', 'RESOURCE_LIMIT', 'PROBE_INTERRUPTED']) {
    const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
    const negative = { outcome: 'untested', reason, evidenceId: randomUUID(), environment: h.later(),
      lifecycle: { encode: 'running', decode: 'not-started' }, validation: null };
    rejects(() => ticket.issueReceipt(negative), 'PROBE_CHILD_NOT_CLOSED');
    assert.equal(h.registry.snapshot().activeProbeId, ticket.plan.probeId);
    const receipt = ticket.issueReceipt({ ...negative, lifecycle: { encode: 'closed', decode: 'not-started' } });
    const finished = h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt });
    assert.equal(finished.state, 'untested'); assert.equal(finished.reason, reason); assert.equal(finished.available, false);
  }
  const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
  const receipt = ticket.issueReceipt({ outcome: 'unavailable', reason: 'UNSUPPORTED_MODE', evidenceId: randomUUID(), environment: h.later(),
    lifecycle: { encode: 'closed', decode: 'not-started' }, validation: null });
  assert.equal(h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt }).reason, 'UNSUPPORTED_MODE');
});

test('complete warning, actual mode/device, exact invocation, output/decode and SDR evidence are mandatory', () => {
  const changes = [
    { warningCaptureComplete: false }, { unexpectedWarnings: 1 }, { contributionHash: '0'.repeat(64) }, { invocationId: randomUUID() },
    { argvSha256: 'not-a-hash' }, { fixtureSha256: 'not-a-hash' }, { modeSource: 'encoder-list' }, { actualMode: 'cqp' },
    { actualEncoder: 'libx265' }, { actualAdapterIdentity: 'other-adapter' },
    ...[{ frames: 95 }, { decodedFrames: 95 }, { codec: 'av1' }, { bitDepth: 10 }, { width: 640 }, { signal: 'pq' },
      { chroma: '4:4:4' }, { valid: false }, { primaries: 'bt2020' }, { range: 'pc' }].map(output => ({ output })),
  ];
  for (const change of changes) {
    const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
    const observed = success(ticket.plan, h.later());
    observed.validation = { ...observed.validation, ...change, output: { ...observed.validation.output, ...change.output } };
    const receipt = ticket.issueReceipt(observed);
    assert.throws(() => h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt }));
    assert.equal(h.registry.getCell({ cellId: cell.cellId }).state, 'untested'); assert.equal(h.registry.snapshot().activeProbeId, null);
  }
});

test('unknown identities, HDR and unimplemented transforms cannot borrow the SDR probe', () => {
  const h = harness();
  for (const changes of [{ bitDepth: 10, signal: 'pq', transformId: 'preserve-pq-v1' }, { transformId: 'scale-v1' }]) {
    const cell = h.registry.ensureCell(request('h265-qsv', changes));
    rejects(() => h.registry.beginProbe({ cellId: cell.cellId }), 'PROBE_PLAN_NOT_IMPLEMENTED');
    assert.equal(h.registry.snapshot().activeProbeId, null); assert.equal(h.registry.getCell({ cellId: cell.cellId }).available, false);
  }
  const observed = observation(); observed.inventory.devices[1].runtimeVersion = 'unknown';
  const unknown = harness({ observed }), cell = unknown.registry.ensureCell(request());
  assert.equal(cell.state, 'untested'); rejects(() => unknown.registry.beginProbe({ cellId: cell.cellId }), 'NATIVE_IDENTITY_UNRESOLVED');
});

test('registry growth is bounded without evicting active/verified evidence or accumulating probe queues', () => {
  const h = harness({ maxCells: 1 }), cell = h.registry.ensureCell(request());
  const ticket = h.registry.beginProbe({ cellId: cell.cellId });
  for (let n = 0; n < 8; n++) rejects(() => h.registry.beginProbe({ cellId: cell.cellId }), 'PROBE_BUSY');
  rejects(() => h.registry.ensureCell(request('h264-qsv')), 'CAPABILITY_REGISTRY_FULL');
  assert.equal(h.registry.snapshot().cells.length, 1); assert.equal(h.registry.snapshot().activeProbeId, ticket.plan.probeId);
  const verified = h.registry.completeProbe({ probeId: ticket.plan.probeId, receipt: ticket.issueReceipt(success(ticket.plan, h.later())) });
  rejects(() => h.registry.ensureCell(request('h264-qsv')), 'CAPABILITY_REGISTRY_FULL');
  assert.equal(h.registry.requireVerified({ cellId: cell.cellId, revision: verified.revision }).state, 'verified');
});

test('discovery validation is transactional, bounded and rejects accessors, duplicate devices and stale IDs', () => {
  const h = harness(), before = h.registry.snapshot();
  let getterRan = false;
  const hostile = observation(); Object.defineProperty(hostile, 'runtime', { get() { getterRan = true; return {}; } });
  rejects(() => h.registry.observeDiscovery(hostile), 'INVALID_BACKEND_EVIDENCE'); assert.equal(getterRan, false);
  const devices = [device('amf')]; Object.defineProperty(devices, '0', { get() { getterRan = true; return device('amf'); } });
  rejects(() => h.registry.observeDiscovery(observation({ inventory: { status: 'complete', devices } })), 'INVALID_BACKEND_EVIDENCE');
  assert.equal(getterRan, false);
  for (const input of [
    observation({ inventory: { status: 'complete', devices: [device('amf'), device('amf')] } }),
    observation({ inventory: { status: 'complete', devices: new Array(33).fill(device('amf')) } }),
    observation({ inventory: { status: 'complete', devices: new Array(2) } }),
    observation({ inventory: { status: 'unavailable', devices: [device('amf')] } }),
    observation({ observedAt: 100000 }), { ...observation(), path: 'D:\\arbitrary' },
  ]) rejects(() => h.registry.observeDiscovery(input), 'INVALID_BACKEND_EVIDENCE');
  rejects(() => h.registry.observeDiscovery({ ...h.observed, observedAt: 999, evidenceId: randomUUID() }), 'STALE_DISCOVERY');
  rejects(() => h.registry.observeDiscovery({ ...h.observed, observedAt: 1001 }), 'DISCOVERY_ID_REUSED');
  assert.deepEqual(h.registry.snapshot(), before);
  assert.deepEqual(h.registry.observeDiscovery(h.observed), before);
});

test('receipt validation rejects hostile free metadata before retaining it and snapshots cannot be mutated', () => {
  const h = harness(), cell = h.registry.ensureCell(request()), ticket = h.registry.beginProbe({ cellId: cell.cellId });
  let getterRan = false;
  const observed = success(ticket.plan, h.later());
  Object.defineProperty(observed.validation.output, 'valid', { get() { getterRan = true; return true; } });
  rejects(() => ticket.issueReceipt(observed), 'INVALID_BACKEND_EVIDENCE'); assert.equal(getterRan, false);
  const reason = {}; Object.defineProperty(reason, 'location', { enumerable: true, get() { getterRan = true; return 'private'; } });
  rejects(() => ticket.issueReceipt(success(ticket.plan, h.later(), { reason })), 'INVALID_BACKEND_EVIDENCE'); assert.equal(getterRan, false);
  rejects(() => ticket.issueReceipt({ ...success(ticket.plan, h.later()), stderr: 'unbounded raw text' }), 'INVALID_BACKEND_EVIDENCE');
  assert.throws(() => h.registry.snapshot().cells.push({ state: 'verified' }));
  assert.throws(() => { h.registry.getCell({ cellId: cell.cellId }).settings.quality = 1; });
});
