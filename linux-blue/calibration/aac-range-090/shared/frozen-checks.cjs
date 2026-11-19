'use strict';
const assert=require('node:assert/strict');
const SIGNAL = Object.freeze({ format: 'f32le-interleaved', channels: 2, sampleRate: 48000, windowSamples: 4096,
  lagRadiusSamples: 2048, coarseLagStep: 16, coarseSampleStride: 8, fractions: [0, 0.25, 0.5, 0.75, 1],
  minimumCorrelation: 0.90, maximumNormalizedRmsError: 0.45, maximumCrossChannelCorrelation: 0.80,
  minimumChannelSeparation: 0.10, maximumAcceptedLagSamples: 0, tieEpsilon: 1e-12 });
const rational = value => {
  const match = /^(-?\d+)\/([1-9]\d*)$/.exec(String(value)); assert.ok(match, 'Exact rational required'); return { n: BigInt(match[1]), d: BigInt(match[2]) };
};
const add = (a, b) => ({ n: a.n * b.d + b.n * a.d, d: a.d * b.d });
const packed = value => ({ n: BigInt(value.n), d: BigInt(value.d) });
const compare = (a, b) => a.n * b.d - b.n * a.d;
const ceilUs = value => { assert.ok(value.n >= 0n && value.d > 0n); return Number((value.n * 1000000n + value.d - 1n) / value.d); };

function frozenQualifications(id, runtimeIdentity, probe) {
  // These bounds are fixed BEFORE encoding. The expected Matroska tick and
  // native AAC terminal block allowance are hypotheses under test, never fitted
  // to observed candidate errors. Different output time bases fail this trial.
  const video = probe.streams.find(stream => stream.codec_type === 'video'), audio = probe.streams.find(stream => stream.codec_type === 'audio');
  const videoTick = rational(video.time_base), audioTick = rational(audio.time_base), outputTick = rational('1/1000'), sample = rational('1/48000');
  const videoUs = ceilUs(add(add(videoTick, outputTick), rational('1/1000000')));
  const audioClockUs = ceilUs(add(add(audioTick, sample), outputTick));
  const terminalSamples = 1023, audioUs = ceilUs(rational(`${terminalSamples}/48000`)) + audioClockUs;
  return { frozenBeforeEncode: true, expectedOutputTimeBase: '1/1000',
    derivation: { sourceVideoTimeBase: video.time_base, sourceAudioTimeBase: audio.time_base, outputTimeBaseHypothesis: '1/1000',
      video: 'source tick + fixed output tick + one microsecond representation allowance',
      audioInterior: 'source audio tick + one source sample + fixed output tick',
      audioEndpoint: 'at most1023 terminal AAC block samples + audio interior quantization; no source sample shortage permitted',
      countAllowanceIsNotSignalledPadding: true, noObservedCandidateErrorUsed: true },
    qualification: { evidenceId: `${id}:endpoints`, runtimeIdentity, containerDuration: 'matroska-packet-end-plus-codec-delay',
      tolerances: { videoTimestampUs: videoUs, audioTimestampUs: audioUs, avSyncUs: videoUs + audioUs,
        durationUs: videoUs + ceilUs(sample), sampleCount: terminalSamples } },
    timingQualification: { evidenceId: `${id}:interior`, runtimeIdentity, videoDurationUs: videoUs, audioTimelineUs: audioClockUs,
      aac: { alignment: 'decoded-after-signalled-skip', encoderDelaySamples: 1024, discardPaddingSamples: 0 } } };
}

function checkCompleteSource(entry, spec) {
  const complete = entry.collection.completeSource, video = complete.video, audio = complete.audio[0];
  assert.equal(complete.audio.length, 1); assert.equal(video.frames, spec.seconds * spec.fps);
  assert.deepEqual(video.properties, { policy: 'short-sdr-range-v1', sampleAspectRatio: '1:1', chromaLocation: 'left',
    sideDataPolicy: 'h26x-unregistered-sei-only', framesChecked: video.frames }, 'Every complete source frame must receive the frozen property checks');
  assert.equal(packed(video.firstTime).n, 0n); assert.ok(compare(packed(video.endTime), rational('120/1')) <= 0);
  const sourceVideo = entry.inspection.probe.streams.find(stream => stream.codec_type === 'video');
  const tick = ceilUs(rational(sourceVideo.time_base));
  assert.ok(video.maximumNominalCadenceErrorUs <= tick && video.maximumNominalDurationErrorUs <= tick
    && video.maximumNominalPhaseErrorUs <= tick);
  assert.equal(audio.inputIndex, entry.plan.expectedOutput.streams.find(stream => stream.codecType === 'audio').inputIndex);
  entry.sourceExtentAssessment = { maximumSeconds: 120, actualVideoEnd: video.endTime, actualAudioEnd: audio.endTime,
    actualAudioSamples: audio.sampleCount, actualAudioGaps: audio.gaps, audioExcessBeyond120Us: Math.max(0, ceilUs(packed(audio.endTime)) - 120000000),
    valid: packed(audio.firstTime).n === 0n && audio.gaps === 0 && BigInt(audio.sampleCount) <= 120n * 48000n
      && compare(packed(audio.endTime), rational('120/1')) <= 0 };
  assert.equal(entry.sourceExtentAssessment.valid, true, 'Complete decoded source audio exceeds the frozen120s/zero-origin/continuous family boundary');
}

