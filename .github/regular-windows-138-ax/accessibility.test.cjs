'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs/promises'),path=require('node:path');
const {axStatus,classify,openAx,navigation,seek,TERMINAL,MAX}=require('./accessibility.cjs');
const {report}=require('./report.cjs'),{POLICY}=require('./binding.cjs');
const stage='Encoding. File 1 of 1: fixture-a.mp4';
const validAX={nodeId:'17',backendDOMNodeId:11,ignored:false,role:{value:'status'},properties:[{name:'live',value:{value:'polite'}},{name:'atomic',value:{value:true}}]};
const statuses=(events,overflow=false)=>classify({events,overflow});

test('AX requires provider semantics on the exact visible DOM node; decorative/live impostors fail',()=>{
  assert.equal(axStatus([validAX],11),'17');
  for(const value of [{ignored:true},{role:{value:'paragraph'}},{properties:[]},{backendDOMNodeId:12},
    {properties:[{name:'live',value:{value:'assertive'}},validAX.properties[1]]},
    {properties:[validAX.properties[0],{name:'atomic',value:{value:false}}]}]) {
    assert.throws(()=>axStatus([{...validAX,...value}],11));
  }
  assert.throws(()=>axStatus([validAX,validAX],11));
});
test('Chromium adapter addresses the status by backend-node identity and samples exposed text',async()=>{
  const calls=[];
  const page={context:()=>({newCDPSession:async()=>({
    send:async(method,args)=>{
      calls.push([method,args]);
      switch(method){
        case 'Accessibility.enable':return {};
        case 'DOM.getDocument':return {root:{nodeId:1}};
        case 'DOM.querySelector':assert.equal(args.selector,'#current-job-announcement');return {nodeId:3};
        case 'DOM.describeNode':assert.equal(args.nodeId,3);return {node:{backendNodeId:11}};
        case 'Accessibility.getPartialAXTree':assert.equal(args.backendNodeId,11);return {nodes:[validAX]};
        case 'Accessibility.getChildAXNodes':assert.equal(args.id,'17');return {nodes:[{ignored:false,role:{value:'StaticText'},name:{value:TERMINAL}}]};
        default:assert.fail('Unknown method');
      }
    },detach:async()=>{calls.push(['detached']);},
  })})};
  const a=await openAx(page,x=>x);
  assert.deepEqual(await a.read(),{ax:'17',dom:11,text:TERMINAL});await a.detach();
  assert.equal(calls[0][0],'Accessibility.enable');assert.equal(calls.at(-1)[0],'detached');
});
test('only numeric changes during an unchanged file stage count as the routine progress contrast',()=>{
  const result=statuses([['delivery','semantic'],['percent','10.0%'],['status',stage],['delivery','stable'],['percent','10.0%'],['percent','10.0%'],['percent','25.0%'],['delivery','semantic'],['status',TERMINAL]]);
  assert.deepEqual(result,{stage:1,terminal:1,stableNumeric:1,duplicates:0,percentContrast:'observed'});
  const gap=statuses([['delivery','semantic'],['status',stage],['delivery','stable'],['percent','10.0%'],
    ['delivery','semantic'],['percent','25.0%'],['status',TERMINAL]]);
  assert.equal(gap.percentContrast,'not-observed');assert.equal(gap.stableNumeric,0);
});
test('missing stage/outcome, duplicate text writes, leaked percentages, bad events and overflow fail',()=>{
  for(const events of [[['status',TERMINAL]],[['status',stage]],[['status',stage],['status',stage],['status',TERMINAL]],
    [['status',stage],['status','33.0% complete'],['status',TERMINAL]],
    [['status',stage],['status',TERMINAL],['status',TERMINAL]],
    [['status',stage],['unknown','value'],['status',TERMINAL]],
    Array.from({length:MAX+1},()=>['percent','0.0%'])])assert.throws(()=>statuses(events));
  assert.throws(()=>statuses([['status',stage],['status',TERMINAL]],true));
});
test('keyboard path verifies roving focus, Enter activation, Jobs-owned tab stop and keyboard return',async()=>{
  const calls=[];
  const samples=[
    {id:'tab-jobs',selected:'tab-encode',valid:true},
    {id:'tab-jobs',selected:'tab-jobs',valid:true},
    {id:'workspace-jobs',owner:'workspace-jobs',valid:true},
    {id:'jobs-open-encode',owner:'workspace-jobs',valid:true},
    {id:'jobs-open-encode',owner:'workspace-jobs',valid:true},
    {id:'workspace-encode',selected:'tab-encode',valid:true},
  ];
  const fake={locator:id=>({focus:async()=>calls.push(['anchor',id])}),evaluate:async()=>samples.shift(),
    keyboard:{press:async key=>calls.push(['key',key])}};
  await navigation(fake,x=>x);
  assert.deepEqual(calls,[['anchor','#tab-encode'],['key','ArrowRight'],['key','ArrowRight'],['key','Enter'],['key','Tab'],['key','Enter']]);
  await assert.rejects(seek({evaluate:async()=>({id:'hidden',valid:false}),keyboard:fake.keyboard},'#start-batch',x=>x));
});
function sample() {
  const pin={sha256:'a'.repeat(64),sizeBytes:400,path:'PRIVATE: should never serialize'};
  return {id:{head:'b'.repeat(40),seed:'c'.repeat(40),runId:'123',attempt:1},harnessTree:'d'.repeat(40),policy:POLICY,
    build:{asar:pin,zip:pin,executable:pin},postRunReadback:{harness:'verified',product:'verified',packageInputs:'verified'},failure:null,
    result:{fixtureGenerationCalls:1,keyboardStarts:1,probeReadbackCalls:1,sourceUnchanged:true,packageUnchanged:true,
      keyboardNavigation:true,persistentTerminalAx:true,close:'normal',runningInAx:'observed',output:pin,untrustedPayload:'PRIVATE',
      launchOwnership:'verified-shell-launcher-and-pinned-main',security:{packaged:true,sandbox:true,contextIsolation:true,nodeIntegration:false},
      processObservation:{kind:'sampled-not-exhaustive',samples:5,observedDescendants:4,observedStartupMedia:0,observedLiveAfterClose:0},
      observations:{stage:2,terminal:1,stableNumeric:1,duplicates:0,percentContrast:'observed'}}};
}
test('sanitized report proves the finite narrow contract or labels missing observations explicitly',()=>{
  const fixture=sample(),out=report(fixture);
  assert.equal(out.state,'R06_HOSTED_AX_CORE_PASSED');assert(!JSON.stringify(out).includes('PRIVATE'));
  fixture.result.runningInAx='not-observed';fixture.result.observations.stableNumeric=0;fixture.result.observations.percentContrast='not-observed';
  assert.equal(report(fixture).state,'R06_HOSTED_AX_CORE_PASSED_WITH_OBSERVATION_GAPS');
  fixture.postRunReadback.product='failed';assert.throws(()=>report(fixture));
  fixture.failure={phase:'report',code:'ERR_ASSERTION',message:'PRIVATE'};
  assert.deepEqual(report(fixture).failure,{phase:'report',code:'ERR_ASSERTION'});assert(!JSON.stringify(report(fixture)).includes('PRIVATE'));
});
test('source/runtime boundaries stay structural: one Start, no app clicks or state injection, one report',async()=>{
  const journey=await fs.readFile(path.join(__dirname,'journey.cjs'),'utf8');
  const yml=await fs.readFile(path.join(__dirname,'windows.yml.in'),'utf8');
  assert.equal((journey.match(/keyboardStarts\+\+/g)||[]).length,1);
  assert.equal((journey.match(/fixtureGenerationCalls\+\+/g)||[]).length,1);
  assert(!journey.includes('page.click(')&&!journey.includes('.dispatchEvent(')&&!journey.includes('startBatch({'));
  assert.equal((yml.match(/uses: actions\/upload-artifact@/g)||[]).length,1);
  assert(!yml.includes('regular-win-cpu-138-once'));
});
