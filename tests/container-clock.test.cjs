'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateContainerClock } = require('../src/container-clock.cjs');

// Compact numeric observations derived from the saved full packet/decoded data:
// calibration6cedbad8, retained-aac-container.json, casesA/B. No private artifact
// dependency, media access, decode, executable, network or qualification grant.
const clone = value => structuredClone(value);
const { EXPLICIT_AAC_DISCARD_CLOCK } = require('../src/operation-aac-discard-clock.cjs');
const MODE = 'matroska-packet-end-plus-codec-delay';
const mappings = [{ inputIndex: 0, outputIndex: 0, codecType: 'video', codecName: 'hevc' },
  { inputIndex: 1, outputIndex: 1, codecType: 'audio', codecName: 'aac' }];
const audioPolicies = [{ index: 1, mode: 'precision-aac', sampleRate: 48000, channels: 2, channelLayout: 'stereo',
  timestampMapping: 'subtract-one-common-absolute-start', qualification: 'encoder-layout-rate-container-delay-padding-required',
  losslessOriginalClaim: false, codec: 'aac', profile: 'LC', bitrateKbps: 320, bitrateOrigin: 'layout-policy', sampleRepresentation: 'decoded-audio-lossy-reencode' }];
function fixture(id = 'A') {
  const a = id === 'A', frames = a ? 15 : 240, end = a ? 500000 : 8000000;
  const video = { sourceFrameCount: frames, outputFrameCount: frames, comparedFrames: frames, firstSourcePtsUs: 0,
    lastSourcePtsUs: a ? 466667 : 7966667, lastSourceDurationUs: 33333, firstOutputPtsUs: 0,
    lastOutputPtsUs: end - 33000, lastOutputDurationUs: 33000, maxRebasedTimestampErrorUs: 334 };
  const audio = [{ inputIndex: 1, sourceSampleCount: a ? 24000 : 383376, outputSampleCount: a ? 24576 : 384000,
    firstSourcePtsUs: 0, lastSourceEndUs: a ? 500000 : 7987000, firstOutputPtsUs: 0,
    lastOutputEndUs: a ? 512333 : 8000333, encoderDelaySamples: 1024, discardPaddingSamples: 0 }];
  const clock = { representation: MODE, streams: [
    { outputIndex: 0, packetCount: frames, packetEnd: { n: String(end / 1000), d: '1000' }, codecDelaySamples: 0, sampleRate: null },
    { outputIndex: 1, packetCount: a ? 25 : 376, packetEnd: { n: a ? '500' : '7987', d: '1000' }, codecDelaySamples: 1024, sampleRate: 48000 },
  ] };
  return { clock, options: { mappings: clone(mappings), video, audio, audioPolicies: clone(audioPolicies), audioOrigin: { n: '0', d: '1' }, videoToleranceUs: 1088, audioToleranceUs: 1042 } };
}
const invalid = action => assert.throws(action, error => error.code === 'INVALID_OPERATION_VALIDATION');
const validate = f => validateContainerClock(f.clock, f.options);

test('retainedA arithmetic resolves521ms container clock independently from512333us decoded AAC extent', () => {
  const f = fixture(), result = validate(f);
  assert.deepEqual(result, { maximumStoredEndUs: 521333 }); assert.ok(Object.isFrozen(result));
  assert.equal(f.clock.streams[1].packetCount * 1024 - 1024, 24576);
  assert.equal(f.options.audio[0].outputSampleCount - f.options.audio[0].sourceSampleCount, 576);
  assert.ok(Math.abs(521000 - result.maximumStoredEndUs) <= 1088);
  assert.ok(Math.abs(521000 - f.options.audio[0].lastOutputEndUs) > 1088);
  assert.equal(f.options.videoToleranceUs, 1088); assert.equal(f.options.audioToleranceUs, 1042);
});

test('retainedB arithmetic resolves8008ms clock without fitting the624-sample decoded AAC tail', () => {
  const f = fixture('B'), result = validate(f);
  assert.deepEqual(result, { maximumStoredEndUs: 8008333 });
  assert.equal(f.clock.streams[1].packetCount * 1024 - 1024, 384000);
  assert.equal(f.options.audio[0].outputSampleCount - f.options.audio[0].sourceSampleCount, 624);
  assert.ok(Math.abs(8008000 - result.maximumStoredEndUs) <= 1088);
  assert.ok(Math.abs(8008000 - f.options.audio[0].lastOutputEndUs) > 1088);
});

