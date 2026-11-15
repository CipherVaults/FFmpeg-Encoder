'use strict';
// Owned small fixtures supplement a caller-selected (maximum30 total) real-file
// set. Personal inputs are never written. Every temporary directory is created
// and removed by the existing owned-fixture helper, with path/prefix guards.
const fs=require('node:fs/promises'),path=require('node:path');
const {realWitness}=require('../tests/helpers/remux-real-witness.cjs'),{isoRewrite}=require('../tests/helpers/remux-packet-witnesses.cjs');
const {atom}=require('../tests/helpers/mov-fixture.cjs'),{focused,selected}=require('./v07-remux-admission-batch.cjs');
function rawMeta(bytes){let found=false;function walk(b){const out=[];for(let at=0;at<b.length;){const size=b.readUInt32BE(at),type=b.toString('latin1',at+4,at+8);let body=b.subarray(at+8,at+size);if(type==='meta'){if(body.toString('latin1',8,12)!=='hdlr')throw Error('Unexpected owned meta framing.');body=body.subarray(4);found=true;}else if(['moov','trak','udta'].includes(type))body=walk(body);out.push(atom(type,body));at+=size;}return Buffer.concat(out);}const out=walk(bytes);if(!found)throw Error('No owned metadata.');return out;}
function sound(bytes,version){return isoRewrite(bytes,'mp4a',b=>{const head=Buffer.from(b.subarray(0,28)),extra=Buffer.alloc(version===1?16:36);head.writeUInt16BE(version,8);head.writeUInt16BE(65534,20);if(version===1){extra.writeUInt32BE(1024,0);extra.writeUInt32BE(2,12);}else{extra.writeUInt32BE(72,0);extra.writeDoubleBE(48000,4);extra.writeUInt32BE(2,12);extra.writeUInt32BE(0x7f000000,16);extra.writeUInt32BE(16,20);extra.writeUInt32BE(1024,32);}return Buffer.concat([head,extra,b.subarray(28)]);});}
function movieSize(bytes,extended){const out=[];for(let at=0;at<bytes.length;){const size=bytes.readUInt32BE(at),type=bytes.toString('latin1',at+4,at+8),box=bytes.subarray(at,at+size);if(type==='moov'){if(extended){const header=Buffer.alloc(16);header.writeUInt32BE(1);header.write('moov',4);header.writeBigUInt64BE(BigInt(size+8),8);out.push(header,box.subarray(8));}else{const copy=Buffer.from(box);copy.writeUInt32BE(0);out.push(copy);}}else out.push(box);at+=size;}return Buffer.concat(out);}
async function run(log,beforeRoot,realFiles){selected(realFiles);if(realFiles.length>23)throw Error('Leave room for seven generated framing witnesses.');const cleanup=[],lab=[];
  try{for(const [label,options]of [
    ['sidx',{movflags:'frag_keyframe+empty_moov+default_base_moof+dash'}],
    ['quicktime-meta-raw',{transform:b=>rawMeta(isoRewrite(b,'ftyp',h=>{h.write('qt  ');return h;}))}],
    ['canon-CAEP',{transform:b=>isoRewrite(b,'ftyp',h=>{h.write('CAEP',h.length-4);return h;})}],
    ['sound-v1',{audio:true,transform:b=>sound(b,1)}],['sound-v2',{audio:true,transform:b=>sound(b,2)}],
    ['extended-moov',{transform:b=>movieSize(b,true)}],['zero-sized-final-moov',{transform:b=>movieSize(b,false)}]
  ]){const f=await realWitness({after:cb=>cleanup.push(cb)},'isobmff',options);lab.push({label,file:f.sourcePath});}
    await fs.appendFile(log,'FOCUSED_VARIANTS '+JSON.stringify(lab)+'\n');return await focused(log,beforeRoot,[...realFiles,...lab.map(r=>r.file)]);
  }finally{for(const close of cleanup.reverse())await close();}
}
if(require.main===module){const [log,beforeRoot]=process.argv.slice(2);(async()=>{const line=(await fs.readFile(log,'utf8')).split('\n').findLast(l=>l.startsWith('FOCUSED_INPUTS '));if(!line)throw Error('Missing explicit focused input list.');const result=await run(log,beforeRoot,JSON.parse(line.slice(15)));console.log(JSON.stringify(result));if(result.inconclusive.length)process.exitCode=1;})().catch(e=>{console.error(e);process.exitCode=1;});}
module.exports={run,rawMeta,sound,movieSize};
