'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs/promises');
const {packetSync}=require('../src/remux-native-sync.cjs'),{realWitness}=require('./helpers/remux-real-witness.cjs'),{runTool}=require('../src/process-runner.cjs');
const {ffmpeg}=require('../src/candidate-runtime.cjs').resolveCandidateRuntime({root:path.resolve(__dirname,'..')});
const {observeNativeInventory}=require('../src/remux-native-checks.cjs'),{isoRewrite}=require('./helpers/remux-packet-witnesses.cjs');
const code='REMUX_NATIVE_TEST_SYNC';
const classify=(codec,bytes,config)=>packetSync({codec,config,code,start:0,end:bytes.length,read:async(at,n)=>{assert.ok(at>=0&&at+n<=bytes.length&&n<=65536);return bytes.subarray(at,at+n);}});
test('bounded own-packet AVC/HEVC length/header classifiers prove keys and reject each malformed adjacent form',async()=>{
  for(const codec of ['h264','hevc'])for(const width of [1,2,4]){const config=Buffer.alloc(codec==='h264'?5:22);config[codec==='h264'?4:21]=width-1;
    const unit=type=>{const h=codec==='h264'?Buffer.from([type]):Buffer.from([type<<1,1]),len=Buffer.alloc(width);len.writeUIntBE(h.length,0,width);return Buffer.concat([len,h]);},key=unit(codec==='h264'?0x65:19),dependent=unit(codec==='h264'?0x41:1);
    assert.equal(await classify(codec,key,config),true);assert.equal(await classify(codec,dependent,config),false);
    for(const bad of [key.subarray(0,-1),Buffer.concat([key,dependent]),Buffer.concat([key,Buffer.from([0])]),Buffer.concat(Array(1025).fill(key))])await assert.rejects(classify(codec,bad,config),{code});
    const forbidden=Buffer.from(key);forbidden[width]|=128;await assert.rejects(classify(codec,forbidden,config),{code});
    if(codec==='hevc'){const bad=Buffer.from(key);bad[width+1]=0;await assert.rejects(classify(codec,bad,config),{code});}
    const badConfig=Buffer.from(config);badConfig[codec==='h264'?4:21]=2;await assert.rejects(classify(codec,key,badConfig),{code});
    await assert.rejects(classify(codec,key,null),{code});
  }
});
test('VP9 show-existing/profile/key subfields and AV1 sequence/frame/OBU bounds have independent neighbours',async()=>{
  assert.equal(await classify('vp9',Buffer.from([0x82])),true);assert.equal(await classify('vp9',Buffer.from([0x86])),false);assert.equal(await classify('vp9',Buffer.from([0x88])),false);assert.equal(await classify('vp9',Buffer.from([0xb0])),true);
  for(const b of [0,0xb8])await assert.rejects(classify('vp9',Buffer.from([b])),{code});
  const config=Buffer.from([0x81,0,0,0,0x0a,1,0]),key=Buffer.from([0x32,1,0]);assert.equal(await classify('av1',key,config),true);assert.equal(await classify('av1',Buffer.from([0x32,1,0x20]),config),false);assert.equal(await classify('av1',Buffer.from([0x32,1,0x80]),config),false);
  for(const b of [Buffer.from([0xb2,1,0]),Buffer.from([0x32,2,0]),Buffer.from([0x32,128]),Buffer.from([0x36]),Buffer.from([0x32,0])])await assert.rejects(classify('av1',b,config),{code});
  await assert.rejects(classify('av1',key,Buffer.alloc(4)),{code});await assert.rejects(classify('unknown',key,null),{code});
});
for(const [codec,encoder,family,args]of [['hevc','libx265','isobmff',['-x265-params','pools=1:frame-threads=1:log-level=error']],['av1','libaom-av1','isobmff',['-cpu-used','8']],['vp9','libvpx-vp9','matroska',['-deadline','realtime','-cpu-used','8']]])test('ordinary '+codec+' own access points survive actual native admission',async t=>{
  const f=await realWitness(t,'isobmff',{audio:false}),file=path.join(path.dirname(f.sourcePath),'coded.'+(family==='matroska'?'mkv':'mp4'));
  await runTool(ffmpeg,['-v','error','-nostdin','-n','-i',f.sourcePath,'-an','-c:v',encoder,'-threads','1','-g','10',...args,file]);const probe=await f.probe(file),inspect=()=>observeNativeInventory({file,probe,family,target:family==='matroska'?'matroska':'mp4'}),native=await inspect();assert.ok(native.randomAccess.streams[0].indexed.length>0);
  if(codec==='hevc'){const original=await fs.readFile(file);await fs.writeFile(file,isoRewrite(original,'sdtp',b=>{const at=b.indexOf(0x18,4);assert.ok(at>=4);b[at]=0x14;return b;}));await assert.rejects(inspect(),{code:'REMUX_NATIVE_SDTP'});}
});

