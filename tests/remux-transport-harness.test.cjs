'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path');
const fixture = require('../scripts/v07-remux-long-fixtures.cjs');
const smoke = require('../scripts/v07-remux-long-smoke.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { createHash } = require('node:crypto');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const ID = '715e278f-1b7e-4d19-948d-a952b68c328e';
test('TS root proof wiring names all four positive cells and both specific refusals', () => {
  const names = ['ts-mp4','ts-video-mp4','ts-offset-mp4','ts-long-mp4','ts-refused','ts-refused-cut'];
  for (const mode of ['--qualify', '--normal']) {
    for (const name of names) assert.deepEqual(smoke.configuration(['--run-owned-remux',mode,'--cases',name]).cases,[name]);
    assert.deepEqual(smoke.configuration(['--run-owned-remux',mode,'--cases',names.join(',')]), { mode, cases: names });
  }
  assert.equal(smoke.CASES['ts-refused'].also,'ts-refused-cut');
  assert.equal(smoke.CASES['ts-refused-cut'].refusal,'REMUX_TS_HEAD_NOT_KEYFRAME');
  assert.equal(smoke.CASES['ts-refused'].refusal,'REMUX_TS_AUDIO_COUNT');
  for(const label of ['ts-refused','ts-refused-cut']){
    smoke.requireRefusal(label,{status:'unsupported',reasonCode:smoke.CASES[label].refusal});
    assert.throws(()=>smoke.requireRefusal(label,{status:'ready',reasonCode:smoke.CASES[label].refusal}));
    assert.throws(()=>smoke.requireRefusal(label,{status:'unsupported',reasonCode:'INVALID_PROBE'}));
  }
  for(const spec of fixture.TS_FIXTURES.filter(s=>!s.cut)){
    const args=fixture.generationArgs(spec,path.join(os.tmpdir(),spec.name));
    assert.equal(args.at(-2),'mpegts');assert.equal(args[args.indexOf('-t')+1],String(spec.seconds));
    assert.ok(args.includes('-n')&&!args.includes('-y')&&!args.some(a=>/nvenc|qsv|amf/.test(a)));
    assert.equal(args.filter(a=>a==='1:a:0').length,spec.twoAudio?2:spec.audio?1:0);
    if(spec.offset)assert.equal(args[args.indexOf('-output_ts_offset')+1],'4');
  }
  assert.equal(fixture.TS_FIXTURES.find(s=>s.id==='TS_LONG').seconds,1200);
  assert.equal(fixture.TS_LIMITS.maxChildren,11);
  assert.throws(()=>fixture.generationArgs({...fixture.TS_FIXTURES[0]},path.join(os.tmpdir(),'ts-av.ts')));
});
test('TS fixture pins are required before opening the owned session; normal mode uses the six evidenced production routes',async()=>{
  let calls=0;
  await assert.rejects(smoke.createSmoke({tsPins:{id:'ROOT_FILL_TS_FIXTURE_ID',sha256:'ROOT_FILL_TS_FIXTURE_REPORT_SHA256'},createOwnedSession(){calls++;throw Error('must remain inert');}})
    (['--run-owned-remux','--qualify','--cases','ts-mp4']),/ROOT/);
  assert.equal(calls,0);
  await assert.rejects(smoke.createSmoke({tsPins:{id:ID,sha256:'a'.repeat(64)},createOwnedSession(){calls++;throw Error('valid pins reached session');}})
    (['--run-owned-remux','--qualify','--cases','ts-mp4']),/valid pins reached session/);
  assert.equal(calls,1);
  const options = smoke.routeOptions('--normal'); assert.equal(options.remuxPolicies, REMUX_POLICIES); assert.equal(options.remuxPolicyIdentity, REMUX_POLICY_ID);
  assert.equal(options.remuxPolicies.filter(p => p.evidenceIds.length).length, 6);
  const normal=options.remuxPolicies.find(p=>p.inputFamily==='mpegts');
  assert.equal(normal.id, 'full-remux-mpegts-mp4-v1'); assert.equal(normal.evidenceIds.length, 6);
  assert.ok(normal.evidenceIds.every(id => id.startsWith('1865c531-2809-4170-870e-29f56dfc97a3:')));
  assert.ok(smoke.routeOptions('--qualify').remuxPolicies.find(p=>p.inputFamily==='mpegts').evidenceIds.length);
});
test('TS fixture orchestration stays on the owned mechanism with a separate six-case manifest',async()=>{
  const io={mkdir:async()=>{}}, generated=[],hashed=[];
  const cases=fixture.TS_FIXTURES.filter(s=>!s.cut), owned=path.join(os.tmpdir(),'inert-ts-fixture-session');
  // Test generation calls and fixed outputs. Cut bytes are tested separately
  // with small temp files by remux-transport.test.cjs, never on the owned drive.
  const session={owned,io,controller:new AbortController(),runtime:{ffmpeg:'fake-ffmpeg',ffprobe:'fake-ffprobe'},
    report:{cases:[]},open:async()=>{},close:async()=>{},save:async()=>{},async run(exe,args){
      if(exe==='fake-ffmpeg'){generated.push(args);return{exitCode:0};}
      const spec=fixture.TS_FIXTURES.find(s=>s.name===path.basename(args.at(-1)));
      const p={streams:[{index:0,id:'0x100',codec_type:'video',codec_name:'h264',pix_fmt:'yuv420p',field_order:'progressive',
        color_range:'tv',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709',disposition:{default:1}},
        ...(spec.audio?[{index:1,id:'0x101',codec_type:'audio',codec_name:'aac',codec_tag_string:'[15][0][0][0]',profile:'LC',sample_rate:'48000',channels:2,channel_layout:'stereo'}]:[])],
        format:{format_name:'mpegts',duration:String(spec.seconds),start_time:String(spec.offset||1.4),nb_programs:1,nb_stream_groups:0},chapters:[],stream_groups:[]};
      if(spec.twoAudio)p.streams.push({...p.streams[1],index:2,id:'0x102'});
      p.format.nb_streams=p.streams.length;p.programs=[{program_id:1,program_num:1,pmt_pid:4096,pcr_pid:256,nb_streams:p.streams.length,streams:p.streams.map(s=>({index:s.index}))}];
      return {stdout:JSON.stringify(p),stderr:'',stderrCapture:{truncated:false}};
    }};
  // Stop at the cut dependency to demonstrate it cannot manufacture missing
  // source bytes through a child or accept a copied specification as authority.
  const r=await fixture.createFixtures({createOwnedSession:()=>session,hashFile:async file=>{hashed.push(file);return{bytes:1024,sha256:'a'.repeat(64)};}})(['--run-owned-ts-fixtures']);
  assert.equal(r.status,'failed-retained');assert.equal(r.cases.length,6,JSON.stringify(r.failure));assert.equal(generated.length,5);assert.equal(hashed.length,5);
  assert.ok(cases.every(s=>generated.some(a=>a.at(-1)===path.join(owned,s.name))));
});
test('TS manifest parser binds every fixed path, hash, byte ceiling and closure',()=>{
  const report={id:ID,status:'passed-owned-fixtures',liveChildren:0,leaseReleased:true,closureFailures:[],
    cases:fixture.TS_FIXTURES.map(s=>({id:s.id,output:path.join(fixture.OWNED,'fixtures','remux-long-'+ID,s.name),
      status:'passed-generated-metadata',file:{bytes:1024,sha256:'a'.repeat(64)},observation:{scope:'generated-source-metadata-only',seconds:s.seconds}}))};
  const parse=r=>{const bytes=Buffer.from(JSON.stringify(r));return smoke.fixtureSources(bytes,{id:ID,sha256:sha(bytes)},fixture.TS_FIXTURES);};
  assert.equal(parse(report).size,6);
  for(const mutate of [r=>{r.cases[0].output=path.join(os.tmpdir(),'wrong.ts');},r=>{r.cases[0].file.bytes=fixture.TS_FIXTURES[0].maxBytes;},
    r=>{r.liveChildren=1;},r=>{r.cases.pop();}]){const r=structuredClone(report);mutate(r);assert.throws(()=>parse(r));}
});
