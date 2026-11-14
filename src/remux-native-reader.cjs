'use strict';
// Metadata only, random access. Never open a media file for writing. Payload
// extents are skipped, not read into a buffer or used as an atom scanner.
const fs = require('node:fs/promises');
const { ToolError } = require('./process-runner.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const FIELDS = ['dev','ino','size','nlink','mtimeNs','ctimeNs','birthtimeNs'];
const need = (v, text) => { if (!v) throw new ToolError('REMUX_NATIVE_STRUCTURE', text); };
async function readNativeMetadata({file,identity,maxRecords=20000,timeoutMs=120000,signal,family}) {
  need(Number.isSafeInteger(maxRecords)&&maxRecords>0&&Number.isSafeInteger(maxRecords*256+8388608), 'Invalid native metadata budget.');
  need(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&Number.isSafeInteger(Date.now()+timeoutMs), 'Invalid native metadata deadline.');
  const deadline=Date.now()+timeoutMs,limit=maxRecords*256+8388608;
  const stop=()=>{if(signal?.aborted)throw new ToolError('CANCELLED','Native metadata inspection cancelled.');
    if(Date.now()>deadline)throw new ToolError('REMUX_NATIVE_TIMEOUT','Native metadata inspection exceeded its deadline.');};stop();
  await assertOrdinaryPath(file);const named=await fs.lstat(file,{bigint:true}),handle=await fs.open(file,'r');
  try{
    const before=await handle.stat({bigint:true});need(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(Number.MAX_SAFE_INTEGER)
      &&FIELDS.every(k=>before[k]===named[k])&&(!identity||FIELDS.filter(k=>k!=='nlink').every(k=>String(before[k])===identity[k])), 'Native metadata file identity changed.');
    let bytesRead=0,count=0;const nodes=[],seenTypes=new Set();
    async function read(at,n){stop();need(Number.isSafeInteger(at)&&Number.isSafeInteger(n)&&at>=0&&n>=0&&n<=65536&&at+n<=Number(before.size)
      &&(bytesRead+=n)<=limit,'Native metadata byte/extent budget exceeded.');const b=Buffer.alloc(n);for(let p=0;p<n;){const r=await handle.read(b,p,n-p,at+p);stop();need(r.bytesRead>0,'Truncated native metadata.');p+=r.bytesRead;}return b;}
    const add=(type,body,end,path,parent)=>{need(++count<=maxRecords*16+8192,'Native metadata element count exceeded.');seenTypes.add(type);
      const node={type,body,end,path,parent,children:[]};if(parent)parent.children.push(node);nodes.push(node);return node;};
    const isoMasters=new Set(['moov','trak','mdia','minf','stbl','edts','tapt','dinf','udta','wave','mvex','moof','traf','mfra','tref','sinf','schi','iprp','ipco']);
    async function iso(start,end,depth,parent=null){need(depth<=12,'Native atom depth exceeded.');for(let at=start;at<end;){
      need(end-at>=8,'Truncated native atom header.');const h=await read(at,8);let n=BigInt(h.readUInt32BE()),size=8;const type=h.toString('latin1',4,8);
      if(n===1n){need(end-at>=16,'Truncated extended native atom.');n=(await read(at+8,8)).readBigUInt64BE();size=16;}if(!n)n=BigInt(end-at);
      need(n>=BigInt(size)&&n<=BigInt(end-at),'Native atom exceeds its parent.');const node=add(type,at+size,at+Number(n),(parent?.path||'')+'/'+type,parent);
      if(isoMasters.has(type))await iso(node.body,node.end,depth+1,node);
      else if(type==='meta'){need(node.end-node.body>=4,'Truncated native meta box.');await iso(node.body+4,node.end,depth+1,node);}
      else if(type==='stsd'||type==='dref'){need(node.end-node.body>=8,'Truncated native entry table.');await iso(node.body+8,node.end,depth+1,node);}
      else if(parent?.type==='stsd'){
        const track=ancestor(node,'trak'),handler=track&&nodes.find(n=>ancestor(n,'trak')===track&&n.type==='hdlr'&&n.parent?.type==='mdia');
        // Sample-entry framing is defined by its registered type. Do not use
        // minf's QuickTime data-reference handler, or depend on mdia child order.
        const kind=['avc1','avc3','hvc1','hev1','av01','vp09','mp4v'].includes(type)?'vide':
          ['mp4a','alac','Opus','fLaC','ac-3','ec-3'].includes(type)?'soun':
          handler&&handler.end-handler.body>=12?(await read(handler.body+8,4)).toString('ascii'):null;
        let prefix=kind==='vide'?78:kind==='soun'?28:null;
        if(kind==='soun'){need(node.end-node.body>=28,'Truncated native sound entry.');const version=(await read(node.body+8,2)).readUInt16BE();need([0,1,2].includes(version),'Unknown native sound-entry version.');prefix=[28,44,64][version];}
        if(prefix!==null){need(node.end-node.body>=prefix,'Truncated native sample entry.');await iso(node.body+prefix,node.end,depth+1,node);}
      }
      // ilst items are metadata values, whose numeric IDs have meaning only
      // through keys. Retain the item, never scan a value as a child stream.
      at=node.end;
    }}
    let ebmlWalk;
    if(family==='isobmff')await iso(0,Number(before.size),0);
    else if(family==='matroska')ebmlWalk=await require('./remux-ebml-reader.cjs').walkMatroskaMetadata({end:Number(before.size),maxRecords,read,add,seenTypes,stop});
    else need(false,'Unknown native metadata family.');
    const result=await arguments[0].withMetadata({nodes,seenTypes,read,bytesRead:()=>bytesRead,stop,ebmlWalk});
    stop();const after=await handle.stat({bigint:true}),namedAfter=await fs.lstat(file,{bigint:true});need(FIELDS.every(k=>before[k]===after[k]&&after[k]===namedAfter[k]),'Native metadata changed during inspection.');
    // Read callbacks cannot outlive the identity-bound handle. Consumers run
    // inside withMetadata; no writable or unbranded file capability is exposed.
    return result;
  }finally{await handle.close();}
}
function ancestor(node,type){for(let p=node.parent;p;p=p.parent)if(p.type===type)return p;return null;}
module.exports={readNativeMetadata,ancestor};