function matchedSignal(source, output) {
  assert.equal(source.length % 8, 0); assert.equal(output.length % 8, 0);
  const count = Math.min(source.length, output.length) / 8, width = SIGNAL.windowSamples, radius = SIGNAL.lagRadiusSamples;
  assert.ok(count >= radius * 2 + width, 'Not enough independently decoded common PCM for fixed windows');
  const value = (bytes, index, channel) => { const sample = bytes.readFloatLE(index * 8 + channel * 4); assert.ok(Number.isFinite(sample)); return sample; };
  function score(start, channel, otherChannel, lag, stride = 1) {
    let dot = 0, a2 = 0, b2 = 0, squared = 0;
    for (let index = start; index < start + width; index += stride) {
      const a = value(source, index, channel), b = value(output, index + lag, otherChannel);
      dot += a * b; a2 += a * a; b2 += b * b; squared += (a - b) ** 2;
    }
    assert.ok(a2 > 1e-12 && b2 > 1e-12, 'Silent/degenerate signal is not alignment evidence');
    return { lagSamples: lag, correlation: dot / Math.sqrt(a2 * b2), normalizedRmsError: Math.sqrt(squared / a2) };
  }
  function lagDiagnostic(start, channel) {
    let best = null;
    const consider = candidate => { if (!best || candidate.correlation > best.correlation + SIGNAL.tieEpsilon
      || Math.abs(candidate.correlation - best.correlation) <= SIGNAL.tieEpsilon && Math.abs(candidate.lagSamples) < Math.abs(best.lagSamples)) best = candidate; };
    for (let lag = -radius; lag <= radius; lag += SIGNAL.coarseLagStep) consider(score(start, channel, channel, lag, SIGNAL.coarseSampleStride));
    const center = best.lagSamples; best = null;
    for (let lag = Math.max(-radius, center - SIGNAL.coarseLagStep + 1); lag <= Math.min(radius, center + SIGNAL.coarseLagStep - 1); lag++) consider(score(start, channel, channel, lag));
    // Zero is evaluated even if a distant coarse alias won. No shift is applied
    // to the acceptance comparison; a nonzero best lag remains a failure.
    consider(score(start, channel, channel, 0)); return best;
  }
  const span = count - width - radius * 2;
  const starts = [...new Set(SIGNAL.fractions.map(fraction => radius + Math.floor(span * fraction)))];
  const windows = [0, ...starts].map(start => ({ startSample: start, samples: width, channels: [0, 1].map(channel => {
    const zeroLag = score(start, channel, channel, 0), crossChannel = score(start, channel, 1 - channel, 0);
    const bestLag = start === 0 ? null : lagDiagnostic(start, channel);
    return { channel, zeroLag, crossChannelCorrelation: crossChannel.correlation, bestLag,
      valid: zeroLag.correlation >= SIGNAL.minimumCorrelation && zeroLag.normalizedRmsError <= SIGNAL.maximumNormalizedRmsError
        && Math.abs(crossChannel.correlation) <= SIGNAL.maximumCrossChannelCorrelation
        && zeroLag.correlation - Math.abs(crossChannel.correlation) >= SIGNAL.minimumChannelSeparation
        && (!bestLag || bestLag.lagSamples === SIGNAL.maximumAcceptedLagSamples) };
  }) }));
  return { scope: 'channel-specific-gross-signal-and-decoder-alignment-only', thresholdsFrozenBeforeEncode: SIGNAL,
    commonSamples: count, sourceSamples: source.length / 8, outputSamples: output.length / 8, windows,
    valid: windows.every(window => window.channels.every(channel => channel.valid)),
    limitations: ['No fitted shift or independent timestamp zeroing is applied.', 'First common window starts at sample0; lag searches use fixed2048-sample margins.',
      'AAC waveform identity, inaudibility, perceptual quality and unexamined signal content are not established.'] };
}

module.exports={frozenQualifications,matchedSignal,checkCompleteSource,SIGNAL};
