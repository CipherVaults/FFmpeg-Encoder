'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { POLICY_VERSION, UPLOAD_PIPELINE, NATIVE_PROFILES, getNativeProfile, validateNativeSettings,
  validateTrustedDevice, nativeContribution, describeNativeRecipe, validateCapabilityPolicy, capabilityKey,
  validateCapabilityCell, requireVerifiedCapability } = require('../src/backend-adapters.cjs');

const ids = { amf: randomUUID(), qsv: randomUUID() };
const device = backend => ({ id: ids[backend], backend, vendorId: backend === 'amf' ? '0x1002' : '0x8086',
  adapterIndex: backend === 'amf' ? 1 : 2, adapterIdentity: `${backend}:luid:00000000:12345678`,
  driverVersion: '32.0.1.2', runtimeVersion: '1.35.0' });
const settings = (id, changes = {}) => {
  const profile = getNativeProfile(id);
  return { ...profile.operationalSeed, deviceId: ids[profile.backend], ...changes };
};
const trusted = (id, depth = 8) => ({ device: device(getNativeProfile(id).backend), bitDepth: depth, pipelineId: UPLOAD_PIPELINE });
const policy = (id = 'h265-qsv', changes = {}) => {
  const profile = getNativeProfile(id);
  return { policyVersion: POLICY_VERSION, ffmpegSha256: 'a'.repeat(64), ffprobeSha256: 'b'.repeat(64),
    device: device(profile.backend), profileId: id, preset: profile.operationalSeed.preset,
    mode: profile.operationalSeed.mode, bitDepth: 8, pipelineId: UPLOAD_PIPELINE, transformId: 'none-v1',
    signal: 'sdr', container: 'matroska', ...changes };
};
function verified(p) {
  const profile = getNativeProfile(p.profileId), key = capabilityKey(p);
  return { schema: 1, key, state: 'verified', reason: 'VERIFIED', checkedAt: 1000, evidence: {
    kind: 'native-hardware', policyKey: key, evidenceId: randomUUID(), invocationId: randomUUID(), modeSource: 'runtime-log',
    actualMode: p.mode, actualEncoder: profile.encoder, actualAdapterIdentity: p.device.adapterIdentity,
    encodeClosed: true, decodeClosed: true, output: { codec: profile.encodedCodec, bitDepth: p.bitDepth,
      width: 320, height: 180, frames: 96, decodedFrames: 96, chroma: '4:2:0', signal: p.signal, valid: true } } };
}
const option = (args, name) => args[args.indexOf(name) + 1];
const rejectsCode = (fn, code) => assert.throws(fn, value => value.code === code);

test('six immutable native profiles are operational proposals, never tested defaults or CPU/NVIDIA replacements', () => {
  assert.deepEqual(NATIVE_PROFILES.map(p => p.id), ['h264-amf', 'h265-amf', 'av1-amf', 'h264-qsv', 'h265-qsv', 'av1-qsv']);
  for (const p of NATIVE_PROFILES) {
    assert.equal(p.testedDefault, false); assert.equal(p.evidenceStatus, 'hardware-unverified');
    assert.equal(p.chroma, '4:2:0'); assert.equal(p.progressive, true);
    assert.ok(Object.isFrozen(p)); assert.ok(Object.isFrozen(p.modes.cqp)); assert.ok(Object.isFrozen(p.bitDepths));
    validateNativeSettings(p.id, settings(p.id));
  }
  rejectsCode(() => getNativeProfile('h265-nvidia'), 'INVALID_NATIVE_PROFILE');
  rejectsCode(() => getNativeProfile('h265-cpu'), 'INVALID_NATIVE_PROFILE');
  assert.throws(() => NATIVE_PROFILES[0].bitDepths.push(10));
});

test('native scalar CQP expands into editable codec-specific frame quantizers without cross-encoder conversion', () => {
  assert.deepEqual(validateNativeSettings('h264-amf', settings('h264-amf')).quality, { i: 24, p: 24, b: 24 });
  assert.deepEqual(validateNativeSettings('h265-amf', settings('h265-amf')).quality, { i: 24, p: 24 });
  assert.deepEqual(validateNativeSettings('av1-amf', settings('av1-amf')).quality, { i: 128, p: 128, b: 128 });
  assert.deepEqual(validateNativeSettings('av1-qsv', settings('av1-qsv')).quality, { i: 128, p: 128, b: 128 });
  assert.equal(validateNativeSettings('h265-qsv', settings('h265-qsv')).quality, 25);
  const input = settings('h265-amf', { quality: { i: 22, p: 27 } });
  const normalized = validateNativeSettings('h265-amf', input); input.quality.i = 50;
  assert.deepEqual(normalized.quality, { i: 22, p: 27 }); assert.ok(Object.isFrozen(normalized.quality));
});

