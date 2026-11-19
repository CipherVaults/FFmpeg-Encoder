'use strict';
// Explicit candidate scope, not production defaults or measured-family authority.
const assert=require('node:assert/strict');
const SETTINGS=Object.freeze({profileId:'h264-cpu',preset:'veryfast',quality:23});
const POLICY=Object.freeze({maxBatchInputs:2,maxBatchBytes:1024**3,maxBatchDurationSeconds:1800,maxInputBytes:1024**3,maxDurationSeconds:1800,maxWidth:1920,maxHeight:1080,maxRate:60,
  discoveryMs:300000,preparationMs:120000,executionMs:600000,floorBytes:27n*1024n**3n,headroomBytes:2n*1024n**3n,monitorMs:500});
function need(ok,code){if(!ok)throw Object.assign(new Error('Input or operation is outside the explicit ordinary CPU candidate.'),{code});}
function boundedRate(value){if(typeof value!=='string'||!/^\d{1,9}\/\d{1,9}$/.test(value))return false;const [n,d]=value.split('/').map(BigInt);return n>0n&&d>0n&&n<=60n*d;}
function admit({probe,settings,request,bytes}){
  need(settings&&Object.keys(settings).length===3&&Object.entries(SETTINGS).every(([k,v])=>settings[k]===v),'ORDINARY_SETTINGS');
  return admitInput({probe,request,bytes});
}
function admitInput({probe,request,bytes}){
  // Requests are normalized by shared operation-contract before reaching this boundary.
  need(request?.target==='matroska'&&request.range===null&&request.resolution==='source'&&request.audioPolicy==='copy'&&request.hdrPolicy==='preserve','ORDINARY_REQUEST');
  need(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=POLICY.maxInputBytes,'ORDINARY_SOURCE_BYTES');
  const duration=Number(probe?.format?.duration);need(Number.isFinite(duration)&&duration>0&&duration<=POLICY.maxDurationSeconds,'ORDINARY_DURATION');
  need(Array.isArray(probe.streams)&&probe.streams.length>=1&&probe.streams.length<=2&&(!probe.chapters||probe.chapters.length===0),'ORDINARY_STREAMS');
  const videos=probe.streams.filter(s=>s.codec_type==='video'),audio=probe.streams.filter(s=>s.codec_type==='audio');
  need(videos.length===1&&videos.length+audio.length===probe.streams.length&&audio.length<=1,'ORDINARY_STREAMS');
  const v=videos[0];need(v.codec_name==='h264'&&v.pix_fmt==='yuv420p'&&Number.isSafeInteger(v.width)&&v.width>0&&v.width%2===0&&v.width<=POLICY.maxWidth&&Number.isSafeInteger(v.height)&&v.height>0&&v.height%2===0&&v.height<=POLICY.maxHeight,'ORDINARY_VIDEO');
  need(v.sample_aspect_ratio==='1:1'&&v.color_space==='bt709'&&v.color_transfer==='bt709'&&v.color_primaries==='bt709'&&['tv','pc'].includes(v.color_range),'ORDINARY_COLOR_GEOMETRY');
  need(!v.tags?.rotate&&(!v.side_data_list||v.side_data_list.length===0)&&!v.disposition?.attached_pic,'ORDINARY_ORIENTATION');
  need(boundedRate(v.avg_frame_rate)&&boundedRate(v.r_frame_rate),'ORDINARY_RATE');
  for(const a of audio)need(a.codec_name==='aac'&&[1,2].includes(a.channels)&&['44100','48000'].includes(String(a.sample_rate))&&(!a.side_data_list||a.side_data_list.length===0),'ORDINARY_AUDIO');
  return Object.freeze({route:'ordinary-cpu-full-source-v1',validation:'accepted-full-validator',duration,bytes});
}
function admitBatch(entries){
  need(Array.isArray(entries)&&entries.length>=1&&entries.length<=POLICY.maxBatchInputs,'ORDINARY_BATCH_COUNT');
  const admitted=entries.map(admit);
  const bytes=admitted.reduce((n,row)=>n+row.bytes,0),duration=admitted.reduce((n,row)=>n+row.duration,0);
  need(Number.isSafeInteger(bytes)&&bytes<=POLICY.maxBatchBytes,'ORDINARY_BATCH_BYTES');
  need(Number.isFinite(duration)&&duration<=POLICY.maxBatchDurationSeconds,'ORDINARY_BATCH_DURATION');
  return Object.freeze({bytes,duration,count:admitted.length});
}
function createPhaseRunner(invoke,{now=()=>performance.now()}={}){
  assert.equal(typeof invoke,'function');let phase=null,expires=0,controller=null,closed=false,live=0,phaseTimer=null;
  function assertCurrent(){if(closed||!controller||controller.signal.aborted||now()>=expires){controller?.abort();need(false,'ORDINARY_DEADLINE');}}
  return Object.freeze({
    begin(name){need(!closed&&live===0&&['discovery','preparation','execution'].includes(name),'ORDINARY_PHASE');need(!controller?.signal.aborted,'ORDINARY_CLOSED');clearTimeout(phaseTimer);phase=name;expires=now()+POLICY[name==='discovery'?'discoveryMs':name==='preparation'?'preparationMs':'executionMs'];controller=new AbortController();phaseTimer=setTimeout(()=>controller.abort(),Math.max(1,expires-now()));phaseTimer.unref();},
    settle(name){need(live===0&&phase===name,'ORDINARY_PHASE');assertCurrent();clearTimeout(phaseTimer);phaseTimer=null;phase=null;controller=null;},
    assertCurrent,
    get signal(){assertCurrent();return controller.signal;},
    async run(executable,args,options){need(!closed&&controller&&phase,'ORDINARY_PHASE');const remaining=Math.floor(expires-now());need(remaining>0&&!controller.signal.aborted,'ORDINARY_DEADLINE');const timeout=options.timeoutMs===0||options.timeoutMs===undefined?remaining:Math.min(options.timeoutMs,remaining);need(Number.isSafeInteger(timeout)&&timeout>0,'ORDINARY_DEADLINE');const signal=options.signal?AbortSignal.any([options.signal,controller.signal]):controller.signal;let timer;live++;try{timer=setTimeout(()=>controller.abort(),remaining);return await invoke(executable,args,{...options,timeoutMs:timeout,signal});}finally{clearTimeout(timer);live--;if(signal.aborted)closed=true; }},
    abort(){clearTimeout(phaseTimer);closed=true;controller?.abort();},
    close(){need(live===0,'ORDINARY_CHILD_UNSETTLED');clearTimeout(phaseTimer);closed=true;controller?.abort();},
    state(){return {phase,closed,live};}
  });
}
module.exports={POLICY,SETTINGS,admit,admitInput,admitBatch,boundedRate,createPhaseRunner};
