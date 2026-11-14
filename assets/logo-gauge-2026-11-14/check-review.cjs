'use strict';
// Bounded offline artwork QA. This launches a hidden reviewer, not the app.
// No installation, network access or writes outside this folder except OS-temp state.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { sizes, colours, contrastRows, writePreview, geometry, appName } = require('./make-gauge.cjs');
const dir = __dirname;
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const allowedTags = new Set(['svg', 'title', 'desc', 'path', 'g', 'text']);
const allowedAttrs = new Set(['xmlns', 'width', 'height', 'viewBox', 'role', 'aria-label', 'd', 'fill', 'fill-rule', 'data-part', 'stroke', 'stroke-width', 'stroke-linejoin', 'transform', 'x', 'y', 'font-family', 'font-size', 'font-weight', 'letter-spacing']);
const allowedPaint = new Set([...Object.values(colours), 'currentColor']);
function auditSvg(source) {
  assert(!/<!DOCTYPE|<!ENTITY/i.test(source), 'DTD/entities refused');
  assert(!/<\?/.test(source), 'processing instructions refused');
  assert(!/\b(?:href|src)\s*=|url\s*\(/i.test(source), 'references refused');
  assert(!/\bon[a-z]+\s*=/i.test(source), 'events refused');
  assert(!/\bstyle\s*=/i.test(source), 'style refused');
  for (const match of source.matchAll(/<\/?([\w:-]+)\b/g)) assert(allowedTags.has(match[1]), `element refused: ${match[1]}`);
  for (const match of source.matchAll(/\s([\w:-]+)\s*=/g)) assert(allowedAttrs.has(match[1]), `attribute refused: ${match[1]}`);
  for (const match of source.matchAll(/\b(?:fill|stroke)="([^"]+)"/g)) assert(allowedPaint.has(match[1]), `paint refused: ${match[1]}`);
}
function auditPreview(html) {
  assert(!/<(?:script|link|iframe|object|embed)\b/i.test(html), 'active page elements refused');
  assert(!/\bon[a-z]+\s*=|url\s*\(/i.test(html), 'page event handlers and CSS references refused');
  for (const policy of ["default-src 'none'", "script-src 'none'", 'img-src data:']) assert(html.includes(policy), `missing restrictive policy: ${policy}`);
  for (const match of html.matchAll(/\bsrc="([^"]+)"/g)) assert(match[1].startsWith('data:image/png;base64,'), 'only embedded review PNGs');
  for (const match of html.matchAll(/\bhref="([^"]+)"/g)) assert(/^#[\w-]+$/.test(match[1]), 'only same-page jump links');
}
const blankUrl = 'data:text/html;charset=utf-8,' + encodeURIComponent('<!doctype html><html lang="en"><meta charset="utf-8"><title>Offline Gauge raster QA</title><body></body></html>');
const previewUrl = pathToFileURL(path.join(dir, 'preview.html')).href;
const allowedRequest = url => url === previewUrl || url === blankUrl || url.startsWith('data:image/png;base64,') || url.startsWith('data:image/svg+xml;charset=utf-8,');
function negativeTests() {
  const valid = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M1 1H2V2Z" fill="currentColor"/></svg>';
  auditSvg(valid);
  const mutations = [
    '<!DOCTYPE svg>' + valid,
    '<!ENTITY blocked "value">' + valid,
    '<?xml-stylesheet href="outside.css"?>' + valid,
    valid.replace('<path ', '<path href="outside.svg" '),
    valid.replace('currentColor', 'url(#paint)'),
    valid.replace('<path ', '<path onload="void(0)" '),
    valid.replace('<path ', '<path style="fill:red" '),
    valid.replace('<path ', '<image '),
    valid.replace('<path ', '<script '),
    valid.replace('<path ', '<foreignObject '),
    valid.replace('<path ', '<animate '),
    valid.replace('<path ', '<path filter="none" '),
    valid.replace('currentColor', '#123456'),
    valid.replace('currentColor', '&#35;ffad42')
  ];
  for (const source of mutations) assert.throws(() => auditSvg(source));
  const safePage = `<meta http-equiv="Content-Security-Policy" content="default-src 'none';script-src 'none';img-src data:"><a href="#in-app">Review</a><img src="data:image/png;base64,AA==">`;
  auditPreview(safePage);
  const pageMutations = [
    safePage + '<script>void(0)</script>',
    safePage + '<p onclick="void(0)">',
    safePage + '<p style="background:url(outside)">',
    safePage.replace("default-src 'none'", 'default-src *'),
    safePage.replace("script-src 'none'", 'script-src *'),
    safePage.replace('img-src data:', 'img-src *'),
    safePage.replace('data:image/png;base64,AA==', 'https://example.invalid/image.png'),
    safePage.replace('#in-app', 'file:///C:/outside.html')
  ];
  for (const html of pageMutations) assert.throws(() => auditPreview(html));
  const refusedUrls = ['https://example.invalid/', 'http://127.0.0.1/', 'file:///C:/outside.svg', 'javascript:void(0)', 'data:text/html,blocked', previewUrl + '.other'];
  for (const url of refusedUrls) assert.equal(allowedRequest(url), false);
  for (const url of [blankUrl, previewUrl, 'data:image/png;base64,AA==', 'data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E']) assert.equal(allowedRequest(url), true);
  return { content: mutations.length, preview: pageMutations.length, request: refusedUrls.length };
}
function inspectSources() {
  const negative = negativeTests();
  const svgFiles = fs.readdirSync(dir).filter(name => name.endsWith('.svg')).sort();
  assert.equal(svgFiles.length, 36);
  for (const name of svgFiles) auditSvg(read(name));
  for (const size of [16, 20, 24, 256]) {
    const paths = theme => [...read(appName(theme, size)).matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(paths('dark'), paths('light'), 'same app geometry in both themes');
    assert.deepEqual(paths('dark'), paths('currentcolor'), 'same single-file geometry');
    for (const theme of ['dark', 'light', 'currentcolor']) {
      assert(read(appName(theme, size)).includes(`fill="${colours.amber}" fill-rule="evenodd" data-part="amber"`));
    }
  }
  const masterPaths = [...read('gauge-app-dark.svg').matchAll(/<path d="([^"]+)"/g)].map(m => m[1]);
  const selected = fs.readFileSync(path.resolve(dir, '../logo-candidates-2026-11-14/gauge-mark-dark.svg'), 'utf8');
  assert.deepEqual(masterPaths, [...selected.matchAll(/<path d="([^"]+)"/g)].map(m => m[1]), 'selected 256-grid paths retained');
  for (const theme of ['dark', 'light', 'currentcolor']) {
    const source = read(`gauge-lockup-${theme}.svg`);
    assert(source.includes('>FFmpeg Encoder</text>'));
    assert(source.includes("'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"));
  }
  for (const option of ['outlined', 'midtone']) {
    for (const size of sizes) {
      const source = read(`gauge-win-${option}-${size}.svg`);
      assert(source.includes(`width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"`));
      for (const match of source.matchAll(/\bd="([^"]+)"/g)) {
        const numbers = match[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
        assert(numbers.every(n => Number.isInteger(n) && n >= 1 && n <= size - 1), 'pixel alignment and margin');
      }
    }
  }
  return { negative, svgFiles };
}
if (!process.versions.electron) {
  const checked = inspectSources();
  console.log(`PASS: ${checked.svgFiles.length} static SVGs; ${checked.negative.content} unsafe-SVG, ${checked.negative.preview} unsafe-preview and ${checked.negative.request} request-policy negative fixtures; matching app geometry and integer Windows grids.`);
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { cwd: path.resolve(dir, '../..'), env, windowsHide: true, encoding: 'utf8', timeout: 180000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) console.error(result.error.message);
  process.exitCode = result.status === 0 ? 0 : 1;
} else {
  const { app, BrowserWindow, session, nativeImage } = require('electron');
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'ffmpeg-gauge-review-'));
  for (const key of ['userData', 'sessionData', 'crashDumps']) app.setPath(key, state);
  app.setAppLogsPath(path.join(state, 'logs'));
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('disk-cache-dir', path.join(state, 'cache'));
  app.commandLine.appendSwitch('no-proxy-server');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  let win, partition, resultCode = 1;
  const blocked = [], browserErrors = [];
  const evaluate = (fn, arg = null) => win.webContents.executeJavaScript(`(${fn.toString()})(${JSON.stringify(arg)})`);
  const settle = () => evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  app.whenReady().then(async () => {
    const checked = inspectSources();
    partition = session.fromPartition('gauge-offline-review-memory');
    partition.webRequest.onBeforeRequest((details, callback) => {
      const allowed = allowedRequest(details.url);
      if (!allowed) blocked.push(details.url);
      callback({ cancel: !allowed });
    });
    win = new BrowserWindow({ show: false, width: 1680, height: 2300, backgroundColor: '#101318', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: partition, backgroundThrottling: false } });
    win.setContentSize(1680, 2300);
    win.webContents.on('console-message', details => { if (details.level === 'error') browserErrors.push(details.message); });
    await win.loadURL(blankUrl);
    const input = checked.svgFiles.map(name => ({ name, source: read(name) }));
    const rendered = await evaluate(async files => {
      function parse(source) {
        const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
        if (doc.querySelector('parsererror') || doc.documentElement.localName !== 'svg' || doc.documentElement.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('Invalid SVG XML/root/namespace');
        return doc;
      }
      const malformed = ['<svg xmlns="http://www.w3.org/2000/svg"><path></svg>', '<html/>', '<svg/>'];
      for (const source of malformed) {
        let refused = false;
        try { parse(source); } catch { refused = true; }
        if (!refused) throw new Error('XML negative fixture was accepted');
      }
      const results = [];
      for (const { name, source } of files) {
        const doc = parse(source), root = doc.documentElement;
        const width = Number(root.getAttribute('width')), height = Number(root.getAttribute('height'));
        const image = new Image();
        image.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(source);
        await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, width, height).data;
        const paint = {};
        let opaque = 0, partial = 0, borderPaint = 0;
        for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
          const i = (y * width + x) * 4, alpha = pixels[i + 3];
          if (alpha === 255) {
            opaque++;
            const key = '#' + [pixels[i], pixels[i + 1], pixels[i + 2]].map(n => n.toString(16).padStart(2, '0')).join('');
            paint[key] = (paint[key] || 0) + 1;
          } else if (alpha > 0) partial++;
          if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && alpha > 0) borderPaint++;
        }
        const windows = name.startsWith('gauge-win-');
        results.push({ name, width, height, opaque, partial, borderPaint, paint,
          // Check the output aperture in all square drawings, not the lockups.
          centreAlpha: width === height ? pixels[(Math.floor(height * .66) * width + Math.floor(width * .66)) * 4 + 3] : null,
          png: windows ? canvas.toDataURL('image/png').split(',')[1] : null });
      }
      return { xmlNegativeCases: malformed.length, results };
    }, input);
    const pngFiles = [];
    for (const r of rendered.results) {
      assert(r.opaque > 0 && r.paint[colours.amber] > 0, `rendered amber: ${r.name}`);
      assert.equal(r.borderPaint, 0, `transparent margins: ${r.name}`);
      if (r.width === r.height) assert.equal(r.centreAlpha, 0, `open aperture: ${r.name}`);
      if (r.name.startsWith('gauge-win-')) {
        assert.equal(r.partial, 0, `whole-pixel Windows alpha: ${r.name}`);
        assert(r.paint[r.name.includes('outlined') ? colours.dark : colours.grey] > 0);
        if (r.name.includes('outlined')) assert(r.paint[colours.light] > 0);
        const name = r.name.replace('.svg', '.png');
        const bytes = Buffer.from(r.png, 'base64');
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
        const decoded = nativeImage.createFromBuffer(bytes);
        assert.equal(decoded.isEmpty(), false);
        assert.deepEqual(decoded.getSize(), { width: r.width, height: r.height });
        fs.writeFileSync(path.join(dir, name), bytes);
        pngFiles.push(name);
      }
      delete r.png;
    }
    const app16 = rendered.results.find(r => r.name === 'gauge-app-light-16.svg');
    assert.equal(app16.opaque, 82);
    assert.equal(app16.paint[colours.amber], 40);
    assert.equal(app16.paint[colours.dark], 42);
    for (const size of [16, 20, 24, 32, 40, 48, 64, 128, 256]) {
      const outlined = rendered.results.find(r => r.name === `gauge-win-outlined-${size}.svg`);
      const midtone = rendered.results.find(r => r.name === `gauge-win-midtone-${size}.svg`);
      assert.equal(outlined.paint[colours.amber], midtone.paint[colours.amber]);
      assert.equal(outlined.paint[colours.dark], midtone.paint[colours.grey]);
    }
    writePreview();
    const html = read('preview.html');
    auditPreview(html);
    await win.loadURL(previewUrl);
    await evaluate(async () => { await document.fonts.ready; await Promise.all([...document.images].map(image => image.decode())); });
    const dom = await evaluate(() => {
      const inlineErrors = [...document.querySelectorAll('svg')].filter(svg => new DOMParser().parseFromString(new XMLSerializer().serializeToString(svg), 'image/svg+xml').querySelector('parsererror')).length;
      const sized = [...document.querySelectorAll('svg[data-size], img[data-size]:not(.zoom)')].map(e => ({ expected: Number(e.dataset.size), width: e.getBoundingClientRect().width, height: e.getBoundingClientRect().height }));
      const inherited = [...document.querySelectorAll('[data-app="currentcolor"]')].map(svg => ({ frame: getComputedStyle(svg.querySelector('[data-part="frame"]')).fill, amber: getComputedStyle(svg.querySelector('[data-part="amber"]')).fill }));
      return { inlineErrors, sized, inherited, images: document.images.length, decoded: [...document.images].filter(i => i.complete && i.naturalWidth > 0).length, viewport: innerWidth, client: document.documentElement.clientWidth, content: document.documentElement.scrollWidth, strips: document.querySelectorAll('.windows-strip').length, appPanels: document.querySelectorAll('.app-panel').length };
    });
    assert.equal(dom.inlineErrors, 0);
    assert.equal(dom.images, dom.decoded);
    assert.equal(dom.strips, 8);
    assert.equal(dom.appPanels, 6);
    assert.equal(dom.inherited.length, 6);
    for (const [i, item] of dom.inherited.entries()) {
      assert.equal(item.frame, i % 2 === 0 ? 'rgb(237, 240, 244)' : 'rgb(28, 41, 37)');
      assert.equal(item.amber, 'rgb(255, 173, 66)');
    }
    for (const item of dom.sized) {
      assert.equal(item.width, item.expected);
      assert.equal(item.height, item.expected);
    }
    assert.equal(dom.viewport, 1680);
    assert.equal(dom.content, dom.client);
    const captures = [];
    for (const id of ['in-app', 'windows-outlined', 'windows-midtone', 'side-by-side']) {
      const rect = await evaluate(id => {
        const section = document.getElementById(id);
        scrollTo(0, Math.floor(section.getBoundingClientRect().top + scrollY));
        const r = section.getBoundingClientRect();
        return { x: Math.floor(r.x), y: Math.floor(r.y), width: Math.ceil(r.width), height: Math.ceil(r.height), viewportHeight: innerHeight };
      }, id);
      assert(rect.y >= 0 && rect.y + rect.height <= rect.viewportHeight, `section fits capture: ${id} ${JSON.stringify(rect)}`);
      await settle();
      const bytes = (await win.webContents.capturePage({ x: rect.x, y: rect.y, width: rect.width, height: rect.height })).toPNG();
      const name = `review-${id}.png`;
      fs.writeFileSync(path.join(dir, name), bytes);
      const decoded = nativeImage.createFromBuffer(bytes);
      assert.equal(decoded.isEmpty(), false);
      assert.deepEqual(decoded.getSize(), { width: rect.width, height: rect.height });
      const bitmap = decoded.toBitmap();
      assert(bitmap.some((byte, i) => i % 4 !== 3 && byte > 0));
      captures.push({ name, width: rect.width, height: rect.height, bytes: bytes.length });
      pngFiles.push(name);
    }
    win.setContentSize(390, 900);
    await settle();
    const narrow = await evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth,
      overflow: [...document.querySelectorAll('.surface,.three,.three>div,.alternative-grid,.edge-comparison,.inherit')].map(e => ({ tag: e.className, right: e.getBoundingClientRect().right, width: e.getBoundingClientRect().width, scroll: e.scrollWidth })).filter(e => e.right > document.documentElement.clientWidth || e.scroll > e.width + 1) }));
    assert.equal(narrow.content, narrow.viewport, `390 px page reflow; long native-size strips scroll within their panels ${JSON.stringify(narrow.overflow)}`);
    assert.deepEqual(blocked, [], 'no off-page or network requests attempted');
    assert.deepEqual(browserErrors, []);
    assert.equal(fs.readdirSync(dir, { withFileTypes: true }).filter(entry => entry.isDirectory()).length, 0, 'no state/cache directories in artwork folder');
    const hashFiles = fs.readdirSync(dir).filter(name => name !== 'verification.json').sort();
    const hashes = Object.fromEntries(hashFiles.map(name => [name, createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex')]));
    fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), node: process.versions.node, electron: process.versions.electron, chromium: process.versions.chrome, deviceScaleFactor: 1, viewport: { width: 1680, height: 2300 }, stateOutsideProject: state, svgCount: checked.svgFiles.length, svgXmlNegativeCases: rendered.xmlNegativeCases, negativeTests: checked.negative, svgRenders: rendered.results, pngCount: pngFiles.length, captures, dom, narrow, offPageRequests: blocked, browserErrors, contrast: contrastRows(), outlineWidths: Object.fromEntries(sizes.map(size => [size, geometry(size, true).edge])), hashes, limit: 'Local original artwork and hidden Chromium review only. No app, Windows shell/taskbar, ICO, packaging or owner acceptance.' }, null, 2) + '\n');
    console.log(`PASS: ${checked.svgFiles.length} SVG XML parses and renders; ${rendered.xmlNegativeCases} XML negative fixtures; 18 transparent native PNGs; 4 decoded full-section PNGs; theme inheritance, all displayed sizes and 390px reflow; 0 off-page requests/errors.`);
    console.log(`Review sizes: ${captures.map(c => `${c.name} ${c.width}x${c.height}`).join(', ')}.`);
    console.log(`Electron cache/session state is outside the project: ${state}`);
    resultCode = 0;
  }).catch(error => {
    console.error(error.stack || error);
  }).finally(async () => {
    if (win) win.destroy();
    if (partition) await partition.closeAllConnections();
    app.exit(resultCode);
  });
}
