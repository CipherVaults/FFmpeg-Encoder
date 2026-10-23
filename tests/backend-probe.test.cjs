'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createHash, randomUUID } = require('node:crypto');
const { NativeCapabilityRegistry } = require('../src/backend-capabilities.cjs');
const { NATIVE_PROFILES, getNativeProfile } = require('../src/backend-adapters.cjs');
const { NativeBackendProbe, numericProbeFrame, decodedFrameId, validateMetadata, qsvRuntimeSettings } = require('../src/backend-probe.cjs');
const { bindDiscoveryInventory, consumeNativeInitialization } = require('../src/backend-observation.cjs');

// Owned temporary bytes and injected children only. None of these tests launch
// FFmpeg or provide evidence of AMD/Intel hardware, driver or media support.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = stderr => ({ stderr, stderrCapture: { totalBytes: Buffer.byteLength(stderr), truncated: false } });
const qsvLog = '[AVHWDeviceContext @ aa11] [verbose] Selecting d3d11va adapter 1\n'
  + '[AVHWDeviceContext @ aa11] [info] Using device 8086:1234 (Test Intel).\n'
  + '[AVHWDeviceContext @ aa22] [verbose] Initialize MFX session: implementation version is 2.12\n'
  + '[hevc_qsv @ abc123] [verbose] TargetUsage: 4; RateControlMethod: ICQ\n[hevc_qsv @ abc123] [verbose] ICQQuality: 25\n';
