'use strict';

// Pure validation of one explicitly qualified Matroska clock representation.
// Demuxed packet PTS have CodecDelay removed; the stored container endpoint
// includes it. This does not replace decoded timing/content validation, grant
// publication, or make a lossy AAC sample-count difference lossless.
const { EXPLICIT_AAC_DISCARD_CLOCK, isWindowsAacTuple } = require('./operation-aac-discard-clock.cjs');
const REPRESENTATION = 'matroska-packet-end-plus-codec-delay';
const SAFE = BigInt(Number.MAX_SAFE_INTEGER), US = 1000000n;
const VIDEO_KEYS = ['sourceFrameCount', 'outputFrameCount', 'firstSourcePtsUs', 'lastSourcePtsUs', 'lastSourceDurationUs',
  'firstOutputPtsUs', 'lastOutputPtsUs', 'lastOutputDurationUs', 'comparedFrames', 'maxRebasedTimestampErrorUs'];
const AUDIO_KEYS = ['inputIndex', 'sourceSampleCount', 'outputSampleCount', 'firstSourcePtsUs', 'lastSourceEndUs',
  'firstOutputPtsUs', 'lastOutputEndUs', 'encoderDelaySamples', 'discardPaddingSamples'];
const POLICY_KEYS = ['index', 'mode', 'sampleRate', 'channels', 'channelLayout', 'timestampMapping', 'qualification',
  'losslessOriginalClaim', 'codec', 'profile', 'bitrateKbps', 'bitrateOrigin', 'sampleRepresentation'];
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = message => { throw Object.assign(new Error(message), { code: 'INVALID_OPERATION_VALIDATION' }); };
const need = (condition, message) => { if (!condition) fail(message); };
function record(value, allowed, required = allowed) {
  need(plain(value), 'Container clock values must be inert records.');
  const keys = Reflect.ownKeys(value);
  need(required.every(key => own(value, key)) && keys.every(key => typeof key === 'string' && allowed.includes(key)), 'Container clock record has missing or unsupported fields.');
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(descriptor.enumerable && own(descriptor, 'value'), 'Container clock records cannot contain accessors or hidden fields.');
  }
}
function list(value, length) {
  need(Array.isArray(value) && value.length === length && Reflect.ownKeys(value).length === length + 1, 'Container clock lists must be dense and have the exact qualified length.');
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    need(descriptor && descriptor.enumerable && own(descriptor, 'value'), 'Container clock lists cannot contain accessors or holes.');
  }
  return value;
}
function inert(value, state = { nodes: 0 }, depth = 0) {
  need(++state.nodes <= 512 && depth <= 8, 'Container clock input exceeds its bounded structure.');
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') { need(Number.isSafeInteger(value), 'Container clock numbers must remain exact safe integers.'); return; }
  if (typeof value === 'string') { need(value.length <= 1024, 'Container clock text exceeds its bound.'); return; }
  need(plain(value) || Array.isArray(value), 'Container clock inputs must contain only inert data.');
  if (Array.isArray(value)) need(value.length <= 32 && Reflect.ownKeys(value).length === value.length + 1, 'Container clock arrays exceed their bound or contain extra fields.');
  for (const key of Reflect.ownKeys(value)) {
    if (Array.isArray(value) && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    need(typeof key === 'string' && descriptor.enumerable && own(descriptor, 'value'), 'Container clock input cannot contain accessors, symbols or hidden fields.');
    inert(descriptor.value, state, depth + 1);
  }
}
function integer(value, label, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${label} must be an exact bounded integer.`); return BigInt(value);
}
function rational(n, d) {
  need(d > 0n, 'Container clock denominator must be positive.');
  let a = n < 0n ? -n : n, b = d;
  while (b) [a, b] = [b, a % b];
  const gcd = a || 1n; return { n: n / gcd, d: d / gcd };
}
function packetTime(value) {
  record(value, ['n', 'd']);
  need(typeof value.n === 'string' && /^(0|[1-9]\d{0,39})$/.test(value.n)
    && typeof value.d === 'string' && /^[1-9]\d{0,39}$/.test(value.d), 'Packet endpoint needs bounded exact integer strings and a positive denominator.');
  const result = rational(BigInt(value.n) * US, BigInt(value.d));
  need(result.n > 0n && result.n <= SAFE * result.d, 'Packet endpoint is empty or exceeds exact microsecond handling.'); return result;
}
function audioOrigin(value) {
  record(value, ['n', 'd']);
  need(typeof value.n === 'string' && /^-?(0|[1-9]\d{0,39})$/.test(value.n)
    && typeof value.d === 'string' && /^[1-9]\d{0,39}$/.test(value.d), 'Canonical audio origin needs bounded exact integer strings and a positive denominator.');
  const result = rational(BigInt(value.n) * US, BigInt(value.d));
  need(result.n >= -SAFE * result.d && result.n <= SAFE * result.d, 'Canonical audio origin exceeds exact microsecond handling.'); return result;
}
const add = (a, b) => rational(a.n * b.d + b.n * a.d, a.d * b.d);
const subtract = (a, b) => rational(a.n * b.d - b.n * a.d, a.d * b.d);
const compare = (a, b) => a.n * b.d - b.n * a.d;
function within(actual, expected, toleranceUs, label) {
  const difference = subtract(actual, expected), magnitude = difference.n < 0n ? -difference.n : difference.n;
  need(magnitude <= BigInt(toleranceUs) * difference.d, `${label} differs beyond the independently qualified tolerance.`);
}
function checkedVideo(value) {
  record(value, VIDEO_KEYS);
  for (const key of VIDEO_KEYS) integer(value[key], key, key.includes('Pts') ? -Number.MAX_SAFE_INTEGER
    : key.includes('Count') || key === 'comparedFrames' || key.includes('Duration') ? 1 : 0);
  need(value.sourceFrameCount === value.outputFrameCount && value.comparedFrames === value.outputFrameCount
    && value.lastSourcePtsUs >= value.firstSourcePtsUs && value.lastOutputPtsUs >= value.firstOutputPtsUs, 'Decoded video count/order is incomplete or inconsistent.');
  const end = BigInt(value.lastOutputPtsUs) + BigInt(value.lastOutputDurationUs);
  need(end > 0n && end <= SAFE, 'Decoded video endpoint exceeds exact handling.'); return rational(end, 1n);
}
function checkedAudio(value, mapping, policy, explicitDiscard) {
  record(value, AUDIO_KEYS);
  for (const key of AUDIO_KEYS) integer(value[key], key, /Pts|End/.test(key) ? -Number.MAX_SAFE_INTEGER
    : key.includes('SampleCount') ? 1 : 0, key === 'inputIndex' ? 1023 : Number.MAX_SAFE_INTEGER);
  need(value.inputIndex === mapping.inputIndex && policy.index === mapping.inputIndex
    && value.lastSourceEndUs > value.firstSourcePtsUs && value.lastOutputEndUs > value.firstOutputPtsUs, 'Decoded audio must describe the one mapped, ordered stream.');
  need(value.encoderDelaySamples === 1024 && (explicitDiscard ? value.discardPaddingSamples <= 1023 : value.discardPaddingSamples === 0),
    'The AAC clock needs its measured priming and discard padding.');
}

function validateContainerClock(clock, options) {
  inert(clock); inert(options);
  const explicitDiscard = clock.representation === EXPLICIT_AAC_DISCARD_CLOCK;
  record(clock, ['representation', 'streams', ...(explicitDiscard ? ['nativeDurationTicks', 'discardPaddingNs'] : [])]);
  need(explicitDiscard || clock.representation === REPRESENTATION, 'Unknown or unqualified container clock representation.');
  record(options, ['mappings', 'video', 'audio', 'audioPolicies', 'audioOrigin', 'videoToleranceUs', 'audioToleranceUs']);
  const origin = audioOrigin(options.audioOrigin);
  integer(options.videoToleranceUs, 'Video packet timing tolerance', 0, 1000000);
  integer(options.audioToleranceUs, 'Audio packet timing tolerance', 0, 1000000);
  const mappings = list(options.mappings, 2), streams = list(clock.streams, 2);
  for (const mapping of mappings) {
    record(mapping, ['inputIndex', 'outputIndex', 'codecType', 'codecName'], ['inputIndex', 'outputIndex', 'codecType']);
    integer(mapping.inputIndex, 'Input mapping index', 0, 1023); integer(mapping.outputIndex, 'Output mapping index', 0, 1023);
    need(['video', 'audio'].includes(mapping.codecType), 'Only one video and one AAC audio clock are qualified.');
    if (own(mapping, 'codecName')) need(mapping.codecName === (mapping.codecType === 'video' ? 'hevc' : 'aac'), 'This representation is limited to the qualified HEVC/AAC output family.');
  }
  need(new Set(mappings.map(item => item.inputIndex)).size === 2 && new Set(mappings.map(item => item.outputIndex)).size === 2, 'Container clock mappings must be unique.');
  const videoMapping = mappings.find(item => item.codecType === 'video'), audioMapping = mappings.find(item => item.codecType === 'audio');
  need(videoMapping && audioMapping, 'Exactly one video and one audio mapping are required.');
  const policies = list(options.audioPolicies, 1), policy = policies[0];
  record(policy, POLICY_KEYS, ['index', 'mode', 'sampleRate', 'channels', 'channelLayout']);
  integer(policy.index, 'Audio policy index', 0, 1023);
  const measuredTuple = explicitDiscard ? isWindowsAacTuple(policy.sampleRate, policy.channels, policy.channelLayout)
    : policy.sampleRate === 48000 && policy.channels === 2 && policy.channelLayout === 'stereo';
  need(policy.index === audioMapping.inputIndex && policy.mode === 'precision-aac' && measuredTuple,
    'This clock requires its exact mapped precision AAC tuple.');
  const optionalValues = { timestampMapping: 'subtract-one-common-absolute-start', qualification: 'encoder-layout-rate-container-delay-padding-required',
    losslessOriginalClaim: false, codec: 'aac', profile: 'LC', bitrateKbps: explicitDiscard && policy.channels === 1 ? 128 : 320,
    bitrateOrigin: 'layout-policy', sampleRepresentation: 'decoded-audio-lossy-reencode' };
  for (const [key, expected] of Object.entries(optionalValues)) if (own(policy, key)) need(policy[key] === expected, 'Audio policy is outside the qualified initial AAC family.');
  const videoEnd = checkedVideo(options.video), audio = list(options.audio, 1)[0];
  checkedAudio(audio, audioMapping, policy, explicitDiscard);
  const seen = new Set(); let maximum = null;
  for (const stream of streams) {
    record(stream, ['outputIndex', 'packetCount', 'packetEnd', 'codecDelaySamples', 'sampleRate']);
    integer(stream.outputIndex, 'Packet output index', 0, 1023); const count = integer(stream.packetCount, 'Complete packet count', 1);
    integer(stream.codecDelaySamples, 'Container codec delay');
    const mapping = mappings.find(item => item.outputIndex === stream.outputIndex);
    need(mapping && !seen.has(stream.outputIndex), 'Every mapped output needs exactly one complete packet clock.'); seen.add(stream.outputIndex);
    const endpoint = packetTime(stream.packetEnd); let stored = endpoint;
    if (mapping.codecType === 'video') {
      need(stream.codecDelaySamples === 0 && stream.sampleRate === null && count === BigInt(options.video.outputFrameCount), 'Video packet count/delay does not match complete decoded frames.');
      within(endpoint, videoEnd, options.videoToleranceUs, 'Video packet endpoint');
    } else {
      need(stream.sampleRate === policy.sampleRate && stream.codecDelaySamples === 1024 && stream.codecDelaySamples === audio.encoderDelaySamples,
        'AAC packet clock needs the same qualified codec delay and sample rate as decoded evidence.');
      const audioRate = BigInt(policy.sampleRate), discard = BigInt(audio.discardPaddingSamples);
      need(count * 1024n - 1024n - discard === BigInt(audio.outputSampleCount),
        'AAC packets minus verified priming and discard do not match decoded output samples.');
      if (explicitDiscard) {
        const nativeDiscard = integer(clock.discardPaddingNs, 'Native discard padding', 0, 24000000);
        need(audio.sourceSampleCount === audio.outputSampleCount && nativeDiscard === (2n * discard * 1000000000n + audioRate) / (2n * audioRate),
          'The native discard must retain exactly the selected samples.');
      }
      // A terminal AAC coding tail must be nonnegative and shorter than one
      // complete1024-sample access unit. Missing/extra packets cannot acquire a
      // fitted clock shift through a conveniently signed sample difference.
      const difference = BigInt(audio.outputSampleCount) - BigInt(audio.sourceSampleCount);
      need(difference >= 0n && difference <= 1023n, 'Decoded AAC output must retain the selected samples with at most1023 terminal coding-tail samples.');
      const selectedEnd = subtract(rational(BigInt(audio.lastOutputEndUs), 1n), rational(difference * US, audioRate));
      within(endpoint, selectedEnd, options.audioToleranceUs, 'AAC packet endpoint and independently decoded tail');
      // The origin is supplied from the genuine canonical plan's effective
      // filter origin. Independently check the selected SOURCE endpoint too;
      // decoded padding/count agreement alone cannot prove source membership.
      const selectedSourceEnd = subtract(rational(BigInt(audio.lastSourceEndUs), 1n), origin);
      need(selectedSourceEnd.n > 0n, 'The selected source audio endpoint must follow the canonical origin.');
      within(endpoint, selectedSourceEnd, options.audioToleranceUs, 'AAC packet endpoint and rebased selected source');
      stored = add(endpoint, rational(1024n * US, audioRate));
    }
    need(stored.n > 0n && stored.n <= SAFE * stored.d, 'Stored container endpoint exceeds exact microsecond handling.');
    if (!maximum || compare(stored, maximum) > 0n) maximum = stored;
  }
  need(seen.size === mappings.length && maximum, 'A mapped packet clock is missing.');
  if (explicitDiscard) {
    const ticks = integer(clock.nativeDurationTicks, 'Native Matroska duration', 1, 4000);
    const duration = rational(ticks * 1000n, 1n);
    within(duration, maximum, 1000, 'Physical Matroska duration and the longest stored clock');
    return Object.freeze({ maximumStoredEndUs: Number(duration.n) });
  }
  // Match canonical nearest-us conversion, with positive half ties rounded up.
  // Every consistency comparison above used the exact rational, before rounding.
  const rounded = maximum.n / maximum.d + (maximum.n % maximum.d * 2n >= maximum.d ? 1n : 0n);
  need(rounded > 0n && rounded <= SAFE, 'Rounded container endpoint exceeds exact handling.');
  return Object.freeze({ maximumStoredEndUs: Number(rounded) });
}

module.exports = { validateContainerClock };
