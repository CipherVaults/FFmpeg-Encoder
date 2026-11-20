'use strict';
// Bounded qualification observation only. No copying, saving, encoder/catalog
// authority or product import. A summary comparison cannot issue a selection.
const fs=require('node:fs/promises'), sync=require('node:fs'), path=require('node:path');
const { createHash }=require('node:crypto'), {isDeepStrictEqual,types}=require('node:util');
const {readSourceIdentity,sameIdentity}=require('../../src/source-identity.cjs');
const {readNativeMetadata,ancestor}=require('../../src/remux-native-reader.cjs');
const {observeNativeInventory,compareNativeInventories}=require('../../src/remux-native-checks.cjs');
const {observeRemuxSourcePlayback}=require('../../src/remux-edit-lists.cjs');
const {manifest,loaderGuard}=require('../product-linux-shell.cjs');
const {openCandidateCalibrationRuntime}=require('../candidate-calibration-runtime.cjs');
const {runTool,ToolError}=require('../../src/process-runner.cjs');
const H=/^[0-9a-f]{64}$/,U=1024*1024,FIELDS=['dev','ino','size','mtimeNs','ctimeNs','birthtimeNs'];
const need=(v,m)=>{if(!v)throw new ToolError('Q2L_MULTI_AUDIO',m);};
const hash=b=>createHash('sha256').update(b).digest('hex');
const digest=v=>hash(JSON.stringify(v));
const local=s=>need(typeof s==='string'&&s===path.resolve(s)&&!(/[\x00-\x1f\x7f]/).test(s),'Canonical absolute local path required.');
const checkSignal=s=>{if(s?.aborted)throw new ToolError('CANCELLED','Multi-audio observation cancelled.');};
const keys=['index','trackId','kind','rate','channels','layout','language','isDefault','packets','units','packetSha256','decodedSha256','decodeBytes','configSha256','nativeEditSha256','streamInfoSha256','rawChannelHeader'];
const data=(o,k)=>{const d=Object.getOwnPropertyDescriptor(o,k);need(d&&d.enumerable&&Object.hasOwn(d,'value'),'Inert own fields required.');return d.value;};
// FFmpeg 9.0.2's MOV demuxer exposes one 1024-sample AAC priming packet and,
// for a short final coded frame, an independent exact terminal discard. Do not
// conflate nominal frame duration, demuxed duration and actual audible samples.
function checkAacTiming(j,count,pts,dts,duration,extent,side) {
  need([j,count,pts,dts,duration,extent].every(Number.isSafeInteger)&&count>=2&&count<=256&&j>=0&&j<count&&
    extent>0&&extent<=3*48000&&pts===dts&&pts===(j-1)*1024&&duration>0&&duration<=1024&&
    duration===(j===count-1?extent-pts:1024),'Unmeasured AAC gaps or timeline.');
  const lead=j===0?1024:0, discard=j===count-1?1024-duration:0;
  const expected=lead||discard?[{side_data_type:'Skip Samples',skip_samples:lead,discard_padding:discard,skip_reason:0,discard_reason:0}]:[];
  need(!types.isProxy(side)&&Array.isArray(side)&&side.length===expected.length&&Reflect.ownKeys(side).length===side.length+1,'AAC priming or terminal discard shape is incomplete.');
  if(expected.length){
    const observed=data(side,0),keys=Object.keys(expected[0]);
    need(observed&&!types.isProxy(observed)&&Object.getPrototypeOf(observed)===Object.prototype&&Reflect.ownKeys(observed).length===keys.length&&
      keys.every(k=>data(observed,k)===expected[0][k]),'AAC priming or terminal discard disagrees with the measured sample grid.');
  }
}
// Movie timescales can legitimately differ while *all* native edit locations
// and durations represent precisely the same rational time. Media-track and
// movie ticks are different units; media_time stays in the actual media grid.
function movieTicks(ticks,scale) {
  need(typeof ticks==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(ticks)&&typeof scale==='string'&&/^[1-9][0-9]{0,9}$/.test(scale),'Invalid movie clock.');
  const n=BigInt(ticks),d=BigInt(scale);let a=n,b=d;while(b)[a,b]=[b,a%b];return String(n/a)+'/'+String(d/a);
}
function nativeEdits(t) {
  return {trackId:t.trackId,outputIndex:t.outputIndex,controls:t.controls,dimensions:t.dimensions,mediaScale:t.mediaScale,mediaDuration:t.mediaDuration,
    trackDuration:movieTicks(t.trackDuration,t.movieScale),entries:t.entries.map(e=>({duration:movieTicks(e.duration,t.movieScale),mediaTime:e.mediaTime,rateInteger:e.rateInteger,rateFraction:e.rateFraction}))};
}
function compareTracks(a,b) {
  for(const x of [a,b]) {
    need(!types.isProxy(x)&&Array.isArray(x)&&x.length===3&&Reflect.ownKeys(x).length===4,'One video and two audio tracks required.');
    const ids=new Set();let selected=0;
    for(let i=0;i<3;i++) {
      const t=data(x,i);need(t&&!types.isProxy(t)&&Object.getPrototypeOf(t)===Object.prototype&&Reflect.ownKeys(t).length===keys.length,'Unknown track summary.');
      for(const k of keys)data(t,k);
      need(t.index===i&&Number.isInteger(t.trackId)&&t.trackId>0&&t.trackId<=0xffffffff&&!ids.has(t.trackId),'Unknown or repeated track identity.');ids.add(t.trackId);
      need(typeof t.isDefault==='boolean'&&Number.isSafeInteger(t.packets)&&t.packets>0&&t.packets<=256&&
        Number.isSafeInteger(t.units)&&t.units>0&&Number.isSafeInteger(t.decodeBytes)&&t.decodeBytes>0&&t.decodeBytes<=6*U&&
        ['packetSha256','decodedSha256','configSha256','nativeEditSha256','streamInfoSha256'].every(k=>typeof t[k]==='string'&&H.test(t[k])),'Missing bounded track evidence.');
      if(i===0)need(t.kind==='video'&&t.isDefault&&t.rate===null&&t.channels===null&&t.layout===null&&t.rawChannelHeader===null&&t.language==='und'&&t.units===t.packets,'Unmeasured video track.');
      else{
        need(t.kind==='audio'&&[44100,48000].includes(t.rate)&&[1,2].includes(t.channels)&&t.layout===(t.channels===1?'mono':'stereo')&&
          t.rawChannelHeader===t.channels&&t.decodeBytes===t.units*t.channels*4&&t.units<=3*t.rate,'Unmeasured audio track.');
        need(['eng','ara','deu','und'].includes(t.language),'Unmeasured audio language.');
        selected+=Number(t.isDefault);
      }
    }
    need(selected===1,'Exactly one audio default required.');
  }
  for(let i=0;i<3;i++)for(const k of keys)need(a[i][k]===b[i][k],'Track '+i+' differs in '+k+'.');
  return true;
}
function statMatches(s,id){return s.isFile()&&!s.isSymbolicLink()&&s.nlink===1n&&FIELDS.every(k=>String(s[k])===id[k]);}
function settleName(file,id) {
  let ok;try{ok=id.canonicalPath===file&&statMatches(sync.lstatSync(file,{bigint:true}),id)&&sync.realpathSync.native(file)===file&&statMatches(sync.lstatSync(file,{bigint:true}),id);}catch{ok=false;}
  need(ok,'A named file changed before settlement.');
}
async function snapshot(file,signal) {
  const id=await readSourceIdentity(file,{signal});checkSignal(signal);
  need(id.canonicalPath===file&&Number(id.size)>=32&&Number(id.size)<=16*U,'Only small canonical regular-file lab cases.');
  const fd=await fs.open(file,sync.constants.O_RDONLY|sync.constants.O_NOFOLLOW|sync.constants.O_NONBLOCK);
  try {
    need(statMatches(await fd.stat({bigint:true}),id),'File changed before byte observation.');
    const bytes=Buffer.alloc(Number(id.size));let n=0;while(n<bytes.length){checkSignal(signal);const r=await fd.read(bytes,n,Math.min(128*1024,bytes.length-n),n);need(r.bytesRead>0,'Incomplete file.');n+=r.bytesRead;}
    need(bytes.toString('ascii',4,8)==='ftyp'&&bytes.toString('ascii',8,12)==='isom'&&statMatches(await fd.stat({bigint:true}),id),'Not the observed bounded MP4 family.');
    settleName(file,id);return {file,id,bytes};
  } finally{await fd.close();}
}
async function auditPaths(runtimeRoot,source,output,signal) {
  for(const f of [runtimeRoot,source,output])local(f);need(source!==output,'Distinct files required.');
  need(signal===undefined||signal instanceof AbortSignal,'Native cancellation required.');checkSignal(signal);loaderGuard();
  const rt=await openCandidateCalibrationRuntime(manifest(runtimeRoot),{execute:(...args)=>{loaderGuard();return runTool(...args);}});
  let files,result;
  try {
    files=[];for(const f of [source,output])files.push(await snapshot(f,signal));
    need(!(files[0].id.dev===files[1].id.dev&&files[0].id.ino===files[1].id.ino),'Distinct filesystem objects required.');
    const run=rt.createRunner(),cap={signal,timeoutMs:12000,stdoutLimit:4*U,stderrLimit:8192};
    const views=[];
    for(const file of files){
      const args=['-v','error','-f','mov','-protocol_whitelist','file','-show_programs','-show_stream_groups','-show_chapters','-show_format','-show_streams','-show_packets','-show_data_hash','sha256','-of','json',file.file];
      const result=await run(rt.pins.ffprobe.path,args,cap);need(result.exitCode===0&&result.stderrCapture?.totalBytes===0,'Probe not clean.');
      const p=JSON.parse(result.stdout);need(p.format?.filename===file.file&&p.format.format_name==='mov,mp4,m4a,3gp,3g2,mj2'&&p.format.tags?.major_brand==='isom'&&
        Number(p.format.size)===file.bytes.length&&p.format.start_time==='0.000000'&&Number(p.format.duration)>0&&Number(p.format.duration)<=3&&
        ['programs','stream_groups','chapters'].every(k=>Array.isArray(p[k])&&p[k].length===0)&&p.streams?.length===3&&p.format.nb_streams===3&&
        Array.isArray(p.packets)&&p.packets.length>0&&p.packets.length<=768,'Unmeasured inventory, extent, or track count.');
      const opt={file:file.file,identity:file.id,family:'isobmff',target:'mp4',probe:p,maxRecords:2048,timeoutMs:12000,signal};
      const inv=await observeNativeInventory(opt),pb=await observeRemuxSourcePlayback(opt);
      const phys=await readNativeMetadata({...opt,withMetadata:async m=>{
        const tracks=m.nodes.filter(x=>x.type==='trak'&&x.parent?.type==='moov'),mdat=m.nodes.filter(x=>x.type==='mdat'&&!x.parent);
        need(tracks.length===3&&mdat.length===1&&!m.seenTypes.has('moof'),'Only the measured unfragmented MP4 structure.');
        const headers=[null];for(const tr of tracks.slice(1)){
          const sound=m.nodes.filter(x=>x.type==='mp4a'&&ancestor(x,'trak')===tr);need(sound.length===1&&sound[0].end-sound[0].body>=28,'One bounded audio sample entry required.');
          const b=await m.read(sound[0].body,28);need(b.readUInt16BE(8)===0,'Unknown audio sample-entry version.');
          headers.push({channels:b.readUInt16BE(16),sampleRate:b.readUInt32BE(24)/65536});
        }return{mdat:[mdat[0].body,mdat[0].end],headers};
      }});
      const pos=[],summaries=[];
      need(p.packets.every(q=>[0,1,2].includes(q.stream_index)),'Packet belongs to an unmeasured track.');
      for(let i=0;i<3;i++){
        const s=p.streams[i],play=pb.tracks[i],audio=i!==0;
        need(s.index===i&&s.id==='0x'+play.trackId.toString(16)&&play.outputIndex===i&&(play.controls.flags&1)===s.disposition.default&&
          Object.entries(s.disposition).every(([k,v])=>k==='default'?[0,1].includes(v):v===0)&&!s.side_data_list?.length&&
          /^SHA256:[a-f0-9]{64}$/.test(s.extradata_hash)&&s.start_pts===0&&s.time_base==='1/'+play.mediaScale&&
          Number.isSafeInteger(s.duration_ts)&&s.duration_ts>0,'Native track binding, default, config or clock disagreed.');
        if(audio)need(s.codec_type==='audio'&&s.codec_name==='aac'&&s.profile==='LC'&&s.codec_tag_string==='mp4a'&&s.sample_fmt==='fltp'&&
          ['44100','48000'].includes(s.sample_rate)&&s.sample_rate===play.mediaScale&&phys.headers[i].sampleRate===Number(s.sample_rate)&&
          [1,2].includes(s.channels)&&phys.headers[i].channels===s.channels&&s.channel_layout===(s.channels===1?'mono':'stereo')&&s.initial_padding===1024&&
          isDeepStrictEqual(inv.groups[i].members,[1,2])&&s.tags?.handler_name==='SoundHandler','Unmeasured AAC source or native alternate-group binding.');
        else need(s.codec_type==='video'&&s.codec_name==='h264'&&s.codec_tag_string==='avc1'&&[160,176,192].includes(s.width)&&s.height===96&&
          s.pix_fmt==='yuv420p'&&s.color_range==='tv'&&[s.color_space,s.color_primaries,s.color_transfer].every(v=>v==='bt709')&&
          s.time_base==='1/30000'&&s.r_frame_rate==='30/1'&&s.avg_frame_rate==='30/1','Unmeasured H.264 reference track.');
        const packets=p.packets.filter(q=>q.stream_index===i),rows=[],display=new Set();need(packets.length===Number(s.nb_read_packets)&&packets.length===Number(s.nb_frames)&&packets.length>0&&packets.length<=256,'Incomplete track.');
        for(let j=0;j<packets.length;j++){
          const q=packets[j],offset=Number(q.pos),size=Number(q.size);
          need(q.codec_type===s.codec_type&&Number.isSafeInteger(offset)&&Number.isSafeInteger(size)&&size>0&&offset>=phys.mdat[0]&&offset+size<=phys.mdat[1]&&
            'SHA256:'+hash(file.bytes.subarray(offset,offset+size))===q.data_hash&&
            [q.pts,q.dts,q.duration].every(Number.isSafeInteger)&&q.duration>0,'Missing physical packet or exact clock.');
          const skip=q.side_data_list||[];
          if(audio)checkAacTiming(j,packets.length,q.pts,q.dts,q.duration,s.duration_ts,skip);
          else{
            need(skip.length===0&&q.duration===1000&&q.dts===(j-2)*1000&&q.pts>=0&&q.pts<packets.length*1000&&q.pts%1000===0&&!display.has(q.pts),'Unmeasured reference video PTS/decode order.');
            display.add(q.pts);
          }
          rows.push([q.pts,q.dts,q.duration,q.flags,size,q.data_hash,skip]);pos.push([offset,size]);
        }
        const outHash=createHash('sha256');let count=0;
        const raw=await run(rt.pins.ffmpeg.path,['-nostdin','-v','error','-xerror','-err_detect','explode','-protocol_whitelist','file,pipe',
          '-threads','1','-f','mov','-i',file.file,'-map','0:'+i,'-threads','1',...(audio?['-c:a','pcm_s32le','-f','s32le']:['-fps_mode','passthrough','-pix_fmt','yuv420p','-f','rawvideo']),'pipe:1'],
          {...cap,stdoutLimit:6*U,onStdoutChunk:chunk=>{outHash.update(chunk);count+=chunk.length;}});
        need(raw.exitCode===0&&raw.stderrCapture?.totalBytes===0&&raw.stdoutCapture?.streamed===true&&!raw.stdoutCapture.truncated&&raw.stdoutCapture.totalBytes===count&&count>0,'Full strict native decode incomplete.');
        const units=audio?count/(4*s.channels):count/(s.width*s.height*3/2);
        need(Number.isSafeInteger(units)&&units===(audio?s.duration_ts:packets.length),'Actual decoded extent differs from selected track clock.');
        summaries.push({index:i,trackId:play.trackId,kind:s.codec_type,rate:audio?Number(s.sample_rate):null,channels:audio?s.channels:null,layout:audio?s.channel_layout:null,
          language:s.tags?.language,isDefault:s.disposition.default===1,packets:packets.length,units,packetSha256:digest(rows),decodedSha256:outHash.digest('hex'),decodeBytes:count,
          configSha256:s.extradata_hash.slice(7),nativeEditSha256:digest(nativeEdits(play)),streamInfoSha256:digest(s),rawChannelHeader:audio?phys.headers[i].channels:null});
      }
      pos.sort((a,b)=>a[0]-b[0]);let at=phys.mdat[0];for(const [p,n]of pos){need(at===p,'Unaccounted or overlapping media payload.');at+=n;}need(at===phys.mdat[1],'Unaccounted media tail.');
      views.push({summaries,inv,movieScale:pb.tracks[0].movieScale,format:{duration:p.format.duration,tags:p.format.tags},sha256:hash(file.bytes)});
    }
    compareTracks(views[0].summaries,views[1].summaries);need(isDeepStrictEqual(views[0].format,views[1].format),'Container timing/tags changed.');
    compareNativeInventories(views[0].inv,views[1].inv,[0,1,2].map(index=>({inputIndex:index,outputIndex:index})));
    for(const f of files)need(sameIdentity(f.id,await readSourceIdentity(f.file,{signal})),'File changed during audit.');
    await rt.requireCurrent(signal);result={scope:'standalone short synthetic MP4 pair; no route, writer or publication authority',runtimeIdentity:rt.runtimeIdentity,
      sourceSha256:views[0].sha256,outputSha256:views[1].sha256,sourceMovieScale:views[0].movieScale,outputMovieScale:views[1].movieScale,tracks:views[0].summaries};
  } finally {await rt.close();}
  checkSignal(signal);for(const f of files)settleName(f.file,f.id);return result;
}
module.exports={auditPaths,compareTracks,checkAacTiming,movieTicks};
