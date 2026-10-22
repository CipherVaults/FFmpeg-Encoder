'use strict';

// DISPLAY FIXTURES ONLY. This separate Electron entry never imports main.js.
// It reuses the production preload, IPC validation, service, protocol and UI.
// Only inspection/capability observations are injected. A planned argument array
// is presentation evidence; there is no executable media path in this host.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { app, BrowserWindow, ipcMain, session, protocol } = require('electron');
const ROOT = path.resolve(__dirname, '..');
const OWNER = 'Slice1 display fixtures — no media qualification';
const parentRoot = path.join(ROOT, 'artifacts', 'v0.7', 'slice1-ui');
const runRoot = path.resolve(app.commandLine.getSwitchValue('slice1-run-root') || '.');
const runId = path.basename(runRoot);
if (path.dirname(runRoot) !== parentRoot || !/^[a-f0-9-]{36}$/.test(runId)) {
  throw Error('Slice1 requires a new driver-owned artifact run directory.');
}
const marker = JSON.parse(fs.readFileSync(path.join(runRoot, 'run-root.json'), 'utf8'));
if (marker.schema !== 1 || marker.id !== runId || marker.purpose !== OWNER) throw Error('Invalid Slice1 run ownership.');
const stateDir = path.join(runRoot, 'state');
if (path.resolve(app.commandLine.getSwitchValue('user-data-dir') || '.') !== stateDir) throw Error('Slice1 preference isolation mismatch.');
fs.mkdirSync(stateDir, { recursive: true });
app.setPath('userData', stateDir);
app.setPath('sessionData', stateDir);
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-component-update');
// Hidden capture must continue producing compositor frames without showing or
// focusing a desktop window. These switches affect this isolated process only.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');

const evidence = {
  schema: 1, purpose: OWNER, id: runId, runRoot, stateDir,
  startedAt: new Date().toISOString(), electron: process.versions.electron, mediaInvocationCount: 0,
  processAttempts: [], runAttempts: [], blockedActions: [], fixtureInspections: [],
  observation: 'Injected display fixtures; no FFmpeg/ffprobe observation or media qualification.',
  pathsReadByInspection: 'Only text byte fixtures under this artifact run.',
  production: { preload: 'preload.js', ipc: 'src/ipc.cjs', service: 'src/encoder-service.cjs',
    assets: ['ui/index.html', 'ui/styles.css', 'ui/renderer.js'] },
  capturePolicy: { alwaysStartsHidden: true, backgroundThrottling: false,
    switches: ['disable-renderer-backgrounding', 'disable-backgrounding-occluded-windows'],
    method: 'Electron webContents.capturePage with stayHidden; NativeImage PNG scaleFactor 1 requested; actual PNG dimensions recorded',
    systemSleepControl: 'stayAwake omitted; no keep-awake request' },
};
const saveProof = () => fs.writeFileSync(path.join(runRoot, 'no-media-proof.json'), JSON.stringify(evidence, null, 2) + '\n');
const refusal = message => Object.assign(new Error(message), { code: 'SLICE1_MEDIA_FORBIDDEN' });
const recordBlocked = (kind, details) => {
  evidence.blockedActions.push({ kind, at: new Date().toISOString(), ...details }); saveProof();
  throw refusal(`${OWNER}. ${kind} is disabled in this host.`);
};

// Install before loading any production module that can capture spawn/exec.
// This is a test-process boundary, never a production feature or environment
// bypass. It also catches an accidental future call outside injected run().
const childProcess = require('node:child_process');
for (const name of ['spawn', 'spawnSync', 'exec', 'execSync', 'execFile', 'execFileSync', 'fork']) {
  childProcess[name] = (...args) => {
    evidence.processAttempts.push({ api: name, executable: String(args[0]), at: new Date().toISOString() });
    saveProof(); throw refusal('Child processes are forbidden in the Slice1 display host.');
  };
}
require('node:module').syncBuiltinESMExports();
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES, ARCHIVE_RECIPE, describeRecipe } = require('../src/media.cjs');
const { generationDescriptionOf } = require('../src/provenance.cjs');
const { ENTRY_URL, CSP, resolveAsset, registerLocalProtocol } = require('../src/local-protocol.cjs');
const { registerIpc } = require('../src/ipc.cjs');
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: {
  standard: true, secure: true, supportFetchAPI: true, corsEnabled: true,
} }]);

