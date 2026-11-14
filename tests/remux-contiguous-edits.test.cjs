'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {runTool}=require('../src/process-runner.cjs'),{observeRemuxSourcePlayback}=require('../src/remux-edit-lists.cjs');
const {resolveCandidateRuntime}=require('../src/candidate-runtime.cjs'),{isoEdit}=require('./helpers/native-inventory-collector.cjs');
const {ffmpeg,ffprobe}=resolveCandidateRuntime({root:path.resolve(__dirname,'..')});

test('bounded contiguous unity-edit experiment identifies repeated discard preroll and retains the truthful refusal',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'remux-contiguous-'));
  t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^remux-contiguous-/);await fs.rm(root,{recursive:true});});
  const file=path.join(root,'owned.mp4');
  await runTool(ffmpeg,['-v','error','-nostdin','-n','-f','lavfi','-i','testsrc2=s=64x48:r=30:d=1','-an','-c:v','libx264','-threads','1','-preset','ultrafast','-bf','0','-g','10','-sc_threshold','0','-pix_fmt','yuv420p',file],{timeoutMs:30000});
  const inspect=async extra=>JSON.parse((await runTool(ffprobe,['-v','error',...extra,'-show_streams','-show_packets','-show_data_hash','sha256','-of','json',file],{timeoutMs:30000,stdoutLimit:1024*1024})).stdout);
  const plain=await inspect([]),scale=BigInt(plain.streams[0].time_base.split('/')[1]),original=await fs.readFile(file);
  assert.ok(original.indexOf(Buffer.from('mdat'))<original.indexOf(Buffer.from('moov')));
  const edited=isoEdit(original,'elst',h=>{
    assert.equal(h[0],0);assert.equal(h.readUInt32BE(4),1);assert.equal(h.readUInt32BE(8),1000);
    const out=Buffer.alloc(32);out.writeUInt32BE(2,4);out.writeUInt32BE(500,8);out.writeInt16BE(1,16);
    out.writeUInt32BE(500,20);out.writeInt32BE(Number(scale/2n),24);out.writeInt16BE(1,28);return out;
  });
  await fs.writeFile(file,edited);const projected=await inspect([]),native=await inspect(['-ignore_editlist','1']);
  assert.equal(native.packets.length,plain.packets.length);
  assert.ok(projected.packets.length>native.packets.length,'The demuxer repeats packets at the second edit boundary.');
  assert.ok(projected.packets.some(p=>p.flags.includes('D')),'Repeated preroll is marked discard.');
  const visible=projected.packets.filter(p=>!p.flags.includes('D'));
  assert.deepEqual(visible.map(p=>[p.pts,p.dts,p.duration,p.data_hash]),plain.packets.map(p=>[p.pts,p.dts,p.duration,p.data_hash]),'Filtering discard preroll works for this single no-B-frame experiment only.');
  t.diagnostic(JSON.stringify({nativePackets:native.packets.length,demuxPackets:projected.packets.length,discardPackets:projected.packets.length-visible.length,
    conclusion:'This one experiment cannot prove exact preroll for B-frames, AAC priming, fragments and all edit boundaries; retain REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED.'}));
  const identity=await require('../src/source-identity.cjs').readSourceIdentity(file);
  await assert.rejects(observeRemuxSourcePlayback({file,probe:projected,identity,target:'mp4',selectedIndexes:[0],maxRecords:10000}),{code:'REMUX_SOURCE_EDIT_PREROLL_UNVERIFIED'});
});
