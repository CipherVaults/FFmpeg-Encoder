'use strict';
// Developer-only. Two inputs: the already qualified runtime directory and an existing owned scratch parent.
// Never reads user media. Fresh private child directory, fixed fixture/candidate names; no service, IPC, shell or publication.
const fs = require('node:fs/promises'), path = require('node:path'), assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { manifest, loaderGuard } = require('../linux-blue/product-linux-shell.cjs');
const { openCandidateCalibrationRuntime } = require('../linux-blue/candidate-calibration-runtime.cjs');
const { parseProbeJson } = require('../src/inspection.cjs');
const { makeLayer3 } = require('./fixtures/q2j-layer3.cjs');
const { inspectFrames, compareCopy } = require('../linux-blue/qualification-tests/q2j-mp3-witness.cjs');
const sha = b=>createHash('sha256').update(b).digest('hex');
async function main() {
  const [rt,parent]=process.argv.slice(2);
  assert(process.argv.length===4 && rt===await fs.realpath(rt) && parent===await fs.realpath(parent));
  loaderGuard();
  const dir=await fs.mkdtemp(path.join(parent,'q2j-mp3-proof-')), timer=AbortSignal.timeout(90000);
  const runtime=await openCandidateCalibrationRuntime(manifest(rt)), ledger=[], cases=[];
  const run=runtime.createRunner();
  async function invoke(tool,args,{signal=timer,expectedFail=false}={}) {
    loaderGuard();let child;
    const row={tool,args:args.map(a=>a.startsWith(dir+path.sep)?path.relative(dir,a):a)};
    try {
      const result=await run(runtime.pins[tool].path,args,{timeoutMs:8000,stdoutLimit:1024*1024,stderrLimit:32*1024,signal,onChild:c=>{child=c;}});
      row.exitCode=result.exitCode;row.stderr=result.stderr;row.signal=result.exitSignal??null;
      // This pinned CLI can close 0 on a refused -n overwrite. Require the actual diagnostic and unchanged destination digest, not a nonzero exit assumption.
      if(expectedFail){assert.equal(child?.exitCode,0);assert.match(result.stderr,/already exists/);assert.equal(child?.signalCode,null);return '';}
      assert.equal(result.stderr,''); assert.equal(result.exitCode,0);
      return result.stdout;
    } catch(e) {
      row.errorCode=e.code;row.exitCode=e.exitCode??null;row.stderr=e.stderr??'';row.signal=e.exitSignal??null;
      if(expectedFail && e.code==='TOOL_FAILED' && e.exitCode===1 && /already exists/.test(e.stderr))return '';
      throw e;
    } finally {row.started=!!child; if(child){row.childExit=child.exitCode;row.childSignal=child.signalCode;} ledger.push(row);}
  }
  const probe=async f=>parseProbeJson(await invoke('ffprobe',['-v','error','-show_streams','-show_format','-show_packets','-show_data_hash','sha256','-show_chapters','-show_programs','-show_stream_groups','-of','json',f]),'MP3 lab probe');
  const base=['-nostdin','-v','error','-xerror','-err_detect','explode','-threads','1','-protocol_whitelist','file'];
  try {
    for(const [name,cfg] of [['stereo-48-cbr',{rate:48000,channels:2}],['mono-441-vbr',{rate:44100,channels:1,variable:true}],['stereo-32-vbr',{rate:32000,channels:2,variable:true}]]) {
      const source = makeLayer3(cfg), ip=path.join(dir,name+'.mp3'), op=path.join(dir,name+'.mp4');
      inspectFrames(source);
      await fs.writeFile(ip,source,{flag:'wx',mode:0o600});
      const s=await probe(ip);
      const args=[...base,'-i',ip,'-map','0:0','-c:a','copy','-map_metadata','-1','-map_chapters','-1','-fflags','+bitexact','-n','-f','mp4',op];
      await invoke('ffmpeg',args);
      const o=await probe(op);
      const pcm=[];
      for(const f of [ip,op]) {const dest=f+'.s32le';await invoke('ffmpeg',[...base,'-i',f,'-map','0:0','-threads','1','-c:a','pcm_s32le','-f','s32le','-n',dest]);pcm.push(await fs.readFile(dest));}
      const fields={source,output:await fs.readFile(op),sourceProbe:s,outputProbe:o,sourcePcm:pcm[0],outputPcm:pcm[1]};
      const result=compareCopy(fields);assert(pcm[0].some(v=>v!==0),'fixture must be audible, not equal silence');
      const negative={};
      const mutated=(key,update,code)=>{const v={...fields};update(v);assert.throws(()=>compareCopy(v),e=>e.code===code);negative[key]=code;};
      mutated('changed-packet-payload',v=>{v.output=Buffer.from(v.output);v.output[Number(o.packets[0].pos)+40]^=1;},'MP3_PACKET_MISMATCH');
      mutated('reordered-probed-packets',v=>{v.outputProbe=structuredClone(o);v.outputProbe.packets.reverse();},'MP3_PACKET_MISMATCH');
      mutated('shift-one-sample',v=>{v.outputProbe=structuredClone(o);v.outputProbe.packets[5].pts++;},'MP3_CLOCK_MISMATCH');
      mutated('gapless-side-data',v=>{v.sourceProbe=structuredClone(s);v.sourceProbe.packets[0].side_data_list=[{side_data_type:'Skip Samples',skip_samples:1}];},'MP3_CLOCK_MISMATCH');
      mutated('language-change',v=>{v.outputProbe=structuredClone(o);v.outputProbe.streams[0].tags.language='eng';},'MP3_FAMILY_UNPROVED');
      mutated('omitted-input-metadata',v=>{v.sourceProbe=structuredClone(s);v.sourceProbe.format.tags={title:'Keep me'};},'MP3_FAMILY_UNPROVED');
      mutated('wrong-native-brand',v=>{v.output=Buffer.from(v.output);v.output.write('qt  ',8);},'MP3_MP4_UNPROVED');
      mutated('wrong-native-channels',v=>{v.output=Buffer.from(v.output);const i=v.output.indexOf(Buffer.from('mp4a'));assert(i>0);v.output.writeUInt16BE(cfg.channels===1?2:1,i+4+16);},'MP3_MP4_UNPROVED');
      mutated('wrong-native-object-type',v=>{v.output=Buffer.from(v.output);const p=v.output.indexOf(Buffer.from('048080800d6b15','hex'));assert(p>0);v.output[p+5]=0x40;},'MP3_MP4_UNPROVED');
      mutated('decoded-sample-changed',v=>{v.outputPcm=Buffer.from(v.outputPcm);v.outputPcm[40]^=1;},'MP3_PCM_MISMATCH');
      if(name==='stereo-48-cbr'){
        await invoke('ffmpeg',args,{expectedFail:true});
        assert.equal(sha(await fs.readFile(op)),result.outputSha256,'existing output changed');
      }
      assert.deepEqual(await fs.readFile(ip),source);
      cases.push({name,...result,mutatedObservationRefusals:negative});
    }
    // A real truncated stream can still be recognized and recover earlier frames: the complete raw walker must reject it.
    const truncated=makeLayer3().subarray(0,-19), tp=path.join(dir,'truncated.mp3');await fs.writeFile(tp,truncated,{flag:'wx'});
    const tr=await probe(tp);assert.equal(tr.streams[0].codec_name,'mp3');assert.throws(()=>inspectFrames(truncated),e=>e.code==='MP3_FRAME_UNPROVED');
    // Misnamed, valid PCM WAV: ordinary FFprobe, never type trust by extension.
    const wav=Buffer.alloc(44+480);wav.write('RIFF');wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(48000,24);wav.writeUInt32LE(96000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(480,40);
    const wp=path.join(dir,'misnamed.mp3');await fs.writeFile(wp,wav,{flag:'wx'});const wpProbe=await probe(wp);assert.equal(wpProbe.format.format_name,'wav');assert.throws(()=>inspectFrames(wav),e=>e.code==='MP3_FRAME_UNPROVED');
    await runtime.requireCurrent();
    const aborted=AbortSignal.abort();await assert.rejects(invoke('ffprobe',['-version'],{signal:aborted}),e=>e.code==='CANCELLED');assert.equal(ledger.at(-1).started,false);
    await assert.rejects(runtime.requireCurrent(), e => e.code==='OPERATION_RUNTIME_STALE');
    const fresh=await openCandidateCalibrationRuntime(manifest(rt));try{await fresh.requireCurrent();}finally{await fresh.close();}
    const evidence={scope:'native laboratory only; no product Prepare/Start/publication',runtimeIdentity:runtime.runtimeIdentity,cases,extra:{truncatedRecognizedAs:tr.streams[0].codec_name,misnamedRecognizedAs:wpProbe.format.format_name,preAbortedChildren:0,oldOwnerRetired:true,freshIntegrityChecked:true,noClobber:true},ledger};
    await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({dir,status:'passed',cases:cases.length,receiptSha256:sha(await fs.readFile(path.join(dir,'receipt.json')))}));
  } catch(e) {
    await fs.writeFile(path.join(dir,'failed.json'),JSON.stringify({message:String(e.stack),cases,ledger},null,2)+'\n',{flag:'wx'});
    console.error(dir);throw e;
  } finally {await runtime.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
