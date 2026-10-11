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

// Owned temporary bytes and injected children only. None of these tests launch
// FFmpeg or provide evidence of AMD/Intel hardware, driver or media support.
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const captured = stderr => ({ stderr, stderrCapture: { totalBytes: Buffer.byteLength(stderr), truncated: false } });
const qsvLog = '[hevc_qsv @ abc123] [verbose] TargetUsage: 4; RateControlMethod: ICQ\n[hevc_qsv @ abc123] [verbose] ICQQuality: 25\n';
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
    adapterIdentity: `${backend}:fixture:00001`, driverVersion: '32.1.2.3', runtimeVersion: options.unresolved ? 'unresolved' : '1.35.0' };
  const registry = new NativeCapabilityRegistry();
  const environment = () => ({ schema: 1, evidenceId: randomUUID(), observedAt: Date.now(), runtime: Object.fromEntries(Object.keys(runtime)
    .map(name => [name, { sha256: sha(`not-executable-test-bytes-${name}`), version: `${name} version test-fixture` }])),
    wrappers: Object.fromEntries(NATIVE_PROFILES.map(profile => [profile.encoder, 'present'])), inventory: { status: 'complete', devices: [{ ...device }] } });
  registry.observeDiscovery(environment());
  const profile = getNativeProfile(profileId), req = { operation: 'encode', profileId,
    settings: { ...profile.operationalSeed, deviceId: device.id }, bitDepth: options.bitDepth || 8,
    transformId: 'none-v1', signal: 'sdr', container: 'matroska' };
  const cell = registry.ensureCell(req);
  let plan, released = 0, observed = 0;
  const calls = [];
  const begin = registry.beginProbe.bind(registry);
  registry.beginProbe = request => { const ticket = begin(request); plan = ticket.plan; return ticket; };
  const invoke = async (exe, argv, runOptions) => {
    const kind = calls.length === 0 ? 'encode' : calls.length === 1 ? 'metadata' : 'decode';
    const child = new EventEmitter(); child.pid = 100 + calls.length; child.kill = () => { child.killed = true; options.onKill?.(child); };
    const call = { kind, exe, argv, runOptions, child }; calls.push(call); runOptions.onChild(child);
    try {
      const custom = await options.beforeRun?.(call, { plan, environment, runtime });
      if (custom) return custom;
      let result;
      if (kind === 'encode') {
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
      const result = environment(); options.changeEnvironment?.(result, observed); return result; },
    acquireMediaSlot: async () => ({ release: async () => { released++; } }),
    ...(options.noObserver ? {} : { observeNative: async ({ plan: current, stderr }) => {
      const native = { invocationId: current.invocationId, contributionHash: current.contributionHash, stderrSha256: sha(stderr),
        modeSource: backend === 'qsv' ? 'runtime-log' : 'runtime-query', actualMode: current.settings.mode,
        actualQuality: current.settings.quality, actualPreset: current.settings.preset, actualEncoder: current.contribution.encoder,
        actualAdapterIdentity: current.policy.device.adapterIdentity, runtimeVersion: current.policy.device.runtimeVersion, scope: 'same-encoder-session' };
      options.changeNative?.(native); return native;
    } }), run: options.run || invoke });
  return { root, ownedRoot, runtime, registry, cell, probe, calls, environment,
    get released() { return released; }, get plan() { return plan; }, run: signal => probe.probe({ cellId: cell.cellId }, { signal }) };
}

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

test('AMF follows its own canonical CQP controls and needs same-session effective-property evidence', async t => {
  const h = await fixture(t, { backend: 'amf' }), result = await h.run();
  assert.equal(result.status, 'verified', JSON.stringify(result.failure));
  const argv = h.calls[0].argv; assert.ok(argv.includes('hevc_amf')); assert.ok(argv.includes('-qp_i:v:0')); assert.ok(!argv.includes('-qp_b:v:0'));
  assert.equal(argv[argv.indexOf('-rc:v:0') + 1], 'cqp'); assert.ok(!argv.some(arg => arg.startsWith('qsv=')));
  assert.match(result.scope, /No HDR.*injected tests/);
});

test('successful output with no vendor collector remains untested rather than treating argv as proof', async t => {
  const h = await fixture(t, { noObserver: true }), result = await h.run();
  assert.equal(result.status, 'untested'); assert.equal(result.failure.code, 'PROBE_EVIDENCE_UNOBSERVED');
  assert.equal(h.calls.length, 3); assert.equal(result.cell.available, false); assert.equal(h.registry.snapshot().activeProbeId, null);
});

test('wrong effective quality, preset, encoder or device refuses the exact cell with no fallback', async t => {
  for (const [field, value, reason] of [['actualQuality', { i: 23, p: 24 }, 'MODE_MISMATCH'],
    ['actualPreset', 'quality', 'MODE_MISMATCH'], ['actualEncoder', 'libx265', 'DEVICE_MISMATCH'], ['actualAdapterIdentity', 'amf:other', 'DEVICE_MISMATCH']]) {
    const h = await fixture(t, { backend: 'amf', changeNative: record => { record[field] = value; } }), result = await h.run();
    assert.equal(result.status, 'unavailable', field); assert.equal(result.reason, reason);
    assert.equal(h.calls.length, 3); assert.equal(h.calls.filter(call => call.kind === 'encode').length, 1);
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
  const h = await fixture(t, { changeEnvironment: (value, count) => { if (count === 2) value.inventory.devices[0].driverVersion = 'changed'; } });
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