test('stream order is immaterial and every mapped stream contributes to the stored maximum', () => {
  const f = fixture(); f.clock.streams.reverse(); f.options.mappings.reverse(); assert.deepEqual(validate(f), { maximumStoredEndUs: 521333 });
  f.clock.streams.find(s => s.outputIndex === 0).packetEnd = { n: '7', d: '10' };
  f.options.video.lastOutputPtsUs = 667000; assert.deepEqual(validate(f), { maximumStoredEndUs: 700000 });
});

test('nearest integer microseconds use exact rational arithmetic and positive half ties round up', () => {
  const f = fixture(); f.clock.streams[0].packetEnd = { n: '1400001', d: '2000000' };
  f.options.video.lastOutputPtsUs = 667001; f.options.videoToleranceUs = 1;
  assert.deepEqual(validate(f), { maximumStoredEndUs: 700001 });
  f.clock.streams[0].packetEnd = { n: '140000099', d: '200000000' };
  assert.deepEqual(validate(f), { maximumStoredEndUs: 700000 });
});

test('packet clocks use supplied tolerances exactly, including sub-microsecond failures before rounding', () => {
  const f = fixture(); f.options.videoToleranceUs = 0; assert.ok(validate(f));
  f.clock.streams[0].packetEnd = { n: '5000001', d: '10000000' }; invalid(() => validate(f));
  const audio = fixture(); audio.clock.streams[1].packetEnd = { n: '501042', d: '1000000' }; assert.ok(validate(audio));
  audio.clock.streams[1].packetEnd = { n: '5010421', d: '10000000' }; invalid(() => validate(audio));
  const zero = fixture(); zero.options.audioToleranceUs = 0; invalid(() => validate(zero));
  zero.options.audio[0].lastOutputEndUs = 512000; assert.ok(validate(zero));
});

test('unknown representations and missing/duplicate/unmapped packet streams fail closed', () => {
  for (const mutate of [f => { f.clock.representation = 'end-timestamp'; }, f => { f.clock.representation = 'span'; },
    f => { delete f.clock.representation; }, f => { f.clock.streams.pop(); }, f => { f.clock.streams.push(clone(f.clock.streams[0])); },
    f => { f.clock.streams[1].outputIndex = 0; }, f => { f.clock.streams[1].outputIndex = 2; },
    f => { f.clock.streams[0].extra = true; }, f => { delete f.clock.streams[0].packetEnd; }]) {
    const f = fixture(); mutate(f); invalid(() => validate(f));
  }
});

test('video count, zero delay and packet endpoint must match complete decoded frame evidence', () => {
  for (const mutate of [f => { f.clock.streams[0].packetCount--; }, f => { f.clock.streams[0].packetCount = 0; },
    f => { f.clock.streams[0].codecDelaySamples = 1; }, f => { f.clock.streams[0].sampleRate = 48000; },
    f => { f.clock.streams[0].packetEnd = { n: '498', d: '1000' }; }, f => { f.options.video.comparedFrames--; },
    f => { f.options.video.sourceFrameCount--; }, f => { delete f.options.video.lastOutputDurationUs; },
    f => { f.options.video.lastOutputDurationUs = 0; }, f => { f.options.video.lastOutputPtsUs = -1; f.options.video.firstOutputPtsUs = 0; }]) {
    const f = fixture(); mutate(f); invalid(() => validate(f));
  }
});

test('AAC packet count/delay/sample rate and observed skip/discard evidence cannot be substituted', () => {
  for (const mutate of [f => { f.clock.streams[1].packetCount++; }, f => { f.clock.streams[1].packetCount = -1; },
    f => { f.clock.streams[1].packetCount = '25'; }, f => { f.clock.streams[1].codecDelaySamples = 0; },
    f => { f.clock.streams[1].codecDelaySamples = 2048; }, f => { f.clock.streams[1].sampleRate = null; },
    f => { f.clock.streams[1].sampleRate = 44100; }, f => { f.clock.streams[1].packetEnd = { n: '521', d: '1000' }; },
    f => { f.options.audio[0].outputSampleCount++; }, f => { f.options.audio[0].sourceSampleCount = -1; },
    f => { f.options.audio[0].encoderDelaySamples = 0; }, f => { f.options.audio[0].discardPaddingSamples = 1; },
    f => { f.options.audio[0].inputIndex = 3; }, f => { f.options.audio[0].lastOutputEndUs = f.options.audio[0].firstOutputPtsUs; }]) {
    const f = fixture(); mutate(f); invalid(() => validate(f));
  }
});

