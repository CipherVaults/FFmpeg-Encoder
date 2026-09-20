'use strict';

// Targeted L recipe UI evidence. This uses the real isolated app and real
// startup capability probes; the unavailable-device view is explicitly injected
// after those checks and is not evidence of a physical unsupported GPU.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { _electron } = require('playwright');
const { describeRecipe } = require('../src/media.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', `archive-quality-ui-smoke-${Date.now()}-${randomUUID().slice(0,8)}`);
const userData = path.join(artifacts, 'user-data');
const report = { status: 'running', time: new Date().toISOString(), artifacts, checks: [], sessions: [], errors: [], limits: [
  'Folder-picker results are substituted with empty harness-owned directories; no personal recordings are touched.',
  'Startup capability probes are real. This UI flow does not encode prepared media or prove Archive Quality perception, filesize, or portable behavior.',
  'Unavailable recipe is a deliberately substituted main capability response after real probes; not physical unsupported-hardware evidence.',
  'Screenshots and geometry use native Electron content sizes. Vertical scrolling is allowed.',
] };
let app, page;
async function close() { if (app) { await app.close(); app=null; } }
async function launch(label) {
  const env={...process.env}; delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({ executablePath:path.join(root,'node_modules/electron/dist/electron.exe'), args:[root,`--user-data-dir=${userData}`],cwd:root,env });
  page=await app.firstWindow(); page.on('pageerror',e=>report.errors.push(e.message));
  await page.waitForFunction(()=>!document.querySelector('#choose-input')?.disabled,undefined,{timeout:120000});
  const caps=await page.evaluate(()=>window.encoder.getCapabilities());
  const session={label,caps,boundary:await page.evaluate(()=>({require:typeof require,process:typeof process,methods:Object.keys(window.encoder).sort()}))};
  report.sessions.push(session);assert.equal(session.boundary.require,'undefined');assert.equal(session.boundary.process,'undefined');
  return caps;
}
async function persisted(expected) {
  await page.waitForFunction(async wanted=>{
    const p=await window.encoder.getPreferences();const v=p.settingsByProfile[wanted.profileId];
    return p.profileId===wanted.profileId&&v?.preset===wanted.preset&&v?.quality===wanted.quality&&(v?.recipeId||null)===(wanted.recipeId||null);
  },expected,{timeout:10000});
}
async function visibleSettings() {
  return page.evaluate(()=>({profileId:document.querySelector('#profile').value,preset:document.querySelector('#preset').value,quality:Number(document.querySelector('#quality').value)}));
}
async function canonicalDisplay(settings) {
  const expected=describeRecipe(settings).args;
  await page.waitForFunction(args=>{try{return JSON.stringify(JSON.parse(document.querySelector('#recipe-args').textContent))===JSON.stringify(args);}catch{return false;}},expected);
  assert.deepEqual(JSON.parse(await page.textContent('#recipe-args')),expected);
  return expected;
}
async function main() {
  await fs.mkdir(artifacts,{recursive:true});
  try {
    report.sourceHashes={};
    for(const file of ['ui/index.html','ui/renderer.js','ui/styles.css','src/media.cjs','src/capabilities.cjs','src/preferences.cjs','src/encoder-service.cjs'])report.sourceHashes[file]=createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex');
    const caps=await launch('recipe interaction');
    const recipe=caps.recipes.find(r=>r.profileId==='h265-nvidia');assert.ok(recipe);assert.equal(recipe.available,true,JSON.stringify(recipe));
    report.recipe=recipe;
    const input=path.join(artifacts,'empty-input'),output=path.join(artifacts,'empty-output');
    await fs.mkdir(input);await fs.mkdir(output);
    await app.evaluate(({dialog},folders)=>{let n=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folders[n++]]});},[input,output]);
    await page.click('#choose-input');await page.click('#choose-output');
    await page.selectOption('#profile',recipe.profileId);
    await page.click('#archive-quality');
    const initial={profileId:recipe.profileId,preset:recipe.preset,quality:recipe.quality,recipeId:recipe.id};
    await persisted(initial);assert.deepEqual(await visibleSettings(),{profileId:recipe.profileId,preset:recipe.preset,quality:recipe.quality});
    assert.equal(await page.isEnabled('#preset'),true);assert.equal(await page.isEditable('#quality'),true);
    assert.equal(await page.getAttribute('#current-recipe','open'),'');
    report.initialArgs=await canonicalDisplay(initial);
    await page.hover('#archive-help');
    await page.waitForFunction(()=>document.querySelector('#archive-help').getAttribute('aria-expanded')==='true');
    assert.deepEqual(JSON.parse(await page.textContent('#archive-args')),describeRecipe(initial).args);
    assert.match(await page.textContent('#archive-evidence-note'),/Ada|Blackwell/);
    await page.keyboard.press('Escape');await page.focus('#archive-help');await page.keyboard.press('ArrowDown');
    assert.equal(await page.evaluate(()=>document.activeElement.id),'archive-help-details-content');
    await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>document.activeElement.id),'archive-args');
    await page.keyboard.press('End');
    await page.waitForFunction(()=>{const el=document.querySelector('#archive-args');return el.scrollHeight<=el.clientHeight||el.scrollTop>0;});
    await page.keyboard.press('Escape');assert.equal(await page.evaluate(()=>document.activeElement.id),'archive-help');
    report.geometry=[];
    for(const size of [{width:1100,height:800},{width:640,height:480}]) {
      await app.evaluate(({BrowserWindow},s)=>BrowserWindow.getAllWindows()[0].setContentSize(s.width,s.height),size);
      await page.click('#archive-help');await page.locator('#archive-help-details-content').scrollIntoViewIfNeeded();
      const geometry=await page.locator('#archive-help-details-content').evaluate(el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:el.scrollWidth,client:el.clientWidth};});
      assert.ok(geometry.left>=0&&geometry.right<=geometry.width&&geometry.scroll<=geometry.client+1);
      await page.screenshot({path:path.join(artifacts,`archive-help-${size.width}.png`),fullPage:true});
      await page.keyboard.press('Escape');
      report.geometry.push({size,geometry});
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1100,800));
    const manual={...initial,preset:recipe.preset==='p6'?'p5':'p6',quality:recipe.quality===27?28:27};
    await page.selectOption('#preset',manual.preset);await page.fill('#quality',String(manual.quality));await persisted(manual);
    assert.match(await page.textContent('#active-recipe'),/modified preset\/quality/);report.modifiedArgs=await canonicalDisplay(manual);
    await page.click('#clear-recipe');const standard={profileId:manual.profileId,preset:manual.preset,quality:manual.quality};
    await persisted(standard);assert.deepEqual(await visibleSettings(),standard);assert.equal(await page.isVisible('#active-recipe'),false);report.standardArgs=await canonicalDisplay(standard);
    assert.notDeepEqual(report.modifiedArgs,report.standardArgs);
    await page.click('#archive-quality');await persisted(initial);
    await page.selectOption('#preset',manual.preset);await page.fill('#quality',String(manual.quality));await persisted(manual);
    await page.selectOption('#profile','h264-cpu');assert.equal(await page.isVisible('#archive-quality-row'),false);
    await page.selectOption('#profile',recipe.profileId);await persisted(manual);await canonicalDisplay(manual);
    const before=await page.evaluate(()=>window.encoder.getPreferences());
    await close();await launch('remembered recipe restart');
    await persisted(manual);await canonicalDisplay(manual);
    assert.equal(await page.isVisible('#active-recipe'),true);
    const after=await page.evaluate(()=>window.encoder.getPreferences());assert.notEqual(before.inputFolder.id,after.inputFolder.id);
    // Only this main-side response is substituted; renderer/preload/save/clear
    // paths stay real. Its purpose is to verify no silent fallback in the UI.
    await app.evaluate((_,modulePath)=>{
      const req=process.getBuiltinModule('module').createRequire(modulePath);const {EncoderService}=req(modulePath);
      const original=EncoderService.prototype.getCapabilities;
      EncoderService.prototype.getCapabilities=async function(...args){const caps=structuredClone(await original.apply(this,args));caps.recipes=caps.recipes.map(r=>({...r,available:false,supportedBitDepths:[],reason:'Simulated unavailable recipe for UI acceptance.'}));return caps;};
    },path.join(root,'src/encoder-service.cjs'));
    await page.reload();await page.waitForFunction(()=>!document.querySelector('#choose-input').disabled);
    assert.equal(await page.isVisible('#active-recipe'),true);assert.match(await page.textContent('#recipe-unavailable'),/Simulated unavailable/);
    assert.equal(await page.isEnabled('#prepare-batch'),false);assert.equal(await page.isEnabled('#archive-quality'),false);
    assert.deepEqual(await visibleSettings(),standard);
    await page.screenshot({path:path.join(artifacts,'remembered-unavailable-recipe.png'),fullPage:true});
    await page.click('#clear-recipe');await persisted(standard);assert.equal(await page.isEnabled('#prepare-batch'),true);
    await page.click('#tested-default');
    const defaults=describeRecipe(initial).testedDefault.settings;await persisted(defaults);
    assert.deepEqual(await visibleSettings(),defaults);await canonicalDisplay(defaults);assert.equal(await page.isVisible('#active-recipe'),false);
    report.checks.push('Archive helper uses main capability values, exposes canonical full recipe options and leaves ordinary controls editable.',
      'Recipe help supports hover and keyboard focus/ArrowDown/Escape; it remains bounded at normal and minimum content sizes.',
      'Manual preset/CQ edits retain the named additional options and display modified state; Use standard options removes only recipeId.',
      'Recipe selection and manual edits survive profile switching and actual app restart without reusable folder authority.',
      'A simulated unavailable remembered recipe remains visible, blocks Review and never silently falls back; explicit clearing restores ordinary preparation.',
      'Tested Default remains distinct and resets to ordinary canonical defaults without recipeId.');
    assert.deepEqual(report.errors,[]);report.status='passed';
  } catch(error) {
    report.status='failed';report.failure={message:error.message,stack:error.stack};
    if(page&&!page.isClosed()){await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});report.failureText=await page.locator('body').innerText().catch(()=>null);}
    throw error;
  } finally {await close();await fs.writeFile(path.join(artifacts,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,report:path.join(artifacts,'report.json')}));}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
