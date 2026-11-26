'use strict';

const { ToolError } = require('./process-runner.cjs');
const { readNativeMetadata, ancestor } = require('./remux-native-reader.cjs');

const WINDOWS_TWO_AAC = 'h264-two-aac-mp4-windows-v1';
const VIDEO_SCALE = 30000n;
const MOVIE_SCALE = 35280000n;
const VIDEO_STEP = 1000n;
const AAC_STEP = 1024n;

function requireShape(condition, message, code = 'REMUX_TWO_AAC_SOURCE_UNQUALIFIED') {
  if (!condition) throw new ToolError(code, message);
}

function ticks(value) {
  requireShape((Number.isSafeInteger(value) || typeof value === 'string')
    && /^-?(0|[1-9]\d{0,18})$/.test(String(value)), 'An exact native track or packet clock is required.', 'REMUX_TWO_AAC_TIMING');
  return BigInt(value);
}

function assertTwoAacProbe(probe) {
  const [video, first, second] = probe.streams;
  requireShape(probe.format?.tags?.major_brand === 'isom' && probe.streams.length === 3
    && probe.chapters.length === 0 && probe.programs.length === 0 && probe.stream_groups.length === 0
    && probe.streams.every((stream, index) => stream.index === index && /^0x[1-3]$/.test(stream.id) && BigInt(stream.id) === BigInt(index + 1)
      && ticks(stream.start_pts) === 0n && [0, 1].includes(stream.disposition?.default)
      && Object.entries(stream.disposition).every(([key, value]) => key === 'default' || value === 0)),
  'Verified two-track MP4 copy requires a flat MP4 with one video and its two ordered audio tracks.');
  requireShape(video.codec_type === 'video' && video.codec_name === 'h264' && video.time_base === '1/30000'
    && video.r_frame_rate === '30/1' && video.avg_frame_rate === '30/1' && video.tags?.language === 'und'
    && video.disposition.default === 1 && ticks(video.duration_ts) > 0n && ticks(video.duration_ts) % VIDEO_STEP === 0n,
  'Verified two-track MP4 copy requires the measured default 30 fps H.264 track and its native clock.');
  const exact = (stream, rate, channels, language, isDefault) => stream.codec_type === 'audio'
    && stream.codec_name === 'aac' && stream.codec_tag_string === 'mp4a' && stream.profile === 'LC' && stream.sample_fmt === 'fltp'
    && stream.sample_rate === String(rate) && stream.time_base === '1/' + rate && stream.channels === channels
    && stream.channel_layout === (channels === 1 ? 'mono' : 'stereo') && stream.tags?.language === language
    && stream.disposition.default === (isDefault ? 1 : 0) && ticks(stream.initial_padding) === AAC_STEP && ticks(stream.seek_preroll) === AAC_STEP
    && (stream.trailing_padding === undefined || ticks(stream.trailing_padding) === 0n);
  const mixed = exact(first, 48000, 2, 'eng', true) && exact(second, 44100, 1, 'ara', false);
  const twins = exact(first, 48000, 2, 'eng', false) && exact(second, 48000, 2, 'ara', true);
  requireShape(mixed || twins, 'This verified route covers the two measured AAC layouts, languages and default-track orders.');
  requireShape([first, second].every(stream => ticks(stream.duration_ts) > 0n && ticks(stream.duration_ts) % AAC_STEP === 0n),
    'This verified route needs complete terminal AAC units, with no shortening edit.', 'REMUX_SOURCE_EDIT_UNSUPPORTED');
  return mixed ? 'mixed' : 'twins';
}

function assertTwoAacPacket(stream, packet, ordinal) {
  const pts = ticks(packet.pts), dts = ticks(packet.dts), duration = ticks(packet.duration);
  const sideData = packet.side_data_list ?? [];
  const position = BigInt(ordinal), length = ticks(stream.duration_ts);
  if (stream.codec_type === 'video') {
    requireShape(pts >= 0n && pts < length && pts % VIDEO_STEP === 0n && duration === VIDEO_STEP
      && dts === (position - 2n) * VIDEO_STEP && sideData.length === 0,
    'The H.264 packet left its exact native decode or presentation grid.', 'REMUX_TWO_AAC_TIMING');
    return;
  }
  const first = ordinal === 0, skip = sideData[0];
  const validPadding = first ? sideData.length === 1 && skip?.side_data_type === 'Skip Samples'
    && ticks(skip.skip_samples) === AAC_STEP && ticks(skip.discard_padding) === 0n
    && ticks(skip.skip_reason) === 0n && ticks(skip.discard_reason) === 0n : sideData.length === 0;
  requireShape(pts === (position - 1n) * AAC_STEP && pts === dts && pts < length && duration === AAC_STEP && validPadding,
    'The AAC access unit changed its exact clock, head priming or full terminal span.', 'REMUX_TWO_AAC_TIMING');
}

