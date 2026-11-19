'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Module = require('node:module');
const fixtures = require('../scripts/v07-remux-long-fixtures.cjs');
const smoke = require('../scripts/v07-remux-long-smoke.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const MiB = 1024 ** 2, GiB = 1024 ** 3, ID = '715e278f-1b7e-4d19-948d-a952b68c328e';
const sha = b => createHash('sha256').update(b).digest('hex');
const absent = () => Object.assign(new Error('Injected absent entry'), { code: 'ENOENT' });
test('performance accounting uses the clipped union of concurrent child lifetimes', () => {
  assert.equal(smoke.childCoverage([{ childStartedAt: 0, childClosedAt: 30 }, { childStartedAt: 20, childClosedAt: 70 },
    { childStartedAt: 80, childClosedAt: 120 }, {}], 10, 100), 80);
});
function scanTree() {
  const root = path.resolve('inert-owned-growth'), nodes = new Map(), calls = { stat: new Map(), read: new Map() };
  let nextInode = 1n; const control = { onStat: null, onRead: null };
  function add(file, kind = 'file', size = 1n) {
    const node = { kind, size, dev: 1n, ino: nextInode++, birthtimeNs: 1n, mtimeNs: 0n, link: false };
    nodes.set(file, node); return node;
  }
  add(root, 'directory', 0n);
  const io = {
    async lstat(file, options) {
      assert.equal(options?.bigint, true); const count = (calls.stat.get(file) || 0) + 1; calls.stat.set(file, count);
      const n = nodes.get(file); if (!n) throw absent();
      const stat = { ...n, isFile: () => n.kind === 'file', isDirectory: () => n.kind === 'directory', isSymbolicLink: () => n.link };
      return await control.onStat?.(file, stat, count) ?? stat;
    },
    async readdir(file) {
      const n = nodes.get(file); if (!n) throw absent(); assert.equal(n.kind, 'directory');
      const count = (calls.read.get(file) || 0) + 1; calls.read.set(file, count);
      const names = [...nodes.keys()].filter(name => name !== root && path.dirname(name) === file).map(name => path.basename(name));
      return await control.onRead?.(file, names, count) ?? names;
    },
  };
  return { root, nodes, calls, control, io, add, child: name => path.join(root, name) };
}
async function mutatedFixtures(before, after) {
  const file = path.resolve(__dirname, '../scripts/v07-remux-long-fixtures.cjs'), source = await fs.readFile(file, 'utf8');
  assert.equal(source.split(before).length, 2, 'One exact harness mutation site.');
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(source.replace(before, after), file); return compiled.exports;
}
function fixtureReport() {
  return { schema: 1, id: ID, status: 'passed-owned-fixtures', liveChildren: 0, leaseReleased: true, closureFailures: [],
    cases: fixtures.FIXTURES.map(s => ({ id: s.id, output: path.join(fixtures.OWNED, 'fixtures', 'remux-long-' + ID, s.name),
      status: 'passed-generated-metadata', file: { bytes: s.minBytes || MiB, sha256: 'a'.repeat(64) },
      observation: { scope: 'generated-source-metadata-only', seconds: s.seconds } })) };
}
function probe(s) {
  return { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, pix_fmt: 'yuv420p',
    field_order: 'progressive', sample_aspect_ratio: '1:1', color_range: 'tv', color_space: 'bt709', color_primaries: 'bt709',
    color_transfer: 'bt709', avg_frame_rate: '30/1', r_frame_rate: '30/1', time_base: '1/30000' },
  ...(s.audio ? [{ index: 1, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo' }] : [])],
  format: { format_name: s.target === 'matroska' ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(s.seconds),
    nb_streams: s.audio ? 2 : 1, nb_programs: 0, nb_stream_groups: 0 }, chapters: [], programs: [], stream_groups: [] };
}
test('all proof flags/modes/cases and ROOT_FILL pins fail before any I/O when invalid', async () => {
  let ioCalls = 0; const dependencies = { createOwnedSession() { ioCalls++; throw Error('must be inert'); } };
  for (const argv of [[], ['--run-owned-fixtures', '--extra'], ['--normal'], ['--run-owned-remux', '--normal', '--cases', ''],
    ['--run-owned-remux', '--normal', '--cases', 'mp4-mp4,mp4-mp4'], ['--run-owned-remux', '--normal', '--cases', '../outside'],
    ['--run-owned-remux', '--qualify', '--normal', '--cases', 'mp4-mp4']]) {
    if (argv[0] === '--run-owned-fixtures' || argv.length === 0) await assert.rejects(fixtures.createFixtures(dependencies)(argv));
    else await assert.rejects(smoke.createSmoke(dependencies)(argv));
  }
  await assert.rejects(smoke.createSmoke({ ...dependencies, pins: { id: 'ROOT_FILL_FIXTURE_ID', sha256: 'ROOT_FILL_FIXTURE_REPORT_SHA256' } })(['--run-owned-remux', '--normal', '--cases', 'mp4-mp4']), /ROOT/);
  assert.equal(ioCalls, 0);
  for (const mode of ['--normal', '--qualify']) assert.deepEqual(smoke.configuration(['--run-owned-remux', mode, '--cases', Object.keys(smoke.CASES).join(',')]).cases, Object.keys(smoke.CASES));
  assert.equal(smoke.routeOptions('--normal').remuxPolicies, REMUX_POLICIES); assert.equal(smoke.routeOptions('--normal').remuxPolicyIdentity, REMUX_POLICY_ID);
  const qualify = smoke.routeOptions('--qualify'); assert.equal(qualify.remuxPolicies.length, 6); assert.ok(qualify.remuxPolicies.every(p => p.id.startsWith('q2o-packet-lab:')));
  assert.ok(qualify.remuxPolicies.every(p => p.verificationMethod === 'packet-identity-v1'));
  assert.throws(() => smoke.routeOptions('--auto'));
});
test('fixture prospectus pins CPU argv, duration/byte shape, forecast and both volume floors', () => {
  assert.equal(fixtures.LIMITS.totalMs, 15 * 60000); assert.equal(fixtures.LIMITS.forecastBytes, 6 * GiB);
  assert.equal(fixtures.LIMITS.maxChildren, 6); assert.equal(fixtures.FIXTURES.filter(s => s.seconds === 1200).length, 2);
  for (const spec of fixtures.FIXTURES) {
    const args = fixtures.generationArgs(spec, path.resolve('inert-owned-fixtures', 'remux-long-' + ID, spec.name));
    assert.ok(args.includes('-n') && !args.includes('-y')); assert.equal(args[args.indexOf('-c:v') + 1], 'libx264');
    assert.ok(!args.some(a => /nvenc|qsv|amf/.test(a))); assert.equal(args[args.indexOf('-t') + 1], String(spec.seconds));
    const bytes = spec.minBytes || MiB; assert.equal(fixtures.assessFixture(probe(spec), spec, bytes).completeDecodeProven, false);
    assert.throws(() => fixtures.assessFixture(probe(spec), spec, spec.maxBytes));
    const bad = probe(spec); bad.streams[0].pix_fmt = 'yuv420p10le'; assert.throws(() => fixtures.assessFixture(bad, spec, bytes));
  }
  const large = fixtures.FIXTURES.find(s => s.minBytes); assert.equal(large.minBytes, 600 * MiB);
  assert.throws(() => fixtures.assessFixture(probe(large), large, large.minBytes - 1));
  assert.throws(() => fixtures.generationArgs({ ...large }, path.join(fixtures.OWNED, large.name)));
  const d = { bavail: 25n * BigInt(GiB), bsize: 1n }, f = { bavail: BigInt(fixtures.LIMITS.forecastBytes + fixtures.LIMITS.marginBytes), bsize: 1n };
  fixtures.requireSpace(d, f, fixtures.LIMITS);
  assert.throws(() => fixtures.requireSpace({ ...d, bavail: d.bavail - 1n }, f, fixtures.LIMITS));
  assert.throws(() => fixtures.requireSpace(d, { ...f, bavail: f.bavail - 1n }, fixtures.LIMITS));
  assert.throws(() => fixtures.requireSpace({ bavail: 1e15, bsize: 1n }, f, fixtures.LIMITS));
});
test('pinned reports refuse changed SHA, paths, shapes, closure and failed generation', () => {
  const report = fixtureReport(), bytes = Buffer.from(JSON.stringify(report)), pins = { id: ID, sha256: sha(bytes) };
  assert.equal(smoke.fixtureSources(bytes, pins).size, 3);
  assert.throws(() => smoke.fixtureSources(bytes, { ...pins, sha256: 'b'.repeat(64) }));
  for (const edit of [p => { p.id = 'other'; }, p => { p.status = 'failed-retained'; }, p => { p.liveChildren = 1; }, p => { p.leaseReleased = false; },
    p => { p.closureFailures = ['failure']; }, p => { p.cases.pop(); }, p => { p.cases[0].output = 'F:\\outside.mp4'; },
    p => { p.cases[0].file.sha256 = 'invalid'; }, p => { p.cases[0].observation.seconds = 1; }, p => { p.cases[2].file.bytes = 512 * MiB; }]) {
    const p = structuredClone(report); edit(p); const b = Buffer.from(JSON.stringify(p)); assert.throws(() => smoke.fixtureSources(b, { id: ID, sha256: sha(b) }));
  }
  for (const n of [-1, 0.5, NaN, smoke.LIMITS.maxStarts]) assert.throws(() => smoke.requireStart(n));
});
function evidence(label = 'mp4-mp4') {
  const spec = smoke.LEGACY[label], count = spec?.frames || '36000', variable = spec?.cadence === 'variable' || label === 'timeline-video-mp4';
  const native = { complete: true, unitCount: count, contentSha256: 'c'.repeat(64), metadataSha256: 'd'.repeat(64),
    firstPts: { numerator: '0', denominator: '1' }, endPts: { numerator: '12', denominator: '1' },
    cadence: { version: 1, classification: variable ? 'variable' : 'constant', intervalCount: String(BigInt(count) - 1n),
      firstStep: { numerator: '1', denominator: '30' }, differingStep: variable ? { numerator: '1', denominator: '15' } : null } };
  return { status: 'completed', verificationMethod: 'packet-identity-v1', ioBytes: { packetPayload: 64, outputSeal: 123, physicalMediaReads: null },
    invocations: [{ args: ['-show_packets'] }, { args: ['-show_packets'] },
      ...Array.from({ length: 1 }, () => ({ args: ['-show_data'] })),
      ...Array.from({ length: 2 }, () => ({ args: ['data', '-bsf:v', 'h264_mp4toannexb,filter_units=remove_types=12,h264_metadata', 'null', 'pipe:1', 'pipe:3', 'framehash', 'sha256', '-copyinkf'] })),
      ...Array.from({ length: 2 }, () => ({ args: ['-frames:v', '1', 'rawvideo'] }))],
    essenceEvidence: { verificationMethod: 'packet-identity-v1', outputFileSha256: 'e'.repeat(64),
      streams: [{ codecType: 'video', source: native, output: structuredClone(native), timestamps: { complete: true, comparedUnits: count,
        maxPtsError: { numerator: '0', denominator: '1' }, maxDurationError: { numerator: '0', denominator: '1' } } }] } };
}
test('outcomes pin every warning code/key/message and retain complete native checks', () => {
  for (const [label, warnings] of Object.entries(smoke.EXPECTED_WARNINGS)) {
    const result = { status: 'success', verificationMethod: 'packet-identity-v1', outcome: warnings.length ? 'saved-with-warning' : 'saved', outputDisposition: { published: true }, warnings };
    smoke.requireOutcome(label, result, evidence());
    for (const change of [{ status: 'failed' }, { outputDisposition: { published: false } }, { warnings: [...warnings, { code: 'unexpected', key: 'x', message: 'extra' }] },
      { outcome: 'quick-unverified' }, ...(warnings.length ? [{ warnings: [] }, { warnings: warnings.map(w => ({ ...w, message: w.message + ' changed' })) },
        { warnings: warnings.map(w => ({ ...w, key: 'wrong' })) }, { warnings: warnings.map(w => ({ ...w, code: 'wrong' })) }] : [])])
      assert.throws(() => smoke.requireOutcome(label, { ...result, ...change }, evidence()));
    for (const edit of [e => { e.status = 'failed'; }, e => { e.essenceEvidence.streams[0].timestamps.complete = false; },
      e => { e.essenceEvidence.streams[0].output.contentSha256 = 'b'.repeat(64); }, e => { e.essenceEvidence.streams[0].output.unitCount = '1'; },
      e => { e.verificationMethod = 'complete-native-v1'; }, e => { e.essenceEvidence.verificationMethod = 'complete-native-v1'; }]) {
      const e = evidence(); edit(e); assert.throws(() => smoke.requireOutcome(label, result, e));
    }
  }
});

test('fast proof refuses a slow fallback, missing packet pass, changed child windows and malformed timing metrics', async () => {
  const make = () => ({ copyMs: 1, verificationMs: 60000, evidence: evidence() });
  smoke.requirePerformance(make());
  for (const edit of [r => { r.verificationMs++; }, r => { r.verificationMs = -1; }, r => { r.copyMs = NaN; },
    r => { r.evidence.invocations.shift(); }, r => { r.evidence.invocations.push({ args: ['-show_frames'] }); },
    r => { r.evidence.invocations.at(-1).args[1] = '3'; }, r => { r.evidence.invocations.pop(); },
    r => { r.evidence.invocations.splice(2, 1); }, r => { r.evidence.invocations.splice(4, 1); }, r => { r.evidence.invocations.splice(6, 1); },
    r => { r.evidence.invocations[4].args = r.evidence.invocations[4].args.filter(a => a !== 'pipe:1'); }]) {
    const r = make(); edit(r); assert.throws(() => smoke.requirePerformance(r));
  }
  const file = path.resolve(__dirname, '../scripts/v07-remux-long-smoke.cjs'), source = await fs.readFile(file, 'utf8');
  const before = 'record.verificationMs <= LIMITS.verificationMs'; assert.equal(source.split(before).length, 2);
  const compiled = new Module(file, module); compiled.filename = file; compiled.paths = Module._nodeModulePaths(path.dirname(file));
  compiled._compile(source.replace(before, 'true'), file); const r = make(); r.verificationMs++;
  const negative = api => assert.throws(() => api.requirePerformance(r)); negative(smoke);
  assert.throws(() => negative(compiled.exports), { code: 'ERR_ASSERTION' });
});

test('every grouped evidence child has a unique receipt and a closed main-owned group (each guard mutant killed)', async () => {
  const make = () => {
    const e = evidence(); e.invocations.forEach(c => { c.executable = 'owned-ffmpeg'; }); const n = e.invocations.length;
    return { record: { evidence: e, runtimeGroup: { limit: 2, closed: true, live: 0, liveChildren: 0, started: n, completed: n,
      childrenStarted: n, childrenClosed: n, peakChildren: 2 } }, invocations: e.invocations.map(c => ({ file: c.executable, argv: c.args })) };
  };
  const file = require.resolve('../scripts/v07-remux-long-smoke.cjs'), text = await fs.readFile(file, 'utf8'), Module = require('node:module');
  for (const [guard, replacement, mutate] of [
    ['index >= 0', 'true', x => { x.invocations.pop(); }],
    ['g.limit === 2', 'true', x => { x.record.runtimeGroup.limit = 3; }],
    ['g.closed &&', 'true &&', x => { x.record.runtimeGroup.closed = false; }],
    ['g.live === 0', 'true', x => { x.record.runtimeGroup.live = 1; }],
    ['g.liveChildren === 0', 'true', x => { x.record.runtimeGroup.liveChildren = 1; }],
    ['g.started === record.evidence.invocations.length', 'true', x => { const g = x.record.runtimeGroup; g.started++; g.completed++; g.childrenStarted++; g.childrenClosed++; }],
    ['g.completed === g.started', 'true', x => { x.record.runtimeGroup.completed--; }],
    ['g.childrenStarted === g.started', 'true', x => { x.record.runtimeGroup.childrenStarted--; }],
    ['g.childrenClosed === g.started', 'true', x => { x.record.runtimeGroup.childrenClosed--; }],
    ['g.peakChildren >= 1 && g.peakChildren <= 2', 'true', x => { x.record.runtimeGroup.peakChildren = 3; }],
  ]) {
    const base = make(); smoke.requireChildAccounting(base.record, base.invocations); mutate(base);
    const negative = target => assert.throws(() => target.requireChildAccounting(base.record, base.invocations)); negative(smoke);
    assert.equal(text.split(guard).length, 2, guard); const m = new Module(file, module); m.filename = file; m.paths = Module._nodeModulePaths(path.dirname(file));
    m._compile(text.replace(guard, replacement), file); assert.throws(() => negative(m.exports), { code: 'ERR_ASSERTION' }, guard);
  }
});

test('Q2d sources bind the closed pinned report and exact existing source or published seed without ignored test inputs', () => {
  const report = { id: smoke.MKV_REPORT_ID, status: 'passed-bounded-copy-service', liveChildren: 0, leaseReleased: true, closureFailures: [],
    sources: [], cases: [] };
  for (const p of Object.values(smoke.LEGACY).filter(p => p.kind === 'mkv')) {
    if (p.origin) report.sources.push({ origin: p.file, bytes: p.bytes, sha256: p.sha256 });
    else report.cases.push({ label: p.seed, status: 'passed-real-full-remux-service', output: { file: p.file, bytes: p.bytes, sha256: p.sha256 } });
  }
  for (const [label, p] of Object.entries(smoke.LEGACY).filter(([, p]) => p.kind === 'mkv')) {
    const bytes = Buffer.from(JSON.stringify(report)); assert.throws(() => smoke.legacySource(bytes, label));
    assert.equal(smoke.legacySource(bytes, label, () => smoke.MKV_REPORT_SHA).sha256, p.sha256);
    for (const edit of [r => { r.id = ID; }, r => { r.status = 'failed-retained'; }, r => { r.liveChildren = 1; },
      r => { r.leaseReleased = false; }, r => { r.closureFailures.push('failure'); }, r => {
        if (p.origin) r.sources[0].sha256 = 'f'.repeat(64); else r.cases.find(c => c.label === p.seed).output.bytes++;
      }]) { const r = structuredClone(report); edit(r); assert.throws(() => smoke.legacySource(Buffer.from(JSON.stringify(r)), label, () => smoke.MKV_REPORT_SHA)); }
  }
  const vfr = require('../scripts/v07-remux-mov-vfr-smoke.cjs');
  for (const [name, p] of Object.entries(vfr.FIXTURES)) {
    assert.equal(smoke.LEGACY[name].file, p.file); assert.equal(smoke.LEGACY[name].reportSha256, p.reportSha256);
    assert.throws(() => smoke.legacySource(Buffer.from('{}'), name));
  }
});
test('fixture orchestration uses injected tools only and generates exactly the three owned specimens', async () => {
  const calls = [], session = { owned: path.resolve('inert-owned-fixtures', ID), runtime: { ffmpeg: 'mock-ffmpeg', ffprobe: 'mock-ffprobe' }, controller: new AbortController(), io: {},
    report: { cases: [] }, open: async () => {}, close: async () => {}, save: async () => {},
    run: async (file, args) => { calls.push({ file, args }); const spec = fixtures.FIXTURES.find(s => path.basename(args.at(-1)) === s.name); assert.ok(spec);
      return { exitCode: 0, stdout: JSON.stringify(probe(spec)), stderr: '', stderrCapture: { truncated: false, totalBytes: 0 } }; } };
  const report = await fixtures.createFixtures({ createOwnedSession: () => session,
    hashFile: async file => { const spec = fixtures.FIXTURES.find(s => s.name === path.basename(file)); return { bytes: spec.minBytes || MiB, sha256: 'a'.repeat(64) }; } })(['--run-owned-fixtures']);
  assert.equal(report.status, 'passed-owned-fixtures'); assert.equal(calls.length, 6); assert.equal(report.cases.length, 3);
  assert.equal(calls.filter(c => c.file === 'mock-ffmpeg').length, 3); assert.equal(calls.filter(c => c.file === 'mock-ffprobe').length, 3);
});
test('the observed non-default long MKV pins the exact disclosed singleton and vendor warnings', () => {
  assert.equal(smoke.CASES['mkv-mp4'].refusal, undefined);
  assert.deepEqual(smoke.EXPECTED_WARNINGS['mkv-mp4'].map(w => w.code), ['REMUX_DESCRIPTIVE_METADATA_DIFFERENCE', 'REMUX_SINGLETON_DEFAULT_MARKED']);
});
test('copy growth requires the same live child and an ordinary positive file; every new guard kills its mutant', async () => {
  const file = 'owned-stage', ordinary = () => ({ isFile: () => true, isSymbolicLink: () => false, nlink: 1n, dev: 1n, ino: 2n, size: 64n });
  const io = stat => ({ lstat: async (name, options) => { assert.equal(name, file); assert.deepEqual(options, { bigint: true }); return stat; } });
  assert.deepEqual(await smoke.observeCopyStage(io(ordinary()), file, () => true), { stage: 'copy', bytes: '64', observation: 'owned-stage-growth', liveOwnedChild: true });
  assert.equal(await smoke.observeCopyStage({ lstat: async () => { throw Object.assign(Error('not created'), { code: 'ENOENT' }); } }, file, () => true), null);
  for (const code of ['EACCES', 'EIO', 'EPERM']) await assert.rejects(smoke.observeCopyStage({ lstat: async () => { throw Object.assign(Error(code), { code }); } }, file, () => true), { code });
  const filename = require.resolve('../scripts/v07-remux-long-smoke.cjs'), text = require('node:fs').readFileSync(filename, 'utf8'), Module = require('node:module');
  const mutant = (guard, replacement) => { assert.equal(text.split(guard).length, 2); const m = new Module(filename, module); m.filename = filename;
    m.paths = Module._nodeModulePaths(path.dirname(filename)); m._compile(text.replace(guard, replacement), filename); return m.exports; };
  for (const [guard, edit] of [['stat.isFile()', s => { s.isFile = () => false; }], ['!stat.isSymbolicLink()', s => { s.isSymbolicLink = () => true; }],
    ['stat.nlink === 1n', s => { s.nlink = 2n; }], ['stat.dev !== 0n', s => { s.dev = 0n; }], ['stat.ino !== 0n', s => { s.ino = 0n; }]]) {
    const stat = ordinary(); edit(stat);
    const negative = api => assert.rejects(api.observeCopyStage(io(stat), file, () => true));
    await negative(smoke); await assert.rejects(negative(mutant(guard, 'true')), { code: 'ERR_ASSERTION' });
  }
  for (const [guard, stat, live] of [['stillLive()', ordinary(), false], ['stat.size > 0n', { ...ordinary(), size: 0n }, true]]) {
    const negative = async api => assert.equal(await api.observeCopyStage(io(stat), file, () => live), null);
    await negative(smoke); await assert.rejects(negative(mutant(guard, 'true')), { code: 'ERR_ASSERTION' });
  }
});
test('long smoke wires all routes and cancellations, continues safe failed verdicts and stops every unsafe continuation', async () => {
  for (const scenario of [{ mode: '--normal' }, { mode: '--qualify' }, { mode: '--qualify', copyGrowth: true },
    { mode: '--qualify', timingGap: true }, { mode: '--qualify', timingGap: true, timingMutant: true },
    { mode: '--qualify', failure: 'verdict' }, { mode: '--qualify', failure: 'performance' },
    { mode: '--qualify', failure: 'preparing' },
    ...['lease', 'missing', 'children', 'abort', 'active', 'source', 'reply', 'reply-children'].map(unsafe => ({ mode: '--qualify', failure: 'verdict', unsafe }))]) {
    const { mode } = scenario;
    const fixture = fixtureReport(), fixtureBytes = Buffer.from(JSON.stringify(fixture)), pins = { id: ID, sha256: sha(fixtureBytes) };
    const files = new Map(fixture.cases.map(c => [c.output, c.file])), calls = [], children = new Set(); let activeService, controls, healthChecks = 0;
    const missing = () => Object.assign(new Error('absent'), { code: 'ENOENT' });
    const io = { mkdir: async () => {}, readdir: async dir => [...files.keys()].filter(file => path.dirname(file) === dir).map(file => path.basename(file)), lstat: async file => {
      if (file.endsWith('report.json')) return { size: fixtureBytes.length, isFile: () => true, isSymbolicLink: () => false };
      if (!files.has(file)) throw missing(); return { size: BigInt(files.get(file).bytes), nlink: 1n, dev: 1n, ino: 2n, isFile: () => true, isSymbolicLink: () => false };
    }, readFile: async () => fixtureBytes };
    const session = { owned: path.join('F:\\owned', ID), directory: 'mock-report-directory', runtime: { ffmpeg: 'mock-ffmpeg', ffprobe: 'mock-ffprobe' },
      io, controller: new AbortController(), children, report: { cases: [], acceptedStarts: 0, invocations: [] }, open: async () => {}, close: async () => {
        if (scenario.unsafe) children.clear(); else assert.equal(children.size, 0);
      }, save: async () => {},
      ...(scenario.unsafe === 'missing' ? {} : { assertHealthy: async () => { healthChecks++;
        if (scenario.unsafe === 'lease') throw Object.assign(Error('held lease changed'), { code: 'REMUX_PROOF_UNSAFE_CONTINUATION' });
        if (scenario.unsafe === 'reply') return { leaseIntact: false, liveChildren: 0 };
        if (scenario.unsafe === 'reply-children') return { leaseIntact: true, liveChildren: 1 };
        return { leaseIntact: true, liveChildren: 0 }; } }),
      async run(file, args, options) {
        this.report.invocations.push({ file, argv: args });
        calls.push({ file, args }); const child = new EventEmitter(); child.exitCode = null; child.kill = () => true; children.add(child); options.onChild?.(child);
        if (args.includes('-c')) {
          if (scenario.copyGrowth && activeService.label === 'cancel-copy') {
            // Real 9.0.2 can finish copying before its first progress=continue.
            // Keep only the same live child's positive stage growth observable.
            files.set(args.at(-1), { bytes: 64 });
            const until = Date.now() + 2000;
            while (activeService.phase !== 'cancelled') { assert.ok(Date.now() < until, 'Live stage growth must cancel without a progress record.'); await new Promise(r => setTimeout(r, 5)); }
            files.delete(args.at(-1)); options.onProgress?.({ frame: 5400, bytes: 678829493, ended: true });
          } else options.onProgress?.({ frame: 1, bytes: 64, seconds: 0.01, ended: false });
        }
        else await options.onStdoutChunk?.(Buffer.alloc(4096));
        child.exitCode = 0; child.emit('close', 0); children.delete(child); return { exitCode: 0, stdout: '', stderr: '' };
      } };
    class Service {
      constructor(options) { this.options = options; this.plan = { entries: new Map() }; activeService = this; }
      async initializeDiagnostics() {} async registerFolder(file) { return { id: file }; }
      async prepareRemuxBatch(request) {
        const label = path.basename(request.outputFolderId).replace(/^output-/, ''), c = smoke.CASES[label];
        const name = c.legacy ? path.basename(smoke.LEGACY[c.legacy].file) : fixtures.FIXTURES.find(s => s.id === c.fixture).name;
        this.label = label; this.file = path.join(request.inputFolderId, name); this.destination = path.join(request.outputFolderId, 'published.' + c.target);
        this.item = { id: label, name, status: c.refusal ? 'unsupported' : c.legacy ? 'generated' : 'ready', ...(c.refusal ? { reasonCode: c.refusal } : {}) }; this.phase = 'ready';
        if (scenario.failure === 'preparing' && label === 'mp4-mkv') this.item.status = 'unsupported';
        this.plan.entries.set(label, { destination: this.destination, inspection: { probe: { streams: [{ codec_type: 'video', avg_frame_rate: '10/1', r_frame_rate: '10/1' }] } } }); this.taskPromise = Promise.resolve();
      }
      snapshot() { return { phase: this.phase, planId: 'mock-plan', operationDraft: { id: 'draft', revision: 1 }, items: [structuredClone(this.item)] }; }
      async reencodeOutputs() {
        const count = smoke.CASES[this.label].omissions || 0; this.item.status = count ? 'unsupported' : 'ready';
        this.item.reasonCode = count ? 'REMUX_AUDIO_OMISSION_REQUIRED' : null;
        this.item.remux = { omissionCandidates: Array.from({ length: count }, (_, i) => ({ id: 'audio-' + i, label: 'audio ' + i })) };
      }
      async setRemuxOmissions(request) { assert.equal(request.draftId, 'draft'); assert.equal(request.revision, 1); assert.equal(request.decisionIds.length, smoke.CASES[this.label].omissions); this.item.status = 'ready'; }
      getEncodingDetails() { return { args: ['inert display'] }; }
      startBatch() {
        this.phase = 'running';
        this.taskPromise = (async () => {
          await this.options.run('mock-ffmpeg', ['-n', '-progress', 'pipe:1', '-c', 'copy', this.destination], { onProgress() {} });
          if (scenario.timingGap && this.label === 'large-mp4') await new Promise(resolve => setTimeout(resolve, 60));
          const e = evidence(this.label);
          for (const c of e.invocations) {
            if (this.phase === 'cancelled') return;
            const tool = c.args.some(a => a.startsWith('-show_')) ? 'ffprobe' : 'ffmpeg'; c.executable = 'mock-' + tool;
            await this.options.operationRuntime.invokeRemux({}, tool, c.args, { onStdoutChunk: async () => {} });
          }
          if (this.phase === 'cancelled') return;
          const entry = this.plan.entries.get(this.label); entry.operationEvidence = e;
          entry.operationRuntimeGroup = { limit: 2, closed: true, started: e.invocations.length, completed: e.invocations.length,
            childrenStarted: e.invocations.length, childrenClosed: e.invocations.length, live: 0, liveChildren: 0, peakChildren: 1 };
          if (scenario.failure && this.label === 'mp4-mkv') {
            if (scenario.failure === 'performance') e.invocations.at(-1).args[1] = '2';
            else {
              Object.assign(this.item, { status: 'failed', reasonCode: 'REMUX_AUDIO_TRIM', reason: 'Injected trim mismatch', outputDisposition: { published: false } });
              this.phase = scenario.unsafe === 'active' ? 'preparing' : 'completed';
              if (scenario.unsafe === 'children') children.add(new EventEmitter());
              if (scenario.unsafe === 'abort') session.controller.abort();
              return;
            }
          }
          const vendor = { code: 'REMUX_DESCRIPTIVE_METADATA_DIFFERENCE', key: 'VENDOR_ID', message: "Stream 0 → 0: descriptive metadata 'VENDOR_ID' is missing or changed in its requested representation." };
          const warnings = smoke.EXPECTED_WARNINGS[this.label] || (this.label === 'timeline-video-mp4'
            ? [require('../scripts/v07-remux-mov-vfr-smoke.cjs').AVERAGE_WARNING, vendor] : this.label === 'bframe-video-mp4' ? [vendor] : []);
          files.set(this.destination, { bytes: 123, sha256: e.essenceEvidence.outputFileSha256 });
          Object.assign(this.item, { status: 'success', verificationMethod: 'packet-identity-v1', outcome: warnings.length ? 'saved-with-warning' : 'saved', warnings,
            outputDisposition: { published: true }, evidenceStorage: { final: { violations: [] } } }); this.phase = 'completed';
        })();
      }
      async cancelCurrent() { if (this.phase === 'running') { this.phase = 'cancelled'; this.item.status = 'cancelled'; this.item.outputDisposition = { published: false }; } }
      async closeOperationResources() {} async closeDiagnostics() { return { persisted: true }; }
    }
    let api = smoke;
    if (scenario.timingMutant) {
      const filename = require.resolve('../scripts/v07-remux-long-smoke.cjs'), source = require('node:fs').readFileSync(filename, 'utf8');
      const guard = "if (activeCase.cancel !== 'copy') activeCase.verificationStartedAt ??= finished;";
      assert.equal(source.split(guard).length, 2); const Module = require('node:module'), m = new Module(filename, module);
      m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename)); m._compile(source.replace(guard, ''), filename); api = m.exports;
    }
    const report = await api.createSmoke({ pins, createOwnedSession: () => session, EncoderService: Service, readFixtureReport: async () => fixtureBytes,
      createOperationControls: options => { controls = options; return { operationRuntime: { invoke: async () => {}, invokeRemux: async () => {} } }; },
      copyPinnedFile: async (source, target, expected) => { assert.equal(files.get(source).sha256, expected.sha256); files.set(target, expected); return expected; },
      readLegacySource: async label => { const p = smoke.LEGACY[label], original = { file: p.file, bytes: p.bytes || MiB, sha256: p.sha256 || 'a'.repeat(64) }; files.set(p.file, original); return original; },
      hashFile: async file => { assert.ok(files.has(file));
        if (scenario.unsafe === 'source' && activeService.item.status === 'failed' && file === activeService.file) return { ...files.get(file), sha256: '0'.repeat(64) };
        return files.get(file); },
    })(['--run-owned-remux', mode, '--cases', Object.keys(smoke.CASES).filter(name => !name.startsWith('ts-')).join(',')]);
    assert.ok(activeService); assert.equal(report.status, scenario.failure ? 'failed-retained' : 'passed-owned-long-remux', JSON.stringify(report.failure));
    assert.equal(report.acceptedStarts, scenario.unsafe ? 1 : scenario.failure === 'preparing' ? 13 : 14); assert.equal(report.cases.length, 14);
    assert.equal(report.cases.filter(c => c.status === 'passed-complete-verified-remux').length, scenario.unsafe ? 0 : scenario.failure ? 11 : 12);
    assert.equal(report.cases.filter(c => c.status === 'passed-preservation-refusal' && c.noPublication).length, 0);
    assert.equal(report.cases.filter(c => c.status === 'passed-live-cancellation' && c.noPublication).length, scenario.unsafe ? 0 : 2);
    assert.equal(calls.length, scenario.unsafe ? 8 : scenario.failure === 'preparing' ? 91 : 99); assert.equal(controls.remuxPolicies.length, 6);
    if (scenario.copyGrowth) assert.equal(report.cases.find(c => c.label === 'cancel-copy').cancelObserved.observation, 'owned-stage-growth');
    if (scenario.timingGap) {
      const negative = () => assert.ok(report.cases.find(c => c.label === 'large-mp4').verificationMs >= 60, 'The post-copy verification clock must include setup before the packet child.');
      if (scenario.timingMutant) assert.throws(negative, { code: 'ERR_ASSERTION' }); else negative();
    }
    if (scenario.failure) {
      assert.equal(report.cases[0].status, 'failed-retained'); assert.equal(report.cases[0].continuation.safe, !scenario.unsafe);
      if (scenario.unsafe) assert.equal(report.cases.filter(c => c.status === 'not-run-unsafe').length, 13);
      else { assert.equal(healthChecks, 1); assert.ok(report.cases[0].continuation.leaseIntact); }
    }
    assert.ok(report.cases.filter(c => c.status !== 'not-run-unsafe').every(c => Number.isSafeInteger(c.copyMs) && c.copyMs >= 0 && Number.isSafeInteger(c.verificationMs) && c.peakRssBytes > 0));
  }
});
test('streamed pinned-file copying hashes all bytes, refuses collisions/mismatches/cancellation and preserves sources', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'remux-long-copy-'));
  t.after(async () => { assert.equal(path.dirname(root), os.tmpdir()); assert.ok(path.basename(root).startsWith('remux-long-copy-')); await fs.rm(root, { recursive: true, force: true }); });
  const source = path.join(root, 'source'), output = path.join(root, 'output'), bytes = Buffer.alloc(3 * 65536 + 7, 0x5a);
  await fs.writeFile(source, bytes); const expected = { bytes: bytes.length, sha256: sha(bytes) };
  assert.deepEqual(await fixtures.readBoundedFile(source, bytes.length), bytes);
  await assert.rejects(fixtures.readBoundedFile(source, bytes.length - 1));
  await assert.rejects(fixtures.readBoundedFile(source, 0));
  await assert.rejects(fixtures.readBoundedFile(source, bytes.length, { signal: AbortSignal.abort() }));
  assert.equal((await fixtures.copyPinnedFile(source, output, expected)).sha256, expected.sha256);
  await assert.rejects(fixtures.copyPinnedFile(source, output, expected), { code: 'EEXIST' });
  await assert.rejects(fixtures.copyPinnedFile(source, path.join(root, 'wrong'), { ...expected, sha256: 'b'.repeat(64) }));
  await assert.rejects(fixtures.copyPinnedFile(source, path.join(root, 'cancelled'), expected, { signal: AbortSignal.abort() }));
  await assert.rejects(fixtures.hashFile(source, { signal: AbortSignal.abort() })); assert.deepEqual(await fs.readFile(source), bytes);
});

