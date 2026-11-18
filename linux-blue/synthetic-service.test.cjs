'use strict';
// Portable control/filesystem contracts, not codec/media qualification. The
// original live-media suite remains explicitly runnable under qualification-tests.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {EventEmitter}=require('node:events'),{createRequire}=require('node:module'),{createHash}=require('node:crypto');
const {cpuChoices}=require('./ui-policy.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const settings=id=>{const p=cpuChoices().find(x=>x.id===id);return {profileId:id,preset:p.defaultPreset,quality:p.quality.default};};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
const tick=()=>new Promise(r=>setImmediate(r));
async function fixture(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'synthetic-contract-'));let service,control;
  // Drain service before removing only this test-owned directory, including errors.
  t.after(async()=>{try{control?.hold?.resolve();await service?.close();}finally{await fs.rm(root,{recursive:true,force:true});}});
  const bytes=Buffer.from('inert portable source; not video\n'),source=path.join(root,'source.mkv');await fs.writeFile(source,bytes,{flag:'wx'});
  const census={spawned:0,closed:0,live:0,maximum:0},seen=[],encoded=new Map();control={hold:null,entered:deferred(),badFrames:false};
  const media=codec=>({streams:[{codec_type:'video',codec_name:codec,nb_read_frames:'12',width:320,height:180,pix_fmt:'yuv420p',color_range:'tv',color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709'},
    {codec_type:'audio',codec_name:'pcm_s16le',sample_rate:'48000',channels:2,tags:{language:'eng'}}],format:{tags:{title:'synthetic contract'}}});
  const cancelled=signal=>{if(signal?.aborted)throw Object.assign(new Error('injected child cancellation'),{code:'CANCELLED'});};
  async function child(opts,action) {
    const c=new EventEmitter();census.spawned++;census.live++;census.maximum=Math.max(census.maximum,census.live);
    try {opts.onChild?.(c);cancelled(opts.signal);return await action();}
    finally {census.live--;census.closed++;c.emit('close',opts.signal?.aborted?null:0,opts.signal?.aborted?'SIGTERM':null);}
  }
  const runtime={sha256:sha,
    runFixedTool:async(kind,args,opts)=>child(opts,async()=>{
      seen.push({kind,args:[...args]});cancelled(opts.signal);
      if(kind==='ffprobe'){
        const file=args.at(-1),codec=encoded.get(file)||'h264';assert.ok(file.startsWith(root+path.sep));
        const p=media(codec);if(encoded.has(file)&&control.badFrames)p.streams[0].nb_read_frames='11';return {stdout:JSON.stringify(p)};
      }
      assert.equal(kind,'ffmpeg');assert.ok(args.includes('-i'));
      return {stdout:args.includes('hash')?'SHA256='+sha(Buffer.from('synthetic copied audio'))+'\n':''};
    }),
    runCpuEncode:async(request,opts)=>child(opts,async()=>{
      assert.equal(sha(await fs.readFile(request.input)),sha(bytes));assert.notEqual(request.input,source);
      assert.equal(path.basename(request.input),'.synthetic-fixture');
      seen.push({kind:'encode',input:request.input,output:request.output,profile:request.settings.profileId});
      control.entered.resolve();opts.onProgress?.({frame:1});
      if(control.hold)await control.hold.promise;else await tick();
      cancelled(opts.signal);await fs.writeFile(request.output,Buffer.from('inert encoded staging bytes'));
      encoded.set(request.output,{'h264-cpu':'h264','h265-cpu':'hevc','av1-cpu':'av1'}[request.settings.profileId]);
      return {exitCode:0};
    })};
  const file=path.join(__dirname,'synthetic-service.cjs'),original=await fs.readFile(file,'utf8'),real=createRequire(file),module={exports:{}};
  // A test-local literal binds the inert byte fixture. Hashing, bounded capture,
  // path/identity checks and real staging/publication are NOT replaced.
  const expected="const FIXTURE_SHA = '145c63faaaa6052e7fd7b0dc206319c67355edbb8b5e2c43a2687af5100a5d06';";
  assert.equal(original.split(expected).length,2);
  const code=original.replace(expected,`const FIXTURE_SHA = '${sha(bytes)}';`);
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`,{filename:file})(n=>n==='./runtime.cjs'?runtime:real(n),module,module.exports);
  return {root,source,bytes,census,seen,control,api:module.exports,async create(options={}){service=await module.exports.createSyntheticService({source,parent:root,...options});return service;}};
}
test('portable staged contracts preserve three codec routes, exclusive publication and busy admission',async t=>{
  const h=await fixture(t),s=await h.create();await assert.rejects(s.start({...settings('h264-cpu'),profileId:'h264-nvidia'}),{code:'LINUX_UI_SETTINGS'});
  const first=s.start(settings('h264-cpu'));await assert.rejects(s.start(settings('h265-cpu')),{code:'SYNTHETIC_BUSY'});
  const results=[await first];for(const id of ['h265-cpu','av1-cpu'])results.push(await s.start(settings(id)));
  assert.ok(results.every(x=>x.published&&x.status==='published'&&!x.cleanup.retained));
  const destination=results[0].destination,before=sha(await fs.readFile(destination)),calls=h.census.spawned;
  await assert.rejects(s.start(settings('h264-cpu')),{code:'SYNTHETIC_OUTPUT_EXISTS'});assert.equal(h.census.spawned,calls);assert.equal(sha(await fs.readFile(destination)),before);
  assert.equal(sha(await fs.readFile(h.source)),sha(h.bytes));await s.close();await assert.rejects(s.start(settings('h264-cpu')),{code:'SYNTHETIC_CLOSED'});
  assert.equal(h.census.live,0);assert.equal(h.census.maximum,1);assert.equal(h.census.spawned,h.census.closed);assert.equal(h.seen.filter(x=>x.kind==='encode').length,3);
});
test('portable cancellation waits for child close before restart; progress-time collision preserves sentinel',async t=>{
  const h=await fixture(t);h.control.hold=deferred();let mode='cancel',s,collision;
  s=await h.create({onProgress(){if(mode==='cancel')void s.cancel();else if(mode==='collision'){require('node:fs').writeFileSync(collision,'existing output',{flag:'wx'});mode='done';}}});
  const running=s.start(settings('h264-cpu')),rejected=assert.rejects(running,{code:'CANCELLED'});await h.control.entered.promise;
  let drained=false;const drain=s.cancel().then(()=>{drained=true;});await tick();assert.equal(drained,false);assert.equal(h.census.live,1);
  await assert.rejects(s.start(settings('h264-cpu')),{code:'SYNTHETIC_BUSY'});h.control.hold.resolve();await rejected;await drain;assert.equal(h.census.live,0);
  assert.deepEqual((await fs.readdir(s.directory)).filter(n=>n.endsWith('.mkv')),[]);
  mode='collision';h.control.hold=null;collision=path.join(s.directory,'h264-cpu.mkv');const result=await s.start(settings('h264-cpu'));
  assert.equal(result.status,'collision');assert.equal(result.published,false);assert.equal(result.cleanup.retained,true);assert.equal(await fs.readFile(collision,'utf8'),'existing output');
  assert.equal(h.census.spawned,h.census.closed);
});
test('portable wrong or swapped fixture refuses before child execution',async t=>{
  const h=await fixture(t);await fs.writeFile(h.source,'not the pinned inert fixture');await assert.rejects(h.create(),{code:'SYNTHETIC_FIXTURE'});assert.equal(h.census.spawned,0);
  await fs.rm(h.source);const alias=path.join(h.root,'other');await fs.writeFile(alias,h.bytes);await fs.symlink(alias,h.source);
  await assert.rejects(h.create(),{code:'SYNTHETIC_FIXTURE'});assert.equal(h.census.spawned,0);
});
test('portable close drains active child and permanently rejects later work',async t=>{
  const h=await fixture(t);h.control.hold=deferred();const s=await h.create(),running=s.start(settings('h264-cpu')),rejected=assert.rejects(running,{code:'CANCELLED'});
  await h.control.entered.promise;let drained=false;const closed=s.close().then(()=>{drained=true;});await tick();assert.equal(drained,false);assert.equal(h.census.live,1);
  await assert.rejects(s.start(settings('h264-cpu')),{code:'SYNTHETIC_CLOSED'});h.control.hold.resolve();await rejected;await closed;
  assert.equal(h.census.live,0);assert.equal(h.census.spawned,h.census.closed);assert.deepEqual((await fs.readdir(s.directory)).filter(n=>n.endsWith('.mkv')),[]);
});
test('portable caller replacement cannot redirect captured source reads',async t=>{
  const h=await fixture(t),s=await h.create();await fs.writeFile(h.source,'caller changed after capture');const result=await s.start(settings('h264-cpu'));
  assert.equal(result.published,true);assert.equal(await fs.readFile(h.source,'utf8'),'caller changed after capture');
  assert.ok(h.seen.filter(x=>x.kind==='encode').every(x=>x.input!==h.source));assert.equal(h.census.live,0);
});
test('portable failed output validation never gains publication authority',async t=>{
  const h=await fixture(t);h.control.badFrames=true;const s=await h.create();await assert.rejects(s.start(settings('h264-cpu')),{code:'ERR_ASSERTION'});
  assert.deepEqual((await fs.readdir(s.directory)).filter(n=>n.endsWith('.mkv')),[]);assert.equal(h.census.live,0);assert.equal(h.census.spawned,h.census.closed);
});
