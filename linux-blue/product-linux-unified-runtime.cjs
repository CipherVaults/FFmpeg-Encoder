'use strict';
// Private per-Prepare generation. It never owns UI/history or revives a token.
const assert = require('node:assert/strict');
const path = require('node:path');
const { openCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { manifest, loaderGuard } = require('./product-linux-shell.cjs');
const { invocation } = require('./product-linux-remux-service.cjs');
const { clockGuardedRunner } = require('./workbench-long-range-service.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { POLICY } = require('./ordinary-cpu-policy.cjs');
const { runTool } = require('../src/process-runner.cjs');
const { RemuxOperations } = require('../src/remux-operation.cjs');
async function openUnifiedGeneration(runtimeRoot, stateDir, onChild) {
  loaderGuard(); const candidate = await openCandidateCalibrationRuntime(manifest(runtimeRoot));
  let phase = null, closed = false, retired = false, closePromise, observer;
  const remuxControls=new WeakMap();
  const ordinary = candidate.createRunner({ onChild });
  const measured = clockGuardedRunner(ordinary, candidate.pins.ffprobe.path);
  async function current(signal) { assert(!closed); loaderGuard(); await candidate.requireCurrent(signal); assert(!closed); }
  function phaseCurrent(owner) { if(owner.control)assert.strictEqual(owner.control.requireCurrent(),owner.control.selected,'Remux selected costs changed'); assert(!closed && phase === owner && !owner.signal.aborted && performance.now() < owner.expires, 'Operation phase retired or expired'); }
  async function run(executable, args, options = {}) {
    const owner = phase; assert(owner); phaseCurrent(owner);
    const signal = options.signal ? AbortSignal.any([owner.signal, options.signal]) : owner.signal;
    assert(!signal.aborted); if(owner.route === 'remux') invocation(candidate.pins, executable, args, options, path.join(stateDir,'operation-evidence'));
    assert(++owner.calls <= owner.maxChildren, 'Operation invocation ceiling');
    owner.live++;
    try {
      await current(signal); phaseCurrent(owner); assert(!signal.aborted);
      const remaining = Math.floor(owner.expires - performance.now()); assert(remaining > 0);
      const timeoutMs = Math.min(options.timeoutMs || remaining, remaining, owner.childMs || remaining);
      const supplied = {...options, signal, timeoutMs};
      if (owner.route !== 'remux') return await (owner.route === 'measured' ? measured : ordinary)(executable, args, supplied);
      let result, failure;
      try { result = await runTool(executable,args,{...supplied,onChild(child){onChild?.(child);options.onChild?.(child);}}); } catch(error) { failure=error; }
      try { await current(); } catch(error) { if(failure) throw new AggregateError([failure,error],'Invocation and integrity failure'); throw error; }
      if(failure)throw failure;return result;
    } finally { owner.live--; }
  }
  try {
    observer = new OperationRuntimeObserver({runtime:Object.fromEntries(Object.entries(candidate.pins).map(([k,v])=>[k,v.path])),pins:Object.fromEntries(Object.entries(candidate.pins).map(([k,v])=>[k,{sizeBytes:v.size,sha256:v.sha256}])),run});
    return Object.freeze({candidate,observer,run,current,
      bindRemux(operations,selection,bindings){
        assert(!closed&&!retired&&!phase&&operations instanceof RemuxOperations&&typeof bindings==='function');
        const requireCurrent=()=>RemuxOperations.prototype.requireCurrent.call(operations,selection,bindings());
        const selected=requireCurrent();assert(selected.remux&&selected.qualification.inputFamily==='isobmff'&&selected.qualification.target==='mp4');
        const token=Object.freeze({});remuxControls.set(token,Object.freeze({kind:'remux-mp4',selected,requireCurrent}));return token;
      },
      begin(route,kind,controller,token=null) {
        const control=token===null?null:remuxControls.get(token);assert(token===null||control,'Only this generation issued Remux control is admitted');
        assert(!closed&&!retired&&!phase&&['ordinary','av1-ordinary','h265-ordinary','measured','remux','discovery'].includes(route));
        assert(controller instanceof AbortController);
        let ms=kind==='checking'?POLICY.discoveryMs:kind==='preparing'&&['ordinary','av1-ordinary'].includes(route)?POLICY.preparationMs:POLICY.executionMs;
        let maxChildren=route==='remux'?32:128,childMs=route==='remux'?120000:null;
        if(control){
          assert(route==='remux'&&kind==='running'&&Object.isFrozen(control)&&control.kind==='remux-mp4');
          const q=control.requireCurrent();assert.strictEqual(q,control.selected);assert(Object.isFrozen(q)&&Object.isFrozen(q.budget)&&Object.isFrozen(q.resources));
          assert(q.remux&&q.qualification.inputFamily==='isobmff'&&q.qualification.target==='mp4');
          for(const n of [q.executionBudgetMs,q.budget.timeoutMs,q.resources.maxChildren])assert(Number.isSafeInteger(n)&&n>0);
          ms=q.executionBudgetMs;childMs=q.budget.timeoutMs;maxChildren=q.resources.maxChildren;
        }
        const owner={route,kind,controller,control,signal:controller.signal,expires:performance.now()+ms,maxChildren,childMs,calls:0,live:0,timer:null};
        if(control){
          const tick=()=>{if(phase!==owner)return;if(performance.now()>=owner.expires)controller.abort();else{owner.timer=setTimeout(tick,Math.min(1000,Math.max(1,owner.expires-performance.now())));owner.timer.unref?.();}};
          owner.timer=setTimeout(tick,Math.min(1000,ms));
        }else owner.timer=setTimeout(()=>controller.abort(),ms);
        owner.timer.unref?.();phase=owner;
      },
      settle(){if(!phase)return;assert.equal(phase.live,0,'Owned invocations unsettled');if(phase.signal.aborted||performance.now()>=phase.expires){retired=true;phase.controller.abort();}clearTimeout(phase.timer);phase=null;},
      abort(){phase?.controller.abort();},
      assertCurrent(){assert(phase);phaseCurrent(phase);},
      get signal(){assert(phase);phaseCurrent(phase);return phase.signal;},
      snapshot(){return {closed,phase:phase?.kind||null,live:phase?.live||0};},
      close(){return closePromise ||= (async()=>{assert(!phase||phase.live===0,'Cannot retire live generation');closed=true;if(phase)clearTimeout(phase.timer);const errors=[];try{await observer.close();}catch(e){errors.push(e);}try{await candidate.close();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Generation closure failed');phase=null;})();}
    });
  } catch(error){await candidate.close();throw error;}
}
module.exports={openUnifiedGeneration};
