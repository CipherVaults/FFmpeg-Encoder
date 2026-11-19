'use strict';
const test=require('node:test'),A=require('node:assert/strict'),fs=require('node:fs'),P=require('node:path'),H=require('node:crypto');
const C=require('./pinned.cjs'),{authority,metadata}=require('./prepare.cjs'),{matches}=require('./pe-icon.cjs');
const fake=(p,change={})=>({tag_name:p.tag,draft:false,assets:[{name:p.file,size:p.size,digest:'sha256:'+p.sha,browser_download_url:'https://github.com/'+p.repo+'/releases/download/'+p.tag+'/'+p.file,...change}]});
test('official asset identity refuses wrong size, digest, missing digest, redirect alias, or multiple matching assets',async()=>{
 for(const p of C.archives){const res=body=>async()=>({status:200,json:async()=>body});await metadata(p,res(fake(p)));
  for(const ch of [{size:p.size+1},{digest:'sha256:'+'a'.repeat(64)},{digest:null},{browser_download_url:'https://example.test/'+p.file}])
   await A.rejects(metadata(p,res(fake(p,ch))));
  const dup=fake(p);dup.assets.push(dup.assets[0]);await A.rejects(metadata(p,res(dup)));
 }});
test('only first named actor push on intended private hosted Windows branch',()=>{
 const env={GITHUB_REPOSITORY:C.privateRepo,GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/blue/private-windows-alpha-preflight-20261121',GITHUB_SHA:'b'.repeat(40),GITHUB_RUN_ATTEMPT:'1',GITHUB_ACTOR:'AE0101',RUNNER_OS:'Windows',RUNNER_ENVIRONMENT:'github-hosted'};
 const ev={repository:{private:true},forced:false,deleted:false,created:false,before:C.original,after:env.GITHUB_SHA};authority(env,ev);
 for(const opt of [{GITHUB_REPOSITORY:'AE0101/FFmpeg-Encoder'},{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_ACTOR:'remote-helper'},{GITHUB_REF:'refs/heads/codex/v0.7-candidate'},{GITHUB_EVENT_NAME:'pull_request'},{RUNNER_ENVIRONMENT:'self-hosted'}])A.throws(()=>authority({...env,...opt},ev));
 for(const patch of [{repository:{private:false}},{forced:true},{deleted:true},{created:true},{before:'1'.repeat(40)},{after:'a'.repeat(40)}])A.throws(()=>authority(env,{...ev,...patch}));
});
test('Gauge input is the exact 7-frame private ICO and malformed PE fails',()=>{
 const i=fs.readFileSync(P.join(__dirname,'gauge-app.ico'));A.equal(H.createHash('sha256').update(i).digest('hex'),C.ico);
 A.equal(i.readUInt16LE(4),7);A.throws(()=>matches(Buffer.from('no image'),i));
});
test('inert workflow lacks write permissions and persistent artifact or public distribution step',()=>{
 const w=fs.readFileSync(P.join(__dirname,'hosted-workflow.yml.template'),'utf8').split(/\r?\n/).filter(x=>!x.trim().startsWith('#')).join('\n');
 A.match(w,/contents: read/);A.doesNotMatch(w,/actions\/upload-artifact|contents: write|gh release|workflow_dispatch|pull_request|git push/);
 for(const m of w.matchAll(/uses: (\S+)/g))A.match(m[1],/@[0-9a-f]{40}$/);
 A(w.includes(C.original)&&w.includes(C.helper));
});
test('smoke bounded parser & media facts',()=>{
 const {parse,checkProbe}=require('./native-smoke.cjs');A.throws(()=>parse([]));A.throws(()=>parse(['--app','x','--app','x']));
 const j={streams:[{codec_type:'video',codec_name:'h264',width:320,height:180,nb_read_frames:48},{codec_type:'audio',codec_name:'aac'}]};
 checkProbe(JSON.stringify(j));j.streams[0].nb_read_frames=47;A.throws(()=>checkProbe(JSON.stringify(j)));
});
