'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { assertCandidateResize1440Receipt, verifyCandidateResize1440Producers, createCandidateResize1440Service, REPORT, REPORT_SHA, RUNTIME_ID } = require('./candidate-resize1440-service.cjs');
const shared = require('./workbench-long-range-service.cjs');
const { deriveCfrResize1440FlacResources, RESIZE_1440_RESOURCE_POLICY: RESOURCE_POLICY, RESIZE_1440_FAMILY_ID } = require('../src/operation-resource-budget.cjs');
const { frozenQualifications } = require('../scripts/v07-sdr-flac-range-calibration.cjs');
const { CandidateTrimService } = require('./workbench-trim-candidate.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function probe(seconds = 150, tick = 15360) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', width: 2560, height: 1440,
    pix_fmt: 'yuv420p', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', field_order: 'progressive', avg_frame_rate: '30/1', r_frame_rate: '30/1',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: `1/${tick}`,
    start_pts: 0, start_time: '0', duration_ts: seconds * tick, duration: String(seconds), disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    time_base: '1/48000', start_pts: 0, start_time: '0', duration_ts: seconds * 48000, duration: String(seconds), disposition: { default: 1 } }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), start_time: '0', size: '100000000',
    nb_streams: 2, nb_programs: 0, nb_stream_groups: 0, tags: { major_brand: 'qt  ' } }, programs: [], stream_groups: [], chapters: [] };
}
// Synthetic structure exercises refusal logic, never a media qualification.
function report() {
  const sources = ['long-pattern', 'heldout-flipped'].map((id, i) => ({ id, sourceExtentUs: (i ? 11 : 150) * 1000000,
    sha256: (i ? 'b' : 'a').repeat(64), identity: { size: '100000000' }, probe: probe(i ? 11 : 150),
    frozen: frozenQualifications(`${path.basename(path.dirname(REPORT))}:${id}`, RUNTIME_ID, probe(i ? 11 : 150)) }));
  const cases = [ ['late-forty-seconds', 0, { startUs: 100000000, endUs: 140000000 }],
    ['late-open-end', 0, { startUs: 130000000 }], ['heldout-nonaligned', 1, { startUs: 413000, endUs: 8621000 }] ].map(([id, index, range]) => {
    const source = sources[index], end = range.endUs ?? source.sourceExtentUs;
    return { id, geometry: { requested: '720', mode: 'downscale', filterRequired: true, source: { width: 2560, height: 1440 }, output: { width: 1280, height: 720, sampleAspectRatio: { numerator: '1', denominator: '1' }, rotationDegrees: 0 } }, sourceId: source.id, range, status: 'passed', validation: { valid: true },
      resources: deriveCfrResize1440FlacResources({ sourceExtentUs: source.sourceExtentUs, selectedExtentUs: end - range.startUs, sourceBytes: source.identity.size }),
      pipeBytes: 1, elapsedMs: 1, frames: Math.ceil(end * 30 / 1e6) - Math.ceil(range.startUs * 30 / 1e6),
      samples: Math.ceil(end * 48000 / 1e6) - Math.ceil(range.startUs * 48000 / 1e6),
      pcmIdentity: { sourceHash: 'c'.repeat(64), outputHash: 'c'.repeat(64) }, completeSource: { video: { frames: source.sourceExtentUs * 30 / 1e6, properties: { policy: RESIZE_1440_FAMILY_ID } },
        audio: [{ sampleCount: String(source.sourceExtentUs * 48000 / 1e6) }] } };
  });
  for (const row of cases) {
    const s = sources.find(value => value.id === row.sourceId);
    Object.assign(row.completeSource.video.properties, { framesChecked: row.completeSource.video.frames, sampleAspectRatio: '1:1', chromaLocation: 'left', sideDataPolicy: 'h26x-unregistered-sei-only' });
    row.completeSource.audio[0].gaps = 0;
    Object.assign(row.pcmIdentity, { algorithm: 'sha256', format: 's16le-interleaved', sourceBytes: row.samples * 4, outputBytes: row.samples * 4 });
    Object.assign(row.validation, { validation: 'decoded-operation-contract', qualificationEvidenceId: s.frozen.qualification.evidenceId,
      timing: { timeline: 'request-relative', resolved: { startUs: row.range.startUs, endUs: row.range.endUs ?? s.sourceExtentUs } } });
  }
  for (const row of cases) row.telemetry = { valid: true, scope: 'encoder-input-count-and-timeline-only', streams: ['video', 'audio'].map((kind, outputIndex) => ({ kind, outputIndex, unknownInputRecords: '0', correspondence: 'reported-input-and-independent-selected-source' })) };
  return { diagnosticsComplete: true, children: Array.from({ length: 42 }, (_, i) => ({ sequence: i + 1, closed: true, exitCode: 0, signal: null, stderr: { available: true, completeAtSave: true, truncated: false, totalBytes: 0, retainedBytes: 0, sha256: sha(Buffer.alloc(0)) } })), candidateRuntime: true, geometry: { sourceWidth: 2560, sourceHeight: 1440, resolution: '720', outputWidth: 1280, outputHeight: 720 }, status: 'passed-pre-catalog-calibration', runtimeIdentity: RUNTIME_ID, resourcePolicy: RESOURCE_POLICY,
    publicationAuthorized: false, catalogActivated: false, settings, census: { spawned: 42, closed: 42, live: 0, maximum: 1 }, sources, cases };
}