const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const input = path.join(runRoot, 'fixture-input');
const output = path.join(runRoot, 'fixture-output');
const normalNames = Array.from({ length: 62 }, (_, index) =>
  `Display fixture ${String(index + 1).padStart(2, '0')} — recording with descriptive title.mkv`);
const specialNames = ['Collision display fixture.mp4', 'Collision display fixture.mkv',
  'Generated output display fixture.mkv', 'Generated output with missing description display fixture.mkv',
  'Possible previous output_H265-CPU.mkv', 'Refused color display fixture.mkv',
  'Existing destination display fixture.mkv', 'Range request display fixture.mkv',
  'Long name display fixture العربية — meeting recording with chapters audio and subtitles from a deliberate review session.mkv'];
const fixtureNames = [...normalNames, ...specialNames];
const outputIds = new Map(specialNames.filter(name => name.startsWith('Generated')).map(name => [name, randomUUID()]));
const priorGenerationFixture = generationDescriptionOf({ version: 1, profileId: SETTINGS.profileId, codec: 'H265', backend: 'CPU',
  encoder: 'libx265', preset: SETTINGS.preset, qualityMode: 'CRF', quality: SETTINGS.quality, bitDepth: 8,
  encoderArgs: describeRecipe(SETTINGS).args, appVersion: require('../package.json').version,
  createdAt: '2026-10-23T00:00:00.000Z' }); // Explicit synthetic provenance timestamp, not an observation.
function fixtureInspection(name) {
  const probe = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p',
    width: 1920, height: 1080, avg_frame_rate: '30000/1001', duration: '7250.5',
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', disposition: { default: 1 } },
  { index: 1, codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
    tags: { language: 'eng', title: 'Fixture audio description' }, disposition: { default: 1 } },
  { index: 2, codec_type: 'subtitle', codec_name: 'subrip', tags: { language: 'ara' }, disposition: { default: 0 } }],
  chapters: [], format: { duration: '7250.5', tags: { title: `${OWNER}: ${name}` } } };
  if (outputIds.has(name)) Object.assign(probe.format.tags, {
    FFMPEG_ENCODER_PROVENANCE: '1', FFMPEG_ENCODER_OUTPUT_ID: outputIds.get(name),
  });
  if (name === 'Generated output display fixture.mkv') probe.format.tags.FFMPEG_ENCODER_GENERATION = JSON.stringify(priorGenerationFixture);
  const refused = name.startsWith('Refused');
  return { probe, color: { classification: refused ? 'ambiguous' : 'sdr', supported: !refused,
    transfer: 'bt709', videoIndex: 0, reasons: refused ? ['Display fixture: ambiguous color evidence is refused. No media was inspected.'] : [] },
  duration: 7250.5, summary: { selectedVideoIndex: 0, codec: 'h264', width: 1920, height: 1080,
    pixelFormat: 'yuv420p', bitDepth: 8, frameRate: 30000 / 1001, durationSeconds: 7250.5,
    streamCounts: { video: 1, audio: 1, subtitle: 1, attachment: 0 },
    metadataNotices: [OWNER], samplingLimit: 'Synthetic descriptive facts; no metadata or decoded frame was observed.' } };
}

