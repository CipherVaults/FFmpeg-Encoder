const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts', `app-smoke-${Date.now()}`);
  const input = path.join(artifacts, 'input');
  const output = path.join(artifacts, 'output');
  await fs.mkdir(input, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const ffmpeg = path.join(root, 'ffmpeg/ffmpeg.exe');
  await runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=2,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited', '-f', 'lavfi', '-i', 'sine=duration=2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-n', path.join(input, 'A fixture.mp4')]);
  await fs.copyFile(path.join(input, 'A fixture.mp4'), path.join(input, 'B fixture.mp4'));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${path.join(artifacts, 'user-data')}`], cwd: root, env });
  const errors = [];
  const checks = [];
  let page;
  const waitSnapshot = async (predicate, timeout = 60000) => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.encoder.getSnapshot());
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Timed out waiting for the application state.');
  };
  try {
    page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 60000 });
    const boundary = await page.evaluate(() => ({ requireType: typeof require, processType: typeof process, bridge: Object.keys(window.encoder).sort() }));
    assert.equal(boundary.requireType, 'undefined');
    assert.equal(boundary.processType, 'undefined');
    assert.equal(boundary.bridge.includes('send'), false);
    assert.deepEqual([...boundary.bridge].sort(), ['getCapabilities', 'chooseInputFolder', 'chooseOutputFolder', 'prepareBatch', 'treatAsOriginal', 'startBatch', 'cancelBatch', 'getSnapshot', 'onUpdate'].sort());
    checks.push('renderer has no Node globals and exposes only the named bridge methods');
    const prefs = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    assert.equal(prefs.sandbox, true); assert.equal(prefs.contextIsolation, true); assert.equal(prefs.nodeIntegration, false);
    checks.push('Electron confirms sandbox, isolation and disabled Node integration');
    const invalid = await page.evaluate(async () => {
      try { await window.encoder.prepareBatch({ inputPath: 'C:\\', command: 'calc.exe' }); return 'accepted'; }
      catch (error) { return error.message; }
    });
    assert.match(invalid, /Expected only/);
    checks.push('unexpected privileged payload rejected');
    await app.evaluate(({ dialog }, folders) => { let index = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folders[index++]] }); }, [input, output]);
    await page.click('#choose-input'); await page.click('#choose-output');
    await page.screenshot({ path: path.join(artifacts, 'setup.png'), fullPage: true });
    await page.click('#prepare-batch');
    await waitSnapshot(state => state.phase === 'ready');
    let snapshot = await page.evaluate(() => window.encoder.getSnapshot());
    assert.deepEqual(snapshot.items.map(item => item.status), ['ready', 'ready'], JSON.stringify(snapshot));
    await page.click('#start-batch');
    await waitSnapshot(state => ['completed', 'failed'].includes(state.phase));
    snapshot = await page.evaluate(() => window.encoder.getSnapshot());
    assert.equal(snapshot.counts.success, 2, JSON.stringify(snapshot));
    checks.push('two inputs inspected, queued sequentially, encoded, validated and published');
    await page.screenshot({ path: path.join(artifacts, 'results.png'), fullPage: true });
    const outputs = (await fs.readdir(output)).sort();
    for (const name of outputs) await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', path.join(output, name), '-f', 'null', '-']);
    checks.push('both published files decode without errors');
    await page.click('#new-batch'); await page.click('#prepare-batch');
    await waitSnapshot(state => state.phase === 'ready');
    const skips = await page.evaluate(() => window.encoder.getSnapshot());
    assert.deepEqual(skips.items.map(item => item.status), ['skipped', 'skipped']);
    checks.push('new batch flow skips both existing outputs');
    assert.deepEqual(errors, []);
    const report = { time: new Date().toISOString(), artifacts, checks, boundary, snapshot, outputs, errors, limitations: ['Native picker return is substituted; OS picker interaction still needs separate verification.', 'Lifecycle races and broader media fixtures are separate suites.'] };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    if (page) {
      console.error(await page.evaluate(async () => ({ text: document.body.innerText, snapshot: await window.encoder?.getSnapshot() })));
      await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true });
    }
    throw error;
  } finally {
    if (page && !page.isClosed()) await page.evaluate(async () => { const state = await window.encoder?.getSnapshot(); if (state?.batchId) await window.encoder.cancelBatch({ batchId: state.batchId }); }).catch(() => {});
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
