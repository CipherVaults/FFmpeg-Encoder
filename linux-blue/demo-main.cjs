'use strict';
// Separate opt-in entry. The Windows main/preload/runtime paths stay untouched.
const { app, BrowserWindow, ipcMain, session } = require('electron');
const fs = require('node:fs/promises');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createSyntheticService } = require('./synthetic-service.cjs');
const { createDemoController } = require('./demo-controller.cjs');
const { registerDemoIpc } = require('./demo-ipc.cjs');
const { verifyTool } = require('./runtime.cjs');
const { preflightOutputFolder } = require('./output-preflight.cjs');
app.enableSandbox();
app.disableHardwareAcceleration();
const parent = path.join(__dirname, 'artifacts', 'desktop-demo');
for (const [name, folder] of [['userData', 'electron-state'], ['sessionData', 'electron-session']]) {
  const directory = path.join(parent, folder);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  app.setPath(name, directory);
}

async function launchDemo({ onChild, show = true } = {}) {
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  await app.whenReady();
  await verifyTool('ffmpeg'); await verifyTool('ffprobe');
  const storage = await preflightOutputFolder(parent);
  console.log('LINUX_DEMO_OUTPUT_PREFLIGHT', JSON.stringify({ passed: storage.passed,
    atomicPublication: storage.atomicPublication, collisionPreserved: storage.collisionPreserved,
    persistentReuse: storage.persistentReuse }));
  const census = { spawned: 0, closed: 0, live: 0, maximum: 0 };
  const controller = await createDemoController({ createService: createSyntheticService,
    source: process.env.LINUX_BLUE_SYNTHETIC_FIXTURE, parent, onChild(child) {
      census.spawned++; census.live++; census.maximum = Math.max(census.maximum, census.live);
      child.once('close', () => { census.closed++; census.live--; });
      onChild?.(child);
    } });
  const entryUrl = pathToFileURL(path.join(__dirname, 'demo.html')).href;
  const allowed = new Set(['demo.html', 'demo-renderer.js', 'demo.css'].map(name => pathToFileURL(path.join(__dirname, name)).href));
  const isolated = session.fromPartition('blue-linux-synthetic-demo');
  isolated.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.setDevicePermissionHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !allowed.has(details.url) }));
  const window = new BrowserWindow({ width: 900, height: 680, minWidth: 720, minHeight: 580, show,
    title: 'Blue Linux · Synthetic CPU Demo', autoHideMenuBar: true, backgroundColor: '#101a27',
    webPreferences: { session: isolated, preload: path.join(__dirname, 'demo-preload.cjs'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false, devTools: false } });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  const unregister = registerDemoIpc({ ipcMain, window, entryUrl, controller });
  let draining, drained = false;
  const close = () => {
    if (!draining) draining = controller.close().then(() => {
      if (census.live !== 0) throw new Error('Owned child closure remains incomplete.');
      console.log('LINUX_DEMO_CLOSED', JSON.stringify({ ...census, state: controller.snapshot() }));
      drained = true; unregister();
      if (!window.isDestroyed()) window.destroy();
    });
    return draining;
  };
  window.on('close', event => {
    if (!drained) { event.preventDefault(); void close().then(() => app.quit()); }
  });
  app.on('before-quit', event => {
    if (!drained) { event.preventDefault(); void close().then(() => app.quit()); }
  });
  window.webContents.on('render-process-gone', () => { void close().then(() => app.quit()); });
  try {
    await window.loadURL(entryUrl);
    const preferences = window.webContents.getLastWebPreferences();
    console.log('LINUX_DEMO_READY', JSON.stringify({ electron: process.versions.electron,
      sandbox: preferences.sandbox, contextIsolation: preferences.contextIsolation,
      nodeIntegration: preferences.nodeIntegration, webSecurity: preferences.webSecurity }));
  }
  catch (failure) { await close(); throw failure; }
  return { window, close, entryUrl };
}
// Electron's direct .cjs entry does not reliably set require.main to this module.
// This file is an entry point, not an importable controller/test helper.
console.log('LINUX_DEMO_ENTRY', JSON.stringify({ requireMainMatches: require.main === module }));
launchDemo().catch(failure => { console.error('LINUX_DEMO_START_FAILED', failure.code || 'START_FAILED'); app.exit(1); });
