'use strict';
const { ToolError }=require('./process-runner.cjs');
const { INVENTORY }=require('./remux-native-inventory.cjs');
const { readNativeMetadata,ancestor }=require('./remux-native-reader.cjs');
const { createHash }=require('node:crypto');
const { WINDOWS_TIMED_MATROSKA, assertWindowsTimedMatroskaProbe, readWindowsChapterDisplays }=require('./remux-windows-chapters.cjs');
const { readWindowsSubtitleBlocks }=require('./remux-windows-subrip.cjs');
const isoPayloadExtents=new WeakMap();
// ISO/IEC 23091-2/H.273 codes, using the pinned FFmpeg probe names. Native
// container colour declarations cannot hide behind a codec's different VUI.
const COLOUR=[{1:'bt709',4:'bt470m',5:'bt470bg',6:'smpte170m',7:'smpte240m',8:'film',9:'bt2020',10:'smpte428',11:'smpte431',12:'smpte432',22:'jedec-p22'},
  {1:'bt709',4:'bt470m',5:'bt470bg',6:'smpte170m',7:'smpte240m',8:'linear',9:'log100',10:'log316',11:'iec61966-2-4',12:'bt1361e',13:'iec61966-2-1',14:'bt2020-10',15:'bt2020-12',16:'smpte2084',17:'smpte428',18:'arib-std-b67'},
  {0:'gbr',1:'bt709',4:'fcc',5:'bt470bg',6:'smpte170m',7:'smpte240m',8:'ycgco',9:'bt2020nc',10:'bt2020c',11:'smpte2085',12:'chroma-derived-nc',13:'chroma-derived-c',14:'ictcp'}];
