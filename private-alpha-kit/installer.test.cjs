'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {REQUIRED,render,safeRel,args}=require('./installer.cjs');
test('reject dangerous, nested-state, relative and reserved device names',()=>{
  for(const value of ['../a','resources/../../x','data/test','data','Uninstall.exe','A//B','a:b','a\\b','a/b ',' N','a/CON.txt','a/a"file','a/$INSTDIR','a/empty/.','a/../b']) {
    assert.throws(()=>safeRel(value),value);
  }
  assert.equal(safeRel('resources/ffmpeg/ffmpeg.exe'),'resources/ffmpeg/ffmpeg.exe');
  assert.throws(()=>args(['--stage','here'],['stage']));
});
test('installer explicit payload and uninstall list; no recursion, elevation, run, or wildcard',()=>{
  const payload=[...REQUIRED,'resources/chromium.pak'].map(path=>({path}));
  const recipe=render(payload,'/path with spaces','/out/installer.exe','/gauge.ico');
  assert.match(recipe,/RequestExecutionLevel user/);
  assert.match(recipe,/LOCALAPPDATA\\Programs\\FFmpeg Encoder 0\.7 Alpha/);
  assert.match(recipe,/Uninstall\\FFmpegEncoder070AlphaPrivate/);
  assert.match(recipe,/GetFileAttributesW/);
  assert.match(recipe,/0x400/);
  assert.match(recipe,/\bWriteUninstaller\b/);
  assert.match(recipe,/SetOverwrite off/);
  assert.match(recipe,/DeleteRegKey \/ifempty HKCU/);assert.doesNotMatch(recipe,/DeleteRegKey HKCU/);
  assert.equal(recipe.match(/DeleteRegValue HKCU/g).length,6);
  assert.doesNotMatch(recipe,/RMDir \/r|WriteRegStr HKLM|Exec(?:Wait|Shell)? |File \/r|Delete .*\*/i);
  assert.equal(recipe.match(/^  File /gm).length,payload.length);
  assert.equal(recipe.match(/^  Delete /gm).length,payload.length+2);
  assert.throws(()=>render(payload.slice(1),'/app','/setup.exe','/icon.ico'),/Required packaged file missing/);
  assert.equal(render(payload,'/path with spaces','/out/installer.exe','/gauge.ico'),recipe);
});
