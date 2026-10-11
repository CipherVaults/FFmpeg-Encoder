const { app, BrowserWindow, dialog, ipcMain, session, protocol, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { EncoderService } = require('./src/encoder-service.cjs');
const { OutputAccess } = require('./src/output-access.cjs');
const { registerIpc } = require('./src/ipc.cjs');
const { ENTRY_URL, resolveAsset, registerLocalProtocol } = require('./src/local-protocol.cjs');

// Register before readiness. CSP and CORS remain enabled; no service workers or
// arbitrary file loading are granted to this origin.
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);

let window;
let service;
let exitAllowed = false;
let closePrompt = false;
let root;
let stateDir;
let shutdownComplete = false;
let shutdownPromise;
let shutdownOutcome = 'completed';
let quitDuringStartup = false;
let rendererLost = false;
let startupFailurePromise;
let shutdownExitCode = 0;

function finishShutdown() {
  shutdownPromise ||= (async () => {
    await service?.cancelCurrent();
    await service?.closeDiagnostics(shutdownOutcome);
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

function startupFailed(error) {
  // A renderer can fail while loadURL is still pending. A synchronous error
  // box blocks render-process-gone and therefore the cancellation/close path.
  // Drain owned work first and use an asynchronous, window-owned error dialog.
  // Renderer loss may take ownership while that dialog is pending; destroying
  // its parent then closes it. Genuine startup errors remain visible.
  startupFailurePromise ||= (async () => {
    shutdownOutcome = 'failed'; shutdownExitCode = 1;
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
  root = app.getAppPath();
  stateDir = app.commandLine.hasSwitch('user-data-dir')
    ? app.commandLine.getSwitchValue('user-data-dir')
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
  const binaryRoot = app.isPackaged ? path.join(process.resourcesPath, 'ffmpeg') : path.join(root, 'ffmpeg');
  service = new EncoderService({ ffmpeg: path.join(binaryRoot, 'ffmpeg.exe'), ffprobe: path.join(binaryRoot, 'ffprobe.exe'), stateDir,
    outputAccess: new OutputAccess({ openPath: file => shell.openPath(file), showItemInFolder: file => shell.showItemInFolder(file) }) });
  await service.initializeDiagnostics();
  if (quitDuringStartup) { await finishShutdown(); return; }
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
    backgroundColor: '#0f1115', title: 'FFmpeg Encoder', autoHideMenuBar: true,
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
  const removeHandlers = registerIpc({ ipcMain, window, service, dialog, entryUrl });
  service.on('update', snapshot => {
    if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('encoder:update', snapshot);
  });
  window.on('close', async event => {
    if (exitAllowed || !service.busy) return;
    event.preventDefault();
    if (closePrompt) return;
    closePrompt = true;
    try {
      const choice = await dialog.showMessageBox(window, {
        type: 'question', title: 'Encoding is active',
        message: 'Keep the application open, or cancel the current work and exit?',
        buttons: ['Keep application open', 'Cancel encoding and exit'], defaultId: 0, cancelId: 0, noLink: true,
      });
      if (choice.response === 1) {
        await service.cancelCurrent();
        exitAllowed = true;
        window.close();
      }
    } finally { closePrompt = false; }
  });
  window.webContents.on('render-process-gone', async (_event, details) => {
    // Loss of the only UI cancels work; it never enables invisible encoding.
    shutdownOutcome = 'failed';
    rendererLost = true;
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
    removeHandlers();
    void finishShutdown();
  });
  await window.loadURL(entryUrl);
}

app.on('before-quit', event => {
  if (service && !shutdownComplete) {
    event.preventDefault();
    if (window && !window.isDestroyed()) window.close();
    else { quitDuringStartup = true; void finishShutdown(); }
  }
});
// The window's close handler drains the owned child and durable session tail.
// Quitting here first can truncate the final diagnostic event.
app.on('window-all-closed', () => { if (!service) app.quit(); });
