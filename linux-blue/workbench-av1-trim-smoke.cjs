'use strict';
// Fresh real-service proof for the exact AV1-pair calibration. Neither this
// developer entry nor its composition is imported by the application.
const { smoke } = require('./workbench-trim-candidate-smoke.cjs');
const { createAv1TrimService, REPORT, REPORT_SHA } = require('./workbench-av1-trim.cjs');
const { PINS, createAv1OperationRunner } = require('./runtime-av1-operation.cjs');
async function main() {
  return smoke({ createService: createAv1TrimService, reportFile: REPORT,
    reportSha: REPORT_SHA, pins: PINS, createRunner: createAv1OperationRunner,
    artifactLabel: 'trim-service-av1-' });
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { main };
