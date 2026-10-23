'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Qualification belongs to the reviewed implementation as well as its native
// runtime/configurations. A development edit expires the default catalog until
// its affected evidence is reviewed again. This main-only reader executes no
// tool and exposes no filesystem path choice to the renderer.
function verifyHdrCatalogSeals(expected, root = path.resolve(__dirname, '..')) {
  try {
    if (!/^[a-f0-9]{64}$/.test(expected)) return false;
    const file = path.join(root, 'resources/hdr-content-producers.json');
    if (fs.statSync(file).size > 65536) return false;
    const raw = fs.readFileSync(file);
    const sha = bytes => createHash('sha256').update(bytes).digest('hex');
    if (sha(raw) !== expected) return false;
    const manifest = JSON.parse(raw);
    if (manifest.schema !== 1 || !Array.isArray(manifest.files) || manifest.files.length < 16 || manifest.files.length > 128) return false;
    const seen = new Set();
    for (const entry of manifest.files) {
      if (!entry || Object.keys(entry).sort().join(',') !== 'path,sha256' || typeof entry.path !== 'string'
          || !/^(src\/[a-z0-9-]+\.cjs|resources\/hdr-content-configurations\.json|main\.js|preload\.js)$/.test(entry.path)
          || entry.path === 'src/hdr-catalog.cjs' || seen.has(entry.path) || !/^[a-f0-9]{64}$/.test(entry.sha256)) return false;
      seen.add(entry.path);
      const candidate = path.join(root, entry.path);
      if (fs.statSync(candidate).size > 2 * 1024 * 1024 || sha(fs.readFileSync(candidate)) !== entry.sha256) return false;
    }
    return ['main.js','preload.js','src/appearance.cjs','src/ipc.cjs','src/hdr-catalog-seals.cjs','src/hdr-operation.cjs','src/hdr-input.cjs','src/hevc-content.cjs','src/hdr-workspace.cjs',
      'src/hdr-evidence.cjs','src/hdr-encoding.cjs','src/hdr-contract.cjs','src/hdr-container.cjs','src/operation-controls.cjs','src/encoder-service.cjs',
      'src/inspection.cjs','src/media.cjs','src/process-runner.cjs','src/source-identity.cjs','src/operation-contract.cjs',
      'src/media-evidence.cjs','src/provenance.cjs','src/operation-runtime.cjs','src/operation-storage.cjs','src/operation-telemetry.cjs',
      'src/candidate-runtime.cjs','src/outputs.cjs','src/output-access.cjs','src/storage-eligibility.cjs','src/diagnostics.cjs',
      'resources/hdr-content-configurations.json'].every(file => seen.has(file));
  } catch { return false; }
}

module.exports = { verifyHdrCatalogSeals };
