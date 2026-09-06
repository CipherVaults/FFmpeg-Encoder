// Exercise the historical app through real Electron and FFmpeg. Native folder
// dialogs are substituted at the OS boundary; clicks and IPC still run for real.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron } = require('playwright');

async function main() {
  const root = path.resolve(__dirname, '..');
  const label = process.argv[2] || 'legacy-baseline';
  const artifacts = path.join(root, 'artifacts', label, String(Date.now()));
  const input = path.join(artifacts, 'input');
  const output = path.join(artifacts, 'output');
  await fs.mkdir(input, { recursive: true });
  await fs.mkdir(output, { recursive: true });
  const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
  const run = (args) => execFileSync(ffmpeg, args, { windowsHide: true, timeout: 60000, maxBuffer: 8 * 1024 * 1024 }).toString();
  // All media used here is generated and isolated from Ahmed's original videos.
  run(['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=24:duration=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-c:a', 'aac', '-shortest', '-n', path.join(input, 'A fixture.mp4')]);
  await fs.copyFile(path.join(input, 'A fixture.mp4'), path.join(input, 'B fixture.mp4'));
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${path.join(artifacts, 'user-data')}`], cwd: root, env, timeout: 45000 });
  const errors = [];
  try {
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForSelector('#start-encoding-btn');
    await app.evaluate(({ dialog }, folders) => {
      let index = 0;
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folders[index++]] });
    }, [input, output]);
    await page.click('#select-input-btn');
    await page.click('#select-output-btn');
    assert.equal(await page.textContent('#input-path'), input);
    assert.equal(await page.textContent('#output-path'), output);
    await page.screenshot({ path: path.join(artifacts, 'setup.png'), fullPage: true });
    await page.click('#start-encoding-btn');
    await page.waitForFunction(() => document.querySelector('#completed-container').style.display === 'block', { timeout: 90000 });
    assert.equal((await page.textContent('#completed-files')).trim(), '2');
    assert.equal(await page.isDisabled('#start-encoding-btn'), false);
    const outputs = (await fs.readdir(output)).sort();
    assert.deepEqual(outputs, ['A fixture_H265-CPU.mkv', 'B fixture_H265-CPU.mkv']);
    for (const filename of outputs) run(['-v', 'error', '-i', path.join(output, filename), '-f', 'null', '-']);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: path.join(artifacts, 'completed.png'), fullPage: true });
    const report = {
      label, time: new Date().toISOString(), artifacts,
      versions: await app.evaluate(() => process.versions),
      ffmpeg: run(['-version']).split('\n')[0].trim(),
      outputs, checks: ['real window loaded', 'folder button/IPC selection with dialog substitution', 'two sequential real H265 encodes', 'completed count and enabled Start', 'full output decode', 'no page errors'],
      limitations: ['Native folder picker interaction is not tested.', 'Known legacy defects are characterized separately; this smoke test asserts only successful flow.'],
    };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await app.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