async function injectedSession(t, api, kind, limits = fixtures.LIMITS) {
  const base = await fs.realpath(os.tmpdir()), home = await fs.mkdtemp(path.join(base, 'remux-growth-session-'));
  const artifactPrefix = path.join(fixtures.ROOT, 'artifacts/v0.7'), control = { onStat: null, onRead: null, lease: null };
  const mapped = file => {
    for (const [prefix, local] of [[fixtures.OWNED, path.join(home, 'owned')], [artifactPrefix, path.join(home, 'artifacts')]])
      if (file === prefix || file.startsWith(prefix + path.sep)) return path.join(local, path.relative(prefix, file));
    return file;
  };
  await fs.mkdir(mapped(fixtures.OWNED)); await fs.mkdir(mapped(artifactPrefix));
  const io = { ...fs,
    lstat: (file, options) => control.onStat ? control.onStat(file, options, () => fs.lstat(mapped(file), options)) : fs.lstat(mapped(file), options),
    readdir: async (file, options) => {
      const names = await fs.readdir(mapped(file), options);
      return control.onRead ? await control.onRead(file, names) : names;
    },
    mkdir: (file, options) => fs.mkdir(mapped(file), options), open: async (file, flags) => {
      const handle = await fs.open(mapped(file), flags); if (path.basename(file) === 'media-job.lock') control.lease = handle;
      if (path.basename(file) === 'report.json') { const write = handle.write.bind(handle);
        handle.write = (...args) => control.onWrite ? control.onWrite(() => write(...args)) : write(...args); }
      if (path.basename(file).startsWith('invocation-')) control.onInvocationOpen?.(handle, file);
      return handle;
    },
    readFile: (file, options) => fs.readFile(mapped(file), options), unlink: file => fs.unlink(mapped(file)),
    statfs: async () => ({ bavail: 1024n * BigInt(GiB), bsize: 1n }),
  };
  const session = api.createOwnedSession({ kind, limits, dependencies: { fs: io, platform: 'win32', randomUUID: () => ID,
    assertOrdinaryPath: async (file, type) => { const s = await fs.lstat(mapped(file)); assert.ok(!s.isSymbolicLink() && (type === 'directory' ? s.isDirectory() : s.isFile())); },
    verifyCandidateRuntime: async () => ({ ffmpeg: path.join(home, 'not-launched-ffmpeg'), ffprobe: path.join(home, 'not-launched-ffprobe'), verified: { scope: 'injected-no-media' } }),
    runTool: (...args) => control.run ? control.run(...args) : assert.fail('This session regression must never run a child.'),
  } });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await session.close(); } };
  t.after(async () => {
    try { await close(); }
    finally {
      const actual = await fs.realpath(home); assert.equal(actual, home); assert.equal(path.dirname(actual), base);
      assert.ok(path.basename(actual).startsWith('remux-growth-session-')); await fs.rm(actual, { recursive: true, force: true });
    }
  });
  await session.open(); return { session, control, mapped, close };
}
async function waitForObservation(session) {
  const until = Date.now() + 5000;
  while (!session.report.monitorFailure && !session.report.freeBytes && !session.report.consecutiveUnstableScans) {
    assert.ok(Date.now() < until, 'The actual periodic monitor did not finish its injected scan.');
    await new Promise(resolve => setImmediate(resolve));
  }
}

