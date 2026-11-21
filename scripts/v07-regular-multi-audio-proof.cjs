'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { readNativeMetadata, ancestor } = require('../src/remux-native-reader.cjs');
const { observeNativeInventory } = require('../src/remux-native-checks.cjs');
const { observeRemuxSourcePlayback } = require('../src/remux-edit-lists.cjs');
const { checkAacTiming, compareTracks, movieTicks } = require('../linux-blue/qualification-tests/q2l-multiaudio-copy.cjs');
const { createOwnedSession, hashFile, readBoundedFile, fault } = require('./v07-remux-long-fixtures.cjs');

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ totalMs: 180000, childMs: 30000, maxChildren: 32, maxStarts: 0,
  minimumDFreeBytes: 25 * GiB, marginBytes: 256 * MiB, forecastBytes: 256 * MiB, reportBytes: 6 * MiB });
const MOVIE_CLOCK = '35280000';
const SHAPES = [
  { id: 'mixed', width: 192, tracks: [
    { rate: 48000, channels: 2, frequency: 397, samples: 95232, language: 'eng', isDefault: true },
    { rate: 44100, channels: 1, frequency: 571, samples: 88064, language: 'ara', isDefault: false },
  ] },
  { id: 'twins', width: 176, tracks: [
    { rate: 48000, channels: 2, frequency: 419, samples: 95232, language: 'eng', isDefault: false },
    { rate: 48000, channels: 2, frequency: 593, samples: 95232, language: 'ara', isDefault: true },
  ] },
];
const common = ['-hide_banner', '-nostdin', '-v', 'error', '-xerror'];
const iso = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov'];
const clocks = ['-video_track_timescale', '30000', '-movie_timescale', MOVIE_CLOCK,
  '-use_editlist', '1', '-movflags', 'use_metadata_tags', '-write_tmcd', '0',
  '-avoid_negative_ts', 'disabled', '-n', '-f', 'mp4'];
const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));

function metadataArgs(tracks) {
  return tracks.flatMap((track, index) => ['-metadata:s:a:' + index, 'language=' + track.language,
    '-disposition:a:' + index, track.isDefault ? 'default' : '0']);
}

function audioFilter({ channels, frequency, rate }) {
  const first = '0.24*sin(2*PI*(' + frequency + '*t+3*t*t))';
  const second = '|0.20*sin(2*PI*(' + (frequency + 193) + '*t+5*t*t))';
  return 'aevalsrc=' + first + (channels === 2 ? second : '') + ':s=' + rate
    + ':c=' + (channels === 2 ? 'stereo' : 'mono') + ':d=2';
}

function makeSource(session, shape, output) {
  return session.run(session.runtime.ffmpeg, [...common,
    '-f', 'lavfi', '-i', 'testsrc2=size=' + shape.width + 'x96:rate=30:duration=2',
    ...shape.tracks.flatMap(track => ['-f', 'lavfi', '-i', audioFilter(track)]),
    '-map', '0:v:0', '-map', '1:a:0', '-map', '2:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
    '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-pix_fmt:v', '+yuv420p', '-threads:v', '1', '-g', '30',
    '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '128k', '-threads:a', '1',
    ...shape.tracks.flatMap((track, index) => ['-filter:a:' + index, 'atrim=end_sample=' + track.samples]),
    ...metadataArgs(shape.tracks), ...clocks, output]);
}

function makeCopy(session, source, output, tracks, swap) {
  return session.run(session.runtime.ffmpeg, [...common, '-copyts', ...iso, '-i', source,
    '-map', '0:v:0', '-map', swap ? '0:a:1' : '0:a:0', '-map', swap ? '0:a:0' : '0:a:1',
    '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy', ...metadataArgs(tracks), ...clocks, output]);
}

async function readNativeFile(file, probe) {
  const identity = await readSourceIdentity(file);
  const args = { file, identity, family: 'isobmff', target: 'mp4', probe, maxRecords: 2048, timeoutMs: 12000 };
  const playback = await observeRemuxSourcePlayback(args);
  const inventory = await observeNativeInventory(args);
  const physical = await readNativeMetadata({ ...args, async withMetadata(meta) {
    const tracks = meta.nodes.filter(node => node.type === 'trak' && node.parent?.type === 'moov');
    const media = meta.nodes.filter(node => node.type === 'mdat' && !node.parent);
    assert.equal(tracks.length, 3);
    assert.equal(media.length, 1);
    assert(!meta.seenTypes.has('moof'));
    const headers = [null];
    for (const track of tracks.slice(1)) {
      const entries = meta.nodes.filter(node => node.type === 'mp4a' && ancestor(node, 'trak') === track);
      assert.equal(entries.length, 1);
      const prefix = await meta.read(entries[0].body, 28);
      assert.equal(prefix.readUInt16BE(8), 0);
      headers.push({ channels: prefix.readUInt16BE(16), rate: prefix.readUInt32BE(24) / 65536 });
    }
    return { mediaExtent: [media[0].body, media[0].end], headers };
  } });
  return { playback, inventory, ...physical };
}