const initializationLog = qsvLog.split('\n').filter(line => !line.startsWith('[hevc_qsv @ ')).join('\n');
function metadata(plan) {
  const profile = getNativeProfile(plan.policy.profileId), common = { width: 320, height: 180, pix_fmt: plan.fixture.pixelFormat,
    color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' };
  return { streams: [{ ...common, index: 0, codec_type: 'video', codec_name: profile.encodedCodec,
    profile: profile.codec === 'H264' ? 'High' : profile.codec === 'H265' && plan.policy.bitDepth === 10 ? 'Main 10' : 'Main', field_order: 'progressive' }],
  frames: Array.from({ length: 96 }, (_, index) => ({ ...common, media_type: 'video', stream_index: 0, interlaced_frame: 0, best_effort_timestamp_time: (index / 30).toFixed(3) })),
  format: { duration: '3.200000' } };
}
async function fixture(t, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'backend-probe-test-'));
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const ownedRoot = path.join(root, 'owned'); await fs.mkdir(ownedRoot);
  const runtime = { ffmpeg: path.join(root, 'ffmpeg.exe'), ffprobe: path.join(root, 'ffprobe.exe') };
  for (const [name, file] of Object.entries(runtime)) await fs.writeFile(file, `not-executable-test-bytes-${name}`);
  const backend = options.backend || 'qsv', profileId = options.profileId || `h265-${backend}`;
  const device = { id: randomUUID(), backend, vendorId: backend === 'qsv' ? '0x8086' : '0x1002', adapterIndex: 1,
    adapterIdentity: 'dxgi:00000000:00000001', driverVersion: '32.1.2.3', runtimeVersion: options.unresolved ? 'unresolved' : 'mfx-api:2.12' };
  const registry = new NativeCapabilityRegistry();
  const environment = () => ({ schema: 1, evidenceId: randomUUID(), observedAt: Date.now(), runtime: Object.fromEntries(Object.keys(runtime)
    .map(name => [name, { sha256: sha(`not-executable-test-bytes-${name}`), version: `${name} version 9.0.2-test-fixture` }])),
    wrappers: Object.fromEntries(NATIVE_PROFILES.map(profile => [profile.encoder, 'present'])), inventory: { status: 'complete', devices: [{ ...device }] } });
  const rawInventory = value => ({ status: value.inventory.status, adapters: [
    { adapterIndex: 0, description: 'Unselected NVIDIA', vendorId: 0x10de, deviceId: 0x5678, luid: '00000000:00000002',
      umdVersion: '32.0.1.2', backendCandidate: null, software: false },
    ...(value.inventory.devices.length ? [{ adapterIndex: 1, description: backend === 'qsv' ? 'Test Intel' : 'Test AMD', vendorId: backend === 'qsv' ? 0x8086 : 0x1002,
      deviceId: 0x1234, luid: value.inventory.devices[0].adapterIdentity.slice(5),
      umdVersion: value.inventory.devices[0].driverVersion, backendCandidate: backend, software: false }] : []),
  ] });
  const bindEnvironment = value => bindDiscoveryInventory(value, rawInventory(value), registry);
  registry.observeDiscovery(bindEnvironment(environment()));
  const profile = getNativeProfile(profileId), req = { operation: 'encode', profileId,
    settings: { ...profile.operationalSeed, deviceId: device.id }, bitDepth: options.bitDepth || 8,
    transformId: 'none-v1', signal: 'sdr', container: 'matroska' };
  const cell = registry.ensureCell(req);
  let plan, released = 0, observed = 0;
  const calls = [];
  const begin = registry.beginProbe.bind(registry);
  registry.beginProbe = request => { const ticket = begin(request); plan = ticket.plan; return ticket; };
  const invoke = async (exe, argv, runOptions) => {
    const kind = argv.includes('-frames:v:0') && argv[argv.indexOf('-frames:v:0') + 1] === '0' ? 'initialization'
      : calls.length === 0 ? 'encode' : calls.length === 1 ? 'metadata' : 'decode';
    const child = new EventEmitter(); child.pid = 100 + calls.length; child.kill = () => { child.killed = true; options.onKill?.(child); };
    const call = { kind, exe, argv, runOptions, child }; calls.push(call); runOptions.onChild(child);
    try {
      const custom = await options.beforeRun?.(call, { plan, environment, runtime });
      if (custom) return custom;
      let result;
      if (kind === 'initialization') {
        result = { stdout: '', exitCode: 0, ...captured(options.stderr ?? initializationLog) };
      } else if (kind === 'encode') {
        await fs.writeFile(argv.at(-1), 'owned-injected-encoded-output', { flag: 'wx' });
        result = { stdout: '', exitCode: 0, ...captured(options.stderr ?? (backend === 'qsv' ? qsvLog : '')) };
      } else if (kind === 'metadata') {
        const value = metadata(plan); options.changeMetadata?.(value);
        result = { stdout: JSON.stringify(value), exitCode: 0, ...captured('') };
      } else {
        let total = 0;
        for (let index = 0; index < 96; index++) {
          const bytes = numericProbeFrame(plan.policy.bitDepth, options.changedFrame === index ? (index + 1) % 96 : index);
          // Include chunks split inside a 16-bit sample/frame for streaming.
          for (const chunk of [bytes.subarray(0, 13), bytes.subarray(13)]) { await runOptions.onStdoutChunk(chunk); total += chunk.length; }
        }
        result = { stdout: '', exitCode: 0, stdoutCapture: { totalBytes: total, truncated: false, streamed: true }, ...captured('') };
      }
      options.changeResult?.(result, kind);
      return result;
    } finally { if (!options.deferClose?.(call)) child.emit('close', 0, null); }
  };
  const probe = new NativeBackendProbe({ registry, ownedRoot, runtime,
    observeEnvironment: async () => { observed++; if (options.failRefresh && observed === 2) throw new Error('discovery unavailable');
      const result = environment(); options.changeEnvironment?.(result, observed); bindEnvironment(result);
      if (options.publishDiscovery) registry.observeDiscovery(result);
      return result; },
    acquireMediaSlot: options.acquireMediaSlot || (async () => ({ release: async () => { released++; } })),
    ...(options.noObserver ? { observeNative: async () => null } : options.observeNative ? { observeNative: options.observeNative } : {}),
    run: options.run || invoke });
  return { root, ownedRoot, runtime, registry, cell, probe, calls, environment, rawInventory,
    get released() { return released; }, get observed() { return observed; }, get plan() { return plan; },
    initialize: signal => probe.initialize({ cellId: cell.cellId }, { signal }), run: signal => probe.probe({ cellId: cell.cellId }, { signal }) };
}

