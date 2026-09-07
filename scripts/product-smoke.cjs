const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');
const { PROFILES } = require('../src/media.cjs');
const { inspectInput, validateOutput } = require('../src/inspection.cjs');
const { createRichFixture } = require('./test-fixtures.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts', `product-smoke-${Date.now()}`);
  const input = path.join(artifacts, 'profile inputs');
  const mixed = path.join(artifacts, 'mixed inputs');
  const output = path.join(artifacts, 'outputs');
  for (const folder of [input, mixed, output]) await fs.mkdir(folder, { recursive: true });
  const ffmpeg = path.join(root, 'ffmpeg/ffmpeg.exe');
  const ffprobe = path.join(root, 'ffmpeg/ffprobe.exe');
  const fixture = async (file, { bits = 8, transfer = 'bt709', primaries = 'bt709', matrix = 'bt709', duration = 2, size = '320x180' } = {}) => {
    await runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}:rate=24:duration=${duration},setparams=color_primaries=${primaries}:color_trc=${transfer}:colorspace=${matrix}:range=limited`, '-c:v', 'ffv1', '-pix_fmt', bits === 10 ? 'yuv420p10le' : 'yuv420p', '-color_primaries', primaries, '-color_trc', transfer, '-colorspace', matrix, '-color_range', 'tv', '-n', file]);
  };
  await fixture(path.join(input, '8 bit.mkv'));
  await fixture(path.join(input, '10 bit.mkv'), { bits: 10 });
  const richName = `Rich العربية & [preserved] ${'long filename '.repeat(5)}.mkv`;
  await createRichFixture(ffmpeg, path.join(artifacts, 'fixture resources'), path.join(mixed, richName));
  await fixture(path.join(mixed, 'BT2020 SDR.mkv'), { bits: 10, transfer: 'bt2020-10', primaries: 'bt2020', matrix: 'bt2020nc' });
  await fixture(path.join(mixed, 'PQ HDR.mkv'), { bits: 10, transfer: 'smpte2084', primaries: 'bt2020', matrix: 'bt2020nc' });
  await fixture(path.join(mixed, 'HLG HDR.mkv'), { bits: 10, transfer: 'arib-std-b67', primaries: 'bt2020', matrix: 'bt2020nc' });
  await fs.copyFile(path.join(input, '8 bit.mkv'), path.join(mixed, 'Collision.mkv'));
  await fs.copyFile(path.join(input, '8 bit.mkv'), path.join(mixed, 'Collision.mp4'));
  await fs.copyFile(path.join(input, '8 bit.mkv'), path.join(mixed, 'Existing.mkv'));
  await fs.writeFile(path.join(mixed, 'Corrupt.mp4'), 'Deliberately invalid media.');
  await fs.writeFile(path.join(artifacts, 'captions.srt'), '1\n00:00:00,000 --> 00:00:01,500\nUnsupported MP4 subtitle copy\n');
  await runTool(ffmpeg, ['-v', 'error', '-i', path.join(input, '8 bit.mkv'), '-i', path.join(artifacts, 'captions.srt'), '-map', '0:v', '-map', '1:s', '-c:v', 'libx264', '-c:s', 'mov_text', '-n', path.join(mixed, 'Unsupported subtitle.mp4')]);
  await runTool(ffmpeg, ['-v', 'error', '-i', path.join(input, '8 bit.mkv'), '-f', 'lavfi', '-i', 'testsrc2=size=160x96:rate=24:duration=2,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited', '-map', '0:v', '-map', '1:v', '-c:v', 'ffv1', '-color_primaries:v', 'bt709', '-color_trc:v', 'bt709', '-colorspace:v', 'bt709', '-color_range:v', 'tv', '-disposition:v:0', '0', '-disposition:v:1', 'default', '-n', path.join(mixed, 'Alternate primary.mkv')]);
  const existing = path.join(output, 'Existing_H264-CPU.mkv');
  await fs.writeFile(existing, 'Existing output must remain byte-identical.');
  const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const hashes = {};
  for (const folder of [input, mixed]) for (const name of await fs.readdir(folder)) hashes[path.join(folder, name)] = await hash(path.join(folder, name));
  hashes[existing] = await hash(existing);
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${path.join(artifacts, 'user-data')}`], cwd: root, env });
  const checks = [], cases = [], layouts = [], errors = [];
  let page;
  const waitSnapshot = async predicate => {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      const state = await page.evaluate(() => window.encoder.getSnapshot());
      if (predicate(state)) return state;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    throw Error('Application state timed out.');
  };
  try {
    page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => !document.querySelector('#profile').disabled, undefined, { timeout: 60000 });
    await page.evaluate(() => { window.testProgress = []; window.encoder.onUpdate(state => { if (state.phase === 'running' && state.progress) window.testProgress.push(state.progress); }); });
    // Observe arguments at the real service/runner boundary without replacing the
    // process runner or the codec. This instrumentation lives only in the harness.
    await app.evaluate(({ app }, modulePath) => {
      const { EncoderService } = process.getBuiltinModule('module').createRequire(modulePath)(modulePath);
      const execute = EncoderService.prototype.execute;
      globalThis.encodeCommands = [];
      EncoderService.prototype.execute = function (...args) {
        if (!this.testObserved) {
          const run = this.run;
          this.run = (exe, argv, options) => { if (options?.onProgress) globalThis.encodeCommands.push({ exe, argv }); return run(exe, argv, options); };
          this.testObserved = true;
        }
        return execute.apply(this, args);
      };
    }, path.join(root, 'src/encoder-service.cjs'));
    const selectFolders = async folder => {
      await app.evaluate(({ dialog }, folders) => { let i = 0; dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folders[i++]] }); }, [folder, output]);
      await page.click('#choose-input'); await page.click('#choose-output');
    };
    const setSettings = async profile => {
      await page.selectOption('#profile', profile.id);
      const preset = profile.hardware === 'NVIDIA' ? 'p4' : profile.id === 'av1-cpu' ? '9' : 'veryfast';
      const settings = { profileId: profile.id, preset, quality: profile.quality.default + 1 };
      await page.selectOption('#preset', preset); await page.fill('#quality', String(settings.quality));
      return settings;
    };
    await selectFolders(input);
    for (const profile of PROFILES) {
      const settings = await setSettings(profile);
      await page.click('#prepare-batch');
      const ready = await waitSnapshot(state => state.phase === 'ready');
      assert.deepEqual(ready.settings, settings); assert.ok(ready.items.every(item => item.status === 'ready'), JSON.stringify(ready));
      assert.match(await page.textContent('#effective-settings'), new RegExp(`preset ${settings.preset}.*${profile.quality.mode} ${settings.quality}`));
      await page.click('#start-batch');
      const finished = await waitSnapshot(state => ['completed', 'failed'].includes(state.phase));
      assert.equal(finished.counts.success, 2, JSON.stringify(finished));
      for (const item of finished.items) await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', path.join(output, item.outputName), '-f', 'null', '-']);
      const commands = await app.evaluate(() => globalThis.encodeCommands.slice(-2));
      for (const { argv } of commands) {
        assert.equal(argv[argv.findIndex(arg => /^-preset(?::|$)/.test(arg)) + 1], settings.preset);
        const qualityFlag = profile.hardware === 'NVIDIA' ? /^-cq(?::|$)/ : /^-crf(?::|$)/;
        assert.equal(argv[argv.findIndex(arg => qualityFlag.test(arg)) + 1], String(settings.quality));
        assert.equal(argv[argv.indexOf('-c:v:0') + 1], profile.encoder);
      }
      cases.push({ settings, counts: finished.counts, commands });
      await page.click('#new-batch');
    }
    checks.push('all six UI profiles propagate changed quality/preset to real commands and complete 8/10-bit queue outputs with full decoding');
    await selectFolders(mixed); const settings = await setSettings(PROFILES[0]);
    await page.click('#prepare-batch'); const ready = await waitSnapshot(state => state.phase === 'ready');
    assert.equal(ready.items.filter(item => item.status === 'unsupported').length, 4, JSON.stringify(ready));
    assert.equal(ready.items.filter(item => item.status === 'skipped').length, 1);
    const conflicts = ready.items.filter(item => item.status === 'conflict'); assert.equal(conflicts.length, 2);
    await page.check(`input[data-file-id="${conflicts[0].id}"]`);
    await page.check(`input[data-file-id="${conflicts[1].id}"]`);
    assert.equal(await page.isChecked(`input[data-file-id="${conflicts[0].id}"]`), false);
    assert.equal(await page.isChecked(`input[data-file-id="${conflicts[1].id}"]`), true);
    const cdp = await page.context().newCDPSession(page);
    const captureLayouts = async phase => {
      // Chromium device emulation exercises actual DOM/CSS under explicit CSS
      // viewport and device-scale combinations; it does not change Windows DPI.
      for (const [label, width, height, scale] of [['720p', 1280, 720, 1], ['desktop', 1920, 1080, 1], ['4k', 3840, 2160, 1], ['4k-200pct', 1920, 1080, 2], ['small-150pct', 854, 480, 1.5]]) {
        await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: scale, mobile: false });
        const metrics = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, controls: [...document.querySelectorAll('button,select,input')].filter(el => el.getClientRects().length).map(el => ({ id: el.id, left: el.getBoundingClientRect().left, right: el.getBoundingClientRect().right, width: el.getBoundingClientRect().width })) }));
        assert.ok(metrics.scrollWidth <= metrics.width + 1, JSON.stringify({ label, phase, metrics }));
        assert.ok(metrics.controls.every(control => control.left >= 0 && control.right <= metrics.width + 1 && control.width > 0));
        const image = `${phase}-${label}.png`; await page.screenshot({ path: path.join(artifacts, image), fullPage: true, scale: 'css' });
        layouts.push({ phase, label, width, height, scale, image, metrics });
      }
    };
    await captureLayouts('preview');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await page.click('#start-batch');
    const finished = await waitSnapshot(state => ['completed', 'failed'].includes(state.phase));
    assert.deepEqual(finished.counts, { success: 4, failed: 4, skipped: 1, cancelled: 0, unprocessed: 1 }, JSON.stringify(finished));
    for (const item of finished.items.filter(item => item.status === 'success')) {
      const source = await inspectInput(path.join(mixed, item.name), { ffprobe });
      const result = await runTool(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-show_data_hash', 'sha256', '-of', 'json', path.join(output, item.outputName)]);
      const probe = JSON.parse(result.stdout); const validation = validateOutput(source, probe, settings);
      assert.equal(validation.valid, true, JSON.stringify(validation));
      if (item.name.startsWith('Alternate')) { assert.equal(probe.streams.filter(stream => stream.codec_type === 'video').length, 1); assert.equal(probe.streams[0].width, 160); }
      await runTool(ffmpeg, ['-v', 'error', '-xerror', '-i', path.join(output, item.outputName), '-f', 'null', '-']);
    }
    checks.push('mixed batch preserves rich tracks/chapters/attachments and BT2020 SDR, selects default primary video, rejects PQ/HLG/corrupt/unsupported subtitles, and resolves same-stem selection');
    for (const [file, before] of Object.entries(hashes)) assert.equal(await hash(file), before, file);
    checks.push('all source and pre-existing output SHA256 values remain unchanged');
    await captureLayouts('results');
    const progress = await page.evaluate(() => window.testProgress);
    assert.ok(progress.some(item => item.seconds > 0 && item.bytes > 0 && Number.isFinite(item.percent)), JSON.stringify(progress));
    checks.push('real main-owned progress includes elapsed media time, size and determinate percentage');
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await page.click('#new-batch'); await page.click('#prepare-batch');
    const again = await waitSnapshot(state => state.phase === 'ready');
    assert.equal(again.items.filter(item => item.status === 'skipped').length, 6);
    assert.equal(await page.isEnabled('#start-batch'), false);
    assert.match(await page.textContent('#preview-message'), /Nothing to encode/);
    assert.deepEqual(errors, []);
    const report = { time: new Date().toISOString(), artifacts, checks, cases, mixed: { ready, finished, again }, layouts, progress, errors, limitations: ['Dialog returns are substituted; native picker has separate verification.', 'DPI matrix uses Chromium device emulation, not a global Windows DPI change.', 'Dolby Vision/HDR10+ detection uses structured metadata tests; these generated real fixtures cover PQ and HLG.'] };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ artifacts, checks, cases: cases.length, layouts: layouts.length }, null, 2));
  } catch (error) {
    if (page && !page.isClosed()) { console.error(await page.evaluate(() => window.encoder.getSnapshot())); await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }); }
    throw error;
  } finally {
    if (page && !page.isClosed()) await page.evaluate(async () => { const state = await window.encoder.getSnapshot(); if (state.batchId) await window.encoder.cancelBatch({ batchId: state.batchId }); }).catch(() => {});
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
