'use strict';
const {ToolError}=require('./process-runner.cjs');
// Only codec framing and access-point headers enter memory. Coded picture
// bodies remain skipped; the existing complete packet/decode checks own them.
async function packetSync({codec,config,read,start,end,code,details=false}){
  const need=(ok,why)=>{if(!ok)throw new ToolError(code,why);};
  const result=(key,reference,leading=2)=>details?{key,reference,leading}:key;
  need(Number.isSafeInteger(start)&&Number.isSafeInteger(end)&&end>start,'Random-access packet has no bounded coded extent.');
  if(codec==='vp9'){
    const b=(await read(start,1))[0];need(b>>6===2,'Invalid VP9 frame marker.');let bit=4;const profile=(b>>5&1)|((b>>4&1)<<1);
    if(profile===3){need(!(b&8),'Reserved VP9 profile bit.');bit--;}
    if(b&(1<<(bit-1)))return result(false);return result(!(b&(1<<(bit-2))));
  }
  if(codec==='h264'||codec==='hevc'){
    const at=codec==='h264'?4:21;need(config&&config.length>at,'Random-access codec configuration is incomplete.');const width=(config[at]&3)+1;
    need([1,2,4].includes(width),'Unsupported native NAL length width.');let units=0,key=null,reference=null,leading=2;
    for(let pos=start;pos<end;){need(++units<=1024&&pos+width<=end,'Random-access NAL count/length exceeds its bound.');const len=(await read(pos,width)).readUIntBE(0,width);pos+=width;
      const bytes=codec==='h264'?1:2;need(len>=bytes&&pos+len<=end,'Random-access NAL exceeds its own packet.');const h=await read(pos,bytes);
      need(!(h[0]&128)&&(bytes===1||(h[1]&7)!==0),'Invalid random-access NAL header.');const type=codec==='h264'?h[0]&31:h[0]>>1&63;
      if(codec==='h264'&&type>=1&&type<=5||codec==='hevc'&&type<=31){const sync=codec==='h264'?type===5:type>=16&&type<=21,ref=codec==='h264'?!!(h[0]&96):type>=16||!!(type&1),lead=codec==='hevc'&&type>=6&&type<=9?(type<=7?3:1):2;
        need(key===null||key===sync,'A packet mixes independent and dependent pictures.');need(reference===null||reference===ref,'A packet mixes reference and non-reference picture declarations.');key=sync;reference=ref;leading=lead;}
      pos+=len;
    }need(key!==null,'A video sample has no independently classified picture.');return result(key,reference,leading);
  }
  if(codec==='av1'){
    need(config&&config.length>=4,'AV1 access-point configuration is incomplete.');let reduced=null,key=null,units=0;
    const scan=async(begin,limit,get,configuration=false)=>{for(let pos=begin;pos<limit;){need(++units<=1024,'AV1 access-point OBU count exceeds its bound.');const h=(await get(pos++,1))[0],type=h>>3&15;
      need(!(h&129),'Invalid AV1 access-point OBU header.');if(h&4){need(pos<limit,'Truncated AV1 OBU extension.');pos++;}
      let length=limit-pos;if(h&2){let size=0n,done=false;for(let i=0;i<8;i++){need(pos<limit,'Truncated AV1 OBU size.');const v=(await get(pos++,1))[0];size|=BigInt(v&127)<<BigInt(i*7);if(!(v&128)){done=true;break;}}need(done&&size<=BigInt(limit-pos),'AV1 OBU exceeds its packet.');length=Number(size);}
      need(pos+length<=limit,'AV1 OBU exceeds its own extent.');if(type===1){need(length>0,'Truncated AV1 sequence header.');reduced=!!((await get(pos,1))[0]&8);}
      if(!configuration&&[3,6].includes(type)&&key===null){need(length>0&&reduced!==null,'AV1 frame has no admitted sequence header.');const b=(await get(pos,1))[0];key=reduced||!(b&128)&&(b>>5&3)===0;}
      pos+=length;
    }};
    await scan(4,config.length,async(at,n)=>config.subarray(at,at+n),true);await scan(start,end,read);
    need(key!==null,'AV1 sample has no classified frame header.');return result(key);
  }
  throw new ToolError(code,'Video codec '+String(codec)+' has no native random-access packet classifier.');
}
module.exports={packetSync};