test('explicit initializer owns a fixed zero-frame child and returns only a scoped one-use API bootstrap', async t => {
  const h = await fixture(t, { unresolved: true, publishDiscovery: true });
  assert.equal(h.calls.length, 0, 'construction starts no child');
  const result = await h.initialize(); assert.equal(result.status, 'observed', JSON.stringify(result.failure));
  assert.equal(result.reason, 'API_VERSION_OBSERVED'); assert.equal(h.calls.length, 1); assert.equal(h.released, 1);
  const argv = h.calls[0].argv;
  assert.equal(argv[argv.indexOf('-frames:v:0') + 1], '0'); assert.equal(argv[argv.indexOf('-c:v:0') + 1], 'wrapped_avframe');
  assert.equal(argv[argv.indexOf('-i') + 1], 'color=c=black:s=16x16:r=1'); assert.equal(argv.at(-1), 'pipe:1');
  assert.ok(!argv.includes('hevc_qsv')); assert.deepEqual(await fs.readdir(h.ownedRoot), []);
  const current = h.environment(), observation = consumeNativeInitialization(result.initialization, { owner: h.registry,
    runtime: current.runtime, inventory: h.rawInventory(current), currentDevices: current.inventory.devices.map(({ id, adapterIdentity }) => ({ id, adapterIdentity })) });
  assert.equal(observation.runtimeVersion, 'mfx-api:2.12'); assert.equal(observation.actualMode, undefined);
  assert.ok(h.registry.snapshot().profiles.every(profile => !profile.available));
});

test('initializer refuses request argv, missing hardware, partial discovery, AMF and failed slot admission before a child', async t => {
  const h = await fixture(t, { unresolved: true });
  await assert.rejects(h.probe.initialize({ cellId: h.cell.cellId, argv: ['anything'] }), { code: 'INVALID_NATIVE_PROBE' });
  for (const options of [{ backend: 'amf' }, { changeEnvironment: value => { value.inventory.devices = []; } },
    { changeEnvironment: value => { value.inventory.status = 'partial'; } },
    { acquireMediaSlot: async () => { throw Object.assign(new Error('slot occupied'), { code: 'MEDIA_BUSY' }); } },
    { acquireMediaSlot: async () => ({}) }]) {
    const candidate = await fixture(t, options), result = await candidate.initialize();
    assert.equal(result.status, 'untested'); assert.equal(result.initialization, null); assert.equal(candidate.calls.length, 0);
  }
});

test('initializer rejects successful summaries without child ownership, forged captures, requested versions and changed argv', async t => {
  for (const options of [{ run: async () => ({ stdout: '', exitCode: 0, ...captured(initializationLog) }) },
    { changeResult: result => { result.stderrCapture.totalBytes++; } },
    { changeResult: result => { result.stderrCapture.truncated = true; } },
    { changeResult: result => { result.stdoutCapture = { totalBytes: 99, truncated: false }; } },
    { stderr: initializationLog.replace('Initialize MFX session: implementation version is', 'Required implementation version is') },
    { beforeRun: call => { call.argv.push('-frames:v', '1'); } }]) {
    const h = await fixture(t, options), result = await h.initialize();
    assert.equal(result.status, 'untested'); assert.equal(result.initialization, null); assert.equal(h.released, 1);
  }
});

test('initializer cancellation and shared busy state retain the owned slot until actual child close', async t => {
  let entered, held; const ready = new Promise(resolve => { entered = resolve; });
  const h = await fixture(t, { deferClose: call => { held = call; entered(); return true; } });
  const controller = new AbortController(); let settled = false;
  const work = h.initialize(controller.signal).then(result => { settled = true; return result; });
  await ready;
  await assert.rejects(h.initialize(), { code: 'PROBE_BUSY' }); await assert.rejects(h.run(), { code: 'PROBE_BUSY' });
  controller.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(held.child.killed, true); assert.equal(settled, false); assert.equal(h.released, 0);
  held.child.emit('close', 0, null);
  const result = await work; assert.equal(result.reason, 'CANCELLED'); assert.equal(result.initialization, null);
  assert.equal(h.released, 1); assert.equal(h.observed, 1, 'cancellation starts no follow-up discovery');
});

test('initializer refuses changed binaries and an unreleased slot without retaining a bootstrap grant', async t => {
  const changed = await fixture(t); await fs.appendFile(changed.runtime.ffmpeg, 'changed');
  const failed = await changed.initialize(); assert.equal(failed.reason, 'CAPABILITY_STALE'); assert.equal(changed.calls.length, 0);
  const held = await fixture(t, { acquireMediaSlot: async () => ({ release: async () => { throw new Error('retain lease'); } }) });
  const result = await held.initialize(); assert.equal(result.reason, 'INITIALIZATION_SLOT_UNRELEASED'); assert.equal(result.initialization, null);
});

