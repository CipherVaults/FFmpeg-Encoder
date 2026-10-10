'use strict';

// A presentation adapter for the sealed review pack, not a second review pack.
// The original page/data/assets stay untouched. Only the existing interface is
// rendered anew, with neutral URLs and a narrowly allowlisted local-player action.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawn, execFile } = require('node:child_process');
const { reviewHtml, assetPath } = require('./benchmark-lab-review.cjs');

const ROOT = path.resolve(__dirname, '..');
const CAMPAIGN = path.join(ROOT, 'artifacts', 'phase1-2026-10-10');
const BUNDLE = path.join(CAMPAIGN, 'calibration-review-0d206bb1-df49-4ce4-9961-647827959c6d');
const SEAL = '5bd8934b4dc7366b2787d5cfd8571133c047969fc4579bd1c95232167622f406';
const PORT = 48186;
const PLAYER = 'C:\\Program Files (x86)\\K-Lite Codec Pack\\MPC-HC64\\mpc-hc64.exe';
const SCENES = ['cd-b', 'e33-a', 'fh5-a', 'acc-a', 'desk-b', 'sf-b'];
const APP = 'ffmpeg-visual-review';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');

function loadReview(bundle = BUNDLE, expectedSeal = SEAL) {
  const manifestBytes = fs.readFileSync(path.join(bundle, 'review-manifest.json'));
  assert.equal(sha(manifestBytes), expectedSeal, 'The sealed review manifest changed.');
  const manifest = JSON.parse(manifestBytes);
  const original = fs.readFileSync(path.join(bundle, 'index.html'), 'utf8');
  const indexSeal = manifest.files.find(file => file.path === 'index.html');
  assert.ok(indexSeal, 'Missing original interface seal.');
  assert.equal(sha(original), indexSeal.sha256, 'The sealed review interface changed.');
  const encoded = original.match(/<script>const pack=(.*?);let groupIndex=/s);
  assert.ok(encoded, 'Cannot read the existing review data.');
  const pack = JSON.parse(encoded[1]);
  assert.deepEqual(pack.groups.map(group => group.id).sort(), [...SCENES].sort());
  const assets = new Map();
  const clips = new Map();
  const realBundle = fs.realpathSync(bundle);
  function mapAsset(publicPath, relative) {
    assetPath(relative);
    const filename = fs.realpathSync(path.join(bundle, relative));
    assert.ok(filename.startsWith(realBundle + path.sep), 'Asset escaped the sealed bundle.');
    const seal = manifest.files.find(file => file.path === relative);
    assert.ok(seal && fs.statSync(filename).size === seal.bytes, 'Asset missing or size changed.');
    assets.set('/' + publicPath, { filename, bytes: seal.bytes, sha256: seal.sha256 });
    return publicPath;
  }
  const groups = SCENES.map(id => {
    const group = pack.groups.find(item => item.id === id);
    assert.ok(Number.isInteger(group.width) && Number.isInteger(group.height));
    assert.ok(group.frameIndices.every(Number.isInteger));
    const entries = group.entries.map((entry, index) => {
      assert.match(entry.label, /^(Captured source|x265 reference|Candidate [A-G])$/);
      const neutral = entry.label === 'Captured source' ? 'source' : entry.label === 'x265 reference'
        ? 'reference' : entry.label.toLowerCase().replace(' ', '-');
      const prefix = `media/${id}/${neutral}`;
      const clip = mapAsset(`${prefix}/motion.mkv`, entry.clip);
      clips.set(`${id}:${index}`, assets.get('/' + clip).filename);
      return { label: entry.label, clip, images: entry.images.map((image, frame) =>
        mapAsset(`${prefix}/frame-${frame}.png`, image)) };
    });
    return { id, title: group.title, context: group.context, width: group.width, height: group.height,
      frameIndices: group.frameIndices, entries };
  });
  return { pack: { groups }, assets, clips, seal: expectedSeal };
}

function byteRange(header, size) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  let start, end;
  if (!match[1]) { const length = Number(match[2]); if (!Number.isSafeInteger(length) || length <= 0) return null;
    start = Math.max(0, size - length); end = size - 1;
  } else { start = Number(match[1]); end = match[2] ? Number(match[2]) : size - 1; }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= size || end < start) return null;
  return { start, end: Math.min(end, size - 1), partial: true };
}

