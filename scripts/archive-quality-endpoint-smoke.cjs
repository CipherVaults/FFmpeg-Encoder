'use strict';

// Actual application endpoint evidence for the named Archive Quality recipe.
// Fixtures and outputs stay inside this unique owned artifact directory. This
// is separate from perceptual benchmarking and final portable acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { _electron } = require('playwright');
const { runTool } = require('../src/process-runner.cjs');
const { createRichFixture } = require('./test-fixtures.cjs');
const { inspectInput, inspectMetadata, validateOutput } = require('../src/inspection.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const { describeRecipe } = require('../src/media.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', `archive-quality-endpoint-smoke-${Date.now()}-${randomUUID().slice(0,8)}`);
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
const hash = async file => createHash('sha256').update(await fs.readFile(file)).digest('hex');
const report = { status: 'running', time: new Date().toISOString(), artifacts, phase: 'created', cases: [], checks: [], errors: [], limits: [
  'Folder-picker returns are substituted; real UI/preload/validated IPC/main planning, encoding and local NTFS publication are exercised.',
  'Only two generated owned fixtures are used. No personal media, cold archive inspection campaign or perceptual benchmark is repeated.',
  'Prepared display is an accurately labelled argv template; only its protected temporary destination is assigned at execution.',
  'Actual child invocation is observed by wrapping the existing process runner without replacing its execution. This is not an independent OS process census.',
  'Same-machine development application evidence is not packaged, clean-machine or Ada-hardware acceptance.',
] };
const save = async phase => { if (phase) report.phase=phase; await fs.writeFile(path.join(artifacts,'report.json'),JSON.stringify(report,null,2)); };
let app, page;

async function until(predicate, timeoutMs=120000) {
  const deadline=Date.now()+timeoutMs; let state;
  while (Date.now()<deadline) {
    state=await page.evaluate(()=>window.encoder.getSnapshot());
    if(predicate(state)) return state;
    await new Promise(resolve=>setTimeout(resolve,35));
  }
  throw new Error(`Endpoint state timeout: ${JSON.stringify(state)}`);
}

async function close() {
  if(!app) return;
  if(page&&!page.isClosed()) {
    await page.evaluate(async()=>{const s=await window.encoder.getSnapshot();if(['preparing','running','checking','cancelling'].includes(s.phase)&&s.batchId)await window.encoder.cancelBatch({batchId:s.batchId});}).catch(()=>{});
    report.commands=await app.evaluate(()=>globalThis.__archiveEndpoint?.commands||[]).catch(()=>[]);
    report.lastSnapshot=await page.evaluate(()=>window.encoder.getSnapshot()).catch(()=>null);
  }
  await app.close(); app=null;
}

async function launch() {
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  app=await _electron.launch({ executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:[root,`--user-data-dir=${path.join(artifacts,'user-data')}`],cwd:root,env });
  page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForFunction(()=>!document.querySelector('#choose-input')?.disabled,undefined,{timeout:120000});
  report.capabilities=await page.evaluate(()=>window.encoder.getCapabilities());
  report.boundary=await page.evaluate(()=>({require:typeof require,process:typeof process,methods:Object.keys(window.encoder).sort()}));
  assert.equal(report.boundary.require,'undefined');assert.equal(report.boundary.process,'undefined');
  await app.evaluate((_,modulePath)=>{
    const require=process.getBuiltinModule('module').createRequire(modulePath);
    const {EncoderService}=require(modulePath);const prepare=EncoderService.prototype.prepareBatch;
    const harness=globalThis.__archiveEndpoint={commands:[]};
    EncoderService.prototype.prepareBatch=function(...args) {
      if(!this.__archiveEndpointObserved) {
        this.__archiveEndpointObserved=true;const run=this.run;
        this.run=(executable,argv,options={})=>{
          if(!options.onProgress)return run(executable,argv,options);
          const invocation={executable,argv:[...argv],pid:null,spawnedAt:null,closedAt:null};harness.commands.push(invocation);
          return run(executable,argv,{...options,onChild(child){
            invocation.pid=child.pid;invocation.spawnedAt=Date.now();
            child.once('close',(code,signal)=>Object.assign(invocation,{code,signal,closedAt:Date.now()}));
            options.onChild?.(child);
          }});
        };
      }
      return prepare.apply(this,args);
    };
  },path.join(root,'src/encoder-service.cjs'));
}

async function displayDetails(state,item) {
  const expected=await page.evaluate(payload=>window.encoder.getEncodingDetails(payload),{planId:state.planId,fileId:item.id});
  const row=page.locator(`tr[data-file-id="${item.id}"]`);
  const outer=row.locator('[data-testid="file-details"]');
  if(await outer.getAttribute('open')===null)await outer.locator(':scope > summary').click();
  const details=row.locator('[data-testid="encoding-details"]');
  if(await details.getAttribute('open')===null)await details.locator(':scope > summary').click();
  await page.waitForFunction(({id,args})=>{
    const raw=document.querySelector(`tr[data-file-id="${id}"] [data-testid="resolved-args"]`)?.textContent;
    try{return JSON.stringify(JSON.parse(raw))===JSON.stringify(args);}catch{return false;}
  },{id:item.id,args:expected.args});
  assert.deepEqual(JSON.parse(await row.locator('[data-testid="resolved-args"]').textContent()),expected.args);
  return expected;
}

function assertInvocation(prepared,actual) {
  assert.equal(prepared.kind,'resolved-argument-template');
  assert.ok(prepared.outputPlaceholder);assert.equal(prepared.args.at(-1),prepared.outputPlaceholder);
  const expected=[...prepared.args];expected[expected.length-1]=actual.argv.at(-1);
  assert.equal(actual.executable,prepared.executable);
  assert.deepEqual(actual.argv,expected,'Actual invocation differs from the displayed template beyond the declared staging path');
  assert.match(path.basename(path.dirname(actual.argv.at(-1))),/^\.ffmpeg-encoder-/);
  assert.equal(actual.code,0);assert.ok(actual.pid&&actual.closedAt>=actual.spawnedAt);
}

async function main() {
  await fs.mkdir(artifacts,{recursive:true});
  try {
    report.sourceHashes={};for(const file of ['scripts/archive-quality-endpoint-smoke.cjs','scripts/test-fixtures.cjs','ui/index.html','ui/renderer.js','ui/styles.css','src/media.cjs','src/capabilities.cjs','src/encoder-service.cjs','src/inspection.cjs','src/provenance.cjs','src/ipc.cjs','preload.js'])report.sourceHashes[file]=await hash(path.join(root,file));
    const directory=path.join(artifacts,"Same folder العربية & apostrophe's");await fs.mkdir(directory);
    const sources=[{file:path.join(directory,'Rich original.mkv'),depth:8,frames:120},{file:path.join(directory,'Ten-bit original.mkv'),depth:10,frames:12}];
    await createRichFixture(ffmpeg,path.join(artifacts,'rich-fixture-resources'),sources[0].file);
    await runTool(ffmpeg,['-v','error','-f','lavfi','-i','testsrc2=size=320x180:rate=24:duration=0.5,format=yuv420p10le,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
      '-c:v','ffv1','-pix_fmt','yuv420p10le','-color_primaries','bt709','-color_trc','bt709','-colorspace','bt709','-color_range','tv','-metadata','title=Ten-bit SDR preservation fixture','-n',sources[1].file]);
    for(const source of sources){source.sha256=await hash(source.file);source.inspection=await inspectInput(source.file,{ffprobe});assert.equal(source.inspection.color.supported,true);assert.equal(source.inspection.color.classification,'sdr');}
    report.sources=sources.map(({file,depth,frames,sha256})=>({file,depth,frames,sha256}));await save('fixtures verified');
    await launch();
    const recipe=report.capabilities.recipes.find(entry=>entry.profileId==='h265-nvidia');assert.ok(recipe);assert.equal(recipe.available,true,JSON.stringify(recipe));
    for(const source of sources)assert.ok(recipe.supportedBitDepths.includes(source.depth));
    report.recipe=recipe;
    await app.evaluate(({dialog},directory)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[directory]});},directory);
    await page.click('#choose-input');await page.click('#choose-output');await page.selectOption('#profile',recipe.profileId);await page.click('#archive-quality');
    const settings={profileId:recipe.profileId,preset:recipe.preset,quality:recipe.quality,recipeId:recipe.id};report.settings=settings;
    await page.waitForFunction(async expected=>{const p=await window.encoder.getPreferences();return p.profileId===expected.profileId&&JSON.stringify(p.settingsByProfile[expected.profileId])===JSON.stringify({preset:expected.preset,quality:expected.quality,recipeId:expected.recipeId});},settings);
    const canonical=describeRecipe(settings);assert.ok(canonical.recipe);
    await page.waitForFunction(expected=>{try{return JSON.stringify(JSON.parse(document.querySelector('#recipe-args').textContent))===JSON.stringify(expected);}catch{return false;}},canonical.args);
    await page.click('#prepare-batch');const prepared=await until(state=>['ready','failed','cancelled'].includes(state.phase));
    assert.equal(prepared.phase,'ready',JSON.stringify(prepared));assert.equal(prepared.items.length,2);assert.ok(prepared.items.every(item=>item.status==='ready'));assert.deepEqual(prepared.settings,settings);
    report.prepared=prepared;const details=new Map();
    for(const item of prepared.items)details.set(item.id,await displayDetails(prepared,item));
    report.preparedDetails=Object.fromEntries(details);
    await page.screenshot({path:path.join(artifacts,'prepared-archive-details.png'),fullPage:true});await save('prepared UI argv verified');
    await page.click('#start-batch');const finished=await until(state=>['completed','failed','cancelled'].includes(state.phase));
    assert.equal(finished.phase,'completed',JSON.stringify(finished));assert.equal(finished.counts.success,2);assert.equal(finished.counts.failed,0);
    const commands=await app.evaluate(()=>globalThis.__archiveEndpoint.commands);assert.equal(commands.length,2);
    assert.ok(commands[1].spawnedAt>=commands[0].closedAt,'Application encoded more than one file at a time');
    for(const item of finished.items) {
      assert.equal(item.status,'success');
      const source=sources.find(entry=>path.basename(entry.file)===item.name);assert.ok(source);
      const command=commands.find(entry=>entry.argv[entry.argv.indexOf('-i')+1]===source.file);assert.ok(command);assertInvocation(details.get(item.id),command);
      const executed=await displayDetails(finished,item);assert.equal(executed.kind,'actual-invocation');assert.deepEqual(executed.args,command.argv);
      const output=path.join(directory,item.outputName);const outputProbe=await inspectMetadata(output,{ffprobe});
      const validation=validateOutput(source.inspection,outputProbe,settings);assert.equal(validation.valid,true,JSON.stringify(validation));
      const marker=classifyMarker(outputProbe);assert.equal(marker.kind,'generated');assert.ok(marker.previousGeneration);
      assert.equal(marker.previousGeneration.recipeId,recipe.id);assert.equal(marker.previousGeneration.quality,recipe.quality);assert.equal(marker.previousGeneration.preset,recipe.preset);
      assert.equal(marker.previousGeneration.bitDepth,source.depth);assert.deepEqual(marker.previousGeneration.encoderArgs,canonical.args);
      const decoded=await runTool(ffmpeg,['-hide_banner','-nostdin','-v','error','-xerror','-nostats','-i',output,'-map','0:v:0','-map','0:a?','-progress','pipe:1','-f','null','-'],{timeoutMs:120000});
      assert.equal(decoded.stderr.trim(),'');assert.match(decoded.stdout,/progress=end/);
      const frames=[...decoded.stdout.matchAll(/^frame=(\d+)\s*$/gm)].map(match=>Number(match[1]));assert.equal(frames.at(-1),source.frames);
      if(source.depth===8){assert.equal(outputProbe.streams.length,5);assert.equal(outputProbe.streams.filter(stream=>stream.codec_type==='audio').length,2);assert.equal(outputProbe.chapters.length,2);assert.ok(outputProbe.streams.find(stream=>stream.codec_type==='attachment').extradata_hash);}
      assert.equal(await hash(source.file),source.sha256);
      report.cases.push({input:source.file,output,sha256:await hash(output),depth:source.depth,decodedFrames:frames.at(-1),validation,marker,command,executed,streams:outputProbe.streams.map(stream=>({type:stream.codec_type,codec:stream.codec_name,pixelFormat:stream.pix_fmt,tags:stream.tags,disposition:stream.disposition,attachmentHash:stream.extradata_hash})),chapters:outputProbe.chapters});
      await save(`verified ${item.name}`);
    }
    report.finished=finished;
    await page.click('#new-batch');await page.click('#prepare-batch');
    const again=await until(state=>['ready','failed','cancelled'].includes(state.phase));assert.equal(again.phase,'ready');assert.equal(again.items.length,4);
    for(const item of again.items){assert.equal(item.status,sources.some(source=>path.basename(source.file)===item.name)?'skipped':'generated');assert.ok(!item.reencodeAuthorized);}
    assert.equal(await page.isEnabled('#start-batch'),false);await page.selectOption('#batch-filter','generated');
    for(const item of again.items.filter(entry=>entry.status==='generated')){
      const row=page.locator(`tr[data-file-id="${item.id}"]`);assert.match(await row.locator('[data-testid="origin-label"]').textContent(),/Excluded/);
      assert.ok((await row.locator('[data-testid="previous-generation"]').textContent()).includes(recipe.label));
    }
    await page.screenshot({path:path.join(artifacts,'generated-archive-rescan.png'),fullPage:true});
    report.rescan=again;assert.deepEqual((await fs.readdir(directory)).filter(name=>name.startsWith('.ffmpeg-encoder-')),[]);
    for(const source of sources)assert.equal(await hash(source.file),source.sha256);
    for(const output of report.cases)assert.equal(await hash(output.output),output.sha256);
    assert.deepEqual(report.errors,[]);
    report.checks.push('Native Archive helper -> canonical settings -> prepared UI argv -> actual sequential FFmpeg invocation matched, except the declared protected staging-path substitution.',
      'Rich8-bit and simple10-bit SDR recipe outputs fully decoded; video depth/cadence/color, all audio/subtitles, attachment content hash, metadata, dispositions and chapters passed production validation.',
      'New outputs carry recognized provenance with exact recipeId, preset/CQ, bit depth and canonical encoder options.',
      'Fresh same-folder preparation excluded both generated outputs and skipped existing destinations; no source/output hashes changed and no owned staging files remained.');
    report.status='passed';await save('complete');
  } catch(error) {
    report.status='failed';report.failure={message:error.message,stack:error.stack};
    if(page&&!page.isClosed()){await page.screenshot({path:path.join(artifacts,'failure.png'),fullPage:true}).catch(()=>{});report.failureText=await page.locator('body').innerText().catch(()=>null);}
    throw error;
  } finally {await close();await save();console.log(JSON.stringify({status:report.status,report:path.join(artifacts,'report.json')}));}
}
main().catch(error=>{console.error(error.stack);process.exitCode=1;});
