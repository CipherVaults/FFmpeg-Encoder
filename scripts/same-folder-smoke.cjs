'use strict';

// K endpoint acceptance. Only generated fixtures beneath this run's artifact
// directory are changed. Electron/main/preload/UI, tools and NTFS publication
// are real; picker substitution and deliberately seeded journal/race cases are
// identified individually in the report. This is not portable acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { classifyMarker, ProvenanceJournal } = require('../src/provenance.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', `same-folder-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`);
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  time: new Date().toISOString(), artifacts, status: 'running', sessions: [], cases: [], checks: [], errors: [],
  limitations: [
    'Folder picker returns are substituted; UI buttons, preload, validated IPC and main planning/encoding are real.',
    'Media fixtures are generated beneath this run directory. No personal archive media or external output is used.',
    'Recovery and identity-index fixtures deliberately seed local bookkeeping; race timing is injected where stated. These cases do not simulate power loss.',
    'Child spawn/close are observed at the real process-runner callback. This is not an independent Windows process census.',
    'Native local NTFS on this machine is covered. Junction/reparse storage fixtures and clean-machine/portable acceptance are not covered here.',
    'No broad profile option or perceptual-quality matrix is repeated.',
  ],
};
const protectedFiles = new Map();
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const protect = async file => protectedFiles.set(file, await hash(file));
const probe = async file => JSON.parse((await runTool(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file])).stdout);
const save = () => fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
let current;

async function folder(name) {
  const result = path.join(artifacts, name);
  await fs.mkdir(result, { recursive: true });
  return result;
}

async function fixture(file, { duration = 1, size = '320x180', tags = [] } = {}) {
  await runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
    `testsrc2=size=${size}:rate=24:duration=${duration},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited`,
    '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    ...tags.flatMap(tag => ['-metadata', tag]), '-n', file], { timeoutMs: 120000 });
  await protect(file);
}

async function until(predicate, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let state;
  while (Date.now() < deadline) {
    state = await current.page.evaluate(() => window.encoder.getSnapshot());
    if (predicate(state)) return state;
    await pause(30);
  }
  throw new Error(`Application state timed out: ${JSON.stringify(state)}`);
}

async function close() {
  if (!current) return;
  const { app, page, session } = current;
  if (!page.isClosed()) {
    await page.evaluate(async () => {
      const state = await window.encoder.getSnapshot();
      if (['preparing', 'running', 'checking', 'cancelling'].includes(state.phase) && state.batchId) await window.encoder.cancelBatch({ batchId: state.batchId });
    }).catch(() => {});
    session.commands = await app.evaluate(() => globalThis.__sameFolderSmoke.commands).catch(() => []);
    session.lastSnapshot = await page.evaluate(() => window.encoder.getSnapshot()).catch(() => null);
  }
  await app.close();
  current = null;
}

async function launch(label, userData) {
  await close();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, `--user-data-dir=${userData}`], cwd: root, env });
  const page = await app.firstWindow();
  const session = { label, userData, mainPid: await app.evaluate(() => process.pid) };
  current = { app, page, session }; report.sessions.push(session);
  page.on('pageerror', error => report.errors.push({ label, message: error.message }));
  await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 120000 });
  session.capabilities = await page.evaluate(() => window.encoder.getCapabilities());
  session.boundary = await page.evaluate(() => ({ requireType: typeof require, processType: typeof process, methods: Object.keys(window.encoder).sort() }));
  assert.equal(session.boundary.requireType, 'undefined'); assert.equal(session.boundary.processType, 'undefined');
  assert.ok(session.boundary.methods.includes('treatAsOriginal'));
  await app.evaluate((_electron, modulePath) => {
    const require = process.getBuiltinModule('module').createRequire(modulePath);
    const { EncoderService } = require(modulePath);
    const prepare = EncoderService.prototype.prepareBatch;
    const harness = globalThis.__sameFolderSmoke = { service: null, commands: [] };
    EncoderService.prototype.prepareBatch = function (...args) {
      harness.service = this;
      if (!this.__sameFolderObserved) {
        this.__sameFolderObserved = true;
        const run = this.run;
        this.run = (executable, argv, options = {}) => {
          if (!options.onProgress) return run(executable, argv, options);
          const entry = { executable, argv, spawnedAt: null, closedAt: null, pid: null };
          harness.commands.push(entry);
          return run(executable, argv, { ...options, onChild(child) {
            entry.pid = child.pid; entry.spawnedAt = Date.now();
            child.once('close', (code, signal) => { entry.closedAt = Date.now(); entry.code = code; entry.signal = signal; });
            options.onChild?.(child);
          } });
        };
      }
      return prepare.apply(this, args);
    };
  }, path.join(root, 'src', 'encoder-service.cjs'));
  return current;
}

