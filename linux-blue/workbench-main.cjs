'use strict';

// Explicit experimental entry. The original Windows launcher is untouched.
// Reuse the shared workbench, preload, IPC, media and settings architecture;
// approved Linux UI changes do not create a second product shell.
const { app, BrowserWindow, dialog, ipcMain, session, protocol, nativeTheme, shell } = require('electron');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createWorkbenchService } = require('./workbench-service.cjs');
const { selectWorkbenchRuntime, sessionSwitchingEnabled } = require('./workbench-runtime-choice.cjs');
const switchingEnabled = sessionSwitchingEnabled(process.argv);
const runtimeChoice = selectWorkbenchRuntime(process.argv);
const createService = runtimeChoice === 'baseline' ? createWorkbenchService
  : runtimeChoice === '9.0.2-ordinary-candidate' ? require('./candidate-ordinary-service.cjs').createCandidateOrdinaryService
  : runtimeChoice === '9.0.2-keep720-candidate' ? require('./candidate-workbench.cjs').createCandidateWorkbench
  : runtimeChoice === '9.0.2-full-copy-candidate' ? require('./candidate-full-copy-workbench.cjs').createCandidateFullCopyWorkbench
  : runtimeChoice === '9.0.2-resize-candidate' ? require('./candidate-resize-workbench.cjs').createCandidateResizeWorkbench
    : require('./workbench-av1-service.cjs').create1440QualifiedAv1WorkbenchService;
const { AppearanceSettings } = require('../src/appearance.cjs');
const { OutputAccess } = require('../src/output-access.cjs');
const { registerIpc } = require('../src/ipc.cjs');
const { ENTRY_URL, resolveAsset, registerLocalProtocol } = require('../src/local-protocol.cjs');

app.enableSandbox();
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }]);
const root = path.resolve(__dirname, '..');
const stateDir = runtimeChoice === 'baseline' ? path.join(__dirname, 'artifacts', 'workbench-preview')
  : path.join(__dirname, 'artifacts', runtimeChoice === '9.0.2-ordinary-candidate' ? 'workbench-ordinary-candidate-preview' : runtimeChoice === '9.0.2-keep720-candidate' ? 'workbench-keep720-candidate-preview' : runtimeChoice === '9.0.2-resize-candidate' ? 'workbench-resize-candidate-preview' : runtimeChoice === '9.0.2-full-copy-candidate' ? 'workbench-full-copy-candidate-preview' : 'workbench-av1-preview');
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
for (const [name, child] of [['userData', 'electron-state'], ['sessionData', 'electron-session']]) {
  const directory = path.join(stateDir, child);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath(name, directory);
}
let title = 'FFmpeg Encoder · Linux CPU preview · Full SDR · 30-minute encode limit';
if (runtimeChoice === '9.0.2-ordinary-candidate') title = 'FFmpeg Encoder · Experimental ordinary FFmpeg 9.0.2 CPU · Full / Keep source / copied audio · Cancel requires relaunch · 30-minute encode limit';
else if (runtimeChoice === '9.0.2-keep720-candidate') title = 'FFmpeg Encoder · Experimental Keep720 range · CPU slow25 / precision FLAC · Cancel requires relaunch · native threading unqualified';
else if (runtimeChoice === '9.0.2-resize-candidate') title = 'FFmpeg Encoder · Experimental 1080p30 to 720p resize range · CPU slow25 / precision FLAC · Cancel requires relaunch · native threading unqualified';
else if (runtimeChoice === '9.0.2-full-copy-candidate') title = 'FFmpeg Encoder · Experimental whole-file 1080p30 to 720p · CPU slow25 / copied AAC · Cancel requires relaunch · native threading unqualified';
else if (runtimeChoice !== 'baseline') title = 'FFmpeg Encoder · Linux CPU preview · FFmpeg 9.0.2 AV1 · ordinary encode limit 30 minutes';
const census = { spawned: 0, closed: 0, live: 0, maximum: 0 };
let window, service, appearance, unregister, sessionOwner, transitionPromise, transitionActive = false, replacingWindow = false, retiringWindow;
let closing = false, closed = false, closePromise, startupPromise, appearanceFailed = false, failed = false;

const ipcOwners = new Set(), cancellations = new WeakMap();
const currentService = () => sessionOwner ? sessionOwner.owner?.service : service;
function cancelOwner(owner) {
  if (!owner) return Promise.resolve();
  if (!cancellations.has(owner)) {
    try { cancellations.set(owner, Promise.resolve(owner.cancelCurrent())); }
    catch (error) { cancellations.set(owner, Promise.reject(error)); }
  }
  return cancellations.get(owner);
}
function retireIpc(owner) {
  if (!owner) return;
  owner();
  // A transition retires its own IPC handler: observe settlement, never await it here.
  void Promise.resolve(owner.whenIdle?.()).then(() => ipcOwners.delete(owner), () => {
    failed = true; ipcOwners.delete(owner);
  });
}
function beginClose() {
  closing = true;
  for (const owner of ipcOwners) owner.closeAdmission?.();
  sessionOwner?.beginClose();
  service?.closeAdmission();
  appearance?.closeAdmission();
}

