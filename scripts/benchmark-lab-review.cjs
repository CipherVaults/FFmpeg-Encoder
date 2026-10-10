'use strict';

// Presentation only. The runner supplies verified, aligned assets and retains
// the separate reveal key. No commands, encoder options or scores are invented
// in the review page, and it cannot authorize or launch a benchmark run.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

function randomizedOrder(entries, seed, namespace) {
  assert.equal(typeof seed, 'string'); assert.ok(seed.length >= 16);
  return [...entries].sort((a, b) => {
    const rank = item => crypto.createHash('sha256').update(`${seed}:${namespace}:${item.id}`).digest('hex');
    return rank(a).localeCompare(rank(b));
  });
}

function assetPath(value) {
  assert.equal(typeof value, 'string');
  assert.match(value, /^[A-Za-z0-9_.\/-]+$/);
  assert.ok(!value.startsWith('/') && !value.split('/').some(part => part === '..' || part === '.'), 'Review asset escapes its bundle.');
  return value;
}

function reviewHtml(pack) {
  assert.ok(pack.groups.length > 0);
  for (const group of pack.groups) {
    assert.ok(group.entries.length >= 2 && group.frameIndices.length > 0);
    for (const entry of group.entries) {
      assetPath(entry.clip); entry.images.forEach(assetPath);
      assert.equal(entry.images.length, group.frameIndices.length);
    }
  }
  // Script JSON is data, never concatenated source text from a media filename.
  const encoded = JSON.stringify(pack).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Phase 1 calibration review</title><style>
body{font:16px system-ui,sans-serif;margin:24px;color:#17212b;background:#fff}main{max-width:1440px;margin:auto}
button,select{font:inherit;padding:8px 12px;margin:4px;border:1px solid #8497aa;border-radius:6px;background:#fff;color:inherit}
button[aria-pressed=true]{background:#e8f3ff;border-color:#147ac1}button:focus-visible,select:focus-visible,a:focus-visible{outline:3px solid #eb8523;outline-offset:2px}
.muted{color:#4b6072}.controls{display:flex;flex-wrap:wrap;align-items:center;gap:8px}.viewport{overflow:auto;max-height:78vh;border:1px solid #bdcbd6;margin:16px 0;background:#111}
img{display:block;width:auto;max-width:none;height:auto}.fit img{max-width:100%;height:auto}.note{background:#eef5fb;padding:12px;border-radius:6px}a{color:#006bb3}
</style><main><h1>Native calibration review</h1>
<p class="note">Compare captured source, the accepted x265 reference and blinded candidates. These sources were already compressed; source-relative fidelity is not lossless game-render fidelity. Judge texture in motion, foliage, particles, darkness and text. Scores are deliberately absent from this page.</p>
<div class="controls"><label>Scene <select id="scene"></select></label><label>Matched frame <select id="frame"></select></label><button id="scale" aria-pressed="false">Fit view</button></div>
<p id="context" class="muted"></p><div id="choices" class="controls" aria-label="Comparison images"></div>
<p id="selected" aria-live="polite"></p><div class="viewport" id="viewport"><img id="image" alt=""></div>
<p><a id="motion" href="">Open this motion clip</a> · For native motion playback, open the numbered files in your existing MPC-HC. All clips use the same presentation frames and source timing; no audio is included.</p>
<p class="muted">Start at 100% (one image pixel per displayed CSS pixel); Fit view helps navigate but resizes the image. Browser/Windows display scaling may still affect physical pixel mapping. Use keyboard Tab and Enter on controls, or keys 1–9 to switch labels. Preserve the same scroll position to compare fine detail. The separate reveal key contains exact tested settings.</p>
<p>Record: scene, label, texture/motion/text concerns, whether it appears close enough to the reference, and your preferred trade-off. These judgments select finalists; they do not modify application settings.</p>
<script>const pack=${encoded};let groupIndex=0,entryIndex=0,frameIndex=0,fit=false;
const el=id=>document.getElementById(id),scene=el('scene'),frame=el('frame');
pack.groups.forEach((g,i)=>{const o=document.createElement('option');o.value=i;o.textContent=g.title;scene.append(o)});
function draw(){const g=pack.groups[groupIndex],e=g.entries[entryIndex];el('image').src=e.images[frameIndex];el('image').alt=g.title+' · '+e.label+' · matched source frame '+g.frameIndices[frameIndex];el('motion').href=e.clip;el('selected').textContent=e.label+' · '+g.width+' × '+g.height+' · source frame '+g.frameIndices[frameIndex];el('viewport').classList.toggle('fit',fit);el('scale').textContent=fit?'Show 100%':'Fit view';el('scale').setAttribute('aria-pressed',String(fit));Array.from(el('choices').children).forEach((b,i)=>b.setAttribute('aria-pressed',String(i===entryIndex)))}
function group(){const g=pack.groups[groupIndex];frame.replaceChildren();g.frameIndices.forEach((n,i)=>{const o=document.createElement('option');o.value=i;o.textContent='Frame '+n;frame.append(o)});el('context').textContent=g.context;el('choices').replaceChildren();g.entries.forEach((e,i)=>{const b=document.createElement('button');b.textContent=(i+1)+'. '+e.label;b.onclick=()=>{entryIndex=i;draw()};el('choices').append(b)});entryIndex=0;frameIndex=0;draw()}
scene.onchange=()=>{groupIndex=Number(scene.value);group()};frame.onchange=()=>{frameIndex=Number(frame.value);draw()};el('scale').onclick=()=>{fit=!fit;draw()};document.addEventListener('keydown',e=>{if(/^[1-9]$/.test(e.key)&&e.target.tagName!=='SELECT'){const i=Number(e.key)-1;if(i<pack.groups[groupIndex].entries.length){entryIndex=i;draw()}}});group();</script></main></html>`;
}

module.exports = { randomizedOrder, assetPath, reviewHtml };
