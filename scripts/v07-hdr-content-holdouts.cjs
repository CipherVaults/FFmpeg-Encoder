'use strict';

// Parent-scheduled generation of the two independent, prospectively fixed
// holdouts. This script neither reads/mints configuration templates nor changes
// the application catalog. The first normal default-factory run judges them.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto'),{execFile}=require('node:child_process'),{promisify}=require('node:util');
const {verifyCandidateRuntime}=require('../src/candidate-runtime.cjs'),{runTool}=require('../src/process-runner.cjs');
const ROOT=path.resolve(__dirname,'..'),OWNED='F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const sha=b=>createHash('sha256').update(b).digest('hex');
const SPECS=Object.freeze([
 {name:'H1',configuration:'reviewed-V3-source',width:1920,height:1080,fps:24,frames:389,transfer:'smpte2084',preset:'medium',crf:26,bframes:3,sar:1,hue:73,saturation:0.65,master:null,cll:null,seed:'independent-hue73-389-v1'},
 {name:'H2',configuration:'reviewed-legacy-HLG-source',width:320,height:180,fps:30,frames:1800,transfer:'arib-std-b67',preset:'ultrafast',lossless:true,bframes:3,sar:0,hue:121,saturation:0.8,
  master:'G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(15000000,5)',cll:'1500,600',seed:'independent-hue121-1800-v1'},
]);
// The original H2 completed encoding but exceeded the unchanged 16 MiB source
// cap. Keep that file/report as a byte-limit negative. This independently fixed
// replacement samples one moving picture per second, then holds it at 30 fps;
// it changes picture complexity, never the qualification templates or limits.
const REPLACEMENT_SPEC=Object.freeze({...SPECS[1],name:'H2b',hue:219,saturation:0.55,motionSample:1,
 master:'G(13250,34500)B(7500,3000)R(34000,16000)WP(15635,16450)L(18000000,5)',cll:'1800,650',seed:'independent-low-motion219-1800-v2'});