async function configure(input, output = input, profileId = 'h264-cpu', preset = 'veryfast') {
  const { app, page } = current;
  if (await page.isVisible('#new-batch')) await page.click('#new-batch');
  await app.evaluate(({ dialog }, folders) => {
    let index = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folders[index++]] });
  }, [input, output]);
  await page.click('#choose-input'); await page.click('#choose-output');
  await page.selectOption('#profile', profileId); await page.selectOption('#preset', preset);
  await page.fill('#quality', '25');
}

async function prepare(label) {
  await current.page.click('#prepare-batch');
  const state = await until(value => ['ready', 'failed', 'cancelled'].includes(value.phase));
  assert.equal(state.phase, 'ready', `${label}: ${JSON.stringify(state)}`);
  return state;
}

async function newPlan(label) {
  await current.page.click('#new-batch');
  return prepare(label);
}

async function start(label) {
  await current.page.click('#start-batch');
  const state = await until(value => ['completed', 'failed', 'cancelled'].includes(value.phase));
  assert.equal(state.phase, 'completed', `${label}: ${JSON.stringify(state)}`);
  return state;
}

function item(state, name) {
  const result = state.items.find(entry => entry.name === name);
  assert.ok(result, `${name} not present: ${JSON.stringify(state)}`);
  return result;
}

async function assertNoStages(directory) {
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.ffmpeg-encoder-')), []);
}

async function ordinaryAndRestart() {
  const directory = await folder('ordinary'); const userData = await folder('ordinary-state');
  const source = path.join(directory, 'Original العربية.mkv'); await fixture(source);
  await launch('ordinary-first-process', userData);
  await configure(directory);
  const first = await prepare('first same-folder plan');
  assert.deepEqual(first.items.map(entry => entry.status), ['ready']);
  // Created after the fixed plan snapshot, so it cannot join this encode.
  const late = path.join(directory, 'Late arrival.mkv'); await fs.copyFile(source, late); await protect(late);
  const cpu = await start('CPU first encode');
  assert.equal(cpu.counts.success, 1); assert.equal(cpu.items.length, 1);
  const cpuFile = path.join(directory, cpu.items[0].outputName);
  const cpuMarker = classifyMarker(await probe(cpuFile)); assert.equal(cpuMarker.kind, 'generated');
  await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', cpuFile, '-f', 'null', '-']); await protect(cpuFile);
  const next = await newPlan('post-CPU same-folder plan');
  assert.equal(item(next, path.basename(cpuFile)).status, 'generated');
  assert.equal(item(next, path.basename(source)).status, 'skipped');
  assert.equal(item(next, path.basename(late)).status, 'ready');
  assert.equal(await current.page.locator(`input[data-file-id="${item(next, path.basename(cpuFile)).id}"]`).isEnabled(), false);
  const deniedOverride = await current.page.evaluate(async request => {
    try { await window.encoder.treatAsOriginal(request); return { accepted: true }; }
    catch (error) { return { accepted: false, code: error.code, message: error.message }; }
  }, { planId: next.planId, fileId: item(next, path.basename(cpuFile)).id });
  assert.equal(deniedOverride.accepted, false);
  await current.page.screenshot({ path: path.join(artifacts, 'generated-excluded.png'), fullPage: true });

  await configure(directory, directory, 'h264-nvidia', 'p4');
  const gpuReady = await prepare('NVENC same-folder plan');
  assert.equal(item(gpuReady, path.basename(cpuFile)).status, 'generated');
  // Select one source only, keeping the native proof small and deterministic.
  await current.page.click('#clear-selection');
  await current.page.check(`input[data-file-id="${item(gpuReady, path.basename(source)).id}"]`);
  const gpu = await start('NVENC encode'); assert.equal(gpu.counts.success, 1);
  const gpuFile = path.join(directory, item(gpu, path.basename(source)).outputName);
  const gpuMarker = classifyMarker(await probe(gpuFile)); assert.equal(gpuMarker.kind, 'generated');
  assert.notEqual(gpuMarker.outputId, cpuMarker.outputId);
  await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', gpuFile, '-f', 'null', '-']); await protect(gpuFile);

  // Rename and copy retain the actual MKV marker, independently of suffixes.
  const renamed = path.join(directory, 'Renamed generated.mkv');
  const copied = path.join(directory, 'Copied generated.mkv');
  const renameFrom = path.join(directory, 'Before rename.mkv');
  await fs.copyFile(cpuFile, renameFrom); await fs.rename(renameFrom, renamed); await protect(renamed);
  await fs.copyFile(gpuFile, copied); await protect(copied);
  await launch('ordinary-restarted-process', userData); await configure(directory);
  const restart = await prepare('restart recognizes outputs');
  for (const file of [cpuFile, gpuFile, renamed, copied]) assert.equal(item(restart, path.basename(file)).status, 'generated');
  assert.equal(item(restart, path.basename(source)).status, 'skipped');
  assert.ok((await fs.readdir(directory)).every(name => !/_(?:H264|H265|AV1)-.*_(?:H264|H265|AV1)-/i.test(name)));
  await assertNoStages(directory);
  report.cases.push({ label: 'native CPU/NVENC publication, fixed snapshot and fresh-process recognition', directory, first, cpu, cpuMarker, next, deniedOverride, gpu, gpuMarker, restart });
  report.checks.push('Real same-folder CPU/NVENC outputs validate/decode with distinct main UUIDs; outputs and marker-retaining copies are excluded after restart, without suffix chains; late file does not join prepared plan.');
}

