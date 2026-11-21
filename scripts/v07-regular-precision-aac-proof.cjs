'use strict';

// Finite owned Windows measurements of the canonical range plan. No service
// family, readiness, Start, publication or compatibility waiver is installed.
const assert = require('node:assert/strict');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { inspectInput, parseProbeJson } = require('../src/inspection.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation } = require('../src/encode-operation.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { readNativeMetadata } = require('../src/remux-native-reader.cjs');
const { lossySignal } = require('./v07-encode-operation-smoke.cjs');
const { createOwnedSession, hashFile, copyPinnedFile, readBoundedFile, fault, ROOT } = require('./v07-remux-long-fixtures.cjs');

const MiB = 1024 ** 2;
const LIMITS = Object.freeze({ totalMs: 240000, childMs: 60000, maxChildren: 48, maxStarts: 0,
  minimumDFreeBytes: 25 * 1024 ** 3, marginBytes: 256 * MiB, forecastBytes: 256 * MiB, reportBytes: 8 * MiB });
const TUPLES = [
  { rate: 44100, layout: 'stereo', channels: 2, bitrate: 320, frequency: 541 },
  { rate: 48000, layout: 'mono', channels: 1, bitrate: 128, frequency: 657 },
];
const CUTS = [
  { startUs: 1113371, endUs: 2073917 },
  { startUs: 2177311, endUs: 3000000 },
];
const SETTINGS = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const sha256 = value => createHash('sha256').update(value).digest('hex');

function fixtureArgs(tuple, output) {
  const tone = frequency => '0.19*sin(2*PI*(' + frequency + '*t+13*t*t+0.7*t*t*t))';
  const expressions = [tone(tuple.frequency)];
  if (tuple.channels === 2) expressions.push(tone(tuple.frequency + 237));
  const audio = 'aevalsrc=' + expressions.join('|') + ':s=' + tuple.rate + ':c=' + tuple.layout + ':d=3';
  return ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-n',
    '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=30:duration=3', '-f', 'lavfi', '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1', '-vf',
    'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-threads:v:0', '4',
    '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p',
    '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=3:b-adapt=0:open-gop=0',
    '-fps_mode:v:0', 'passthrough', '-c:a:0', 'pcm_s16le', '-ar:a:0', String(tuple.rate),
    '-channel_layout:a:0', tuple.layout, '-sample_fmt:a:0', 's16', '-t', '3',
    '-video_track_timescale', '15360', '-movflags', '+faststart', '-f', 'mov', output];
}

async function readProbe(session, file, args) {
  const run = await session.run(session.runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file',
    ...args, '-of', 'json', '-i', file], { stdoutLimit: 2 * MiB });
  assert.equal(run.stderr, '');
  assert.equal(run.stdoutCapture?.truncated !== true, true);
  return parseProbeJson(run.stdout, 'Q2f complete observation');
}

async function videoFrames(session, file) {
  const result = await readProbe(session, file, ['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pts,duration']);
  assert.ok(result.frames.length && result.frames.every(frame => Number.isSafeInteger(frame.pts) && Number.isSafeInteger(frame.duration)));
  return result.frames;
}

async function audioBytes(session, file) {
  const parts = [];
  const result = await session.run(session.runtime.ffmpeg,
    ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-protocol_whitelist', 'file,pipe',
      '-i', file, '-map', '0:a:0', '-c:a:0', 'pcm_s16le', '-threads:a', '1', '-f', 's16le', 'pipe:1'],
    { stdoutLimit: MiB, onStdoutChunk: part => { parts.push(Buffer.from(part)); } });
  const bytes = Buffer.concat(parts);
  assert.equal(result.stdoutCapture?.truncated, false);
  assert.equal(result.stdoutCapture.totalBytes, bytes.length);
  assert.equal(result.stderr, '');
  return bytes;
}

