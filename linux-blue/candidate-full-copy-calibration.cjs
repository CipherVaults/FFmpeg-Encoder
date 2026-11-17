'use strict';
// Developer laboratory only. Importing this module launches nothing. No CLI,
// production factory, caller qualifications, publication or catalog activation.
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { requireCandidateCalibrationRuntime } = require('./candidate-calibration-runtime.cjs');
const { OperationFamilySelector } = require('../src/operation-family.cjs');
const { FULL_COPY_FAMILY_ID, FULL_COPY_RESOURCE_POLICY, deriveCfrFullResizeCopyResources } = require('../src/operation-resource-budget.cjs');
const { collectOperationEvidence, compactRow, lineSink, evidenceFailure } = require('../src/operation-evidence.cjs');
const { inspectInput, inspectMetadata } = require('../src/inspection.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { resolveFileRequest } = require('../src/operation-contract.cjs');
const { buildEncodeOperation, withEncodeOperationTelemetry, resolveEncodeOperationInvocation, fingerprintEncodeSource,
  validateEncodeOperationTelemetry, validateEncodeOperationOutput } = require('../src/encode-operation.cjs');
const { createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { createStage, sealStage, retainSealedStage } = require('../src/outputs.cjs');
const { generationDescriptionOf } = require('../src/provenance.cjs');
const { PROFILES, describeRecipe } = require('../src/media.cjs');
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const SETTINGS = freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const FROZEN = freeze({ classification: 'preregistered-unmeasured; not production qualification',
  sourceVideoClock: '1/15360', sourceAudioClock: '1/48000', outputClock: '1/1000',
  containerDuration: 'matroska-copy-end-plus-codec-delay',
  tolerances: { videoTimestampUs: 1067, audioTimestampUs: 1042, avSyncUs: 2109, durationUs: 1088, sampleCount: 0 },
  videoDurationUs: 1067, audioTimelineUs: 1042,
  rationale: 'Video: source tick + output millisecond +1us; audio: source tick + source sample + output millisecond. Exact copied sample count. Container max(video end, copied decoded audio end plus its own observed delay). No fitted shift or terminal coding allowance.',
  sourceCriterion: 'Zero origin; complete CFR/properties/continuous samples; exact metadata-versus-decoded ends. AAC priming/padding relation unresolved. Failure stops before target.' });
const SPECS = freeze([{ id: 'short-mp4', seconds: 8, extension: 'mp4', flip: false, frequency: 440 },
  { id: 'long-mov', seconds: 150, extension: 'mov', flip: false, frequency: 683 },
  { id: 'heldout-mp4', seconds: 11, extension: 'mp4', flip: true, frequency: 997 }]);
const LIMITS = freeze({ children: 128, overallMs: 1800000, caseMs: 480000, childMs: 300000, generationMs: 180000,
  minFreeBytes: 27 * 1024 ** 3, ownedBytes: 2 * 1024 ** 3, fileBytes: 512 * 1024 ** 2, reportBytes: 32 * 1024 ** 2 });
const sha = b => createHash('sha256').update(b).digest('hex');
const fault = (message, code = 'FULL_COPY_SOURCE_DIAGNOSTIC') => { throw Object.assign(new Error(message), { code }); };
function integer(x) { const s = String(x); if (!/^-?\d{1,19}$/.test(s)) fault('Exact integer observation required.'); return BigInt(s); }
function rat(n, d = 1n) { n = BigInt(n); d = BigInt(d); if (d <= 0n) fault('Positive rational denominator required.'); let a = n < 0n ? -n : n, b = d; while (b) [a, b] = [b, a % b]; return { n: n / (a || 1n), d: d / (a || 1n) }; }
const add = (a, b) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const sub = (a, b) => rat(a.n * b.d - b.n * a.d, a.d * b.d);
const cmp = (a, b) => a.n * b.d - b.n * a.d;
const packed = r => ({ n: String(r.n), d: String(r.d) });
const unpack = r => rat(r.n, r.d);
function tick(stream) { const m = /^([1-9]\d*)\/([1-9]\d*)$/.exec(stream.time_base); if (!m) fault('Observed clock required.'); return rat(m[1], m[2]); }
const at = (n, t) => rat(n * t.n, t.d);
async function fileReceipt(file) { const s = await fs.lstat(file); assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.size <= LIMITS.fileBytes); const h = createHash('sha256'); for await (const b of createReadStream(file)) h.update(b); const after = await fs.lstat(file); for (const key of ['dev','ino','size','mtimeMs','ctimeMs']) assert.equal(after[key],s[key], 'File changed while hashing: '+key); return { path: file, bytes: s.size, sha256: h.digest('hex') }; }
async function ownedBytes(root) { let n = 0; for (const e of await fs.readdir(root, { withFileTypes: true })) { const p = path.join(root, e.name); assert.ok(!e.isSymbolicLink()); if (e.isDirectory()) n += await ownedBytes(p); else { const s = await fs.lstat(p); assert.ok(s.isFile()); n += s.size; } } return n; }
async function writeJson(file, value) { const b = Buffer.from(JSON.stringify(value, null, 2)); assert.ok(b.length <= LIMITS.reportBytes); await fs.writeFile(file, b, { flag: 'wx' }); }
async function persistFinalReport(root, report) {
  const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= LIMITS.reportBytes);
  const file = path.join(root, 'report.json'); await fs.writeFile(file, bytes, { flag: 'wx' });
  const actual = await fs.readFile(file); assert.deepEqual(actual, bytes); assert.deepEqual(JSON.parse(actual), report);
  return { path: file, bytes: actual.length, sha256: sha(actual), readbackVerified: true };
}
// Independent bounded raw observations. Never a fabricated completed collector
// receipt, never private family authority. Source and output have separate files.
async function scanDiagnostics({ file, probe, directory, ffprobe, run, budget, source, signal }) {
  const result = { collectorAuthority: false, source, file, files: [] };
  const streams = ['video', 'audio'].map(kind => { const s = probe.streams.filter(s => s.codec_type === kind); assert.equal(s.length, 1); return s[0]; });
  const guards = ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm'];
  async function scan(label, args, onLine) {
    const destination = path.join(directory, label + '.compact'); const fd = await fs.open(destination, 'wx');
    const sink = lineSink(onLine, { maxBytes: budget.maxFrameBytes, maxRecords: budget.maxRecords, signal }); let bytes = 0;
    try {
      await run(ffprobe, args, { signal, timeoutMs: budget.timeoutMs, onStdoutChunk: async chunk => {
        // Retain the rejected chunk only up to the frozen byte cap;
        // never let a hostile stream write without its byte ceiling.
        const room = Math.max(0, budget.maxFrameBytes - bytes); const kept = chunk.subarray(0, room);
        let pos = 0; while (pos < kept.length) { const w = await fd.write(kept, pos, kept.length - pos); assert.ok(w.bytesWritten); pos += w.bytesWritten; } bytes += kept.length;
        await sink.push(chunk);
      } });
      const capture = await sink.finish(); await fd.sync(); result.files.push({ label, path: destination, bytes, sha256: capture.sha256, records: capture.records });
    } catch (error) { error.diagnosticPartial = { label, path: destination, retainedBytes: bytes, facts: result }; throw error; }
    finally { await fd.close(); }
  }
  for (const stream of streams) {
    const kind = stream.codec_type, t = tick(stream); let first = null, end = null, count = 0, samples = 0n, gaps = 0, cadence = true;
    const allowed = ['media_type','stream_index','pts','duration','pkt_duration','nb_samples','sample_fmt','channels','channel_layout','width','height','pix_fmt','interlaced_frame','color_range','color_space','color_primaries','color_transfer','sample_aspect_ratio','chroma_location','side_data_type'];
    await scan(kind, [...guards, '-select_streams', String(stream.index), '-show_frames', '-show_entries', 'frame=' + allowed.filter(k => k !== 'side_data_type').join(',') + ':frame_tags=:frame_side_data=side_data_type', '-of', 'compact=p=1:nk=0:escape=c', '-i', file], line => {
      const row = compactRow(line, 'frame', allowed); assert.equal(row.media_type, kind); assert.equal(integer(row.stream_index), BigInt(stream.index));
      const start = at(integer(row.pts), t); first ||= start;
      if (kind === 'video') {
        for (const key of ['width','height','pix_fmt','color_range','color_space','color_primaries','color_transfer']) assert.equal(row[key], String(stream[key]));
        assert.equal(row.interlaced_frame, '0');
        if (source) { assert.equal(row.sample_aspect_ratio, '1:1'); assert.equal(row.chroma_location, 'left'); assert.ok(row.side_data_type === undefined || row.side_data_type === 'H.26[45] User Data Unregistered SEI message'); }
        const duration = integer(row.duration ?? row.pkt_duration); assert.ok(duration > 0n); if (row.duration !== undefined && row.pkt_duration !== undefined) assert.equal(row.duration, row.pkt_duration);
        if (source) { const diff = sub(start, rat(BigInt(count), 30n)), dur = sub(at(duration,t), rat(1n,30n)); cadence &&= (diff.n < 0n ? -diff.n : diff.n)*t.d <= t.n*diff.d && (dur.n < 0n ? -dur.n : dur.n)*t.d <= t.n*dur.d; }
        end = add(start, at(duration,t));
      } else {
        assert.equal(row.sample_fmt, stream.sample_fmt); assert.equal(row.channels, String(stream.channels)); assert.equal(row.channel_layout, stream.channel_layout);
        const n = integer(row.nb_samples); assert.ok(n > 0n && n <= 2147483647n); if (end && cmp(start,end) !== 0n) gaps++;
        samples += n; end = add(start, rat(n, integer(stream.sample_rate)));
      }
      count++; result[kind] = { frames: count, samples: String(samples), first: packed(first), end: packed(end), gaps, cadence, metadata: { startPts: String(stream.start_pts), durationTs: String(stream.duration_ts), timeBase: stream.time_base } };
    });
    assert.ok(count > 0);
  }
  const audio = streams[1]; let packets = 0, firstPacket, lastPacket;
  const payload = createHash('sha256'), padding = createHash('sha256');
  await scan('packets', [...guards, '-select_streams', String(audio.index), '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=stream_index,pts,duration,data_hash:packet_tags=:packet_side_data=side_data_type,skip_samples,discard_padding', '-of', 'compact=p=1:nk=0:escape=c', '-i', file], line => {
    const row = compactRow(line,'packet',['stream_index','pts','duration','data_hash','side_data_type','skip_samples','discard_padding']); assert.equal(integer(row.stream_index),BigInt(audio.index)); integer(row.pts); assert.ok(integer(row.duration)>0n); assert.match(row.data_hash,/^SHA256:[a-f0-9]{64}$/i);
    const hasPadding = ['side_data_type','skip_samples','discard_padding'].some(k=>Object.hasOwn(row,k));
    if(hasPadding){assert.equal(row.side_data_type,'Skip Samples');assert.ok(integer(row.skip_samples)>=0n && integer(row.discard_padding)>=0n);}
    payload.update(row.data_hash.slice(7).toLowerCase()+'\n');padding.update(`${packets}:${hasPadding ? row.skip_samples+','+row.discard_padding : '-'}\n`); firstPacket ||= row;lastPacket=row;packets++;
  });
  let header;
  await scan('header',[...guards,'-select_streams',String(audio.index),'-show_streams','-show_data_hash','sha256','-show_entries','stream=index,extradata_hash:stream_tags=:stream_disposition=','-of','compact=p=1:nk=0:escape=c','-i',file],line=>{const row=compactRow(line,'stream',['index','extradata_hash']);assert.equal(header,undefined);assert.equal(integer(row.index),BigInt(audio.index));assert.match(row.extradata_hash,/^SHA256:[a-f0-9]{64}$/i);header=row.extradata_hash.slice(7).toLowerCase();});
  assert.ok(packets>0 && header); result.packets={count:packets,payloadSha256:payload.digest('hex'),paddingSha256:padding.digest('hex'),headerSha256:header,first:firstPacket,last:lastPacket,timeBase:audio.time_base};return result;
}
function assertStrictSourceDiagnostics(diagnostic, probe) {
  for (const kind of ['video','audio']) {
    const s=probe.streams.find(x=>x.codec_type===kind),d=diagnostic[kind],t=tick(s);
    const metadataEnd=at(integer(s.duration_ts),t), observed=unpack(d.end);
    if(integer(s.start_pts)!==0n || unpack(d.first).n!==0n || cmp(metadataEnd,observed)!==0n || d.gaps!==0 || !d.cadence)
      fault(`Strict Full-copy ${kind} metadata/decoded extent, origin or cadence mismatch. AAC priming/padding remains unqualified; no target encode.`);
    if(kind==='video' && cmp(observed,rat(BigInt(d.frames),30n))!==0n)fault('Complete video count/extent mismatch.');
    if(kind==='audio' && cmp(observed,rat(d.samples,48000n))!==0n)fault('Complete audio sample/extent mismatch.');
  }
  return true;
}
function selectorFor(id, runtimeIdentity) {
  const qualification={evidenceId:id+':endpoints',runtimeIdentity,containerDuration:FROZEN.containerDuration,tolerances:{...FROZEN.tolerances}};
  const timingQualification={evidenceId:id+':interior',runtimeIdentity,videoDurationUs:FROZEN.videoDurationUs,audioTimelineUs:FROZEN.audioTimelineUs,aac:null};
  return new OperationFamilySelector({policyIdentity:id,families:[{id:FULL_COPY_FAMILY_ID,resourcePolicy:FULL_COPY_RESOURCE_POLICY,settings:SETTINGS,runtimeIdentity,environment:null,qualification,timingQualification,evidenceIds:[qualification.evidenceId,timingQualification.evidenceId]}]});
}
async function runCandidateFullCopyCampaign(options) {
  assert.ok(options && Object.getPrototypeOf(options)===Object.prototype);assert.deepEqual(Reflect.ownKeys(options),['verifiedRuntime']);assert.ok(Object.hasOwn(Object.getOwnPropertyDescriptor(options,'verifiedRuntime'),'value'));
  const runtime=requireCandidateCalibrationRuntime(options.verifiedRuntime);let root;
  try { await runtime.requireCurrent(); const base=path.join(__dirname,'artifacts');await fs.mkdir(base,{recursive:true});root=await fs.mkdtemp(path.join(base,'candidate-full-copy-calibration-')); }
  catch(error){try{await runtime.close();}catch(closeError){throw new AggregateError([error,closeError],'Campaign setup and runtime close failed');}throw error;}
  const report={schema:1,root,status:'preparing',runtimeIdentity:runtime.runtimeIdentity,pins:runtime.pins,dependencies:runtime.dependencies,frozen:FROZEN,specs:SPECS,limits:LIMITS,settings:SETTINGS,publicationAuthorized:false,catalogActivated:false,cases:[],children:[],census:{spawned:0,closed:0,live:0,maximum:0},pipeBytes:0};
  const controller=new AbortController(),started=Date.now(),monotonicStart=process.hrtime.bigint(),timer=setTimeout(()=>controller.abort(),LIMITS.overallMs);let current,activeCase,sourceIdentity,selector,selection,bindings,telemetry,stage,caseDeadline,childBusy=false;
  const invoke=runtime.createRunner({onChild(child){assert.ok(current);current.spawned=true;current.pid=child.pid ?? null;const c=report.census;c.spawned++;c.live++;c.maximum=Math.max(c.maximum,c.live);const row=current;child.once('close',(code,signal)=>{c.closed++;c.live--;row.closed=true;row.exitCode=code;row.signal=signal;});}});
  async function sourceCurrent(){await runtime.requireCurrent();if(sourceIdentity)assert.deepEqual(await readSourceIdentity(sourceIdentity.canonicalPath),sourceIdentity);if(selection)selector.requireCurrent(bindings.token,bindings.value);}
  async function run(executable,args,opts={}) {
    assert.equal(childBusy,false);childBusy=true;let row,result,failure,ended=false;
    try{
      await sourceCurrent();assert.ok(!controller.signal.aborted && report.census.spawned<LIMITS.children && report.census.live===0);
      const space=await fs.statfs(root,{bigint:true});assert.ok(space.bavail*space.bsize>=BigInt(LIMITS.minFreeBytes));assert.ok(await ownedBytes(root)<=LIMITS.ownedBytes);
      const remaining=Math.min(LIMITS.overallMs-(Date.now()-started),(caseDeadline||Infinity)-Date.now());assert.ok(remaining>0);
      row=current={index:report.children.length+1,executable,args:[...args],startedAt:new Date().toISOString(),spawned:false};report.children.push(row);
      result=await invoke(executable,args,{...opts,timeoutMs:Math.min(opts.timeoutMs||LIMITS.childMs,LIMITS.childMs,remaining),stdoutLimit:16*1024**2,stderrLimit:256*1024,signal:AbortSignal.any([controller.signal,...(opts.signal?[opts.signal]:[])]),...(args.includes('-progress')?{onProgress(v){ended ||= v.ended===true;opts.onProgress?.(v);}}:{}),onOutputBytes(v){report.pipeBytes+=v.bytes;if(activeCase){activeCase.pipeBytes+=v.bytes;assert.ok(activeCase.pipeBytes<=activeCase.diagnosticAndOperationPipeLimit);}opts.onOutputBytes?.(v);}});
      assert.equal(result.exitCode,0);if(args.includes('-progress'))assert.equal(ended,true,'Terminal encode progress required');return result;
    }catch(e){failure=e;throw e;}finally{
      if(row){const settled=failure||result,b=Buffer.from(typeof settled?.stderr==='string'?settled.stderr:'');row.finishedAt=new Date().toISOString();row.stderr={bytes:b.length,sha256:sha(b),capture:settled?.stderrCapture||null,completeAtSave:row.closed===true && !!settled?.stderrCapture && !settled.stderrCapture.truncated && !settled.stderrTruncated && settled.stderrCapture.totalBytes===b.length};if(failure)row.failure=evidenceFailure(failure);
        try{await fs.writeFile(path.join(root,`child-${row.index}.stderr`),b,{flag:'wx'});await writeJson(path.join(root,`child-${row.index}.json`),row);}catch(e){if(failure)failure.diagnosticSaveFailure=evidenceFailure(e);else throw e;}}
      current=null;childBusy=false;
      if(row && !failure)assert.equal(row.stderr.completeAtSave,true,'Every actual child requires known complete untruncated stderr');
    }
  }
  try{
    await writeJson(path.join(root,'preregistered.json'),{frozen:FROZEN,specs:SPECS,limits:LIMITS,runtimeIdentity:runtime.runtimeIdentity});
    for(const spec of SPECS){
      caseDeadline=Date.now()+LIMITS.caseMs;const directory=path.join(root,spec.id);await fs.mkdir(directory);const input=path.join(directory,'source.'+spec.extension);
      activeCase={id:spec.id,status:'generating',pipeBytes:0,diagnosticAndOperationPipeLimit:1024**3};report.cases.push(activeCase);
      await run(runtime.pins.ffmpeg.path,['-hide_banner','-nostdin','-v','warning','-n','-f','lavfi','-i',`testsrc2=size=1920x1080:rate=30:duration=${spec.seconds}`,'-f','lavfi','-i',`aevalsrc=0.1*sin(2*PI*(${spec.frequency}*t+5.5*t*t))|0.1*sin(2*PI*(${spec.frequency+219}*t+6.5*t*t)):s=48000:c=stereo:d=${spec.seconds}`,'-map','0:v:0','-map','1:a:0','-map_metadata','-1','-map_chapters','-1','-vf',`${spec.flip?'vflip,':''}setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,'-c:v','libx264','-preset','veryfast','-profile:v','high','-pix_fmt','yuv420p','-color_range','tv','-colorspace','bt709','-color_primaries','bt709','-color_trc','bt709','-video_track_timescale','15360','-c:a','aac','-b:a','192k','-ar:a','48000','-channel_layout:a','stereo',input],{timeoutMs:LIMITS.generationMs});
      activeCase.source=await fileReceipt(input);sourceIdentity=await readSourceIdentity(input);activeCase.sourceIdentity=sourceIdentity;
      const inspection=await inspectInput(input,{ffprobe:runtime.pins.ffprobe.path,run,signal:controller.signal});await writeJson(path.join(directory,'source-probe.json'),inspection.probe);
      const metadata=inspection.probe.streams.map(s=>at(integer(s.duration_ts),tick(s)));let extent=metadata.reduce((a,b)=>cmp(a,b)>0n?a:b);const container=inspection.probe.format.duration;assert.match(String(container),/^\d+(?:\.\d{1,6})?$/);const parts=String(container).split('.'),cr=rat(BigInt(parts[0])*1000000n+BigInt((parts[1]||'').padEnd(6,'0')),1000000n);if(cmp(cr,extent)>0n)extent=cr;
      const extentUs=Number((extent.n*1000000n+extent.d-1n)/extent.d);assert.ok(Number.isSafeInteger(extentUs));const resources=deriveCfrFullResizeCopyResources({sourceExtentUs:extentUs,sourceBytes:sourceIdentity.size});activeCase.resources=resources;caseDeadline=Math.min(caseDeadline,Date.now()+resources.executionBudgetMs);
      // Eight independent diagnostic streams plus all nine production collector
      // streams; each extra stream is separately capped by complete frame budget.
      activeCase.diagnosticAndOperationPipeLimit=resources.resources.pipeBytes+8*resources.budget.maxFrameBytes+32*1024**2;
      selector=selectorFor(path.basename(root)+':'+spec.id,runtime.runtimeIdentity);
      const request=resolveFileRequest({fileId:spec.id,identityRevision:1,draftRevision:1,operation:'encode',overrides:{range:null,resolution:'720',audioPolicy:'copy'}});
      const orientation=selector.orientationQualification({inspection,request,runtimeIdentity:runtime.runtimeIdentity,settings:SETTINGS});stage=await createStage(directory);
      const profile=PROFILES.find(x=>x.id===SETTINGS.profileId),recipe=describeRecipe(SETTINGS);
      const generationDescription=generationDescriptionOf({version:1,profileId:profile.id,codec:profile.codec,backend:profile.hardware,encoder:profile.encoder,preset:SETTINGS.preset,qualityMode:recipe.qualityMode,quality:25,bitDepth:8,encoderArgs:recipe.args,appVersion:require('../package.json').version,runtimeVersion:'9.0.2',createdAt:new Date().toISOString()});
      const plan=withEncodeOperationTelemetry(buildEncodeOperation({input,output:stage.file,settings:SETTINGS,inspection,request,runtimeIdentity:runtime.runtimeIdentity,outputId:randomUUID(),generationDescription,...orientation}));
      const value={plan,settings:SETTINGS,sourceIdentity,sourceProbeFingerprint:fingerprintEncodeSource(inspection.probe),runtimeIdentity:runtime.runtimeIdentity,environment:null,budget:null,executionBudgetMs:120000};const token=selector.select(value);bindings={token,value};selection=selector.requireCurrent(token,value);assert.deepEqual(selection.resources,resources.resources);assert.equal(plan.instrumentation.streams.length,1);assert.equal(plan.instrumentation.streams[0].kind,'video');
      const sourceDir=path.join(directory,'source-diagnostic');await fs.mkdir(sourceDir);activeCase.status='source-diagnostic';
      activeCase.sourceDiagnostic=await scanDiagnostics({file:input,probe:inspection.probe,directory:sourceDir,ffprobe:runtime.pins.ffprobe.path,run,budget:resources.budget,source:true,signal:controller.signal});await writeJson(path.join(directory,'source-diagnostic.json'),activeCase.sourceDiagnostic);
      assertStrictSourceDiagnostics(activeCase.sourceDiagnostic,inspection.probe);await sourceCurrent();activeCase.sourceDiagnosticAccepted=true;activeCase.status='encoding';
      telemetry=await createOperationTelemetry({stageDirectory:directory,runtimeIdentity:runtime.runtimeIdentity,planFingerprint:plan.planFingerprint,streams:plan.instrumentation.streams,maxBytes:resources.resources.telemetryBytes,maxRecords:resources.resources.telemetryRecords});await assertTelemetryReady(telemetry);
      await run(runtime.pins.ffmpeg.path,resolveEncodeOperationInvocation(plan,{output:stage.file,telemetry}),{timeoutMs:resources.budget.timeoutMs});await sealStage(stage);activeCase.output=await fileReceipt(stage.file);
      const te=await collectOperationTelemetry(telemetry,{completion:{childClosed:true,exitCode:0,cancelled:false},signal:controller.signal});await closeOperationTelemetry(telemetry,{childClosed:true});telemetry=null;await writeJson(path.join(directory,'telemetry.json'),te);
      const outputProbe=await inspectMetadata(stage.file,{ffprobe:runtime.pins.ffprobe.path,run,signal:controller.signal});await writeJson(path.join(directory,'output-probe.json'),outputProbe);assert.ok(outputProbe.streams.every(s=>s.time_base===FROZEN.outputClock));
      const outDir=path.join(directory,'output-diagnostic');await fs.mkdir(outDir);activeCase.outputDiagnostic=await scanDiagnostics({file:stage.file,probe:outputProbe,directory:outDir,ffprobe:runtime.pins.ffprobe.path,run,budget:resources.budget,source:false,signal:controller.signal});await writeJson(path.join(directory,'output-diagnostic.json'),activeCase.outputDiagnostic);
      activeCase.status='collecting';const collection=await collectOperationEvidence({plan,sourceProbe:inspection.probe,outputProbe,sourcePath:input,outputPath:stage.file,stageDirectory:directory,ffmpeg:runtime.pins.ffmpeg.path,ffprobe:runtime.pins.ffprobe.path,run,signal:controller.signal,budget:selection.budget,timingQualification:selection.timingQualification,sourcePolicy:selection.sourcePolicy,familySelection:selection});
      activeCase.collection=collection;assert.equal(collection.invocations.length,9);activeCase.telemetryValidation=validateEncodeOperationTelemetry(plan,te,collection);assert.equal(activeCase.telemetryValidation.valid,true);assert.ok(activeCase.telemetryValidation.streams.every(s=>s.unknownInputRecords==='0'));
      activeCase.validation=validateEncodeOperationOutput(plan,outputProbe,{qualification:selection.qualification,decodedEvidence:collection.decodedEvidence});assert.equal(activeCase.validation.valid,true,activeCase.validation.errors.join('; '));
      await sourceCurrent();assert.equal((await fileReceipt(input)).sha256,activeCase.source.sha256);await retainSealedStage(stage,'Developer Full-copy calibration only; never published.');stage=null;selector.invalidate('Case closed');selector=null;selection=null;bindings=null;sourceIdentity=null;activeCase.status='passed';activeCase=null;
    }
    report.status='passed-preregistered-full-copy-calibration';
  }catch(error){report.status='failed-retained';report.failure=evidenceFailure(error);if(error.diagnosticPartial)report.partialDiagnostic=error.diagnosticPartial;if(activeCase)activeCase.status='failed-retained';}
  finally{
    clearTimeout(timer);selector?.invalidate('Campaign closed');
    if(telemetry)try{await closeOperationTelemetry(telemetry,{childClosed:report.census.live===0});}catch(e){report.telemetryCloseFailure=evidenceFailure(e);}
    // Never delete partial/unsealed output. Existing stage owner retains it.
    if(stage)try{await retainSealedStage(stage,'Failed Full-copy calibration retained.');}catch(e){report.stageRetentionFailure=evidenceFailure(e);}
    try{await runtime.close();}catch(e){report.runtimeCloseFailure=evidenceFailure(e);}
    try{for(const pin of [...Object.values(runtime.pins),...runtime.dependencies]){const actual=await fileReceipt(pin.path);assert.equal(actual.bytes,pin.size);assert.equal(actual.sha256,pin.sha256);if(pin.sonamePath)assert.equal(await fs.realpath(pin.sonamePath),pin.path);}for(const c of report.cases)if(c.source)assert.deepEqual(await fileReceipt(c.source.path),c.source);report.postCloseIdentitiesVerified=true;}catch(e){report.postCloseIdentityFailure=evidenceFailure(e);}
    report.diagnosticsComplete=report.children.every(x=>x.closed && x.stderr.completeAtSave);
    if(report.census.live || report.census.spawned!==report.census.closed || report.census.maximum>1 || !report.diagnosticsComplete || report.runtimeCloseFailure || report.telemetryCloseFailure || report.postCloseIdentityFailure)report.status='failed-retained';
    report.elapsedMs=Date.now()-started;report.monotonicElapsedMs=Number(process.hrtime.bigint()-monotonicStart)/1e6;report.finishedAt=new Date().toISOString();report.ownedBytesAtClose=await ownedBytes(root);if(report.ownedBytesAtClose>LIMITS.ownedBytes)report.status='failed-retained';
    const persisted=await persistFinalReport(root,report);await writeJson(path.join(root,'completion.json'),{status:report.status,report:persisted,census:report.census});
  }
  return report;
}
module.exports={runCandidateFullCopyCampaign,scanDiagnostics,assertStrictSourceDiagnostics,persistFinalReport,FROZEN,SPECS};
