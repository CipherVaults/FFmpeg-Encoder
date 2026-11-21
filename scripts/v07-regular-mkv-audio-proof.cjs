'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { readNativeMetadata, ancestor } = require('../src/remux-native-reader.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { observeMkvAacClock, requireMkvAacClock, CLOCK_FILTER } = require('../src/remux-mkv-aac-clock.cjs');
const { verifyMkvAacCopy } = require('../src/remux-mkv-aac-evidence.cjs');
const { parseProbeJson } = require('../src/inspection.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { createOwnedSession, hashFile, readBoundedFile, copyPinnedFile, fault, ROOT } = require('./v07-remux-long-fixtures.cjs');

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ totalMs: 180000, childMs: 30000, maxChildren: 42, maxStarts: 0,
  minimumDFreeBytes: 25 * GiB, marginBytes: 256 * MiB, forecastBytes: 256 * MiB, reportBytes: 8 * MiB });
const SPECIMENS = Object.freeze([
  { id: 'aligned', samples: 61440, offset: 0, frequency: 397 },
  { id: 'offset-partial-tail', samples: 59297, offset: 3072, frequency: 583 },
]);
const PCM_RATE = 48000n;
const inputOptions = ['-hide_banner', '-nostdin', '-v', 'warning', '-xerror', '-copyts',
  '-protocol_whitelist', 'file,pipe'];
const hash = value => createHash('sha256').update(value).digest('hex');

function generationArgs(spec, file) {
  const audio = 'aevalsrc=0.23*sin(2*PI*(' + spec.frequency + '*t+4*t*t))|0.19*sin(2*PI*('
    + (spec.frequency + 219) + '*t+6*t*t)):s=48000:c=stereo:d=' + (spec.videoSeconds ? '2' : '1.5');
  return ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-n',
    '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=25:duration=' + (spec.videoSeconds ?? '1.28'),
    '-f', 'lavfi', '-i', audio, '-map', '0:v:0', '-map', '1:a:0', '-threads:v:0', '2',
    '-map_metadata', '-1', '-map_chapters', '-1', '-vf',
    'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v', 'libx264', '-preset:v', 'veryfast', '-crf:v', '24', '-pix_fmt:v', '+yuv420p',
    '-g', '25', '-c:a', 'aac', '-profile:a', 'aac_low', '-b:a', '192k', '-threads:a', '1',
    '-af', 'atrim=end_sample=' + spec.samples + ',asetpts=PTS+' + spec.offset,
    '-avoid_negative_ts', 'disabled', '-f', 'matroska', file];
}

async function observeProbe(session, file, shortened) {
  const result = await session.run(session.runtime.ffprobe,
    ['-v', 'error', '-protocol_whitelist', 'file', '-show_streams', '-show_format', '-show_packets',
      '-show_data_hash', 'sha256', '-of', 'json', '-i', file], { stdoutLimit: 2 * MiB });
  const metadata = parseProbeJson(result.stdout, 'Q2k native packets');
  const packets = JSON.parse(result.stdout).packets;
  assert(Array.isArray(packets) && packets.length > 0 && packets.length <= 256);
  assert.equal(metadata.streams.length, 2);
  const [video, audio] = metadata.streams;
  assert.equal(video.codec_name, 'h264');
  assert.equal(video.color_transfer, 'bt709');
  assert.equal(audio.codec_name, 'aac');
  assert.equal(audio.profile, 'LC');
  assert.deepEqual([audio.sample_rate, audio.channels, audio.channel_layout], ['48000', 2, 'stereo']);
  assert.match(audio.extradata_hash, /^SHA256:[a-f0-9]{64}$/i);
  const units = packets.filter(packet => packet.stream_index === audio.index);
  assert(units.length >= (shortened ? 1 : 32) && units.length <= 120);
  for (const unit of units) assert.match(unit.data_hash, /^SHA256:[a-f0-9]{64}$/i);
  return { metadata, video, audio, units, unitsHash: hash(JSON.stringify(units.map(row => [row.size, row.data_hash]))) };
}

function rate(timeBase) {
  const matched = /^1\/([1-9]\d*)$/.exec(timeBase);
  assert(matched, 'An exact tick denominator is required.');
  return BigInt(matched[1]);
}

async function videoDecode(session, file, family) {
  const result = await session.run(session.runtime.ffmpeg,
    [...inputOptions, '-noautorotate', '-format_whitelist', family === 'matroska' ? 'matroska,webm' : 'mov',
      '-i', file, '-map', '0:v:0', '-an', '-sn', '-dn', '-c:v', 'rawvideo', '-threads:v', '1',
      '-pix_fmt:v', '+yuv420p', '-fps_mode:v', 'passthrough', '-enc_time_base:v', 'demux',
      '-avoid_negative_ts', 'disabled', '-hash', 'sha256', '-f', 'framehash', '-format_version', '1', 'pipe:1'],
    { stdoutLimit: MiB });
  const timeBase = /^#tb 0: (1\/[1-9]\d*)\r?$/m.exec(result.stdout)?.[1];
  const denominator = rate(timeBase);
  const rows = result.stdout.split(/\r?\n/).filter(line => line && !line.startsWith('#')).map(line => {
    const [stream, dts, pts, duration, bytes, sha256] = line.split(',').map(value => value.trim());
    assert.equal(stream, '0');
    assert.equal(dts, pts);
    assert.match(sha256, /^[a-f0-9]{64}$/i);
    assert(BigInt(duration) > 0n);
    return { pts, duration, bytes, sha256 };
  });
  assert.equal(rows.length, 32);
  const origin = BigInt(rows[0].pts);
  for (const [index, row] of rows.entries()) {
    assert.equal((BigInt(row.pts) - origin) * 25n, BigInt(index) * denominator);
    assert.equal(BigInt(row.duration) * 25n, denominator);
  }
  return { timeBase, rows, originSamples: toSamples(origin, denominator).toString() };
}

