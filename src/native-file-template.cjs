'use strict';
const fs=require('node:fs'),fsp=require('node:fs/promises'),{createHash}=require('node:crypto');
const {assertOrdinaryPath}=require('./candidate-runtime.cjs');
const {generationDescriptionOf,MARKER_KEY,OUTPUT_ID_KEY,GENERATION_KEY}=require('./provenance.cjs');
const {isNativeFileCommand}=require('./native-file-command.cjs');
// Bounds: 128 MiB output, parsed element headers and depth. The finite native
// contract admits at most 900 frames, far below MAX_ELEMENTS even with Cues.
const MAXIMUM_BYTES=128*1024**2,MAX_ELEMENTS=65536,MAX_DEPTH=12;
const ID={EBML:0x1a45dfa3,SEGMENT:0x18538067,INFO:0x1549a966,DURATION:0x4489,TRACKS:0x1654ae6b,ENTRY:0xae,TAGS:0x1254c367,TAG:0x7373,TARGETS:0x63c0,SIMPLE:0x67c8,NAME:0x45a3,STRING:0x4487,CRC:0xbf,DOCTYPE:0x4282,SEGMENT_UID:0x73a4,TRACK_UID:0x73c5,TRACK_NUMBER:0xd7,TAG_TRACK_UID:0x63c5,
  EBML_READ_VERSION:0x42f7,EBML_MAX_ID_LENGTH:0x42f2,EBML_MAX_SIZE_LENGTH:0x42f3,DOCTYPE_READ_VERSION:0x4285};
