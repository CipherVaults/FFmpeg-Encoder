'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {verifyHdrCatalogSeals}=require('../src/hdr-catalog-seals.cjs');
const sha=b=>createHash('sha256').update(b).digest('hex');
const names=[
  'main.js',
  'package.json',
  'preload.js',
  'resources/candidate-binary-manifest.json',
  'resources/hdr-content-configurations.json',
  'resources/hdr-sdr-content-configurations.json',
  'src/app-settings.cjs',
  'src/appearance.cjs',
  'src/backend-adapters.cjs',
  'src/backend-capabilities.cjs',
  'src/backend-discovery.cjs',
  'src/backend-observation.cjs',
  'src/backend-probe.cjs',
  'src/candidate-runtime.cjs',
  'src/capabilities.cjs',
  'src/container-clock.cjs',
  'src/diagnostics.cjs',
  'src/encode-operation.cjs',
  'src/encode-preservation-catalog.cjs',
  'src/encode-preservation-producers.cjs',
  'src/encode-preservation-workspace.cjs',
  'src/encode-preservation.cjs',
  'src/encoder-service.cjs',
  'src/hdr-catalog-seals.cjs',
  'src/hdr-container.cjs',
  'src/hdr-contract.cjs',
  'src/hdr-encoding.cjs',
  'src/hdr-evidence.cjs',
  'src/hdr-input.cjs',
  'src/hdr-operation.cjs',
  'src/hdr-workspace.cjs',
  'src/hevc-content.cjs',
  'src/inspection-cache.cjs',
  'src/inspection.cjs',
  'src/ipc.cjs',
  'src/local-protocol.cjs',
  'src/media-evidence.cjs',
  'src/media.cjs',
  'src/mov-representation.cjs',
  'src/operation-catalog.cjs',
  'src/operation-contract.cjs',
  'src/operation-controls.cjs',
  'src/operation-draft.cjs',
  'src/operation-evidence.cjs',
  'src/operation-family.cjs',
  'src/operation-names.cjs',
  'src/operation-qualification.cjs',
  'src/operation-runtime.cjs',
  'src/operation-storage.cjs',
  'src/operation-telemetry.cjs',
  'src/output-access.cjs',
  'src/outputs.cjs',
  'src/preferences.cjs',
  'src/process-runner.cjs',
  'src/provenance.cjs',
  'src/remux-catalog.cjs',
  'src/remux-contract.cjs',
  'src/remux-evidence.cjs',
  'src/remux-metadata-policy.cjs',
  'src/remux-operation.cjs',
  'src/remux-validation.cjs',
  'src/remux-workspace.cjs',
  'src/source-catalog-seals.cjs',
  'src/source-identity.cjs',
  'src/storage-eligibility.cjs',
  'src/windows-adapters.cjs',
  'ui/index.html',
  'ui/renderer.js',
  'ui/styles.css',
];
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'hdr-catalog-seals-'));await fs.mkdir(path.join(root,'src'));await fs.mkdir(path.join(root,'resources'));
 const files=[];for(const name of names){const bytes=Buffer.from('Mocked qualification producer '+name);await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),bytes);files.push({path:name,sha256:sha(bytes)});}
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
for(const name of ['appearance','ipc','hdr-container','media-evidence','provenance','operation-runtime','operation-storage','operation-telemetry','candidate-runtime','outputs','output-access','storage-eligibility','diagnostics'])
 test('qualification cannot omit transitive authority producer '+name,async t=>{const h=await fixture(t);h.manifest.files=h.manifest.files.filter(file=>file.path!=='src/'+name+'.cjs');assert.equal(verifyHdrCatalogSeals(await h.save(h.manifest),h.root),false);});
for(const file of ['main.js','preload.js'])
 test('qualification cannot omit presentation entry producer '+file,async t=>{const h=await fixture(t);assert.equal(verifyHdrCatalogSeals(h.expected,h.root),true);h.manifest.files=h.manifest.files.filter(entry=>entry.path!==file);assert.equal(verifyHdrCatalogSeals(await h.save(h.manifest),h.root),false);});
for(const file of ['main.js','preload.js','src/ipc.cjs','src/appearance.cjs'])
 test('a byte change to '+file+' expires existing qualification',async t=>{const h=await fixture(t);assert.equal(verifyHdrCatalogSeals(h.expected,h.root),true);await fs.appendFile(path.join(h.root,file),'changed presentation producer');assert.equal(verifyHdrCatalogSeals(h.expected,h.root),false);});
test('a raw-container preservation guard edit expires existing qualification',async t=>{const h=await fixture(t);assert.equal(verifyHdrCatalogSeals(h.expected,h.root),true);await fs.appendFile(path.join(h.root,'src/hdr-container.cjs'),'changed raw scalar guard');assert.equal(verifyHdrCatalogSeals(h.expected,h.root),false);});
