'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {graphBinding,bindingMatches}=require('../scripts/v07-remux-implementation.cjs');
test('admission graph binds a transitive helper and invalidates its cached digest after its bytes change',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'remux-graph-'));t.after(async()=>{assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^remux-graph-/);await fs.rm(root,{recursive:true});});
  const entry=path.join(root,'entry.cjs'),middle=path.join(root,'middle.cjs'),leaf=path.join(root,'leaf.cjs');
  await fs.writeFile(entry,"module.exports=require('./middle.cjs');");await fs.writeFile(middle,"module.exports=require('./leaf.cjs');");await fs.writeFile(leaf,'module.exports=1;');require(entry);
  const a=await graphBinding([entry],[root]);assert.equal(a.files.length,3);assert.equal(await bindingMatches(a,[entry],[root]),true);
  await fs.writeFile(leaf,'module.exports=2;');const b=await graphBinding([entry],[root]);assert.notEqual(a.digest,b.digest);assert.equal(await bindingMatches(a,[entry],[root]),false);
  assert.equal(await bindingMatches({...b,files:b.files.filter(f=>f.file!==leaf)},[entry],[root]),false);
  assert.equal(await bindingMatches({...b,files:[...b.files,{file:path.join(root,'..','outside.cjs'),sha256:'a'.repeat(64)}]},[entry],[root]),false);
  assert.equal(await bindingMatches(undefined,[entry],[root]),false);
});
