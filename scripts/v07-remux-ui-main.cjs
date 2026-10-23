'use strict';

// Separate root-owned Electron entry: actual production modules and default
// policies, hidden isolated state, bounded exact-source media authority only.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const { ROOT, PURPOSE, LEASE_PATH, LIMITS, CASES, SPECIMENS, sha, identity, samePath, inside,
  pathsFor, ordinaryPath, stableFile, producerManifest, resourceCheck, bounded } = require('./v07-remux-ui.cjs');
assert.equal(process.platform, 'win32'); assert.ok(app.commandLine.hasSwitch('run-owned-remux-ui'));
const id = app.commandLine.getSwitchValue('remux-ui-id'), places = pathsFor(id);
assert.ok(samePath(app.commandLine.getSwitchValue('user-data-dir'), places.stateDir));
const marker = JSON.parse(stableFile(path.join(places.runRoot, 'run-root.json')).bytes);
assert.equal(marker.schema, 1); assert.equal(marker.id, id); assert.equal(marker.purpose, PURPOSE);
assert.ok(Number.isFinite(Date.parse(marker.startedAt)) && Date.now() >= Date.parse(marker.startedAt)
  && Date.now() - Date.parse(marker.startedAt) < LIMITS.totalMs, 'The driver-owned whole-run deadline is current.');
assert.ok(Object.hasOwn(CASES, marker.case)); assert.deepEqual(marker.selected, CASES[marker.case]);
for (const key of Object.keys(places)) { assert.equal(marker[key], places[key]); ordinaryPath(places[key], 'directory'); }
assert.deepEqual(marker.limits, LIMITS); assert.deepEqual(producerManifest(), marker.producers);
const ownedMarker = JSON.parse(stableFile(path.join(places.ownedRoot, 'owned-root.json')).bytes);
assert.deepEqual(ownedMarker, { schema: 1, id, purpose: PURPOSE, runRoot: places.runRoot });
const specimen = SPECIMENS[marker.selected.specimen], inputFile = path.join(places.input, specimen.name);
assert.equal(marker.source.inputFile, inputFile); assert.equal(marker.source.sha256, specimen.sha256);
assert.equal(marker.sentinel.file, path.join(places.output, 'protected-existing-text.txt'));
assert.equal(stableFile(inputFile, 512 * 1024 ** 2).sha256, specimen.sha256);
const leaseBefore = stableFile(LEASE_PATH);
const lease = JSON.parse(leaseBefore.bytes); assert.equal(lease.token, id); assert.equal(lease.pid, marker.driverPid);
assert.equal(lease.purpose, PURPOSE); assert.equal(lease.runRoot, places.runRoot);
for (const key of ['dev', 'ino', 'birthtimeNs']) assert.equal(leaseBefore.identity[key], marker.lease.identity[key]);
app.setPath('userData', places.stateDir); app.setPath('sessionData', places.stateDir);
for (const name of ['disable-background-networking', 'disable-component-update', 'disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows']) app.commandLine.appendSwitch(name);

const evidence = { schema: 1, id, purpose: PURPOSE, ...places, startedAt: marker.startedAt, hostStartedAt: new Date().toISOString(),
  electron: process.versions.electron, node: process.versions.node, chromium: process.versions.chrome,
  producersBefore: marker.producers, dialogs: [], events: [], invocations: [], blockedActions: [], copyJobs: 0,
  maximumConcurrentChildren: 0, liveChildren: 0, pipeBytes: { stdout: 0, stderr: 0 },
  capabilities: { profiles: [], recipes: [], versions: {}, observation: 'Unavailable in this bounded Remux host. No encoder/device capability observation or encoder probe occurred.' },
  capturePolicy: { alwaysHidden: true, backgroundThrottling: false, stayHidden: true, systemSleepControl: 'No keep-awake request.' },
  limitations: ['Main-substituted folder results; native OS pickers untested.', 'Output-opening OS applications are blocked and untested.',
    'No synthetic running phase, injected inspection, plan, evidence, collector result or prospective policy.'] };