let window, service, removeHandlers;
let closing = false;
let heldState = null;
async function seedFixtures() {
  await fsp.mkdir(input); await fsp.mkdir(output);
  for (const name of fixtureNames) await fsp.writeFile(path.join(input, name), `${OWNER}\nNOT A MEDIA FILE\n${name}\n`, { flag: 'wx' });
  await fsp.writeFile(path.join(output, 'Existing destination display fixture_H265-CPU.mkv'), `${OWNER}\nNOT A MEDIA FILE\n`, { flag: 'wx' });
  evidence.fixtureFiles = fixtureNames.map(name => ({ name, kind: 'plain-text-not-media' }));
  evidence.fixtureCount = fixtureNames.length; saveProof();
}
function assertNoMedia() {
  if (evidence.mediaInvocationCount || evidence.processAttempts.length || evidence.runAttempts.length) {
    throw Error('Slice1 no-media assertion failed; inspect no-media-proof.json.');
  }
  return { mediaInvocationCount: 0, processAttempts: 0, runAttempts: 0,
    fixtureInspections: evidence.fixtureInspections.length, blockedActions: evidence.blockedActions.length };
}
async function markFixture() {
  await window.webContents.executeJavaScript(`(() => {
    document.title = ${JSON.stringify(OWNER)};
    let notice = document.getElementById('slice1-fixture-notice');
    if (!notice) {
      notice = document.createElement('aside'); notice.id = 'slice1-fixture-notice';
      notice.className = 'error-banner'; notice.setAttribute('role', 'note');
      const heading = document.createElement('strong'); heading.textContent = ${JSON.stringify(OWNER)};
      const detail = document.createElement('p');
      detail.textContent = 'Synthetic descriptions and text byte files only. Capability availability is a display fixture. Start and process execution are disabled.';
      notice.append(heading, detail);
      (document.querySelector('.app-shell') || document.body).prepend(notice);
    }
  })()`);
}
async function createWindow() {
  await seedFixtures();
  service = new EncoderService({ ffmpeg: '[unobserved display fixture: FFmpeg disabled]',
    ffprobe: '[unobserved display fixture: ffprobe disabled]', stateDir,
    inspectionCache: null, inspectionWorkers: 2,
    storageEligibility: { check: async () => ({ eligible: false, reason: 'Display fixtures do not establish storage eligibility.' }) },
    capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile,
      label: `${profile.label} [DISPLAY FIXTURE]`, available: true, supportedBitDepths: [8, 10],
      reason: 'Injected display fixture; runtime support was not observed.', checks: [] })),
    recipes: [{ ...ARCHIVE_RECIPE, available: false, supportedBitDepths: [],
      reason: 'Unavailable in this display host; no runtime qualification.' }],
    versions: {} }),
    inspect: async (file, options) => {
      if (path.dirname(file) !== input || !fixtureNames.includes(path.basename(file))) throw refusal('Inspection accepts owned display fixtures only.');
      evidence.fixtureInspections.push({ file: path.basename(file), kind: 'injected-description-not-media-observation' });
      options.onStage?.({ stage: 'metadata' });
      return fixtureInspection(path.basename(file));
    },
    verify: () => recordBlocked('Output validation', {}),
    run: async (executable, argv) => {
      evidence.runAttempts.push({ executable, argv: [...argv], at: new Date().toISOString() });
      saveProof(); throw refusal('FFmpeg, ffprobe and storage subprocesses are disabled.');
    },
    outputAccess: { action: async () => recordBlocked('Open completed output', {}) },
  });
  // No fake successful execution or publication is possible, even with valid
  // prepared IDs. This replacement exists only in this separate display host.
  service.startBatch = () => recordBlocked('Start batch', {});
  await service.initializeDiagnostics();
  const appSession = session.fromPartition(`slice1-ui-${runId}`);
  appSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  appSession.setPermissionCheckHandler(() => false);
  appSession.on('will-download', event => event.preventDefault());
  registerLocalProtocol(appSession.protocol, path.join(ROOT, 'ui'));
  appSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !resolveAsset(details.url, details.method) }));
  window = new BrowserWindow({ width: 1100, height: 800, minWidth: 640, minHeight: 480,
    show: false, backgroundColor: '#0f1115', title: OWNER, autoHideMenuBar: true,
    webPreferences: { preload: path.join(ROOT, 'preload.js'), session: appSession, backgroundThrottling: false,
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } });
  window.webContents.on('page-title-updated', event => { event.preventDefault(); window.setTitle(OWNER); });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  for (const eventName of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) {
    window.webContents.on(eventName, event => event.preventDefault());
  }
  const fixtureDialog = { showOpenDialog: async (_window, options) => ({ canceled: false,
    filePaths: [options.title === 'Select input video folder' ? input : output] }) };
  removeHandlers = registerIpc({ ipcMain, window, service, dialog: fixtureDialog, entryUrl: ENTRY_URL });
  service.on('update', snapshot => {
    saveProof();
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('encoder:update', snapshot);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    evidence.rendererFailure = details; saveProof(); void finish('failed');
  });
  window.on('close', event => { if (!closing) { event.preventDefault(); void finish('completed'); } });
  window.webContents.on('did-finish-load', () => { void markFixture(); });
  // Main-only controls: not preload/IPC/renderer authority. The driver can hold
  // a *synthetic* busy phase to check inert navigation without owning a child.
  globalThis.slice1FixtureHarness = Object.freeze({
    proof: () => {
      const preferences = window.webContents.getLastWebPreferences();
      return structuredClone({ ...evidence, snapshot: service.snapshot(),
        isolation: { userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), partition: `slice1-ui-${runId}` },
        security: { entryUrl: ENTRY_URL, csp: CSP, ...Object.fromEntries([
          'preload', 'nodeIntegration', 'contextIsolation', 'sandbox', 'webSecurity',
          'allowRunningInsecureContent', 'webviewTag', 'backgroundThrottling',
        ].map(key => [key, preferences[key]])), backgroundThrottling: window.webContents.getBackgroundThrottling() } });
    },
    assertNoMedia, markFixture,
    showWindow: () => { window.show(); return { outerBounds: window.getBounds(), contentBounds: window.getContentBounds() }; },
    hideWindow: () => { window.hide(); return { visible: window.isVisible() }; },
    reviewWindowSize: size => {
      if (!['outer640', 'ordinary'].includes(size)) throw Error('Unknown bounded review window size.');
      if (size === 'outer640') window.setBounds({ width: 640, height: 480 });
      else window.setContentSize(1088, 794);
      return { outerBounds: window.getBounds(), contentBounds: window.getContentBounds() };
    },
    applyRangeFixture: async () => {
      const state = service.snapshot(); const item = state.items.find(row => row.name === 'Range request display fixture.mkv');
      if (!item || state.phase !== 'ready') throw Error('Prepare the mixed fixtures before requesting the range fixture.');
      const result = await service.updateFileOperations({ planId: state.planId, draftId: state.operationDraft.id,
        revision: state.operationDraft.revision, fileIds: [item.id], overrides: { range: { startUs: 10000000, endUs: 35000000 } } });
      saveProof(); return result;
    },
    holdBusyFixture: () => {
      if (heldState || service.busy) throw Error('An existing fixture hold must be released first.');
      heldState = service.state; service.state = { ...service.state, phase: 'running',
        progress: { fileId: service.state.items[0]?.id || null, fileIndex: 1, total: service.state.items.length,
          stage: 'output-validation', percent: null, seconds: 0, duration: null, speed: null, fps: null } };
      evidence.busyFixture = 'Synthetic busy display only; no child exists.'; service.emitState(); return service.snapshot();
    },
    releaseBusyFixture: () => {
      if (heldState) { service.state = { ...heldState, revision: service.state.revision }; heldState = null; service.emitState(); }
      return service.snapshot();
    },
  });
  await window.loadURL(ENTRY_URL); await markFixture();
  evidence.readyAt = new Date().toISOString(); evidence.electron = process.versions.electron;
  assertNoMedia(); saveProof();
}
async function finish(outcome) {
  if (closing) return; closing = true;
  try { await service?.closeDiagnostics(outcome); }
  catch (error) { evidence.closeDiagnosticError = error.message; }
  evidence.finishedAt = new Date().toISOString(); evidence.outcome = outcome; saveProof();
  removeHandlers?.(); if (window && !window.isDestroyed()) window.destroy(); app.quit();
}
app.on('before-quit', event => { if (!closing) { event.preventDefault(); void finish('completed'); } });
app.on('window-all-closed', () => { if (closing) app.quit(); });
app.whenReady().then(createWindow).catch(error => {
  evidence.startupFailure = { message: error.message, stack: error.stack }; saveProof();
  console.error(error); void finish('failed').finally(() => app.exit(1));
});
