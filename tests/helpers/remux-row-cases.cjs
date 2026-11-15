'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs/promises');
const {realWitness}=require('./remux-real-witness.cjs');
const {fixture,isoEdit,atom,element,uint}=require('./native-inventory-collector.cjs');
const {isoRewrite,ebmlRewrite,compact,wideOffsets,blockForm}=require('./remux-packet-witnesses.cjs');
const {children}=require('./ebml-fixture.cjs');
const {relocateMatroska}=require('./remux-matroska-relocate.cjs');
const {withMetadata}=require('./native-metadata-fixture.cjs');
const {MATROSKA_SCHEMA}=require('../../src/remux-native-inventory.cjs');
const master=new Set(MATROSKA_SCHEMA.filter(r=>r.type==='master').map(r=>Number(r.id)));
function duplicate(bytes,id){return ebmlRewrite(bytes,id,b=>Buffer.concat([b,b]));}
function add(bytes,id,child){return ebmlRewrite(bytes,id,b=>Buffer.concat([b,child]));}
function fixed(bytes,id,n){return ebmlRewrite(bytes,id,b=>{let v=BigInt(n);for(let i=b.length-1;i>=0;i--){b[i]=Number(v&255n);v>>=8n;}assert.equal(v,0n);return b;});}
function inPlace(bytes,id,change){const out=Buffer.from(bytes);let found=false;function walk(start,end){for(const n of children(out,start,end)){if(!found&&n.id===id){change(out.subarray(n.body,n.end));found=true;}else if(master.has(n.id))walk(n.body,n.end);}}walk(0,out.length);assert.ok(found);return out;}
async function replace(f,bytes){for(const file of [f.sourcePath,f.outputPath])await fs.writeFile(file,bytes);f.original=bytes;return f;}
function nativeOnly(f,family){f.collect=async()=>{try{const {observeNativeInventory,compareNativeInventories}=require('../../src/remux-native-checks.cjs'),target=family==='isobmff'?'mp4':'matroska';
  const source=await observeNativeInventory({file:f.sourcePath,probe:f.source,family,target}),output=await observeNativeInventory({file:f.outputPath,probe:f.output,family,target});
  compareNativeInventories(source,output,f.source.streams.map(s=>({inputIndex:s.index,outputIndex:s.index})));return{status:'completed',nativeInventory:{source,output}};
}catch(e){return{status:'failed',failure:{code:e.code,message:e.message}};}};return f;}
function occurrences(bytes,id){let count=0;const walk=b=>{for(const n of children(b)){if(n.id===id)count++;if(master.has(n.id))walk(b.subarray(n.body,n.end));}};walk(bytes);return count;}
async function rowCase(t,r){
  if(r.container==='isobmff'&&r.id!=='isobmff:dref.external'&&(r.check==='iso-seek'||['stsd','dref','sv3d','proj'].includes(r.atom))){
    const fragment=['trex','tfhd','tfdt','trun'].includes(r.atom),f=await realWitness(t,'isobmff',{audio:false,movflags:fragment?'frag_keyframe+empty_moov+default_base_moof':undefined,
      transform:r.atom==='stz2'?compact:r.atom==='co64'?wideOffsets:undefined});let good=f.original,bad;
    if(['sv3d','proj'].includes(r.atom)){
      const projection=()=>atom('proj',Buffer.concat([atom('prhd',Buffer.alloc(16)),atom('equi',Buffer.alloc(20))]));
      good=isoRewrite(good,'avc1',b=>Buffer.concat([b,atom('sv3d',Buffer.concat([atom('svhd',Buffer.concat([Buffer.alloc(4),Buffer.from('fixture\0')])),projection()]))]));
      bad=isoRewrite(good,r.atom,b=>Buffer.concat([b,r.atom==='sv3d'?projection():atom('prhd',Buffer.alloc(16))]));
    }else bad=isoRewrite(good,r.atom,b=>{
      if(['stts','ctts','tfdt'].includes(r.atom))b[0]=2;
      else if(r.atom==='stsz')b.writeUInt32BE(0xffffffff,b.readUInt32BE(4)?4:12);
      else if(r.atom==='stz2')b[7]=7;
      else if(r.atom==='stsc')b.writeUInt32BE(2,8);
      else if(r.atom==='stco')b.writeUInt32BE(0xffffffff,8);
      else if(r.atom==='co64')b.writeBigUInt64BE(0xffffffffffffffffn,8);
      else if(r.atom==='stss')b.writeUInt32BE(2,8);
      else if(['stsd','dref'].includes(r.atom))b.writeUInt32BE(2,4);
      else if(r.atom==='trex')b.writeUInt32BE(2,8);
      else if(r.atom==='tfhd')b[1]|=0x80;
      else if(r.atom==='trun')b[0]=2;
      else assert.fail('missing native row fixture '+r.id);return b;
    });
    await replace(f,good);if(fragment||['sv3d','proj'].includes(r.atom))nativeOnly(f,'isobmff');return{f,mutant:bad};
  }
  if(r.id==='isobmff:dref.external'){
    const f=await realWitness(t,'isobmff',{audio:false});return{f,mutant:isoRewrite(f.original,'url ',b=>{b[3]=0;return b;})};
  }
  if(r.id==='isobmff:mfra'){
    const f=await fixture(t,'isobmff'),footer=Buffer.alloc(8);footer.writeUInt32BE(24,4);const good=Buffer.concat([f.original,atom('mfra',atom('mfro',footer))]),bad=Buffer.concat([f.original,atom('mfra',Buffer.concat([atom('mfro',footer),atom('mfro',footer)]))]);return{f:await replace(f,good),mutant:bad};
  }
  if(r.id==='isobmff:ilst.numeric-key-item'){
    const f=await fixture(t,'isobmff'),entries=[{key:'title',value:'same'}];
    return{f:await replace(f,withMetadata(f.original,entries)),mutant:withMetadata(f.original,entries,{index:0})};
  }
  if(r.container==='matroska'&&r.check==='mkv-seek'){
    if(['SimpleBlock.flags','Block.flags'].includes(r.field)){const f=await realWitness(t,'matroska',{transform:r.field==='Block.flags'?blockForm('Block'):undefined}),bad=inPlace(f.original,Number(r.element),b=>{b[3]^=128;});return{f,mutant:bad};}
    if(['Position','PrevSize'].includes(r.field)){
      const f=await fixture(t,'matroska'),top=children(f.original),segment=top.find(n=>n.id===0x18538067),body=f.original.subarray(segment.body,segment.end),first=element(0x1f43b675,Buffer.concat([element(0xe7,uint(0)),element(0xa7,uint(body.length))])),second=element(0x1f43b675,Buffer.concat([element(0xe7,uint(0)),element(0xab,uint(first.length))])),good=Buffer.concat([f.original.subarray(0,segment.at),element(segment.id,Buffer.concat([body,first,element(0xec,Buffer.alloc(3)),second]))]);
      const bad=inPlace(good,Number(r.element),b=>{b[b.length-1]++;});await replace(f,good);return{f,mutant:bad};
    }
    const f=await realWitness(t,'matroska'),id=Number(r.element);let good=relocateMatroska(f.original,ebmlRewrite(f.original,0x18538067,b=>b)),bad;
    let blockNumber;
    if(r.field==='CueBlockNumber'){
      function find(b){for(const n of children(b)){if(n.id===0x1f43b675){let number=0;for(const block of children(b,n.body,n.end))if([0xa3,0xa0].includes(block.id)){number++;const media=block.id===0xa0?children(b,block.body,block.end).find(c=>c.id===0xa1):block;if(media&&b[media.body]===0x81){blockNumber=number;return;}}}else if(master.has(n.id)){find(b.subarray(n.body,n.end));if(blockNumber)return;}}}find(good);assert.ok(blockNumber);good=relocateMatroska(good,add(good,0xb7,element(id,uint(blockNumber))));
    }
    if(r.field==='CueDuration'){good=blockForm('BlockDuration')(good);good=relocateMatroska(good,add(good,0xb7,element(id,uint(40))));}
    if(r.field==='SeekHead')bad=ebmlRewrite(good,0x114d9b74,()=>Buffer.alloc(0));
    else if(r.field==='Seek')bad=add(good,0x4dbb,element(0x53ac,uint(0)));
    else if(r.field==='SeekID')bad=inPlace(good,id,b=>{b[b.length-1]^=1;});
    else if(r.field==='Cues')bad=ebmlRewrite(good,0x18538067,b=>{const cue=children(b).find(n=>n.id===id);assert.ok(cue);return Buffer.concat([b,b.subarray(cue.at,cue.end)]);});
    else if(r.field==='CuePoint')bad=add(good,id,element(0xb3,uint(0)));
    else if(r.field==='CueTrackPositions')bad=add(good,id,element(0xf7,uint(1)));
    else if(r.field==='CueTime')bad=inPlace(good,id,b=>{b[b.length-1]^=1;});
    else if(r.field==='CueTrack')bad=inPlace(good,id,b=>{b.fill(0);b[b.length-1]=99;});
    else if(r.field==='CueDuration')bad=inPlace(good,id,b=>{b.fill(0);b[b.length-1]=41;});
    else if(r.field==='CueBlockNumber')bad=inPlace(good,id,b=>{b.fill(0);b[b.length-1]=blockNumber+1;});
    else if(['CueRelativePosition','CueClusterPosition','SeekPosition'].includes(r.field))bad=inPlace(good,id,b=>{b.fill(255);});
    else return null;
    if(['SeekHead','Seek','Cues','CuePoint','CueTrackPositions'].includes(r.field)&&r.field!=='Cues')bad=relocateMatroska(good,bad);
    await replace(f,good);return{f,mutant:bad};
  }
  if(r.id==='matroska:EditionFlagDefault'){
    const f=await fixture(t,'matroska'),editions=(a,b)=>element(0x1043a770,Buffer.concat([element(0x45b9,element(0x45db,uint(a))),element(0x45b9,element(0x45db,uint(b)))]));
    const good=add(f.original,0x18538067,editions(1,0)),bad=add(f.original,0x18538067,editions(0,0));await replace(f,good);return{f,mutant:bad};
  }
  if(r.container==='matroska'&&['ChapLanguage','ChapLanguageBCP47','ChapCountry'].includes(r.field)){
    const f=await fixture(t,'matroska'),make=value=>add(f.original,0x18538067,element(0x1043a770,element(0x45b9,element(0xb6,Buffer.concat([element(0x73c4,uint(1)),element(0x91,uint(0)),element(0x80,Buffer.concat([element(0x85,Buffer.from('chapter')),...(value?[element(Number(r.element),Buffer.from(value))]:[])]))])))));
    f.source.chapters.push({id:1,time_base:'1/1000000000',start:0,end:2000000000,tags:{title:'chapter'}});f.output.chapters=structuredClone(f.source.chapters);
    const good=make(r.field==='ChapCountry'?'':'eng'),bad=make(r.field==='ChapCountry'?'US':'fr');await replace(f,good);nativeOnly(f,'matroska');return{f,mutant:bad};
  }
  return null;
}
module.exports={rowCase,replace,fixed,add,occurrences,nativeOnly};
