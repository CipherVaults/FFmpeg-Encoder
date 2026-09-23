'use strict';

// Field regressions exercise the native UI/IPC/service with short owned phone
// fixtures. The original personal recordings are never opened for writing.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');
const { inspectInput, inspectMetadata, validateOutput } = require('../src/inspection.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const root = path.resolve(__dirname, '..');
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const report = { status: 'running', startedAt: new Date().toISOString(), cases: [], limits: [
  'Native development app with substituted folder picker; final extracted ZIP acceptance is separate.',
  'Short stream-copy fixtures retain actual Samsung stream tags; no full personal recording is encoded.',
  'The source-change case deliberately toggles an owned fixture attribute after a real encoder starts. It does not establish the cause of the historical OBS failure.',
] };
let app, page, artifacts;
const save = async phase => { if (phase) report.phase = phase; await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2)); };
async function until(predicate, timeout = 180000) {
  const end = Date.now() + timeout; let snapshot;
  while (Date.now() < end) { snapshot = await page.evaluate(() => window.encoder.getSnapshot()); if (predicate(snapshot)) return snapshot; await new Promise(r => setTimeout(r, 60)); }
  throw Error(`Timed out: ${JSON.stringify(snapshot)}`);
}
async function folders(input, output) {
  await app.evaluate(({ dialog }, values) => { let i = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [values[i++]] }); }, [input, output]);
  await page.click('#choose-input'); await page.click('#choose-output');
}
async function prepare() {
  await page.click('#prepare-batch'); const s = await until(s => ['ready', 'failed', 'cancelled'].includes(s.phase)); assert.equal(s.phase, 'ready', JSON.stringify(s)); return s;
}
async function details(state, item) {
  const row = page.locator(`tr[data-file-id="${item.id}"]`);
  const outer = row.locator('[data-testid="file-details"]');
  if (await outer.getAttribute('open') === null) await outer.locator(':scope > summary').click();
  const inner = row.locator('[data-testid="encoding-details"]');
  if (await inner.getAttribute('open') === null) await inner.locator(':scope > summary').click();
  const expected = await page.evaluate(p => window.encoder.getEncodingDetails(p), { planId: state.planId, fileId: item.id });
  await page.waitForFunction(({ id, args }) => { try { return JSON.stringify(JSON.parse(document.querySelector(`tr[data-file-id="${id}"] [data-testid="resolved-args"]`).textContent)) === JSON.stringify(args); } catch { return false; } }, { id: item.id, args: expected.args });
  return expected;
}
async function finish() {
  await page.click('#start-batch'); return until(s => ['completed', 'failed', 'cancelled'].includes(s.phase));
}
async function main() {
  artifacts = await fs.mkdtemp(path.join(root, 'artifacts', 'field-native-')); report.artifacts = artifacts;
  try {
    const fixtureReportPath = path.resolve(process.argv[2]);
    const fixtureReport = JSON.parse(await fs.readFile(fixtureReportPath, 'utf8'));
    assert.equal(fixtureReport.status, 'complete'); assert.equal(fixtureReport.cases.length, 2);
    report.fixtureReport = { path: fixtureReportPath, sha256: await hash(fixtureReportPath) };
    report.sourceHashes = {};
    for (const file of ['src/media.cjs', 'src/inspection.cjs', 'src/encoder-service.cjs', 'src/source-identity.cjs', 'ui/renderer.js', 'scripts/field-qa-smoke.cjs']) report.sourceHashes[file] = await hash(path.join(root, file));
    const same = path.join(artifacts, 'phone same folder'); await fs.mkdir(same);
    const sources = [];
    for (const [i, entry] of fixtureReport.cases.entries()) {
      const file = path.join(same, `Samsung ${i + 1}.mp4`); await fs.copyFile(entry.fixture, file);
      sources.push({ file, sha256: await hash(file), inspection: await inspectInput(file, { ffprobe }) });
    }
    report.sources = sources;
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const stateDir = path.join(artifacts, 'user-data');
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${stateDir}`], cwd: root, env });
    page = await app.firstWindow(); report.pageErrors = []; page.on('pageerror', e => report.pageErrors.push(e.message));
    await page.waitForFunction(() => !document.querySelector('#choose-input')?.disabled, undefined, { timeout: 120000 });
    await app.evaluate((_, modulePath) => {
      const require = process.getBuiltinModule('module').createRequire(modulePath);
      const { EncoderService } = require(modulePath); const prepare = EncoderService.prototype.prepareBatch;
      const harness = globalThis.__fieldQA = { commands: [], mutate: null, mutation: null };
      EncoderService.prototype.prepareBatch = function(...args) {
        if (!harness.service) {
          harness.service = this; const run = this.run;
          this.run = (executable, argv, options = {}) => {
            if (!options.onProgress) return run(executable, argv, options);
            const entry = { executable, argv: [...argv] }; harness.commands.push(entry);
            return run(executable, argv, { ...options, onChild(child) {
              entry.pid = child.pid; options.onChild?.(child);
              if (harness.mutate) {
                // Only the explicit owned test fixture can reach this hook.
                const fs = require('node:fs'); const file = harness.mutate; harness.mutate = null;
                const stat = fs.statSync(file, { bigint: true });
                fs.chmodSync(file, 0o444); fs.chmodSync(file, 0o666);
                const after = fs.statSync(file, { bigint: true });
                harness.mutation = { file, operation: 'owned fixture read-only attribute toggle', beforeCtimeNs: String(stat.ctimeNs), afterCtimeNs: String(after.ctimeNs), beforeMtimeNs: String(stat.mtimeNs), afterMtimeNs: String(after.mtimeNs) };
              }
            } });
          };
        }
        return prepare.apply(this, args);
      };
    }, path.join(root, 'src/encoder-service.cjs'));
    await folders(same, same); await page.selectOption('#profile', 'h265-cpu'); await page.click('#tested-default');
    const prepared = await prepare(); assert(prepared.items.every(i => i.status === 'ready'));
    const preparedArgs = {};
    for (const item of prepared.items) {
      preparedArgs[item.id] = await details(prepared, item);
      const notice = page.locator(`tr[data-file-id="${item.id}"] [data-testid="metadata-notices"]`);
      assert.equal(await notice.isVisible(), true); assert.match(await notice.textContent(), /SOURCE_CREATION_TIME/);
      assert(preparedArgs[item.id].args.some(arg => arg.startsWith('SOURCE_CREATION_TIME=')));
    }
    await page.screenshot({ path: path.join(artifacts, 'phone-prepared.png'), fullPage: true });
    report.prepared = prepared; await save('phone prepared notices and argv');
    const completed = await finish(); assert.equal(completed.counts.success, 2, JSON.stringify(completed));
    const commands = await app.evaluate(() => globalThis.__fieldQA.commands);
    for (const item of completed.items) {
      const source = sources.find(s => path.basename(s.file) === item.name); const output = path.join(same, item.outputName);
      const command = commands.find(c => c.argv[c.argv.indexOf('-i') + 1] === source.file);
      const expected = [...preparedArgs[item.id].args]; expected[expected.length - 1] = command.argv.at(-1); assert.deepEqual(command.argv, expected);
      const probe = await inspectMetadata(output, { ffprobe }); const validation = validateOutput(source.inspection, probe, completed.settings); assert.equal(validation.valid, true, JSON.stringify(validation));
      await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
      assert.equal(classifyMarker(probe).kind, 'generated'); assert.equal(await hash(source.file), source.sha256);
      report.cases.push({ input: source.file, output, outputHash: await hash(output), validation, probe, argv: command.argv });
    }
    await page.screenshot({ path: path.join(artifacts, 'phone-success.png'), fullPage: true });
    await page.click('#new-batch'); const rescan = await prepare();
    assert.equal(rescan.items.filter(i => i.status === 'generated').length, 2); assert.equal(rescan.items.filter(i => i.status === 'skipped').length, 2); report.rescan = rescan;
    await save('phone encoded preserved and safely rescanned');

    // Fail after a real encode when a source identity changes, then prove the
    // same unchanged bytes can be freshly prepared and safely encoded afterward.
    const input = path.join(artifacts, 'identity input'); const output = path.join(artifacts, 'identity output'); await fs.mkdir(input); await fs.mkdir(output);
    const file = path.join(input, 'Owned metadata change.mp4'); await fs.copyFile(sources[0].file, file); const beforeHash = await hash(file);
    await folders(input, output); await page.selectOption('#profile', 'h264-cpu'); await page.selectOption('#preset', 'veryfast');
    const identityPrepared = await prepare(); assert.equal(identityPrepared.items[0].status, 'ready');
    await app.evaluate((_, file) => { globalThis.__fieldQA.mutate = file; }, file);
    const failed = await finish(); assert.equal(failed.counts.failed, 1, JSON.stringify(failed));
    const item = failed.items[0]; assert.match(item.reason, /ctimeNs/); assert.equal(item.sourceIdentityDiagnostic.stage, 'after-encode');
    assert.deepEqual(item.sourceIdentityDiagnostic.changedFields, ['ctimeNs']); assert.equal(await hash(file), beforeHash);
    assert.equal(await fs.stat(path.join(output, item.outputName)).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; }), false);
    await details(failed, item); assert.match(await page.locator(`tr[data-file-id="${item.id}"] .item-reason`).textContent(), /ctimeNs/);
    await page.screenshot({ path: path.join(artifacts, 'source-change-diagnostic.png'), fullPage: true });
    const log = JSON.parse(await fs.readFile(path.join(stateDir, 'logs', `${failed.batchId}.json`), 'utf8'));
    assert.deepEqual(log.items[0].sourceIdentityDiagnostic, item.sourceIdentityDiagnostic);
    report.identityFailure = { failed, log, mutation: await app.evaluate(() => globalThis.__fieldQA.mutation), contentSha256: beforeHash };
    await page.click('#new-batch'); await prepare(); const retried = await finish(); assert.equal(retried.counts.success, 1, JSON.stringify(retried)); report.identityRetry = retried;
    for (const source of sources) assert.equal(await hash(source.file), source.sha256);
    for (const item of report.cases) assert.equal(await hash(item.output), item.outputHash);
    assert.deepEqual(report.pageErrors, []); report.status = 'passed';
  } catch (error) { report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    if (app) {
      if (page && !page.isClosed()) await page.evaluate(async () => { const s = await window.encoder.getSnapshot(); if (['running', 'preparing', 'cancelling'].includes(s.phase)) await window.encoder.cancelBatch({ batchId: s.batchId }); }).catch(() => {});
      await app.close();
    }
    report.finishedAt = new Date().toISOString(); await save(); console.log(JSON.stringify({ status: report.status, artifacts, failure: report.failure }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
