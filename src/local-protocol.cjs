const fs = require('node:fs/promises');
const path = require('node:path');

const ENTRY_URL = 'app://encoder/index.html';
const CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-src 'none'; frame-ancestors 'none'";
const ASSETS = new Map([
  [ENTRY_URL, { name: 'index.html', type: 'text/html; charset=utf-8' }],
  ['app://encoder/styles.css', { name: 'styles.css', type: 'text/css; charset=utf-8' }],
  ['app://encoder/renderer.js', { name: 'renderer.js', type: 'text/javascript; charset=utf-8' }],
]);

function resolveAsset(url, method = 'GET') {
  // Exact canonical URLs, not a general filesystem router. No decoding, joining
  // user paths, query parameters, credentials, ports, or directory fallback.
  return method === 'GET' && typeof url === 'string' ? ASSETS.get(url) || null : null;
}

function registerLocalProtocol(protocol, uiRoot) {
  protocol.handle('app', async request => {
    const asset = resolveAsset(request.url, request.method);
    if (!asset) return new Response('Not found', { status: 404 });
    try {
      return new Response(await fs.readFile(path.join(uiRoot, asset.name)), { headers: {
        'Content-Type': asset.type, 'Content-Security-Policy': CSP,
        'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
      } });
    } catch {
      return new Response('Application asset unavailable', { status: 404 });
    }
  });
}
module.exports = { ENTRY_URL, CSP, resolveAsset, registerLocalProtocol };
