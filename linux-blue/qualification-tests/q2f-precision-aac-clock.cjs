'use strict';

// Offline clock arithmetic for the bounded Q2f native calibration. Pure
// observations are never evidence/selection authority or a production route.
// One zero-origin PCM source, one native AAC-LC stream, 1ms Matroska ticks,
// no source gaps or signalled discard. Does not test signal quality or playback.
const { isProxy } = require('node:util').types;
const ACCESS_UNIT = 1024n, US = 1_000_000n, MS = 1_000n, NS = 1_000_000_000n;
const fields = ['rate','layout','channels','bitrate','startUs','endUs','sourceFrames','first','end','origin',
  'scaleNs','durationTicks','codecDelayNs','discardPaddingNs','videoEndTick','ffprobeInitialPadding',
  'fullDecodedSamples','packets','frames'];
const need = (ok, message) => { if (!ok) throw Object.assign(new Error(message), { code:'Q2F_AAC_CLOCK' }); };
function record(value, keys) {
  need(value && !isProxy(value) && Object.getPrototypeOf(value) === Object.prototype && Reflect.ownKeys(value).length === keys.length,
    'Expected exact plain observation fields.');
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(value,k);
    need(d && d.enumerable && Object.hasOwn(d,'value'),'Observation fields must be enumerable data.');
  }
  return value;
}
function integer(v,min,max) {
  need(Number.isSafeInteger(v) && v>=min && v<=max,'Expected bounded exact native integer.');
  return BigInt(v);
}
function rows(value,max) {
  need(!isProxy(value) && Array.isArray(value) && Object.getPrototypeOf(value)===Array.prototype
    && value.length>0 && value.length<=max && Reflect.ownKeys(value).length===value.length+1,'Expected bounded complete observations.');
  for (let i=0;i<value.length;i++) {
    const d=Object.getOwnPropertyDescriptor(value,i);
    need(d && d.enumerable && Object.hasOwn(d,'value'),'Sparse or accessor observation.');
  }
  return value;
}
const abs = n=>n<0n?-n:n;
const nearest = (n,d)=>(n<0n?-1n:1n)*((abs(n)*2n+d)/(2n*d));
const ceiling = (n,d)=>(n+d-1n)/d;
const secondsLimit = 170; // Evidence-array bound for this offline evaluator, not a product policy.

function assessPrecisionAacClock(input) {
  const x=record(input,fields);
  const rate=integer(x.rate,44100,48000);
  need((rate===44100n && x.layout==='stereo' && x.channels===2 && x.bitrate===320) ||
    (rate===48000n && x.layout==='mono' && x.channels===1 && x.bitrate===128),
    'Only the two measured layout-default AAC tuples apply.');
  const extent=integer(x.sourceFrames,1,secondsLimit*48000), lo=integer(x.startUs,0,secondsLimit*1e6);
  const hi=integer(x.endUs,1,secondsLimit*1e6), first=ceiling(lo*rate,US), end=ceiling(hi*rate,US);
  const origin=nearest(lo*rate,US);
  need(lo<hi && first<end && end<=extent && hi*rate<=extent*US &&
    x.first===Number(first) && x.end===Number(end) && x.origin===Number(origin),
    'Selection is not exact half-open sample membership on the measured source clock.');
  const phase=first-origin, selected=end-first;
  need(x.scaleNs===1_000_000 && x.codecDelayNs===Number(nearest(ACCESS_UNIT*NS,rate)) &&
    x.ffprobeInitialPadding===Number(ACCESS_UNIT) && x.discardPaddingNs===null,
    'CodecDelay, observed decoder skip, Matroska tick or physical discard do not match the measured representation.');
  const videoEnd=integer(x.videoEndTick,1,(secondsLimit+1)*1000);
  const stored=integer(x.durationTicks,1,(secondsLimit+1)*1000);
  const packets=rows(x.packets,8192), frames=rows(x.frames,8191);
  const expectedFrames=ceiling(selected,ACCESS_UNIT), decoded=expectedFrames*ACCESS_UNIT, tail=decoded-selected;
  need(BigInt(frames.length)===expectedFrames && packets.length===frames.length+1 &&
    x.fullDecodedSamples===Number(decoded),'Missing/excess coded units or independently decoded samples.');
  let codedEnd;
  for (let i=0;i<packets.length;i++) {
    const p=record(packets[i],['pts','duration','padding']);
    const sample=phase+(BigInt(i)-1n)*ACCESS_UNIT, tick=nearest(sample*MS,rate);
    need(p.pts===Number(tick),'Packet PTS leaves the measured sample grid.');
    const length=integer(p.duration,1,24);
    if(i<packets.length-1) need(length===ACCESS_UNIT*MS/rate,'Unexpected nonterminal coded duration.');
    if(i===0) {
      const p0=record(p.padding,['skipSamples','discardPadding']);
      need(tick<0n && p0.skipSamples===Number(ACCESS_UNIT) && p0.discardPadding===0,
        'First negative AAC PTS requires one fully signalled priming unit.');
    } else {
      need(p.padding===null,'Unexpected additional AAC skip or discard evidence.');
      const f=record(frames[i-1],['pts','samples']);
      need(f.pts===p.pts && f.samples===Number(ACCESS_UNIT),'Decoded sample grid is not the post-skip packet grid.');
    }
    codedEnd=tick+length;
  }
  // A coded terminal duration can shorten only the packet timestamp extent;
  // a full decode may still expose the nonnegative unsignalled coding tail.
  const decodedEnd = BigInt(frames.at(-1).pts)*rate + ACCESS_UNIT*MS;
  need(abs(codedEnd*rate-(phase+selected)*MS)<=rate &&
    abs(codedEnd*rate-(decodedEnd-tail*MS))<=rate,
    'Coded endpoint disagrees with exact selected and independently decoded-minus-tail clocks.');
  const storedAudio=codedEnd*rate+ACCESS_UNIT*MS, storedVideo=videoEnd*rate;
  const maximum=storedAudio>storedVideo?storedAudio:storedVideo;
  need(abs(stored*rate-maximum)<=rate,'Physical Matroska duration disagrees with the longest stored stream clock.');
  return Object.freeze({selectedSamples:Number(selected),decodedSampleFrames:Number(decoded),decodedTailSamples:Number(tail),
    primingSamples:Number(ACCESS_UNIT),firstPacketTick:packets[0].pts,firstDecodedTick:frames[0].pts,
    codedEndTicks:Number(codedEnd),containerEndTicks:Number(stored),
    longestClock:storedAudio>storedVideo?'audio':storedAudio===storedVideo?'both':'video',
    sampleRepresentation:'decoded-audio-lossy-reencode',productionQualified:false});
}
module.exports={ assessPrecisionAacClock };
