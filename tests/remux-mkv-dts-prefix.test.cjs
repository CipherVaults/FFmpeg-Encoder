'use strict';
// ISO to Matroska remux of reordered VFR H.264 on FFmpeg 9.1.
//
// Cause: the 9.1 mov demuxer (mov_update_sample_durations) reports reordered
// VFR packet durations in presentation order, not as stts decode steps. Those
// durations are copied into Matroska BlockDurations. Matroska stores no DTS, so
// the output's leading reorder packets have no decode time and the comparison
// derives them backwards from the first concrete DTS through their durations;
// with presentation-order durations that no longer reproduces the ISO source's
// real leading DTS. The fix gives the source's same leading packets the
// identical derivation (ISO to Matroska only) and keeps every output field
// compared. These tests pin the accepted form and its near misses.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), syncFs = require('node:fs'), path = require('node:path'), os = require('node:os');
const Module = require('node:module');
const { randomUUID } = require('node:crypto');
const evidence = require('../src/remux-evidence.cjs');
const { compareRemuxPackets } = evidence;

const HASH = 'a'.repeat(64);
const q = (n, d) => ({ numerator: String(n), denominator: String(d) });
function variant(before, after) {
  const file = path.resolve(__dirname, '../src/remux-evidence.cjs'), source = syncFs.readFileSync(file, 'utf8');
  const parts = source.split(before); assert.ok(parts.length >= 2, 'Mutation site present.');
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(parts.join(after), file); return compiled.exports;
}
async function* list(values) { for (const value of values) yield structuredClone(value); }
const packet = (pts, dts, duration, key = false) => ({ size: '1', hash: HASH, key, discard: false, sideSha256: HASH, pts, dts, duration });
// The exact first packets FFmpeg 9.1 reports for the corpus VFR B-frame MP4
// (time base 1/15360) and for its Matroska copy (1/1000). Source durations are
// presentation-order (1536, 1536, 1024, ...), while the source DTS steps are
// 1536, 1024, 1536, ...; the Matroska output has no DTS for packets 0 and 1.
function iso() {
  return [packet(q(0, 1), q(-2560, 15360), q(1536, 15360), true), packet(q(3072, 15360), q(-1024, 15360), q(1536, 15360)),
    packet(q(1536, 15360), q(0, 1), q(1024, 15360)), packet(q(2560, 15360), q(1536, 15360), q(512, 15360)),
    packet(q(6144, 15360), q(2560, 15360), q(1536, 15360))];
}
function mkv() {
  return [packet(q(0, 1000), null, q(100, 1000), true), packet(q(200, 1000), null, q(100, 1000)),
    packet(q(100, 1000), q(0, 1000), q(67, 1000)), packet(q(167, 1000), q(100, 1000), q(33, 1000)),
    packet(q(400, 1000), q(167, 1000), q(100, 1000))];
}
const MIRROR = { outputPrefix: true, mirrorPrefix: true };
const compare = (a, b, options = MIRROR) => compareRemuxPackets(a.length, b.length, list(a), list(b), options);

test('ISO to Matroska mirrors only the output DTS prefix; without it the 9.1 copy is refused at packet 0', async () => {
  const result = await compare(iso(), mkv());
  assert.equal(result.complete, true); assert.equal(result.comparedUnits, '5');
  // The unmirrored comparison is the pre-fix behaviour: the derived Matroska
  // prefix (-200 ms, -100 ms) differs from the ISO decode clock (-1/6 s, -1/15 s).
  await assert.rejects(compare(iso(), mkv(), { outputPrefix: true }), e => e.code === 'REMUX_PACKET_TIMING' && /dts exceeds 1\/500s at packet 0/.test(e.message));
  // A decode-order source (stts steps as durations, the pre-9.1 report) gives
  // the same derived prefix as its real DTS, so the mirrored form agrees.
  const decodeOrder = iso(); decodeOrder[1].duration = q(1024, 15360);
  const output = mkv(); output[1].duration = q(67, 1000);
  assert.equal((await compare(decodeOrder, output)).complete, true);
  assert.equal((await compare(decodeOrder, output, { outputPrefix: true })).complete, true);
});

