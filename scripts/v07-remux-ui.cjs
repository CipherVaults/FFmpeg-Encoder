'use strict';

// Root-scheduled endpoint evidence, never an automatic qualification command.
// Requiring this file only exposes inert helpers to the separate Electron host.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const FIXTURE_ID = '6b317682-605b-4d40-8ff3-b3f84678f0ae';
const FIXTURE_REPORT = path.join(ROOT, 'artifacts/v0.7/slice2/envelope-fixtures', FIXTURE_ID, 'report.json');
const PURPOSE = 'Slice3 real Remux UI endpoint; one owned stream-copy job';
const LEASE_PATH = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
const LIMITS = Object.freeze({ totalMs: 30 * 60000, jobMs: 600000, childMs: 120000,
  maxChildren: 64, maxPipeBytes: 256 * 1024 ** 2, forecastBytes: 1024 ** 3, marginBytes: 512 * 1024 ** 2 });
const SPECIMENS = Object.freeze({
  A: { name: 'A-1920x1080-30fps.mp4', bytes: 7302143, sha256: '8f9a4f320fcf214759ba0d4ba0b7a1aad4e2393c6b56360b9858752e5e15ebdc' },
  B: { name: 'B-1280x720-30fps.mov', bytes: 3086612, sha256: 'd6030cb3613006b72da5ea02a80fefd82ad14f57c76268b823a691f83e162273' },
  E: { name: 'E-1920x1080-30fps.mov', bytes: 22781910, sha256: 'ce4c29097500b975efa2cb1761d62ff0736a3a6e3e627727390689ae8c99ecfe' },
});
const CASES = Object.freeze({ 'B-mkv': { specimen: 'B', target: 'matroska' },
  'A-mp4': { specimen: 'A', target: 'mp4' }, 'E-mkv': { specimen: 'E', target: 'matroska' },
  'E-mp4': { specimen: 'E', target: 'mp4' } });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = stat => Object.fromEntries(['dev', 'ino', 'size', 'nlink', 'mtimeNs', 'ctimeNs', 'birthtimeNs']
  .map(key => [key, String(stat[key])]));
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
function inside(root, file) {
  const relative = path.relative(root, path.resolve(file));
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}
function pathsFor(id) {
  assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  const runRoot = path.join(ROOT, 'artifacts/v0.7/slice3/ui', id);
  const ownedRoot = path.join(OWNED, 'outputs', 'remux-ui-' + id);
  return { runRoot, ownedRoot, stateDir: path.join(ownedRoot, 'state'), input: path.join(ownedRoot, 'input'),
    output: path.join(ownedRoot, 'output'), rescanOutput: path.join(ownedRoot, 'rescan-output') };
}
function ordinaryPath(file, kind = 'file') {
  const absolute = path.resolve(file), anchor = path.parse(absolute).root;
  let current = anchor;
  const parts = path.relative(anchor, absolute).split(path.sep).filter(Boolean);
  for (let index = 0; index <= parts.length; index++) {
    if (index) current = path.join(current, parts[index - 1]);
    const stat = fs.lstatSync(current);
    assert.ok(!stat.isSymbolicLink(), 'Harness paths must not contain links or redirected ancestors.');
    assert.ok(index === parts.length && kind === 'file' ? stat.isFile() : stat.isDirectory());
  }
  assert.ok(samePath(fs.realpathSync(absolute), absolute), 'Harness path resolved outside its literal namespace.');
  return absolute;
}
function stableFile(file, limit = 2 * 1024 ** 2) {
  ordinaryPath(file);
  const before = fs.lstatSync(file, { bigint: true });
  assert.equal(before.nlink, 1n); assert.ok(before.size <= BigInt(limit));
  const handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    assert.deepEqual(identity(fs.fstatSync(handle, { bigint: true })), identity(before));
    const bytes = fs.readFileSync(handle); assert.ok(bytes.length <= limit);
    assert.deepEqual(identity(fs.fstatSync(handle, { bigint: true })), identity(before));
    assert.deepEqual(identity(fs.lstatSync(file, { bigint: true })), identity(before));
    ordinaryPath(file);
    return { bytes, identity: identity(before), sha256: sha(bytes) };
  } finally { fs.closeSync(handle); }
}
function producerManifest() {
  const files = ['main.js', 'preload.js', 'package.json', 'package-lock.json', 'resources/candidate-binary-manifest.json',
    'scripts/v07-remux-ui.cjs', 'scripts/v07-remux-ui-main.cjs'];
  function add(directory, depth = 0) {
    assert.ok(depth <= 8); ordinaryPath(path.join(ROOT, directory), 'directory');
    for (const entry of fs.readdirSync(path.join(ROOT, directory), { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink()); const file = path.join(directory, entry.name);
      if (entry.isDirectory()) add(file, depth + 1);
      else { assert.ok(entry.isFile()); files.push(file.replaceAll(path.sep, '/')); }
    }
  }
  add('src'); add('ui'); assert.ok(files.length <= 256);
  return files.sort().map(file => { const value = stableFile(path.join(ROOT, file));
    return { file, sizeBytes: value.bytes.length, sha256: value.sha256 }; });
}
async function accountOwned(root) {
  ordinaryPath(root, 'directory');
  // The application may rename its own cache/spool entries while being counted.
  // Retry a vanished name only; links, wrong types and budgets fail immediately.
  for (let attempt = 1; attempt <= 3; attempt++) {
    let bytes = 0, entries = 0;
    async function walk(directory, depth) {
      assert.ok(depth <= 32); ordinaryPath(directory, 'directory');
      for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
        assert.ok(++entries <= 10000); const file = path.join(directory, entry.name);
        assert.ok(inside(root, file)); const stat = await fsp.lstat(file);
        assert.ok(!stat.isSymbolicLink());
        if (stat.isDirectory()) await walk(file, depth + 1);
        else { assert.ok(stat.isFile() && stat.nlink === 1); bytes += stat.size;
          assert.ok(Number.isSafeInteger(bytes) && bytes <= LIMITS.forecastBytes, 'Owned UI run exceeded its 1 GiB growth envelope.'); }
      }
    }
    try { await walk(root, 0); return { bytes, entries, attempt, accounting: 'Observed logical named-file sizes, not an atomic filesystem quota or peak allocation.' }; }
    catch (error) { if (error.code !== 'ENOENT' || attempt === 3) throw error; }
  }
}
async function resourceCheck(ownedRoot) {
  const [d, f, owned] = await Promise.all([fsp.statfs(ROOT), fsp.statfs(OWNED), accountOwned(ownedRoot)]);
  const value = { at: new Date().toISOString(), DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize, owned };
  assert.ok(value.DFreeBytes >= 25 * 1024 ** 3, 'D: must retain at least 25 GiB free.');
  assert.ok(value.FFreeBytes >= LIMITS.forecastBytes + LIMITS.marginBytes, 'F: must retain forecast plus 512 MiB margin.');
  return value;
}
function options() {
  const result = { run: false, describe: false, case: 'B-mkv' };
  const seen = new Set();
  for (const argument of process.argv.slice(2)) {
    const key = argument.split('=')[0]; assert.ok(!seen.has(key), 'Duplicate harness argument.'); seen.add(key);
    if (argument === '--run-owned-remux-ui') result.run = true;
    else if (argument === '--describe') result.describe = true;
    else if (argument.startsWith('--case=') && Object.hasOwn(CASES, argument.slice(7))) result.case = argument.slice(7);
    else throw Error('Unknown or unbounded Remux UI harness argument: ' + argument);
  }
  assert.ok(result.describe ? !result.run : result.run, 'Execution requires --run-owned-remux-ui; --describe never launches.');
  return result;
}
const description = { command: 'node scripts/v07-remux-ui.cjs --run-owned-remux-ui --case=B-mkv',
  cases: Object.keys(CASES), purpose: PURPOSE, production: 'Actual UI/preload/registerIpc/EncoderService/createOperationControls/current pinned runtime/default Remux catalog.',
  media: 'One real Full stream-copy job, complete real collector/validator/publication; no encodes, benchmark, encoder capability or hardware probes.',
  interactions: 'Hidden BrowserWindow; actual input/output buttons and IPC, with main-only exact owned folder-picker substitutions. Native OS pickers and output-opening applications are untested.',
  catalog: 'No prospective policies. Fails before Electron launch if the requested source-owned default route is absent.',
  generatedSource: 'Rescan the one published result, observe default exclusion, and explicitly admit/reprepare only; never Start a second copy.',
  ownership: 'Fresh UUID D: receipt plus F: state/input/output. Fixed exclusive media-job.lock remains owned until main drain proof AND actual Electron close.', limits: LIMITS };

