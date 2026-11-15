'use strict';
const {createHash}=require('node:crypto');
const {ToolError}=require('./process-runner.cjs');
const CODECS={h264:'V_MPEG4/ISO/AVC',hevc:'V_MPEGH/ISO/HEVC',av1:'V_AV1',vp9:'V_VP9',aac:'A_AAC',opus:'A_OPUS',flac:'A_FLAC',vorbis:'A_VORBIS',subrip:'S_TEXT/UTF8',ass:'S_TEXT/ASS'};
for(const codec of ['pcm_s16le','pcm_s24le','pcm_s32le'])CODECS[codec]='A_PCM/INT/LIT';
for(const codec of ['pcm_s16be','pcm_s24be','pcm_s32be'])CODECS[codec]='A_PCM/INT/BIG';
for(const codec of ['pcm_f32le','pcm_f64le'])CODECS[codec]='A_PCM/FLOAT/IEEE';
const colour={MatrixCoefficients:['color_space',{0:'gbr',1:'bt709',4:'fcc',5:'bt470bg',6:'smpte170m',7:'smpte240m',8:'ycgco',9:'bt2020nc',10:'bt2020c'}],
  TransferCharacteristics:['color_transfer',{1:'bt709',4:'bt470m',5:'bt470bg',6:'smpte170m',7:'smpte240m',8:'linear',13:'iec61966-2-1',14:'bt2020-10',15:'bt2020-12',16:'smpte2084',18:'arib-std-b67'}],
  Primaries:['color_primaries',{1:'bt709',4:'bt470m',5:'bt470bg',6:'smpte170m',7:'smpte240m',8:'film',9:'bt2020',10:'smpte428',11:'smpte431',12:'smpte432'}]};
