'use strict';

// Transport conversion is an interpretation boundary. No NAL may disappear:
// Annex B start codes become four-byte lengths; ADTS alone is stripped. The
// sample description is an additional byte-identical copy of SPS/PPS, never
// permission to remove an in-band parameter set, AUD, SEI or filler.
const { createHash } = require('node:crypto');
const { ToolError } = require('./process-runner.cjs');
const sha = data => createHash('sha256').update(data).digest('hex');
const need = (ok, code, message) => { if (!ok) throw new ToolError(code, message); };
const MAX_PACKET = 8 * 1024 * 1024;
const ANNEX_B_PREFIX = Buffer.from([0, 0, 1]);
// Finite continuous-transport envelope: PCR observations at most one second
// apart; each delivered PES decode clock within ten seconds of the latest PCR.
const PCR_GAP = 27000000n, PCR_PES_DISTANCE = 270000000n;

// PMT descriptor loops are at most a 1024-byte PSI section. Keep the treatment
// in the shared inventory; never interpret a descriptor's text as instructions.
function inspectTransportDescriptors(bytes, streams) {
  const code='REMUX_TS_DESCRIPTOR_STRUCTURE',rules=require('./remux-native-inventory.cjs').INVENTORY
    .filter(r=>r.container==='mpegts'&&r.enforcement==='transport-inventory');
  need(Buffer.isBuffer(bytes)&&bytes.length>=16&&bytes.length<=1024&&bytes[0]===2,code,'Invalid bounded PMT descriptor section.');
  const end=bytes.length-4,programLength=((bytes[10]&15)<<8)|bytes[11];
  function loop(start,limit,stream){
    need(start<=limit&&limit<=end,code,'PMT descriptor loop exceeds the section.');
    const seen=new Set();
    for(let at=start;at<limit;){
      need(at+2<=limit,code,'Truncated PMT descriptor header.');const tag=bytes[at],length=bytes[at+1],next=at+2+length;
      need(next<=limit,code,'PMT descriptor payload exceeds its loop.');
      need(rules.some(r=>r.tag===tag),'REMUX_TS_DESCRIPTOR_UNCLASSIFIED','TS descriptor 0x'+tag.toString(16)+': its playback interpretation has no inventory row.');
      for(const r of rules.filter(r=>r.tag===tag)){
        need(!seen.has(tag),r.code,'TS '+r.field+': duplicate presentation descriptor.');seen.add(tag);
        if(r.check==='ts-absent')need(false,r.code,'TS '+r.field+': this presentation/selection control cannot be carried by MP4.');
        if(r.check==='ts-language'){
          const language=length===4?bytes.toString('latin1',at+2,at+5):'';
          need(stream?.codec_type==='audio'&&/^[a-z]{3}$/.test(language)&&bytes[at+5]===0
            &&language===(stream.tags?.language||'und'),r.code,
          'TS ISO_639_language_audio_type: requires one faithfully carried language and ordinary audio type 0.');
        }
        if(r.check==='ts-aac'){
          // ETSI EN 300 468 H.2 / table 26: AAC uses the HE-AAC component
          // labels too. Only the neutral channel-mode labels are equivalent;
          // receiver mixes and PES-private SAOC-DE controls cannot be copied.
          need(stream?.codec_type==='audio'&&stream.codec_name==='aac'&&length>=1&&length<=3,r.code,'TS AAC descriptor: unsupported or malformed AAC presentation.');
          if(length>1){const flags=bytes[at+3],type=bytes[at+4],channels=Number(stream.channels);
            need(!(flags&127)&&(flags&128?length===3&&(type===1&&channels===1||type===3&&channels===2||type===5&&channels>2):length===2),r.code,
              'TS AAC descriptor: accessibility, receiver-mix, SAOC-DE or mismatched channel modes cannot be carried.');}
        }
      }
      at=next;
    }
  }
  loop(12,12+programLength,null);
  for(let at=12+programLength;at<end;){
    need(at+5<=end,code,'Truncated PMT elementary-stream descriptor header.');
    const pid=((bytes[at+1]&31)<<8)|bytes[at+2],length=((bytes[at+3]&15)<<8)|bytes[at+4],next=at+5+length;
    loop(at+5,next,streams.find(s=>Number(s.id)===pid));at=next;
  }
}