const proofFile = path.join(places.runRoot, 'main-proof.json');
function save() {
  const text = JSON.stringify(evidence, null, 2) + '\n'; assert.ok(Buffer.byteLength(text) <= 16 * 1024 ** 2);
  fs.writeFileSync(proofFile, text);
}
const children = new Set(), childClosures = new Set();
let permittedSpawn = null, activeInvocation = false, runtime, service, window, removeHandlers;
let closing = false, finished = false, closePromise, totalTimer, resourceTimer, resourceObservation, runningCapturePromise;
const controller = new AbortController();
function saveAfterChildHandoff(label) {
  try { save(); }
  catch (error) {
    // Disk/report failures may abort the owned operation, but may never throw
    // between nativeSpawn returning a handle and runTool receiving ownership.
    evidence.proofPersistenceFailure ||= { label, code: error.code, message: error.message };
    controller.abort();
    if (!closing) setImmediate(() => { void finish('failed').catch(failure => {
      evidence.shutdownFailure = { code: failure.code, message: failure.message };
      // No forced exit here: the root-owned lease must remain if durable
      // closure proof cannot be written. Actual children are drained first.
    }); });
  }
}
async function drainTrackedChildren() {
  const tracked = [...children];
  for (const child of tracked) { try { child.kill(); } catch { /* actual close remains the boundary */ } }
  const retry = setTimeout(() => { for (const child of tracked) if (children.has(child)) {
    try { child.kill('SIGKILL'); } catch { /* preserve ownership until close */ }
  } }, 2000); retry.unref();
  try { await Promise.all([...childClosures]); }
  finally { clearTimeout(retry); }
  assert.equal(children.size, 0, 'Every harness-tracked child must actually close before app exit.');
}
function refuse(message) { return Object.assign(new Error(message), { code: 'REMUX_UI_HOST_BOUNDARY' }); }
function assertLease() {
  const current = stableFile(LEASE_PATH); const value = JSON.parse(current.bytes);
  for (const key of ['dev', 'ino', 'birthtimeNs']) assert.equal(current.identity[key], marker.lease.identity[key]);
  assert.equal(value.token, id); assert.equal(value.pid, marker.driverPid); assert.equal(value.purpose, PURPOSE);
}
function block(api, executable) {
  evidence.blockedActions.push({ api, executable: String(executable), at: new Date().toISOString() }); save();
  throw refuse('This harness permits only the current exact service-owned runtime/storage invocation.');
}
// Install before production modules capture spawn. Every process must be issued
// by guardedRun, match its exact argv and close before ownership is released.
const childProcess = require('node:child_process'), nativeSpawn = childProcess.spawn;
childProcess.spawn = (file, args, options) => {
  if (!permittedSpawn || permittedSpawn.spawned || file !== permittedSpawn.file
      || JSON.stringify(args) !== JSON.stringify(permittedSpawn.args)) return block('spawn', file);
  assert.equal(options.windowsHide, true); assert.equal(options.shell, false); assert.equal(children.size, 0);
  assertLease(); assert.deepEqual(producerManifest(), marker.producers);
  const invocation = permittedSpawn; invocation.spawned = true;
  const child = nativeSpawn(file, args, options); invocation.entry.pid = child.pid; invocation.entry.childHandleObserved = true;
  children.add(child); evidence.liveChildren = children.size;
  evidence.maximumConcurrentChildren = Math.max(evidence.maximumConcurrentChildren, children.size);
  let resolveClose;
  const childClose = new Promise(resolve => { resolveClose = resolve; }); childClosures.add(childClose);
  child.once('close', (code, signal) => {
    invocation.entry.closed = { code, signal, at: new Date().toISOString() };
    children.delete(child); evidence.liveChildren = children.size; childClosures.delete(childClose); resolveClose();
    saveAfterChildHandoff('actual-child-close');
  });
  // The microtask runs only after the synchronous runTool handle handoff and
  // its own abort/close listeners have been installed. This call cannot throw
  // a filesystem failure back across the native spawn return boundary.
  queueMicrotask(() => saveAfterChildHandoff('actual-child-spawn'));
  return child;
};
for (const name of ['spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) childProcess[name] = file => block(name, file);
require('node:module').syncBuiltinESMExports();
const { runTool } = require('../src/process-runner.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { verifyCandidateRuntime } = require('../src/candidate-runtime.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('../src/remux-catalog.cjs');
const { StorageEligibility } = require('../src/storage-eligibility.cjs');
const { registerIpc } = require('../src/ipc.cjs');
const { ENTRY_URL, CSP, resolveAsset, registerLocalProtocol } = require('../src/local-protocol.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

async function guardedRun(file, args, options = {}, execute = runTool) {
  assert.ok(!closing && !controller.signal.aborted); assert.equal(activeInvocation, false); assert.equal(children.size, 0);
  // Reserve admission before asynchronous resource checks. A second caller
  // cannot race the preflight and replace the exact pending spawn permit.
  activeInvocation = true;
  let entry, spawned;
  try {
    assert.ok(evidence.invocations.length < LIMITS.maxChildren, 'Whole UI run reached its stricter 64-child ceiling.');
    assert.ok(Date.now() - Date.parse(evidence.startedAt) < LIMITS.totalMs); assertLease();
    assert.deepEqual(producerManifest(), marker.producers);
    const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    if (samePath(file, helper)) {
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']); assert.equal(args.length, 5);
      // The production module containing this fixed helper is hash-frozen.
      // No renderer or CLI text is accepted as PowerShell code or its input.
      assert.ok(args[4].includes('[System.IO.DriveInfo]::new') && args[4].includes("throw 'Invalid drive request'"));
      assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' });
    } else {
      assert.ok(file === runtime.ffmpeg || file === runtime.ffprobe, 'Only the pinned candidate pair is permitted.');
      assert.ok(Array.isArray(args) && args.length <= 8192 && args.every(value => typeof value === 'string' && !value.includes('\0')));
      assert.ok(!args.includes('-y')); assert.ok(!args.some(value => /^(?:https?|ftp|tcp|udp|srt|rtmp):/i.test(value)));
      for (const value of args) if (path.isAbsolute(value)) assert.ok(inside(places.ownedRoot, value), 'All media paths stay inside this exact F-owned run.');
      for (let index = 0; index < args.length; index++) if (args[index] === '-i') assert.ok(inside(places.ownedRoot, args[index + 1]));
      if (file === runtime.ffprobe) assert.ok(inside(places.ownedRoot, args.at(-1)), 'No version/listing/capability probe is permitted.');
      else if (!['-', 'pipe:1'].includes(args.at(-1))) {
        assert.ok(inside(places.output, args.at(-1)), 'The sole media writer uses protected output staging.');
        assert.equal(args[args.indexOf('-c') + 1], 'copy'); assert.ok(args.includes('-n'));
        assert.ok(!args.includes('-vf') && !args.includes('-filter_complex'));
        assert.equal(++evidence.copyJobs, 1, 'This endpoint run authorizes exactly one actual stream copy.');
      }
    }
    evidence.resourcesLatest = await resourceCheck(places.ownedRoot);
    entry = { sequence: evidence.invocations.length + 1, file, args: [...args], status: 'running', startedAt: new Date().toISOString() };
    evidence.invocations.push(entry); permittedSpawn = { file, args: [...args], entry, spawned: false }; save();
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
    const result = await execute(file, args, { ...options, signal, timeoutMs: Math.min(options.timeoutMs || LIMITS.childMs, LIMITS.childMs),
      onOutputBytes: value => { evidence.pipeBytes[value.stream] += value.bytes;
        assert.ok(evidence.pipeBytes.stdout + evidence.pipeBytes.stderr <= LIMITS.maxPipeBytes, 'Whole-run aggregate pipe-byte ceiling exceeded.');
        options.onOutputBytes?.(value); },
      onChild: child => { spawned = child; assert.ok(children.has(child)); options.onChild?.(child); } });
    assert.ok(spawned && entry.closed, 'A returned invocation needs the actual child close event.');
    entry.status = 'completed'; entry.exitCode = result.exitCode; entry.stderr = result.stderr; entry.stderrCapture = result.stderrCapture;
    return result;
  } catch (error) {
    if (entry) Object.assign(entry, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, stderrCapture: error.stderrCapture });
    else evidence.invocationAdmissionFailure = { code: error.code, message: error.message };
    throw error;
  }
  finally {
    // runTool and OperationRuntimeObserver both retain close and sink ownership.
    // Never clear a live handle or advertise closure to let the driver unlock.
    if (entry) { entry.finishedAt = new Date().toISOString(); entry.closedObserved = Boolean(entry.closed); }
    permittedSpawn = null; activeInvocation = false; save();
  }
}
function observe(snapshot) {
  assert.ok(evidence.events.length < 4096, 'Bounded actual service event history exceeded.');
  const event = { sequence: evidence.events.length + 1, at: new Date().toISOString(), revision: snapshot.revision,
    phase: snapshot.phase, operation: snapshot.operation, batchId: snapshot.batchId, planId: snapshot.planId,
    progress: snapshot.progress, counts: snapshot.counts,
    items: snapshot.items.map(item => ({ id: item.id, name: item.name, status: item.status, reencodeAuthorized: item.reencodeAuthorized, reason: item.reason })) };
  evidence.events.push(event); save();
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    window.webContents.send('encoder:update', snapshot);
    if (snapshot.phase === 'running' && !runningCapturePromise) runningCapturePromise = captureRealRunningEvent(event);
  }
}
async function captureRealRunningEvent(event) {
  const attempt = { triggeredByActualEvent: event, status: 'requested', file: path.join(places.runRoot, 'actual-running-event.png') };
  evidence.runningCapture = attempt; save();
  try {
    // Wait for actual UI frame presentation, never hold or fabricate a phase.
    // A completed job is truthfully recorded if the real running frame was fast.
    attempt.dom = await bounded(window.webContents.executeJavaScript(`(async () => {
      const deadline = performance.now() + 2000;
      while (document.querySelector('#tab-jobs')?.getAttribute('aria-selected') !== 'true' && performance.now() < deadline)
        await new Promise(resolve => requestAnimationFrame(resolve));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
        progressLabel: document.querySelector('#progress-label')?.textContent,
        phaseLabel: document.querySelector('#phase-badge')?.textContent,
        monitorVisible: !document.querySelector('#monitor-panel')?.hidden,
        innerWidth, innerHeight, devicePixelRatio };
    })()`), 10000, 'Real running frame observation');
    attempt.phaseBefore = service.snapshot().phase; assert.equal(window.isVisible(), false);
    const bounds = window.getContentBounds();
    const image = await bounded(window.webContents.capturePage({ x: 0, y: 0, width: bounds.width, height: bounds.height }, { stayHidden: true }), 20000, 'Real running hidden capture');
    const bytes = image.toPNG({ scaleFactor: 1 }); await fsp.writeFile(attempt.file, bytes, { flag: 'wx' });
    attempt.phaseAfter = service.snapshot().phase; attempt.outerBounds = window.getBounds(); attempt.contentBounds = bounds;
    attempt.pngSize = { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
    attempt.sha256 = sha(bytes); attempt.scaleFactors = image.getScaleFactors(); attempt.visible = window.isVisible();
    attempt.runningAtBothObservationBoundaries = attempt.phaseBefore === 'running' && attempt.phaseAfter === 'running';
    attempt.status = attempt.runningAtBothObservationBoundaries ? 'captured-during-real-running-phase' : 'real-running-event-retained-frame-phase-recorded';
  } catch (error) { attempt.status = 'capture-failed-event-retained'; attempt.failure = { code: error.code, message: error.message }; }
  finally { save(); }
}
function currentProof() {
  const preferences = window?.webContents.getLastWebPreferences();
  return structuredClone({ ...evidence, visible: window?.isVisible() || false, liveChildren: children.size,
    snapshot: service?.snapshot(),
    isolation: { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), partition: 'remux-ui-' + id },
    security: preferences ? { entryUrl: ENTRY_URL, csp: CSP, ...Object.fromEntries([
      'preload', 'nodeIntegration', 'contextIsolation', 'sandbox', 'webSecurity', 'allowRunningInsecureContent', 'webviewTag', 'backgroundThrottling'
    ].map(key => [key, preferences[key]])) } : null });
}
async function createWindow() {
  assert.equal(process.versions.electron, JSON.parse(stableFile(path.join(ROOT, 'package.json')).bytes).devDependencies.electron);
  evidence.resourcesBefore = await resourceCheck(places.ownedRoot); assertLease();
  assert.deepEqual(producerManifest(), marker.producers);
  assert.ok(REMUX_POLICIES.some(policy => policy.inputFamily === 'isobmff' && policy.target === marker.selected.target));
  evidence.catalog = { policyIdentity: REMUX_POLICY_ID, policies: REMUX_POLICIES };
  runtime = await verifyCandidateRuntime({ root: ROOT }); evidence.runtime = runtime.verified;
  const runtimeIdentity = createHash('sha256').update(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 })))).digest('hex');
  const controls = createOperationControls({ runtime, stateDir: places.stateDir, families: FAMILIES, policyIdentity: POLICY_ID });
  const observed = controls.operationRuntime, invoke = observed.invoke.bind(observed);
  observed.invoke = (token, tool, args, options) => guardedRun(runtime[tool], args, options, (_file, argv, opts) => invoke(token, tool, argv, opts));
  service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir: places.stateDir, runtimeIdentity,
    inspectionWorkers: 1, run: guardedRun, storageEligibility: new StorageEligibility({ run: guardedRun }), ...controls,
    capabilities: async () => ({ profiles: [], recipes: [], versions: {} }),
    outputAccess: new OutputAccess({ openPath: file => block('open-completed-output', file), showItemInFolder: file => block('show-completed-output', file) }) });
  await service.initializeDiagnostics(); service.on('update', observe);
  const appSession = session.fromPartition('remux-ui-' + id);
  appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false)); appSession.setPermissionCheckHandler(() => false);
  appSession.on('will-download', event => event.preventDefault());
  registerLocalProtocol(appSession.protocol, path.join(ROOT, 'ui'));
  appSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resolveAsset(details.url, details.method) }));
  window = new BrowserWindow({ width: 1456, height: 939, minWidth: 640, minHeight: 480, show: false,
    backgroundColor: '#0f1115', title: 'FFmpeg Encoder — isolated owned Remux endpoint', autoHideMenuBar: true,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), session: appSession, backgroundThrottling: false,
      nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } });
  window.setContentSize(1440, 900);
  window.on('show', () => { evidence.visibilityViolation = new Date().toISOString(); window.hide(); save(); void finish('failed'); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const name of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) window.webContents.on(name, event => event.preventDefault());
  const selections = [{ role: 'input', folder: places.input }, { role: 'output', folder: places.output },
    { role: 'input', folder: places.output }, { role: 'output', folder: places.rescanOutput }];
  const exactDialog = { showOpenDialog: async (owner, options) => {
    assert.equal(owner, window); assert.deepEqual(options.properties, ['openDirectory']);
    const role = options.title === 'Select input video folder' ? 'input' : options.title === 'Select output folder' ? 'output' : null;
    const next = selections[evidence.dialogs.length]; assert.ok(next && role === next.role, 'Only the fixed current picker sequence is permitted.');
    ordinaryPath(next.folder, 'directory');
    evidence.dialogs.push({ role, title: options.title, returnedFolder: next.folder, method: 'Main-only substituted picker result; native OS dialog untested.', at: new Date().toISOString() });
    save(); return { canceled: false, filePaths: [next.folder] };
  } };
  removeHandlers = registerIpc({ ipcMain, window, service, dialog: exactDialog, entryUrl: ENTRY_URL });
  window.webContents.on('render-process-gone', (_event, details) => { evidence.rendererFailure = details; save(); void finish('failed'); });
  window.on('close', event => { if (!finished) { event.preventDefault(); void finish(closing ? evidence.outcome : 'completed'); } });
  // Main-only observation and one explicit drain. No generic renderer hook,
  // arbitrary folders/argv, plan injection, phase mutation or dialog authority.
  globalThis.remuxUiHarness = Object.freeze({ proof: currentProof, close: outcome => {
    assert.ok(['completed', 'failed'].includes(outcome)); void finish(outcome); return { accepted: true, outcome };
  } });
  totalTimer = setTimeout(() => { evidence.deadlineExceeded = true; save(); void finish('failed'); },
    Math.max(1, LIMITS.totalMs - (Date.now() - Date.parse(marker.startedAt)))); totalTimer.unref();
  resourceTimer = setInterval(() => {
    if (closing || resourceObservation) return;
    resourceObservation = resourceCheck(places.ownedRoot).then(value => { evidence.resourcesLatest = value; })
      .catch(error => { evidence.resourceFailure = { code: error.code, message: error.message }; save(); void finish('failed'); })
      .finally(() => { resourceObservation = null; });
  }, 1000); resourceTimer.unref();
  await window.loadURL(ENTRY_URL); assert.equal(window.isVisible(), false); evidence.readyAt = new Date().toISOString(); save();
}
async function finish(outcome) {
  if (closePromise) return closePromise;
  closing = true; evidence.outcome = outcome; controller.abort(); clearTimeout(totalTimer); clearInterval(resourceTimer);
  closePromise = (async () => {
    const failures = [], closure = { startedAt: new Date().toISOString(), failures };
    evidence.closure = closure;
    async function attempt(label, action) { try { return await action(); } catch (error) {
      failures.push({ label, code: error.code, message: error.message }); evidence.outcome = 'failed'; return null; } }
    // Independently own every actual handle, including one whose consumer
    // failed before retaining it. Start termination before awaiting service
    // cancellation; neither app.exit nor lease release may precede real close.
    const trackedDrain = drainTrackedChildren();
    await attempt('cancel-and-drain', () => service?.cancelCurrent());
    await attempt('harness-tracked-child-drain', () => trackedDrain);
    await attempt('operation-resources', async () => { await service?.closeOperationResources(); closure.resourcesClosed = true; });
    await attempt('diagnostics', async () => { const result = await service?.closeDiagnostics(evidence.outcome);
      closure.diagnosticsPersisted = result?.persisted === true; assert.equal(closure.diagnosticsPersisted, true); });
    if (resourceObservation) await resourceObservation;
    if (runningCapturePromise) await runningCapturePromise;
    closure.allChildrenClosed = children.size === 0 && !activeInvocation
      && evidence.invocations.every(entry => !entry.childHandleObserved || entry.closedObserved && entry.closed);
    evidence.liveChildren = children.size; await attempt('actual-child-closure', async () => assert.equal(closure.allChildrenClosed, true));
    await attempt('producer-freeze', async () => { evidence.producersAfter = producerManifest(); assert.deepEqual(evidence.producersAfter, marker.producers); });
    if (runtime) await attempt('runtime-exit-pins', async () => { evidence.runtimeAfter = (await verifyCandidateRuntime({ root: ROOT })).verified; assert.deepEqual(evidence.runtimeAfter, evidence.runtime); });
    await attempt('lease-still-owned-until-parent-observes-electron-close', async () => assertLease());
    await attempt('owned-source-unchanged', async () => { const current = stableFile(inputFile, 512 * 1024 ** 2);
      assert.equal(current.sha256, marker.source.sha256); assert.deepEqual(current.identity, marker.source.inputIdentity);
      assert.equal(stableFile(marker.sentinel.file).sha256, marker.sentinel.sha256); });
    evidence.finalSnapshot = service?.snapshot(); evidence.finishedAt = new Date().toISOString();
    removeHandlers?.(); if (window && !window.isDestroyed()) window.destroy(); closure.windowDestroyed = !window || window.isDestroyed();
    closure.finishedAt = new Date().toISOString(); finished = true; save();
    // Do not remove the root-owned media lease here. The driver must first
    // observe this drain proof AND the Electron process's actual close event.
    app.exit(evidence.outcome === 'failed' ? 1 : 0);
  })();
  return closePromise;
}
app.on('before-quit', event => { if (!finished) { event.preventDefault(); void finish('completed'); } });
app.on('window-all-closed', () => { if (finished) app.quit(); });
app.whenReady().then(createWindow).catch(error => {
  evidence.startupFailure = { code: error.code, message: error.message, stack: error.stack }; save();
  void finish('failed').catch(failure => { evidence.shutdownFailure = { message: failure.message }; save(); app.exit(1); });
});