async function admissionWidth(t, api = fixtures, kind = 'smoke') {
  const h = await injectedSession(t, api, kind), pending = [], works = [], errors = [];
  h.control.run = (_file, _argv, options) => new Promise(resolve => {
    const child = new EventEmitter(); let done = false;
    const finish = () => { if (done) return; done = true; child.emit('close', 0, null); resolve({ exitCode: 0, stderr: '', stdout: '' }); };
    child.kill = finish; options.onChild(child); pending.push(finish);
    if (options.signal.aborted) finish(); else options.signal.addEventListener('abort', finish, { once: true });
  });
  const width = kind === 'smoke' ? 2 : 1;
  try {
    for (let n = 0; n < width; n++) works.push(h.session.run(h.session.runtime.ffprobe, ['-version']).catch(error => errors.push(error)));
    assert.equal(h.session.report.activeInvocations, width, 'reserve before async namespace/producers checks');
    await assert.rejects(h.session.run('unadmitted-executable', []), /Only a remux smoke session permits two owned invocations/);
    const until = Date.now() + 5000;
    while (pending.length < width && errors.length === 0) { assert.ok(Date.now() < until); await new Promise(resolve => setImmediate(resolve)); }
    assert.equal(errors.length, 0); assert.equal(pending.length, width); pending.forEach(finish => finish()); await Promise.all(works);
    assert.equal(h.session.report.childrenClosed, width); assert.equal(h.session.report.maxConcurrentChildren, width);
    assert.equal(h.session.report.activeInvocations, 0); assert.equal(h.session.report.invocationAttempts, width);
    await assert.rejects(h.session.run('unadmitted-executable', []), /Only the verified paired media runtime/);
    assert.equal(h.session.report.activeInvocations, 0, 'failed preflight releases its ticket');
    await h.session.assertHealthy();
  } finally { h.session.controller.abort(); pending.forEach(finish => finish()); await Promise.all(works); await h.close(); }
}
for (const kind of ['smoke', 'fixtures']) test(`real injected ${kind} session reserves width before async admission and releases failed tickets`, t => admissionWidth(t, fixtures, kind));