function transportSourceReasons(probe, target) {
  const reasons = [], add = (code, message) => reasons.push({ code, message, streamIndex: null });
  if (target !== 'mp4') add('REMUX_TS_TARGET', 'MPEG-TS stream copy is qualified only for MP4.');
  const p = probe.mediaEvidence.container.programs;
  if (p.state !== 'known' || p.value.length !== 1 || p.value[0].state !== 'known'
      || p.value[0].streamIndexes.length !== probe.streams.length)
    add('REMUX_TS_PROGRAM', 'MPEG-TS needs exactly one known program containing every stream.');
  const videos = probe.streams.filter(s => s.codec_type === 'video'), audio = probe.streams.filter(s => s.codec_type === 'audio');
  if (videos.length !== 1) add('REMUX_TS_VIDEO_COUNT', 'MPEG-TS needs exactly one H.264 video stream.');
  for (const s of probe.streams) {
    const name = `${s.codec_type || 'unknown'} / ${s.codec_name || 'unknown'} (stream ${s.index})`;
    if (!['video', 'audio'].includes(s.codec_type)) add('REMUX_TS_OTHER_STREAM', `MPEG-TS cannot preserve ${name} in this MP4 route.`);
    else if (s.codec_type === 'video') {
      if (s.codec_name !== 'h264') add('REMUX_TS_VIDEO_CODEC', `MPEG-TS video ${name} is unsupported; H.264 is required.`);
      else if (s.field_order !== 'progressive') add('REMUX_TS_INTERLACED', 'MPEG-TS video must be explicitly progressive; interlaced or unknown field order is unsupported.');
      else if (s.pix_fmt !== 'yuv420p' || s.bits_per_raw_sample !== undefined && String(s.bits_per_raw_sample) !== '8')
        add('REMUX_TS_VIDEO_PRECISION', 'MPEG-TS video must be eight-bit 4:2:0 H.264.');
      else if (!['color_space', 'color_transfer', 'color_primaries'].every(k => s[k] === 'bt709') || s.color_range !== 'tv'
          || probe.mediaEvidence.streams.find(e => e.index === s.index)?.hdr.entries.length)
        add('REMUX_TS_SDR', 'MPEG-TS needs explicit limited-range BT.709 SDR without HDR metadata.');
    } else if (s.codec_name !== 'aac' || s.profile !== 'LC' || s.codec_tag_string !== '[15][0][0][0]')
      add('REMUX_TS_AUDIO_CODEC', `MPEG-TS audio ${name} is unsupported; AAC-LC with ADTS framing is required (LATM, AC-3 and MP2 are unsupported).`);
    else if (s.sample_rate !== '48000' || ![1, 2].includes(s.channels) || s.channel_layout !== (s.channels === 1 ? 'mono' : 'stereo'))
      add('REMUX_TS_AUDIO_LAYOUT', 'This MPEG-TS route currently proves only 48 kHz mono or stereo AAC-LC.');
  }
  if (audio.length > 1) add('REMUX_TS_AUDIO_COUNT', 'MPEG-TS with a second audio stream is unsupported; retain the original.');
  if (probe.chapters.length || probe.stream_groups.length) add('REMUX_TS_RELATIONSHIPS', 'MPEG-TS chapters or stream groups cannot be flattened into this MP4 route.');
  return reasons;
}