function toSamples(ticks, denominator) {
  assert.equal((ticks * PCM_RATE) % denominator, 0n, 'Origin is outside the exact sample lattice.');
  return (ticks * PCM_RATE) / denominator;
}

async function audioDecode(session, file, family, audio) {
  const demux = family === 'matroska' ? ['-format_whitelist', 'matroska,webm']
    : ['-format_whitelist', 'mov', '-ignore_editlist', '0'];
  const result = await session.run(session.runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file',
    ...(family === 'matroska' ? [] : ['-ignore_editlist', '0']),
    '-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=pts,nb_samples,sample_fmt,channels',
    '-of', 'json', '-i', file], { stdoutLimit: MiB });
  const frames = JSON.parse(result.stdout).frames;
  assert(Array.isArray(frames) && frames.length > 0 && frames.length <= 120);
  const denominator = rate(audio.time_base);
  const first = BigInt(frames[0].pts);
  let sampleFrames = 0n;
  const offLattice = [];
  for (const [index, frame] of frames.entries()) {
    assert.equal(frame.sample_fmt, 'fltp');
    assert.equal(frame.channels, 2);
    const samples = BigInt(frame.nb_samples);
    assert(samples > 0n && samples <= 1024n);
    const residual = (BigInt(frame.pts) - first) * PCM_RATE - sampleFrames * denominator;
    // Each container timestamp must be the exact nearest representable tick
    // of the continuous sample lattice. This is a representation test.
    if (residual * 2n < -PCM_RATE || residual * 2n > PCM_RATE) offLattice.push({ index, residual: residual.toString() });
    sampleFrames += samples;
  }
  const left = createHash('sha256'), right = createHash('sha256'), interleaved = createHash('sha256');
  let tail = Buffer.alloc(0), bytes = 0;
  await session.run(session.runtime.ffmpeg, [...inputOptions, ...demux, '-i', file,
    '-map', '0:a:0', '-vn', '-sn', '-dn', '-threads:a', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'],
  { stdoutLimit: MiB, onStdoutChunk(chunk) {
    bytes += chunk.length;
    assert(bytes <= MiB);
    interleaved.update(chunk);
    const block = Buffer.concat([tail, chunk]);
    const end = block.length - (block.length % 8);
    const leftBlock = Buffer.alloc(end / 2), rightBlock = Buffer.alloc(end / 2);
    for (let pos = 0; pos < end; pos += 8) {
      block.copy(leftBlock, pos / 2, pos, pos + 4);
      block.copy(rightBlock, pos / 2, pos + 4, pos + 8);
    }
    left.update(leftBlock);
    right.update(rightBlock);
    tail = block.subarray(end);
  } });
  assert.equal(tail.length, 0);
  assert.equal(BigInt(bytes), sampleFrames * 8n);
  const start = toSamples(first, denominator);
  return { frames, timeBase: audio.time_base, sampleFrames: sampleFrames.toString(), offLattice,
    start: start.toString(), end: (start + sampleFrames).toString(),
    sha256: interleaved.digest('hex'), leftSha256: left.digest('hex'), rightSha256: right.digest('hex') };
}

async function nativeTimeline(file, family) {
  const identity = await readSourceIdentity(file);
  return readNativeMetadata({ file, identity, family, maxRecords: 512, timeoutMs: 30000,
    seekRecords: family === 'matroska', async withMetadata(meta) {
      const choose = (nodes, type) => {
        const matches = nodes.filter(node => node.type === type || node.name === type);
        assert(matches.length <= 1, 'Duplicate native field ' + type);
        return matches[0];
      };
      const required = (nodes, type) => {
        const found = choose(nodes, type);
        assert(found, 'Missing native field ' + type);
        return found;
      };
      const bytes = node => {
        assert(node.end > node.body && node.end - node.body <= 4096);
        return meta.read(node.body, node.end - node.body);
      };
      const uint = async node => {
        const buffer = await bytes(node);
        assert(buffer.length <= 8);
        return BigInt('0x' + buffer.toString('hex'));
      };

      if (family === 'matroska') {
        const tracks = meta.nodes.filter(node => node.name === 'TrackEntry');
        let audio;
        for (const track of tracks) {
          if (await uint(required(track.children, 'TrackType')) === 2n) {
            assert.equal(audio, undefined);
            audio = track;
          }
        }
        assert(audio);
        const number = await uint(required(audio.children, 'TrackNumber'));
        const field = choose(audio.children, 'CodecDelay');
        const delayNs = field ? await uint(field) : 0n;
        const paddings = meta.ebmlWalk.paddings.filter(row => row.trackId === number.toString());
        assert(paddings.length <= 1);
        const paddingNs = paddings.length ? BigInt(paddings[0].nanoseconds) : 0n;
        return { trackId: number.toString(), delayNs: delayNs.toString(), paddingNs: paddingNs.toString(),
          privateConfigSha256: hash(await bytes(required(audio.children, 'CodecPrivate'))),
          audioPacketCount: meta.ebmlWalk.packets.filter(row => row.trackId === number.toString()).length };
      }

      let audio;
      for (const node of meta.nodes.filter(row => row.type === 'hdlr' && row.parent.type === 'mdia')) {
        const value = await bytes(node);
        if (value.toString('ascii', 8, 12) === 'soun') {
          assert.equal(audio, undefined);
          audio = ancestor(node, 'trak');
        }
      }
      assert(audio);
      const nodes = meta.nodes.filter(node => ancestor(node, 'trak') === audio);
      const movie = await bytes(required(meta.nodes, 'mvhd'));
      const media = await bytes(required(nodes, 'mdhd'));
      assert([0, 1].includes(movie[0]) && [0, 1].includes(media[0]));
      const movieScale = movie.readUInt32BE(movie[0] ? 20 : 12);
      const mediaScale = media.readUInt32BE(media[0] ? 20 : 12);
      const table = await bytes(required(nodes, 'stts'));
      assert.equal(table.readUInt32BE(0), 0);
      const entries = table.readUInt32BE(4);
      assert(entries > 0 && entries <= 128 && table.length === 8 + entries * 8);
      const sampleDurations = [];
      for (let index = 0; index < entries; index++) {
        const start = 8 + index * 8;
        sampleDurations.push({ count: table.readUInt32BE(start), duration: table.readUInt32BE(start + 4) });
      }
      const elst = choose(nodes, 'elst');
      const edits = [];
      if (elst) {
        const box = await bytes(elst);
        assert([0, 1].includes(box[0]) && box.readUIntBE(1, 3) === 0);
        const wide = box[0] === 1, stride = wide ? 20 : 12;
        const count = box.readUInt32BE(4);
        assert(count > 0 && count <= 2 && box.length === 8 + count * stride);
        for (let index = 0; index < count; index++) {
          const start = 8 + stride * index;
          const duration = wide ? box.readBigUInt64BE(start) : BigInt(box.readUInt32BE(start));
          const mediaTime = wide ? box.readBigInt64BE(start + 8) : BigInt(box.readInt32BE(start + 4));
          const editRate = box.readUInt32BE(start + (wide ? 16 : 8));
          edits.push({ duration: duration.toString(), mediaTime: mediaTime.toString(), rate1616: editRate });
        }
      }
      return { movieScale, mediaScale, sampleDurations, edits };
    } });
}