async function nativeClock(file, signal) {
  const identity = await readSourceIdentity(file, { signal });
  return readNativeMetadata({ file, identity, signal, family: 'matroska', maxRecords: 1024, timeoutMs: 15000, seekRecords: true,
    async withMetadata(meta) {
      const bytes = async name => {
        const records = meta.nodes.filter(node => node.name === name);
        assert.equal(records.length, 1, name);
        const { body, end } = records[0];
        assert.ok(end - body > 0 && end - body <= 8);
        return meta.read(body, end - body);
      };
      const uint = value => Number(BigInt('0x' + value.toString('hex')));
      const stored = await bytes('Duration');
      assert.ok([4, 8].includes(stored.length));
      const durationTicks = stored.length === 8 ? stored.readDoubleBE() : stored.readFloatBE();
      const padding = meta.ebmlWalk.paddings;
      assert.ok(padding.length <= 1 && padding.every(row => row.trackId === '2' && /^[1-9][0-9]{0,8}$/.test(row.nanoseconds)),
        'Only one bounded terminal discard on the audio track is admitted to measurement.');
      return { scaleNs: uint(await bytes('TimestampScale')), durationTicks,
        codecDelayNs: uint(await bytes('CodecDelay')), discardPaddingNs: padding.length ? Number(padding[0].nanoseconds) : null };
    } });
}

async function readAac(session, output, tuple) {
  const packets = await readProbe(session, output,
    ['-select_streams', 'a:0', '-show_streams', '-show_packets', '-show_format', '-show_data_hash', 'sha256']);
  const stream = packets.streams[0];
  assert.equal(packets.streams.length, 1);
  assert.deepEqual([stream.codec_name, stream.profile, stream.time_base, stream.sample_rate, stream.channel_layout, stream.channels],
    ['aac', 'LC', '1/1000', String(tuple.rate), tuple.layout, tuple.channels]);
  const frames = await readProbe(session, output, ['-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=pts,nb_samples']);
  return { stream, formatDuration: packets.format.duration,
    packets: packets.packets.map(row => {
      const side = row.side_data_list ?? [];
      assert.ok(side.length <= 1 && (!side.length || side[0].side_data_type === 'Skip Samples'));
      return { pts: row.pts, duration: row.duration,
        padding: side.length ? { skipSamples: side[0].skip_samples, discardPadding: side[0].discard_padding } : null };
    }), frames: frames.frames.map(row => ({ pts: row.pts, samples: row.nb_samples })) };
}

async function recoverFirst(id, digest) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const dir = path.join(ROOT, 'artifacts/v0.7/q2f-regular-precision-aac/smoke', id);
  const bytes = await readBoundedFile(path.join(dir, 'report.json'), LIMITS.reportBytes);
  assert.equal(sha256(bytes), digest);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.runtimePair, REGULAR_WINDOWS_PAIR);
  assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.equal(saved.fixtures.length, 1);
  assert.equal(saved.cases.length, 1);
  assert.deepEqual(saved.cases[0].range, CUTS[0]);
  const [source] = saved.fixtures;
  const [output] = saved.cases;
  assert.equal(source.input, path.join(dir, 'owned', '44100-stereo', 'source.mov'));
  assert.equal(output.output, path.join(dir, 'owned', '44100-stereo', 'cut-1.mkv'));
  assert.deepEqual(await hashFile(source.input), source.source);
  assert.deepEqual(await hashFile(output.output), output.outputPin);
  return { id, source, output };
}

