'use strict';
// Explicit alternative composition of the actual service, not another product
// shell. No qualifications from a different runtime are imported or inferred.
const { LinuxWorkbenchService } = require('./workbench-service.cjs');
const { failedVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { PINS, RUNTIME_ID, verifyAv1Tool, createAv1Runner } = require('./runtime-av1.cjs');
async function createAv1WorkbenchService({ stateDir, onChild, outputAccess } = {}) {
  await verifyAv1Tool('ffmpeg'); await verifyAv1Tool('ffprobe');
  const service = new LinuxWorkbenchService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path,
    stateDir, runtimeIdentity: RUNTIME_ID, outputAccess, inspectionWorkers: 1, run: createAv1Runner({ onChild }),
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
  });
  service.linuxRemuxStatus = Object.freeze({ available: false,
    reason: 'Remux and changed encodes are not qualified for this runtime. Use the unchanged baseline entry for its reviewed remux preview.' });
  return service;
}
// Qualified explicit AV1 composition; the original ordinary factory remains for regression and rollback.
// Exact pre-catalog AND actual-service proofs gate construction. No fallback
// to ordinary-only controls disguises a missing or changed qualification.
async function createQualifiedAv1WorkbenchService({ stateDir, onChild, outputAccess } = {}) {
  const { createQualifiedEncodeControls } = require('./workbench-qualified-encode-controls.cjs');
  const { controls, status } = await createQualifiedEncodeControls({ stateDir, onChild });
  const { Av1WorkbenchAdmissionService } = require('./workbench-av1-admission.cjs');
  const service = new Av1WorkbenchAdmissionService({ ffmpeg: PINS.ffmpeg.path, ffprobe: PINS.ffprobe.path,
    stateDir, runtimeIdentity: RUNTIME_ID, outputAccess, inspectionWorkers: 1,
    // Ordinary calls retain timeout-zero compatibility and terminal progress.
    // Qualified calls use their separate observed proportional runner instead.
    run: createAv1Runner({ onChild }),
    vendorCapabilities: async () => ({ profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map() }),
    ...controls,
  });
  service.linuxQualifiedEncodeStatus = status;
  service.linuxRemuxStatus = Object.freeze({ available: false,
    reason: 'Remux is not qualified for this AV1 runtime. Qualified CPU H265 SDR FLAC operations have separate per-file eligibility; ordinary CPU encoding remains available.' });
  return service;
}
module.exports = { createAv1WorkbenchService, createQualifiedAv1WorkbenchService };
