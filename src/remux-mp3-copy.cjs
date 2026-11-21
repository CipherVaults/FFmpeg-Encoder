'use strict';
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const { classifyMarker, MARKER_KEY, OUTPUT_ID_KEY } = require('./provenance.cjs');
const COPY_NOTICE = 'The original MP3 audio is copied into MP4 without conversion. Some Apple players may not play this combination. The sole audio track becomes the default.';
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_OUTPUT_BYTES = MAX_SOURCE_BYTES + 512 * 1024;
const MAX_PACKETS = 4096;
const SAMPLES_PER_PACKET = 1152;
const sha = b => createHash('sha256').update(b).digest('hex');
function need(ok, code, message) { if (!ok) throw new ToolError(code, message); }
function bounded(b, maximum = MAX_SOURCE_BYTES) {
  need(Buffer.isBuffer(b) && b.length > 0 && b.length <= maximum,
    'MP3_WITNESS_LIMIT', 'Outside the bounded complete MP3 verification scope.');
}
function frame(ok) { need(ok, 'MP3_FRAME_UNPROVED', 'Not a fully covered, untagged MPEG-1 Layer III frame sequence.'); }
function inspectFrames(raw) {
  bounded(raw);
  const frames = [];
  let rate, channels;
  for (let pos = 0; pos < raw.length;) {
    need(frames.length < MAX_PACKETS, 'MP3_WITNESS_LIMIT', 'Frame observation limit reached.');
    frame(pos + 4 <= raw.length && raw[pos] === 255 && raw[pos+1] === 0xfb);
    const b = raw[pos+2], c = raw[pos+3];
    const kbps = [0,32,40,48,56,64,80,96,112,128,160,192,224,256,320,0][b >> 4];
    const hz = [44100,48000,32000,0][(b >> 2) & 3], ch = (c >> 6) === 3 ? 1 : 2;
    frame(kbps && hz && (c & 3) === 0);
    const size = Math.floor(144000 * kbps / hz) + ((b >> 1) & 1);
    frame(pos + size <= raw.length && (!frames.length || (rate === hz && channels === ch)));
    const bytes = raw.subarray(pos, pos + size), info = ch === 1 ? 21 : 36;
    // FFmpeg may omit a Xing/Info frame from the packet list; never treat a gapless header as audible PCM.
    if (!frames.length) frame(!['Info','Xing'].includes(bytes.toString('ascii',info,info+4)) && bytes.toString('ascii',36,40) !== 'VBRI');
    rate = hz; channels = ch;
    frames.push({ pos, size, sha256: sha(bytes) }); pos += size;
  }
  frame(frames.length >= 2);
  return { rate, channels, frames };
}
function family(ok) { need(ok, 'MP3_FAMILY_UNPROVED', 'Audio family, layout, metadata or sole-stream shape is unproved.'); }
function clock(ok) { need(ok, 'MP3_CLOCK_MISMATCH', 'The exact Layer III sample clock was not preserved.'); }
function payload(ok) { need(ok, 'MP3_PACKET_MISMATCH', 'Ordered compressed frame bytes were not preserved.'); }
function iso(ok) { need(ok, 'MP3_MP4_UNPROVED', 'Native MP4 identity or media extent is unproved.'); }
function boxes(b, start, end) {
  const out = new Map();
  for (let i = start; i < end;) {
    iso(i + 8 <= end);
    const len = b.readUInt32BE(i), kind = b.toString('latin1',i+4,i+8);
    iso(len >= 8 && i+len <= end && !out.has(kind) && out.size < 32);
    out.set(kind,{body:i+8,end:i+len}); i += len;
  }
  return out;
}
function readMp4(b, src, outputId) {
  bounded(b, outputId === undefined ? MAX_SOURCE_BYTES : MAX_OUTPUT_BYTES);
  const top = boxes(b,0,b.length), field = (m,k) => {const f=m.get(k); iso(f);return f;};
  const child = (m,k,prefix=0) => {const f=field(m,k);iso(f.body+prefix<=f.end);return boxes(b,f.body+prefix,f.end);};
  const body = (m,k) => {const f=field(m,k);return b.subarray(f.body,f.end);};
  iso([...top.keys()].join('/') === 'ftyp/free/mdat/moov');
  iso(body(top,'ftyp').toString('hex') === '69736f6d0000020069736f6d69736f326d703431');
  const moov=child(top,'moov'), trak=child(moov,'trak'), mdia=child(trak,'mdia'), minf=child(mdia,'minf');
  const stbl=child(minf,'stbl'), stsd=body(stbl,'stsd');
  iso(stsd.length >= 8 && stsd.readUInt32BE(0) === 0 && stsd.readUInt32BE(4) === 1);
  const entries=child(stbl,'stsd',8); iso(entries.size===1);
  const sample=body(entries,'mp4a');iso(sample.length>=28 && sample.readUInt16BE(6)===1 && sample.readUInt16BE(8)===0 && sample.readUInt16BE(16)===src.channels && sample.readUInt32BE(24)===src.rate*65536);
  // The pinned muxer's MPEG-1 Audio descriptor, not the AAC 0x40 object type.
  const extensions=child(entries,'mp4a',28);
  iso([...extensions.keys()].join('/')==='esds/btrt'); // This pinned lab output only; not a generic MP4 acceptance rule.
  const esds=body(extensions,'esds');
  iso(esds.length===36 && esds.subarray(0,19).toString('hex')==='00000000038080801b000100048080800d6b15' && esds.subarray(30).toString('hex')==='068080800102');
  const mdhd=body(mdia,'mdhd');
  iso(mdhd.length===24 && mdhd.readUInt32BE(0)===0 && mdhd.readUInt32BE(12)===src.rate && mdhd.readUInt32BE(16)===src.frames.length*SAMPLES_PER_PACKET && mdhd.readUInt16BE(20)===0x55c4);
  const stts=body(stbl,'stts');
  iso(stts.length===16 && stts.readUInt32BE(0)===0 && stts.readUInt32BE(4)===1 && stts.readUInt32BE(8)===src.frames.length && stts.readUInt32BE(12)===1152);
  const ed=body(child(trak,'edts'),'elst'), movie=body(moov,'mvhd');
  iso(ed.length===20 && ed.readUInt32BE(0)===0 && ed.readUInt32BE(4)===1 && ed.readInt32BE(12)===0 && ed.readUInt32BE(16)===65536 && movie.length===100 && movie.readUInt32BE(0)===0);
  const scale=movie.readUInt32BE(12);
  iso(scale>0 && movie.readUInt32BE(16)===ed.readUInt32BE(8) && BigInt(ed.readUInt32BE(8))*BigInt(src.rate)===BigInt(src.frames.length*SAMPLES_PER_PACKET)*BigInt(scale));
  return field(top,'mdat');
}
function metadata(p, src, size, output, outputId) {
  family(p && ['streams','programs','stream_groups','chapters'].every(k=>Array.isArray(p[k])) && p.streams.length===1 && p.programs.length+p.stream_groups.length+p.chapters.length===0);
  const s=p.streams[0], f=p.format;
  family(f && f.nb_streams===1 && f.nb_programs===0 && f.nb_stream_groups===0 && f.size===String(size) && f.format_name===(output?'mov,mp4,m4a,3gp,3g2,mj2':'mp3'));
  family(s && s.index===0 && s.codec_type==='audio' && s.codec_name==='mp3' && s.sample_rate===String(src.rate) && s.channels===src.channels && s.channel_layout===(src.channels===1?'mono':'stereo'));
  family(!s.side_data_list?.length && s.initial_padding===0 && !s.trailing_padding && s.disposition && s.disposition.default===(output?1:0) && Object.keys(s.disposition).every(k=>k==='default'||s.disposition[k]===0));
  if (output) {
    family(f.tags?.major_brand==='isom' && f.tags?.minor_version==='512' && f.tags?.compatible_brands==='isomiso2mp41');
    const expectedTags = ['major_brand', 'minor_version', 'compatible_brands'];
    if (outputId !== undefined) {
      const marker = classifyMarker(p);
      family(marker.kind === 'generated' && marker.outputId === outputId && marker.previousGeneration === undefined);
      expectedTags.push(MARKER_KEY, OUTPUT_ID_KEY);
    }
    family(Object.keys(f.tags).length === expectedTags.length && Object.keys(f.tags).every(key => expectedTags.includes(key)));
    family(s.codec_tag_string==='mp4a' && s.tags?.language==='und' && s.tags.handler_name==='SoundHandler' && Object.keys(s.tags).length===2);
  } else family(!Object.keys(f.tags||{}).length && !Object.keys(s.tags||{}).length);
  clock(s.start_pts===0 && /^(?:1)\/[1-9]\d{0,8}$/.test(s.time_base));
  return BigInt(s.time_base.split('/')[1]);
}
function validateMp3SourceProbe(probe, observed) {
  metadata(probe, observed, observed.size, false);
}