async function observeFile(session, file, family, shortened = false) {
  const pins = await hashFile(file);
  const probe = await observeProbe(session, file, shortened);
  const video = await videoDecode(session, file, family);
  const audio = await audioDecode(session, file, family, probe.audio);
  const native = await nativeTimeline(file, family);
  assert.deepEqual(await hashFile(file), pins);
  return { file, pins, probe, video, audio, native };
}

function samplesFromNs(value) {
  const numerator = BigInt(value) * PCM_RATE;
  const samples = (numerator + 500000000n) / 1000000000n;
  const difference = samples * 1000000000n - numerator;
  return (difference >= -PCM_RATE && difference <= PCM_RATE) ? samples : null;
}

function analyse(source, target) {
  const relative = row => ({ start: BigInt(row.audio.start) - BigInt(row.video.originSamples),
    end: BigInt(row.audio.end) - BigInt(row.video.originSamples) });
  const a = relative(source), b = relative(target);
  const startShift = b.start - a.start, endShift = b.end - a.end;
  const retainedSamplesEqual = source.audio.sampleFrames === target.audio.sampleFrames;
  const pcmEqual = ['sha256', 'leftSha256', 'rightSha256'].every(key => source.audio[key] === target.audio[key]);
  const leftFrames = source.video.rows, rightFrames = target.video.rows;
  const videoEqual = leftFrames.length === rightFrames.length
    && leftFrames.every((frame, index) => frame.sha256 === rightFrames[index].sha256 && frame.bytes === rightFrames[index].bytes);
  const ascEqual = source.probe.audio.extradata_hash === target.probe.audio.extradata_hash;
  const aacUnitsEqual = source.probe.unitsHash === target.probe.unitsHash;
  const delay = samplesFromNs(source.native.delayNs), padding = samplesFromNs(source.native.paddingNs);
  const sourceCoded = 1024n * BigInt(source.native.audioPacketCount);
  const sourceEffective = delay !== null && padding !== null && source.native.audioPacketCount === source.probe.units.length
    && sourceCoded - delay - padding === BigInt(source.audio.sampleFrames)
    && source.probe.audio.extradata_hash.toLowerCase() === 'sha256:' + source.native.privateConfigSha256;
  const targetNative = target.native;
  const targetCoded = targetNative.sampleDurations.reduce((sum, row) => sum + BigInt(row.count) * BigInt(row.duration), 0n);
  const mediaEdits = targetNative.edits.filter(row => BigInt(row.mediaTime) >= 0n);
  const emptyEdits = targetNative.edits.filter(row => row.mediaTime === '-1');
  const targetScale = BigInt(targetNative.movieScale);
  const targetEffective = targetNative.mediaScale === Number(PCM_RATE)
    && (targetNative.edits.length === 0 ? targetCoded === BigInt(target.audio.sampleFrames)
      : mediaEdits.length === 1 && emptyEdits.length + 1 === targetNative.edits.length
        && targetNative.edits.every(row => row.rate1616 === 65536)
        && (emptyEdits.length === 0 || targetNative.edits[0] === emptyEdits[0])
        && BigInt(mediaEdits[0].duration) * PCM_RATE === BigInt(target.audio.sampleFrames) * targetScale
        && BigInt(mediaEdits[0].mediaTime) + BigInt(target.audio.sampleFrames) <= targetCoded);
  const continuous = source.audio.offLattice.length === 0 && target.audio.offLattice.length === 0;
  const contentStable = retainedSamplesEqual && pcmEqual && videoEqual && ascEqual && aacUnitsEqual;
  const evidenceSufficient = contentStable && continuous && sourceEffective && targetEffective;
  return { classification: evidenceSufficient && startShift === endShift ? (startShift === 0n ? 'D-exact' : 'B-uniform-shift') : 'D-and-B-unproved',
    contentStable, retainedSamplesEqual, pcmEqual, aacUnitsEqual, ascEqual, videoEqual,
    continuous, sourceEffective, targetEffective,
    sourceCodedSamples: sourceCoded.toString(), targetCodedSamples: targetCoded.toString(),
    sourceDelaySamples: delay?.toString() ?? null, sourcePaddingSamples: padding?.toString() ?? null,
    sourceStart: a.start.toString(), sourceEnd: a.end.toString(), targetStart: b.start.toString(), targetEnd: b.end.toString(),
    shiftStartSamples: startShift.toString(), shiftEndSamples: endShift.toString(),
    deltaSampleCount: (BigInt(target.audio.sampleFrames) - BigInt(source.audio.sampleFrames)).toString() };
}

