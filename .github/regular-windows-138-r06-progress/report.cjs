'use strict';
const assert=require('node:assert/strict');
const hex=(n,s)=>typeof s==='string'&&new RegExp('^[a-f0-9]{'+n+'}$').test(s);
const readbacks=['harness','product','packageInputs'];
const phases=new Set(['authority','build','owned-input','fixture','launch','security','prepare','encode','readback','ax-keyboard','ax-outcome','close','report']);
function diagnostic(value){
  assert(value&&phases.has(value.phase)&&/^[A-Z][A-Z0-9_]{0,63}$/.test(value.code));
  return {phase:value.phase,code:value.code};
}
function pin(value){
  assert(hex(64,value.sha256)&&Number.isSafeInteger(value.sizeBytes)&&value.sizeBytes>0&&value.sizeBytes<=2**31);
  return {sha256:value.sha256,sizeBytes:value.sizeBytes};
}
function observationGap(result){
  if(!result?.observations||!result.progressFeed)return null;
  const ax=result.runningInAx==='observed',pct=result.observations.stableNumeric>0&&result.progressFeed.advances>0;
  return ax&&pct?null:ax?'R06_LIVE_PERCENT_NOT_OBSERVED':pct?'R06_RUNNING_AX_NOT_OBSERVED':'R06_LIVE_AX_AND_PERCENT_NOT_OBSERVED';
}
const missing=new Set(['R06_LIVE_PERCENT_NOT_OBSERVED','R06_RUNNING_AX_NOT_OBSERVED','R06_LIVE_AX_AND_PERCENT_NOT_OBSERVED']);
function report({id,harnessTree,policy,result,build,postRunReadback,failure}){
  assert(hex(40,id.head)&&hex(40,id.seed)&&hex(40,harnessTree)&&/^[1-9]\d{0,18}$/.test(id.runId)&&id.attempt===1);
  assert(hex(40,policy.source)&&hex(40,policy.tree)&&hex(64,policy.productInputs));
  const post={};for(const key of readbacks){
    assert(['verified','failed','not-run'].includes(postRunReadback[key]));post[key]=postRunReadback[key];
  }
  const r={schema:'windows-packaged-r06-genuine-live-progress/v2',head:id.head,seed:id.seed,harnessTree,runId:id.runId,attempt:1,
    productHead:policy.source,productTree:policy.tree,packageInputsSha256:policy.productInputs,requiredFreeBytes:String(policy.floor),
    state:failure?(missing.has(failure.code)?'R06_LIVE_PROGRESS_INCOMPLETE':'R06_LIVE_PROGRESS_FAILED'):'R06_LIVE_PROGRESS_PASSED',failure:failure?diagnostic(failure):null,postRunReadback:post,
    input:'single-owned-synthetic',picker:'substituted-dialog-return',accessibility:'chromium-accessibility-tree-and-dom-not-native-at',
    desktop:'no-native-desktop-or-real-screen-reader-claim',gpu:'not-qualified',distribution:'report-only'};
  if(build)r.build=Object.fromEntries(['asar','executable','zip'].map(k=>[k,pin(build[k])]));
  if(result){
    r.journey={};
    const j=r.journey;
    for(const key of ['fixtureGenerationCalls','keyboardStarts','probeReadbackCalls']){assert(Number.isInteger(result[key])&&result[key]>=0&&result[key]<=1);j[key]=result[key];}
    for(const key of ['sourceUnchanged','packageUnchanged','keyboardNavigation','persistentTerminalAx'])j[key]=result[key]===true;
    assert(['pending','normal','unconfirmed','forced-owned-tree'].includes(result.close));j.close=result.close;
    if(result.runningInAx!==undefined){assert(['observed','not-observed'].includes(result.runningInAx));j.runningInAx=result.runningInAx;}
    if(result.launchOwnership){assert.equal(result.launchOwnership,'verified-shell-launcher-and-pinned-main');j.launchOwnership=result.launchOwnership;}
    if(result.security){j.security={};for(const key of ['packaged','sandbox','contextIsolation','nodeIntegration']){
      assert(typeof result.security[key]==='boolean');j.security[key]=result.security[key];
    }}
    if(result.cleanupFailure)j.cleanupFailure=diagnostic(result.cleanupFailure);
    if(result.output){j.output=pin(result.output);assert(j.output.sizeBytes<16*1024*1024);}
    if(result.processObservation){
      const o=result.processObservation;assert(['sampled-not-exhaustive','unobserved-launch'].includes(o.kind));j.processObservation={kind:o.kind};
      for(const key of ['samples','observedDescendants','observedStartupMedia','observedLiveAfterClose']){
        if(key==='observedLiveAfterClose'&&o.kind==='unobserved-launch')assert.equal(o[key],null);
        else assert(Number.isInteger(o[key])&&o[key]>=0&&o[key]<=1200);
        j.processObservation[key]=o[key];
      }
    }
    if(result.observations){
      const o=result.observations;j.observations={};
      for(const key of ['stage','terminal','stableNumeric','duplicates']){assert(Number.isInteger(o[key])&&o[key]>=0&&o[key]<=384);j.observations[key]=o[key];}
      assert.equal(o.percentContrast,o.stableNumeric?'observed':'not-observed');j.observations.percentContrast=o.percentContrast;
    }
    if(result.progressFeed){
      const feed=result.progressFeed;j.progressFeed={};
      for(const key of ['eligible','corroborated','advances']){assert(Number.isInteger(feed[key])&&feed[key]>=0&&feed[key]<=384);j.progressFeed[key]=feed[key];}
      assert(feed.corroborated<=feed.eligible&&feed.advances<=Math.max(0,feed.corroborated-1));
      assert.equal(j.observations?.stableNumeric,feed.advances);
    }
  }
  if(missing.has(failure?.code))assert.equal(observationGap(result),failure.code);
  if(!failure){
    assert(Object.values(post).every(v=>v==='verified'));const j=r.journey;
    assert(r.build&&j&&j.output&&j.fixtureGenerationCalls===1&&j.keyboardStarts===1&&j.probeReadbackCalls===1);
    assert(j.sourceUnchanged&&j.packageUnchanged&&j.keyboardNavigation&&j.persistentTerminalAx&&j.close==='normal'&&!j.cleanupFailure);
    assert(j.launchOwnership&&j.security?.packaged&&j.security.sandbox&&j.security.contextIsolation&&!j.security.nodeIntegration);
    assert(j.runningInAx);assert(j.observations?.stage>0&&j.observations.terminal===1&&j.observations.duplicates===0);
    assert(j.processObservation?.kind==='sampled-not-exhaustive'&&j.processObservation.samples>0&&j.processObservation.observedLiveAfterClose===0);
    assert.equal(observationGap(result),null);assert(j.progressFeed?.advances>0&&j.runningInAx==='observed');
  }
  return r;
}
module.exports={report,diagnostic,observationGap};
