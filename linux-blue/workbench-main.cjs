'use strict';

// Explicit experimental entry. The original Windows launcher is untouched.
// Reuse the shared workbench, preload, IPC, media and settings architecture;
// approved Linux UI changes do not create a second product shell.
const { app, BrowserWindow, dialog, ipcMain, session, protocol, nativeTheme, shell } = require('electron');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createWorkbenchService } = require('./workbench-service.cjs');
const { selectWorkbenchRuntime } = require('./workbench-runtime-choice.cjs');
const runtimeChoice = selectWorkbenchRuntime(process.argv);
const createService = runtimeChoice === 'baseline' ? createWorkbenchService
  : require('./workbench-av1-service.cjs').createQualifiedAv1WorkbenchService;
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
  : path.join(__dirname, 'artifacts', 'workbench-av1-preview');
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
for (const [name, child] of [['userData', 'electron-state'], ['sessionData', 'electron-session']]) {
  const directory = path.join(stateDir, child);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath(name, directory);
}
let title = 'FFmpeg Encoder · Linux CPU preview · Full SDR · 30-minute encode limit';
if (runtimeChoice !== 'baseline') title = 'FFmpeg Encoder · Linux CPU preview · FFmpeg 9.0.2 AV1 · ordinary encode limit 30 minutes';
const census = { spawned: 0, closed: 0, live: 0, maximum: 0 };
let window, service, appearance, unregister;
let closing = false, closed = false, closePromise, startupPromise, appearanceFailed = false, failed = false;

function beginClose() {
  closing = true;
  service?.closeAdmission();
  appearance?.closeAdmission();
}

async function drain() {
  const failures = failed ? [new Error('Startup or renderer failed.')] : [];
  for (const close of [() => service?.cancelCurrent(), () => service?.closeOperationResources(),
    async () => { await appearance?.flush(); if (appearanceFailed) throw new Error('Appearance save was not confirmed.'); }]) {
    try { await close(); } catch (error) { failures.push(error); }
  }
  try {
    const receipt = await service?.closeDiagnostics(failures.length ? 'failed' : 'completed');
    if (service && receipt?.persisted !== true) throw new Error('Diagnostic closure was not confirmed.');
  } catch (error) { failures.push(error); }
  if (census.live !== 0) failures.push(new Error('An owned media child remains live.'));
  unregister?.();
  closed = true;
  if (window && !window.isDestroyed()) window.destroy();
  console.log('LINUX_WORKBENCH_CLOSED', JSON.stringify({ ...census, failures: failures.length }));
  app.exit(failures.length ? 1 : 0);
}

function close() {
  // Close admission and abort now, not after a slow startup/log write/picker.
  beginClose();
  if (closePromise) return closePromise;
  const cancel = service?.cancelCurrent();
  closePromise = (async () => {
    const settled = await Promise.allSettled([startupPromise, cancel]);
    if (settled.some(result => result.status === 'rejected')) failed = true;
    await drain();
  })();
  return closePromise;
}

async function launch() {
  await app.whenReady();
  if (closing) return;
  service = await createService({ stateDir,
    outputAccess: new OutputAccess({ openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file) }),
    onChild(child) {
    census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
    child.once('close', () => { census.closed++; census.live--; });
  } });
  if (closing) { beginClose(); return; }
  title += service.linuxRemuxStatus.available ? ' · Remux ≤60s: MKV video / MP4 AAC'
    : runtimeChoice === 'baseline' ? ' · Remux unavailable (source mismatch)' : ' · Remux unavailable';
  if (service.linuxQualifiedEncodeStatus?.available) title += ' · H265 FLAC range/resize: per-file eligibility';
  await service.initializeDiagnostics();
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
  unregister = registerIpc({ ipcMain, window, service, dialog, entryUrl: ENTRY_URL, appearance: {
    load: () => appearance.load(),
    async set(request) {
      try {
        const saved = await appearance.set(request);
        if (saved.persistence?.persisted !== true) throw new Error('Appearance save was not confirmed.');
        appearanceFailed = false; applyTheme(saved.theme); return saved;
      } catch (error) { appearanceFailed = true; throw error; }
    },
  } });
  service.on('update', snapshot => {
    if (!closing && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('encoder:update', snapshot);
  });
  window.on('close', event => { if (!closed) { event.preventDefault(); void close(); } });
  window.webContents.on('render-process-gone', () => { failed = true; void close(); });
  await window.loadURL(ENTRY_URL);
  const preferences = window.webContents.getLastWebPreferences();
  console.log('LINUX_WORKBENCH_READY', JSON.stringify({ electron: process.versions.electron,
    runtimeChoice, runtimeIdentity: service.runtimeIdentity,
    mode: service.linuxQualifiedEncodeStatus?.available ? 'qualified-cpu-sdr' : 'ordinary-cpu-full-sdr',
    qualifiedFamilies: service.linuxQualifiedEncodeStatus?.familyIds || [], remuxAvailable: service.linuxRemuxStatus.available, sandbox: preferences.sandbox,
    contextIsolation: preferences.contextIsolation, nodeIntegration: preferences.nodeIntegration,
    originalUi: true, originalPreload: true }));
}

app.on('before-quit', event => { if (!closed) { event.preventDefault(); void close(); } });
app.on('window-all-closed', () => { void close(); });
if (!app.requestSingleInstanceLock()) { closed = true; app.quit(); }
else {
  app.on('second-instance', () => { if (window && !window.isDestroyed()) { window.restore(); window.focus(); } });
  startupPromise = launch();
  startupPromise.catch(error => {
    failed = true;
    console.error('LINUX_WORKBENCH_START_FAILED', error.code || 'START_FAILED', error.message);
    void close();
  });
}