function assertTwoAacUnits(stream, count, decodedSamples) {
  const length = ticks(stream.duration_ts);
  const video = stream.codec_type === 'video';
  requireShape(ticks(count) === (video ? length / VIDEO_STEP : length / AAC_STEP + 1n)
    && (video || decodedSamples === undefined || ticks(decodedSamples) === length),
  'The complete packet and decoded sample counts must match each native track edit.', 'REMUX_TWO_AAC_TIMING');
}

async function observeTwoAacNative({ file, probe, identity, playback, maxRecords, timeoutMs, signal }) {
  const variant = assertTwoAacProbe(probe);
  const tracks = probe.streams.map((stream, index) => {
    const track = playback.tracks.find(entry => entry.outputIndex === index);
    const audio = index !== 0, mediaTime = audio ? AAC_STEP : 2n * VIDEO_STEP;
    const scale = audio ? BigInt(stream.sample_rate) : VIDEO_SCALE, length = ticks(stream.duration_ts);
    requireShape(track?.trackId === index + 1 && !track.fragmentCoverage && ticks(track.movieScale) === MOVIE_SCALE
      && ticks(track.mediaScale) === scale && ticks(track.mediaDuration) === (audio ? length + AAC_STEP : length)
      && track.controls.flags === (stream.disposition.default ? 3 : 2) && track.controls.alternateGroup === Number(audio)
      && track.entries.length === 1 && track.entries[0].rateInteger === 1 && track.entries[0].rateFraction === 0
      && ticks(track.entries[0].mediaTime) === mediaTime && track.trackDuration === track.entries[0].duration
      && ticks(track.trackDuration) * scale === length * MOVIE_SCALE,
    'The MP4 track order, native controls or exact unity-rate edit is outside the measured two-AAC route.', 'REMUX_TWO_AAC_NATIVE');
    return track;
  });
  const metadataBytesRead = await readNativeMetadata({ file, identity, family: 'isobmff', maxRecords, timeoutMs, signal,
    async withMetadata(meta) {
      const brands = meta.nodes.filter(node => node.type === 'ftyp' && !node.parent);
      const media = meta.nodes.filter(node => node.type === 'mdat' && !node.parent);
      const nativeTracks = meta.nodes.filter(node => node.type === 'trak' && node.parent?.type === 'moov');
      requireShape(brands.length === 1 && brands[0].end - brands[0].body >= 8 && media.length === 1 && nativeTracks.length === tracks.length
        && !meta.seenTypes.has('moof') && !meta.seenTypes.has('mvex') && (await meta.read(brands[0].body, 4)).toString('ascii') === 'isom',
      'Only the measured physical flat MP4 brand and track layout are verified.', 'REMUX_TWO_AAC_NATIVE');
      for (const [index, track] of nativeTracks.entries()) {
        const [entry, ...duplicates] = meta.nodes.filter(node => node.type === 'tkhd' && node.parent === track);
        requireShape(entry && duplicates.length === 0 && entry.end - entry.body >= 24,
          'Every measured MP4 track needs one native track header.', 'REMUX_TWO_AAC_NATIVE');
        const header = await meta.read(entry.body, 24);
        requireShape(header[0] <= 1 && header.readUInt32BE(header[0] ? 20 : 12) === index + 1,
          'The physical MP4 track order differs from the qualified map.', 'REMUX_TWO_AAC_NATIVE');
        if (index === 0) continue;
        const entries = meta.nodes.filter(node => node.type === 'mp4a' && ancestor(node, 'trak') === track);
        requireShape(entries.length === 1 && entries[0].end - entries[0].body >= 28,
          'Each AAC track needs one bounded native sample entry.', 'REMUX_TWO_AAC_NATIVE');
        const sample = await meta.read(entries[0].body, 28), stream = probe.streams[index];
        requireShape(sample.readUInt16BE(8) === 0 && sample.readUInt16BE(16) === stream.channels
          && sample.readUInt32BE(24) === Number(stream.sample_rate) * 65536,
        'The physical AAC channel or sample-rate header changed.', 'REMUX_TWO_AAC_NATIVE');
      }
      return meta.bytesRead();
    } });
  return { variant, trackIds: tracks.map(track => track.trackId), metadataBytesRead };
}

module.exports = { WINDOWS_TWO_AAC, VIDEO_SCALE, MOVIE_SCALE, assertTwoAacProbe, assertTwoAacPacket, assertTwoAacUnits, observeTwoAacNative };
