'use strict';

// Root-scheduled copy-only development verification. All masters are known
// owned fixtures; no personal footage, benchmark or encoder search is involved.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const FIXTURES = path.join(ROOT, 'artifacts/v0.7/slice2/envelope-fixtures/6b317682-605b-4d40-8ff3-b3f84678f0ae/report.json');
const OLD_AAC = path.join(OWNED, 'outputs/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/aac-calibration-delayed.mkv');
const ENTRY_MODULES = ['main.js', 'preload.js', 'scripts/v07-remux-service-smoke.cjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const labPolicies = ['isobmff:matroska', 'isobmff:mp4', 'matroska:matroska', 'matroska:mp4'].map(route => {
  const [inputFamily, target] = route.split(':');
  return { id: 'slice3-' + inputFamily + '-' + target, inputFamily, target,
    evidenceIds: ['slice3-prospective-service-qualification'], allowAncillary: inputFamily === 'matroska' && target === 'matroska',
    runtimeIdentity: '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6' };
});
async function main() {
  const cli = process.argv.slice(2); assert.equal(cli[0], '--run-owned-remux');
  assert.ok(cli[1] === '--qualify' || cli[1] === '--normal');
  assert.equal(cli[2], '--cases'); assert.ok(cli.length === 4 || cli.length === 5 && cli[4] === '--lifecycle');
  const choices = cli[3].split(','), allowed = ['E-mkv', 'E-mp4', 'A-mp4', 'D-mkv', 'rich-mkv', 'timeline-mkv', 'timeline-video-mp4', 'B-video-mkv'];
  assert.ok(choices.length > 0 && new Set(choices).size === choices.length && choices.every(value => allowed.includes(value)));
  const id = randomUUID(), directory = path.join(ROOT, 'artifacts/v0.7/slice3/service', id);
  const owned = path.join(OWNED, 'outputs', 'remux-service-' + id), stateDir = path.join(owned, 'state');
  const leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock'), children = new Set();
  let runtime, service, lease, leaseIdentity, cancelOnEvidence = false, corruptNextCopy = false;
  const controller = new AbortController();
  const report = { schema: 1, id, status: 'running', startedAt: new Date().toISOString(), directory, owned,
    mode: cli[1], cases: [], invocations: [], maxConcurrentChildren: 0,
    limits: { totalMs: 30 * 60000, forecastBytes: 1024 ** 3, maxInvocations: 512 },
    limitations: ['Real service, not native BrowserWindow/picker/portable acceptance.',
      cli[1] === '--qualify' ? 'Prospective main-trusted laboratory policies; not default catalog enablement.' : 'Normal fixed production policy/catalog.',
      'Full-only copy; no benchmark, quality/default search or personal media.', 'Distinct destinations; no new same-folder eligibility claim.'] };
  const save = () => { const text = JSON.stringify(report, null, 2); assert.ok(Buffer.byteLength(text) <= 32 * 1024 * 1024, 'Bounded report'); return fs.writeFile(path.join(directory, 'report.json'), text); };
  const timer = setTimeout(() => { controller.abort(); void service?.cancelCurrent(); }, report.limits.totalMs); timer.unref();
  const sources = [];
  async function freezeModules() {
    const entries = await fs.readdir(path.join(ROOT, 'src'), { withFileTypes: true });
    assert.ok(entries.length <= 128 && entries.every(value => value.isFile() && !value.isSymbolicLink() && value.name.endsWith('.cjs')));
    const files = [...ENTRY_MODULES, ...entries.map(value => 'src/' + value.name)].sort();
    return Promise.all(files.map(async file => {
      const source = path.join(ROOT, file), stat = await fs.lstat(source);
      assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= 2 * 1024 ** 2);
      return { file, sha256: sha(await fs.readFile(source)) };
    }));
  }
  async function space() {
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]);
    const value = { DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize, at: new Date().toISOString() };
    assert.ok(value.DFreeBytes >= 25 * 1024 ** 3 && value.FFreeBytes >= report.limits.forecastBytes + 512 * 1024 ** 2); return value;
  }
  async function run(file, args, options = {}, execute = runTool) {
    assert.ok(!controller.signal.aborted); assert.equal(children.size, 0); assert.ok(report.invocations.length < report.limits.maxInvocations);
    const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    if (path.normalize(file).toLowerCase() === path.normalize(helper).toLowerCase()) {
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
      assert.equal(args.length, 5); assert.ok(args[4].includes('[System.IO.DriveInfo]::new')); assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' });
    } else assert.ok([runtime.ffmpeg, runtime.ffprobe].includes(file));
    assert.ok(!args.includes('-y'));
    for (let i = 0; i < args.length; i++) if (['-i', '-attach'].includes(args[i])) assert.ok(args[i + 1].startsWith(owned + path.sep));
    if (file === runtime.ffmpeg && args.at(-1) !== '-' && args.at(-1) !== 'pipe:1') {
      assert.equal(args[args.indexOf('-c') + 1], 'copy', 'Every file-writing job is stream copy; no encodes authorized by this harness.');
      assert.ok(args.at(-1).startsWith(owned + path.sep));
    }
    assert.deepEqual(await freezeModules(), report.sourcesBefore);
    const entry = { file, args, status: 'running', startedAt: new Date().toISOString() }; report.invocations.push(entry); await save();
    let child;
    try {
      const value = await execute(file, args, { ...options, signal: options.signal || controller.signal, onChild(value) {
        child = value; children.add(value); report.maxConcurrentChildren = Math.max(report.maxConcurrentChildren, children.size);
        value.once('close', (code, signal) => { entry.closed = { code, signal }; children.delete(value); }); options.onChild?.(value);
        if (cancelOnEvidence && service.snapshot().progress?.stage === 'evidence-collection') {
          cancelOnEvidence = false; setImmediate(() => void service.cancelCurrent());
        }
      } });
      entry.status = 'completed'; entry.exitCode = value.exitCode; entry.stderr = value.stderr; entry.stderrCapture = value.stderrCapture;
      if (corruptNextCopy && file === runtime.ffmpeg && args.includes('-c') && args[args.indexOf('-c') + 1] === 'copy') {
        corruptNextCopy = false; await fs.writeFile(args.at(-1), 'INTENTIONALLY INVALID OWNED NEGATIVE FIXTURE'); entry.injectedInvalidOutput = true;
      }
      return value;
    } catch (error) { Object.assign(entry, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, stderrCapture: error.stderrCapture }); throw error; }
    finally { if (child) assert.ok(entry.closed); entry.finishedAt = new Date().toISOString(); await save(); }
  }
  async function copySource(file, name, expectedSha) {
    const before = await fs.lstat(file, { bigint: true }); assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n);
    const bytes = await fs.readFile(file); const after = await fs.lstat(file, { bigint: true });
    for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.equal(before[key], after[key]);
    assert.ok(bytes.length <= 512 * 1024 ** 2); if (expectedSha) assert.equal(sha(bytes), expectedSha);
    const folder = path.join(owned, 'input-' + name); await fs.mkdir(folder); const target = path.join(folder, path.basename(file)); await fs.writeFile(target, bytes, { flag: 'wx' });
    sources.push({ file: target, sha256: sha(bytes), origin: file, bytes: bytes.length }); return target;
  }
  async function prepare(file, output, target) {
    const a = await service.registerFolder(path.dirname(file), 'input'), b = await service.registerFolder(output, 'output');
    await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target }); await service.taskPromise;
    let s = service.snapshot(); assert.equal(s.phase, 'ready', s.error); let item = s.items.find(value => value.name === path.basename(file));
    const generatedExcluded = item.status === 'generated';
    if (generatedExcluded) { await service.reencodeOutputs({ planId: s.planId, fileIds: [item.id] }); await service.taskPromise; s = service.snapshot(); item = s.items.find(value => value.id === item.id); }
    return { s, item, generatedExcluded };
  }
  async function job(label, file, target, { omitAudio = false, omissionCount = 2, initialStatus = 'unsupported', failure = false, cancel = false } = {}) {
    const output = path.join(owned, 'output-' + label); await fs.mkdir(output);
    const record = { label, source: file, target, status: 'preparing', controlledInvalidOutput: failure, cancellation: cancel }; report.cases.push(record); await save();
    let { s, item } = await prepare(file, output, target);
    record.initial = s;
    if (omitAudio) {
      assert.equal(item.status, initialStatus);
      if (initialStatus === 'unsupported') assert.match(item.reason, /AAC|priming|Matroska/i);
      const ids = item.remux.omissionCandidates.filter(value => /audio/.test(value.label)).map(value => value.id); assert.equal(ids.length, omissionCount);
      await service.setRemuxOmissions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: ids });
      await service.taskPromise; s = service.snapshot(); item = s.items.find(value => value.id === item.id); record.omissionIds = ids;
    }
    record.prepared = s; assert.equal(item.status, 'ready', item.reason);
    record.detailsBefore = service.getEncodingDetails({ planId: s.planId, fileId: item.id });
    corruptNextCopy = failure; cancelOnEvidence = cancel;
    service.startBatch({ planId: s.planId, fileIds: [item.id] }); await service.taskPromise;
    record.result = service.snapshot(); const result = record.result.items.find(value => value.id === item.id), entry = service.plan.entries.get(item.id);
    record.detailsAfter = service.getEncodingDetails({ planId: s.planId, fileId: item.id }); record.evidence = entry.operationEvidence;
    if (failure || cancel) {
      assert.equal(result.status, cancel ? 'cancelled' : 'failed', result.reason);
      assert.equal(await fs.stat(entry.destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false);
      record.status = cancel ? 'passed-real-cancel-without-publication' : 'passed-invalid-output-refusal';
    } else {
      assert.equal(result.status, 'success', result.reason); assert.equal(record.evidence.status, 'completed'); assert.equal(result.evidenceStorage.final.violations.length, 0);
      if (label === 'E-mp4') {
        // Explicit owner metadata amendment: producer labels are descriptive,
        // not a content-equivalence exception. Functional validation still ran.
        assert.equal(result.outcome, 'saved-with-warning');
        assert.equal((result.warnings || []).filter(value => /vendor_id/i.test(value.message)).length, 2);
      }
      record.output = { file: entry.destination, bytes: (await fs.stat(entry.destination)).size, sha256: sha(await fs.readFile(entry.destination)) };
      record.status = 'passed-real-full-remux-service';
    }
    assert.equal(children.size, 0); await save(); return record;
  }
  try {
    await fs.mkdir(directory, { recursive: true }); await fs.mkdir(owned); await fs.mkdir(stateDir); report.resourcesBefore = await space(); await save();
    lease = await fs.open(leasePath, 'wx+'); await lease.writeFile(JSON.stringify({ token: id, pid: process.pid, purpose: 'Bounded Slice3 Remux root-only copy/proof' })); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true });
    runtime = await verifyCandidateRuntime({ root: ROOT }); report.runtime = runtime.verified; report.sourcesBefore = await freezeModules();
    const controls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
      ...(cli[1] === '--qualify' ? { remuxPolicies: labPolicies, remuxPolicyIdentity: 'slice3-prospective-native-service-v1' } : {}) });
    const observed = controls.operationRuntime, invoke = observed.invoke.bind(observed);
    observed.invoke = (token, tool, args, options) => run(runtime[tool], args, options, (_file, argv, opts) => invoke(token, tool, argv, opts));
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, inspectionWorkers: 1,
      runtimeIdentity: FAMILIES[0].runtimeIdentity, run, ...controls }); await service.initializeDiagnostics();
    const fixtures = JSON.parse(await fs.readFile(FIXTURES, 'utf8'));
    const cache = new Map();
    async function source(specimen) { if (!cache.has(specimen)) { const value = fixtures.cases.find(value => value.id === specimen); cache.set(specimen, await copySource(value.output, specimen, value.file.sha256)); } return cache.get(specimen); }
    let rich;
    async function richSource() {
      if (rich) return rich; const base = await source('B'), support = path.join(owned, 'rich-support'); await fs.mkdir(support);
      const subtitle = path.join(support, 'events.srt'), styled = path.join(support, 'events.ass'), chapters = path.join(support, 'chapters.txt'), attachment = path.join(support, 'opaque-fixture.ttf');
      await fs.writeFile(subtitle, '1\n00:00:00,250 --> 00:00:02,000\nOwned subtitle event\n\n2\n00:00:04,000 --> 00:00:06,500\nSecond event\n');
      await fs.writeFile(styled, '[Script Info]\nScriptType: v4.00+\nPlayResX: 1280\nPlayResY: 720\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,24,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,1,0,2,10,10,10,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,Owned ASS event\n');
      await fs.writeFile(chapters, ';FFMETADATA1\ntitle=Owned rich fixture\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=4000\ntitle=First\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=4000\nEND=8000\ntitle=Second\n');
      await fs.writeFile(attachment, 'Opaque owned payload for exact attachment copying; not a usable font.');
      const folder = path.join(owned, 'input-rich'); await fs.mkdir(folder); rich = path.join(folder, 'rich.mkv');
      await run(runtime.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-i', base, '-i', subtitle, '-i', styled, '-f', 'ffmetadata', '-i', chapters,
        '-map', '0', '-map', '1:0', '-map', '2:0', '-c', 'copy', '-map_metadata', '3', '-map_chapters', '3', '-attach', attachment,
        '-metadata:s:t:0', 'mimetype=application/x-truetype-font', '-metadata:s:t:0', 'filename=opaque-fixture.ttf', '-f', 'matroska', rich]);
      sources.push({ file: rich, bytes: (await fs.stat(rich)).size, sha256: sha(await fs.readFile(rich)), origin: 'Owned B stream copy plus synthetic subtitle/chapter/opaque attachment (not font validation)' }); return rich;
    }
    let timeline;
    for (const choice of choices) {
      if (choice.startsWith('E-')) await job(choice, await source('E'), choice.endsWith('mp4') ? 'mp4' : 'matroska');
      else if (choice === 'A-mp4') await job(choice, await source('A'), 'mp4');
      else if (choice === 'D-mkv') await job(choice, await source('D'), 'matroska');
      else if (choice === 'B-video-mkv') await job(choice, await source('B'), 'matroska', { omitAudio: true, omissionCount: 1, initialStatus: 'ready' });
      else if (choice === 'rich-mkv') await job(choice, await richSource(), 'matroska');
      else { timeline ||= await copySource(OLD_AAC, 'timeline'); await job(choice, timeline, choice === 'timeline-mkv' ? 'matroska' : 'mp4', { omitAudio: choice === 'timeline-video-mp4' }); }
    }
    if (cli[4] === '--lifecycle') {
      const file = await source('B'); await job('invalid-output', file, 'matroska', { failure: true });
      await job('cancel-evidence', file, 'matroska', { cancel: true });
      const result = report.cases.find(value => value.output); const target = path.join(owned, 'rescan-output'); await fs.mkdir(target);
      const scan = await prepare(result.output.file, target, 'matroska');
      report.generatedAdmission = { initialExcludedByDefault: scan.generatedExcluded, explicitCurrentAdmissionStatus: scan.item.status, snapshot: scan.s };
      assert.equal(scan.generatedExcluded, true); assert.equal(scan.item.status, 'ready', scan.item.reason);
      await service.cancelBatch({ batchId: scan.s.batchId }); assert.equal(service.snapshot().phase, 'cancelled');
      assert.throws(() => service.startBatch({ planId: scan.s.planId, fileIds: [scan.item.id] }), { code: 'STALE_PLAN' });
      const copyCount = () => report.invocations.filter(value => value.args.includes('-c') && value.args[value.args.indexOf('-c') + 1] === 'copy').length;
      const beforeCopies = copyCount();
      const repeated = await prepare(result.source, path.dirname(result.output.file), result.target);
      assert.equal(repeated.item.status, 'skipped', repeated.item.reason);
      assert.throws(() => service.startBatch({ planId: repeated.s.planId, fileIds: [repeated.item.id] }), { code: 'INVALID_SELECTION' });
      assert.equal(copyCount(), beforeCopies);
      assert.equal(sha(await fs.readFile(result.output.file)), result.output.sha256);
      report.existingOutputSkip = { snapshot: repeated.s, noNewCopy: true, outputSha256: result.output.sha256 };
    }
    for (const source of sources) {
      assert.equal(sha(await fs.readFile(source.file)), source.sha256);
      if (path.isAbsolute(source.origin)) assert.equal(sha(await fs.readFile(source.origin)), source.sha256);
    }
    for (const item of report.cases.filter(value => value.output)) assert.equal(sha(await fs.readFile(item.output.file)), item.output.sha256);
    report.sources = sources; report.resourcesAfter = await space(); report.status = 'passed-bounded-copy-service';
  } catch (error) { report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    clearTimeout(timer); report.closureFailures = [];
    async function attempt(label, action) { try { await action(); } catch (error) { report.closureFailures.push({ label, code: error.code, message: error.message }); report.status = 'failed-retained'; process.exitCode = 1; } }
    if (service) { await attempt('cancel', () => service.cancelCurrent()); await attempt('resources', () => service.closeOperationResources());
      await attempt('diagnostics', async () => { report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed'); assert.equal(report.diagnosticClosure.persisted, true); }); }
    report.liveChildren = children.size; await attempt('child-closure', async () => assert.equal(children.size, 0));
    if (lease && children.size === 0) await attempt('media-lease', async () => {
      const named = await fs.lstat(leasePath, { bigint: true }); assert.equal(named.dev, leaseIdentity.dev); assert.equal(named.ino, leaseIdentity.ino);
      assert.equal(JSON.parse(await fs.readFile(leasePath, 'utf8')).token, id); await lease.close(); await fs.unlink(leasePath); report.leaseReleased = true;
    });
    if (report.sourcesBefore) await attempt('module-freeze', async () => { report.sourcesAfter = await freezeModules(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); });
    report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ id, status: report.status, report: path.join(directory, 'report.json'), failure: report.failure }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
