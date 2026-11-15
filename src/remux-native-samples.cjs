'use strict';
const {ToolError}=require('./process-runner.cjs'),{ancestor}=require('./remux-native-reader.cjs'),{packetSync}=require('./remux-native-sync.cjs');
const error=(type,why)=>{throw new ToolError('REMUX_NATIVE_'+type.toUpperCase(),'ISO '+type+': '+why);};
async function isoSeeking({meta,tracks,integer}){
  const nodes=meta.nodes,packets=[],streams=[],byId=new Map(),mdats=nodes.filter(n=>n.type==='mdat');
  const fail=(type,ok,why)=>{if(!ok)error(type,why);};
  const scoped=(track,type)=>nodes.filter(n=>n.type===type&&ancestor(n,'trak')===track.node);
  const one=(track,type,required=false)=>{const a=scoped(track,type);fail(type,a.length<=1&&(!required||a.length===1),'required unique sample table missing or duplicated.');return a[0];};
  async function table(node,width,head=8){const type=node.type,count=Number(await integer(node,4,4));fail(type,await integer(node,1,3)===0n&&(type==='ctts'||await integer(node,0,1)===0n),'unsupported sample table version/flags.');fail(type,count<=meta.maxRecords&&node.end-node.body===head+count*width,'sample table count/extent exceeds its exact budget.');const rows=[];
    for(let i=0;i<count;){const amount=Math.min(512,count-i),b=await meta.read(node.body+head+i*width,amount*width);for(let j=0;j<amount;j++)rows.push(b.subarray(j*width,(j+1)*width));i+=amount;}return rows;}
  async function flags(value,info,type){
    fail(type,(value&0xf0000000)===0,'reserved sample flag bits.');const leading=value>>>26&3,depends=value>>>24&3,depended=value>>>22&3,redundant=value>>>20&3,padding=value>>>17&7;
    fail(type,depends!==3&&depended!==3&&!redundant&&!padding&&!(value&65535),'unproved dependency/redundancy/padding/degradation flags.');
    if(info!==undefined){fail(type,!(value&0x10000)===info.key&&(depends===0||depends===(info.key?2:1)),'sample flags disagree with its coded access point.');
      fail(type,(!leading||leading===info.leading)&&(!depended||info.reference!==undefined&&depended===(info.reference?1:2)),'sample reference/leading flags disagree with the coded picture.');}
  }
  function append(state,packet){fail('seek_budget',packets.length<meta.maxRecords,'native seek packet records exceed the complete budget.');packet.ordinal=state.packets.length+1;state.packets.push(packet);packets.push(packet);state.clock=packet.dts+packet.duration;}
  async function validate(state,packet,type='stss'){
    const mdat=mdats.find(m=>packet.start>=m.body&&packet.start<m.end);fail(packet.offsetType||type,!!mdat,'sample offset does not locate its own media-data payload.');
    fail(packet.sizeType||type,packet.end>packet.start&&packet.end<=mdat.end,'sample size extends outside its own media-data payload.');
    if(state.track.kind==='video'){packet.sync=await packetSync({codec:state.track.stream.codec_name,config:state.config,read:meta.read,start:packet.start,end:packet.end,code:'REMUX_NATIVE_'+type.toUpperCase(),details:true});packet.key=packet.sync.key;
      if(packet.declaredKey!==undefined)fail(type,packet.declaredKey===packet.key,'sync sample declaration differs from its coded picture.');
    }else{packet.key=true;packet.sync={key:true,reference:false,leading:2};if(packet.declaredKey!==undefined)fail(type,packet.declaredKey,'an independently framed audio/subtitle sample is excluded from its own sync table.');}
    if(packet.flags!==undefined)await flags(packet.flags,packet.sync,packet.flagType);
  }
  for(const track of tracks){const stsd=one(track,'stsd'),stss=one(track,'stss');
    // Metadata-only injected fixtures have no sample description or indexes.
    // Every decodable ISO video has stsd; any declared index without it refuses.
    if(!stsd){fail('stss',!stss,'sync samples have no native sample description.');continue;}
    const plainSize=one(track,'stsz'),compactSize=one(track,'stz2');fail('stz2',!plainSize||!compactSize,'both ordinary and compact sample-size tables are present.');
    const size=plainSize||compactSize;fail('stsz',!!size,'native sample sizes are missing.');const count=Number(await integer(size,8,4));fail(size.type,count<=meta.maxRecords,'native sample count exceeds its budget.');let sizes=[];
    fail(size.type,await integer(size,0,4)===0n,'unsupported sample-size version/flags.');
    if(size.type==='stsz'){const common=Number(await integer(size,4,4));fail('stsz',size.end-size.body===12+(common?0:count*4),'sample-size extent mismatch.');
      if(common)sizes=Array(count).fill(common);else for(let i=0;i<count;i+=Math.min(1024,count-i)){const n=Math.min(1024,count-i),b=await meta.read(size.body+12+i*4,n*4);for(let j=0;j<n;j++)sizes.push(b.readUInt32BE(j*4));}
    }else{const bits=Number(await integer(size,7,1));fail('stz2',await integer(size,4,3)===0n&&[4,8,16].includes(bits)&&size.end-size.body===12+Math.ceil(count*bits/8),'compact sample-size extent/width mismatch.');for(let i=0;i<count;i++){const b=await integer(size,12+Math.floor(i*bits/8),bits===16?2:1);sizes.push(Number(bits===4?i%2?b&15n:b>>4n:b));}}
    const narrowOffsets=one(track,'stco'),largeOffsets=one(track,'co64');fail('co64',!narrowOffsets||!largeOffsets,'both narrow and wide chunk-offset tables are present.');
    const offsets=narrowOffsets||largeOffsets,sc=one(track,'stsc');fail('stsc',!!offsets&&!!sc,'native chunk mapping is missing.');
    const chunkRows=await table(offsets,offsets.type==='co64'?8:4),chunks=chunkRows.map(b=>{const n=Number(b.length===8?b.readBigUInt64BE():BigInt(b.readUInt32BE()));fail(offsets.type,Number.isSafeInteger(n),'chunk offset is not an exact native address.');return n;}),chunkMap=(await table(sc,12)).map(b=>[b.readUInt32BE(),b.readUInt32BE(4),b.readUInt32BE(8)]);
    fail('stsc',!count&&!chunks.length||chunkMap.length&&chunkMap[0][0]===1,'chunk mapping does not start at its first chunk.');
    for(let i=0;i<chunkMap.length;i++)fail('stsc',chunkMap[i][0]>0&&chunkMap[i][0]<=chunks.length&&chunkMap[i][1]>0&&chunkMap[i][2]===1&&(!i||chunkMap[i][0]>chunkMap[i-1][0]),'invalid chunk/sample-description mapping.');
    let mapped=0;for(let i=0;i<chunkMap.length;i++)mapped+=((chunkMap[i+1]?.[0]||chunks.length+1)-chunkMap[i][0])*chunkMap[i][1];fail('stsc',Number.isSafeInteger(mapped)&&mapped===count,'chunk mapping does not cover the exact own sample count.');
    const ts=one(track,'stts',true),ct=one(track,'ctts'),durations=[],compositions=[];
    for(const [n,result,composition]of [[ts,durations,false],...(ct?[[ct,compositions,true]]:[])]){
      const version=Number(await integer(n,0,1));fail(n.type,await integer(n,1,3)===0n&&version<=(composition?1:0),'unsupported sample clock version/flags.');
      for(const b of await table(n,8)){const repeat=b.readUInt32BE(),v=composition&&version===1?b.readInt32BE(4):b.readUInt32BE(4);fail(n.type,repeat>0&&result.length+repeat<=count,'invalid sample clock coverage.');for(let j=0;j<repeat;j++)result.push(v);}
      fail(n.type,result.length===count,'sample clocks do not cover every native sample.');
    }
    const sync=stss?new Set((await table(stss,4)).map(b=>b.readUInt32BE())):null;if(stss){const declared=(await table(stss,4)).map(b=>b.readUInt32BE());fail('stss',declared.every((n,i)=>n>0&&n<=count&&(!i||n>declared[i-1])),'sync sample numbers are duplicated, unordered or out of range.');}
    const configNode=nodes.find(n=>['avcC','hvcC','av1C'].includes(n.type)&&ancestor(n,'trak')===track.node);let config=null;if(configNode){fail(configNode.type,configNode.end-configNode.body<=65536,'access-point configuration exceeds its explicit full-extent budget.');config=await meta.read(configNode.body,configNode.end-configNode.body);}
    const state={track,config,packets:[],clock:0n,defaults:null,indexed:new Set()};byId.set(Number(track.trackId),state);let sample=0,map=0,clock=0n;
    for(let chunk=0;chunk<chunks.length;chunk++){while(map+1<chunkMap.length&&chunkMap[map+1][0]<=chunk+1)map++;let pos=chunks[chunk];
      for(let j=0;j<chunkMap[map][1];j++){fail('stsc',sample<count,'chunk map declares extra samples.');const duration=BigInt(durations[sample]),packet={start:pos,end:pos+sizes[sample],dts:clock,pts:clock+BigInt(compositions[sample]||0),duration,declaredKey:sync?sync.has(sample+1):true,offsetType:offsets.type,sizeType:size.type};await validate(state,packet);append(state,packet);clock+=duration;pos=packet.end;sample++;}}
    fail('stsc',sample===count,'chunk map omits native samples.');for(const p of state.packets)if(p.key)state.indexed.add(p.ordinal);
    const sdtp=one(track,'sdtp');if(sdtp){fail('sdtp',sdtp.end-sdtp.body===4+count&&await integer(sdtp,0,4)===0n,'dependency entries do not cover the native sample count.');for(let i=0;i<count;i++){const value=Number(await integer(sdtp,4+i,1)),depends=value>>4&3;
      const info=state.packets[i].sync,leading=value>>6,depended=value>>2&3;fail('sdtp',!(value&3)&&depended!==3&&depends!==3&&(!leading||leading===info.leading)&&(!depended||info.reference!==undefined&&depended===(info.reference?1:2)),'leading/reference/redundancy declaration differs from its coded picture.');
      fail('sdtp',depends===0||depends===(state.packets[i].key?2:1),'dependency declaration contradicts the coded access point.');}}
    if(one(track,'stps'))error('stps','partial-sync recovery has no proved native target mapping.');
  }
  for(const trex of nodes.filter(n=>n.type==='trex')){fail('trex',trex.end-trex.body===24&&await integer(trex,0,4)===0n,'invalid fragment-default header.');const id=Number(await integer(trex,4,4)),state=byId.get(id);fail('trex',state&&!state.defaults&&await integer(trex,8,4)===1n,'unknown/duplicate default track or sample description.');
    state.defaults={duration:Number(await integer(trex,12,4)),size:Number(await integer(trex,16,4)),flags:Number(await integer(trex,20,4))};await flags(state.defaults.flags,undefined,'trex');}
  for(const moof of nodes.filter(n=>n.type==='moof')){let previousEnd=null;const trafs=moof.children.filter(n=>n.type==='traf');
    for(const traf of trafs){const hs=traf.children.filter(n=>n.type==='tfhd');fail('tfhd',hs.length===1,'fragment needs one native track header.');const hd=hs[0],hf=Number(await integer(hd,1,3)),id=Number(await integer(hd,4,4)),state=byId.get(id);
      fail('tfhd',await integer(hd,0,1)===0n&&!(hf&~0x03003b)&&state?.defaults,'unknown fragment track/header flags.');let at=8,base=hf&1?Number(await integer(hd,at,8)):(hf&0x20000)||previousEnd===null?moof.start:previousEnd;if(hf&1)at+=8;
      if(hf&2){fail('tfhd',await integer(hd,at,4)===1n,'changed sample description.');at+=4;}
      const field=async(bit,fallback)=>{if(!(hf&bit))return fallback;const value=Number(await integer(hd,at,4));at+=4;return value;};
      const duration=await field(8,state.defaults.duration),size=await field(16,state.defaults.size),sampleFlags=await field(32,state.defaults.flags),flagType=hf&32?'tfhd':'trex';await flags(sampleFlags,undefined,flagType);fail('tfhd',at===hd.end-hd.body,'fragment-header extent mismatch.');
      const clocks=traf.children.filter(n=>n.type==='tfdt');fail('tfdt',clocks.length<=1,'duplicate fragment decode clock.');let clock=state.clock;
      if(clocks.length){const dt=clocks[0],version=Number(await integer(dt,0,1));fail('tfdt',version<=1&&dt.end-dt.body===(version?12:8)&&await integer(dt,1,3)===0n,'invalid fragment decode clock.');clock=await integer(dt,4,version?8:4);fail('tfdt',!state.packets.length||clock===state.clock,'fragment decode clock differs from the preceding own packets.');}
      let position=base;for(const run of traf.children.filter(n=>n.type==='trun')){const rf=Number(await integer(run,1,3)),version=Number(await integer(run,0,1)),count=Number(await integer(run,4,4));fail('trun',version<=1&&!(rf&~0xf05)&&count>0&&packets.length+count<=meta.maxRecords&&!(hf&0x10000)&&!((rf&4)&&(rf&0x400)),'invalid run version/count/flags.');let pos=8;
        if(rf&1){position=base+Number(await integer(run,pos,4,true));pos+=4;}const first=rf&4?Number(await integer(run,pos,4)):null;if(rf&4)pos+=4;
        const width=[0x100,0x200,0x400,0x800].filter(bit=>rf&bit).length*4;fail('trun',run.end-run.body===pos+count*width,'run extent does not cover its native samples.');
        for(let i=0;i<count;i++){let cursor=pos+i*width;const get=async(bit,fallback,signed=false)=>{if(!(rf&bit))return fallback;const value=Number(await integer(run,cursor,4,signed));cursor+=4;return value;};
          const d=await get(0x100,duration),n=await get(0x200,size),f=await get(0x400,i===0&&first!==null?first:sampleFlags),offset=await get(0x800,0,version===1),durationType=rf&0x100?'trun':hf&8?'tfhd':'trex',sizeType=rf&0x200?'trun':hf&16?'tfhd':'trex';fail(durationType,d>0,'fragment sample duration is unavailable.');fail(sizeType,n>0,'fragment sample size is unavailable.');
          const packet={start:position,end:position+n,dts:clock,pts:clock+BigInt(offset),duration:BigInt(d),flags:f,flagType:(rf&0x400||i===0&&first!==null)?'trun':flagType,offsetType:hf&1?'tfhd':'trun',sizeType,moof,traf,run,runNumber:i+1};await validate(state,packet,packet.flagType);append(state,packet);position=packet.end;clock+=packet.duration;
        }
      }previousEnd=position;
    }
  }
  for(const state of byId.values())if(state.track.selected&&state.track.kind==='video')streams.push({index:state.track.index,indexed:[...state.indexed]});
  return{streams,states:byId,packets};
}
module.exports={isoSeeking};
