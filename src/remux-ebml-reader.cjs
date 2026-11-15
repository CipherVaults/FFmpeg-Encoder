'use strict';
const {ToolError}=require('./process-runner.cjs');
const {MATROSKA_SCHEMA,INVENTORY}=require('./remux-native-inventory.cjs');

// RFC 8794 section 6.2 and the Matroska schema: only Segment and Cluster may
// have unknown sizes. Global Void/CRC-32 elements do not end either master.
// No read-ahead is permitted. Compressed block data stay unread; a bounded
// block header binds native track/timestamp references and terminal padding.
const DEPTH=12,GLOBALS=new Set(['Void','CRC-32']);
const OPAQUE=new Set(['SimpleBlock','Block','BlockVirtual','BlockAdditional','EncryptedBlock']);
const TYPES=new Map(MATROSKA_SCHEMA.map(e=>[e.id.toLowerCase(),e]));
const REFUSALS=new Map(INVENTORY.filter(r=>r.container==='matroska'&&r.treatment==='require-default'&&r.check==='absent').map(r=>[r.element,r]));
const DEFAULTS=new Map(INVENTORY.filter(r=>r.container==='matroska'&&r.treatment==='require-default'&&r.check==='mkv-default').map(r=>[r.element,r]));
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
async function walkMatroskaMetadata({end,maxRecords,read,add,seenTypes,stop,seekRecords=false}){
  const limits=ebmlLimits(maxRecords),stats={elements:0,headerBytes:0,clusterChildren:0,unknownClusters:0,
    knownClustersSkipped:0,blockBytesSkipped:0,blockHeaderBytesRead:0,peakDepth:0,limits,paddings:[],references:0};
  const lastBlocks=new Map(),packets=[],ordinals=new Map();let previousCluster=null;
  function packet(node,group=null){if(!seekRecords)return;const b=node.blockInfo,cluster=b.cluster;
    if(packets.length>=maxRecords)throw new ToolError('REMUX_NATIVE_SEEK_BUDGET','Native seek packets exceed the complete record budget.');
    const ordinal=(ordinals.get(b.trackId)||0)+1;ordinals.set(b.trackId,ordinal);
    const number=(cluster.blockNumber||0)+1;cluster.blockNumber=number;
    packets.push({trackId:b.trackId,ordinal,number,pts:String(b.pts),cluster:cluster.start,clusterBody:cluster.body,start:group?.start??node.start,body:node.body+b.width,end:node.end,lacing:b.flags&6,discardable:!group&&!!(b.flags&1),key:group?group.reference===undefined:!!(b.flags&128),duration:group?.duration===undefined?null:String(group.duration)});
  }
  const remember=(id,pts)=>{if(!lastBlocks.has(id)&&lastBlocks.size>=32)throw new ToolError('REMUX_NATIVE_TRACK_MAP','Native block tracks exceed the admitted stream bound.');lastBlocks.set(id,pts);};
  async function scalar(h,signed=false){const width=h.end-h.body,code='REMUX_NATIVE_'+h.entry.name.toUpperCase();if(width>8)throw new ToolError(code,'Invalid native '+h.entry.name+' scalar extent.');if(!width)return 0n;const b=await read(h.body,width);let v=0n;for(const x of b)v=v*256n+BigInt(x);return signed&&(b[0]&128)?v-(1n<<BigInt(width*8)):v;}
  async function blockHeader(h){if(h.end-h.body<4)throw new ToolError('REMUX_NATIVE_BLOCK','Truncated native block header.');let b=await read(h.body,4);stats.blockHeaderBytesRead+=4;const first=b[0];let width=1,mask=128;while(width<=8&&!(first&mask)){width++;mask>>=1;}
    if(width>8||h.end-h.body<width+3)throw new ToolError('REMUX_NATIVE_BLOCK','Invalid native block track/clock extent.');
    if(width>1){b=Buffer.concat([b,await read(h.body+4,width-1)]);stats.blockHeaderBytesRead+=width-1;}
    let id=BigInt(first&(mask-1));for(let i=1;i<width;i++)id=id*256n+BigInt(b[i]);if(!id)throw new ToolError('REMUX_NATIVE_BLOCK','Native block track number is zero.');
    const flags=b[width+2];if(flags&8||flags&(h.entry.name==='SimpleBlock'?0x70:0xf1))throw new ToolError('REMUX_NATIVE_BLOCK_FLAGS','Invisible or reserved block presentation flags have no proved target mapping.');
    return{trackId:String(id),relative:BigInt(b.readInt16BE(width)),width:width+3,flags};
  }
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
      if(!h.entry)throw new ToolError('REMUX_NATIVE_UNCLASSIFIED','Matroska: unclassified native element '+h.type+'; its playback meaning has not been verified.');
      if(!allowed(parent,h.entry)){
        if(unknown&&boundary(parent,h.entry))return{at,pending:h};
        fail('LEVEL','Native EBML ID '+h.type+' is not valid inside '+(parent?.name||'the document root')+'.');
      }
      seenTypes.add(h.type);if(!retain)stats.clusterChildren++;
      // Cluster children are streamed, not retained in an unbounded node tree.
      // Presence guards must therefore run here as well as on retained nodes.
      if(!retain){const refusal=REFUSALS.get(h.type);
        if(refusal)throw new ToolError(refusal.code,'matroska '+refusal.field+': '+refusal.reason);
        const rule=DEFAULTS.get(h.type);if(rule){const width=h.end-h.body;if(width>8)throw new ToolError(rule.code,'matroska '+rule.field+': invalid scalar extent.');let v=BigInt(rule.nativeDefault);if(width){v=0n;for(const x of await read(h.body,width))v=v*256n+BigInt(x);}if(v!==BigInt(rule.nativeDefault))throw new ToolError(rule.code,'matroska '+rule.field+': non-neutral streamed control.');}}
      const node=retain?add(h.type,h.body,h.end,(parent?.path||'')+'/'+h.entry.name,parent):{type:h.type,name:h.entry.name,body:h.body,end:h.end,parent};
      node.name=h.entry.name;
      node.start=h.at;
      if(!retain&&h.entry.name==='Timestamp'){if(parent.timestamp!==undefined||parent.blocksSeen)throw new ToolError('REMUX_NATIVE_TIMESTAMP','Duplicate or late Cluster Timestamp cannot bind its native blocks.');parent.timestamp=await scalar(h);}
      if(!retain&&h.entry.name==='Position'&&await scalar(h)!==BigInt(parent.start-parent.parent.body))throw new ToolError('REMUX_NATIVE_POSITION','Cluster Position does not resolve to its own segment offset.');
      if(!retain&&h.entry.name==='PrevSize'&&await scalar(h)!==BigInt(previousCluster===null?0:previousCluster.end-previousCluster.start))throw new ToolError('REMUX_NATIVE_PREVSIZE','Cluster PrevSize differs from its preceding own cluster extent.');
      if(!retain&&h.entry.name==='ReferenceBlock'){
        if(parent.reference!==undefined)throw new ToolError('REMUX_NATIVE_REFERENCEBLOCK','More than one native reference has no proved pinned-muxer mapping.');parent.reference=await scalar(h,true);
      }
      if(!retain&&['Block','SimpleBlock'].includes(h.entry.name)){
        const info=await blockHeader(h);let cluster=parent;while(cluster&&cluster.name!=='Cluster')cluster=cluster.parent;
        if(!cluster)throw new ToolError('REMUX_NATIVE_BLOCK','Native block has no Cluster clock.');cluster.blocksSeen=true;
        node.blockInfo={...info,pts:(cluster.timestamp??0n)+info.relative,previous:lastBlocks.get(info.trackId),cluster};
        if(stats.paddings.some(p=>p.trackId===info.trackId))throw new ToolError('REMUX_NATIVE_DISCARDPADDING','Padding is interior to its native track.');
        if(h.entry.name==='SimpleBlock'){remember(info.trackId,node.blockInfo.pts);packet(node);}
      }
      if(!retain&&h.entry.name==='Block'){
        if(parent.block)throw new ToolError('REMUX_NATIVE_DISCARDPADDING','A BlockGroup contains ambiguous multiple blocks.');parent.block=node;
      }
      if(!retain&&h.entry.name==='DiscardPadding'){
        if(parent.padding!==undefined)throw new ToolError('REMUX_NATIVE_DISCARDPADDING','Duplicate block padding is ambiguous.');parent.padding=await scalar(h,true);
        if(parent.padding<0n)throw new ToolError('REMUX_NATIVE_DISCARDPADDING','Negative block padding has no proved leading-trim mapping.');
      }
      if(!retain&&h.entry.name==='BlockDuration'){if(parent.duration!==undefined)throw new ToolError('REMUX_NATIVE_BLOCKDURATION','Duplicate native block durations are ambiguous.');parent.duration=await scalar(h);}
      if(h.entry.type==='master'&&!OPAQUE.has(h.entry.name)){
        if(h.entry.name==='Cluster'&&h.unknown)stats.unknownClusters++;
        const next=await walk(h.body,h.end,depth+1,node,h.unknown,retain&&h.entry.name!=='Cluster');
        if(h.entry.name==='BlockGroup'&&node.padding>0n){
          if(!node.block||stats.paddings.length>=32)throw new ToolError('REMUX_NATIVE_DISCARDPADDING','Padding lacks a single bounded native track/block binding.');
          const trackId=node.block.blockInfo.trackId;if(stats.paddings.some(p=>p.trackId===trackId))throw new ToolError('REMUX_NATIVE_DISCARDPADDING','More than one terminal padding declaration names a track.');
          stats.paddings.push({trackId,nanoseconds:String(node.padding)});
        }
        if(h.entry.name==='BlockGroup'){
          const b=node.block?.blockInfo;
          if(node.reference!==undefined){if(!b||b.previous===undefined||node.reference!==b.previous-b.pts)throw new ToolError('REMUX_NATIVE_REFERENCEBLOCK','Native ReferenceBlock is not the exact previous same-track block timestamp.');stats.references++;}
          if(b){remember(b.trackId,b.pts);packet(node.block,node);}
        }
        node.end=next.at;if(h.entry.name==='Cluster')previousCluster=node;at=next.at;pending=next.pending;if(!pending)continue;
        // The boundary header was already read and charged once. Its parent
        // now consumes it without rereading bytes or creating a second node.
        continue;
      }else if(OPAQUE.has(h.entry.name))stats.blockBytesSkipped+=h.end-h.body-(node.blockInfo?.width||0);
      at=h.end;
    }
    return{at,pending:null};
  }
  await walk(0,end,0);stop();return Object.freeze({...stats,blockTrackIds:[...lastBlocks.keys()],packets});
}
module.exports={walkMatroskaMetadata,ebmlLimits};
