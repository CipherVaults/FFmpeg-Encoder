'use strict';

// Real Electron/FFmpeg lifecycle verification using generated media. Dialog
// decisions are substituted at the native boundary; process ownership and exit
// are observed from Windows, never inferred from a finished-looking progress UI.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');

const execute = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = path.resolve(__dirname, '..');
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const artifacts = path.join(root, 'artifacts', `lifecycle-smoke-${Date.now()}`);
const input = path.join(artifacts, 'input');
const report = { time: new Date().toISOString(), artifacts, checks: [], cases: [], limitations: [
  'Native picker return and close-dialog choices are substituted; real Windows dialog interaction is not covered.',
  'Tests exercise application-owned encode cancellation; abrupt OS termination of the entire machine/process tree is not simulated.',
] };

async function windowsProcesses(field, processId) {
  assert.ok(['ParentProcessId', 'ProcessId'].includes(field));
  assert.ok(Number.isSafeInteger(processId) && processId > 0);
  // Only a validated numeric PID is interpolated. This is read-only process
  // inspection; there is no process-name kill or unrelated-process mutation.
  const script = `$ErrorActionPreference='Stop'; $rows=@(Get-CimInstance Win32_Process -Filter '${field} = ${processId}' | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CreationDate,CommandLine); ConvertTo-Json -InputObject $rows -Compress`;
  const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
  return JSON.parse(stdout || '[]');
}

async function assertChildGone(child) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const same = (await windowsProcesses('ProcessId', child.ProcessId))
      .find(item => item.CreationDate === child.CreationDate && item.ExecutablePath === child.ExecutablePath);
    if (!same) return;
    await wait(100);
  }
  throw new Error(`Owned FFmpeg child ${child.ProcessId} still exists after cancellation settled.`);
}

async function snapshotUntil(page, predicate, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let snapshot;
  while (Date.now() < deadline) {
    snapshot = await page.evaluate(() => window.encoder.getSnapshot());
    if (predicate(snapshot)) return snapshot;
    await wait(100);
  }
  throw new Error(`Timed out waiting for snapshot: ${JSON.stringify(snapshot)}`);
}

async function ownedEncodeChild(app) {
  // On Windows Playwright's process() can be the Electron launch trampoline,
  // whose child is the actual main process that owns FFmpeg.
  const mainPid = await app.evaluate(() => process.pid);
  const deadline = Date.now() + 15000;
  let lastChildren = [];
  while (Date.now() < deadline) {
    const children = await windowsProcesses('ParentProcessId', mainPid);
    lastChildren = children;
    const matches = children.filter(child => child.ExecutablePath?.toLowerCase() === ffmpeg.toLowerCase()
      && child.CommandLine?.includes('-progress') && child.CommandLine?.includes(artifacts));
    assert.ok(matches.length <= 1, 'More than one encode child is active.');
    if (matches.length) return matches[0];
    await wait(100);
  }
  report.processObservationFailure = { mainPid, ffmpeg, lastChildren };
  throw new Error('No live app-owned FFmpeg encode child was observed.');
}

async function launch(label) {
  const output = path.join(artifacts, label, 'output');
  await fs.mkdir(output, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, `--user-data-dir=${path.join(artifacts, label, 'user-data')}`], cwd: root, env,
    timeout: 60000,
  });
  const child = app.process();
  const exitPromise = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  const page = await app.firstWindow();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 120000 });
  await page.evaluate(() => {
    window.__lifecycleEvents = [];
    window.encoder.onUpdate(snapshot => window.__lifecycleEvents.push({ phase: snapshot.phase, batchId: snapshot.batchId, items: snapshot.items.map(item => ({ id: item.id, name: item.name, status: item.status })) }));
  });
  await app.evaluate(({ dialog }, folders) => {
    let index = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folders[index++]] });
    globalThis.__lifecycleDialogs = [];
  }, [input, output]);
  await page.click('#choose-input'); await page.click('#choose-output');
  await page.selectOption('#profile', 'h265-cpu');
  await page.selectOption('#preset', 'veryslow');
  await page.fill('#quality', '25');
  return { app, page, output, errors, exitPromise, mainPid: await app.evaluate(() => process.pid), launcherPid: child.pid, label };
}

async function prepareAndStart(context) {
  const { page, app } = context;
  await page.click('#prepare-batch');
  const ready = await snapshotUntil(page, state => ['ready', 'failed', 'cancelled'].includes(state.phase));
  assert.equal(ready.phase, 'ready', JSON.stringify(ready));
  assert.deepEqual(ready.items.map(item => item.status), ['ready', 'ready']);
  await page.click('#start-batch');
  const running = await snapshotUntil(page, state => state.phase === 'running' && state.items[0]?.status === 'running');
  const encodeChild = await ownedEncodeChild(app);
  assert.equal((await page.evaluate(() => window.encoder.getSnapshot())).phase, 'running', 'Fixture ended before lifecycle action.');
  return { running, encodeChild };
}

async function substituteCloseChoice(app, choice) {
  await app.evaluate(({ dialog }, response) => {
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__lifecycleDialogs.push(options);
      return { response };
    };
  }, choice);
}

async function closedWithin(context) {
  const outcome = await Promise.race([
    context.exitPromise,
    wait(15000).then(() => { throw new Error(`${context.label}: application did not exit after cleanup.`); }),
  ]);
  assert.equal(outcome.code, 0, JSON.stringify(outcome));
  return outcome;
}

