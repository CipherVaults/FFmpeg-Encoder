'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILES } = require('../src/media.cjs');
const { NATIVE_PROFILES, nativeEncoderContribution, validateNativeEncoderSettings } = require('../src/backend-adapters.cjs');
const { VENDOR_PROFILES, VENDOR_TESTED_EVIDENCE, VENDOR_MESSAGES, validateVendorSettings,
  vendorPixelFormat, describeVendorRecipe, vendorFragments } = require('../src/vendor-profiles.cjs');
const defaults = profile => ({ profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default });
const invalid = fn => assert.throws(fn, { code: 'INVALID_SETTINGS', message: VENDOR_MESSAGES.INVALID_SETTINGS });

test('six deeply frozen vendor rows derive all controls from native exports without changing ordinary profiles', () => {
  assert.equal(PROFILES.length, 6);
  assert.equal(VENDOR_PROFILES.length, 6);
  assert.deepEqual(VENDOR_PROFILES.map(row => [row.id, row.encoder, row.twin, row.bitDepths, row.quality]), [
    ['h264-amd', 'h264_amf', 'h264-cpu', [8], { mode: 'QP', min: 0, max: 51, default: 24 }],
    ['h265-amd', 'hevc_amf', 'h265-cpu', [8, 10], { mode: 'QP', min: 0, max: 51, default: 24 }],
    ['av1-amd', 'av1_amf', 'av1-cpu', [8, 10], { mode: 'QP', min: 0, max: 255, default: 128 }],
    ['h264-intel', 'h264_qsv', 'h264-cpu', [8], { mode: 'ICQ', min: 1, max: 51, default: 25 }],
    ['h265-intel', 'hevc_qsv', 'h265-cpu', [8, 10], { mode: 'ICQ', min: 1, max: 51, default: 25 }],
    ['av1-intel', 'av1_qsv', 'av1-cpu', [8, 10], { mode: 'QP', min: 0, max: 255, default: 128 }],
  ]);
  const frozen = value => {
    if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); }
  };
  frozen(VENDOR_PROFILES); frozen(VENDOR_TESTED_EVIDENCE); frozen(VENDOR_MESSAGES);
  assert.deepEqual(VENDOR_TESTED_EVIDENCE, []);
  for (const profile of VENDOR_PROFILES) {
    const native = NATIVE_PROFILES.find(row => row.id === profile.nativeId);
    assert.deepEqual(profile.presets, native.presets);
    assert.equal(profile.defaultPreset, native.operationalSeed.preset);
    assert.equal(profile.tier, 'untested');
    assert.equal(profile.suffix, `${profile.codec}-${profile.hardware}-GPU`);
    assert.throws(() => profile.presets.push('injected'), TypeError);
  }
});

test('vendor ids and native ids are disjoint and neither path accepts the other namespace', () => {
  for (const profile of VENDOR_PROFILES) {
    assert.ok(!NATIVE_PROFILES.some(row => row.id === profile.id));
    invalid(() => validateVendorSettings({ ...defaults(profile), profileId: profile.nativeId }));
    assert.throws(() => validateNativeEncoderSettings(profile.id, { preset: profile.defaultPreset, mode: 'cqp', quality: 24 }), { code: 'INVALID_NATIVE_PROFILE' });
  }
});

for (const profile of VENDOR_PROFILES) for (const depth of profile.bitDepths) {
  test(`${profile.id} ${depth}-bit fragments equal the canonical native contribution for every preset and quality boundary`, () => {
    const native = NATIVE_PROFILES.find(row => row.id === profile.nativeId), mode = native.operationalSeed.mode;
    for (const preset of profile.presets) for (const quality of [profile.quality.min, profile.quality.max, profile.quality.default]) {
      const settings = { profileId: profile.id, preset, quality };
      assert.deepEqual(validateVendorSettings(settings), settings);
      const nativeQuality = mode === 'cqp' ? Object.fromEntries(native.modes.cqp.fields.map(field => [field, quality])) : quality;
      assert.deepEqual(vendorFragments(profile, settings, depth), nativeEncoderContribution(native.id,
        { preset, mode, quality: nativeQuality }, { bitDepth: depth, pipelineId: 'software-d3d11-upload-v1' }));
    }
    assert.equal(vendorPixelFormat(profile, depth === 10 ? 'yuv420p10le' : 'yuv420p'), depth === 10 ? 'p010le' : 'nv12');
  });
}