async function makeCopy(session, file, output, shortened, sampleClock) {
  const input = [...inputOptions, '-format_whitelist', 'matroska,webm', '-i', file];
  if (shortened) input.push('-t', '0.64', '-format_whitelist', 'matroska,webm', '-i', file);
  const args = [...input, '-map', '0:v:0', '-map', shortened ? '1:a:0' : '0:a:0',
    '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy',
    ...(sampleClock ? ['-bsf:a:0', sampleClock] : []), '-avoid_negative_ts', 'disabled',
    '-video_track_timescale', '1000', '-movie_timescale', '48000', '-use_editlist', '1',
    '-movflags', 'use_metadata_tags', '-write_tmcd', '0', '-n', '-f', 'mp4', output];
  await session.run(session.runtime.ffmpeg, args);
}


async function recoverAligned(id, digest, negativeSha) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  for (const expected of [digest, negativeSha]) assert.match(expected, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2k-regular-audio/smoke', id);
  const bytes = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(hash(bytes), digest);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.childrenClosed, 12);
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.equal(saved.comparisons.length, 1);
  const [comparison] = saved.comparisons;
  assert.deepEqual(comparison.spec, SPECIMENS[0]);
  assert.deepEqual(comparison.comparison, analyse(comparison.source, comparison.output));
  const root = path.join(directory, 'owned', 'aligned');
  for (const [record, name] of [[comparison.source, 'source.mkv'], [comparison.output, 'copy.mp4']]) {
    assert.equal(record.file, path.join(root, name));
    assert.deepEqual(await hashFile(record.file), record.pins);
  }
  const negativeFile = path.join(root, 'negative-shorter-audio.mp4');
  const close = JSON.parse(await readBoundedFile(path.join(directory, 'invocation-11-close.json'), MiB));
  assert.equal(close.status, 'completed');
  assert.equal(close.argv.at(-1), negativeFile);
  const negative = await hashFile(negativeFile);
  assert.equal(negative.sha256, negativeSha);
  return { id, comparison, negativeFile, negative };
}


async function recoverForClockTrial(id, digest) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const base = path.join(ROOT, 'artifacts/v0.7/q2k-regular-audio/smoke');
  const directory = path.join(base, id);
  const bytes = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(hash(bytes), digest);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'completed-mkv-audio-measurement');
  assert.equal(saved.acceptedStarts, 0);
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.equal(saved.comparisons.length, SPECIMENS.length);
  assert.match(saved.alignedRecoveredFrom, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  for (const [index, row] of saved.comparisons.entries()) {
    const spec = SPECIMENS[index];
    assert.deepEqual(row.spec, spec);
    const sourceRoot = spec.id === 'aligned' ? path.join(base, saved.alignedRecoveredFrom) : directory;
    assert.equal(row.source.file, path.join(sourceRoot, 'owned', spec.id, 'source.mkv'));
    assert.deepEqual(await hashFile(row.source.file), row.source.pins);
    assert.deepEqual(row.comparison, analyse(row.source, row.output));
    assert.equal(row.comparison.sourceEffective, true);
    assert.equal(row.comparison.sourceDelaySamples, '1024');
    assert.equal(row.source.audio.offLattice.length, 0);
    assert.equal(row.source.video.originSamples, '0');
    assert.equal(row.source.audio.start, String(spec.offset));
    assert.equal(row.source.audio.sampleFrames, String(spec.samples));
  }
  return saved;
}


async function offsetEditSeed(id, digest) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2k-regular-audio/smoke', id);
  const receipt = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(hash(receipt), digest);
  const saved = JSON.parse(receipt);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'completed-mkv-audio-measurement');
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  const record = saved.comparisons.find(row => row.spec.id === 'offset-partial-tail');
  assert.deepEqual(record.spec, SPECIMENS[1]);
  assert.equal(record.comparison.classification, 'B-uniform-shift');
  assert.equal(record.comparison.shiftStartSamples, '-3072');
  assert.deepEqual(record.comparison, analyse(record.source, record.output));
  const owned = path.join(directory, 'owned', record.spec.id);
  for (const [observed, filename] of [[record.source, 'source.mkv'], [record.output, 'copy.mp4']]) {
    assert.equal(observed.file, path.join(owned, filename));
    assert.deepEqual(await hashFile(observed.file), observed.pins);
  }
  return { id, record };
}

