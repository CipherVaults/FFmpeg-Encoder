'use strict';
// Opt-in read-only integration assay. The caller restores/generates each of the
// named synthetic files; this script creates no product output or authorization.
const fs=require('node:fs/promises'),path=require('node:path'),a=require('node:assert/strict'),{createHash}=require('node:crypto');
const {auditPaths}=require('../linux-blue/qualification-tests/q2l-multiaudio-copy.cjs');
async function main(runtimeRoot,dir){
  a.equal(dir,await fs.realpath(dir));a.equal(dir,path.resolve(dir));
  const expected={
    mixed:[[48000,2,'eng',true],[44100,1,'ara',false]],
    held:[[44100,2,'deu',false],[48000,1,'eng',true]],
    twins:[[48000,2,'eng',false],[48000,2,'ara',true]]};
  const named=k=>path.join(dir,k+'.mp4'),cases=[],negatives=[];
  for(const [k,roles] of Object.entries(expected)) {
    const obs=await auditPaths(runtimeRoot,named(k+'-source'),named(k+'-copy'));
    a.deepEqual(obs.tracks.slice(1).map(t=>[t.rate,t.channels,t.language,t.isDefault]),roles);
    a.notEqual(obs.tracks[1].decodedSha256,obs.tracks[2].decodedSha256);
    a.notEqual(obs.tracks[1].packetSha256,obs.tracks[2].packetSha256);
    cases.push({name:k,...obs});
  }
  for(const name of ['missing','swapped','language','known-language','default']) {
    let refusal;try{await auditPaths(runtimeRoot,named('twins-source'),named(name));}catch(e){refusal={code:e.code,message:e.message};}
    a.ok(refusal&&refusal.code==='Q2L_MULTI_AUDIO','Expected a scoped refusal for '+name);
    const reason={missing:/inventory|track count/i,swapped:/packetSha256/,language:/Unmeasured audio language/,'known-language':/Track 2 differs in language/,default:/isDefault/};
    a.match(refusal.message,reason[name]);negatives.push({name,...refusal});
  }
  const aborted=new AbortController();aborted.abort();await a.rejects(auditPaths(runtimeRoot,named('held-source'),named('held-copy'),aborted.signal),{code:'CANCELLED'});
  return {scope:'true native targeted multi-audio comparison; not a production job or all remux proof',cases,negatives,preCancelledRefused:true,
    componentSha256:createHash('sha256').update(await fs.readFile(require.resolve('../linux-blue/qualification-tests/q2l-multiaudio-copy.cjs'))).digest('hex')};
}
if(require.main===module) main(...process.argv.slice(2)).then(x=>console.log(JSON.stringify(x,null,2))).catch(e=>{console.error(e);process.exitCode=1;});
