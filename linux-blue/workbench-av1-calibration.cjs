'use strict';
// Fresh strict calibration for the separately pinned AV1-capable pair. Reuses
// the existing fixture and validators, never the earlier pair's receipt.
// This neither registers a family nor changes the actual application route.
const { calibrate } = require('./workbench-flac-calibration.cjs');
const { verifyAv1Tool } = require('./runtime-av1.cjs');
const { PINS, RUNTIME_ID, createAv1OperationRunner } = require('./runtime-av1-operation.cjs');
async function main() {
  await verifyAv1Tool('ffmpeg'); await verifyAv1Tool('ffprobe');
  return calibrate({ pins: PINS, runtimeIdentity: RUNTIME_ID,
    createRunner: createAv1OperationRunner, label: 'flac-candidate-' });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
