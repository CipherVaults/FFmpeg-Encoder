'use strict';

// Main-only Prepare diagnosis. Neither probe values nor this result can grant
// a writer; the independent caller owns executable, fd and file currentness.
const { TextDecoder } = require('node:util');
const { ToolError } = require('../src/process-runner.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const { parseProbeJson } = require('../src/inspection.cjs');
const BAD = 'REMUX_MP3_METADATA_UNPROVED';
const LIMIT = 128 * 1024;
const plain = o => o !== null && typeof o === 'object'
  && [Object.prototype, null].includes(Object.getPrototypeOf(o));
const positive = /^[1-9][0-9]{0,15}$/;
function need(test, code, message) { if (!test) throw new ToolError(code, message); }
const bounded = ok => need(ok,BAD,'Standalone MP3 needs bounded, unambiguous media metadata.');
function validText(s) {
  return typeof s === 'string' && s.length <= 16384 && !/[\0\uFFFD]/u.test(s) && Buffer.from(s).toString('utf8') === s;
}
// Reject accessors, prototype-bearing objects, sparse arrays, cycles and
// packet/frame dumps before the consumer looks at any media properties.
function inert(value) {
  let chars = 0, nodes = 0;
  const ancestors = new Set();
  const string = s => { bounded(validText(s)); chars += Buffer.byteLength(s); bounded(chars <= LIMIT); return s; };
  function copy(v,depth) {
    bounded(++nodes <= 2048 && depth <= 8);
    if (typeof v === 'string') return string(v);
    if (v === null || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v)) return v;
    const array = Array.isArray(v);
    bounded((array || plain(v)) && !ancestors.has(v));
    ancestors.add(v);
    const out = array ? [] : Object.create(null), keys = Reflect.ownKeys(v);
    if(array) bounded(keys.length <= 65 && keys.length === v.length + 1);
    else bounded(keys.length <= 128);
    let position = 0;
    for (const k of keys) {
      if (array && k === 'length') continue;
      bounded(typeof k === 'string' && k.length <= 128 && (!array || k === String(position++)));
      string(k);
      const d = Object.getOwnPropertyDescriptor(v,k);
      bounded(d?.enumerable && Object.hasOwn(d,'value'));
      Object.defineProperty(out,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});
    }
    ancestors.delete(v);return out;
  }
  return copy(value,0);
}
function parseStandaloneMp3Probe(stdout) {
  let s = stdout;
  if (Buffer.isBuffer(stdout)) {
    bounded(stdout.length <= LIMIT);
    try { s = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(stdout); }
    catch { bounded(false); }
  }
  bounded(typeof s === 'string' && s.length <= LIMIT && Buffer.byteLength(s) <= LIMIT
    && !/[\0\uFFFD]/u.test(s) && Buffer.from(s).toString('utf8')===s);
  // Same duplicate and reserved-tag handling as normal media inspection.
  return parseProbeJson(s,'Standalone MP3 inspection');
}
function tagCount(value) {
  if (value === undefined) return 0;
  bounded(plain(value) && Object.keys(value).length <= 64 && Object.values(value).every(v=>typeof v==='string'));
  return Object.keys(value).length;
}
function inspectStandaloneMp3Probe(rawProbe, physicalFacts) {
  bounded(plain(rawProbe));
  const keys = Reflect.ownKeys(rawProbe);
  bounded(keys.length===5 && ['streams','format','chapters','programs','stream_groups'].every(k=>Object.hasOwn(rawProbe,k)));
  const p = inert(rawProbe), f = p.format;
  bounded(plain(f) && ['streams','chapters','programs','stream_groups'].every(k=>Array.isArray(p[k]))
    && [...p.streams,...p.chapters,...p.programs,...p.stream_groups].every(plain));
  need(f.format_name==='mp3','REMUX_MP3_WRONG_FAMILY','This file was not identified as a standalone MP3 container.');
  const containers = tagCount(f.tags);
  const trackTags = p.streams.reduce((n,s)=>n+tagCount(s.tags),0);
  for (const c of p.chapters) tagCount(c.tags);
  const provenance=classifyMarker(p);
  need(provenance.kind!=='generated','REMUX_MP3_GENERATED','This source has a recognized application-generated marker. MP3 copy was not prepared.');
  need(provenance.kind==='unmarked','REMUX_MP3_PROVENANCE_UNPROVED','This source has suspicious application metadata. MP3 copy was not prepared.');
  need(!p.streams.some(s=>s.disposition?.attached_pic===1),'REMUX_MP3_COVER_UNQUALIFIED','Standalone MP3 with attached artwork is not covered by this inspection.');
  need(p.streams.length===1 && p.chapters.length===0 && p.programs.length===0 && p.stream_groups.length===0
    && f.nb_streams===1 && f.nb_programs===0 && f.nb_stream_groups===0,
    'REMUX_MP3_STRUCTURE_UNQUALIFIED','Only a single MP3 audio stream, without chapters, programs or additional streams, is covered.');
  const s=p.streams[0];
  need(s.index===0 && s.codec_type==='audio' && s.codec_name==='mp3',
    'REMUX_MP3_WRONG_FAMILY','The sole stream was not identified as MP3 audio.');
  need(containers===0 && trackTags===0,'REMUX_MP3_TAGS_UNQUALIFIED','Standalone MP3 tags are not covered by this inspection. No tag text was retained.');
  const gapless = (v)=>v!==undefined && v!==0;
  need(!gapless(s.initial_padding) && !gapless(s.trailing_padding) && !gapless(s.seek_preroll)
    && (!Object.hasOwn(s,'side_data_list') || Array.isArray(s.side_data_list)&&s.side_data_list.length===0),
    'REMUX_MP3_GAPLESS_UNQUALIFIED','MP3 padding, gapless or other stream side data is not covered.');
  need(plain(s.disposition) && Object.values(s.disposition).every(v=>v===0),
    'REMUX_MP3_STRUCTURE_UNQUALIFIED','Special MP3 track dispositions are not covered.');
  const rate=typeof s.sample_rate==='string'?Number(s.sample_rate):0, ch=s.channels;
  const clock=typeof s.time_base==='string' && /^1\/([1-9]\d{0,8})$/.exec(s.time_base);
  need(typeof s.sample_rate==='string' && ['32000','44100','48000'].includes(s.sample_rate)
    && [1,2].includes(ch) && s.channel_layout===(ch===1?'mono':'stereo') && clock && Number(clock[1])%rate===0
    && s.start_pts===0 && s.start_time==='0.000000' && f.start_time==='0.000000',
    'REMUX_MP3_CLOCK_UNQUALIFIED','The MP3 sample rate, channel layout or zero-start sample clock is not established.');
  bounded(typeof f.size==='string' && positive.test(f.size) && Number.isSafeInteger(Number(f.size)));
  return comparePhysical(physicalFacts,{rate,ch,bytes:Number(f.size),clock:Number(clock[1]),containers,trackTags});
}
function comparePhysical(raw,{rate,ch,bytes,clock,containers,trackTags}) {
  const failure=ok=>need(ok,'REMUX_MP3_PREFIX_UNPROVED','A matching bounded MPEG-1 Layer III source prefix was not established.');
  failure(plain(raw));
  const fields=['method','rate','channels','frames','contiguousPrefixBytes','fileBytes','reachesEof','completePayloadVerified','metadataAbsenceVerified'];
  failure(Reflect.ownKeys(raw).length===fields.length && fields.every(k=>{
    const d=Object.getOwnPropertyDescriptor(raw,k);return d?.enumerable && Object.hasOwn(d,'value');
  }));
  const p=raw;
  failure(p.method==='mp3-mpeg1-layer3-prefix-headers-v1' && p.rate===rate && p.channels===ch
    && p.fileBytes===bytes && Number.isSafeInteger(p.frames) && p.frames>=2 && p.frames<=4096
    && Number.isSafeInteger(p.contiguousPrefixBytes) && p.contiguousPrefixBytes>=p.frames*4
    && p.contiguousPrefixBytes<=bytes && typeof p.reachesEof==='boolean'
    && p.reachesEof===(p.contiguousPrefixBytes===bytes) && p.completePayloadVerified===false && p.metadataAbsenceVerified===false);
  return Object.freeze({kind:'standalone-mp3',executionReady:false,rate,channels:ch,layout:ch===1?'mono':'stereo',
    sampleClockDenominator:clock,streamCount:1,containerTagCount:containers,streamTagCount:trackTags,
    inspectedPrefixFrames:p.frames,reachesEof:p.reachesEof,completePayloadVerified:false,metadataAbsenceVerified:false,
    reasonCode:'REMUX_MP3_QUALIFICATION_REQUIRED',
    reason:'Standalone MP3 audio was identified. Verified MP3 copy into MP4 is not available here. No copy or conversion was started.'});
}
module.exports={parseStandaloneMp3Probe,inspectStandaloneMp3Probe};
