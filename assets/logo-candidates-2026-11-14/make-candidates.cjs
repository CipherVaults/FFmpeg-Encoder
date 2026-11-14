'use strict';
// Original, hand-authored SVG geometry. This writes only beside this script.
// No generated images, dependencies, fonts, downloaded material or app changes.
const fs = require('node:fs');
const path = require('node:path');
const out = __dirname;
const root = path.resolve(out, '..', '..');
const font = "'Segoe UI Variable', 'Segoe UI', system-ui, sans-serif";
const palettes = {
  dark: { background: '#101318', surface: '#181d24', inset: '#202630', border: '#343e4a', text: '#edf0f4', muted: '#b1bdcb', orange: '#ffad42' },
  light: { background: '#f7f7f4', surface: '#ffffff', inset: '#f0f3f1', border: '#b9c5c0', text: '#1c2925', muted: '#4d6057', orange: '#176b5c' }
};
const concepts = [
  {
    name: 'gauge', label: 'Gauge', idea: 'A large source frame steps down into a smaller, precisely aligned output.', rank: 1,
    large: (n, a) => `  <path d="M32 104V40H216V72H64V104ZM32 152H64V184H96V216H32Z" fill="${n}"/>
  <path d="M112 104H224V216H112ZM144 136V184H192V136Z" fill="${a}" fill-rule="evenodd"/>
  <path d="M88 104H104V120H88ZM88 144H104V160H88Z" fill="${n}"/>`,
    small: (n, a) => `  <path d="M2 6V2H14V4H4V6ZM2 9H4V12H6V14H2Z" fill="${n}"/>
  <path d="M7 7H14V14H7ZM9 9V12H12V9Z" fill="${a}" fill-rule="evenodd"/>`
  },
  {
    name: 'sleeve', label: 'Sleeve', idea: 'An open wrapping sleeve changes the container while a central media core stays intact.', rank: 4,
    large: (n, a) => `  <path d="M32 72L128 24L224 72V104L128 56L64 88V168L96 184V220L32 188Z" fill="${n}"/>
  <path d="M224 116V188L128 236V200L192 168V100Z" fill="${a}"/>
  <path d="M88 104H160V160H88Z" fill="${a}"/>`,
    small: (n, a) => `  <path d="M2 4L8 1L14 4V6L8 3L4 5V10L6 11V13L2 11Z" fill="${n}"/>
  <path d="M14 7V12L8 15V13L12 11V6Z" fill="${a}"/>
  <path d="M6 7H10V10H6Z" fill="${a}"/>`
  },
  {
    name: 'splice', label: 'Splice', idea: 'A slanted, open cut separates two film-strip ends without losing their frame rhythm.', rank: 3,
    large: (n, a) => `  <path d="M24 56H144L88 200H24ZM48 88V168H72L104 88Z" fill="${n}" fill-rule="evenodd"/>
  <path d="M176 56H232V200H120ZM192 88L160 168H208V88Z" fill="${a}" fill-rule="evenodd"/>
  <path d="M120 24H152V40H120ZM104 216H136V232H104Z" fill="${a}"/>`,
    small: (n, a) => `  <path d="M1 4H9L6 13H1ZM3 6V11H4L6 6Z" fill="${n}" fill-rule="evenodd"/>
  <path d="M11 4H15V13H8ZM12 6L10 11H13V6Z" fill="${a}" fill-rule="evenodd"/>`
  },
  {
    name: 'witness', label: 'Witness', idea: 'An open inspection frame closes through a check, making verification part of the frame itself.', rank: 2,
    large: (n, a) => `  <path d="M56 40H184V72H72V184H184V160H216V184Q216 216 184 216H72Q40 216 40 184V72Q40 40 56 40Z" fill="${n}"/>
  <path d="M88 120L112 96L144 128L200 64L224 88L144 176Z" fill="${a}"/>`,
    small: (n, a) => `  <path d="M3 2H11V4H4V12H12V10H14V13L13 14H3L2 13V3Z" fill="${n}"/>
  <path d="M5 7L7 5L9 7L13 3L15 5L9 11Z" fill="${a}"/>`
  },
  {
    name: 'lattice', label: 'Lattice', idea: 'Two machined rails form an abstract FE monogram, with a shared central working line.', rank: 5,
    large: (n, a) => `  <path d="M40 40H120V72H72V112H104V144H72V216H40Z" fill="${n}"/>
  <path d="M136 40H216V72H168V112H200V144H168V184H216V216H136Z" fill="${a}"/>`,
    small: (n, a) => `  <path d="M2 2H7V4H4V7H6V9H4V14H2Z" fill="${n}"/>
  <path d="M8 2H14V4H10V7H13V9H10V12H14V14H8Z" fill="${a}"/>`
  },
  {
    name: 'cadence', label: 'Cadence', idea: 'A measured signal crosses a video frame, linking sound, timing and picture.', rank: 6,
    large: (n, a) => `  <path d="M32 88V40H224V88H192V72H64V88ZM32 168H64V184H192V168H224V216H32Z" fill="${n}"/>
  <path d="M24 116H72L96 68L136 156L160 100L184 116H232V140H176L170 136L136 212L96 124L88 140H24Z" fill="${a}"/>`,
    small: (n, a) => `  <path d="M2 5V2H14V5H12V4H4V5ZM2 11H4V12H12V11H14V14H2Z" fill="${n}"/>
  <path d="M1 7H4L6 4L9 10L11 6L13 7H15V9H12L9 15L6 9L5 9H1Z" fill="${a}"/>`
  }
];
const escape = value => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
function svg(c, theme, kind) {
  const mono = kind === 'mono';
  const small = kind === 'small';
  const lockup = kind === 'lockup';
  const palette = palettes[theme];
  const foreground = mono ? 'currentColor' : palette.text;
  const accent = mono ? 'currentColor' : palette.orange;
  const drawing = small ? c.small(foreground, accent) : c.large(foreground, accent);
  const viewBox = lockup ? '0 0 560 96' : small ? '0 0 16 16' : '0 0 256 256';
  const width = lockup ? 560 : small ? 16 : 256;
  const height = lockup ? 96 : width;
  const body = lockup ? `  <g transform="translate(0 4) scale(.34375)">\n${drawing}\n  </g>
  <text x="112" y="61" fill="${foreground}" font-family="${font}" font-size="40" font-weight="600" letter-spacing="-.6">FFmpeg Encoder</text>` : drawing;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox}" role="img" aria-label="FFmpeg Encoder — ${c.label}${mono ? ' monochrome' : small ? ' optical 16 pixel mark' : lockup ? ' lockup' : ' mark'}">
  <title>${c.label}</title>
  <desc>${escape(c.idea)} Original candidate, November 14, 2026.</desc>
