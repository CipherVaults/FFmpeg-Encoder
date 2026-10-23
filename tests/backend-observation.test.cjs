'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { nativeContribution, NATIVE_PROFILES } = require('../src/backend-adapters.cjs');
const { NativeObservationCollector, bindDiscoveryInventory, qsvRuntimeSettings,
  nativeInitializationArgs, captureNativeInitialization, consumeNativeInitialization } = require('../src/backend-observation.cjs');

// Pure inert fixtures only: no subprocess, device initialization, media or real
// vendor evidence. These tests establish parser/receipt refusal, not hardware.
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const runtime = { ffmpeg: { sha256: 'a'.repeat(64), version: 'ffmpeg version 9.0.2-test' },
  ffprobe: { sha256: 'b'.repeat(64), version: 'ffprobe version 9.0.2-test' } };
const captured = stderr => ({ totalBytes: Buffer.byteLength(stderr), truncated: false });
const stderr = '[AVHWDeviceContext @ aaaa] [verbose] Selecting d3d11va adapter 0\n'
  + '[AVHWDeviceContext @ aaaa] [info] Using device 8086:1234 (Test Intel).\n'
  + '[AVHWDeviceContext @ bbbb] [verbose] Initialize MFX session: implementation version is 2.12\n'
  + '[hevc_qsv @ cccc] [verbose] TargetUsage: 4; RateControlMethod: ICQ\n'
  + '[hevc_qsv @ cccc] [verbose] ICQQuality: 25\n';

function harness(options = {}) {
  let currentEvidenceId;
  const owner = { snapshot: () => ({ discoveryEvidenceId: currentEvidenceId }) }, collector = new NativeObservationCollector();
  const device = { id: randomUUID(), backend: 'qsv', vendorId: '0x8086', adapterIndex: 0,
    adapterIdentity: 'dxgi:00000000:00000001', driverVersion: '32.0.1.2', runtimeVersion: 'mfx-api:2.12' };
  const settings = { preset: 'medium', mode: 'icq', quality: 25, deviceId: device.id };
  const plan = { invocationId: randomUUID(), contributionHash: 'c'.repeat(64), settings,
    policy: { profileId: 'h265-qsv', device, ffmpegSha256: runtime.ffmpeg.sha256, ffprobeSha256: runtime.ffprobe.sha256 },
    contribution: nativeContribution('h265-qsv', settings, { device, bitDepth: 8 }) };
  const environment = (changes = {}) => {
    const selected = { ...device, ...(changes.device || {}) }, status = changes.status || 'complete';
    const value = { schema: 1, evidenceId: randomUUID(), observedAt: changes.observedAt ?? Date.now(), runtime: clone(runtime),
      wrappers: Object.fromEntries(NATIVE_PROFILES.map(profile => [profile.encoder, 'present'])),
      inventory: { status, devices: [selected] } };
    currentEvidenceId = value.evidenceId;
    return bindDiscoveryInventory(value, { status, adapters: [{ adapterIndex: 0, description: 'Test Intel',
      vendorId: 0x8086, deviceId: 0x1234, luid: selected.adapterIdentity.slice(5), umdVersion: selected.driverVersion,
      software: false, backendCandidate: 'qsv' }] }, owner);
  };
  const before = environment(), after = environment();
  const source = { file: 'C:\\owned\\fixture.yuv', sha256: 'd'.repeat(64) };
  const argv = [...plan.contribution.deviceArgs, '-f', 'rawvideo', '-i', source.file, ...plan.contribution.args, '-f', 'matroska', 'C:\\owned\\output.mkv'];
  const invocation = { kind: 'encode', invocationId: plan.invocationId, executableSha256: runtime.ffmpeg.sha256,
    argv, argvSha256: hash(argv), close: { code: 0, signal: null } };
  const log = options.stderr ?? stderr;
  const capture = () => collector.captureClosed({ plan, before, invocation, source, stderr: log,
    stderrCapture: options.stderrCapture || captured(log) });
  const complete = (receipt, changes = {}) => collector.complete(receipt, { plan, invocation, source, after, ...changes });
  return { owner, collector, plan, before, after, source, invocation, environment, capture, complete };
}

