'use strict';

// Native renderer layout coverage. Startup capabilities are real; the monitor
// snapshots and partial-depth return value below are explicitly synthetic UI
// fixtures, never evidence that a batch encoded or that this GPU lacks a depth.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const { ENTRY_URL } = require('../src/local-protocol.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', `layout-smoke-${Date.now()}`);
const scenarios = [
  { label: '720p', width: 1280, height: 720, dpr: 1 },
  { label: 'desktop', width: 1920, height: 1080, dpr: 1 },
  { label: '4k', width: 3840, height: 2160, dpr: 1 },
  { label: '4k-200pct', width: 1920, height: 1080, dpr: 2 },
  { label: 'small-150pct', width: 854, height: 480, dpr: 1.5 },
];
const report = {
  startedAtUtc: new Date().toISOString(), status: 'running', artifacts, layouts: [], checks: [], errors: [],
  limits: [
    'This launches the real isolated Electron application at app://encoder/index.html and waits for its real startup encode/decode capability checks.',
    'Monitor states are synthetic complete snapshots delivered by main through the existing encoder:update event; they do not represent a real batch or real telemetry.',
    'The available-but-partial-depth case is a harness-only override of the cached capability response, followed by renderer reload. It is not this hardware capability result.',
    'Folder dialog results are substituted with actual harness-owned directories; this is not native OS picker coverage.',
    'DPR uses Chromium CDP device emulation, not a Windows display setting or physical monitor change. Vertical scrolling is allowed.',
    'Screenshots use CSS pixel scale; recorded devicePixelRatio separately proves the requested emulated DPR.',
  ],
};

