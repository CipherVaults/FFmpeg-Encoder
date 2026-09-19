'use strict';

// Amended L generated-output and canonical-argv endpoint acceptance. Only generated fixtures beneath this run's artifact
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
const artifacts = path.join(root, 'artifacts', `amended-workflow-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`);
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


async function readyUI() {
  await current.page.waitForFunction(() => !document.querySelector('#choose-input').disabled && !!window.encoder.getPreferences, undefined, {timeout:120000});
}
async function persisted(profileId, preset, quality) {
  await current.page.waitForFunction(async expected => {
    const p = await window.encoder.getPreferences(); const v = p.settingsByProfile[expected.profileId];
    return p.profileId === expected.profileId && v?.preset === expected.preset && v?.quality === expected.quality;
  }, {profileId,preset,quality}, {timeout:10000});
}
async function setSettings(profileId, preset, quality) {
  await current.page.selectOption('#profile', profileId);
  await current.page.selectOption('#preset', preset);
  await current.page.fill('#quality', String(quality));
  await persisted(profileId,preset,quality);
}
async function values() {
  return current.page.evaluate(() => ({profileId:document.querySelector('#profile').value,preset:document.querySelector('#preset').value,quality:Number(document.querySelector('#quality').value),slider:Number(document.querySelector('#quality-slider').value)}));
}
async function namespaceHashes(userData, namespace) {
  const directory=path.join(userData,namespace); const result={};
  let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return result;throw e;}
  for(const entry of entries) if(entry.isFile()) result[entry.name]=await hash(path.join(directory,entry.name));
  return result;
}

