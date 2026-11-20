'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { assessPrecisionAacClock } = require('../linux-blue/qualification-tests/q2f-precision-aac-clock.cjs');

const cases = [
  [44100, 'stereo', 2, 320, 1113371, 2073917, 49100, 91460, 43, 961, 986, 986, 23219955, 648],
  [44100, 'stereo', 2, 320, 2177311, 3000000, 96020, 132300, 37, 823, 822, 846, 23219955, 584],
  [48000, 'mono',   1, 128, 1113371, 2073917, 53442, 99549, 47, 961, 986, 986, 21333333, 997],
  [48000, 'mono',   1, 128, 2177311, 3000000,104511,144000, 40, 823, 822, 844, 21333333, 447],
];
function witness(index = 0) {
  const [rate, layout, channels, bitrate, startUs, endUs, first, end, blocks, packetEnd, videoEndTick, durationTicks, codecDelayNs] = cases[index];
  const origin = Math.round(startUs * rate / 1e6);
  const packetDuration = Math.floor(1024 * 1000 / rate);
  const packets = Array.from({ length: blocks }, (_, i) => {
    const pts = Math.round((first - origin + 1024 * (i - 1)) * 1000 / rate);
    return { pts, duration: i === blocks - 1 ? packetEnd - pts : packetDuration,
      padding: i === 0 ? { skipSamples: 1024, discardPadding: 0 } : null };
  });
  const frames = packets.slice(1).map(({ pts }) => ({ pts, samples:1024 }));
  return { rate, layout, channels, bitrate, startUs, endUs, sourceFrames: rate*3, first, end, origin,
    scaleNs: 1000000, durationTicks, codecDelayNs, discardPaddingNs: null, videoEndTick,
    ffprobeInitialPadding:1024, fullDecodedSamples:frames.length*1024, packets, frames };
}
for (const [index, [rate,layout,,,,,,,,,,, ,tail]] of cases.entries()) {
  test('native-derived compact arithmetic for '+rate+' '+layout+' case '+index, () => {
    const input=witness(index), result=assessPrecisionAacClock(input);
    assert.equal(result.selectedSamples,input.end-input.first);
    assert.equal(result.decodedTailSamples,tail);
    assert.equal(result.codedEndTicks,input.packets.at(-1).pts+input.packets.at(-1).duration);
    assert.equal(result.containerEndTicks, input.durationTicks);
    assert.equal(result.productionQualified,false);
    assert.ok(Object.isFrozen(result));
  });
}
test('storage clock chooses video when longer and distinguishes codec delay of the two rates otherwise',()=>{
  assert.deepEqual(Array.from({length:4},(_,i)=>assessPrecisionAacClock(witness(i)).longestClock),
    ['video','audio','video','audio']);
});
for (const [name, breakIt] of [
  ['48k delay copied into 44.1k',x=>x.codecDelayNs=21333333], ['unexpected channel count',x=>x.channels=1],
  ['unsupported AAC bitrate policy',x=>x.bitrate=128], ['track clock overridden',x=>x.scaleNs=100000],
  ['non-exclusive end',x=>x.end++], ['origin set to first sample instead of nearest request',x=>{x.startUs++;x.origin+=2}],
  ['source extent too short',x=>x.sourceFrames=x.end-1], ['priming not signed',x=>x.packets[0].pts=0],
  ['priming also at tail',x=>x.packets.at(-1).padding=x.packets[0].padding],
  ['physical discard padding inserted',x=>x.discardPaddingNs=1024], ['native decoder delay missing',x=>x.ffprobeInitialPadding=0],
  ['missing packet',x=>x.packets.splice(9,1)], ['duplicated packet time',x=>x.packets[4].pts=x.packets[3].pts],
  ['full decode count does not match frames',x=>x.fullDecodedSamples--], ['interior gap',x=>x.frames[5].pts+=2],
  ['packet endpoint substituted for stored endpoint',x=>x.durationTicks=x.packets.at(-1).pts+x.packets.at(-1).duration],
  ['wrong terminal duration',x=>x.packets.at(-1).duration+=5], ['one complete excess access unit',x=>{const last=x.packets.at(-1);x.packets.push({...last,pts:last.pts+23});x.frames.push({pts:last.pts+23,samples:1024});x.fullDecodedSamples+=1024}],
  ['sparse list',x=>{delete x.frames[1];}], ['unsafe timeline',x=>x.endUs=Number.MAX_SAFE_INTEGER],
]) test('refuses '+name,()=>{ const input=witness(); breakIt(input); assert.throws(()=>assessPrecisionAacClock(input),{ code:'Q2F_AAC_CLOCK' }); });
test('refuses accessor without invoking caller code',()=>{
  let read=false; const input=witness(); Object.defineProperty(input.packets[1],'pts',{ get(){ read=true; return 0; }});
  assert.throws(()=>assessPrecisionAacClock(input),{code:'Q2F_AAC_CLOCK'}); assert.equal(read,false);
});
test('refuses proxies without invoking traps',()=>{
  let trapped=false; const handler={ getPrototypeOf(){trapped=true; return Object.prototype;} };
  for (const key of ['root','packets','row','padding','frames']) {
    let x=witness();
    if(key==='root') x=new Proxy(x,handler);
    if(key==='packets' || key==='frames') x[key]=new Proxy(x[key],handler);
    if(key==='row') x.packets[2]=new Proxy(x.packets[2],handler);
    if(key==='padding') x.packets[0].padding=new Proxy(x.packets[0].padding,handler);
    assert.throws(()=>assessPrecisionAacClock(x),{code:'Q2F_AAC_CLOCK'});
  }
  assert.equal(trapped,false);
});