async function drain() {
  const failures = failed ? [new Error('Startup, transition or admitted IPC failed.')] : [];
  const owned = currentService();
  for (const close of [() => cancelOwner(owned), () => owned?.closeOperationResources(),
    async () => { await appearance?.flush(); if (appearanceFailed) throw new Error('Appearance save was not confirmed.'); }]) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  try {
    const receipt = await owned?.closeDiagnostics(failures.length ? 'failed' : 'completed');
    if (owned && receipt?.persisted !== true) throw new Error('Diagnostic closure was not confirmed.');
  } catch (error) { failures.push(error); }
  if (census.live !== 0) failures.push(new Error('An owned media child remains live.'));
  for (const owner of ipcOwners) owner();
  closed = true;
  if (window && !window.isDestroyed()) window.destroy();
  console.log('LINUX_WORKBENCH_CLOSED', JSON.stringify({ ...census, failures: failures.length }));
  app.exit(failures.length ? 1 : 0);
}

function close() {
  // Close admission and abort now, not after a slow startup/log write/picker.
  beginClose();
  if (closePromise) return closePromise;
  const cancel = cancelOwner(currentService());
  closePromise = (async () => {
    const settled = await Promise.allSettled([startupPromise, transitionPromise, cancel]);
    if (settled.some(result => result.status === 'rejected')) failed = true;
    // Also fence a registration installed by a startup/transition that just settled.
    beginClose();
    const ipcSettled = await Promise.allSettled([...ipcOwners].map(owner => owner.whenIdle?.()));
    if (ipcSettled.some(result => result.status === 'rejected')) failed = true;
    await drain();
  })();
  return closePromise;
}

