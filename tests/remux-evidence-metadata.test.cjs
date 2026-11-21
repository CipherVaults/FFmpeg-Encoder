'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const {createHash}=require('node:crypto');
const {runTool}=require('../src/process-runner.cjs');
const {ffmpeg}=require('../src/candidate-runtime.cjs').resolveCandidateRuntime({root:path.resolve(__dirname,'..')});
const {realWitness}=require('./helpers/remux-real-witness.cjs');
// The pinned FFmpeg CLI warns when it discards copied stale tags (Matroska
// DURATION, BPS, NUMBER_OF_*, encoder ids) from a re-encoded stream. Evidence
// decodes write raw PCM/framehash bytes that carry no metadata, so they copy
// none. The strict empty-stderr gate itself is unchanged.
const DISCARDED=/^\[[av]ost#0:0\/(?:pcm_f32le|rawvideo) @ [0-9a-f]+\] Discarding stream metadata 'DURATION' because the stream is being re-encoded\./m;
async function decode(args){
  const hash=createHash('sha256');let bytes=0;
  const result=await runTool(ffmpeg,args,{timeoutMs:120000,stdoutLimit:64*1024*1024,onStdoutChunk:async chunk=>{bytes+=chunk.length;hash.update(chunk);}});
  return {exitCode:result.exitCode,stderr:result.stderr,bytes,sha256:hash.digest('hex')};
}
const without=args=>{const at=args.indexOf('-map_metadata');assert.deepEqual(args.slice(at,at+2),['-map_metadata','-1']);return [...args.slice(0,at),...args.slice(at+2)];};

test('real Matroska evidence decodes copy no stale tags, keep identical bytes and still surface a genuine decode warning',async t=>{
  const f=await realWitness(t,'matroska');
  for(const stream of f.source.streams)assert.match(String(stream.tags?.DURATION),/^\d\d:\d\d:\d\d\.\d+$/,'the source carries the stale Matroska statistics tag');
  const r=await f.collect();assert.equal(r.status,'completed',JSON.stringify(r.failure));assert.equal(f.validate(r).valid,true,JSON.stringify(f.validate(r)));
  // Window decodes read owned raw H264 clips, which carry no container tags.
  const decodes=r.invocations.filter(entry=>entry.executable===ffmpeg&&!entry.label.endsWith('-windows'));
  const natives=['source','output'].map(side=>decodes.find(entry=>entry.label===side+'-1-native-audio'));
  assert.ok(natives.every(Boolean),'both sides decode complete native audio');
  assert.ok(decodes.some(entry=>entry.label.endsWith('-complete-parameters')));
  for(const entry of r.invocations.filter(entry=>entry.executable===ffmpeg))assert.equal(entry.stderr,'',entry.label);
  for(const entry of decodes){
    const map=entry.args.indexOf('-map');assert.ok(entry.args.indexOf('-i')<map);
    assert.deepEqual(entry.args.slice(map+2,map+4),['-map_metadata','-1'],entry.label);assert.equal(entry.status,'completed');
  }
  for(const entry of natives){
    const kept=await decode(entry.args),copied=await decode(without(entry.args));
    // The option only stops stale tag copying: the decoded bytes are identical.
    assert.equal(kept.exitCode,0);assert.equal(kept.stderr,'');assert.equal(copied.exitCode,0);assert.match(copied.stderr,DISCARDED,entry.label);
    assert.ok(kept.bytes>0);assert.equal(kept.bytes,copied.bytes);assert.equal(kept.sha256,copied.sha256);
    if(entry.sha256)assert.equal(kept.sha256,entry.sha256);
    // A genuine diagnostic on a truncated file is still reported on stderr,
    // which the collector's unchanged gate refuses (REMUX_EVIDENCE_DECODE).
    const truncated=path.join(path.dirname(f.sourcePath),'truncated-'+entry.label+'.mkv');
    await fs.writeFile(truncated,f.original.subarray(0,Math.floor(f.original.length*2/3)),{flag:'wx'});
    const args=[...entry.args];args[args.indexOf('-i')+1]=truncated;
    const damaged=await decode(args);assert.match(damaged.stderr,/File ended prematurely/,entry.label);assert.doesNotMatch(damaged.stderr,DISCARDED);
  }
});
