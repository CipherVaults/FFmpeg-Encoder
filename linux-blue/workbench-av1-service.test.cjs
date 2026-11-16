'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createAv1WorkbenchService, createQualifiedAv1WorkbenchService } = require('./workbench-av1-service.cjs');
const { LinuxWorkbenchService } = require('./workbench-service.cjs');
const { PINS, RUNTIME_ID } = require('./runtime-av1.cjs');
test('original factory remains ordinary-only and forwards state/output access without spawning', async () => {
  const stateDir = path.join(__dirname,'artifacts','factory-test-not-executed'), outputAccess = { marker:'main-owned-test-handle' };
  const service = await createAv1WorkbenchService({stateDir,outputAccess,onChild(){assert.fail('child');}});
  assert.ok(service instanceof LinuxWorkbenchService);assert.equal(service.stateDir,stateDir);assert.equal(service.outputAccess,outputAccess);
  assert.equal(service.ffmpeg,PINS.ffmpeg.path);assert.equal(service.ffprobe,PINS.ffprobe.path);assert.equal(service.runtimeIdentity,RUNTIME_ID);
  assert.equal(service.operationQualifications,null);assert.equal(service.operationRuntime,null);
  assert.equal(service.linuxQualifiedEncodeStatus,undefined);assert.equal(service.linuxRemuxStatus.available,false);
});
test('new factory preserves real pending control gate before runtime reads or children', async () => {
  // Fresh test-only module evaluation replaces only the Full calibration's
  // readiness constant with pending. No accepted proof or constructor is faked.
  const controlsFile=path.join(__dirname,'workbench-qualified-encode-controls.cjs'), factoryFile=path.join(__dirname,'workbench-av1-service.cjs');
  const controlsSource=await fs.readFile(controlsFile,'utf8'),factorySource=await fs.readFile(factoryFile,'utf8');
  function load(source,file,override) {
    const module={exports:{}},real=createRequire(file);
    const wrapper=vm.runInThisContext(`(function(require,module,exports,__dirname,__filename){${source}\n})`,{filename:file});
    wrapper(name=>Object.hasOwn(override,name)?override[name]:real(name),module,module.exports,__dirname,file);return module.exports;
  }
  const pending=load(controlsSource,controlsFile,{'./workbench-full-resize-service.cjs':{REPORT_SHA:null}});
  const factory=load(factorySource,factoryFile,{'./workbench-qualified-encode-controls.cjs':pending});
  const original=fs.readFile;let reads=0;fs.readFile=async()=>{reads++;assert.fail('No read after pending gate');};
  try { await assert.rejects(factory.createQualifiedAv1WorkbenchService({stateDir:'/not-created',onChild(){assert.fail('child');}}),/pending/); }
  finally { fs.readFile=original; }
  assert.equal(reads,0);assert.equal(typeof createQualifiedAv1WorkbenchService,'function');
});
test('qualified wiring keeps separate runner and options while main selects it only for explicit AV1', async () => {
  const source=await fs.readFile(path.join(__dirname,'workbench-av1-service.cjs'),'utf8');
  const qualified=source.slice(source.indexOf('async function createQualifiedAv1WorkbenchService'));
  assert.ok(qualified.indexOf('await createQualifiedEncodeControls')<qualified.indexOf('new Av1WorkbenchAdmissionService'));
  assert.match(qualified,/createQualifiedEncodeControls\(\{ stateDir, onChild \}\)/);
  assert.match(qualified,/stateDir, runtimeIdentity: RUNTIME_ID, outputAccess/);
  assert.match(qualified,/run: createAv1Runner\(\{ onChild \}\)/);assert.match(qualified,/\.\.\.controls/);
  assert.match(qualified,/service\.linuxQualifiedEncodeStatus = status/);assert.doesNotMatch(qualified,/catch\s*\(|createAv1ProportionalRunner/);
  const main=await fs.readFile(path.join(__dirname,'workbench-main.cjs'),'utf8');
  assert.match(main,/\.createQualifiedAv1WorkbenchService/);
  assert.match(main,/runtimeChoice === 'baseline' \? createWorkbenchService/);
});

test('main runtime selection keeps the baseline lazy and reports qualified scope without changing security guards', async () => {
  const source = await fs.readFile(path.join(__dirname, 'workbench-main.cjs'), 'utf8');
  const start = source.indexOf('const createService = '), end = source.indexOf(';', start);
  assert.ok(start >= 0 && end > start);
  const expression = source.slice(start, end + 1) + '\ncreateService;';
  const baseline = () => {}, qualified = () => {};
  for (const runtimeChoice of ['baseline', '9.0.2-av1']) {
    let imports = 0;
    const selected = vm.runInNewContext(expression, { runtimeChoice, createWorkbenchService: baseline,
      require(name) { imports++; assert.equal(name, './workbench-av1-service.cjs'); return { createQualifiedAv1WorkbenchService: qualified }; } });
    assert.equal(selected, runtimeChoice === 'baseline' ? baseline : qualified);
    assert.equal(imports, runtimeChoice === 'baseline' ? 0 : 1);
  }
  assert.match(source, /'qualified-cpu-sdr' : 'ordinary-cpu-full-sdr'/);
  assert.match(source, /qualifiedFamilies: service\.linuxQualifiedEncodeStatus\?\.familyIds \|\| \[\]/);
  assert.ok(source.includes('H265 FLAC range/resize: per-file eligibility'));
  for (const guard of ['app.enableSandbox()', 'requestSingleInstanceLock()', 'contextIsolation: true', 'nodeIntegration: false',
    'closeAdmission()', 'closeOperationResources()', 'closeDiagnostics', "require('../src/ipc.cjs')"])
    assert.ok(source.includes(guard), guard);
  assert.doesNotMatch(source, /no-sandbox|disable-web-security/);
});
