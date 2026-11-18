'use strict';
// Deterministic schema specimens ONLY. Never written at production artifact paths,
// never accepted by a live pinned factory, never evidence of executed media.
const path=require('node:path'),fs=require('node:fs/promises'),vm=require('node:vm');
const {createHash}=require('node:crypto'),{createRequire}=require('node:module');
const resources=require('../../src/operation-resource-budget.cjs');
const {frozenQualifications}=require('../../scripts/v07-sdr-flac-range-calibration.cjs');
const {RUNTIME_ID}=require('../runtime-av1.cjs');
const settings={profileId:'h265-cpu',preset:'slow',quality:25};
const sha=b=>createHash('sha256').update(b).digest('hex'),bytes=v=>Buffer.from(JSON.stringify(v));
const definitions={keep720:['workbench-long-range-service.cjs','FAMILY_ID','RESOURCE_POLICY','deriveCfrFlacResources'],resize1080to720:['workbench-resize-service.cjs','RESIZE_FAMILY_ID','RESIZE_RESOURCE_POLICY','deriveCfrResizeFlacResources'],fullResize1080to720:['workbench-full-resize-service.cjs','FULL_RESIZE_FAMILY_ID','FULL_RESIZE_RESOURCE_POLICY','deriveCfrFullResizeFlacResources'],fullResize1440to720:['workbench-full-1440-service.cjs','FULL_1440_RESIZE_FAMILY_ID','FULL_1440_RESIZE_RESOURCE_POLICY','deriveCfrFull1440ResizeFlacResources']};
function calibration(kind) {
 const def=definitions[kind];if(!def)throw new Error('Unknown synthetic kind');
 const module=require('../'+def[0]),full=kind.startsWith('full'),fourth=kind==='fullResize1440to720',resize=kind!=='keep720',width=fourth?2560:resize?1920:1280,height=fourth?1440:resize?1080:720;
 const ids=full?(fourth?['full-1440-pattern','full-1440-heldout-tail']:['full-long-pattern','full-heldout-tail']):['long-pattern','heldout-flipped'];
 const sources=ids.map((id,i)=>{
  const videoUs=fourth?(i?7100000:12000000):full?(i?43100000:150000000):(i?11000000:150000000),audioUs=full?(fourth?(i?7217000:12000000):(i?43217000:150000000)):videoUs;
  const probe={streams:[{index:0,codec_type:'video',codec_name:'h264',profile:'High',width,height,pix_fmt:'yuv420p',field_order:'progressive',sample_aspect_ratio:'1:1',display_aspect_ratio:'16:9',avg_frame_rate:'30/1',r_frame_rate:'30/1',time_base:'1/15360',start_pts:0,start_time:'0',duration:String(videoUs/1e6),duration_ts:videoUs*15360/1e6,color_transfer:'bt709',color_space:'bt709',color_primaries:'bt709',color_range:'tv',chroma_location:'left'},
   {index:1,codec_type:'audio',codec_name:'pcm_s16le',sample_fmt:'s16',sample_rate:'48000',channels:2,channel_layout:'stereo',time_base:'1/48000',start_pts:0,start_time:'0',duration:String(audioUs/1e6),duration_ts:audioUs*48000/1e6}],format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',duration:String(audioUs/1e6),start_time:'0',size:'100000000',nb_streams:2,nb_programs:0,nb_stream_groups:0,tags:{major_brand:'qt  '}},programs:[],stream_groups:[],chapters:[]};
  return {id,sourceExtentUs:audioUs,sha256:(i?'b':'a').repeat(64),identity:{size:'100000000'},probe,frozen:frozenQualifications(`${path.basename(path.dirname(module.REPORT))}:${id}`,RUNTIME_ID,probe)};
 });
 const specs=full?[[fourth?'full-1440':'full-long',0,null],[fourth?'full-1440-heldout-audio-tail':'full-heldout-audio-tail',1,null]]:[['late-forty-seconds',0,{startUs:100000000,endUs:140000000}],['late-open-end',0,{startUs:130000000}],['heldout-nonaligned',1,{startUs:413000,endUs:8621000}]];
 const cases=specs.map(([id,i,range])=>{const s=sources[i],start=range?.startUs||0,end=range?.endUs??s.sourceExtentUs;
  const frames=full?Number(s.probe.streams[0].duration_ts)*30/15360:Math.ceil(end*30/1e6)-Math.ceil(start*30/1e6),samples=full?Number(s.probe.streams[1].duration_ts):Math.ceil(end*48000/1e6)-Math.ceil(start*48000/1e6);
  return {id,sourceId:s.id,range,status:'passed',validation:{valid:true,...(full?{timing:{timeline:'source-timestamps',requested:null,resolved:null}}:{})},resources:resources[def[3]]({sourceExtentUs:s.sourceExtentUs,selectedExtentUs:end-start,sourceBytes:s.identity.size}),pipeBytes:1,elapsedMs:1,frames,samples,pcmIdentity:{sourceHash:'c'.repeat(64),outputHash:'c'.repeat(64)},completeSource:{video:{frames:full?frames:s.sourceExtentUs*30/1e6,properties:{policy:resources[def[1]]}},audio:[{sampleCount:String(full?samples:s.sourceExtentUs*48000/1e6)}]}};
 });
 return {syntheticSchemaFixture:true,status:'passed-pre-catalog-calibration',runtimeIdentity:RUNTIME_ID,resourcePolicy:resources[def[2]],publicationAuthorized:false,catalogActivated:false,settings:{...settings},census:{spawned:34,closed:34,live:0,maximum:1},...(resize?{geometry:{sourceWidth:width,sourceHeight:height,resolution:'720',outputWidth:1280,outputHeight:720}}:{}),sources,cases};
}
function serviceProof(kind) {
 const c=calibration(kind),ids=c.sources.flatMap(s=>[s.frozen.qualification.evidenceId,s.frozen.timingQualification.evidenceId]),full=kind.startsWith('full'),fourth=kind==='fullResize1440to720',resize=kind!=='keep720';
 const names=[...(fourth?['full-1440','full-1440-calibrated-audio-tail','fresh-independent-full-1440-audio-tail']:full?['full-long','full-calibrated-audio-tail','fresh-independent-full-audio-tail']:['long-late-forty','long-open-end','fresh-independent-nonaligned']),'real-encode-cancelled-no-publication','fresh-success-after-encode-cancel','real-evidence-cancelled-no-publication','fresh-success-after-evidence-cancel','existing-output-preserved'];
 const cases=names.map((name,i)=>{
  if(i===7)return {case:name,status:'passed',item:{status:'skipped'}};
  if(i===3||i===5)return {case:name,status:'passed',observed:{childLive:true,kind:i===3?'encode':'complete-source-evidence',progress:{ended:false},bytesObserved:1},item:{status:'cancelled',cleanup:{retained:true},outputDisposition:{published:false,kind:'retained-unverified',validationCurrent:false}}};
  const frames=fourth?(i===0?360:i===1?213:120):full?(i===0?4500:i===1?1293:120):(i===0?1200:i===1?600:246),samples=fourth?(i===0?576000:i===1?346416:197616):full?(i===0?7200000:i===1?2074416:197616):frames*1600;
  return {case:name,status:'passed',frames,samples,elapsedMs:1,item:{status:'success',outputDisposition:{published:true},sourceAssessment:{kind:'unchanged'},operationRequest:{resolution:resize?'720':'source',audioPolicy:'precision-flac',range:full?null:{startUs:0,endUs:1000000}},timing:{timeline:full?'source-timestamps':'request-relative',requested:null,resolved:null},evidenceStorage:{final:{recordPersisted:true,violations:[]}}},accounting:{status:'completed',failure:null,evidenceIds:ids,sourceIdentityDisposition:'unchanged',telemetryValidation:{valid:true},children:2,streamedBytes:10,pipeBytes:{stdout:5,stderr:5}},limits:{executionBudgetMs:100,maxChildren:3,evidenceBytes:100,pipeBytes:100,evidenceReserveBytes:100},reservation:{forecastBytes:100,reservedBytes:100},pcmIdentity:{format:'s16le-interleaved',sourceHash:'d'.repeat(64),outputHash:'d'.repeat(64),sourceBytes:samples*4,outputBytes:samples*4},...(resize?{geometry:{output:{width:1280,height:720}},orientationQualification:{runtimeIdentity:RUNTIME_ID}}:{})};
 });
 return {syntheticSchemaFixture:true,status:fourth?'passed-developer-full-1440-service-proof':full?'passed-developer-full-resize-service-proof':resize?'passed-developer-resize-service-proof':'passed-developer-long-range-service-proof',appActivated:false,census:{spawned:80,closed:80,live:0,maximum:1,encodes:7},...(resize?{geometry:c.geometry}:{}),cases};
}
// The real builder/validators run through deterministic test-only byte inputs.
// No private selector/observer brand is mocked. Unsupported Full-FLAC descriptors
// must still refuse after receipt validation, never yield invented controls.
async function controlsFixture({rejectFourth=false,mutateProof}={}) {
 const file=path.resolve(__dirname,'../workbench-qualified-encode-controls.cjs'),real=createRequire(file),module={exports:{}},map=new Map(),proofs={},counts={reads:[],validated:[],tools:[],fourthLoads:0,runner:0};
 const modules={};
 for(const [kind,def] of Object.entries(definitions)) {
  const live=real('./'+def[0]),cal=bytes(calibration(kind)),proof=serviceProof(kind);if(mutateProof)mutateProof(proof,kind);
  const raw=bytes(proof),proofPath=path.resolve('/synthetic-schema-only',kind+'.json');map.set(live.REPORT,cal);map.set(proofPath,raw);proofs[kind]={report:proofPath,sha256:sha(raw)};
  const key=kind==='keep720'?'assertLongRangeReceipt':kind==='resize1080to720'?'assertResizeReceipt':kind==='fullResize1080to720'?'assertFullResizeReceipt':'assertFull1440Receipt';
  modules['./'+def[0]]={...live,REPORT_SHA:sha(cal),[key]:b=>{counts.validated.push(kind);return live[key](b,sha(cal));}};
 }
 const observerPath=path.resolve(__dirname,'../../src/operation-runtime.cjs'),observerBytes=await fs.readFile(observerPath);map.set(observerPath,observerBytes);
 const original=await fs.readFile(file,'utf8');let source=original.replace(/const SERVICE_PROOFS = Object\.freeze\(\{[\s\S]*?\n\}\);/,`const SERVICE_PROOFS = Object.freeze(${JSON.stringify(proofs)});`).replace(/const OBSERVER_SHA = '[a-f0-9]{64}';/,`const OBSERVER_SHA = '${sha(observerBytes)}';`);
 if(source===original)throw new Error('Test constant replacement failed');
 const overrides={'node:fs/promises':{...fs,readFile:async n=>{counts.reads.push(n);if(!map.has(n))throw new Error('Unexpected synthetic read '+n);return map.get(n);}},'./runtime-av1.cjs':{...real('./runtime-av1.cjs'),verifyAv1Tool:async k=>counts.tools.push(k)},'./runtime-av1-operation.cjs':{createAv1ProportionalRunner(){counts.runner++;throw new Error('No runner permitted');}}};
 vm.runInThisContext(`(function(require,module,exports,__dirname){${source}\n})`,{filename:file})(n=>{if(n==='./workbench-full-1440-service.cjs'){counts.fourthLoads++;if(rejectFourth)throw Object.assign(new Error('inactive fourth unavailable'),{code:'TEST_1440_UNAVAILABLE'});}return modules[n]||overrides[n]||real(n);},module,module.exports,path.dirname(file));
 return {api:module.exports,counts};
}
module.exports={calibration,serviceProof,controlsFixture,bytes,sha};