async function addOffsetToNativeEdit(session, seed, output) {
  const { file, pins } = seed.record.output;
  const data = await readBoundedFile(file, MiB);
  assert.equal(hash(data), pins.sha256);
  const identity = await readSourceIdentity(file);
  const layout = await readNativeMetadata({ file, identity, family: 'isobmff', maxRecords: 512,
    timeoutMs: 30000, withMetadata(meta) {
      const one = (type, parent) => {
        const nodes = meta.nodes.filter(node => node.type === type && (parent ? node.parent === parent : !node.parent));
        assert.equal(nodes.length, 1, type);
        return nodes[0];
      };
      const moov = one('moov'), mdat = one('mdat'), mvhd = one('mvhd', moov);
      assert(mdat.end <= moov.start && moov.end === data.length);
      const tracks = meta.nodes.filter(node => node.type === 'trak' && node.parent === moov);
      assert.equal(tracks.length, 2);
      const types = new Map(tracks.map(track => {
        const handler = one('hdlr', one('mdia', track));
        return [data.toString('ascii', handler.body + 8, handler.body + 12), track];
      }));
      const audio = types.get('soun'), video = types.get('vide');
      assert(audio && video);
      const edts = one('edts', audio), elst = one('elst', edts);
      const edited = [moov, audio, edts, elst];
      for (const node of edited) {
        assert.equal(node.body - node.start, 8);
        assert.equal(data.readUInt32BE(node.start), node.end - node.start);
      }
      const audioHeader = one('tkhd', audio).body, videoHeader = one('tkhd', video).body;
      assert([audioHeader, videoHeader, mvhd.body, elst.body].every(offset => data[offset] === 0));
      assert.equal(data.readUInt32BE(mvhd.body + 12), 48000);
      assert.equal(elst.end - elst.body, 20);
      assert.equal(data.readUInt32BE(elst.body), 0);
      assert.equal(data.readUInt32BE(elst.body + 4), 1);
      const duration = data.readUInt32BE(elst.body + 8);
      assert.equal(duration, 59297);
      assert.equal(data.readUInt32BE(elst.body + 12), 1024);
      assert.equal(data.readUInt32BE(elst.body + 16), 65536);
      assert.equal(data.readUInt32BE(audioHeader + 20), duration);
      const videoDuration = data.readUInt32BE(videoHeader + 20);
      assert.equal(data.readUInt32BE(mvhd.body + 16), Math.max(duration, videoDuration));
      return { unchangedEnd: moov.start, insertion: elst.body + 8, editCountAt: elst.body + 4,
        audioDurationAt: audioHeader + 20, movieDurationAt: mvhd.body + 16, duration, videoDuration,
        sizeOffsets: edited.map(node => node.start) };
    } });
  const empty = Buffer.alloc(12);
  const offset = seed.record.spec.offset;
  empty.writeUInt32BE(offset);
  empty.writeInt32BE(-1, 4);
  empty.writeUInt32BE(65536, 8);
  const staged = Buffer.concat([data.subarray(0, layout.insertion), empty, data.subarray(layout.insertion)]);
  const afterInsert = at => at < layout.insertion ? at : at + empty.length;
  staged.writeUInt32BE(2, layout.editCountAt);
  staged.writeUInt32BE(layout.duration + offset, afterInsert(layout.audioDurationAt));
  staged.writeUInt32BE(Math.max(layout.videoDuration, layout.duration + offset), afterInsert(layout.movieDurationAt));
  for (const at of layout.sizeOffsets) staged.writeUInt32BE(data.readUInt32BE(at) + empty.length, at);
  assert.deepEqual(staged.subarray(0, layout.unchangedEnd), data.subarray(0, layout.unchangedEnd));
  await session.io.writeFile(output, staged, { flag: 'wx' });
  return { unchangedMediaPrefixSha256: hash(staged.subarray(0, layout.unchangedEnd)), emptyEditSamples: offset,
    retainedMediaStartSamples: 1024, retainedDurationSamples: layout.duration, addedBytes: empty.length };
}

async function run(recovery, clockTrial = null, nativeOffset = null) {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: 'mkv-audio' });
  const { report, io } = session;
  report.scope = 'Direct owned 9.1 copy measurement for Q2k. No app Start, publication or default decision.';
  report.comparisons = [];
  if (recovery) report.alignedRecoveredFrom = recovery.id;
  if (clockTrial) report.clockTrialBasedOn = clockTrial.id;
  if (nativeOffset) report.nativeOffsetBasedOn = nativeOffset.id;
  try {
    await session.open();
    for (const spec of nativeOffset ? SPECIMENS.slice(1) : SPECIMENS) {
      const root = path.join(session.owned, spec.id);
      await io.mkdir(root);
      const file = path.join(root, 'source.mkv'), output = path.join(root, 'copy.mp4');
      const record = { spec };
      report.comparisons.push(record);
      if (nativeOffset) {
        record.source = nativeOffset.record.source;
        record.nativeOffset = await addOffsetToNativeEdit(session, nativeOffset, output);
        record.output = await observeFile(session, output, 'isobmff');
        record.comparison = analyse(record.source, record.output);
        assert.deepEqual(record.output.native.edits, [
          { duration: '3072', mediaTime: '-1', rate1616: 65536 },
          { duration: '59297', mediaTime: '1024', rate1616: 65536 },
        ]);
        assert.deepEqual(record.output.native.sampleDurations, [{ count: 59, duration: 1024 }]);
        assert.deepEqual([record.comparison.targetStart, record.comparison.targetEnd], ['3072', '62369']);
        assert.equal(record.comparison.classification, 'D-exact');
        await session.save();
        continue;
      }
      if (clockTrial) {
        const prior = clockTrial.comparisons.find(row => row.spec.id === spec.id);
        await copyPinnedFile(prior.source.file, file, prior.source.pins);
        record.source = { ...prior.source, file, pins: await hashFile(file) };
        // The known AAC priming starts before zero. In the offset test
        // this also proposes a disclosed earlier placement of the audio.
        record.prospective = { targetStartSamples: 0, relativeShiftSamples: -spec.offset,
          unchangedAacFrameSamples: 1024, sourcePaddingSamples: prior.comparison.sourcePaddingSamples };
        const sampleClock = 'setts=time_base=1/48000:prescale=1:ts=N*1024-1024:duration=1024';
        await makeCopy(session, file, output, false, sampleClock);
        record.output = await observeFile(session, output, 'isobmff');
        record.comparison = analyse(record.source, record.output);
        await session.save();
        continue;
      }
      if (recovery && spec.id === 'aligned') {
        const earlier = recovery.comparison;
        Object.assign(record, { source: earlier.source, output: earlier.output, comparison: earlier.comparison });
      } else {
        await session.run(session.runtime.ffmpeg, generationArgs(spec, file));
        record.source = await observeFile(session, file, 'matroska');
        await session.save();
        await makeCopy(session, file, output, false);
        record.output = await observeFile(session, output, 'isobmff');
        record.comparison = analyse(record.source, record.output);
      }
      if (spec.id === 'aligned') {
        const negative = path.join(root, 'negative-shorter-audio.mp4');
        if (recovery) await copyPinnedFile(recovery.negativeFile, negative, recovery.negative);
        else await makeCopy(session, file, negative, true);
        record.negative = await observeFile(session, negative, 'isobmff', true);
        record.negativeComparison = analyse(record.source, record.negative);
        assert.equal(record.negativeComparison.videoEqual, true);
        assert.equal(record.negativeComparison.retainedSamplesEqual, false);
        assert.equal(record.negativeComparison.classification, 'D-and-B-unproved');
      }
      await session.save();
    }
    report.status = 'completed-mkv-audio-measurement';
  } catch (error) {
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
    report.status = 'failed-retained';
  } finally {
    await session.close();
  }
  return report;
}