test('quality limits are codec/mode-specific and reject automatic values and wrong frame fields', () => {
  for (const p of NATIVE_PROFILES) for (const [mode, control] of Object.entries(p.modes)) {
    for (const quality of [control.min, control.max]) validateNativeSettings(p.id, settings(p.id, { mode, quality }));
    for (const quality of [control.min - 1, control.max + 1, NaN, Infinity, 25.5, '25', null]) {
      rejectsCode(() => validateNativeSettings(p.id, settings(p.id, { mode, quality })), 'INVALID_NATIVE_SETTINGS');
    }
  }
  rejectsCode(() => validateNativeSettings('h265-amf', settings('h265-amf', { quality: { i: 24, p: 24, b: 24 } })), 'INVALID_NATIVE_SETTINGS');
  rejectsCode(() => validateNativeSettings('h264-amf', settings('h264-amf', { quality: { i: 24, p: 24 } })), 'INVALID_NATIVE_SETTINGS');
  rejectsCode(() => validateNativeSettings('av1-amf', settings('av1-amf', { mode: 'qvbr', quality: 128 })), 'INVALID_NATIVE_SETTINGS');
  rejectsCode(() => validateNativeSettings('av1-qsv', settings('av1-qsv', { mode: 'icq', quality: 128 })), 'INVALID_NATIVE_SETTINGS');
});

test('renderer settings cannot supply adapter indexes, paths, raw parameters, unknown modes or accessors', () => {
  for (const field of ['adapterIndex', 'path', 'argv', 'qsv_params', 'bitDepth', 'recipeId', 'profileId']) {
    rejectsCode(() => validateNativeSettings('h265-qsv', { ...settings('h265-qsv'), [field]: 'arbitrary' }), 'INVALID_NATIVE_SETTINGS');
  }
  for (const changes of [{ preset: 'p7' }, { preset: 4 }, { mode: 'cq' }, { mode: 'toString' }, { deviceId: '2' },
    { deviceId: 'C:\\private\\device' }, { deviceId: undefined }]) {
    rejectsCode(() => validateNativeSettings('h265-qsv', settings('h265-qsv', changes)), 'INVALID_NATIVE_SETTINGS');
  }
  let accessed = false; const input = settings('h265-qsv');
  Object.defineProperty(input, 'quality', { enumerable: true, get() { accessed = true; return 25; } });
  rejectsCode(() => validateNativeSettings('h265-qsv', input), 'INVALID_NATIVE_SETTINGS'); assert.equal(accessed, false);
  const frame = { i: 24, p: 24 }; Object.defineProperty(frame, 'b', { enumerable: true, get() { accessed = true; return 24; } });
  rejectsCode(() => validateNativeSettings('h264-amf', settings('h264-amf', { quality: frame })), 'INVALID_NATIVE_SETTINGS');
  assert.equal(accessed, false);
});

test('AMF uses native codec controls without NVENC recipe flags or HEVC-only controls on AV1', () => {
  const hevc = nativeContribution('h265-amf', settings('h265-amf', { quality: { i: 20, p: 27 } }), trusted('h265-amf', 10));
  assert.equal(option(hevc.args, '-c:v:0'), 'hevc_amf'); assert.equal(option(hevc.args, '-quality:v:0'), 'balanced');
  assert.equal(option(hevc.args, '-qp_i:v:0'), '20'); assert.equal(option(hevc.args, '-qp_p:v:0'), '27');
  assert.equal(hevc.args.includes('-qp_b:v:0'), false); assert.equal(option(hevc.args, '-profile:v:0'), 'main10');
  assert.equal(option(hevc.args, '-bitdepth:v:0'), '10');
  const av1 = nativeContribution('av1-amf', settings('av1-amf', { mode: 'qvbr', quality: 25 }), trusted('av1-amf', 10));
  assert.equal(option(av1.args, '-qvbr_quality_level:v:0'), '25'); assert.equal(option(av1.args, '-profile:v:0'), 'main');
  for (const item of [hevc, av1]) for (const forbidden of ['-cq:v:0', '-crf:v:0', '-tune:v:0', '-multipass:v:0', '-b_ref_mode:v:0', '-x265-params']) {
    assert.equal(item.args.includes(forbidden), false);
  }
  assert.equal(av1.args.includes('-qp_i:v:0'), false);
  const h264 = nativeContribution('h264-amf', settings('h264-amf'), trusted('h264-amf'));
  assert.equal(h264.args.includes('-bitdepth:v:0'), false); assert.equal(option(h264.args, '-profile:v:0'), 'high');
});

