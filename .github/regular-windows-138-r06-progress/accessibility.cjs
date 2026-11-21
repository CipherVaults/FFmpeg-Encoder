'use strict';
const assert = require('node:assert/strict');
const TERMINAL = 'Batch finished. 1 succeeded';
const STATUS = '#current-job-announcement';
const ENCODING = 'Encoding. File 1 of 1: fixture-a.mp4';
const MAX = 384;
const STAGE = /^(?:Encoding|Checking encoder input|Checking preservation|Validating output|Checking source|Publishing output|Processing)\. File 1 of 1: fixture-a\.mp4$/;
const PERCENT = /^(?:100\.0|\d{1,2}\.\d)%$/;

function axStatus(nodes,nodeId) {
  assert(Array.isArray(nodes)&&nodes.length<=96);
  const found=nodes.filter(n=>n.backendDOMNodeId===nodeId);
  assert.equal(found.length,1);
  const n=found[0];assert.equal(n.ignored,false);assert.equal(n.role?.value,'status');
  for(const [name,wanted] of [['live','polite'],['atomic',true]]) {
    const properties=n.properties?.filter(p=>p.name===name)||[];
    assert.equal(properties.length,1);assert.equal(properties[0].value?.value,wanted);
  }
  assert.equal(typeof n.nodeId,'string');
  return n.nodeId;
}
function interior(value) {
  return typeof value==='string'&&PERCENT.test(value)&&Number(value.slice(0,-1))>0&&Number(value.slice(0,-1))<99;
}
function classify({overflow,initial,final,deliveries}) {
  assert.equal(overflow,false);assert(Array.isArray(deliveries)&&deliveries.length<=MAX);
  const bounded=value=>typeof value==='string'&&value.length<=320;
  const bookend=b=>b&&bounded(b.status)&&bounded(b.percent);
  assert(bookend(initial)&&bookend(final));
  let {status,percent}=initial;
  let stage=0,terminal=0,duplicates=0,eligible=0,corroborated=0,advances=0,previous=null,revision=-1,totalRecords=0;
  for(const row of deliveries) {
    assert(bookend(row.before)&&bookend(row.after)&&Array.isArray(row.records)&&typeof row.linked==='boolean');
    assert.equal(row.before.status,status);assert.equal(row.before.percent,percent);
    totalRecords+=row.records.length;assert(totalRecords<=MAX);
    assert(row.records.length>0||row.feed!==null);
    let semantic=false,changed=false;
    for(const entry of row.records){
      assert(bounded(entry.old)&&bounded(entry.next));
      if(entry.kind==='status'){
        assert.equal(entry.old,status);semantic=true;
        if(entry.next!==''&&entry.next===status)duplicates++;
        status=entry.next;
        if(STAGE.test(status))stage++;
        if(status===TERMINAL)terminal++;
        assert(!/\d(?:\.\d+)?%/.test(status),'A percentage reached the polite status.');
      } else {
        assert.equal(entry.kind,'percent');assert.equal(entry.old,percent);
        changed ||= entry.next!==percent;percent=entry.next;
      }
    }
    assert.equal(row.after.status,status);assert.equal(row.after.percent,percent);
    if(row.feed!==null){
      assert(row.feed&&Number.isSafeInteger(row.feed.revision)&&row.feed.revision>revision&&interior(row.feed.percent));
      revision=row.feed.revision;eligible++;
    }
    if(!row.linked){
      if(semantic||changed)previous=null;
      continue;
    }
    // The browser records occurrence identity; independently verify the same
    // single, changed transition and live-indicator bookends in delivery order.
    assert(row.feed&&!semantic&&changed&&row.records.length===1&&row.records[0].kind==='percent');
    assert.equal(row.before.status,ENCODING);assert.equal(status,ENCODING);
    assert.equal(row.feed.percent,percent);
    corroborated++;
    const value=Number(percent.slice(0,-1));
    if(previous!==null&&value>previous)advances++;
    previous=value;
  }
  assert.equal(final.status,status);assert.equal(final.percent,percent);
  assert.equal(duplicates,0);assert(stage>=1);assert.equal(terminal,1);
  return {observations:{stage,terminal,stableNumeric:advances,duplicates,percentContrast:advances?'observed':'not-observed'},
    progressFeed:{eligible,corroborated,advances}};
}
async function watch(page,within,fileId,planId) {
  return within(page.evaluateHandle(({status,max,fileId,planId,encoding})=>{
    const a=document.querySelector(status), p=document.querySelector('#percent');
    if(!a||!p)throw Error('Missing observation nodes.');
    if(typeof fileId!=='string'||typeof planId!=='string')throw Error('Missing exact observed job binding.');
    const current=()=>({status:a.textContent,percent:p.textContent}),initial=current();
    let prior=initial,priorPercentNode=p.firstChild;
    const deliveries=[];let overflow=false,totalRecords=0,revision=-1,live=true,activeBatchId=null;
    const collect=(records,feed=null)=>{
      if(overflow||(!records.length&&!feed))return;
      totalRecords+=records.length;
      if(deliveries.length>=max||totalRecords>max){overflow=true;return;}
      const after=current(),before=prior;
      const recordsText=[];
      const boundedText=nodes=>{
        let value='';
        if(nodes.length>1)return null; // Exact renderer puts one ordinary text or clears the node.
        for(const node of nodes){
          if(node.nodeType!==3||node.textContent.length>320)return null;
          value=node.textContent;
        }
        return value;
      };
      for(const r of records){
        if(r.type!=='childList'||(r.target!==a&&r.target!==p)){overflow=true;return;}
        const old=boundedText(r.removedNodes),next=boundedText(r.addedNodes);
        if(old===null||next===null){overflow=true;return;}
        recordsText.push({kind:r.target===a?'status':'percent',old,next});
      }
      const r=records[0], entry=recordsText[0];
      const linked=Boolean(feed&&records.length===1&&entry.kind==='percent'&&
        before.status===encoding&&after.status===encoding&&
        entry.old===before.percent&&entry.next===after.percent&&entry.old!==entry.next&&entry.next===feed.percent&&
        r.removedNodes.length===1&&r.addedNodes.length===1&&r.removedNodes[0]===priorPercentNode&&r.addedNodes[0]===p.firstChild&&
        !p.closest('[hidden],[inert],[aria-hidden="true"]')&&p.getClientRects().length>0);
      deliveries.push({before,after,records:recordsText,feed,linked});
      prior=after;priorPercentNode=p.firstChild;
    };
    // Observer-owned async deliveries are never linked to an IPC revision.
    const observer=new MutationObserver(records=>collect(records));
    for(const node of [a,p])observer.observe(node,{childList:true});
    let stopUpdates;
    try {
      stopUpdates=window.encoder.onUpdate(snapshot=>{
        // The existing preload listener is registered before this subscriber
        // and applies the snapshot synchronously. Drain its own delivery now,
        // even on an ineligible callback, so no record can be reused later.
        const records=observer.takeRecords();
        const q=snapshot?.progress, n=q?.percent;
        let feed=null;
        if(live&&snapshot?.planId===planId&&snapshot.phase==='running'&&typeof snapshot.batchId==='string'){
          if(activeBatchId===null)activeBatchId=snapshot.batchId;
          if(snapshot.batchId===activeBatchId&&Number.isSafeInteger(snapshot.revision)&&snapshot.revision>revision){
            revision=snapshot.revision;
            if(q?.stage==='encoding'&&q.fileId===fileId&&q.ended===false&&Number.isFinite(n)&&n>0&&n<99){
              const percent=n.toFixed(1)+'%', rounded=Number(percent.slice(0,-1));
              if(rounded>0&&rounded<99)feed={revision,percent};
            }
          }
        }
        collect(records,feed);
      });
    } catch(error) { observer.disconnect(); throw error; }
    return {stop:()=>{live=false;observer.disconnect();stopUpdates();},inspect:()=>{collect(observer.takeRecords());return {
      overflow,initial,final:current(),deliveries,status:a.textContent,
      same:a===document.querySelector(status)&&p===document.querySelector('#percent'),
      outside:!a.closest('[hidden],[inert],[aria-hidden="true"]'),
    };}};
  },{status:STATUS,max:MAX,fileId,planId,encoding:ENCODING}));
}
async function openAx(page,within) {
  const session=await within(page.context().newCDPSession(page));
  try {
    await within(session.send('Accessibility.enable'));
    const textOf=async (id,timeoutMs)=>{
      const children=await within(session.send('Accessibility.getChildAXNodes',{id}),timeoutMs);
      assert(Array.isArray(children.nodes)&&children.nodes.length<=16);
      const text=children.nodes.filter(n=>n.ignored===false&&n.role?.value==='StaticText').map(n=>n.name?.value).join(' ');
      assert(text.length<=320);return text;
    };
    const read=async()=>{
      const doc=await within(session.send('DOM.getDocument',{depth:0}));
      const {nodeId}=await within(session.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:STATUS}));
      assert(Number.isInteger(nodeId)&&nodeId>0);
      const {node}=await within(session.send('DOM.describeNode',{nodeId,depth:0}));
      const {nodes}=await within(session.send('Accessibility.getPartialAXTree',{backendNodeId:node.backendNodeId,fetchRelatives:true}));
      const id=axStatus(nodes,node.backendNodeId);
      return {ax:id,dom:node.backendNodeId,text:await textOf(id)};
    };
    return {read,textOf,detach:()=>within(session.detach())};
  } catch(error) { try{await within(session.detach());}catch{} throw error; }
}
function visibleKeys(page) {
  return page.evaluate(()=>{
    const el=document.activeElement;
    const inert=!el||el.matches(':disabled')||Boolean(el.closest('[hidden],[inert],[aria-hidden="true"]'));
    const hidden=!el||el.getClientRects().length===0||getComputedStyle(el).visibility==='hidden'||getComputedStyle(el).display==='none';
    const tab=document.querySelector('[role=tab][aria-selected=true]');
    return {id:el?.id||'',valid:!inert&&!hidden,selected:tab?.id||'',
      owner:el?.closest('[role=tabpanel]')?.id||'',body:el===document.body};
  });
}
async function seek(page,selector,within) {
  const id=selector.slice(1);
  assert(/^#[a-z-]+$/.test(selector));
  for(let attempts=0;attempts<=55;attempts++) {
    const focus=await within(visibleKeys(page));assert(focus.valid||focus.body);
    if(focus.id===id){assert(focus.valid);return attempts;}
    if(attempts<55)await within(page.keyboard.press('Tab'));
  }
  assert.fail('Target was not reachable through bounded Tab navigation.');
}
async function sampleRunningAx(ax,id,pause,now=Date.now) {
  const end=now()+6000;
  for(let i=0;i<60&&now()<end;i++){
    const text=await ax.textOf(id,Math.min(1000,end-now()));
    if(text===ENCODING&&now()<=end)return 'observed';
    if(text===TERMINAL)return 'not-observed';
    if(i<59&&now()<end)await pause(Math.min(75,end-now()));
  }
  return 'not-observed';
}
async function navigation(page,within) {
  // One explicit focus anchor, then real Playwright key input.
  await within(page.locator('#tab-encode').focus());
  await within(page.keyboard.press('ArrowRight'));await within(page.keyboard.press('ArrowRight'));
  const roving=await within(visibleKeys(page));
  assert.equal(roving.id,'tab-jobs');assert.equal(roving.selected,'tab-encode');assert(roving.valid);
  await within(page.keyboard.press('Enter'));
  assert.equal((await within(visibleKeys(page))).selected,'tab-jobs');
  await seek(page,'#jobs-open-encode',within);
  const jobs=await within(visibleKeys(page));assert.equal(jobs.owner,'workspace-jobs');
  await within(page.keyboard.press('Enter'));
  const back=await within(visibleKeys(page));assert(back.valid);assert.equal(back.id,'workspace-encode');assert.equal(back.selected,'tab-encode');
}
async function activate(page,selector,within) {
  await seek(page,selector,within);
  await within(page.keyboard.press('Enter'));
}
module.exports={TERMINAL,ENCODING,STAGE,MAX,axStatus,classify,watch,openAx,sampleRunningAx,visibleKeys,seek,navigation,activate};
