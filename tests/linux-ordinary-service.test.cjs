'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),Module=require('node:module');
const {EncoderService}=require('../src/encoder-service.cjs');
const {PROFILES}=require('../src/media.cjs');
const {SETTINGS}=require('../linux-blue/ordinary-cpu-policy.cjs');
async function setup(t,{expireDuringValidation=false}={}){
 let clock=0;
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-composition-'));t.after(()=>fs.rm(root,{recursive:true}));
 const input=path.join(root,'input'),output=path.join(root,'output');await fs.mkdir(input);await fs.mkdir(output);await fs.writeFile(path.join(input,'source.mp4'),'Owned textual test source, not media.');
 const probe={format:{duration:'2'},streams:[{index:0,codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',width:320,height:180,sample_aspect_ratio:'1:1',color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709',color_range:'tv',avg_frame_rate:'24/1',r_frame_rate:'24/1',disposition:{default:1}}]};
 const inspection={probe,color:{classification:'sdr',supported:true,transfer:'bt709',videoIndex:0,reasons:[]},duration:2,summary:{selectedVideoIndex:0,codec:'h264',width:320,height:180,bitDepth:8}};
 const events=[];let current=true,closed=false,lastArgs=[];
 const shell=await fs.readFile(path.resolve(__dirname,'../linux-blue/product-linux-shell.cjs'),'utf8');
 const dependencies=JSON.parse(shell.split('const DEPENDENCIES = ')[1].split(';\nfunction manifest')[0]);
 const candidate={runtimeIdentity:'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13',dependencies,pins:{ffmpeg:{path:'/injected-ffmpeg'},ffprobe:{path:'/injected-ffprobe'}},async requireCurrent(){events.push('current');assert(current,'changed runtime');},async close(){closed=true;},createRunner(){return async(exe,args)=>{
   if(exe==='/injected-ffprobe'){const tags={};for(let i=0;i<lastArgs.length;i++)if(lastArgs[i]==='-metadata'){const v=lastArgs[i+1],j=v.indexOf('=');tags[v.slice(0,j)]=v.slice(j+1);}return {stdout:JSON.stringify({format:{tags}}),stderr:'',exitCode:0};}
   events.push('encode');lastArgs=args;await fs.writeFile(args.at(-1),'Owned fake encoded test output');return {stdout:'',stderr:'',exitCode:0};
 }}};
 // Load the unchanged composition with a module-local runtime double and the real
 // EncoderService subclass. No production injection option or executable is used.
 class InjectedService extends EncoderService{constructor(options){super({...options,storageEligibility:{check:async()=>({eligible:true})},capabilities:async({run})=>{events.push('discovery');await run('/injected-ffprobe',[],{timeoutMs:1000});return {profiles:PROFILES.map(p=>({...p,available:true,supportedBitDepths:[8]})),versions:{ffmpeg:'injected'}};},inspect:async()=>{events.push('inspect');return structuredClone(inspection);},verify:()=>{if(expireDuringValidation)clock=600001;return {valid:true,errors:[]};}});}}
 const filename=path.resolve(__dirname,'../linux-blue/ordinary-cpu-service.cjs'),mod=new Module(filename,module);mod.filename=filename;mod.paths=module.paths;
 const realRequire=Module.createRequire(filename);mod.require=id=>id==='../src/encoder-service.cjs'?{EncoderService:InjectedService}:id==='./candidate-calibration-runtime.cjs'?{requireCandidateCalibrationRuntime:token=>{assert.equal(token,candidate);return token;}}:id==='./ordinary-cpu-policy.cjs'?{...realRequire(id),createPhaseRunner:invoke=>realRequire(id).createPhaseRunner(invoke,{now:()=>clock})}:id==='./ordinary-cpu-stage-guard.cjs'?{openOrdinaryStageGuard:facts=>realRequire(id).openOrdinaryStageGuard(facts,{io:{...fs,statfs:async()=>({bavail:40n*1024n**3n,bsize:1n})}})}:realRequire(id);
 mod._compile(await fs.readFile(filename,'utf8'),filename);
 const service=await mod.exports.createOrdinaryCpuService({verifiedRuntime:candidate,stateDir:path.join(root,'state')});
 const i=await service.registerFolder(input,'input'),o=await service.registerFolder(output,'output');
 return {service,events,input,output,request:{inputFolderId:i.id,outputFolderId:o.id,settings:{...SETTINGS}},setCurrent:value=>current=value,isClosed:()=>closed,advance:value=>clock+=value,requireEntry:mod.exports.requireOrdinaryEntry};
}
test('actual ordinary factory discovery, preparation, single execution and owned closure',async t=>{
 const h=await setup(t);const prepared=await h.service.prepareBatch(h.request);
 assert.equal(prepared.items.length,1);assert.equal(prepared.items[0].status,'ready',prepared.items[0].reason);
 h.service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]});await h.service.taskPromise;
 assert.equal(h.events.filter(x=>x==='encode').length,1,JSON.stringify(h.service.snapshot().items));assert.equal(h.service.snapshot().items[0].status,'success',JSON.stringify(h.service.snapshot().items));
 assert(h.events.indexOf('discovery')<h.events.indexOf('inspect'));await h.service.closeOperationResources();assert(h.isClosed());
});
test('ordinary composition rejects changed settings and explicit preservation/native entries',async t=>{
 const h=await setup(t);await assert.rejects(h.service.prepareBatch({...h.request,settings:{...SETTINGS,quality:24}}));
 const prepared=await h.service.prepareBatch(h.request),item=h.service.state.items[0],entry=h.service.plan.entries.get(item.id);
 for(const key of ['native','encodePreservation']){entry[key]={};assert.throws(()=>h.requireEntry(h.service,item));delete entry[key];}
 await fs.appendFile(path.join(h.input,'source.mp4'),'changed source');
 h.service.startBatch({planId:prepared.planId,fileIds:[item.id]});await h.service.taskPromise;assert.equal(h.events.filter(x=>x==='encode').length,0);
 await h.service.closeOperationResources();
});
test('ordinary composition refuses changed runtime before execution',async t=>{
 const h=await setup(t);const prepared=await h.service.prepareBatch(h.request);h.setCurrent(false);
 h.service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]});await h.service.taskPromise;assert.equal(h.events.filter(x=>x==='encode').length,0);await h.service.closeOperationResources();
});

