'use strict';
// FFmpeg Encoder 0.6 Beta packaged-app NVIDIA smoke on the owner's PC (real GPU), derived from smoke.cjs.
// Runs a freshly extracted portable copy from owned release scratch only: every path (app, work, the
// redirected profile/temp folders) must sit under one ffenc-release-work-<12 hex> folder. It never
// touches an installed copy, the daily-use app or profile, or personal media; the sources are synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants, createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createRequire } = require('node:module');
const exec = promisify(execFile);
const VERSION = '0.6.0-beta.1';
const ELECTRON = '44.2.0';
const FFMPEG_VERSION = '9.1';
const pins = {
  'ffmpeg.exe': { size: 52000768, sha256: 'c11d60d48f66d9ba92828c0a61d7e174143f117a54cc22e35dac09a95e7f2209' },
  'ffprobe.exe': { size: 51801600, sha256: '2015d0d51c06c7719fa033f32d0633cc362480e74f49c3fb46e50742fef69188' },
};
// Non-default preset/quality on the standard passes, so the UI controls must drive the encode
// (factory defaults are p5 with CQ 28/25/30).
const PASSES = [
  { id: 'h264-nvidia', encoder: 'h264_nvenc', codec: 'h264', suffix: 'H264-Nvidia-GPU', preset: 'p6', quality: 27 },
  { id: 'h265-nvidia', encoder: 'hevc_nvenc', codec: 'hevc', suffix: 'H265-Nvidia-GPU', preset: 'p4', quality: 24 },
  { id: 'av1-nvidia', encoder: 'av1_nvenc', codec: 'av1', suffix: 'AV1-Nvidia-GPU', preset: 'p6', quality: 31 },
  { id: 'h265-nvidia', encoder: 'hevc_nvenc', codec: 'hevc', suffix: 'H265-Nvidia-GPU', preset: 'p7', quality: 29, archive: 'archive-quality-hevc-v1' },
];
const ARCHIVE_FLAGS = [['-preset:v:0', 'p7'], ['-tune:v:0', 'uhq'], ['-multipass:v:0', 'fullres'], ['-rc:v:0', 'vbr'], ['-cq:v:0', '29'], ['-bf:v:0', '4'], ['-b_ref_mode:v:0', 'each']];
function parse(argv) {
  const args = {};
  assert.equal(argv.length, 6);
  for (let i = 0; i < argv.length; i += 2) {
    const opt = argv[i].slice(2);
    assert(['source', 'app', 'work'].includes(opt) && argv[i] === '--' + opt && !Object.hasOwn(args, opt));
    args[opt] = argv[i + 1];
  }
  for (const k of ['source', 'app', 'work']) assert(path.isAbsolute(args[k]));
  return args;
}
const normalize = file => path.resolve(file).toLowerCase();
function contains(parent, child) {
  parent = normalize(parent); child = normalize(child);
  return parent === child || child.startsWith(parent + path.sep);
}
function scratchRoot(file) {
  for (let p = path.resolve(file); p !== path.dirname(p); p = path.dirname(p))
    if (/^ffenc-release-work-[0-9a-f]{12}$/.test(path.basename(p))) return p;
  throw Error('Not inside owned release scratch.');
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
    if (['failed', 'cancelled'].includes(s.phase)) throw Error('UNEXPECTED_TERMINAL_STATE ' + JSON.stringify(s).slice(0, 2000));
    await new Promise(resolve => setTimeout(resolve, 150));
  } while (Date.now() < until);
  throw Error('STATE_TIMEOUT');
}
function checkProbe(text, codec, depth) {
  const { streams } = JSON.parse(text);
  assert.equal(streams.length, 2);
  const v = streams.find(x => x.codec_type === 'video');
  assert.deepEqual([v.codec_name, v.width, v.height, Number(v.nb_read_frames)], [codec, 640, 360, 48]);
  assert.equal(/10(le|be)?$/.test(v.pix_fmt), depth === 10, `pix_fmt ${v.pix_fmt} for ${depth}-bit source`);
  assert.deepEqual([v.color_primaries, v.color_transfer, v.color_space], ['bt709', 'bt709', 'bt709']);
  assert.equal(streams.find(x => x.codec_type === 'audio')?.codec_name, 'aac');
  return { pix_fmt: v.pix_fmt, profile: v.profile };
}
async function smoke(args) {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  const { source, app: executable, work } = args;
  const appRoot = path.dirname(executable);
  const owned = scratchRoot(work);
  assert.equal(normalize(scratchRoot(appRoot)), normalize(owned)); assert.equal(normalize(scratchRoot(source)), normalize(owned));
  assert(!contains(appRoot, work) && !contains(work, appRoot) && !contains(source, work) && !contains(work, source));
  assert(!contains(source, appRoot) && !contains(appRoot, source));
  assert.equal(path.basename(executable).toLowerCase(), 'ffmpeg encoder.exe');
  await ordinary(source, true); await ordinary(appRoot, true); await ordinary(path.dirname(work), true);
  assert.equal(JSON.parse(await fs.readFile(path.join(source, 'package.json'), 'utf8')).version, VERSION);
  await fs.mkdir(work);
  const started = new Date().toISOString();
  let phase = 'verify', app;
  const report = { schema: 1, status: 'failed', form: 'portable', host: 'owner-pc-real-gpu', started, appVersion: VERSION, electron: ELECTRON,
    picker: 'substituted-dialog-return', profileRedirect: 'USERPROFILE/APPDATA/LOCALAPPDATA/TEMP under work', passes: [] };
  const dir = name => path.join(work, name);
  const binary = name => path.join(appRoot, 'resources', 'ffmpeg', name + '.exe');
  const state = path.join(appRoot, 'data');
  const systemRoot = process.env.SystemRoot;
  const cmd = path.join(systemRoot, 'System32', 'cmd.exe');
  const env = { SystemRoot: systemRoot, windir: systemRoot, ComSpec: cmd, PATH: path.join(systemRoot, 'System32'),
    TEMP: dir('temp'), TMP: dir('temp'), USERPROFILE: dir('home'), APPDATA: path.join(dir('home'), 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(dir('home'), 'AppData', 'Local') };
  for (const k of ['SystemDrive', 'ProgramData', 'USERNAME', 'USERDOMAIN', 'SESSIONNAME', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'])
    if (process.env[k]) env[k] = process.env[k];
  const run = (file, argv) => exec(file, argv, { env, cwd: dir('cwd'), timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
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
    const outs = PASSES.map((_, i) => 'output-' + (i + 1));
    for (const name of ['input', 'cwd', 'temp', 'home', ...outs]) await fs.mkdir(dir(name));
    await fs.mkdir(env.APPDATA, { recursive: true }); await fs.mkdir(env.LOCALAPPDATA, { recursive: true });
    for (const name of ['ffmpeg', 'ffprobe']) {
      assert.deepEqual(await digest(binary(name)), pins[name + '.exe']);
      assert((await run(binary(name), ['-version'])).stdout.split(/\r?\n/, 1)[0].startsWith(name + ' version ' + FFMPEG_VERSION + ' '));
    }
    report.packagedPins = { app: appPin, asar: asarPin, ...pins };
    phase = 'fixtures';
    const tags = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv'];
    const lavfi = ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
      'testsrc2=size=640x360:rate=24:duration=2,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
      '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=2'];
    const sources = [
      { file: path.join(dir('input'), 'Eight-bit source.mp4'), depth: 8 },
      { file: path.join(dir('input'), 'Ten-bit source.mkv'), depth: 10 },
    ];
    await run(binary('ffmpeg'), [...lavfi, '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', ...tags, '-c:a', 'aac', '-shortest', '-n', sources[0].file]);
    await run(binary('ffmpeg'), [...lavfi, '-c:v', 'ffv1', '-pix_fmt', 'yuv420p10le', ...tags, '-c:a', 'aac', '-shortest', '-n', sources[1].file]);
    for (const s of sources) { s.pin = await digest(s.file); assert(s.pin.size > 0 && s.pin.size < 64 * 1024 * 1024); }
    const requireSource = createRequire(path.join(source, 'package.json'));
    assert.equal(requireSource('playwright/package.json').version, '1.63.0');
    const { _electron: electron } = requireSource('playwright');
    phase = 'launch';
    const page = await window(electron);
    const errors = [];
    page.on('pageerror', () => errors.push(true));
    const caps = await bounded(page.evaluate(() => window.encoder.getCapabilities()), 60000);
    report.capabilities = caps.profiles.map(p => ({ id: p.id || p.profileId, available: p.available }));
    assert.equal(caps.profiles.length, 6);
    assert(caps.profiles.every(p => p.available), 'All six profiles must be available on the NVIDIA host: ' + JSON.stringify(report.capabilities));
    const recipe = caps.recipes.find(r => r.id === 'archive-quality-hevc-v1');
    assert(recipe && recipe.available, 'Archive Quality recipe must be available.');
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
      globalThis.__betaSmoke = [];
      EncoderService.prototype.prepareBatch = function (...args) {
        if (!this.__betaSmokeInstalled) {
          this.__betaSmokeInstalled = true;
          const run = this.run;
          this.run = (exe, argv, options) => {
            globalThis.__betaSmoke.push({ exe, argv: [...argv], encode: Boolean(options?.onProgress) });
            return run.call(this, exe, argv, options);
          };
        }
        return prepare.apply(this, args);
      };
    }, [dir('input'), ...outs.map(dir)]));
    await page.click('#choose-input');
    const rf = normalize(binary('ffmpeg')), rp = normalize(binary('ffprobe'));
    let lastPlan = null, callsSeen = 0;
    for (let i = 0; i < PASSES.length; i++) {
      const pass = PASSES[i];
      phase = `prepare-${i + 1}`;
      if (i > 0) await page.click('#new-batch');
      await page.click('#choose-output');
      await page.selectOption('#profile', pass.id);
      if (pass.archive) await page.click('#archive-quality');
      else { await page.selectOption('#preset', pass.preset); await page.fill('#quality', String(pass.quality)); }
      // Poll from Node (an async waitForFunction predicate would resolve at once).
      if (pass.archive) {
        const until = Date.now() + 15000; let p;
        do {
          p = await bounded(page.evaluate(() => window.encoder.getPreferences()));
          const v = p.settingsByProfile[pass.id];
          if (p.profileId === pass.id && v?.preset === pass.preset && v?.quality === pass.quality && v?.recipeId === pass.archive) break;
          await new Promise(r => setTimeout(r, 150));
        } while (Date.now() < until);
        assert.deepEqual([p.profileId, p.settingsByProfile[pass.id]?.preset, p.settingsByProfile[pass.id]?.quality, p.settingsByProfile[pass.id]?.recipeId],
          [pass.id, pass.preset, pass.quality, pass.archive], 'Archive Quality preference was not saved.');
      }
      await page.click('#prepare-batch');
      const ready = await waitState(page, s => s.phase === 'ready' && s.planId !== lastPlan, 120000);
      lastPlan = ready.planId;
      assert(ready.items.length === 2 && ready.items.every(it => it.status === 'ready'), JSON.stringify(ready.items));
      assert.deepEqual([ready.settings.profileId, ready.settings.preset, ready.settings.quality], [pass.id, pass.preset, pass.quality]);
      if (pass.archive) assert.equal(ready.settings.recipeId, pass.archive);
      phase = `encode-${i + 1}`;
      await page.click('#start-batch');
      const done = await waitState(page, s => s.phase === 'completed', 300000);
      assert.equal(done.counts.success, 2, JSON.stringify(done.items.map(it => [it.name, it.status, it.reason])).slice(0, 3000));
      assert.equal(done.items.length, 2);
      const calls = (await bounded(app.evaluate(() => globalThis.__betaSmoke))).slice(callsSeen);
      callsSeen += calls.length;
      assert(calls.length && calls.every(c => [rf, rp].includes(normalize(c.exe))));
      const encodes = calls.filter(c => c.encode);
      assert.equal(encodes.length, 2);
      for (const c of encodes) {
        assert.equal(normalize(c.exe), rf);
        const arg = flag => { const k = c.argv.indexOf(flag); return k < 0 ? undefined : c.argv[k + 1]; };
        assert.equal(arg('-c:v:0'), pass.encoder, JSON.stringify(c.argv));
        assert.equal(arg('-preset:v:0'), pass.preset, JSON.stringify(c.argv));
        assert.equal(arg('-cq:v:0'), String(pass.quality), JSON.stringify(c.argv));
        if (pass.archive) for (const [flag, value] of ARCHIVE_FLAGS) assert.equal(arg(flag), value, `${flag} in ${JSON.stringify(c.argv)}`);
        else { assert.equal(arg('-tune:v:0'), 'hq', JSON.stringify(c.argv)); assert.equal(arg('-multipass:v:0'), undefined, JSON.stringify(c.argv)); }
      }
      phase = `readback-${i + 1}`;
      const outputs = [];
      for (const item of done.items) {
        // 0.6 snapshots report status and outputName (encoder-service.cjs:508), not a disposition.
        assert.equal(item.status, 'success');
        assert.equal(item.outputName, path.parse(item.name).name + '_' + pass.suffix + '.mkv');
        const output = path.join(dir(outs[i]), item.outputName);
        const src = sources.find(s => path.basename(s.file) === item.name); assert(src, item.name);
        const pin = await digest(output);
        assert(pin.size > 0 && pin.size < 64 * 1024 * 1024);
        const video = checkProbe((await run(binary('ffprobe'), ['-v', 'error', '-count_frames', '-show_entries',
          'stream=codec_type,codec_name,profile,width,height,pix_fmt,color_primaries,color_transfer,color_space,nb_read_frames', '-of', 'json', output])).stdout, pass.codec, src.depth);
        await run(binary('ffmpeg'), ['-nostdin', '-v', 'error', '-xerror', '-i', output, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
        outputs.push({ name: path.basename(output), sourceDepth: src.depth, ...video, ...pin });
      }
      report.passes.push({ profile: pass.id, recipe: pass.archive || 'tested-default-values', encoder: pass.encoder, preset: pass.preset, quality: pass.quality,
        argv: encodes.map(c => c.argv), outputs });
    }
    for (const s of sources) assert.deepEqual(await digest(s.file), s.pin);
    assert.equal(errors.length, 0);
    phase = 'close';
    await close();
    phase = 'relaunch';
    const again = await window(electron);
    const pref = await bounded(again.evaluate(() => window.encoder.getPreferences()));
    assert.equal(pref.profileId, 'h265-nvidia');
    const kept = id => { const v = pref.settingsByProfile[id] || {}; return [v.preset, v.quality, v.recipeId]; };
    assert.deepEqual(kept('h265-nvidia'), ['p7', 29, 'archive-quality-hevc-v1']);
    assert.deepEqual(kept('h264-nvidia'), ['p6', 27, undefined]);
    assert.deepEqual(kept('av1-nvidia'), ['p6', 31, undefined]);
    await close();
    assert.deepEqual(await digest(executable), appPin);
    assert.deepEqual(await digest(path.join(appRoot, 'resources', 'app.asar')), asarPin);
    report.status = 'passed';
    phase = 'complete';
  } catch (err) {
    report.failure = { phase, code: err?.code === 'ERR_ASSERTION' ? 'ERR_ASSERTION' : 'SMOKE_FAILED', message: String(err?.message).slice(0, 4000) };
    console.error('GPU smoke failed:', phase, err.message);
    if (app) try { await close(); } catch { report.close = 'unconfirmed'; }
    throw err;
  } finally {
    report.finished = new Date().toISOString();
    await fs.writeFile(path.join(work, 'gpu-smoke.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  }
  console.log('Packaged NVIDIA smoke passed: 4 passes, 8 encodes');
}
module.exports = { parse, contains, checkProbe, scratchRoot };
if (require.main === module) smoke(parse(process.argv.slice(2))).catch(() => { process.exitCode = 1; });
