'use strict';
// Offline QA only. Runs its own hidden window, never the encoder application.
// All outputs, Electron state and screenshots stay in this candidate folder.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const dir = __dirname;
const names = ['gauge', 'sleeve', 'splice', 'witness', 'lattice', 'cadence'];
const read = file => fs.readFileSync(path.join(dir, file), 'utf8');
const colours = new Set(['#edf0f4', '#ffad42', '#1c2925', '#176b5c', 'currentColor']);
function audit(source) {
  assert(!/<!DOCTYPE|<!ENTITY/i.test(source), 'no DTD or entity');
  assert(!/<\?/.test(source), 'no processing instruction');
  assert(!/\b(?:href|src)\s*=|url\s*\(/i.test(source), 'no reference');
  assert(!/\bon[a-z]+\s*=/i.test(source), 'no event handler');
  const allowedTags = new Set(['svg', 'title', 'desc', 'rect', 'path', 'g', 'text']);
  for (const match of source.matchAll(/<\/?([a-zA-Z][\w:-]*)\b/g)) assert(allowedTags.has(match[1]), `unexpected element ${match[1]}`);
  assert(!/\bstyle\s*=/i.test(source), 'no inline style');
  for (const match of source.matchAll(/\bfill="([^"]+)"/g)) assert(colours.has(match[1]), `non-token colour ${match[1]}`);
}
function auditFixtures() {
  const valid = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0H2V2Z" fill="currentColor"/></svg>';
  audit(valid);
  const mutations = [
    '<!DOCTYPE svg>' + valid,
    '<?xml-stylesheet href="outside.css"?>' + valid,
    valid.replace('/></svg>', ' href="outside.svg"/></svg>'),
    valid.replace('currentColor', 'url(#paint)'),
    valid.replace('<path ', '<path onload="void(0)" '),
    valid.replace('<path ', '<image '),
    valid.replace('<path ', '<script '),
    valid.replace('<path ', '<foreignObject '),
    valid.replace('<path ', '<path style="fill:currentColor" '),
    valid.replace('currentColor', '#123456')
  ];
  for (const mutation of mutations) assert.throws(() => audit(mutation));
  return mutations.length;
}
function inspectSources() {
  const negativeCases = auditFixtures();
  const files = fs.readdirSync(dir).filter(file => file.endsWith('.svg')).sort();
  assert.equal(files.length, 60);
  const css = fs.readFileSync(path.resolve(dir, '../../ui/styles.css'), 'utf8');
  const blocks = {
    dark: css.slice(0, css.indexOf(':root[data-theme="light"]')),
    light: css.slice(css.indexOf(':root[data-theme="light"]'))
  };
  for (const [theme, values] of Object.entries({ dark: ['#edf0f4', '#ffad42', '#181d24'], light: ['#1c2925', '#176b5c', '#ffffff'] })) {
    for (const value of values) assert(blocks[theme].includes(value));
  }
  for (const name of names) {
    for (const base of ['mark', 'mark-16', 'lockup']) {
      assert.equal(read(`${name}-${base}.svg`), read(`${name}-${base}-dark.svg`));
    }
    for (const theme of ['dark', 'light']) {
      const small = read(`${name}-mark-16-${theme}.svg`);
      assert(small.includes('viewBox="0 0 16 16"'));
      assert(small.includes('width="16" height="16"'));
      for (const match of small.matchAll(/\bd="([^"]+)"/g)) {
        const coordinates = match[1].match(/-?\d+(?:\.\d+)?/g).map(Number);
        assert(coordinates.every(n => Number.isInteger(n) && n >= 0 && n <= 16));
      }
      const lockup = read(`${name}-lockup-${theme}.svg`);
      assert(lockup.includes('<text '));
      assert(lockup.includes('>FFmpeg Encoder</text>'));
      assert(lockup.includes("'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif"));
      const master = read(`${name}-mark-${theme}.svg`);
      assert(master.includes('viewBox="0 0 256 256"'));
      assert(!master.includes('<text '));
    }
    const mono = read(`${name}-mono.svg`);
    assert(mono.includes('currentColor'));
    assert(!/#[\da-f]{3,8}/i.test(mono));
  }
  for (const file of files) audit(read(file));
  const preview = read('preview.html');
  assert(!/<(?:script|img|link|iframe|object)\b/i.test(preview));
  assert(!/\b(?:src|xlink:href)\s*=|url\s*\(/i.test(preview));
  assert(preview.includes("default-src 'none'"));
  assert.equal((preview.match(/data-role="candidate"/g) || []).length, 72);
  assert.equal((preview.match(/data-role="mono"/g) || []).length, 12);
  assert.equal((preview.match(/data-role="lockup"/g) || []).length, 12);
  return { files, negativeCases, preview };
}

if (!process.versions.electron) {
  const checked = inspectSources();
  console.log(`PASS: ${checked.files.length} SVGs, 10 negative content fixtures, optical integer grids, theme tokens and inline page structure.`);
  const { spawnSync } = require('node:child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const result = spawnSync(require('electron'), [__filename], { cwd: path.resolve(dir, '../..'), env, windowsHide: true, encoding: 'utf8', timeout: 90000 });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  process.exitCode = result.status === 0 ? 0 : 1;
} else {
  const { app, BrowserWindow, session } = require('electron');
  const state = path.join(dir, '.qa-electron-state');
  fs.mkdirSync(state, { recursive: true });
  app.setPath('userData', state);
  app.setPath('sessionData', state);
  app.setPath('crashDumps', state);
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
  app.commandLine.appendSwitch('disable-http-cache');
  app.commandLine.appendSwitch('no-proxy-server');
  app.commandLine.appendSwitch('force-device-scale-factor', '1');
  const blocked = [];
  let resultCode = 1;
  let win;
  app.whenReady().then(async () => {
    const checked = inspectSources();
    const previewUrl = pathToFileURL(path.join(dir, 'preview.html')).href;
    const partition = session.fromPartition('logo-review-memory');
    partition.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url === previewUrl || details.url.startsWith('data:');
      if (!allowed) blocked.push(details.url);
      callback({ cancel: !allowed });
    });
    win = new BrowserWindow({ show: false, width: 1500, height: 1000, backgroundColor: '#101318', webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, session: partition, backgroundThrottling: false } });
    const pageErrors = [];
    win.webContents.on('console-message', details => { if (details.level === 'error') pageErrors.push(details.message); });
    await win.loadURL(previewUrl);
    const dom = await win.webContents.executeJavaScript(`(() => {
      const svgFiles = ${JSON.stringify(checked.files.map(file => [file, read(file)]))};
      const xmlErrors = svgFiles.filter(([name, source]) => new DOMParser().parseFromString(source,'image/svg+xml').querySelector('parsererror')).map(([name])=>name);
      const panels = [...document.querySelectorAll('[data-concept] .theme')].map(panel=>({
        concept:panel.closest('[data-concept]').dataset.concept,
        theme:panel.dataset.theme,
        surface:getComputedStyle(panel).backgroundColor,
        sizes:[...panel.querySelectorAll('svg[data-role="candidate"]')].map(svg=>({size:Number(svg.dataset.size),width:svg.getBoundingClientRect().width,height:svg.getBoundingClientRect().height,source:svg.dataset.source})),
        mono:panel.querySelector('[data-role="mono"]').getBoundingClientRect().width,
        lockup:panel.querySelector('[data-role="lockup"] text').textContent
      }));
      return {xmlErrors,panels,width:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth};
    })()`);
    assert.deepEqual(dom.xmlErrors, []);
    assert.equal(dom.panels.length, 12);
    for (const panel of dom.panels) {
      assert.equal(panel.surface, panel.theme === 'dark' ? 'rgb(24, 29, 36)' : 'rgb(255, 255, 255)');
      assert.deepEqual(panel.sizes.map(item => item.size), [16, 24, 32, 48, 128, 256]);
      for (const item of panel.sizes) { assert.equal(item.width, item.size); assert.equal(item.height, item.size); assert.equal(item.source, item.size <= 24 ? 'optical' : 'master'); }
      assert.equal(panel.lockup, 'FFmpeg Encoder');
    }
    assert.equal(dom.scrollWidth, dom.width);
    await win.webContents.executeJavaScript('scrollTo(0,0)');
    fs.writeFileSync(path.join(dir, 'review-overview.png'), (await win.webContents.capturePage()).toPNG());
    for (const name of names) {
      const rectangle = await win.webContents.executeJavaScript(`(() => {const element=document.getElementById(${JSON.stringify(name)});element.scrollIntoView({block:'start'});const r=element.getBoundingClientRect();return {x:Math.floor(r.x),y:Math.max(0,Math.floor(r.y)),width:Math.ceil(r.width),height:Math.ceil(r.height)};})()`);
      assert(rectangle.height <= 960, 'concept fits capture');
      await new Promise(resolve => setTimeout(resolve, 80));
      fs.writeFileSync(path.join(dir, `review-${name}.png`), (await win.webContents.capturePage(rectangle)).toPNG());
    }
    win.setContentSize(390, 900);
    await new Promise(resolve => setTimeout(resolve, 80));
    const narrow = await win.webContents.executeJavaScript('({viewport:document.documentElement.clientWidth,content:document.documentElement.scrollWidth})');
    assert.equal(narrow.viewport, narrow.content, 'no horizontal page overflow at 390px');

    // Rasterize the optical SVG to an actual 16x16 bitmap before enlargement.
    const grid = `<!doctype html><html><meta charset="utf-8"><style>body{margin:0;font-family:Segoe UI,system-ui,sans-serif;background:#101318;color:#edf0f4}h1{font-size:20px;padding:22px 28px 6px;margin:0}p{padding:0 28px;font-size:12px;color:#b1bdcb}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;padding:12px 24px}.panel{padding:20px;background:#181d24;border-radius:8px}.light{background:#fff;color:#1c2925}.row{display:flex;align-items:center;gap:24px;height:112px;border-top:1px solid #343e4a}.light .row{border-color:#b9c5c0}.label{width:80px;font-size:14px}canvas{display:block}.opt{width:42px;font-size:11px}.zoom{image-rendering:pixelated}</style><h1>Native 16 px / optical review</h1><p>Each 96 px square is a 6× nearest-neighbour enlargement of the actual 16 px raster. The 16 px and 24 px samples remain at native size.</p><div class="grid">${['dark', 'light'].map(theme => `<div class="panel ${theme}"><h2>${theme === 'dark' ? 'Dark / amber' : 'Light / teal'}</h2>${names.map(name => `<div class="row"><span class="label">${name}</span><div class="opt"><canvas width="16" height="16" data-name="${name}" data-theme="${theme}" data-size="16"></canvas><p style="padding:0;color:inherit">16 px</p></div><div class="opt"><canvas width="24" height="24" data-name="${name}" data-theme="${theme}" data-size="24"></canvas><p style="padding:0;color:inherit">24 px</p></div><canvas class="zoom" width="96" height="96" data-name="${name}" data-theme="${theme}" data-size="96"></canvas></div>`).join('')}</div>`).join('')}</div></html>`;
    win.setContentSize(1100, 940);
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(grid));
    const pixelChecks = await win.webContents.executeJavaScript(`(async () => {
      const sources=${JSON.stringify(Object.fromEntries(names.map(name => [name, Object.fromEntries(['dark', 'light'].map(theme => [theme, read(`${name}-mark-16-${theme}.svg`)]))])))};
      const results=[];
      for(const canvas of document.querySelectorAll('canvas')){
        const {name,theme,size}=canvas.dataset;
        const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(sources[name][theme]);await image.decode();
        const context=canvas.getContext('2d');context.imageSmoothingEnabled=false;
        if(Number(size)===96){const native=document.createElement('canvas');native.width=native.height=16;native.getContext('2d').drawImage(image,0,0,16,16);context.drawImage(native,0,0,96,96);}
        else context.drawImage(image,0,0,Number(size),Number(size));
        const bytes=context.getImageData(0,0,canvas.width,canvas.height).data;
        if(Number(size)===16){let opaque=0;for(let i=3;i<bytes.length;i+=4)if(bytes[i]>200)opaque++;results.push({name,theme,opaquePixels:opaque,totalPixels:256});}
      }
      return results;
    })()`);
    for (const result of pixelChecks) assert(result.opaquePixels > 35 && result.opaquePixels < 200, 'nonempty open 16px silhouette');
    // Canvas pixels are ready before the compositor has necessarily painted them.
    await win.webContents.executeJavaScript('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    await new Promise(resolve => setTimeout(resolve, 120));
    fs.writeFileSync(path.join(dir, 'small-size-review.png'), (await win.webContents.capturePage()).toPNG());
    assert.deepEqual(blocked, [], 'no external request attempted');
    assert.deepEqual(pageErrors, [], 'no browser errors');
    const hashes = Object.fromEntries([...checked.files, 'preview.html', 'NOTES.md', 'make-candidates.cjs', 'check-review.cjs', 'check-xml.ps1'].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')]));
    const screenshotHashes = Object.fromEntries(['review-overview.png', 'small-size-review.png', ...names.map(name => `review-${name}.png`)].map(file => [file, createHash('sha256').update(fs.readFileSync(path.join(dir, file))).digest('hex')]));
    fs.writeFileSync(path.join(dir, 'verification.json'), JSON.stringify({ schema: 1, checkedAt: new Date().toISOString(), node: process.versions.node, electron: process.versions.electron, chromium: process.versions.chrome, deviceScaleFactor: 1, svgCount: checked.files.length, contentNegativeCases: checked.negativeCases, xmlErrors: dom.xmlErrors, externalRequests: blocked, browserErrors: pageErrors, panels: dom.panels, narrow, pixelChecks, hashes, screenshotHashes, limit: 'Local hidden Electron rendering only. No Windows taskbar, shell, packaging or owner acceptance.' }, null, 2) + '\n');
    console.log('PASS: 60 SVGs parse in Chromium; all 12 panels render at six exact sizes; offline requests 0; browser errors 0; 390px reflow passed; native 16px raster and 6x review saved.');
    resultCode = 0;
  }).catch(error => {
    console.error(error.stack || error);
  }).finally(async () => {
    if (win) win.destroy();
    await session.fromPartition('logo-review-memory').closeAllConnections();
    app.exit(resultCode);
  });
}
