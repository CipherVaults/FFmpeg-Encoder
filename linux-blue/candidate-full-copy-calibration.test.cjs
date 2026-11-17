'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const { scanDiagnostics, assertStrictSourceDiagnostics, persistFinalReport, runCandidateFullCopyCampaign, FROZEN, SPECS } = require('./candidate-full-copy-calibration.cjs');
function probe() { return { streams: [
  { index: 0, codec_type: 'video', time_base: '1/15360', start_pts: 0, duration_ts: 15360, width: 1920, height: 1080, pix_fmt: 'yuv420p', color_range: 'tv', color_space: 'bt709', color_transfer: 'bt709', color_primaries: 'bt709' },
  { index: 1, codec_type: 'audio', time_base: '1/48000', start_pts: 0, duration_ts: 48000, channels: 2, channel_layout: 'stereo', sample_fmt: 'fltp', sample_rate: '48000' }
] }; }
async function setup(t, mutate = () => {}) {
 const root = await fs.mkdtemp(path.join(os.tmpdir(),'full-copy-diagnostic-'));t.after(()=>fs.rm(root,{recursive:true}));const calls=[];
 const run=async(exe,args,options)=>{ calls.push(args);let rows;
 if(args.includes('-show_frames')) {const video=args[args.indexOf('-select_streams')+1]==='0';rows=Array.from({length:video?30:10},(_,i)=> video ? {media_type:'video',stream_index:0,pts:i*512,duration:512,width:1920,height:1080,pix_fmt:'yuv420p',interlaced_frame:0,color_range:'tv',color_space:'bt709',color_transfer:'bt709',color_primaries:'bt709',sample_aspect_ratio:'1:1',chroma_location:'left'} : {media_type:'audio',stream_index:1,pts:i*4800,nb_samples:4800,sample_fmt:'fltp',channels:2,channel_layout:'stereo'});mutate(rows,video);rows=rows.map(x=>'frame|'+Object.entries(x).map(([k,v])=>`${k}=${v}`).join('|'));
 }else if(args.includes('-show_packets'))rows=['packet|stream_index=1|pts=0|duration=1024|data_hash=SHA256:'+'a'.repeat(64)+'|side_datum/skip_samples:side_data_type=Skip Samples|side_datum/skip_samples:skip_samples=0|side_datum/skip_samples:discard_padding=0'];
 else rows=['stream|index=1|extradata_hash=SHA256:'+'b'.repeat(64)];
 const bytes=Buffer.from(rows.join('\n')+'\n');for(let i=0;i<bytes.length;i+=17)await options.onStdoutChunk(bytes.subarray(i,i+17));return {stdout:'',stderr:'',exitCode:0,stderrCapture:{totalBytes:0,truncated:false}};};
 return {root,calls,run};
}
test('strict independent source diagnostic streams four children and never invents collector authority',async t=>{const h=await setup(t),p=probe();const d=await scanDiagnostics({file:path.join(h.root,'source'),probe:p,directory:h.root,ffprobe:'/synthetic/ffprobe',run:h.run,budget:{maxFrameBytes:100000,maxRecords:1000},source:true});assert.equal(h.calls.length,4);assertStrictSourceDiagnostics(d,p);assert.equal(d.video.frames,30);assert.equal(d.audio.samples,'48000');assert.equal(d.collectorAuthority,false);assert.equal(d.packets.first.skip_samples,'0');assert.equal(d.packets.first.discard_padding,'0');assert.ok(d.files.every(x=>x.sha256));});
test('AAC metadata/decoded discrepancy is explicit failure, not fitted or truncated',async t=>{const h=await setup(t,(rows,video)=>{if(!video)rows.at(-1).nb_samples=4801;}),p=probe();const d=await scanDiagnostics({file:'/synthetic/source',probe:p,directory:h.root,ffprobe:'/synthetic/ffprobe',run:h.run,budget:{maxFrameBytes:100000,maxRecords:1000},source:true});assert.throws(()=>assertStrictSourceDiagnostics(d,p),{code:'FULL_COPY_SOURCE_DIAGNOSTIC'});assert.equal(d.audio.samples,'48001');assert.equal(d.audio.end.n,'48001');});
test('diagnostic capacity refusal preserves raw partial file and never expands bound',async t=>{const h=await setup(t);await assert.rejects(scanDiagnostics({file:'/synthetic/source',probe:probe(),directory:h.root,ffprobe:'/synthetic/ffprobe',run:h.run,budget:{maxFrameBytes:100,maxRecords:1000},source:true}));assert.equal(h.calls.length,1);assert.ok((await fs.stat(path.join(h.root,'video.compact'))).size>0);});
test('final report persistence is exclusive and returned persisted bytes agree',async t=>{const h=await setup(t),r={status:'failed-retained',failure:{code:'ORIGINAL'}};const result=await persistFinalReport(h.root,r);assert.deepEqual(JSON.parse(await fs.readFile(result.path)),r);await assert.rejects(persistFinalReport(h.root,{status:'passed'}),{code:'EEXIST'});assert.equal(JSON.parse(await fs.readFile(result.path)).failure.code,'ORIGINAL');});
test('campaign refuses forged runtime and arbitrary qualification before creating files',async()=>{await assert.rejects(runCandidateFullCopyCampaign({verifiedRuntime:{}}));await assert.rejects(runCandidateFullCopyCampaign({verifiedRuntime:{},qualification:{}}));assert.equal(SPECS.length,3);assert.equal(FROZEN.tolerances.sampleCount,0);assert.equal(FROZEN.containerDuration,'matroska-copy-end-plus-codec-delay');});
test('genuine injected runtime campaign preserves fail-first source discrepancy and never targets or generates case2',async t=>{
 const {openCandidateCalibrationRuntime}=require('./candidate-calibration-runtime.cjs');const {createHash}=require('node:crypto');const {EventEmitter}=require('node:events');
 const hash=b=>createHash('sha256').update(b).digest('hex');const h=await setup(t);const pins={};for(const tool of ['ffmpeg','ffprobe']){const bytes=Buffer.from('synthetic '+tool);const file=path.join(h.root,tool);await fs.writeFile(file,bytes);pins[tool]={path:file,size:bytes.length,sha256:hash(bytes)};}
 const runtimeIdentity=hash(JSON.stringify(['ffmpeg','ffprobe'].map(k=>({sizeBytes:pins[k].size,sha256:pins[k].sha256}))));let generated=0,target=0;
 const p=probe();Object.assign(p.streams[0],{codec_name:'h264',profile:'High',sample_aspect_ratio:'1:1',display_aspect_ratio:'16:9',field_order:'progressive',avg_frame_rate:'30/1',r_frame_rate:'30/1',chroma_location:'left',duration_ts:122880,duration:'8',start_time:'0',disposition:{default:1},side_data_list:[{side_data_type:'Display Matrix',rotation:0,displaymatrix:'00000000: 65536 0 0\n00000001: 0 65536 0\n00000002: 0 0 1073741824'}]});Object.assign(p.streams[1],{codec_name:'aac',profile:'LC',duration_ts:384000,duration:'8',start_time:'0',disposition:{default:1}});Object.assign(p,{format:{format_name:'mov,mp4,m4a,3gp,3g2,mj2',start_time:'0',duration:'8',size:'16',nb_streams:2,nb_programs:0,nb_stream_groups:0,tags:{major_brand:'isom'}},chapters:[],programs:[],stream_groups:[]});
 const execute=async(exe,args,options)=>{const child=new EventEmitter();child.kill=()=>{};options.onChild(child);let stdout='';try{
  if(exe===pins.ffmpeg.path){if(args.includes('-progress')){target++;throw new Error('Target must not start');}generated++;await fs.writeFile(args.at(-1),'synthetic-source',{flag:'wx'});}
  else if(options.onStdoutChunk){return await h.run(exe,args,options);} // one-second diagnostic under8smetadata deliberately refuses
  else if(args.includes('-show_frames')){const interval=args[args.indexOf('-read_intervals')+1]||'0';const start=Number(interval.split('%')[0]);stdout=JSON.stringify({frames:Array.from({length:60},(_,i)=>({...p.streams[0],media_type:'video',stream_index:0,pts_time:String(start+i/30),best_effort_timestamp_time:String(start+i/30),interlaced_frame:0}))});}
  else stdout=JSON.stringify(p);
  return {stdout,stderr:'',exitCode:0,stderrCapture:{totalBytes:0,truncated:false}};
 }finally{child.emit('close',0,null);}};
 const runtime=await openCandidateCalibrationRuntime({pins,runtimeIdentity,dependencies:[]},{execute});const report=await runCandidateFullCopyCampaign({verifiedRuntime:runtime});
 t.after(async()=>{assert.ok(path.basename(report.root).startsWith('candidate-full-copy-calibration-'));await fs.rm(report.root,{recursive:true});});
 assert.equal(report.status,'failed-retained');assert.equal(report.failure.code,'FULL_COPY_SOURCE_DIAGNOSTIC');assert.equal(generated,1);assert.equal(target,0);assert.equal(report.cases.length,1);assert.equal(report.cases[0].sourceDiagnostic.video.frames,30);assert.equal(report.census.live,0);assert.equal(report.census.spawned,report.census.closed);assert.equal(report.postCloseIdentitiesVerified,true);assert.equal(report.cases[0].sourceDiagnosticAccepted,undefined);assert.equal(JSON.parse(await fs.readFile(path.join(report.root,'report.json'))).failure.code,'FULL_COPY_SOURCE_DIAGNOSTIC');await assert.rejects(runtime.requireCurrent());
});

