'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { RemuxOperations, fingerprintRemuxSourceIdentity, deriveRemuxAssessmentBudget } = require('../src/remux-operation.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const { collectRemuxEvidence, compareRemuxPackets } = require('../src/remux-evidence.cjs');
const { prepareTransport, initialization } = require('../src/remux-transport-evidence.cjs');
const { canonicalTransportVideo, canonicalTransportAudio, transportNals, dumpBytes, transportClock, createTransportIntegrity } = require('../src/remux-transport.cjs');
const admission = require('./helpers/remux-admission-fixture.cjs');
const { ffmpeg, ffprobe } = require('../src/candidate-runtime.cjs').resolveCandidateRuntime({ root: path.resolve(__dirname, '..') });
const route = REMUX_POLICIES.find(p => p.inputFamily === 'mpegts'), runtimeIdentity = route.runtimeIdentity;
const request = { fileId: 'ts', identityRevision: 0, draftRevision: 0, operation: 'remux', target: 'mp4', range: null, omissionRequestIds: [] };
async function temp(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-ts-unit-'));
  t.after(async () => { assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('remux-ts-unit-')); await fs.rm(dir, { recursive: true }); }); return dir; }
async function probe(file) { return JSON.parse((await runTool(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-show_programs', '-show_stream_groups', '-show_chapters', '-show_data_hash', 'sha256', '-of', 'json', file])).stdout); }
async function fixture(t, { audio = true, offset = false, bframes = true, vfr = false, twoAudio = false, stereo = false } = {}) {
  const dir = await temp(t), file = path.join(dir, 'input.ts');
  const args = ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=128x72:r=30:d=1'];
  if (audio) args.push('-f', 'lavfi', '-i', 'sine=r=48000:d=1');
  args.push('-map', '0:v:0'); if (audio) args.push('-map', '1:a:0'); if (twoAudio) args.push('-map', '1:a:0');
  args.push('-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709' + (vfr ? ',setpts=PTS+floor(N/7)*0.033333333/TB' : ''), '-fps_mode', 'passthrough',
    '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-pix_fmt', 'yuv420p',
    '-x264-params', 'keyint=6:min-keyint=6:scenecut=0:open-gop=0:bframes=' + (bframes ? '2' : '0'),
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv');
  if (audio) args.push('-c:a', 'aac', '-ar:a', '48000', '-ac:a', stereo ? '2' : '1');
  if (offset) args.push('-output_ts_offset', '4');
  args.push('-f', 'mpegts', file); await runTool(ffmpeg, args);
  const raw = await probe(file), identity = await readSourceIdentity(file);
  const assessment = assessRemux({ request, probe: raw, sourceFingerprint: fingerprintRemuxSourceIdentity(identity) });
  assert.equal(assessment.status, 'qualification-required', JSON.stringify(assessment.blockers));
  return { dir, file, raw, identity, assessment };
}
function owner(qualified = true) { return new RemuxOperations({ runtimeIdentity, policyIdentity: REMUX_POLICY_ID,
  policies: qualified ? REMUX_POLICIES : [{ ...route, evidenceIds: [] }] }); }
async function prepare(f, run = runTool, signal) { return prepareTransport({ file: f.file, probe: f.raw, identity: f.identity,
  ffprobe, run, signal, budget: deriveRemuxAssessmentBudget(f.assessment, f.identity.size, 'packet-identity-v1').budget }); }
async function complete(t, shape = {}, mutant = null) {
  const f = await fixture(t, shape), api = owner(), output = path.join(f.dir, 'out.mp4'), outputId = randomUUID();
  const plan = api.prepare({ assessment: f.assessment, request, input: f.file, output, outputId, sourceIdentity: f.identity });
  assert.equal(plan.args[plan.args.indexOf('-movie_timescale')+1],'90000');
  assert.equal(plan.args[plan.args.indexOf('-video_track_timescale')+1],'90000');
  const selection = api.select({ plan, settings: null, sourceIdentity: f.identity, sourceProbeFingerprint: plan.sourceProbeFingerprint,
    runtimeIdentity, environment: null, budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS });
  assert.ok(selection); const transportPreparation = await prepare(f);
  await runTool(ffmpeg, api.resolveInvocation(plan, { output }));
  if (mutant?.native) { const bytes = await fs.readFile(output); mutant.native(bytes); await fs.writeFile(output, bytes); }
  const outputProbe = await probe(output);
  const controller=new AbortController();let opened=0,closed=0;
  const calls = [], run = async (file, args, opts) => {
    calls.push(args);
    const cancel=mutant?.cancelAt&&(mutant.cancelAt==='packets'?args.includes('-show_packets'):
      mutant.cancelAt==='headers'?args.some(a=>a.includes('h264_metadata')):args.includes('rawvideo'));
    if(cancel)return runTool(file,args,{...opts,onChild(child){opened++;child.once('close',()=>{closed++;});opts.onChild?.(child);controller.abort();}});
    if(mutant?.change && args.includes('-show_packets')) return replayMutant(file,args,opts,mutant.change);
    return runTool(file, args, opts);
  };
  const evidence = await collectRemuxEvidence({ assessment: f.assessment, runtimeIdentity, outputId, sourceProbe: f.raw, outputProbe,
    sourcePath: f.file, outputPath: output, stageDirectory: f.dir, ffmpeg, ffprobe, run, budget: EVIDENCE_BUDGET,
    verificationMethod: 'packet-identity-v1', transportPreparation, maxConcurrentChildren: 2,signal:controller.signal });
  if(mutant){assert.equal(evidence.status,mutant.cancelAt?'cancelled':'failed');assert.equal(evidence.failure.code,mutant.code,JSON.stringify(evidence.failure));
    if(mutant.cancelAt){assert.ok(opened>0);assert.equal(closed,opened);}
    assert.throws(()=>api.validate(plan,outputProbe,evidence),{code:'REMUX_EVIDENCE_RECEIPT_REQUIRED'});return {...f,evidence};}
  assert.equal(evidence.status, 'completed', JSON.stringify(evidence.failure));
  const result = api.validate(plan, outputProbe, evidence); assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(evidence.verificationClaim.completeAudioDecoded, false);
  const videoComparison=evidence.comparisons.find(c=>Object.hasOwn(c,'sourceBFrames'));
  assert.equal(videoComparison.sourceBFrames,videoComparison.outputBFrames);
  if(shape.bframes!==false)assert.equal(videoComparison.sourceBFrames,2);
  assert.deepEqual(evidence.transport.nalMovements, []); assert.equal(evidence.transport.headDroppedPackets, 0);
  assert.deepEqual(evidence.readAccounting.completeOperations.map(c => [c.side, c.operation]), [
    ['source', 'transport-integrity'], ['source', 'packet-probe-during-preparation'],
    ['output', 'output-all-packets'], ['output', 'output-0-complete-parameters'], ['output', 'output-seal']
  ]);
  assert.equal(evidence.readAccounting.physicalIOBytes, null);
  assert.equal(evidence.readAccounting.partialOperations.filter(c => c.operation === 'native-edit-list-metadata').length, 1);
  assert.equal(calls.filter(a => a.includes('-show_packets')).length, 1);
  assert.ok(calls.every(a => !a.includes('-show_frames') && !a.includes('pcm_f32le')));
  return { ...f, api, plan, evidence, output, outputProbe };
}
for (const [name, shape] of Object.entries({ 'H264 plus ADTS AAC': {}, 'video only': { audio: false },
  'non-zero start': { offset: true }, 'B frames': { bframes: true }, 'stereo AAC': { stereo: true }, 'variable timestamps': { audio: false, vfr: true } }))
  test('generated TS packet-identity: ' + name, async t => { await complete(t, shape); });
test('six production routes are evidenced while an injected empty-evidence TS route still refuses preparation', async t => {
  const f = await fixture(t); assert.equal(REMUX_POLICIES.length, 6); assert.ok(REMUX_POLICIES.every(p => p.evidenceIds.length));
  assert.deepEqual(route.evidenceIds, ['ts-mp4', 'ts-video-mp4', 'ts-offset-mp4', 'ts-long-mp4', 'ts-refused', 'ts-refused-cut']
    .map(label => '1865c531-2809-4170-870e-29f56dfc97a3:' + label));
  assert.throws(() => owner(false).prepare({ assessment: f.assessment, request, input: f.file,
    output: path.join(f.dir, 'never.mp4'), outputId: randomUUID(), sourceIdentity: f.identity }), { code: 'REMUX_QUALIFICATION_REQUIRED' });
  assert.equal((await fs.readdir(f.dir)).length, 1);
});
function dump(data){const lines=[];for(let at=0;at<data.length;at+=16){const hex=data.subarray(at,at+16).toString('hex').match(/.{1,4}/g).join(' ');
  lines.push(at.toString(16).padStart(8,'0')+': '+hex.padEnd(39,' ')+'  .');}return '\n'+lines.join('\n')+'\n';}
async function replayMutant(file,args,opts,change){
  const r=await runTool(file,args,{...opts,onStdoutChunk:undefined,stdoutLimit:32*1024*1024});const p=JSON.parse(r.stdout);change(p);
  const bytes=Buffer.from(JSON.stringify(p));await opts.onStdoutChunk(bytes);
  return {...r,stdout:'',stdoutCapture:{streamed:true,truncated:false,totalBytes:bytes.length}};
}
test('complete TS verifier kills ordered NAL, AAC, sample-description and exact-clock mutants',async t=>{
  const changeNals=edit=>p=>{const packet=p.packets.find(s=>s.codec_type==='video'),ns=transportNals(dumpBytes(packet.data,Number(packet.size)),'avcc').map(n=>Buffer.from(n));
    const data=admission.avcNals(edit(ns));packet.data=dump(data);packet.size=String(data.length);};
  const cases=[
    {name:'one NAL payload byte',code:'REMUX_PACKET_PAYLOAD',change:changeNals(ns=>{ns.at(-1)[ns.at(-1).length-1]^=1;return ns;})},
    {name:'SPS NAL dropped',code:'REMUX_PACKET_PAYLOAD',change:changeNals(ns=>ns.filter(n=>(n[0]&31)!==7))},
    {name:'NAL reordered',code:'REMUX_PACKET_PAYLOAD',change:changeNals(ns=>[ns[1],ns[0],...ns.slice(2)])},
    {name:'AUD removed',code:'REMUX_PACKET_PAYLOAD',change:changeNals(ns=>ns.filter(n=>(n[0]&31)!==9))},
    {name:'SEI removed',code:'REMUX_PACKET_PAYLOAD',change:changeNals(ns=>ns.filter(n=>(n[0]&31)!==6))},
    {name:'SPS differs in band',code:'REMUX_TS_PARAMETER_CHANGE',change:changeNals(ns=>{const s=ns.find(n=>(n[0]&31)===7);s[s.length-1]^=1;return ns;})},
    {name:'sample description differs',code:'REMUX_TS_PARAMETER_CHANGE',change:p=>{const s=p.streams.find(s=>s.codec_type==='video'),b=dumpBytes(s.extradata,s.extradata_size);
      let at=6;for(let i=0;i<(b[5]&31);i++)at+=2+b.readUInt16BE(at);at++;const size=b.readUInt16BE(at);at+=2;b[at+size-1]^=1;s.extradata=dump(b);}},
    {name:'one AAC payload byte',code:'REMUX_PACKET_PAYLOAD',change:p=>{const a=p.packets.find(s=>s.codec_type==='audio'),b=dumpBytes(a.data,Number(a.size));b[b.length-1]^=1;a.data=dump(b);}},
    {name:'shifted PTS',code:'REMUX_TS_PACKET_IDENTITY',change:p=>{const v=p.packets.find(s=>s.codec_type==='video');v.pts++;delete v.pts_time;}},
    {name:'changed AV offset',code:'REMUX_TS_PACKET_IDENTITY',change:p=>{for(const a of p.packets.filter(s=>s.codec_type==='audio')){a.pts++;a.dts++;delete a.pts_time;delete a.dts_time;}}},
  ];
  for(const mutant of cases) await t.test(mutant.name,async t=>{await complete(t,{},mutant);});
});

test('complete verifier inspects sealed native video and audio edit rates beyond demuxed packet identity', async t => {
  for (const [name, track] of [['video', 0], ['audio', 1]]) await t.test(name + ' rate 0x00020000', async t => {
    await complete(t, {}, { code: 'REMUX_EDIT_RATE_UNSUPPORTED', native: b => {
      let at = -1;
      for (let i = 0; i <= track; i++) at = b.indexOf(Buffer.from('elst'), at + 1);
      assert.ok(at > 0); assert.equal(b[at + 4], 0);
      const count = b.readUInt32BE(at + 8); assert.equal(count, 2);
      b.writeUInt32BE(0x00020000, at + 12 + (count - 1) * 12 + 8);
    } });
  });
});

test('complete collector refuses every native playback-control and header-duration mutant', async t => {
  const cases = [
    ['audio track volume zero', 'tkhd', 1, 36, 2, 0, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['audio track disabled', 'tkhd', 1, 1, 3, 0, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['video track volume nonzero', 'tkhd', 0, 36, 2, 256, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['track layer', 'tkhd', 0, 32, 2, 1, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['audio alternate group', 'tkhd', 1, 34, 2, 2, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['track matrix', 'tkhd', 0, 40, 4, 131072, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['video display width', 'tkhd', 0, 76, 4, 32 * 65536, 'REMUX_TRACK_GEOMETRY_UNSUPPORTED'],
    ['video display height', 'tkhd', 0, 80, 4, 32 * 65536, 'REMUX_TRACK_GEOMETRY_UNSUPPORTED'],
    ['audio balance', 'smhd', 0, 4, 2, 256, 'REMUX_SOUND_BALANCE_UNSUPPORTED'],
    ['movie volume zero', 'mvhd', 0, 24, 2, 0, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['movie rate 2.0', 'mvhd', 0, 20, 4, 131072, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['movie matrix', 'mvhd', 0, 36, 4, 131072, 'REMUX_OUTPUT_PLAYBACK_UNEXPECTED'],
    ['movie duration one tick', 'mvhd', 0, 16, 4, 1, 'REMUX_MOVIE_DURATION_UNEXPECTED'],
    ['video media duration one tick', 'mdhd', 0, 16, 4, 1, 'REMUX_MEDIA_DURATION_UNEXPECTED'],
    ['track duration one tick off', 'tkhd', 0, 20, 4, null, 'REMUX_TRACK_DURATION_UNEXPECTED'],
  ];
  for (const [name, type, occurrence, offset, width, value, code] of cases) await t.test(name, async t => {
    await complete(t, {}, { code, native: b => {
      let at = -1; for (let i = 0; i <= occurrence; i++) at = b.indexOf(Buffer.from(type), at + 1);
      assert.ok(at > 0); const target = at + 4 + offset; assert.equal(b[at + 4], 0);
      b.writeUIntBE(value ?? b.readUIntBE(target, width) + 1, target, width);
    } });
  });
});
test('mid-stream ADTS header changes refuse during preparation',async t=>{
  const f=await fixture(t);
  await assert.rejects(prepare(f,(file,args,opts)=>replayMutant(file,args,opts,p=>{
    const a=p.packets.filter(s=>s.codec_type==='audio')[1],b=dumpBytes(a.data,Number(a.size));b[2]^=4;a.data=dump(b);
  })),{code:'REMUX_TS_ADTS_CONFIG'});
});
test('TS verification cancellation closes the packet, header and boundary-decoder child before refusing authority',async t=>{
  for(const cancelAt of ['packets','headers','windows'])await complete(t,{}, {cancelAt,code:'CANCELLED',change:()=>{}});
});
test('incomplete initialization, changed source and unknown transport side metadata fail closed',async t=>{
  assert.throws(()=>initialization(nals().slice(0,1),stream()),{code:'REMUX_TS_INITIALIZATION'});
  const f=await fixture(t);
  await assert.rejects(prepare({...f,identity:{...f.identity,size:'1'}}),{code:'REMUX_TS_SOURCE_CHANGED'});
  for(const entry of [{side_data_type:'MPEGTS Stream ID',id:999},{side_data_type:'Unknown functional data',id:224}])
    await assert.rejects(prepare(f,(file,args,opts)=>replayMutant(file,args,opts,p=>{p.packets[0].side_data_list=[entry];})),{code:'REMUX_TS_PACKET_SIDE_DATA'});
  for(const value of [null,{},Array(17).fill({side_data_type:'MPEGTS Stream ID',id:224})])
    await assert.rejects(prepare(f,(file,args,opts)=>replayMutant(file,args,opts,p=>{p.packets[0].side_data_list=value;})),{code:'REMUX_TS_PACKET_SIDE_DATA'});
});
test('two audio TS is refused before preparation', async t => {
  const dir = await temp(t); // fixture() deliberately asserts positive admission, so generate directly.
  const file = path.join(dir, 'two.ts'); await runTool(ffmpeg, ['-v','error','-f','lavfi','-i','color=s=128x72:r=30:d=0.2',
    '-f','lavfi','-i','sine=r=48000:d=0.2','-map','0:v','-map','1:a','-map','1:a','-c:v','libx264','-threads','1',
    '-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-c:a','aac','-f','mpegts',file]);
  const p = await probe(file), a = assessRemux({ request, probe: p, sourceFingerprint: 'a'.repeat(64) });
  assert.ok(a.blockers.some(b => b.code === 'REMUX_TS_AUDIO_COUNT'));
});
test('transport preparation cannot be replaced with a serialized token', async t => {
  const f = await complete(t); const { getTransportPreparation } = require('../src/remux-transport-evidence.cjs');
  assert.throws(() => getTransportPreparation({ kind:'main-owned-ts-packet-preparation-v1' }, f.file, f.raw, f.evidence.sourceBefore), { code: 'REMUX_TS_PREPARATION_REQUIRED' });
});

function stream() { return { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level:40, width: 2,height:2,
  pix_fmt:'yuv420p',field_order:'progressive',
  sample_aspect_ratio:'1:1',color_range:'tv',color_primaries:'bt709',color_transfer:'bt709',color_space:'bt709' }; }
const nals = () => [admission.sps({width:2,height:2,level:40}), admission.pps(), admission.sei(), admission.packet(0).subarray(4)];
const annex = ns => Buffer.concat(ns.flatMap(n => [Buffer.from([0,0,0,1]),n]));
test('canonical AVC keeps AUD, SPS/PPS, filler and all ordered payloads', () => {
  const ns = nals(), admitted = initialization(ns, stream()), all = [Buffer.from([9,240]),...ns,Buffer.from([12,255,128])];
  const a = canonicalTransportVideo(annex(all),'annexb',admitted,true), b = canonicalTransportVideo(a.data,'avcc',admitted,true);
  assert.equal(a.sha256,b.sha256); assert.deepEqual(a.units.map(n=>n.type),[9,7,8,6,5,12]);
  for (const mutate of [values => { const v = values.map(n=>Buffer.from(n)); v[4][v[4].length-1]^=1; return v; },
    values=>values.filter((_,i)=>i!==3), values=>[values[1],values[0],...values.slice(2)], values=>values.slice(0,-1)]) {
    const b=canonicalTransportVideo(annex(mutate(all)),'annexb',admitted,true); assert.notEqual(a.sha256,b.sha256);
  }
  const changed=all.map(n=>Buffer.from(n)); changed[1][4]^=1;
  assert.throws(()=>canonicalTransportVideo(annex(changed),'annexb',admitted,true),{code:'REMUX_TS_PARAMETER_CHANGE'});
  assert.throws(()=>canonicalTransportVideo(annex([Buffer.from([65,128])]),'annexb',admitted,true),{code:'REMUX_TS_HEAD_NOT_KEYFRAME'});
});
function adts(payload=Buffer.from([1,2,3])) { const n=payload.length+7;return Buffer.concat([Buffer.from([255,241,76,64|(n>>11),(n>>3)&255,((n&7)<<5)|31,252]),payload]); }
test('ADTS payload identity and configuration mutants',()=>{
  const a=adts(), s={channels:1}, asc=Buffer.from([17,136]); const parsed=canonicalTransportAudio(a,'adts',asc,s);
  assert.deepEqual(parsed.data,Buffer.from([1,2,3]));assert.equal(parsed.sha256,canonicalTransportAudio(parsed.data,'raw',asc,s).sha256);
  const b=Buffer.from(a);b[b.length-1]^=1;assert.notEqual(parsed.sha256,canonicalTransportAudio(b,'adts',asc,s).sha256);
  const changed=Buffer.from(a);changed[2]^=4;assert.throws(()=>canonicalTransportAudio(changed,'adts',asc,s),{code:'REMUX_TS_ADTS_CONFIG'});
  for(const [at,mask] of [[1,8],[2,2],[3,4],[3,8],[3,16],[3,32]]){const b=Buffer.from(a);b[at]|=mask;
    assert.throws(()=>canonicalTransportAudio(b,'adts',asc,s),{code:'REMUX_TS_ADTS_CONFIG'});}
  const crc=Buffer.from(a);crc[1]&=254;assert.throws(()=>canonicalTransportAudio(crc,'adts',asc,s),{code:'REMUX_TS_ADTS_CRC'});
  const multi=Buffer.from(a);multi[6]|=1;assert.throws(()=>canonicalTransportAudio(multi,'adts',asc,s),{code:'REMUX_TS_ADTS_FRAME'});
  assert.throws(()=>canonicalTransportAudio(a.subarray(0,8),'adts',asc,s),{code:'REMUX_TS_ADTS_FRAME'});
  assert.throws(()=>canonicalTransportAudio(a,'untrusted',asc,s),{code:'REMUX_TS_AAC_FRAMING'});
  assert.throws(()=>canonicalTransportAudio(a,'raw',Buffer.alloc(0),s),{code:'REMUX_TS_AAC_FRAMING'});
});
test('TS clock refuses missing, backwards, wrap and audio gaps with specific codes',()=>{
  const s={codec_type:'video',time_base:'1/90000'};const clock=transportClock(s);clock({pts:9000,dts:6000});
  assert.throws(()=>clock({pts:12000}),{code:'REMUX_TS_TIMESTAMPS_MISSING'});
  assert.throws(()=>clock({pts:12000,dts:5999}),{code:'REMUX_TS_DTS_BACKWARDS'});
  assert.throws(()=>clock({pts:8589934592,dts:8589934592}),{code:'REMUX_TS_TIMESTAMP_WRAP'});
  assert.throws(()=>transportClock({...s,time_base:'1/1000'})({pts:0,dts:0}),{code:'REMUX_TS_TIME_BASE'});
  const audio=transportClock({...s,codec_type:'audio'});audio({pts:0,dts:0});assert.throws(()=>audio({pts:2000,dts:2000}),{code:'REMUX_TS_DISCONTINUITY'});
});
test('NAL framing and packet dump bounds fail closed',()=>{
  for(const value of [Buffer.from([1]),Buffer.from([0,0,1]),Buffer.from([0,0,0,10,1])]) assert.throws(()=>transportNals(value,'avcc'),{code:'REMUX_TS_NAL_FRAMING'});
  assert.throws(()=>dumpBytes('\n00000001: 00                                      .\n',1),{code:'REMUX_TS_PACKET_BYTES'});
  for(const value of [{valueOf(){throw Error('must not coerce');}},'0x20','1e3',NaN,8388609])
    assert.throws(()=>dumpBytes('',value),{code:'REMUX_TS_PACKET_BYTES'});
});
test('exact packet timing catches a shifted timestamp and changed A/V offset',async()=>{
  const row={packetIndex:0,size:'1',hash:'a'.repeat(64),key:true,discard:false,sideSha256:'b'.repeat(64),pts:{numerator:'1',denominator:'1'},dts:{numerator:'1',denominator:'1'},duration:{numerator:'1',denominator:'30'}};
  async function* rows(v){yield v;}
  for(const field of ['pts','dts']){const changed=structuredClone(row);changed[field]={numerator:'90001',denominator:'90000'};
    await assert.rejects(compareRemuxPackets(1,1,rows(row),rows(changed),{exactTiming:true}),{code:'REMUX_TS_PACKET_IDENTITY'});}
});
test('raw transport refuses framing, discontinuity, continuity loss and partial head',()=>{
  const streams=[{id:'0x100'}],packet=Buffer.alloc(188,255);packet.set([71,1,0,16]);
  assert.throws(()=>createTransportIntegrity([{id:'unknown'}]),{code:'REMUX_TS_PID'});
  assert.throws(()=>createTransportIntegrity(streams).push(packet),{code:'REMUX_TS_PARTIAL_HEAD'});
  const corrupt=Buffer.from(packet);corrupt[0]=0;assert.throws(()=>createTransportIntegrity(streams).push(corrupt),{code:'REMUX_TS_FRAMING'});
  for(const [at,mask] of [[1,128],[3,64],[3,128]]){const b=Buffer.from(packet);b[at]|=mask;
    assert.throws(()=>createTransportIntegrity(streams).push(b),{code:'REMUX_TS_FRAMING'});}
  const adaptation=Buffer.from(packet);adaptation[3]=32;adaptation[4]=182;
  assert.throws(()=>createTransportIntegrity(streams).push(adaptation),{code:'REMUX_TS_FRAMING'});
  const discontinuous=Buffer.from(packet);discontinuous[3]=48;discontinuous[4]=1;discontinuous[5]=128;
  assert.throws(()=>createTransportIntegrity(streams).push(discontinuous),{code:'REMUX_TS_DISCONTINUITY'});
  const other=Buffer.from(packet);other[1]=0;other[2]=32;const checker=createTransportIntegrity(streams);checker.push(other);
  assert.throws(()=>checker.push(other),{code:'REMUX_TS_CONTINUITY'});
  const truncated=createTransportIntegrity(streams);truncated.push(Buffer.from([71]));assert.throws(()=>truncated.finish(),{code:'REMUX_TS_FRAMING'});
});
test('hostile 8 MiB Annex B and AVCC packets stop before allocating excess NAL views',()=>{
  for(const framing of ['annexb','avcc']){
    const data=Buffer.alloc(8*1024*1024);data.fill(framing==='annexb'?Buffer.from([0,0,1,9]):Buffer.from([0,0,0,1,9]));
    let views=0,furthest=0,reads=0;const sub=data.subarray,read=data.readUIntBE;
    data.subarray=function(a,b){views++;furthest=Math.max(furthest,b??data.length);return sub.call(this,a,b);};
    data.readUIntBE=function(a,n){reads++;furthest=Math.max(furthest,a+n);return read.call(this,a,n);};
    assert.throws(()=>transportNals(data,framing),{code:'REMUX_TS_NAL_LIMIT'});
    assert.ok(views<=1025&&reads<=1024&&furthest<8192,JSON.stringify({views,reads,furthest}));
  }
});
test('PCR base/extension are monotonic, bounded and tied to the declared PID and PES clock',()=>{
  const streams=[{id:'0x100',codec_type:'video'}],programs=[{pmt_pid:4096,pcr_pid:256}];
  const pcr=(base,extension=0,pid=256)=>{const b=Buffer.alloc(188,255);b.set([71,pid>>8,pid&255,32,183,16]);const v=BigInt(base);
    b[6]=Number(v>>25n);b[7]=Number(v>>17n&255n);b[8]=Number(v>>9n&255n);b[9]=Number(v>>1n&255n);
    b[10]=Number(v&1n)*128+126+(extension>>8);b[11]=extension&255;return b;};
  const check=createTransportIntegrity(streams,programs);check.push(pcr(90000,1));check.push(pcr(90000,299));check.push(pcr(90001));check.push(pcr(180001));
  for(const [values,code] of [
    [[pcr(90000),pcr(89999)],'REMUX_TS_PCR_BACKWARDS'],[[pcr(90000),pcr(180001)],'REMUX_TS_PCR_DISCONTINUITY'],
    [[pcr(8589934591n,299),pcr(0)],'REMUX_TS_PCR_WRAP'],[[pcr(90000,300)],'REMUX_TS_PCR_INVALID'],
    [[pcr(90000,0,257)],'REMUX_TS_PCR_PID'],
  ])assert.throws(()=>{const c=createTransportIntegrity(streams,programs);for(const b of values)c.push(b);},{code});
  const bad=pcr(90000);bad[10]&=~2;assert.throws(()=>createTransportIntegrity(streams,programs).push(bad),{code:'REMUX_TS_PCR_INVALID'});
  assert.throws(()=>createTransportIntegrity(streams,[{pmt_pid:4096,pcr_pid:8191}]),{code:'REMUX_TS_PCR_PID'});
  const pes=Buffer.alloc(188,255);pes.set([71,65,0,16,0,0,1,224,0,0,128,128,5,33,0,1,0,1]);
  const mismatch=createTransportIntegrity(streams,programs);mismatch.push(pcr(1800000));
  assert.throws(()=>mismatch.push(pes),{code:'REMUX_TS_PCR_PES_MISMATCH'});
  const table=(pid,id)=>{const b=Buffer.alloc(188,255);b.set([71,64|(pid>>8),pid&255,16,0,id,176,9,0,1,193,0,0,0,0,0,0]);return b;};
  const missing=createTransportIntegrity(streams,programs);missing.push(Buffer.concat([table(0,0),table(4096,2),pes]));
  assert.throws(()=>missing.finish(),{code:'REMUX_TS_PCR_MISSING'});
});
test('review PCR XOR 0x40 mutant and a source changed during preparation are refused',async t=>{
  const f=await fixture(t),bytes=await fs.readFile(f.file);let count=0;
  for(let at=0;at+188<=bytes.length;at+=188)if((bytes[at+3]&32)&&bytes[at+4]>=7&&(bytes[at+5]&16))if(++count===3)bytes[at+6]^=64;
  assert.ok(count>=3);const changed=path.join(f.dir,'pcr-jump.ts');await fs.writeFile(changed,bytes,{flag:'wx'});
  await assert.rejects(prepare({...f,file:changed,identity:await readSourceIdentity(changed)}),{code:'REMUX_TS_PCR_DISCONTINUITY'});
  await assert.rejects(prepare(f,async(file,args,opts)=>{const r=await runTool(file,args,opts);await fs.appendFile(f.file,Buffer.alloc(188));return r;}),{code:'REMUX_TS_SOURCE_CHANGED'});
});
test('each TS source-envelope refusal has a named reason for the window', async t => {
  const f = await fixture(t);
  const cases = [
    ['REMUX_TS_PROGRAM', p => { p.programs=[];p.format.nb_programs=0; }],
    ['REMUX_TS_VIDEO_COUNT', p => { const v=structuredClone(p.streams[0]);v.index=2;v.disposition.default=0;p.streams[0].disposition.default=1;p.streams.push(v); }],
    ['REMUX_TS_VIDEO_CODEC', p => { p.streams[0].codec_name='hevc'; }],
    ['REMUX_TS_VIDEO_CODEC', p => { p.streams[0].codec_name='mpeg2video'; }],
    ['REMUX_TS_INTERLACED', p => { p.streams[0].field_order='tt'; }],
    ['REMUX_TS_VIDEO_PRECISION', p => { p.streams[0].pix_fmt='yuv420p10le'; }],
    ['REMUX_TS_SDR', p => { p.streams[0].color_transfer='smpte2084'; }],
    ...['ac3','mp2','aac_latm'].map(codec=>['REMUX_TS_AUDIO_CODEC',p=>{p.streams[1].codec_name=codec;}]),
    ['REMUX_TS_AUDIO_CODEC',p=>{p.streams[1].profile='HE-AAC';}],
    ['REMUX_TS_AUDIO_LAYOUT',p=>{p.streams[1].sample_rate='44100';}],
    ['REMUX_TS_AUDIO_LAYOUT',p=>{p.streams[1].channels=6;p.streams[1].channel_layout='5.1';}],
    ...[['subtitle','dvb_teletext'],['subtitle','dvb_subtitle'],['data','scte_35'],['data','bin_data']].map(([type,codec])=>
      ['REMUX_TS_OTHER_STREAM',p=>{p.streams.push({index:2,codec_type:type,codec_name:codec});}]),
    ['REMUX_TS_SERVICE_METADATA',p=>{p.format.tags={service_name:'one'};p.programs[0].tags={service_name:'two'};}],
    ['REMUX_TS_RELATIONSHIPS',p=>{p.chapters=[{id:0,time_base:'1/90000',start:0,end:9000}];}],
  ];
  for(const [code,mutate] of cases){ const p=structuredClone(f.raw);mutate(p);p.format.nb_streams=p.streams.length;
    if(p.programs.length===1){p.programs[0].nb_streams=p.streams.length;p.programs[0].streams=p.streams.map(s=>({index:s.index}));}
    const a=assessRemux({request,probe:p,sourceFingerprint:'a'.repeat(64)});
    assert.ok(a.blockers.some(b=>b.code===code&&b.message.length>15),code);
  }
  for(const [r,code] of [[{...request,target:'matroska'},'REMUX_TS_TARGET'],[{...request,omissionRequestIds:['fake']},'REMUX_TS_OMISSION']])
    assert.ok(assessRemux({request:r,probe:f.raw,sourceFingerprint:'a'.repeat(64)}).blockers.some(b=>b.code===code));
});
test('TS audio clocks cannot round onto a different MP4 sample grid',()=>{
  assert.throws(()=>transportClock({codec_type:'audio',time_base:'1/90000'})({pts:1,dts:1}),{code:'REMUX_TS_AUDIO_CLOCK'});
});
test('raw program-table and partial audio head guards refuse their own mutants',()=>{
  const streams=[{id:'0x100',codec_type:'video'}],programs=[{pmt_pid:4096,pcr_pid:256}];
  const table=(pid,id,cc=0)=>{const b=Buffer.alloc(188,255);b.set([71,64|(pid>>8),pid&255,16|cc,0,id,176,9,0,1,193,0,0,0,0,0,0]);return b;};
  assert.throws(()=>createTransportIntegrity(streams,[{pmt_pid:256}]),{code:'REMUX_TS_PROGRAM'});
  const check=createTransportIntegrity(streams,programs);check.push(table(0,0));check.push(table(4096,2));
  const changed=table(4096,2,1);changed[10]=195;assert.throws(()=>check.push(changed),{code:'REMUX_TS_PROGRAM_CHANGED'});
  const bad=table(0,0);bad[4]=255;assert.throws(()=>createTransportIntegrity(streams,programs).push(bad),{code:'REMUX_TS_PSI'});
  const pes=Buffer.alloc(188,255);pes.set([71,65,0,16,0,0,1,192,0,0,128,128,5,33,0,1,0,1]);
  assert.throws(()=>createTransportIntegrity([{id:'0x100',codec_type:'audio'}]).push(pes),{code:'REMUX_TS_PARTIAL_AUDIO_HEAD'});
  const malformed=Buffer.from(pes);malformed[6]=0;assert.throws(()=>createTransportIntegrity([{id:'0x100'}]).push(malformed),{code:'REMUX_TS_PES'});
});
test('source header sniff and full preparation refuse a generated cut before any output',async t=>{
  const f=await fixture(t),cut=path.join(f.dir,'cut.ts');
  const {cutTransportFixture,hashFile}=require('../scripts/v07-remux-long-fixtures.cjs');
  await cutTransportFixture(f.file,cut,await hashFile(f.file));
  const {inspectTransportHead}=require('../src/remux-transport.cjs');
  await assert.rejects(inspectTransportHead(cut),{code:'REMUX_TS_HEAD_NOT_KEYFRAME'});
  const cutFacts={...f,file:cut,identity:await readSourceIdentity(cut)};
  await assert.rejects(prepare(cutFacts),{code:'REMUX_TS_HEAD_NOT_KEYFRAME'});
  assert.deepEqual((await fs.readdir(f.dir)).sort(),['cut.ts','input.ts']);
});
test('preparation cancellation, foreign stamps and untrusted demux diagnostics never grant authority',async t=>{
  const f=await fixture(t),controller=new AbortController();controller.abort();await assert.rejects(prepare(f,runTool,controller.signal),{code:'CANCELLED'});
  const token=await prepare(f),{getTransportPreparation}=require('../src/remux-transport-evidence.cjs');
  assert.throws(()=>getTransportPreparation(token,f.file,f.raw,{}),{code:'REMUX_TS_PREPARATION_REQUIRED'});
  await assert.rejects(prepare(f,async(file,args,opts)=>({...await runTool(file,args,opts),stderr:'transport warning'})),{code:'REMUX_TS_DEMUX'});
});
test('real service offers ready MP4 for production TS and exposes the injected empty-evidence refusal through IPC',async t=>{
  const f=await fixture(t),{EncoderService}=require('../src/encoder-service.cjs');
  for(const qualified of [false,true]){
    const output=await temp(t),service=new EncoderService({ffmpeg,ffprobe,stateDir:path.join(output,'state'),run:runTool,
      runtimeIdentity,inspectionCache:null,storageEligibility:{check:async()=>({eligible:false,reason:'unit'})},
      capabilities:async()=>{throw Error('Remux must not initialize encoders');},remuxOperations:owner(qualified),
      operationEvidenceBudget:EVIDENCE_BUDGET,operationDeadlineMs:EXECUTION_BUDGET_MS,
      operationRuntime:{observe:async()=>Object.freeze({}),snapshot:()=>({runtimeIdentity,environment:null}),close:async()=>{}},
      operationStorage:()=>{throw Error('No execution storage before Start');}});
    t.after(async()=>{await service.cancelCurrent();await service.closeOperationResources();await service.closeDiagnostics();});
    const a=await service.registerFolder(f.dir,'input'),b=await service.registerFolder(output,'output');
    await service.prepareRemuxBatch({inputFolderId:a.id,outputFolderId:b.id,target:'mp4'});await service.taskPromise;
    const snapshot=service.snapshot(),item=snapshot.items.find(i=>i.name==='input.ts');
    assert.ok(snapshot.remuxSupport.targets.includes('mp4'));
    assert.equal(item.status,qualified?'ready':'unsupported',item.reason);
    if(!qualified){assert.equal(item.reasonCode,'REMUX_QUALIFICATION_REQUIRED');assert.match(item.reason,/awaits measured route evidence/);
      assert.throws(()=>service.startBatch({planId:snapshot.planId,fileIds:[item.id]}),{code:'INVALID_SELECTION'});}
    assert.ok(!JSON.stringify(snapshot).includes('main-owned-ts-packet-preparation'));
  }
});
test('concurrent TS preparation serializes the observed runtime and holds each child through close',async t=>{
  const f=await fixture(t),second=path.join(f.dir,'second.ts');await fs.copyFile(f.file,second,require('node:fs').constants.COPYFILE_EXCL);
  const output=await temp(t),{EncoderService}=require('../src/encoder-service.cjs');let active=0,calls=0;
  const service=new EncoderService({ffmpeg,ffprobe,stateDir:path.join(output,'state'),runtimeIdentity,inspectionCache:null,
    storageEligibility:{check:async()=>({eligible:false,reason:'unit'})},remuxOperations:owner(),
    operationEvidenceBudget:EVIDENCE_BUDGET,operationDeadlineMs:EXECUTION_BUDGET_MS,operationStorage:()=>{throw Error('before Start');},
    operationRuntime:{observe:async()=>{assert.equal(active,0);return Object.freeze({});},snapshot:()=>({runtimeIdentity,environment:null}),close:async()=>{},
      async invoke(token,tool,args,opts){assert.equal(tool,'ffprobe');assert.equal(active,0);active++;calls++;
        try{return await runTool(ffprobe,args,opts);}finally{active--;}}}});
  try{const a=await service.registerFolder(f.dir,'input'),b=await service.registerFolder(output,'output');
    await service.prepareRemuxBatch({inputFolderId:a.id,outputFolderId:b.id,target:'mp4'});await service.taskPromise;
    const s=service.snapshot();assert.equal(s.items.length,2);assert.ok(s.items.every(i=>i.status==='ready'),JSON.stringify(s.items));assert.equal(calls,2);assert.equal(active,0);
  }finally{await service.cancelCurrent();await service.closeOperationResources();await service.closeDiagnostics();}
});
test('TS policy and required track tags cannot widen the measured source envelope',async t=>{
  assert.throws(()=>new RemuxOperations({runtimeIdentity,policyIdentity:'unit',policies:[{...route,allowRotation90:true,evidenceIds:['unit']}]}),{code:'INVALID_REMUX_OPERATION'});
  const f=await fixture(t);f.raw.streams[0].tags={BPS:'1000'};
  const a=assessRemux({request,probe:f.raw,sourceFingerprint:fingerprintRemuxSourceIdentity(f.identity)});
  assert.throws(()=>owner().prepare({assessment:a,request,input:f.file,output:path.join(f.dir,'no.mp4'),outputId:randomUUID(),sourceIdentity:f.identity}),{code:'REMUX_TRACK_TAG_UNREPRESENTABLE'});
});
test('transport budget overflow and an idle preparation refuse without a grant',async t=>{
  const f=await fixture(t),{scanTransportPackets}=require('../src/remux-transport-evidence.cjs');let invocations=0;
  await assert.rejects(scanTransportPackets({file:f.file,probe:f.raw,budget:{maxRecords:10000,maxDurationSeconds:10,
    maxOutputBytes:Number.MAX_SAFE_INTEGER,maxTextBytes:1},invoke:async()=>{invocations++;}}),{code:'REMUX_PROPORTIONAL_BUDGET'});
  assert.equal(invocations,0);
  const interval=global.setInterval,clear=global.clearInterval,now=Date.now;let tick,clock=now();
  global.setInterval=callback=>{tick=callback;return{unref(){}};};global.clearInterval=()=>{};Date.now=()=>clock;
  try {await assert.rejects(prepare(f,async(_file,_args,options)=>{clock+=120001;tick();assert.equal(options.signal.aborted,true);
    throw Object.assign(Error('aborted'),{code:'CANCELLED'});}),{code:'REMUX_TS_STALLED'});}
  finally{global.setInterval=interval;global.clearInterval=clear;Date.now=now;}
});