const rowFor = entry => current.page.locator(`tr[data-file-id="${entry.id}"]`);
async function detailsFor(state, entry) {
  const args = await current.page.evaluate(request => window.encoder.getEncodingDetails(request), { planId: state.planId, fileId: entry.id });
  const row = rowFor(entry);
  const outer = row.locator('[data-testid="file-details"]');
  if (await outer.getAttribute('open') === null) await outer.locator('summary').first().click();
  const details = row.locator('[data-testid="encoding-details"]');
  if (await details.getAttribute('open') === null) await details.locator('summary').click();
  await current.page.waitForFunction(({ id, expected }) => {
    const raw = document.querySelector(`tr[data-file-id="${id}"] [data-testid="resolved-args"]`)?.textContent;
    try { return JSON.stringify(JSON.parse(raw)) === JSON.stringify(expected); } catch { return false; }
  }, { id: entry.id, expected: args.args });
  assert.deepEqual(JSON.parse(await row.locator('[data-testid="resolved-args"]').textContent()), args.args);
  return args;
}
async function selectOnly(entry) {
  await current.page.click('#clear-selection');
  await rowFor(entry).locator('[data-testid="encode-file"]').check();
}
function assertExecutedTemplate(prepared, observed) {
  assert.ok(Array.isArray(prepared.args) && prepared.args.length > 20);
  assert.equal(prepared.kind, 'resolved-argument-template');
  assert.ok(prepared.outputPlaceholder);
  assert.equal(prepared.args.at(-1), prepared.outputPlaceholder);
  const expected = [...prepared.args]; expected[expected.length - 1] = observed.argv.at(-1);
  assert.deepEqual(observed.argv, expected, 'Spawned argv differs from the displayed prepared template beyond its declared staging path');
}
async function apiError(method, request) {
  return current.page.evaluate(async ({ method, request }) => {
    try { await window.encoder[method](request); return null; } catch (error) { return error.code || error.message; }
  }, { method, request });
}
async function transparentGeneratedWorkflow() {
  const input = await folder('Same folder العربية & apostrophe\'s');
  const userData = await folder('amended state');
  const source = path.join(input, 'Original العربية & sample.mkv');
  await fixture(source, { duration: 2 });
  const old = path.join(input, 'Old marked settings unknown.mkv');
  await fixture(old, { tags: ['FFMPEG_ENCODER_PROVENANCE=1', `FFMPEG_ENCODER_OUTPUT_ID=${randomUUID()}`] });
  const legacy = path.join(input, 'Historical_H265-CPU.mkv');
  await fs.copyFile(source, legacy); await protect(legacy);
  await launch('produce described CPU output', userData); await readyUI();
  await configure(input, input, 'h264-cpu', 'veryfast'); await setSettings('h264-cpu', 'veryfast', 29);

  const cpuRecipe = await current.page.evaluate(() => window.encoder.getRecipe({ profileId: 'h264-cpu', preset: 'veryfast', quality: 29 }));
  // Focus opens the same explanation as hovering; direct browser observation
  // below verifies that the information can be reached without a mouse hover.
  await current.page.focus('#preset-help');
  await current.page.waitForFunction(() => document.querySelector('#preset-help-details').open);
  await current.page.waitForFunction(() => document.querySelector('#preset-contribution').textContent.includes('veryfast'));
  assert.match(await current.page.textContent('#preset-contribution'), /veryfast/);
  await current.page.hover('#default-help');
  await current.page.waitForFunction(() => document.querySelector('#default-help-details').open);
  await current.page.waitForFunction(() => document.querySelector('#default-args').textContent.includes('slower'));
  assert.match(await current.page.textContent('#default-args'), /slower/);
  assert.match(await current.page.textContent('#default-args'), /24/);
  await current.page.screenshot({ path: path.join(artifacts, 'cpu-help.png'), fullPage: true });

  let state = await prepare('original plus marked and ambiguous files');
  const original = item(state, path.basename(source));
  assert.equal(original.status, 'ready');
  assert.equal(item(state, path.basename(old)).status, 'generated');
  assert.equal(item(state, path.basename(legacy)).status, 'ambiguous');
  await current.page.selectOption('#batch-filter', 'all');
  assert.match(await rowFor(item(state, path.basename(old))).locator('[data-testid="previous-generation"]').textContent(), /unavailable|unknown/i);
  const preparedCPU = await detailsFor(state, original);
  await selectOnly(original); state = await start('CPU first generation');
  const commandCPU = await current.app.evaluate(() => globalThis.__sameFolderSmoke.commands.at(-1));
  assertExecutedTemplate(preparedCPU, commandCPU);
  const firstOutput = path.join(input, item(state, path.basename(source)).outputName);
  const firstProbe = await probe(firstOutput); assert.equal(classifyMarker(firstProbe).kind, 'generated');
  await protect(firstOutput); await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', firstOutput, '-f', 'null', '-']);
  const copyA = path.join(input, 'Generated copy A.mkv'); const copyB = path.join(input, 'Generated copy B.mkv');
  await fs.copyFile(firstOutput, copyA); await fs.copyFile(firstOutput, copyB); await protect(copyA); await protect(copyB);

  await current.page.click('#new-batch'); await setSettings('h265-nvidia', 'p6', 23);
  const nvidiaRecipe = await current.page.evaluate(() => window.encoder.getRecipe({ profileId: 'h265-nvidia', preset: 'p6', quality: 23 }));
  await current.page.focus('#preset-help');
  await current.page.waitForFunction(() => document.querySelector('#preset-contribution').textContent.includes('p6'));
  assert.match(await current.page.textContent('#preset-contribution'), /p6/);
  state = await prepare('generated subset with changed backend and codec');
  const first = item(state, path.basename(firstOutput)); const a = item(state, path.basename(copyA)); const b = item(state, path.basename(copyB));
  for (const generated of [first, a, b]) {
    assert.equal(generated.status, 'generated'); assert.equal(generated.reencodeAuthorized, false);
    assert.equal(generated.origin.kind, 'generated');
  }
  const selectedBeforeFilter = await current.page.textContent('#selected-count');
  await current.page.selectOption('#batch-filter', 'generated');
  assert.equal(await current.page.textContent('#selected-count'), selectedBeforeFilter);
  const afterFilter = await current.page.evaluate(() => window.encoder.getSnapshot());
  assert.ok(afterFilter.items.filter(i => i.origin?.kind === 'generated').every(i => !i.reencodeAuthorized));
  assert.match(await rowFor(first).locator('[data-testid="previous-generation"]').textContent(), /veryfast/);
  assert.match(await rowFor(first).locator('[data-testid="previous-generation"]').textContent(), /29/);

  // The UI selection for deliberate admission is distinct from encode selection.
  await rowFor(first).locator('[data-testid="choose-reencode"]').check();
  await rowFor(a).locator('[data-testid="choose-reencode"]').check();
  assert.match(await current.page.textContent('#reencode-selected-count'), /2/);
  assert.match(await current.page.textContent('#reencode-warning'), /quality loss/i);
  await current.page.click('#reencode-selected');
  state = await until(s => s.phase === 'ready' && item(s, first.name).reencodeAuthorized && item(s, a.name).reencodeAuthorized);
  assert.equal(item(state, b.name).status, 'generated'); assert.equal(item(state, b.name).reencodeAuthorized, false);
  assert.equal(item(state, path.basename(old)).reencodeAuthorized, false);
  assert.equal(item(state, first.name).origin.kind, 'generated');
  const preparedGPU = await detailsFor(state, item(state, first.name));
  assert.ok(preparedGPU.args.includes('hevc_nvenc')); assert.ok(preparedGPU.args.includes('p6')); assert.ok(preparedGPU.args.includes('23'));
  await current.page.screenshot({ path: path.join(artifacts, 'generated-authorized-command.png'), fullPage: true });
  await selectOnly(item(state, first.name)); state = await start('intentional CPU output to NVIDIA H265 re-encode');
  const commandGPU = await current.app.evaluate(() => globalThis.__sameFolderSmoke.commands.at(-1)); assertExecutedTemplate(preparedGPU, commandGPU);
  const secondOutput = path.join(input, item(state, first.name).outputName); await protect(secondOutput);
  const secondProbe = await probe(secondOutput); assert.equal(classifyMarker(secondProbe).kind, 'generated');
  assert.notEqual(classifyMarker(secondProbe).outputId, classifyMarker(firstProbe).outputId);
  await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', secondOutput, '-f', 'null', '-']);

  state = await newPlan('completed generations excluded again without recursion');
  for (const name of [first.name, a.name, b.name, path.basename(secondOutput)]) {
    assert.equal(item(state, name).status, 'generated'); assert.equal(item(state, name).reencodeAuthorized, false);
  }
  await current.page.selectOption('#batch-filter', 'generated');
  await rowFor(item(state, first.name)).locator('[data-testid="reencode-output"]').click();
  state = await until(s => s.phase === 'ready' && item(s, first.name).reencodeAuthorized);
  assert.equal(item(state, first.name).status, 'skipped', 'Existing second generation must never be overwritten');

  // A changed file invalidates admission even when its contents still decode.
  const bNow = item(state, b.name);
  await rowFor(bNow).locator('[data-testid="reencode-output"]').click();
  state = await until(s => s.phase === 'ready' && item(s, b.name).reencodeAuthorized);
  await selectOnly(item(state, b.name));
  const stat = await fs.stat(copyB); await fs.utimes(copyB, stat.atime, new Date(stat.mtimeMs + 2000));
  const countBefore = await current.app.evaluate(() => globalThis.__sameFolderSmoke.commands.length);
  state = await start('changed authorized source fails without child encode');
  assert.equal(item(state, b.name).status, 'failed');
  assert.match(item(state, b.name).reason, /changed/i);
  assert.equal(await current.app.evaluate(() => globalThis.__sameFolderSmoke.commands.length), countBefore);
  const staleRequest = { planId: state.planId, fileIds: [a.id] };
  await close(); await launch('restart loses all reencode authority', userData); await readyUI();
  assert.equal((await current.page.evaluate(() => window.encoder.getSnapshot())).phase, 'idle');
  assert.ok(await apiError('reencodeOutputs', staleRequest));
  state = await prepare('restart generated defaults');
  assert.ok(state.items.filter(i => i.origin?.kind === 'generated').every(i => i.status === 'generated' && !i.reencodeAuthorized));
  report.cases.push({ cpuRecipe, nvidiaRecipe, preparedCPU, commandCPU, preparedGPU, commandGPU,
    firstOutput, secondOutput, firstTags: firstProbe.format.tags, secondTags: secondProbe.format.tags,
    restartItems: state.items.map(i => ({ name: i.name, status: i.status, origin: i.origin, reencodeAuthorized: i.reencodeAuthorized })) });
  report.checks.push('Native main/preload/UI CPU first generation and explicit NVIDIA H265 re-encode decode successfully with fresh provenance.',
    'Displayed per-file argv exactly equals spawned production argv except the explicitly labelled temporary output substitution.',
    'Hover and keyboard focus expose canonical native preset/default arguments; direct controls remain visible.',
    'Explicit generated subset admission leaves unrelated files excluded; Generated filter does not authorize or alter queue selection.',
    'Known prior settings shown, marker-only prior settings unknown; legacy action stays separate.',
    'Reprepare and restart clear generated authorization, existing destination skips and changed authorized source launches no encode.');
}
async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  try {
    report.sourceHashes = {};
    for (const f of ['src/media.cjs', 'src/preferences.cjs', 'src/encoder-service.cjs', 'src/inspection.cjs', 'src/provenance.cjs', 'preload.js', 'src/ipc.cjs', 'ui/index.html', 'ui/renderer.js', 'ui/styles.css']) report.sourceHashes[f] = await hash(path.join(root, f));
    await transparentGeneratedWorkflow(); await close(); report.protectedHashes = [];
    for (const [file, before] of protectedFiles) { const after = await hash(file); assert.equal(after, before); report.protectedHashes.push({ file, sha256: after }); }
    assert.deepEqual(report.errors, []); report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { message: error.message, stack: error.stack };
    if (current && !current.page.isClosed()) { await current.page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); report.failureText = await current.page.locator('body').innerText().catch(() => null); }
    throw error;
  } finally { await close(); await save(); console.log(JSON.stringify({ status: report.status, report: path.join(artifacts, 'report.json') })); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
