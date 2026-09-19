'use strict';

// L workflow endpoint acceptance. Only generated fixtures beneath this run's artifact
// directory are changed. Electron/main/preload/UI, tools and NTFS publication
// are real; picker substitution and deliberately seeded journal/race cases are
// identified individually in the report. This is not portable acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { classifyMarker, ProvenanceJournal } = require('../src/provenance.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', `workflow-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`);
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = {
  time: new Date().toISOString(), artifacts, status: 'running', sessions: [], cases: [], checks: [], errors: [],
  limitations: [
    'Folder picker returns are substituted; UI buttons, preload, validated IPC and main planning/encoding are real.',
    'Media fixtures are generated beneath this run directory. No personal archive media or external output is used.',
    'Recovery and identity-index fixtures deliberately seed local bookkeeping; race timing is injected where stated. These cases do not simulate power loss.',
    'Child spawn/close are observed at the real process-runner callback. This is not an independent Windows process census.',
    'Native local NTFS on this machine is covered. Junction/reparse storage fixtures and clean-machine/portable acceptance are not covered here.',
    'No broad profile option or perceptual-quality matrix is repeated.',
  ],
};
const protectedFiles = new Map();
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const protect = async file => protectedFiles.set(file, await hash(file));
const probe = async file => JSON.parse((await runTool(ffprobe, ['-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', file])).stdout);
const save = () => fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
let current;

async function folder(name) {
  const result = path.join(artifacts, name);
  await fs.mkdir(result, { recursive: true });
  return result;
}

async function fixture(file, { duration = 1, size = '320x180', tags = [] } = {}) {
  await runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i',
    `testsrc2=size=${size}:rate=24:duration=${duration},setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited`,
    '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    ...tags.flatMap(tag => ['-metadata', tag]), '-n', file], { timeoutMs: 120000 });
  await protect(file);
}

async function until(predicate, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let state;
  while (Date.now() < deadline) {
    state = await current.page.evaluate(() => window.encoder.getSnapshot());
    if (predicate(state)) return state;
    await pause(30);
  }
  throw new Error(`Application state timed out: ${JSON.stringify(state)}`);
}

async function close() {
  if (!current) return;
  const { app, page, session } = current;
  if (!page.isClosed()) {
    await page.evaluate(async () => {
      const state = await window.encoder.getSnapshot();
      if (['preparing', 'running', 'checking', 'cancelling'].includes(state.phase) && state.batchId) await window.encoder.cancelBatch({ batchId: state.batchId });
    }).catch(() => {});
    session.commands = await app.evaluate(() => globalThis.__sameFolderSmoke.commands).catch(() => []);
    session.lastSnapshot = await page.evaluate(() => window.encoder.getSnapshot()).catch(() => null);
  }
  await app.close();
  current = null;
}

async function launch(label, userData) {
  await close();
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({ executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root, `--user-data-dir=${userData}`], cwd: root, env });
  const page = await app.firstWindow();
  const session = { label, userData, mainPid: await app.evaluate(() => process.pid) };
  current = { app, page, session }; report.sessions.push(session);
  page.on('pageerror', error => report.errors.push({ label, message: error.message }));
  await page.waitForFunction(() => document.querySelector('#profile') && !document.querySelector('#profile').disabled, undefined, { timeout: 120000 });
  session.capabilities = await page.evaluate(() => window.encoder.getCapabilities());
  session.boundary = await page.evaluate(() => ({ requireType: typeof require, processType: typeof process, methods: Object.keys(window.encoder).sort() }));
  assert.equal(session.boundary.requireType, 'undefined'); assert.equal(session.boundary.processType, 'undefined');
  assert.ok(session.boundary.methods.includes('treatAsOriginal'));
  await app.evaluate((_electron, modulePath) => {
    const require = process.getBuiltinModule('module').createRequire(modulePath);
    const { EncoderService } = require(modulePath);
    const prepare = EncoderService.prototype.prepareBatch;
    const harness = globalThis.__sameFolderSmoke = { service: null, commands: [] };
    EncoderService.prototype.prepareBatch = function (...args) {
      harness.service = this;
      if (!this.__sameFolderObserved) {
        this.__sameFolderObserved = true;
        const run = this.run;
        this.run = (executable, argv, options = {}) => {
          if (!options.onProgress) return run(executable, argv, options);
          const entry = { executable, argv, spawnedAt: null, closedAt: null, pid: null };
          harness.commands.push(entry);
          return run(executable, argv, { ...options, onChild(child) {
            entry.pid = child.pid; entry.spawnedAt = Date.now();
            child.once('close', (code, signal) => { entry.closedAt = Date.now(); entry.code = code; entry.signal = signal; });
            options.onChild?.(child);
          } });
        };
      }
      return prepare.apply(this, args);
    };
  }, path.join(root, 'src', 'encoder-service.cjs'));
  return current;
}

