'use strict';
// Standalone Windows x64 release-candidate smoke. Native execution is mandatory.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createRequire } = require('node:module');
const exec = promisify(execFile);
const SHA = '1b9838a0c4a9379ef36032ddea4c422e66aaea9b';
const VERSION = '0.7.0-alpha.1';
const ELECTRON = '44.7.0';
const FFMPEG_VERSION = '9.0.2-full_build-www.gyan.dev';
const pins = {
  'ffmpeg.exe': { size: 227823104, sha256: '589e50b766d251afdf181dd664d40bd94407e200b019989fd7468c7d118a28d0' },
  'ffprobe.exe': { size: 227621376, sha256: '02264dfa4f56baaa31e443ece8aa16d397f6b008200e7fd184d22b9009e75fd3' },
};
function parse(argv) {
  const args = {};
  assert.equal(argv.length, 8);
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i].slice(2);
    assert(['source', 'app', 'work', 'form'].includes(opt) && argv[i] === '--' + opt && !Object.hasOwn(args, opt));
    args[opt] = argv[i + 1];
  }
  assert(['portable', 'installed'].includes(args.form));
  for (const k of ['source', 'app', 'work']) assert(path.isAbsolute(args[k]));
  return args;
}
const normalize = file => path.resolve(file).toLowerCase();
function contains(parent, child) {
  parent = normalize(parent); child = normalize(child);
  return parent === child || child.startsWith(parent + path.sep);
}
async function ordinary(file, directory = false) {
  const s = await fs.lstat(file);
  assert(directory ? s.isDirectory() : s.isFile() && s.nlink === 1);
  assert(!s.isSymbolicLink() && normalize(await fs.realpath(file)) === normalize(file));
  return s;
}
async function digest(file) {
  const s = await ordinary(file);
  const h = createHash('sha256');
  for await (const data of createReadStream(file)) h.update(data);
  return { size: s.size, sha256: h.digest('hex') };
}
function bounded(p, timeout = 15000) {
  let timer;
  return Promise.race([p, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error('SMOKE_TIMEOUT')), timeout);
  })]).finally(() => clearTimeout(timer));
}
async function waitState(page, condition, ms) {
  const until = Date.now() + ms;
  do {
    const s = await bounded(page.evaluate(() => window.encoder.getSnapshot()));
    if (condition(s)) return s;
    if (['failed', 'cancelled'].includes(s.phase)) throw Error('UNEXPECTED_TERMINAL_STATE');
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < until);
  throw Error('STATE_TIMEOUT');
}
function checkProbe(text) {
  const { streams } = JSON.parse(text);
  assert.equal(streams.length, 2);
  const v = streams.find(x => x.codec_type === 'video');
  assert.deepEqual([v.codec_name, v.width, v.height, Number(v.nb_read_frames)], ['h264', 320, 180, 48]);
  assert.equal(streams.find(x => x.codec_type === 'audio')?.codec_name, 'aac');
}
async function smoke(args) {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  assert.equal(process.env.GITHUB_ACTIONS === 'true' || process.env.FFMPEG_OWNER_NATIVE_SMOKE === '1', true,
    'Use the isolated reviewed runner, or deliberately opt into a disposable owner test.');
  const { source, app: executable, work, form } = args;
  const appRoot = path.dirname(executable);
  assert(!contains(source, appRoot) && !contains(appRoot, source) || !contains(appRoot, source) && contains(path.join(source, 'out'), appRoot));
  assert(!contains(appRoot, work) && !contains(work, appRoot) && !contains(source, work) && !contains(work, source));
  assert.equal(path.basename(executable).toLowerCase(), 'ffmpeg encoder.exe');
  await ordinary(source, true); await ordinary(appRoot, true); await ordinary(path.dirname(work), true);
  const git = await exec('git', ['rev-parse', 'HEAD'], { cwd: source, timeout: 10000, maxBuffer: 4096, windowsHide: true });
  assert.equal(git.stdout.trim(), SHA);
  await fs.mkdir(work);
  const started = new Date().toISOString();
  let phase = 'verify', app;
  const report = { schema: 1, status: 'failed', form, started, source: SHA, appVersion: VERSION, electron: ELECTRON,
    picker: 'substituted-dialog-return', gpu: 'not-qualified', network: 'not-qualified-as-offline', nativeDesktop: 'not-qualified' };
  const dir = name => path.join(work, name);
  const binary = name => path.join(appRoot, 'resources', 'ffmpeg', name + '.exe');
  const state = path.join(appRoot, 'data');
  const systemRoot = process.env.SystemRoot;
  const cmd = path.join(systemRoot, 'System32', 'cmd.exe');
  const env = { SystemRoot: systemRoot, windir: systemRoot, ComSpec: cmd, PATH: path.join(systemRoot, 'System32'),
    TEMP: dir('temp'), TMP: dir('temp') };
  for (const k of ['SystemDrive', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'ProgramData', 'USERNAME', 'USERDOMAIN', 'SESSIONNAME'])
    if (process.env[k]) env[k] = process.env[k];
  const run = (file, argv) => exec(file, argv, { env, cwd: dir('cwd'), timeout: 45000, maxBuffer: 128 * 1024, windowsHide: true });
  const window = async electron => {
    app = await electron.launch({ executablePath: executable, cwd: dir('cwd'), env, timeout: 90000 });
    const page = await app.firstWindow({ timeout: 90000 });
    page.setDefaultTimeout(15000);
    const identity = await bounded(app.evaluate(({ app, BrowserWindow }) => {
      const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return { packaged: app.isPackaged, version: app.getVersion(), electron: process.versions.electron,
        exe: app.getPath('exe'), resources: process.resourcesPath, asar: app.getAppPath(),
        data: app.getPath('userData'), sessionData: app.getPath('sessionData'), cwd: process.cwd(),
        sandbox: prefs.sandbox, isolated: prefs.contextIsolation, node: prefs.nodeIntegration };
    }));
    assert.deepEqual([identity.packaged, identity.version, identity.electron, identity.sandbox, identity.isolated, identity.node],
      [true, VERSION, ELECTRON, true, true, false]);
    for (const [actual, expected] of [[identity.exe, executable], [identity.resources, path.join(appRoot, 'resources')],
      [identity.asar, path.join(appRoot, 'resources', 'app.asar')], [identity.data, state], [identity.sessionData, state], [identity.cwd, dir('cwd')]]) {
      assert.equal(normalize(actual), normalize(expected));
    }
    assert.equal(page.url(), 'app://encoder/index.html');
    assert.deepEqual(await bounded(page.evaluate(() => [typeof require, typeof process])), ['undefined', 'undefined']);
    await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled,
      undefined, { timeout: 150000 });
    return page;
  };
  const close = async () => { if (app) { await bounded(app.close(), 20000); app = undefined; } };
  try {
    assert.equal(await fs.lstat(state).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; }), false,
      'Never smoke a package with an existing profile.');
    const appPin = await digest(executable);
    const asarPin = await digest(path.join(appRoot, 'resources', 'app.asar'));
    for (const name of ['input', 'output', 'cwd', 'temp']) await fs.mkdir(dir(name));
    for (const name of ['ffmpeg', 'ffprobe']) {
      assert.deepEqual(await digest(binary(name)), pins[name + '.exe']);
      assert((await run(binary(name), ['-version'])).stdout.split(/\r?\n/, 1)[0].startsWith(name + ' version ' + FFMPEG_VERSION + ' '));
    }
    report.packagedPins = { app: appPin, asar: asarPin, ...pins };
    phase = 'fixtures';
    const a = path.join(dir('input'), 'Fixture A.mp4');
    const b = path.join(dir('input'), 'Fixture B.mp4');
    const sentinel = path.join(dir('output'), 'unrelated.txt');
    await fs.writeFile(sentinel, 'Must survive unchanged.\n', { flag: 'wx' });
    const sentinelPin = await digest(sentinel);
    await run(binary('ffmpeg'), ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=320x180:rate=24:duration=2,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
      '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast',
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-n', a]);
    await fs.copyFile(a, b, constants.COPYFILE_EXCL);
    const inputPin = await digest(a);
    assert(inputPin.size > 0 && inputPin.size < 8 * 1024 * 1024);
    const requireSource = createRequire(path.join(source, 'package.json'));
    assert.equal(requireSource('playwright/package.json').version, '1.63.0');
    const { _electron: electron } = requireSource('playwright');
    phase = 'launch';
    const page = await window(electron);
    const errors = [];
    page.on('pageerror', () => errors.push(true));
    await bounded(app.evaluate(({ dialog, app }, folders) => {
      let n = 0;
      dialog.showOpenDialog = async () => {
        if (n >= folders.length) throw Error('Picker budget exceeded.');
        return { canceled: false, filePaths: [folders[n++]] };
      };
      // No production spawn/validation substitution: record and call through.
      const filename = app.getAppPath() + '/src/encoder-service.cjs';
      const { createRequire } = process.getBuiltinModule('module');
      const { EncoderService } = createRequire(filename)(filename);
      const prepare = EncoderService.prototype.prepareBatch;
      globalThis.__alphaSmoke = [];
      EncoderService.prototype.prepareBatch = function (...args) {
        if (!this.__alphaSmokeInstalled) {
          this.__alphaSmokeInstalled = true;
          const run = this.run;
          this.run = (exe, argv, options) => {
            globalThis.__alphaSmoke.push({ exe, argv: [...argv], encode: Boolean(options?.onProgress) });
            return run.call(this, exe, argv, options);
          };
        }
        return prepare.apply(this, args);
      };
    }, [dir('input'), dir('output')]));
    await page.click('#choose-input'); await page.click('#choose-output');
    await page.selectOption('#profile', 'h264-cpu');
    await page.selectOption('#preset', 'veryfast');
    await page.fill('#quality', '23');
    phase = 'prepare';
    await page.click('#prepare-batch');
    const ready = await waitState(page, s => s.phase === 'ready', 90000);
    assert(ready.items.length === 2 && ready.items.every(i => i.status === 'ready'));
    assert.deepEqual([ready.settings.profileId, ready.settings.preset, ready.settings.quality], ['h264-cpu', 'veryfast', 23]);
    phase = 'encode';
    await page.click('#start-batch');
    const done = await waitState(page, s => s.phase === 'completed', 120000);
    assert.equal(done.counts.success, 2); assert.equal(done.items.length, 2);
    const calls = await bounded(app.evaluate(() => globalThis.__alphaSmoke));
    const rf = normalize(binary('ffmpeg')), rp = normalize(binary('ffprobe'));
    assert(calls.length && calls.every(c => [rf, rp].includes(normalize(c.exe))));
    const encodes = calls.filter(c => c.encode);
    assert.equal(encodes.length, 2);
    assert(encodes.every(c => normalize(c.exe) === rf && c.argv.includes('libx264')));
    assert(calls.some(c => normalize(c.exe) === rp));
    phase = 'readback';
    const paths = new Set();
    const outputPins = [];
    for (const item of done.items) {
      assert.equal(item.outputDisposition?.kind, 'published');
      const output = item.outputDisposition.file;
      assert.equal(normalize(path.dirname(output)), normalize(dir('output')));
      paths.add(normalize(output));
      const pin = await digest(output);
      assert(pin.size > 0 && pin.size < 16 * 1024 * 1024);
      outputPins.push(pin);
      checkProbe((await run(binary('ffprobe'), ['-v', 'error', '-count_frames', '-show_entries',
        'stream=codec_type,codec_name,width,height,nb_read_frames', '-of', 'json', output])).stdout);
      await run(binary('ffmpeg'), ['-nostdin', '-v', 'error', '-xerror', '-i', output,
        '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
    }
    assert.equal(paths.size, 2);
    phase = 'collision';
    await page.click('#new-batch'); await page.click('#prepare-batch');
    const collision = await waitState(page, s => s.phase === 'ready' && s.planId !== ready.planId, 90000);
    assert(collision.items.length === 2 && collision.items.every(i => i.status === 'skipped' && i.reason === 'Output already exists.'));
    for (let i = 0; i < done.items.length; i++) assert.deepEqual(await digest(done.items[i].outputDisposition.file), outputPins[i]);
    assert.deepEqual(await digest(sentinel), sentinelPin);
    for (const file of [a, b]) assert.deepEqual(await digest(file), inputPin);
    assert.equal(errors.length, 0);
    phase = 'close';
    await close();
    phase = 'relaunch';
    const again = await window(electron);
    const pref = await bounded(again.evaluate(() => window.encoder.getPreferences()));
    assert.equal(pref.profileId, 'h264-cpu');
    assert.equal(pref.settingsByProfile['h264-cpu'].preset, 'veryfast');
    assert.equal(pref.settingsByProfile['h264-cpu'].quality, 23);
    await close();
    assert.deepEqual(await digest(executable), appPin);
    assert.deepEqual(await digest(path.join(appRoot, 'resources', 'app.asar')), asarPin);
    report.result = { outputs: outputPins, decoded48FramesEach: true, bundleOnly: true,
      noOverwrite: true, launchCloseRelaunch: true, adjacentProfile: true };
    report.status = 'passed';
    phase = 'complete';
  } catch (err) {
    report.failure = { phase, code: err?.code === 'ERR_ASSERTION' ? 'ERR_ASSERTION' : 'SMOKE_FAILED' };
    console.error('Native smoke failed:', phase, err.message);
    if (app) try { await close(); } catch { report.close = 'unconfirmed'; }
    throw err;
  } finally {
    report.finished = new Date().toISOString();
    await fs.writeFile(path.join(work, 'native-smoke.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  console.log('Native CPU smoke passed:', form);
}
module.exports = { parse, contains, checkProbe };
if (require.main === module) smoke(parse(process.argv.slice(2))).catch(() => { process.exitCode = 1; });
