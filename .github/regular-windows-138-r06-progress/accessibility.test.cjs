'use strict';
const assert=require('node:assert/strict'),test=require('node:test');
const fs=require('node:fs/promises'),path=require('node:path');
const {axStatus,classify,openAx,watch,sampleRunningAx,navigation,seek,TERMINAL,MAX}=require('./accessibility.cjs');
const {report,observationGap}=require('./report.cjs'),{POLICY}=require('./binding.cjs');
const stage='Encoding. File 1 of 1: fixture-a.mp4';
const validAX={nodeId:'17',backendDOMNodeId:11,ignored:false,role:{value:'status'},properties:[{name:'live',value:{value:'polite'}},{name:'atomic',value:{value:true}}]};
function ledger(...rows){
  const initial={status:'Ready',percent:'In progress'};let prior=initial;
  const deliveries=rows.map(([writes,feed=null,linked=false])=>{
    const before=prior,after={...before},records=writes.map(([kind,next])=>{
      const old=after[kind];after[kind]=next;return {kind,old,next};
    });
    prior=after;return {before,after,records,feed,linked};
  });
  return {initial,final:prior,deliveries,overflow:false};
}
const write=(kind,value,feed=null,linked=false)=>[[[kind,value]],feed,linked];
const begin=write('status',stage),end=write('status',TERMINAL);
const numeric=(revision,percent)=>({revision,percent});

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
test('same Encoding episode: two distinct increasing actual linked mutations create one advance',()=>{
  assert.deepEqual(classify(ledger(begin,write('percent','10.0%',numeric(4,'10.0%'),true),
    write('percent','10.0%',numeric(5,'10.0%')),write('percent','25.0%',numeric(6,'25.0%'),true),end)),{
    observations:{stage:1,terminal:1,stableNumeric:1,duplicates:0,percentContrast:'observed'},
    progressFeed:{eligible:3,corroborated:2,advances:1},
  });
});
test('decreasing DOM (25→10) does not corroborate rising feed (10→25) even with both numerals present',()=>{
  const wrong=ledger(begin,write('percent','25.0%',numeric(1,'10.0%')),write('percent','10.0%',numeric(2,'25.0%')),end);
  assert.deepEqual(classify(wrong).progressFeed,{eligible:2,corroborated:0,advances:0});
  for(const d of wrong.deliveries.slice(1,3)){
    d.linked=true;assert.throws(()=>classify(wrong));d.linked=false;
  }
  const descending=ledger(begin,write('percent','25.0%',numeric(1,'25.0%'),true),write('percent','10.0%',numeric(2,'10.0%'),true),end);
  assert.deepEqual(classify(descending).progressFeed,{eligible:2,corroborated:2,advances:0});
});
test('stale revision, invalid percent, false bookends and lost transitions are rejected',()=>{
  const bad=[ledger(begin,write('percent','10.0%',numeric(3,'10.0%'),true),
    write('percent','25.0%',numeric(2,'25.0%'),true),end)];
  for(const value of ['0.0%','99.0%','100.0%','n/a'])bad.push(ledger(begin,write('percent',value,numeric(1,value),true),end));
  const source=()=>ledger(begin,write('percent','10.0%',numeric(3,'10.0%'),true),end);
  const staleOld=source();staleOld.deliveries[1].records[0].old='unrelated';bad.push(staleOld);
  const staleBefore=source();staleBefore.deliveries[1].before={status:'unrelated',percent:'In progress'};bad.push(staleBefore);
  const staleAfter=source();staleAfter.deliveries[1].after={status:stage,percent:'unrelated'};bad.push(staleAfter);
  const staleEnd=source();staleEnd.final={...staleEnd.final,percent:'unrelated'};bad.push(staleEnd);
  for(const row of bad)assert.throws(()=>classify(row));
});
test('a numeral in a semantic, coalesced, or asynchronously repeated delivery cannot backfill telemetry',()=>{
  const mixed=ledger(
    [[['status',stage],['percent','10.0%']],numeric(1,'10.0%')],
    write('percent','10.0%'),
    [[],numeric(2,'10.0%')],
    [[['percent','18.0%'],['percent','25.0%']],numeric(3,'25.0%')],
    write('percent','25.0%'),
    [[],numeric(4,'25.0%')],end);
  assert.deepEqual(classify(mixed).progressFeed,{eligible:4,corroborated:0,advances:0});
  for(const index of [0,3]){
    mixed.deliveries[index].linked=true;assert.throws(()=>classify(mixed));mixed.deliveries[index].linked=false;
  }
  const split=ledger(begin,write('percent','10.0%',numeric(1,'10.0%'),true),write('percent','15.0%'),
    write('percent','25.0%',numeric(2,'25.0%'),true),end);
  assert.deepEqual(classify(split).progressFeed,{eligible:2,corroborated:2,advances:0});
  const episodes=ledger(begin,write('percent','10.0%',numeric(1,'10.0%'),true),
    write('status','Checking source. File 1 of 1: fixture-a.mp4'),begin,
    write('percent','25.0%',numeric(2,'25.0%'),true),end);
  assert.deepEqual(classify(episodes).progressFeed,{eligible:2,corroborated:2,advances:0});
});
test('missing stage/outcome, duplicate status text, leaked percentages, bad events and overflow fail',()=>{
  for(const events of [[end],[begin],[begin,begin,end],
    [begin,write('status','33.0% complete'),end],
    [begin,end,end],[begin,write('unknown','value'),end],
    [begin,...Array.from({length:MAX+1},()=>write('percent','0.0%')),end]])assert.throws(()=>classify(ledger(...events)));
  assert.throws(()=>classify({...ledger(begin,end),overflow:true}));
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
      progressFeed:{eligible:3,corroborated:2,advances:1},observations:{stage:2,terminal:1,stableNumeric:1,duplicates:0,percentContrast:'observed'}}};
}
test('sanitized report proves the finite narrow contract or labels missing observations explicitly',()=>{
  const fixture=sample(),out=report(fixture);
  assert.equal(out.state,'R06_LIVE_PROGRESS_PASSED');assert.equal(out.schema,'windows-packaged-r06-genuine-live-progress/v2');
  assert(!JSON.stringify(out).includes('PRIVATE'));
  fixture.result.progressFeed.advances=0;assert.throws(()=>report(fixture));fixture.result.progressFeed.advances=1;
  fixture.result.runningInAx='not-observed';fixture.result.observations.stableNumeric=0;fixture.result.observations.percentContrast='not-observed';fixture.result.progressFeed.advances=0;
  assert.throws(()=>report(fixture));
  fixture.failure={phase:'ax-outcome',code:observationGap(fixture.result)};
  assert.equal(report(fixture).state,'R06_LIVE_PROGRESS_INCOMPLETE');
  fixture.postRunReadback.product='failed';fixture.failure=null;assert.throws(()=>report(fixture));
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

test('live AX sampler uses only the prebound node and stops at terminal or a finite count',async()=>{
  const requested=[],p=[];
  const observed=await sampleRunningAx({textOf:async id=>{requested.push(id);return requested.length===2?stage:'Ready';}},'17',async ms=>p.push(ms));
  assert.equal(observed,'observed');assert.deepEqual(requested,['17','17']);assert.deepEqual(p,[75]);
  assert.equal(await sampleRunningAx({textOf:async()=>TERMINAL},'17',async()=>assert.fail('terminal cannot wait')),'not-observed');
  let n=0;assert.equal(await sampleRunningAx({textOf:async()=>{n++;return 'Ready';}},'17',async()=>{}),'not-observed');assert.equal(n,60);
  let t=0, cap=0;
  assert.equal(await sampleRunningAx({textOf:async(id,ms)=>{assert(ms<=1000);cap++;t+=950;return 'Ready';}},
    '17',async ms=>{t+=ms;},()=>t),'not-observed');
  assert(cap<60);
});
async function harness(t){
  let subscribed,deliver,stopped=0,disconnected=0,queued=[];
  const node=textContent=>({nodeType:3,textContent});
  const view=value=>({firstChild:node(value),get textContent(){return this.firstChild?.textContent??'';},
    closest:()=>null,getClientRects:()=>[1]});
  const status=view('Ready'),percent=view('In progress');
  const old={document:global.document,window:global.window,MutationObserver:global.MutationObserver};
  global.document={querySelector:key=>key==='#percent'?percent:status};
  global.window={encoder:{onUpdate:fn=>{subscribed=fn;return()=>{stopped++;};}}};
  global.MutationObserver=class {
    constructor(cb){deliver=cb;}observe(){}
    takeRecords(){const records=queued;queued=[];return records;}
    disconnect(){disconnected++;}
  };
  t.after(()=>{for(const [k,v] of Object.entries(old)){if(v===undefined)delete global[k];else global[k]=v;}});
  const observed=await watch({evaluateHandle:async(fn,args)=>fn(args)},x=>x,'file','plan');
  const send=(revision,over={},progress={})=>subscribed({revision,planId:'plan',batchId:'run',phase:'running',
    progress:{stage:'encoding',fileId:'file',ended:false,percent:10,...progress},...over});
  const mutate=(target,value,identity='exact')=>{
    const next=node(value),old=target.firstChild;target.firstChild=next;
    queued.push({type:'childList',target,removedNodes:[identity==='wrong-old'?node(old.textContent):old],
      addedNodes:[identity==='wrong-new'?node(value):next]});
  };
  const flush=()=>{const records=queued;queued=[];deliver(records);};
  return {observed,status,percent,send,mutate,flush,closed:()=>({stopped,disconnected})};
}
test('passive subscriber drains ineligible callbacks, binds exact plan/file/new batch, and never reuses observer deliveries',async t=>{
  const {observed,status,percent,send,mutate,flush,closed}=await harness(t);
  mutate(status,stage);send(1,{planId:'bad',batchId:'fake'});
  send(2,{}, {percent:null});
  mutate(percent,'10.0%');send(3,{batchId:'other'});
  send(4,{}, {ended:true});
  send(5); // Prior matching transition was already drained at the wrong-batch callback.
  send(4);
  mutate(percent,'20.0%');flush();send(6,{}, {percent:20});
  mutate(percent,'25.0%');send(7,{}, {fileId:'wrong',percent:25});
  mutate(percent,'26.0%');send(6,{}, {percent:26}); // Cannot outrun even a nonnumeric same-batch watermark.
  send(8,{}, {percent:25});
  mutate(percent,'30.0%');send(9,{}, {percent:30});
  mutate(percent,'40.0%');send(10,{}, {percent:40});
  mutate(status,TERMINAL);send(11,{phase:'completed'});
  const result=classify(observed.inspect());
  assert.equal(result.observations.stableNumeric,1);
  assert.deepEqual(result.progressFeed,{eligible:5,corroborated:2,advances:1});
  observed.stop();send(12);assert.deepEqual(classify(observed.inspect()),result);assert.deepEqual(closed(),{stopped:1,disconnected:1});
});
test('passive subscriber rejects semantic, coalesced, invisible, and equal-text wrong-node occurrences',async t=>{
  const {observed,status,percent,send,mutate,flush}=await harness(t);
  mutate(status,stage);mutate(percent,'10.0%');send(1);
  mutate(percent,'10.0%');flush();send(2);
  mutate(percent,'15.0%');mutate(percent,'20.0%');send(3,{}, {percent:20});
  mutate(percent,'25.0%','wrong-new');send(4,{}, {percent:25});
  mutate(percent,'30.0%','wrong-old');send(5,{}, {percent:30});
  percent.closest=()=>({});
  mutate(percent,'35.0%');send(6,{}, {percent:35});
  mutate(status,TERMINAL);flush();
  assert.deepEqual(classify(observed.inspect()).progressFeed,{eligible:6,corroborated:0,advances:0});
});
test('both targeted live observations independently control success',()=>{
  const f=sample();
  f.result.runningInAx='not-observed';assert.equal(observationGap(f.result),'R06_RUNNING_AX_NOT_OBSERVED');
  f.result.runningInAx='observed';f.result.progressFeed.advances=0;assert.equal(observationGap(f.result),'R06_LIVE_PERCENT_NOT_OBSERVED');
  f.result.runningInAx='not-observed';assert.equal(observationGap(f.result),'R06_LIVE_AX_AND_PERCENT_NOT_OBSERVED');
});