function presentation(track) {
  return {
    trackId: track.trackId, outputIndex: track.outputIndex, controls: track.controls,
    dimensions: track.dimensions, mediaScale: track.mediaScale, mediaDuration: track.mediaDuration,
    trackDuration: movieTicks(track.trackDuration, track.movieScale),
    entries: track.entries.map(entry => ({ duration: movieTicks(entry.duration, track.movieScale), mediaTime: entry.mediaTime,
      rateInteger: entry.rateInteger, rateFraction: entry.rateFraction })),
  };
}

async function decodeTrack(session, file, stream, expectedUnits) {
  const output = createHash('sha256');
  let bytes = 0;
  const video = stream.codec_type === 'video';
  const args = [...common, '-err_detect', 'explode', '-copyts', ...iso, '-ignore_editlist', '0',
    '-i', file, '-map', '0:' + stream.index, '-threads', '1',
    ...(video ? ['-fps_mode', 'passthrough', '-pix_fmt', '+yuv420p', '-f', 'rawvideo'] : ['-c:a', 'pcm_f32le', '-f', 'f32le']),
    'pipe:1'];
  const result = await session.run(session.runtime.ffmpeg, args, { stdoutLimit: 6 * MiB, onStdoutChunk(chunk) {
    output.update(chunk);
    bytes += chunk.length;
  } });
  assert.equal(result.stderrCapture.totalBytes, 0);
  assert.equal(result.stdoutCapture.totalBytes, bytes);
  assert.equal(result.stdoutCapture.truncated, false);
  const expectedBytesPerUnit = video ? stream.width * stream.height * 3 / 2 : stream.channels * 4;
  assert.equal(bytes, expectedUnits * expectedBytesPerUnit);
  return { decodedSha256: output.digest('hex'), decodeBytes: bytes };
}

