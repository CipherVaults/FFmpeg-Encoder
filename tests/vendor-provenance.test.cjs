'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { generationDescriptionOf, generationDescriptionV3, provenanceArgs, classifyMarker, historicalSuffix,
  createOutputId } = require('../src/provenance.cjs');
const { VENDOR_PROFILES, describeVendorRecipe } = require('../src/vendor-profiles.cjs');
const { load } = require('./vendor-s34-fixtures.cjs');
function description(profile = VENDOR_PROFILES[1]) {
  const tuple = { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default };
  return { version: 3, kind: 'vendor-encoder', profileId: profile.id, codec: profile.codec, backend: profile.hardware,
    encoder: profile.encoder, preset: tuple.preset, qualityMode: profile.quality.mode, quality: tuple.quality,
    bitDepth: 8, encoderArgs: describeVendorRecipe(tuple).args, appVersion: '0.7.0-alpha.1', createdAt: '2026-11-12T07:00:00.000Z' };
}
for (const profile of VENDOR_PROFILES) test(`${profile.id} v3 description round trips without changing marker v1`, () => {
  const value = description(profile), outputId = createOutputId();
  assert.deepEqual(generationDescriptionOf(value), value);
  const args = provenanceArgs(outputId, value), tags = {};
  for (let i = 0; i < args.length; i += 2) { const [key, ...tail] = args[i + 1].split('='); tags[key] = tail.join('='); }
  const marker = classifyMarker({ format: { tags } });
  assert.equal(marker.outputId, outputId); assert.deepEqual(marker.previousGeneration, value);
  assert.equal(tags.FFMPEG_ENCODER_PROVENANCE, '1');
  assert.equal(historicalSuffix(`source_${profile.suffix}.mkv`), profile.suffix);
});
for (const patch of [
  { kind: 'native-encoder' }, { profileId: 'h265-amf' }, { profileId: 'unknown' }, { encoder: 'libx265' }, { codec: 'AV1' },
  { backend: 'CPU' }, { qualityMode: 'CRF' }, { quality: 256 }, { bitDepth: 12 }, { encoderArgs: ['-c:v', 'libx265'] },
  { appVersion: '\nprivate' }, { createdAt: '2026-02-30T07:00:00.000Z' }, { runtimeVersion: 'PRIVATE\npath' },
  { recipeId: 'archive' }, { binding: 'PRIVATE' },
]) test(`v3 refuses contradictory or unbounded data ${JSON.stringify(patch)}`, () => {
  assert.equal(generationDescriptionV3({ ...description(), ...patch }), null);
});
test('v3 rejects accessors, proxies and extra array keys without invoking executable properties', () => {
  let reads = 0;
  const value = description(); Object.defineProperty(value, 'encoder', { enumerable: true, get() { reads++; return 'hevc_amf'; } });
  assert.equal(generationDescriptionV3(value), null);
  const proxy = new Proxy(description(), { getPrototypeOf() { reads++; throw new Error('PRIVATE'); } });
  assert.equal(generationDescriptionOf(proxy), null);
  const nested = description(); Object.defineProperty(nested.encoderArgs, '0', { get() { reads++; return '-c:v:0'; } });
  assert.equal(generationDescriptionV3(nested), null); assert.equal(reads, 0);
});
test('accepted-0.6-style v1-only dispatch refuses v3 but retains the generated-output marker', () => {
  // The rewrite must actually apply; a silent non-match would test the current code instead.
  const old = load('src/provenance.cjs', source => { const changed = source.replace(
    /return version\.value === 1 \? generationDescriptionV1\(value\) : version\.value === 2 \? generationDescriptionV2\(value\)\s*: version\.value === 3 \? generationDescriptionV3\(value\)(?: : version\.value === 4 \? generationDescriptionV4\(value\))? : null;/,
    'return version.value === 1 ? generationDescriptionV1(value) : null;'); assert.notEqual(changed, source); return changed; });
  const value = description();
  assert.equal(old.generationDescriptionOf(value), null);
  const marker = old.classifyMarker({ format: { tags: { FFMPEG_ENCODER_PROVENANCE: '1', FFMPEG_ENCODER_OUTPUT_ID: createOutputId(),
    FFMPEG_ENCODER_GENERATION: JSON.stringify(value) } } });
  assert.equal(marker.kind, 'generated'); assert.equal(marker.previousGeneration, undefined); assert.match(marker.descriptionNotice, /unavailable/);
});
module.exports = { description };