async function main(){
 assert.ok(process.argv.length===2 || (process.argv.length===3&&process.argv[2]==='--replacement'));
 const specs=process.argv[2]==='--replacement'?[REPLACEMENT_SPEC]:SPECS;
 const id=randomUUID(),directory=path.join(ROOT,'artifacts/v0.7/hdr-eligibility','holdouts-'+id),owned=path.join(OWNED,'fixtures','hdr-holdouts-'+id),lock=path.join(ROOT,'artifacts/v0.7/media-job.lock');
 const report={schema:1,id,purpose:'Independent holdout generation only; no family fitting, qualification or activation',specs,startedAt:new Date().toISOString(),directory,owned,invocations:[],fixtures:[]};
 let lease,leaseStat,live=0;const save=()=>fs.writeFile(path.join(directory,'report.json'),JSON.stringify(report,null,2));
 try{
  await fs.mkdir(directory);await fs.mkdir(owned);await save();
  assert.equal((await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',"@(Get-Process ffmpeg,ffprobe,electron -ErrorAction SilentlyContinue | Select-Object ProcessName,Id) | ConvertTo-Json -Compress"],{windowsHide:true,timeout:10000})).stdout.trim(),'');
  lease=await fs.open(lock,'wx+');await lease.writeFile(JSON.stringify({id,pid:process.pid,purpose:report.purpose}));await lease.sync();leaseStat=await lease.stat({bigint:true});
  const [d,f]=await Promise.all([fs.statfs(ROOT),fs.statfs(OWNED)]);report.resources={DFreeBytes:d.bavail*d.bsize,FFreeBytes:f.bavail*f.bsize,forecastBytes:512*1024**2};assert.ok(report.resources.DFreeBytes>=25*1024**3&&report.resources.FFreeBytes>=1024**3);
  report.gpu=(await promisify(execFile)(path.join(process.env.SystemRoot,'System32/nvidia-smi.exe'),['--query-gpu=uuid,driver_version,utilization.encoder,utilization.decoder','--format=csv,noheader,nounits'],{windowsHide:true,timeout:10000,maxBuffer:65536})).stdout.trim();assert.deepEqual(report.gpu.split(',').slice(2).map(v=>Number(v.trim())),[0,0]);
  const runtime=await verifyCandidateRuntime({root:ROOT});report.runtime=runtime.verified;report.producerSha256=sha(await fs.readFile(__filename));await save();
  for(const spec of specs){
   const origin=path.join(owned,spec.name+'.mkv'),parameters=['log-level=error','repeat-headers=1','annexb=1','info=1','hdr10-opt=0','colorprim=9','transfer='+(spec.transfer==='smpte2084'?16:18),'colormatrix=9','range=0','bframes='+spec.bframes,
    'cll='+(spec.cll===null?'0':'1'),...(spec.lossless?['lossless=1']:[]),...(spec.master?['master-display='+spec.master]:[]),...(spec.cll!==null?['max-cll='+spec.cll]:[])].join(':');
   const filter=`scale=iw:ih:flags=neighbor,format=yuv420p10le,hue=h=${spec.hue}:s=${spec.saturation},${spec.motionSample?'select=not(mod(n\\,30)),fps=30,':''}setsar=${spec.sar},setparams=range=limited:color_primaries=bt2020:color_trc=${spec.transfer}:colorspace=bt2020nc`;
   const argv=['-hide_banner','-v','warning','-nostdin','-n','-f','lavfi','-i',`testsrc2=size=${spec.width}x${spec.height}:rate=${spec.fps}`,'-frames:v',String(spec.frames),'-an','-sn','-dn','-vf',filter,'-c:v','libx265','-preset',spec.preset,
    ...(!spec.lossless?['-crf',String(spec.crf)]:[]),'-x265-params',parameters,'-profile:v','main10','-pix_fmt','+yuv420p10le','-color_trc',spec.transfer,'-color_primaries','bt2020','-colorspace','bt2020nc','-color_range','tv','-chroma_sample_location','left','-dolbyvision','0','-f','matroska',origin];
   assert.equal(live,0);const call={name:spec.name,executable:runtime.ffmpeg,argv,startedAt:new Date().toISOString()};report.invocations.push(call);await save();let closed;
   const result=await runTool(runtime.ffmpeg,argv,{timeoutMs:180000,stdoutLimit:65536,stderrLimit:1024**2,onChild:c=>{live++;c.once('close',(code,signal)=>{closed={code,signal};live--;});}});
   assert.deepEqual(closed,{code:0,signal:null});assert.equal(result.stderrCapture.truncated,false);call.closed=closed;call.stderr=result.stderr;call.stderrCapture=result.stderrCapture;call.finishedAt=new Date().toISOString();
   const bytes=await fs.readFile(origin);assert.ok(bytes.length>0&&bytes.length<=16*1024**2);report.fixtures.push({name:spec.name,origin,bytes:bytes.length,sha256:sha(bytes),transfer:spec.transfer,width:spec.width,height:spec.height,frameCount:spec.frames});await save();
  }
  const manifest={schema:1,profiles:path.join(ROOT,'resources/hdr-content-configurations.json'),fixtures:report.fixtures};await fs.writeFile(path.join(directory,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx'});report.status='generated-uninspected-holdouts';
 }catch(error){report.status='failed-retained';report.failure={code:error.code,message:error.message,stderr:error.stderr,stderrCapture:error.stderrCapture};process.exitCode=1;}
 finally{assert.equal(live,0);if(lease){const named=await fs.stat(lock,{bigint:true});assert.equal(named.ino,leaseStat.ino);assert.equal(named.dev,leaseStat.dev);await lease.close();await fs.unlink(lock);report.leaseReleased=true;}report.finishedAt=new Date().toISOString();await save();console.log(JSON.stringify({directory,status:report.status,failure:report.failure,manifest:path.join(directory,'manifest.json')}));}
}
if(require.main===module)main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={SPECS};
