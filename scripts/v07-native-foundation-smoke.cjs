'use strict';

// Native O-foundation evidence only. The parent must grant the real-media slot
// before running this script. It never starts a personal-media encode: ordinary
// app capability probes may encode their own short, isolated synthetic samples.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { _electron } = require('playwright');
const { ENTRY_URL, CSP } = require('../src/local-protocol.cjs');
const { readSourceIdentity, sameIdentity } = require('../src/source-identity.cjs');

const root = path.resolve(__dirname, '..');
const owned = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const supplied = 'F:\\FFmpeg Encoder Project supplied videos\\Videos our FFmpeg Encoder have Issues with';
const expectedSources = ['107_new.mp4', '108_new.mp4', '109_new.mp4', 'Freelanzwya Sep 26th Live Workshop.mp4'];
const expectedBridge = ['getCapabilities', 'getPreferences', 'saveSettings', 'resetProfile', 'forgetPreferences',
  'clearInspectionCache', 'getRecipe', 'getEncodingDetails', 'chooseInputFolder', 'chooseOutputFolder',
  'prepareBatch', 'treatAsOriginal', 'reencodeOutputs', 'startBatch', 'cancelBatch', 'getSnapshot',
  'getDiagnosticHistory', 'getDiagnosticRecord', 'getDiagnosticExportPreview', 'onUpdate'];
const electronTrial = process.argv.includes('--electron-maintenance-trial');
const lifecycleOnly = process.argv.includes('--lifecycle-only');
const expectedElectron = electronTrial ? '44.7.0' : '44.2.0';
const executablePath = electronTrial
  ? path.join(owned, 'staging/runtime-trials/electron-44.7.0/electron.exe')
  : path.join(root, 'node_modules/electron/dist/electron.exe');
const serviceModule = path.join(root, 'src/encoder-service.cjs');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { schema: 1, id: randomUUID(), startedAt: new Date().toISOString(), status: 'running', cases: [], electronTrial, lifecycleOnly, expectedElectron, executablePath,
  limitations: [
    'Folder-picker return values are substituted at Electron dialog.showOpenDialog; actual UI buttons and preload/IPC preparation execute normally.',
    'Capability probes use real bundled tools on short owned synthetic samples. No personal-media encode, remux or benchmark run is started.',
    'Source preservation uses complete before/after bounded identities, not whole-file equality or a full hash sweep.',
    'Renderer failure is deliberately injected with forcefullyCrashRenderer. Startup quit delays diagnostics in a harness entry point; the production shutdown path executes unchanged.',
    'Screenshots and DOM observations establish this current UI, not future R workspace or owner visual acceptance.',
  ] };
let reportRoot, runRoot, leaseHandle, leaseIdentity, leasePath;
const liveApplications = new Set();

