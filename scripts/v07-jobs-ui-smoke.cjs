'use strict';

// Parent-owned native UI evidence. Reuse one sealed two-second synthetic source;
// real preparation/encoding/validation/publication execute unchanged. Delays at
// existing service boundaries make short post-encode stages observable, not fake.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const { _electron } = require('playwright');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const SOURCE = path.join(OWNED, 'fixtures/encode-operation-01349687-ff85-4606-b3be-b2baec87d06b/landscape.mp4');
const SOURCE_SHA = '488a30e753a3129a2a64ef9314a69be91e4db1bc508a6bd14b26ad5fc01f10e4';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function bounded(promise, label, ms = 10000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out.')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function boundedHash(file) {
  const before = await fs.lstat(file, { bigint: true });
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n && before.size < 32n * 1024n ** 2n);
  const data = await fs.readFile(file), after = await fs.lstat(file, { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs']) assert.equal(before[key], after[key]);
  return { path: file, bytes: data.length, sha256: sha(data) };
}
async function main() {
  assert.deepEqual(process.argv.slice(2), ['--parent-granted-media-slot']);
  const id = randomUUID(), reportRoot = path.join(ROOT, 'artifacts/v0.7/jobs-ui', id);
  const work = path.join(OWNED, 'staging', 'jobs-ui-' + id), input = path.join(work, 'input'), output = path.join(work, 'output');
  const report = { id, startedAt: new Date().toISOString(), status: 'running', stages: [],
    limitations: ['Native folder-dialog return values are substituted; clicks, preload and main authority are real.',
      'Post-encode stages are deliberately delayed for observation; timing is not performance evidence.',
      'One ordinary Full SDR CPU encode plus normal startup capability fixtures only. No benchmark or personal-media processing.',
      'Does not qualify changed operations, HDR display quality or AMD/Intel execution.'], work, source: SOURCE };
  let lease, leaseStat, app, page, exited = false, exitPromise;
  const leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
  await fs.mkdir(path.dirname(reportRoot), { recursive: true });
  await fs.mkdir(reportRoot, { recursive: false });
  const save = () => fs.writeFile(path.join(reportRoot, 'report.json'), JSON.stringify(report, null, 2));
  const until = async predicate => {
    const end = Date.now() + 180000;
    while (Date.now() < end) {
      const state = await bounded(page.evaluate(() => window.encoder.getSnapshot()), 'Snapshot read'); report.lastSnapshot = state;
      if (predicate(state)) return state;
      if (['failed', 'completed', 'cancelled'].includes(state.phase)) throw Error('Unexpected terminal before expected observation: ' + JSON.stringify(state.items));
      await delay(75);
    }
    throw Error('Native job observation deadline exceeded.');
  };
  try {
    lease = await fs.open(leasePath, 'wx+');
    await lease.writeFile(JSON.stringify({ schema: 1, token: id, pid: process.pid, purpose: 'jobs-ui-native', startedAt: report.startedAt }));
    await lease.sync(); leaseStat = await lease.stat({ bigint: true });
    report.freeSpace = {};
    for (const drive of ['D', 'F']) { const stat = await fs.statfs(drive + ':\\', { bigint: true }); const free = stat.bavail * stat.bsize;
      report.freeSpace[drive] = String(free); assert.ok(free > (drive === 'D' ? 25n * 1024n ** 3n : 512n * 1024n ** 2n)); }
    report.sourceBefore = await boundedHash(SOURCE); assert.equal(report.sourceBefore.sha256, SOURCE_SHA);
    await fs.mkdir(work); await fs.mkdir(input); await fs.mkdir(output);
    const copy = path.join(input, 'Owned two-second landscape.mp4');
    await fs.copyFile(SOURCE, copy, require('node:fs').constants.COPYFILE_EXCL);
    assert.equal((await boundedHash(copy)).sha256, SOURCE_SHA);
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: path.join(ROOT, 'node_modules/electron/dist/electron.exe'),
      args: [ROOT, '--user-data-dir=' + path.join(work, 'state')], cwd: ROOT, env, timeout: 60000 });
    exitPromise = new Promise(resolve => app.process().once('exit', (code, signal) => { exited = true; resolve({ code, signal }); }));
    page = await app.firstWindow(); page.setDefaultTimeout(30000); report.pageErrors = [];
    page.on('pageerror', error => report.pageErrors.push(error.message));
    await page.waitForFunction(() => !document.querySelector('#profile').disabled, undefined, { timeout: 180000 });
    report.runtime = await app.evaluate(({ app }) => ({ app: app.getVersion(), electron: process.versions.electron, data: app.getPath('userData') }));
    await save();
    assert.equal(report.runtime.electron, '44.7.0'); assert.equal(report.runtime.app, '0.7.0-alpha.1');
    await app.evaluate(({ dialog }, options) => {
      let next = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [options.folders[next++]] });
      const { EncoderService } = process.getBuiltinModule('module').createRequire(options.service)(options.service);
      const execute = EncoderService.prototype.execute;
      globalThis.jobUiEvidence = { commands: [], stages: [], held: null, release: null };
      EncoderService.prototype.execute = function (...args) {
        const evidence = globalThis.jobUiEvidence, seen = new Set();
        const pause = async stage => {
          if (seen.has(stage) || this.controller.signal.aborted) return; seen.add(stage); evidence.held = stage;
          await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(Error('UI evidence hold expired.')), 45000);
            const release = () => { clearTimeout(timer); this.controller.signal.removeEventListener('abort', release);
              evidence.release = null; evidence.held = null; resolve(); };
            evidence.release = release; this.controller.signal.addEventListener('abort', release, { once: true });
          });
        };
        const run = this.run;
        this.run = async (exe, argv, opts) => {
          if (opts?.onProgress) evidence.commands.push({ executable: exe, argv });
          if (this.state.progress?.stage === 'output-validation') await pause('output-validation');
          return run(exe, argv, opts);
        };
        const assess = this.assessCompletedSource;
        this.assessCompletedSource = async (...values) => { await pause('source-check'); return assess.apply(this, values); };
        const folders = this.verifyFolders;
        this.verifyFolders = async (...values) => { if (this.state.progress?.stage === 'publication') await pause('publication'); return folders.apply(this, values); };
        this.on('update', state => { if (state?.progress?.stage) evidence.stages.push(state.progress.stage); });
        return execute.apply(this, args);
      };
    }, { service: path.join(ROOT, 'src/encoder-service.cjs'), folders: [input, output] });
    await page.click('#choose-input'); await page.click('#choose-output'); await page.selectOption('#profile', 'h265-cpu');
    await page.click('#prepare-batch'); report.prepared = await until(state => state.phase === 'ready');
    assert.equal(report.prepared.items.length, 1); assert.equal(report.prepared.items[0].status, 'ready', JSON.stringify(report.prepared.items));
    report.planned = await page.evaluate(({ planId, fileId }) => window.encoder.getEncodingDetails({ planId, fileId }),
      { planId: report.prepared.planId, fileId: report.prepared.items[0].id });
    await page.click('#start-batch');
    for (const stage of ['output-validation', 'source-check', 'publication']) {
      report.observingStage = stage; await save();
      await until(state => state.progress?.stage === stage);
      // The stage is emitted before the real boundary awaits diagnostics/I/O.
      // Wait for the harness hold itself; publication of state is not that hold.
      const holdDeadline = Date.now() + 20000;
      while (await bounded(app.evaluate(() => globalThis.jobUiEvidence.held), 'Main hold read') !== stage) {
        assert.ok(Date.now() < holdDeadline, 'Expected main hold was not reached'); await delay(50);
      }
      await page.click('#tab-jobs');
      await page.waitForFunction(() => !document.querySelector('#active-job-progress').hasAttribute('value'));
      const observation = await page.evaluate(() => ({ summary: document.querySelector('#active-job-summary').textContent,
        label: document.querySelector('#active-job-progress').getAttribute('aria-valuetext'),
        percent: document.querySelector('#active-job-progress').getAttribute('value'),
        cancelEnabled: !document.querySelector('#cancel-batch').disabled,
        telemetryHidden: document.querySelector('#encoding-telemetry').hidden,
        speed: document.querySelector('#speed').textContent, fps: document.querySelector('#fps').textContent,
        jobsVisible: !document.querySelector('#workspace-jobs').hidden }));
      assert.equal(observation.percent, null); assert.equal(observation.cancelEnabled, true); assert.equal(observation.telemetryHidden, true);
      assert.equal(observation.speed, '—'); assert.equal(observation.fps, '—'); assert.equal(observation.jobsVisible, true);
      assert.match(observation.label, /indeterminate/);
      const held = await app.evaluate(() => globalThis.jobUiEvidence.held); assert.equal(held, stage);
      await page.screenshot({ path: path.join(reportRoot, stage + '.png') });
      await page.click('#tab-settings'); assert.equal(await page.locator('#workspace-settings').isVisible(), true);
      await page.click('#tab-jobs'); report.stages.push({ stage, ...observation }); await save();
      await app.evaluate(() => globalThis.jobUiEvidence.release());
    }
    report.completed = await until(state => ['completed', 'failed'].includes(state.phase));
    assert.equal(report.completed.counts.success, 1, JSON.stringify(report.completed.items));
    assert.equal(report.completed.items[0].outputDisposition.kind, 'published');
    assert.ok(report.completed.items[0].outputAccess, 'Published output action authority exists');
    report.execution = await app.evaluate(() => ({ commands: globalThis.jobUiEvidence.commands, stages: globalThis.jobUiEvidence.stages }));
    assert.equal(report.execution.commands.length, 1);
    assert.deepEqual(report.execution.commands[0].argv.slice(0, -1), report.planned.args.slice(0, -1));
    assert.deepEqual([...new Set(report.execution.stages)], ['encoding', 'output-validation', 'source-check', 'publication']);
    const outputs = await fs.readdir(output); assert.equal(outputs.length, 1);
    report.output = await boundedHash(path.join(output, outputs[0]));
    await page.screenshot({ path: path.join(reportRoot, 'completed.png') });
    await page.click('#tab-history'); await page.waitForFunction(() => document.querySelector('#workspace-history').textContent.includes('OUTPUT_PUBLISHED'));
    await page.screenshot({ path: path.join(reportRoot, 'history.png') });
    assert.deepEqual(report.pageErrors, []);
    await app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 20); });
    report.exit = await bounded(exitPromise, 'Native shutdown', 20000);
    assert.equal(report.exit.code, 0); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; await save(); }
  finally {
    if (app && !exited) { try {
      await bounded(app.evaluate(({ dialog, BrowserWindow }) => {
        globalThis.jobUiEvidence?.release?.(); dialog.showMessageBox = async () => ({ response: 1 });
        setTimeout(() => BrowserWindow.getAllWindows().forEach(window => window.close()), 25);
      }), 'Owned cleanup request');
      await bounded(exitPromise, 'Owned cleanup exit', 20000);
    } catch (error) { report.cleanupFailure = error.message; } }
    if (report.sourceBefore) { report.sourceAfter = await boundedHash(SOURCE); assert.deepEqual(report.sourceAfter, report.sourceBefore); }
    if (lease) {
      const current = await fs.lstat(leasePath, { bigint: true }), content = JSON.parse(await fs.readFile(leasePath, 'utf8'));
      if ((!app || exited) && current.dev === leaseStat.dev && current.ino === leaseStat.ino && content.token === id && content.pid === process.pid) {
        await lease.close(); lease = null; await fs.unlink(leasePath); report.leaseReleased = true;
      } else report.leaseRetained = 'Unconfirmed app exit or lease identity; parent recovery required.';
      await lease?.close();
    }
    report.finishedAt = new Date().toISOString(); await save();
    console.log(JSON.stringify({ status: report.status, report: path.join(reportRoot, 'report.json'), failure: report.failure?.message }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
