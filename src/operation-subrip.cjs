'use strict';

// Q06/Q2m component only. Inspect one explicitly selected S_TEXT/UTF8 track
// of a small immutable Matroska snapshot. This is not source admission, a
// workbench route, a rendered-text oracle or authority to omit other streams.
const { createHash } = require('node:crypto');
const { walkMatroskaMetadata } = require('./remux-ebml-reader.cjs');
const { MATROSKA_SCHEMA } = require('./remux-native-inventory.cjs');

const LIMITS = Object.freeze({ sourceBytes: 4 * 1024 * 1024, elements: 65536, metadata: 16384,
  packets: 32768, tracks: 32, cues: 4096, cueBytes: 16384, textBytes: 512 * 1024 });
const observations = new WeakSet();
const fail = (code,message) => { throw Object.assign(new Error(message),{code:'SUBRIP_'+code}); };
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};
const utf8 = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
function decode(bytes,code) {
  try { return utf8.decode(bytes); } catch { fail(code,'Invalid UTF-8 in subtitle evidence.'); }
}
// XML 1.0 NameStartChar / NameChar (W3C 2.3) include colon, non-Latin
// letters, and supplementary code points. Only match tag-shaped tokens,
// not spaced comparison prose. This does not parse or interpret XML.
const xmlNameStart = String.raw`:A-Z_a-z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u02ff\u0370-\u037d\u037f-\u1fff\u200c-\u200d\u2070-\u218f\u2c00-\u2fef\u3001-\ud7ff\uf900-\ufdcf\ufdf0-\ufffd\u{10000}-\u{effff}`;
const xmlName = `[${xmlNameStart}][${xmlNameStart}0-9.\\-\\u00b7\\u0300-\\u036f\\u203f-\\u2040]*`;
const xmlWs = String.raw`[\t\r\n ]`;
const xmlTag = new RegExp(`<${xmlName}(?:${xmlWs}+${xmlName}${xmlWs}*=${xmlWs}*(?:"[^"<]*"|'[^'<]*'))*${xmlWs}*/?>`,'u');
function cueText(bytes) {
  const text = decode(bytes,'TEXT_UNSUPPORTED');
  // Preserve ordinary comparison signs, ampersands, multilingual prose and
  // CRLF/LF exactly. No HTML/entity, ASS override, MicroDVD styling, blank
  // separator line or position-control interpretation is established here.
  if (!text.trim() || /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\ufeff]/u.test(text)
      || /\r(?!\n)|(?:^|\n)[ \t]*(?:\r?\n|$)/u.test(text)
      || xmlTag.test(text) || /<\s*[/!?A-Za-z_][^<>]*>|<\/?\d+[^<>]*>|\{\s*(?:\\|[A-Za-z]:)|\\[Nnh]|&(?:#[xX]?\w+|[A-Za-z]\w*);/u.test(text)) {
    fail('TEXT_UNSUPPORTED','A subtitle cue is not in the verified plain-text envelope.');
  }
  return text;
}
const clusterNames = new Set(['Cluster','Timestamp','Position','PrevSize','SimpleBlock','BlockGroup','Block','BlockDuration','ReferenceBlock']);
const unsupportedCluster = new Set(MATROSKA_SCHEMA.filter(e=>e.path.includes('\\Cluster') && !clusterNames.has(e.name)).map(e=>e.id));
const trackFields = new Set(['CRC-32','Void','TrackNumber','TrackUID','TrackType','CodecID','Name','Language','LanguageBCP47',
  'FlagEnabled','FlagDefault','FlagForced','FlagOriginal','FlagHearingImpaired','FlagVisualImpaired','FlagTextDescriptions',
  'FlagCommentary','FlagLacing','MaxBlockAdditionID']);
const infoFields = new Set(['CRC-32','Void','TimestampScale','MuxingApp','WritingApp','SegmentUUID','Duration','DateUTC','Title']);

// The caller must obtain expectedSha256 from its own held-source/selection
// boundary. A matching self-supplied hash is content consistency, not proof
// of pathname identity, provenance, cancellation, or playback readiness.
// Primitive canonical base64 avoids mutable buffers/getters across awaits.
async function observeSubRip(snapshotBase64,expectedSha256,trackNumber) {
  if (typeof snapshotBase64 !== 'string' || !snapshotBase64.length) fail('SNAPSHOT_INVALID','Expected immutable base64 source bytes.');
  if (snapshotBase64.length > 4*Math.ceil(LIMITS.sourceBytes/3)) fail('LIMIT','Source exceeds the bounded component snapshot.');
  const file = Buffer.from(snapshotBase64,'base64');
  if (file.length > LIMITS.sourceBytes) fail('LIMIT','Source exceeds the bounded component snapshot.');
  if (file.toString('base64') !== snapshotBase64) fail('SNAPSHOT_INVALID','Subtitle snapshot is not canonical base64.');
  const sourceSha256 = createHash('sha256').update(file).digest('hex');
  if (sourceSha256 !== expectedSha256) fail('SOURCE_CHANGED','Subtitle source does not match the expected byte identity.');
  if (typeof trackNumber !== 'string' || !/^[1-9]\d{0,19}$/.test(trackNumber)) fail('TRACK_INVALID','Expected an exact native Matroska track number.');

  const roots = [], nodes = [], seen = new Set();
  let nElements=0, blockGroups=0, blocks=0, simple=0;
  const walk = await walkMatroskaMetadata({
    end:file.length, maxRecords:LIMITS.packets, seekRecords:true, stop(){},
    read(at,n) { return file.subarray(at,at+n); },
    add(type,body,end,path,parent) {
      if (nodes.length>=LIMITS.metadata) fail('LIMIT','Too many Matroska metadata elements.');
      const node={type,body,end,path,parent,children:[]}; nodes.push(node); (parent?parent.children:roots).push(node); return node;
    },
    seenTypes:{add(type) {
      if (++nElements>LIMITS.elements) fail('LIMIT','Too many Matroska elements in the complete source.');
      seen.add(type); if(type==='0xa0') blockGroups++; else if(type==='0xa1') blocks++; else if(type==='0xa3') simple++;
    }},
  });
  function one(parent,name,code,required=false) {
    const found=parent.children.filter(n=>n.name===name);
    if (found.length>1 || (required&&!found.length)) fail(code,'A required or unique '+name+' field is missing or ambiguous.');
    return found[0];
  }
  function number(node,code) {
    const size=node.end-node.body;
    if (size<1 || size>8) fail(code,'Invalid native integer width.');
    return BigInt('0x'+file.toString('hex',node.body,node.end));
  }
  function label(node,code,max) {
    if (node.end-node.body>max) fail('LIMIT','Subtitle metadata exceeds the bounded text limit.');
    return decode(file.subarray(node.body,node.end),code);
  }
  const doc={children:roots}, header=one(doc,'EBML','CONTAINER_UNSUPPORTED',true), segment=one(doc,'Segment','CONTAINER_UNSUPPORTED',true);
  if (roots.indexOf(header)>roots.indexOf(segment) || label(one(header,'DocType','CONTAINER_UNSUPPORTED',true),'CONTAINER_UNSUPPORTED',32)!=='matroska')
    fail('CONTAINER_UNSUPPORTED','Only native Matroska subtitle packets are observed.');
  for (const [key,maximum] of [['EBMLReadVersion',1n],['DocTypeReadVersion',4n],['EBMLMaxIDLength',4n],['EBMLMaxSizeLength',8n]]) {
    const f=one(header,key,'CONTAINER_UNSUPPORTED');if(f){const x=number(f,'CONTAINER_UNSUPPORTED');if(x<1n||x>maximum)fail('CONTAINER_UNSUPPORTED','Unsupported Matroska reader declaration.');}
  }
  if (header.children.some(n=>!['CRC-32','Void','EBMLVersion','EBMLReadVersion','EBMLMaxIDLength','EBMLMaxSizeLength','DocType','DocTypeVersion','DocTypeReadVersion'].includes(n.name))
      || segment.children.some(n=>!['CRC-32','Void','Info','Tracks','SeekHead','Cues','Tags','Cluster','Attachments'].includes(n.name)))
    fail('TIMELINE_UNSUPPORTED','Linked, chapter-driven or extended presentation has no verified subtitle clock here.');
  const info=one(segment,'Info','CLOCK_INVALID',true);
  if (info.children.some(n=>!infoFields.has(n.name))) fail('TIMELINE_UNSUPPORTED','Non-local segment controls are unverified.');
  const scaleNode=one(info,'TimestampScale','CLOCK_INVALID'), scale=scaleNode?number(scaleNode,'CLOCK_INVALID'):1000000n;
  if (!scale || segment.children.some(n=>n.name==='Cluster'&&n.blocksSeen&&n.timestamp===undefined)) fail('CLOCK_INVALID','Native packet clock is missing or zero.');
  if (blockGroups!==blocks || (blocks+simple)!==walk.packets.length || [...seen].some(t=>unsupportedCluster.has(t)))
    fail('PACKET_UNSUPPORTED','Block grouping or supplemental packet presentation cannot be applied safely.');

  const entries=one(segment,'Tracks','TRACK_INVALID',true).children.filter(n=>n.name==='TrackEntry');
  if (entries.length>LIMITS.tracks) fail('LIMIT','Too many tracks in the bounded observation.');
  const numbers=new Set(), uids=new Set(); let entry,uid;
  for (const t of entries) {
    const n=number(one(t,'TrackNumber','TRACK_INVALID',true),'TRACK_INVALID').toString();
    const id=number(one(t,'TrackUID','TRACK_INVALID',true),'TRACK_INVALID').toString();
    if(n==='0'||id==='0'||numbers.has(n)||uids.has(id)) fail('TRACK_INVALID','Native track identity is ambiguous.');
    numbers.add(n);uids.add(id); if(n===trackNumber){entry=t;uid=id;}
  }
  if (!entry || walk.blockTrackIds.some(n=>!numbers.has(n))) fail('TRACK_INVALID','A native track reference does not resolve.');
  if (number(one(entry,'TrackType','TRACK_INVALID',true),'TRACK_INVALID')!==17n
      || label(one(entry,'CodecID','TRACK_INVALID',true),'TRACK_INVALID',64)!=='S_TEXT/UTF8')
    fail('CODEC_UNSUPPORTED','Only plain SubRip is observed; styled ASS/SSA, bitmap and other codecs are not transformed.');
  if (entry.children.some(n=>!trackFields.has(n.name))) fail('TRACK_CONTROL','Unverified subtitle codec, timing or track controls.');
  function scalar(name,fallback) {const n=one(entry,name,'TRACK_CONTROL');return n?number(n,'TRACK_CONTROL'):fallback;}
  function flag(name,defaultValue) {
    const value=scalar(name,BigInt(defaultValue)); if(value!==0n&&value!==1n)fail('TRACK_CONTROL','Invalid subtitle disposition.');return value===1n;
  }
  if (!flag('FlagEnabled',1) || scalar('MaxBlockAdditionID',0n)!==0n) fail('TRACK_CONTROL','Disabled or supplemental subtitle presentations are unverified.');
  flag('FlagLacing',1); // capability alone is not an actually laced packet.
  function trackText(key,max,fallback) {const n=one(entry,key,'TRACK_CONTROL');return n?label(n,'TRACK_CONTROL',max):fallback;}
  const language=trackText('Language',64,'eng'), languageBCP47=trackText('LanguageBCP47',128,null), name=trackText('Name',512,null);
  if (!/^[a-z]{3}$/.test(language) || (languageBCP47!==null && !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(languageBCP47))
      || (name!==null && /[\u0000-\u001f\u007f]/u.test(name))) fail('TRACK_CONTROL','Unsupported track language or name.');
  if (languageBCP47!==null) {
    try { Intl.getCanonicalLocales(languageBCP47); } catch { fail('TRACK_CONTROL','Malformed or unsupported BCP 47 subtitle language.'); }
  }
  // BCP 47 takes precedence over the legacy field; do not normalize either.
  const track={number:trackNumber,uid,codec:'S_TEXT/UTF8',language,languageBCP47,effectiveLanguage:languageBCP47??language,name,default:flag('FlagDefault',1),forced:flag('FlagForced',0),
    original:flag('FlagOriginal',0),hearingImpaired:flag('FlagHearingImpaired',0),visualImpaired:flag('FlagVisualImpaired',0),
    descriptions:flag('FlagTextDescriptions',0),commentary:flag('FlagCommentary',0)};
  const cues=[];let bytes=0,previous=null;
  for(const p of walk.packets){
    if(p.trackId!==trackNumber)continue;
    const length=p.end-p.body;
    if(cues.length>=LIMITS.cues || length>LIMITS.cueBytes || (bytes+=length)>LIMITS.textBytes) fail('LIMIT','Complete subtitle evidence exceeds its bounded budget.');
    if(p.lacing || !p.key || p.discardable || p.duration===null || BigInt(p.duration)<=0n) fail('PACKET_UNSUPPORTED','Each cue requires its own plain block and exact positive duration.');
    const start=BigInt(p.pts);if(previous!==null&&start<previous)fail('ORDER_UNSUPPORTED','Subtitle cues must already be in presentation order.');
    previous=start; cues.push({ordinal:p.ordinal,startTicks:p.pts,endTicks:String(start+BigInt(p.duration)),text:cueText(file.subarray(p.body,p.end))});
  }
  const result=freeze({sourceSha256,track,timestampScaleNs:String(scale),cues}); observations.add(result); return result;
}

// Accept only this module's fully inspected observations, never caller-built
// cue arrays. Rational seconds on the native Segment clock, not display time.
// Output has millisecond ticks (the SubRip time grid); refuse any surviving
// rebased edge not exactly representable, instead of silently rounding.
function clipSubRip(observation,currentSourceSha256,startSeconds,endSeconds) {
  if (!observations.has(observation)) fail('OBSERVATION_INVALID','Expected an original bounded subtitle observation.');
  if (currentSourceSha256!==observation.sourceSha256) fail('SOURCE_CHANGED','The held source no longer matches the subtitle observation.');
  function rational(s) {
    if(typeof s!=='string'||s.length>82||!/^(-?\d{1,40})\/([1-9]\d{0,39})$/.test(s)) fail('RANGE_INVALID','Expected bounded exact numerator/denominator seconds.');
    const [n,d]=s.split('/').map(BigInt);return {n,d};
  }
  const cmp=(a,b)=>a.n*b.d-b.n*a.d, start=rational(startSeconds), end=rational(endSeconds);
  if(cmp(end,start)<=0n)fail('RANGE_INVALID','Expected a nonempty start-inclusive/end-exclusive interval.');
  const scale=BigInt(observation.timestampScaleNs), time=t=>({n:BigInt(t)*scale,d:1000000000n});
  function outputMs(t) {
    const n=cmp(t,start)*1000n,d=t.d*start.d;
    if(n%d)fail('BOUNDARY_INEXACT','A surviving subtitle boundary is not exactly representable in output milliseconds.');
    return String(n/d);
  }
  const cues=[],clipped=[],omitted=[];
  for(const c of observation.cues){
    const s=time(c.startTicks),e=time(c.endTicks);
    if(cmp(e,start)<=0n || cmp(s,end)>=0n){omitted.push(c.ordinal);continue;}
    const left=cmp(s,start)<0n,right=cmp(e,end)>0n;
    if(left||right)clipped.push({ordinal:c.ordinal,start:left,end:right});
    cues.push({ordinal:c.ordinal,startMs:outputMs(left?start:s),endMs:outputMs(right?end:e),text:c.text});
  }
  return freeze({sourceSha256:observation.sourceSha256,track:observation.track,timeBase:'1/1000',cues,clipped,omitted});
}
module.exports={observeSubRip,clipSubRip,cueText,LIMITS};
