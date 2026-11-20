'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const PRODUCT_RUNTIME='dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
function harness(runtimeIdentity=PRODUCT_RUNTIME){const file=require.resolve('../linux-blue/product-linux-unified-runtime.cjs'),original=createRequire(file),m={exports:{}};let now=0;const calls=[],timers=[];let hold=null,holdRunner=null;
 const candidate={runtimeIdentity,pins:{ffmpeg:{path:'/runtime/ffmpeg',size:1,sha256:'a'.repeat(64)},ffprobe:{path:'/runtime/ffprobe',size:1,sha256:'b'.repeat(64)}},requireCurrent:async()=>{if(hold)await hold;},createRunner:()=>async(exe,args,options)=>{calls.push({exe,args,options,route:'candidate'});if(holdRunner)await holdRunner();return {exitCode:0,stdout:'{"format":{"format_name":"matroska,webm"},"streams":[{"time_base":"1/90000"}]}' };},close:async()=>{calls.push({close:'candidate'});}};
 class MockRemuxOperations{requireCurrent(selection,bindings){assert.equal(bindings.token,selection);return selection.requireCurrent();}}
 const replacements={'../src/remux-operation.cjs':{RemuxOperations:MockRemuxOperations},'./candidate-calibration-runtime.cjs':{openCandidateCalibrationRuntime:async()=>candidate},'./product-linux-shell.cjs':{manifest:()=>({}),loaderGuard(){}},'../src/operation-runtime.cjs':{OperationRuntimeObserver:class{async close(){calls.push({close:'observer'});}}},'../src/process-runner.cjs':{ToolError:original('../src/process-runner.cjs').ToolError,runTool:async(exe,args,options)=>{calls.push({route:'raw',options});return {exitCode:0};}}};
 vm.runInThisContext('(function(require,module,exports,performance,setTimeout,clearTimeout){'+fs.readFileSync(file,'utf8')+'\n})')(id=>replacements[id]||original(id),m,m.exports,{now:()=>now},(f,ms)=>{const t={f,ms,unref(){}};timers.push(t);return t;},()=>{});
 return {...m.exports,bind:(g,c)=>g.bindRemux(new MockRemuxOperations(),c,()=>({token:c})),calls,timers,advance:ms=>now+=ms,hold:p=>hold=p,holdRunner:f=>holdRunner=f};}