test('strict diagnostics reject unknown fields and discontinuous copied audio without fitting',async t=>{
 const bad=await setup(t,(rows,video)=>{if(video)rows[0].unexpected='not-authorized';});await assert.rejects(scanDiagnostics({file:'/synthetic/source',probe:probe(),directory:bad.root,ffprobe:'/synthetic/ffprobe',run:bad.run,budget:{maxFrameBytes:100000,maxRecords:1000},source:true}));
 const gap=await setup(t,(rows,video)=>{if(!video)rows[5].pts++;});const p=probe();const d=await scanDiagnostics({file:'/synthetic/source',probe:p,directory:gap.root,ffprobe:'/synthetic/ffprobe',run:gap.run,budget:{maxFrameBytes:100000,maxRecords:1000},source:true});assert.ok(d.audio.gaps>0);assert.throws(()=>assertStrictSourceDiagnostics(d,p),{code:'FULL_COPY_SOURCE_DIAGNOSTIC'});
});
test('diagnostic scan forwards exact derived child deadline before any child execution',async t=>{
 const h=await setup(t);let observed;const stop=new Error('injected deadline observation stop');
 await assert.rejects(scanDiagnostics({file:'/synthetic/source',probe:probe(),directory:h.root,ffprobe:'/synthetic/nonexecutable',budget:{timeoutMs:17,maxFrameBytes:100,maxRecords:10},source:true,run:async(exe,args,options)=>{observed=options.timeoutMs;throw stop;}}),error=>error===stop);
 assert.equal(observed,17);
});