async function recoverSourceClockHoldout(id, sha256) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(sha256, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2k-regular-audio/smoke', id);
  const bytes = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(hash(bytes), sha256);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.childrenClosed, 2);
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.equal(saved.holdouts.length, 1);
  const held = saved.holdouts[0];
  assert.equal(held.file, path.join(directory, 'owned', 'exact-holdout', 'source.mkv'));
  assert.deepEqual(await hashFile(held.file), held.pin);
  return held;
}

async function runSourceClockHoldouts(previous) {
  const limits = { ...LIMITS, maxChildren: 6 };
  const session = createOwnedSession({ kind: 'smoke', limits, regularProof: 'mkv-audio' });
  const { report, io } = session;
  report.scope = 'Fresh Windows 9.1 Matroska AAC source-clock holdouts before product admission';
  report.holdouts = [];
  if (previous) report.reusedExactSourcePin = previous.pin.sha256;
  const cases = [
    { id: 'exact-holdout', samples: 76800, offset: 0, frequency: 673, videoSeconds: '1.60', mode: 'exact' },
    { id: 'earlier-holdout', samples: 74657, offset: 3072, frequency: 733, videoSeconds: '1.60', mode: 'earlier' },
    { id: 'unknown-clock', samples: 76800, offset: 3072, frequency: 827, videoSeconds: '1.60', mode: null },
  ];
  try {
    await session.open();
    for (const spec of cases) {
      const dir = path.join(session.owned, spec.id);
      await io.mkdir(dir);
      const file = path.join(dir, 'source.mkv');
      if (previous && spec.id === 'exact-holdout') {
        assert.deepEqual(previous.spec, spec);
        await copyPinnedFile(previous.file, file, previous.pin);
      } else await session.run(session.runtime.ffmpeg, generationArgs(spec, file));
      const result = await session.run(session.runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file',
        '-show_streams', '-show_format', '-show_chapters', '-show_programs', '-show_stream_groups',
        '-show_data_hash', 'sha256', '-of', 'json', '-i', file], { stdoutLimit: MiB });
      const probe = parseProbeJson(result.stdout, 'Windows Matroska AAC source holdout');
      const pin = await hashFile(file), identity = await readSourceIdentity(file);
      const item = { spec, file, pin, probe };
      report.holdouts.push(item);
      const options = { file, identity, probe, signal: session.controller.signal };
      if (spec.mode) {
        const observed = await observeMkvAacClock(options);
        requireMkvAacClock(observed, identity);
        assert.equal(observed.sha256, pin.sha256);
        assert.equal(observed.mode, spec.mode);
        assert.equal(observed.shiftSamples, -spec.offset || 0);
        assert.equal(observed.sampleFrames, spec.samples);
        assert.equal(observed.videoFrames, 40);
        item.sourceClock = observed;
      } else {
        await assert.rejects(observeMkvAacClock(options), { code: 'REMUX_MKV_AAC_CLOCK_UNQUALIFIED' });
        item.refused = true;
      }
      await session.save();
    }
    report.status = 'passed-mkv-audio-source-holdouts';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    await session.close();
  }
  return report;
}


async function readSourceHoldouts(id, sha256) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(sha256, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2k-regular-audio/smoke', id);
  const bytes = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(hash(bytes), sha256);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'passed-mkv-audio-source-holdouts');
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.deepEqual(saved.holdouts.map(row => row.spec.mode), ['exact', 'earlier', null]);
  for (const row of saved.holdouts) {
    assert.equal(row.file, path.join(directory, 'owned', row.spec.id, 'source.mkv'));
    assert.deepEqual(await hashFile(row.file), row.pin);
  }
  return saved;
}


async function recoverClockCopy(id, receiptSha, seedSha, outputSha) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  for (const digest of [receiptSha, seedSha, outputSha]) assert.match(digest, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2k-regular-audio/smoke', id);
  const bytes = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(hash(bytes), receiptSha);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.childrenClosed, 2);
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.equal(saved.copies.length, 1);
  const seed = await readSourceHoldouts(saved.seed, seedSha);
  const output = path.join(directory, 'owned', 'exact-holdout', 'copy.mp4');
  assert.equal(saved.copies[0].output, output);
  assert.equal(saved.invocations[0].argv.at(-1), output);
  assert.equal(saved.invocations[0].status, 'completed');
  assert.equal(saved.copies[0].clock.sha256, seed.holdouts[0].pin.sha256);
  const pin = await hashFile(output);
  assert.equal(pin.sha256, outputSha);
  return { id, output, pin, seed };
}