test('ordinary phase ceilings retain exact existing durations and timeout tightening',async()=>{const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');for(const [route,kind,ms]of[['discovery','checking',300000],['ordinary','preparing',120000],['ordinary','running',600000]]){g.begin(route,kind,new AbortController());assert.equal(h.timers.at(-1).ms,ms);await g.run('/runtime/ffprobe',['-version'],{timeoutMs:0});assert.equal(h.calls.at(-1).options.timeoutMs,ms);g.settle();}await g.close();});
test('ordinary discovery does not inherit measured Matroska clock restriction',async()=>{const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');const args=['-show_format','-show_streams'];g.begin('ordinary','preparing',new AbortController());await g.run('/runtime/ffprobe',args,{timeoutMs:500});g.settle();g.begin('measured','preparing',new AbortController());await assert.rejects(g.run('/runtime/ffprobe',args,{timeoutMs:500}),/exactly 1\/1000/);g.settle();await g.close();});
test('expired or cancelled phase is retired, never reset into a new operation',async()=>{for(const mode of ['expired','cancelled']){const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state'),c=new AbortController();g.begin('ordinary','preparing',c);if(mode==='expired')h.advance(120001);else c.abort();g.settle();assert.throws(()=>g.begin('ordinary','running',new AbortController()));await g.close();}});
test('deferred currentness expiry refuses before executor and owns live read until settlement',async()=>{const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');let release;h.hold(new Promise(r=>release=r));g.begin('ordinary','preparing',new AbortController());const run=g.run('/runtime/ffprobe',['-version'],{timeoutMs:1000});assert.equal(g.snapshot().live,1);assert.throws(()=>g.settle(),/unsettled/);h.advance(120001);release();await assert.rejects(run,/expired/);assert.equal(h.calls.length,0);g.settle();await g.close();});
test('AV1 uses ordinary120s preparation/raw runner and cancellation retires phase',async()=>{const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state'),c=new AbortController();g.begin('av1-ordinary','preparing',c);assert.equal(h.timers.at(-1).ms,120000);await g.run('/runtime/ffprobe',['-show_format','-show_streams'],{timeoutMs:0});assert.equal(h.calls.at(-1).route,'candidate');c.abort();g.settle();assert.throws(()=>g.begin('av1-ordinary','running',new AbortController()));await g.close();});
test('H265 ordinary running uses raw candidate runner while measured observations retain clock refusal',async()=>{const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');g.begin('measured','preparing',new AbortController());await assert.rejects(g.run('/runtime/ffprobe',['-show_format','-show_streams'],{timeoutMs:500}),/1\/1000/);g.settle();g.begin('h265-ordinary','running',new AbortController());assert.equal(h.timers.at(-1).ms,600000);await g.run('/runtime/ffprobe',['-show_format','-show_streams'],{timeoutMs:500});assert.equal(h.calls.at(-1).route,'candidate');assert.throws(()=>g.begin('measured','running',new AbortController()));g.settle();g.begin('measured','running',new AbortController());await assert.rejects(g.run('/runtime/ffprobe',['-show_format','-show_streams'],{timeoutMs:500}),/1\/1000/);g.settle();await g.close();});

function remuxControl({ms=5000000000,child=1200000,count=64,target='mp4',current=null}={}){
 const selected=Object.freeze({remux:true,qualification:Object.freeze({inputFamily:'isobmff',target}),executionBudgetMs:ms,budget:Object.freeze({timeoutMs:child}),resources:Object.freeze({maxChildren:count})});
 return Object.freeze({kind:'remux-isobmff',selected,requireCurrent:current||(()=>selected)});
}
test('selected MP4 controls survive beyond old limits with overflow-safe timer and clipped children',async()=>{
 const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state'),c=remuxControl();g.begin('remux','running',new AbortController(),h.bind(g,c));assert.equal(h.timers.at(-1).ms,1000);
 h.advance(600001);await g.run('/runtime/ffprobe',['-version'],{timeoutMs:900000});assert.equal(h.calls.at(-1).options.timeoutMs,900000);
 await g.run('/runtime/ffprobe',['-version'],{timeoutMs:1500000});assert.equal(h.calls.at(-1).options.timeoutMs,1200000);g.settle();await g.close();
});
test('target, phase, mutable and changed selected controls refuse',async()=>{
 for(const mode of ['target','phase','mutable','changed']){const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');let c=remuxControl({target:mode==='target'?'mpegts':'mp4'});if(mode==='mutable')c={...c};if(mode==='changed')c=remuxControl({current:()=>({})});assert.throws(()=>g.begin('remux',mode==='phase'?'preparing':'running',new AbortController(),mode==='mutable'?c:h.bind(g,c)));await g.close();}
});
test('deferred MP4 currentness cancellation expiry and selection replacement spawn nothing',async()=>{
 for(const mode of ['cancel','expire','stale']){const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');let changed=false,c=remuxControl({ms:900000});const original=c;c=Object.freeze({...c,requireCurrent:()=>{assert(!changed,'stale');return original.selected;}});let release;h.hold(new Promise(r=>release=r));const abort=new AbortController();g.begin('remux','running',abort,h.bind(g,c));const run=g.run('/runtime/ffprobe',['-version'],{timeoutMs:300000});if(mode==='cancel')abort.abort();if(mode==='expire')h.advance(900001);if(mode==='stale')changed=true;release();await assert.rejects(run);assert.equal(h.calls.length,0);g.settle();await g.close();}
});
test('selected invocation ceiling refuses before spawn and legacy remux remains120s',async()=>{
 const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');g.begin('remux','running',new AbortController(),h.bind(g,remuxControl({count:1})));await g.run('/runtime/ffprobe',['-version'],{timeoutMs:200000});await assert.rejects(g.run('/runtime/ffprobe',['-version'],{timeoutMs:200000}),/ceiling/);assert.equal(h.calls.length,1);g.settle();g.begin('remux','running',new AbortController());await g.run('/runtime/ffprobe',['-version'],{timeoutMs:200000});assert.equal(h.calls.at(-1).options.timeoutMs,120000);g.settle();await g.close();
});

test('forged frozen raw costs and foreign generation tokens cannot authorize begin',async()=>{const h=harness(),a=await h.openUnifiedGeneration('/runtime','/state'),b=await h.openUnifiedGeneration('/runtime','/state');const c=remuxControl(),token=h.bind(a,c);for(const x of [c,token])assert.throws(()=>b.begin('remux','running',new AbortController(),x),/generation issued/);assert.throws(()=>a.bindRemux({},c,()=>({})));await a.close();await b.close();});
test('selected MKV controls survive beyond old limits with overflow-safe timer and clipped children',async()=>{
 const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state'),c=remuxControl({target:'matroska'});g.begin('remux','running',new AbortController(),h.bind(g,c));assert.equal(h.timers.at(-1).ms,1000);
 h.advance(600001);await g.run('/runtime/ffprobe',['-version'],{timeoutMs:900000});assert.equal(h.calls.at(-1).options.timeoutMs,900000);
 await g.run('/runtime/ffprobe',['-version'],{timeoutMs:1500000});assert.equal(h.calls.at(-1).options.timeoutMs,1200000);g.settle();await g.close();
});test('deferred MKV currentness cancellation expiry and selection replacement spawn nothing',async()=>{
 for(const mode of ['cancel','expire','stale']){const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');let changed=false,c=remuxControl({ms:900000,target:'matroska'});const original=c;c=Object.freeze({...c,requireCurrent:()=>{assert(!changed,'stale');return original.selected;}});let release;h.hold(new Promise(r=>release=r));const abort=new AbortController();g.begin('remux','running',abort,h.bind(g,c));const run=g.run('/runtime/ffprobe',['-version'],{timeoutMs:300000});if(mode==='cancel')abort.abort();if(mode==='expire')h.advance(900001);if(mode==='stale')changed=true;release();await assert.rejects(run);assert.equal(h.calls.length,0);g.settle();await g.close();}
});
test('MKV token cannot switch to a different valid target after binding',async()=>{
 const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');const mkv=remuxControl({target:'matroska'}),mp4=remuxControl();let selected=mkv.selected;
 const control=Object.freeze({...mkv,requireCurrent:()=>selected}),token=h.bind(g,control);selected=mp4.selected;
 assert.throws(()=>g.begin('remux','running',new AbortController(),token));assert.equal(g.snapshot().phase,null);assert.equal(h.calls.length,0);await g.close();
});
test('selected MOV controls survive beyond old limits with overflow-safe timer and clipped children',async()=>{
 const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state'),c=remuxControl({target:'mov'});g.begin('remux','running',new AbortController(),h.bind(g,c));assert.equal(h.timers.at(-1).ms,1000);
 h.advance(600001);await g.run('/runtime/ffprobe',['-version'],{timeoutMs:900000});assert.equal(h.calls.at(-1).options.timeoutMs,900000);
 await g.run('/runtime/ffprobe',['-version'],{timeoutMs:1500000});assert.equal(h.calls.at(-1).options.timeoutMs,1200000);g.settle();await g.close();
});test('deferred MOV currentness cancellation expiry and selection replacement spawn nothing',async()=>{
 for(const mode of ['cancel','expire','stale']){const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');let changed=false,c=remuxControl({ms:900000,target:'mov'});const original=c;c=Object.freeze({...c,requireCurrent:()=>{assert(!changed,'stale');return original.selected;}});let release;h.hold(new Promise(r=>release=r));const abort=new AbortController();g.begin('remux','running',abort,h.bind(g,c));const run=g.run('/runtime/ffprobe',['-version'],{timeoutMs:300000});if(mode==='cancel')abort.abort();if(mode==='expire')h.advance(900001);if(mode==='stale')changed=true;release();await assert.rejects(run);assert.equal(h.calls.length,0);g.settle();await g.close();}
});
test('MOV token cannot switch to a different valid target after binding',async()=>{
 const h=harness(),g=await h.openUnifiedGeneration('/runtime','/state');const mkv=remuxControl({target:'mov'}),mp4=remuxControl();let selected=mkv.selected;
 const control=Object.freeze({...mkv,requireCurrent:()=>selected}),token=h.bind(g,control);selected=mp4.selected;
 assert.throws(()=>g.begin('remux','running',new AbortController(),token));assert.equal(g.snapshot().phase,null);assert.equal(h.calls.length,0);await g.close();
});

function proportionalResizeFixture({selector=null, duration=150}={}){
 const {createProductSelector}=require('../linux-blue/product-linux-service.cjs');
 const {resolveFileRequest}=require('../src/operation-contract.cjs');
 const {buildEncodeOperation,fingerprintEncodeSource}=require('../src/encode-operation.cjs');
 const {classifyColor}=require('../src/media.cjs');
 const settings={profileId:'h265-cpu',preset:'slow',quality:25}, file='/synthetic/q2n-source.mov';
 const probe={streams:[{index:0,codec_type:'video',codec_name:'h264',profile:'High',width:1920,height:1080,pix_fmt:'yuv420p',field_order:'progressive',
  color_range:'tv',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709',chroma_location:'left',sample_aspect_ratio:'1:1',display_aspect_ratio:'16:9',
  avg_frame_rate:'30/1',r_frame_rate:'30/1',time_base:'1/15360',start_pts:0,start_time:'0',duration_ts:duration*15360,duration:String(duration),disposition:{default:1},
  side_data_list:[{side_data_type:'Display Matrix',rotation:0,displaymatrix:'00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824'}]},
  {index:1,codec_type:'audio',codec_name:'pcm_s16le',sample_fmt:'s16',sample_rate:'48000',channels:2,channel_layout:'stereo',
   time_base:'1/48000',start_pts:0,start_time:'0',duration_ts:duration*48000,duration:String(duration),disposition:{default:1}}],
  format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',duration:String(duration),start_time:'0',size:'85000000',nb_streams:2,nb_programs:0,nb_stream_groups:0,tags:{major_brand:'qt  '}},
  chapters:[],programs:[],stream_groups:[]};
 const sourceIdentity={canonicalPath:file,dev:'1',ino:'2',size:probe.format.size,mtimeNs:'100',ctimeNs:'101',birthtimeNs:'99',sparseDigest:'sha256-sparse-v1:'+'a'.repeat(64)};
 const request=resolveFileRequest({fileId:'synthetic',identityRevision:1,draftRevision:1,operation:'encode',
   overrides:{range:{startUs:91000000,endUs:123000000},resolution:'720',audioPolicy:'precision-flac'}});
 const plan=buildEncodeOperation({input:file,output:'/synthetic/q2n-output.mkv',settings,inspection:{probe,color:classifyColor(probe),duration},request,runtimeIdentity:PRODUCT_RUNTIME});
 selector ||= createProductSelector(require('../linux-blue/product-linux-qualification.json'));
 const bindings={plan,settings,sourceIdentity,sourceProbeFingerprint:fingerprintEncodeSource(probe),runtimeIdentity:PRODUCT_RUNTIME,environment:null,budget:null,executionBudgetMs:120000};
 const selection=selector.select(bindings), result=selector.requireCurrent(selection,bindings);
 return {selector,bindings,selection,result};
}
test('measured proportional owner survives 600s, clips each child, and consumes its generation token once',async()=>{
 const x=proportionalResizeFixture(),h=harness(),g=await h.openUnifiedGeneration('/runtime','/state',undefined,x.selector),q=x.result;
 assert(q.executionBudgetMs>600000&&q.budget.timeoutMs>600000);
 try{
  const token=g.bindMeasured(x.selection,()=>x.bindings);assert(Object.isFrozen(token));
  g.begin('measured','running',new AbortController(),token);assert.equal(h.timers.at(-1).ms,1000);
  h.advance(600001);await g.run('/runtime/ffprobe',['-version'],{timeoutMs:q.budget.timeoutMs+5});assert.equal(h.calls.at(-1).options.timeoutMs,q.budget.timeoutMs);
  h.advance(q.executionBudgetMs-600001-79);await g.run('/runtime/ffprobe',['-version'],{timeoutMs:q.budget.timeoutMs});assert.equal(h.calls.at(-1).options.timeoutMs,79);
  g.settle();assert.throws(()=>g.begin('measured','running',new AbortController(),token));
 } finally{await g.close();}
});
test('measured ownership rejects forged, foreign, stale, wrong plan and wrong runtime grants before a child',async()=>{
 const x=proportionalResizeFixture(),other=proportionalResizeFixture(),sameSelectorOther=proportionalResizeFixture({selector:x.selector}),h=harness(),wrong=harness('b'.repeat(64));
 const a=await h.openUnifiedGeneration('/runtime','/state',undefined,x.selector),b=await h.openUnifiedGeneration('/runtime','/state',undefined,x.selector),w=await wrong.openUnifiedGeneration('/runtime','/state',undefined,x.selector);
 try{
  const token=a.bindMeasured(x.selection,()=>x.bindings);
  for(const entry of [x.result,{...x.result},{executionBudgetMs:Infinity},{executionBudgetMs:NaN},{executionBudgetMs:2**53}])
   assert.throws(()=>a.begin('measured','running',new AbortController(),entry));
  assert.throws(()=>b.begin('measured','running',new AbortController(),token));
  assert.throws(()=>a.begin('measured','preparing',new AbortController(),token));
  assert.throws(()=>a.begin('h265-ordinary','running',new AbortController(),token));
  assert.throws(()=>a.bindMeasured(other.selection,()=>other.bindings));
  assert.throws(()=>a.bindMeasured(x.selection,()=>sameSelectorOther.bindings));
  assert.throws(()=>a.bindMeasured(x.selection,()=>({...x.bindings,budget:x.result.budget})));
  assert.throws(()=>w.bindMeasured(x.selection,()=>x.bindings));
  x.selector.invalidate('Synthetic measured selector retirement');
  assert.throws(()=>a.begin('measured','running',new AbortController(),token));
  assert.equal(h.calls.length+wrong.calls.length,0);assert.equal(a.snapshot().phase,null);
 } finally{await a.close();await b.close();await w.close();}
});
test('deferred measured ownership expiry, cancellation or source drift refuses before the runner and settles',async()=>{
 for(const mode of ['expire','cancel','stale']){
  const x=proportionalResizeFixture(),h=harness(),g=await h.openUnifiedGeneration('/runtime','/state',undefined,x.selector);
  let r, current=x.bindings;const hold=new Promise(resolve=>r=resolve);
  try{
   const token=g.bindMeasured(x.selection,()=>current),c=new AbortController();
   g.begin('measured','running',c,token);h.hold(hold);
   const pending=g.run('/runtime/ffprobe',['-version'],{timeoutMs:1000});
   assert.equal(g.snapshot().live,1);assert.throws(()=>g.settle(),/unsettled/);
   if(mode==='expire'){h.advance(x.result.executionBudgetMs);h.timers.at(-1).f();}
   if(mode==='cancel')c.abort();
   if(mode==='stale')current={...current,sourceIdentity:{...current.sourceIdentity,ctimeNs:'179'}};
   r();await assert.rejects(pending);assert.equal(h.calls.length,0);
   g.settle();assert.equal(g.snapshot().live,0);assert.throws(()=>g.begin('measured','running',new AbortController()));
  } finally{r();await g.close();}
 }
});
test('measured result cannot return success if selection retires while the owned child is running',async()=>{
 const x=proportionalResizeFixture(),h=harness(),g=await h.openUnifiedGeneration('/runtime','/state',undefined,x.selector);
 let release,enter;const resumed=new Promise(r=>release=r),started=new Promise(r=>enter=r);
 try{
  const control=g.bindMeasured(x.selection,()=>x.bindings);g.begin('measured','running',new AbortController(),control);
  h.holdRunner(async()=>{enter();await resumed;});
  const pending=g.run('/runtime/ffprobe',['-version'],{timeoutMs:1000});await started;
  x.selector.invalidate('Synthetic in-flight retirement');release();
  await assert.rejects(pending);assert.equal(h.calls.length,1);g.settle();assert.throws(()=>g.begin('measured','running',new AbortController()));
 } finally{release();await g.close();}
});
test('measured post-run settlement honors per-job abort and the selected invocation ceiling',async()=>{
 const x=proportionalResizeFixture(),h=harness(),g=await h.openUnifiedGeneration('/runtime','/state',undefined,x.selector);
 let release,enter;const resumed=new Promise(r=>release=r),started=new Promise(r=>enter=r);
 try{
  const control=g.bindMeasured(x.selection,()=>x.bindings);g.begin('measured','running',new AbortController(),control);
  const q=x.result, binary='/runtime/ffprobe',args=['-version'];
  assert.equal(q.resources.maxChildren,64);
  for(let i=0;i<q.resources.maxChildren-1;i++)await g.run(binary,args,{timeoutMs:1000});
  const perJob=new AbortController();
  h.holdRunner(async()=>{enter();await resumed;});const pending=g.run(binary,args,{timeoutMs:1000,signal:perJob.signal});await started;
  perJob.abort();release();await assert.rejects(pending,{code:'CANCELLED'});
  await assert.rejects(g.run(binary,args,{timeoutMs:1000}),/invocation ceiling/);
  assert.equal(h.calls.length,q.resources.maxChildren);assert.equal(g.snapshot().live,0);g.settle();
 } finally{release();await g.close();}
});

for(const mode of ['first exclusive link','exclusive copy fallback'])test(`measured publication refuses expired child-free ${mode} without waiting for its timer callback`,async t=>{
 const fsp=require('node:fs/promises'),os=require('node:os');
 const {createStage,sealStage,markStageValidated,publishOutput,cleanupStage}=require('../src/outputs.cjs');
 const dir=await fsp.mkdtemp(path.join(os.tmpdir(),'q2n-publish-'));
 t.after(()=>fsp.rm(dir,{recursive:true,force:true}));
 const x=proportionalResizeFixture(),h=harness(),g=await h.openUnifiedGeneration('/runtime','/state',undefined,x.selector);
 try{
  const control=g.bindMeasured(x.selection,()=>x.bindings),controller=new AbortController();
  g.begin('measured','running',controller,control);
  const stage=await createStage(dir),dest=path.join(dir,'already-validated.mkv');
  await fsp.writeFile(stage.file,'independent owned validated bytes');await sealStage(stage);await markStageValidated(stage);
  const near=x.result.executionBudgetMs;
  let links=0;
  const link=mode==='first exclusive link'
   ? async(...args)=>{links++;return fsp.link(...args);}
   : async()=>{links++;h.advance(near);throw Object.assign(Error('synthetic unsupported hard-link'),{code:'EXDEV'});};
  if(mode==='first exclusive link')h.advance(near);
  assert.equal(g.snapshot().live,0);assert.equal(controller.signal.aborted,false);assert.equal(h.calls.length,0);
  assert.throws(()=>g.assertCurrent(Object.freeze({})),/current measured owner/);
  await assert.rejects(publishOutput(stage,dest,{signal:controller.signal,link,assertCurrent:()=>g.assertCurrent(control)}),{code:'OPERATION_DEADLINE'});
  assert.equal(controller.signal.aborted,false,'intentionally never invoked the scheduled timeout callback');
  assert.equal(links,mode==='first exclusive link'?0:1);
  await assert.rejects(fsp.stat(dest),{code:'ENOENT'});
  const retained=await cleanupStage(stage);assert.equal(retained.validationCurrent,true);assert.equal(retained.completed,true);
  assert.equal(await fsp.readFile(stage.file,'utf8'),'independent owned validated bytes');
  g.settle();assert.equal(g.snapshot().live,0);assert.throws(()=>g.begin('measured','running',new AbortController()));
 }finally{await g.close();}
});