test('external cancellation during deferred slot release discards an otherwise completed initializer receipt', async t => {
  let releaseEntered, finishRelease;
  const releasing = new Promise(resolve => { releaseEntered = resolve; });
  const released = new Promise(resolve => { finishRelease = resolve; });
  const h = await fixture(t, { acquireMediaSlot: async () => ({ release: async () => { releaseEntered(); await released; } }) });
  const controller = new AbortController(); let settled = false;
  const work = h.initialize(controller.signal).then(result => { settled = true; return result; });
  await releasing; controller.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'slot ownership remains pending through release');
  finishRelease(); const result = await work;
  assert.equal(result.status, 'untested'); assert.equal(result.reason, 'CANCELLED'); assert.equal(result.initialization, null);
  assert.equal(h.calls.length, 1); assert.equal(h.observed, 2);
});

test('numeric fixture frame IDs work at both depths and reject a damaged or incomplete identity', () => {
  for (const depth of [8, 10]) for (const index of [0, 1, 31, 63, 64, 95]) assert.equal(decodedFrameId(numericProbeFrame(depth, index), depth), index);
  assert.throws(() => numericProbeFrame(12, 0)); assert.throws(() => numericProbeFrame(8, 96));
  assert.throws(() => decodedFrameId(Buffer.alloc(20), 8));
  const ambiguous = Buffer.alloc(320 * 180 * 3 / 2, 128);
  assert.throws(() => decodedFrameId(ambiguous, 8), { code: 'PROBE_OUTPUT_MISMATCH' });
});

test('QSV effective-setting parsing rejects echoed argv, conflicting sessions and missing quality', () => {
  assert.deepEqual(qsvRuntimeSettings(qsvLog, 'hevc_qsv'), { mode: 'icq', preset: 'medium', quality: 25 });
  assert.equal(qsvRuntimeSettings('-global_quality 25 ICQQuality: 25', 'hevc_qsv'), null);
  assert.equal(qsvRuntimeSettings(qsvLog, 'hevc_amf'), null);
  assert.equal(qsvRuntimeSettings(qsvLog.replace('ICQQuality: 25', 'unobserved'), 'hevc_qsv'), null);
  assert.equal(qsvRuntimeSettings(qsvLog + qsvLog.replaceAll('abc123', 'abc456'), 'hevc_qsv'), null);
  const cqp = qsvLog.replace('RateControlMethod: ICQ', 'RateControlMethod: CQP').replace('ICQQuality: 25', 'QPI: 23; QPP: 24; QPB: 25');
  assert.deepEqual(qsvRuntimeSettings(cqp, 'hevc_qsv'), { mode: 'cqp', preset: 'medium', quality: { i: 23, p: 24, b: 25 } });
});

test('unresolved vendor runtime returns truthful untested state without files, admission or media', async t => {
  const h = await fixture(t, { unresolved: true }), result = await h.run();
  assert.equal(result.status, 'untested'); assert.equal(result.reason, 'VENDOR_RUNTIME_UNOBSERVED');
  assert.equal(h.calls.length, 0); assert.equal(h.released, 0); assert.deepEqual(await fs.readdir(h.ownedRoot), []);
  assert.equal(h.registry.snapshot().activeProbeId, null);
});

test('canonical SDR probe qualifies only after exact settings, complete frames, device binding and closure', async t => {
  const h = await fixture(t, { bitDepth: 10 }), result = await h.run();
  assert.equal(result.status, 'verified', JSON.stringify(result.failure)); assert.equal(result.reason, 'VERIFIED');
  assert.deepEqual(result.lifecycle, { encode: 'closed', decode: 'closed' });
  assert.equal(h.released, 1); assert.equal(h.calls.length, 3); assert.equal(h.registry.snapshot().activeProbeId, null);
  assert.equal(result.decoded.frames, 96); assert.equal(result.decoded.everyFrameIdentityMatched, true);
  const argv = h.calls[0].argv;
  assert.equal(argv[argv.indexOf('-c:v:0') + 1], 'hevc_qsv'); assert.equal(argv[argv.indexOf('-global_quality:v:0') + 1], '25');
  assert.ok(argv.includes('-n')); assert.ok(!argv.includes('-y')); assert.ok(argv.includes('qsv=ffenc_qsv@ffenc_d3d'));
  assert.equal(h.calls[2].argv.at(-1), 'pipe:1');
  const folder = path.join(h.ownedRoot, (await fs.readdir(h.ownedRoot))[0]);
  const saved = JSON.parse(await fs.readFile(path.join(folder, 'report.json'), 'utf8'));
  assert.equal(saved.cell.state, 'verified'); assert.equal(saved.invocations.length, 3);
  assert.equal(h.registry.requireVerified({ cellId: result.cell.cellId, revision: result.cell.revision }).available, true);
});

