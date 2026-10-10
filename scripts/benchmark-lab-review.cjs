'use strict';

// Presentation only. The runner supplies verified, aligned assets and retains
// the separate reveal key. This page neither collects judgments nor authorizes
// benchmark work. Access mode adds one bounded existing-player action; the
// loopback server maps its scene/index to immutable media, never an input path.
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
      assert.match(entry.label, /^(Captured source|x265 reference|Candidate [A-Z])$/);
    }
  }
  // Whitelist presentation data: no scores or case metadata can accidentally
  // enter the browser. Sorting scenes never changes any candidate order.
  const page = { groups: pack.groups.map(g => ({ id: g.id, title: g.title, context: g.context,
    width: g.width, height: g.height, frameIndices: [...g.frameIndices],
    entries: g.entries.map(e => ({ label: e.label, clip: e.clip, images: [...e.images] })) })) };
  if (pack.access) {
    assert.equal(typeof pack.access.playerAvailable, 'boolean');
    assert.equal(typeof pack.access.csrfToken, 'string');
    page.access = { playerAvailable: pack.access.playerAvailable, csrfToken: pack.access.csrfToken };
  }
  const encoded = JSON.stringify(page).replaceAll('<', '\\u003c').replaceAll('\u2028', '\\u2028').replaceAll('\u2029', '\\u2029');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>FFmpeg Visual Review</title><style>
