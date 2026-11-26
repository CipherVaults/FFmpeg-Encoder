'use strict';

const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { cueText, LIMITS } = require('./operation-subrip.cjs');

const SOURCE_ERROR = 'REMUX_SUBRIP_SOURCE_UNQUALIFIED';
const NATIVE_ERROR = 'REMUX_NATIVE_SUBRIP_COPY';
const requireSubtitle = (condition, message, code = SOURCE_ERROR) => {
  if (!condition) throw new ToolError(code, message);
};

function assertWindowsSubtitleProbe(probe) {
  const [video, subtitle] = probe.streams;
  requireSubtitle(probe.streams.length === 2 && video.index === 0 && video.codec_type === 'video' && video.codec_name === 'h264'
    && subtitle.index === 1 && subtitle.codec_type === 'subtitle' && subtitle.codec_name === 'subrip'
    && subtitle.time_base === '1/1000' && !subtitle.extradata_size && subtitle.extradata_hash === undefined
    && !subtitle.side_data_list?.length && subtitle.tags?.language === 'ara'
    && typeof subtitle.tags.title === 'string' && subtitle.tags.title.length > 0
    && subtitle.disposition?.default === 1 && subtitle.disposition.forced === 1
    && Object.entries(subtitle.disposition).every(([key, value]) => ['default', 'forced'].includes(key) || value === 0)
    && probe.chapters.length === 0 && !probe.programs?.length && !probe.stream_groups?.length,
  'This Windows Matroska route needs one H.264 track and one Arabic plain SubRip track with its measured selection flags, without other timed tracks.');
}

async function readWindowsSubtitleBlocks({ meta, tracks, integer, text }) {
  const track = tracks.find(value => value.index === 1);
  function only(type) {
    const values = track?.node.children.filter(node => node.type === type);
    requireSubtitle(values?.length === 1, 'The native subtitle track control is missing or ambiguous.', NATIVE_ERROR);
    return values[0];
  }
  const scales = meta.nodes.filter(node => node.type === '0x2ad7b1');
  requireSubtitle(track?.selected && track.trackId === '2' && await integer(only('0x83')) === 17n
    && await text(only('0x86')) === 'S_TEXT/UTF8' && await text(only('0x22b59c')) === 'ara'
    && await text(only('0x536e')) === track.stream.tags.title
    && !track.node.children.some(node => ['0x63a2', '0x22b59d'].includes(node.type))
    && (scales.length === 0 || scales.length === 1 && await integer(scales[0]) === 1000000n),
  'The subtitle track needs the exact native text, language, title and millisecond mapping.', NATIVE_ERROR);

  const packets = meta.ebmlWalk.packets.filter(packet => packet.trackId === track.trackId);
  requireSubtitle(packets.length > 0, 'The declared subtitle track has no native text blocks.', NATIVE_ERROR);
  const rows = [];
  let previous = -1n, textBytes = 0;
  for (const packet of packets) {
    const pts = BigInt(packet.pts), duration = BigInt(packet.duration ?? 0);
    const size = packet.end - packet.body;
    textBytes += size;
    requireSubtitle(packet.key && !packet.discardable && !packet.lacing && packet.ordinal === rows.length + 1
      && pts > previous && duration > 0n && size > 0 && size <= LIMITS.cueBytes && textBytes <= LIMITS.textBytes
      && packet.body >= 4 && (await meta.read(packet.body - 4, 1))[0] === 0x82,
    'Each subtitle block needs a unique position, positive extent and bounded plain-text payload.', NATIVE_ERROR);
    const bytes = await meta.read(packet.body, size);
    cueText(bytes);
    rows.push({ ordinal: packet.ordinal, pts: packet.pts, duration: packet.duration, position: String(packet.body - 4),
      size: String(size), sha256: createHash('sha256').update(bytes).digest('hex') });
    previous = pts;
  }
  return rows;
}

function requireSubtitlePacket(packet, native, ordinal) {
  requireSubtitle(native?.ordinal === ordinal && String(packet.pos) === native.position
    && String(packet.pts) === native.pts && String(packet.dts) === native.pts && String(packet.duration) === native.duration
    && String(packet.size) === native.size && packet.flags === 'K__' && !packet.side_data_list?.length,
  'The demuxed subtitle packet differs from its exact native timed text block.', NATIVE_ERROR);
  return native.sha256;
}

module.exports = { assertWindowsSubtitleProbe, readWindowsSubtitleBlocks, requireSubtitlePacket };