function checkExplicitDiscardClock(observation) {
  const { rate, scaleNs, codecDelayNs, discardPaddingNs, first, end, origin,
    videoEndTick, durationTicks, ffprobeInitialPadding, fullDecodedSamples, packets, frames } = observation;
  const selected = end - first, accessUnit = 1024, blocks = Math.ceil(selected / accessUnit);
  const tail = blocks * accessUnit - selected, phase = first - origin;
  assert.ok(selected > 0 && (phase === 0 || phase === 1));
  assert.equal(scaleNs, 1000000);
  assert.equal(codecDelayNs, Math.round(accessUnit * 1000000000 / rate));
  assert.equal(ffprobeInitialPadding, accessUnit);
  assert.equal(discardPaddingNs, tail ? Math.round(tail * 1000000000 / rate) : null);
  assert.equal(fullDecodedSamples, selected);
  assert.equal(packets.length, blocks + 1);
  assert.equal(frames.length, blocks);
  const normalDuration = Math.floor(accessUnit * 1000 / rate);
  const tick = samples => Math.sign(samples) * Math.round(Math.abs(samples) * 1000 / rate);
  for (const [index, packet] of packets.entries()) {
    const head = index === 0, last = index === blocks;
    assert.equal(packet.pts, tick(phase + (index - 1) * accessUnit));
    if (!last) assert.equal(packet.duration, normalDuration);
    assert.deepEqual(packet.padding, head ? { skipSamples: accessUnit, discardPadding: 0 }
      : last && tail ? { skipSamples: 0, discardPadding: tail } : null);
    if (!head) assert.deepEqual(frames[index - 1], { pts: packet.pts, samples: accessUnit - (last ? tail : 0) });
  }
  assert.equal(frames.reduce((sum, row) => sum + row.samples, 0), selected);
  const last = packets.at(-1);
  assert.equal(last.duration, tail ? tick(accessUnit - tail) : normalDuration);
  const codedEnd = last.pts + last.duration;
  // Same one-tick relations as the earlier measured Matroska clock. In
  // this measured representation the decoder already consumed the discard.
  assert.ok(Math.abs(codedEnd * rate - (phase + selected) * 1000) <= rate);
  assert.ok(Math.abs(codedEnd * rate - (last.pts * rate + frames.at(-1).samples * 1000)) <= rate);
  const storedEnd = Math.max(videoEndTick * rate, codedEnd * rate + accessUnit * 1000);
  assert.ok(Math.abs(durationTicks * rate - storedEnd) <= rate);
  return { selectedSamples: selected, presentedSamples: fullDecodedSamples, discardPaddingSamples: tail,
    encoderDelaySamples: accessUnit, terminalPacketDurationMs: last.duration, containerEndTicks: durationTicks,
    productionQualified: false };
}