async function configure(input, output = input, profileId = 'h264-cpu', preset = 'veryfast') {
  const { app, page } = current;
  if (await page.isVisible('#new-batch')) await page.click('#new-batch');
  await app.evaluate(({ dialog }, folders) => {
    let index = 0;
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folders[index++]] });
  }, [input, output]);
  await page.click('#choose-input'); await page.click('#choose-output');
  await page.selectOption('#profile', profileId); await page.selectOption('#preset', preset);
  await page.fill('#quality', '25');
}

async function prepare(label) {
  await current.page.click('#prepare-batch');
  const state = await until(value => ['ready', 'failed', 'cancelled'].includes(value.phase));
  assert.equal(state.phase, 'ready', `${label}: ${JSON.stringify(state)}`);
  return state;
}

async function newPlan(label) {
  await current.page.click('#new-batch');
  return prepare(label);
}

async function start(label) {
  await current.page.click('#start-batch');
  const state = await until(value => ['completed', 'failed', 'cancelled'].includes(value.phase));
  assert.equal(state.phase, 'completed', `${label}: ${JSON.stringify(state)}`);
  return state;
}

function item(state, name) {
  const result = state.items.find(entry => entry.name === name);
  assert.ok(result, `${name} not present: ${JSON.stringify(state)}`);
  return result;
}

async function assertNoStages(directory) {
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.startsWith('.ffmpeg-encoder-')), []);
}


