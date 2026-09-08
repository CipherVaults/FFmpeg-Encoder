'use strict';

// Acceptance runs the extracted executable, not the development entry point.
// The harness needs Node/Playwright; the child application's deliberately small
// PATH and its bundled resource identity prove it does not need either on PATH.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { createServer } = require('node:http');
const { promisify } = require('node:util');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');
const { hashFile } = require('./build-portable.cjs');
const execute = promisify(execFile);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const root = path.resolve(__dirname, '..');
  const reportPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
  await fs.mkdir(path.join(root, 'artifacts'), { recursive: true });
  const artifacts = await fs.mkdtemp(path.join(root, 'artifacts', 'portable-acceptance-'));
  const extracted = path.join(artifacts, 'Extracted العربية folder');
  const alternateCwd = path.join(artifacts, 'alternate working directory');
  const input = path.join(artifacts, 'input');
  const output = path.join(artifacts, 'output');
  const cancelInput = path.join(artifacts, 'cancel input');
  const cancelOutput = path.join(artifacts, 'cancel output');
  const restartOutput = path.join(artifacts, 'restart output');
  const sevenZip = 'C:\\Program Files\\7-Zip\\7z.exe';
  const executable = path.join(extracted, 'FFmpeg Encoder.exe');
  const ffmpeg = path.join(extracted, 'resources', 'ffmpeg', 'ffmpeg.exe');
  const ffprobe = path.join(extracted, 'resources', 'ffmpeg', 'ffprobe.exe');
  const report = { time: new Date().toISOString(), status: 'running', artifacts, buildReport: reportPath, zip: null, extracted, launchAttempted: false, closed: null, checks: [], cases: [], errors: [], cleanupErrors: [], protectedFiles: [], limitations: [
    'Same-machine portable extraction; no claim of independent clean-machine or other GPU compatibility.',
    'Native dialog returns are substituted in this harness. Real Windows folder selection has separate H evidence.',
    'Offline acceptance uses verified unreachable-proxy/resolver restrictions in Electron sessions/processes, not physical disconnection or a machine firewall change; it does not sandbox hypothetical main-process Node sockets.',
    'Playwright debugging attaches only for verification. The distributed application has no automation workflow or background encoding feature.',
  ] };
  let app;
  let page;
  let mainProcess;
  let networkControl;
  let failure;
  const ownedMedia = new Map();
  const matchesProcess = (row, record) => row.ProcessId === record.ProcessId
    && row.CreationDate === record.CreationDate
    && row.ExecutablePath?.toLowerCase() === record.ExecutablePath?.toLowerCase();
  const isOwnedMedia = row => [ffmpeg.toLowerCase(), ffprobe.toLowerCase()].includes(row.ExecutablePath?.toLowerCase());
  const protect = async (file, role) => report.protectedFiles.push({ path: file, role, ...await hashFile(file) });
  const verifyProtected = async () => {
    for (const entry of report.protectedFiles) {
      assert.deepEqual(await hashFile(entry.path), { sizeBytes: entry.sizeBytes, sha256: entry.sha256 }, `Protected file changed: ${entry.path}`);
    }
  };
  async function inventory(directory, relative = '') {
    const files = [];
    for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
      const child = path.posix.join(relative, entry.name);
      if (entry.isDirectory()) files.push(...await inventory(directory, child));
      else { assert(entry.isFile(), `Unexpected link or non-regular extracted entry: ${child}`); files.push(child); }
    }
    return files.sort();
  }
  async function stateUntil(predicate, timeout = 120000) {
    const deadline = Date.now() + timeout;
    let state;
    while (Date.now() < deadline) { state = await page.evaluate(() => window.encoder.getSnapshot()); if (predicate(state)) return state; await wait(75); }
    throw Error(`Timed out waiting for portable state: ${JSON.stringify(state)}`);
  }
  const processRows = async (field, id) => {
    assert(['ParentProcessId', 'ProcessId'].includes(field) && Number.isSafeInteger(id) && id > 0);
    // Windows PowerShell's redirected output otherwise uses a legacy code page,
    // corrupting Unicode paths and making exact process identity comparisons fail.
    const command = `[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $rows=@(Get-CimInstance Win32_Process -Filter '${field} = ${id}' | Select-Object ProcessId,ParentProcessId,ExecutablePath,CreationDate,CommandLine); ConvertTo-Json -InputObject $rows -Compress`;
    const { stdout } = await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', command], { windowsHide: true, timeout: 15000 });
    return JSON.parse(stdout || '[]');
  };
  const collectOwnedMedia = async () => {
    if (!mainProcess) return [];
    const rows = (await processRows('ParentProcessId', mainProcess.ProcessId)).filter(isOwnedMedia);
    for (const row of rows) ownedMedia.set(`${row.ProcessId}:${row.CreationDate}`, row);
    return rows;
  };
  const exactProcessAlive = async record => (await processRows('ProcessId', record.ProcessId)).some(row => matchesProcess(row, record));
  try {
    assert(reportPath, 'Pass the successful build-report.json path.');
    assert(reportPath.startsWith(path.join(root, 'out') + path.sep), 'Build report must be inside this project output area.');
    const build = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(build.status, 'build-verified-runtime-acceptance-pending');
    assert.equal(build.version, '0.5.0');
    report.zip = build.zip;
    assert.deepEqual(await hashFile(build.zip.path), { sizeBytes: build.zip.sizeBytes, sha256: build.zip.sha256 });
    for (const dir of [extracted, alternateCwd, input, output, cancelInput, cancelOutput, restartOutput]) await fs.mkdir(dir);
    await execute(sevenZip, ['t', build.zip.path], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
    await execute(sevenZip, ['x', build.zip.path, `-o${extracted}`, '-y'], { windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024 });
    assert.equal((await fs.readdir(extracted)).includes('data'), false);
    report.extractedInventory = await inventory(extracted);
    assert.deepEqual(report.extractedInventory, [...build.packageInventory].sort(), 'Extracted ZIP inventory differs from the verified package.');
    for (const file of build.packageInventory) {
      assert.deepEqual(await hashFile(path.join(extracted, file)), await hashFile(path.join(build.packageDir, file)), `Extracted file differs: ${file}`);
    }
    // Bind critical extracted bytes directly to immutable values in the report,
    // rather than trusting only the possibly changed unpacked build directory.
    const recordedFiles = [
      { ...build.executable, path: 'FFmpeg Encoder.exe' },
      { ...build.asar, path: 'resources/app.asar' },
      ...build.resources.map(entry => ({ ...entry, path: `resources/${entry.path}` })),
      ...build.electronNotices,
    ];
    report.recordedHashesVerified = [];
    for (const entry of recordedFiles) {
      assert.deepEqual(await hashFile(path.join(extracted, entry.path)), { sizeBytes: entry.sizeBytes, sha256: entry.sha256 }, `Extracted recorded hash differs: ${entry.path}`);
      report.recordedHashesVerified.push({ path: entry.path, sizeBytes: entry.sizeBytes, sha256: entry.sha256 });
    }
    report.checks.push('ZIP integrity and exact extracted inventory match the verified build; executable, ASAR, resources and notices match recorded hashes');
    const fixture = async (file, size, duration) => runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${duration},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited`, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-n', file]);
    await fixture(path.join(input, 'A portable.mp4'), '320x180', 2);
    await fs.copyFile(path.join(input, 'A portable.mp4'), path.join(input, 'B portable.mp4'));
    await fixture(path.join(cancelInput, 'A cancel.mp4'), '1920x1080', 30);
    await fs.copyFile(path.join(cancelInput, 'A cancel.mp4'), path.join(cancelInput, 'B queued.mp4'));
    for (const folder of [input, cancelInput]) {
      for (const name of await fs.readdir(folder)) await protect(path.join(folder, name), 'source');
    }
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (['path', 'electron_run_as_node', 'node_options'].includes(key.toLowerCase())) delete env[key];
    env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
    report.launchAttempted = true;
    report.closed = false;
    app = await _electron.launch({ executablePath: executable, cwd: alternateCwd, env,
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9'], timeout: 60000 });
    const mainPid = await app.evaluate(() => process.pid);
    mainProcess = (await processRows('ProcessId', mainPid)).find(row => row.ExecutablePath?.toLowerCase() === executable.toLowerCase());
    assert(mainProcess, 'Actual extracted Electron main process was not observed.');
    report.mainProcess = mainProcess;
    page = await app.firstWindow(); page.on('pageerror', error => report.errors.push(error.message));
    await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 120000 });
    report.identity = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, version: app.getVersion(), executable: app.getPath('exe'), appPath: app.getAppPath(), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), resources: process.resourcesPath, cwd: process.cwd(), path: process.env.PATH, pid: process.pid, versions: process.versions }));
    assert.equal(report.identity.isPackaged, true); assert.equal(report.identity.version, '0.5.0');
    assert.equal(report.identity.executable.toLowerCase(), executable.toLowerCase());
    assert.equal(report.identity.userData, path.join(extracted, 'data'));
    assert.equal(report.identity.sessionData, path.join(extracted, 'data'));
    report.electronChildren = (await processRows('ParentProcessId', mainPid)).filter(row => row.ExecutablePath?.toLowerCase() === executable.toLowerCase());
    assert(report.electronChildren.length > 0, 'No Electron child process identities were observed.');
    for (const child of report.electronChildren) {
      assert(child.CommandLine.includes(`--user-data-dir="${path.join(extracted, 'data')}"`), 'Electron child must use adjacent portable data.');
    }
    assert.equal(report.identity.cwd, alternateCwd); assert.equal(report.identity.path, env.PATH);
    assert.equal(report.identity.appPath, path.join(extracted, 'resources', 'app.asar'));
    assert.equal(page.url(), 'app://encoder/index.html');
    const boundary = await page.evaluate(() => ({ require: typeof require, process: typeof process, methods: Object.keys(window.encoder) }));
    assert.equal(boundary.require, 'undefined'); assert.equal(boundary.process, 'undefined'); assert.equal(boundary.methods.length, 8);
    report.capabilities = await page.evaluate(() => window.encoder.getCapabilities());
    assert.equal(report.capabilities.profiles.length, 6);
    assert.ok(report.capabilities.profiles.every(profile => profile.available));
    report.checks.push('Extracted ASAR app reports version0.5.0, uses adjacent data/bundled resources, has isolated bridge, and initializes all six profiles with restricted PATH and alternate cwd');
    // This runtime leaves navigator.onLine true and its nominal offline API
    // still permits the control fetch. Instead make network access unavailable
    // through a verified unreachable proxy, including loopback. A separate
    // control session preserves the production request allowlist throughout.
    networkControl = createServer((_request, response) => { response.writeHead(200, { 'Cache-Control': 'no-store' }); response.end('portable-network-control'); });
    await new Promise((resolve, reject) => { networkControl.once('error', reject); networkControl.listen(0, '127.0.0.1', resolve); });
    const controlUrl = `http://127.0.0.1:${networkControl.address().port}/control`;
    report.networkControl = await app.evaluate(async ({ session }, url) => {
      const control = session.fromPartition('portable-offline-control');
      await control.setProxy({ mode: 'direct' });
      const onlineText = await (await control.fetch(url, { signal: AbortSignal.timeout(5000) })).text();
      const unavailableProxy = { mode: 'fixed_servers', proxyRules: '127.0.0.1:9', proxyBypassRules: '<-loopback>' };
      await control.setProxy(unavailableProxy);
      await control.closeAllConnections();
      let offlineError = null;
      try { await control.fetch(url + '?offline', { signal: AbortSignal.timeout(5000) }); }
      catch (error) { offlineError = error.message; }
      const application = session.fromPartition('encoder-local');
      await application.setProxy(unavailableProxy);
      await application.closeAllConnections();
      return { onlineText, offlineError, controlProxy: await control.resolveProxy(url), applicationProxy: await application.resolveProxy(url), proxyConfiguration: unavailableProxy };
    }, controlUrl);
    assert.equal(report.networkControl.onlineText, 'portable-network-control');
    assert.match(report.networkControl.offlineError || '', /ERR_PROXY_CONNECTION_FAILED/);
    assert.equal(report.networkControl.controlProxy, 'PROXY 127.0.0.1:9');
    assert.equal(report.networkControl.applicationProxy, report.networkControl.controlProxy);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#profile').disabled, undefined, { timeout: 60000 });
    report.offline = await page.evaluate(() => ({ online: navigator.onLine, url: location.href }));
    report.checks.push('A working network control request fails with ERR_PROXY_CONNECTION_FAILED under network isolation; application session verifies the same proxy and reloads its bundled app origin');
    const folders = async (from, to) => {
      await app.evaluate(({ dialog }, paths) => { let i = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[i++]] }); }, [from, to]);
      await page.click('#choose-input'); await page.click('#choose-output');
    };
    const settings = async (profile, preset) => { await page.selectOption('#profile', profile); await page.selectOption('#preset', preset); };
    const prepare = async () => { await page.click('#prepare-batch'); const state = await stateUntil(state => ['ready', 'failed'].includes(state.phase)); assert.equal(state.phase, 'ready', JSON.stringify(state)); return state; };
    await folders(input, output); await settings('h264-cpu', 'veryfast');
    await prepare(); await page.click('#start-batch');
    const completed = await stateUntil(state => ['completed', 'failed'].includes(state.phase));
    assert.equal(completed.counts.success, 2, JSON.stringify(completed)); report.cases.push({ name: 'offline encode', state: completed });
    const outputHashes = [];
    for (const item of completed.items) {
      const file = path.join(output, item.outputName);
      await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
      const probe = JSON.parse((await runTool(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file])).stdout);
      assert.equal(probe.streams[0].codec_name, 'h264'); assert.equal(probe.streams[0].color_transfer, 'bt709');
      outputHashes.push({ name: item.outputName, ...await hashFile(file) });
      await protect(file, 'completed output / existing output in later steps');
    }
    await page.screenshot({ path: path.join(artifacts, 'offline-results.png'), fullPage: true });
    await page.click('#new-batch'); const skipped = await prepare();
    assert.equal(skipped.counts.skipped, 2); assert.equal(await page.isEnabled('#start-batch'), false);
    for (const item of outputHashes) assert.deepEqual(await hashFile(path.join(output, item.name)), { sizeBytes: item.sizeBytes, sha256: item.sha256 });
    report.checks.push('Offline extracted app completes two real encodes/full decodes and skips existing outputs without changing hashes');
    await folders(cancelInput, cancelOutput); await settings('h265-cpu', 'veryslow');
    await prepare(); await page.click('#start-batch');
    await stateUntil(state => state.phase === 'running');
    const deadline = Date.now() + 15000;
    let owned;
    while (!owned && Date.now() < deadline) {
      const children = (await processRows('ParentProcessId', report.identity.pid)).filter(row => row.ExecutablePath?.toLowerCase() === ffmpeg.toLowerCase() && row.CommandLine?.includes('-progress'));
      assert(children.length <= 1); owned = children[0]; if (!owned) await wait(100);
    }
    assert(owned, 'No exact bundled FFmpeg child observed during cancellation case.');
    ownedMedia.set(`${owned.ProcessId}:${owned.CreationDate}`, owned);
    await page.click('#cancel-batch'); const cancelled = await stateUntil(state => state.phase === 'cancelled');
    assert.equal(cancelled.counts.cancelled, 1); assert.equal(cancelled.counts.unprocessed, 1);
    assert.deepEqual(await fs.readdir(cancelOutput), []);
    assert.equal((await processRows('ProcessId', owned.ProcessId)).some(row => row.CreationDate === owned.CreationDate && row.ExecutablePath === owned.ExecutablePath), false);
    report.cases.push({ name: 'owned child cancellation', child: owned, state: cancelled });
    await page.click('#new-batch'); await folders(input, restartOutput); await settings('h264-cpu', 'veryfast');
    await prepare(); await page.click('#start-batch'); const restarted = await stateUntil(state => ['completed', 'failed'].includes(state.phase));
    assert.equal(restarted.counts.success, 2); assert.notEqual(restarted.batchId, cancelled.batchId);
    for (const item of restarted.items) {
      const file = path.join(restartOutput, item.outputName);
      await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
      await protect(file, 'completed restart output');
    }
    await verifyProtected();
    assert.deepEqual(await fs.readdir(cancelOutput), []);
    report.cases.push({ name: 'new batch after cancellation', state: restarted });
    report.checks.push('Cancellation removes exact bundled child/owned temporary output and stops queued work; a distinct subsequent batch completes two real outputs');
    assert.deepEqual(report.errors, []);
    report.runtimeChecksPassed = true;
  } catch (error) {
    failure = error;
    report.failure = { message: error.message, stack: error.stack };
    if (page && !page.isClosed()) { report.state = await page.evaluate(() => window.encoder?.getSnapshot()).catch(() => null); await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {}); }
  } finally {
    // Preserve the first failure, but record every cleanup failure. A close()
    // rejection or surviving exact process must never produce passed/closed.
    const cleanupStep = async (stage, action) => {
      try { await action(); }
      catch (error) {
        failure ||= error;
        report.cleanupErrors.push({ stage, message: error.message, stack: error.stack });
      }
    };
    if (app) {
      await cleanupStep('observe owned media before closing', collectOwnedMedia);
      if (page && !page.isClosed()) await cleanupStep('settle active operation', () => page.evaluate(async () => {
        const state = await window.encoder.getSnapshot();
        if (['checking', 'preparing', 'running', 'cancelling'].includes(state.phase)) await window.encoder.cancelBatch({ batchId: state.batchId });
      }));
      await cleanupStep('close extracted app', async () => {
        let timer;
        try {
          await Promise.race([
            app.close(),
            new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Extracted app close exceeded 10 seconds.')), 10_000); }),
          ]);
        } finally { clearTimeout(timer); }
      });
      await cleanupStep('verify exact main and owned media exit', async () => {
        assert(mainProcess, 'Cannot verify shutdown without an observed actual main-process identity.');
        const deadline = Date.now() + 5000;
        let remaining;
        do {
          await collectOwnedMedia();
          remaining = [];
          for (const record of [mainProcess, ...ownedMedia.values()]) {
            if (await exactProcessAlive(record)) remaining.push(record);
          }
          if (!remaining.length) break;
          await wait(100);
        } while (Date.now() < deadline);
        report.shutdown = { mainProcess, observedMedia: [...ownedMedia.values()], remaining };
        assert.deepEqual(remaining, [], 'Exact main/owned media processes remain after close.');
        assert.deepEqual(await collectOwnedMedia(), [], 'Bundled media child remains after main exit.');
        report.closed = true;
      });
    }
    await cleanupStep('verify protected files after shutdown', async () => {
      await verifyProtected();
      report.protectedFilesVerifiedAfterShutdown = true;
    });
    if (networkControl) await cleanupStep('close loopback network control', () => new Promise((resolve, reject) => networkControl.close(error => error ? reject(error) : resolve())));
    if (!failure) {
      assert.equal(report.closed, true);
      report.checks.push('Actual extracted main PID and all observed/remaining bundled media children are absent after close; every source and completed-output hash remains unchanged through shutdown');
    }
    report.status = failure ? 'failed' : 'passed';
    if (failure && !report.failure) report.failure = { message: failure.message, stack: failure.stack };
    report.finishedAtUtc = new Date().toISOString();
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ artifacts, status: report.status, checks: report.checks, failure: report.failure }, null, 2));
  }
  if (failure) throw failure;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