async function runClockCopyHoldouts(seed, previous) {
  const session = createOwnedSession({ kind: 'smoke', limits: { ...LIMITS, maxChildren: 22 }, regularProof: 'mkv-audio' });
  const { report, io } = session;
  report.scope = 'Independent AAC clock-copy verifier against fresh held-out Windows sources';
  report.seed = seed.id;
  if (previous) report.recoveredExactOutput = previous.id;
  report.copies = [];
  try {
    await session.open();
    for (const held of seed.holdouts.slice(0, 2)) {
      const dir = path.join(session.owned, held.spec.id);
      await io.mkdir(dir);
      const source = path.join(dir, 'source.mkv'), output = path.join(dir, 'copy.mp4');
      const sourcePin = await copyPinnedFile(held.file, source, held.pin);
      const sourceIdentity = await readSourceIdentity(source);
      const signal = session.controller.signal;
      const sourceProbe = { ...held.probe, format: { ...held.probe.format, filename: source } };
      const clock = await observeMkvAacClock({ file: source, identity: sourceIdentity, probe: sourceProbe, signal });
      assert.equal(clock.sha256, held.sourceClock.sha256);
      assert.equal(clock.mode, held.spec.mode);
      const row = { source, sourcePin, output, clock };
      report.copies.push(row);
      if (previous && held.spec.mode === 'exact') await copyPinnedFile(previous.output, output, previous.pin);
      else await makeCopy(session, source, output, false, CLOCK_FILTER);
      const invoke = async (_label, executable, args, stdoutLimit, onStdoutChunk) => {
        const result = await session.run(executable, args, { stdoutLimit, ...(onStdoutChunk ? { onStdoutChunk } : {}) });
        assert.equal(result.stderrCapture.totalBytes, 0);
        if (onStdoutChunk) assert.equal(result.stdoutCapture.truncated, false);
        return result.stdout;
      };
      const context = { clock, sourcePath: source, sourceIdentity, ffprobe: session.runtime.ffprobe, ffmpeg: session.runtime.ffmpeg,
        signal, invoke };
      const result = await verifyMkvAacCopy({ ...context, outputPath: output });
      row.verified = result.copy;
      assert.equal(result.copy.shiftSamples, -held.spec.offset || 0);
      assert.equal(result.copy.sampleFrames, held.spec.samples);
      assert.equal(result.copy.outputSha256, (await hashFile(output)).sha256);
      if (held.spec.mode === 'exact') {
        const plain = path.join(dir, 'unreconstructed-clock.mp4');
        await makeCopy(session, source, plain, false);
        await assert.rejects(verifyMkvAacCopy({ ...context, outputPath: plain }), { code: 'REMUX_MKV_AAC_COPY_UNVERIFIED' });
        row.plain = { file: plain, pin: await hashFile(plain), refused: true };
      }
      await session.save();
    }
    report.status = 'passed-mkv-audio-clock-copy-holdouts';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    await session.close();
  }
  return report;
}

async function runServiceHoldouts(seed, prospective) {
  const limits = { ...LIMITS, totalMs: 360000, maxChildren: 48, maxStarts: 2 };
  const session = createOwnedSession({ kind: 'smoke', limits, regularProof: 'mkv-audio' });
  const { report, io } = session;
  report.scope = prospective ? 'Prospective real-service route proof' : 'Default factory real-service route proof';
  report.seed = seed.id;
  report.cases = [];
  let service;
  try {
    await session.open();
    const runtime = session.runtime;
    const stateDir = path.join(session.owned, 'state');
    const input = path.join(session.owned, 'input'), output = path.join(session.owned, 'output');
    for (const folder of [stateDir, input, output]) await io.mkdir(folder);
    const sourcePins = new Map();
    for (const row of seed.holdouts) {
      const file = path.join(input, row.spec.id + '.mkv');
      sourcePins.set(file, await copyPinnedFile(row.file, file, row.pin));
    }
    const policy = prospective ? { remuxPolicyIdentity: 'q2k-mkv-aac-service-prospective',
      remuxPolicies: [{ id: 'q2k-mkv-aac-prospective', inputFamily: 'matroska', target: 'mp4',
        allowAncillary: false, allowRotation90: false, runtimeIdentity: REGULAR_WINDOWS_PAIR,
        verificationMethod: 'aac-sample-clock-v1', evidenceIds: ['449ea838-7423-4733-802a-baf779211e4e:source-holdouts',
          '5a829a0a-cdcb-4fb0-b365-805e38faf5fa:staged-verification'] }] } : {};
    const controls = createOperationControls({ runtime, stateDir, ...policy });
    const invoke = controls.operationRuntime.invoke.bind(controls.operationRuntime);
    controls.operationRuntime.invoke = (token, tool, args, options) => session.run(runtime[tool], args, options,
      (_file, argv, owned) => invoke(token, tool, argv, owned));
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, runtimeIdentity: REGULAR_WINDOWS_PAIR,
      stateDir, run: session.run, inspectionWorkers: 1, ...controls });
    await service.initializeDiagnostics();
    session.controller.signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });
    const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
    const ready = await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target: 'mp4' });
    report.prepared = ready.items;
    await session.save();
    assert.equal(ready.phase, 'ready', ready.error);
    const item = (snapshot, id) => snapshot.items.find(row => row.name === id + '.mkv');
    const exact = item(ready, 'exact-holdout'), earlier = item(ready, 'earlier-holdout'), unknown = item(ready, 'unknown-clock');
    assert.equal(exact.status, 'ready', exact.reason);
    assert.equal(exact.remux.audioShift, undefined);
    assert.equal(earlier.status, 'unsupported', earlier.reason);
    assert.equal(earlier.reasonCode, 'REMUX_AUDIO_SHIFT_CHOICE_REQUIRED');
    assert.equal(earlier.remux.audioShift.approved, false);
    assert.equal(earlier.remux.audioShift.shiftSamples, -3072);
    assert.equal(earlier.remux.audioShift.milliseconds, 64);
    assert.equal(unknown.status, 'unsupported', unknown.reason);
    assert.equal(unknown.reasonCode, 'REMUX_MKV_AAC_CLOCK_UNQUALIFIED');
    assert.equal(unknown.remux.audioShift, undefined);

    const beforeRefusals = report.invocations.length;
    for (const refused of [earlier, unknown]) {
      assert.throws(() => service.startBatch({ planId: ready.planId, fileIds: [refused.id] }), { code: 'INVALID_SELECTION' });
    }
    const consent = { planId: ready.planId, draftId: ready.operationDraft.id, revision: ready.operationDraft.revision,
      decisionIds: [earlier.remux.audioShift.id] };
    assert.throws(() => service.setRemuxAudioChoices({ ...consent, decisionIds: [exact.id] }), { code: 'REMUX_AUDIO_SHIFT_STALE' });
    assert.throws(() => service.setRemuxAudioChoices({ ...consent, revision: consent.revision - 1 }), { code: 'REMUX_AUDIO_SHIFT_STALE' });
    assert.throws(() => service.setRemuxAudioChoices({ ...consent, shiftSamples: -3072 }), { code: 'INVALID_REMUX_REQUEST' });
    assert.equal(report.invocations.length, beforeRefusals);
    assert.deepEqual(await io.readdir(output), []);
    report.refusals = { unapprovedAndUnknownStarts: 2, fabricatedOrStaleChoice: 3, children: 0 };

    const prepared = await service.setRemuxAudioChoices(consent);
    report.approved = prepared.items;
    await session.save();
    assert.equal(prepared.phase, 'ready', prepared.error);
    assert.notEqual(prepared.planId, ready.planId);
    assert.throws(() => service.setRemuxAudioChoices({ ...consent, planId: prepared.planId }), { code: 'REMUX_AUDIO_SHIFT_STALE' });
    const currentExact = item(prepared, 'exact-holdout'), currentEarlier = item(prepared, 'earlier-holdout');
    assert.equal(currentExact.status, 'ready', currentExact.reason);
    assert.equal(currentExact.remux.audioShift, undefined);
    assert.equal(currentEarlier.status, 'ready', currentEarlier.reason);
    assert.equal(currentEarlier.remux.audioShift.approved, true);
    assert.equal(currentEarlier.remux.audioShift.shiftSamples, -3072);
    const entries = [currentExact, currentEarlier].map(row => service.plan.entries.get(row.id));
    service.startBatch({ planId: prepared.planId, fileIds: [currentExact.id, currentEarlier.id] });
    report.acceptedStarts++;
    await service.taskPromise;
    const finished = service.snapshot();
    report.finished = finished.items;
    for (const [index, row] of [currentExact, currentEarlier].entries()) {
      const result = finished.items.find(value => value.id === row.id), entry = entries[index];
      const evidence = entry.operationEvidence;
      const outcome = { item: result, evidence };
      report.cases.push(outcome);
      await session.save();
      assert.equal(result.status, 'success', result.reason);
      assert.equal(result.outputDisposition.published, true);
      assert.equal(result.verificationMethod, 'aac-sample-clock-v1');
      const shift = result.warnings?.find(warning => warning.code === 'REMUX_AAC_SHIFT_VERIFIED');
      assert.equal(shift?.message, index === 0 ? undefined : 'Every audio sample was preserved. Audio moved 64 ms earlier.');
      assert.equal(evidence.status, 'completed');
      assert.equal(evidence.invocations.length, 6);
      assert.equal(evidence.nativeInventory.complete, true);
      const copy = evidence.essenceEvidence.mkvAacCopy;
      assert.equal(copy.videoFrames, 40);
      assert.equal(copy.sampleFrames, seed.holdouts[index].spec.samples);
      assert.equal(copy.shiftSamples, index === 0 ? 0 : -3072);
      outcome.output = { file: entry.destination, ...await hashFile(entry.destination) };
      assert.equal(outcome.output.sha256, copy.outputSha256);
      outcome.source = { file: entry.file, ...await hashFile(entry.file) };
      assert.deepEqual(await hashFile(entry.file), sourcePins.get(entry.file));
    }
    report.outputNames = (await io.readdir(output)).sort();
    assert.deepEqual(report.outputNames, [currentEarlier.outputName, currentExact.outputName].sort());
    for (const [file, pinned] of sourcePins) assert.deepEqual(await hashFile(file), pinned);
    assert.equal(report.acceptedStarts, 1);
    report.status = prospective ? 'passed-mkv-audio-service-prospective' : 'passed-mkv-audio-service-normal';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    try {
      if (service) {
        await service.cancelCurrent();
        await service.closeOperationResources();
        report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed');
        assert.equal(report.diagnosticClosure.persisted, true);
      }
    } catch (error) {
      report.status = 'failed-retained';
      report.serviceClosureFailure = fault(error);
    } finally { await session.close(); }
  }
  return report;
}