test('AMF honestly refuses without creating another session or treating setters as effective proof', async t => {
  const h = await fixture(t, { backend: 'amf' }), result = await h.run();
  assert.equal(result.status, 'untested'); assert.equal(result.reason, 'AMF_EFFECTIVE_PROPERTIES_UNOBSERVED');
  assert.match(result.limitation, /same-component.*readback/);
  assert.equal(h.calls.length, 0); assert.equal(h.released, 0); assert.deepEqual(await fs.readdir(h.ownedRoot), []);
});

test('withheld captured-child receipt remains untested rather than treating successful output as proof', async t => {
  const h = await fixture(t, { noObserver: true }), result = await h.run();
  assert.equal(result.status, 'untested'); assert.equal(result.failure.code, 'PROBE_EVIDENCE_UNOBSERVED');
  assert.equal(h.calls.length, 3); assert.equal(result.cell.available, false); assert.equal(h.registry.snapshot().activeProbeId, null);
});

test('production-style publishing of the exact post-discovery observation does not invalidate an unchanged probe', async t => {
  const h = await fixture(t, { publishDiscovery: true }), result = await h.run();
  assert.equal(result.status, 'verified', JSON.stringify(result.failure));
  assert.equal(result.cell.available, true); assert.match(result.nativeObservation.assurance.device, /complete-pre-post-dxgi/);
  assert.match(result.nativeObservation.assurance.runtime, /DLL-build-not-independently-observed/);
});

test('wrong captured effective quality, preset, encoder, device or runtime refuses without fallback', async t => {
  for (const [from, to, reason] of [['ICQQuality: 25', 'ICQQuality: 24', 'MODE_MISMATCH'],
    ['TargetUsage: 4', 'TargetUsage: 5', 'MODE_MISMATCH'], ['hevc_qsv', 'h264_qsv', 'DEVICE_MISMATCH'],
    ['Test Intel', 'Other Intel', 'DEVICE_MISMATCH'], ['version is 2.12', 'version is 2.11', 'DEVICE_MISMATCH']]) {
    const h = await fixture(t, { stderr: qsvLog.replaceAll(from, to) }), result = await h.run();
    assert.equal(result.status, 'unavailable', from); assert.equal(result.reason, reason);
    assert.equal(h.calls.length, 3); assert.equal(h.calls.filter(call => call.kind === 'encode').length, 1);
  }
});

test('plain fabricated query summaries and JSON copies of captured receipts cannot qualify', async t => {
  for (const observeNative of [async () => ({ modeSource: 'runtime-query', actualMode: 'icq' }),
    async ({ receipt }) => JSON.parse(JSON.stringify(receipt))]) {
    const h = await fixture(t, { observeNative }), result = await h.run();
    assert.equal(result.status, 'untested'); assert.equal(result.failure.code, 'PROBE_EVIDENCE_UNOBSERVED');
    assert.equal(result.cell.available, false); assert.equal(h.calls.length, 3);
  }
});

test('metadata and decoded-content validation independently refuse wrong depth, dropped/reordered frames and wrong color', async t => {
  for (const options of [{ changeMetadata: value => { value.streams[0].pix_fmt = 'yuv420p10le'; } },
    { changeMetadata: value => { value.frames[10].color_transfer = 'smpte2084'; } },
    { changeMetadata: value => { value.frames.pop(); } }, { changedFrame: 17 }]) {
    const h = await fixture(t, options), result = await h.run();
    assert.equal(result.status, 'unavailable', JSON.stringify(result.failure)); assert.equal(result.reason, 'OUTPUT_MISMATCH');
    assert.equal(result.cell.available, false); assert.equal(h.registry.snapshot().activeProbeId, null);
  }
});

