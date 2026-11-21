'use strict';
const assert = require('node:assert/strict');
const TERMINAL = 'Batch finished. 1 succeeded';
const STATUS = '#current-job-announcement';
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
function classify({overflow,events}) {
  assert.equal(overflow,false);assert(Array.isArray(events)&&events.length<=MAX);
  let stage=0,terminal=0,stableNumeric=0,duplicates=0,status=null,lastPercent=null,stableDelivery=false;
  for(const row of events) {
    assert(Array.isArray(row)&&row.length===2);
    const [kind,value]=row;assert(typeof value==='string'&&value.length<=320);
    if(kind==='delivery') {
      assert(['stable','semantic'].includes(value));
      stableDelivery=value==='stable';
      if(!stableDelivery)lastPercent=null;
    } else if(kind==='status') {
      assert(!stableDelivery);
      if(value!==''&&value===status)duplicates++;
      status=value;lastPercent=null;
      if(STAGE.test(value))stage++;
      if(value===TERMINAL)terminal++;
      assert(!/\d(?:\.\d+)?%/.test(value),'A percentage reached the polite status.');
    } else {
      assert.equal(kind,'percent');
      if(stableDelivery&&PERCENT.test(value)&&STAGE.test(status||'')){
        if(lastPercent!==null&&value!==lastPercent)stableNumeric++;
        lastPercent=value;
      }
    }
  }
  assert.equal(duplicates,0);assert(stage>=1);assert.equal(terminal,1);
  return {stage,terminal,stableNumeric,duplicates,percentContrast:stableNumeric?'observed':'not-observed'};
}
async function watch(page,within) {
  return within(page.evaluateHandle(({status,max})=>{
    const a=document.querySelector(status), p=document.querySelector('#percent');
    if(!a||!p)throw Error('Missing observation nodes.');
    const events=[];let overflow=false;
    const collect=records=>{
      if(!records.length)return;
      if(events.length===max){overflow=true;return;}
      // Percent written earlier in the same render as a stage transition
      // cannot count as a numeric-only observation of the prior stage.
      events.push(['delivery',records.some(r=>r.target===a)?'semantic':'stable']);
      for(const r of records) {
        if(events.length===max){overflow=true;return;}
        if(r.type!=='childList'||(r.target!==a&&r.target!==p)){overflow=true;return;}
        const s=Array.from(r.addedNodes,n=>n.textContent).join('');
        if(s.length>320){overflow=true;return;}
        events.push([r.target===a?'status':'percent',s]);
      }
    };
    const observer=new MutationObserver(collect);
    for(const node of [a,p])observer.observe(node,{childList:true});
    return {a,p,observer,inspect:()=>{collect(observer.takeRecords());return {
      overflow,events,status:a.textContent,same:a===document.querySelector(status)&&p===document.querySelector('#percent'),
      outside:!a.closest('[hidden],[inert],[aria-hidden="true"]'),
    };}};
  },{status:STATUS,max:MAX}));
}
async function openAx(page,within) {
  const session=await within(page.context().newCDPSession(page));
  try {
    await within(session.send('Accessibility.enable'));
    const read=async()=>{
      const doc=await within(session.send('DOM.getDocument',{depth:0}));
      const {nodeId}=await within(session.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector:STATUS}));
      assert(Number.isInteger(nodeId)&&nodeId>0);
      const {node}=await within(session.send('DOM.describeNode',{nodeId,depth:0}));
      const {nodes}=await within(session.send('Accessibility.getPartialAXTree',{backendNodeId:node.backendNodeId,fetchRelatives:true}));
      const id=axStatus(nodes,node.backendNodeId);
      const children=await within(session.send('Accessibility.getChildAXNodes',{id}));
      assert(Array.isArray(children.nodes)&&children.nodes.length<=16);
      const text=children.nodes.filter(n=>n.ignored===false&&n.role?.value==='StaticText').map(n=>n.name?.value).join(' ');
      assert(text.length<=320);
      return {ax:id,dom:node.backendNodeId,text};
    };
    return {read,detach:()=>within(session.detach())};
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
module.exports={TERMINAL,STAGE,MAX,axStatus,classify,watch,openAx,visibleKeys,seek,navigation,activate};