async function observeFile(session, file, shape) {
  const pin = await hashFile(file);
  const bytes = await readBoundedFile(file, 8 * MiB);
  assert.equal(hash(bytes), pin.sha256);
  const result = await session.run(session.runtime.ffprobe, ['-v', 'error', '-count_packets', ...iso,
    '-show_streams', '-show_format', '-show_chapters', '-show_programs', '-show_stream_groups',
    '-show_packets', '-show_data_hash', 'sha256', '-of', 'json', file], { stdoutLimit: 4 * MiB });
  assert.equal(result.stderrCapture.totalBytes, 0);
  const probe = JSON.parse(result.stdout);
  assert.equal(probe.streams.length, 3);
  assert.equal(probe.format.tags.major_brand, 'isom');
  assert.deepEqual([probe.chapters, probe.programs, probe.stream_groups], [[], [], []]);
  const native = await readNativeFile(file, probe);
  const summaries = [];
  const seenRanges = [];
  for (const [index, stream] of probe.streams.entries()) {
    const expected = shape.tracks[index - 1], video = index === 0;
    const play = native.playback.tracks[index], trackId = play.trackId;
    assert.equal(stream.index, index);
    assert.equal(BigInt(stream.id), BigInt(trackId));
    assert.equal(Boolean(play.controls.flags & 1), Boolean(stream.disposition.default));
    assert.equal(stream.time_base, '1/' + play.mediaScale);
    assert.equal(stream.start_pts, 0);
    assert.match(stream.extradata_hash, /^SHA256:[a-f0-9]{64}$/);
    const units = video ? 60 : expected.samples;
    const layout = video ? null : expected.channels === 2 ? 'stereo' : 'mono';
    if (video) {
      assert.deepEqual([stream.codec_type, stream.codec_name, stream.width, stream.height, stream.pix_fmt,
        stream.color_space, stream.color_transfer, stream.color_primaries, stream.avg_frame_rate, stream.time_base],
      ['video', 'h264', shape.width, 96, 'yuv420p', 'bt709', 'bt709', 'bt709', '30/1', '1/30000']);
    } else {
      assert.deepEqual([stream.codec_type, stream.codec_name, stream.profile, stream.sample_fmt,
        Number(stream.sample_rate), stream.channels, stream.channel_layout, stream.duration_ts, stream.initial_padding],
      ['audio', 'aac', 'LC', 'fltp', expected.rate, expected.channels, layout, units, 1024]);
      assert.deepEqual(native.headers[index], { channels: expected.channels, rate: expected.rate });
      assert.deepEqual(native.inventory.groups[index].members, [1, 2]);
    }
    assert.equal(stream.tags.language, video ? 'und' : expected.language);
    assert.equal(Boolean(stream.disposition.default), video || expected.isDefault);
    const packets = probe.packets.filter(row => row.stream_index === index);
    assert.equal(packets.length, Number(stream.nb_read_packets));
    const display = new Set();
    const witnessed = packets.map((packet, ordinal) => {
      const offset = Number(packet.pos), size = Number(packet.size);
      assert(Number.isSafeInteger(offset) && Number.isSafeInteger(size) && size > 0);
      assert(offset >= native.mediaExtent[0] && offset + size <= native.mediaExtent[1]);
      assert.equal('SHA256:' + hash(bytes.subarray(offset, offset + size)), packet.data_hash);
      seenRanges.push([offset, offset + size]);
      const skip = packet.side_data_list ?? [];
      if (video) {
        assert.equal(packet.duration, 1000);
        assert.equal(packet.dts, (ordinal - 2) * 1000);
        assert.equal(packet.pts % 1000, 0);
        assert(packet.pts >= 0 && packet.pts < 60000 && !display.has(packet.pts));
        display.add(packet.pts);
        assert.deepEqual(skip, []);
      } else {
        checkAacTiming(ordinal, packets.length, packet.pts, packet.dts, packet.duration, units, skip);
      }
      return [packet.pts, packet.dts, packet.duration, packet.flags, size, packet.data_hash, skip];
    });
    if (video) assert.equal(display.size, 60);
    summaries.push({ index, trackId, kind: stream.codec_type, rate: video ? null : expected.rate,
      channels: video ? null : expected.channels, layout, language: stream.tags.language, isDefault: Boolean(stream.disposition.default),
      packets: packets.length, units, packetSha256: digest(witnessed), ...await decodeTrack(session, file, stream, units),
      configSha256: stream.extradata_hash.slice(7), nativeEditSha256: digest(presentation(play)),
      streamInfoSha256: digest([stream.codec_name, stream.codec_tag_string, stream.profile, stream.time_base, stream.disposition, stream.tags.language]),
      rawChannelHeader: video ? null : native.headers[index].channels });
  }
  assert.equal(seenRanges.length, probe.packets.length);
  seenRanges.sort((a, b) => a[0] - b[0]);
  assert(seenRanges.every(([start], index) => index === 0 || start >= seenRanges[index - 1][1]));
  assert.deepEqual(await hashFile(file), pin);
  return { file, pin, summaries, nativeEdits: native.playback.tracks.map(presentation) };
}

async function proof() {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: 'multi-audio' });
  const { report, io } = session;
  report.scope = 'Owned Windows 9.1 MP4 to MP4 multi-audio laboratory';
  report.cases = [];
  try {
    await session.open();
    for (const shape of SHAPES) {
      const dir = path.join(session.owned, shape.id);
      await io.mkdir(dir);
      const source = path.join(dir, 'source.mp4'), copy = path.join(dir, 'copy.mp4');
      const row = { shape };
      report.cases.push(row);
      await makeSource(session, shape, source);
      row.source = await observeFile(session, source, shape);
      await session.save();
      await makeCopy(session, source, copy, shape.tracks, false);
      row.copy = await observeFile(session, copy, shape);
      assert.equal(compareTracks(row.source.summaries, row.copy.summaries), true);
      assert.notEqual(row.copy.summaries[1].decodedSha256, row.copy.summaries[2].decodedSha256);
      if (shape.id === 'twins') {
        const negative = path.join(dir, 'swap-audio-payloads.mp4');
        await makeCopy(session, source, negative, shape.tracks, true);
        row.negative = await observeFile(session, negative, shape);
        assert.equal(row.negative.summaries[1].decodedSha256, row.source.summaries[2].decodedSha256);
        assert.equal(row.negative.summaries[2].decodedSha256, row.source.summaries[1].decodedSha256);
        assert.throws(() => compareTracks(row.source.summaries, row.negative.summaries), /Track 1 differs in packetSha256/);
        row.swapRefused = true;
      }
      await session.save();
    }
    report.status = 'passed-regular-multi-audio-laboratory';
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
  assert.equal(process.argv.length, 2);
  proof().then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, children: report.childrenClosed,
      report: path.join(report.directory, 'report.json'), failure: report.failure, closureFailures: report.closureFailures }));
    if (report.status !== 'passed-regular-multi-audio-laboratory') process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