function dumpBytes(text, expected) {
  need(typeof expected === 'number' && Number.isSafeInteger(expected) || typeof expected === 'string' && /^[1-9]\d{0,6}$/.test(expected),
    'REMUX_TS_PACKET_BYTES', 'Transport byte count must be an exact bounded integer.');
  expected = Number(expected);
  need(Number.isSafeInteger(expected) && expected > 0 && expected <= MAX_PACKET && typeof text === 'string'
    && text.length <= expected * 6 + 256, 'REMUX_TS_PACKET_BYTES', 'Transport packet dump exceeds its byte bound.');
  const data = Buffer.alloc(expected); let at = 0;
  for (const line of text.split('\n')) {
    if (!line) continue;
    need(/^[0-9a-f]{8}: /i.test(line) && parseInt(line.slice(0, 8), 16) === at,
      'REMUX_TS_PACKET_BYTES', 'Transport packet dump has an invalid offset.');
    const hex = line.slice(10, 49).replace(/ /g, '');
    need(/^[0-9a-f]+$/i.test(hex) && hex.length % 2 === 0 && hex.length <= 32 && at + hex.length / 2 <= expected,
      'REMUX_TS_PACKET_BYTES', 'Transport packet dump is malformed or excessive.');
    at += Buffer.from(hex, 'hex').copy(data, at);
  }
  need(at === expected, 'REMUX_TS_PACKET_BYTES', 'Transport packet dump is incomplete.'); return data;
}
function transportNals(data, framing = 'annexb', lengthBytes = 4) {
  need(Buffer.isBuffer(data) && data.length > 0 && data.length <= MAX_PACKET,
    'REMUX_TS_NAL_FRAMING', 'A bounded complete AVC packet is required.');
  const units = [];
  const push = (start, end) => {
    // Refuse before allocating a Buffer view or scanning the next NAL body.
    need(units.length < 1024, 'REMUX_TS_NAL_LIMIT', 'An AVC packet contains more than 1,024 NAL units.');
    units.push(data.subarray(start, end));
  };
  if (framing === 'annexb') {
    let start = -1;
    for (let i = data.indexOf(ANNEX_B_PREFIX); i !== -1; i = data.indexOf(ANNEX_B_PREFIX, start)) {
      if (start === -1) need(data.subarray(0, i).every(b => b === 0), 'REMUX_TS_NAL_FRAMING', 'Missing Annex B start code.');
      else { need(units.length < 1024, 'REMUX_TS_NAL_LIMIT', 'An AVC packet contains more than 1,024 NAL units.');
        let end = i; while (end > start && data[end - 1] === 0) end--; push(start, end); }
      start = i + ANNEX_B_PREFIX.length;
    }
    need(start !== -1, 'REMUX_TS_NAL_FRAMING', 'Missing Annex B start code.');
    need(units.length < 1024, 'REMUX_TS_NAL_LIMIT', 'An AVC packet contains more than 1,024 NAL units.');
    let end = data.length; while (end > start && data[end - 1] === 0) end--; push(start, end);
  } else {
    need(framing === 'avcc' && [1, 2, 4].includes(lengthBytes), 'REMUX_TS_NAL_FRAMING', 'Unknown AVC packet framing.');
    for (let at = 0; at < data.length;) {
      need(units.length < 1024, 'REMUX_TS_NAL_LIMIT', 'An AVC packet contains more than 1,024 NAL units.');
      need(at + lengthBytes <= data.length, 'REMUX_TS_NAL_FRAMING', 'Truncated AVC length.');
      const n = data.readUIntBE(at, lengthBytes); at += lengthBytes;
      need(n > 0 && at + n <= data.length, 'REMUX_TS_NAL_FRAMING', 'Truncated or empty AVC NAL.');
      push(at, at + n); at += n;
    }
  }
  need(units.length > 0 && units.length <= 1024 && units.every(n => n.length > 0 && !(n[0] & 128)),
    'REMUX_TS_NAL_FRAMING', 'Empty, excessive or forbidden AVC NAL.'); return units;
}
function canonicalTransportVideo(data, framing, admitted, first = false, lengthBytes = 4) {
  const nals = transportNals(data, framing, lengthBytes), result = [];
  for (const nal of nals) {
    const type = nal[0] & 31;
    if ([7, 8].includes(type)) need([...admitted[type === 7 ? 'sps' : 'pps'].values()].some(p => p.equals(nal)),
      'REMUX_TS_PARAMETER_CHANGE', 'An in-band SPS/PPS differs from the MP4 sample description or changes mid-stream.');
    const length = Buffer.alloc(4); length.writeUInt32BE(nal.length); result.push(length, nal);
  }
  need(!first || nals.some(n => (n[0] & 31) === 5) && !nals.some(n => (n[0] & 31) === 1),
    'REMUX_TS_HEAD_NOT_KEYFRAME', 'The TS begins before a complete IDR keyframe; cut-mid-GOP inputs are unsupported.');
  const canonical = Buffer.concat(result);
  return { data: canonical, units: nals.map(n => ({ type: n[0] & 31, bytes: n.length, sha256: sha(n) })), sha256: sha(canonical) };
}
function canonicalTransportAudio(data, framing, expectedAsc, stream) {
  need(Buffer.isBuffer(data) && data.length > 0 && data.length <= MAX_PACKET,
    'REMUX_TS_ADTS_FRAME', 'A bounded complete AAC frame is required.');
  need(['raw', 'adts'].includes(framing) && Buffer.isBuffer(expectedAsc) && expectedAsc.length === 2,
    'REMUX_TS_AAC_FRAMING', 'AAC requires an explicit raw/ADTS framing and a complete admitted AudioSpecificConfig.');
  if (framing === 'raw') return { data, asc: expectedAsc, sha256: sha(data) };
  need(data.length >= 7 && data[0] === 255 && (data[1] & 246) === 240,
    'REMUX_TS_ADTS_FRAME', 'Partial or invalid ADTS frame at the source head or inside the file.');
  need((data[1] & 1) === 1, 'REMUX_TS_ADTS_CRC', 'CRC-protected ADTS frames are not supported by this route.');
  const profile = (data[2] >> 6) + 1, rate = (data[2] >> 2) & 15, channels = ((data[2] & 1) << 2) | (data[3] >> 6);
  need(profile === 2 && rate === 3 && channels === stream.channels && [1, 2].includes(channels)
    && !(data[1] & 8) && !(data[2] & 2) && !(data[3] & 60),
    'REMUX_TS_ADTS_CONFIG', 'Every ADTS frame must describe the admitted 48 kHz mono/stereo AAC-LC configuration.');
  const length = ((data[3] & 3) << 11) | (data[4] << 3) | (data[5] >> 5);
  need(length === data.length && length > 7 && (data[6] & 3) === 0,
    'REMUX_TS_ADTS_FRAME', 'Partial, concatenated or multiple-block ADTS frames are unsupported.');
  const asc = Buffer.from([(profile << 3) | (rate >> 1), ((rate & 1) << 7) | (channels << 3)]);
  need(Buffer.isBuffer(expectedAsc) && asc.equals(expectedAsc), 'REMUX_TS_ADTS_CONFIG', 'ADTS configuration changes or differs from the MP4 AudioSpecificConfig.');
  const payload = data.subarray(7); return { data: payload, asc, sha256: sha(payload) };
}