test('default raw QSV producer reads actual mode, quality, device and scoped API observation from one captured child', () => {
  const h = harness(), result = h.complete(h.capture());
  assert.equal(result.actualMode, 'icq'); assert.equal(result.actualEncoder, 'hevc_qsv');
  assert.equal(result.actualAdapterIdentity, h.plan.policy.device.adapterIdentity);
  assert.equal(result.observation.actualQuality, 25); assert.equal(result.observation.actualPreset, 'medium');
  assert.equal(result.observation.runtimeVersion, 'mfx-api:2.12');
  assert.match(result.observation.assurance.runtime, /encoder-session-and-DLL-build-not-independently-observed/);
  assert.match(result.observation.assurance.limitations, /bounded inference/);
  assert.equal(result.observation.argvSha256, h.invocation.argvSha256);
  assert.equal(result.observation.fixtureSha256, h.source.sha256); assert.ok(Object.isFrozen(result.observation));
});

test('QSV parser rejects duplicate, malformed, conflicting and missing effective blocks', () => {
  assert.deepEqual(qsvRuntimeSettings(stderr, 'hevc_qsv'), { mode: 'icq', preset: 'medium', quality: 25 });
  const cqp = stderr.replace('RateControlMethod: ICQ', 'RateControlMethod: CQP').replace('ICQQuality: 25', 'QPI: 22; QPP: 24; QPB: 25');
  assert.deepEqual(qsvRuntimeSettings(cqp, 'hevc_qsv'), { mode: 'cqp', preset: 'medium', quality: { i: 22, p: 24, b: 25 } });
  for (const log of [stderr + '[hevc_qsv @ cccc] [verbose] ICQQuality: 24\n',
    stderr + '[hevc_qsv @ dddd] [verbose] TargetUsage: 4; RateControlMethod: ICQ\n',
    stderr + '[hevc_qsv @ invalid-pointer] [verbose] ICQQuality: 22\n',
    stderr.replace('ICQQuality: 25', 'ICQQuality: unobserved'), stderr.replace('TargetUsage: 4', 'TargetUsage: unknown'),
    stderr + '[hevc_qsv @ cccc] [verbose] TargetUsage: 4; RateControlMethod: ICQ\n', '-global_quality 25 ICQQuality: 25']) {
    assert.equal(qsvRuntimeSettings(log, 'hevc_qsv'), null, log);
  }
});

test('partial captures, requested version text, missing device, alternate contexts and fallback paths grant nothing', () => {
  for (const log of [stderr.replace('Initialize MFX session: implementation version is', 'Use oneVPL required API version is'),
    stderr.replace(/.*Using device.*\n/, ''), stderr + '[AVHWDeviceContext @ dddd] [verbose] Initialize MFX session: implementation version is 2.12\n',
    stderr.replace('Using device 8086:1234', 'Using device malformed'),
    stderr + '[AVHWDeviceContext @ invalid-pointer] [info] Using device 8086:1234 (Test Intel).\n',
    stderr + '[hevc_qsv @ cccc] [verbose] Initialized an internal MFX session using hardware accelerated implementation\n',
    stderr + '[hevc_qsv @ cccc] [verbose] Initialized an internal MFX session using software implementation\n',
    stderr + '[h264_qsv @ dddd] [verbose] ICQQuality: 25\n']) {
    const h = harness({ stderr: log }); assert.throws(() => h.complete(h.capture()), { code: 'PROBE_EVIDENCE_UNOBSERVED' });
  }
  const h = harness({ stderrCapture: { ...captured(stderr), truncated: true } });
  assert.throws(h.capture, { code: 'PROBE_EVIDENCE_UNOBSERVED' });
});

test('actual changed mode, quality, preset, encoder, adapter or API version refuses the requested cell', () => {
  for (const [from, to, code] of [['ICQQuality: 25', 'ICQQuality: 26', 'PROBE_MODE_MISMATCH'],
    ['TargetUsage: 4', 'TargetUsage: 7', 'PROBE_MODE_MISMATCH'], ['ICQ', 'LA_ICQ', 'PROBE_EVIDENCE_UNOBSERVED'],
    ['hevc_qsv', 'h264_qsv', 'PROBE_DEVICE_MISMATCH'], ['Test Intel', 'Other Intel', 'PROBE_DEVICE_MISMATCH'],
    ['version is 2.12', 'version is 2.13', 'PROBE_DEVICE_MISMATCH'], ['adapter 0', 'adapter 1', 'PROBE_DEVICE_MISMATCH']]) {
    const h = harness({ stderr: stderr.replaceAll(from, to) });
    assert.throws(() => h.complete(h.capture()), { code }, from);
  }
});

test('receipt copies, foreign collectors, replay and fabricated query summaries cannot supply authority', () => {
  const h = harness(), receipt = h.capture();
  assert.throws(() => h.complete(clone(receipt)), { code: 'PROBE_EVIDENCE_UNOBSERVED' });
  assert.throws(() => h.complete({ modeSource: 'runtime-query', actualMode: 'icq' }), { code: 'PROBE_EVIDENCE_UNOBSERVED' });
  assert.throws(() => new NativeObservationCollector().complete(receipt, {}), { code: 'PROBE_EVIDENCE_UNOBSERVED' });
  h.complete(receipt);
  assert.throws(() => h.complete(receipt), { code: 'PROBE_EVIDENCE_UNOBSERVED' });
});