test('selected source audio endpoint is rebased by the required canonical exact origin', () => {
  const f = fixture(); f.options.audio[0].firstSourcePtsUs += 10000000; f.options.audio[0].lastSourceEndUs += 10000000;
  f.options.audioOrigin = { n: '10', d: '1' }; assert.deepEqual(validate(f), { maximumStoredEndUs: 521333 });
  const changed = clone(f); changed.options.audioOrigin = { n: '1001', d: '100' }; invalid(() => validate(changed));
  const missing = fixture(); delete missing.options.audioOrigin; invalid(() => validate(missing));
  const fraction = fixture(); fraction.options.audio[0].firstSourcePtsUs = 21; fraction.options.audio[0].lastSourceEndUs += 21;
  fraction.options.audioOrigin = { n: '1', d: '48000' }; assert.deepEqual(validate(fraction), { maximumStoredEndUs: 521333 });
  const wrongSource = fixture(); wrongSource.options.audio[0].lastSourceEndUs += 10000; invalid(() => validate(wrongSource));
});

test('AAC shortage, a full extra access unit, and a dropped final packet cannot be fitted through count differences', () => {
  const shortage = fixture(); shortage.options.audio[0].sourceSampleCount = shortage.options.audio[0].outputSampleCount + 1;
  invalid(() => validate(shortage));
  const extra = fixture(); extra.options.audio[0].sourceSampleCount = extra.options.audio[0].outputSampleCount - 1024;
  extra.clock.streams[1].packetEnd = { n: '491', d: '1000' }; extra.options.audio[0].lastSourceEndUs = 491000;
  invalid(() => validate(extra));
  const dropped = fixture(); dropped.clock.streams[1].packetCount = 24; dropped.options.audio[0].outputSampleCount = 23552;
  dropped.clock.streams[1].packetEnd = { n: '491', d: '1000' }; dropped.options.audio[0].lastOutputEndUs = 491000;
  invalid(() => validate(dropped));
  // A forged longer preceding packet could restore the expected stored end
  // despite448 missing decoded samples. Count/endpoint agreement must not
  // compensate for that shortage.
  const compensated = fixture(); compensated.clock.streams[1].packetCount = 24;
  compensated.options.audio[0].outputSampleCount = 23552;
  compensated.options.audio[0].lastOutputEndUs = 490333;
  compensated.clock.streams[1].packetEnd = { n: '500', d: '1000' };
  invalid(() => validate(compensated));
  const endpoint = fixture(); endpoint.options.audio[0].sourceSampleCount = endpoint.options.audio[0].outputSampleCount - 1023;
  endpoint.options.audio[0].lastOutputEndUs = 521313; assert.ok(validate(endpoint));
});

test('only unique one-video/one-AAC48kHz stereo initial-family mappings and policies apply', () => {
  for (const mutate of [f => { f.options.mappings[1].inputIndex = 0; }, f => { f.options.mappings[1].outputIndex = 0; },
    f => { f.options.mappings[1].codecType = 'subtitle'; }, f => { f.options.mappings[1].codecType = 'video'; },
    f => { f.options.mappings[1].codecName = 'flac'; }, f => { f.options.mappings[0].codecName = 'h264'; },
    f => { f.options.audio = []; }, f => { f.options.audio.push(clone(f.options.audio[0])); },
    f => { f.options.audioPolicies[0].index = 3; }, f => { f.options.audioPolicies[0].mode = 'precision-flac'; },
    f => { f.options.audioPolicies[0].sampleRate = 44100; }, f => { f.options.audioPolicies[0].channels = 6; },
    f => { f.options.audioPolicies[0].channelLayout = '5.1'; }, f => { f.options.audioPolicies[0].profile = 'HE-AAC'; },
    f => { f.options.audioPolicies[0].bitrateOrigin = 'explicit-file'; }, f => { f.options.audioPolicies[0].losslessOriginalClaim = true; }]) {
    const f = fixture(); mutate(f); invalid(() => validate(f));
  }
});

