'use strict';

// PROPOSAL ONLY: place at src/hdr-catalog-seals.cjs after root review.
// No imports/checks/tests/media/activation performed by the proposal author.
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const HASH = /^[a-f0-9]{64}$/;
const equalPath = (a,b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const stamp = s => ['dev','ino','size','nlink','mtimeNs','ctimeNs','birthtimeNs'].map(k => String(s[k])).join(':');
const ordinary = s => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n && s.dev > 0n && s.ino > 0n;
const sha = b => createHash('sha256').update(b).digest('hex');
// Exactly64 reviewed literal dependency paths, plus UI3 and the two fixed
// runtime/SDR-resource reads. HDR activation and its own manifest are excluded
// to avoid a self-hash cycle. This is not an arbitrary src/resource regex.
const HDR_CONTENT_PRODUCER_PATHS = Object.freeze([
  'main.js','package.json','preload.js',
  'resources/candidate-binary-manifest.json','resources/hdr-content-configurations.json','resources/hdr-sdr-content-configurations.json',
  'src/app-settings.cjs','src/appearance.cjs','src/backend-adapters.cjs','src/backend-capabilities.cjs',
  'src/backend-discovery.cjs','src/backend-observation.cjs','src/backend-probe.cjs','src/candidate-runtime.cjs',
  'src/capabilities.cjs','src/container-clock.cjs','src/diagnostics.cjs','src/encode-operation.cjs',
  'src/encode-preservation-catalog.cjs','src/encode-preservation-producers.cjs','src/encode-preservation-workspace.cjs','src/encode-preservation.cjs',
  'src/encoder-service.cjs','src/hdr-catalog-seals.cjs','src/hdr-container.cjs','src/hdr-contract.cjs','src/hdr-encoding.cjs',
  'src/hdr-evidence.cjs','src/hdr-input.cjs','src/hdr-operation.cjs','src/hdr-workspace.cjs','src/hevc-content.cjs',
  'src/inspection-cache.cjs','src/inspection.cjs','src/ipc.cjs','src/local-protocol.cjs','src/media-evidence.cjs','src/media.cjs',
  'src/mov-representation.cjs','src/operation-catalog.cjs','src/operation-contract.cjs','src/operation-controls.cjs',
  'src/operation-draft.cjs','src/operation-evidence.cjs','src/operation-family.cjs','src/operation-names.cjs',
  'src/operation-qualification.cjs','src/operation-runtime.cjs','src/operation-storage.cjs','src/operation-telemetry.cjs',
  'src/output-access.cjs','src/outputs.cjs','src/preferences.cjs','src/process-runner.cjs','src/provenance.cjs',
  'src/remux-catalog.cjs','src/remux-contract.cjs','src/remux-evidence.cjs','src/remux-metadata-policy.cjs',
  'src/remux-operation.cjs','src/remux-validation.cjs','src/remux-workspace.cjs','src/source-catalog-seals.cjs',
  'src/source-identity.cjs','src/storage-eligibility.cjs','src/windows-adapters.cjs',
  'ui/index.html','ui/renderer.js','ui/styles.css',
].sort());
const JSON_RESOURCES = new Set([
  'resources/hdr-content-producers.json',
  'resources/hdr-content-configurations.json',
  'resources/hdr-sdr-content-configurations.json',
]);
function rawFile(relative, expected, root, maximum) {
  if (typeof expected !== 'string' || !HASH.test(expected)) return null;
  const selected = path.resolve(root), file = path.join(selected,relative);
  if (!equalPath(fs.realpathSync(selected),selected)) return null;
  // Walk every real ancestor, including the selected root, with no junction,
  // symlink or redirected canonical path accepted as a nearby substitute.
  let cursor = path.parse(file).root;
  for (const part of path.relative(cursor,path.dirname(file)).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor,part); const s = fs.lstatSync(cursor);
    if (!s.isDirectory() || s.isSymbolicLink() || !equalPath(fs.realpathSync(cursor),cursor)) return null;
  }
  const before = fs.lstatSync(file,{bigint:true});
  if (!ordinary(before) || before.size > BigInt(maximum) || !equalPath(fs.realpathSync(file),file)) return null;
  const fd = fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const held = fs.fstatSync(fd,{bigint:true});
    if (!ordinary(held) || stamp(held) !== stamp(before)) return null;
    // Reserve only the admitted size plus one sentinel byte. A concurrent
    // grow cannot make the read allocate or consume an unbounded whole file.
    const capacity = Number(before.size) + 1, storage = Buffer.alloc(capacity);
    let used = 0;
    while (used < capacity) {
      const count = fs.readSync(fd,storage,used,capacity-used,used);
      if (!Number.isInteger(count) || count < 0 || count > capacity-used) return null;
      if (count === 0) break;
      used += count;
    }
    // Exact original size plus observed EOF is required; the sentinel catches
    // growth even when the named/held metadata has not yet changed.
    const bytes = storage.subarray(0,used);
    const afterHeld = fs.fstatSync(fd,{bigint:true}), afterNamed = fs.lstatSync(file,{bigint:true});
    if (BigInt(bytes.length) !== before.size || sha(bytes) !== expected || !ordinary(afterHeld) || !ordinary(afterNamed)
        || stamp(before) !== stamp(afterHeld) || stamp(before) !== stamp(afterNamed)
        || !equalPath(fs.realpathSync(file),file)) return null;
    return bytes;
  } finally { fs.closeSync(fd); }
}
// Narrow fixed JSON reads for HDR only; the generic Full reader stays unchanged.
// No caller-provided resource path can broaden this set.
function readHdrCatalogResource(relative, expected, root = path.resolve(__dirname,'..')) {
  try { return JSON_RESOURCES.has(relative) ? rawFile(relative,expected,root,65536) : null; }
  catch { return null; }
}
function verifyHdrCatalogSeals(expected, root = path.resolve(__dirname,'..')) {
  try {
    const bytes = readHdrCatalogResource('resources/hdr-content-producers.json',expected,root);
    if (!bytes) return false; const manifest = JSON.parse(bytes);
    if (!manifest || Object.keys(manifest).sort().join(',') !== 'files,schema' || manifest.schema !== 1
        || !Array.isArray(manifest.files) || manifest.files.length !== HDR_CONTENT_PRODUCER_PATHS.length) return false;
    const seen = new Set();
    for (const entry of manifest.files) {
      if (!entry || Object.keys(entry).sort().join(',') !== 'path,sha256' || typeof entry.path !== 'string'
          || !HDR_CONTENT_PRODUCER_PATHS.includes(entry.path) || seen.has(entry.path)
          || typeof entry.sha256 !== 'string' || !HASH.test(entry.sha256)) return false;
      seen.add(entry.path);
      if (!rawFile(entry.path,entry.sha256,root,2*1024**2)) return false;
    }
    return JSON.stringify([...seen].sort()) === JSON.stringify(HDR_CONTENT_PRODUCER_PATHS);
  } catch { return false; }
}
module.exports = { HDR_CONTENT_PRODUCER_PATHS, readHdrCatalogResource, verifyHdrCatalogSeals };
