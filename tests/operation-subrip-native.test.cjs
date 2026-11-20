'use strict';
// Opt-in, bounded Linux component witness, not a product execution. No tool
// fallback or download. The FFmpeg and FFprobe hashes are required even when
// Q2M_AUDITED_PAIR_DIR is explicitly set. No user media, GPU or GUI.
const test=require('node:test'), assert=require('node:assert/strict');
const fs=require('node:fs'), path=require('node:path'), os=require('node:os');
const {createHash}=require('node:crypto'), {spawnSync}=require('node:child_process');
const {observeSubRip,clipSubRip}=require('../src/operation-subrip.cjs');
const pins=require('../linux-blue/runtime-recovery-2026-11-19/runtime-build-result.json').outputs;
const pair=process.env.Q2M_AUDITED_PAIR_DIR;
const sha=b=>createHash('sha256').update(b).digest('hex');
const inputRows=[[0,500,'outside before'],[250,800,'مرحبا'],[750,1100,'one\ntwo'],[1250,1800,'at right'],[1500,2250,'outside after']];
const wanted=[[0,300,'مرحبا'],[250,600,'one\ntwo'],[750,1000,'at right']];
function stamp(ms){return [Math.floor(ms/3600000),Math.floor(ms/60000)%60,Math.floor(ms/1000)%60].map(n=>String(n).padStart(2,'0')).join(':')+','+String(ms%1000).padStart(3,'0');}
function srt(rows){return rows.map(([a,b,text],i)=>(i+1)+'\n'+stamp(a)+' --> '+stamp(b)+'\n'+text+'\n\n').join('');}
test('9.0.2 physical Matroska subtitle input, explicit clip and independent full coded + decoded output readback',
  {skip:!pair&&'Set Q2M_AUDITED_PAIR_DIR to the matching 9.0.2 pair; no fallback.'},async t=>{
  assert.equal(process.platform,'linux');
  assert.equal(path.isAbsolute(pair),true); const binaries={};
  for(const pin of pins){
    const file=path.join(pair,pin.path);assert.equal(fs.realpathSync(file),file);const st=fs.lstatSync(file);
    assert.equal(st.isFile(),true);assert.equal(st.size,pin.bytes);assert.equal(sha(fs.readFileSync(file)),pin.sha256);binaries[pin.path]=file;
  }
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'q2m-synthetic-'));
  const files=['input.mkv','clipped.mkv','styled.mkv'].map(n=>path.join(dir,n));
  t.after(()=>{for(const f of files){if(fs.existsSync(f))fs.unlinkSync(f);} fs.rmdirSync(dir);});
  const calls=[];
  function run(tool,args,input){
    const r=spawnSync(binaries[tool],args,{cwd:dir,input,encoding:'utf8',timeout:15000,maxBuffer:512*1024,
      env:{PATH:'/usr/bin:/bin',LC_ALL:'C',TZ:'UTC',HOME:dir,TMPDIR:dir},shell:false});
    assert.ifError(r.error);assert.equal(r.status,0,r.stderr);calls.push(tool);return r.stdout;
  }
  function mux(rows,f){
    // Independent synthetic video track establishes a non-first subtitle;
    // it is not evidence about video-mapping or trimming in the application.
    run('ffmpeg',['-nostdin','-v','error','-f','lavfi','-i','color=black:size=32x32:rate=2:duration=2.5',
      '-f','srt','-i','pipe:0','-map','0:v:0','-map','1:s:0','-c:v','ffv1','-threads:v','1','-flags:v','+bitexact',
      '-c:s','copy','-metadata:s:s:0','language=ara','-metadata:s:s:0','title=Captions','-disposition:s:0','default+forced',
      '-fflags','+bitexact','-n',f],srt(rows));
  }
  function packets(f,expected){
    const p=JSON.parse(run('ffprobe',['-v','error','-select_streams','s:0','-show_packets','-show_streams','-show_data_hash','sha256','-of','json',f]));
    assert.equal(p.streams.length,1);const st=p.streams[0];assert.equal(st.index,1);assert.equal(st.codec_name,'subrip');assert.equal(st.time_base,'1/1000');
    assert.equal(st.tags.language,'ara');assert.equal(st.tags.title,'Captions');assert.equal(st.disposition.default,1);assert.equal(st.disposition.forced,1);
    assert.deepEqual(p.packets.map(x=>[x.stream_index,x.pts,x.duration,x.data_hash]),expected.map(([a,b,text])=>[1,a,b-a,'SHA256:'+sha(Buffer.from(text))]));
  }
  async function scan(f){const b=fs.readFileSync(f);return observeSubRip(b.toString('base64'),sha(b),'2');}
  mux(inputRows,files[0]); packets(files[0],inputRows);
  const source=await scan(files[0]); const r=clipSubRip(source,source.sourceSha256,'1/2','3/2');
  assert.deepEqual(r.omitted,[1,5]);assert.deepEqual(r.clipped,[{ordinal:2,start:true,end:false},{ordinal:4,start:false,end:true}]);
  const planned=r.cues.map(c=>[Number(c.startMs),Number(c.endMs),c.text]);assert.deepEqual(planned,wanted);
  mux(planned,files[1]); packets(files[1],wanted);
  const actual=await scan(files[1]);assert.deepEqual(actual.track,source.track); // same synthetic bitexact track layout only
  assert.deepEqual(actual.cues.map(c=>[Number(c.startTicks),Number(c.endTicks),c.text]),wanted);
  // Independently decode the complete output subtitle stream into timed ASS
  // dialogue. This comparison tests the checker; ASS input remains refused.
  const rendered=run('ffmpeg',['-nostdin','-v','error','-i',files[1],'-map','0:s:0','-c:s','ass','-f','ass','pipe:1']);
  const dialogue=rendered.split(/\r?\n/).filter(x=>x.startsWith('Dialogue:')).map(x=>{const d=x.split(',');return [d[1],d[2],d.slice(9).join(',')];});
  assert.deepEqual(dialogue,[['0:00:00.00','0:00:00.30','مرحبا'],['0:00:00.25','0:00:00.60','one\\Ntwo'],['0:00:00.75','0:00:01.00','at right']]);
  mux([[0,100,'<i>not plain</i>']],files[2]);await assert.rejects(scan(files[2]),{code:'SUBRIP_TEXT_UNSUPPORTED'});
  t.diagnostic(JSON.stringify({synthetic:true,claim:'component-only; no product job',calls,tools:pins.map(x=>[x.path,x.sha256]),
    files:files.map(f=>[path.basename(f),fs.statSync(f).size,sha(fs.readFileSync(f))]),sourceTrack:source.track,
    seen:source.cues.length,kept:r.cues.length,clipped:r.clipped,omitted:r.omitted,decodedOutputEvents:dialogue.length,styledInput:'refused'}));
});
