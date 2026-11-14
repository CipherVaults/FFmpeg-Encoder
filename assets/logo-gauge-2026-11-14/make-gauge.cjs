'use strict';
// Original Gauge geometry from this project's selected candidate, refined here.
// No app integration. Fixed filenames; all generated outputs are beside this file.
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const font = "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif";
const colours = { amber: '#ffad42', dark: '#1c2925', light: '#edf0f4', grey: '#808080' };
const surfaces = [
  { name: 'Dark taskbar', colour: '#202020', text: '#edf0f4' },
  { name: 'Light taskbar', colour: '#f3f3f3', text: '#1c2925' },
  { name: 'White Explorer', colour: '#ffffff', text: '#1c2925' },
  { name: 'Dark Explorer', colour: '#191919', text: '#edf0f4' }
];
const themeSurfaces = [
  ['Dark / surface', '#181d24', 'dark'], ['Light / surface', '#ffffff', 'light'],
  ['Dark / background', '#101318', 'dark'], ['Light / background', '#f7f7f4', 'light'],
  ['Dark / inset', '#202630', 'dark'], ['Light / inset', '#f0f3f1', 'light']
];
const master = {
  frame: 'M32 104V40H216V72H64V104ZM32 152H64V184H96V216H32Z',
  square: 'M112 104H224V216H112ZM144 136V184H192V136Z',
  ticks: 'M88 104H104V120H88ZM88 144H104V160H88Z'
};
// Each tuple: left, top, right, rail, upper end, lower start, foot end,
// baseline, square left/top/width/rail. These are drawings in physical pixels.
const optical = {
  16: [2, 2, 14, 2, 6, 9, 6, 14, 7, 7, 7, 2],
  20: [3, 3, 17, 2, 8, 11, 7, 17, 9, 9, 8, 2],
  24: [3, 3, 21, 3, 9, 14, 9, 21, 11, 11, 10, 3]
};
function geometry(size, windows = false) {
  if (!windows && size === 256) return { ...master, edge: 0 };
  let tuple = optical[size];
  if (!tuple) {
    const r = n => Math.round(n * size / 256);
    tuple = [32, 40, 216, 32, 104, 152, 96, 216, 112, 104, 112, 32].map(r);
  }
  let [l, t, r, w, u, b, f, z, x, y, a, q] = tuple;
  const edge = size <= 64 ? 1 : size <= 128 ? 2 : 3;
  if (windows && size <= 32) {
    // Leave a transparent pixel between the light contour and the amber ring.
    // Both fixed Windows options use exactly the same dark/grey core geometry.
    r -= 1;
    f = Math.min(f, x - edge - 1);
  }
  const frame = `M${l} ${u}V${t}H${r}V${t + w}H${l + w}V${u}ZM${l} ${b}H${l + w}V${z - w}H${f}V${z}H${l}Z`;
  const square = `M${x} ${y}H${x + a}V${y + a}H${x}ZM${x + q} ${y + q}V${y + a - q}H${x + a - q}V${y + q}Z`;
  // Explicit expanded filled silhouettes give whole-pixel, outside-only edges;
  // a centred stroke on the core would land on half pixels at the smallest sizes.
  const contour = `M${l - edge} ${u + edge}V${t - edge}H${r + edge}V${t + w + edge}H${l + w + edge}V${u + edge}ZM${l - edge} ${b - edge}H${l + w + edge}V${z - w - edge}H${f + edge}V${z + edge}H${l - edge}Z`;
  let ticks = '', tickContour = '';
  if (size >= 64) {
    const k = n => Math.round(n * size / 256);
    for (const ty of [104, 144]) {
      const tx = k(88), top = k(ty), side = k(16);
      ticks += `M${tx} ${top}H${tx + side}V${top + side}H${tx}Z`;
      tickContour += `M${tx - edge} ${top - edge}H${tx + side + edge}V${top + side + edge}H${tx - edge}Z`;
    }
  }
  return { frame, square, ticks, contour, tickContour, edge };
}
const pathTag = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
function drawing(g, frame, outlined = false, keyline = false) {
  return [
    outlined ? pathTag(g.contour + g.tickContour, colours.light, ' data-part="edge"') : '',
    pathTag(g.frame, frame, ' data-part="frame"'),
    pathTag(g.square, colours.amber, ` fill-rule="evenodd" data-part="amber"${keyline ? ` stroke="${colours.dark}" stroke-width="0.5" stroke-linejoin="miter"` : ''}`),
    g.ticks ? pathTag(g.ticks, frame, ' data-part="ticks"') : ''
  ].filter(Boolean).join('\n  ');
}
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function svg(body, size, label, viewBox = `0 0 ${size} ${size}`, width = size, height = size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="${esc(label)}">\n  <title>${esc(label)}</title>\n  <desc>Original FFmpeg Encoder Gauge artwork. Fixed amber output square ring; open source frame. November 14, 2026. Transparent background.</desc>\n  ${body}\n</svg>\n`;
}
function appName(theme, size) { return `gauge-app-${theme}${size === 256 ? '' : `-${size}`}.svg`; }
function appSvg(theme, size, keyline = false) {
  const frame = theme === 'currentcolor' ? 'currentColor' : colours[theme === 'dark' ? 'light' : 'dark'];
  return svg(drawing(geometry(size), frame, false, keyline), size, `Gauge / app ${theme} / ${size} px${keyline ? ' / OPTIONAL 0.5 px square edge' : ''}`);
}
function luminance(hex) {
  return hex.slice(1).match(/../g).map(v => parseInt(v, 16) / 255)
    .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}
function contrastRows() {
  return [...themeSurfaces.map(([name, colour]) => ({ name, colour })), ...surfaces].map(s => ({
    name: s.name, background: s.colour,
    amber: contrast(colours.amber, s.colour),
    darkFrame: contrast(colours.dark, s.colour),
    lightEdge: contrast(colours.light, s.colour),
    midtoneFrame: contrast(colours.grey, s.colour)
  }));
}
function writeMasters() {
  for (const theme of ['dark', 'light', 'currentcolor']) {
    for (const size of [16, 20, 24, 256]) fs.writeFileSync(path.join(dir, appName(theme, size)), appSvg(theme, size));
    const frame = theme === 'currentcolor' ? 'currentColor' : colours[theme === 'dark' ? 'light' : 'dark'];
    const body = `<g transform="translate(0 4) scale(.34375)">\n  ${drawing(master, frame)}\n  </g>\n  <text x="112" y="61" fill="${frame}" font-family="${font}" font-size="40" font-weight="600" letter-spacing="-.6">FFmpeg Encoder</text>`;
    fs.writeFileSync(path.join(dir, `gauge-lockup-${theme}.svg`), svg(body, 256, `Gauge / live system-text lockup / ${theme}`, '0 0 560 96', 560, 96));
  }
  for (const size of [16, 20, 24]) fs.writeFileSync(path.join(dir, `gauge-app-light-edge-alternative-${size}.svg`), appSvg('light', size, true));
  for (const option of ['outlined', 'midtone']) {
    for (const size of sizes) {
      const body = drawing(geometry(size, true), option === 'outlined' ? colours.dark : colours.grey, option === 'outlined');
      fs.writeFileSync(path.join(dir, `gauge-win-${option}-${size}.svg`), svg(body, size, `Gauge / Windows ${option} / ${size} px`));
    }
  }
  fs.writeFileSync(path.join(dir, 'NOTES.md'), notes());
}
function inline(source, size, extra = '') {
  return source.trim().replace(/<svg\b[^>]*>/, tag => tag
    .replace(/\bwidth="[^"]*"/, `width="${size}"`)
    .replace(/\bheight="[^"]*"/, `height="${size}"`)
    .replace(/\saria-labelledby="[^"]*"/, '')
    .replace(/>$/, ` ${extra}>`)).replace(/\sid="[^"]*"/g, '');
}
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
function current(size) {
  // Read the original shipped sources unchanged; only presentation size changes.
  const suffix = [16, 20, 24, 32].includes(size) ? `-${size}` : '';
  const source = fs.readFileSync(path.resolve(dir, '../app-icon', `app-icon${suffix}.svg`), 'utf8');
  return inline(source, size, 'data-current="true"');
}
function png(option, size, zoom = false) {
  const data = fs.readFileSync(path.join(dir, `gauge-win-${option}-${size}.png`)).toString('base64');
  return `<img src="data:image/png;base64,${data}" width="${zoom ? size * 6 : size}" height="${zoom ? size * 6 : size}" alt="Gauge ${option}, ${size} px${zoom ? ', 6 times nearest-neighbour enlargement' : ''}" data-option="${option}" data-size="${size}"${zoom ? ' class="zoom"' : ''}>`;
}
function appSample(theme, size) {
  const source = read(appName(theme, size <= 24 ? size : 256));
  return inline(source, size, `data-app="${theme}" data-size="${size}"`);
}
function writePreview() {
  const appPanels = themeSurfaces.map(([name, bg, theme]) => `<div class="surface app-panel" style="background:${bg};color:${theme === 'dark' ? colours.light : colours.dark}" data-surface="${bg}"><h3>${name}<small>${bg}</small></h3><div class="scale">${sizes.map(size => `<figure>${appSample(theme, size)}<figcaption>${size} px</figcaption></figure>`).join('')}</div><div class="inherit"><span>Inline currentColor · 24 px</span>${appSample('currentcolor', 24)}</div></div>`).join('');
  const lockups = ['dark', 'light'].map(theme => `<div class="surface lockup" style="background:${theme === 'dark' ? '#181d24' : '#ffffff'};color:${theme === 'dark' ? colours.light : colours.dark}"><h3>${theme} theme · live system text</h3>${read(`gauge-lockup-${theme}.svg`)}<div class="inherit"><span>Same lockup with currentColor</span>${read('gauge-lockup-currentcolor.svg')}</div></div>`).join('');
  const alternatives = ['#ffffff', '#f7f7f4', '#f0f3f1'].map(bg => `<div class="surface alternative" style="background:${bg};color:${colours.dark}"><h3>${bg}</h3><div class="edge-comparison">${[16, 20, 24].map(size => `<figure>${appSample('light', size)}${inline(read(`gauge-app-light-edge-alternative-${size}.svg`), size)}<figcaption>${size} px · plain / edged</figcaption></figure>`).join('')}</div><p>The edge is optional. Amber stays #ffad42.</p></div>`).join('');
  const windows = option => `<section class="review" id="windows-${option}"><div class="section-head"><span class="eyebrow">Fixed Windows option ${option === 'outlined' ? '01 / recommended' : '02 / alternative'}</span><h2>${option === 'outlined' ? 'Outlined. Dark core, light edge.' : 'Mid-tone. One neutral frame.'}</h2><p>${option === 'outlined' ? 'The dark frame reads on light surfaces. A light outside contour carries its silhouette on dark ones.' : 'A #808080 frame stays visible on these light and dark backgrounds, with less separation from the amber.'} No tile. Actual PNGs below, each beside the current shipped icon.</p></div>${surfaces.map(s => `<div class="surface windows-strip" style="background:${s.colour};color:${s.text}" data-surface="${s.colour}"><h3>${s.name}<small>${s.colour} · left: ${option} / right: current</small></h3><div class="windows-scale">${sizes.map(size => `<figure><div class="pair">${png(option, size)}${current(size)}</div><figcaption>${size} px</figcaption></figure>`).join('')}</div></div>`).join('')}<p class="footnote">Native pixel sizes at 100% browser zoom. The shipped Folded Frame is comparison artwork only. These strips simulate flat backgrounds; no Windows shell integration was performed.</p></section>`;
  const comparison = surfaces.map(s => `<div class="surface compare-panel" style="background:${s.colour};color:${s.text}" data-surface="${s.colour}"><h3>${s.name}<small>${s.colour}</small></h3><div class="three">${['current', 'outlined', 'midtone'].map(option => `<div><h4>${option === 'current' ? 'Current shipped' : option}</h4><div class="hero">${option === 'current' ? current(128) : png(option, 128)}</div><div class="mini">${[16, 24, 32].map(size => `<figure>${option === 'current' ? current(size) : png(option, size)}<figcaption>${size}</figcaption></figure>`).join('')}</div><div class="zoom-box">${option === 'current' ? current(16) : png(option, 16, true)}<span>${option === 'current' ? 'Native 16 px' : '16 px raster × 6'}</span></div></div>`).join('')}</div></div>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; script-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>Gauge / final artwork review / FFmpeg Encoder</title><style>
:root{font-family:${font};background:#101318;color:#edf0f4;color-scheme:dark}*{box-sizing:border-box}body{margin:0}main{max-width:1680px;margin:auto;padding:40px 24px}h1,h2,h3,h4,p,figure{margin:0}h1{font-size:56px;letter-spacing:-.04em;line-height:1.05;margin:12px 0 20px;font-weight:600}h1 em{color:#ffad42;font-style:normal}.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#ffad42;font-weight:600}header>p:not(.eyebrow),.section-head>p{color:#b1bdcb;max-width:950px;font-size:14px;line-height:1.7}nav{display:flex;gap:10px;flex-wrap:wrap;margin:24px 0 38px}a{color:#edf0f4;font-size:13px;text-decoration:none;padding:8px 12px;border:1px solid #343e4a;border-radius:5px}a:focus-visible{outline:2px solid #ffad42;outline-offset:2px}.review{padding:24px 0 18px;border-top:1px solid #343e4a;scroll-margin-top:0}.section-head{margin-bottom:20px}h2{font-size:30px;font-weight:600;letter-spacing:-.025em;margin:6px 0 9px}h3{font-size:13px;font-weight:600;display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}h3 small{font-size:11px;font-weight:400;opacity:.78}.surface{padding:18px;border-radius:8px;min-width:0}.surface svg,.surface img{display:block;flex:none}.theme-grid,.lockup-grid,.compare-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.scale{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin:16px 0 14px;overflow-x:auto}figure{display:flex;flex-direction:column;align-items:center;gap:10px;flex:none}figcaption{font-size:10px;opacity:.78;font-variant-numeric:tabular-nums}.inherit{border-top:1px solid #8885;padding-top:10px;display:flex;align-items:center;gap:16px;font-size:11px}.lockup-grid{margin-top:12px}.lockup>svg{width:350px;max-width:100%;height:auto;margin:6px 0}.lockup .inherit{flex-wrap:wrap}.lockup .inherit svg{width:280px;max-width:100%;height:auto}.alternative-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}.alternative-title{font-size:14px;font-weight:600;margin:20px 0 8px}.alternative-note{font-size:12px;color:#b1bdcb;line-height:1.6}.edge-comparison{display:flex;justify-content:space-around;gap:12px;margin:14px 0}.edge-comparison figure{flex-direction:row;flex-wrap:wrap;justify-content:center;gap:12px}.edge-comparison figcaption{flex-basis:100%;text-align:center}.alternative p{font-size:11px;opacity:.8}.windows-strip{margin-bottom:10px}.windows-scale{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;margin-top:16px;overflow-x:auto}.pair{display:flex;align-items:flex-end;gap:8px}.footnote{color:#b1bdcb;font-size:11px;line-height:1.6;margin:12px 0}.three{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:18px}.three h4{font-size:12px;text-transform:capitalize;font-weight:600}.hero{margin:16px 0 18px}.mini{display:flex;gap:20px;align-items:flex-end}.zoom-box{height:120px;margin-top:18px;display:flex;align-items:center;gap:10px;flex-wrap:wrap}.zoom{image-rendering:pixelated}.zoom-box span{font-size:10px;opacity:.78}.compare-grid{gap:12px}.compare-panel{padding:22px}footer{font-size:12px;line-height:1.7;color:#b1bdcb;padding-top:20px}
.edge-comparison{flex-wrap:wrap;row-gap:16px}
@media(max-width:1550px){.theme-grid{grid-template-columns:1fr}.scale{justify-content:flex-start;gap:16px}.windows-scale{justify-content:flex-start;gap:16px}}@media(max-width:800px){main{padding:28px 14px}h1{font-size:40px}.lockup-grid,.compare-grid,.alternative-grid{grid-template-columns:1fr}.three{gap:8px}.hero>svg,.hero>img{max-width:100%;height:auto}.mini{gap:8px;flex-wrap:wrap}.zoom-box{height:auto;min-height:130px;align-content:start}}
</style></head><body><main><header><p class="eyebrow">FFmpeg Encoder / selected Gauge / 14 November 2026</p><h1>One amber.<br><em>A frame that stays clear.</em></h1><p>Theme-following marks inside the app. Two fixed Windows choices. No background tile. Exact amber #ffad42 in every new asset. Artwork for Claude and Ahmed's review; application and packaging are unchanged.</p></header><nav aria-label="Review sections"><a href="#in-app">In the app</a><a href="#windows-outlined">Windows / outlined</a><a href="#windows-midtone">Windows / mid-tone</a><a href="#side-by-side">Compare</a></nav><section class="review" id="in-app"><div class="section-head"><span class="eyebrow">The selected mark / both themes</span><h2>Same amber. Theme-coloured frame.</h2><p>White-ish #edf0f4 frame in dark mode; dark #1c2925 frame in light mode. Dedicated 16, 20 and 24 px drawings; the 256-grid master above 24 px. Each row also proves inline currentColor inheritance.</p></div><div class="theme-grid">${appPanels}</div><div class="lockup-grid">${lockups}</div><h3 class="alternative-title">Optional small-size remedy / light theme only</h3><p class="alternative-note">Amber contrast on these light surfaces is ${contrast(colours.amber, '#f0f3f1').toFixed(2)}–${contrast(colours.amber, '#ffffff').toFixed(2)}:1. The square is visible but softer than the frame. The clearly labelled alternative adds a 0.5 px dark edge to the square at 16–24 px; the requested plain files remain separate.</p><div class="alternative-grid">${alternatives}</div></section>${windows('outlined')}${windows('midtone')}<section class="review" id="side-by-side"><div class="section-head"><span class="eyebrow">Choose the Windows silhouette</span><h2>Outlined is the stronger signature.</h2><p>All three at 128 px and native 16, 24 and 32 px. Enlargements use the actual 16 px PNG, with nearest-neighbour scaling. The grey alternative is calmer but separates less clearly from the amber.</p></div><div class="compare-grid">${comparison}</div><p class="footnote">Light/dark taskbar and Explorer colours are representative flat review surfaces, not measurements from Ahmed's desktop. Use the full strips above for every export size.</p></section><footer>Original project artwork. No downloads, raster embeds in SVG, scripts or external resources. Lockups retain live system-font text. SVG masters and notes sit beside this offline page. The existing Folded Frame retains its separate provenance.</footer></main></body></html>\n`;
  fs.writeFileSync(path.join(dir, 'preview.html'), html);
}
function notes() {
  const rows = contrastRows().map(r => `| ${r.name} | \`${r.background}\` | ${r.amber.toFixed(3)} | ${r.darkFrame.toFixed(3)} | ${r.lightEdge.toFixed(3)} | ${r.midtoneFrame.toFixed(3)} |`).join('\n');
  return `# Gauge artwork / November 14, 2026

Gauge is the owner's selected project mark. This folder prepares the requested
theme marks and two Windows choices for review. Nothing is wired into the app,
packaging or shipped icon. No ICO is built. Selection of a Windows option and
actual shell/taskbar verification remain with Ahmed and Claude.

## Files

- \`gauge-app-dark.svg\`, \`gauge-app-light.svg\`: 256-grid selected Gauge paths,
  unchanged from the original candidate except that light mode now keeps amber.
  Frame: dark theme \`#edf0f4\`; light theme \`#1c2925\`. Output square ring:
  \`#ffad42\` in both, with identical geometry and filled area. “Square” refers to
  the candidate's filled square-ring path with a transparent central aperture,
  not a newly filled-in solid block. There is no background tile.
- \`gauge-app-{dark,light,currentcolor}-{16,20,24}.svg\`: native-pixel optical
  drawings. The 16 px drawing preserves the original selected small geometry;
  20 and 24 are separately snapped, rather than scaled fractional rails. The
  two tiny measurement ticks are omitted at small sizes.
- \`gauge-app-currentcolor.svg\`: the 256-grid frame and ticks use currentColor;
  the square stays fixed amber. **Inline SVG inherits the host's CSS color.** An
  SVG loaded through an HTML img element does not inherit its host's color.
  Use inline SVG for a single theme-following asset; external-image consumers
  should choose the explicit dark/light file. The page demonstrates inheritance.
- \`gauge-lockup-{dark,light,currentcolor}.svg\`: matching transparent 560 × 96
  lockups. “FFmpeg Encoder” is live 40 px, weight 600 text using Segoe UI Variable,
  Segoe UI, system-ui, sans-serif. No embedded or downloaded fonts; font metrics
  can vary on another OS. Geometry is paths; the requested wordmark is live text.
- \`gauge-app-light-edge-alternative-{16,20,24}.svg\`: **optional alternative**,
  not a replacement. Adds a centred 0.5 px dark stroke to the square's outside
  and aperture perimeter, leaving its amber fill and path unchanged. Antialiasing
  naturally blends the boundary pixels; interior amber remains exact. No edge
  is added to the requested main assets or the Windows amber square.
- \`gauge-win-{outlined,midtone}-{16,20,24,32,40,48,64,128,256}.svg\` and matching
  PNGs: 18 native-pixel SVG masters and 18 transparent RGBA PNGs. Every Windows
  path coordinate and contour boundary is an integer. Outlined: dark frame
  \`#1c2925\`, outside light edge \`#edf0f4\`, fixed amber square. Mid-tone: neutral
  \`#808080\` frame, same fixed amber square. Neither contains a tile.
- \`preview.html\`: self-contained offline review. All SVGs are inline; actual
  exported Windows PNG bytes are embedded as HTML data images, never inside SVG.
  Both app themes appear on their actual surface/background/inset tokens at all
  nine sizes. Both Windows choices appear beside the current shipped icon at
  every size on four backgrounds. The original comparison SVGs are read without
  changing their artwork, including the shipped optical 16/20/24/32 sources.
- \`review-in-app.png\`, \`review-windows-outlined.png\`,
  \`review-windows-midtone.png\`, \`review-side-by-side.png\`: full-section Chromium
  captures of that page at device scale 1 and a 1680 px viewport. Native small
  marks should be judged at 100% image zoom; comparison also has 6× pixel zooms.
- \`make-gauge.cjs\`: reproducible original geometry, contrast calculations,
  documentation and offline page generator. \`check-review.cjs\`: source safety,
  XML parsing, raster export/decode, pixel checks, DOM sizing and review captures.
  \`verification.json\`: exact versions, results, pixel statistics and SHA-256s.

## Measured contrast

Relative sRGB luminance is calculated after channel linearisation:
v/12.92 for v <= 0.04045, otherwise ((v+0.055)/1.055)^2.4. Weights are
0.2126 R + 0.7152 G + 0.0722 B. Contrast = (Llighter+0.05)/(Ldarker+0.05).
These ratios compare solid colours, not antialiased edge pixels or human visual
acceptance. They are not text-legibility or accessibility certification.

| Review surface | Background | Amber | Dark frame | Light frame/edge | Mid-tone frame |
| --- | --- | ---: | ---: | ---: | ---: |
${rows}

Additional colour pairs: amber/dark frame **${contrast(colours.amber, colours.dark).toFixed(3)}:1**;
amber/mid-tone **${contrast(colours.amber, colours.grey).toFixed(3)}:1**;
light edge/dark core **${contrast(colours.light, colours.dark).toFixed(3)}:1**.
The three light app surfaces are real \`ui/styles.css\` values. The Windows strips
are representative flat backgrounds (#202020, #f3f3f3, #ffffff, #191919), not a
capture of the owner's desktop, wallpaper, translucency or high-contrast mode.

## At 16–24 px

The plain 16 px app drawing has 82 fully opaque shape pixels: 42 frame pixels
and 40 amber pixels, with a 3 × 3 transparent aperture. Its 2 px rails remain
pixel aligned. At 20 px the square rail is 2 px; at 24 px it is 3 px. Amber is
clearly coloured but its luminance boundary on white/off-white is weak (below
3:1). The adjacent dark frame anchors the whole silhouette; it does not improve
the square/background contrast. This is why the optional hairline is supplied,
particularly for a small standalone light-theme mark. It changes neither the
chosen amber colour nor the requested plain option. No remedy is silently applied.

Outlined Windows uses a **1 px outside edge at 16/20/24/32/40/48/64**, **2 px at
128**, **3 px at 256**. Contours are filled expanded silhouettes, then the dark
core is drawn on top; there is no centred half-pixel stroke or background tile.
The smallest upper bar and lower foot shorten by one pixel to keep a transparent
gap beside the square. At 16 px the core rails remain 2 px; its bright contour is
exactly 1 px and survives on dark backgrounds. On light backgrounds the dark core
carries the mark. The two measurement ticks return from 64 px, where the contour
has enough room; below that they would crowd the amber. At 256 px the light edge
is only 1.17% of the canvas, avoiding a heavy sticker appearance.

Mid-tone uses the same core geometry at each size, without the edge. At 16 px its
2 px #808080 rails are crisp and visible on all four review backgrounds (ratios
in the table), but its contrast against amber is lower than the dark core's.
The unoutlined amber has the same soft light-background boundary in both Windows
options. Neither choice can adapt to arbitrary taskbar colours or guarantee every
Windows theme. No real shell/taskbar acceptance is claimed.

## Recommendation

Use the requested plain, fixed-amber theme variants as the primary review mark;
inline currentColor is the practical single-file path for the app. If the small
light-theme square feels too soft at native size, choose the separate 0.5 px edge
alternative only for 16–24 px. **Recommend outlined for Windows**: it retains the
dark frame's stronger separation from amber, while its light edge preserves the
silhouette on dark surfaces. Mid-tone is a simpler alternative but feels flatter.
Ahmed's choice is still required before integration; this delivery supplies both.

## Reproduce and verify

From the repository root, with the already installed Node and Electron only:

\`node assets/logo-gauge-2026-11-14/make-gauge.cjs\`

\`node assets/logo-gauge-2026-11-14/check-review.cjs\`

The checker parses **all 36 SVG files** as XML with Chromium DOMParser, rejects
malformed/active/referenced content with negative fixtures, renders every SVG
through Chromium's SVG decoder onto a transparent canvas, and exports each of
the 18 Windows PNGs directly at its native size (no resizing or raster template).
It decodes every PNG again, checks dimensions, transparent margins, open apertures,
exact amber/frame pixels and Windows alpha alignment, then captures and decodes
all four review PNGs. It checks every inline SVG and PNG loads, currentColor on
both themes, exact displayed sizes, no page overflow at 390 px, and no attempted
network requests. Content Security Policy blocks active/external content. The
reviewer runs in a hidden isolated window, never the encoder application; cache,
crash and session paths are under a fresh OS temporary directory outside the repo.
No application tests were requested: application, source and packaging are untouched.
Claude re-runs any evidence it intends to cite in the project records.

## Originality and licence

This is **original artwork from the FFmpeg Encoder project**, derived solely
from its hand-authored selected Gauge candidate in
\`assets/logo-candidates-2026-11-14/\`, refined in this job. No tracing, stock art,
third-party logo geometry, AI raster artwork, downloads or external references.
The project ISC licence applies. The existing Folded Frame comparison retains
its own provenance in \`assets/app-icon/PROVENANCE.md\`. No logo ownership or
endorsement by FFmpeg, Electron or any other product is implied.
`;
}
if (require.main === module) {
  writeMasters();
  console.log('Wrote 36 original SVG masters and NOTES.md. Run check-review.cjs for PNGs and offline preview.');
}
module.exports = { sizes, colours, surfaces, themeSurfaces, geometry, contrast, contrastRows, writePreview, appName };