// Grow a syntactically complete hvcC with a user_data_unregistered prefix SEI.
// Its payload does not change the coded picture. This proves the byte budget
// with a real decoder/probe, rather than padding an invalid codec header or
// injecting an extradata hash that the pinned reader would never produce.
function configurationBytes(config,bytes){
  assert.equal(config[0],1);const arrays=[];let at=23;
  for(let i=0;i<config[22];i++){const flags=config[at++],count=config.readUInt16BE(at);at+=2;const units=[];for(let j=0;j<count;j++){const n=config.readUInt16BE(at);at+=2;units.push(config.subarray(at,at+n));at+=n;}arrays.push({flags,units});}assert.equal(at,config.length);
  let sei=arrays.find(a=>(a.flags&63)===39);const overhead=sei?4:7,nalBytes=n=>2+1+Math.floor(n/255)+1+n+1;let payload,small;
  // A second, short SEI closes the one-byte gaps at payload-size varint steps.
  for(let s=16;s<=17&&payload===undefined;s++)for(let n=16;n<bytes;n++)if(config.length+overhead+nalBytes(s)+nalBytes(n)===bytes){payload=n;small=s;break;}
  assert.ok(payload,'exact boundary must have complete SEI encodings');
  const encode=n=>Buffer.concat([Buffer.from([39<<1,1,5]),Buffer.from([...Array(Math.floor(n/255)).fill(255),n%255]),Buffer.alloc(n,0x55),Buffer.from([0x80])]);
  if(!sei){sei={flags:39,units:[]};arrays.push(sei);}for(const n of [small,payload]){const nal=encode(n);assert.ok(nal.length<=65535);sei.units.push(nal);}
  const head=Buffer.from(config.subarray(0,23));head[22]=arrays.length;
  const result=Buffer.concat([head,...arrays.map(a=>{const h=Buffer.alloc(3);h[0]=a.flags;h.writeUInt16BE(a.units.length,1);return Buffer.concat([h,...a.units.map(u=>{const n=Buffer.alloc(2);n.writeUInt16BE(u.length);return Buffer.concat([n,u]);})]);})]);assert.equal(result.length,bytes);return result;
}
async function decodedHash(file){const r=await runTool(ffmpeg,['-v','error','-nostdin','-i',file,'-map','0:v:0','-frames:v','1','-an','-c:v','rawvideo','-pix_fmt','yuv420p','-f','framehash','-']),rows=r.stdout.split(/\r?\n/).filter(s=>s&&!s.startsWith('#'));assert.equal(rows.length,1);return rows[0].split(',').at(-1).trim();}
test('complete codec configurations at 65536 bytes pass and 65537 refuse in ISO and Matroska',async t=>{
  const {ebmlRewrite}=require('./helpers/remux-packet-witnesses.cjs'),{relocateMatroska}=require('./helpers/remux-matroska-relocate.cjs'),{createHash}=require('node:crypto');
  const f=await realWitness(t,'isobmff',{audio:false}),dir=path.dirname(f.sourcePath),coded=path.join(dir,'budget.mp4');
  await runTool(ffmpeg,['-v','error','-nostdin','-n','-i',f.sourcePath,'-an','-c:v','libx265','-threads','1','-x265-params','pools=1:frame-threads=1:log-level=error',coded]);
  for(const family of ['isobmff','matroska']){
    const file=family==='isobmff'?coded:path.join(dir,'budget.mkv');if(family==='matroska')await runTool(ffmpeg,['-v','error','-nostdin','-n','-i',coded,'-map','0:v:0','-c','copy',file]);
    const original=await fs.readFile(file),hash=await decodedHash(file);let config;
    if(family==='isobmff')isoRewrite(original,'hvcC',b=>{config=b;return b;});else ebmlRewrite(original,0x63a2,b=>{config=b;return b;});assert.ok(config);
    for(const bytes of [65536,65537]){
      const grown=configurationBytes(config,bytes),changed=family==='isobmff'?isoRewrite(original,'hvcC',()=>grown):relocateMatroska(original,ebmlRewrite(original,0x63a2,()=>grown));await fs.writeFile(file,changed);
      const probe=await f.probe(file);assert.equal(probe.streams[0].extradata_hash,'SHA256:'+createHash('sha256').update(grown).digest('hex'));assert.equal(await decodedHash(file),hash,'the boundary fixture remains decodable with the same picture');
      const inspect=()=>observeNativeInventory({file,probe,family,target:family==='matroska'?'matroska':'mp4'});
      if(bytes===65536)await inspect();else await assert.rejects(inspect(),{code:family==='isobmff'?'REMUX_NATIVE_HVCC':'REMUX_NATIVE_CODECPRIVATE'});
    }
    await fs.writeFile(file,original);
  }
});
