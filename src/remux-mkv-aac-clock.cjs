'use strict';

// Source-clock admission for the finite regular Windows MKV/AAC measurements.
// This observer gives no command or Start authority. A current source and a
// verified stage still need the complete sample and video comparisons.
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { readNativeMetadata } = require('./remux-native-reader.cjs');
const { sameIdentity } = require('./source-identity.cjs');

const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const RATE = 48000;
const AAC_FRAME = 1024;
const SHIFT_SAMPLES = -3072;
const ASC_SHA256 = 'b3108813350006ef07740046fab14af9c374938867d16db02fe1a8baa5e72f10';
const VERIFICATION_METHOD = 'aac-sample-clock-v1';
const CLOCK_FILTER = 'setts=time_base=1/48000:prescale=1:ts=N*1024-1024:duration=1024';
const sourceObservations = new WeakMap();

const digest = buffer => createHash('sha256').update(buffer).digest('hex');
function requireClock(condition, reason) {
  if (!condition) throw new ToolError('REMUX_MKV_AAC_CLOCK_UNQUALIFIED', reason);
}
function present(stream, entries) {
  return Object.entries(entries).every(([key, value]) => stream[key] === value);
}
function packetTime(value) {
  requireClock(typeof value === 'string' && /^-?\d{1,8}$/.test(value), 'A measured Matroska block clock is required.');
  return Number(value);
}