if (require.main === module) (async () => {
  const [mode, id, digest, negativeSha, ...extra] = process.argv.slice(2);
  if (mode === '--service-prospective' || mode === '--service-normal') {
    assert(id && digest && !negativeSha && extra.length === 0);
    return runServiceHoldouts(await readSourceHoldouts(id, digest), mode === '--service-prospective');
  }
  if (mode === '--resume-clock-copy') {
    assert(id && digest && negativeSha && extra.length === 1);
    const recovered = await recoverClockCopy(id, digest, negativeSha, extra[0]);
    return runClockCopyHoldouts(recovered.seed, recovered);
  }
  if (mode === '--verify-clock-copy') {
    assert(id && digest && !negativeSha);
    return runClockCopyHoldouts(await readSourceHoldouts(id, digest));
  }
  if (mode === '--source-clock-holdouts') {
    assert(!id || (digest && !negativeSha));
    return runSourceClockHoldouts(id ? await recoverSourceClockHoldout(id, digest) : null);
  }
  assert(!mode || (mode === '--resume-aligned' && id && digest && negativeSha && !extra.length)
    || (['--repair-sample-clock', '--preserve-offset'].includes(mode) && id && digest && !negativeSha));
  if (mode === '--repair-sample-clock') return run(null, await recoverForClockTrial(id, digest));
  if (mode === '--preserve-offset') return run(null, null, await offsetEditSeed(id, digest));
  return run(mode ? await recoverAligned(id, digest, negativeSha) : null);
})().then(report => {
  console.log(JSON.stringify({ id: report.id, status: report.status, children: report.childrenClosed,
    comparison: report.comparisons?.map(row => ({ id: row.spec.id, outcome: row.comparison })),
    report: path.join(report.directory, 'report.json'), failure: report.failure, closureFailures: report.closureFailures }));
  if (!['completed-mkv-audio-measurement', 'passed-mkv-audio-source-holdouts', 'passed-mkv-audio-clock-copy-holdouts',
      'passed-mkv-audio-service-prospective', 'passed-mkv-audio-service-normal'].includes(report.status)) process.exitCode = 1;
}).catch(error => { console.error(error); process.exitCode = 1; });
