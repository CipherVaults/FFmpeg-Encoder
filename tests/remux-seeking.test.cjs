'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {realWitness}=require('./helpers/remux-real-witness.cjs'),{children}=require('./helpers/ebml-fixture.cjs');
const {MATROSKA_SCHEMA}=require('../src/remux-native-inventory.cjs');
const {observeNativeInventory,compareNativeInventories}=require('../src/remux-native-checks.cjs');
const {runTool}=require('../src/process-runner.cjs'),{ffmpeg,ffprobe}=require('../src/candidate-runtime.cjs').resolveCandidateRuntime({root:path.resolve(__dirname,'..')});
const masters=new Set(MATROSKA_SCHEMA.filter(r=>r.type==='master').map(r=>Number(r.id)));
function mutateAll(bytes,id,value){const out=Buffer.from(bytes);let count=0;const walk=(start,end)=>{for(const n of children(out,start,end)){if(n.id===id){out.fill(value,n.body,n.end);count++;}else if(masters.has(n.id))walk(n.body,n.end);}};walk(0,out.length);assert.ok(count);return out;}
const native=(f,file=f.sourcePath,probe=f.source,family='matroska')=>observeNativeInventory({file,probe,family,target:family==='matroska'?'matroska':'mp4'});
test('review8 CueClusterPosition=ff and every CueTime=zero refuse, with the actual indexed neighbour accepted',async t=>{
  const f=await realWitness(t,'matroska');assert.ok((await native(f)).randomAccess.streams[0].indexed.length>=3);
  for(const [id,value,code]of [[0xf1,255,'REMUX_NATIVE_CUECLUSTERPOSITION'],[0xb3,0,'REMUX_NATIVE_CUETIME']]){
    await fs.writeFile(f.sourcePath,mutateAll(f.original,id,value));await assert.rejects(native(f),{code});await fs.writeFile(f.sourcePath,f.original);await native(f);
  }
});
async function firstDecoded(file,seconds,preroll=0){const rewind=Math.min(seconds,preroll),result=await runTool(ffmpeg,['-v','error','-nostdin','-ss',String(seconds-rewind),'-noaccurate_seek','-i',file,...(rewind?['-ss',String(rewind)]:[]),'-map','0:v:0','-frames:v','1','-an','-c:v','rawvideo','-pix_fmt','yuv420p','-f','framehash','-']);
  const rows=result.stdout.split(/\r?\n/).filter(l=>l&&!l.startsWith('#'));assert.equal(rows.length,1,'seek must yield exactly one decoded frame');return rows[0].split(',').at(-1).trim();}
for(const family of ['matroska','isobmff','mpegts'])test('pinned FFmpeg actual remux preserves '+(family==='mpegts'?'the accurately presented seek picture':'the indexed first decoded picture')+': '+family,async t=>{
  const baseFamily=family==='mpegts'?'isobmff':family,f=await realWitness(t,baseFamily,{audio:false,durationSeconds:family==='mpegts'?'3':undefined}),dir=path.dirname(f.sourcePath);let source=f.sourcePath,sourceProbe=f.source;
  if(family==='mpegts'){source=path.join(dir,'seek-source.ts');await runTool(ffmpeg,['-v','error','-nostdin','-n','-i',f.sourcePath,'-map','0:v:0','-c','copy',source]);sourceProbe=await f.probe(source);
    const integrity=require('../src/remux-transport.cjs').createTransportIntegrity(sourceProbe.streams,sourceProbe.programs);integrity.push(await fs.readFile(source));assert.ok(integrity.finish().randomAccessCount>0);}
  const output=path.join(dir,family==='matroska'?'actual-remux.mkv':'actual-remux.mp4');await runTool(ffmpeg,['-v','error','-nostdin','-n','-i',source,'-map','0','-c','copy',output]);const outputProbe=await f.probe(output);
  const out=await native(f,output,outputProbe,family==='matroska'?'matroska':'isobmff');
  if(family!=='mpegts'){const input=await native(f,source,sourceProbe,family);compareNativeInventories(input,out,sourceProbe.streams.map(s=>({inputIndex:s.index,outputIndex:s.index})));}
  if(family==='mpegts'){
    // Scanning TS has no seek index. Decode a full second of preceding data
    // (longer than this fixture's 0.4s GOP), then discard to the target. Keep
    // the untrimmed observation visible: a different demuxer landing point is
    // expected, but the picture presented at the requested time must match.
    for(const seconds of [0,0.25,0.5,0.85,1.25,1.5,2.25,2.85]){
      const withoutPreroll={source:await firstDecoded(source,seconds),output:await firstDecoded(output,seconds)};
      const presented={source:await firstDecoded(source,seconds,1),output:await firstDecoded(output,seconds,1)};
      t.diagnostic(JSON.stringify({seconds,withoutPreroll,presented}));
      assert.equal(presented.source,presented.output,'mpegts accurately presented seek '+seconds);
      if(seconds===0.5)assert.notEqual(withoutPreroll.source,withoutPreroll.output,'the 0.5s fixture retains the reported scanning/indexed landing difference');
    }
  }else for(const seconds of [0,0.25,0.5,0.85])assert.equal(await firstDecoded(source,seconds),await firstDecoded(output,seconds),family+' indexed seek '+seconds);
});
module.exports={mutateAll,firstDecoded};