async function safeCleanup(context) {
  if (!context) return;
  if (!context.page.isClosed()) {
    await context.page.evaluate(async () => {
      const state = await window.encoder.getSnapshot();
      if (state.batchId) await window.encoder.cancelBatch({ batchId: state.batchId });
    }).catch(() => {});
  }
  // Playwright owns this exact app instance. No unrelated process is targeted.
  await context.app.close().catch(() => {});
}

async function keepOpenCancelAndRestart() {
  let context;
  try {
    context = await launch('keep-open-cancel-restart');
    const { app, page, output } = context;
    const first = await prepareAndStart(context);
    await substituteCloseChoice(app, 0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close());
    await page.waitForTimeout(250);
    assert.equal(page.isClosed(), false);
    const prompts = await app.evaluate(() => globalThis.__lifecycleDialogs);
    assert.equal(prompts.length, 1);
    assert.deepEqual(prompts[0].buttons, ['Keep application open', 'Cancel encoding and exit']);
    assert.equal(prompts[0].defaultId, 0); assert.equal(prompts[0].cancelId, 0);
    assert.equal((await page.evaluate(() => window.encoder.getSnapshot())).phase, 'running');
    assert.equal((await ownedEncodeChild(app)).ProcessId, first.encodeChild.ProcessId);
    await page.screenshot({ path: path.join(artifacts, 'keep-open-active.png'), fullPage: true });
    report.checks.push('Keep application open preserves the real window and same active FFmpeg PID');

    await page.click('#cancel-batch');
    const cancelled = await snapshotUntil(page, state => state.phase === 'cancelled');
    assert.equal(cancelled.items[0].status, 'cancelled', JSON.stringify(cancelled));
    assert.equal(cancelled.items[1].status, 'unprocessed', JSON.stringify(cancelled));
    await assertChildGone(first.encodeChild);
    assert.deepEqual(await fs.readdir(output), [], 'Owned temporary output remains after cancellation.');
    const events = await page.evaluate(() => window.__lifecycleEvents);
    assert.equal(events.some(event => event.items.some(item => item.name === 'B lifecycle.mp4' && item.status === 'running')), false);
    assert.equal(cancelled.counts.success, 0);
    await page.screenshot({ path: path.join(artifacts, 'cancelled-results.png'), fullPage: true });
    report.checks.push('UI cancellation awaits owned child exit and temporary cleanup; second queued input never starts');

    await page.click('#new-batch');
    const second = await prepareAndStart(context);
    assert.notEqual(second.running.batchId, first.running.batchId);
    await page.click('#cancel-batch');
    await snapshotUntil(page, state => state.phase === 'cancelled');
    await assertChildGone(second.encodeChild);
    assert.deepEqual(await fs.readdir(output), []);
    report.checks.push('New batch after cancellation prepares and starts a distinct batch, then cancels cleanly');
    assert.deepEqual(context.errors, []);
    report.cases.push({ label: context.label, mainPid: context.mainPid, encodeChildren: [first.encodeChild, second.encodeChild], cancelled, prompts, errors: context.errors });
  } finally { await safeCleanup(context); }
}

async function closeAndExit() {
  let context;
  try {
    context = await launch('cancel-and-exit');
    const { app, page, output } = context;
    const active = await prepareAndStart(context);
    await substituteCloseChoice(app, 1);
    await app.evaluate(({ BrowserWindow }) => {
      // Schedule after evaluate responds so destruction does not hide a genuine
      // action error behind a broadly swallowed target-closed exception.
      setTimeout(() => BrowserWindow.getAllWindows()[0].close(), 25);
    });
    const exit = await closedWithin(context);
    await assertChildGone(active.encodeChild);
    assert.deepEqual(await fs.readdir(output), []);
    assert.equal(page.isClosed(), true);
    report.checks.push('Cancel encoding and exit closes the app only with no remaining owned FFmpeg child or temporary output');
    report.cases.push({ label: context.label, mainPid: context.mainPid, encodeChild: active.encodeChild, exit });
  } finally { await safeCleanup(context); }
}

async function rendererCrash() {
  let context;
  try {
    context = await launch('renderer-crash');
    const { app, output } = context;
    const active = await prepareAndStart(context);
    await app.evaluate(({ BrowserWindow }) => {
      setTimeout(() => BrowserWindow.getAllWindows()[0].webContents.forcefullyCrashRenderer(), 25);
    });
    const exit = await closedWithin(context);
    await assertChildGone(active.encodeChild);
    assert.deepEqual(await fs.readdir(output), []);
    report.checks.push('Forced renderer crash cancels real app-owned FFmpeg, cleans temporary output and exits without background encoding');
    report.cases.push({ label: context.label, mainPid: context.mainPid, encodeChild: active.encodeChild, exit });
  } finally { await safeCleanup(context); }
}

async function main() {
  if (process.platform !== 'win32') throw new Error('This lifecycle suite uses Windows process identity evidence.');
  await fs.mkdir(input, { recursive: true });
  await runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1920x1080:rate=24:duration=12,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited', '-f', 'lavfi', '-i', 'sine=duration=12', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '25', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-n', path.join(input, 'A lifecycle.mp4')], { timeoutMs: 120000 });
  await fs.copyFile(path.join(input, 'A lifecycle.mp4'), path.join(input, 'B lifecycle.mp4'));
  try {
    await keepOpenCancelAndRestart();
    await closeAndExit();
    await rendererCrash();
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.error = { message: error.message, stack: error.stack };
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
