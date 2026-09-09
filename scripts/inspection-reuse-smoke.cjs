'use strict';

// J endpoint acceptance: real Electron, IPC, renderer, shipped tools and cache.
// Only picker returns and the completed-recording discovery allowlist are injected.
// No source media is created, copied, linked, renamed, overwritten or deleted.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { _electron } = require('playwright');
const { readFileStamp } = require('../src/source-identity.cjs');

const INPUT = 'F:\\shadow play\\OBS';
const LAST_COMPLETED = '2026-09-08 17-45-06';
const EXCLUDED_ACTIVE = '2026-09-08 19-02-39.mkv';
const EXPECTED_FILES = 60;
const WARM_TARGET_MS = 8000;
const completedName = name => name !== EXCLUDED_ACTIVE
  && /^\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\.(mkv|mp4|mov|avi|webm)$/i.test(name)
  && name.slice(0, 19) <= LAST_COMPLETED;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts', `inspection-reuse-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`);
  const output = path.join(artifacts, 'output');
  const userData = path.join(artifacts, 'user-data');
  await fs.mkdir(output, { recursive: true });
  const report = {
    time: new Date().toISOString(), artifacts, input: INPUT, output, userData,
    discovery: { injected: true, lastCompleted: LAST_COMPLETED, explicitlyExcludedBeforeStatOrOpen: EXCLUDED_ACTIVE },
    warmTargetMs: WARM_TARGET_MS, sessions: [], runs: [], errors: [], checks: [],
    limitations: [
      'Native folder picker returns are substituted; this harness does not verify OS picker interaction.',
      'Main fs.promises.readdir is filtered only for the input directory, using its real entries and the completed-file allowlist. All media inspection, storage eligibility, source identity, caching, planning, IPC and rendering are real.',
      'Cold means an empty application inspection cache; operating-system and HDD caches are not flushed. Timing is on this machine with the archive and current background load.',
      'Source preservation is checked by bigint identity stamps before/after and sparse identities across plans, not full-file hashing or protection against deliberately concealed writes.',
      'No encoding is requested. The separate standard application smoke covers real encode, validation and full output decoding. This harness alone does not complete milestone J or portable acceptance.',
    ],
  };
  const saveReport = () => fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  let app;
  let page;
  let names;
  const stamps = async () => {
    const rows = [];
    // Only the previously selected names are resolved/stat'ed. Never inspect an
    // excluded name to decide whether it is finished or safe to include.
    for (const name of names) rows.push({ name, stamp: await readFileStamp(path.join(INPUT, name)) });
    return rows;
  };

  const launch = async label => {
    const started = performance.now();
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${userData}`], cwd: root, env });
    page = await app.firstWindow();
    page.on('pageerror', error => report.errors.push({ label, message: error.message }));
    await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 90000 });
    const capabilityReadyMs = performance.now() - started;
    const capabilities = await page.evaluate(() => window.encoder.getCapabilities());
    report.sessions.push({ label, pid: await app.evaluate(() => process.pid), launchThroughCapabilitiesAndUiMs: capabilityReadyMs, capabilities });

    await app.evaluate((_electron, config) => {
      const require = process.getBuiltinModule('module').createRequire(config.modulePath);
      const fs = require('node:fs/promises');
      const path = require('node:path');
      const { createHash } = require('node:crypto');
      const { EncoderService } = require(config.modulePath);
      const { buildEncodeArgs } = require(path.join(path.dirname(config.modulePath), 'media.cjs'));
      const allowed = new Set(config.names);
      const normalizedInput = path.resolve(config.input).toLowerCase();
      const readdir = fs.readdir;
      const harness = globalThis.__inspectionHarness = { current: null, service: null, discoveryCalls: 0 };
      fs.readdir = async function (directory, ...args) {
        const result = await readdir.call(this, directory, ...args);
        if (typeof directory !== 'string' || path.resolve(directory).toLowerCase() !== normalizedInput) return result;
        globalThis.__inspectionHarness.discoveryCalls++;
        return result.filter(entry => allowed.has(typeof entry === 'string' ? entry : entry.name));
      };
      const canonical = value => Array.isArray(value) ? value.map(canonical)
        : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
      const initialize = EncoderService.prototype.initializeInspectionCache;
      EncoderService.prototype.initializeInspectionCache = function (...args) {
        const harness = globalThis.__inspectionHarness;
        harness.service = this;
        if (!this.__inspectionObserved) {
          const observe = run => (executable, argv, options = {}) => {
            const metrics = harness.current;
            if (!metrics) return run(executable, argv, options);
            const isProbe = path.basename(executable).toLowerCase() === 'ffprobe.exe';
            const inputIndex = argv.indexOf('-i');
            const file = inputIndex >= 0 ? argv[inputIndex + 1] : null;
            if (isProbe && (!file || path.dirname(file).toLowerCase() !== normalizedInput || !allowed.has(path.basename(file)))) {
              throw new Error('The harness blocked a media probe outside its completed-recording allowlist.');
            }
            const call = { executable, argv: [...argv], kind: isProbe ? argv.includes('-show_frames') ? 'frames' : 'metadata' : 'storage-helper', name: file ? path.basename(file) : null, startedAt: Date.now(), pid: null, closedAt: null };
            metrics.calls.push(call);
            // Delegate to the actual runner unchanged except an observational
            // onChild callback. Ownership ends at the child's close event.
            return run(executable, argv, { ...options, onChild: child => {
              call.pid = child.pid;
              metrics.activeChildren++;
              metrics.maxActiveChildren = Math.max(metrics.maxActiveChildren, metrics.activeChildren);
              if (isProbe) {
                metrics.activeProbeChildren++;
                metrics.maxActiveProbeChildren = Math.max(metrics.maxActiveProbeChildren, metrics.activeProbeChildren);
              }
              child.once('close', () => {
                call.closedAt = Date.now(); metrics.activeChildren--;
                if (isProbe) metrics.activeProbeChildren--;
              });
              options.onChild?.(child);
            } });
          };
          this.run = observe(this.run);
          this.storageEligibility.run = observe(this.storageEligibility.run);
          this.on('update', state => {
            if (harness.current && state.preparation) harness.current.progress.push({ revision: state.revision, phase: state.phase, elapsedSeconds: state.elapsedSeconds, ...state.preparation });
          });
          this.__inspectionObserved = true;
        }
        return initialize.apply(this, args);
      };
      harness.start = label => { harness.current = { label, calls: [], progress: [], activeChildren: 0, activeProbeChildren: 0, maxActiveChildren: 0, maxActiveProbeChildren: 0 }; };
      harness.result = () => {
        const service = harness.service;
        const rows = service.state.items.map(item => {
          const entry = service.plan?.entries.get(item.id);
          return { name: item.name, outputName: item.outputName, status: item.status, reason: item.reason, summary: item.summary || null,
            inspectionSha256: entry ? digest(entry.inspection) : null,
            identitySha256: entry ? digest(entry.fingerprint) : null,
            commandSha256: entry ? digest(buildEncodeArgs({ input: entry.file, output: entry.destination, settings: service.plan.settings, probe: entry.inspection.probe, colorEvidence: entry.inspection.color })) : null };
        });
        return { ...harness.current, discoveryCalls: harness.discoveryCalls, planId: service.plan?.id, planRows: rows, planSha256: digest(rows), snapshot: service.snapshot(), cacheStats: service.inspectionCache?.stats };
      };
    }, { modulePath: path.join(root, 'src/encoder-service.cjs'), input: INPUT, names });

    await page.evaluate(() => {
      const visible = id => Boolean(document.getElementById(id)?.getClientRects().length);
      window.__inspectionUi = null;
      document.getElementById('prepare-batch').addEventListener('click', () => {
        window.__inspectionUi = { started: performance.now(), readyMs: null, observations: [] };
      }, { capture: true });
      window.encoder.onUpdate(state => {
        const record = window.__inspectionUi;
        if (!record) return;
        if (state.phase === 'ready' && record.readyMs === null) record.readyMs = performance.now() - record.started;
        if (state.phase !== 'preparing' || !state.preparation) return;
        const p = state.preparation;
        record.observations.push({ revision: state.revision, stage: p.stage, window: p.window || null, total: p.total, resolved: p.resolved, reused: p.reused, active: p.active,
          activity: document.getElementById('activity-message').textContent,
          stageText: document.getElementById('inspection-stage').textContent,
          percent: document.getElementById('percent').textContent,
          progressValue: Number(document.getElementById('encode-progress').value),
          monitorVisible: visible('monitor-panel'),
          controls: ['choose-input', 'choose-output', 'profile', 'preset', 'quality', 'quality-slider', 'prepare-batch'].map(id => ({ id, visible: visible(id), disabled: document.getElementById(id).disabled })) });
      });
    });
    await app.evaluate(({ dialog }, folders) => { let index = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folders[index++]] }); }, [INPUT, output]);
    await page.click('#choose-input'); await page.click('#choose-output');
    await page.selectOption('#profile', 'h265-cpu');
  };

  const prepare = async (label, captureProgress = false) => {
    await app.evaluate((_electron, name) => globalThis.__inspectionHarness.start(name), label);
    await page.click('#prepare-batch');
    const deadline = Date.now() + 15 * 60 * 1000;
    let captured = false;
    let nextLog = Date.now();
    while (true) {
      const snapshot = await page.evaluate(() => window.encoder.getSnapshot());
      if (snapshot.phase !== 'preparing') {
        assert.equal(snapshot.phase, 'ready', JSON.stringify(snapshot));
        break;
      }
      if (Date.now() > deadline) throw new Error(`${label} did not finish within 15 minutes.`);
      if (Date.now() >= nextLog) {
        console.log(JSON.stringify({ event: 'preparing', label, elapsedSeconds: snapshot.elapsedSeconds, progress: snapshot.preparation }));
        nextLog = Date.now() + 20000;
      }
      if (captureProgress && !captured && snapshot.preparation?.stage === 'frames') {
        await page.locator('#setup-panel').screenshot({ path: path.join(artifacts, `${label}-locked-controls.png`) });
        await page.locator('#monitor-panel').screenshot({ path: path.join(artifacts, `${label}-inspection-progress.png`) });
        captured = true;
      }
      await pause(75);
    }
    // End timing at the ready update in the real renderer. Screenshot/report
    // serialization and this poll interval are outside the measured endpoint.
    const result = await app.evaluate(() => globalThis.__inspectionHarness.result());
    result.ui = await page.evaluate(() => window.__inspectionUi);
    result.uiPreparationMs = result.ui.readyMs;
    result.mediaProbeCalls = result.calls.filter(call => ['metadata', 'frames'].includes(call.kind)).length;
    result.metadataCalls = result.calls.filter(call => call.kind === 'metadata').length;
    result.frameCalls = result.calls.filter(call => call.kind === 'frames').length;
    result.storageHelperCalls = result.calls.filter(call => call.kind === 'storage-helper').length;
    result.withinWarmTarget = result.uiPreparationMs <= WARM_TARGET_MS;
    report.runs.push(result);
    await saveReport();
    await page.screenshot({ path: path.join(artifacts, `${label}-ready.png`), fullPage: false });
    console.log(JSON.stringify({ event: 'prepared', label, ms: result.uiPreparationMs, mediaProbeCalls: result.mediaProbeCalls, maxActiveChildren: result.maxActiveChildren, preparation: result.snapshot.preparation, planSha256: result.planSha256 }));
    return result;
  };

  try {
    // Names-only discovery precedes any source stat/open. A freshly recorded or
    // differently named item cannot enter this fixture based on file size.
    const directoryNames = await fs.readdir(INPUT);
    names = directoryNames.filter(completedName).sort((a, b) => a.localeCompare(b, 'en', { numeric: false }) || a.localeCompare(b));
    assert.equal(names.length, EXPECTED_FILES, 'The completed-recording fixture changed; review the explicit allowlist before running.');
    assert.equal(names.includes(EXCLUDED_ACTIVE), false);
    report.discovery.names = names;
    report.discovery.totalDirectoryNames = directoryNames.length;
    report.sourceBefore = await stamps();
    report.runtimeHashes = {};
    for (const relative of ['ffmpeg/ffmpeg.exe', 'ffmpeg/ffprobe.exe', 'src/encoder-service.cjs', 'src/inspection.cjs', 'src/inspection-cache.cjs', 'src/source-identity.cjs', 'src/storage-eligibility.cjs', 'ui/renderer.js']) {
      report.runtimeHashes[relative] = createHash('sha256').update(await fs.readFile(path.join(root, relative))).digest('hex');
    }
    await saveReport();
    console.log(JSON.stringify({ event: 'start', artifacts, completedFiles: names.length, excludedActive: EXCLUDED_ACTIVE }));
    await launch('initial');
    const cold = await prepare('cold', true);
    const warm = await prepare('warm');
    await app.close(); app = null; page = null;
    report.cacheFilesAfterClose = (await fs.readdir(path.join(userData, 'cache', 'inspection-v1'))).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
    await launch('restarted');
    const restart = await prepare('restart');
    await app.close(); app = null; page = null;
    report.sourceAfter = await stamps();
    report.outputFiles = await fs.readdir(output);
    assert.deepEqual(report.sourceAfter, report.sourceBefore, 'A completed source changed during acceptance.');
    assert.deepEqual(report.outputFiles, []);
    assert.deepEqual(report.errors, []);
    assert.equal(report.sessions[0].pid === report.sessions[1].pid, false);
    assert.equal(report.cacheFilesAfterClose.length, EXPECTED_FILES);
    assert.equal(cold.snapshot.preparation.inspected, EXPECTED_FILES);
    assert.equal(cold.snapshot.preparation.reused, 0);
    assert.equal(cold.metadataCalls, EXPECTED_FILES);
    assert.ok(cold.frameCalls > 0);
    assert.equal(cold.maxActiveProbeChildren, 2);
    assert.notEqual(cold.planId, warm.planId);
    assert.notEqual(warm.planId, restart.planId);
    for (const run of report.runs) {
      assert.deepEqual(run.snapshot.items.map(item => item.name), names);
      assert.equal(run.snapshot.preparation.resolved, EXPECTED_FILES);
      assert.equal(run.snapshot.preparation.active, 0);
      assert.equal(run.activeChildren, 0);
      assert.ok(run.maxActiveChildren <= 2);
      assert.ok(run.calls.every(call => Number.isInteger(call.pid) && call.closedAt !== null));
      assert.ok(run.ui.observations.length > 0);
      for (const sample of run.ui.observations) {
        assert.ok(sample.controls.every(control => control.visible && control.disabled), `${run.label}: setup controls must stay visible and locked.`);
        assert.ok(sample.monitorVisible);
        assert.ok(Math.abs(sample.progressValue - sample.resolved / sample.total * 100) < 0.001);
      }
    }
    for (const run of [warm, restart]) {
      assert.equal(run.snapshot.preparation.reused, EXPECTED_FILES);
      assert.equal(run.snapshot.preparation.inspected, 0);
      assert.equal(run.mediaProbeCalls, 0);
      assert.equal(run.planSha256, cold.planSha256, 'Inspection evidence, identities, effective plans and displayed classifications differ.');
    }
    assert.ok(cold.ui.observations.some(sample => sample.stage === 'metadata'));
    assert.ok(cold.ui.observations.some(sample => sample.stage === 'frames'));
    assert.ok(warm.ui.observations.some(sample => sample.stage === 'reused'));
    report.checks = ['60 allowlisted completed archive files stayed stable and the isolated output remained empty', 'Cold inspection used two real owned ffprobe children at maximum; all children closed', 'Warm and fresh-process restart reused 60 records with zero media-inspection ffprobe launches', 'Normalized inspection, source identity, displayed classification and effective command hashes match across newly issued plans', 'Real renderer progress uses resolved-file percentage; setup controls remain visible and disabled during inspection', 'Capability/startup time measured separately from click-to-ready preparation'];
    report.status = 'passed';
    report.performanceTargetMet = warm.withinWarmTarget && restart.withinWarmTarget;
  } catch (error) {
    report.status = 'failed'; report.failure = { message: error.message, stack: error.stack };
    if (page && !page.isClosed()) {
      report.failureUi = await page.evaluate(async () => ({ text: document.body.innerText, snapshot: await window.encoder.getSnapshot() })).catch(() => null);
      await page.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {});
    }
    throw error;
  } finally {
    if (page && !page.isClosed()) await page.evaluate(async () => {
      const state = await window.encoder.getSnapshot();
      if (['preparing', 'running', 'checking', 'cancelling'].includes(state.phase) && state.batchId) await window.encoder.cancelBatch({ batchId: state.batchId });
    }).catch(() => {});
    if (app) await app.close().catch(() => {});
    if (names && report.sourceBefore && !report.sourceAfter) report.sourceAfter = await stamps().catch(error => ({ error: error.message }));
    await saveReport();
    console.log(JSON.stringify({ event: 'finished', status: report.status, performanceTargetMet: report.performanceTargetMet, report: path.join(artifacts, 'report.json') }));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
