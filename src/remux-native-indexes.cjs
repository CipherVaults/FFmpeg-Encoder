'use strict';
const {ToolError}=require('./process-runner.cjs');
async function fragmentStarts(meta,integer,need){
  if(meta.fragmentStarts)return meta.fragmentStarts;const clocks=new Map(),defaults=new Map(),starts=new Map();let records=0;
  for(const trak of meta.nodes.filter(n=>n.type==='trak')){
    const tk=trak.children.find(n=>n.type==='tkhd');if(!tk)continue;const v=Number(await integer(tk,0,1)),id=Number(await integer(tk,v?20:12,4));let clock=0n;
    for(const stts of meta.nodes.filter(n=>n.type==='stts')){let p=stts.parent;while(p&&p!==trak)p=p.parent;if(!p)continue;const count=Number(await integer(stts,4,4));need(stts.end-stts.body===8+count*8&&count<=meta.maxRecords,'initial sample clock has invalid extent.');
      for(let i=0;i<count;i++)clock+=await integer(stts,8+i*8,4)*await integer(stts,12+i*8,4);
    }clocks.set(id,clock);
  }
  for(const trex of meta.nodes.filter(n=>n.type==='trex'))defaults.set(Number(await integer(trex,4,4)),await integer(trex,12,4));
  for(const traf of meta.nodes.filter(n=>n.type==='traf')){
    const hd=traf.children.find(n=>n.type==='tfhd'),dt=traf.children.find(n=>n.type==='tfdt');need(hd,'fragment track header is missing.');const id=Number(await integer(hd,4,4)),flags=Number(await integer(hd,1,3));let at=8+(flags&1?8:0)+(flags&2?4:0),duration=defaults.get(id)||0n;
    if(flags&8)duration=await integer(hd,at,4);let clock=clocks.get(id)||0n;
    if(dt){const v=Number(await integer(dt,0,1));need(v<=1,'unknown fragment clock version.');clock=await integer(dt,4,v?8:4);}
    starts.set(traf,clock);
    for(const run of traf.children.filter(n=>n.type==='trun')){
      const f=Number(await integer(run,1,3)),count=Number(await integer(run,4,4)),head=8+(f&1?4:0)+(f&4?4:0),width=[0x100,0x200,0x400,0x800].filter(bit=>f&bit).length*4;
      need((records+=count)<=meta.maxRecords&&run.end-run.body===head+count*width,'fragment sample coverage exceeds its exact extent/budget.');
      if(!(f&0x100)){need(duration>0n,'fragment duration is unavailable.');clock+=duration*BigInt(count);}
      else for(let i=0;i<count;i++){const d=await integer(run,head+i*width,4);need(d>0n,'fragment duration is zero.');clock+=d;}
    }clocks.set(id,clock);
  }meta.fragmentStarts=starts;return starts;
}
async function isoIndex({r,n,meta,probe,integer}){
  const need=(ok,s)=>{if(!ok)throw new ToolError(r.code,'isobmff '+r.field+': '+s);},size=n.end-n.body;
  if(n.type==='mfra'){need(n.children.filter(p=>p.type==='mfro').length===1&&n.children.at(-1).type==='mfro','one final random-access footer is required.');const ids=[];for(const row of n.children.filter(p=>p.type==='tfra'))ids.push(await integer(row,4,4));need(new Set(ids.map(String)).size===ids.length,'duplicate random-access track indexes.');return null;}
  if(n.type==='mfhd'){
    need(size===8&&await integer(n,0,4)===0n,'invalid movie-fragment FullBox.');
    const rows=meta.nodes.filter(p=>p.type==='mfhd');let previous=null;
    for(const row of rows){need(row.parent?.type==='moof'&&row.parent.children.filter(p=>p.type==='mfhd').length===1,'ambiguous fragment sequence header.');const seq=await integer(row,4,4);need(previous===null||seq===previous+1n,'fragment sequence is not consecutive.');previous=seq;}return null;
  }
  if(n.type==='mfro'){
    need(size===8&&await integer(n,0,4)===0n&&n.parent?.type==='mfra'&&n.parent.children.at(-1)===n&&await integer(n,4,4)===BigInt(n.parent.end-n.parent.start),'random-access footer does not locate its complete index.');return null;
  }
  if(n.type==='tfra'){
    need(size>=16&&n.parent?.type==='mfra','truncated or unscoped random-access index.');const b=await meta.read(n.body,16),version=b[0],trackId=b.readUInt32BE(4),lengths=b.readUInt32BE(8),count=b.readUInt32BE(12);
    need(version<=1&&b.readUIntBE(1,3)===0&&(lengths>>>6)===0&&probe.streams.some(s=>s.id&&BigInt(s.id)===BigInt(trackId)),'unknown random-access version/track/length flags.');
    const widths=[(lengths>>4&3)+1,(lengths>>2&3)+1,(lengths&3)+1],clockWidth=version?8:4,width=2*clockWidth+widths.reduce((a,b)=>a+b,0);
    need(count<=meta.maxRecords&&size===16+count*width,'random-access entry count/extent mismatch.');let previous=-1n;
    for(let i=0;i<count;i++){
      const at=16+i*width,time=await integer(n,at,clockWidth),offset=await integer(n,at+clockWidth,clockWidth),numbers=[];let p=at+2*clockWidth;
      for(const w of widths){numbers.push(Number(await integer(n,p,w)));p+=w;}
      need(time>=previous,'random-access times run backwards.');previous=time;
      const moof=meta.nodes.find(p=>p.type==='moof'&&BigInt(p.start)===offset),traf=moof?.children.filter(p=>p.type==='traf')[numbers[0]-1],tfhd=traf?.children.find(p=>p.type==='tfhd'),tfdt=traf?.children.find(p=>p.type==='tfdt');
      need(tfhd&&await integer(tfhd,4,4)===BigInt(trackId),'random-access entry does not identify its native fragment track.');
      const trun=traf.children.filter(p=>p.type==='trun')[numbers[1]-1];need(trun,'random-access sample has no native decode/run clock.');
      const packet=meta.seeking?.packets.find(p=>p.moof===moof&&p.traf===traf&&p.run===trun&&p.runNumber===numbers[2]);
      need(packet&&packet.key&&time===packet.pts,'random-access entry does not identify an independently coded own packet at its native presentation time.');
      const stream=meta.seeking.streams.find(s=>s.index===meta.seeking.states.get(trackId)?.track.index);if(stream&&!stream.indexed.includes(packet.ordinal))stream.indexed.push(packet.ordinal);
    }return null;
  }
  if(n.type==='sidx'){
    need(size>=24,'truncated segment index.');const b=await meta.read(n.body,Math.min(size,40)),version=b[0],clockWidth=version?8:4;
    need(version<=1&&b.readUIntBE(1,3)===0,'unknown segment-index version/flags.');const id=b.readUInt32BE(4),scale=b.readUInt32BE(8),stream=probe.streams.find(s=>s.id&&BigInt(s.id)===BigInt(id));
    need(scale>0&&stream,'segment index has no admitted track clock.');const head=12+clockWidth*2+4;need(size>=head,'truncated segment-index count.');
    const first=await integer(n,12,clockWidth),offset=await integer(n,12+clockWidth,clockWidth),reserved=await integer(n,head-4,2),count=Number(await integer(n,head-2,2));
    need(reserved===0n&&size===head+count*12,'segment-index reserved/count/extent mismatch.');
    if(!count)return null;
    const tb=/^(\d+)\/(\d+)$/.exec(stream.time_base||'');need(tb,'index track time base is unavailable.');
    let start=BigInt(n.end)+offset;
    for(let i=0;i<count;i++){
      const entry=await meta.read(n.body+head+i*12,12),bytes=entry.readUInt32BE(0),duration=entry.readUInt32BE(4),sap=entry.readUInt32BE(8);need(!(bytes&0x80000000)&&bytes>0&&duration>0,'indirect/empty segment references are unproved.');
      const end=start+BigInt(bytes);need(end<=BigInt(meta.fileBytes)&&meta.nodes.some(p=>!p.parent&&BigInt(p.start)===start)&&meta.nodes.some(p=>!p.parent&&BigInt(p.end)===end),'segment reference does not cover complete native boxes.');
      const top=meta.nodes.filter(p=>!p.parent&&p.type==='moof'&&BigInt(p.start)>=start&&BigInt(p.end)<=end),movie=meta.nodes.find(p=>!p.parent&&p.type==='moov'),initial=new Map();
      for(const moof of top)for(const traf of moof.children.filter(p=>p.type==='traf')){
        const hd=traf.children.find(p=>p.type==='tfhd');need(hd,'segment has no native fragment track/decode clock.');const track=Number(await integer(hd,4,4)),clock=(await fragmentStarts(meta,integer,need)).get(traf);
        if(!initial.has(track))initial.set(track,{count:0,clock:0n,minimum:null,maximum:null,endDts:clock});
      }
      let coverage;try{coverage=await require('./remux-fragments.cjs').fragmentCoverage({top,movieBoxes:movie?.children||[],boxes:async(a,b)=>meta.nodes.find(p=>p.body===a&&p.end===b)?.children||[],read:meta.read,maxRecords:meta.maxRecords,initial,trackIds:new Set(probe.streams.filter(s=>s.id).map(s=>Number(BigInt(s.id))))});}
      catch(e){if(e.code==='CANCELLED')throw e;need(false,'segment native timing coverage failed: '+e.message);}
      const covered=coverage.get(id);need(covered&&covered.clock*BigInt(tb[1])*BigInt(scale)===BigInt(duration)*BigInt(tb[2]),'segment duration differs from its referenced native sample clocks.');
      // The pinned writer emits SAP type/delta zero, with starts_with_SAP
      // derived from the referenced first sample. An independent access-point
      // promise cannot disappear merely because all decode clocks match.
      let matching=null;for(const traf of top.flatMap(p=>p.children.filter(c=>c.type==='traf'))){const hd=traf.children.find(c=>c.type==='tfhd');if(hd&&await integer(hd,4,4)===BigInt(id)){matching=traf;break;}}
      need(matching,'segment access point has no native track.');const hd=matching.children.find(c=>c.type==='tfhd'),run=matching.children.find(c=>c.type==='trun');
      let sampleFlags=0n;for(const def of meta.nodes.filter(p=>p.type==='trex'))if(await integer(def,4,4)===BigInt(id))sampleFlags=await integer(def,20,4);
      const hf=Number(await integer(hd,1,3));if(hf&32)sampleFlags=await integer(hd,8+(hf&1?8:0)+(hf&2?4:0)+(hf&8?4:0)+(hf&16?4:0),4);
      need(run&&await integer(run,4,4)>0n,'segment access point has no first sample.');const rf=Number(await integer(run,1,3)),firstAt=8+(rf&1?4:0);
      if(rf&4)sampleFlags=await integer(run,firstAt,4);else if(rf&0x400)sampleFlags=await integer(run,firstAt+(rf&0x100?4:0)+(rf&0x200?4:0),4);
      need(sap===(sampleFlags&0x10000n?0:0x80000000),'segment access-point declaration differs from its native first sample or has unsupported SAP type/delta.');
      if(sap&0x80000000){const packet=meta.seeking?.packets.find(p=>p.traf===matching),stream=meta.seeking?.streams.find(s=>s.index===meta.seeking.states.get(id)?.track.index);if(stream&&packet&&!stream.indexed.includes(packet.ordinal))stream.indexed.push(packet.ordinal);}
      if(i===0)need(covered.minimum!==null&&covered.minimum*BigInt(tb[1])*BigInt(scale)===first*BigInt(tb[2]),'index first presentation time differs from its referenced native sample.');
      start=end;
    }
    return null;
  }
  need(false,'missing native index handler.');
}
module.exports={isoIndex};