const fail=(r,s)=>{throw new ToolError(r.code,'matroska '+r.field+': '+s);};
// Exact continued-fraction projection used by the pinned Matroska demuxer:
// https://raw.githubusercontent.com/FFmpeg/FFmpeg/946fcce07b/libavformat/matroskadec.c
// Its av_reduce limit is 30000 for BOTH numerator and denominator. Inverting
// the reported fraction loses nanoseconds for ordinary variable-rate phones.
function matroskaRate(duration){
  if(typeof duration!=='bigint'||duration<=0n||duration>0xffffffffffffffffn)throw new ToolError('REMUX_NATIVE_DEFAULTDURATION','Invalid native duration.');
  const div=duration<=0x7fffffffffffffffn?1n:2n;let n=1000000000n/div,d=duration/div,a=[0n,1n],b=[1n,0n];const max=30000n;
  while(d){let q=n/d;const rest=n%d,c=[q*b[0]+a[0],q*b[1]+a[1]];
    if(c[0]>max||c[1]>max){if(b[0])q=(max-a[0])/b[0];if(b[1]){const bound=(max-a[1])/b[1];if(bound<q)q=bound;}if(d*(2n*q*b[1]+a[1])>n*b[1])b=[q*b[0]+a[0],q*b[1]+a[1]];break;}
    a=b;b=c;n=d;d=rest;
  }return b;
}
// Every value returned here is either independently corroborated against the
// carried probe representation, or is compared natively on both sides. Labels
// used only by references are resolved by native identity, never compared as
// randomly generated output UIDs.
async function matroskaValue({r,n,t,stream,meta,probe,tracks,byType,integer,floating,text,language,selectedIndexes}){
  const number=async()=>Number(await integer(n)),value=r.type==='float'?await floating(n,r):['uinteger','integer'].includes(r.type)?await integer(n,0,n.end-n.body,r.type==='integer'):null;
  const requireValue=(ok,why)=>{if(!ok)fail(r,why);};
  const tags=stream?.tags||{},field=r.field;
  if(field==='EBMLMaxIDLength'||field==='EBMLMaxSizeLength')requireValue(value===BigInt(field==='EBMLMaxIDLength'?4:8),'unsupported EBML width negotiation.');
  else if(['EBMLVersion','EBMLReadVersion'].includes(field))requireValue(value===1n,'unsupported EBML version.');
  else if(['DocTypeVersion','DocTypeReadVersion'].includes(field))requireValue(value>0n&&value<=4n,'unsupported Matroska version.');
  else if(field==='DocType')requireValue(['matroska','webm'].includes(await text(n)),'unknown document type.');
  else if(field==='TrackNumber')requireValue(value>0n&&value<=0x0fffffffn&&String(value)===t?.trackId,'track number does not identify the admitted stream.');
  else if(field==='TrackUID'){
    requireValue(value>0n,'track UID must be positive.');
    const all=byType.get(n.type)||[],uids=await Promise.all(all.map(p=>integer(p)));
    requireValue(new Set(uids.map(String)).size===uids.length,'duplicate track UIDs cannot bind references.');
  }else if(field==='TrackType')requireValue(value===BigInt({video:1,audio:2,subtitle:17}[stream?.codec_type]||0),'native track type disagrees with its admitted stream.');
  else if(field==='CodecID')requireValue(await text(n)===CODECS[stream?.codec_name],'native codec ID disagrees with the admitted decoder.');
  else if(field==='CodecPrivate'){
    const h=createHash('sha256');for(let at=n.body;at<n.end;){const b=await meta.read(at,Math.min(65536,n.end-at));h.update(b);at+=b.length;}
    requireValue(/^SHA256:[a-f0-9]{64}$/i.test(stream?.extradata_hash||'')&&h.digest('hex')===stream.extradata_hash.slice(7).toLowerCase(),'codec private bytes are not bound by the carried codec header.');
  }else if(field==='Name')requireValue(await text(n)===String(tags.title??tags.name??''),'native track name is absent or different in the carried metadata.');
  else if(field==='Language'){
    const native=language(await text(n));
    if(!n.parent.children.some(p=>p.type==='0x22b59d'))requireValue(native===language(tags.language||(native==='und'?'und':'eng')),'native language disagrees with carried language.');
  }else if(field==='TimestampScale'){
    requireValue(value>0n,'timestamp scale must be positive.');
    // The finite video routes bind the container clock through every video
    // stream. Decoded audio can use a sample clock; its exact sample timeline
    // is independently bound, rather than equating it with an EBML tick.
    const clockTracks=tracks.some(t=>t.kind==='video')?tracks.filter(t=>t.kind==='video'):tracks;
    for(const track of clockTracks){const tb=/^(\d+)\/(\d+)$/.exec(track.stream.time_base||'');requireValue(tb&&BigInt(tb[1])*1000000000n===value*BigInt(tb[2]),'native timestamp unit differs from the admitted container/video clocks.');}
  }else if(field==='Duration'){
    const scaleNode=byType.get('0x2ad7b1')?.[0],scale=scaleNode?Number(await integer(scaleNode)):1000000;
    requireValue(Number.isFinite(value)&&value>0&&Math.round(value*scale/1000)===Math.round(Number(probe.format?.duration)*1000000),'native duration differs from the carried microsecond container duration.');
  }else if(field==='DefaultDuration'){
    if(value===0n)return null;
    // Matroska exposes DefaultDuration as avg_frame_rate. r_frame_rate can be
    // the greatest common timestamp grid for VFR and need not be nominal FPS.
    const average=/^([1-9]\d*)\/([1-9]\d*)$/.exec(stream?.avg_frame_rate||''),rate=stream?.codec_name==='aac'?[null,String(stream.sample_rate),'1024']:average||/^(\d+)\/(\d+)$/.exec(stream?.r_frame_rate||'');requireValue(rate&&/^\d+$/.test(rate[1])&&BigInt(rate[1])>0n&&value>0n,'nominal sample duration has no carried rate.');
    if(stream?.codec_name==='aac'){
      const numerator=1000000000n*BigInt(rate[2]),denominator=BigInt(rate[1]);requireValue(value===numerator/denominator||value===(numerator+denominator-1n)/denominator,'native audio duration differs from its coded sample grid.');
    }else{const [num,den]=matroskaRate(value);requireValue(num*BigInt(rate[2])===den*BigInt(rate[1]),'native nominal duration differs from the pinned carried rational projection.');}
  }else if(['PixelWidth','PixelHeight','Channels'].includes(field))requireValue(value===BigInt(stream?.[{PixelWidth:'width',PixelHeight:'height',Channels:'channels'}[field]]||0),'native dimensions/channel count differ from the admitted decoder.');
  else if(['SamplingFrequency','OutputSamplingFrequency'].includes(field)){
    requireValue(Number.isFinite(value)&&value>0&&value===Number(stream?.sample_rate),'native sample frequency differs from the admitted decoder.');
  }else if(field==='FlagInterlaced')requireValue(value===0n||value===BigInt(stream?.field_order==='progressive'?2:1),'native interlace mode disagrees with decoded field order.');
  else if(field==='FieldOrder'){
    const order={0:'progressive',1:'tt',6:'bb',9:'tb',14:'bt'}[String(value)];requireValue(value===2n||order===stream?.field_order,'native field order disagrees with admitted fields.');
  }else if(colour[field]){
    const [key,names]=colour[field];requireValue(value===2n||names[String(value)]&&names[String(value)]===stream?.[key],'native colour does not match the admitted codec colour.');
  }else if(field==='Range')requireValue(value===0n||({1:'tv',2:'pc'})[String(value)]===stream?.color_range,'native range differs from the admitted codec range.');
  else if(['ChromaSubsamplingHorz','ChromaSubsamplingVert','CbSubsamplingHorz','CbSubsamplingVert'].includes(field)){
    const m=/^(?:yuv|yuva)(420|422|444|440|411|410)p/.exec(stream?.pix_fmt||''),sub={420:[1,1],422:[1,0],444:[0,0],440:[0,1],411:[2,0],410:[2,2]}[m?.[1]];
    requireValue(sub&&value===BigInt(sub[field.endsWith('Horz')?0:1]),'native chroma subsampling differs from the admitted pixel format.');
  }else if(field==='BitsPerChannel'){
    const depth=/(?:p|gray)(9|10|12|14|16)(?:le|be)?$/.exec(stream?.pix_fmt||'');requireValue(value===0n||value===BigInt(depth?depth[1]:8),'native colour depth differs from the admitted pixels.');
  }else if(field==='BitDepth'){
    // AAC's coded quantizers and ASC define reconstruction; this PCM hint is
    // not used by that decoder. Other codecs need an explicit bit-depth proof.
    const pcm=/^pcm_[sf](\d+)(?:le|be)$/.exec(stream?.codec_name||'');
    requireValue(pcm?value===BigInt(pcm[1]):stream?.codec_name==='aac'&&value>=0n&&value<=64n,'native PCM depth is not proved for this codec.');
  }else if(['FileName','FileMediaType','FileData','FileUID'].includes(field)){
    const attached=n.parent,filename=attached.children.find(p=>p.type==='0x466e'),mime=attached.children.find(p=>p.type==='0x4660');
    requireValue(filename&&mime,'attachment has no native filename or media type.');
    const name=await text(filename),type=await text(mime),matches=probe.streams.filter(s=>s.codec_type==='attachment'&&s.tags?.filename===name&&s.tags?.mimetype===type);
    requireValue(matches.length===1,'attachment does not identify exactly one carried attachment.');
    const attachment=matches[0];if(!selectedIndexes.includes(attachment.index))return null;
    if(field==='FileUID'){
      const ids=await Promise.all((byType.get(n.type)||[]).map(p=>integer(p)));requireValue(value>0n&&new Set(ids.map(String)).size===ids.length,'attachment UID is nonpositive or ambiguous.');
    }else if(field==='FileData'){
      const h=createHash('sha256');for(let at=n.body;at<n.end;){const b=await meta.read(at,Math.min(65536,n.end-at));h.update(b);at+=b.length;}
      requireValue('SHA256:'+h.digest('hex')===attachment.extradata_hash,'native attachment bytes differ from its carried complete header.');
    }
  }else fail(r,'native value handler is missing.');
  return null;
}
async function matroskaSemantic({r,n,meta,probe,tracks,byType,integer,text,language,ancestor}){
  const one=(node,id)=>node?.children.find(p=>p.type===id),all=id=>byType.get(id)||[];
  const requireValue=(ok,why)=>{if(!ok)fail(r,why);};
  const chapter=node=>{const atom=node.type==='0xb6'?node:ancestor(node,'0xb6');return probe.chapters?.[all('0xb6').filter(a=>!ancestor(a,'0xb6')).indexOf(atom)];};
  if(['EditionUID','ChapterUID'].includes(r.field)){
    const uids=await Promise.all(all(n.type).map(p=>integer(p)));requireValue(uids.every(v=>v>0n)&&new Set(uids.map(String)).size===uids.length,'nonpositive or duplicate chapter/edition identity.');
  }else if(['ChapterTimeStart','ChapterTimeEnd'].includes(r.field)){
    const c=chapter(n),key=r.field==='ChapterTimeStart'?'start':'end',tb=/^(\d+)\/(\d+)$/.exec(c?.time_base||'');
    requireValue(tb&&/^-?\d+$/.test(String(c?.[key]))&&await integer(n)*BigInt(tb[2])===BigInt(c[key])*BigInt(tb[1])*1000000000n,'native chapter time has no identical carried chapter clock.');
  }else if(r.field==='ChapString')requireValue(await text(n)===String(chapter(n)?.tags?.title??''),'native chapter title has no identical carried chapter title.');
  else if(['TagName','TagString','TagLanguage','TagLanguageBCP47','TagDefault','TagDefaultBogus','TargetTypeValue','TagTrackUID','TagChapterUID','TagEditionUID','TagAttachmentUID','TagBlockAddIDValue'].includes(r.field)){
    const tag=n.type==='0x7373'?n:ancestor(n,'0x7373'),targets=one(tag,'0x63c0');let scopes=[{tags:probe.format?.tags||{},kind:'container'}];
    if(targets){
      const references=targets.children.filter(p=>['0x63c5','0x63c4','0x63c9','0x63c6','0x63c7'].includes(p.type));
      requireValue(new Set(references.map(p=>p.type)).size<=1,'mixed native tag target classes have no proved flattened mapping.');
      if(references.length)scopes=[];
      for(const target of references){const type=target.type;
        const id=await integer(target);
        if(type==='0x63c5'){
          const matches=[];for(const t of tracks){const uid=one(t.node,'0x73c5');if(!id||uid&&await integer(uid)===id)matches.push(t);}
          requireValue(matches.length,'tag names a foreign track UID.');for(const t of matches)scopes.push({tags:t.stream.tags||{},kind:'stream'});
        }else if(type==='0x63c4'){
          const matches=[];for(const atom of all('0xb6')){const uid=one(atom,'0x73c4');if(!id||uid&&await integer(uid)===id){const c=chapter(atom);requireValue(c,'tag names an uncarried chapter UID.');matches.push(c);}}
          requireValue(matches.length,'tag names an uncarried chapter UID.');for(const c of matches)scopes.push({tags:c.tags||{},kind:'chapter'});
        }else requireValue(false,'edition, attachment or block selection tags have no carried target mapping.');
      }
      const tv=one(targets,'0x68ca');requireValue(!tv||await integer(tv)===50n,'non-default tag hierarchy is not carried.');
    }
    const simple=n.type==='0x67c8'?n:ancestor(n,'0x67c8');
    if(simple){
      requireValue(!ancestor(simple,'0x67c8'),'hierarchical tag names are not flattened without proof.');
      const lang=one(simple,'0x447b')||one(simple,'0x447a');
      if(lang){const label=await text(lang);requireValue((lang.type!=='0x447b'||label.length>0)&&language(label)==='und','malformed or localized functional tag selection is not carried.');}
      for(const id of ['0x4484','0x44b4']){const flag=one(simple,id);requireValue(!flag||await integer(flag)===1n,'non-default tag selection is not carried.');}
      const names=simple.children.filter(p=>p.type==='0x45a3'),strings=simple.children.filter(p=>p.type==='0x4487');
      requireValue(names.length===1&&strings.length===1,'a simple tag must have one name and one carried string.');
      const name=await text(names[0]),value=await text(strings[0]);
      const {classifyRemuxMetadataTag}=require('./remux-metadata-policy.cjs');
      for(const scope of scopes){const kind=classifyRemuxMetadataTag(name,{scope:scope.kind}).classification,key=Object.keys(scope.tags).find(k=>k.toLowerCase()===name.toLowerCase());
        requireValue(['descriptive','operation-derived'].includes(kind)||key!==undefined&&String(scope.tags[key])===value,'native functional tag is absent or different in a carried target.');}
    }
  }else fail(r,'native semantic handler is missing.');
  return null;
}
module.exports={matroskaValue,matroskaSemantic,matroskaRate};