async function observeMkvAacClock({ file, identity, probe, signal }) {
  requireClock(identity?.canonicalPath === file && /^[1-9]\d{0,6}$/.test(identity.size) && Number(identity.size) <= MAX_SOURCE_BYTES,
    'The AAC copy requires a current bounded local source.');
  const [video, audio] = probe.streams;
  requireClock(probe.format.format_name === 'matroska,webm' && probe.streams.length === 2
    && probe.chapters.length === 0 && probe.programs.length === 0 && probe.stream_groups.length === 0,
  'Only the measured two-stream Matroska source with no additional relationships is supported.');
  requireClock(present(video, { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', pix_fmt: 'yuv420p',
    width: 320, height: 180, field_order: 'progressive', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9',
    color_range: 'tv', color_primaries: 'bt709', color_transfer: 'bt709', color_space: 'bt709',
    r_frame_rate: '25/1', avg_frame_rate: '25/1', time_base: '1/1000', start_pts: 0 })
    && !(video.side_data_list || []).length && /^SHA256:[a-f0-9]{64}$/.test(video.extradata_hash || ''),
  'Only the measured zero-origin 25 fps SDR H.264 video clock is supported.');
  requireClock(present(audio, { index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp',
    sample_rate: '48000', channels: 2, channel_layout: 'stereo', time_base: '1/1000',
    initial_padding: AAC_FRAME, extradata_hash: 'SHA256:' + ASC_SHA256 })
    && [0, 64].includes(audio.start_pts) && !(audio.side_data_list || []).length,
  'Only the measured 48 kHz stereo AAC clock and configuration are supported.');

  const observation = await readNativeMetadata({ file, identity, family: 'matroska', maxRecords: 512, timeoutMs: 10000,
    signal, seekRecords: true, async withMetadata(meta) {
      const one = (nodes, name) => {
        const matches = nodes.filter(node => node.name === name);
        requireClock(matches.length === 1, 'A unique native ' + name + ' is required.');
        return matches[0];
      };
      const field = async (node, limit) => {
        requireClock(node.end > node.body && node.end - node.body <= limit, 'A native source control exceeds its bound.');
        return meta.read(node.body, node.end - node.body);
      };
      const uint = async node => Number(BigInt('0x' + (await field(node, 6)).toString('hex')));
      const scale = await uint(one(meta.nodes, 'TimestampScale'));
      requireClock(scale === 1000000, 'The measured millisecond Matroska clock is required.');
      const [v, a] = meta.nodes.filter(node => node.name === 'TrackEntry');
      requireClock(v && a && meta.nodes.filter(node => node.name === 'TrackEntry').length === 2
        && !meta.nodes.some(node => node.name === 'TrackTimestampScale')
        && await uint(one(v.children, 'TrackNumber')) === 1 && await uint(one(a.children, 'TrackNumber')) === 2
        && await uint(one(v.children, 'TrackType')) === 1 && await uint(one(a.children, 'TrackType')) === 2
        && (await field(one(v.children, 'CodecID'), 32)).toString('ascii') === 'V_MPEG4/ISO/AVC'
        && (await field(one(a.children, 'CodecID'), 32)).toString('ascii') === 'A_AAC',
      'The native Matroska track identities or representations differ from the measured route.');
      const videoConfig = digest(await field(one(v.children, 'CodecPrivate'), 1024));
      const audioConfig = digest(await field(one(a.children, 'CodecPrivate'), 64));
      requireClock(video.extradata_hash === 'SHA256:' + videoConfig && audioConfig === ASC_SHA256
        && await uint(one(a.children, 'CodecDelay')) === 21333333,
      'The native AVC/AAC configuration or AAC priming differs from the measured source.');

      const padding = meta.ebmlWalk.paddings;
      const exact = audio.start_pts === 0;
      requireClock(exact ? padding.length === 0 : padding.length === 1
        && padding[0].trackId === '2' && padding[0].nanoseconds === '1979167',
      'The source AAC priming and terminal padding need their exact measured combination.');
      const visibleStartSamples = exact ? 0 : -SHIFT_SAMPLES;
      const paddingSamples = exact ? 0 : 95;
      const packets = meta.ebmlWalk.packets;
      const videoPackets = packets.filter(packet => packet.trackId === '1');
      const audioPackets = packets.filter(packet => packet.trackId === '2');
      requireClock(videoPackets.length >= 25 && videoPackets.length <= 100 && audioPackets.length >= 40
        && audioPackets.length <= 192 && packets.length === videoPackets.length + audioPackets.length,
      'The source exceeds the finite complete packet observation.');
      const sortedPts = videoPackets.map(packet => packetTime(packet.pts)).sort((left, right) => left - right);
      requireClock(sortedPts.every((pts, index) => pts === index * 40), 'The native video clock is not exactly 25 frames per second.');
      const samples = (audioPackets.length - 1) * AAC_FRAME - paddingSamples;
      const videoSamples = videoPackets.length * 40 * (RATE / 1000);
      requireClock(visibleStartSamples + samples === videoSamples + (exact ? 0 : 929),
        'The effective audio and video endpoints differ from the measured source shape.');

      const accessUnits = [];
      for (const [index, packet] of audioPackets.entries()) {
        const pts = packetTime(packet.pts), size = packet.end - packet.body;
        // The muxer independently rounds the coded PTS and its positive
        // CodecDelay offset to the millisecond grid. Reconstruct both exact
        // steps. No nearest-tick allowance replaces this equality.
        const codedMilliseconds = Math.round((index - 1) * AAC_FRAME / 48);
        const primingMilliseconds = Math.round(AAC_FRAME / 48);
        const exactPts = audio.start_pts + codedMilliseconds + primingMilliseconds;
        requireClock(!packet.lacing && !packet.discardable && packet.key && size >= 1 && size <= 4096
          && pts === exactPts && (exact || index !== audioPackets.length - 1
            ? packet.duration === null : packet.duration === '19'),
        'A native AAC access unit differs from the measured packet clock or framing.');
        accessUnits.push(Object.freeze({ size, sha256: digest(await meta.read(packet.body, size)) }));
      }
      const whole = createHash('sha256');
      for (let at = 0; at < meta.fileBytes; at += 65536) {
        whole.update(await meta.read(at, Math.min(65536, meta.fileBytes - at)));
      }
      return Object.freeze({
        sha256: whole.digest('hex'), bytes: meta.fileBytes, sampleRate: RATE,
        mode: exact ? 'exact' : 'earlier', shiftSamples: exact ? 0 : SHIFT_SAMPLES,
        visibleStartSamples, sampleFrames: samples, videoFrames: videoPackets.length,
        initialPadding: AAC_FRAME, terminalPadding: paddingSamples, codedAudioPackets: audioPackets.length,
        audioConfig, videoConfig, accessUnits: Object.freeze(accessUnits),
      });
    } });
  sourceObservations.set(observation, Object.freeze({ ...identity }));
  return observation;
}

function requireMkvAacClock(observation, identity) {
  const bound = sourceObservations.get(observation);
  requireClock(bound && (identity === undefined || sameIdentity(bound, identity)), 'A current main-owned Matroska audio clock is required.');
  return bound;
}

async function recheckMkvAacSource(file, observation, probe, signal) {
  const identity = requireMkvAacClock(observation);
  const current = await observeMkvAacClock({ file, identity, probe, signal });
  requireClock(current.sha256 === observation.sha256, 'The complete Matroska source changed after preparation.');
}

module.exports = { CLOCK_FILTER, MAX_SOURCE_BYTES, VERIFICATION_METHOD, observeMkvAacClock,
  requireMkvAacClock, recheckMkvAacSource };