const fail=(r,text)=>{throw new ToolError(r.code,`${r.container} ${r.field}: ${text}`);};
function language(value){try{const s=value||'und';if(!/^[a-zA-Z]{2,8}(?:-[a-zA-Z0-9]{1,8})*$/.test(s)||s.length>255)throw Error();return Intl.getCanonicalLocales(s)[0].toLowerCase();}catch{throw new ToolError('REMUX_NATIVE_LANGUAGE','Native language is malformed or unsupported.');}}
function groupPartition(tracks){return tracks.map(t=>{const peers=tracks.filter(p=>p.kind===t.kind&&p.group!==0&&p.group===t.group);return{index:t.index,members:peers.length>1?peers.map(p=>p.index).sort((a,b)=>a-b):[]};});}
async function observeNativeInventory({file,probe,family,target,identity,maxRecords,timeoutMs,signal,selectedIndexes=probe.streams.map(s=>s.index),sourceEnvelope,retainIsoPayloadExtents=false}){
  const windowsTimed=sourceEnvelope===WINDOWS_TIMED_MATROSKA;
  if(windowsTimed&&(family!=='matroska'||target!=='matroska'))throw new ToolError('REMUX_NATIVE_CHAPTER_COPY','Exact Windows timed copy requires Matroska on both sides.');
  const kind=windowsTimed?assertWindowsTimedMatroskaProbe(probe):null;
  if(family==='mpegts')return {version:1,family,fields:[],encountered:[],coverage:'PAT/PMT/PCR/PES/ADTS/AVC transport preparation'};
  return readNativeMetadata({file,family,identity,maxRecords,timeoutMs,signal,seekRecords:true,withMetadata:async meta=>{
    const records=[],tracks=[],typeRows=INVENTORY.filter(r=>r.container===family),known=new Set(typeRows.map(r=>family==='matroska'?r.element:r.atom).filter(Boolean)),byType=new Map();
    for(const n of meta.nodes){let list=byType.get(n.type);if(!list)byType.set(n.type,list=[]);list.push(n);}
    for(const type of meta.seenTypes)if(!known.has(type))throw new ToolError('REMUX_NATIVE_UNCLASSIFIED',`${family}: unclassified native type ${JSON.stringify(type)}; its playback meaning has not been verified.`);
    async function integer(n,offset=0,width=n.end-n.body-offset,signed=false){
      if(width===0&&family==='matroska'&&offset===0){const d=require('./remux-native-inventory.cjs').MATROSKA_SCHEMA.find(e=>e.id===n.type)?.default;return BigInt(d??0);}
      if(width<1||width>8||offset<0||n.body+offset+width>n.end)throw new ToolError('REMUX_NATIVE_STRUCTURE','Invalid native scalar extent.');const b=await meta.read(n.body+offset,width);let v=0n;for(const x of b)v=v*256n+BigInt(x);if(signed&&(b[0]&128))v-=1n<<BigInt(width*8);return v;}
    async function floating(n,r){const len=n.end-n.body;if(!len)return Number(scalarDefault(n)??0);
      if(![4,8].includes(len))fail(r,'invalid floating-point extent.');const b=await meta.read(n.body,len),v=len===4?b.readFloatBE():b.readDoubleBE();if(!Number.isFinite(v))fail(r,'non-finite presentation value.');return v;}
    function scalarDefault(n){const d=require('./remux-native-inventory.cjs').MATROSKA_SCHEMA.find(e=>e.id===n.type)?.default;
      const hex=typeof d==='string'&&/^(-?)0x([0-9a-f]+)(?:\.([0-9a-f]+))?p([+-]?\d+)$/i.exec(d);
      return hex?(hex[1]?-1:1)*(parseInt(hex[2],16)+(hex[3]?parseInt(hex[3],16)/16**hex[3].length:0))*2**Number(hex[4]):d;}
    async function text(n,offset=0){const size=n.end-n.body-offset;if(size<0||size>1024)throw new ToolError('REMUX_NATIVE_STRUCTURE','Native string exceeds its bound.');if(!size&&family==='matroska')return String(scalarDefault(n)??'');const b=await meta.read(n.body+offset,size);try{return new TextDecoder('utf-8',{fatal:true}).decode(b).replace(/\0+$/,'');}catch{throw new ToolError('REMUX_NATIVE_STRUCTURE','Invalid native UTF-8.');}}
    if(windowsTimed){
      const types=byType.get('0x4282')||[];
      if(types.length!==1||await text(types[0])!=='matroska')throw new ToolError('REMUX_NATIVE_DOCTYPE','The measured timed route requires the Matroska DocType.');
    }
    const chapterDisplays=kind==='chapters'?await readWindowsChapterDisplays({meta,probe,integer,text}):null;
    const parents=meta.nodes.filter(n=>n.type===(family==='isobmff'?'trak':'0xae'));
    for(const t of parents){let stream,id;
      if(family==='isobmff'){const h=t.children.find(n=>n.type==='tkhd');if(!h)throw new ToolError('REMUX_NATIVE_STRUCTURE','Native track lacks tkhd.');const v=Number(await integer(h,0,1));id=await integer(h,v?20:12,4);stream=probe.streams.find(s=>s.id&&BigInt(s.id)===id);}
      else{const number=t.children.find(n=>n.type==='0xd7');if(!number)throw new ToolError('REMUX_NATIVE_STRUCTURE','Native track lacks TrackNumber.');id=await integer(number);const media=probe.streams.filter(s=>s.codec_type!=='attachment');stream=media.find(s=>s.id&&BigInt(s.id)===id)||media[parents.indexOf(t)];}
      if(!stream)throw new ToolError('REMUX_NATIVE_STRUCTURE','Native track has no admitted stream.');
      tracks.push({node:t,stream,index:stream.index,trackId:String(id),kind:stream.codec_type,selected:selectedIndexes.includes(stream.index),group:0});
    }
    if(family==='matroska'&&(new Set(tracks.map(t=>t.trackId)).size!==tracks.length||new Set(tracks.map(t=>t.index)).size!==tracks.length
      ||tracks.length!==probe.streams.filter(s=>s.codec_type!=='attachment').length))throw new ToolError('REMUX_NATIVE_TRACK_MAP','Native Matroska TrackNumbers do not cover the probed media tracks exactly.');
    if(family==='matroska'&&meta.ebmlWalk.blockTrackIds.some(id=>!tracks.some(t=>t.trackId===id)))throw new ToolError('REMUX_NATIVE_TRACK_MAP','A native block names an undeclared or unprobed track.');
    function context(n){const parent=ancestor(n,family==='isobmff'?'trak':'0xae');return tracks.find(t=>t.node===parent);}
    const relevant=n=>{const t=context(n);return !t||t.selected;};
    for(const r of typeRows){meta.stop();const matches=(byType.get(r.atom||r.element)||[]).filter(relevant);
      if(r.check==='mkv-reference'){records.push({id:r.id,treatment:r.treatment,instances:meta.ebmlWalk.references,values:[]});continue;}
      if(r.check==='mkv-padding'){
        const values=[];for(const p of meta.ebmlWalk.paddings){const t=tracks.find(t=>t.trackId===p.trackId);if(!t)fail(r,'padding names a foreign native track.');if(!t.selected)continue;
          const ns=BigInt(p.nanoseconds),rate=BigInt(t.stream.sample_rate||0),scaled=ns*rate,samples=(scaled+500000000n)/1000000000n,delta=scaled-samples*1000000000n;
          if(t.kind!=='audio'||t.stream.codec_name!=='aac'||rate<=0n||samples<=0n||samples>1024n||delta*2n>rate||delta*2n< -rate)fail(r,'terminal padding is not a proved AAC sample quantization.');
          values.push({index:t.index,value:String(samples)});
        }records.push({id:r.id,treatment:r.treatment,instances:values.length,values});continue;
      }
      if(['covered','descriptive'].includes(r.treatment)){records.push({id:r.id,treatment:r.treatment,instances:matches.length,check:r.check});continue;}
      const values=[];
      for(const n of matches){const t=context(n),stream=t?.stream;let value;
        if(r.check==='absent'){if(n.parent?.type==='tref')continue;fail(r,'presence is not supported for this target. '+r.reason);}
        else if(r.check==='uint-zero'||r.check==='bytes-zero'||r.check==='vmhd-mode'||r.check==='vmhd-opcolor'){
          const version=r.versionShift?Number(await integer(n,0,1)):0,at=r.offset+(version===1?r.versionShift||0:0);
          if(n.body+at+r.width>n.end)fail(r,'truncated field.');const b=await meta.read(n.body+at,r.width);value=b.toString('hex');
          const mode=r.check==='vmhd-mode'?b.readUInt16BE():null;
          if(r.check==='vmhd-opcolor'){
            const graphicsMode=Number(await integer(n,4,2));
            if(![0,64].includes(graphicsMode))fail(r,'the composition mode using these operands cannot be carried.');
            value=null;
          }else if(r.check==='vmhd-mode'?![0,64].includes(mode):!b.every(x=>x===0))fail(r,'non-default playback control cannot be carried.');
        }else if(r.check==='handler'){
          if(n.end-n.body<12)fail(r,'truncated handler.');value=(await meta.read(n.body+8,4)).toString('ascii');if(t&&n.parent?.type==='mdia'&&!({video:'vide',audio:'soun',subtitle:'text'}[t.kind]===value||t.kind==='subtitle'&&['sbtl','subt','clcp'].includes(value)))fail(r,'native handler differs from the admitted media kind.');
        }else if(r.check==='groups'){
          const v=Number(await integer(n,0,1));t.group=Number(await integer(n,v?46:34,2,true));value=t.group;
        }else if(r.check==='iso-language'){
          value=language(await text(n,4));if(value!==language(stream?.tags?.language))fail(r,'extended language differs from the language this target can carry.');
        }else if(r.check==='iso-media-language'){
          const version=Number(await integer(n,0,1)),code=Number(await integer(n,version===1?32:20,2));
          if(version>1)fail(r,'unknown native language header version.');
          const native=code===0x7fff?'und':code<0x400?require('./remux-language-codes.cjs')[code]:
            String.fromCharCode(96+((code>>10)&31),96+((code>>5)&31),96+(code&31));
          if(!native||!/^[a-z]{3}$/.test(native))fail(r,'unknown native language code.');
          value=language(native);
          const extended=n.parent?.children.some(p=>p.type==='elng');
          if(!extended&&value!==language(stream?.tags?.language))fail(r,'native language differs from the admitted stream language.');value=null;
        }else if(r.check==='clean-aperture'){
          if(n.end-n.body!==32)fail(r,'malformed aperture.');const b=await meta.read(n.body,32),a=Array.from({length:8},(_,i)=>b.readUInt32BE(i*4));
          if(!a[1]||!a[3]||!a[5]||!a[7])fail(r,'zero aperture denominator.');
          value=BigInt(a[0])===BigInt(stream.width)*BigInt(a[1])&&BigInt(a[2])===BigInt(stream.height)*BigInt(a[3])&&!a[4]&&!a[6]?null:a.map(String).join('/');
        }else if(r.check==='pixel-aspect'){
          if(n.end-n.body!==8)fail(r,'malformed pixel aspect ratio.');const b=await meta.read(n.body,8),w=b.readUInt32BE(),h=b.readUInt32BE(4),sar=(stream.sample_aspect_ratio||'1:1').split(':');
          if(!w||!h||sar.length!==2||!sar.every(v=>/^\d+$/.test(v))||!BigInt(sar[1])||BigInt(w)*BigInt(sar[1])!==BigInt(h)*BigInt(sar[0]))fail(r,'native pixel aspect differs from the admitted picture.');value=null;
        }else if(r.check==='field-order'){
          if(n.end-n.body!==2)fail(r,'malformed field declaration.');const b=await meta.read(n.body,2),order=b[0]===1&&b[1]===0?'progressive':b[0]===2?({1:'tt',6:'bb',9:'tb',14:'bt'}[b[1]]):null;
          if(!order||order!==stream.field_order)fail(r,'native fields differ from admitted codec field order.');value=null;
        }else if(r.check==='colour-method'){
          if(n.end-n.body<4)fail(r,'truncated colour method.');const method=(await meta.read(n.body,4)).toString('ascii');value=null;
          if(['nclx','nclc'].includes(method)){
            if(n.end-n.body!==(method==='nclx'?11:10))fail(r,'malformed enumerated colour declaration.');const b=await meta.read(n.body,n.end-n.body),names=['color_primaries','color_transfer','color_space'];
            for(let i=0;i<3;i++){const code=b.readUInt16BE(4+i*2);if(code!==2&&(!COLOUR[i][code]||COLOUR[i][code]!==stream[names[i]]))fail(r,'native '+names[i]+' differs from admitted colour.');}
            if(method==='nclx'&&((b[10]&127)||stream.color_range!==(b[10]&128?'pc':'tv')))fail(r,'native range differs from admitted colour range.');
          }else{const hash=createHash('sha256');for(let at=n.body+4;at<n.end;){const size=Math.min(65536,n.end-at);hash.update(await meta.read(at,size));at+=size;}value=method==='prof'||method==='rICC'?'icc:'+hash.digest('hex'):method+':'+hash.digest('hex');}
        }else if(r.check==='self-reference'){
          value='self-contained';for(const ref of n.children)if(ref.type!=='url '||ref.end-ref.body!==4||await integer(ref,0,4)!==1n)fail(r,'external/aliased data references are not supported.');
        }else if(r.check==='aac-groups'){
          if(n.end-n.body>65536)fail(r,'sample-group list exceeds its explicit complete-inspection budget.');
          const hash=createHash('sha256');for(let at=n.body;at<n.end;){const size=Math.min(65536,n.end-at);hash.update(await meta.read(at,size));at+=size;}value=hash.digest('hex');
          if(n.end-n.body<=65536){const b=await meta.read(n.body,n.end-n.body),v=b[0];
            if(b.length<4||b.readUIntBE(1,3)!==0)fail(r,'unsupported sample-group FullBox flags.');
            if(stream?.codec_name==='aac'&&b.length>=12&&b.toString('ascii',4,8)==='roll'&&v<=1){
              if(n.type==='sgpd'){const at=v?16:12;if(b.length===at+2&&(!v||b.readUInt32BE(8)===2)&&b.readUInt32BE(v?12:8)===1&&b.readInt16BE(at)===-1)value=null;}
              else{const at=v?12:8;if(b.length>=at+4){const count=b.readUInt32BE(at);let ordinary=count>0&&count<=meta.maxRecords&&b.length===at+4+count*8&&(!v||b.readUInt32BE(8)===0),covered=0;
                for(let i=0;ordinary&&i<count;i++){const samples=b.readUInt32BE(at+4+i*8);ordinary=samples>0&&b.readUInt32BE(at+8+i*8)===1;covered+=samples;}
                const sizes=meta.nodes.find(p=>['stsz','stz2'].includes(p.type)&&ancestor(p,'trak')===t?.node);if(ordinary&&sizes&&covered===Number(await integer(sizes,8,4)))value=null;}}
            }
          }
          if(value!==null)fail(r,'only the complete native AAC roll-minus-one sample-group mapping is proved.');
        }else if(r.check==='sample-dependencies'){
          const size=n.end-n.body;
          if(size<4||await integer(n,0,4)!==0n)fail(r,'invalid dependency FullBox header.');
          const table=meta.nodes.find(p=>['stsz','stz2'].includes(p.type)&&ancestor(p,'trak')===t?.node);
          if(!table||table.end-table.body<12||Number(await integer(table,8,4))!==size-4)fail(r,'dependency entries do not cover the native sample count.');
          // Unknown (00) dependencies impose no condition beyond absence.
          // Preserve every nonzero bit exactly, including reserved bits.
          const hash=createHash('sha256');let neutral=true;
          for(let at=n.body+4;at<n.end;){const b=await meta.read(at,Math.min(65536,n.end-at));hash.update(b);neutral&&=b.every(x=>x===0);at+=b.length;}
          value=neutral?null:hash.digest('hex');
        }else if(['mkv-seek','iso-seek'].includes(r.check)){
          value=null;
        }else if(r.check==='iso-index'){
          value=null; // Runs after own native sample/access-point validation.
        }else if(r.check.startsWith('iso-')&&['iso-ftyp','iso-stsd','iso-zero-box','iso-self-entry','iso-sample-entry','iso-frma','iso-chpl','iso-chan','iso-config','iso-dref'].includes(r.check)){
          value=await require('./remux-native-isobmff.cjs').isoValue({r,n,stream,meta,probe,target,integer,text});
        }else if(r.check==='fingerprint'){
          const hash=createHash('sha256');for(let at=n.body;at<n.end;){const size=Math.min(65536,n.end-at);hash.update(await meta.read(at,size));at+=size;}value=hash.digest('hex');
        }else if(r.check==='references'){
          value=[];for(const ref of n.children){if((ref.end-ref.body)%4||ref.end-ref.body>128)fail(r,'invalid track-reference extent.');const members=[];
            for(let at=ref.body;at<ref.end;at+=4){const id=(await meta.read(at,4)).readUInt32BE(),track=tracks.find(t=>t.trackId===String(id));if(!track)fail(r,'reference names a foreign native track.');members.push(track.index);}value.push({kind:ref.type,members});}
        }else if(r.check==='mkv-crc'){
          if(n.end-n.body!==4)fail(r,'integrity checksum must have its declared four-byte extent.');value=null;
        }else if(r.check==='mkv-corroborated'){
          value=await require('./remux-native-matroska.cjs').matroskaValue({r,n,t,stream,meta,probe,tracks,byType,integer,floating,text,language,selectedIndexes});
        }else if(r.check==='mkv-semantic'){
          value=await require('./remux-native-matroska.cjs').matroskaSemantic({r,n,meta,probe,tracks,byType,integer,text,language,ancestor});
        }else if(r.check==='mkv-codec-delay'){
          const ns=await integer(n),rate=BigInt(stream?.sample_rate||0),hint=String(stream?.initial_padding??'');
          if(ns){if(t?.kind!=='audio'||rate<=0n||!/^[0-9]{1,10}$/.test(hint))fail(r,'delay lacks an exact carried initial sample count.');
            const samples=BigInt(hint),numerator=samples*1000000000n;if(samples<=0n||samples>0xffffffffn||ns!==numerator/rate&&ns!==(numerator+rate-1n)/rate)fail(r,'delay differs from the carried initial-padding sample count.');value=String(samples);
          }else{if(/^[0-9]{1,10}$/.test(hint)&&BigInt(hint)>0n)fail(r,'zero native delay contradicts the carried initial-padding sample count.');value=null;}
        }else if(r.check==='mkv-value'){
          if(r.type==='float')value=String(await floating(n,r));
          else value=String(await integer(n,0,n.end-n.body,r.type==='integer'));
          if(r.field==='DisplayUnit'&&value==='3')value='0';
          if(r.field==='SeekPreRoll'&&target!=='matroska'&&value!=='0')fail(r,'nonzero native preroll has no proved carried target sample-group mapping.');
        }else if(r.check==='mkv-default'){
          if(r.type==='float')value=await floating(n,r);
          else value=Number(await integer(n,0,n.end-n.body,r.type==='integer'));
          if(value!==r.nativeDefault)fail(r,`native value ${value} must be ${r.nativeDefault}.`);
        }else if(r.check==='chroma-siting'){
          const sibling=id=>n.parent.children.find(p=>p.type===id),h=sibling('0x55b7'),v=sibling('0x55b8');
          const x=h?Number(await integer(h)):0,y=v?Number(await integer(v)):0;
          const location=({'1,1':'topleft','1,2':'left','2,1':'top','2,2':'center'})[x+','+y];
          if((x||y)&&(!location||location!==stream?.chroma_location))fail(r,'native chroma coordinates are partial, unsupported or disagree with the carried codec location.');
          value=null;
        }else if(r.check==='chapter-language'){
          // BCP47 overrides all legacy ChapLanguage values in its display.
          // Do not reject an overridden legacy code when the effective label
          // is the same English label the muxer will carry.
          if(chapterDisplays||n.type==='0x437c'&&n.parent.children.some(p=>p.type==='0x437d'))value=null;
          else{value=language(await text(n));if(value!=='en')fail(r,'non-English chapter language is not carried by the pinned muxer.');value=null;}
        }else if(r.check==='chapter-display'){
          const labels=n.parent.children.filter(p=>p.type==='0x80'),titles=[];
          for(const label of labels){const strings=label.children.filter(p=>p.type==='0x85');if(!strings.length)fail(r,'a chapter display lacks its required title.');
            for(const s of strings)titles.push(await text(s));}
          if(titles.some(s=>s!==titles[0]))fail(r,'alternative chapter titles are not carried by the pinned muxer.');value=null;
        }else if(r.check==='flat-chapters'){
          if(ancestor(n,'0xb6'))fail(r,'nested chapter navigation is not carried by the pinned muxer.');value=null;
        }else if(r.check.startsWith('disposition-')){
          value=Number(await integer(n));const key=r.check.slice(12),wanted=Number(stream?.disposition?.[key]||0);if(value!==wanted)fail(r,'native selection flag differs from the admitted disposition.');
        }else if(r.check==='language'){
          value=language(await text(n));const legacy=t.node.children.find(n=>n.type==='0x22b59c'),actualLegacy=legacy?await text(legacy):'eng';
          if(value!==language(actualLegacy)||value!==language(stream?.tags?.language||actualLegacy))fail(r,'authoritative BCP47 language cannot be represented by the admitted legacy language.');
        }else if(r.check==='display'){
          value=String(await integer(n));const video=n.parent,sibling=id=>video.children.find(n=>n.type===id),pw=sibling('0xb0'),ph=sibling('0xba'),dw=sibling('0x54b0'),dh=sibling('0x54ba');
          const w=await integer(dw||pw),h=await integer(dh||ph),sar=(stream.sample_aspect_ratio||'1:1').split(':').map(BigInt);
          // EBML permits 64-bit integers. Never round an untrusted display
          // dimension through Number before the exact aspect comparison.
          if(!w||!h||sar.length!==2||w*BigInt(stream.height)*sar[1]!==h*BigInt(stream.width)*sar[0])fail(r,'native display ratio differs from admitted picture geometry.');
        }else if(r.check==='single-edition'){
          value=Number(await integer(n));if((byType.get('0x45b9')||[]).length<=1)value=null;
        }else if(r.check==='editions'){
          value=(byType.get('0x45b9')||[]).length;value=value<=1?null:value;
        }else if(r.check==='projection-structure'){
          const children=n.children.filter(c=>!['free','skip','wide'].includes(c.type));
          if(n.type==='sv3d'&&(children.filter(c=>c.type==='svhd').length!==1||children.filter(c=>c.type==='proj').length!==1))fail(r,'one spherical header and projection are required.');
          if(n.type==='proj'&&(children.filter(c=>c.type==='prhd').length!==1||children.filter(c=>['equi','cbmp','mshp'].includes(c.type)).length!==1))fail(r,'one projection header and one projection definition are required.');
          if(target==='matroska')fail(r,'this native projection framing has no proved Matroska representation.');value=null;
        }else if(r.check==='metadata-key'||r.check==='native-metadata'){
          // A dedicated keys walk below handles the variable-length table.
          continue;
        }else fail(r,'inventory handler is not implemented.');
        values.push({index:t?.index??null,value});
      }
      records.push({id:r.id,treatment:r.treatment,instances:matches.length,values});
    }
    if(family==='isobmff'){
      meta.seeking=await require('./remux-native-samples.cjs').isoSeeking({meta,tracks,integer});
      for(const r of typeRows.filter(r=>r.check==='iso-index'))for(const n of byType.get(r.atom)||[])await require('./remux-native-indexes.cjs').isoIndex({r,n,meta,probe,integer});
      let metadataBridgeComplete=true;
      const copied=tracks.filter(t=>t.selected),partition=groupPartition(copied);
      for(const kind of ['video','audio']){const peers=copied.filter(t=>t.kind===kind);if(peers.length>1&&peers.some(t=>!t.group||t.group!==peers[0].group))fail(typeRows.find(r=>r.check==='groups'),'the target cannot carry independent simultaneous groups.');}
      for(const n of meta.nodes.filter(n=>n.type==='keys')){if(n.end-n.body>65536)throw new ToolError('REMUX_NATIVE_STRUCTURE','Metadata keys exceed their bound.');const b=await meta.read(n.body,n.end-n.body);if(b.length<8)throw new ToolError('REMUX_NATIVE_STRUCTURE','Truncated metadata keys.');let at=8;const count=b.readUInt32BE(4);if(count>4096)throw new ToolError('REMUX_NATIVE_STRUCTURE','Excessive metadata keys.');for(let i=0;i<count;i++){if(at+8>b.length)throw new ToolError('REMUX_NATIVE_STRUCTURE','Truncated metadata key.');const size=b.readUInt32BE(at);if(size<8||at+size>b.length)throw new ToolError('REMUX_NATIVE_STRUCTURE','Invalid metadata key extent.');const key=b.toString('utf8',at+8,at+size),r=typeRows.find(r=>r.key&&r.key.toLowerCase()===key.toLowerCase());
        if(r){const item=n.parent.children.find(c=>c.type==='ilst');if(!item||item.end-item.body>65536)fail(r,'missing or excessive functional metadata values.');
          const data=await meta.read(item.body,item.end-item.body);let pos=0,found=null;while(pos<data.length){if(pos+8>data.length)fail(r,'truncated metadata item.');const size=data.readUInt32BE(pos);if(size<8||pos+size>data.length)fail(r,'invalid metadata item extent.');if(data.readUInt32BE(pos+4)===i+1)found=data.subarray(pos+8,pos+size);pos+=size;}
          if(!found)fail(r,'functional metadata key lacks its value.');const record=records.find(p=>p.id===r.id);record.values.push({index:context(n)?.index??null,value:createHash('sha256').update(found).digest('hex')});
        }at+=size;}if(at!==b.length)throw new ToolError('REMUX_NATIVE_STRUCTURE','Metadata key extent mismatch.');}
      const {classifyRemuxMetadataTag}=require('./remux-metadata-policy.cjs'),{MARKER_KEY,OUTPUT_ID_KEY,GENERATION_KEY}=require('./provenance.cjs');
      const replaced=new Set([MARKER_KEY,OUTPUT_ID_KEY,GENERATION_KEY].map(s=>s.toLowerCase()));
      const legacy={'©too':'encoder','©swr':'software','©nam':'title','©ART':'artist','©alb':'album','©day':'date','©cmt':'comment','©gen':'genre','©cpy':'copyright','©wrt':'composer','©enc':'encoded_by'};
      for(const itemList of meta.nodes.filter(n=>n.type==='ilst')){
        const keys=itemList.parent?.children.filter(n=>n.type==='keys')||[];if(keys.length>1)throw new ToolError('REMUX_NATIVE_META_INDEX','Duplicate metadata keys tables are ambiguous.');
        const names=[];
        if(keys.length){const n=keys[0],b=await meta.read(n.body,n.end-n.body);if(b.length<8||b.readUInt32BE(0)!==0)throw new ToolError('REMUX_NATIVE_META_INDEX','Unsupported metadata keys FullBox.');
          const count=b.readUInt32BE(4);let at=8;
          for(let i=0;i<count;i++){const size=b.readUInt32BE(at);if(b.toString('ascii',at+4,at+8)!=='mdta')throw new ToolError('REMUX_NATIVE_META_INDEX','Unsupported metadata key namespace.');
            let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(at+8,at+size));}catch{throw new ToolError('REMUX_NATIVE_META_INDEX','Invalid metadata key encoding.');}
            if(!name||name.length>256||/[\x00-\x1f\x7f]/.test(name))throw new ToolError('REMUX_NATIVE_META_INDEX','Invalid metadata key.');names.push(name);at+=size;
          }
        }
        const values=[],index=context(itemList)?.index??null,scope=index===null?'container':'stream';
        for(const item of itemList.children){
          if(['free','skip','wide'].includes(item.type))continue;
          const name=item.type==='mdta-item'?names[item.keyIndex-1]:legacy[item.type]||item.type;
          if(!name)throw new ToolError('REMUX_NATIVE_META_INDEX','Metadata item has no declared key.');
          const classification=classifyRemuxMetadataTag(name,{scope}).classification;
          const required=!replaced.has(name.toLowerCase())&&!(scope==='container'&&['major_brand','minor_version','compatible_brands'].includes(name.toLowerCase()))&&!['descriptive','operation-derived'].includes(classification);
          const data=item.children.filter(n=>n.type==='data');if(!data.length)throw new ToolError('REMUX_NATIVE_META_VALUES','Metadata item lacks a typed data value.');
          for(const n of data){if(n.end-n.body<8)throw new ToolError('REMUX_NATIVE_META_VALUES','Truncated typed metadata value.');
            const header=await meta.read(n.body,8);if(header[0]!==0)throw new ToolError('REMUX_NATIVE_META_VALUES','Unsupported metadata data version.');
            const hash=createHash('sha256'),parts=[],textType=header.readUInt32BE(0)===1?'utf-8':header.readUInt32BE(0)===2?'utf-16be':null;
            for(let at=n.body+8;at<n.end;){const b=await meta.read(at,Math.min(65536,n.end-at));if(required){hash.update(b);if(textType&&n.end-n.body-8<=16384)parts.push(b);}at+=b.length;}
            if(required){const canonicalName=classification==='unassessed'?name:name.toLowerCase();let decoded;
              if(textType&&n.end-n.body-8<=16384){try{decoded=new TextDecoder(textType,{fatal:true}).decode(Buffer.concat(parts));}catch{throw new ToolError('REMUX_NATIVE_META_VALUES','Invalid typed metadata text.');}}
              const tags=index===null?probe.format?.tags:tracks.find(t=>t.index===index)?.stream.tags;
              const key=Object.keys(tags||{}).find(k=>classification==='unassessed'?k===name:k.toLowerCase()===name.toLowerCase());
              if(decoded===undefined||header.readUInt32BE(4)!==0||key===undefined||String(tags[key])!==decoded)metadataBridgeComplete=false;
              values.push(JSON.stringify([canonicalName,decoded===undefined?header.toString('hex'):'text:'+header.subarray(4).toString('hex'),decoded===undefined?hash.digest('hex'):createHash('sha256').update(decoded).digest('hex')]));
            }
          }
        }
        values.sort();if(values.length)for(const r of typeRows.filter(r=>r.check==='native-metadata'))records.find(p=>p.id===r.id).values.push({index,value:JSON.stringify(values)});
      }
      for(const n of meta.nodes.filter(n=>n.type==='data'))if(!ancestor(n,'ilst'))throw new ToolError('REMUX_NATIVE_META_VALUES','Unscoped metadata data box has no verified interpretation.');
      if(target==='matroska'&&!metadataBridgeComplete)throw new ToolError('REMUX_NATIVE_META_TARGET','Native typed/localized metadata cannot be represented by the carried Matroska string tags.');
      const result={version:1,family,fields:records,groups:partition,metadataBridgeComplete,randomAccess:{streams:meta.seeking.streams},encountered:[...meta.seenTypes],metadataBytesRead:meta.bytesRead()};
      if(retainIsoPayloadExtents){
        const extents=new Map();
        for(const {track,packets} of meta.seeking.states.values()){
          if(track.selected)extents.set(track.index,packets.map(({start,end,key})=>({start,end,key})));
        }
        const ordered=[...extents.values()].flat().sort((a,b)=>a.start-b.start);
        if(!ordered.length||ordered.some((row,i)=>i>0&&row.start<ordered[i-1].end))
          throw new ToolError('REMUX_NATIVE_SAMPLE_EXTENT','Native output sample payloads overlap or are missing.');
        isoPayloadExtents.set(result,extents);
      }
      return result;
    }
    const subtitleBlocks=kind==='subrip'?await readWindowsSubtitleBlocks({meta,tracks,integer,text}):null;
    const randomAccess=await require('./remux-native-cues.cjs').matroskaSeeking({meta,tracks,integer,subtitleIndex:subtitleBlocks?1:null}),{packets,...headerWalk}=meta.ebmlWalk;
    return{version:1,family,fields:records,randomAccess,encountered:[...meta.seenTypes],metadataBytesRead:meta.bytesRead(),headerWalk,...(chapterDisplays?{chapterDisplays}:{}),...(subtitleBlocks?{subtitleBlocks}:{})};
  }});
}
function compareNativeInventories(source,output,mappings){
  if((source.chapterDisplays||output.chapterDisplays)&&JSON.stringify(source.chapterDisplays)!==JSON.stringify(output.chapterDisplays))
    throw new ToolError('REMUX_NATIVE_CHAPTER_COPY','The exact native chapter IDs, clocks, titles or language changed.');
  if(source.subtitleBlocks||output.subtitleBlocks){
    const view=rows=>rows?.map(({ordinal,pts,duration,size,sha256})=>[ordinal,pts,duration,size,sha256]);
    if(JSON.stringify(view(source.subtitleBlocks))!==JSON.stringify(view(output.subtitleBlocks)))
      throw new ToolError('REMUX_NATIVE_SUBRIP_COPY','The exact native subtitle payload, order or intervals changed.');
  }
  for(const m of mappings){const a=source.randomAccess?.streams.find(s=>s.index===m.inputIndex),b=output.randomAccess?.streams.find(s=>s.index===m.outputIndex);
    if(a&&a.indexed.some(ordinal=>!b?.indexed.includes(ordinal)))throw new ToolError('REMUX_NATIVE_SEEK_COVERAGE','Output index omits a source-indexed packet of its mapped track.');}
  if(source.family==='isobmff'&&output.family==='isobmff')for(const m of mappings){const a=source.groups.find(g=>g.index===m.inputIndex),b=output.groups.find(g=>g.index===m.outputIndex);
    const members=a.members.map(i=>mappings.find(m=>m.inputIndex===i)?.outputIndex).sort((x,y)=>x-y);if(JSON.stringify(members)!==JSON.stringify(b.members))fail(INVENTORY.find(r=>r.check==='groups'),'output alternate-group membership changed.');}
  for(const r of INVENTORY.filter(r=>r.treatment==='compare'&&r.check!=='groups'))for(const m of [{inputIndex:null,outputIndex:null},...mappings]){
    if(r.check==='native-metadata'&&source.family!==output.family){const iso=source.family==='isobmff'?source:output;
      if(!iso.metadataBridgeComplete)fail(r,'cross-container native metadata has no exact carried string representation.');continue;}
    const values=(s,index)=>s.fields.find(f=>f.id===r.id)?.values?.filter(v=>v.index===index).map(v=>v.value).filter(v=>v!==null)||[];
    const a=values(source,m.inputIndex).map(v=>r.check==='references'?structuredClone(v):v),b=values(output,m.outputIndex);
    if(r.check==='references')for(const v of a)for(const ref of v)ref.members=ref.members.map(i=>mappings.find(m=>m.inputIndex===i)?.outputIndex??-1);
    // Source/output probe and exact metadata checks already bind dispositions,
    // handler kinds, effective language and display ratio across representations.
    if(['handler','iso-language','iso-media-language','language','display','chroma-siting'].includes(r.check)||r.check.startsWith('disposition-'))continue;
    if(r.check==='mkv-codec-delay'&&source.family!==output.family)continue;
    if(r.check==='mkv-padding'&&source.family!==output.family)continue;
    const neutral=r.check==='mkv-value'?String(r.nativeDefault??0):null;
    if(neutral!==null){while(a.length===0)a.push(neutral);while(b.length===0)b.push(neutral);}
    if(JSON.stringify(a)!==JSON.stringify(b))fail(r,'output native presentation value differs from the source.');
  }
  return{version:1,complete:true,inventorySha256:createHash('sha256').update(JSON.stringify(INVENTORY)).digest('hex'),source,output};
}
const getIsoPayloadExtents=observation=>isoPayloadExtents.get(observation);
module.exports={observeNativeInventory,compareNativeInventories,getIsoPayloadExtents,language,groupPartition};