// Check the 33-bit native clock before FFmpeg's wrap correction can hide it.
// VFR presentation reordering is allowed; the decode clock never goes back.
function transportClock(stream) {
  let previous = null, count = 0;
  return packet => {
    need(['pts', 'dts'].every(k => /^(0|[1-9]\d{0,15})$/.test(String(packet[k]))),
      'REMUX_TS_TIMESTAMPS_MISSING', 'Every TS packet needs explicit PTS and DTS.');
    const pts = BigInt(packet.pts), dts = BigInt(packet.dts);
    need(pts < 8589934592n && dts < 8589934592n, 'REMUX_TS_TIMESTAMP_WRAP', 'A TS 33-bit timestamp wrap is unsupported.');
    need(previous === null || dts >= previous, 'REMUX_TS_DTS_BACKWARDS', 'TS decode timestamps run backwards or wrap inside the file.');
    if (stream.codec_type === 'audio' && previous !== null) need(dts - previous === 1920n,
      'REMUX_TS_DISCONTINUITY', 'TS audio timestamps contain a gap or discontinuity.');
    if (stream.codec_type === 'audio') need(pts * 48000n % 90000n === 0n && pts === dts,
      'REMUX_TS_AUDIO_CLOCK', 'TS audio must align exactly to the 48 kHz sample grid; MP4 rounding would change the A/V offset.');
    need(stream.time_base === '1/90000', 'REMUX_TS_TIME_BASE', 'The TS timestamp grid must be the native 90 kHz grid.');
    previous = dts; count++; return count;
  };
}

