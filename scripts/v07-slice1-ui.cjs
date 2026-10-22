'use strict';

// The parent owns execution and desktop review. This driver launches ONLY the
// sibling fail-closed display entry, never the application main or old smoke
// suites. Run --describe to print the boundary without launching Electron.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash, randomUUID } = require('node:crypto');
const ROOT = path.resolve(__dirname, '..');
const OWNER = 'Slice1 display fixtures — no media qualification';
const ENTRY = path.join(__dirname, 'v07-slice1-ui-main.cjs');
const usage = {
  capture: 'node scripts/v07-slice1-ui.cjs',
  interactive: 'node scripts/v07-slice1-ui.cjs --interactive --scenario=mixed',
  emptyInteractive: 'node scripts/v07-slice1-ui.cjs --interactive --scenario=empty',
  boundary: OWNER,
  launchEntry: ENTRY,
  media: 'No FFmpeg, ffprobe, encoder availability probes, encodes or benchmarks. Synthetic text byte fixtures only.',
  isolation: 'A fresh artifacts/v0.7/slice1-ui/<UUID>/state namespace. No accepted application state is opened.',
  controls: 'Main-only globalThis.slice1FixtureHarness via Playwright Electron evaluate; no production renderer test API.',
  interactiveVisibility: 'Hidden through automatic checks. Parent sends show on stdin only after desktop preflight; hide/snapshot/outer640/ordinary/close are the other bounded commands.',
};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
async function captureHiddenBitmap(app, destination) {
  let timer;
  try {
    // A never-shown Electron window can stall CDP Page.captureScreenshot after
    // fonts have loaded. capturePage explicitly requests capture while hidden;
    // no desktop window is shown and no timeout/retry is treated as acceptance.
    const bitmap = await Promise.race([
      app.evaluate(async ({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0], bounds = window.getContentBounds();
        const image = await window.webContents.capturePage({ x: 0, y: 0, width: bounds.width, height: bounds.height },
          { stayHidden: true });
        return { pngBase64: image.toPNG({ scaleFactor: 1 }).toString('base64'), imageSize: image.getSize(),
          sourceScaleFactors: image.getScaleFactors(), representations: image.getScaleFactors().map(scaleFactor =>
            ({ scaleFactor, size: image.getSize(scaleFactor) })), visible: window.isVisible() };
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(Error('Hidden Electron frame capture timed out after 20 seconds.')), 20000); }),
    ]);
    const png = Buffer.from(bitmap.pngBase64, 'base64');
    assert.ok(png.length >= 24 && png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])), 'Capture must be a PNG.');
    const pngSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
    await fs.writeFile(destination, png);
    return { method: 'Electron.webContents.capturePage(stayHidden=true); NativeImage.toPNG(scaleFactor=1 requested)',
      pngSize, imageSize: bitmap.imageSize, sourceScaleFactors: bitmap.sourceScaleFactors,
      representations: bitmap.representations, windowVisible: bitmap.visible,
      conversion: 'NativeImage PNG export only; no image resizing or editing.',
      sleepControl: 'stayAwake omitted; no keep-awake request' };
  } finally { clearTimeout(timer); }
}
async function sourceManifest() {
  const files = ['package.json', 'preload.js', 'src/ipc.cjs', 'src/encoder-service.cjs', 'src/local-protocol.cjs',
    'src/media.cjs', 'src/encode-operation.cjs', 'ui/index.html', 'ui/styles.css', 'ui/renderer.js',
    'scripts/v07-slice1-ui.cjs', 'scripts/v07-slice1-ui-main.cjs'];
  return Promise.all(files.map(async file => { const bytes = await fs.readFile(path.join(ROOT, file));
    return { file, sizeBytes: bytes.length, sha256: sha(bytes) }; }));
}
function options() {
  const result = { interactive: false, scenario: 'mixed', describe: false };
  for (const arg of process.argv.slice(2)) {
    if (arg === '--interactive') result.interactive = true;
    else if (arg === '--describe') result.describe = true;
    else if (arg === '--scenario=empty') result.scenario = 'empty';
    else if (arg === '--scenario=mixed') result.scenario = 'mixed';
    else throw Error(`Unknown Slice1 argument: ${arg}`);
  }
  return result;
}
async function main() {
  const opts = options();
  if (opts.describe) { console.log(JSON.stringify(usage, null, 2)); return; }
  const id = randomUUID(), runRoot = path.join(ROOT, 'artifacts', 'v0.7', 'slice1-ui', id);
  await fs.mkdir(path.dirname(runRoot), { recursive: true }); await fs.mkdir(runRoot);
  await fs.writeFile(path.join(runRoot, 'run-root.json'), JSON.stringify({ schema: 1, id, purpose: OWNER }) + '\n', { flag: 'wx' });
  const report = { schema: 1, id, purpose: OWNER, status: 'running', startedAt: new Date().toISOString(),
    command: { node: process.execPath, script: path.join(__dirname, 'v07-slice1-ui.cjs'), arguments: process.argv.slice(2) },
    artifacts: runRoot, preferenceIsolationPath: path.join(runRoot, 'state'), mode: opts.interactive ? 'interactive' : 'capture-and-check',
    fixtureTruth: {
      capabilities: 'Injected availability for UI display; no encoder/device support observation.',
      inspection: 'Injected typed descriptions over owned plain-text byte files bearing media extensions.',
      preparation: 'Actual EncoderService preparation, source identity, provenance classification and canonical argument builder.',
      ipc: 'Actual production preload.js and registerIpc sender/payload handlers; substituted owned-folder dialog results.',
      runtimeVersions: 'Electron/Chromium/Node from this display process. FFmpeg/ffprobe remain not-yet-observed.',
      execution: 'Start, output opening, process run, child_process APIs all fail closed. No media invocation is permitted.',
    }, limitations: ['Display-only evidence does not qualify media, native folder pickers, codecs, hardware, packaging or release acceptance.',
      'Screenshots capture Chromium content via Electron capturePage. Requested content dimensions, actual PNG pixels, device scale and measured mapping are recorded separately. Native desktop acceptance belongs to the owner.',
      'The isolated harness disables background throttling and requests hidden captures. These rendering controls do not qualify production background behavior. No system keep-awake option is requested.',
      'The conspicuous fixture notice is a harness-only DOM addition using existing production styles.',
      'Navigation busy checks use a main-only synthetic running phase with no child and no execution authority.',
      'Only the display harness Electron instance is closed by automatic mode. Interactive mode remains open until its own window is closed.'],
    checks: [], captureAttempts: [], captures: [], errors: [],
  };
  const save = () => fs.writeFile(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  let app, page, heartbeat, commandInput;
  try {
    report.sourcesBefore = await sourceManifest(); await save();
    const packageInfo = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'));
    const electronInfo = JSON.parse(await fs.readFile(path.join(ROOT, 'node_modules', 'electron', 'package.json'), 'utf8'));
    assert.equal(electronInfo.version, packageInfo.devDependencies.electron, 'The existing pinned Electron package must match. No install is attempted.');
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const args = [ENTRY, `--user-data-dir=${report.preferenceIsolationPath}`, `--slice1-run-root=${runRoot}`,
      ...(opts.interactive ? ['--slice1-interactive'] : [])];
    report.electronLaunch = { executable: path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'), args };
    await save();
    const { _electron } = require('playwright');
    app = await _electron.launch({ executablePath: report.electronLaunch.executable, args, cwd: ROOT, env, timeout: 60000 });
    page = await app.firstWindow(); page.setDefaultTimeout(15000);
    page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled);
    await app.evaluate(() => globalThis.slice1FixtureHarness.markFixture());
    await page.locator('#slice1-fixture-notice').waitFor({ state: 'visible' });
    assert.equal(page.url(), 'app://encoder/index.html');
    const proof = () => app.evaluate(() => globalThis.slice1FixtureHarness.proof());
    const snapshot = () => page.evaluate(() => window.encoder.getSnapshot());
    const noMedia = () => app.evaluate(() => globalThis.slice1FixtureHarness.assertNoMedia());
    const getUI = () => page.evaluate(() => ({
      activeTab: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
      selectedIds: [...document.querySelectorAll('[data-testid="encode-file"]:checked')].map(node => node.dataset.fileId).sort(),
      authorizationChoices: [...document.querySelectorAll('[data-testid="choose-reencode"]:checked')].map(node => node.dataset.fileId).sort(),
      focus: document.querySelector('#focused-file-name')?.textContent,
      filter: document.querySelector('#batch-filter')?.value,
      profile: document.querySelector('#profile')?.value, preset: document.querySelector('#preset')?.value,
      quality: document.querySelector('#quality')?.value,
      drawerOpen: document.querySelector('#files-toggle')?.getAttribute('aria-expanded'),
    }));
    const stateAuthority = state => ({ phase: state.phase, planId: state.planId, settings: state.settings,
      encodingSettingsStale: state.encodingSettingsStale, operationDraft: state.operationDraft,
      items: state.items.map(item => ({ id: item.id, name: item.name, outputName: item.outputName,
        status: item.status, reason: item.reason, origin: item.origin, operationRequest: item.operationRequest,
        reencodeAuthorized: item.reencodeAuthorized })) });
    const checkStartGuard = async label => {
      const before = await snapshot();
      const request = { planId: before.planId || randomUUID(), fileIds: before.items.filter(item => item.status === 'ready').slice(0, 1).map(item => item.id) };
      const result = await page.evaluate(async payload => {
        try { await window.encoder.startBatch(payload); return { rejected: false }; }
        catch (error) { return { rejected: true, code: error.code, message: error.message }; }
      }, request);
      assert.equal(result.rejected, true, 'The display host must reject Start.');
      // Electron contextBridge does not promise custom Error properties on a
      // rejected Promise. Confirm the renderer-visible refusal plus the actual
      // main-owned guard receipt, rather than inventing a retained error.code.
      assert.match(result.message, /Start batch is disabled in this host/);
      const guardReceipt = (await proof()).blockedActions.at(-1);
      assert.equal(guardReceipt.kind, 'Start batch');
      result.codeObservation = result.code || 'custom Error code not preserved through contextBridge';
      assert.deepEqual(stateAuthority(await snapshot()), stateAuthority(before), 'Rejected Start must preserve the authoritative plan and phase.');
      const noMediaResult = await noMedia();
      report.guardChecked ||= []; report.guardChecked.push({ label, result, noMedia: noMediaResult,
        requestHadPreparedPlan: Boolean(before.planId), readyFileCount: request.fileIds.length,
        expectedEvidence: 'The blocked Start action is retained in no-media-proof.json; no process or run attempt is made.' });
      await save();
    };
    const ensureDrawer = async open => {
      const button = page.locator('#files-toggle');
      if (await button.isVisible() && (await button.getAttribute('aria-expanded') === 'true') !== open) await button.click();
    };
    const resize = async (width, height) => {
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size.width, size.height), { width, height });
      await page.waitForFunction(size => Math.abs(innerWidth - size.width) <= 1 && Math.abs(innerHeight - size.height) <= 1, { width, height });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    };
    const capture = async (label, width, height, target = null) => {
      await resize(width, height);
      if (target) await page.locator(target).scrollIntoViewIfNeeded();
      else await page.evaluate(() => scrollTo(0, 0));
      const filename = `${label}-${width}x${height}.png`;
      const windowGeometry = await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows()[0];
        return { outerBounds: window.getBounds(), contentBounds: window.getContentBounds() };
      });
      const metrics = await page.evaluate(() => {
        const rect = selector => {
          const element = document.querySelector(selector); if (!element) return null;
          const box = element.getBoundingClientRect();
          return { x: box.x, y: box.y, top: box.top, right: box.right, bottom: box.bottom,
            left: box.left, width: box.width, height: box.height, hidden: element.hidden,
            clientWidth: element.clientWidth, scrollWidth: element.scrollWidth };
        };
        return { innerWidth, innerHeight, devicePixelRatio, scrollX, scrollY,
        visualViewport: window.visualViewport ? { width: visualViewport.width, height: visualViewport.height,
          offsetLeft: visualViewport.offsetLeft, offsetTop: visualViewport.offsetTop, scale: visualViewport.scale } : null,
        documentClientWidth: document.documentElement.clientWidth, documentClientHeight: document.documentElement.clientHeight,
        documentWidth: document.documentElement.scrollWidth, documentHeight: document.documentElement.scrollHeight,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        rectangles: { appShell: rect('.app-shell'), locationPanel: rect('#location-panel'),
          chooseInput: rect('#choose-input'), chooseOutput: rect('#choose-output'),
          inputPath: rect('#input-path'), outputPath: rect('#output-path') },
        activeElement: document.activeElement?.id || document.activeElement?.getAttribute('data-testid'),
        selectedTab: document.querySelector('[role="tab"][aria-selected="true"]')?.id,
        focusedFile: document.querySelector('#focused-file-name')?.textContent,
        helpOpen: !document.querySelector('#control-help-display')?.hidden,
        drawerOpen: document.querySelector('#files-toggle')?.getAttribute('aria-expanded'),
      }; });
      const attempt = { label, file: filename, requestedContentSize: { width, height }, windowGeometry, metrics, status: 'capturing' };
      report.captureAttempts.push(attempt); await save();
      try {
        attempt.bitmap = await captureHiddenBitmap(app, path.join(runRoot, filename));
        const png = attempt.bitmap.pngSize;
        const expectedCss = { width: metrics.innerWidth, height: metrics.innerHeight }, expectedDevice = {
          width: Math.round(metrics.innerWidth * metrics.devicePixelRatio), height: Math.round(metrics.innerHeight * metrics.devicePixelRatio) };
        const sameSize = (left, right) => Math.abs(left.width - right.width) <= 1 && Math.abs(left.height - right.height) <= 1;
        attempt.rasterMapping = { expectedCssPixelSize: expectedCss, expectedDevicePixelSize: expectedDevice,
          observedPngPixelsPerCssPixel: { x: png.width / width, y: png.height / height },
          classification: sameSize(png, expectedCss) ? 'css-pixel-raster'
            : sameSize(png, expectedDevice) ? 'device-pixel-raster' : 'unexpected-raster-size' };
        attempt.status = 'captured'; report.captures.push(attempt); await save();
        assert.notEqual(attempt.rasterMapping.classification, 'unexpected-raster-size', 'Captured PNG dimensions match neither the CSS content size nor its measured device scale.');
      } catch (error) { attempt.status = 'failed'; attempt.failure = error.message; await save(); throw error; }
      assert.equal(metrics.horizontalOverflow, false, `Unexpected page overflow in ${filename}`);
    };
    const captureSizes = async label => {
      await capture(label, 1440, 900); await capture(label, 1088, 794); await capture(label, 640, 480);
    };
    report.initialProof = await proof();
    assert.equal(report.initialProof.isolation.userData, report.preferenceIsolationPath);
    assert.equal(report.initialProof.isolation.sessionData, report.preferenceIsolationPath);
    assert.equal(report.initialProof.electron, packageInfo.devDependencies.electron);
    for (const field of ['contextIsolation', 'sandbox', 'webSecurity']) assert.equal(report.initialProof.security[field], true);
    assert.equal(report.initialProof.security.nodeIntegration, false);
    assert.equal(report.initialProof.security.backgroundThrottling, false);
    assert.equal((await snapshot()).items.length, 0);
    await checkStartGuard('empty-workbench');
    await captureSizes('empty-encode');
    report.checks.push('Empty workbench uses the production UI, preload, IPC and isolated pinned Electron session.');

    // A keyboard tab focus move must be inert. Explicit activation may read
    // local history/defaults; neither kind of navigation may mutate a draft.
    await page.locator('#tab-encode').focus();
    await page.keyboard.press('ArrowRight');
    assert.equal((await getUI()).activeTab, 'tab-encode');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'tab-remux');
    await page.keyboard.press('Enter');
    assert.equal((await getUI()).activeTab, 'tab-remux');
    const remuxActions = await page.locator('#workspace-remux button:not([disabled]), #workspace-remux input:not([disabled]), #workspace-remux select:not([disabled])').count();
    assert.equal(remuxActions, 0, 'Slice1 Remux must not expose execution controls.');
    await captureSizes('remux-unavailable');
    await page.locator('#tab-encode').click();
    report.checks.push('Manual keyboard navigation moves focus before explicit activation; Remux exposes no executable controls.');

    if (opts.scenario === 'mixed') {
      await resize(1088, 794);
      await page.locator('#choose-input').click(); await page.locator('#choose-output').click();
      await page.locator('#prepare-batch').click();
      // Playwright's injected poller treats an async predicate's Promise as
      // truthy before it resolves. Poll the real IPC snapshot in the driver,
      // awaiting each response, so initial empty-ready cannot satisfy this gate.
      const preparationDeadline = Date.now() + 15000;
      let state;
      do {
        state = await snapshot();
        if (state.phase === 'ready' && state.planId && state.items.length >= 60) break;
        if (['failed', 'cancelled'].includes(state.phase)) throw Error(`Display fixture preparation ${state.phase}: ${state.error || 'inspect diagnostics'}`);
        if (Date.now() >= preparationDeadline) throw Error(`Display fixture preparation timed out: ${state.phase}, ${state.items.length} entries.`);
        await new Promise(resolve => setTimeout(resolve, 50));
      } while (true);
      assert.ok(state.items.length >= 60, 'Mixed fixture coverage requires sixty or more entries.');
      for (const status of ['ready', 'generated', 'ambiguous', 'unsupported', 'skipped', 'conflict']) {
        assert.ok(state.items.some(item => item.status === status), `Missing ${status} display fixture`);
      }
      await app.evaluate(() => globalThis.slice1FixtureHarness.applyRangeFixture());
      state = await snapshot();
      const rangeItem = state.items.find(item => item.name === 'Range request display fixture.mkv');
      assert.equal(rangeItem.status, 'unsupported');
      assert.equal(rangeItem.reasonCode, 'OPERATION_QUALIFICATION_REQUIRED');
      assert.deepEqual(rangeItem.operationRequest.range, { startUs: 10000000, endUs: 35000000 });
      assert.equal(rangeItem.operationRequest.origins.range, 'file');
      report.mixedPrepared = state;
      await checkStartGuard('valid-prepared-display-fixture');
      report.fixtureStatusCounts = Object.fromEntries([...new Set(state.items.map(item => item.status))].map(status => [status, state.items.filter(item => item.status === status).length]));
      await ensureDrawer(true); await capture('mixed-files', 1440, 900, '#batch-heading');
      await capture('mixed-files', 1088, 794, '#batch-heading');
      await capture('mixed-files-drawer', 640, 480, '#batch-heading');
      await resize(1088, 794); await ensureDrawer(true);
      await page.locator('#batch-filter').selectOption('all');
      await page.locator('#clear-selection').click();
      const ordinary = state.items.find(item => item.status === 'ready' && item.name.startsWith('Display fixture'));
      await page.locator(`[data-testid="encode-file"][data-file-id="${ordinary.id}"]`).check();
      const selection = (await getUI()).selectedIds;
      await page.locator(`tr[data-file-id="${ordinary.id}"] [data-testid="inspect-file"]`).click();
      assert.deepEqual((await getUI()).selectedIds, selection, 'Focusing a file must preserve batch membership.');
      assert.equal((await getUI()).focus, ordinary.name);
      await page.locator('#focused-file-details-slot [data-testid="encoding-details"] > summary').click();
      const planned = await page.evaluate(request => window.encoder.getEncodingDetails(request), { planId: state.planId, fileId: ordinary.id });
      await page.waitForFunction(expected => document.querySelector('#focused-file-details-slot [data-testid="resolved-args"]')?.textContent === JSON.stringify(expected, null, 2), planned.args);
      assert.equal(planned.kind, 'resolved-argument-template');
      assert.equal(planned.args.at(-1), '<temporary output assigned at start>');
      report.canonicalArguments = { fixtureOnly: true, file: ordinary.name, ...planned };
      await capture('focused-canonical-argv', 1440, 900, '#file-inspector');
      await capture('focused-canonical-argv', 1088, 794, '#file-inspector');
      await capture('focused-canonical-argv', 640, 480, '#file-inspector');
      assert.equal(await page.locator('#preview-list').isVisible(), false);
      assert.match(await page.locator('#hidden-selected-count').textContent(), /1 selected hidden/);
      assert.match(await page.locator('#selected-review-list').textContent(), /Hidden in file-list view/);
      assert.equal(await page.locator('#start-batch').isVisible(), true, 'Closing Files must leave Start/review in the page flow.');
      assert.deepEqual((await getUI()).selectedIds, selection);
      await resize(1088, 794); await ensureDrawer(true);
      assert.match(await page.locator('#hidden-selected-count').textContent(), /0 selected hidden/);
      report.checks.push('Closed narrow drawer truthfully discloses selected hidden rows while preserving exact selection and reachable Start/review; widening clears that display-only hidden state.');
      await page.locator('#batch-filter').selectOption('generated');
      assert.deepEqual((await getUI()).selectedIds, selection, 'Filtering must preserve hidden selections.');
      const generated = state.items.find(item => item.status === 'generated');
      await page.locator(`tr[data-file-id="${generated.id}"] [data-testid="inspect-file"]`).click();
      assert.deepEqual((await getUI()).selectedIds, selection, 'Generated-file inspection must not select or authorize it.');
      assert.equal((await snapshot()).items.find(item => item.id === generated.id).reencodeAuthorized, false);
      await capture('generated-origin', 1440, 900, '#file-inspector');
      await capture('generated-origin', 1088, 794, '#file-inspector');
      await capture('generated-origin', 640, 480, '#file-inspector');
      await resize(1088, 794); await ensureDrawer(true);
      await page.locator('#batch-filter').selectOption('all');
      await page.locator(`tr[data-file-id="${rangeItem.id}"] [data-testid="inspect-file"]`).click();
      await page.locator('#focused-file-details-slot [data-testid="file-operation-editor"] > summary').click();
      await capture('refused-range-settings-origins', 1440, 900, '#file-inspector');
      await capture('refused-range-settings-origins', 1088, 794, '#file-inspector');
      await capture('refused-range-settings-origins', 640, 480, '#file-inspector');
      report.checks.push('Seventy-plus real preparation rows cover ordinary, generated, ambiguous, refused, skipped and collision states; a range request retains explicit file origin and is refused.');
      report.checks.push('Focus, filters and generated-file inspection preserve batch selection and temporary authorization. Canonical argv display matches the actual production service array.');

      await resize(1088, 794);
      const beforeNavigation = stateAuthority(await snapshot()); const uiBefore = await getUI();
      for (const tab of ['remux', 'jobs', 'settings', 'history', 'help', 'encode']) await page.locator(`#tab-${tab}`).click();
      assert.deepEqual(stateAuthority(await snapshot()), beforeNavigation);
      const uiAfter = await getUI();
      for (const key of ['selectedIds', 'authorizationChoices', 'focus', 'filter', 'profile', 'preset', 'quality']) assert.deepEqual(uiAfter[key], uiBefore[key]);
      report.checks.push('All workspace switches preserve prepared plan, requests, selection, focus and encoder controls.');

      await app.evaluate(() => globalThis.slice1FixtureHarness.holdBusyFixture());
      const busyBefore = stateAuthority(await snapshot());
      await page.locator('#tab-remux').click(); await page.locator('#tab-jobs').click();
      await captureSizes('synthetic-busy-current-jobs');
      await page.locator('#tab-encode').click();
      assert.deepEqual(stateAuthority(await snapshot()), busyBefore, 'Navigation during a busy display must not mutate main state.');
      await app.evaluate(() => globalThis.slice1FixtureHarness.releaseBusyFixture());
      report.checks.push('Synthetic busy-phase navigation remains inert without any media child or queued execution.');
    }

    await resize(1088, 794); await page.locator('#tab-encode').click();
    await page.locator('#preset-help').focus(); await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#control-help-display').isVisible(), true);
    await capture('keyboard-preset-help', 1440, 900, '#control-help-display');
    await capture('keyboard-preset-help', 1088, 794, '#control-help-display');
    await capture('keyboard-preset-help', 640, 480, '#control-help-display');
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('#control-help-display').isVisible(), false);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'preset-help');
    report.checks.push('Keyboard help opens from the actual trigger; Escape closes it and restores trigger focus.');
    await page.locator('#tab-help').click();
    await page.waitForFunction(() => document.querySelector('#runtime-information')?.children.length > 0);
    const runtime = await page.evaluate(() => window.encoder.getRuntimeInformation());
    for (const name of ['ffmpeg', 'ffprobe']) assert.equal(runtime.media[name].status, 'not-yet-observed');
    report.runtimeInformation = runtime; await captureSizes('help-runtime-unobserved');
    report.checks.push('Help reports actual display-process versions and leaves FFmpeg/ffprobe unobserved.');
    if (opts.scenario === 'mixed') {
      await page.locator('#tab-encode').click();
      await page.locator('#review-selected').click();
      await page.waitForFunction(() => document.querySelector('#review-selected').getAttribute('aria-expanded') === 'true');
      await page.locator('#selected-review > summary').click();
      await page.waitForFunction(() => document.querySelector('#review-selected').getAttribute('aria-expanded') === 'false');
      report.checks.push('Selected-review expansion follows both its button and the real details summary toggle.');
    }
    const authorityBeforeDefaults = stateAuthority(await snapshot());
    await page.locator('#tab-settings').click();
    const originalTarget = await page.locator('#default-remux-target').inputValue();
    const target = originalTarget === 'mp4' ? 'matroska' : 'mp4';
    await page.locator('#default-remux-target').selectOption(target);
    await page.locator('#app-settings-save').click();
    await page.waitForFunction(expected => document.querySelector('#remux-target-summary').textContent.startsWith(`${expected} `), target);
    await page.locator('#tab-remux').click();
    assert.match(await page.locator('#remux-target-summary').textContent(), new RegExp(`^${target} .*execution unavailable`));
    assert.deepEqual(stateAuthority(await snapshot()), authorityBeforeDefaults, 'Saving future defaults must not mutate the prepared plan.');
    await page.locator('#tab-settings').click();
    await page.locator('#default-remux-target').selectOption(originalTarget); await page.locator('#app-settings-save').click();
    await page.waitForFunction(expected => document.querySelector('#remux-target-summary').textContent.startsWith(`${expected} `), originalTarget);
    report.checks.push('Remux reflects a genuinely saved App Settings target and reset-to-prior value without changing prepared authority.');
    report.noMedia = await noMedia(); assert.deepEqual(report.errors, []);
    await page.locator('#tab-encode').click();
    await resize(1088, 794); await page.evaluate(() => scrollTo(0, 0));
    report.sourcesAfter = await sourceManifest(); assert.deepEqual(report.sourcesAfter, report.sourcesBefore, 'Source changed during evidence capture; repeat against a stable source snapshot.');
    report.status = opts.interactive ? 'interactive-review-ready-hidden' : 'passed'; await save();
    console.log(JSON.stringify({ artifacts: runRoot, status: report.status, pid: app.process().pid, title: OWNER, noMedia: report.noMedia }, null, 2));
    if (opts.interactive) {
      // Finish automated page input while hidden. Only the parent's explicit
      // bounded stdin command can show this window after native preflight.
      // No network debug port or arbitrary evaluator is exposed.
      const { createInterface } = require('node:readline');
      commandInput = createInterface({ input: process.stdin, crlfDelay: Infinity });
      let commandTail = Promise.resolve();
      const commands = {
        show: () => app.evaluate(() => globalThis.slice1FixtureHarness.showWindow()),
        hide: () => app.evaluate(() => globalThis.slice1FixtureHarness.hideWindow()),
        snapshot: () => proof(),
        outer640: () => app.evaluate(() => globalThis.slice1FixtureHarness.reviewWindowSize('outer640')),
        ordinary: () => app.evaluate(() => globalThis.slice1FixtureHarness.reviewWindowSize('ordinary')),
        close: async () => { await app.close(); return { closedOwnDisplayHost: true }; },
      };
      commandInput.on('line', line => {
        const command = line.trim();
        commandTail = commandTail.then(async () => {
          if (!Object.hasOwn(commands, command)) { console.log(JSON.stringify({ command, rejected: 'Use show, hide, snapshot, outer640, ordinary or close.' })); return; }
          const result = await commands[command]();
          report.interactiveCommands ||= []; report.interactiveCommands.push({ command, at: new Date().toISOString() });
          await save(); console.log(JSON.stringify({ command, result }, null, 2));
        }).catch(error => { console.error(JSON.stringify({ command, error: error.message })); });
      });
      console.log('READY HIDDEN. Parent performs desktop preflight before sending show on stdin. Commands: show, hide, snapshot, outer640, ordinary, close.');
      // Polling writes only evidence; it never sends input or changes state.
      heartbeat = setInterval(() => { void proof().then(async value => {
        report.interactiveLastObservedAt = new Date().toISOString(); report.interactiveProof = value; await save();
      }).catch(() => {}); }, 3000);
      await new Promise(resolve => app.process().once('exit', resolve));
      commandInput.close(); commandInput = null;
      clearInterval(heartbeat); heartbeat = null; app = null;
      report.status = 'interactive-review-closed';
    }
  } catch (error) {
    report.status = 'failed'; report.failure = { message: error.message, stack: error.stack };
    if (app && page && !page.isClosed()) {
      report.failureCapture = await captureHiddenBitmap(app, path.join(runRoot, 'failure.png'))
        .catch(captureError => ({ failed: true, message: captureError.message }));
    }
    process.exitCode = 1;
  } finally {
    clearInterval(heartbeat);
    commandInput?.close();
    if (app) { await app.close().catch(error => { report.closeError = error.message; }); report.closedOwnDisplayHost = true; }
    report.finishedAt = new Date().toISOString();
    try {
      report.finalNoMediaProof = JSON.parse(await fs.readFile(path.join(runRoot, 'no-media-proof.json'), 'utf8'));
      assert.equal(report.finalNoMediaProof.mediaInvocationCount, 0);
      assert.equal(report.finalNoMediaProof.processAttempts.length, 0);
      assert.equal(report.finalNoMediaProof.runAttempts.length, 0);
    }
    catch (error) { report.noMediaProofReadError = error.message; report.status = 'failed'; process.exitCode = 1; }
    await save();
    console.log(JSON.stringify({ artifacts: runRoot, status: report.status, failure: report.failure?.message || null }));
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