function createServer(review, options = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  const player = options.player ?? PLAYER;
  const playerAvailable = !!player && fs.existsSync(player);
  const pack = { ...review.pack, access: { csrfToken: token, playerAvailable } };
  const html = reviewHtml(pack);
  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
  const scriptHash = crypto.createHash('sha256').update(script || '').digest('base64');
  let lastRequest = Date.now();
  const server = http.createServer(async (req, res) => {
    lastRequest = Date.now();
    const origin = `http://127.0.0.1:${server.address().port}`;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self'; media-src 'self'; connect-src 'self'; script-src 'sha256-${scriptHash}'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`);
    if (req.headers.host !== `127.0.0.1:${server.address().port}`) { res.writeHead(403); res.end('Local access only.'); return; }
    const route = req.url;
    if ((req.method === 'GET' || req.method === 'HEAD') && route === '/health') {
      res.setHeader('Content-Type', 'application/json');
      res.end(req.method === 'HEAD' ? '' : JSON.stringify({ app: APP, seal: review.seal, pid: process.pid })); return;
    }
    if ((req.method === 'GET' || req.method === 'HEAD') && (route === '/' || route === '/index.html')) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(req.method === 'HEAD' ? '' : html); return;
    }
    if (route === '/player' && req.method === 'POST') {
      if (!playerAvailable || req.headers.origin !== origin || req.headers['content-type'] !== 'application/json') {
        res.writeHead(403); res.end('Use the local review page.'); return;
      }
      let body = '';
      try {
        for await (const chunk of req) { body += chunk; if (body.length > 2048) throw new Error('Request too large.'); }
        const input = JSON.parse(body);
        assert.equal(input.token, token);
        assert.equal(typeof input.sceneId, 'string'); assert.ok(Number.isInteger(input.entryIndex));
        const filename = review.clips.get(`${input.sceneId}:${input.entryIndex}`);
        assert.ok(filename, 'Only existing labeled clips are allowed.');
        // Never accept a filename, executable or process argument from the browser.
        const child = (options.launchPlayer || spawn)(player, [filename, '/new', '/play'],
          { detached: true, stdio: 'ignore', windowsHide: false });
        await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
        child.unref();
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ opened: true }));
      } catch { res.writeHead(400); res.end('Could not open the selected clip.'); }
      return;
    }
    const asset = review.assets.get(route);
    if (asset && (req.method === 'GET' || req.method === 'HEAD')) {
      const range = byteRange(req.headers.range, asset.bytes);
      if (!range) { res.writeHead(416, { 'Content-Range': `bytes */${asset.bytes}` }); res.end(); return; }
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Content-Type', route.endsWith('.png') ? 'image/png' : 'video/x-matroska');
      res.setHeader('Content-Length', range.end - range.start + 1);
      if (range.partial) res.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${asset.bytes}`);
      res.writeHead(range.partial ? 206 : 200);
      if (req.method === 'HEAD') { res.end(); return; }
      const stream = fs.createReadStream(asset.filename, { start: range.start, end: range.end });
      stream.on('error', () => res.destroy()); res.on('close', () => stream.destroy()); stream.pipe(res); return;
    }
    res.writeHead(404); res.end('Not available in the blind review.');
  });
  // No startup registration or persistent service. Clicking the shortcut starts
  // this helper again; idle use ends naturally without touching benchmark state.
  const timer = setInterval(() => { if (Date.now() - lastRequest > 2 * 60 * 60 * 1000) server.close(); }, 60000);
  timer.unref(); server.once('close', () => clearInterval(timer));
  return server;
}

function openBrowser(url) {
  assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
  return new Promise((resolve, reject) => execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command',
    `Start-Process -FilePath '${url}'`], { windowsHide: true }, error => error ? reject(error) : resolve()));
}

async function main() {
  const state = JSON.parse(fs.readFileSync(path.join(CAMPAIGN, 'state.json')));
  assert.equal(state.humanReview.status, 'awaiting-calibration-judgment', 'This shortcut is for the current visual-review gate.');
  const base = `http://127.0.0.1:${PORT}/`;
  let existing;
  try { const response = await fetch(base + 'health', { signal: AbortSignal.timeout(1500) }); existing = await response.json(); }
  catch { /* No established helper; bind only the specific loopback port below. */ }
  if (existing?.app === APP && existing.seal === SEAL) { if (process.argv.includes('--open')) await openBrowser(base); return; }
  const review = loadReview();
  const server = createServer(review);
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(PORT, '127.0.0.1', resolve); });
  console.log(JSON.stringify({ app: APP, url: base, pid: process.pid, assets: review.assets.size }));
  if (process.argv.includes('--open')) await openBrowser(base);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { loadReview, byteRange, createServer, PORT, BUNDLE, SEAL };
