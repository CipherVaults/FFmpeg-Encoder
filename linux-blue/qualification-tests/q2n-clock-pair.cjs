'use strict';
// Standalone calibration only. No encoder, output, catalog import from the app,
// general source-family grant, or clean x265/performance qualification.
const fs = require('node:fs/promises');
const { constants, lstatSync, realpathSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { manifest, loaderGuard } = require('../product-linux-shell.cjs');
const { openCandidateCalibrationRuntime } = require('../candidate-calibration-runtime.cjs');
const { readSourceIdentity, sameIdentity } = require('../../src/source-identity.cjs');
const { runTool, ToolError } = require('../../src/process-runner.cjs');
const FILE_BYTES = 85993336;
const HASHES = Object.freeze(['9c8f6229c5b00c3c6646d1144ef2f8485b34f60789c0aa716debec798d13c389',
  '21c11d41e997d1774e6d6a4be665dee8c319fc2bc5542c4fa5baec690cecbb03']);
const need = (v, m) => { if (!v) throw new ToolError('Q2N_CLOCK_PAIR', m); };
const cancel = (s) => { if (s.aborted) throw new ToolError('CANCELLED', 'Clock observation cancelled.'); };
function canonical(s) {
  need(typeof s === 'string' && path.isAbsolute(s) && path.resolve(s) === s && !/[\x00-\x1f\x7f]/.test(s), 'Canonical local path required.');
}
function measuredWindow(name) {
  need(name === 'aligned' || name === 'off-grid', 'Only the two measured ranges are known.');
  const [lo,hi] = name === 'aligned' ? [91000000,123000000] : [91013000,92087000];
  // Integer math remains exact on the finite two windows. Capture source-native
  // ticks for each stream; frame-aligned and audio-aligned are different facts.
  const tick=(us,hz)=>{ const t=us*hz/1000000; need(Number.isSafeInteger(t),'Unmeasured sub-tick window.'); return t; };
  const [vs,ve,as,ae]=[tick(lo,30000),tick(hi,30000),tick(lo,48000),tick(hi,48000)];
  const first=Math.ceil(vs/1000), end=Math.ceil(ve/1000);
  return Object.freeze({name,startUs:lo,endUs:hi,videoClock:'1/30000',videoStartTick:vs,videoEndTick:ve,
    audioClock:'1/48000',audioStartTick:as,audioEndTick:ae,frameCount:end-first,audioSampleFrames:ae-as,
    firstMs:Math.round((first*1000-vs)/30),lastMs:Math.round(((end-1)*1000-vs)/30)});
}
const ROW_KEYS = ['stream_index','pts','dts','duration','size','flags','data_hash'];
function compareClockPair(trial, control) {
  for (const x of [trial,control]) need(Array.isArray(x) && x.length===9610 && Reflect.ownKeys(x).length===9611,'Expected complete packet reports.');
  const seen = new Set(); let v=0,a=0,sample=0;
  for (let k=0;k<trial.length;k++) {
    const entries=[Object.getOwnPropertyDescriptor(trial,k),Object.getOwnPropertyDescriptor(control,k)];
    need(entries.every(d=>d && Object.hasOwn(d,'value')),'Packets must be own data entries.');
    const [x,y]=entries.map(d=>d.value);
    for (const r of [x,y]) {
      need(r && Object.getPrototypeOf(r)===Object.prototype && Reflect.ownKeys(r).length===ROW_KEYS.length
        && ROW_KEYS.every(key=>Object.hasOwn(Object.getOwnPropertyDescriptor(r,key)||{},'value')), 'Unknown, incomplete or non-inert packet.');
      need((r.stream_index===0 || r.stream_index===1) && [r.pts,r.dts,r.duration].every(Number.isSafeInteger) &&
        typeof r.size==='string' && /^[1-9][0-9]{0,6}$/.test(r.size) && Number(r.size)<=1024*1024 &&
        ['K__','___'].includes(r.flags) && typeof r.data_hash==='string' && /^SHA256:[a-f0-9]{64}$/.test(r.data_hash),'Unknown packet shape.');
    }
    need(x.stream_index===y.stream_index && x.data_hash===y.data_hash && x.size===y.size && x.flags===y.flags,'Packet order, size, flags or payload differs.');
    for(const key of ['pts','dts','duration']) {
      const same=x.stream_index===0 ? BigInt(x[key])*15360n===BigInt(y[key])*30000n : x[key]===y[key];
      need(same,'Genuine packet times differ.');
    }
    if (x.stream_index===0) {
      need(x.duration===1000 && x.dts===(v-2)*1000 && x.pts>=0 && x.pts<3750000 && x.pts%1000===0 && !seen.has(x.pts),
        'Video is not the measured continuous CFR permutation and decode order.');
      seen.add(x.pts); v++;
    } else {
      need(x.flags==='K__' && x.pts===sample && x.dts===sample && x.duration===(a===5859?384:1024) && Number(x.size)===x.duration*4,
        'Audio sample extent, order or size differs.');
      sample+=x.duration; a++;
    }
  }
  need(v===3750 && a===5860 && sample===6000000,'Incomplete stream extents.');
  return Object.freeze({videoPackets:v,audioPackets:a,audioSampleFrames:sample});
}
function assertSourceView(x,rate,file) {
  const eq=(o, obj)=>Object.entries(obj).every(([k,v])=>o?.[k]===v);
  need(x && ['programs','chapters','stream_groups'].every(k=>Array.isArray(x[k]) && !x[k].length)
    && Array.isArray(x.streams) && x.streams.length===2 && eq(x.format,{filename:file,nb_streams:2,
    nb_programs:0,nb_stream_groups:0,format_name:'mov,mp4,m4a,3gp,3g2,mj2',start_time:'0.000000',duration:'125.000000',size:String(FILE_BYTES)})
    && eq(x.format.tags,{major_brand:'qt  ',compatible_brands:'qt  '}),'Unmeasured container or inventory.');
  const [v,a]=x.streams;
  need(eq(v,{index:0,codec_type:'video',codec_name:'h264',profile:'High',codec_tag_string:'avc1',width:1920,height:1080,
    coded_width:1920,coded_height:1080,sample_aspect_ratio:'1:1',pix_fmt:'yuv420p',field_order:'progressive',bits_per_raw_sample:'8',
    color_range:'tv',color_space:'bt709',color_primaries:'bt709',color_transfer:'bt709',r_frame_rate:'30/1',avg_frame_rate:'30/1',
    start_pts:0,time_base:'1/'+rate,duration_ts:125*rate,nb_frames:'3750'}) && eq(a,{index:1,codec_type:'audio',codec_name:'pcm_s16le',
    codec_tag_string:'sowt',sample_fmt:'s16',sample_rate:'48000',channels:2,channel_layout:'stereo',bits_per_sample:16,
    initial_padding:0,time_base:'1/48000',start_pts:0,duration_ts:6000000}),'Source streams or real clock disagree.');
  for (const s of x.streams) need(!Object.hasOwn(s,'side_data_list') && s.disposition?.default===1 &&
    Object.entries(s.disposition).every(([k,v])=>v===(k==='default'?1:0)), 'Unmeasured side data, transform or role.');
}
async function identity(file,pin,signal) {
  canonical(file); cancel(signal);
  const before=await readSourceIdentity(file,{signal});
  need(before.canonicalPath===file && before.size===String(FILE_BYTES),'Exact bounded named source required.');
  const fd=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const stat=await fd.stat({bigint:true});
    need(stat.isFile() && stat.nlink===1n && ['dev','ino','size','ctimeNs','mtimeNs','birthtimeNs'].every(k=>String(stat[k])===before[k]),'Source changed at open.');
    const hash=createHash('sha256'),buf=Buffer.allocUnsafe(256*1024); let pos=0;
    while(pos<FILE_BYTES) {
      cancel(signal); const {bytesRead}=await fd.read(buf,0,Math.min(buf.length,FILE_BYTES-pos),pos);
      need(bytesRead>0,'Incomplete source.'); hash.update(buf.subarray(0,bytesRead)); pos+=bytesRead;
    }
    need(hash.digest('hex')===pin,'This is not the exact measured source.');
    const post=await fd.stat({bigint:true});
    need(['dev','ino','size','ctimeNs','mtimeNs','birthtimeNs','nlink'].every(k=>post[k]===stat[k]),'Source changed during complete read.');
    need(sameIdentity(before,await readSourceIdentity(file,{signal})),'Name changed during complete read.');
  } finally {await fd.close();}
  cancel(signal);return before;
}
// Point-in-time named-file observations, not an atomic pair snapshot or a lock
// against an external writer after return. No promise/callback between these
// checks and issuing/returning the observation. In particular the *first* file
// cannot go unexamined across awaited reads of the control or runtime shutdown.
function verifyBothNamesNow(ctx) {
  for(let i=0;i<2;i++) {
    const name=ctx.files[i], recorded=ctx.ids[i];
    const matches=s=>s.isFile() && !s.isSymbolicLink() && s.nlink===1n &&
      ['dev','ino','size','ctimeNs','mtimeNs','birthtimeNs'].every(k=>String(s[k])===recorded[k]);
    let ok;
    try {ok=recorded.canonicalPath===name && matches(lstatSync(name,{bigint:true})) &&
      realpathSync.native(name)===name && matches(lstatSync(name,{bigint:true}));}
    catch {ok=false;}
    need(ok,'A bound source name or stamp changed before settlement.');
  }
}
// Ingress for actual evidence is fixed-argv native observation, never the result
// of the exported arithmetic helper or a caller's probe/receipt/identity object.
async function openClockPair(runtimeRoot,onProbeChild) {
  canonical(runtimeRoot); need(onProbeChild===undefined || typeof onProbeChild==='function','Invalid child observer.');
  loaderGuard(); let active=null,closed=false,busy=false;
  const invalidate=()=>{const prior=active;active=null;prior?.ctl.abort();};
  async function observed(ctx,cb) {
    const signal=ctx.ctl.signal;cancel(signal); loaderGuard();
    const rt=await openCandidateCalibrationRuntime(manifest(runtimeRoot),{execute:(...args)=>{loaderGuard();return runTool(...args);}});
    try {
      await rt.requireCurrent(signal);cancel(signal);
      const result=await cb(rt,signal);
      await rt.requireCurrent(signal);cancel(signal);return result;
    } finally {await rt.close();}
  }
  const current=ctx=>{cancel(ctx.ctl.signal);need(!closed && active===ctx,'Superseded clock observation.');};
  return Object.freeze({
    async prepare(trial,control,window) {
      need(!closed && !busy,'Close or settle the preceding observation first.');
      invalidate();const ctx={ctl:new AbortController()};active=ctx;busy=true;
      try {
        ctx.window=measuredWindow(window);ctx.files=[trial,control];ctx.ids=[];canonical(trial);canonical(control);need(trial!==control,'Two distinct sources required.');
        const reports=await observed(ctx,async(rt,signal)=>{
          const runner=rt.createRunner(),reports=[];
          for(let i=0;i<2;i++){
            const f=ctx.files[i];ctx.ids.push(await identity(f,HASHES[i],signal));current(ctx);
            const r=await runner(rt.pins.ffprobe.path,['-v','error','-f','mov','-protocol_whitelist','file','-show_programs','-show_stream_groups',
              '-show_chapters','-show_format','-show_streams','-show_packets','-show_data_hash','sha256','-show_entries',
              'packet=stream_index,pts,dts,duration,size,flags,data_hash,side_data_list:stream:format:chapter:program:stream_group','-of','json',f],
            {signal,timeoutMs:25000,stdoutLimit:5*1024*1024,stderrLimit:4096,
              onChild:child=>{if(onProbeChild)onProbeChild(Object.freeze({tool:'ffprobe',pid:child.pid}));}});
            current(ctx);need(r.exitCode===0 && r.stderrCapture?.totalBytes===0,'Native inventory did not settle cleanly.');
            const x=JSON.parse(r.stdout);assertSourceView(x,i===0?30000:15360,f);reports.push(x.packets);
            need(sameIdentity(ctx.ids[i],await readSourceIdentity(f,{signal})),'Source changed around native probe.');
          }
          return compareClockPair(...reports);
        });
        // Recheck both names, not merely the second one just observed.
        for(let i=0;i<2;i++)need(sameIdentity(ctx.ids[i],await readSourceIdentity(ctx.files[i],{signal:ctx.ctl.signal})),'Source changed before case binding.');
        current(ctx);verifyBothNamesNow(ctx);ctx.token=Object.freeze({});ctx.result=Object.freeze({scope:'measured-source-pair-only; not encode authorization',
          cleanThreadedQualification:false,window:ctx.window,packets:reports});
        return ctx.token;
      } catch(err){if(active===ctx)invalidate();throw err;} finally {busy=false;}
    },
    async requireCurrent(token) {
      const ctx=active;need(!closed && !busy && ctx?.token && token===ctx.token,'Foreign, incomplete or stale clock observation.');
      busy=true;
      try {
        await observed(ctx,async(rt,signal)=>{for(let i=0;i<2;i++)need(sameIdentity(ctx.ids[i],await identity(ctx.files[i],HASHES[i],signal)),'Bound source is stale.');});
        current(ctx);verifyBothNamesNow(ctx);return ctx.result;
      } catch(err){if(active===ctx)invalidate();throw err;} finally {busy=false;}
    },
    // cancel()/close() invalidate immediately. Await the in-flight operation for native retirement.
    cancel:invalidate,
    close(){closed=true;invalidate();}
  });
}
module.exports={compareClockPair,measuredWindow,openClockPair};