${body}
</svg>\n`;
}
for (const c of concepts) {
  for (const theme of ['dark', 'light']) {
    for (const [kind, suffix] of [['mark', 'mark'], ['small', 'mark-16'], ['lockup', 'lockup']]) {
      const text = svg(c, theme, kind);
      fs.writeFileSync(path.join(out, `${c.name}-${suffix}-${theme}.svg`), text);
      if (theme === 'dark') fs.writeFileSync(path.join(out, `${c.name}-${suffix}.svg`), text);
    }
  }
  fs.writeFileSync(path.join(out, `${c.name}-mono.svg`), svg(c, 'dark', 'mono'));
}

// The existing mark is copied inline, unchanged, solely for an offline comparison.
const shippedDir = path.join(root, 'assets', 'app-icon');
const shipped = Object.fromEntries(['', '-16', '-24', '-32'].map(suffix => [suffix, fs.readFileSync(path.join(shippedDir, `app-icon${suffix}.svg`), 'utf8').trim()]));
function inline(source, size, label, extra = '') {
  // Presentation dimensions change here, never the source paths or colour values.
  return source.replace(/<svg\b[^>]*>/, tag => tag
    .replace(/\bwidth="[^"]*"/, `width="${size}"`)
    .replace(/\bheight="[^"]*"/, `height="${size}"`)
    .replace(/\saria-labelledby="[^"]*"/, '')
    .replace(/\saria-label="[^"]*"/, '')
    .replace(/>$/, ` aria-label="${escape(label)}" ${extra}>`))
    .replace(/\sid="[^"]*"/g, '');
}
const sizes = [16, 24, 32, 48, 128, 256];
function current(size) { return inline(shipped[size <= 32 ? `-${size}` : ''], size, `Current Folded Frame at ${size} pixels`, 'data-role="current"'); }
function scaleRow(c, theme) {
  return `<div class="scale-row">${sizes.map(size => {
    const art = c ? inline(svg(c, theme, size <= 24 ? 'small' : 'mark'), size, `${c.label}, ${theme}, ${size} pixels`, `data-role="candidate" data-size="${size}" data-source="${size <= 24 ? 'optical' : 'master'}"`) : current(size);
    return `<figure>${art}<figcaption>${size}<span>px</span></figcaption></figure>`;
  }).join('')}</div>`;
}
function panel(c, theme) {
  const p = palettes[theme];
  const title = theme === 'dark' ? 'Dark / amber' : 'Light / teal';
  const details = c ? `<div class="secondary">
    <div class="mono-sample"><span class="micro">Single colour</span>${inline(svg(c, theme, 'mono'), 48, `${c.label}, monochrome on ${theme}`, 'data-role="mono"')}</div>
    <div class="lockup-sample"><span class="micro">Live system text</span>${svg(c, theme, 'lockup').replace('<svg ', '<svg data-role="lockup" ')}</div>
  </div>
  <div class="comparison"><span class="micro">Side by side · 32 px</span><div>${current(32)}<span>Current</span></div><div>${inline(svg(c, theme, 'mark'), 32, `${c.label} comparison`, 'data-role="comparison-candidate"')}<span>${c.label}</span></div></div>` : `<p class="baseline-note">Folded Frame · current shipped geometry and colours, including its original optical sources at 16, 24 and 32 px. Comparison only.</p>`;
  return `<section class="theme ${theme}" data-theme="${theme}" aria-label="${c ? c.label : 'Current icon'} on ${theme}"><div class="panel-heading"><h3>${title}</h3><span class="surface-token">--surface ${p.surface}</span></div>${scaleRow(c, theme)}${details}</section>`;
}
const cards = concepts.map((c, index) => `<article class="concept" id="${c.name}" data-concept="${c.name}">
  <div class="concept-heading"><div><span class="micro">Concept ${String(index + 1).padStart(2, '0')}</span><h2>${c.label}</h2></div><p>${c.idea}</p><span class="rank">Designer's rank ${c.rank} / 6</span></div>
  <div class="theme-pair">${panel(c, 'dark')}${panel(c, 'light')}</div>
  <p class="optical-note">16 &amp; 24 px use the dedicated optical drawing. 32–256 px use the 256-grid master. See NOTES.md for tradeoffs.</p>
