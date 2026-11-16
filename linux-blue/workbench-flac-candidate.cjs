'use strict';
// Explicit opt-in pre-activation experiment; workbench-main keeps system 7.1.5.
const { calibrate } = require('./workbench-flac-calibration.cjs');
const { PINS, RUNTIME_ID, verifyCandidateTool, createCandidateRunner } = require('./runtime-candidate.cjs');
async function main() {
  await verifyCandidateTool('ffmpeg'); await verifyCandidateTool('ffprobe');
  return calibrate({ pins: PINS, runtimeIdentity: RUNTIME_ID, createRunner: createCandidateRunner, label: 'flac-candidate-' });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