function inOwnedRoot(candidate) {
  const relative = path.relative(owned, candidate);
  assert.ok(relative && !relative.startsWith('..') && !path.isAbsolute(relative), 'Harness paths must stay inside the approved owned root.');
}
async function save() {
  if (reportRoot) await fs.writeFile(path.join(reportRoot, 'report.json'), JSON.stringify(report, null, 2));
}
async function acquireLease() {
  const base = path.join(root, 'artifacts/v0.7');
  await fs.mkdir(base, { recursive: true });
  leasePath = path.join(base, 'media-job.lock');
  // Exclusive create refuses every existing lease, even a seemingly dead one.
  // Recovery/ownership decisions belong to the parent, never to this harness.
  leaseHandle = await fs.open(leasePath, 'wx');
  leaseIdentity = await leaseHandle.stat({ bigint: true });
  await leaseHandle.writeFile(JSON.stringify({ schema: 1, token: report.id, pid: process.pid,
    purpose: 'v07-native-foundation', startedAt: report.startedAt }));
  await leaseHandle.sync();
}
async function releaseLease() {
  if (!leaseHandle) return;
  await leaseHandle.close(); leaseHandle = null;
  if (liveApplications.size) {
    report.leaseRetained = 'An owned native app has not confirmed exit; the parent must reconcile this lease before another media job.';
    return;
  }
  const observed = await fs.lstat(leasePath, { bigint: true });
  if (!observed.isFile() || observed.isSymbolicLink() || observed.dev !== leaseIdentity.dev || observed.ino !== leaseIdentity.ino) {
    report.leaseRetained = 'Lease identity changed; no unlink was attempted.'; return;
  }
  const content = JSON.parse(await fs.readFile(leasePath, 'utf8'));
  if (content.token !== report.id || content.pid !== process.pid) {
    report.leaseRetained = 'Lease ownership token changed; no unlink was attempted.'; return;
  }
  await fs.unlink(leasePath);
}
async function identities() {
  const result = {};
  for (const name of expectedSources) result[name] = await readSourceIdentity(path.join(supplied, name));
  return result;
}
async function journal(stateDir) {
  const directory = path.join(stateDir, 'diagnostics-v1/events');
  const events = [];
  for (const name of await fs.readdir(directory)) {
    if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
    const file = path.join(directory, name), stat = await fs.lstat(file);
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 65536, 'Diagnostic record bounds');
    const envelope = JSON.parse(await fs.readFile(file, 'utf8'));
    assert.equal(envelope.namespace, 'diagnostics-v1');
    assert.equal(envelope.digest, sha(JSON.stringify(envelope.event)), 'Diagnostic envelope digest');
    events.push(envelope.event);
  }
  return events.sort((a, b) => a.at - b.at || a.sequence - b.sequence);
}
async function launch(label, entry = root) {
  const directory = path.join(runRoot, label); inOwnedRoot(directory);
  const stateDir = path.join(directory, 'session-data'), output = path.join(directory, 'outputs');
  await fs.mkdir(stateDir, { recursive: true }); await fs.mkdir(output, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath, args: [entry, `--user-data-dir=${stateDir}`], cwd: root, env, timeout: 60000 });
  const context = { app, label, directory, stateDir, output, exited: false };
  liveApplications.add(context);
  context.exit = new Promise(resolve => {
    const child = app.process();
    const ended = (code, signal) => { context.exited = true; liveApplications.delete(context); resolve({ code, signal }); };
    child.once('exit', ended);
    if (child.exitCode !== null) ended(child.exitCode, child.signalCode);
  });
  return context;
}
async function exited(context, timeoutMs = 20000, allowedCodes = [0]) {
  let timer;
  try {
    const outcome = await Promise.race([context.exit, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${context.label}: native application did not exit within ${timeoutMs}ms.`)), timeoutMs);
    })]);
    assert.ok(allowedCodes.includes(outcome.code), JSON.stringify(outcome));
    return outcome;
  } finally { clearTimeout(timer); }
}
async function normalClose(context) {
  // This uses the production window-close path, not Playwright's forceful
  // connection teardown. Observe actual process exit and persisted terminal.
  await context.app.evaluate(({ BrowserWindow }) => { setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 30); });
  return exited(context);
}
async function snapshotUntil(page, predicate, timeoutMs = 150000) {
  const deadline = Date.now() + timeoutMs;
  let state;
  while (Date.now() < deadline) {
    state = await page.evaluate(() => window.encoder.getSnapshot());
    if (predicate(state)) return state;
    await wait(100);
  }
  throw new Error(`Native state deadline: ${JSON.stringify({ phase: state?.phase, error: state?.error, preparation: state?.preparation })}`);
}
async function observedIdentity(context) {
  const identity = await context.app.evaluate(({ app }) => ({ pid: process.pid, electron: process.versions.electron,
    version: app.getVersion(), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), appPath: app.getAppPath() }));
  assert.equal(identity.electron, expectedElectron, 'The observed native runtime must match the explicit baseline or isolated trial.');
  assert.equal(path.resolve(identity.userData), context.stateDir);
  assert.equal(path.resolve(identity.sessionData), context.stateDir);
  assert.equal(path.resolve(identity.appPath), root);
  return identity;
}
async function nativePreparation() {
  const context = await launch('preparation');
  const result = { name: 'real-ui-preload-preparation-clean-shutdown', stateDir: context.stateDir, output: context.output, checks: [] };
  report.cases.push(result); await save();
  const page = await context.app.firstWindow();
  const pageErrors = []; page.on('pageerror', error => pageErrors.push(error.message));
  result.identity = await observedIdentity(context);
  await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 180000 });
  assert.equal(page.url(), ENTRY_URL);
  result.capabilities = await page.evaluate(() => window.encoder.getCapabilities());
  assert.ok(result.capabilities.profiles.some(profile => profile.id === 'h265-cpu' && profile.available));
  result.bridge = await page.evaluate(() => ({ keys: Object.keys(window.encoder).sort(), frozen: Object.isFrozen(window.encoder),
    requireType: typeof window.require, processType: typeof window.process }));
  assert.deepEqual(result.bridge.keys, [...expectedBridge].sort());
  assert.equal(result.bridge.frozen, true); assert.equal(result.bridge.requireType, 'undefined'); assert.equal(result.bridge.processType, 'undefined');
  result.webPreferences = await context.app.evaluate(({ BrowserWindow }) => {
    const preferences = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return Object.fromEntries(['sandbox', 'contextIsolation', 'nodeIntegration', 'webSecurity', 'webviewTag'].map(key => [key, preferences[key]]));
  });
  assert.equal(result.webPreferences.sandbox, true); assert.equal(result.webPreferences.contextIsolation, true);
  assert.equal(result.webPreferences.nodeIntegration, false); assert.equal(result.webPreferences.webSecurity, true);
  result.protocol = await context.app.evaluate(async ({ session }) => {
    const trusted = session.fromPartition('encoder-local');
    const response = await trusted.fetch('app://encoder/index.html');
    const blocked = [];
    for (const url of ['app://encoder/main.js', 'app://encoder/../main.js', 'app://encoder/index.html?extra=1', 'app://other/index.html']) {
      try { const attempt = await trusted.fetch(url); blocked.push({ url, blocked: !attempt.ok, status: attempt.status }); }
      catch (error) { blocked.push({ url, blocked: true, reason: error.message }); }
    }
    return { status: response.status, csp: response.headers.get('content-security-policy'), nosniff: response.headers.get('x-content-type-options'), blocked };
  });
  assert.equal(result.protocol.status, 200); assert.equal(result.protocol.csp, CSP); assert.equal(result.protocol.nosniff, 'nosniff');
  assert.ok(result.protocol.blocked.every(attempt => attempt.blocked));
  result.checks.push('real capability discovery; isolated data; sandbox/narrow bridge; local protocol allowlist');
  // Block job execution at the service entry as a belt-and-braces harness guard.
  // Preparation and capability discovery remain production implementations.
  await context.app.evaluate(({ dialog }, options) => {
    const { EncoderService } = process.getBuiltinModule('module').createRequire(options.module)(options.module);
    EncoderService.prototype.execute = async function () { throw new Error('Native foundation harness forbids personal-media execution.'); };
    let index = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [options.folders[index++]] });
    dialog.showMessageBox = async () => ({ response: 1 });
  }, { module: serviceModule, folders: [supplied, context.output] });
  await page.screenshot({ path: path.join(reportRoot, '01-native-startup.png'), fullPage: true });
  await page.click('#choose-input'); await page.click('#choose-output');
  await page.selectOption('#profile', 'h265-cpu'); await page.selectOption('#preset', 'slow'); await page.fill('#quality', '25');
  await page.click('#prepare-batch');
  result.prepared = await snapshotUntil(page, state => ['ready', 'failed', 'cancelled'].includes(state.phase));
  assert.equal(result.prepared.phase, 'ready', JSON.stringify(result.prepared));
  assert.deepEqual(result.prepared.items.map(item => item.name).sort(), [...expectedSources].sort());
  assert.ok(result.prepared.items.every(item => item.status === 'unsupported'), 'Foundation baseline must report current refused media honestly; a changed policy needs a deliberate new expectation.');
  assert.ok(result.prepared.items.every(item => item.reason && item.reasonCode), 'Every refused input needs an actual reason and stable diagnostic code.');
  const visible = await page.locator('#batch-items').innerText();
  for (const name of expectedSources) assert.ok(visible.includes(name), 'Actual native table includes ' + name);
  result.ui = { activity: await page.locator('#activity-message').innerText(), preview: visible,
    startDisabled: await page.locator('#start-batch').isDisabled() };
  assert.equal(result.ui.startDisabled, true);
  await page.screenshot({ path: path.join(reportRoot, '02-native-refused-inputs.png'), fullPage: true });
  result.history = await page.evaluate(() => window.encoder.getDiagnosticHistory({ limit: 200 }));
  assert.equal(result.history.status.available, true);
  const inspected = result.history.events.filter(event => event.reason === 'FILE_INSPECTED');
  assert.equal(inspected.length, 4);
  result.inspectionRecords = [];
  for (const event of inspected) result.inspectionRecords.push(await page.evaluate(id => window.encoder.getDiagnosticRecord({ eventId: id }), event.id));
  assert.ok(result.inspectionRecords.every(item => item.event?.context?.code));
  result.redacted = await page.evaluate(ids => window.encoder.getDiagnosticExportPreview({ eventIds: ids }), inspected.map(event => event.id));
  assert.ok(result.redacted.data && result.redacted.json);
  assert.ok(!result.redacted.json.includes(supplied), 'Default export must not contain the supplied private path.');
  result.invalidDiagnosticRequest = await page.evaluate(async () => {
    try { await window.encoder.getDiagnosticRecord({ eventId: '..\\private.json', path: 'C:\\private' }); return { rejected: false }; }
    catch (error) { return { rejected: true, code: error.code, message: error.message }; }
  });
  assert.equal(result.invalidDiagnosticRequest.rejected, true);
  assert.deepEqual(await fs.readdir(context.output), [], 'No personal output was created.');
  result.checks.push('four supplied cases prepared through UI/preload; actionable refused states and durable bounded diagnostics; no Start/no output');
  assert.deepEqual(pageErrors, []); result.pageErrors = pageErrors;
  result.exit = await normalClose(context);
  result.events = await journal(context.stateDir);
  assert.equal(result.events.at(-1).type, 'session-end'); assert.equal(result.events.at(-1).outcome, 'completed');
  assert.ok(result.events.some(event => event.reason === 'PREPARATION_FINISHED'));
  assert.ok(!result.events.some(event => event.reason === 'ENCODE_STARTED'));
  result.checks.push('normal window close exits process with durable completed session marker');
  result.status = 'passed'; await save();
}
async function rendererCrash() {
  const context = await launch('renderer-crash');
  const result = { name: 'renderer-crash-native-shutdown', stateDir: context.stateDir };
  report.cases.push(result); await save();
  const page = await context.app.firstWindow();
  result.identity = await observedIdentity(context);
  // No readiness wait: if capability checking is active, this also exercises
  // real cancellation/owned-child drainage. The observed phase states the scope.
  result.before = await page.evaluate(() => window.encoder.getSnapshot());
  // Delay only the crash diagnostic and observe real cancellation ownership.
  // This proves a slow journal cannot postpone the synchronous abort request.
  result.orderPath = path.join(context.directory, 'renderer-loss-order.json');
  await context.app.evaluate((_electron, options) => {
    const fs = process.getBuiltinModule('fs');
    const { EncoderService } = process.getBuiltinModule('module').createRequire(options.module)(options.module);
    const originalCancel = EncoderService.prototype.cancelCurrent;
    const originalRecord = EncoderService.prototype.recordIncident;
    const observed = {};
    const save = () => fs.writeFileSync(options.file, JSON.stringify(observed));
    EncoderService.prototype.cancelCurrent = function (...args) {
      observed.cancelCalledAt ||= Date.now();
      const result = originalCancel.apply(this, args);
      observed.abortObserved = this.controller?.signal.aborted === true;
      save(); return result;
    };
    EncoderService.prototype.recordIncident = async function (event) {
      if (event.reason === 'RENDERER_GONE') {
        observed.crashRecordStartedAt = Date.now(); save();
        await new Promise(resolve => setTimeout(resolve, 1500));
        observed.crashRecordDelayEndedAt = Date.now(); save();
      }
      return originalRecord.call(this, event);
    };
  }, { module: serviceModule, file: result.orderPath });
  await context.app.evaluate(({ BrowserWindow }) => {
    setTimeout(() => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(), 30);
  });
  await save();
  // If the renderer dies before loadURL settles, startup also fails. Both paths
  // must drain and persist a failed session without a blocking native modal.
  result.exit = await exited(context, 30000, [0, 1]);
  result.order = JSON.parse(await fs.readFile(result.orderPath, 'utf8'));
  assert.ok(result.order.cancelCalledAt <= result.order.crashRecordStartedAt);
  assert.ok(result.order.crashRecordDelayEndedAt - result.order.cancelCalledAt >= 1400);
  if (['checking', 'preparing', 'running'].includes(result.before.phase)) assert.equal(result.order.abortObserved, true);
  result.events = await journal(context.stateDir);
  const crash = result.events.find(event => event.reason === 'RENDERER_GONE');
  assert.ok(crash, 'Renderer loss must be durably distinguished from intentional close.');
  assert.equal(crash.severity, 'error');
  if (result.exit.code === 1) assert.ok(result.events.some(event => event.reason === 'STARTUP_FAILED'));
  assert.equal(result.events.at(-1).type, 'session-end'); assert.equal(result.events.at(-1).outcome, 'failed');
  assert.ok(!result.events.some(event => event.reason === 'ENCODE_STARTED'));
  result.status = 'passed'; await save();
}
async function startupQuit() {
  const directory = path.join(runRoot, 'startup-quit'); inOwnedRoot(directory);
  await fs.mkdir(directory, { recursive: true });
  const hookPath = path.join(directory, 'startup-quit-hook.cjs'), markerPath = path.join(directory, 'hook-evidence.json');
  // This isolated test entry loads the real main.js. Only the initialization
  // delay and quit trigger are injected; production shutdown is not mocked.
  const hook = `'use strict';\nconst fs=require('node:fs');\nconst {app,BrowserWindow}=require('electron');\nconst root=${JSON.stringify(root)};\napp.getAppPath=()=>root;\nconst {EncoderService}=require(${JSON.stringify(serviceModule)});\nconst original=EncoderService.prototype.initializeDiagnostics;\nlet armed=false;\nEncoderService.prototype.initializeDiagnostics=async function(...args){\n const pending=original.apply(this,args);\n if(armed)return pending;\n armed=true;\n await new Promise(resolve=>setTimeout(resolve,1800));\n fs.writeFileSync(${JSON.stringify(markerPath)},JSON.stringify({at:new Date().toISOString(),pid:process.pid,windows:BrowserWindow.getAllWindows().length,event:'quit-during-diagnostics-initialization'}));\n app.quit();\n await new Promise(resolve=>setTimeout(resolve,150));\n return pending;\n};\nrequire(${JSON.stringify(path.join(root, 'main.js'))});\n`;
  await fs.writeFile(hookPath, hook, { flag: 'wx' });
  const result = { name: 'quit-before-window-native-shutdown', hookPath, markerPath };
  report.cases.push(result); await save();
  const context = await launch('startup-quit', hookPath); result.stateDir = context.stateDir;
  result.exit = await exited(context, 20000);
  result.injection = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  assert.equal(result.injection.windows, 0, 'Quit must occur in the intended windowless initialization interval.');
  result.events = await journal(context.stateDir);
  assert.equal(result.events.at(-1).type, 'session-end'); assert.equal(result.events.at(-1).outcome, 'completed');
  assert.ok(!result.events.some(event => event.stage === 'capability'), 'No window/startup capability work should begin after early quit.');
  result.status = 'passed'; await save();
}
async function rendererCrashDuringLoad() {
  const directory = path.join(runRoot, 'renderer-crash-during-load'); inOwnedRoot(directory);
  await fs.mkdir(directory, { recursive: true });
  const hookPath = path.join(directory, 'early-renderer-crash-hook.cjs');
  const markerPath = path.join(directory, 'early-renderer-crash.json');
  // Force the actual renderer to die at DOM readiness while native loadURL is
  // still pending. Unlike the normal crash case, this deterministically covers
  // the startup-rejection race reported by Ahmed's screenshot.
  const hook = `'use strict';
const fs=require('node:fs');
const {app,BrowserWindow}=require('electron');
app.getAppPath=()=>${JSON.stringify(root)};
const state={}; const save=()=>fs.writeFileSync(${JSON.stringify(markerPath)},JSON.stringify(state));
const load=BrowserWindow.prototype.loadURL;
BrowserWindow.prototype.loadURL=function(...args){
 let settled=false;
 this.webContents.once('dom-ready',()=>{
  state.injection={loadSettled:settled,url:args[0],at:Date.now()}; save();
  this.webContents.forcefullyCrashRenderer();
 });
 this.webContents.on('did-fail-load',(_event,code,description,url,isMain)=>{
  state.failure={code,description,url,isMain}; save();
 });
 return load.apply(this,args).then(value=>{settled=true;return value;},error=>{
  settled=true;state.loadRejected={message:error.message,code:error.code};save();throw error;
 });
};
require(${JSON.stringify(path.join(root, 'main.js'))});
`;
  await fs.writeFile(hookPath, hook, { flag: 'wx' });
  const result = { name: 'renderer-crash-during-initial-load', hookPath, markerPath };
  report.cases.push(result); await save();
  const context = await launch('renderer-crash-during-load', hookPath); result.stateDir = context.stateDir;
  result.exit = await exited(context, 30000, [0, 1]);
  result.injection = JSON.parse(await fs.readFile(markerPath, 'utf8'));
  assert.equal(result.injection.injection.loadSettled, false);
  // Native event order varies: the renderer-loss owner can close the window
  // before navigation rejects. Both orders must end durably, with no hang.
  if (result.injection.loadRejected) assert.match(result.injection.loadRejected.message, /ERR_FAILED|ERR_ABORTED/);
  result.events = await journal(context.stateDir);
  if (result.exit.code === 1) assert.ok(result.events.some(event => event.reason === 'STARTUP_FAILED'));
  assert.ok(result.events.some(event => event.reason === 'RENDERER_GONE'));
  assert.equal(result.events.at(-1).type, 'session-end');
  assert.equal(result.events.at(-1).outcome, 'failed');
  result.status = 'passed'; await save();
}
async function main() {
  if (!process.argv.includes('--parent-granted-media-slot')) throw new Error('Refusing launch: the parent must explicitly grant the media slot, then pass --parent-granted-media-slot.');
  assert.equal(require('../package.json').devDependencies.electron, '44.2.0', 'Pre-maintenance baseline only.');
  const actualSources = (await fs.readdir(supplied, { withFileTypes: true })).filter(entry => entry.isFile()).map(entry => entry.name).sort();
  assert.deepEqual(actualSources, [...expectedSources].sort(), 'Refuse unexpectedly expanded personal-media scope.');
  await acquireLease();
  try {
    reportRoot = path.join(root, 'artifacts/v0.7/native-foundation', report.id);
    runRoot = path.join(owned, 'staging', 'native-foundation-' + report.id); inOwnedRoot(runRoot);
    await fs.mkdir(reportRoot, { recursive: true }); await fs.mkdir(runRoot, { recursive: false });
    Object.assign(report, { reportRoot, runRoot, supplied, sourceIdentitiesBefore: await identities() }); await save();
    if (!lifecycleOnly) await nativePreparation();
    await rendererCrash(); await rendererCrashDuringLoad(); await startupQuit();
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed'; report.failure = { message: error.message, stack: error.stack }; process.exitCode = 1;
  } finally {
    // Ask only applications launched by this harness to exit. Never use a
    // process-name kill, delete an output tree, or clear another owner's lease.
    for (const context of [...liveApplications]) {
      try { await context.app.close(); await exited(context); }
      catch (error) { report.cleanupFailure ||= []; report.cleanupFailure.push({ label: context.label, message: error.message }); }
    }
    if (report.sourceIdentitiesBefore) {
      try {
        report.sourceIdentitiesAfter = await identities();
        report.sourcesBoundedUnchanged = expectedSources.every(name => sameIdentity(report.sourceIdentitiesBefore[name], report.sourceIdentitiesAfter[name]));
        if (!report.sourcesBoundedUnchanged) { report.status = 'failed'; report.sourcePreservationFailure = true; process.exitCode = 1; }
      } catch (error) { report.sourceVerificationFailure = error.message; report.status = 'failed'; process.exitCode = 1; }
    }
    await releaseLease(); report.finishedAt = new Date().toISOString(); await save();
    console.log(JSON.stringify({ status: report.status, report: reportRoot && path.join(reportRoot, 'report.json'), cases: report.cases.map(item => ({ name: item.name, status: item.status || 'incomplete' })), failure: report.failure?.message }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