*{box-sizing:border-box}body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#17212b;background:#f4f7fa}main{max-width:1440px;margin:auto;padding:24px}
h1{font-size:clamp(1.7rem,4vw,2.4rem);margin:0 0 10px}h2{margin:0 0 12px}p{margin:10px 0}button,select,textarea{font:inherit;color:inherit}
button,select{padding:9px 14px;border:1px solid #8497aa;border-radius:8px;background:#fff;cursor:pointer}button:hover{background:#eef5fb}
button[aria-pressed=true],.primary{background:#e8f3ff;border-color:#147ac1}button:disabled{cursor:wait;opacity:.6}
button:focus-visible,select:focus-visible,a:focus-visible,textarea:focus-visible,[tabindex]:focus-visible{outline:3px solid #eb8523;outline-offset:3px}
.muted{color:#4b6072}.panel{background:#fff;border:1px solid #d5e0e9;border-radius:12px;padding:20px;margin:18px 0}.note{background:#eef5fb;padding:14px;border-radius:8px}
.scene-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin:20px 0}.scene-card{text-align:left;padding:20px;min-height:125px;display:flex;flex-direction:column;gap:8px}.scene-card strong{font-size:1.15rem}.scene-card span{font-size:.93rem;color:#4b6072}
.controls{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin:12px 0}.viewport{overflow:auto;max-height:76vh;border:1px solid #bdcbd6;margin:16px 0;background:#111}
img{display:block;width:auto;max-width:none;height:auto}.fit img{max-width:100%;height:auto}.motion-viewport{background:#111;max-width:100%;margin:16px 0}video{display:block;width:100%;max-height:72vh;background:#111}
textarea{display:block;width:100%;min-height:290px;padding:12px;border:1px solid #8497aa;border-radius:8px;resize:vertical;background:#fbfdff;line-height:1.5}
.status{min-height:1.5em}.error{color:#9b3028}a{color:#006bb3}[hidden]{display:none!important}.details{font-size:.93rem}.selected{font-weight:600}.tabs{padding-bottom:12px;border-bottom:1px solid #d5e0e9}
@media(max-width:800px){.scene-grid{grid-template-columns:repeat(2,minmax(0,1fr))}main{padding:16px}.panel{padding:16px}}@media(max-width:480px){.scene-grid{grid-template-columns:1fr}.scene-card{min-height:100px}}
</style></head><body><main><h1>FFmpeg Visual Review</h1>
<section id="home" aria-labelledby="home-title"><h2 id="home-title">Choose a scene</h2>
<p>Compare the captured source and x265 reference with the lettered candidates. Tell me which candidates you prefer, whether they look close enough to x265, and any visible problems. <strong>“None close enough” is a useful answer.</strong></p>
<p class="note"><strong>Start with Crimson Desert.</strong> Then try Expedition 33 and Forza. Check stills at the same frame and position; watch motion for texture loss, shimmer and flicker. <strong>Candidate letters differ between scenes:</strong> Candidate A here is unrelated to Candidate A elsewhere.</p>
<div id="scene-list" class="scene-grid" aria-label="Six review scenes"></div>
<p class="muted">No scores or candidate encoder identities are shown. Your response stays in your hands; this page does not save or submit feedback and does not start benchmark runs.</p>
</section>
<section id="viewer" class="panel" hidden aria-labelledby="scene-title"><div class="controls"><button id="back">← All scenes</button><label for="scene">Scene</label><select id="scene"></select><button id="go-response">Response template</button></div>
<h2 id="scene-title" tabindex="-1"></h2><p id="context" class="muted"></p>
<div id="choices" class="controls" aria-label="Captured source, reference and candidate choices"></div><p id="selected" class="selected" aria-live="polite"></p>
<div class="controls tabs" aria-label="Review mode"><button id="stills-tab" aria-pressed="true">Matched stills</button><button id="motion-tab" aria-pressed="false">Motion clip</button></div>
<section id="stills"><div class="controls"><label for="frame">Matched frame</label><select id="frame"></select><button id="scale" aria-pressed="true">Show native 100%</button></div>
<p class="details muted">Native 100% keeps one image pixel per CSS pixel; scroll to inspect detail. Fit view resizes the image. Windows/browser display scaling may still change physical pixel mapping. Switching candidates preserves your scroll position.</p>
<div class="viewport fit" id="viewport"><img id="image" alt=""></div><p id="image-status" class="status error" role="status"></p></section>
<section id="motion-section" hidden><p>Watch the same short scene in each candidate. Clips have no audio. Playback depends on your browser’s support for these existing files.</p>
<div class="motion-viewport"><video id="video" controls playsinline preload="metadata" aria-label="Selected blind review motion clip"></video></div>
<p id="video-status" class="status" role="status">Press Play to check browser playback.</p>
<div class="controls"><button id="player" hidden>Open selected clip in local player (MPC-HC)</button><a id="motion" href="" target="_blank" rel="noopener">Open existing clip directly</a></div>
<p id="player-help" class="details muted"></p><p id="player-status" class="status" role="status"></p></section>
<p class="details muted">Use Tab and Enter on controls. Keys 1–9 switch the numbered choices. Return to All scenes at any time. These sources were already compressed: they are capture references, not lossless game-render ground truth.</p>
</section>
<section id="response" class="panel" aria-labelledby="response-title"><h2 id="response-title" tabindex="-1">Your response template</h2>
<p>Copy this template and replace the brackets in your reply to Codex. Candidate letters are scene-specific. Include stills <em>and</em> motion observations where possible.</p>
<textarea id="template" readonly aria-label="Copyable six-scene response template" spellcheck="false"></textarea>
<div class="controls"><button id="copy" class="primary">Copy response template</button><button id="select-template">Select template text</button></div><p id="copy-status" class="status" role="status"></p>
</section></main><script>
const pack=${encoded};
const names={'cd-b':'Crimson Desert','e33-a':'Expedition 33','fh5-a':'Forza Horizon 5','acc-a':'Assetto Corsa Competizione','desk-b':'Desktop','sf-b':'Starfield'};
const priority=['cd-b','e33-a','fh5-a','acc-a','desk-b','sf-b'];
const groups=[...pack.groups].sort((a,b)=>{const rank=g=>priority.includes(g.id)?priority.indexOf(g.id):priority.length;return rank(a)-rank(b)});
let groupIndex=0,entryIndex=0,frameIndex=0,fit=true,mode='stills',videoEntry=null;
const el=id=>document.getElementById(id),scene=el('scene'),frame=el('frame'),video=el('video');
const sceneName=g=>names[g.id]||g.title;
groups.forEach((g,i)=>{const o=document.createElement('option');o.value=i;o.textContent=sceneName(g);scene.append(o);const b=document.createElement('button');b.className='scene-card';const name=document.createElement('strong');name.textContent=(i+1)+'. '+sceneName(g);const detail=document.createElement('span');detail.textContent=g.context;b.append(name,detail);b.onclick=()=>openScene(i);el('scene-list').append(b)});
el('template').value=groups.map(g=>sceneName(g)+':\\nPreferred candidate letter(s): [ ]\\nClose enough to x265: [yes / borderline / no / none close enough]\\nVisible problems or observations: [ ]').join('\\n\\n');
function videoStatus(text,error=false){el('video-status').textContent=text;el('video-status').classList.toggle('error',error)}
function loadVideo(){const g=groups[groupIndex],e=g.entries[entryIndex];video.style.aspectRatio=g.width+'/'+g.height;if(videoEntry!==e.clip){video.pause();video.src=e.clip;video.load();videoEntry=e.clip;videoStatus('Press Play to check browser playback. If it fails, use the local-player option below.')}video.setAttribute('aria-label',sceneName(g)+' · '+e.label+' motion clip')}
function draw(){const g=groups[groupIndex],e=g.entries[entryIndex],image=el('image');if(image.getAttribute('src')!==e.images[frameIndex]){image.style.visibility='hidden';el('image-status').classList.remove('error');el('image-status').textContent='Loading selected still…';image.src=e.images[frameIndex]}image.alt=sceneName(g)+' · '+e.label+' · matched source frame '+g.frameIndices[frameIndex];el('motion').href=e.clip;el('selected').textContent=e.label+' · '+g.width+' × '+g.height+' · matched source frame '+g.frameIndices[frameIndex];el('viewport').classList.toggle('fit',fit);el('scale').textContent=fit?'Show native 100%':'Fit view';el('scale').setAttribute('aria-pressed',String(fit));Array.from(el('choices').children).forEach((b,i)=>b.setAttribute('aria-pressed',String(i===entryIndex)));el('player-status').textContent='';if(mode==='motion')loadVideo()}
function group(){const g=groups[groupIndex];scene.value=groupIndex;el('scene-title').textContent=sceneName(g);frame.replaceChildren();g.frameIndices.forEach((n,i)=>{const o=document.createElement('option');o.value=i;o.textContent='Frame '+n;frame.append(o)});el('context').textContent=g.context;el('choices').replaceChildren();g.entries.forEach((e,i)=>{const b=document.createElement('button');b.textContent=(i+1)+'. '+e.label;b.onclick=()=>{entryIndex=i;draw()};el('choices').append(b)});entryIndex=0;frameIndex=0;el('viewport').scrollTo(0,0);draw()}
function openScene(i){groupIndex=i;group();el('home').hidden=true;el('viewer').hidden=false;el('scene-title').focus();el('viewer').scrollIntoView({block:'start'})}
function returnHome(){video.pause();el('viewer').hidden=true;el('home').hidden=false;const card=el('scene-list').children[groupIndex];card.focus();el('home').scrollIntoView({block:'start'})}
function changeMode(next){mode=next;el('stills').hidden=mode!=='stills';el('motion-section').hidden=mode!=='motion';el('stills-tab').setAttribute('aria-pressed',String(mode==='stills'));el('motion-tab').setAttribute('aria-pressed',String(mode==='motion'));if(mode==='motion')loadVideo();else video.pause()}
scene.onchange=()=>{groupIndex=Number(scene.value);group()};frame.onchange=()=>{frameIndex=Number(frame.value);draw()};el('scale').onclick=()=>{fit=!fit;draw()};el('back').onclick=returnHome;el('stills-tab').onclick=()=>changeMode('stills');el('motion-tab').onclick=()=>changeMode('motion');
el('go-response').onclick=()=>{video.pause();el('response-title').focus();el('response').scrollIntoView({block:'start'})};
// A queued load event from the preceding candidate must not reveal its image
// beneath the newly selected label. Only reveal the currently selected still.
el('image').onload=()=>{const image=el('image'),expected=new URL(groups[groupIndex].entries[entryIndex].images[frameIndex],document.baseURI).href;if(image.complete&&image.naturalWidth>0&&image.currentSrc===expected){image.style.visibility='visible';el('image-status').textContent=''}};
el('image').onerror=()=>{el('image-status').classList.add('error');el('image-status').textContent='This still could not be opened. Return to All scenes and reopen the scene; no comparison asset is changed.'};
video.addEventListener('playing',()=>videoStatus('Browser playback is running. Judge motion as well as still detail.'));
video.addEventListener('error',()=>videoStatus('This browser could not play the existing clip. Use “Open selected clip in local player” for reliable playback.',true));
video.addEventListener('loadedmetadata',()=>videoStatus('Clip loaded. Press Play; metadata alone does not confirm successful playback.'));
if(pack.access&&pack.access.playerAvailable){el('player').hidden=false;el('player-help').textContent='Uses your installed MPC-HC and the selected blind clip. If its window opens behind the browser, select MPC-HC on the taskbar. These short clips finish in about 12 seconds; press Play to watch again. Stop can show a black picture. Keep renderer statistics hidden for blind review (Ctrl+J toggles them). No files are converted.'}
else{el('player-help').textContent='If browser playback fails, open the existing clip link with your installed local player. No clips are converted or replaced.'}
el('player').onclick=async()=>{const g=groups[groupIndex],i=entryIndex,b=el('player');b.disabled=true;el('player-status').textContent='Opening '+sceneName(g)+' · '+g.entries[i].label+' in MPC-HC…';try{const r=await fetch('/player',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sceneId:g.id,entryIndex:i,token:pack.access.csrfToken})});if(!r.ok)throw new Error('Local player request failed');el('player-status').textContent='Opened '+sceneName(g)+' · '+g.entries[i].label+' in MPC-HC.'}catch{el('player-status').textContent='The local player could not be opened. Reopen the Desktop shortcut and try again.'}finally{b.disabled=false}};
function selectTemplate(){el('template').focus();el('template').select();el('copy-status').textContent='Template selected. Press Ctrl+C, then paste and fill it in your Codex reply.'}
el('select-template').onclick=selectTemplate;el('copy').onclick=async()=>{try{if(!navigator.clipboard||!window.isSecureContext)throw new Error('Clipboard unavailable');await navigator.clipboard.writeText(el('template').value);el('copy-status').textContent='Copied. Paste into your Codex reply and replace the brackets.'}catch{selectTemplate()}};
document.addEventListener('keydown',e=>{if(el('viewer').hidden||e.altKey||e.ctrlKey||e.metaKey||e.target.closest('select,input,textarea,[contenteditable="true"]'))return;if(/^[1-9]$/.test(e.key)){const i=Number(e.key)-1;if(i<groups[groupIndex].entries.length){entryIndex=i;draw();e.preventDefault()}}});
</script></body></html>`;
}

module.exports = { randomizedOrder, assetPath, reviewHtml };