test('incomplete warnings, missing streaming accounting and unreviewed warnings cannot qualify', async t => {
  for (const options of [{ changeResult: (result, kind) => { if (kind === 'encode') result.stderrCapture.truncated = true; } },
    { changeResult: (result, kind) => { if (kind === 'metadata') result.stdoutCapture = { truncated: true }; } },
    { changeResult: (result, kind) => { if (kind === 'decode') delete result.stdoutCapture; } },
    { stderr: qsvLog + '[hevc_qsv @ abc123] [warning] Unsupported option was changed\n' }]) {
    const h = await fixture(t, options), result = await h.run();
    assert.equal(result.status, 'untested'); assert.equal(result.cell.available, false);
    assert.equal(h.registry.snapshot().activeProbeId, null); assert.equal(h.released, 1);
  }
});

test('final discovery failure abandons a closed probe without inventing a fresh environment', async t => {
  const h = await fixture(t, { failRefresh: true }), result = await h.run();
  assert.equal(result.status, 'untested'); assert.equal(result.cell.reason, 'PROBE_INTERRUPTED');
  assert.equal(h.registry.snapshot().activeProbeId, null); assert.equal(h.released, 1);
});

test('changed post-probe driver makes the prior cell stale even with successful injected media', async t => {
  const h = await fixture(t, { changeEnvironment: (value, count) => { if (count === 2) value.inventory.devices[0].driverVersion = '32.1.2.4'; } });
  const result = await h.run(); assert.equal(result.status, 'stale'); assert.equal(result.cell.available, false);
  assert.equal(h.registry.snapshot().activeProbeId, null);
});

test('cancellation and concurrent calls wait for owned child close before release or new admission', async t => {
  let entered, held;
  const ready = new Promise(resolve => { entered = resolve; });
  const h = await fixture(t, { deferClose: call => { if (call.kind === 'encode') { held = call; entered(); return true; } return false; } });
  const controller = new AbortController(); let settled = false;
  const work = h.run(controller.signal).then(result => { settled = true; return result; });
  await ready;
  await assert.rejects(h.run(), { code: 'PROBE_BUSY' });
  controller.abort(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(held.child.killed, true); assert.equal(settled, false); assert.equal(h.released, 0);
  held.child.emit('close', 0, null);
  const result = await work; assert.equal(result.cell.state, 'untested'); assert.equal(result.cell.reason, 'CANCELLED');
  assert.equal(h.calls.length, 1); assert.equal(h.released, 1); assert.equal(h.registry.snapshot().activeProbeId, null);
});

test('fixed binary identity, hostile requests and unexpected retention entries prevent media work', async t => {
  const h = await fixture(t);
  await assert.rejects(h.probe.probe({ cellId: h.cell.cellId, path: 'anything' }), { code: 'INVALID_NATIVE_PROBE' });
  let getterRead = false; const hostile = { get cellId() { getterRead = true; return h.cell.cellId; } };
  await assert.rejects(h.probe.probe(hostile), { code: 'INVALID_NATIVE_PROBE' }); assert.equal(getterRead, false);
  const verified = await h.run(); assert.equal(verified.cell.state, 'verified');
  const priorCalls = h.calls.length; await fs.appendFile(h.runtime.ffmpeg, 'changed');
  const result = await h.run(); assert.equal(result.failure.code, 'CAPABILITY_STALE'); assert.equal(h.calls.length, priorCalls);
  assert.equal(result.cell.available, false, 'A failed binary recheck revokes prior qualification');
  const other = await fixture(t); await fs.writeFile(path.join(other.ownedRoot, 'unowned.txt'), 'preserve');
  const refused = await other.run(); assert.equal(refused.failure.code, 'PROBE_FILE_UNSAFE'); assert.equal(other.calls.length, 0);
  assert.equal(await fs.readFile(path.join(other.ownedRoot, 'unowned.txt'), 'utf8'), 'preserve');
});

test('spawn failure without a child safely abandons the ticket and preserves private failure evidence', async t => {
  const h = await fixture(t, { run: async () => { throw Object.assign(new Error('injected spawn failure'), { code: 'SPAWN_FAILED', ...captured('not launched') }); } });
  const result = await h.run(); assert.equal(result.cell.state, 'untested');
  assert.deepEqual(result.lifecycle, { encode: 'not-started', decode: 'not-started' });
  assert.equal(result.failure.code, 'SPAWN_FAILED'); assert.equal(h.released, 1); assert.equal(h.registry.snapshot().activeProbeId, null);
  const stderr = result.invocations[0].stderr; assert.equal(await fs.readFile(stderr.file, 'utf8'), 'not launched');
});
