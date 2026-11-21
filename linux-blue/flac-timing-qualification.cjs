'use strict';

// Timing arithmetic only. Keep this derivation in parity with the frozen,
// independently pinned calibration producer; no calibration I/O belongs here.
const assert = require('node:assert/strict');

const rational = value => {
  const match = /^(-?\d+)\/([1-9]\d*)$/.exec(String(value)); assert.ok(match, 'Exact rational required'); return { n: BigInt(match[1]), d: BigInt(match[2]) };
};
const add = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const ceilUs = value => { assert.ok(value.n >= 0n && value.d > 0n); return Number((value.n * 1000000n + value.d - 1n) / value.d); };

function frozenQualifications(id, runtimeIdentity, probe) {
  // TEMP observation fixed the model before these bounds: Matroska stores the
  // latest decoded output end, without AAC priming, padding or a fitted shift.
  const video = probe.streams.find(stream => stream.codec_type === 'video'), audio = probe.streams.find(stream => stream.codec_type === 'audio');
  assert.equal(audio.codec_name, 'pcm_s16le'); assert.equal(audio.sample_fmt, 's16');
  assert.equal(audio.sample_rate, '48000'); assert.equal(audio.channels, 2); assert.equal(audio.channel_layout, 'stereo');
  const videoTick = rational(video.time_base), audioTick = rational(audio.time_base), outputTick = rational('1/1000'), sample = rational('1/48000');
  assert.ok(videoTick.n > 0n && audioTick.n > 0n);
  const videoUs = ceilUs(add(add(videoTick, outputTick), rational('1/1000000')));
  const audioUs = ceilUs(add(add(audioTick, sample), outputTick));
  const tolerances = { videoTimestampUs: videoUs, audioTimestampUs: audioUs, avSyncUs: videoUs + audioUs,
    durationUs: videoUs + ceilUs(sample), sampleCount: 0 };
  // No bound may exceed the existing AAC range family's frozen envelope.
  const ceilings = { videoTimestampUs: 1067, audioTimestampUs: 22355, avSyncUs: 23422, durationUs: 1088, sampleCount: 1023 };
  for (const key of Object.keys(ceilings)) assert.ok(tolerances[key] <= ceilings[key], key + ' exceeds the AAC range ceiling');
  assert.ok(videoUs <= 1067 && audioUs <= 1042, 'Interior timing exceeds the AAC range ceiling');
  return { frozenBeforeEncode: true, expectedOutputTimeBase: '1/1000',
    derivation: { sourceVideoTimeBase: video.time_base, sourceAudioTimeBase: audio.time_base, outputTimeBaseHypothesis: '1/1000',
      video: 'source video tick + fixed output tick + one microsecond representation allowance',
      audioInterior: 'source audio tick + one source sample + fixed output tick',
      audioEndpoint: 'audio interior quantization only; FLAC adds no coding tail',
      containerDuration: 'end-timestamp: max decoded video/audio output end; duration bound = video bound + ceil(one sample)',
      sampleCount: 'zero: complete selected canonical s16le PCM byte/hash/sample identity',
      noObservedCandidateErrorUsed: true },
    qualification: { evidenceId: `${id}:endpoints`, runtimeIdentity, containerDuration: 'end-timestamp', tolerances },
    timingQualification: { evidenceId: `${id}:interior`, runtimeIdentity, videoDurationUs: videoUs, audioTimelineUs: audioUs, aac: null } };
}

module.exports = { frozenQualifications };