const SOURCE = path.join(__dirname, 'candidate-resize1440-service.cjs');
const rawPath = process.env.CANDIDATE_RESIZE1440_REPORT_TEST_PATH || REPORT;
const noRaw = !process.env.CANDIDATE_RESIZE1440_REPORT_TEST_PATH && !require('node:fs').existsSync(REPORT)
  && 'Original separately retained 1440 calibration not restored.';
const SIZE = 125817;
const asBytes = obj => Buffer.from(JSON.stringify(obj));
function validateStructure(obj) {
  const bytes = asBytes(obj);
  return assertCandidateResize1440Receipt(bytes, sha(bytes)); // pure structure only
}
test('synthetic three-case receipt exercises the parser only; it is not the fixed report', () => {
  const synthetic = report(); assert.deepEqual(validateStructure(synthetic), synthetic);
  assert.throws(() => assertCandidateResize1440Receipt(asBytes(synthetic)), /exact reviewed/);
  for (const change of [
    r => r.geometry.sourceWidth = 1920, r => r.sources[0].probe.streams[0].height = 1080,
    r => r.sources[1].probe.streams[1].sample_fmt = 's32', r => r.sources[0].probe.streams[0].time_base = '1/30',
    r => r.sources[0].frozen.qualification.evidenceId = 'renamed:long-pattern:endpoints',
    r => r.cases[1].completeSource.video.properties.policy = 'cfr-sdr-range-resize-flac-v1',
    r => r.cases[1].geometry.source.width = 1920, r => r.cases[1].geometry.output.height = 1080,
    r => r.resourcePolicy = 'other', r => r.cases[0].resources.resources.pipeBytes++,
    r => r.cases[1].validation.qualificationEvidenceId = r.sources[1].frozen.qualification.evidenceId,
    r => r.cases[1].validation.timing.resolved.endUs--, r => r.cases[2].range = null,
    r => r.cases[2].pcmIdentity.outputHash = 'd'.repeat(64), r => r.cases[2].pcmIdentity.sourceBytes--,
    r => r.cases[0].completeSource.video.properties.framesChecked--, r => r.cases[0].completeSource.audio[0].gaps++,
    r => r.cases[2].telemetry.streams[1].unknownInputRecords = '1', r => r.census.live++,
    r => r.children.pop(), r => r.children[0].stderr.truncated = true, r => r.diagnosticsComplete = false,
    r => r.runtimeCloseFailure = {}, r => r.publicationAuthorized = true, r => r.catalogActivated = true,
  ]) { const value = structuredClone(report()); change(value); assert.throws(() => validateStructure(value)); }
});