// Raw transport checks complement demuxed packet checks: a demuxer may repair
// continuity/wrap or discard a partial PES before reporting any access units.
function createTransportIntegrity188(streams, programs = null) {
  const selected = new Set(streams.map(s => Number(s.id))), clocks = new Map(), counters = new Map(), started = new Set();
  const audioPids = new Set(streams.filter(s => s.codec_type === 'audio').map(s => Number(s.id)));
  const tables = new Map();
  let pcrPid = null, lastPcr = null, pcrCount = 0;
  if (programs !== null) {
    const pid = Number(programs[0]?.pmt_pid);
    need(programs.length === 1 && Number.isInteger(pid) && pid >= 16 && pid < 8191 && !selected.has(pid),
      'REMUX_TS_PROGRAM', 'TS requires one known distinct program-map PID.');
    for (const [key, tableId] of [[0, 0], [pid, 2]]) tables.set(key, { tableId, data: Buffer.alloc(1024), used: 0, total: 0, hash: null });
    pcrPid = Number(programs[0]?.pcr_pid);
    need(Number.isInteger(pcrPid) && pcrPid >= 16 && pcrPid < 8191, 'REMUX_TS_PCR_PID', 'TS requires one known declared PCR PID.');
  }
  need(selected.size === streams.length && [...selected].every(n => Number.isInteger(n) && n >= 32 && n < 8191),
    'REMUX_TS_PID', 'Every admitted TS elementary stream needs a known distinct PID.');
  let tail = Buffer.alloc(0), count = 0,randomAccessCount=0;
  const access=new Map(),videoPids=new Set(streams.filter(s=>s.codec_type==='video').map(s=>Number(s.id)));
  function finishAccess(pid){const entry=access.get(pid);if(!entry)return;access.delete(pid);const data=Buffer.concat(entry.parts);
    if(entry.expected!==null)need(entry.bytes===entry.expected,'REMUX_TS_RANDOM_ACCESS','Random-access PES is incomplete.');
    if(videoPids.has(pid)){const picture=transportNals(data,'annexb').find(n=>(n[0]&31)>=1&&(n[0]&31)<=5);need(picture&&(picture[0]&31)===5,'REMUX_TS_RANDOM_ACCESS','Random-access indicator does not lead to an independent AVC IDR picture.');}
    else need(audioPids.has(pid)&&data.length>=7&&data[0]===255&&(data[1]&246)===240,'REMUX_TS_RANDOM_ACCESS','Random-access audio does not begin on an aligned ADTS frame.');
    randomAccessCount++;
  }
  function accessBytes(pid,data){const entry=access.get(pid);if(!entry)return;const take=entry.expected===null?data.length:Math.min(data.length,entry.expected-entry.bytes);need(entry.bytes+take<=MAX_PACKET,'REMUX_TS_RANDOM_ACCESS','Random-access PES exceeds its explicit complete-packet budget.');if(take){entry.parts.push(Buffer.from(data.subarray(0,take)));entry.bytes+=take;}if(entry.expected!==null&&entry.bytes===entry.expected)finishAccess(pid);}
  function section(table, data) {
    for (let at = 0; at < data.length;) {
      if (!table.used && data[at] === 255) { need(data.subarray(at).every(b => b === 255), 'REMUX_TS_PSI', 'Invalid TS program-table stuffing.'); return; }
      const take = Math.min((table.total || 3) - table.used, data.length - at);
      data.copy(table.data, table.used, at, at + take); at += take; table.used += take;
      if (table.used === 3 && !table.total) {
        table.total = 3 + ((table.data[1] & 15) << 8) + table.data[2];
        need(table.data[0] === table.tableId && (table.data[1] & 128) && table.total >= 12 && table.total <= 1024,
          'REMUX_TS_PSI', 'Malformed or excessive PAT/PMT section.');
      }
      if (table.total && table.used === table.total) {
        const bytes = table.data.subarray(0, table.total), hash = sha(bytes);
        need((bytes[5] & 1) && bytes[6] === 0 && bytes[7] === 0, 'REMUX_TS_PSI', 'Multi-section or future TS program tables are unsupported.');
        need(!table.hash || table.hash === hash, 'REMUX_TS_PROGRAM_CHANGED', 'The TS program map or program metadata changes inside the file.');
        if(table.tableId===2&&!table.hash)inspectTransportDescriptors(bytes,streams);
        table.hash = hash; table.used = 0; table.total = 0;
      }
    }
  }
  const timestamp = b => {
    need(b.length >= 5 && (b[0] & 1) && (b[2] & 1) && (b[4] & 1), 'REMUX_TS_PES', 'Malformed native PES timestamp.');
    return BigInt((b[0] >> 1) & 7) * 1073741824n + BigInt(b[1]) * 4194304n + BigInt(b[2] >> 1) * 32768n + BigInt(b[3]) * 128n + BigInt(b[4] >> 1);
  };
  return {
    push(chunk) {
      const bytes = tail.length ? Buffer.concat([tail, chunk]) : chunk; let at = 0;
      for (; at + 188 <= bytes.length; at += 188) {
        const b = bytes.subarray(at, at + 188); count++;
        need(b[0] === 71 && !(b[1] & 128) && !(b[3] & 192) && (b[3] & 48),
          'REMUX_TS_FRAMING', 'TS contains an invalid, encrypted or damaged 188-byte transport packet.');
        const pid = ((b[1] & 31) << 8) | b[2], mode = (b[3] >> 4) & 3, cc = b[3] & 15; let payload = 4,random=false;
        if (mode & 2) {
          const length = b[4]; payload = 5 + length;
          need(payload <= 188 && (mode !== 2 || payload === 188), 'REMUX_TS_FRAMING', 'Invalid TS adaptation field length.');
          need(!length || !(b[5] & 128), 'REMUX_TS_DISCONTINUITY', 'TS declares a transport discontinuity.');
          random=length>0&&!!(b[5]&64);
          if(random)need(selected.has(pid)&&(mode&1)&&!!(b[1]&64),'REMUX_TS_RANDOM_ACCESS','Random-access indicator has no aligned selected PES payload.');
          if (length && (b[5] & 16)) {
            need(length >= 7 && (b[10] & 126) === 126, 'REMUX_TS_PCR_INVALID', 'TS has a truncated PCR or invalid reserved PCR bits.');
            const base = BigInt(b[6]) * 33554432n + BigInt(b[7]) * 131072n + BigInt(b[8]) * 512n + BigInt(b[9]) * 2n + BigInt(b[10] >> 7);
            const extension = ((b[10] & 1) << 8) | b[11];
            need(extension < 300, 'REMUX_TS_PCR_INVALID', 'TS PCR extension must be less than 300.');
            if (pcrPid !== null) {
              need(pid === pcrPid, 'REMUX_TS_PCR_PID', 'PCR appeared on a PID other than the declared program PCR PID.');
              const clock = base * 300n + BigInt(extension);
              need(lastPcr === null || clock >= lastPcr, lastPcr !== null && lastPcr - clock > 4294967296n * 300n
                ? 'REMUX_TS_PCR_WRAP' : 'REMUX_TS_PCR_BACKWARDS', 'The TS PCR clock wraps or runs backwards.');
              need(lastPcr === null || clock - lastPcr <= PCR_GAP, 'REMUX_TS_PCR_DISCONTINUITY', 'TS PCR jumps by more than one second without a supported continuous clock.');
              if (lastPcr === null) for (const value of clocks.values()) need(value * 300n >= clock - PCR_PES_DISTANCE && value * 300n <= clock + PCR_PES_DISTANCE,
                'REMUX_TS_PCR_PES_MISMATCH', 'TS PES decode timestamps differ from PCR by more than ten seconds.');
              lastPcr = clock; pcrCount++;
            }
          }
        }
        if (pid === 8191 || !(mode & 1)) continue;
        if (counters.has(pid)) need(cc === ((counters.get(pid) + 1) & 15), 'REMUX_TS_CONTINUITY', 'TS packets are missing, duplicated or out of order.');
        counters.set(pid, cc);
        if (tables.has(pid)) {
          const table = tables.get(pid), data = b.subarray(payload);
          if (b[1] & 64) {
            need(data.length > 0 && data[0] + 1 <= data.length, 'REMUX_TS_PSI', 'Invalid TS program-table pointer.');
            if (table.used) section(table, data.subarray(1, 1 + data[0]));
            else need(data.subarray(1, 1 + data[0]).every(b => b === 255), 'REMUX_TS_PSI', 'TS begins inside a program-table section.');
            need(table.used === 0, 'REMUX_TS_PSI', 'A TS program-table section was truncated.');
            section(table, data.subarray(1 + data[0]));
          } else { need(table.used > 0, 'REMUX_TS_PSI', 'TS begins inside a program-table section.'); section(table, data); }
        }
        if (!selected.has(pid)) continue;
        const start = !!(b[1] & 64);
        need(started.has(pid) || start, 'REMUX_TS_PARTIAL_HEAD', 'The TS cut begins inside an elementary-stream PES packet.');
        const first = !started.has(pid); started.add(pid);
        if (start) {
          finishAccess(pid);
          const p = b.subarray(payload);
          need(p.length >= 14 && p[0] === 0 && p[1] === 0 && p[2] === 1 && (p[6] & 192) === 128
            && (p[7] & 192) >= 128 && p[8] >= ((p[7] & 64) ? 10 : 5) && 9 + p[8] <= p.length,
          'REMUX_TS_PES', 'A TS PES header is missing timestamps, split or malformed.');
          need(!(p[6]&48),'REMUX_TS_PES_ENCRYPTED','PES-level scrambling has no admitted clear packet interpretation.');
          need(!(p[7]&8),'REMUX_TS_PES_TRICK_MODE','PES trick-mode seeking controls have no verified MP4 mapping.');
          need(!(p[7]&63),'REMUX_TS_PES_OPTIONAL','Optional ESCR/rate/copy/CRC/extension controls have no proved native target mapping.');
          const headerBytes=p[7]&64?10:5;
          need((p[9]>>4)===(p[7]&64?3:2)&&(!(p[7]&64)||(p[14]>>4)===1)&&p.subarray(9+headerBytes,9+p[8]).every(v=>v===255),'REMUX_TS_PES','PES timestamp prefixes or header stuffing are not the declared native form.');
          const pts = timestamp(p.subarray(9)), dts = p[7] & 64 ? timestamp(p.subarray(14)) : pts;
          if (lastPcr !== null) need(dts * 300n >= lastPcr - PCR_PES_DISTANCE && dts * 300n <= lastPcr + PCR_PES_DISTANCE,
            'REMUX_TS_PCR_PES_MISMATCH', 'TS PES decode timestamps differ from PCR by more than ten seconds.');
          if (first && audioPids.has(pid)) {
            const audio = p.subarray(9 + p[8]);
            need(audio.length >= 7 && audio[0] === 255 && (audio[1] & 246) === 240,
              'REMUX_TS_PARTIAL_AUDIO_HEAD', 'The first TS audio PES begins inside an ADTS frame; no head samples may be dropped.');
          }
          const previous = clocks.get(pid);
          need(previous === undefined || dts >= previous, previous !== undefined && previous - dts > 4294967296n
            ? 'REMUX_TS_TIMESTAMP_WRAP' : 'REMUX_TS_DTS_BACKWARDS', 'Native TS decode timestamps wrap or run backwards.');
          clocks.set(pid, dts);
          if(random){const length=p.readUInt16BE(4);need(!length||length>=3+p[8],'REMUX_TS_RANDOM_ACCESS','Random-access PES length is invalid.');access.set(pid,{parts:[],bytes:0,expected:length?length-3-p[8]:null});accessBytes(pid,p.subarray(9+p[8]));}
        }else accessBytes(pid,b.subarray(payload));
      }
      tail = Buffer.from(bytes.subarray(at));
    },
    finish() {
      for(const pid of [...access.keys()])finishAccess(pid);
      need(count > 0 && tail.length === 0 && started.size === selected.size, 'REMUX_TS_FRAMING', 'TS is truncated or lacks an admitted elementary stream.');
      need([...tables.values()].every(t => t.hash && t.used === 0), 'REMUX_TS_PSI', 'TS lacks complete stable PAT/PMT program tables.');
      need(pcrPid === null || pcrCount > 0, 'REMUX_TS_PCR_MISSING', 'No PCR was found on the declared program PCR PID.');
      return { packets: count, pcrCount,randomAccessCount };
    },
  };
}
function transportFraming(bytes,final=false){const candidates=[];for(const size of [188,192,204]){const offset=size===192?4:0;if(final&&bytes.length%size)continue;const n=Math.floor(bytes.length/size);if(n<(final?1:3))continue;let good=true;for(let i=0;i<Math.min(n,3);i++)if(bytes[offset+i*size]!==71)good=false;if(good)candidates.push({size,offset});}return candidates.length===1?candidates[0]:null;}
function createTransportIntegrity(streams,programs=null,{packetSize=programs===null?188:null}={}){
  need(packetSize===null||[188,192,204].includes(packetSize),'REMUX_TS_FRAMING','Unknown native transport packet framing.');const core=createTransportIntegrity188(streams,programs);let framing=packetSize?{size:packetSize,offset:packetSize===192?4:0}:null,tail=Buffer.alloc(0);
  function drain(final=false){if(!framing){if(!final&&tail.length<612)return;framing=transportFraming(tail,final);need(framing,'REMUX_TS_FRAMING','Transport framing is truncated, ambiguous or unclassified.');}
    need(framing.size!==192,'REMUX_TS_M2TS_ARRIVAL_CONTROL','M2TS copy/arrival timestamp controls have no verified native target mapping.');
    need(framing.size!==204,'REMUX_TS_RS204_PARITY','RS204 outer error-correction parity has no verified native interpretation.');
    // The core still walks every packet in order. Pass each chunk's complete
    // packet prefix once and retain only the unprocessed bytes.
    const complete = tail.length - tail.length % 188;
    if (complete) core.push(tail.subarray(0, complete));
    tail = Buffer.from(tail.subarray(complete));
  }
  return{push(chunk){need(Buffer.isBuffer(chunk),'REMUX_TS_FRAMING','Transport input must be bytes.');tail=tail.length?Buffer.concat([tail,chunk]):chunk;drain();},finish(){drain(true);need(!tail.length,'REMUX_TS_FRAMING','Native transport wrapper is truncated.');return{...core.finish(),packetSize:framing.size};}};
}
async function inspectTransportHead(file, signal) {
  const fs = require('node:fs/promises'), handle = await fs.open(file, 'r'), buffer = Buffer.alloc(188 * 512);
  try {
    need(!signal?.aborted, 'CANCELLED', 'Transport head inspection cancelled.');
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    // This bounded sniff only recognizes 188-byte TS. Unknown framing goes to
    // the normal inspector, which remains authoritative for format/codec.
    if (bytesRead < 376 || buffer[0] !== 71 || buffer[188] !== 71) return;
    for (let at = 0; at + 188 <= bytesRead; at += 188) {
      const b = buffer.subarray(at, at + 188); if (b[0] !== 71 || !(b[1] & 64) || !(b[3] & 16)) continue;
      const offset = b[3] & 32 ? 5 + b[4] : 4, p = b.subarray(Math.min(offset, 188));
      if (p.length < 10 || p[0] || p[1] || p[2] !== 1 || p[3] < 224 || p[3] > 239) continue;
      const data = p.subarray(Math.min(9 + p[8], p.length));
      for (let i = 0; i + 3 < data.length; i++) if (!data[i] && !data[i + 1] && data[i + 2] === 1) {
        const type = data[i + 3] & 31;
        if (type === 1) need(false, 'REMUX_TS_HEAD_NOT_KEYFRAME', 'The TS begins with a non-IDR picture; cut-mid-GOP inputs are unsupported.');
        if (type === 5) return;
      }
      return;
    }
  } finally { await handle.close(); }
}
module.exports = { transportSourceReasons, dumpBytes, transportNals, canonicalTransportVideo, canonicalTransportAudio, transportClock, createTransportIntegrity, inspectTransportHead, inspectTransportDescriptors };
