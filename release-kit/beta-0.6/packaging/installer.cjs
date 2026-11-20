'use strict';
// FFmpeg Encoder 0.6 Beta per-user NSIS Setup, adapted from the reviewed 0.7 Alpha rehearsal kit.
// Runs only in the disposable Windows Sandbox against the verified portable staging tree.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const APP = 'FFmpeg Encoder.exe';
const LABEL = 'FFmpeg Encoder 0.6 Beta';
const SETUP = 'FFmpeg-Encoder-0.6.0-beta.1-Setup-win32-x64.exe';
const GAUGE = 'b2bbcc2675f6d99b5a985f838bdd9e2128c202f109c10890fe41e00cba86a620';
const KEY = 'Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\FFmpegEncoder060Beta';
const VERSION = '3.13';
const REQUIRED = [APP,'resources/app.asar','resources/ffmpeg/ffmpeg.exe',
  'resources/ffmpeg/ffprobe.exe','resources/third-party/FFmpeg-LICENSE.txt',
  'resources/third-party/FFmpeg-README.txt','resources/binary-manifest.json',
  'LICENSE','LICENSES.chromium.html'];
const ordinal = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const COMPONENT = /^[A-Za-z0-9_.+ -]+$/;
const RESERVED = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;
function safeRel(rel) {
  assert(typeof rel === 'string' && rel.length <= 180);
  assert(rel.split('/').every(x => COMPONENT.test(x) && !/^[ .]|[ .]$/.test(x) && !RESERVED.test(x)), 'Unsafe payload component.');
  assert(!/^(?:data|uninstall\.exe)(?:\/|$)/i.test(rel), 'Installer-owned state may not be in payload.');
  return rel;
}
function quoted(value) {
  assert(typeof value === 'string' && !/["$\r\n\0]/.test(value), 'Unsafe NSIS literal.');
  return '"' + value + '"';
}
async function digest(filename) {
  const h = crypto.createHash('sha256');
  for await (const bytes of fs.createReadStream(filename)) h.update(bytes);
  return h.digest('hex');
}
async function assertPlain(filename, dir) {
  const p = path.resolve(filename);
  const st = await fsp.lstat(p);
  assert(!st.isSymbolicLink() && (dir ? st.isDirectory() : st.isFile() && st.nlink === 1), 'Unexpected link or object.');
  assert.equal(await fsp.realpath(p), p, 'Redirected/case-aliased pathname.');
  return st;
}
async function inventory(root, ignore = new Set()) {
  const visited = new Set();
  const result = [];
  async function walk(folder, prefix = '') {
    await assertPlain(folder, true);
    for (const entry of await fsp.readdir(folder, {withFileTypes:true})) {
      const rel = prefix + entry.name;
      if (!prefix && ignore.has(rel)) continue;
      safeRel(rel);
      const canon = rel.toLowerCase();
      assert(!visited.has(canon), 'Case alias in inventory.');
      visited.add(canon);
      assert(visited.size <= 500, 'Unexpectedly large payload inventory.');
      const filename = path.join(folder,entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) await walk(filename,rel+'/');
      else {
        const st = await assertPlain(filename,false);
        result.push({ path:rel, bytes:st.size, sha256:await digest(filename) });
      }
    }
  }
  await walk(root);
  return result.sort((a,b)=>ordinal(a.path,b.path));
}
function shellPath(relative) { return relative.replaceAll('/','\\'); }
function render(rows, stage, setup, icon) {
  for (const row of rows) safeRel(row.path);
  for (const filename of REQUIRED) assert(rows.some(x=>x.path===filename), 'Required packaged file missing: '+filename);
  const folders = new Set();
  for (const {path:rel} of rows) {
    const parts = rel.split('/');
    parts.pop();
    for (let n=1;n<=parts.length;n++) folders.add(parts.slice(0,n).join('/'));
  }
  const dirs = [...folders].sort((a,b)=>a.split('/').length-b.split('/').length || ordinal(a,b));
  const relative = rel => '$INSTDIR'+(rel?'\\'+shellPath(rel):'');
  const qvar = v=>'"'+v+'"'; // known NSIS variables + safeRel only
  const checked = (v, fn='AssertNotReparse')=>['  Push '+qvar(v), '  Call '+fn];
  const install = [];
  let lastDir = null;
  for (const {path:rel} of rows) {
    const parent = rel.includes('/') ? rel.slice(0,rel.lastIndexOf('/')) : '';
    if (lastDir!==parent) { install.push('  SetOutPath '+qvar(relative(parent))); lastDir=parent; }
    install.push('  File '+quoted(path.join(stage,...rel.split('/'))),'  IfErrors install_failed');
  }
  const guard = name=>[
    'Function '+name,'  Exch $0','  Push $1',
    '  Push $2',
    '  System::Call \'kernel32::GetFileAttributesW(w r0) i .r1 ?e\'',
    '  Pop $2',
    '  IntCmp $1 -1 absent',
    '  IntOp $1 $1 & 0x400',
    '  IntCmp $1 0 ordinary',
    '  Goto denied',
    '  absent:', '  IntCmp $2 2 ordinary', '  IntCmp $2 3 ordinary',
    '  denied:', '  SetErrorLevel 3','  Abort',
    '  ordinary:','  Pop $2','  Pop $1','  Pop $0','FunctionEnd',
  ];
  const root = '$LOCALAPPDATA\\Programs\\'+LABEL;
  const shortcut = '$SMPROGRAMS\\'+LABEL+'.lnk';
  return [
    'Unicode true','Name '+quoted(LABEL),'OutFile '+quoted(setup),'Icon '+quoted(icon),'UninstallIcon '+quoted(icon),
    'RequestExecutionLevel user','CRCCheck force','SetCompressor /SOLID lzma','SetCompressorDictSize 16',
    'VIProductVersion 0.6.0.1','VIAddVersionKey "ProductName" '+quoted(LABEL),
    'VIAddVersionKey "FileVersion" "0.6.0-beta.1"','VIAddVersionKey "FileDescription" "FFmpeg Encoder 0.6 Beta Setup"',
    'VIAddVersionKey "LegalCopyright" "See bundled notices"','VIAddVersionKey "CompanyName" "FFmpeg Encoder project"',
    'InstallDir '+qvar(root),'ShowInstDetails show','ShowUninstDetails show',
    'Page instfiles','UninstPage instfiles',
    ...guard('AssertNotReparse'),...guard('un.AssertNotReparse'),
    'Function .onInit','  SetShellVarContext current','  SetRegView 64','  StrCpy $INSTDIR '+qvar(root),
    ...checked('$LOCALAPPDATA'),...checked('$LOCALAPPDATA\\Programs'),...checked('$INSTDIR'),...checked('$SMPROGRAMS'),...checked(shortcut),
    '  StrCpy $0 $INSTDIR','  System::Call \'kernel32::GetFileAttributesW(w r0) i .r1 ?e\'', '  Pop $2',
    '  IntCmp $1 -1 absent refusal refusal','  absent:','  IntCmp $2 2 root_absent','  IntCmp $2 3 root_absent','  Goto refusal','  root_absent:',
    '  IfFileExists '+qvar(shortcut)+' refusal',
    '  ClearErrors','  EnumRegValue $0 HKCU '+quoted(KEY)+' 0','  IfErrors ok',
    '  refusal:','  SetErrorLevel 2','  Abort','  ok:','FunctionEnd',
    'Section "Install"','  SetOverwrite off','  ClearErrors',...install,
    '  SetOutPath "$INSTDIR"','  WriteUninstaller "$INSTDIR\\Uninstall.exe"',
    '  CreateShortCut '+[shortcut,'$INSTDIR\\'+APP,'','$INSTDIR\\'+APP].map(qvar).join(' '),
    '  IfErrors install_failed','  WriteRegStr HKCU '+quoted(KEY)+' "DisplayName" '+quoted(LABEL),
    '  WriteRegStr HKCU '+quoted(KEY)+' "DisplayVersion" "0.6.0-beta.1"',
    '  WriteRegStr HKCU '+quoted(KEY)+' "InstallLocation" "$INSTDIR"',
    '  WriteRegStr HKCU '+quoted(KEY)+' "UninstallString" \'$\\"$INSTDIR\\Uninstall.exe$\\"\'',
    '  WriteRegDWORD HKCU '+quoted(KEY)+' "NoModify" 1','  WriteRegDWORD HKCU '+quoted(KEY)+' "NoRepair" 1',
    '  IfErrors install_failed','  Goto installed','  install_failed:','  SetErrorLevel 4','  Abort','  installed:','SectionEnd',
    'Function un.onInit','  SetShellVarContext current','  SetRegView 64','  StrCmp $INSTDIR '+qvar(root)+' 0 invalid',
    ...checked('$LOCALAPPDATA','un.AssertNotReparse'),...checked('$LOCALAPPDATA\\Programs','un.AssertNotReparse'),
    ...checked('$INSTDIR','un.AssertNotReparse'),...checked('$SMPROGRAMS','un.AssertNotReparse'),
    ...dirs.flatMap(rel=>checked(relative(rel),'un.AssertNotReparse')),
    ...rows.flatMap(row=>checked(relative(row.path),'un.AssertNotReparse')),
    ...checked('$INSTDIR\\Uninstall.exe','un.AssertNotReparse'),...checked(shortcut,'un.AssertNotReparse'),
    '  ReadRegStr $0 HKCU '+quoted(KEY)+' "InstallLocation"',
    '  StrCmp $0 $INSTDIR verified','  invalid:','  SetErrorLevel 2','  Abort','  verified:','FunctionEnd',
    'Section "Uninstall"',
    ...rows.map(row=>'  Delete '+qvar(relative(row.path))),
    '  Delete '+qvar(shortcut),...['DisplayName','DisplayVersion','InstallLocation','UninstallString','NoModify','NoRepair'].map(name=>'  DeleteRegValue HKCU '+quoted(KEY)+' '+quoted(name)),'  DeleteRegKey /ifempty HKCU '+quoted(KEY),'  Delete "$INSTDIR\\Uninstall.exe"',
    ...dirs.reverse().map(rel=>'  RMDir '+qvar(relative(rel))),
    '  RMDir "$INSTDIR"','SectionEnd','',
  ].join('\r\n');
}
function run(executable,args,cwd,timeout=180000) {
  const p = spawnSync(executable,args,{cwd,encoding:'utf8',timeout,maxBuffer:2*1024*1024,windowsHide:true});
  if (p.error) throw p.error;
  assert.equal(p.status,0,'Process failed: '+path.basename(executable)+' ('+p.status+')\n'+(p.stderr||p.stdout).slice(-1600));
  return p.stdout.trim();
}
function args(input, keys) {
  assert.equal(input.length,keys.length*2);
  const result = {};
  for(let n=0;n<input.length;n+=2) {
    const key=input[n].slice(2);
    assert(input[n].startsWith('--') && keys.includes(key) && !Object.hasOwn(result,key));
    assert(path.isAbsolute(input[n+1]));
    result[key]=path.resolve(input[n+1]);
  }
  return result;
}
async function main() {
  assert.equal(process.platform,'win32','NSIS compilation is intentionally Windows-only.');
  const {stage,out,icon,compiler}=args(process.argv.slice(2),['stage','out','icon','compiler']);
  assert(!out.startsWith(stage+path.sep) && out!==stage, 'Output must be outside staging.');
  await assertPlain(stage,true); await assertPlain(path.dirname(out),true); await assertPlain(icon,false);
  assert.equal(await digest(icon),GAUGE,'Gauge ICO pin mismatch.');
  assert.equal(path.basename(compiler).toLowerCase(),'makensis.exe');
  await assertPlain(compiler,false);
  assert.equal(run(compiler,['/VERSION'],path.dirname(out),5000).replace(/^v/i,''),VERSION,'Unexpected NSIS version.');
  const compilerSha256=await digest(compiler);
  const rows=await inventory(stage);
  const setup=path.join(out,SETUP);
  const nsis=render(rows,stage,setup,icon);
  await fsp.mkdir(out);
  await fsp.writeFile(path.join(out,'setup.nsi'),'\uFEFF'+nsis,{flag:'wx'});
  // Solid-LZMA compression of the verified full payload can exceed three minutes on a standard runner.
  run(compiler,['/NOCONFIG','/V2','/WX',path.join(out,'setup.nsi')],out,12*60*1000);
  assert.equal(await digest(compiler),compilerSha256,'Compiler changed during build.');
  await assertPlain(setup,false);
  assert((await fsp.stat(setup)).size>1024*1024,'Setup did not include a plausible payload.');
  assert.deepEqual(await inventory(stage),rows,'Staged payload changed during compile.');
  await fsp.writeFile(path.join(out,'installer-receipt.json'),JSON.stringify({
    schema:1, setup:SETUP, setupSha256:await digest(setup), compilerVersion:VERSION, compilerSha256, scriptSha256:await digest(path.join(out,'setup.nsi')), gaugeSha256:GAUGE, files:rows,status:'compiled-unverified'
  },null,2)+'\n',{flag:'wx'});
}
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={APP,LABEL,SETUP,GAUGE,KEY,REQUIRED,args,assertPlain,digest,inventory,render,run,safeRel};
