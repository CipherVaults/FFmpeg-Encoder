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
const { inspectInput, inspectMetadata, validateOutput } = require('../src/inspection.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const { createRichFixture } = require('./test-fixtures.cjs');
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
  const archiveFolder = path.join(artifacts, "Archive العربية & apostrophe's");
  const sevenZip = 'C:\\Program Files\\7-Zip\\7z.exe';
  const executable = path.join(extracted, 'FFmpeg Encoder.exe');
  const ffmpeg = path.join(extracted, 'resources', 'ffmpeg', 'ffmpeg.exe');
  const ffprobe = path.join(extracted, 'resources', 'ffmpeg', 'ffprobe.exe');
  const report = { time: new Date().toISOString(), status: 'running', artifacts, buildReport: reportPath, zip: null, extracted, launchAttempted: false, closed: null, sessions: [], checks: [], cases: [], errors: [], cleanupErrors: [], protectedFiles: [], limitations: [
    'Same-machine portable extraction; no claim of independent clean-machine or other GPU compatibility.',
    'Native dialog returns are substituted in this harness. Real Windows folder selection has separate H evidence.',
    'Offline acceptance uses verified unreachable-proxy/resolver restrictions in Electron sessions/processes, not physical disconnection or a machine firewall change; it does not sandbox hypothetical main-process Node sockets.',
    'Playwright debugging attaches only for verification. The distributed application has no automation workflow or background encoding feature.',
    'Tool argv and cache calls are observed through the packaged service runner without replacing execution. Windows independently identifies the real main processes and the cancellation child; short completed jobs can escape OS sampling.',
    'Generated owned fixtures cover the amended packaged path. Accepted L/H profile, layout, race and preservation evidence is reused; no broad profile or personal-media benchmark is repeated.',
  ] };
  let app;
  let page;
  let mainProcess;
  let networkControl;
  let failure;
  let session;
  let controlUrl;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (['path', 'electron_run_as_node', 'node_options'].includes(key.toLowerCase())) delete env[key];
  env.PATH = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const save = async phase => {
    if (phase) report.phase = phase;
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
  };
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
  const observations = () => app.evaluate(() => globalThis.__portableAcceptance.calls);
  const encodeCalls = async () => (await observations()).filter(entry => entry.encoding);
  const ffprobeCalls = async () => (await observations()).filter(entry => entry.executable.toLowerCase() === ffprobe.toLowerCase());
  const folders = async (from, to) => {
    await app.evaluate(({ dialog }, paths) => { let i = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [paths[i++]] }); }, [from, to]);
    await page.click('#choose-input'); await page.click('#choose-output');
  };
  const settings = async (profileId, preset, quality) => {
    await page.selectOption('#profile', profileId); await page.selectOption('#preset', preset);
    if (quality !== undefined) await page.fill('#quality', String(quality));
    await page.waitForFunction(async expected => {
      const p = await window.encoder.getPreferences(); const value = p.settingsByProfile[expected.profileId];
      return p.profileId === expected.profileId && value?.preset === expected.preset && (expected.quality === undefined || value.quality === expected.quality);
    }, { profileId, preset, quality });
  };
  const prepare = async label => {
    const before = (await ffprobeCalls()).length;
    const previousPlanId = (await page.evaluate(() => window.encoder.getSnapshot())).planId;
    const started = Date.now();
    await page.click('#prepare-batch');
    const state = await stateUntil(value => ['ready', 'failed', 'cancelled'].includes(value.phase) && value.planId !== previousPlanId);
    assert.equal(state.phase, 'ready', JSON.stringify(state));
    const evidence = { name: label, elapsedMs: Date.now() - started, ffprobeCalls: (await ffprobeCalls()).slice(before), state };
    report.cases.push(evidence); await save(label); return evidence;
  };
  async function displayDetails(state, item) {
    await page.selectOption('#batch-filter', 'all');
    if (await page.getAttribute('#preview-collapse', 'aria-expanded') === 'false') await page.click('#preview-collapse');
    const expected = await page.evaluate(payload => window.encoder.getEncodingDetails(payload), { planId: state.planId, fileId: item.id });
    const row = page.locator(`tr[data-file-id="${item.id}"]`);
    const outer = row.locator('[data-testid="file-details"]');
    if (await outer.getAttribute('open') === null) await outer.locator(':scope > summary').click();
    const details = row.locator('[data-testid="encoding-details"]');
    if (await details.getAttribute('open') === null) await details.locator(':scope > summary').click();
    await page.waitForFunction(({ id, args }) => {
      const raw = document.querySelector(`tr[data-file-id="${id}"] [data-testid="resolved-args"]`)?.textContent;
      try { return JSON.stringify(JSON.parse(raw)) === JSON.stringify(args); } catch { return false; }
    }, { id: item.id, args: expected.args });
    assert.deepEqual(JSON.parse(await row.locator('[data-testid="resolved-args"]').textContent()), expected.args);
    return expected;
  }
  function assertInvocation(prepared, actual) {
    assert.equal(prepared.kind, 'resolved-argument-template');
    assert.ok(prepared.outputPlaceholder); assert.equal(prepared.args.at(-1), prepared.outputPlaceholder);
    const expected = [...prepared.args]; expected[expected.length - 1] = actual.argv.at(-1);
    assert.equal(actual.executable, ffmpeg); assert.equal(actual.executable, prepared.executable);
    assert.deepEqual(actual.argv, expected, 'Actual invocation differs beyond the declared protected staging path');
    assert.match(path.basename(path.dirname(actual.argv.at(-1))), /^\.ffmpeg-encoder-/);
    assert.equal(actual.code, 0); assert.ok(actual.pid && actual.closedAt >= actual.spawnedAt);
  }
  async function launch(label) {
    assert.equal(app, undefined, 'Close the prior actual process before relaunch.');
    report.launchAttempted = true; report.closed = false;
    app = await _electron.launch({ executablePath: executable, cwd: alternateCwd, env,
      args: ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1', '--proxy-server=http://127.0.0.1:9'], timeout: 60000 });
    const mainPid = await app.evaluate(() => process.pid);
    mainProcess = (await processRows('ProcessId', mainPid)).find(row => row.ExecutablePath?.toLowerCase() === executable.toLowerCase());
    assert(mainProcess, 'Actual extracted Electron main process was not observed.');
    session = { label, mainProcess }; report.sessions.push(session);
    page = await app.firstWindow(); page.on('pageerror', error => report.errors.push({ label, message: error.message }));
    await page.waitForFunction(() => document.querySelector('#choose-input') && !document.querySelector('#choose-input').disabled, undefined, { timeout: 120000 });
    session.identity = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, version: app.getVersion(), executable: app.getPath('exe'), appPath: app.getAppPath(), userData: app.getPath('userData'), sessionData: app.getPath('sessionData'), resources: process.resourcesPath, cwd: process.cwd(), path: process.env.PATH, pid: process.pid, versions: process.versions }));
    const identity = session.identity;
    assert.equal(identity.isPackaged, true); assert.equal(identity.version, '0.6.0');
    assert.equal(identity.executable.toLowerCase(), executable.toLowerCase());
    assert.equal(identity.userData, path.join(extracted, 'data')); assert.equal(identity.sessionData, identity.userData);
    assert.equal(identity.cwd, alternateCwd); assert.equal(identity.path, env.PATH);
    assert.equal(identity.appPath, path.join(extracted, 'resources', 'app.asar'));
    assert.equal(identity.resources, path.join(extracted, 'resources'));
    session.electronChildren = (await processRows('ParentProcessId', mainPid)).filter(row => row.ExecutablePath?.toLowerCase() === executable.toLowerCase());
    assert(session.electronChildren.length > 0, 'No Electron child process identities were observed.');
    for (const child of session.electronChildren) assert(child.CommandLine.includes(`--user-data-dir="${identity.userData}"`), 'Electron child must use adjacent portable data.');
    assert.equal(page.url(), 'app://encoder/index.html');
    session.boundary = await page.evaluate(() => ({ require: typeof require, process: typeof process, methods: Object.keys(window.encoder).sort() }));
    assert.equal(session.boundary.require, 'undefined'); assert.equal(session.boundary.process, 'undefined');
    assert.deepEqual(session.boundary.methods, ['getCapabilities', 'getPreferences', 'saveSettings', 'resetProfile', 'forgetPreferences', 'clearInspectionCache', 'getRecipe', 'getEncodingDetails', 'chooseInputFolder', 'chooseOutputFolder', 'prepareBatch', 'treatAsOriginal', 'reencodeOutputs', 'startBatch', 'cancelBatch', 'getSnapshot', 'onUpdate'].sort());
    session.capabilities = await page.evaluate(() => window.encoder.getCapabilities());
    assert.equal(session.capabilities.profiles.length, 6); assert(session.capabilities.profiles.every(profile => profile.available));
    // Install observation only after the real packaged capability checks finish.
    // The wrapped runner still executes the original binary/argv/options.
    await app.evaluate(({ app }) => {
      const modulePath = `${app.getAppPath()}/src/encoder-service.cjs`;
      const require = process.getBuiltinModule('module').createRequire(modulePath);
      const { EncoderService } = require(modulePath); const prepare = EncoderService.prototype.prepareBatch;
      const harness = globalThis.__portableAcceptance = { calls: [] };
      EncoderService.prototype.prepareBatch = function (...args) {
        if (!this.__portableObserved) {
          this.__portableObserved = true; const run = this.run;
          this.run = (executable, argv, options = {}) => {
            const entry = { executable, argv: [...argv], encoding: Boolean(options.onProgress), pid: null, spawnedAt: null, closedAt: null };
            harness.calls.push(entry);
            return run(executable, argv, { ...options, onChild(child) {
              entry.pid = child.pid; entry.spawnedAt = Date.now();
              child.once('close', (code, signal) => Object.assign(entry, { code, signal, closedAt: Date.now() }));
              options.onChild?.(child);
            } });
          };
        }
        return prepare.apply(this, args);
      };
    });
    // Electron's nominal offline API did not reject control fetches in the
    // accepted 0.5 experiment. Verify this proxy restriction on every process.
    session.networkControl = await app.evaluate(async ({ session }, url) => {
      const control = session.fromPartition('portable-offline-control');
      await control.setProxy({ mode: 'direct' });
      const onlineText = await (await control.fetch(url, { signal: AbortSignal.timeout(5000) })).text();
      const unavailableProxy = { mode: 'fixed_servers', proxyRules: '127.0.0.1:9', proxyBypassRules: '<-loopback>' };
      await control.setProxy(unavailableProxy); await control.closeAllConnections();
      let offlineError = null;
      try { await control.fetch(url + '?offline', { signal: AbortSignal.timeout(5000) }); } catch (error) { offlineError = error.message; }
      const application = session.fromPartition('encoder-local');
      await application.setProxy(unavailableProxy); await application.closeAllConnections();
      return { onlineText, offlineError, controlProxy: await control.resolveProxy(url), applicationProxy: await application.resolveProxy(url), proxyConfiguration: unavailableProxy };
    }, controlUrl);
    assert.equal(session.networkControl.onlineText, 'portable-network-control');
    assert.match(session.networkControl.offlineError || '', /ERR_PROXY_CONNECTION_FAILED/);
    assert.equal(session.networkControl.controlProxy, 'PROXY 127.0.0.1:9');
    assert.equal(session.networkControl.applicationProxy, session.networkControl.controlProxy);
    await page.reload();
    await page.waitForFunction(() => !document.querySelector('#choose-input').disabled, undefined, { timeout: 120000 });
    session.offline = await page.evaluate(() => ({ online: navigator.onLine, url: location.href }));
    session.initialState = await page.evaluate(() => window.encoder.getSnapshot());
    session.initialPreferences = await page.evaluate(() => window.encoder.getPreferences());
    assert.equal(session.initialState.items.length, 0, 'Restart must not automatically prepare a remembered folder.');
    await save(`launched ${label}`);
  }
  async function closeSession() {
    if (!app) return;
    await collectOwnedMedia();
    if (page && !page.isClosed()) {
      await page.evaluate(async () => {
        const state = await window.encoder.getSnapshot();
        if (['checking', 'preparing', 'running', 'cancelling'].includes(state.phase) && state.batchId) await window.encoder.cancelBatch({ batchId: state.batchId });
      });
      session.calls = await observations(); session.lastSnapshot = await page.evaluate(() => window.encoder.getSnapshot());
    }
    let timer;
    try {
      await Promise.race([app.close(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Extracted app close exceeded 10 seconds.')), 10_000); })]);
    } finally { clearTimeout(timer); }
    const remaining = [];
    for (const record of [mainProcess, ...session.electronChildren, ...ownedMedia.values()]) if (await exactProcessAlive(record)) remaining.push(record);
    session.shutdown = { remaining, observedMedia: [...ownedMedia.values()] };
    assert.deepEqual(remaining, [], 'Exact app/owned media processes remain after close.');
    assert.deepEqual(await collectOwnedMedia(), [], 'Bundled media child remains after main exit.');
    session.closed = true; report.closed = true; app = undefined; page = undefined;
    await verifyProtected(); await save(`closed ${session.label}`);
  }
  try {
    assert(reportPath, 'Pass the successful build-report.json path.');
    assert(reportPath.startsWith(path.join(root, 'out') + path.sep), 'Build report must be inside this project output area.');
    const build = JSON.parse(await fs.readFile(reportPath, 'utf8'));
    assert.equal(build.status, 'build-verified-runtime-acceptance-pending');
    assert.equal(build.version, '0.6.0');
    report.buildReportHash = await hashFile(reportPath);
    report.harnessHash = await hashFile(__filename);
    report.zip = build.zip;
    assert.deepEqual(await hashFile(build.zip.path), { sizeBytes: build.zip.sizeBytes, sha256: build.zip.sha256 });
    for (const dir of [extracted, alternateCwd, input, output, cancelInput, cancelOutput, restartOutput, archiveFolder]) await fs.mkdir(dir);
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
    const archiveSources = [
      { file: path.join(archiveFolder, 'Rich original.mkv'), depth: 8, frames: 120 },
      { file: path.join(archiveFolder, 'Ten-bit original.mkv'), depth: 10, frames: 12 },
    ];
    await createRichFixture(ffmpeg, path.join(artifacts, 'rich fixture resources'), archiveSources[0].file);
    await runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=0.5,format=yuv420p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
      '-c:v', 'ffv1', '-pix_fmt', 'yuv420p10le', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-metadata', 'title=Portable ten-bit SDR preservation fixture', '-n', archiveSources[1].file]);
    for (const source of archiveSources) {
      source.inspection = await inspectInput(source.file, { ffprobe });
      assert.equal(source.inspection.color.classification, 'sdr'); assert.equal(source.inspection.color.supported, true);
    }
    report.archiveSources = archiveSources.map(({ file, depth, frames }) => ({ file, depth, frames }));
    for (const folder of [input, cancelInput, archiveFolder]) {
      for (const name of await fs.readdir(folder)) await protect(path.join(folder, name), 'source');
    }
    const gpuQuery = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); $rows=@(Get-CimInstance Win32_VideoController | Select-Object Name,DriverVersion,PNPDeviceID); ConvertTo-Json -InputObject $rows -Compress';
    const gpuResult = await execute(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-Command', gpuQuery], { windowsHide: true, timeout: 15000 });
    report.videoControllers = JSON.parse(gpuResult.stdout || '[]');
    assert(report.videoControllers.some(row => /NVIDIA GeForce RTX 5060\b/i.test(row.Name)), 'This accepted local Blackwell endpoint requires the observed RTX 5060.');
    await save('extracted hashes and owned fixtures verified');
    networkControl = createServer((_request, response) => { response.writeHead(200, { 'Cache-Control': 'no-store' }); response.end('portable-network-control'); });
    await new Promise((resolve, reject) => { networkControl.once('error', reject); networkControl.listen(0, '127.0.0.1', resolve); });
    controlUrl = `http://127.0.0.1:${networkControl.address().port}/control`;
    await launch('initial cold preparation');
    report.identity = session.identity; report.capabilities = session.capabilities;
    report.checks.push('Actual extracted version0.6.0 uses its ASAR, adjacent data, bundled resources, exact 17-method isolated bridge, alternate cwd and restricted PATH.',
      'Every actual process session verifies a working control fetch, proxy failure, matching application proxy and local-origin reload.');
    await folders(input, output); await settings('h264-cpu', 'veryfast', 24);
    const cold = await prepare('cold two-file preparation');
    assert.equal(cold.state.items.length, 2); assert(cold.state.items.every(item => item.status === 'ready'));
    assert(cold.ffprobeCalls.length > 0, 'Fresh extracted data must inspect the two new originals.');
    const warm = await prepare('warm unchanged preparation');
    assert(warm.state.items.every(item => item.status === 'ready' && item.inspectionMethod === 'reused'));
    assert.deepEqual(warm.ffprobeCalls, []); assert.notEqual(warm.state.planId, cold.state.planId);
    const remembered = await page.evaluate(() => window.encoder.getPreferences());
    await closeSession(); await launch('actual process restart with warm cache');
    const restored = session.initialPreferences;
    assert.equal(restored.inputFolder.path, input); assert.equal(restored.outputFolder.path, output);
    assert.notEqual(restored.inputFolder.id, remembered.inputFolder.id); assert.notEqual(restored.outputFolder.id, remembered.outputFolder.id);
    assert.deepEqual(restored.settingsByProfile, remembered.settingsByProfile); assert.equal(restored.profileId, 'h264-cpu');
    assert.equal(await page.inputValue('#profile'), 'h264-cpu'); assert.equal(await page.inputValue('#preset'), 'veryfast'); assert.equal(await page.inputValue('#quality'), '24');
    const staleFolder = await page.evaluate(async previous => {
      try { await window.encoder.prepareBatch({ inputFolderId: previous.inputFolder.id, outputFolderId: previous.outputFolder.id, settings: { profileId: 'h264-cpu', preset: 'veryfast', quality: 24 } }); return null; }
      catch (error) { return error.message; }
    }, remembered);
    assert.match(staleFolder || '', /folder/i);
    const stalePlan = await page.evaluate(async previous => {
      try { await window.encoder.getEncodingDetails({ planId: previous.planId, fileId: previous.items[0].id }); return null; }
      catch (error) { return error.message; }
    }, warm.state);
    assert.ok(stalePlan, 'Prior-process plan authority must be rejected.');
    const restartWarm = await prepare('warm unchanged preparation after actual restart');
    assert(restartWarm.state.items.every(item => item.status === 'ready' && item.inspectionMethod === 'reused'));
    assert.deepEqual(restartWarm.ffprobeCalls, []); assert.notEqual(restartWarm.state.planId, warm.state.planId);
    assert(restartWarm.state.items.every(item => !warm.state.items.some(previous => previous.id === item.id)));
    report.restoredAuthority = { remembered, restored, staleFolder, stalePlan };
    report.checks.push('Two new sources inspect cold, then reuse with zero media-inspection ffprobe calls in warm and actual-process-restart preparations; remembered values/folders restore with fresh folder/plan/file IDs and stale prior-process authority fails.');
    const cpuDetails = await displayDetails(restartWarm.state, restartWarm.state.items[0]);
    await page.click('#start-batch');
    const completed = await stateUntil(state => ['completed', 'failed'].includes(state.phase));
    assert.equal(completed.counts.success, 2, JSON.stringify(completed));
    const cpuCommands = await encodeCalls(); assert.equal(cpuCommands.length, 2);
    assert(cpuCommands[1].spawnedAt >= cpuCommands[0].closedAt);
    assertInvocation(cpuDetails, cpuCommands.find(entry => entry.argv.includes(path.join(input, restartWarm.state.items[0].name))));
    report.cases.push({ name: 'offline encode', state: completed, commands: cpuCommands, preparedDetails: cpuDetails });
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
    await page.click('#new-batch'); const skipped = (await prepare('existing distinct-folder output skips')).state;
    assert.equal(skipped.counts.skipped, 2); assert.equal(await page.isEnabled('#start-batch'), false);
    for (const item of outputHashes) assert.deepEqual(await hashFile(path.join(output, item.name)), { sizeBytes: item.sizeBytes, sha256: item.sha256 });
    report.checks.push('Offline extracted app completes two real encodes/full decodes and skips existing outputs without changing hashes');
    await folders(cancelInput, cancelOutput); await settings('h265-cpu', 'veryslow');
    await prepare('cancel two-file preparation'); await page.click('#start-batch');
    await stateUntil(state => state.phase === 'running');
    const deadline = Date.now() + 15000;
    let owned;
    while (!owned && Date.now() < deadline) {
      const children = (await processRows('ParentProcessId', session.identity.pid)).filter(row => row.ExecutablePath?.toLowerCase() === ffmpeg.toLowerCase() && row.CommandLine?.includes('-progress'));
      assert(children.length <= 1); owned = children[0]; if (!owned) await wait(100);
    }
    assert(owned, 'No exact bundled FFmpeg child observed during cancellation case.');
    ownedMedia.set(`${owned.ProcessId}:${owned.CreationDate}`, owned);
    await page.click('#cancel-batch'); const cancelled = await stateUntil(state => state.phase === 'cancelled');
    assert.equal(cancelled.counts.cancelled, 1); assert.equal(cancelled.counts.unprocessed, 1);
    // K deliberately retains a stage if cancellation occurs before ownership
    // can be bound to its output. Retention with an explicit notice is safe;
    // requiring an empty folder would incorrectly reject that accepted policy.
    const retainedStages = (await fs.readdir(cancelOutput)).sort();
    assert.ok(retainedStages.every(name => name.startsWith('.ffmpeg-encoder-')));
    if (retainedStages.length) assert.ok(cancelled.items.some(item => item.cleanup?.retained && /retained for safety/i.test(item.reason)));
    assert.equal((await processRows('ProcessId', owned.ProcessId)).some(row => row.CreationDate === owned.CreationDate && row.ExecutablePath === owned.ExecutablePath), false);
    report.cases.push({ name: 'owned child cancellation', child: owned, state: cancelled, retainedStages });
    await page.click('#new-batch'); await folders(input, restartOutput); await settings('h264-cpu', 'veryfast');
    await prepare('new batch after cancellation preparation'); await page.click('#start-batch'); const restarted = await stateUntil(state => ['completed', 'failed'].includes(state.phase));
    assert.equal(restarted.counts.success, 2); assert.notEqual(restarted.batchId, cancelled.batchId);
    for (const item of restarted.items) {
      const file = path.join(restartOutput, item.outputName);
      await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', file, '-f', 'null', '-']);
      await protect(file, 'completed restart output');
    }
    await verifyProtected();
    assert.deepEqual((await fs.readdir(cancelOutput)).sort(), retainedStages);
    report.cases.push({ name: 'new batch after cancellation', state: restarted });
    report.checks.push('Cancellation stops the exact bundled child and queued work, cleans bound owned output or explicitly retains unbound stages safely; a distinct subsequent batch completes two real outputs');
    await save('encode skip cancel and new batch verified');

    await page.click('#new-batch'); await folders(archiveFolder, archiveFolder);
    await page.selectOption('#profile', 'h265-nvidia'); await page.click('#archive-quality');
    const recipe = session.capabilities.recipes.find(entry => entry.profileId === 'h265-nvidia');
    assert.ok(recipe); assert.equal(recipe.available, true, JSON.stringify(recipe));
    assert.equal(recipe.preset, 'p7'); assert.equal(recipe.quality, 32);
    for (const source of archiveSources) assert(recipe.supportedBitDepths.includes(source.depth));
    const archiveSettings = { profileId: recipe.profileId, preset: recipe.preset, quality: recipe.quality, recipeId: recipe.id };
    await page.waitForFunction(async expected => {
      const p = await window.encoder.getPreferences(); const value = p.settingsByProfile[expected.profileId];
      return p.profileId === expected.profileId && value?.preset === expected.preset && value?.quality === expected.quality && value?.recipeId === expected.recipeId;
    }, archiveSettings);
    const recipeDescription = await page.evaluate(value => window.encoder.getRecipe(value), archiveSettings);
    await page.waitForFunction(expected => {
      try { return JSON.stringify(JSON.parse(document.querySelector('#recipe-args').textContent)) === JSON.stringify(expected); } catch { return false; }
    }, recipeDescription.args);
    for (const [flag, value] of [['-preset', 'p7'], ['-tune', 'uhq'], ['-multipass', 'fullres'], ['-rc', 'vbr'], ['-cq', '32'], ['-bf', '4'], ['-b_ref_mode', 'each']]) {
      const scopedFlag = `${flag}:v:0`;
      const index = recipeDescription.args.indexOf(scopedFlag);
      assert.ok(index >= 0, `Archive must contain ${scopedFlag}`);
      assert.equal(recipeDescription.args[index + 1], value, `Archive ${scopedFlag} must be canonical`);
    }
    const archivePrepared = (await prepare('Archive rich eight-bit and ten-bit same-folder preparation')).state;
    assert.equal(archivePrepared.items.length, 2); assert(archivePrepared.items.every(item => item.status === 'ready'));
    assert.deepEqual(archivePrepared.settings, archiveSettings);
    const archiveDetails = {};
    for (const item of archivePrepared.items) archiveDetails[item.id] = await displayDetails(archivePrepared, item);
    await page.screenshot({ path: path.join(artifacts, 'archive-prepared-details.png'), fullPage: true });
    const archiveCallStart = (await encodeCalls()).length;
    await page.click('#start-batch');
    const archiveFinished = await stateUntil(state => ['completed', 'failed', 'cancelled'].includes(state.phase));
    assert.equal(archiveFinished.phase, 'completed', JSON.stringify(archiveFinished)); assert.equal(archiveFinished.counts.success, 2);
    const archiveCommands = (await encodeCalls()).slice(archiveCallStart); assert.equal(archiveCommands.length, 2);
    assert(archiveCommands[1].spawnedAt >= archiveCommands[0].closedAt);
    const archiveOutputs = [];
    for (const item of archiveFinished.items) {
      assert.equal(item.status, 'success');
      const source = archiveSources.find(entry => path.basename(entry.file) === item.name); assert.ok(source);
      const command = archiveCommands.find(entry => entry.argv[entry.argv.indexOf('-i') + 1] === source.file); assert.ok(command);
      assertInvocation(archiveDetails[item.id], command);
      const executed = await displayDetails(archiveFinished, item); assert.equal(executed.kind, 'actual-invocation'); assert.deepEqual(executed.args, command.argv);
      const file = path.join(archiveFolder, item.outputName); const outputProbe = await inspectMetadata(file, { ffprobe });
      const validation = validateOutput(source.inspection, outputProbe, archiveSettings); assert.equal(validation.valid, true, JSON.stringify(validation));
      const marker = classifyMarker(outputProbe); assert.equal(marker.kind, 'generated');
      assert.equal(marker.previousGeneration.recipeId, recipe.id); assert.equal(marker.previousGeneration.preset, 'p7'); assert.equal(marker.previousGeneration.quality, 32);
      assert.equal(marker.previousGeneration.bitDepth, source.depth); assert.deepEqual(marker.previousGeneration.encoderArgs, recipeDescription.args);
      const decoded = await runTool(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-nostats', '-i', file, '-map', '0:v:0', '-map', '0:a?', '-progress', 'pipe:1', '-f', 'null', '-'], { timeoutMs: 120000 });
      assert.equal(decoded.stderr.trim(), ''); assert.match(decoded.stdout, /progress=end/);
      const frames = [...decoded.stdout.matchAll(/^frame=(\d+)\s*$/gm)].map(match => Number(match[1])); assert.equal(frames.at(-1), source.frames);
      if (source.depth === 8) {
        assert.equal(outputProbe.streams.length, 5); assert.equal(outputProbe.streams.filter(stream => stream.codec_type === 'audio').length, 2);
        assert.equal(outputProbe.chapters.length, 2); assert.ok(outputProbe.streams.find(stream => stream.codec_type === 'attachment').extradata_hash);
      }
      await protect(file, 'completed Archive output and intentional re-encode source');
      archiveOutputs.push({ file, depth: source.depth, frames: frames.at(-1), marker, validation, command, executed, probe: outputProbe });
      await save(`verified Archive ${source.depth}-bit output`);
    }
    report.archive = { recipe, settings: archiveSettings, recipeDescription, prepared: archivePrepared, details: archiveDetails, finished: archiveFinished, outputs: archiveOutputs };
    await page.click('#new-batch');
    const archiveRescan = (await prepare('Archive same-folder provenance rescan')).state;
    assert.equal(archiveRescan.items.length, 4);
    assert.equal(archiveRescan.items.filter(item => item.status === 'skipped').length, 2);
    assert.equal(archiveRescan.items.filter(item => item.status === 'generated').length, 2);
    assert(archiveRescan.items.every(item => !item.reencodeAuthorized)); assert.equal(await page.isEnabled('#start-batch'), false);
    await page.selectOption('#batch-filter', 'generated');
    for (const item of archiveRescan.items.filter(entry => entry.status === 'generated')) {
      const row = page.locator(`tr[data-file-id="${item.id}"]`);
      assert.match(await row.locator('[data-testid="origin-label"]').textContent(), /Excluded/);
      assert((await row.locator('[data-testid="previous-generation"]').textContent()).includes(recipe.label));
    }
    const richOutput = archiveOutputs.find(entry => entry.depth === 8);
    const generatedBeforeRestart = archiveRescan.items.find(item => item.name === path.basename(richOutput.file)); assert.ok(generatedBeforeRestart);
    await page.locator(`tr[data-file-id="${generatedBeforeRestart.id}"] [data-testid="reencode-output"]`).click();
    const admittedBeforeRestart = await stateUntil(state => state.phase === 'ready' && state.items.some(item => item.id === generatedBeforeRestart.id && item.reencodeAuthorized));
    const archivePreferences = await page.evaluate(() => window.encoder.getPreferences());
    await page.screenshot({ path: path.join(artifacts, 'archive-intent-before-restart.png'), fullPage: true });
    await closeSession(); await launch('Archive preferences and provenance process restart');
    const archiveRestored = session.initialPreferences;
    assert.equal(archiveRestored.inputFolder.path, archiveFolder); assert.equal(archiveRestored.outputFolder.path, archiveFolder);
    assert.notEqual(archiveRestored.inputFolder.id, archivePreferences.inputFolder.id); assert.notEqual(archiveRestored.outputFolder.id, archivePreferences.outputFolder.id);
    assert.equal(archiveRestored.profileId, 'h265-nvidia'); assert.deepEqual(archiveRestored.settingsByProfile, archivePreferences.settingsByProfile);
    assert.equal(await page.inputValue('#preset'), 'p7'); assert.equal(await page.inputValue('#quality'), '32');
    assert.match(await page.textContent('#active-recipe'), /Archive Quality/);
    const archiveRestartRescan = (await prepare('Archive exclusion after actual process restart')).state;
    assert.equal(archiveRestartRescan.items.length, 4); assert(archiveRestartRescan.items.every(item => !item.reencodeAuthorized));
    assert.equal(archiveRestartRescan.items.filter(item => item.status === 'generated').length, 2); assert.equal(await page.isEnabled('#start-batch'), false);
    assert.notEqual(archiveRestartRescan.planId, admittedBeforeRestart.planId);
    report.archivePersistence = { rescan: archiveRescan, admittedBeforeRestart, preferencesBefore: archivePreferences, restored: archiveRestored, restartRescan: archiveRestartRescan };
    report.checks.push('Packaged RTX5060 Archive Quality P7/UHQ/fullres/VBR-CQ32/bf4/B-ref each follows UI to main to displayed prepared argv to two sequential real spawns; rich8/10-bit outputs fully decode and validate preservation.',
      'Same-folder publication marks/describes generated outputs and excludes them on rescan; Archive preferences survive an actual process restart while re-encode grants expire.');
    await save('Archive endpoint and actual process restart verified');

    await settings('h264-cpu', 'veryfast', 24);
    const reencodePrepared = (await prepare('intentional generated Archive output to CPU preparation')).state;
    const generated = reencodePrepared.items.find(item => item.name === path.basename(richOutput.file)); assert.equal(generated.status, 'generated');
    await page.selectOption('#batch-filter', 'generated');
    await page.locator(`tr[data-file-id="${generated.id}"] [data-testid="reencode-output"]`).click();
    const admitted = await stateUntil(state => state.phase === 'ready' && state.items.some(item => item.id === generated.id && item.reencodeAuthorized && item.status === 'ready'));
    const chosen = admitted.items.find(item => item.id === generated.id);
    assert(admitted.items.filter(item => item.id !== chosen.id).every(item => !item.reencodeAuthorized));
    await page.click('#clear-selection'); await page.locator(`tr[data-file-id="${chosen.id}"] [data-testid="encode-file"]`).check();
    const reencodeDetails = await displayDetails(admitted, chosen);
    const beforeReencode = (await encodeCalls()).length;
    await page.click('#start-batch');
    const reencoded = await stateUntil(state => ['completed', 'failed', 'cancelled'].includes(state.phase));
    assert.equal(reencoded.phase, 'completed', JSON.stringify(reencoded)); assert.equal(reencoded.counts.success, 1);
    const reencodeCommands = (await encodeCalls()).slice(beforeReencode); assert.equal(reencodeCommands.length, 1); assertInvocation(reencodeDetails, reencodeCommands[0]);
    const reencodedItem = reencoded.items.find(item => item.id === chosen.id); assert.equal(reencodedItem.status, 'success');
    const reencodedFile = path.join(archiveFolder, reencodedItem.outputName); const reencodedProbe = await inspectMetadata(reencodedFile, { ffprobe });
    const sourceInspection = await inspectInput(richOutput.file, { ffprobe });
    const reencodedValidation = validateOutput(sourceInspection, reencodedProbe, reencoded.settings); assert.equal(reencodedValidation.valid, true, JSON.stringify(reencodedValidation));
    const reencodedMarker = classifyMarker(reencodedProbe); assert.equal(reencodedMarker.kind, 'generated');
    assert.equal(reencodedMarker.previousGeneration.profileId, 'h264-cpu'); assert.equal(reencodedMarker.previousGeneration.preset, 'veryfast'); assert.equal(reencodedMarker.previousGeneration.quality, 24);
    assert.notEqual(reencodedMarker.outputId, richOutput.marker.outputId); assert.equal(reencodedProbe.streams.find(stream => stream.codec_type === 'video').codec_name, 'h264');
    await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', reencodedFile, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
    await protect(reencodedFile, 'completed intentional next-generation output');
    const actualReencodeDetails = await displayDetails(reencoded, reencodedItem); assert.equal(actualReencodeDetails.kind, 'actual-invocation'); assert.deepEqual(actualReencodeDetails.args, reencodeCommands[0].argv);
    await page.screenshot({ path: path.join(artifacts, 'intentional-reencode-results.png'), fullPage: true });
    await page.click('#new-batch'); const finalRescan = (await prepare('fresh rescan after intentional generation')).state;
    assert.equal(finalRescan.items.filter(item => item.status === 'generated').length, 3); assert(finalRescan.items.every(item => !item.reencodeAuthorized));
    report.intentionalReencode = { prepared: reencodePrepared, admitted, details: reencodeDetails, finished: reencoded, commands: reencodeCommands, file: reencodedFile, marker: reencodedMarker, validation: reencodedValidation, executed: actualReencodeDetails, rescan: finalRescan };
    assert.deepEqual((await fs.readdir(archiveFolder)).filter(name => name.startsWith('.ffmpeg-encoder-')), []);
    await verifyProtected();
    report.checks.push('One explicitly chosen unchanged generated Archive output re-encodes with CPU H264/veryfast/CRF24 through displayed and spawned argv; unrelated generated output remains excluded, the next generation validates/fully decodes, and fresh preparation excludes all generated outputs again.');

    // Small prepare-only cases exercise the shipped cache and reset boundaries.
    // Only this deliberately mutable fixture is replaced; retain its old bytes.
    const diagnosticInput = path.join(artifacts, 'prepare-only fixtures'); const diagnosticOutput = path.join(artifacts, 'prepare-only output');
    await fs.mkdir(diagnosticInput); await fs.mkdir(diagnosticOutput);
    const stableFile = path.join(diagnosticInput, 'Stable.mp4'); const changedFile = path.join(diagnosticInput, 'Changed.mp4'); const newFile = path.join(diagnosticInput, 'New.mp4');
    await fs.copyFile(path.join(input, 'A portable.mp4'), stableFile); await fs.copyFile(path.join(input, 'B portable.mp4'), changedFile);
    await protect(stableFile, 'unchanged diagnostic source');
    await folders(diagnosticInput, diagnosticOutput);
    const diagnosticCold = (await prepare('prepare-only cache baseline')).state;
    assert.equal(diagnosticCold.items.filter(item => item.status === 'ready').length, 2);
    const retainedPrior = path.join(artifacts, 'Retained prior changed fixture.mp4');
    await fs.rename(changedFile, retainedPrior); await protect(retainedPrior, 'retained pre-change diagnostic bytes');
    await fixture(changedFile, '320x180', 3); await fs.copyFile(stableFile, newFile);
    await protect(changedFile, 'changed diagnostic source after deliberate replacement'); await protect(newFile, 'new diagnostic source');
    const changedNew = await prepare('changed and new files inspect while unchanged file reuses');
    assert.equal(changedNew.state.items.length, 3);
    assert.equal(changedNew.state.items.find(item => item.name === 'Stable.mp4').inspectionMethod, 'reused');
    for (const name of ['Changed.mp4', 'New.mp4']) assert.equal(changedNew.state.items.find(item => item.name === name).inspectionMethod, 'fresh');
    assert(changedNew.ffprobeCalls.length > 0); assert(changedNew.ffprobeCalls.every(call => call.argv.includes(changedFile) || call.argv.includes(newFile)));
    const cacheDirectory = path.join(extracted, 'data', 'cache', 'inspection-v1');
    let corruptTarget;
    for (const name of await fs.readdir(cacheDirectory)) {
      if (!/^[a-f0-9]{64}\.json$/.test(name)) continue;
      const file = path.join(cacheDirectory, name); const record = JSON.parse(await fs.readFile(file, 'utf8'));
      if (record.identity?.canonicalPath === stableFile) { corruptTarget = file; break; }
    }
    assert.ok(corruptTarget, 'The stable packaged disk-cache record must exist.');
    await closeSession();
    const corruptBackup = path.join(artifacts, 'retained-valid-cache-record.json'); await fs.copyFile(corruptTarget, corruptBackup);
    await fs.writeFile(corruptTarget, '{intentionally invalid cache record');
    report.cacheCorruption = { target: corruptTarget, retainedOriginal: corruptBackup, kind: 'deliberate malformed JSON after actual process shutdown' };
    await launch('corrupt disk cache fallback process restart');
    const corruptRecovery = await prepare('corrupt cache entry inspects fresh and other entries reuse');
    assert.equal(corruptRecovery.state.items.length, 3);
    assert.equal(corruptRecovery.state.items.find(item => item.name === 'Stable.mp4').inspectionMethod, 'fresh');
    for (const name of ['Changed.mp4', 'New.mp4']) assert.equal(corruptRecovery.state.items.find(item => item.name === name).inspectionMethod, 'reused');
    assert(corruptRecovery.ffprobeCalls.length > 0); assert(corruptRecovery.ffprobeCalls.every(call => call.argv.includes(stableFile)));
    const legacyFile = path.join(diagnosticInput, 'Legacy_H264-CPU.mkv'); const invalidFile = path.join(diagnosticInput, 'Invalid marker.mkv');
    await runTool(ffmpeg, ['-v', 'error', '-i', stableFile, '-map', '0', '-c', 'copy', '-n', legacyFile]);
    await runTool(ffmpeg, ['-v', 'error', '-i', stableFile, '-map', '0', '-c', 'copy', '-metadata', 'FFMPEG_ENCODER_PROVENANCE=999', '-n', invalidFile]);
    await protect(legacyFile, 'unmarked legacy-name diagnostic source'); await protect(invalidFile, 'invalid-marker diagnostic source');
    const mixed = (await prepare('legacy and invalid provenance remain non-ready')).state;
    assert.equal(mixed.items.find(item => item.name === path.basename(legacyFile)).status, 'ambiguous');
    assert.equal(mixed.items.find(item => item.name === path.basename(invalidFile)).status, 'provenance-issue');
    assert.equal(await page.inputValue('#batch-filter'), 'attention');
    await page.screenshot({ path: path.join(artifacts, 'mixed-provenance-preview.png'), fullPage: true });
    const namespaceHashes = async directory => {
      const result = {};
      for (const name of await fs.readdir(directory)) if ((await fs.lstat(path.join(directory, name))).isFile()) result[name] = await hashFile(path.join(directory, name));
      return result;
    };
    const provenanceDirectory = path.join(extracted, 'data', 'provenance-v1');
    const provenanceBefore = await namespaceHashes(provenanceDirectory);
    const preferencesBeforeReset = await page.evaluate(() => window.encoder.getPreferences());
    await page.click('#tested-default');
    await page.waitForFunction(async () => (await window.encoder.getPreferences()).settingsByProfile['h264-cpu'].preset === 'slower');
    const reset = await page.evaluate(() => window.encoder.getPreferences());
    assert.deepEqual(reset.settingsByProfile['h264-cpu'], { preset: 'slower', quality: 24 });
    assert.deepEqual(reset.settingsByProfile['h265-nvidia'], preferencesBeforeReset.settingsByProfile['h265-nvidia']);
    assert.deepEqual(reset.inputFolder, preferencesBeforeReset.inputFolder); assert.deepEqual(reset.outputFolder, preferencesBeforeReset.outputFolder);
    await page.locator('#remembered-workflow > summary').click(); await page.click('#clear-inspection-cache');
    await page.waitForFunction(() => document.querySelector('#preferences-notice').textContent.includes('Inspection cache cleared.'));
    assert.deepEqual(await fs.readdir(cacheDirectory), []); assert.deepEqual(await namespaceHashes(provenanceDirectory), provenanceBefore);
    const preferencesAfterClear = await page.evaluate(() => window.encoder.getPreferences()); assert.deepEqual(preferencesAfterClear.settingsByProfile, reset.settingsByProfile);
    await page.click('#forget-preferences');
    await page.waitForFunction(async () => !(await window.encoder.getPreferences()).inputFolder);
    const forgotten = await page.evaluate(() => window.encoder.getPreferences()); assert.equal(forgotten.inputFolder, null); assert.equal(forgotten.outputFolder, null);
    assert.deepEqual(await namespaceHashes(provenanceDirectory), provenanceBefore); assert.deepEqual(await fs.readdir(diagnosticOutput), []);
    report.resetIsolation = { before: preferencesBeforeReset, reset, afterClear: preferencesAfterClear, forgotten, provenanceBefore };
    report.reusedEvidence = [
      'Accepted J/K/L fixed-NTFS helper-failure fallback, destination-race/no-overwrite and large60-row preview evidence applies to unchanged packaged modules verified by the build hashes; these full injected/race/large-batch cases are not repeated here.',
      'Accepted L/H broad six-profile options, unavailable devices, accessibility/layout matrices and remaining source/stream edge cases are not expanded in this portable delta run.',
    ];
    await verifyProtected();
    report.checks.push('Prepare-only changed/new files alone launch fresh inspection; one deliberately corrupted disk record falls back to fresh inspection after actual restart while unaffected files reuse.',
      'Packaged preview keeps legacy and invalid-marker fixtures non-ready; Tested Default resets only the current profile, cache clear preserves settings/provenance, and forgetting preferences removes folder authority while preserving provenance and all media hashes.');
    assert.deepEqual(report.errors, []);
    report.runtimeChecksPassed = true;
    await save('runtime checks passed; final shutdown pending');
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
      if (session) await cleanupStep('record final session observations', async () => {
        session.calls = await observations(); session.lastSnapshot = await page.evaluate(() => window.encoder.getSnapshot());
      });
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
          for (const record of [...report.sessions.flatMap(entry => [entry.mainProcess, ...entry.electronChildren]), ...ownedMedia.values()]) {
            if (await exactProcessAlive(record)) remaining.push(record);
          }
          if (!remaining.length) break;
          await wait(100);
        } while (Date.now() < deadline);
        report.shutdown = { mainProcess, observedMedia: [...ownedMedia.values()], remaining };
        assert.deepEqual(remaining, [], 'Exact main/owned media processes remain after close.');
        assert.deepEqual(await collectOwnedMedia(), [], 'Bundled media child remains after main exit.');
        report.closed = true;
        session.closed = true;
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
