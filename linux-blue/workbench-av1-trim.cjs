'use strict';
// Separate developer proof only. No application route or renderer configuration
// selects this composition. Neither old-pair receipt nor qualification is reused.
const path = require('node:path');
const { createCalibratedTrimServiceFactory } = require('./workbench-trim-candidate.cjs');
const { PINS, RUNTIME_ID, verifyAv1Tool } = require('./runtime-av1.cjs');
const { createAv1OperationRunner } = require('./runtime-av1-operation.cjs');
const REPORT = path.join(__dirname, 'artifacts', 'flac-candidate-FjjuSk', 'report.json');
const REPORT_SHA = '749a5eb326864f756cd663e3c1fc9bde854ea80a9b2650cc9dbe6b1d0caac53a';
const QUALIFIED_RUNTIME_ID = '682e105c3586993d44c2c981149a5ae904713b9395cfa9cbfab48da9f903b0ae';
if (RUNTIME_ID !== QUALIFIED_RUNTIME_ID) throw Object.assign(new Error('The AV1 trim receipt belongs to another executable pair.'),
  { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
const createAv1TrimService = createCalibratedTrimServiceFactory({
  pins: PINS, runtimeIdentity: QUALIFIED_RUNTIME_ID, verifyTool: verifyAv1Tool, createRunner: createAv1OperationRunner,
  report: REPORT, reportSha: REPORT_SHA, policyIdentity: 'blue-linux-av1-trim-service-candidate-v1',
});
module.exports = { createAv1TrimService, REPORT, REPORT_SHA, QUALIFIED_RUNTIME_ID };