async function markersAndLegacy() {
  const directory = await folder('classification'); const userData = await folder('classification-state');
  const names = { legacy: 'Possible_H264-CPU.mkv', historical: 'Historical_AV1-Nvidia-GPU.mkv', partial: 'Partial marker.mkv', unknown: 'Unknown marker.mkv', malformed: 'Malformed marker.mkv', reserved: 'Reserved unknown key.mkv' };
  await fixture(path.join(directory, names.legacy)); await fixture(path.join(directory, names.historical));
  await fixture(path.join(directory, names.partial), { tags: ['FFMPEG_ENCODER_PROVENANCE=1'] });
  await fixture(path.join(directory, names.unknown), { tags: ['FFMPEG_ENCODER_PROVENANCE=999', `FFMPEG_ENCODER_OUTPUT_ID=${randomUUID()}`] });
  await fixture(path.join(directory, names.malformed), { tags: ['FFMPEG_ENCODER_PROVENANCE=1', 'FFMPEG_ENCODER_OUTPUT_ID=not-a-uuid'] });
  await fixture(path.join(directory, names.reserved), { tags: ['FFMPEG_ENCODER_UNRECOGNIZED=1'] });
  await launch('classification-and-override', userData); await configure(directory);
  const ready = await prepare('conservative provenance classification');
  for (const name of [names.legacy, names.historical]) assert.equal(item(ready, name).status, 'ambiguous');
  for (const name of [names.partial, names.unknown, names.malformed, names.reserved]) assert.equal(item(ready, name).status, 'provenance-issue');
  assert.equal(await current.page.isEnabled('#start-batch'), false);
  assert.match(await current.page.textContent('#batch-items'), /Possible previous output/);
  const legacy = item(ready, names.legacy);
  await current.page.locator('tr').filter({ has: current.page.locator(`input[data-file-id="${legacy.id}"]`) }).getByTestId('treat-as-original').click();
  const approved = await until(value => item(value, names.legacy).status === 'ready');
  assert.equal(item(approved, names.historical).status, 'ambiguous');
  await current.page.check(`input[data-file-id="${legacy.id}"]`);
  const finished = await start('explicitly treated legacy original'); assert.equal(finished.counts.success, 1);
  const output = path.join(directory, item(finished, names.legacy).outputName);
  assert.equal(classifyMarker(await probe(output)).kind, 'generated'); await protect(output);
  const renewed = await newPlan('override expires with plan');
  const stale = await current.page.evaluate(async request => {
    try { await window.encoder.treatAsOriginal(request); return { accepted: true }; }
    catch (error) { return { accepted: false, code: error.code, message: error.message }; }
  }, { planId: ready.planId, fileId: legacy.id });
  assert.equal(stale.accepted, false);
  assert.notEqual(item(renewed, names.historical).status, 'ready');
  const historical = item(renewed, names.historical);
  await current.page.locator('tr').filter({ has: current.page.locator(`input[data-file-id="${historical.id}"]`) }).getByTestId('treat-as-original').click();
  await until(value => item(value, names.historical).status === 'ready');
  const modifiedFixture = path.join(directory, names.historical);
  const oldTimes = await fs.stat(modifiedFixture);
  await fs.utimes(modifiedFixture, oldTimes.atime, new Date(oldTimes.mtimeMs + 5000));
  await current.page.check(`input[data-file-id="${historical.id}"]`);
  const changedIdentity = await start('changed identity expires legacy authorization');
  assert.equal(changedIdentity.counts.success, 0); assert.equal(item(changedIdentity, names.historical).status, 'failed');
  assert.match(item(changedIdentity, names.historical).reason, /chang|identity|prepar/i);
  await current.page.screenshot({ path: path.join(artifacts, 'legacy-and-markers.png'), fullPage: true });
  await assertNoStages(directory);
  report.cases.push({ label: 'native malformed/partial/unknown reserved tags and explicit legacy UI override', directory, ready, approved, finished, renewed, stale, changedIdentity });
  report.checks.push('Malformed/partial/unknown reserved tags stay non-ready; legacy CPU and NVIDIA suffixes are excluded; explicit UI override enables only the chosen file and old-plan authorization is rejected.');
}

