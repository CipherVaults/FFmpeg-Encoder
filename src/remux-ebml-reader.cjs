'use strict';
const {ToolError}=require('./process-runner.cjs');
const {MATROSKA_SCHEMA}=require('./remux-native-inventory.cjs');

// RFC 8794 section 6.2 and the Matroska schema: only Segment and Cluster may
// have unknown sizes. Global Void/CRC-32 elements do not end either master.
// No read-ahead is permitted: even a one-byte block body must remain unread.
const DEPTH=12,GLOBALS=new Set(['Void','CRC-32']);
const OPAQUE=new Set(['SimpleBlock','Block','BlockVirtual','BlockAdditions','EncryptedBlock']);
const TYPES=new Map(MATROSKA_SCHEMA.map(e=>[e.id.toLowerCase(),e]));
const PARENTS=new Map(MATROSKA_SCHEMA.map(e=>{
  const parts=e.path.split('\\').filter(Boolean),parents=new Set([parts.at(-2)?.replace(/^\+/,'')]);
  if(parts.at(-1)?.startsWith('+'))parents.add(e.name);
  return[e.name,parents];
}));
const fail=(code,text)=>{throw new ToolError('REMUX_NATIVE_EBML_'+code,text);};
function ebmlLimits(maxRecords){
  const limits={elements:16*maxRecords+8192,headerBytes:32*maxRecords+65536,depth:DEPTH};
  if(!Number.isSafeInteger(maxRecords)||maxRecords<1||!Object.values(limits).every(v=>Number.isSafeInteger(v)&&v>0))
    fail('BUDGET','Invalid native EBML header-walk budget.');
  return Object.freeze(limits);
}
async function walkMatroskaMetadata({end,maxRecords,read,add,seenTypes,stop}){
  const limits=ebmlLimits(maxRecords),stats={elements:0,headerBytes:0,clusterChildren:0,unknownClusters:0,
    knownClustersSkipped:0,blockBytesSkipped:0,peakDepth:0,limits};
  async function headerRead(at,n){
    stop();if(stats.headerBytes+n>limits.headerBytes)fail('HEADER_BYTES','Native EBML header bytes exceed the proportional budget.');
    stats.headerBytes+=n;return read(at,n);
  }
  const width=(first,max)=>{let n=1,mask=128;while(n<=max&&!(first&mask)){n++;mask>>=1;}
    if(n>max)fail('HEADER','Invalid native EBML variable integer.');return n;};
  async function header(at,limit){
    stop();if(++stats.elements>limits.elements)fail('ELEMENTS','Native EBML elements exceed the proportional header-walk budget.');
    if(limit-at<2)fail('HEADER','Truncated native EBML element header.');
    // Two bytes are always header bytes (ID >= 1 byte, size >= 1 byte).
    const first=await headerRead(at,2),idWidth=width(first[0],4),id=Buffer.alloc(idWidth);id[0]=first[0];
    let sizeFirst=first[1];
    if(idWidth>1){if(limit-at<idWidth+1)fail('HEADER','Truncated native EBML element ID.');id[1]=first[1];
      const rest=await headerRead(at+2,idWidth-1);rest.copy(id,2,0,idWidth-2);sizeFirst=rest.at(-1);}
    let idValue=0n;for(const b of id)idValue=idValue*256n+BigInt(b);
    const idData=idValue&((1n<<BigInt(idWidth*7))-1n);
    // RFC 9559 section 4.2 corrects RFC 8794: one-byte ID 0x80 is
    // ChapterDisplay, not reserved. Other zero-data/all-one IDs stay invalid.
    if(!idData&&idValue!==128n||idData===(1n<<BigInt(idWidth*7))-1n)fail('HEADER','Reserved native EBML element ID.');
    const sizeWidth=width(sizeFirst,8),body=at+idWidth+sizeWidth;
    if(body>limit)fail('HEADER','Truncated native EBML element size.');
    let size=BigInt(sizeFirst&((1<<(8-sizeWidth))-1));
    if(sizeWidth>1)for(const b of await headerRead(at+idWidth+1,sizeWidth-1))size=size*256n+BigInt(b);
    const unknown=size===(1n<<BigInt(sizeWidth*7))-1n,type='0x'+idValue.toString(16),entry=TYPES.get(type);
    if(unknown&&(!entry||!['Segment','Cluster'].includes(entry.name)))fail('UNKNOWN_SIZE','Only native Matroska Segment and Cluster may have unknown lengths.');
    if(!unknown&&size>BigInt(limit-body))fail('EXTENT','Native EBML child extends past its parent or the file.');
    return{at,type,entry,body,end:unknown?limit:body+Number(size),unknown};
  }
  const allowed=(parent,entry)=>entry&&(GLOBALS.has(entry.name)||(['EBML','Segment'].includes(entry.name)?!parent:
    parent&&PARENTS.get(entry.name)?.has(parent.name)));
  const boundary=(parent,entry)=>entry&&!GLOBALS.has(entry.name)&&(['EBML','Segment'].includes(entry.name)
    ||parent.name==='Cluster'&&PARENTS.get(entry.name)?.has('Segment'));
  async function walk(start,limit,depth,parent=null,unknown=false,retain=true){
    stop();if(depth>limits.depth)fail('DEPTH','Native EBML nesting exceeds 12 levels.');stats.peakDepth=Math.max(stats.peakDepth,depth);
    let at=start,pending=null;
    while(at<limit){
      stop();const h=pending||await header(at,limit);pending=null;
      if(!allowed(parent,h.entry)){
        if(unknown&&boundary(parent,h.entry))return{at,pending:h};
        fail('LEVEL','Native EBML ID '+h.type+' is not valid inside '+(parent?.name||'the document root')+'.');
      }
      seenTypes.add(h.type);if(!retain)stats.clusterChildren++;
      const node=retain?add(h.type,h.body,h.end,(parent?.path||'')+'/'+h.entry.name,parent):{type:h.type,name:h.entry.name};
      node.name=h.entry.name;
      if(h.entry.name==='Cluster'&&!h.unknown){
        // The previous finite-Cluster path remains a direct seek. Only an
        // unknown-sized Cluster needs its child headers to establish its end.
        stats.knownClustersSkipped++;
      }else if(h.entry.type==='master'&&!OPAQUE.has(h.entry.name)){
        if(h.entry.name==='Cluster')stats.unknownClusters++;
        const next=await walk(h.body,h.end,depth+1,node,h.unknown,retain&&h.entry.name!=='Cluster');
        node.end=next.at;at=next.at;pending=next.pending;if(!pending)continue;
        // The boundary header was already read and charged once. Its parent
        // now consumes it without rereading bytes or creating a second node.
        continue;
      }else if(OPAQUE.has(h.entry.name))stats.blockBytesSkipped+=h.end-h.body;
      at=h.end;
    }
    return{at,pending:null};
  }
  await walk(0,end,0);stop();return Object.freeze(stats);
}
module.exports={walkMatroskaMetadata,ebmlLimits};