async function serialReport(t, api = fixtures) {
  const h = await injectedSession(t, api, 'smoke'); let active = 0, peak = 0;
  h.control.onWrite = async write => { active++; peak = Math.max(peak, active);
    try { await new Promise(resolve => setImmediate(resolve)); return await write(); } finally { active--; } };
  await Promise.all([h.session.save(), h.session.save(), h.session.save()]);
  assert.equal(peak, 1); assert.equal(JSON.parse(await h.session.io.readFile(path.join(h.session.directory, 'report.json'), 'utf8')).id, ID);
  h.control.onWrite = null; await h.close();
}
test('real session serializes concurrent durable report rewrites', serialReport);

test('session admission-width and report-serialization mutants are killed', async t => {
  for (const [before, after, kind] of [
    ["inFlight < (kind === 'smoke' ? 2 : 1)", "inFlight < (kind === 'smoke' ? 3 : 1)", 'smoke'],
    ["inFlight < (kind === 'smoke' ? 2 : 1)", "inFlight < (kind === 'smoke' ? 2 : 2)", 'fixtures'],
  ]) { const api = await mutatedFixtures(before, after); await assert.rejects(admissionWidth(t, api, kind), assert.AssertionError); }
  const api = await mutatedFixtures('const work = saveTail.then(async () => {', 'const work = Promise.resolve().then(async () => {');
  await assert.rejects(serialReport(t, api), assert.AssertionError);
});