async function collisionAndCancel() {
  const collision = await folder('collision'); const userData = await folder('collision-state');
  const source = path.join(collision, 'Collision.mkv'); await fixture(source);
  await launch('collision-and-cancel', userData); await configure(collision);
  const ready = await prepare('destination race');
  const destination = path.join(collision, ready.items[0].outputName);
  await fs.writeFile(destination, 'A deliberate external winner appearing after prepare.', { flag: 'wx' }); await protect(destination);
  const raced = await start('existing destination after prepare'); assert.equal(raced.counts.skipped, 1); assert.equal(raced.counts.success, 0);
  assert.deepEqual(await current.app.evaluate(() => globalThis.__sameFolderSmoke.commands), []);
  await assertNoStages(collision);
  report.cases.push({ label: 'native destination appearing after prepare', ready, raced, destination });

  const directory = await folder('cancellation');
  const long = path.join(directory, 'A active.mkv'); const queued = path.join(directory, 'B queued.mkv');
  await fixture(long, { duration: 6, size: '640x360' }); await fixture(queued);
  await configure(directory, directory, 'h265-cpu', 'veryslow');
  const cancelReady = await prepare('cancel plan'); assert.equal(cancelReady.items.filter(entry => entry.status === 'ready').length, 2);
  await current.page.click('#start-batch');
  await until(value => value.phase === 'running' && value.items.some(entry => entry.status === 'running'));
  const deadline = Date.now() + 10000;
  let live;
  while (Date.now() < deadline) {
    live = await current.app.evaluate(() => globalThis.__sameFolderSmoke.commands.find(entry => entry.pid && !entry.closedAt));
    if (live) break;
    await pause(20);
  }
  assert.ok(live?.pid, 'A real encode child must have spawned before cancellation.');
  await current.page.click('#cancel-batch');
  const cancelled = await until(value => value.phase === 'cancelled');
  const commands = await current.app.evaluate(() => globalThis.__sameFolderSmoke.commands);
  assert.equal(commands.length, 1); assert.ok(commands[0].closedAt);
  assert.equal(cancelled.counts.success, 0); assert.equal(cancelled.counts.cancelled, 1); assert.equal(cancelled.counts.unprocessed, 1);
  const cancelledDirectoryEntries = (await fs.readdir(directory)).sort();
  const retainedStages = cancelledDirectoryEntries.filter(name => name.startsWith('.ffmpeg-encoder-'));
  assert.deepEqual(cancelledDirectoryEntries.filter(name => !name.startsWith('.ffmpeg-encoder-')), [path.basename(long), path.basename(queued)].sort());
  const cancelledSnapshot = cancelled;
  await launch('restart-after-cancel', userData); await configure(directory);
  const restart = await prepare('fresh-process plan after cancellation');
  assert.equal(restart.items.filter(entry => entry.status === 'ready').length, 2);
  await current.page.click('#clear-selection'); await current.page.check(`input[data-file-id="${item(restart, path.basename(queued)).id}"]`);
  const subsequent = await start('subsequent encode after cancellation'); assert.equal(subsequent.counts.success, 1);
  const published = path.join(directory, item(subsequent, path.basename(queued)).outputName);
  assert.equal(classifyMarker(await probe(published)).kind, 'generated'); await protect(published);
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.ffmpeg-encoder-')).sort(), retainedStages);
  report.cases.push({ label: 'real encoder cancellation and fresh-process restart', directory, cancelReady, live, commands, cancelledSnapshot, retainedStages, restart, subsequent });
  report.checks.push('A destination created after prepare is skipped without encode; cancellation waits for the real child close, cleans owned staging only, stops queued work, and a fresh process can encode again.');
}