test('mirrored prefix near misses are still refused with their codes', async () => {
  const cases = [
    // One prefix duration beyond 1/500 s moves the derived prefix clock first.
    ['prefix-duration', b => { b[1].duration = q(1021, 10000); }, 'REMUX_PACKET_TIMING', /dts exceeds 1\/500s at packet 0/],
    // A later duration beyond 1/500 s.
    ['duration', b => { b[3].duration = q(36, 1000); }, 'REMUX_PACKET_TIMING', /duration exceeds 1\/500s at packet 3/],
    // Two prefix durations each inside 1/500 s whose accumulated decode-clock
    // difference is 3 ms: the derived DTS still bound the sum.
    ['accumulated', b => { b[0].duration = q(1015, 10000); b[1].duration = q(1015, 10000); }, 'REMUX_PACKET_TIMING', /dts exceeds 1\/500s at packet 0/],
    // The concrete anchor DTS itself changed; the derived prefix moves with it
    // and is reached first.
    ['anchor', b => { b[2].dts = q(3, 1000); }, 'REMUX_PACKET_TIMING', /dts exceeds 1\/500s at packet 0/],
    // A prefix presentation time changed.
    ['pts', b => { b[1].pts = q(203, 1000); }, 'REMUX_PACKET_TIMING', /pts exceeds 1\/500s at packet 1/],
    // A later concrete DTS changed after the prefix.
    ['interior', b => { b[3].dts = q(103, 1000); }, 'REMUX_PACKET_TIMING', /dts exceeds 1\/500s at packet 3/],
    // Payload identity in the prefix is unaffected by the clock form.
    ['payload', b => { b[0].hash = 'b'.repeat(64); }, 'REMUX_PACKET_PAYLOAD', /at packet 0/],
    // An interior missing output DTS is not a prefix.
    ['interior-missing', b => { b[3].dts = null; }, 'REMUX_PACKET_DTS', /interior/],
  ];
  for (const [name, mutate, code, message] of cases) {
    const b = mkv(); mutate(b);
    await assert.rejects(compare(iso(), b), e => e.code === code && message.test(e.message), name);
  }
  // The source's real leading DTS must still advance strictly to the anchor.
  for (const [name, mutate] of [['equal', a => { a[1].dts = q(0, 1); }], ['beyond', a => { a[1].dts = q(1, 15360); }],
    ['backwards', a => { a[0].dts = q(-1024, 15360); }], ['missing', a => { a[0].dts = null; }],
    // A leading packet presented before it is decoded is not a real source clock.
    ['after-pts', a => { a[0].pts = q(-3000, 15360); }]]) {
    const a = iso(); mutate(a);
    await assert.rejects(compare(a, mkv()), { code: 'REMUX_PACKET_DTS' }, name);
  }
  // Mirroring is only the ISO-source/Matroska-output form.
  await assert.rejects(compare(iso(), mkv(), { outputPrefix: false, mirrorPrefix: true }), { code: 'REMUX_PACKET_DTS' });
  await assert.rejects(compare(iso(), mkv(), { sourcePrefix: true, outputPrefix: true, mirrorPrefix: true }), { code: 'REMUX_PACKET_DTS' });
  // Fewer source packets than the output prefix plus its anchor.
  await assert.rejects(compareRemuxPackets(2, 5, list(iso().slice(0, 2)), list(mkv()), MIRROR), { code: 'REMUX_PACKET_COUNT' });
  // An output without a DTS prefix leaves every source DTS compared directly.
  const concrete = mkv(); concrete[0].dts = q(-200, 1000); concrete[1].dts = q(-100, 1000);
  await assert.rejects(compare(iso(), concrete), e => e.code === 'REMUX_PACKET_TIMING' && /dts exceeds 1\/500s at packet 0/.test(e.message));
});

test('mirrored prefix guards are each load-bearing', async () => {
  for (const [before, after, run, code] of [
    ['need(previous === null || greater(dts, previous),', 'need(true,', () => { const a = iso(); a[1].dts = q(0, 1); return [a, mkv()]; }, 'REMUX_PACKET_DTS'],
    ['!anchored && held.length < count', 'held.length < count', () => [iso(), mkv()], null],
  ]) {
    const [a, b] = run(), mutant = variant(before, after);
    if (code) await assert.rejects(compareRemuxPackets(a.length, b.length, list(a), list(b), MIRROR), { code });
    else assert.equal((await compareRemuxPackets(a.length, b.length, list(a), list(b), MIRROR)).complete, true);
    // The mutant either accepts the near miss or fails on the valid form.
    const outcome = await mutant.compareRemuxPackets(a.length, b.length, list(a), list(b), MIRROR).then(() => 'accepted', e => e.code);
    assert.notEqual(outcome, code || 'accepted', before);
  }
});

