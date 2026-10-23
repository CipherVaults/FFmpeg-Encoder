'use strict';

// PROPOSAL: exact existing Full ingress partition plus the current naming
// producer. This32-path list is not the whole application's dependency closure.
const ENCODE_PRESERVATION_PRODUCER_PATHS = Object.freeze([
  'main.js','preload.js','package.json','resources/candidate-binary-manifest.json',
  'src/candidate-runtime.cjs','src/diagnostics.cjs','src/encode-operation.cjs',
  'src/encode-preservation.cjs','src/encode-preservation-producers.cjs','src/encode-preservation-workspace.cjs',
  'src/encoder-service.cjs','src/inspection.cjs','src/inspection-cache.cjs','src/ipc.cjs','src/local-protocol.cjs',
  'src/media.cjs','src/media-evidence.cjs','src/operation-contract.cjs','src/operation-controls.cjs',
  'src/operation-draft.cjs','src/operation-names.cjs','src/operation-runtime.cjs','src/outputs.cjs','src/output-access.cjs',
  'src/process-runner.cjs','src/provenance.cjs','src/source-catalog-seals.cjs','src/source-identity.cjs',
  'src/storage-eligibility.cjs','ui/index.html','ui/renderer.js','ui/styles.css',
].sort());
module.exports = { ENCODE_PRESERVATION_PRODUCER_PATHS };