</article>`).join('\n');
const declarations = theme => Object.entries(palettes[theme]).map(([token, colour]) => `--${token}:${colour}`).join(';');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; script-src 'none'; base-uri 'none'; form-action 'none'">
<title>FFmpeg Encoder · six original logo candidates</title>
<style>
:root{${declarations('dark')};font-family:${font};color:var(--text);background:var(--background);color-scheme:dark}
*{box-sizing:border-box}body{margin:0}main{max-width:1568px;padding:56px 32px 48px;margin:auto}h1,h2,h3,p,figure{margin:0}h1{font-size:clamp(32px,4.5vw,64px);font-weight:600;line-height:1.08;letter-spacing:-.045em;margin:18px 0}h1 span{color:var(--orange)}
.eyebrow,.micro{font-size:11px;line-height:1.5;letter-spacing:.1em;text-transform:uppercase;font-weight:600}.eyebrow{color:var(--orange)}.intro{max-width:760px;color:var(--muted);line-height:1.7;font-size:16px}.status{display:inline-block;margin-top:22px;border:1px solid var(--border);padding:9px 12px;border-radius:6px;color:var(--muted);font-size:13px}
nav{display:flex;gap:8px;flex-wrap:wrap;margin:28px 0 42px}a{color:var(--text);text-decoration:none;border:1px solid var(--border);border-radius:6px;padding:8px 14px;font-size:13px}a:hover,a:focus-visible{border-color:var(--orange);outline:2px solid var(--orange);outline-offset:2px}
.concept{padding-top:26px;margin-bottom:32px;border-top:1px solid var(--border);scroll-margin-top:16px}.concept-heading{display:flex;gap:24px;align-items:center;margin:0 0 20px}.concept-heading .micro{color:var(--orange)}h2{font-size:30px;font-weight:600;letter-spacing:-.025em}.concept-heading p{max-width:530px;color:var(--muted);font-size:14px;line-height:1.65}.rank{margin-left:auto;white-space:nowrap;color:var(--muted);font-size:12px}
.theme-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.theme{background:var(--surface);color:var(--text);padding:24px;border:1px solid var(--border);border-radius:12px;min-width:0}.theme.dark{${declarations('dark')};color-scheme:dark}.theme.light{${declarations('light')};color-scheme:light}
.panel-heading{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap}h3{font-size:13px;font-weight:600}.surface-token{color:var(--muted);font-size:11px}.scale-row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap;margin:28px 0 24px;min-height:280px}.scale-row figure{display:flex;flex-direction:column;align-items:center;gap:12px;flex:none}.scale-row svg{display:block;flex:none}.scale-row figcaption{font-size:11px;color:var(--muted);font-variant-numeric:tabular-nums}.scale-row figcaption span{font-size:9px;margin-left:2px}
.secondary{display:grid;grid-template-columns:80px minmax(0,1fr);gap:16px;padding-top:18px;border-top:1px solid var(--border)}.secondary .micro{display:block;color:var(--muted);font-size:9px;margin-bottom:12px;letter-spacing:.06em}.mono-sample svg{display:block}.lockup-sample svg{display:block;max-width:100%;width:420px;height:auto;max-height:72px}
.comparison{display:flex;align-items:center;gap:20px;margin-top:18px;padding-top:16px;border-top:1px solid var(--border);flex-wrap:wrap}.comparison>.micro{color:var(--muted);font-size:9px;letter-spacing:.05em}.comparison>div{display:flex;align-items:center;gap:8px;font-size:11px;color:var(--muted)}.baseline-note{font-size:12px;line-height:1.7;color:var(--muted);max-width:480px}.optical-note{color:var(--muted);font-size:11px;margin-top:10px}footer{border-top:1px solid var(--border);padding-top:24px;font-size:12px;color:var(--muted);line-height:1.7}footer strong{color:var(--text);font-weight:500}
@media(max-width:1330px){.theme-pair{grid-template-columns:1fr}.scale-row{min-height:0}.concept-heading{flex-wrap:wrap}.rank{margin-left:0}.concept-heading p{flex:1;min-width:260px}}
@media(max-width:600px){main{padding:32px 16px}.theme{padding:18px}.concept-heading{gap:12px}.concept-heading p{flex-basis:100%;min-width:0}.rank{width:100%}.secondary{grid-template-columns:60px minmax(0,1fr);gap:8px}.scale-row{gap:12px}h1{font-size:38px}.surface-token{font-size:10px}}
@media print{main{padding:16px}.concept{break-inside:avoid}.theme{print-color-adjust:exact;-webkit-print-color-adjust:exact}nav{display:none}}
</style>
</head>
<body><main>
<header><p class="eyebrow">FFmpeg Encoder / original artwork / 14 November 2026</p><h1>Careful work.<br><span>A clear signature.</span></h1><p class="intro">Six distinct directions for a tool that encodes, trims, resizes and remuxes video, then checks the result. Real theme colours. Real small sizes. The current Folded Frame sits beside each candidate.</p><p class="status">Candidates for Claude's theme review and Ahmed's selection · shipped icon remains unchanged</p></header>
<nav aria-label="Concepts"><a href="#current">Current icon</a>${concepts.map(c => `<a href="#${c.name}">${c.label}</a>`).join('')}</nav>
<article class="concept" id="current"><div class="concept-heading"><div><span class="micro">Comparison baseline</span><h2>Folded Frame</h2></div><p>The existing icon, included inline so this entire review works offline.</p></div><div class="theme-pair">${panel(null, 'dark')}${panel(null, 'light')}</div></article>
${cards}
<footer><strong>Original artwork created in this job.</strong> Candidate geometry is hand-authored SVG; lockups use live system text. No raster artwork, downloaded fonts or network requests. The comparison icon retains its existing provenance and ISC licence. Theme colours come from ui/styles.css. NOTES.md records tokens, small-size decisions, weaknesses and the designer's ranking. Review candidates only; no app integration or owner acceptance is implied.</footer>
</main></body></html>\n`;
fs.writeFileSync(path.join(out, 'preview.html'), html);
console.log(`Wrote ${concepts.length * 10} SVGs and the self-contained preview in ${path.relative(root, out)}.`);
