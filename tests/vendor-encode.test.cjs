'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { createHash } = require('node:crypto');
const { buildEncodeOperation } = require('../src/encode-operation.cjs');
const { PROFILES, buildEncodeArgs, classifyColor, describeRecipe } = require('../src/media.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { MARKER_KEY, GENERATION_KEY } = require('../src/provenance.cjs');
const profiles = require('../src/vendor-profiles.cjs');
const { VENDOR_PROFILES, VENDOR_MESSAGES, vendorFragments } = profiles;
const { resolveCatalogSettings } = require('../src/encoder-catalog.cjs');
const { ordinaryProbe } = require('../scripts/capture-ordinary-argv.cjs');
const api = require('../src/vendor-encode.cjs');

const filename = path.resolve(__dirname, '../src/vendor-encode.cjs');
const bindingData = (vendor = 'AMD', adapterIndex = 3) => ({ vendor, adapterIndex,
  vendorId: vendor === 'AMD' ? 0x1002 : 0x8086, deviceId: 0x1234,
  luid: '00000001:00000002', umdVersion: '31.0.1.2', description: 'Private DXGI description' });
const settingsFor = profile => ({ profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default });
function make(implementation = api, { id = 'h265-amd', bitDepth = 10, variant = 'plain', provenance = false,
  settings, twinSettings, generationDescription } = {}) {
  const profile = VENDOR_PROFILES.find(row => row.id === id);
  const resolved = resolveCatalogSettings(settings || settingsFor(profile));
  const twin = twinSettings || resolved.twinSettings;
  const probe = ordinaryProbe(bitDepth === 10 ? 'yuv420p10le' : 'yuv420p', variant);
  const plan = buildEncodeOperation({ input: 'X:\\golden\\input.mkv', output: 'X:\\golden\\output.mkv',
    settings: twin, inspection: { probe, color: classifyColor(probe) },
    request: resolveFileRequest({ fileId: 'vendor-fixture', identityRevision: 1, draftRevision: 1, operation: 'encode' }),
    ...(provenance ? { outputId: '12345678-1234-4123-8123-123456789abc' } : {}),
    ...(generationDescription ? { generationDescription } : {}) });
  return { args: [...plan.args], options: { twinSettings: twin, profile, settings: resolved.settings, bitDepth,
    binding: implementation.createVendorBinding(bindingData(profile.hardware)) } };
}
function overlay(h, implementation = api) { return implementation.overlayVendorArgs(h.args, h.options); }
function expectCode(fn, code = 'VENDOR_ARGV_SHAPE') { assert.throws(fn, { code, message: VENDOR_MESSAGES[code] }); }
function changed(implementation, mutate, config) {
  const h = make(implementation, config); mutate(h); return () => overlay(h, implementation);
}
function loadOverlay(source, badFragments = false) {
  const loaded = new Module(filename, module);
  loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const realRequire = loaded.require.bind(loaded);
  loaded.require = name => name === './vendor-profiles.cjs' && badFragments ? { ...profiles,
    vendorFragments: (...args) => {
      const result = vendorFragments(...args);
      return { ...result, pixelArgs: [...result.pixelArgs, '-pix_fmt:v:0', 'd3d11'] };
    },
  } : realRequire(name);
  loaded._compile(source, filename);
  return loaded.exports;
}

test('h265-amd 10-bit example is built end to end from a genuine CPU operation plan', () => {
  const h = make(api, { variant: 'combined', provenance: true });
  const original = structuredClone(h), result = overlay(h);
  const prefix = ['-hide_banner', '-nostdin', '-loglevel', 'warning', '-nostats', '-progress', 'pipe:1',
    '-n', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi'];
  assert.deepEqual(result, [...prefix,
    '-init_hw_device', 'd3d11va=ffenc_d3d:3', '-filter_hw_device', 'ffenc_d3d', '-i', 'X:\\golden\\input.mkv',
    '-map', '0:2', '-map', '0:4', '-map', '0:7', '-map', '0:9', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy', '-c:v:0', 'hevc_amf',
    '-map_metadata:s:0', '0:s:2', '-metadata:s:0', 'SOURCE_CREATION_TIME=source-time-text', '-disposition:0', 'default',
    '-map_metadata:s:1', '0:s:4', '-metadata:s:1', 'SOURCE_CREATION_TIME=audio-time-text', '-disposition:1', 'default+original',
    '-map_metadata:s:2', '0:s:7', '-disposition:2', '0', '-map_metadata:s:3', '0:s:9', '-disposition:3', 'forced',
    '-quality:v:0', 'balanced', '-usage:v:0', 'transcoding', '-rc:v:0', 'cqp', '-b:v:0', '0', '-qp_i:v:0', '24', '-qp_p:v:0', '24',
    '-filter:v:0', 'format=p010le,hwupload=extra_hw_frames=16', '-profile:v:0', 'main10', '-pix_fmt:v:0', 'd3d11', '-bitdepth:v:0', '10',
    '-fps_mode:v:0', 'passthrough', '-color_trc:v:0', 'bt709', '-color_primaries:v:0', 'bt709', '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv',
    '-metadata', `${MARKER_KEY}=1`, '-metadata', 'FFMPEG_ENCODER_OUTPUT_ID=12345678-1234-4123-8123-123456789abc',
    '-default_mode', 'passthrough', '-f', 'matroska', 'X:\\golden\\output.mkv']);
  assert.deepEqual(h.args, original.args); assert.deepEqual(h.options.settings, original.options.settings);
});

for (const profile of VENDOR_PROFILES) for (const bitDepth of profile.bitDepths) {
  test(`${profile.id} ${bitDepth}-bit overlays every preset and quality boundary with one chosen upload device`, () => {
    for (const preset of profile.presets) for (const quality of [profile.quality.min, profile.quality.default, profile.quality.max]) {
      const h = make(api, { id: profile.id, bitDepth, settings: { profileId: profile.id, preset, quality } });
      const result = overlay(h), fragment = vendorFragments(profile, h.options.settings, bitDepth);
      assert.equal(result.filter(value => value === '-i').length, 1);
      assert.equal(result.filter(value => value === '-filter:v:0').length, 1);
      assert.equal(result.filter(value => value === '-pix_fmt:v:0').length, 1);
      assert.equal(result.filter(value => value === profile.encoder).length, 1);
      assert.equal(result[result.indexOf('-filter:v:0') + 1], fragment.uploadFilters.join(','));
      assert.equal(result.includes('-x265-params'), false); assert.equal(result.includes('-crf:v:0'), false);
      assert.deepEqual(result.slice(12, result.indexOf('-i')), profile.hardware === 'AMD'
        ? ['-init_hw_device', 'd3d11va=ffenc_d3d:3', '-filter_hw_device', 'ffenc_d3d']
        : ['-init_hw_device', 'd3d11va=ffenc_d3d:3', '-init_hw_device', 'qsv=ffenc_qsv@ffenc_d3d', '-filter_hw_device', 'ffenc_qsv']);
      assert.deepEqual(result.slice(-5), h.args.slice(-5));
    }
  });
}

// Each named overlay check has its own negative assertion. The same assertion
// is reused below on an in-memory module with precisely that check disabled.
const negatives = [
  { guard: 'binding-record', run: a => expectCode(() => a.createVendorBinding({ ...bindingData(), device: 'foreign' }), 'VENDOR_DEVICE_INVALID') },
  { guard: 'binding-index', run: a => expectCode(() => a.createVendorBinding(bindingData('AMD', '0,child_device=foreign')), 'VENDOR_DEVICE_INVALID') },
  { guard: 'binding-identity', run: a => expectCode(() => a.createVendorBinding({ ...bindingData(), vendorId: 0x8086 }), 'VENDOR_DEVICE_INVALID') },
  { guard: 'options-record', run: a => expectCode(changed(a, h => { h.options.extra = 'untrusted'; })) },
  { guard: 'ordinary-device', run: a => expectCode(changed(a, h => { h.options.profile = PROFILES[0]; }), 'VENDOR_DEVICE_UNEXPECTED') },
  { guard: 'twin-settings', run: a => expectCode(changed(a, () => {}, { twinSettings: { profileId: 'h265-cpu', preset: 'medium', quality: 25 } })) },
  { guard: 'binding-required', run: a => expectCode(changed(a, h => { h.options.binding = null; }), 'VENDOR_DEVICE_REQUIRED') },
  { guard: 'binding-brand', run: a => expectCode(changed(a, h => { h.options.binding = Object.freeze(bindingData()); }), 'VENDOR_DEVICE_INVALID') },
  { guard: 'binding-vendor', run: a => expectCode(changed(a, h => { h.options.binding = a.createVendorBinding(bindingData('Intel')); }), 'VENDOR_DEVICE_MISMATCH') },
  { guard: 'argv-data', run: a => expectCode(changed(a, h => { h.args.extra = 'hidden-selector'; })) },
  { guard: 'prefix', run: a => expectCode(changed(a, h => { h.args[9] = 'file,http'; })) },
  { guard: 'paths', run: a => expectCode(changed(a, h => { h.args[13] = 'https://foreign/input'; })) },
  { guard: 'map-index', run: a => expectCode(changed(a, h => {
    h.args[h.args.indexOf('-map') + 1] = '0:02'; h.args[h.args.indexOf('-map_metadata:s:0') + 1] = '0:s:02';
  })) },
  { guard: 'map-set', run: a => expectCode(changed(a, h => {
    h.args.splice(h.args.indexOf('-map'), 2); h.args.splice(h.args.indexOf('-map_metadata:s:0'), 4);
  })) },
  { guard: 'mapping-codec', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-c')] = '-unknown-copy-option'; })) },
  { guard: 'stream-metadata', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-map_metadata:s:0')] = '-map_metadata:s:1'; })) },
  { guard: 'creation-alias', run: a => expectCode(changed(a, h => {
    h.args[h.args.indexOf('-metadata:s:0') + 1] = 'UNREVIEWED_TIME=source';
  }, { variant: 'metadata' })) },
  { guard: 'stream-disposition', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-disposition:0') + 1] = 'original+dub'; })) },
  { guard: 'twin-options', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-crf:v:0') + 1] = '26'; })) },
  { guard: 'twin-pixel', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-pix_fmt:v:0') + 1] = '+yuv444p10le'; })) },
  { guard: 'timing', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-fps_mode:v:0') + 1] = 'cfr'; })) },
  { guard: 'transfer', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-color_trc:v:0') + 1] = 'smpte2084'; })) },
  { guard: 'color-value', run: a => expectCode(changed(a, h => { h.args[h.args.indexOf('-colorspace:v:0') + 1] = 'untrusted:foreign'; })) },
  { guard: 'provenance', run: a => expectCode(changed(a, h => {
    h.args[h.args.indexOf('-metadata') + 1] = `${MARKER_KEY}=0`;
  }, { provenance: true })) },
  { guard: 'terminal', run: a => expectCode(changed(a, h => { h.args[h.args.length - 4] = 'changed'; })) },
  { guard: 'complete', run: a => expectCode(changed(a, h => { h.args.push(h.args.at(-1)); })) },
  { guard: 'overlay-final', run: a => {
    // Inject a broken pure contribution to exercise the otherwise unreachable
    // postcondition, without changing any canonical table or production bytes.
    const broken = loadOverlay(a.source || fs.readFileSync(filename, 'utf8'), true);
    expectCode(() => overlay(make(broken), broken));
  } },
  { guard: 'hash-data', run: a => expectCode(() => a.vendorArgsHash(Object.assign(['valid'], { extra: 'field' }))) },
];
for (const negative of negatives) test(`overlay guard ${negative.guard} rejects its own negative case`, () => negative.run(api));

for (const [label, tokens] of [
  ['extra device selectors', ['-init_hw_device', 'd3d11va=foreign:1', '-filter_hw_device', 'foreign']],
  ['duplicate filter', ['-filter:v:0', 'format=nv12,hwupload']],
  ['hwaccel', ['-hwaccel', 'd3d11va']], ['hwaccel output', ['-hwaccel_output_format', 'd3d11']],
  ['vf alias', ['-vf', 'scale=10:10']], ['filter complex', ['-filter_complex', 'null']],
  ['filter script', ['-filter_script:v:0', 'X:\\foreign.txt']],
  ['second input', ['-i', 'X:\\foreign.mkv']], ['second output', ['X:\\second.mkv']],
  ['range', ['-ss', '1']], ['audio transform', ['-c:a', 'flac']], ['resize', ['-s:v', '320x180']],
  ['unknown option', ['-unrecognized', 'value']],
]) test(`whole argv rejects ${label} before the output`, () => {
  expectCode(changed(api, h => { h.args.splice(-5, 0, ...tokens); }));
});

test('whole argv refuses foreign options in every insertion position, including device and filter aliases', () => {
  const h = make();
  for (let position = 0; position <= h.args.length; position++) for (const option of ['-init_hw_device', '-filter:v:0', '-i']) {
    const args = [...h.args]; args.splice(position, 0, option, 'foreign');
    expectCode(() => api.overlayVendorArgs(args, h.options));
  }
});
test('missing, duplicated and altered mapping, stream and terminal pieces fail closed', () => {
  for (const mutate of [
    h => h.args.splice(h.args.indexOf('-map'), 0, '-map', '0:2'),
    h => { h.args[h.args.indexOf('-map') + 1] = '0:9007199254740992'; },
    h => { h.args[h.args.indexOf('-disposition:0') + 1] = 'default+default'; },
    h => { h.args[h.args.indexOf('-disposition:0') + 1] = 'unrecognized'; },
    h => { h.args[13] = h.args.at(-1); },
    h => { h.args[h.args.length - 2] = 'mp4'; },
    h => h.args.splice(-5, 5),
    h => h.args.splice(h.args.indexOf('-c:v:0'), 0, '-c:v:0', 'libx265'),
  ]) expectCode(changed(api, mutate));
});
test('array accessors and proxies fail before executing untrusted property code', () => {
  const h = make();
  const accessor = [...h.args]; Object.defineProperty(accessor, 0, { enumerable: true, get() { assert.fail('argv accessor ran'); } });
  expectCode(() => api.overlayVendorArgs(accessor, h.options));
  expectCode(() => api.overlayVendorArgs(new Proxy(h.args, { getPrototypeOf() { assert.fail('argv proxy ran'); } }), h.options));
  const revoked = Proxy.revocable(h.args, {}); revoked.revoke();
  expectCode(() => api.overlayVendorArgs(revoked.proxy, h.options));
  const options = { ...h.options }; Object.defineProperty(options, 'binding', { enumerable: true, get() { assert.fail('options accessor ran'); } });
  expectCode(() => api.overlayVendorArgs(h.args, options));
});
test('binding factory refuses invalid indexes, schema, vendor and identity observations and never grants a clone a brand', () => {
  for (const index of [-1, 64, 0.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    expectCode(() => api.createVendorBinding(bindingData('AMD', index)), 'VENDOR_DEVICE_INVALID');
  }
  for (const change of [{ vendor: 'NVIDIA' }, { luid: 'not-a-luid' }, { umdVersion: null },
    { deviceId: -1 }, { deviceId: 1.5 }, { description: 'secret\npath' }, { description: 'x'.repeat(129) }]) {
    expectCode(() => api.createVendorBinding({ ...bindingData(), ...change }), 'VENDOR_DEVICE_INVALID');
  }
  const accessor = bindingData(); Object.defineProperty(accessor, 'adapterIndex', { enumerable: true, get() { assert.fail('binding accessor ran'); } });
  expectCode(() => api.createVendorBinding(accessor), 'VENDOR_DEVICE_INVALID');
  expectCode(() => api.createVendorBinding(new Proxy(bindingData(), { ownKeys() { assert.fail('binding proxy ran'); } })), 'VENDOR_DEVICE_INVALID');
  for (const index of [0, 63]) {
    const binding = api.createVendorBinding(bindingData('AMD', index)); assert.ok(Object.isFrozen(binding));
    assert.throws(() => { binding.adapterIndex = 'foreign'; }, TypeError);
    const h = make(); h.options.binding = structuredClone(binding);
    expectCode(() => overlay(h), 'VENDOR_DEVICE_INVALID');
  }
});
test('bindings are refused on every ordinary profile and forged profiles, settings and depths fail closed', () => {
  for (const profile of PROFILES) {
    expectCode(changed(api, h => { h.options.profile = profile; }), 'VENDOR_DEVICE_UNEXPECTED');
  }
  expectCode(changed(api, h => { h.options.profile = { ...h.options.profile }; }), 'INVALID_SETTINGS');
  expectCode(changed(api, h => { h.options.settings = settingsFor(VENDOR_PROFILES[0]); }), 'INVALID_SETTINGS');
  expectCode(changed(api, h => { h.options.bitDepth = 12; }), 'VENDOR_DEPTH_NOT_OFFERED');
  expectCode(changed(api, h => { h.options.bitDepth = 10; }, { id: 'h264-amd', bitDepth: 8 }), 'VENDOR_DEPTH_NOT_OFFERED');
});
test('optional color and provenance syntax accepts genuine builder outputs and rejects malformed or extra metadata', () => {
  const h = make();
  const probe = ordinaryProbe('yuv420p10le');
  for (const key of ['color_primaries', 'color_space', 'color_range']) delete probe.streams[0][key];
  h.args = buildEncodeArgs({ input: 'X:\\golden\\input.mkv', output: 'X:\\golden\\output.mkv', settings: h.options.twinSettings, probe });
  assert.ok(overlay(h).includes('hevc_amf'));
  for (const mutate of [
    x => { x.args[x.args.indexOf('-metadata') + 3] = 'FFMPEG_ENCODER_OUTPUT_ID=invalid'; },
    x => x.args.splice(-5, 0, '-metadata', `${GENERATION_KEY}={broken`),
    x => x.args.splice(-5, 0, '-metadata', `${GENERATION_KEY}={"version":999}`),
    x => x.args.splice(-5, 0, '-metadata', 'arbitrary=not-builder-grammar'),
    x => { x.args[x.args.indexOf('-color_trc:v:0') + 1] = 'arib-std-b67'; },
    x => { x.args[x.args.indexOf('-color_range:v:0') + 1] = 'unknown'; },
  ]) expectCode(changed(api, mutate, { provenance: true }));
});
test('a genuine descriptive provenance run is retained as inert metadata', () => {
  const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
  const generationDescription = { version: 1, profileId: settings.profileId, codec: 'H265', backend: 'CPU',
    encoder: 'libx265', preset: settings.preset, qualityMode: 'CRF', quality: settings.quality, bitDepth: 10,
    encoderArgs: describeRecipe(settings).args, appVersion: '0.7.0-alpha.1', createdAt: '2000-01-01T00:00:00.000Z' };
  const h = make(api, { provenance: true, generationDescription });
  const value = h.args.find(token => token.startsWith(`${GENERATION_KEY}=`));
  assert.equal(overlay(h).find(token => token.startsWith(`${GENERATION_KEY}=`)), value);
  assert.equal(overlay(h).filter(token => token === '-i').length, 1);
});
test('hash binds every token, its order and adapter index without join collisions', () => {
  const h = make(), args = overlay(h), first = api.vendorArgsHash(args);
  assert.equal(first, createHash('sha256').update(args.map(value => JSON.stringify(value)).join('\n')).digest('hex'));
  assert.equal(first, api.vendorArgsHash([...args]));
  h.options.binding = api.createVendorBinding(bindingData('AMD', 4));
  assert.notEqual(first, api.vendorArgsHash(overlay(h)));
  for (const [a, b] of [[['a', 'bc'], ['ab', 'c']], [['a\nb'], ['a', 'b']], [[], ['']], [['a', 'b'], ['b', 'a']], [['\ud800'], ['\ufffd']]]) {
    assert.notEqual(api.vendorArgsHash(a), api.vendorArgsHash(b));
  }
  expectCode(() => api.vendorArgsHash([1])); expectCode(() => api.vendorArgsHash(['\0']));
});
test('pure modules do not import discovery, native state, filesystem or child execution on the overlay path', () => {
  const source = fs.readFileSync(filename, 'utf8');
  assert.doesNotMatch(source, /require\(['"](?:node:)?(?:fs|child_process|net|https?|dns)|require\(['"]\.\/(?:backend-discovery|native-(?:file|capabilit|backend))/);
  assert.equal(require('../src/native-file-runtime.cjs').DEFAULT_NATIVE_FILE_POLICIES.length, 0);
  assert.equal(PROFILES.length, 6);
});

test('each guard removal makes its own negative assertion fail in memory, with unchanged source hashes', () => {
  const source = fs.readFileSync(filename, 'utf8'), before = createHash('sha256').update(source).digest('hex');
  const guards = [...source.matchAll(/(?:guard|take)\('([^']+)'/g)].map(match => match[1]);
  assert.deepEqual([...new Set(guards)].sort(), negatives.map(item => item.guard).sort());
  for (const negative of negatives) {
    const mutated = source.replace('if (!condition)', `if (name !== '${negative.guard}' && !condition)`);
    assert.notEqual(mutated, source);
    const mutant = loadOverlay(mutated); mutant.source = mutated;
    assert.throws(() => negative.run(mutant), { code: 'ERR_ASSERTION' }, `surviving guard mutant: ${negative.guard}`);
  }
  assert.equal(createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), before);
});