function trackChild(child) {
  census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
  child.once('close', () => { census.closed++; census.live--; });
}
async function launch() {
  await app.whenReady();
  if (closing) return;
  const acquire = factory => factory({ stateDir,
    outputAccess: new OutputAccess({ openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file) }),
    onChild(child) {
    census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
    child.once('close', () => { census.closed++; census.live--; });
  } });
  if (switchingEnabled) {
    const { WorkbenchSession } = require('./workbench-session.cjs');
    sessionOwner = new WorkbenchSession({
      ordinary: access => createWorkbenchService({ stateDir, outputAccess: access, onChild: trackChild }),
      fullCopy: access => require('./candidate-full-copy-workbench.cjs').createCandidateFullCopyWorkbench({ stateDir, outputAccess: access, onChild: trackChild }),
      createAccess: () => new OutputAccess({ openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file) }),
      publish: snapshot => { if (!closing && window && !window.isDestroyed()) window.webContents.send('encoder:update', snapshot); },
    });
    service = await sessionOwner.select('ordinary');
  } else service = await acquire(createService);
  if (closing) { beginClose(); return; }
  title += service.linuxRemuxStatus.available ? ' · Remux ≤60s: MKV video / MP4 AAC'
    : runtimeChoice === 'baseline' ? ' · Remux unavailable (source mismatch)' : ' · Remux unavailable';
  if (service.linuxQualifiedEncodeStatus?.available) title += ' · H265 FLAC range/resize: per-file eligibility';
  if (!switchingEnabled) await service.initializeDiagnostics();
  appearance = new AppearanceSettings({ directory: stateDir });
  const initial = await appearance.load();
  if (closing) { beginClose(); return; }
  const background = theme => theme === 'light' ? '#f7f7f4' : '#101318';
  const applyTheme = theme => {
    nativeTheme.themeSource = theme;
    if (window && !window.isDestroyed()) window.setBackgroundColor(background(theme));
  };
  applyTheme(initial.theme);
  const local = session.fromPartition('blue-linux-original-workbench');
  local.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  local.setPermissionCheckHandler(() => false);
  local.setDevicePermissionHandler(() => false);
  local.on('will-download', event => event.preventDefault());
  registerLocalProtocol(local.protocol, path.join(root, 'ui'));
  local.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resolveAsset(details.url, details.method) }));
  async function openWindow() {
  window = new BrowserWindow({ width: 1100, height: 800, minWidth: 640, minHeight: 480,
    backgroundColor: background(initial.theme), title, autoHideMenuBar: true,
    icon: path.join(root, 'assets', 'logo-gauge-2026-11-14', 'gauge-win-midtone-256.png'),
    webPreferences: { preload: path.join(root, 'preload.js'), session: local,
      sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false } });
  window.on('page-title-updated', event => event.preventDefault());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const event of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) {
    window.webContents.on(event, e => e.preventDefault());
  }
  const ownedWindow = window;
  const bindIpc = () => registerIpc({ ipcMain, window, service, dialog, entryUrl: ENTRY_URL,
    workbenchSession: switchingEnabled ? {
      status: () => sessionOwner.status(), blocked: () => closing || sessionOwner.transitioning,
      select(kind) {
        if (transitionActive) throw Object.assign(new Error('A session transition is active.'), { code: 'BUSY' });
        transitionActive = true;
        transitionPromise = (async () => {
          try {
            const next = await sessionOwner.select(kind);
            if (closing) return null;
            service = next; retireIpc(unregister);
            // A new WebContents is the document fence; no public epoch getter.
            // Keep the same application/theme/security, not a generic navigation protocol.
            replacingWindow = true; retiringWindow = ownedWindow;
            try { ownedWindow.destroy(); await openWindow(); }
            finally { replacingWindow = false; retiringWindow = null; }
            if (closing) return null;
            window.setTitle(kind === 'ordinary' ? title : 'FFmpeg Encoder · Experimental whole-file 720p / copied AAC');
            return sessionOwner.status();
          } catch (error) {
            if (closing && error.code === 'SHUTTING_DOWN') return null;
            if (!sessionOwner.owner) { service = null; dialog.showErrorBox('Workbench session unavailable', error.message); }
            else if (ownedWindow.isDestroyed()) {
              failed = true; dialog.showErrorBox('Workbench window replacement failed', error.message); void close();
            }
            throw error;
          } finally { transitionActive = false; }
        })();
        return transitionPromise;
      },
    } : undefined, appearance: {
    load: () => appearance.load(),
    async set(request) {
      try {
        const saved = await appearance.set(request);
        if (saved.persistence?.persisted !== true) throw new Error('Appearance save was not confirmed.');
        appearanceFailed = false; applyTheme(saved.theme); return saved;
      } catch (error) { appearanceFailed = true; throw error; }
    },
  } });
  unregister = bindIpc(); ipcOwners.add(unregister);
  if (!switchingEnabled) service.on('update', snapshot => {
    if (!closing && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('encoder:update', snapshot);
  });
  window.on('close', event => { if (ownedWindow !== retiringWindow && !closed) { event.preventDefault(); void close(); } });
  window.webContents.on('render-process-gone', () => { if (window === ownedWindow && !replacingWindow) { failed = true; void close(); } });
  await window.loadURL(ENTRY_URL);
  if (closing) { beginClose(); return; }
  }
  await openWindow();
  if (closing) return;
  const preferences = window.webContents.getLastWebPreferences();
  console.log('LINUX_WORKBENCH_READY', JSON.stringify({ electron: process.versions.electron,
    runtimeChoice, runtimeIdentity: service.runtimeIdentity,
    mode: runtimeChoice === '9.0.2-ordinary-candidate' ? 'developer-ordinary-cpu-full-sdr'
      : runtimeChoice === '9.0.2-keep720-candidate' ? 'developer-keep720-range'
      : runtimeChoice === '9.0.2-resize-candidate' ? 'developer-resize-range'
      : runtimeChoice === '9.0.2-full-copy-candidate' ? 'developer-full-copy'
      : service.linuxQualifiedEncodeStatus?.available ? 'qualified-cpu-sdr' : 'ordinary-cpu-full-sdr',
    qualifiedFamilies: service.linuxQualifiedEncodeStatus?.familyIds || [], remuxAvailable: service.linuxRemuxStatus.available, sandbox: preferences.sandbox,
    contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration,
    originalUi: true, originalPreload: true }));
}

app.on('before-quit', event => { if (!closed) { event.preventDefault(); void close(); } });
app.on('window-all-closed', () => { if (!replacingWindow || window !== retiringWindow) void close(); });
if (!app.requestSingleInstanceLock()) { closed = true; app.quit(); }
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { window.restore(); window.focus(); } });
  startupPromise = launch();
  startupPromise.catch(error => {
    failed = true;
    console.error('LINUX_WORKBENCH_START_FAILED', error.code || 'START_FAILED', error.message);
    if (runtimeChoice === '9.0.2-ordinary-candidate' && app.isReady()) dialog.showErrorBox('Experimental ordinary 9.0.2 preview unavailable', error.message);
    if (runtimeChoice === '9.0.2-keep720-candidate' && app.isReady()) dialog.showErrorBox('Experimental Keep720 preview unavailable', error.message);
    if (runtimeChoice === '9.0.2-resize-candidate' && app.isReady()) dialog.showErrorBox('Experimental resize preview unavailable', error.message);
    if (runtimeChoice === '9.0.2-full-copy-candidate' && app.isReady()) dialog.showErrorBox('Experimental Full-copy preview unavailable', error.message);
    void close();
  });
}