test('session permits paired bounded hash pipes and refuses a wider native output', async t => {
  const h = await injectedSession(t, fixtures, 'smoke'), child = new EventEmitter(); child.kill = () => {};
  h.control.run = async (_file, _argv, options) => { options.onChild(child); child.emit('close', 0, null); return { exitCode: 0, stderr: '' }; };
  const args = ['-f', 'framehash', '-hash', 'sha256', '-c:v', 'rawvideo', '-frames:v', '1', 'pipe:1', '-frames:v', '1', 'pipe:3'];
  await h.session.run(h.session.runtime.ffmpeg, args);
  for (const changed of [args.map((v, i) => i === 10 ? '2' : v), args.filter(v => v !== 'pipe:1')]) {
    await assert.rejects(h.session.run(h.session.runtime.ffmpeg, changed), /Only two bounded decoded hash pipes/);
  }
  assert.equal(h.session.report.childrenClosed, 1); await h.close();
});

async function invocationReceipt(t, api = fixtures, mode = 'none') {
  const h = await injectedSession(t, api, 'smoke'), sentinel = path.join(h.session.directory, 'invocation-1-admission.json');
  let children = 0, writes = 0, closes = 0;
  if (mode === 'existing') await fs.writeFile(h.mapped(sentinel), 'protected receipt');
  h.control.onInvocationOpen = handle => {
    const stat = handle.stat.bind(handle), write = handle.writeFile.bind(handle), sync = handle.sync.bind(handle), close = handle.close.bind(handle); let synced = false;
    handle.stat = async (...args) => { const actual = await stat(...args);
      if (mode === 'unsafe' && !synced) actual.nlink = 2n;
      if (mode === 'changed' && synced) actual.ino += 1n; return actual; };
    handle.writeFile = (...args) => { writes++; return write(...args); };
    handle.sync = async () => { if (mode === 'io') throw Object.assign(Error('disk error'), { code: 'EIO' }); await sync(); synced = true; };
    handle.close = async () => { closes++; await close(); if (mode === 'close') throw Object.assign(Error('close error'), { code: 'EIO' }); };
  };
  h.control.run = async (_file, _argv, options) => { children++;
    assert.equal(JSON.parse(await h.session.io.readFile(sentinel, 'utf8')).status, 'running', 'Durable admission exists BEFORE spawn.');
    const child = new EventEmitter(); child.kill = () => {}; options.onChild(child); child.emit('close', 0, null); return { exitCode: 0, stderr: '' }; };
  if (mode === 'none') {
    await h.session.run(h.session.runtime.ffprobe, ['-version']); assert.equal(children, 1); assert.equal(closes, 2);
    const closed = JSON.parse(await h.session.io.readFile(path.join(h.session.directory, 'invocation-1-close.json'), 'utf8'));
    assert.equal(closed.status, 'completed'); assert.equal(closed.closed.code, 0); assert.equal(closed.ordinal, 1); assert.ok(closed.executorSettledAt >= closed.executorStartedAt);
  } else {
    await assert.rejects(h.session.run(h.session.runtime.ffprobe, ['-version']), { code: 'REMUX_PROOF_INVOCATION_RECEIPT' });
    assert.equal(children, 0); assert.equal(h.session.controller.signal.aborted, true); assert.ok(h.session.report.invocationPersistenceFailure);
    if (mode === 'unsafe') assert.equal(writes, 0);
    if (mode === 'existing') assert.equal(await fs.readFile(h.mapped(sentinel), 'utf8'), 'protected receipt'); else assert.equal(closes, 1);
  }
  await h.close();
}
test('real session seals tiny exclusive admission and close receipts before the full case report', invocationReceipt);
for (const mode of ['existing', 'unsafe', 'changed', 'io', 'close']) test(`invocation receipt ${mode} failure aborts before spawn and retains owned evidence`, t => invocationReceipt(t, fixtures, mode));
test('durable invocation admission/exclusivity/ordinary identity guards kill their mutants', async t => {
  for (const [before, after, mode] of [
    ["handle = await io.open(file, 'wx+'); const created", "handle = await io.open(file, 'w+'); const created", 'existing'],
    ["ordinary(created) && created.size === 0n, 'Ordinary exclusive invocation receipt required.'", "true, 'Ordinary exclusive invocation receipt required.'", 'unsafe'],
    ["ordinary(after) && same(after, named) && after.size === BigInt(data.length)\n        && after.dev === created.dev && after.ino === created.ino && after.birthtimeNs === created.birthtimeNs", 'true', 'changed'],
  ]) { const api = await mutatedFixtures(before, after); await assert.rejects(invocationReceipt(t, api, mode), assert.AssertionError); }
});
test('actual owned session continuation proves the held lease and refuses leaked children, abort, token/identity changes and unsafe storage', async t => {
  const leasePath = path.join(fixtures.ROOT, 'artifacts/v0.7/media-job.lock');
  for (const failure of ['none', 'children', 'abort', 'token', 'large', 'identity', 'io', 'storage', 'links', 'truncated']) {
    const h = await injectedSession(t, fixtures, 'smoke'), localLease = h.mapped(leasePath), original = await fs.readFile(localLease);
    const statfs = h.session.io.statfs, child = new EventEmitter(), read = h.control.lease.read; let reads = 0;
    try {
      if (failure === 'children') h.session.children.add(child);
      if (failure === 'abort') h.session.controller.abort();
      if (failure === 'token') await fs.writeFile(localLease, JSON.stringify({ token: 'foreign' }));
      if (failure === 'large') await fs.writeFile(localLease, Buffer.concat([original, Buffer.alloc(5000, 32)]));
      if (failure === 'identity') h.control.onStat = async (file, options, read) => { const stat = await read(); if (file === leasePath) stat.ino++; return stat; };
      if (failure === 'io') h.control.onStat = async (file, options, read) => { if (file === leasePath) throw Object.assign(Error('injected access denied'), { code: 'EACCES' }); return read(); };
      if (failure === 'storage') h.session.io.statfs = async () => ({ bavail: 1n, bsize: 1n });
      if (failure === 'links') await fs.link(localLease, localLease + '.owned-link');
      if (failure === 'truncated') h.control.lease.read = async () => {
        if (reads++) throw Object.assign(Error('A missing no-progress guard would loop.'), { code: 'SECOND_READ' }); return { bytesRead: 0 };
      };
      if (failure === 'none') assert.deepEqual(await h.session.assertHealthy(), { leaseIntact: true, liveChildren: 0 });
      else await assert.rejects(h.session.assertHealthy(), failure === 'io' ? { code: 'EACCES' } : undefined);
      assert.equal(h.session.report.invocations.length, 0, 'No media or other child is needed for a safety checkpoint.');
    } finally {
      h.session.children.delete(child); h.control.onStat = null; h.session.io.statfs = statfs; h.control.lease.read = read;
      if (failure === 'links') await fs.unlink(localLease + '.owned-link');
      if (['token', 'large'].includes(failure)) await fs.writeFile(localLease, original);
      await h.close();
    }
    await assert.rejects(h.session.assertHealthy(), { code: 'REMUX_PROOF_UNSAFE_CONTINUATION' });
  }
});
test('owned-session continuation guards kill their own child/token/size removal mutants', async t => {
  const leasePath = path.join(fixtures.ROOT, 'artifacts/v0.7/media-job.lock');
  for (const [guard, replacement, failure] of [
    ["children.size === 0 && inFlight === 0, 'A previous case still owns a live child or invocation.'", "true, 'A previous case still owns a live child or invocation.'", 'children'],
    ["JSON.parse(bytes.toString('utf8')).token === id", 'true', 'token'], ['named.size <= 4096n', 'true', 'large'], ['read.bytesRead > 0', 'true', 'truncated'],
  ]) {
    const negative = async api => {
      const h = await injectedSession(t, api, 'smoke'), file = h.mapped(leasePath), original = await fs.readFile(file), child = new EventEmitter(), read = h.control.lease.read; let reads = 0;
      try {
        if (failure === 'children') h.session.children.add(child);
        if (failure === 'token') await fs.writeFile(file, JSON.stringify({ token: 'foreign' }));
        if (failure === 'large') await fs.writeFile(file, Buffer.concat([original, Buffer.alloc(5000, 32)]));
        if (failure === 'truncated') h.control.lease.read = async () => {
          if (reads++) throw Object.assign(Error('missing no-progress guard'), { code: 'SECOND_READ' }); return { bytesRead: 0 };
        };
        await assert.rejects(h.session.assertHealthy(), { code: 'REMUX_PROOF_UNSAFE_CONTINUATION' });
      } finally { h.session.children.delete(child); h.control.lease.read = read; await fs.writeFile(file, original); await h.close(); }
    };
    await negative(fixtures); await assert.rejects(negative(await mutatedFixtures(guard, replacement)), { code: 'ERR_ASSERTION' });
  }
});
async function cleanupSessionRegression(t, api, kind) {
  const h = await injectedSession(t, api, kind), { session, control, mapped } = h;
  const stage = path.join(session.owned, '.ffmpeg-encoder-inert'), encoded = path.join(stage, 'encoded.mkv'), published = path.join(session.owned, 'published.mkv');
  const payload = Buffer.from('Owned inert publication bytes; no media process.');
  await fs.mkdir(mapped(stage)); await fs.writeFile(mapped(encoded), payload); await fs.link(mapped(encoded), mapped(published));
  let enumerated = false, removed = 0, rootListings = 0;
  control.onRead = async (file, names) => { if (file === session.owned) rootListings++; if (file === stage) enumerated = names.includes('encoded.mkv'); return names; };
  control.onStat = async (file, _options, original) => {
    if (file === encoded && enumerated && removed === 0) {
      await fs.unlink(mapped(encoded)); await fs.rmdir(mapped(stage)); removed++;
    }
    return original();
  };
  session.report.status = 'passed-injected-publication'; t.mock.timers.tick(750); await waitForObservation(session); await h.close();
  assert.equal(removed, 1); assert.ok(rootListings >= 4, 'Discard the raced pass and complete a fresh namespace scan.');
  assert.equal(session.controller.signal.aborted, false); assert.equal(session.report.monitorFailure, undefined);
  assert.equal(session.report.status, 'passed-injected-publication'); assert.equal(session.report.ownedBytes, payload.length);
  assert.equal(session.report.liveChildren, 0); assert.equal(session.report.invocations.length, 0);
  assert.equal(session.report.leaseReleased, true); assert.deepEqual(session.report.closureFailures, []);
  assert.deepEqual(await fs.readFile(mapped(published)), payload);
}
test('actual fixture and smoke session monitors survive listed-stage cleanup without losing a valid publication', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const kind of ['fixtures', 'smoke']) await cleanupSessionRegression(t, fixtures, kind);
});
test('real-session regression kills removal of the listed-entry disappearance retry', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const mutant = await mutatedFixtures("if (listed && error.code === 'ENOENT') { changed = true; return null; }", 'if (false) { changed = true; return null; }');
  await assert.rejects(cleanupSessionRegression(t, mutant, 'smoke'), { code: 'ERR_ASSERTION' });
});
test('a namespace-consistent rescan counts additions once even with unchanged directory clock precision', async () => {
  async function positive(api) {
    const h = scanTree(); h.add(h.child('a'), 'file', 7n);
    h.control.onRead = (file, names, count) => { if (file === h.root && count === 2) { h.add(h.child('b'), 'file', 11n); return [...names, 'b']; } return names; };
    assert.equal(await api.ownedBytes(h.root, h.io), 18); assert.equal(h.calls.read.get(h.root), 4);
  }
  await positive(fixtures);
  const mutant = await mutatedFixtures('if (!changed) return Number(total);', 'return Number(total);');
  await assert.rejects(positive(mutant), { code: 'ERR_ASSERTION' });
});
test('a retry discards bytes counted before cleanup instead of retaining a partial total', async () => {
  const h = scanTree(); h.add(h.child('a-stage'), 'file', 100n); h.add(h.child('b-published'), 'file', 7n);
  h.control.onStat = (file, stat, count) => { if (file === h.child('b-published') && count === 1) h.nodes.delete(h.child('a-stage')); return stat; };
  assert.equal(await fixtures.ownedBytes(h.root, h.io), 7); assert.equal(h.calls.read.get(h.root), 4);
});
test('persistent cleanup churn stops after three whole scans with its specific refusal code', async () => {
  async function negative(api) {
    const h = scanTree(); h.add(h.child('vanished'));
    h.control.onStat = file => { if (file === h.child('vanished')) throw absent(); };
    await assert.rejects(api.ownedBytes(h.root, h.io), error => error.code === 'REMUX_OWNED_SCAN_UNSTABLE' && error.attempts === 3);
    assert.equal(h.calls.stat.get(h.child('vanished')), 3); assert.equal(h.calls.read.get(h.root), 6);
  }
  assert.equal(fixtures.MAX_OWNED_SCAN_ATTEMPTS, 3); await negative(fixtures);
  const mutant = await mutatedFixtures('const MAX_OWNED_SCAN_ATTEMPTS = 3;', 'const MAX_OWNED_SCAN_ATTEMPTS = 4;');
  await assert.rejects(negative(mutant), { code: 'ERR_ASSERTION' });
});
test('unsafe later objects cannot hide behind an earlier disappeared name', async () => {
  for (const unsafe of ['link', 'special', 'unknown-identity']) {
    const h = scanTree(); h.add(h.child('a-vanished')); const bad = h.add(h.child('z-unsafe'));
    if (unsafe === 'link') bad.link = true; else if (unsafe === 'special') bad.kind = 'special'; else bad.ino = 0n;
    h.control.onStat = file => { if (file === h.child('a-vanished')) throw absent(); };
    await assert.rejects(fixtures.ownedBytes(h.root, h.io), /links\/special files|unknown identity/);
    assert.equal(h.calls.read.get(h.root), 1, 'An unsafe object must abort the pass rather than retry.');
    assert.equal(h.calls.stat.get(h.child('z-unsafe')), 1);
  }
});
test('unsafe-object guard mutant is rejected by its own negative', async () => {
  async function negative(api) { const h = scanTree(); h.add(h.child('link')).link = true; await assert.rejects(api.ownedBytes(h.root, h.io), /links\/special files/); }
  await negative(fixtures);
  const mutant = await mutatedFixtures('!s.isSymbolicLink() && (s.isFile() || s.isDirectory())', '(s.isFile() || s.isDirectory())');
  await assert.rejects(negative(mutant), { code: 'ERR_ASSERTION' });
});
test('file and directory identity changes are fatal within a pass and across retries', async () => {
  async function negativeFile(api) {
    const h = scanTree(); h.add(h.child('file'));
    h.control.onStat = (file, stat, count) => file === h.child('file') && count === 2 ? { ...stat, ino: stat.ino + 1n } : stat;
    await assert.rejects(api.ownedBytes(h.root, h.io), /file changed identity/); assert.equal(h.calls.read.get(h.root), 1);
  }
  async function negativeDirectory(api, retry) {
    const h = scanTree(); h.add(h.child('file'));
    if (retry) { h.add(h.child('vanished')); h.control.onRead = (file, names, count) => { if (file === h.root && count === 1) h.nodes.delete(h.child('vanished')); return names; }; }
    h.control.onStat = (file, stat, count) => file === h.root && count >= (retry ? 3 : 2) ? { ...stat, ino: stat.ino + 1n } : stat;
    await assert.rejects(api.ownedBytes(h.root, h.io), /directory changed identity/);
  }
  await negativeFile(fixtures); await negativeDirectory(fixtures, false); await negativeDirectory(fixtures, true);
  await assert.rejects(negativeFile(await mutatedFixtures('after.isFile() && sameObject(before, after)', 'after.isFile()')), { code: 'ERR_ASSERTION' });
  await assert.rejects(negativeDirectory(await mutatedFixtures('after.isDirectory() && sameObject(before, after)', 'after.isDirectory()'), false), { code: 'ERR_ASSERTION' });
  await assert.rejects(negativeDirectory(await mutatedFixtures('!prior || sameObject(prior, before)', 'true'), true), { code: 'ERR_ASSERTION' });
});
test('all other stat/read errors and a missing scan root retain their original failure without retry', async () => {
  for (const code of ['EACCES', 'EPERM', 'EIO', 'ENOTDIR', 'ENOSPC']) for (const action of ['stat', 'read']) {
    const h = scanTree(), file = h.child('child'); h.add(file, action === 'read' ? 'directory' : 'file');
    const error = Object.assign(new Error('ENOENT text is not a disappearance grant'), { code });
    if (action === 'stat') h.control.onStat = name => { if (name === file) throw error; };
    else h.control.onRead = name => { if (name === file) throw error; };
    await assert.rejects(fixtures.ownedBytes(h.root, h.io), value => value === error); assert.equal(h.calls.read.get(h.root), 1);
  }
  const root = scanTree(); root.nodes.delete(root.root);
  await assert.rejects(fixtures.ownedBytes(root.root, root.io), { code: 'ENOENT' }); assert.equal(root.calls.stat.get(root.root), 1);
  const existing = scanTree(); existing.add(existing.child('directory'), 'directory');
  existing.control.onRead = file => { if (file !== existing.root) throw absent(); };
  await assert.rejects(fixtures.ownedBytes(existing.root, existing.io), { code: 'ENOENT' }); assert.equal(existing.calls.read.get(existing.root), 1);
});
test('the actual monitor aborts unsafe objects/errors immediately and bounds consecutive noisy namespace samples', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  for (const mode of ['link', 'special', 'EACCES', 'persistent-churn']) {
    const h = await injectedSession(t, fixtures, 'smoke'), file = path.join(h.session.owned, 'encoded.mkv'); await fs.writeFile(h.mapped(file), 'owned inert');
    h.control.onStat = async (name, _options, original) => {
      if (name !== file) return original();
      if (mode === 'EACCES') throw Object.assign(new Error('denied'), { code: 'EACCES' });
      if (mode === 'persistent-churn') throw absent();
      const stat = await original(); if (mode === 'link') stat.isSymbolicLink = () => true; else { stat.isFile = () => false; stat.isDirectory = () => false; }
      return stat;
    };
    h.session.report.status = 'passed-before-monitor'; t.mock.timers.tick(750); await waitForObservation(h.session);
    if (mode === 'persistent-churn') {
      assert.equal(h.session.controller.signal.aborted, false); assert.equal(h.session.report.consecutiveUnstableScans, 1);
      for (let n = 1; n < 5; n++) {
        t.mock.timers.tick(1000);
        while (!h.session.report.monitorFailure && h.session.report.consecutiveUnstableScans === n) await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(h.session.report.consecutiveUnstableScans, 5);
    }
    await h.close();
    assert.equal(h.session.controller.signal.aborted, true); assert.equal(h.session.report.status, 'failed-retained');
    assert.equal(h.session.report.monitorFailure.code, mode === 'persistent-churn' ? 'REMUX_OWNED_SCAN_UNSTABLE' : mode === 'EACCES' ? 'EACCES' : 'ERR_ASSERTION');
    assert.equal(h.session.report.invocations.length, 0); assert.equal(h.session.report.liveChildren, 0); assert.equal(h.session.report.leaseReleased, true);
  }
});
test('a transient noisy namespace cannot cancel a valid case and never suppresses storage or strict admission checks', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = await injectedSession(t, fixtures, 'smoke'), file = path.join(h.session.owned, 'encoded.mkv'); await fs.writeFile(h.mapped(file), 'owned');
  h.control.onStat = async (name, options, read) => { if (name === file) throw absent(); return read(); };
  t.mock.timers.tick(750); await waitForObservation(h.session); assert.equal(h.session.report.consecutiveUnstableScans, 1);
  assert.equal(h.session.controller.signal.aborted, false);
  await assert.rejects(h.session.assertHealthy(), { code: 'REMUX_OWNED_SCAN_UNSTABLE' }, 'A noisy sample is never admission authority.');
  h.control.onStat = null; t.mock.timers.tick(1000);
  while (h.session.report.consecutiveUnstableScans) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.session.report.ownedBytes, 5); assert.equal(h.session.controller.signal.aborted, false);
  const statfs = h.session.io.statfs; h.session.io.statfs = async () => ({ bavail: 1n, bsize: 1n });
  h.control.onStat = async (name, options, read) => { if (name === file) throw absent(); return read(); };
  t.mock.timers.tick(1000);
  while (!h.session.report.monitorFailure) await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.session.controller.signal.aborted, true); assert.notEqual(h.session.report.monitorFailure.code, 'REMUX_OWNED_SCAN_UNSTABLE');
  h.control.onStat = null; h.session.io.statfs = statfs; await h.close();
});
test('four noisy periodic samples are deferred and the fifth aborts; both retry-bound mutants are killed', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  async function negative(api, expectAbort, tickCount) {
    const h = await injectedSession(t, api, 'smoke'), file = path.join(h.session.owned, 'encoded.mkv'); await fs.writeFile(h.mapped(file), 'owned');
    h.control.onStat = async (name, options, read) => { if (name === file) throw absent(); return read(); };
    try {
      for (let n = 0; n < tickCount; n++) {
        t.mock.timers.tick(1000);
        while (!h.session.report.monitorFailure && (h.session.report.consecutiveUnstableScans || 0) <= n) await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(h.session.controller.signal.aborted, expectAbort);
    } finally { h.control.onStat = null; await h.close(); }
  }
  await negative(fixtures, false, 4); await negative(fixtures, true, 5);
  await assert.rejects(negative(await mutatedFixtures('report.consecutiveUnstableScans <= 4', 'report.consecutiveUnstableScans < 4'), false, 4), { code: 'ERR_ASSERTION' });
  await assert.rejects(negative(await mutatedFixtures('report.consecutiveUnstableScans <= 4', 'true'), true, 5), { code: 'ERR_ASSERTION' });
});
test('structural, filename and exact-byte guards remain enforced during retryable scans', async () => {
  for (const invalid of ['', '.', '..', 'a/b', 'a\\b', 1]) {
    const h = scanTree(); h.control.onRead = () => [invalid]; await assert.rejects(fixtures.ownedBytes(h.root, h.io));
  }
  const duplicate = scanTree(); duplicate.control.onRead = () => ['same', 'same']; await assert.rejects(fixtures.ownedBytes(duplicate.root, duplicate.io));
  const huge = scanTree(); huge.add(huge.child('file'), 'file', BigInt(Number.MAX_SAFE_INTEGER) + 1n);
  await assert.rejects(fixtures.ownedBytes(huge.root, huge.io), /exact representation/);
  const shrink = scanTree(); shrink.add(shrink.child('file'), 'file', 7n);
  shrink.control.onStat = (file, stat, count) => file !== shrink.root && count === 2 ? { ...stat, size: 6n } : stat;
  await assert.rejects(fixtures.ownedBytes(shrink.root, shrink.io), /shrank/);
  const unknownSize = scanTree(); unknownSize.add(unknownSize.child('file'), 'file', 7n);
  unknownSize.control.onStat = (file, stat, count) => file !== unknownSize.root && count === 2 ? { ...stat, size: '7' } : stat;
  await assert.rejects(fixtures.ownedBytes(unknownSize.root, unknownSize.io), /unknown size/);
  const clock = scanTree(); clock.control.onStat = (_file, stat) => ({ ...stat, mtimeNs: undefined });
  await assert.rejects(fixtures.ownedBytes(clock.root, clock.io), /directory time/);
  const depth = scanTree(); let nested = depth.root; for (let i = 0; i < 17; i++) { nested = path.join(nested, 'd'); depth.add(nested, 'directory'); }
  await assert.rejects(fixtures.ownedBytes(depth.root, depth.io), /structural ceiling/);
  const entries = scanTree(); entries.control.onRead = () => Array.from({ length: 8193 }, (_, i) => String(i));
  await assert.rejects(fixtures.ownedBytes(entries.root, entries.io), /structural ceiling/);
});

test('historical Windows ownership stays Windows-specific while neutral argv refuses relative roots',()=>{
  assert.equal(path.win32.parse(fixtures.OWNED).root,'F:\\');assert(path.win32.isAbsolute(fixtures.OWNED));
  const spec=fixtures.FIXTURES.find(x=>x.id==='LARGE_MP4');
  assert.throws(()=>fixtures.generationArgs(spec,path.join('relative-owned',spec.name)),/Exact owned fixture output required/);
  const args=fixtures.generationArgs(spec,path.resolve('inert-owned-fixtures',spec.name));assert.equal(args.at(-1),path.resolve('inert-owned-fixtures',spec.name));
});