async function bounded(promise, milliseconds, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timed out.')), milliseconds); })]); }
  finally { clearTimeout(timer); }
}
async function pollSnapshot(readSnapshot, accepts, { label = 'Actual service snapshot', timeoutMs = 20000 } = {}) {
  assert.equal(typeof readSnapshot, 'function'); assert.equal(typeof accepts, 'function');
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= LIMITS.totalMs);
  const deadline = Date.now() + timeoutMs;
  let last, observations = 0;
  const expired = () => Object.assign(new Error(`${label} timed out after ${timeoutMs} ms; last actual phase: ${last?.phase || 'unobserved'}.`),
    { code: 'REMUX_UI_WAIT_TIMEOUT', observations, lastObserved: last ? {
      phase: last.phase, revision: last.revision, batchId: last.batchId, planId: last.planId,
    } : null });
  while (true) {
    if (Date.now() >= deadline) throw expired();
    // Playwright1.63's injected poller treats a returned Promise as truthy.
    // Both IPC reads and any asynchronous DOM readiness check are instead
    // awaited here in Node. The interval paces observations; it never holds or
    // fabricates a service phase or delays the application's media operation.
    last = await bounded(Promise.resolve().then(readSnapshot), deadline - Date.now(), label + ' IPC response'); observations++;
    if (Date.now() >= deadline) throw expired();
    const accepted = await bounded(Promise.resolve().then(() => accepts(last)), deadline - Date.now(), label + ' readiness check');
    assert.equal(typeof accepted, 'boolean', 'Snapshot acceptance must resolve to an actual boolean.');
    if (Date.now() >= deadline) throw expired();
    if (accepted) return last;
    await new Promise(resolve => setTimeout(resolve, Math.min(50, deadline - Date.now())));
  }
}
async function captureHidden(app, destination) {
  const bitmap = await bounded(app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]; assertHidden(window);
    function assertHidden(value) { if (value.isVisible()) throw Error('The harness window became visible.'); }
    const bounds = window.getContentBounds();
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: bounds.width, height: bounds.height }, { stayHidden: true });
    assertHidden(window);
    return { png: image.toPNG({ scaleFactor: 1 }).toString('base64'), imageSize: image.getSize(), scaleFactors: image.getScaleFactors(),
      outerBounds: window.getBounds(), contentBounds: window.getContentBounds(), visible: window.isVisible() };
  }), 20000, 'Hidden capture');
  const bytes = Buffer.from(bitmap.png, 'base64'); delete bitmap.png;
  assert.ok(bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])));
  await fsp.writeFile(destination, bytes, { flag: 'wx' });
  return { ...bitmap, file: destination, sha256: sha(bytes), bytes: bytes.length,
    pngSize: { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) },
    method: 'Electron.capturePage(stayHidden=true); NativeImage.toPNG(scaleFactor=1 requested); no image editing.' };
}
async function main() {
  const opts = options(); if (opts.describe) { console.log(JSON.stringify(description, null, 2)); return; }
  assert.equal(process.platform, 'win32', 'This exact owned endpoint harness is Windows-only.');
  const id = randomUUID(), places = pathsFor(id), selected = CASES[opts.case], specimen = SPECIMENS[selected.specimen];
  const report = { schema: 1, id, purpose: PURPOSE, status: 'running', startedAt: new Date().toISOString(),
    command: { node: process.execPath, script: __filename, arguments: process.argv.slice(2) }, case: opts.case, ...places,
    limits: LIMITS, checks: [], stateWaits: [], captures: [], errors: [], limitations: [
      'Hidden Chromium endpoint evidence does not establish native folder-picker, desktop visual acceptance, portability, packaging or release acceptance.',
      'Encode capabilities are deliberately unavailable, with zero claimed availability and no encoder/device probe. Remux inspection and media evidence are real.',
      'Folder choices are main-substituted exact owned paths. Output-opening applications are disabled in this host and are not tested.',
      'Background throttling is disabled in this isolated hidden capture host; no keep-awake request or production background-behavior claim.',
      'A fast genuine running state may finish before frame capture; actual main events and the phase at capture are recorded without synthetic holds.',
      'Source/hash checks and named-file growth observations are bounded evidence, not atomic OS quotas or a clean-machine qualification.' ] };
  let lease, leaseIdentity, app, electronProcess, electronClosed = false, closePromise, launchAttempted = false, deadline;
  const reportFile = path.join(places.runRoot, 'report.json');
  const save = async () => { const bytes = JSON.stringify(report, null, 2) + '\n'; assert.ok(Buffer.byteLength(bytes) <= 16 * 1024 ** 2); await fsp.writeFile(reportFile, bytes); };
  try {
    ordinaryPath(ROOT, 'directory'); ordinaryPath(OWNED, 'directory'); ordinaryPath(path.join(OWNED, 'outputs'), 'directory');
    await fsp.mkdir(path.dirname(places.runRoot), { recursive: true }); ordinaryPath(path.dirname(places.runRoot), 'directory');
    await fsp.mkdir(places.runRoot); await fsp.mkdir(places.ownedRoot);
    for (const file of [places.stateDir, places.input, places.output, places.rescanOutput]) await fsp.mkdir(file);
    report.sourcesBefore = producerManifest(); report.resourcesBefore = await resourceCheck(places.ownedRoot); await save();
    const catalog = require('../src/remux-catalog.cjs');
    report.catalog = { policyIdentity: catalog.REMUX_POLICY_ID, policies: catalog.REMUX_POLICIES };
    assert.ok(catalog.REMUX_POLICIES.some(policy => policy.inputFamily === 'isobmff' && policy.target === selected.target),
      'The source-owned default Remux route is not activated. Finish root qualification/review before this UI run.');
    lease = await fsp.open(LEASE_PATH, 'wx+');
    await lease.writeFile(JSON.stringify({ schema: 1, token: id, pid: process.pid, purpose: PURPOSE, runRoot: places.runRoot }) + '\n'); await lease.sync();
    leaseIdentity = identity(await lease.stat({ bigint: true })); report.lease = { path: LEASE_PATH, identity: leaseIdentity, token: id, pid: process.pid };
    const fixtureReceipt = stableFile(FIXTURE_REPORT, 4 * 1024 ** 2), fixture = JSON.parse(fixtureReceipt.bytes).cases.find(value => value.id === selected.specimen);
    const origin = path.join(OWNED, 'fixtures', 'sdr-envelope-' + FIXTURE_ID, specimen.name);
    assert.equal(fixture.status, 'generated-and-inspected'); assert.ok(samePath(fixture.output, origin));
    assert.equal(fixture.file.bytes, specimen.bytes); assert.equal(fixture.file.sha256, specimen.sha256);
    const source = stableFile(origin, 512 * 1024 ** 2); assert.equal(source.bytes.length, specimen.bytes); assert.equal(source.sha256, specimen.sha256);
    const inputFile = path.join(places.input, specimen.name); await fsp.writeFile(inputFile, source.bytes, { flag: 'wx' });
    report.source = { origin, originIdentity: source.identity, inputFile, sha256: source.sha256, bytes: source.bytes.length,
      inputIdentity: stableFile(inputFile, 512 * 1024 ** 2).identity, fixtureReport: FIXTURE_REPORT, fixtureReportSha256: fixtureReceipt.sha256 };
    const sentinel = path.join(places.output, 'protected-existing-text.txt');
    await fsp.writeFile(sentinel, 'Protected owned non-media sentinel for ' + id + '\n', { flag: 'wx' });
    report.protectedSentinel = { file: sentinel, sha256: stableFile(sentinel).sha256 };
    const marker = { schema: 1, id, purpose: PURPOSE, startedAt: report.startedAt, driverPid: process.pid, case: opts.case, selected, ...places,
      source: report.source, sentinel: report.protectedSentinel, producers: report.sourcesBefore, lease: report.lease, limits: LIMITS };
    await fsp.writeFile(path.join(places.runRoot, 'run-root.json'), JSON.stringify(marker, null, 2) + '\n', { flag: 'wx' });
    await fsp.writeFile(path.join(places.ownedRoot, 'owned-root.json'), JSON.stringify({ schema: 1, id, purpose: PURPOSE, runRoot: places.runRoot }) + '\n', { flag: 'wx' });
    const packageInfo = JSON.parse(stableFile(path.join(ROOT, 'package.json')).bytes);
    const electronInfo = JSON.parse(stableFile(path.join(ROOT, 'node_modules/electron/package.json')).bytes);
    assert.equal(electronInfo.version, packageInfo.devDependencies.electron, 'Use the existing exact pinned Electron; never install.');
    report.electronLaunch = { executable: path.join(ROOT, 'node_modules/electron/dist/electron.exe'), args: [
      path.join(__dirname, 'v07-remux-ui-main.cjs'), '--run-owned-remux-ui', '--remux-ui-id=' + id, '--user-data-dir=' + places.stateDir] };
    assert.deepEqual(producerManifest(), report.sourcesBefore); await save();
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const { _electron } = require('playwright'); launchAttempted = true;
    app = await _electron.launch({ executablePath: report.electronLaunch.executable, args: report.electronLaunch.args, cwd: ROOT, env, timeout: 60000 });
    electronProcess = app.process();
    closePromise = new Promise(resolve => { electronProcess.once('close', (code, signal) => {
      electronClosed = true; report.electronClose = { code, signal, at: new Date().toISOString() }; resolve(); }); });
    if (electronProcess.exitCode !== null || electronProcess.signalCode !== null) { electronClosed = true; report.electronClose = { code: electronProcess.exitCode, signal: electronProcess.signalCode }; }
    deadline = setTimeout(() => { report.errors.push('The whole-run deadline expired.');
      void app.evaluate(() => globalThis.remuxUiHarness.close('failed')).catch(() => {}); },
    Math.max(1, LIMITS.totalMs - (Date.now() - Date.parse(report.startedAt)))); deadline.unref();
    const page = await app.firstWindow(); page.setDefaultTimeout(20000); page.on('pageerror', error => report.errors.push(error.message));
    const proof = () => app.evaluate(() => globalThis.remuxUiHarness.proof());
    const snapshot = () => page.evaluate(() => window.encoder.getSnapshot());
    async function waitSnapshot(label, accepts, timeoutMs = 20000) {
      const receipt = { label, timeoutMs, observations: 0, startedAt: new Date().toISOString(), status: 'waiting' };
      report.stateWaits.push(receipt);
      try {
        const value = await pollSnapshot(async () => {
          const current = await snapshot(); receipt.observations++;
          receipt.lastObserved = { revision: current.revision, phase: current.phase, batchId: current.batchId, planId: current.planId };
          return current;
        }, accepts, { label, timeoutMs });
        receipt.status = 'accepted-actual-snapshot'; return value;
      } catch (error) { receipt.status = 'failed'; receipt.failure = { code: error.code, message: error.message }; throw error; }
      finally { receipt.finishedAt = new Date().toISOString(); await save(); }
    }
    await page.waitForFunction(() => Boolean(window.encoder && document.querySelector('#choose-input')));
    await waitSnapshot('Startup capability operation and UI command settled',
      async current => current.phase !== 'checking' && await page.locator('#choose-input').isEnabled());
    assert.equal(page.url(), 'app://encoder/index.html');
    report.initial = await proof();
    assert.equal(report.initial.security.contextIsolation, true); assert.equal(report.initial.security.sandbox, true);
    assert.equal(report.initial.security.nodeIntegration, false); assert.equal(report.initial.security.webSecurity, true);
    assert.equal(report.initial.security.webviewTag, false); assert.equal(report.initial.visible, false);
    assert.equal(report.initial.isolation.userData, places.stateDir); assert.equal(report.initial.isolation.sessionData, places.stateDir);
    assert.equal(report.initial.electron, electronInfo.version); assert.deepEqual(report.initial.capabilities.profiles, []);
    async function resize(width, height) {
      await app.evaluate(({ BrowserWindow }, size) => { const window = BrowserWindow.getAllWindows()[0];
        if (window.isVisible()) throw Error('Hidden-window policy violated.'); window.setContentSize(size.width, size.height); }, { width, height });
      await page.waitForFunction(size => Math.abs(innerWidth - size.width) <= 1 && Math.abs(innerHeight - size.height) <= 1, { width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    }
    async function capture(label, width = 1440, height = 900, selector = null) {
      await resize(width, height); if (selector) await page.locator(selector).scrollIntoViewIfNeeded(); else await page.evaluate(() => scrollTo(0, 0));
      const metrics = await page.evaluate(() => ({ innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY,
        documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
        focusedFile: document.querySelector('#focused-file-name')?.textContent, progressLabel: document.querySelector('#progress-label')?.textContent,
        phaseLabel: document.querySelector('#phase-badge')?.textContent, startDisabled: document.querySelector('#start-batch').disabled,
        drawerOpen: document.querySelector('#remux-files-toggle')?.getAttribute('aria-expanded') }));
      const before = await snapshot(), bitmap = await captureHidden(app, path.join(places.runRoot, label + '-' + width + 'x' + height + '.png'));
      const after = await snapshot(), match = (a, b) => Math.abs(a.width - b.width) <= 1 && Math.abs(a.height - b.height) <= 1;
      const css = { width: metrics.innerWidth, height: metrics.innerHeight }, device = { width: Math.round(css.width * metrics.devicePixelRatio), height: Math.round(css.height * metrics.devicePixelRatio) };
      const item = { label, requestedContentSize: { width, height }, metrics, bitmap, phaseBefore: before.phase, phaseAfter: after.phase,
        rasterMapping: match(bitmap.pngSize, css) ? 'css-pixel-raster' : match(bitmap.pngSize, device) ? 'device-pixel-raster' : 'unexpected-raster-size' };
      report.captures.push(item); await save(); assert.notEqual(item.rasterMapping, 'unexpected-raster-size'); assert.equal(metrics.horizontalOverflow, false);
    }
    async function prepare() {
      const previous = await snapshot();
      await page.locator('#prepare-remux').click();
      const state = await waitSnapshot('New Remux preparation and UI command settled', async current => current.batchId !== previous.batchId
        && !['preparing', 'checking'].includes(current.phase) && await page.locator('#prepare-remux').isEnabled());
      assert.equal(state.phase, 'ready', state.error); assert.equal(state.operation, 'remux');
      assert.equal(state.items.length, 1); return state;
    }
    async function focus(item) {
      await page.locator('#batch-filter').selectOption('all');
      const drawer = page.locator('#remux-files-toggle');
      if (await drawer.isVisible() && await drawer.getAttribute('aria-expanded') !== 'true' && await page.evaluate(() => innerWidth <= 900)) await drawer.click();
      await page.locator('tr[data-file-id="' + item.id + '"] [data-testid="inspect-file"]').click();
      assert.equal(await page.locator('#focused-file-name').textContent(), item.name);
    }
    async function details(item, planId) {
      const disclosure = page.locator('#focused-file-details-slot [data-testid="encoding-details"]');
      if (await disclosure.getAttribute('open') === null) await disclosure.locator('summary').click();
      const value = await page.evaluate(request => window.encoder.getEncodingDetails(request), { planId, fileId: item.id });
      await page.waitForFunction(args => document.querySelector('#focused-file-details-slot [data-testid="resolved-args"]')?.textContent === JSON.stringify(args, null, 2), value.args);
      assert.equal(value.args[value.args.indexOf('-c') + 1], 'copy'); assert.ok(!value.args.includes('-y')); return value;
    }
    await page.locator('#tab-remux').click(); await page.locator('#choose-input').click(); await page.locator('#choose-output').click();
    report.folderButtons = (await proof()).dialogs;
    assert.deepEqual(report.folderButtons.map(value => value.role), ['input', 'output']);
    await page.locator('#remux-target').selectOption(selected.target);
    let state = await prepare(), item = state.items[0];
    report.prepared = state; assert.equal(item.status, 'ready', item.reason); assert.equal(item.reencodeAuthorized, false);
    await focus(item);
    const preservation = page.locator('#focused-file-details-slot [data-testid="remux-preservation"]');
    if (await preservation.getAttribute('open') === null) await preservation.locator('summary').click();
    const audioDecision = item.remux?.omissionCandidates?.find(value => /audio/.test(value.label));
    assert.ok(audioDecision, 'The fixed A/B/E specimen has an exact main-issued audio decision for the keyboard check.');
    report.keyboardOmission = { fileId: item.id, fileName: item.name, target: selected.target, decisionId: audioDecision.id, observations: [] };
    async function keyboardDecision(decision, omitted) {
      const beforePlanId = state.planId;
      const fileId = item.id;
      const button = page.locator('#focused-file-details-slot [data-testid="remux-omission"][data-decision-id="' + decision.id + '"]');
      await button.focus(); await page.keyboard.press('Enter');
      state = await waitSnapshot(omitted ? 'Exact keyboard omission prepared' : 'Exact keyboard restoration prepared', current => current.phase === 'ready'
        && current.planId !== beforePlanId && current.items.some(row => row.id === fileId
          && (row.remux?.omissionDecisionIds || []).includes(decision.id) === omitted));
      item = state.items.find(row => row.id === fileId); assert.equal(item.status, 'ready', item.reason);
      await page.waitForFunction(request => {
        const active = document.activeElement;
        return active?.dataset.testid === 'remux-omission' && active.dataset.decisionId === request.decisionId && !active.disabled
          || active?.id === 'focused-file-name' && active.textContent === request.fileName;
      }, { decisionId: decision.id, fileName: item.name });
      const active = await page.evaluate(() => ({ id: document.activeElement?.id, testid: document.activeElement?.dataset.testid,
        decisionId: document.activeElement?.dataset.decisionId, text: document.activeElement?.textContent }));
      report.keyboardOmission.observations.push({ omitted, planId: state.planId, omissionDecisionIds: item.remux.omissionDecisionIds, focus: active });
      assert.equal(item.remux.target, selected.target); assert.equal((await proof()).copyJobs, 0);
    }
    await keyboardDecision(audioDecision, true);
    await capture('keyboard-audio-omission-focus', 1440, 900, '#file-inspector');
    // Restoring may mint a new unapproved opaque decision; the production UI
    // then returns keyboard focus to this exact file's heading, as documented.
    const restoreDecision = item.remux.omissionCandidates.find(value => value.id === audioDecision.id);
    assert.ok(restoreDecision); await keyboardDecision(restoreDecision, false);
    assert.equal(item.remux.omissionDecisionIds.length, 0);
    report.preparedAfterKeyboardRestore = state;
    report.checks.push('Actual keyboard audio omission and restoration use main-issued opaque decisions, real preparation and the current replacement control or exact-file heading focus; no media job starts.');
    report.preparedArguments = await details(item, state.planId);
    assert.equal(report.preparedArguments.kind, 'resolved-argument-template'); assert.equal(report.preparedArguments.args.at(-1), '<temporary output assigned at start>');
    assert.equal(await page.locator('#start-batch').isEnabled(), true);
    await capture('prepared-remux-preservation', 1440, 900, '#file-inspector');
    await capture('prepared-remux-narrow', 800, 900, '#file-inspector');
    await resize(1440, 900);
    const changedTarget = selected.target === 'matroska' ? 'mp4' : 'matroska';
    await page.locator('#remux-target').selectOption(changedTarget);
    assert.equal(await page.locator('#start-batch').isDisabled(), true);
    assert.equal(await page.locator('#remux-target-notice').isVisible(), true);
    report.targetMismatch = { originalTarget: selected.target, selectedTarget: changedTarget, startDisabled: true, snapshotPlanUnchanged: (await snapshot()).planId === state.planId };
    await capture('changed-target-start-revoked', 1440, 900, '#remux-heading');
    await page.locator('#remux-target').selectOption(selected.target); assert.equal(await page.locator('#start-batch').isEnabled(), true);
    report.checks.push('Production Remux navigation, input/output buttons and IPC, actual qualified preparation, stream decisions, canonical argument display and target-mismatch Start revocation.');
    const preparedBatchId = state.batchId, startedPlanId = state.planId;
    await page.locator('#start-batch').click();
    await page.waitForFunction(() => document.querySelector('#tab-jobs').getAttribute('aria-selected') === 'true');
    state = await waitSnapshot('Started Remux job actually terminal', current => current.batchId !== preparedBatchId && current.planId === startedPlanId
      && ['completed', 'failed', 'cancelled'].includes(current.phase), LIMITS.jobMs + 30000);
    report.result = state; item = state.items[0]; assert.equal(state.phase, 'completed', state.error); assert.equal(item.status, 'success', item.reason);
    await focus(item); report.executedArguments = await details(item, state.planId); assert.equal(report.executedArguments.kind, 'actual-invocation');
    assert.deepEqual(report.executedArguments.args.slice(0, -1), report.preparedArguments.args.slice(0, -1));
    assert.equal(report.executedArguments.executable, report.preparedArguments.executable);
    assert.equal(report.executedArguments.destination, report.preparedArguments.destination);
    assert.ok(inside(places.output, report.executedArguments.args.at(-1)));
    assert.equal(item.outputDisposition?.published, true);
    await capture('success-current-jobs', 1440, 900, '#results-panel');
    await capture('success-result-details-narrow', 800, 900, '#file-inspector');
    const successProof = await proof(); report.realEvents = successProof.events; report.runningCapture = successProof.runningCapture;
    assert.ok(successProof.events.some(event => event.phase === 'running'), 'Retain an actual running update even when copy is too fast for a screenshot.');
    assert.ok(successProof.events.some(event => event.progress?.stage === 'evidence-collection'), 'Actual complete-evidence collection must be observed.');
    assert.equal(successProof.copyJobs, 1); assert.equal(successProof.liveChildren, 0);
    const outputFile = report.executedArguments.destination; assert.ok(inside(places.output, outputFile));
    const output = stableFile(outputFile, 512 * 1024 ** 2); report.output = { file: outputFile, bytes: output.bytes.length, sha256: output.sha256, identity: output.identity };
    report.checks.push('One actual production Start reached Current Jobs, real running/progress/evidence events, validated publication, success/result and actual-invocation details.');

    // Inspect the produced app marker without running another stream-copy job.
    await resize(1440, 900); await page.locator('#new-batch').click(); await page.locator('#choose-input').click(); await page.locator('#choose-output').click();
    state = await prepare(); item = state.items[0];
    report.generatedRescan = { initial: state }; assert.equal(item.status, 'generated'); assert.equal(item.reencodeAuthorized, false);
    assert.equal(await page.locator('#start-batch').isDisabled(), true); await focus(item);
    await capture('generated-result-excluded', 1440, 900, '#batch-heading');
    const rescanFamily = selected.target === 'matroska' ? 'matroska' : 'isobmff';
    if (catalog.REMUX_POLICIES.some(policy => policy.inputFamily === rescanFamily && policy.target === selected.target)) {
      await page.locator('tr[data-file-id="' + item.id + '"] [data-testid="choose-reencode"]').check();
      const previousAdmissionBatchId = state.batchId;
      await page.locator('#reencode-selected').click();
      state = await waitSnapshot('Current generated-source admission and UI command settled', async current => current.batchId !== previousAdmissionBatchId
        && current.phase !== 'preparing' && await page.locator('#prepare-remux').isEnabled());
      item = state.items[0]; report.generatedRescan.explicitAdmission = state;
      assert.equal(state.phase, 'ready', state.error); assert.equal(item.status, 'ready', item.reason); assert.equal(item.reencodeAuthorized, true);
      assert.equal(await page.locator('#start-batch').isEnabled(), true);
      await capture('generated-result-explicit-source-only', 1440, 900, '#batch-heading');
      await page.locator('#remux-target').selectOption(changedTarget); assert.equal(await page.locator('#start-batch').isDisabled(), true);
      state = await prepare(); report.generatedRescan.afterTargetReprepare = state;
      assert.equal(state.items[0].status, 'generated'); assert.equal(state.items[0].reencodeAuthorized, false);
      assert.equal(await page.locator('#start-batch').isDisabled(), true);
      report.checks.push('The real published result is excluded by default; exact UI source admission is ready-only, and target reprepare discards admission without starting a second copy.');
    } else report.generatedRescan.explicitAdmissionNotAttempted = 'No activated default route for this generated result/target; default exclusion was observed.';
    assert.equal((await proof()).copyJobs, 1); assert.equal(report.errors.length, 0);
    assert.equal(stableFile(sentinel).sha256, report.protectedSentinel.sha256);
    const masterAfter = stableFile(origin, 512 * 1024 ** 2), copiedAfter = stableFile(inputFile, 512 * 1024 ** 2);
    assert.equal(masterAfter.sha256, report.source.sha256); assert.deepEqual(masterAfter.identity, report.source.originIdentity);
    assert.equal(copiedAfter.sha256, report.source.sha256); assert.deepEqual(copiedAfter.identity, report.source.inputIdentity);
    assert.equal(stableFile(outputFile, 512 * 1024 ** 2).sha256, report.output.sha256);
    report.finalBeforeClose = await proof(); report.resourcesAfter = await resourceCheck(places.ownedRoot);
    report.status = 'passed-bounded-real-remux-ui-endpoint'; await save();
  } catch (error) { report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    clearTimeout(deadline); report.closureFailures = [];
    async function attempt(label, action) { try { return await action(); } catch (error) {
      report.closureFailures.push({ label, code: error.code, message: error.message }); report.status = 'failed-retained'; process.exitCode = 1; return null; } }
    if (app && !electronClosed) {
      await attempt('request-main-drain', () => app.evaluate((_electron, outcome) => globalThis.remuxUiHarness.close(outcome), report.status.startsWith('passed') ? 'completed' : 'failed'));
      if (closePromise) await attempt('actual-electron-close', () => bounded(closePromise, 150000, 'Actual Electron close after main drain'));
    }
    if (launchAttempted) await attempt('main-closure-proof', async () => {
      const value = JSON.parse(stableFile(path.join(places.runRoot, 'main-proof.json'), 16 * 1024 ** 2).bytes); report.closedMain = value;
      assert.equal(value.id, id); assert.equal(value.closure?.resourcesClosed, true); assert.equal(value.closure?.diagnosticsPersisted, true);
      assert.equal(value.liveChildren, 0); assert.equal(value.closure?.allChildrenClosed, true); assert.equal(value.closure?.windowDestroyed, true);
      assert.equal(electronClosed, true, 'The media lease outlives the actual Electron process.');
      if (report.status.startsWith('passed')) { assert.equal(report.electronClose?.code, 0); assert.equal(report.electronClose?.signal, null); }
      assert.equal(value.closure?.failures.length, 0); if (value.outcome === 'failed') throw Error('The main host retained a failed outcome.');
    });
    if (report.sourcesBefore) await attempt('producer-freeze', async () => { report.sourcesAfter = producerManifest(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore); });
    if (lease) {
      const safeToRelease = !launchAttempted || electronClosed && report.closedMain?.closure?.resourcesClosed === true
        && report.closedMain?.closure?.allChildrenClosed === true && report.closedMain?.liveChildren === 0;
      if (safeToRelease) await attempt('media-lease-release', async () => {
        ordinaryPath(LEASE_PATH); const named = identity(await fsp.lstat(LEASE_PATH, { bigint: true }));
        for (const key of ['dev', 'ino', 'birthtimeNs']) assert.equal(named[key], leaseIdentity[key]);
        const value = JSON.parse(await fsp.readFile(LEASE_PATH, 'utf8')); assert.equal(value.token, id); assert.equal(value.pid, process.pid);
        await lease.close(); lease = null; await fsp.unlink(LEASE_PATH); report.leaseReleased = true;
      });
      else { report.leaseRetained = 'Actual app/owned-child closure is unproven. Root must inspect this exact owned lease; no automatic stale-lock removal.';
        await attempt('close-retained-lease-handle', async () => { await lease.close(); lease = null; }); }
    }
    report.finishedAt = new Date().toISOString();
    await attempt('save-report', save); console.log(JSON.stringify({ id, status: report.status, report: reportFile, failure: report.failure,
      leaseReleased: report.leaseReleased === true, leaseRetained: report.leaseRetained }));
  }
}
module.exports = { ROOT, OWNED, PURPOSE, LEASE_PATH, LIMITS, CASES, SPECIMENS, FIXTURE_REPORT,
  sha, identity, samePath, inside, pathsFor, ordinaryPath, stableFile, producerManifest, resourceCheck, bounded, pollSnapshot };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