async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, `--user-data-dir=${path.join(artifacts, 'user-data')}`], cwd: root, env,
  });
  report.pid = await app.evaluate(() => process.pid);
  let page;
  let cdp;
  try {
    page = await app.firstWindow();
    page.on('pageerror', (error) => report.errors.push(error.message));
    await page.waitForFunction(() => !document.querySelector('#profile')?.disabled, undefined, { timeout: 60_000 });
    assert.equal(page.url(), ENTRY_URL);
    report.realCapabilities = await page.evaluate(() => window.encoder.getCapabilities());
    assert.equal(report.realCapabilities.profiles.length, 6);
    assert.ok(report.realCapabilities.profiles.every((profile) => profile.checks.length === 2));
    report.checks.push('Real startup capability results loaded through the production bridge at the app origin.');
    cdp = await page.context().newCDPSession(page);

    // Mutate only the return value in this process's test instrumentation. The
    // cached real result and production service state remain authoritative.
    const partialReason = '10-bit SDR: synthetic layout fixture — this encoder cannot initialize that depth on the example device.';
    await app.evaluate(({ app }, { modulePath, reason }) => {
      const { EncoderService } = process.getBuiltinModule('module').createRequire(modulePath)(modulePath);
      const original = EncoderService.prototype.getCapabilities;
      EncoderService.prototype.getCapabilities = async function (...args) {
        const result = await original.apply(this, args);
        const profile = result.profiles.find((item) => item.id === 'h264-nvidia');
        profile.available = true;
        profile.supportedBitDepths = [8];
        profile.reason = reason;
        profile.checks = [
          { bitDepth: 8, available: true, reason: null },
          { bitDepth: 10, available: false, reason, code: 'SYNTHETIC_LAYOUT_FIXTURE' },
        ];
        return result;
      };
    }, { modulePath: path.join(root, 'src/encoder-service.cjs'), reason: partialReason });
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#profile')?.disabled);
    await page.selectOption('#profile', 'h264-nvidia');
    await page.locator('#capability-details summary').click();
    assert.equal(await page.locator('#profile option[value="h264-nvidia"]').isDisabled(), false);
    assert.match(await page.textContent('#profile-description'), /8-bit supported/);
    assert.ok((await page.textContent('#capability-list')).includes(partialReason));
    report.syntheticPartialDepth = { profileId: 'h264-nvidia', available: true, supportedBitDepths: [8], reason: partialReason };
    report.checks.push('Available partial-depth profile remains selectable and visibly reports both supported depth and the unavailable-depth reason.');

    const folders = ['Input العربية with long folder wording '.repeat(2).trim(), 'Output العربية with long folder wording '.repeat(2).trim()]
      .map((name) => path.join(artifacts, name));
    for (const folder of folders) await fs.mkdir(folder);
    await app.evaluate(({ dialog }, paths) => {
      let next = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[next++]] });
    }, folders);
    await page.click('#choose-input');
    await page.click('#choose-output');
    // Folder selection settles asynchronously in main; wait rather than race it.
    await page.waitForFunction(() => document.querySelector('#prepare-batch')?.disabled === false, null, { timeout: 15000 });
    assert.equal(await page.isEnabled('#prepare-batch'), true);

    async function capture(phase, scenario) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: scenario.width, height: scenario.height, deviceScaleFactor: scenario.dpr, mobile: false,
      });
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const metrics = await page.evaluate(() => {
        const shown = (element) => element.getClientRects().length > 0;
        const rect = (element) => {
          const box = element.getBoundingClientRect();
          return { id: element.id || element.tagName, left: box.left, right: box.right, width: box.width, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth };
        };
        return {
          width: innerWidth, height: innerHeight, dpr: devicePixelRatio,
          scrollWidth: document.documentElement.scrollWidth,
          controls: [...document.querySelectorAll('button,select,input,progress,summary')].filter(shown).map(rect),
          containers: [...document.querySelectorAll('.panel,.table-scroll,.current-file,.path-box,.telemetry,.cancel-bar')].filter(shown).map(rect),
        };
      });
      assert.equal(metrics.width, scenario.width);
      assert.equal(metrics.height, scenario.height);
      // Chromium can expose a tiny floating-point error under CDP emulation
      // (for example 1.0000000149011612 for 1); reject meaningful scale drift.
      assert.ok(Math.abs(metrics.dpr - scenario.dpr) < 0.000001,
        `Unexpected DPR: requested ${scenario.dpr}, observed ${metrics.dpr}`);
      assert.ok(metrics.scrollWidth <= metrics.width + 1, `Horizontal page overflow: ${phase}/${scenario.label}`);
      for (const control of metrics.controls) {
        assert.ok(control.width > 0 && control.left >= -1 && control.right <= metrics.width + 1,
          `Control outside viewport: ${phase}/${scenario.label}/${JSON.stringify(control)}`);
      }
      for (const container of metrics.containers) {
        assert.ok(container.scrollWidth <= container.clientWidth + 1,
          `Container overflow: ${phase}/${scenario.label}/${JSON.stringify(container)}`);
      }
      const image = `${phase}-${scenario.label}.png`;
      await page.screenshot({ path: path.join(artifacts, image), fullPage: true, scale: 'css' });
      report.layouts.push({ phase, ...scenario, image, metrics });
      await fs.writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    }
    for (const scenario of scenarios) await capture('setup-partial-depth', scenario);

    report.serviceBeforeSynthetic = await page.evaluate(() => window.encoder.getSnapshot());
    const longName = `Long العربية & [preserved] ${'unbrokenfilename'.repeat(11)} final source.mkv`;
    let revision = 1_000_000;
    for (const knownDuration of [true, false]) {
      const snapshot = {
        revision: revision++, batchId: 'synthetic-layout-batch', planId: 'synthetic-layout-plan', phase: 'running',
        settings: { profileId: 'av1-cpu', preset: '9', quality: 33 },
        items: [
          { id: 'synthetic-current', name: longName, outputName: `${longName.slice(0, -4)}_AV1-CPU.mkv`, status: 'running', reason: null, summary: { width: 1920, height: 1080, bitDepth: 10, duration: knownDuration ? 120 : null, classification: 'sdr' } },
          { id: 'synthetic-next', name: 'Second queued source.mkv', outputName: 'Second queued source_AV1-CPU.mkv', status: 'pending', reason: null },
        ],
        counts: { success: 0, failed: 0, skipped: 0, cancelled: 0, unprocessed: 2 },
        progress: { fileId: 'synthetic-current', seconds: 45, percent: knownDuration ? 37.5 : null, etaSeconds: knownDuration ? 75 : null, fps: 123.4, speed: 1.25, bytes: 987654321 },
        elapsedSeconds: 36, error: null,
      };
      await app.evaluate(({ BrowserWindow }, state) => {
        BrowserWindow.getAllWindows()[0].webContents.send('encoder:update', state);
      }, snapshot);
      await page.waitForFunction((expected) => document.querySelector('#percent').textContent === expected,
        knownDuration ? '37.5%' : 'In progress');
      assert.equal(await page.textContent('#current-file'), longName);
      assert.match(await page.textContent('#monitor-settings'), /AV1 · CPU · preset 9 · CRF 33/);
      assert.match(await page.textContent('#effective-settings'), /preset 9 · CRF 33/);
      assert.equal(await page.locator('#encode-progress').getAttribute('value'), knownDuration ? '37.5' : null);
      assert.equal(await page.textContent('#eta'), knownDuration ? '01:15' : '—');
      assert.equal(await page.textContent('#monitor-count'), 'File 1 of 2');
      // Since the October 11 workbench, the monitor lives in Current Jobs.
      await page.click('#tab-jobs');
      assert.equal(await page.isVisible('#monitor-panel'), true);
      const phase = knownDuration ? 'monitor-determinate' : 'monitor-unknown';
      for (const scenario of scenarios) await capture(phase, scenario);
      report.checks.push(`${phase}: synthetic long filename, effective settings, progress semantics, and five viewport/DPR layouts passed.`);
    }
    const actualState = await page.evaluate(() => window.encoder.getSnapshot());
    report.serviceAfterSynthetic = actualState;
    assert.equal(actualState.phase, 'idle');
    // Startup capabilities retain their operation identifier after settling.
    // Compare authoritative state before/after instead of assuming no ID exists;
    // elapsedSeconds is a computed display clock and can legitimately advance.
    const { elapsedSeconds: beforeElapsed, ...before } = report.serviceBeforeSynthetic;
    const { elapsedSeconds: afterElapsed, ...after } = actualState;
    assert.deepEqual(after, before);
    assert.deepEqual(actualState.items, []);
    report.checks.push('Production service stayed idle and unchanged, with no media items: synthetic monitor events exercised presentation only.');
    assert.deepEqual(report.errors, []);
    report.status = 'passed';
  } catch (error) {
    report.status = 'failed';
    report.failure = { message: error.message, stack: error.stack };
    if (page && !page.isClosed()) await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
    throw error;
  } finally {
    await cdp?.send('Emulation.clearDeviceMetricsOverride').catch(() => {});
    await app.close();
    report.closed = true;
    report.finishedAtUtc = new Date().toISOString();
    await fs.writeFile(path.join(artifacts, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ artifacts, status: report.status, layouts: report.layouts.length, closed: report.closed }));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
