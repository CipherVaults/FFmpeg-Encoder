'use strict';
const assert=require('node:assert/strict');
const fsp=require('node:fs/promises');
const path=require('node:path');
const { LABEL, SETUP, KEY, APP, args, assertPlain, digest, inventory, run }=require('./installer.cjs');
const {setTimeout:delay}=require('node:timers/promises');
async function absent(p) {
  try { await fsp.lstat(p); } catch(e) { if(e.code==='ENOENT') return true; throw e; }
  return false;
}
async function waitAbsent(p) {
  for(let n=0;n<100;n++) { if(await absent(p)) return; await delay(250); }
  assert.fail('Uninstaller did not complete its documented wait.');
}
async function go() {
  // Disposable Windows Sandbox acceptance only (fresh WDAGUtilityAccount profile, no network).
  assert.equal(process.platform,'win32');
  assert.equal(process.env.USERNAME,'WDAGUtilityAccount','Disposable Windows Sandbox only.');
  const [mode,...flags]=process.argv.slice(2);
  assert(['install','uninstall'].includes(mode));
  const {compiled,work}=args(flags,['compiled','work']);
  assert(work.toLowerCase().startsWith('c:\\t\\'),'Expected the sandbox work root.');
  await assertPlain(compiled,true);
  const setup=path.join(compiled,SETUP);
  await assertPlain(setup,false);
  const receipt=JSON.parse(await fsp.readFile(path.join(compiled,'installer-receipt.json'),'utf8'));
  assert.equal(receipt.setup,SETUP);
  assert.equal(await digest(setup),receipt.setupSha256);
  const dir=path.join(process.env.LOCALAPPDATA,'Programs',LABEL);
  const uninstall=path.join(dir,'Uninstall.exe');
  const keep=path.join(dir,'data','preserve-test.txt');
  const extra=path.join(dir,'unrelated-test.txt');
  const old=path.join(path.dirname(dir),'FFmpeg Encoder 0.6 (test sentinel, not real installation)');
  const sibling=path.join(path.dirname(dir),LABEL+' (test preserve sentinel)');
  const oldFile=path.join(old,'data','0.6-preserve.txt');
  const siblingFile=path.join(sibling,'keep.txt');
  const reg=path.join(process.env.SystemRoot,'System32','reg.exe');
  const link=path.join(process.env.APPDATA,'Microsoft','Windows','Start Menu','Programs',LABEL+'.lnk');
  const verifyDifferentScope=async()=>{
    assert.equal(await fsp.readFile(oldFile,'utf8'),'original 0.6 profile\n');
    assert.equal(await fsp.readFile(siblingFile,'utf8'),'untouched beta sibling\n');
  };
  if(mode==='install') {
    assert(await absent(dir) && await absent(old) && await absent(sibling) && await absent(link),'Runner paths must be fresh.');
    await fsp.mkdir(work);
    await fsp.mkdir(path.dirname(oldFile),{recursive:true});
    await fsp.mkdir(sibling);
    await fsp.writeFile(oldFile,'original 0.6 profile\n',{flag:'wx'});
    await fsp.writeFile(siblingFile,'untouched beta sibling\n',{flag:'wx'});
    run(setup,['/S'],work);
    await assertPlain(uninstall,false);
    assert.deepEqual(await inventory(dir,new Set(['Uninstall.exe'])),receipt.files,'Setup files differ from verified portable payload.');
    await assertPlain(link,false);
    const loc=run(reg,['query','HKCU\\'+KEY,'/v','InstallLocation'],work,5000);
    assert(loc.includes(dir),'Beta-specific uninstall registry entry did not match installed location.');
    await verifyDifferentScope();
    console.log(path.join(dir,APP)); // read by invoking workflow; do not publish unredacted logs.
  } else {
    await assertPlain(work,true);
    await assertPlain(uninstall,false);
    const profile=path.dirname(keep);
    if(await absent(profile)) await fsp.mkdir(profile);
    await assertPlain(profile,true);
    await fsp.writeFile(keep,'beta profile retained\n',{flag:'wx'});
    await fsp.writeFile(extra,'unrelated install root file retained\n',{flag:'wx'});
    run(reg,['add','HKCU\\'+KEY,'/v','UnrelatedTestSentinel','/t','REG_SZ','/d','keep this outside-owned value','/f','/reg:64'],work,5000);
    run(uninstall,['/S'],work);
    await waitAbsent(uninstall);
    assert(run(reg,['query','HKCU\\'+KEY,'/v','UnrelatedTestSentinel','/reg:64'],work,5000).includes('keep this outside-owned value'),'Unrelated value was lost');
    assert(await absent(link),'Beta shortcut survived uninstall.');
    assert.throws(()=>run(reg,['query','HKCU\\'+KEY,'/v','InstallLocation'],work,5000),/Process failed: reg\.exe \(1\)/i,'Beta registration survived uninstall.');
    for(const item of receipt.files) assert(await absent(path.join(dir,...item.path.split('/'))),'Packaged file survived uninstall.');
    assert.equal(await fsp.readFile(keep,'utf8'),'beta profile retained\n');
    assert.equal(await fsp.readFile(extra,'utf8'),'unrelated install root file retained\n');
    await verifyDifferentScope();
    await fsp.writeFile(path.join(work,'installer-acceptance.json'),JSON.stringify({
      schema:1, setupSha256:receipt.setupSha256, result:'native-install-inventory-and-conservative-uninstall-passed',
      checked:['fresh fixed per-user install','portable payload hashes equal','beta-specific shortcut and registry','beta and simulated 0.6 profile and unrelated files retained'],
      notChecked:['real user 0.6 installation','click-through setup','Windows SmartScreen','application CPU/GPU qualification']
    },null,2)+'\n',{flag:'wx'});
  }
}
go().catch(e=>{console.error(e.message);process.exitCode=1;});
