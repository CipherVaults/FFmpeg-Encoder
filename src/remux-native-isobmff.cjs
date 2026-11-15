'use strict';
const {ToolError}=require('./process-runner.cjs'),{createHash}=require('node:crypto');
const fail=(r,s)=>{throw new ToolError(r.code,'isobmff '+r.field+': '+s);};
const sampleCodecs={avc1:'h264',avc3:'h264',hvc1:'hevc',hev1:'hevc',av01:'av1',vp09:'vp9',mp4v:'mpeg4',mp4a:'aac',tx3g:'mov_text'};
async function isoValue({r,n,stream,meta,probe,target,integer,text}){
  const need=(ok,s)=>{if(!ok)fail(r,s);},size=n.end-n.body;
  if(r.check==='iso-ftyp'){
    // Brands are declarations, not sample interpretation. Actual sample-entry,
    // codec, colour and metadata framing are checked independently, including
    // QuickTime framing; no major/compatible-brand whitelist is necessary.
    need(size>=8&&size%4===0,'invalid file-type field extent.');return null;
  }
  if(r.check==='iso-stsd'){
    need(size>=8&&await integer(n,0,4)===0n&&await integer(n,4,4)===1n&&n.children.length===1,'exactly one version-zero native sample description is required.');return null;
  }
  if(r.check==='iso-dref'){need(size>=8&&await integer(n,0,4)===0n&&await integer(n,4,4)===1n&&n.children.length===1&&n.children[0].type==='url ','data-reference table is not one ordinary self-contained entry.');return null;}
  if(r.check==='iso-self-entry'){need(n.type==='url '&&size===4&&await integer(n,0,4)===1n,'external or aliased data entry is not self-contained.');return null;}
  if(r.check==='iso-zero-box'){need(size===(n.type==='nmhd'?4:0)&&(!size||await integer(n)===0n),'non-default null media header or wave terminator.');return null;}
  if(r.check==='iso-sample-entry'){
    // Entry-specific dimensions and data-reference selection are independent
    // of the codec's own coded headers. Reject a disagreement hidden by probing.
    const codec=sampleCodecs[n.type];
    if(n.type==='mp4a'&&n.parent?.type==='wave'){need(stream?.codec_name==='aac'&&size===4&&await integer(n)===0n,'non-default QuickTime AAC wave marker.');return null;}
    need(n.parent?.type==='stsd'&&codec===stream?.codec_name,'sample entry has no matching admitted codec/track.');
    need(size>=8&&await integer(n,0,6)===0n&&await integer(n,6,2)===1n,'sample entry is not an ordinary self-contained data reference.');
    if(stream.codec_type==='video'){
      need(size>=78&&Number(await integer(n,24,2))===stream.width&&Number(await integer(n,26,2))===stream.height,'native sample-entry dimensions differ from admitted pixels.');
      need(await integer(n,40,2)===1n,'sample entry requires non-default frames per sample.');
    }else if(stream.codec_type==='audio'){
      need(size>=28,'truncated sound sample entry.');const version=Number(await integer(n,8,2)),channels=Number(await integer(n,16,2)),bits=Number(await integer(n,18,2)),cid=Number(await integer(n,20,2)),rate=Number(await integer(n,24,4));
      need(version<=2&&[0,2,stream.channels].includes(channels)&&[0,16].includes(bits)&&[0,65534].includes(cid)&&await integer(n,22,2)===0n,'unproved sound-entry channel/depth/compression/packet hints.');
      if(version<2)need(rate===0||rate===Number(stream.sample_rate)*65536,'sound-entry sample rate differs from the admitted AAC configuration.');
      if(version===1){need(size>=44&&[0n,1024n].includes(await integer(n,28,4))&&await integer(n,32,4)===0n&&await integer(n,36,4)===0n&&[0n,2n].includes(await integer(n,40,4)),'unproved QuickTime v1 packet interpretation.');}
      if(version===2){need(size>=64,'truncated QuickTime v2 sound entry.');const b=await meta.read(n.body+28,36),frequency=b.readDoubleBE(4);
        need(b.readUInt32BE(0)===72&&frequency===Number(stream.sample_rate)&&b.readUInt32BE(12)===stream.channels&&b.readUInt32BE(16)===0x7f000000&&[0,16].includes(b.readUInt32BE(20))&&b.readUInt32BE(24)===0&&b.readUInt32BE(28)===0&&[0,1024].includes(b.readUInt32BE(32)),'unproved QuickTime v2 rate/channel/format/packet interpretation.');}
    }
    // Sound-entry channel/rate hints can be overridden by an AAC ASC. The
    // complete admitted ASC and effective channel/rate comparison remain exact.
    return null;
  }
  if(r.check==='iso-frma'){
    need(size===4&&(await text(n))===(stream?.codec_tag_string||({aac:'mp4a',h264:'avc1'}[stream?.codec_name])),'wave original-format name disagrees with the admitted codec.');return null;
  }
  if(r.check==='iso-chan'){
    need(size>=16&&await integer(n,0,4)===0n,'malformed channel layout FullBox.');const b=await meta.read(n.body,16),tag=b.readUInt32BE(4),bitmap=b.readUInt32BE(8),count=b.readUInt32BE(12);
    const neutral=stream?.codec_name==='aac'&&count===0&&(tag===0&&bitmap===0||tag===65536&&bitmap===(stream.channels===1?4:stream.channels===2?3:-1)||bitmap===0&&tag===(stream.channels===1?6553601:stream.channels===2?6619138:-1));
    if(neutral){need(size===16,'trailing channel coordinates are not neutral.');return null;}
    need(target!=='matroska','channel layout/coordinates have no proved cross-container representation.');
  }
  if(r.check==='iso-chpl'){
    need(size>=9&&size<=65536,'invalid Nero chapter list extent.');const b=await meta.read(n.body,size);need(b[0]===1&&b.readUIntBE(1,3)===0&&b.readUInt32BE(4)===0,'unsupported Nero chapter list version/flags.');let at=9;
    need(b[8]===(probe.chapters?.length||0),'native chapter list is not completely carried.');
    for(let i=0;i<b[8];i++){
      need(at+9<=b.length,'truncated native chapter.');const ns=b.readBigUInt64BE(at)*100n,len=b[at+8];at+=9;need(at+len<=b.length,'truncated native chapter label.');
      const c=probe.chapters[i],tb=/^(\d+)\/(\d+)$/.exec(c.time_base||'');need(tb&&ns*BigInt(tb[2])===BigInt(c.start)*BigInt(tb[1])*1000000000n,'chapter start differs from the carried clock.');
      let title;try{title=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(at,at+len));}catch{fail(r,'invalid native chapter label.');}
      need(title===String(c.tags?.title??''),'chapter label differs from the carried title.');at+=len;
    }need(at===b.length,'trailing unclassified chapter bytes.');return null;
  }
  if(r.check==='iso-config'){
    let start=n.body,end=n.end;
    if(n.type==='esds'){
      need(size>=4&&await integer(n,0,4)===0n,'unsupported elementary-stream descriptor header.');
      need(size<=65536,'elementary-stream descriptor list exceeds its explicit 65536-byte budget; no suffix may be exempted.');
      const b=await meta.read(n.body,size);let asc=null;
      function descriptors(start,end,depth=0){need(depth<=12,'elementary-stream descriptor nesting exceeds its explicit budget.');for(let at=start;at<end;){need(at+2<=end,'truncated elementary-stream descriptor.');const tag=b[at++];let length=0,done=false;
        for(let k=0;k<4;k++){need(at<end,'truncated descriptor length.');const v=b[at++];length=length*128+(v&127);if(!(v&128)){done=true;break;}}
        need(done&&at+length<=end,'invalid elementary-stream descriptor extent.');const stop=at+length;
        if(tag===3){need(length>=3,'truncated ES descriptor.');need(b[at+2]===0,'ES dependency, URL, clock or stream-priority selection has no proved carried mapping.');descriptors(at+3,stop,depth+1);}
        else if(tag===4){need(length>=13,'truncated decoder configuration.');need(stream?.codec_name==='aac'&&b[at]===0x40&&b[at+1]===0x15,'decoder object/stream type is not the admitted ordinary AAC configuration.');descriptors(at+13,stop,depth+1);}
        else if(tag===5){need(!asc,'ambiguous decoder-specific configuration.');asc=b.subarray(at,stop);}
        else if(tag===6)need(length===1&&b[at]===2,'non-default sync-layer interpretation has no proved carried mapping.');
        else need(false,'unclassified elementary-stream descriptor '+tag+'.');
        at=stop;
      }}
      descriptors(4,b.length);need(asc,'missing decoder-specific configuration.');need('SHA256:'+createHash('sha256').update(asc).digest('hex')===stream?.extradata_hash,'native decoder-specific bytes disagree with the admitted codec header.');return null;
    }
    if(n.type==='avcC'||n.type==='hvcC'){
      const h=createHash('sha256');for(let at=start;at<end;){const b=await meta.read(at,Math.min(65536,end-at));h.update(b);at+=b.length;}
      need('SHA256:'+h.digest('hex')===stream?.extradata_hash,'native codec configuration disagrees with the admitted codec header.');return null;
    }
    need(target!=='matroska','this codec configuration has no proved cross-container native representation.');
  }
  const hash=createHash('sha256');for(let at=n.body;at<n.end;){const b=await meta.read(at,Math.min(65536,n.end-at));hash.update(b);at+=b.length;}return hash.digest('hex');
}
module.exports={isoValue};