function compareCompressedCopy({ source, output, sourceProbe, outputProbe, outputId }) {
  const src=inspectFrames(source), extent=readMp4(output,src,outputId), rate=BigInt(src.rate);
  const sampleCount=src.frames.length*SAMPLES_PER_PACKET;
  payload(output.subarray(extent.body,extent.end).equals(source)); // no gaps, junk, truncation or unprobed tail
  for (const [bytes,p,out] of [[source,sourceProbe,false],[output,outputProbe,true]]) {
    const ticks=metadata(p,src,bytes.length,out,outputId);
    payload(Array.isArray(p.packets) && p.packets.length===src.frames.length);
    src.frames.forEach((f,i)=>{
      const pk=p.packets[i];payload(pk && pk.codec_type==='audio' && pk.stream_index===0 && pk.size===String(f.size) && pk.pos===String(f.pos+(out?extent.body:0)) && pk.data_hash==='SHA256:'+f.sha256);
      clock(pk.flags==='K__' && !pk.side_data_list?.length && [pk.pts,pk.dts,pk.duration].every(Number.isSafeInteger) && pk.pts===pk.dts && BigInt(pk.pts)*rate===BigInt(i*SAMPLES_PER_PACKET)*ticks && BigInt(pk.duration)*rate===1152n*ticks);
    });
    if(out) clock(Number.isSafeInteger(p.streams[0].duration_ts) && BigInt(p.streams[0].duration_ts)*rate===BigInt(sampleCount)*ticks);
  }
  return Object.freeze({ sourceSha256: sha(source), outputSha256: sha(output), orderedPacketPayloadSha256: sha(source),
    sampleFrames: sampleCount, packets: src.frames.length, rate: src.rate, channels: src.channels });
}

function compareCopy({ sourcePcm, outputPcm, ...inputs }) {
  const measured = compareCompressedCopy(inputs), bytes = measured.sampleFrames * measured.channels * 4;
  need(Buffer.isBuffer(sourcePcm) && Buffer.isBuffer(outputPcm) && sourcePcm.length === bytes
    && outputPcm.length === bytes && sourcePcm.equals(outputPcm),
  'MP3_PCM_MISMATCH', 'The complete decoded signed 32-bit PCM or its sample count differs.');
  return Object.freeze({ status: 'laboratory-observation-only', ...measured, pcmS32leSha256: sha(sourcePcm), notice: COPY_NOTICE });
}

module.exports = { inspectFrames, compareCopy, compareCompressedCopy, validateMp3SourceProbe, COPY_NOTICE, MAX_SOURCE_BYTES, MAX_OUTPUT_BYTES, MAX_PACKETS, SAMPLES_PER_PACKET };
