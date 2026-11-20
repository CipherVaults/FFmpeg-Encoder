'use strict';
const test = require('node:test');
const a = require('node:assert/strict');
const { compareClockPair, measuredWindow, openClockPair } = require('../linux-blue/qualification-tests/q2n-clock-pair.cjs');
const h = 'SHA256:' + 'a'.repeat(64);
function packets(rate) {
  // Deterministic inert double, not native media, FFmpeg or file authority.
  const pts = [0, 3, 2, 1], rows = [];
  for (let n = 0; n < 3750; n++) rows.push({stream_index: 0, pts: (n < 4 ? pts[n] : n) * rate/30,
    dts: (n - 2) * rate/30, duration: rate/30, size: '25', flags: n%60 ? '___' : 'K__', data_hash: h});
  for (let n = 0; n < 5860; n++) {
    const duration = n === 5859 ? 384 : 1024;
    rows.push({stream_index: 1, pts: n*1024, dts: n*1024, duration, size: String(duration*4), flags: 'K__', data_hash: h});
  }
  return rows;
}
test('unequal native grids compare exactly, including B-frame reordering, negative DTS and final partial audio block', () => {
  const r = compareClockPair(packets(30000), packets(15360));
  a.deepEqual(r, {videoPackets:3750,audioPackets:5860,audioSampleFrames:6000000});
  a.ok(Object.isFrozen(r));
});
for (const [reason, change] of [
  ['one genuine 30000 clock tick', p => p[0].pts++], ['order',p=>[p[1],p[2]]=[p[2],p[1]]],
  ['flags',p=>p[0].flags='___'], ['payload size',p=>p[0].size='24'], ['content hash',p=>p[0].data_hash=h.replace('a','b')],
  ['unmeasured side data',p=>p[0].side_data_list=[]], ['unknown track',p=>p[0].stream_index=2],
  ['unsafe timestamp',p=>p[1].pts=Number.MAX_SAFE_INTEGER+1], ['missing tail',p=>p.pop()],
]) test('comparison refuses '+reason, () => {
  const p=packets(30000);change(p);a.throws(()=>compareClockPair(p,packets(15360)),{code:'Q2N_CLOCK_PAIR'});
});
test('equally wrong clocks or unbounded metadata cannot support a media verdict merely by matching one another', () => {
  for (const change of [p=>p[4].pts=p[3].pts,p=>p[6].dts=p[5].dts,p=>p[3750].size='4',p=>p[3750].duration=1000,
    p=>p[0].flags='X',p=>p[0].data_hash='unknown',p=>p[0].size='99999999999',p=>p[0].odd='surprise']) {
    const x=packets(30000),y=packets(15360);change(x);change(y);a.throws(()=>compareClockPair(x,y),{code:'Q2N_CLOCK_PAIR'});
  }
});
test('sparse or accessor array entries do not run supplied code', () => {
  const a1=packets(30000); let touched=false;
  Object.defineProperty(a1,'0',{get(){touched=true;return null;}});
  a.throws(()=>compareClockPair(a1,packets(15360)),{code:'Q2N_CLOCK_PAIR'});a.equal(touched,false);
  const a2=packets(30000); delete a2[3]; a.throws(()=>compareClockPair(a2,packets(15360)),{code:'Q2N_CLOCK_PAIR'});
});
test('only two measured half-open windows; exact genuine ticks, first/last output ticks and sample extent', () => {
  const x=measuredWindow('aligned'), y=measuredWindow('off-grid');
  a.deepEqual([x.videoStartTick,x.videoEndTick,x.frameCount,x.audioSampleFrames,x.firstMs,x.lastMs],[2730000,3690000,960,1536000,0,31967]);
  a.deepEqual([y.videoStartTick,y.videoEndTick,y.frameCount,y.audioSampleFrames,y.firstMs,y.lastMs],[2730390,2762610,32,51552,20,1054]);
  a.equal(y.audioStartTick,4368624);a.equal(y.audioEndTick,4420176);a.ok(Object.isFrozen(y));
  for (const v of ['full','aligned ',{},null,90000,NaN,'__proto__']) a.throws(()=>measuredWindow(v),{code:'Q2N_CLOCK_PAIR'});
});
test('open cannot take a report, runtime handle or relative filesystem authority', async () => {
  for (const root of [{runtimeIdentity:'claimed'}, '/tmp/../x', 'runtime', null])
    await a.rejects(openClockPair(root),{code:'Q2N_CLOCK_PAIR'});
});
