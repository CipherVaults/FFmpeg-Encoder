const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveAsset, ENTRY_URL, CSP } = require('../src/local-protocol.cjs');

test('protocol exposes exactly the three UI assets with no filesystem routing', () => {
  assert.equal(resolveAsset(ENTRY_URL).name, 'index.html');
  assert.equal(resolveAsset('app://encoder/renderer.js').name, 'renderer.js');
  assert.equal(resolveAsset('app://encoder/styles.css').name, 'styles.css');
  for (const url of [
    'app://encoder/../main.js', 'app://encoder/%2e%2e/main.js', 'app://encoder/%252e%252e/main.js',
    'app://encoder/main.js', 'app://encoder/preload.js', 'app://encoder/index.html?file=secret',
    'app://encoder/index.html#fragment', 'app://user@encoder/index.html', 'app://encoder:99/index.html',
    'app://other/index.html', 'file:///C:/Windows/win.ini', 'https://example.invalid/',
    'app://encoder/%69ndex.html', 'app://encoder/index.html/extra', 'app://encoder/',
  ]) assert.equal(resolveAsset(url), null, url);
  for (const method of ['POST', 'PUT', 'DELETE', 'HEAD']) assert.equal(resolveAsset(ENTRY_URL, method), null);
});
test('response policy disallows network, inline execution, object/frame embedding and base URL changes', () => {
  assert.match(CSP, /connect-src 'none'/);
  assert.match(CSP, /frame-ancestors 'none'/);
  assert.match(CSP, /base-uri 'none'/);
  assert.equal(CSP.includes('unsafe-inline'), false);
  assert.equal(CSP.includes('unsafe-eval'), false);
});
