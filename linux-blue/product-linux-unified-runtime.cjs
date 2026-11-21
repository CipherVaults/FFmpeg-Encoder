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
const { runTool, ToolError } = require('../src/process-runner.cjs');
const { RemuxOperations } = require('../src/remux-operation.cjs');
const {CELL:TWO_AAC_CELL}=require('./product-two-aac-owner.cjs');
const twoAac=control=>control?.kind==='remux-isobmff'&&control.selected.qualification.cellId===TWO_AAC_CELL;
const { OperationFamilySelector, isProportionalFamilySelection } = require('../src/operation-family.cjs');
const TIMER_MAX_MS=2147483647;
async function openUnifiedGeneration(runtimeRoot, stateDir, onChild, measuredSelector=null) {
  assert(measuredSelector===null||measuredSelector instanceof OperationFamilySelector);
  // The actual product factory method retains the qualified source clock check.
  const currentMeasured=measuredSelector?.requireCurrent.bind(measuredSelector);
  loaderGuard(); const candidate = await openCandidateCalibrationRuntime(manifest(runtimeRoot));
  let phase = null, closed = false, retired = false, closePromise, observer;
  const remuxControls=new WeakMap(), measuredControls=new WeakMap();
  const ordinary = candidate.createRunner({ onChild });
  const measured = clockGuardedRunner(ordinary, candidate.pins.ffprobe.path);
  async function current(signal) { assert(!closed); loaderGuard(); await candidate.requireCurrent(signal); assert(!closed); }
  function phaseCurrent(owner) {
    if(owner.control){
      try{assert.strictEqual(owner.control.requireCurrent(),owner.control.selected,'Selected operation costs changed');}
      catch(error){if(owner.control.kind==='measured-h265'||twoAac(owner.control))retired=true;throw error;}
    }
    if(owner.control?.kind==='measured-h265'&&performance.now()>=owner.expires)
      throw new ToolError('OPERATION_DEADLINE','The measured operation exceeded its total deadline.');
    assert(!closed&&!retired&&phase===owner&&!owner.signal.aborted&&performance.now()<owner.expires,'Operation phase retired or expired');
  }
  async function run(executable, args, options = {}) {
    const owner = phase; assert(owner); phaseCurrent(owner);
    const signal = options.signal ? AbortSignal.any([owner.signal, options.signal]) : owner.signal;
    assert(!signal.aborted);
    if(owner.route === 'remux') invocation(candidate.pins, executable, args, options, path.join(stateDir,'operation-evidence'),
      owner.kind==='running' && owner.control?.kind==='remux-isobmff' && !twoAac(owner.control)
        && owner.control.selected.verificationMethod==='packet-identity-v1');
    assert(++owner.calls <= owner.maxChildren, 'Operation invocation ceiling');
    owner.live++;
    try {
      await current(signal); phaseCurrent(owner); assert(!signal.aborted);
      const remaining = Math.floor(owner.expires - performance.now()); assert(remaining > 0);
      const timeoutMs = Math.min(options.timeoutMs || remaining, remaining, owner.childMs || remaining);
      const supplied = {...options, signal, timeoutMs};
      if (owner.route !== 'remux') {
        const result=await (owner.route === 'measured' ? measured : ordinary)(executable,args,supplied);
        if(owner.control?.kind==='measured-h265'){
          if(signal.aborted)throw new ToolError('CANCELLED','Measured operation cancelled.');
          phaseCurrent(owner);
        }
        return result;
      }
      let result, failure;
      try { result = await runTool(executable,args,{...supplied,onChild(child){onChild?.(child);options.onChild?.(child);}}); } catch(error) { failure=error; }
      try { await current(); } catch(error) { if(failure) throw new AggregateError([failure,error],'Invocation and integrity failure'); throw error; }
      if(failure)throw failure;
      if(twoAac(owner.control)){phaseCurrent(owner);if(signal.aborted)throw new ToolError('CANCELLED','Two-track remux cancelled.');}
      return result;
    } finally { owner.live--; }
  }
  try {
    observer = new OperationRuntimeObserver({runtime:Object.fromEntries(Object.entries(candidate.pins).map(([k,v])=>[k,v.path])),pins:Object.fromEntries(Object.entries(candidate.pins).map(([k,v])=>[k,{sizeBytes:v.size,sha256:v.sha256}])),run});
    return Object.freeze({candidate,observer,run,current,
      bindRemux(operations,selection,bindings){
        assert(!closed&&!retired&&!phase&&operations instanceof RemuxOperations&&typeof bindings==='function');
        const requireCurrent=()=>RemuxOperations.prototype.requireCurrent.call(operations,selection,bindings());
        const selected=requireCurrent();assert(selected.remux&&selected.qualification.inputFamily==='isobmff'&&['mp4','matroska','mov'].includes(selected.qualification.target));
        const token=Object.freeze({});remuxControls.set(token,Object.freeze({kind:'remux-isobmff',selected,requireCurrent}));return token;
      },
      bindMeasured(selection,bindings){
        assert(!closed&&!retired&&!phase&&currentMeasured&&typeof bindings==='function');
        const requireCurrent=()=>{
          const b=bindings(),q=currentMeasured(selection,b);
          assert(isProportionalFamilySelection(q,b.plan)&&q.controlsRequired&&q.qualification.runtimeIdentity===candidate.runtimeIdentity);
          return q;
        };
        const selected=requireCurrent(),token=Object.freeze({});
        measuredControls.set(token,Object.freeze({kind:'measured-h265',selected,requireCurrent}));return token;
      },
      begin(route,kind,controller,token=null) {
        const control=token===null?null:measuredControls.get(token)||remuxControls.get(token);
        assert(token===null||control,'Only this generation issued operation control is admitted');
        assert(!closed&&!retired&&!phase&&['ordinary','av1-ordinary','h265-ordinary','measured','remux','discovery'].includes(route));
        assert(controller instanceof AbortController);
        let ms=kind==='checking'?POLICY.discoveryMs:kind==='preparing'&&['ordinary','av1-ordinary'].includes(route)?POLICY.preparationMs:POLICY.executionMs;
        let maxChildren=route==='remux'?32:128,childMs=route==='remux'?120000:null;
        if(control){
          assert(kind==='running'&&Object.isFrozen(control));
          const proportionalEncode=control.kind==='measured-h265';
          if(proportionalEncode){
            assert(route==='measured');
            measuredControls.delete(token); // One valid-route Start attempt, never replayable.
          }else{assert(route==='remux'&&control.kind==='remux-isobmff');if(twoAac(control))remuxControls.delete(token);}
          const q=control.requireCurrent();assert.strictEqual(q,control.selected);assert(Object.isFrozen(q)&&Object.isFrozen(q.budget)&&Object.isFrozen(q.resources));
          for(const n of [q.executionBudgetMs,q.budget.timeoutMs,q.resources.maxChildren])assert(Number.isSafeInteger(n)&&n>0);
          if(proportionalEncode){
            assert(q.executionBudgetMs<=TIMER_MAX_MS&&q.budget.timeoutMs<=q.executionBudgetMs&&q.resources.maxChildren<=maxChildren);
          }else assert(q.remux&&q.qualification.inputFamily==='isobmff'&&['mp4','matroska','mov'].includes(q.qualification.target));
          ms=q.executionBudgetMs;childMs=q.budget.timeoutMs;maxChildren=q.resources.maxChildren;
        }
        const owner={route,kind,controller,control,controlToken:token,signal:controller.signal,expires:performance.now()+ms,maxChildren,childMs,calls:0,live:0,timer:null};
        if(control){
          const tick=()=>{if(phase!==owner)return;if(performance.now()>=owner.expires)controller.abort();else{owner.timer=setTimeout(tick,Math.min(1000,Math.max(1,owner.expires-performance.now())));owner.timer.unref?.();}};
          owner.timer=setTimeout(tick,Math.min(1000,ms));
        }else owner.timer=setTimeout(()=>controller.abort(),ms);
        owner.timer.unref?.();phase=owner;
      },
      settle(){if(!phase)return;assert.equal(phase.live,0,'Owned invocations unsettled');if(phase.signal.aborted||performance.now()>=phase.expires){retired=true;phase.controller.abort();}clearTimeout(phase.timer);phase=null;},
      abort(){phase?.controller.abort();},
      assertCurrentTwoAac(token){assert(phase&&phase.live===0&&twoAac(phase.control)&&phase.controlToken===token,'Final two-AAC publication requires the current settled generation');phaseCurrent(phase);},
      assertCurrent(token){
        assert(phase&&(token===undefined||phase.control?.kind==='measured-h265'&&phase.controlToken===token),'Only the current measured owner can guard publication');
        phaseCurrent(phase);
      },
      get signal(){assert(phase);phaseCurrent(phase);return phase.signal;},
      snapshot(){return {closed,phase:phase?.kind||null,live:phase?.live||0};},
      close(){return closePromise ||= (async()=>{assert(!phase||phase.live===0,'Cannot retire live generation');closed=true;if(phase)clearTimeout(phase.timer);const errors=[];try{await observer.close();}catch(e){errors.push(e);}try{await candidate.close();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Generation closure failed');phase=null;})();}
    });
  } catch(error){await candidate.close();throw error;}
}
module.exports={openUnifiedGeneration};