async function readyUI() {
  await current.page.waitForFunction(() => !document.querySelector('#choose-input').disabled && !!window.encoder.getPreferences, undefined, {timeout:120000});
}
async function persisted(profileId, preset, quality) {
  await current.page.waitForFunction(async expected => {
    const p = await window.encoder.getPreferences(); const v = p.settingsByProfile[expected.profileId];
    return p.profileId === expected.profileId && v?.preset === expected.preset && v?.quality === expected.quality;
  }, {profileId,preset,quality}, {timeout:10000});
}
async function setSettings(profileId, preset, quality) {
  await current.page.selectOption('#profile', profileId);
  await current.page.selectOption('#preset', preset);
  await current.page.fill('#quality', String(quality));
  await persisted(profileId,preset,quality);
}
async function values() {
  return current.page.evaluate(() => ({profileId:document.querySelector('#profile').value,preset:document.querySelector('#preset').value,quality:Number(document.querySelector('#quality').value),slider:Number(document.querySelector('#quality-slider').value)}));
}
async function namespaceHashes(userData, namespace) {
  const directory=path.join(userData,namespace); const result={};
  let entries;try{entries=await fs.readdir(directory,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return result;throw e;}
  for(const entry of entries) if(entry.isFile()) result[entry.name]=await hash(path.join(directory,entry.name));
  return result;
}
async function workflow() {
  const input=await folder('sixty originals');const output=await folder('outputs');const userData=await folder('workflow-state');
  const source=path.join(input,'Recording 00.mkv');await fixture(source,{duration:0.5});
  for(let i=1;i<60;i++){const destination=path.join(input,'Recording '+String(i).padStart(2,'0')+'.mkv');await fs.copyFile(source,destination);await protect(destination);}
  await launch('first workflow process',userData);await readyUI();await configure(input,output,'h265-cpu','medium');
  await setSettings('h265-cpu','medium',29);await setSettings('h265-nvidia','p6',23);
  await current.page.selectOption('#profile','h265-cpu');await persisted('h265-cpu','medium',29);
  assert.deepEqual(await values(),{profileId:'h265-cpu',preset:'medium',quality:29,slider:29});
  await current.page.selectOption('#profile','h265-nvidia');await persisted('h265-nvidia','p6',23);
  const before=await current.page.evaluate(()=>window.encoder.getPreferences());await close();
  await launch('restored workflow process',userData);await readyUI();
  const restored=await current.page.evaluate(()=>window.encoder.getPreferences());
  assert.equal(restored.inputFolder.path,input);assert.equal(restored.outputFolder.path,output);
  assert.notEqual(restored.inputFolder.id,before.inputFolder.id);assert.notEqual(restored.outputFolder.id,before.outputFolder.id);
  assert.deepEqual(await values(),{profileId:'h265-nvidia',preset:'p6',quality:23,slider:23});
  const stale=await current.page.evaluate(async p=>{try{await window.encoder.prepareBatch({inputFolderId:p.inputFolder.id,outputFolderId:p.outputFolder.id,settings:{profileId:'h264-cpu',preset:'slower',quality:24}});return false;}catch(e){return e.code;}},before);
  assert.equal(stale,'INVALID_FOLDER');
  const defaults=[['h264-cpu','slower',24],['h265-cpu','slow',25],['av1-cpu','6',32],['h264-nvidia','p5',28],['h265-nvidia','p5',25],['av1-nvidia','p5',30]];
  report.defaults=[];
  for(const [profileId,preset,quality] of defaults){
    await current.page.selectOption('#profile',profileId);await current.page.click('#tested-default');await persisted(profileId,preset,quality);
    assert.deepEqual(await values(),{profileId,preset,quality,slider:quality});
    const text=await current.page.textContent('#tested-default-values');assert.ok(text.includes(preset)&&text.includes(String(quality)));
    report.defaults.push({profileId,preset,quality,text});
  }
  await current.page.selectOption('#profile','h264-cpu');await persisted('h264-cpu','slower',24);
  const cold=await prepare('sixty clean real media files');assert.equal(cold.items.length,60);assert.ok(cold.items.every(i=>i.status==='ready'));
  assert.equal(await current.page.getAttribute('#preview-collapse','aria-expanded'),'false');
  assert.equal(await current.page.isVisible('#preview-list'),false);assert.match(await current.page.textContent('#selected-count'),/60/);
  assert.match(await current.page.textContent('#hidden-selected-count'),/60/);assert.equal(await current.page.isEnabled('#start-batch'),true);
  await current.page.click('#preview-collapse');
  const layout=await current.page.locator('#preview-list').evaluate(el=>({height:el.clientHeight,scrollHeight:el.scrollHeight,overflow:getComputedStyle(el).overflowY}));
  assert.ok(layout.height>0&&layout.height<900&&layout.scrollHeight>layout.height);assert.ok(['auto','scroll'].includes(layout.overflow));
  const detail=current.page.locator('[data-testid="file-details"]').first();await detail.locator('summary').click();assert.equal(await detail.getAttribute('open'),'');
  const selectedBefore=await current.page.locator('#batch-items input:checked:visible').count();assert.equal(selectedBefore,60);
  await current.page.selectOption('#batch-filter','attention');assert.match(await current.page.textContent('#hidden-selected-count'),/60/);
  assert.equal(await current.page.isEnabled('#start-batch'),true);await current.page.selectOption('#batch-filter','all');
  assert.equal(await current.page.locator('#batch-items input:checked:visible').count(),60);assert.equal(await detail.getAttribute('open'),'');
  await current.page.screenshot({path:path.join(artifacts,'compact-sixty.png'),fullPage:true});
  await current.page.click('#clear-selection');await current.page.locator('#batch-items input[type="checkbox"]').first().check();
  const selectedName=cold.items[0].name;const encoded=await start('visible Tested Default maps through actual CPU argv');assert.equal(encoded.counts.success,1);
  const command=await current.app.evaluate(()=>globalThis.__sameFolderSmoke.commands.at(-1));
  assert.equal(command.argv[command.argv.indexOf('-preset:v:0')+1],'slower');assert.equal(command.argv[command.argv.indexOf('-crf:v:0')+1],'24');
  const encodedFile=path.join(output,encoded.items.find(i=>i.status==='success').outputName);await protect(encodedFile);
  await runTool(ffmpeg,['-v','error','-xerror','-i',encodedFile,'-f','null','-']);
  const generated=path.join(input,'Recognized copy.mkv');await fs.copyFile(encodedFile,generated);await protect(generated);
  const legacy=path.join(input,'Legacy_H264-CPU.mkv');await fs.copyFile(source,legacy);await protect(legacy);
  const mixed=await newPlan('mixed statuses use compact Needs attention');
  assert.equal(item(mixed,'Recognized copy.mkv').status,'generated');assert.equal(item(mixed,'Legacy_H264-CPU.mkv').status,'ambiguous');assert.equal(item(mixed,selectedName).status,'skipped');
  assert.equal(await current.page.inputValue('#batch-filter'),'attention');assert.equal(await current.page.getAttribute('#preview-collapse','aria-expanded'),'true');
  assert.equal(await current.page.isVisible('#attention-warning'),true);assert.equal(await current.page.locator('#batch-items input:checked:visible').count(),0);
  assert.match(await current.page.textContent('#hidden-selected-count'),/59/);
  await current.page.selectOption('#batch-filter','generated');assert.match(await current.page.textContent('#batch-items'),/Recognized copy/);
  await current.page.selectOption('#batch-filter','skipped');assert.match(await current.page.textContent('#batch-items'),/Recording 00/);
  await current.page.selectOption('#batch-filter','all');assert.equal(await current.page.locator('#batch-items input:checked:visible').count(),59);
  await current.page.screenshot({path:path.join(artifacts,'mixed-preview.png'),fullPage:true});
  const provenanceBefore=await namespaceHashes(userData,'provenance-v1');assert.ok(Object.keys(provenanceBefore).length>=2);
  const cacheDir=path.join(userData,'cache','inspection-v1');assert.ok((await fs.readdir(cacheDir)).length>=60);
  await current.page.click('#clear-inspection-cache');
  await current.page.waitForFunction(async()=>!document.querySelector('#clear-inspection-cache').disabled);
  assert.deepEqual(await fs.readdir(cacheDir),[]);assert.deepEqual(await namespaceHashes(userData,'provenance-v1'),provenanceBefore);
  const afterCache=await current.page.evaluate(()=>window.encoder.getPreferences());assert.equal(afterCache.inputFolder.path,input);assert.equal(afterCache.profileId,'h264-cpu');
  await current.page.click('#forget-preferences');
  await current.page.waitForFunction(async()=>{const p=await window.encoder.getPreferences();return !p.inputFolder&&!p.outputFolder;});
  assert.deepEqual(await namespaceHashes(userData,'provenance-v1'),provenanceBefore);assert.equal(await current.page.isEnabled('#prepare-batch'),false);
  const absent=await folder('last remembered empty folder');
  await current.app.evaluate(({dialog},folders)=>{let i=0;dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folders[i++]]});},[absent,output]);
  await current.page.click('#choose-input');await current.page.click('#choose-output');await close();
  assert.equal((await fs.readdir(absent)).length,0);await fs.rmdir(absent);
  await launch('missing remembered location',userData);await readyUI();
  const missing=await current.page.evaluate(()=>window.encoder.getPreferences());assert.equal(missing.inputFolder.available,false);assert.equal(missing.inputFolder.path,absent);assert.ok(!missing.inputFolder.id);
  assert.equal(await current.page.isVisible('#input-unavailable'),true);assert.equal(await current.page.isEnabled('#prepare-batch'),false);assert.equal(await current.page.isEnabled('#choose-input'),true);
  assert.equal((await current.page.evaluate(()=>window.encoder.getSnapshot())).phase,'idle');
  report.cases.push({before,restored,cold:{items:cold.items.length,preparation:cold.preparation},layout,encoded,mixed:{items:mixed.items.map(i=>({name:i.name,status:i.status}))},missing,command});
  report.checks.push('Remembered locations restore as fresh main IDs; stale prior-process tokens fail; per-profile CPU/NVIDIA manual values survive switching and restart.', 'All six Tested Default helpers populate the normal visible controls with exact values; actual CPU encode uses those values and fully decodes.', 'Sixty real independent media files prepare; large clean preview collapses, bounded list expands, details persist across filters and selected/hidden-selected counts retain selection.', 'Mixed attention/generated/skipped states remain distinct; filters do not change selected originals; warnings and Start remain outside the bounded list.', 'Clear cache preserves preferences/provenance/media; Forget preferences preserves provenance/media and removes current folder authority; missing remembered folder is visible and never recreated or auto-started.');
}
async function main(){
  await fs.mkdir(artifacts,{recursive:true});
  try{
    report.sourceHashes={};for(const f of ['src/preferences.cjs','src/encoder-service.cjs','src/inspection.cjs','src/provenance.cjs','preload.js','src/ipc.cjs','ui/index.html','ui/renderer.js','ui/styles.css'])report.sourceHashes[f]=await hash(path.join(root,f));
    await workflow();await close();report.protectedHashes=[];for(const [file,before]of protectedFiles){const after=await hash(file);assert.equal(after,before);report.protectedHashes.push({file,sha256:after});}
    assert.deepEqual(report.errors,[]);report.status='passed';
  }catch(error){report.status='failed';report.failure={message:error.message,stack:error.stack};if(current&&!current.page.isClosed()){await current.page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});report.failureText=await current.page.locator('body').innerText().catch(()=>null);}throw error;}
  finally{await close();await save();console.log(JSON.stringify({status:report.status,report:path.join(artifacts,'report.json')}));}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