test('malformed, negative, noncanonical and unbounded rational terms are rejected', () => {
  for (const packetEnd of [{ n: '0', d: '1' }, { n: '-1', d: '1' }, { n: '1', d: '0' }, { n: '1', d: '-1' },
    { n: '1.5', d: '1' }, { n: '1e3', d: '1' }, { n: 500, d: '1000' }, { n: '0500', d: '1000' },
    { n: '500', d: '01000' }, { n: '1'.repeat(41), d: '1' }, { n: '1', d: '1'.repeat(41) },
    { n: '500', d: '1000', fittedOffset: 1 }]) {
    const f = fixture(); f.clock.streams[0].packetEnd = packetEnd; invalid(() => validate(f));
  }
  const equivalent = fixture(); equivalent.clock.streams[0].packetEnd = { n: '50000000000000000000', d: '100000000000000000000' };
  assert.deepEqual(validate(equivalent), { maximumStoredEndUs: 521333 });
  for (const origin of [{ n: '0', d: '0' }, { n: 0, d: '1' }, { n: '1e1', d: '1' }, { n: '0', d: '-1' },
    { n: '0', d: '1', fittedOffset: 1 }, { n: '1'.repeat(41), d: '1' }]) {
    const f = fixture(); f.options.audioOrigin = origin; invalid(() => validate(f));
  }
});

test('unsafe arithmetic and malformed tolerances cannot round into apparently valid evidence', () => {
  for (const mutate of [f => { f.options.video.lastOutputPtsUs = Number.MAX_SAFE_INTEGER; f.options.video.lastOutputDurationUs = 1; },
    f => { f.clock.streams[0].packetEnd = { n: String(BigInt(Number.MAX_SAFE_INTEGER) + 1n), d: '1000000' }; },
    f => { f.clock.streams[1].packetCount = Number.MAX_SAFE_INTEGER; }, f => { f.options.audio[0].outputSampleCount = Number.MAX_SAFE_INTEGER + 1; },
    f => { f.options.videoToleranceUs = Infinity; }, f => { f.options.audioToleranceUs = -1; },
    f => { f.options.audioToleranceUs = 1042.5; }, f => { f.options.audioToleranceUs = 1000001; }]) {
    const f = fixture(); mutate(f); invalid(() => validate(f));
  }
});

test('accessors, sparse arrays, symbols, hidden fields and exotic records never introduce authority', () => {
  let reads = 0;
  for (const mutate of [f => { Object.defineProperty(f.clock.streams[0], 'packetCount', { enumerable: true, get() { reads++; return 15; } }); },
    f => { delete f.clock.streams[0]; }, f => { f.options.audioPolicies.extra = true; },
    f => { f.options.audio[0][Symbol('extra')] = 1; }, f => { Object.defineProperty(f.options.video, 'secret', { value: 1 }); },
    f => { Object.setPrototypeOf(f.clock.streams[0], { hiddenAuthority: true }); }]) {
    const f = fixture(); mutate(f); invalid(() => validate(f));
  }
  assert.equal(reads, 0);
});

test('validation is pure and does not add a lossless, padding or publication grant', () => {
  const f = fixture(), before = clone(f), result = validate(f);
  assert.deepEqual(f, before); assert.deepEqual(Object.keys(result), ['maximumStoredEndUs']);
  assert.equal(Object.hasOwn(result, 'publicationAuthorized'), false); assert.equal(Object.hasOwn(result, 'contentIdentity'), false);
  assert.equal(f.options.audio[0].outputSampleCount - f.options.audio[0].sourceSampleCount, 576);
});

test('Windows AAC validates the retained samples after native terminal discard without subtracting it twice', () => {
  const f = fixture('A');
  f.clock.representation = EXPLICIT_AAC_DISCARD_CLOCK;
  f.clock.nativeDurationTicks = 521;
  f.clock.discardPaddingNs = 12000000;
  const audio = f.options.audio[0];
  audio.outputSampleCount = audio.sourceSampleCount;
  audio.lastOutputEndUs = 500000;
  audio.discardPaddingSamples = 576;
  Object.assign(f.options.audioPolicies[0], { channels: 1, channelLayout: 'mono', bitrateKbps: 128 });
  assert.deepEqual(validate(f), { maximumStoredEndUs: 521000 });
  for (const mutate of [
    bad => { bad.options.audio[0].lastOutputEndUs -= 12000; },
    bad => { bad.options.audio[0].outputSampleCount--; },
    bad => { bad.options.audio[0].discardPaddingSamples--; },
    bad => { bad.clock.discardPaddingNs--; },
    bad => { bad.clock.nativeDurationTicks -= 2; },
    bad => { bad.clock.streams[1].sampleRate = 44100; },
    bad => { bad.options.audioPolicies[0].bitrateKbps = 320; },
  ]) {
    const broken = clone(f);
    mutate(broken);
    invalid(() => validate(broken));
  }
});