async function seededRecoveryAndIndex() {
  const directory = await folder('seeded-recovery'); const userData = await folder('seeded-recovery-state');
  const source = path.join(directory, 'Original.mkv'); await fixture(source);
  const sourceIdentity = await readSourceIdentity(source);
  const journal = new ProvenanceJournal({ directory: userData });
  const matchingId = randomUUID(); const indexedId = randomUUID();
  const matching = path.join(directory, 'Matching published.mkv');
  const unrelated = path.join(directory, 'Unrelated race winner.mkv');
  const uncertain = path.join(directory, 'Uncertain corrupt.mkv');
  const absent = path.join(directory, 'Absent target.mkv');
  const indexed = path.join(directory, 'Indexed unmarked.mkv');
  await fixture(matching, { tags: ['FFMPEG_ENCODER_PROVENANCE=1', `FFMPEG_ENCODER_OUTPUT_ID=${matchingId}`] });
  await fixture(unrelated); await fixture(indexed);
  await fs.writeFile(uncertain, 'Deliberately corrupt generated fixture for recovery uncertainty.'); await protect(uncertain);
  for (const [outputId, destination] of [[matchingId, matching], [randomUUID(), unrelated], [randomUUID(), uncertain], [randomUUID(), absent], [indexedId, indexed]]) {
    await journal.recordIntent({ outputId, sourceIdentity, destination, profileId: 'h264-cpu' });
  }
  await journal.recordPublished(indexedId, await readSourceIdentity(indexed));
  // Seeded identity evidence deliberately represents a historical publication;
  // the bytes are not relabeled or remuxed. Product lookup still uses native
  // current identity and the durable checksummed published record.
  const stateFiles = (await fs.readdir(journal.directory)).sort();
  for (const name of stateFiles) await protect(path.join(journal.directory, name));
  await launch('seeded-recovery-and-index', userData);
  const startup = await current.page.evaluate(() => window.encoder.getSnapshot());
  assert.equal(startup.provenanceRecovery.matching, 1, JSON.stringify(startup));
  assert.equal(startup.provenanceRecovery.absent, 1);
  assert.equal(startup.provenanceRecovery.unrelated, 1);
  assert.equal(startup.provenanceRecovery.uncertain, 1);
  await configure(directory); const ready = await prepare('seeded index recognition');
  assert.equal(item(ready, path.basename(indexed)).status, 'generated');
  assert.equal(classifyMarker(await probe(indexed)).kind, 'unmarked');
  assert.equal(item(ready, path.basename(matching)).status, 'generated');
  assert.equal(item(ready, path.basename(unrelated)).status, 'ready');
  assert.ok(!ready.items.some(entry => entry.name === path.basename(absent)));
  await assert.rejects(fs.lstat(absent), { code: 'ENOENT' });
  assert.deepEqual((await fs.readdir(journal.directory)).sort(), stateFiles, 'Recovery must not create records or mutate pending history.');
  report.cases.push({ label: 'seeded journal with real product startup recovery and native identity-index lookup', injected: 'Five intent records and one published record represent interrupted/history cases; all media probes and identity reads are real.', directory, startup, ready, stateFiles });
  report.checks.push('Startup recovery distinguishes matching/absent/unrelated/uncertain pending targets without republishing/deleting/relabeling files; durable matching index evidence excludes an unmarked file.');
}