const MASTER=new Set([ID.EBML,ID.SEGMENT,ID.INFO,ID.TRACKS,ID.ENTRY,ID.TAGS,ID.TAG,ID.TARGETS,ID.SIMPLE,0x114d9b74,0x4dbb,0x1c53bb6b,0xbb,0xb7,0x1f43b675,0xa0,0xe0,0x55b0,0x55d0]);
// Domain separation: a template digest names its method/version and commits to
// the file length and the exact normalization layout, so it can never be
// confused with another method's digest or a file normalized at other offsets.
const METHOD='ffmpeg-encoder/native-matroska-complete-template/v1';
const table=Uint32Array.from({length:256},(_,i)=>{let c=i;for(let bit=0;bit<8;bit++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
const fail=(code,message,cause)=>{throw Object.assign(new Error(message),{code:'NATIVE_TEMPLATE_'+code},cause?{cause}:{});};
const sha=b=>createHash('sha256').update(b).digest('hex');
const receipts=new WeakSet();
function crc32(parts,check=()=>{}){let crc=0xffffffff;for(const bytes of parts)for(let i=0;i<bytes.length;i++){crc=table[(crc^bytes[i])&255]^(crc>>>8);if(!(i%65536))check();}return(crc^0xffffffff)>>>0;}
// Only an original command from buildNativeFileCommand is accepted. It is deep
// frozen, so its UUID/argv/description are read once and cannot change.
function checkOptions(command){if(!isNativeFileCommand(command)||!command.argv.includes('+bitexact'))fail('COMMAND','The original bitexact native command built by main is required.');const description=generationDescriptionOf(command.generationDescription);if(description?.version!==2)fail('COMMAND','Native-v2 generation metadata required.');return description;}

// Complete finalized-file template. Every unrecognized finite byte remains in
// the fingerprint; only validated global dynamic app fields/CRC values vary.
// This observes bytes, not media quality or a qualified policy/publication grant.
function inspect(bytes,command,{signal,deadlineAt=Number.MAX_SAFE_INTEGER}={}){
  if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>MAXIMUM_BYTES||bytes.buffer instanceof SharedArrayBuffer)fail('LIMIT','A complete nonshared bounded native Matroska buffer is required.');
  if(signal!==undefined&&!(signal instanceof AbortSignal)||!Number.isSafeInteger(deadlineAt))fail('LIMIT','Bounded main cancellation/deadline required.');
  const description=checkOptions(command),spans=[],masters=[],reserved=new Set();let count=0;
  const check=()=>{if(signal?.aborted)fail('CANCELLED','Template observation cancelled.');if(Date.now()>=deadlineAt)fail('DEADLINE','Template observation exceeded its admitted deadline.');};check();
  function vint(at,end,id=false){if(at>=end)fail('TRUNCATED','Missing EBML variable integer.');let n=1,mark=128;while(n<=8&&!(bytes[at]&mark)){n++;mark>>=1;}if(n>(id?4:8)||at+n>end)fail('VINT','Unsupported/truncated EBML variable integer.');let value=BigInt(id?bytes[at]:bytes[at]&(mark-1));for(let i=1;i<n;i++)value=value*256n+BigInt(bytes[at+i]);if(id){const data=value&((1n<<BigInt(7*n))-1n);if(data===(1n<<BigInt(7*n))-1n||n>1&&data<(1n<<BigInt(7*(n-1)))-1n)fail('VINT','Invalid EBML element identifier.');}return{length:n,value,unknown:!id&&value===(1n<<BigInt(7*n))-1n};}
  // Finalized dialect: every element, including the outer Segment, has a known
  // size. The pinned muxer patches the Segment size only in its trailer, so an
  // unknown size means the output was never finalized (killed or failed).
  function children(start,end,parent,depth){if(depth>MAX_DEPTH)fail('LIMIT','EBML depth exceeded.');const result=[];for(let at=start;at<end;){check();if(++count>MAX_ELEMENTS)fail('LIMIT','EBML element limit exceeded.');const id=vint(at,end,true),size=vint(at+id.length,end),data=at+id.length+size.length,numericId=Number(id.value);if(size.unknown)fail('UNKNOWN_SIZE','An unfinalized element of unknown size is outside the finalized dialect.');if(parent!==null&&(numericId===ID.EBML||numericId===ID.SEGMENT))fail('STRUCTURE','An EBML header or Segment may only appear at the top level.');const length=Number(size.value);if(!Number.isSafeInteger(length)||length<0||length>end-data)fail('TRUNCATED','EBML child exceeds its parent.');const item={id:numericId,start:at,data,end:data+length,length,parent,depth,children:[]};if(MASTER.has(item.id)){item.children=children(data,item.end,item,depth+1);masters.push(item);}result.push(item);at=item.end;}return result;}
  const top=children(0,bytes.length,null,0);if(top.length!==2||top[0].id!==ID.EBML||top[1].id!==ID.SEGMENT)fail('STRUCTURE','Exactly one EBML header and one complete Segment required.');
  const one=(nodes,id,label)=>{const found=nodes.filter(n=>n.id===id);if(found.length!==1)fail('STRUCTURE','Expected one '+label+'.');return found[0];};
  const atMostOne=(nodes,id,label)=>{const found=nodes.filter(n=>n.id===id);if(found.length>1)fail('STRUCTURE','Duplicate '+label+'.');return found[0];};
  const text=n=>{if(n.length>16384)fail('LIMIT','EBML text exceeds bound.');const raw=bytes.subarray(n.data,n.end),value=raw.toString('utf8');if(!Buffer.from(value).equals(raw)||value.includes('\0'))fail('TEXT','Invalid/noncanonical UTF8 in observed application metadata.');return value;};
  const uint=n=>{if(n.length<1||n.length>8)fail('INTEGER','Unsupported EBML unsigned scalar.');let value=0n;for(let at=n.data;at<n.end;at++)value=value*256n+BigInt(bytes[at]);return value;};
  // EBML header declarations must describe the parser actually used here.
  const header=top[0].children;
  if(text(one(header,ID.DOCTYPE,'DocType'))!=='matroska')fail('STRUCTURE','Matroska DocType required.');
  for(const [id,label,ok] of [[ID.EBML_READ_VERSION,'EBMLReadVersion',v=>v===1n],[ID.EBML_MAX_ID_LENGTH,'EBMLMaxIDLength',v=>v===4n],[ID.EBML_MAX_SIZE_LENGTH,'EBMLMaxSizeLength',v=>v>=1n&&v<=8n],[ID.DOCTYPE_READ_VERSION,'DocTypeReadVersion',v=>v>=1n&&v<=4n]]){const node=atMostOne(header,id,label);if(node&&!ok(uint(node)))fail('STRUCTURE','Unsupported EBML header '+label+'.');}
  const segment=top[1],info=one(segment.children,ID.INFO,'Info'),tracks=one(segment.children,ID.TRACKS,'Tracks');
  if(info.children.some(n=>n.id===ID.SEGMENT_UID))fail('BITEXACT','The native bitexact dialect must omit SegmentUID.');
  one(info.children,ID.DURATION,'finalized Info Duration');
  const entry=one(tracks.children,ID.ENTRY,'TrackEntry');
  if(uint(one(entry.children,ID.TRACK_UID,'TrackUID'))!==1n||uint(one(entry.children,ID.TRACK_NUMBER,'TrackNumber'))!==1n)fail('BITEXACT','The first native bitexact track must use TrackUID/Number1.');
  // The sole bitexact track is UID1, so any track-scoped tag must reference it;
  // TagTrackUID0 is the all-tracks scope and stays raw in the fingerprint.
  for(const parent of masters)if(parent.id===ID.TARGETS)for(const ref of parent.children.filter(n=>n.id===ID.TAG_TRACK_UID)){const value=uint(ref);if(value!==0n&&value!==1n)fail('BITEXACT','A tag references a track UID that does not exist in the bitexact output.');}
  for(const parent of masters){
    const crcs=parent.children.filter(n=>n.id===ID.CRC);if(crcs.length>1)fail('CRC','Duplicate CRC32.');
    if(crcs.length){const crc=crcs[0];
      // The pinned muxer writes CRC-32 only in level-1 elements. Accepting it
      // deeper would let nested CRCs re-scan the same bytes many times.
      if(parent.parent!==segment)fail('CRC','CRC32 outside a level-1 element is outside the dialect.');
      if(parent.children[0]!==crc||crc.length!==4)fail('CRC','CRC32 must be the first child with exactly four bytes.');const actual=crc32([bytes.subarray(parent.data,crc.start),bytes.subarray(crc.end,parent.end)],check);if(bytes.readUInt32LE(crc.data)!==actual)fail('CRC','CRC32 does not match the complete original parent bytes.');spans.push({start:crc.data,end:crc.end,replacement:Buffer.alloc(4),kind:'validated-crc'});}
    if(parent.id!==ID.SIMPLE)continue;
    const names=parent.children.filter(n=>n.id===ID.NAME);if(names.length!==1)fail('STRUCTURE','Each SimpleTag must have one TagName.');const name=text(names[0]);if(!/^FFMPEG_ENCODER_/i.test(name))continue;
    const key=name.toUpperCase();if(name!==key||![MARKER_KEY,OUTPUT_ID_KEY,GENERATION_KEY].includes(key)||reserved.has(key))fail('PROVENANCE','Unknown, case-variant or duplicate reserved native tag.');
    const tag=parent.parent;if(!tag||tag.id!==ID.TAG||tag.parent?.id!==ID.TAGS||tag.parent.parent!==segment)fail('PROVENANCE','Reserved native metadata must be a direct global SimpleTag.');
    const targets=tag.children.filter(n=>n.id===ID.TARGETS);if(targets.length!==1||targets[0].children.length)fail('PROVENANCE','Global native metadata requires empty Targets.');
    // Only TagName/TagString: a language/default variant changes the key the
    // demuxer reports (e.g. NAME-eng), so it is not the exact global tag.
    if(parent.children.some(n=>![ID.NAME,ID.STRING].includes(n.id)))fail('PROVENANCE','Unsupported reserved tag child.');
    const string=one(parent.children,ID.STRING,'reserved TagString'),value=text(string);reserved.add(key);
    if(key===MARKER_KEY){if(value!=='1')fail('PROVENANCE','Native marker version mismatch.');}
    else if(key===OUTPUT_ID_KEY){if(value!==command.outputId)fail('PROVENANCE','The current native output UUID did not round-trip.');spans.push({start:string.data,end:string.end,replacement:Buffer.from('00000000-0000-4000-8000-000000000000'),kind:'output-id'});}
    else{const actual=JSON.stringify(description);if(value!==actual)fail('PROVENANCE','The exact canonical current native-v2 generation did not round-trip.');const replacement=Buffer.from(JSON.stringify({...description,createdAt:'0000-00-00T00:00:00.000Z'}));if(replacement.length!==string.length)fail('PROVENANCE','Dynamic generation replacement changed encoded length.');spans.push({start:string.data,end:string.end,replacement,kind:'created-at'});}
  }
  if(reserved.size!==3)fail('PROVENANCE','All three exact global native application tags are required.');
  spans.sort((a,b)=>a.start-b.start);
  const manifest=JSON.stringify(spans.map(s=>[s.kind,s.start,s.end-s.start])),manifestSha256=sha(Buffer.from(manifest));
  let at=0;const canonical=createHash('sha256');canonical.update(`${METHOD}\n${bytes.length}\n${manifestSha256}\n`);
  for(const span of spans){if(span.start<at||span.replacement.length!==span.end-span.start)fail('STRUCTURE','Overlapping/unequal template masks.');canonical.update(bytes.subarray(at,span.start));canonical.update(span.replacement);at=span.end;}canonical.update(bytes.subarray(at));check();
  return {schema:1,kind:'native-matroska-complete-template',method:METHOD,bytes:bytes.length,sha256:sha(bytes),templateSha256:canonical.digest('hex'),manifestSha256,masks:spans.length,elements:count,validatedCrcs:spans.filter(s=>s.kind==='validated-crc').length,
    outputId:command.outputId,argvSha256:command.argvSha256,generationSha256:sha(JSON.stringify(description)),normalization:'exact-current-global-outputUUID/native-v2-createdAt-and-validated-CRC-only',executionAuthority:'none'};
}
const brand=result=>{Object.freeze(result);receipts.add(result);return result;};
// A buffer inspection describes bytes only; observeNativeFileTemplate is the only
// way to obtain a receipt that names an actual held stage file.
function inspectNativeFileTemplate(bytes,command,options){return brand({...inspect(bytes,command,options),observation:'buffer',file:null});}
// Genuine results only: a caller-shaped copy of a template receipt grants nothing.
function isNativeFileTemplate(value){return Boolean(value)&&typeof value==='object'&&receipts.has(value);}
const STAMP=['dev','ino','size','nlink','mtimeNs','ctimeNs','birthtimeNs'],stamp=s=>Object.fromEntries(STAMP.map(k=>[k,String(s[k])])),same=(a,b)=>STAMP.every(k=>a[k]===b[k]);
async function observeNativeFileTemplate(file,command,{signal,maximumBytes,deadlineAt}={}){
  if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>MAXIMUM_BYTES)fail('LIMIT','Explicit finalized-template file bound at most128MiB required.');
  if(!Number.isSafeInteger(deadlineAt)||signal!==undefined&&!(signal instanceof AbortSignal))fail('LIMIT','An explicit finite deadline and main cancellation signal are required.');
  const live=()=>{if(signal?.aborted)fail('CANCELLED','Template file observation cancelled.');if(Date.now()>=deadlineAt)fail('DEADLINE','Template file observation exceeded its admitted deadline.');};
  live();
  let canonical,before;
  try{canonical=await assertOrdinaryPath(file);before=await fsp.lstat(canonical,{bigint:true});}catch(error){fail('FILE','The native stage is not an ordinary readable file.',error);}
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1n||before.dev<=0n||before.ino<=0n||before.size<1n||before.size>BigInt(maximumBytes))fail('FILE','A bounded singly-linked ordinary stage required.');
  let handle;try{handle=await fsp.open(canonical,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));}catch(error){fail('FILE','The native stage could not be opened read-only.',error);}
  let primary=null;
  try{
    const expected=stamp(before),stable=async()=>{let held,named;try{await assertOrdinaryPath(canonical);[held,named]=await Promise.all([handle.stat({bigint:true}),fsp.lstat(canonical,{bigint:true})]);}catch(error){fail('FILE','The native stage changed or disappeared during observation.',error);}if(!held.isFile()||!named.isFile()||held.nlink!==1n||named.nlink!==1n||!same(expected,stamp(held))||!same(expected,stamp(named)))fail('FILE','The complete template file object/path/stamp changed.');};
    await stable();const bytes=Buffer.alloc(Number(before.size));for(let position=0;position<bytes.length;){live();let bytesRead;try{({bytesRead}=await handle.read(bytes,position,Math.min(1024**2,bytes.length-position),position));}catch(error){fail('FILE','The native stage could not be read completely.',error);}if(!bytesRead)fail('FILE','Template file ended early.');position+=bytesRead;}
    await stable();live();const result=inspect(bytes,command,{signal,deadlineAt});await stable();live();return brand({...result,observation:'file',file:canonical});
  }catch(error){primary=error;throw error;}
  finally{try{await handle.close();}catch(closeError){if(!primary)fail('FILE','The native stage handle did not close cleanly.',closeError);primary.closeFailure=closeError;}}
}
module.exports={inspectNativeFileTemplate,observeNativeFileTemplate,isNativeFileTemplate,NATIVE_TEMPLATE_MAXIMUM_BYTES:MAXIMUM_BYTES,NATIVE_TEMPLATE_METHOD:METHOD};