async function run(recovered, readbackOnly) {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: 'precision-aac' });
  const { report, io } = session;
  report.scope = 'Q2f canonical range laboratory on the exact Windows 9.1 engine';
  report.runtimePair = REGULAR_WINDOWS_PAIR;
  report.fixtures = [];
  report.productionQualified = false;
  try {
    await session.open();
    const { ffmpeg, ffprobe } = session.runtime;
    const signal = session.controller.signal;
    if (recovered) report.readbackOf = recovered.id;
    for (const tuple of readbackOnly ? [TUPLES[0]] : TUPLES) {
      const prior = tuple === TUPLES[0] ? recovered : null;
      const dir = path.join(session.owned, tuple.rate + '-' + tuple.layout);
      await io.mkdir(dir);
      const input = path.join(dir, 'source.mov');
      if (prior) await copyPinnedFile(prior.source.input, input, prior.source.source, { signal });
      else await session.run(ffmpeg, fixtureArgs(tuple, input));
      const source = await hashFile(input);
      const inspection = await inspectInput(input, { ffmpeg, ffprobe, signal, run: session.run });
      const [video, audio] = inspection.probe.streams;
      assert.deepEqual([video.start_pts, video.time_base, Number(video.duration_ts), video.r_frame_rate], [0, '1/15360', 46080, '30/1']);
      assert.deepEqual([audio.start_pts, audio.time_base, Number(audio.duration_ts), audio.sample_rate,
        audio.channel_layout, audio.channels, audio.codec_name, audio.sample_fmt],
      [0, '1/' + tuple.rate, 3 * tuple.rate, String(tuple.rate), tuple.layout, tuple.channels, 'pcm_s16le', 's16']);
      const sourceVideo = await videoFrames(session, input);
      assert.equal(sourceVideo.length, 90);
      assert.ok(sourceVideo.every((row, i) => row.pts === 512 * i && row.duration === 512));
      const sourceAudio = await audioBytes(session, input);
      const frameBytes = tuple.channels * 2;
      assert.equal(sourceAudio.length, 3 * tuple.rate * frameBytes);
      report.fixtures.push({ tuple, input, source, sourceAudioSha256: sha256(sourceAudio), sourceVideo });
      for (const [index, range] of (readbackOnly ? [CUTS[0]] : CUTS).entries()) {
        const savedCase = index === 0 ? prior?.output : null;
        const output = path.join(dir, 'cut-' + (index + 1) + '.mkv');
        const outputId = randomUUID();
        const request = resolveFileRequest({ fileId: randomUUID(), identityRevision: 0, draftRevision: 0, operation: 'encode',
          overrides: { target: 'matroska', resolution: 'source', hdrPolicy: 'preserve', audioPolicy: 'precision-aac', range } });
        const plan = buildEncodeOperation({ input, output, settings: SETTINGS, inspection, request, outputId, runtimeIdentity: REGULAR_WINDOWS_PAIR });
        const selected = plan.contract.audio.streams[0];
        assert.deepEqual([selected.sampleRate, selected.channels, selected.channelLayout, selected.bitrateKbps, selected.bitrateOrigin],
          [tuple.rate, tuple.channels, tuple.layout, tuple.bitrate, 'layout-policy']);
        const row = { input, output, tuple, range, plan: savedCase?.plan ?? plan, status: 'collecting' };
        report.cases.push(row);
        await session.save();
        if (savedCase) await copyPinnedFile(savedCase.output, output, savedCase.outputPin, { signal });
        else await session.run(ffmpeg, plan.args);
        row.outputPin = await hashFile(output);
        const aac = await readAac(session, output, tuple), videoOutput = await videoFrames(session, output);
        const outputAudio = await audioBytes(session, output);
        const native = await nativeClock(output, signal);
        const rangeVideo = sourceVideo.filter(frame => frame.pts * 1000000 >= range.startUs * 15360 && frame.pts * 1000000 < range.endUs * 15360);
        assert.equal(videoOutput.length, rangeVideo.length);
        assert.ok(videoOutput.every(({ pts, duration }, ordinal) =>
          duration === 33 && Math.abs(pts * 1000 + range.startUs - rangeVideo[ordinal].pts * 1000000 / 15360) <= 1000),
        'Video frame timestamps must stay within their already measured one-millisecond representation.');
        const first = Math.ceil(range.startUs * tuple.rate / 1000000), end = Math.ceil(range.endUs * tuple.rate / 1000000);
        const origin = Math.round(range.startUs * tuple.rate / 1000000), last = videoOutput.at(-1);
        assert.equal(outputAudio.length % frameBytes, 0);
        row.observation = { rate: tuple.rate, layout: tuple.layout, channels: tuple.channels, bitrate: tuple.bitrate, ...range,
          sourceFrames: sourceAudio.length / frameBytes, first, end, origin, ...native,
          videoEndTick: last.pts + last.duration, ffprobeInitialPadding: aac.stream.initial_padding,
          fullDecodedSamples: outputAudio.length / frameBytes, packets: aac.packets, frames: aac.frames };
        row.videoOutput = videoOutput;
        row.sourceVideoSelected = rangeVideo;
        row.effectiveContainerDuration = aac.formatDuration;
        row.outputAudioSha256 = sha256(outputAudio);
        row.signalCheck = lossySignal(sourceAudio.subarray(first * frameBytes, end * frameBytes), outputAudio, tuple.channels, tuple.rate);
        assert.ok(row.signalCheck.valid && row.signalCheck.channels.every(channel => channel.lagSamples === 0),
          'Each decoded audio channel needs an independent zero-lag signal match.');
        await session.save();
        assert.deepEqual(await hashFile(output), row.outputPin);
        assert.deepEqual(await hashFile(input), source);
        if (!readbackOnly) row.clock = checkExplicitDiscardClock(row.observation);
        row.status = readbackOnly ? 'measured' : 'passed';
        await session.save();
      }
    }
    assert.equal(report.acceptedStarts, 0);
    assert.equal(report.cases.length, readbackOnly ? 1 : 4);
    report.status = readbackOnly ? 'passed-windows-precision-aac-readback' : 'passed-windows-precision-aac-clock';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    await session.close();
  }
  return report;
}

if (require.main === module) {
  const [mode, id, digest, ...extra] = process.argv.slice(2);
  assert(!extra.length && (mode === '--owned-lab' && !id || ['--readback-first', '--resume-lab'].includes(mode) && id && digest));
  (async () => run(id ? await recoverFirst(id, digest) : null, mode === '--readback-first'))().then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, closed: report.childrenClosed,
      report: path.join(report.directory, 'report.json'), failure: report.failure, closureFailures: report.closureFailures }));
    if (!report.status.startsWith('passed')) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