async function injectedPublicationFaults() {
  const directory = await folder('publication-faults'); const userData = await folder('publication-faults-state');
  const source = path.join(directory, 'Original.mkv'); await fixture(source);
  await launch('post-publication-index-failure', userData); await configure(directory);
  const ready = await prepare('index failure plan');
  await current.app.evaluate((_electron, modulePath) => {
    const { ProvenanceJournal } = process.getBuiltinModule('module').createRequire(modulePath)(modulePath);
    const record = ProvenanceJournal.prototype.recordPublished;
    ProvenanceJournal.prototype.recordPublished = function (...args) {
      ProvenanceJournal.prototype.recordPublished = record;
      throw Object.assign(new Error('Injected final index write failure.'), { code: 'EIO' });
    };
  }, path.join(root, 'src', 'provenance.cjs'));
  const published = await start('index failure preserves output');
  assert.equal(published.counts.success, 1, JSON.stringify(published));
  const output = path.join(directory, published.items[0].outputName);
  const marker = classifyMarker(await probe(output)); assert.equal(marker.kind, 'generated'); await protect(output);
  await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', output, '-f', 'null', '-']);
  const records = (await fs.readdir(path.join(userData, 'provenance-v1'))).sort();
  assert.ok(records.includes(`${marker.outputId}.intent.json`));
  assert.ok(!records.includes(`${marker.outputId}.published.json`));
  await assertNoStages(directory);
  await launch('restart-after-index-failure', userData);
  const startup = await current.page.evaluate(() => window.encoder.getSnapshot());
  assert.equal(startup.provenanceRecovery.matching, 1);
  await configure(directory); const restarted = await prepare('published output remains excluded after failed index');
  assert.equal(item(restarted, path.basename(output)).status, 'generated');
  assert.equal(item(restarted, path.basename(source)).status, 'skipped');
  report.cases.push({ label: 'real validated publication with injected final-index failure and fresh-process recovery', injected: 'ProvenanceJournal.recordPublished throws once after actual native publication.', ready, published, marker, records, startup, restarted });
  report.checks.push('Injected final index write failure preserves a real validated output and pending intent; a fresh process reports matching recovery and excludes the marked output.');
}

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  try {
    await ordinaryAndRestart(); await save();
    await markersAndLegacy(); await save();
    await collisionAndCancel();
    await seededRecoveryAndIndex(); await save();
    await injectedPublicationFaults();
    for (const [file, before] of protectedFiles) assert.equal(await hash(file), before, `Protected source/output changed: ${file}`);
    report.protectedFiles = [...protectedFiles].map(([file, sha256]) => ({ file, sha256 }));
    assert.deepEqual(report.errors, []);
    report.checks.push('Full SHA256 matches for every generated original and preserved completed/pre-existing output.');
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { message: error.message, stack: error.stack };
    if (current && !current.page.isClosed()) {
      report.failureUi = await current.page.evaluate(async () => ({ text: document.body.innerText, snapshot: await window.encoder.getSnapshot() })).catch(() => null);
      await current.page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    }
    throw error;
  } finally {
    await close().catch(error => { report.closeFailure = error.message; });
    await save();
    console.log(JSON.stringify({ status: report.status, report: path.join(artifacts, 'report.json'), checks: report.checks }));
  }
}

main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