test('the exact 97 calibration producer hashes match current bytes; this is not a runtime check', async () => {
  await verifyCandidateResize1440Producers();
  const literal = (await fs.readFile(SOURCE, 'utf8')).match(/const PRODUCERS = Object\.freeze\((\{[\s\S]*?\n\})\);/);
  const entries = Object.entries(JSON.parse(literal[1])); assert.equal(entries.length, 97);
  const sorted = Object.fromEntries(entries.sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
  assert.equal(sha(JSON.stringify(sorted)), 'afc4e814efc16f63bc2952852d1ea4bd2f9e4bef9fdb8a75a074e64c0eb78633');
});
test('public factory cannot accept copied handles, getters, paths, digests, arbitrary family options or UI mode', async () => {
  const stateDir = '/tmp/unused-fixed-1440'; let reads = 0;
  await assert.rejects(createCandidateResize1440Service({ stateDir, verifiedRuntime: {} }), /privately issued/);
  await assert.rejects(createCandidateResize1440Service(Object.defineProperty({ stateDir }, 'verifiedRuntime', { enumerable:true, get(){ reads++; } })));
  assert.equal(reads, 0);
  for (const key of ['report', 'reportSha', 'familyId', 'resourcePolicy', 'workbenchMode', 'outputAccess'])
    await assert.rejects(createCandidateResize1440Service({ stateDir, verifiedRuntime: {}, [key]: 'override' }), /Only fixed/);
});

// VM fakes only a candidate handle and report descriptor/identity observations.
// It does NOT replace the runtime digest, producer table, parser, selector or service.
// Lookup paths in the report are historical observations, not files to execute or read.
async function harness({ bytes = Buffer.alloc(SIZE), issue = null, cleanupFails = false, actualFS = false } = {}) {
  const source = await fs.readFile(SOURCE, 'utf8'), requireHere = createRequire(SOURCE), mod = { exports: {} };
  const deps = JSON.parse(source.match(/const DEPENDENCIES = (\[[\s\S]*?\n\]);/)[1]);
  const counts = { current: 0, closed: 0, open: 0, close: 0, used: 0, producerPass: 0, stat: 0, lstat: 0, realpath: 0, flags: null, calls: 0 };
  const fake = { pins: Object.fromEntries(['ffmpeg','ffprobe'].map(k => [k, { path:'/synthetic/' + k, size:1, sha256:'a'.repeat(64) }])),
    runtimeIdentity: issue === 'identity' ? 'f'.repeat(64) : RUNTIME_ID, dependencies: issue === 'dependencies' ? [] : deps,
    async requireCurrent(){ if (++counts.current === 2 && issue === 'post-current') throw Error('stale after source checks'); },
    async close(){ counts.closed++; if (cleanupFails) throw Error('owned cleanup failed'); },
    createRunner(){ return async () => { counts.calls++; throw Error('Unexpected child invocation'); }; } };
  const base = { dev:1n, ino:2n, nlink:1n, size:BigInt(SIZE), mtimeNs:1n, ctimeNs:1n, birthtimeNs:1n };
  const inputs = { './candidate-calibration-runtime.cjs': { requireCandidateCalibrationRuntime(c){ assert.equal(c, fake); return fake; } },
    'node:fs/promises': { ...fs, async readFile(name, ...rest) {
      if (name.endsWith('/linux-blue/workbench-long-range-calibration.cjs')) {
        counts.producerPass++;
        if (issue === 'producer' || issue === 'post-producer' && counts.producerPass === 2) return Buffer.from('altered producer');
      }
      return fs.readFile(name, ...rest);
    }, async realpath(name){ assert.equal(name, REPORT); counts.realpath++;
      return issue === 'symlink' || issue === 'path-alias' && counts.realpath === 2 ? REPORT+'.other' : REPORT; },
    async lstat(name, options){ assert.equal(name, REPORT); assert.equal(options.bigint, true); counts.lstat++;
      return { ...base, isFile:() => issue !== 'pre-nonregular', nlink:issue === 'pre-hardlink' ? 2n : 1n,
        size:issue === 'pre-size' ? BigInt(SIZE - 1) : BigInt(SIZE), ino:issue === 'replacement' && counts.lstat === 2 ? 3n : 2n }; },
    async open(name, flags){ assert.equal(name, REPORT); counts.flags=flags; counts.open++;
      return { async stat(){return { ...base, isFile:() => issue !== 'nonregular', nlink:issue === 'hardlink' ? 2n : 1n,
        ino:issue === 'open-swap' ? 3n : 2n,
        size:BigInt(issue === 'oversize' ? SIZE + 1 : SIZE), ctimeNs:issue === 'mutation' ? BigInt(++counts.stat) : 1n };},
        async read(buf, off, len, pos){ const n=issue === 'truncated' ? 0 : bytes.copy(buf,off,pos,pos+Math.min(len,8192)); counts.used+=n; return {bytesRead:n}; },
        async close(){ counts.close++; } };
    } } };
  if (actualFS) delete inputs['node:fs/promises'];
  vm.runInThisContext('(function(require,module,exports,__dirname){'+source+'\n})',{ filename:SOURCE })(
    name => Object.hasOwn(inputs,name) ? inputs[name] : requireHere(name), mod, mod.exports, __dirname);
  return { counts, fake, build:() => mod.exports.createCandidateResize1440Service({verifiedRuntime:fake,stateDir:'/tmp/unused-fixed-1440'}) };
}
test('rejects an initially nonregular, multiply-linked or wrong-sized pathname before attempting to open it', async () => {
  for (const issue of ['pre-nonregular', 'pre-hardlink', 'pre-size']) {
    const h = await harness({issue});
    await assert.rejects(h.build(), /ordinary report.*before opening/);
    assert.equal(h.counts.lstat, 1); assert.equal(h.counts.open, 0); assert.equal(h.counts.used, 0);
    assert.equal(h.counts.closed, 1); assert.equal(h.counts.calls, 0);
  }
});
test('open is nonblocking and refuses a changed descriptor before reading, without leaking ownership', async () => {
  const c = require('node:fs').constants;
  for (const issue of ['open-swap','nonregular']) {
    const h = await harness({issue});
    await assert.rejects(h.build(), /changed before bounded reading/);
    assert.equal(h.counts.lstat, 1); assert.equal(h.counts.open, 1);
    assert.equal(h.counts.flags, c.O_RDONLY | c.O_NOFOLLOW | c.O_NONBLOCK);
    assert.equal(h.counts.used, 0); assert.equal(h.counts.close, 1); assert.equal(h.counts.closed, 1); assert.equal(h.counts.calls, 0);
  }
});
test('changed identity/producer, report substitution, unstable descriptor or replaced name closes the owner before child execution', async () => {
  for (const issue of ['identity','dependencies','producer','symlink','nonregular','hardlink','oversize','mutation','truncated','replacement','path-alias','digest']) {
    const h=await harness({issue}); await assert.rejects(h.build()); assert.equal(h.counts.closed,1,issue);
    assert.equal(h.counts.calls,0); assert.equal(h.counts.close, h.counts.open);
    if (['identity','dependencies','producer','symlink'].includes(issue)) assert.equal(h.counts.open,0);
    if (['replacement','path-alias','digest'].includes(issue)) assert.equal(h.counts.used,SIZE);
  }
  const h=await harness({issue:'producer',cleanupFails:true});
  await assert.rejects(h.build(), e => e instanceof AggregateError && e.cause === e.errors[0] && /producer changed/.test(e.errors[0].message) && /owned cleanup failed/.test(e.errors[1].message));
});
test('actual fixed raw 1440 report is accepted; portable rewrite and other saved ranges cannot replace it', {skip:noRaw}, async () => {
  const bytes=await fs.readFile(rawPath); assert.equal(bytes.length,SIZE); assert.equal(sha(bytes),REPORT_SHA);
  const r=assertCandidateResize1440Receipt(bytes); assert.equal(r.census.closed,42);
  assert.deepEqual(r.cases.map(c => [c.frames,c.samples]),[[1200,1920000],[600,960000],[246,393984]]);
  assert.throws(()=>assertCandidateResize1440Receipt(asBytes(r)),/exact reviewed/);
  const legacy=require('./candidate-resize-service.cjs'), full=require('./candidate-full-copy-service.cjs');
  assert.throws(()=>legacy.assertCandidateServiceReceipt(bytes)); assert.throws(()=>full.assertCandidateServiceReceipt(bytes));
});
for (const [label,variable] of [['1080','CANDIDATE_RESIZE_REPORT_TEST_PATH'],['Full-copy','CANDIDATE_FULL_COPY_REPORT_TEST_PATH']]) {
  test('actual retained '+label+' report cannot authorize 1440', {skip:!process.env[variable]}, async () => {
    const bytes=await fs.readFile(process.env[variable]);
    const original=require(label==='1080'?'./candidate-resize-service.cjs':'./candidate-full-copy-service.cjs');
    assert.equal(sha(bytes), original.REPORT_SHA);
    assert.throws(()=>assertCandidateResize1440Receipt(bytes), /exact reviewed/);
    assert.throws(()=>assertCandidateResize1440Receipt(bytes,sha(bytes)),/matching pre-catalog/);
  });
}
test('producer drift on second verification and stale runtime after fixed report acceptance both refuse construction', {skip:noRaw}, async () => {
  const bytes=await fs.readFile(rawPath);
  for(const issue of ['post-producer','post-current']){
    const h=await harness({issue,bytes}); await assert.rejects(h.build(),issue==='post-producer'? /producer changed/ : /stale after source checks/);
    assert.equal(h.counts.close,1); assert.equal(h.counts.producerPass,2); assert.equal(h.counts.closed,1); assert.equal(h.counts.calls,0);
  }
});
test('real fixed receipt, real plan/selector/resources, injected candidate handle: no media or service publication', {skip:noRaw}, async () => {
  const bytes=await fs.readFile(rawPath), raw=assertCandidateResize1440Receipt(bytes), h=await harness({bytes}), service=await h.build();
  const { buildEncodeOperation, withEncodeOperationTelemetry, fingerprintEncodeSource }=require('../src/encode-operation.cjs');
  const { resolveFileRequest }=require('../src/operation-contract.cjs'), { classifyColor }=require('../src/media.cjs');
  const { isProportionalFamilySelection }=require('../src/operation-family.cjs'), { operationCostLimits }=require('../src/encoder-service.cjs');
  const src=raw.sources[1], planRange={startUs:613000,endUs:2721000}, selector=service.operationQualifications;
  function bindings(overrides={}, sourceProbe=src.probe) {
    const request=resolveFileRequest({fileId:'test',identityRevision:1,draftRevision:1,operation:'encode',overrides:{resolution:'720',range:planRange,audioPolicy:'precision-flac',...overrides}});
    const inspection={probe:sourceProbe,color:classifyColor(sourceProbe),duration:11}, identity={...src.identity,canonicalPath:'/synthetic/genuine-metadata.mov'};
    const orientation=selector.orientationQualification({inspection,request,runtimeIdentity:RUNTIME_ID,settings});
    const plan=withEncodeOperationTelemetry(buildEncodeOperation({input:identity.canonicalPath,output:'/synthetic/not-created.mkv',inspection,request,settings,runtimeIdentity:RUNTIME_ID,...orientation}));
    return {plan,settings,sourceIdentity:identity,sourceProbeFingerprint:fingerprintEncodeSource(sourceProbe),runtimeIdentity:RUNTIME_ID,environment:null,budget:null,executionBudgetMs:120000};
  }
  try{
    assert.ok(service instanceof CandidateTrimService); assert.ok(service.operationRuntime instanceof OperationRuntimeObserver);
    assert.ok(selector instanceof shared.ClockQualifiedFamilySelector); assert.equal(service.operationTelemetry,true); assert.equal(service.operationEvidenceBudget,null);
    assert.equal(h.counts.close,1); assert.equal(h.counts.used,SIZE); assert.equal(h.counts.producerPass,2);
    const flags = require('node:fs').constants;
    assert.equal(h.counts.flags, flags.O_RDONLY | flags.O_NOFOLLOW | flags.O_NONBLOCK);
    assert.equal(h.counts.lstat, 2);
    const b=bindings(), token=selector.select(b), result=selector.requireCurrent(token,b);
    assert.equal(result.sourcePolicy.id, RESIZE_1440_FAMILY_ID); assert.equal(result.resourcePolicy, RESOURCE_POLICY);
    const expected=deriveCfrResize1440FlacResources({sourceExtentUs:11000000,selectedExtentUs:2108000,sourceBytes:src.identity.size});
    assert.equal(isProportionalFamilySelection(result,b.plan),true); assert.deepEqual(result.budget,expected.budget);
    assert.deepEqual(operationCostLimits({operationPlan:b.plan},result),{...expected.resources,executionBudgetMs:expected.executionBudgetMs});
    assert.throws(()=>selector.requireCurrent({...token},b)); assert.throws(()=>selector.requireCurrent(token,{...b,sourceIdentity:{...b.sourceIdentity,ino:'999'}}));
    for (const overrides of [{range:null},{resolution:'source'},{resolution:'1080'},{audioPolicy:'precision-aac'}])
      assert.throws(()=>selector.select(bindings(overrides)));
    for(const [width,height] of [[1920,1080],[3840,2160]]){
      const other=probe(11); Object.assign(other.streams[0],{width,height}); other.format.size=src.identity.size;
      assert.throws(()=>selector.select(bindings({},other)));
    }
    service.plan={operation:'encode',sameFolder:false,settings,entries:new Map([['compat',{operationPlan:{compatibilityPath:true}}]])};
    assert.throws(()=>service.startBatch({planId:'unused',fileIds:['compat']}),{code:'LINUX_TRIM_CANDIDATE_SCOPE'});
    selector.invalidate('End the injected plan scope.'); assert.throws(()=>selector.requireCurrent(token,b));
    service.plan=null; const cancellation=service.cancelCurrent(); assert.equal(service.admissionClosed,true);
    assert.throws(()=>service.startBatch({planId:'unused',fileIds:['compat']}),{code:'SHUTTING_DOWN'}); await cancellation;
  } finally { await service.closeOperationResources(); }
  assert.equal(h.counts.closed,1); assert.equal(h.counts.calls,0);
});

test('original restored at its fixed canonical path: real bounded descriptor read and producer rechecks, injected candidate only',
  {skip: !require('node:fs').existsSync(REPORT) && 'Original report not restored at its canonical path.'}, async () => {
    const h = await harness({actualFS: true}), service = await h.build();
    try { assert.ok(service.operationQualifications instanceof shared.ClockQualifiedFamilySelector); }
    finally { await service.closeOperationResources(); }
    assert.equal(h.counts.current, 2); assert.equal(h.counts.closed, 1); assert.equal(h.counts.calls, 0);
  });
