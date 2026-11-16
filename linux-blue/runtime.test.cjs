'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PINS, assertHost, assertPinnedBytes, cpuArgs, sha256,
  validateRunOptions, assertEncodeCompleted, runCpuEncode } = require('./runtime.cjs');
const { buildEncodeArgs, PROFILES } = require('../src/media.cjs');

function request(profileId = 'h264-cpu') {
  const profile = PROFILES.find(item => item.id === profileId);
  return { input: '/owned/source.mkv', output: '/owned/output.mkv',
    settings: { profileId, preset: profile.defaultPreset, quality: profile.quality.default },
    probe: { streams: [{ index: 0, codec_type: 'video', codec_name: 'ffv1', width: 320,
      height: 180, pix_fmt: 'yuv420p', color_transfer: 'bt709', disposition: { default: 1 } }],
    format: { duration: '0.4' } } };
}

test('runtime pins are immutable and fixed, never a PATH selection', () => {
  assert.deepEqual(Object.keys(PINS), ['ffmpeg', 'ffprobe']);
  for (const [kind, pin] of Object.entries(PINS)) {
    assert.equal(pin.path, `/usr/bin/${kind}`);
    assert(Object.isFrozen(pin));
    assert.match(pin.sha256, /^[a-f0-9]{64}$/);
  }
  assert(Object.isFrozen(PINS));
});

test('host mismatch and each loader override fail closed', () => {
  assert.doesNotThrow(() => assertHost('linux', 'x64', {}));
  for (const [platform, arch] of [['win32', 'x64'], ['darwin', 'arm64'], ['linux', 'arm64']]) {
    assert.throws(() => assertHost(platform, arch, {}), { code: 'LINUX_PILOT_HOST' });
  }
  for (const key of ['LD_PRELOAD', 'LD_LIBRARY_PATH', 'LD_AUDIT']) {
    assert.throws(() => assertHost('linux', 'x64', { [key]: '/untrusted' }), { code: 'LINUX_PILOT_LOADER' });
  }
});

test('same-length tampering and length mismatch both refuse', () => {
  const bytes = Buffer.from('expected'), pin = { size: bytes.length, sha256: sha256(bytes) };
  assert.doesNotThrow(() => assertPinnedBytes(bytes, pin));
  for (const changed of [Buffer.from('tampered'), Buffer.from('expected-extra')]) {
    assert.throws(() => assertPinnedBytes(changed, pin), { code: 'LINUX_PILOT_RUNTIME_CHANGED' });
  }
});

test('CPU adapter preserves the production builder arguments exactly', () => {
  for (const id of ['h264-cpu', 'h265-cpu', 'av1-cpu']) {
    const input = request(id), args = cpuArgs(input);
    assert.deepEqual(args, buildEncodeArgs(input));
    assert(args.includes('-n'));
    assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file,pipe');
  }
});

test('GPU, unknown profile, network input and source overwrite refuse', () => {
  assert.throws(() => cpuArgs(request('h264-nvidia')), { code: 'LINUX_PILOT_CPU_ONLY' });
  assert.throws(() => cpuArgs({ settings: { profileId: 'unknown' } }), { code: 'LINUX_PILOT_CPU_ONLY' });
  assert.throws(() => cpuArgs({ ...request(), input: 'https://example.invalid/input.mkv' }), { code: 'INVALID_PATH' });
  assert.throws(() => cpuArgs({ ...request(), output: '/owned/source.mkv' }), { code: 'INVALID_PATH' });
});

test('run options cannot disable bounds or replace spawn/output accounting', () => {
  assert.doesNotThrow(() => validateRunOptions({ timeoutMs: 5000, signal: new AbortController().signal }));
  for (const options of [{ timeoutMs: 0 }, { timeoutMs: 60001 }, { timeoutMs: NaN },
    { spawnImpl() {} }, { onOutputBytes() {} }, { stdoutLimit: 999999999 }, { onProgress: 'bad' }, { signal: {} }]) {
    assert.throws(() => validateRunOptions(options), { code: 'LINUX_PILOT_OPTIONS' });
  }
});

test('zero exit without terminal progress is not completion', () => {
  assert.doesNotThrow(() => assertEncodeCompleted(true));
  assert.throws(() => assertEncodeCompleted(false), { code: 'LINUX_PILOT_INCOMPLETE' });
});

test('existing output refuses before any process starts', async () => {
  let spawned = false;
  await assert.rejects(runCpuEncode({ ...request(), output: __filename }, {
    onChild() { spawned = true; },
  }), { code: 'LINUX_PILOT_OUTPUT_EXISTS' });
  assert.equal(spawned, false);
});
