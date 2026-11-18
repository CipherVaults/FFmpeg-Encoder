const { app, BrowserWindow, dialog, ipcMain, session, protocol, shell, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EncoderService } = require('./src/encoder-service.cjs');
const { checkVendorCapabilities } = require('./src/vendor-capabilities.cjs');
const { OutputAccess } = require('./src/output-access.cjs');
const { verifyCandidateRuntime } = require('./src/candidate-runtime.cjs');
const { createOperationControls } = require('./src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('./src/operation-catalog.cjs');
const { createNativeBackendControls } = require('./src/native-backend-controls.cjs');
const { createNativeFileControls, assertProductionNativeFileControls, nativeRefusal } = require('./src/native-file-controls.cjs');
const { registerIpc } = require('./src/ipc.cjs');
const { ENTRY_URL, resolveAsset, registerLocalProtocol } = require('./src/local-protocol.cjs');
const { AppearanceSettings } = require('./src/appearance.cjs');

// Register before readiness. CSP and CORS remain enabled; no service workers or
// arbitrary file loading are granted to this origin.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

// Explicit opt-in only. No renderer/persisted setting can select this route.
const linuxProductCandidate = process.platform === 'linux' && app.commandLine.hasSwitch('linux-product-candidate');
const linuxOrdinaryCandidate = process.platform === 'linux' && app.commandLine.hasSwitch('linux-ordinary-cpu-candidate');
let window;
let service;
let ipcRegistration;
let appearance;
let appearanceSaveFailed = false;
let exitAllowed = false;
let closePrompt = false;
let confirmedCancellation;
let root;
let stateDir;
let shutdownComplete = false;
let shutdownPromise;
let shutdownOutcome = 'completed';
let quitDuringStartup = false;
let rendererLost = false;
let startupFailurePromise;
let shutdownExitCode = 0;

function closeAdmission() {
  // A committed close fences the registration, not just methods that check
  // the service's busy flag. An unresolved Keep/Cancel prompt is not a close.
  ipcRegistration?.closeAdmission();
  appearance?.closeAdmission();
  service?.closeAdmission?.();
}

function finishShutdown() {
  closeAdmission();
  shutdownPromise ||= (async () => {
    // A failed drain must not skip attempts to close owned handles/leases or
    // flush diagnostics. Each closure retains its own failure identity.
    const failures = [];
    for (const [reason, close] of [
      // A busy-close cancellation is requested while its parent window is
      // still live. Retain its outcome even when the final drain can recover.
      ...(confirmedCancellation ? [['CLOSE_CANCELLATION_FAILED', () => confirmedCancellation]] : []),
      ['OPERATION_DRAIN_FAILED', () => service?.cancelCurrent()],
      // Unregistering prevents new calls but does not settle trusted calls
      // already admitted (picker, output action, rejection diagnostic, etc.).
      ['IPC_DRAIN_FAILED', () => ipcRegistration?.whenIdle()],
      ['OPERATION_RESOURCES_CLOSE_FAILED', () => service?.closeOperationResources?.()],
      ['APPEARANCE_FLUSH_FAILED', async () => {
        await appearance?.flush();
        if (appearanceSaveFailed) throw new Error('The last requested appearance change was not confirmed saved.');
      }]
    ]) {
      try { await close(); }
      catch (error) { shutdownOutcome = 'failed'; failures.push({ reason, error }); }
    }
    try {
      for (const { reason, error } of failures) {
        await service?.recordIncident({ stage: 'shutdown', reason, severity: 'error', message: error.message });
      }
    } finally {
      try {
        const receipt = await service?.closeDiagnostics(shutdownOutcome);
        if (service && receipt?.persisted !== true) throw new Error('Final diagnostic history was not saved. Work after the last durable record is unknown.');
      } catch (error) {
        shutdownExitCode ||= 1;
        throw error;
      }
    }
    if (failures.length) throw new AggregateError(failures.map(item => item.error), 'Owned shutdown was incomplete.');
  })().catch(error => {
    // Shutdown cannot manufacture persistence when the state disk is broken.
    // The last durable record remains the honest recovery boundary.
    console.error('Shutdown diagnostics incomplete:', error.message);
  }).finally(() => {
    exitAllowed = true; shutdownComplete = true;
    if (shutdownExitCode) app.exit(shutdownExitCode);
    else app.quit();
  });
  return shutdownPromise;
}

const appearanceBackground = theme => theme === 'light' ? '#f7f7f4' : '#101318';
function applyNativeAppearance(theme) {
  // Electron's app-local theme source controls native dialogs/chrome only; no
  // operating-system setting or media/processing state is changed here.
  nativeTheme.themeSource = theme;
  if (window && !window.isDestroyed()) window.setBackgroundColor(appearanceBackground(theme));
}

const appearanceFacade = {
  load: () => appearance.load(),
  async set(request) {
    // The store accepts/tracks this write before the first await, so an
    // immediate close cannot outrun it. Invalid DTOs grant no write to drain.
    const pending = appearance.set(request);
    let snapshot;
    try { snapshot = await pending; }
    catch (error) { appearanceSaveFailed = true; throw error; }
    if (snapshot.persistence?.persisted !== true) {
      appearanceSaveFailed = true;
      throw Object.assign(new Error('The appearance change was not confirmed saved.'), { code: 'APPEARANCE_SAVE_UNCONFIRMED' });
    }
    appearanceSaveFailed = false;
    applyNativeAppearance(snapshot.theme);
    return snapshot;
  },
};

function startupFailed(error) {
  // A renderer can fail while loadURL is still pending. A synchronous error
  // box blocks render-process-gone and therefore the cancellation/close path.
  // Drain owned work first and use an asynchronous, window-owned error dialog.
  // Renderer loss may take ownership while that dialog is pending; destroying
  // its parent then closes it. Genuine startup errors remain visible.
  startupFailurePromise ||= (async () => {
    shutdownOutcome = 'failed'; shutdownExitCode = 1;
    closeAdmission();
    await service?.cancelCurrent();
    await service?.recordIncident({ stage: 'startup', reason: 'STARTUP_FAILED', severity: 'error',
      message: error.message, context: { code: error.code || null } });
    if (!rendererLost && !quitDuringStartup && !shutdownComplete) {
      const options = { type: 'error', title: 'FFmpeg Encoder could not start',
        message: 'FFmpeg Encoder could not start', detail: error.message, buttons: ['Close'], noLink: true };
      if (window && !window.isDestroyed()) await dialog.showMessageBox(window, options);
      else if (app.isReady()) await dialog.showMessageBox(options);
      else dialog.showErrorBox(options.title, options.detail);
    }
  })().catch(failure => console.error('Startup failure reporting incomplete:', failure.message))
    .finally(() => finishShutdown());
  return startupFailurePromise;
}

try {
  if (linuxProductCandidate && linuxOrdinaryCandidate) throw new Error('Choose exactly one Linux candidate route.');
  root = app.getAppPath();
  stateDir = app.commandLine.hasSwitch('user-data-dir')
    ? app.commandLine.getSwitchValue('user-data-dir')
    : linuxOrdinaryCandidate ? path.join(app.getPath('appData'), 'FFmpegEncoder-Linux-Ordinary-Candidate')
    : linuxProductCandidate ? path.join(app.getPath('appData'), 'FFmpegEncoder-Linux-Candidate')
    : path.join(app.isPackaged ? path.dirname(app.getPath('exe')) : root, app.isPackaged ? 'data' : 'data-next-0.7');
  fs.mkdirSync(stateDir, { recursive: true });
  // Electron/Chromium can initialize GPU/network state before createWindow.
  // Configure both paths synchronously before readiness and the instance lock,
  // so portable copies keep process/session data beside their executable too.
  app.setPath('userData', stateDir);
  app.setPath('sessionData', stateDir);

  // Exactly one app instance owns the queue and its child-process lifecycle.
  if (!app.requestSingleInstanceLock()) app.quit();
  else {
    app.on('second-instance', () => { if (window && !window.isDestroyed()) { window.restore(); window.focus(); } });
    app.whenReady().then(createWindow).catch(startupFailed);
  }
} catch (error) {
  startupFailed(error);
}

async function createWindow() {
  let nativeFilesFailure = null;
  if (linuxOrdinaryCandidate) {
    const { createLinuxOrdinaryShell } = require('./linux-blue/product-linux-ordinary-shell.cjs');
    service = await createLinuxOrdinaryShell({
      runtimeRoot: path.join(app.isPackaged ? process.resourcesPath : root, 'runtime'), stateDir,
      outputAccess: new OutputAccess({ openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file) }),
    });
  } else if (linuxProductCandidate) {
    const { createLinuxProductShell } = require('./linux-blue/product-linux-shell.cjs');
    service = await createLinuxProductShell({
      runtimeRoot: path.join(app.isPackaged ? process.resourcesPath : root, 'runtime'), stateDir,
      outputAccess: new OutputAccess({ openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file) }),
    });
  } else {
  // A separate verified namespace preserves the paused benchmark's9.0.1 pair.
  // No renderer, IPC handler or capability child exists before verification;
  // a missing or altered candidate runtime is an explicit startup failure.
  const runtime = await verifyCandidateRuntime({ root, isPackaged: app.isPackaged, resourcesPath: process.resourcesPath });
  if (quitDuringStartup || shutdownComplete) return;
  const runtimeIdentity = createHash('sha256').update(JSON.stringify(runtime.verified.slice(0, 2)
    .map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 })))).digest('hex');
  const nativeControls = createNativeBackendControls({ runtime, stateDir,
    acquireMediaSlot: request => service.acquireNativeMediaSlot(request),
    retainInitialization: report => service.retainNativeInitialization(report) });
  // Native file encoding (Beta) is composed once with its fixed empty catalog.
  // Only the data folder's own condition leaves it unavailable; any other
  // refusal (extra keys such as policies, a non-genuine backend service, a
  // non-production brand or a policy row) is a build defect and stops startup.
  let nativeFiles = null;
  try {
    nativeFiles = createNativeFileControls({ stateDir, nativeBackends: nativeControls.nativeBackends,
      runtime: Object.fromEntries(['ffmpeg', 'ffprobe'].map((name, index) => [name,
        { file: runtime[name], sizeBytes: runtime.verified[index].sizeBytes, sha256: runtime.verified[index].sha256 }])) });
  } catch (error) {
    if (error?.code !== 'NATIVE_FILE_STATE_FOLDER_UNAVAILABLE') throw error;
    nativeFilesFailure = nativeRefusal(error);
  }
  if (nativeFiles) assertProductionNativeFileControls(nativeFiles);
  service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, runtimeIdentity, stateDir,
    ...createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID }),
    ...nativeControls, nativeFiles, vendorCapabilities: checkVendorCapabilities,
    outputAccess: new OutputAccess({ openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file) }) });
  }
  await service.initializeDiagnostics();
  if (quitDuringStartup) { await finishShutdown(); return; }
  if (nativeFilesFailure) await service.recordIncident({ stage: 'startup', reason: 'NATIVE_FILE_COMPOSITION_FAILED', severity: 'warning',
    context: { nativePrivate: nativeFilesFailure.nativePrivate } });
  appearance = new AppearanceSettings({ directory: stateDir });
  const initialAppearance = await appearance.load();
  // Quitting while the app-owned preference is loading must not create a late
  // window, change native appearance or establish new renderer authority.
  if (quitDuringStartup || shutdownComplete) { await finishShutdown(); return; }
  applyNativeAppearance(initialAppearance.theme);
  const uiRoot = path.join(root, 'ui');
  const entryUrl = ENTRY_URL;
  const appSession = session.fromPartition('encoder-local');
  appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);
  appSession.on('will-download', event => event.preventDefault());
  registerLocalProtocol(appSession.protocol, uiRoot);
  appSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resolveAsset(details.url, details.method) }));
  window = new BrowserWindow({
    width: 1100, height: 800, minWidth: 640, minHeight: 480,
    backgroundColor: appearanceBackground(initialAppearance.theme), title: 'FFmpeg Encoder', autoHideMenuBar: true,
    icon: path.join(root, 'assets', 'app-icon', 'app-icon.ico'),
    webPreferences: {
      preload: path.join(root, 'preload.js'), session: appSession,
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-frame-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  ipcRegistration = registerIpc({ ipcMain, window, service, appearance: appearanceFacade, dialog, entryUrl });
  service.on('update', snapshot => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('encoder:update', snapshot);
  });
  window.on('close', async event => {
    if (exitAllowed || !service.busy) { closeAdmission(); return; }
    event.preventDefault();
    if (closePrompt) return;
    closePrompt = true;
    try {
      const choice = await dialog.showMessageBox(window, {
        type: 'question', title: 'An operation is active',
        message: 'Keep the application open, or cancel the current work and exit?',
        buttons: ['Keep application open', 'Cancel work and exit'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (choice.response === 1 && !window.isDestroyed()) {
        closeAdmission();
        confirmedCancellation = (async () => service.cancelCurrent())();
        try { await confirmedCancellation; }
        catch { /* finishShutdown owns this failure and still tries the final drain. */ }
        exitAllowed = true;
        if (!window.isDestroyed()) window.close();
      }
    } finally { closePrompt = false; }
  });
  window.webContents.on('render-process-gone', async (_event, details) => {
    // Loss of the only UI cancels work; it never enables invisible encoding.
    shutdownOutcome = 'failed';
    rendererLost = true;
    closeAdmission();
    // Abort ownership synchronously before waiting on disk-backed diagnostics.
    // An unavailable/slow log directory must never prolong invisible encoding.
    const cancellation = service.cancelCurrent();
    const recording = service.recordIncident({ stage: 'global', reason: 'RENDERER_GONE', severity: 'error',
      message: 'The renderer process exited; active work is being cancelled.', context: {
        reason: String(details?.reason || 'unknown').slice(0, 80), exitCode: Number.isInteger(details?.exitCode) ? details.exitCode : null,
      } });
    await Promise.allSettled([cancellation, recording]);
    exitAllowed = true;
    if (!window.isDestroyed()) window.destroy();
  });
  window.on('closed', () => {
    ipcRegistration();
    void finishShutdown();
  });
  await window.loadURL(entryUrl);
}

app.on('before-quit', event => {
  // Verification can still be awaiting file IO before service construction.
  // Quitting then must never create a late invisible app or startup dialog.
  if (!service) quitDuringStartup = true;
  if (service && !shutdownComplete) {
    event.preventDefault();
    if (window && !window.isDestroyed()) window.close();
    else { quitDuringStartup = true; void finishShutdown(); }
  }
});
// The window's close handler drains the owned child and durable session tail.
// Quitting here first can truncate the final diagnostic event.
app.on('window-all-closed', () => { if (!service) app.quit(); });