test('QSV ICQ and CQP cannot accidentally select one another and asymmetric QPs resolve exactly', () => {
  const icq = nativeContribution('h265-qsv', settings('h265-qsv'), trusted('h265-qsv'));
  assert.equal(option(icq.args, '-global_quality:v:0'), '25'); assert.equal(icq.args.includes('-q:v:0'), false);
  assert.equal(option(icq.args, '-b:v:0'), '0');
  const cqp = nativeContribution('av1-qsv', settings('av1-qsv', { quality: { i: 12, p: 128, b: 255 } }), trusted('av1-qsv', 10));
  assert.equal(cqp.args.includes('-global_quality:v:0'), false);
  const p = Number(option(cqp.args, '-q:v:0'));
  assert.equal(p * Number(option(cqp.args, '-i_qfactor:v:0')) + Number(option(cqp.args, '-i_qoffset:v:0')), 12);
  assert.equal(p * Number(option(cqp.args, '-b_qfactor:v:0')) + Number(option(cqp.args, '-b_qoffset:v:0')), 255);
  assert.equal(option(cqp.args, '-profile:v:0'), 'main');
  for (const args of [icq.args, cqp.args]) for (const forbidden of ['-cq:v:0', '-crf:v:0', '-qsv_params', '-look_ahead:v:0', '-tune:v:0']) assert.equal(args.includes(forbidden), false);
});

test('device setup selects the bound D3D11 adapter and derives QSV with no auto or software fallback', () => {
  for (const id of ['h265-amf', 'h265-qsv']) {
    const p = getNativeProfile(id), contribution = nativeContribution(id, settings(id), trusted(id, 10));
    assert.equal(contribution.deviceArgs[1], `d3d11va=ffenc_d3d:${device(p.backend).adapterIndex}`);
    assert.deepEqual(contribution.uploadFilters, ['format=p010le', 'hwupload=extra_hw_frames=16']);
    assert.equal(contribution.deviceArgs.includes('qsv=ffenc_qsv@ffenc_d3d'), p.backend === 'qsv');
    assert.equal(contribution.args.includes('auto'), false); assert.equal(contribution.deviceArgs.includes('auto'), false);
    assert.equal(contribution.deviceArgs.some(arg => arg.includes('libx265')), false);
  }
  rejectsCode(() => nativeContribution('h265-qsv', settings('h265-qsv'), { device: null, bitDepth: 8 }), 'NATIVE_DEVICE_UNAVAILABLE');
  rejectsCode(() => nativeContribution('h265-qsv', settings('h265-qsv', { deviceId: randomUUID() }), trusted('h265-qsv')), 'NATIVE_DEVICE_MISMATCH');
  rejectsCode(() => nativeContribution('h265-qsv', settings('h265-qsv'), { ...trusted('h265-qsv'), device: device('amf') }), 'NATIVE_DEVICE_MISMATCH');
  rejectsCode(() => validateTrustedDevice({ ...device('amf'), vendorId: '0x10de' }, 'amf'), 'NATIVE_DEVICE_MISMATCH');
  rejectsCode(() => validateTrustedDevice({ ...device('amf'), adapterIndex: '0;evil' }, 'amf'), 'INVALID_NATIVE_SETTINGS');
  rejectsCode(() => validateTrustedDevice({ ...device('amf'), adapterIndex: 64 }, 'amf'), 'INVALID_NATIVE_SETTINGS');
});

test('new profiles refuse H.264 ten-bit, twelve-bit and unknown upload routes', () => {
  for (const p of NATIVE_PROFILES) {
    rejectsCode(() => nativeContribution(p.id, settings(p.id), trusted(p.id, 12)), 'UNSUPPORTED_NATIVE_DEPTH');
    if (p.codec === 'H264') rejectsCode(() => nativeContribution(p.id, settings(p.id), trusted(p.id, 10)), 'UNSUPPORTED_NATIVE_DEPTH');
    for (const pipelineId of ['arbitrary-filter', null, undefined]) rejectsCode(() => nativeContribution(p.id, settings(p.id),
      { ...trusted(p.id), pipelineId }), 'UNSUPPORTED_NATIVE_PIPELINE');
  }
});

test('displayed recipe shares canonical encoder, setup and upload arrays and visibly reflects edits', () => {
  const id = 'h265-amf', base = settings(id);
  const description = describeNativeRecipe(id, base, trusted(id));
  assert.strictEqual(description.args, description.contribution.args);
  assert.strictEqual(description.presetContribution, description.contribution.preset);
  assert.deepEqual(description.contribution, nativeContribution(id, base, trusted(id)));
  const edited = describeNativeRecipe(id, { ...base, preset: 'quality', quality: { i: 19, p: 25 } }, trusted(id));
  assert.equal(option(edited.args, '-quality:v:0'), 'quality'); assert.equal(option(edited.args, '-qp_i:v:0'), '19');
  assert.equal(option(edited.args, '-qp_p:v:0'), '25'); assert.notDeepEqual(edited.args, description.args);
  assert.equal(description.testedDefault, false); assert.match(description.scope, /not|only/i);
});