test('deadline expires during validation: no publication after final child',async t=>{
 const h=await setup(t,{expireDuringValidation:true});const prepared=await h.service.prepareBatch(h.request);
 h.service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]});await h.service.taskPromise;
 assert.equal(h.events.filter(x=>x==='encode').length,1);
 assert.notEqual(h.service.snapshot().items[0].status,'success');
 assert(!(await fs.readdir(h.output)).some(name=>name.endsWith('.mkv')));
 await h.service.closeOperationResources();
});

test('completed discovery and Ready budgets do not consume user review time',async t=>{
 const h=await setup(t);await h.service.getCapabilities();h.advance(400000);
 const prepared=await h.service.prepareBatch(h.request);assert.equal(prepared.items[0].status,'ready');h.advance(130000);
 h.service.startBatch({planId:prepared.planId,fileIds:[prepared.items[0].id]});await h.service.taskPromise;
 assert.equal(h.service.snapshot().items[0].status,'success');await h.service.closeOperationResources();
});

test('candidate recipe/reset stay on fixed tuple without changing production defaults',async t=>{
 const h=await setup(t);const caps=await h.service.getCapabilities();const profile=caps.profiles[0];
 assert.equal(profile.candidateFixedSettings,true);assert.deepEqual(profile.bitDepths,[8]);assert.deepEqual(profile.supportedBitDepths,[8]);
 const recipe=h.service.getRecipe({...SETTINGS});assert.deepEqual(recipe.testedDefault.settings,SETTINGS);assert.deepEqual(recipe.testedDefault.args,recipe.args);assert.match(recipe.mediaNote,/only 8-bit/);
 assert.throws(()=>h.service.getRecipe({...SETTINGS,quality:24}));
 const prefs=await h.service.resetProfile({profileId:SETTINGS.profileId});assert.deepEqual(prefs.settingsByProfile[SETTINGS.profileId],{preset:'veryfast',quality:23});
 const prepared=await h.service.prepareBatch(h.request);assert.equal(prepared.items[0].status,'ready');
 assert.equal(PROFILES.find(p=>p.id==='h264-cpu').defaultPreset,'slower');assert.equal(PROFILES.find(p=>p.id==='h264-cpu').quality.default,24);
 await h.service.closeOperationResources();
});