test('FFmpeg 9.1 ISO VFR B-frame MP4 copies to Matroska with complete evidence; the unmirrored collector refuses it', { timeout: 120000 }, async t => {
  const { runTool } = require('../src/process-runner.cjs');
  const { ffmpeg, ffprobe } = require('../src/candidate-runtime.cjs').resolveCandidateRuntime({ root: path.resolve(__dirname, '..') });
  const { readSourceIdentity } = require('../src/source-identity.cjs');
  const { RemuxOperations, fingerprintRemuxSourceIdentity } = require('../src/remux-operation.cjs');
  const { assessRemux } = require('../src/remux-contract.cjs');
  const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
  const { EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
  const { createStage } = require('../src/outputs.cjs');
  const runtimeIdentity = REMUX_POLICIES[0].runtimeIdentity;
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-mkv-prefix-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.match(path.basename(root), /^remux-mkv-prefix-/); await fs.rm(root, { recursive: true }); });
  const probe = async file => JSON.parse((await runTool(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-show_chapters', '-show_programs',
    '-show_stream_groups', '-show_data_hash', 'sha256', '-of', 'json', file])).stdout);
  const packets = async file => JSON.parse((await runTool(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'packet=pts,dts,duration',
    '-of', 'json', file])).stdout).packets;
  const file = path.join(root, 'vfr-bframes.mp4');
  await runTool(ffmpeg, ['-v', 'error', '-nostdin', '-n', '-f', 'lavfi', '-i', 'testsrc2=s=64x48:r=30:d=1', '-f', 'lavfi', '-i', 'sine=r=48000:d=1',
    '-map', '0:v', '-map', '1:a', '-vf', 'select=not(mod(n\\,3))+not(mod(n\\,5)),setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-fps_mode', 'vfr', '-c:v', 'libx264', '-preset', 'ultrafast', '-threads', '1', '-bf', '2', '-g', '10', '-pix_fmt', 'yuv420p',
    '-color_range', 'tv', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-ac', '2', file]);
  // The fixture exercises the 9.1 cause: some reported duration is not its DTS step.
  const sourcePackets = await packets(file);
  assert.ok(sourcePackets.slice(0, -1).some((p, i) => Number(p.duration) !== Number(sourcePackets[i + 1].dts) - Number(p.dts)));
  const raw = await probe(file), identity = await readSourceIdentity(file), target = 'matroska';
  const request = { fileId: 'prefix', identityRevision: 0, draftRevision: 0, operation: 'remux', target, range: null, omissionRequestIds: [] };
  const assessment = assessRemux({ request, probe: raw, sourceFingerprint: fingerprintRemuxSourceIdentity(identity) });
  const api = new RemuxOperations({ runtimeIdentity, policyIdentity: REMUX_POLICY_ID, policies: REMUX_POLICIES });
  const stage = await createStage(root), output = stage.file, outputId = randomUUID();
  const plan = api.prepare({ assessment, request, input: file, output, outputId, sourceIdentity: identity });
  api.select({ plan, settings: null, sourceIdentity: identity, sourceProbeFingerprint: plan.sourceProbeFingerprint, runtimeIdentity, environment: null,
    budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS });
  await runTool(ffmpeg, api.resolveInvocation(plan, { output }));
  const outputPackets = await packets(output);
  assert.equal(outputPackets[0].dts, undefined); assert.equal(outputPackets[1].dts, undefined); assert.notEqual(outputPackets[2].dts, undefined);
  const outputProbe = await probe(output);
  const collect = module => module.collectRemuxEvidence({ assessment, runtimeIdentity, outputId, sourceProbe: raw, outputProbe, sourcePath: file, outputPath: output,
    stageDirectory: root, ffmpeg, ffprobe, run: runTool, budget: EVIDENCE_BUDGET, verificationMethod: 'packet-identity-v1', maxConcurrentChildren: 2 });
  const accepted = await collect(evidence);
  assert.equal(accepted.status, 'completed', JSON.stringify(accepted.failure));
  assert.equal(api.validate(plan, outputProbe, accepted).valid, true);
  const unmirrored = await collect(variant("mirrorPrefix: before.family === 'isobmff' && after.family === 'matroska' }", 'mirrorPrefix: false }'));
  assert.equal(unmirrored.status, 'failed');
  assert.equal(unmirrored.failure.code, 'REMUX_PACKET_TIMING'); assert.match(unmirrored.failure.message, /dts exceeds 1\/500s at packet 0/);
});