test('original plan, invocation, executed argv and fixture bindings must remain exact', () => {
  for (const changes of [h => ({ plan: clone(h.plan) }), h => ({ source: { ...h.source, sha256: 'e'.repeat(64) } }),
    h => ({ invocation: { ...h.invocation, invocationId: randomUUID() } }), h => {
      const argv = [...h.invocation.argv, '-b:v', '1000']; return { invocation: { ...h.invocation, argv, argvSha256: hash(argv) } };
    }]) {
    const h = harness(), receipt = h.capture(); assert.throws(() => h.complete(receipt, changes(h)), { code: 'PROBE_EVIDENCE_UNOBSERVED' });
  }
  const h = harness(); h.invocation.argvSha256 = '0'.repeat(64);
  assert.throws(h.capture, { code: 'PROBE_EVIDENCE_UNOBSERVED' });
  const changed = harness(); changed.invocation.argv[changed.invocation.argv.indexOf('-global_quality:v:0') + 1] = '26';
  changed.invocation.argvSha256 = hash(changed.invocation.argv);
  assert.throws(changed.capture, { code: 'PROBE_EVIDENCE_UNOBSERVED' });
});

test('unbranded, partial, reused and changed post-discovery observations cannot complete a capture', () => {
  for (const change of [h => clone(h.after), h => h.before,
    h => h.environment({ status: 'partial' }), h => h.environment({ device: { driverVersion: '32.0.1.3' } })]) {
    const h = harness(), receipt = h.capture(); assert.throws(() => h.complete(receipt, { after: change(h) }));
  }
});

test('native parsing refuses an unsupported runtime without preventing descriptive discovery', () => {
  const h = harness(), value = clone(h.before); value.runtime.ffmpeg.version = 'ffmpeg version 9.0.3-test';
  const raw = { status: 'complete', adapters: [{ adapterIndex: 0, description: 'Test Intel', vendorId: 0x8086, deviceId: 0x1234,
    luid: '00000000:00000001', umdVersion: '32.0.1.2', software: false, backendCandidate: 'qsv' }] };
  bindDiscoveryInventory(value, raw, h.owner);
  assert.throws(() => h.complete(h.capture(), { after: value }), { code: 'PROBE_EVIDENCE_UNOBSERVED' });
});

test('explicit initialization receipt is one-use and scoped, with no codec or mode success', () => {
  const h = harness(), argv = nativeInitializationArgs(h.before, h.plan.policy.device.id);
  const invocation = { ...h.invocation, kind: 'initialization', argv, argvSha256: hash(argv) };
  const initializationStderr = stderr.split('\n').filter(line => !line.startsWith('[hevc_qsv @ ')).join('\n');
  const receipt = captureNativeInitialization({ before: h.before, after: h.after, invocation,
    deviceId: h.plan.policy.device.id, stderr: initializationStderr, stderrCapture: captured(initializationStderr) });
  const raw = { status: 'complete', adapters: [{ adapterIndex: 0, description: 'Test Intel', vendorId: 0x8086, deviceId: 0x1234,
    luid: '00000000:00000001', umdVersion: '32.0.1.2', software: false, backendCandidate: 'qsv' }] };
  const currentDevices = h.after.inventory.devices.map(({ id, adapterIdentity }) => ({ id, adapterIdentity }));
  assert.throws(() => consumeNativeInitialization(clone(receipt), { owner: h.owner, runtime, inventory: raw, currentDevices }), { code: 'NATIVE_INITIALIZATION_UNTRUSTED' });
  const result = consumeNativeInitialization(receipt, { owner: h.owner, runtime, inventory: raw, currentDevices });
  assert.equal(result.runtimeVersion, 'mfx-api:2.12'); assert.equal(result.actualMode, undefined);
  assert.throws(() => consumeNativeInitialization(receipt, { owner: h.owner, runtime, inventory: raw, currentDevices }), { code: 'NATIVE_INITIALIZATION_UNTRUSTED' });
});

test('AMF has an explicit technical limitation even with a captured child and a fabricated property claim', () => {
  const h = harness(); h.plan.policy.profileId = 'h265-amf';
  const receipt = h.capture(); assert.throws(() => h.complete(receipt), { code: 'AMF_EFFECTIVE_PROPERTIES_UNOBSERVED' });
});