const base = defaults(VENDOR_PROFILES[0]);
for (const [label, request] of [
  ['null', null], ['array', []], ['primitive', 'h264-amd'], ['inherited record', Object.create(base)],
  ['unknown id', { ...base, profileId: 'unknown-path-secret' }], ['prototype id', { ...base, profileId: '__proto__' }],
  ['ordinary id', { ...base, profileId: 'h264-cpu' }], ['mode key', { ...base, mode: 'cqp' }],
  ['device key', { ...base, deviceId: 'secret-path' }], ['recipe', { ...base, recipeId: 'archive-quality-hevc-v1' }],
  ['symbol', { ...base, [Symbol('field')]: 1 }], ['missing quality', { profileId: base.profileId, preset: base.preset }],
  ['Intel preset on AMD', { ...base, preset: 'medium' }], ['AMD preset on Intel', { profileId: 'h264-intel', preset: 'balanced', quality: 25 }],
  ['QP 256', { profileId: 'av1-amd', preset: 'balanced', quality: 256 }],
  ['ICQ zero', { profileId: 'h265-intel', preset: 'medium', quality: 0 }],
  ['negative quality', { ...base, quality: -1 }], ['float', { ...base, quality: 24.5 }],
  ['string quality', { ...base, quality: '24' }], ['NaN', { ...base, quality: NaN }], ['Infinity', { ...base, quality: Infinity }],
  ['unsafe integer', { ...base, quality: Number.MAX_SAFE_INTEGER + 1 }], ['object preset', { ...base, preset: new String('balanced') }],
  ['hidden field', Object.defineProperty({ ...base }, 'quality', { value: 24, enumerable: false })],
]) test(`vendor settings reject ${label} with fixed text`, () => invalid(() => validateVendorSettings(request)));

test('vendor accessors and proxies are rejected without executing their code', () => {
  for (const key of ['profileId', 'preset', 'quality']) {
    const request = { ...base }; Object.defineProperty(request, key, { enumerable: true, get() { assert.fail('accessor ran'); } });
    invalid(() => validateVendorSettings(request));
  }
  invalid(() => validateVendorSettings(new Proxy(base, { getPrototypeOf() { assert.fail('proxy trap ran'); } })));
  const revoked = Proxy.revocable(base, {}); revoked.revoke(); invalid(() => validateVendorSettings(revoked.proxy));
  assert.deepEqual(validateVendorSettings(Object.assign(Object.create(null), base)), base);
});

for (const pixel of ['yuv422p', 'yuv422p10le', 'yuvj420p', 'gray', 'gray10le', 'yuv444p', 'yuv444p10le', 'nv12', 'p010le', 'yuva420p', 'yuv420p12le', undefined]) {
  test(`vendor pixels reject ${String(pixel)} before constructing argv`, () => {
    for (const profile of VENDOR_PROFILES) assert.throws(() => vendorPixelFormat(profile, pixel), {
      code: 'UNSUPPORTED_PIXEL_FORMAT', message: VENDOR_MESSAGES.UNSUPPORTED_PIXEL_FORMAT,
    });
  });
}
test('H.264 10-bit and all unoffered fragment depths fail closed', () => {
  for (const profile of VENDOR_PROFILES) {
    for (const depth of [0, 12, '8', NaN, ...(!profile.bitDepths.includes(10) ? [10] : [])]) {
      assert.throws(() => vendorFragments(profile, defaults(profile), depth), { code: 'VENDOR_DEPTH_NOT_OFFERED' });
    }
    if (profile.codec === 'H264') assert.throws(() => vendorPixelFormat(profile, 'yuv420p10le'), { code: 'VENDOR_DEPTH_NOT_OFFERED' });
  }
});
test('forged profiles and mismatched settings cannot supply encoder syntax', () => {
  invalid(() => vendorFragments({ ...VENDOR_PROFILES[0] }, base, 8));
  invalid(() => vendorFragments(VENDOR_PROFILES[1], base, 8));
  invalid(() => vendorPixelFormat({ ...VENDOR_PROFILES[0] }, 'yuv420p'));
});
test('recipe descriptions use fixed help and honest starting values without leaking supplied values', () => {
  for (const profile of VENDOR_PROFILES) {
    const result = describeVendorRecipe(defaults(profile)), fragment = vendorFragments(profile, defaults(profile), 8);
    assert.deepEqual(result.args, [...fragment.codec, ...fragment.preset, ...fragment.options]);
    assert.deepEqual(result.presetContribution, fragment.preset);
    assert.equal(result.startingValues.tier, 'untested');
    assert.ok(!Object.hasOwn(result, 'testedDefault'));
    assert.match(result.disclosure, /cannot/);
  }
  invalid(() => describeVendorRecipe({ ...base, preset: 'F:\\secret\\stderr' }));
  for (const code of ['VENDOR_EXECUTION_UNAVAILABLE', 'VENDOR_VALIDATION_TIMEOUT', 'VENDOR_ENCODE_FAILED',
    'VENDOR_HDR_DEFERRED', 'VENDOR_ROUTE_UNQUALIFIED', 'VENDOR_FRAME_COUNT_MISMATCH']) assert.equal(typeof VENDOR_MESSAGES[code], 'string');
});
