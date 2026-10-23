'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {verifyHdrCatalogSeals}=require('../src/hdr-catalog-seals.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=['hdr-catalog-seals','hdr-operation','hdr-input','hevc-content','hdr-workspace','hdr-evidence','hdr-encoding','hdr-contract','hdr-container',
  'operation-controls','encoder-service','inspection','media','process-runner','source-identity','operation-contract',
  'media-evidence','provenance','operation-runtime','operation-storage','operation-telemetry','candidate-runtime','outputs','output-access','storage-eligibility','diagnostics'].map(n=>'src/'+n+'.cjs').concat('resources/hdr-content-configurations.json','main.js','preload.js');
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'hdr-catalog-seals-'));await fs.mkdir(path.join(root,'src'));await fs.mkdir(path.join(root,'resources'));
 const files=[];for(const name of names){const bytes=Buffer.from('Mocked qualification producer '+name);await fs.writeFile(path.join(root,name),bytes);files.push({path:name,sha256:sha(bytes)});}
 const save=async manifest=>{const bytes=Buffer.from(JSON.stringify(manifest));await fs.writeFile(path.join(root,'resources/hdr-content-producers.json'),bytes);return sha(bytes);};
 const manifest={schema:1,files},expected=await save(manifest);t.diagnostic('Retained synthetic seal fixture '+root);return {root,manifest,save,expected};}
test('default qualification verifies the complete reviewed implementation and template bytes',async t=>{const h=await fixture(t);assert.equal(verifyHdrCatalogSeals(h.expected,h.root),true);await fs.appendFile(path.join(h.root,'src/hdr-input.cjs'),'changed');assert.equal(verifyHdrCatalogSeals(h.expected,h.root),false);});
test('changing the pin manifest cannot silently renew qualification',async t=>{const h=await fixture(t);await h.save({...h.manifest,unreviewed:true});assert.equal(verifyHdrCatalogSeals(h.expected,h.root),false);});
for(const [label,change] of [
 ['missing critical producer',m=>{m.files[0]={path:'src/unrelated.cjs',sha256:'a'.repeat(64)};}],
 ['duplicate producer',m=>{m.files[1]=m.files[0];}],
 ['path traversal',m=>{m.files[1].path='../unrelated';}],
 ['catalog self reference',m=>{m.files[1].path='src/hdr-catalog.cjs';}],
 ['extra entry field',m=>{m.files[1].unreviewed=true;}],
 ['foreign digest',m=>{m.files[1].sha256='a'.repeat(64);}],
 ['unsupported schema',m=>{m.schema=2;}],
])test('seal contract refuses '+label,async t=>{const h=await fixture(t);change(h.manifest);const expected=await h.save(h.manifest);assert.equal(verifyHdrCatalogSeals(expected,h.root),false);});
test('missing manifests and malformed identities never activate the catalog',async t=>{const h=await fixture(t);assert.equal(verifyHdrCatalogSeals(null,h.root),false);await fs.unlink(path.join(h.root,'resources/hdr-content-producers.json'));assert.equal(verifyHdrCatalogSeals(h.expected,h.root),false);});
for(const name of ['hdr-container','media-evidence','provenance','operation-runtime','operation-storage','operation-telemetry','candidate-runtime','outputs','output-access','storage-eligibility','diagnostics'])
 test('qualification cannot omit transitive authority producer '+name,async t=>{const h=await fixture(t);h.manifest.files=h.manifest.files.filter(file=>file.path!=='src/'+name+'.cjs');assert.equal(verifyHdrCatalogSeals(await h.save(h.manifest),h.root),false);});
test('a raw-container preservation guard edit expires existing qualification',async t=>{const h=await fixture(t);assert.equal(verifyHdrCatalogSeals(h.expected,h.root),true);await fs.appendFile(path.join(h.root,'src/hdr-container.cjs'),'changed raw scalar guard');assert.equal(verifyHdrCatalogSeals(h.expected,h.root),false);});
