const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron } = require('playwright');
const { ENTRY_URL, CSP } = require('../src/local-protocol.cjs');

async function main() {
  const root = path.resolve(__dirname, '..');
  const artifacts = path.join(root, 'artifacts', `protocol-smoke-${Date.now()}`);
  await fs.mkdir(artifacts, { recursive: true });
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'), args: [root, `--user-data-dir=${path.join(artifacts, 'user-data')}`], cwd: root, env });
  const checks = [];
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 60000 });
    assert.equal(page.url(), ENTRY_URL);
    // Main-side fetch deliberately bypasses renderer CSP to exercise the session
    // request filter and protocol handler themselves, not just browser policy.
    const assets = await app.evaluate(async ({ session }) => {
      const result = [];
      for (const name of ['index.html', 'styles.css', 'renderer.js']) {
        const response = await session.fromPartition('encoder-local').fetch(`app://encoder/${name}`);
        result.push({ name, status: response.status, csp: response.headers.get('content-security-policy'), nosniff: response.headers.get('x-content-type-options'), bytes: (await response.text()).length });
      }
      return result;
    });
    for (const asset of assets) { assert.equal(asset.status, 200); assert.equal(asset.csp, CSP); assert.equal(asset.nosniff, 'nosniff'); assert.ok(asset.bytes > 100); }
    checks.push('native app origin serves exactly the UI assets with response CSP and nosniff');
    const attempts = await app.evaluate(async ({ session }) => {
      const urls = ['app://encoder/main.js', 'app://encoder/preload.js', 'app://encoder/%2e%2e/main.js', 'app://encoder/%252e%252e/main.js', 'app://encoder/index.html?extra=1', 'app://other/index.html', 'file:///C:/Windows/win.ini', 'http://127.0.0.1:9/blocked', 'https://example.invalid/blocked'];
      const results = [];
      for (const url of urls) {
        try { const response = await session.fromPartition('encoder-local').fetch(url); results.push({ url, blocked: !response.ok, status: response.status }); }
        catch (error) { results.push({ url, blocked: true, reason: error.message }); }
      }
      try { await session.fromPartition('encoder-local').fetch('app://encoder/index.html', { method: 'POST' }); results.push({ method: 'POST', blocked: false }); }
      catch (error) { results.push({ method: 'POST', blocked: true, reason: error.message }); }
      return results;
    });
    assert.ok(attempts.every(attempt => attempt.blocked), JSON.stringify(attempts));
    checks.push('session denies private source files, traversal, extra URL components, external/local file requests and POST');
    const policy = await page.evaluate(async () => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', event => violations.push(event.violatedDirective));
      const script = document.createElement('script'); script.textContent = 'window.untrustedInlineExecuted = true'; document.body.append(script);
      const button = document.createElement('button'); button.setAttribute('onclick', 'window.untrustedHandlerExecuted = true'); document.body.append(button); button.click();
      const iframe = document.createElement('iframe'); iframe.src = 'app://encoder/index.html'; document.body.append(iframe);
      let fetchDenied = false; try { await fetch('app://encoder/renderer.js'); } catch { fetchDenied = true; }
      const popup = window.open('app://encoder/index.html');
      const permission = await Notification.requestPermission();
      await new Promise(resolve => setTimeout(resolve, 150));
      return { inline: Boolean(window.untrustedInlineExecuted), handler: Boolean(window.untrustedHandlerExecuted), fetchDenied, popupDenied: popup === null, permission, violations };
    });
    assert.equal(policy.inline, false); assert.equal(policy.handler, false); assert.equal(policy.fetchDenied, true); assert.equal(policy.popupDenied, true); assert.equal(policy.permission, 'denied');
    assert.ok(policy.violations.some(value => value.startsWith('frame-src')), JSON.stringify(policy));
    checks.push('renderer CSP blocks inline scripts, event handlers, frames and fetch; popups and notification permission denied');
    await app.evaluate(({ BrowserWindow }) => {
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      globalThis.navigationProof = [];
      for (const name of ['will-frame-navigate', 'will-navigate']) contents.on(name, event => globalThis.navigationProof.push({ name, prevented: event.defaultPrevented }));
    });
    await page.evaluate(() => { const link = document.createElement('a'); link.href = 'app://encoder/styles.css'; document.body.append(link); link.click(); });
    await page.waitForTimeout(150);
    assert.equal(page.url(), ENTRY_URL);
    const navigation = await app.evaluate(() => globalThis.navigationProof);
    assert.ok(navigation.length > 0 && navigation.every(event => event.prevented), JSON.stringify(navigation));
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 1);
    checks.push('renderer navigation is cancelled before leaving the trusted entry and no extra window is created');
    const report = { time: new Date().toISOString(), artifacts, checks, assets, attempts, policy, limitations: ['Sender-frame and payload rejection are covered by the IPC unit/integration suite; this suite exercises the real Chromium/session boundary.'] };
    await fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
