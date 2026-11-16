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
module.exports = { createAv1WorkbenchService };