test('capability key binds binary pair, policy, stable adapter identity, ordinal, driver, mode, preset and pipeline', () => {
  const p = policy(), original = capabilityKey(p);
  assert.equal(capabilityKey({ ...p, device: { ...p.device, id: randomUUID() } }), original);
  const variants = [
    { ffmpegSha256: 'c'.repeat(64) }, { ffprobeSha256: 'd'.repeat(64) }, { mode: 'cqp' }, { preset: 'slow' },
    { bitDepth: 10 }, { transformId: 'scale-v1' },
    ...['adapterIdentity', 'driverVersion', 'runtimeVersion'].map(key => ({ device: { ...p.device, [key]: 'changed' } })),
    { device: { ...p.device, adapterIndex: p.device.adapterIndex + 1 } },
  ];
  for (const change of variants) assert.notEqual(capabilityKey({ ...p, ...change }), original);
  const reordered = Object.fromEntries(Object.entries(p).reverse()); assert.equal(capabilityKey(reordered), original);
  rejectsCode(() => capabilityKey({ ...p, policyVersion: 2 }), 'INVALID_CAPABILITY_POLICY');
  rejectsCode(() => capabilityKey({ ...p, container: 'mp4' }), 'INVALID_CAPABILITY_POLICY');
  rejectsCode(() => capabilityKey({ ...p, signal: 'hlg' }), 'INVALID_CAPABILITY_POLICY');
  validateCapabilityPolicy({ ...p, bitDepth: 10, signal: 'hlg', transformId: 'preserve-hlg-v1' });
  let executed = false;
  rejectsCode(() => capabilityKey({ ...p, ffmpegSha256: { toString() { executed = true; return 'a'.repeat(64); } } }), 'INVALID_CAPABILITY_POLICY');
  assert.equal(executed, false);
});

test('verified status requires matching native execution, closed full decode, actual mode/device and output evidence', () => {
  const p = policy(), good = verified(p); assert.equal(requireVerifiedCapability(good, p).state, 'verified');
  for (const change of [{ kind: 'mock' }, { kind: 'encoder-list' }, { modeSource: 'help' }, { actualMode: 'cqp' },
    { actualEncoder: 'libx265' }, { actualAdapterIdentity: 'other-device' }, { encodeClosed: false }, { decodeClosed: false },
    { policyKey: 'not-matching' }]) rejectsCode(() => validateCapabilityCell({ ...good, evidence: { ...good.evidence, ...change } }, p), 'INVALID_NATIVE_EVIDENCE');
  for (const change of [{ decodedFrames: 95 }, { frames: 95 }, { bitDepth: 10 }, { codec: 'av1' }, { signal: 'hlg' }, { valid: false }, { chroma: '4:4:4' }]) {
    rejectsCode(() => validateCapabilityCell({ ...good, evidence: { ...good.evidence, output: { ...good.evidence.output, ...change } } }, p), 'INVALID_NATIVE_EVIDENCE');
  }
  rejectsCode(() => validateCapabilityCell({ ...good, checkedAt: null }, p), 'INVALID_NATIVE_EVIDENCE');
  rejectsCode(() => validateCapabilityCell(good, { ...p, ffmpegSha256: 'c'.repeat(64) }), 'CAPABILITY_STALE');
  const unknown = policy('h265-qsv', { device: { ...device('qsv'), runtimeVersion: 'unknown' } });
  rejectsCode(() => validateCapabilityCell(verified(unknown), unknown), 'INVALID_NATIVE_EVIDENCE');
});

test('CPU-only discovery stays non-throwing and resource/cancellation failures are untested rather than unsupported', () => {
  const absent = policy('h265-amf', { device: null });
  const unavailable = { schema: 1, key: capabilityKey(absent), state: 'unavailable', reason: 'MISSING_DEVICE', checkedAt: 1, evidence: null };
  assert.equal(validateCapabilityCell(unavailable, absent).state, 'unavailable');
  rejectsCode(() => requireVerifiedCapability(unavailable, absent), 'NATIVE_CAPABILITY_UNVERIFIED');
  for (const reason of ['RESOURCE_LIMIT', 'CANCELLED', 'PROBE_INTERRUPTED']) {
    const pending = { ...unavailable, state: 'untested', reason };
    assert.equal(validateCapabilityCell(pending, absent).state, 'untested');
    rejectsCode(() => validateCapabilityCell({ ...pending, state: 'unavailable' }, absent), 'INVALID_CAPABILITY_STATE');
  }
  rejectsCode(() => validateCapabilityCell({ ...unavailable, state: 'verified', reason: 'VERIFIED' }, absent), 'INVALID_NATIVE_SETTINGS');
  rejectsCode(() => validateCapabilityCell({ ...unavailable, state: 'discovered', reason: 'DISCOVERED', evidence: {} }, absent), 'INVALID_CAPABILITY_STATE');
});
