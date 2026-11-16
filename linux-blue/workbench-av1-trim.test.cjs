'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createAv1TrimService, REPORT, REPORT_SHA, QUALIFIED_RUNTIME_ID } = require('./workbench-av1-trim.cjs');
const { assertCalibrationReceipt } = require('./workbench-trim-candidate.cjs');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
test('AV1 trim composition binds only its fresh receipt and executable pair', () => {
  assert.equal(typeof createAv1TrimService, 'function');
  assert.equal(QUALIFIED_RUNTIME_ID, require('./runtime-av1.cjs').RUNTIME_ID);
  assert.equal(QUALIFIED_RUNTIME_ID, '682e105c3586993d44c2c981149a5ae904713b9395cfa9cbfab48da9f903b0ae');
  assert.notEqual(QUALIFIED_RUNTIME_ID, require('./runtime-candidate.cjs').RUNTIME_ID);
  assert.ok(REPORT.endsWith('/flac-candidate-FjjuSk/report.json'));
  assert.equal(REPORT_SHA, '749a5eb326864f756cd663e3c1fc9bde854ea80a9b2650cc9dbe6b1d0caac53a');
  assert.notEqual(REPORT_SHA, require('./workbench-trim-candidate.cjs').REPORT_SHA);
});
test('another runtime receipt cannot be admitted to the AV1 composition', () => {
  const report = { status: 'passed-calibration-only', runtimeIdentity: require('./runtime-candidate.cjs').RUNTIME_ID,
    cases: Array.from({ length: 3 }, () => ({ status: 'passed' })), source: { sha256: 'b'.repeat(64) },
    frozen: { qualification: { runtimeIdentity: QUALIFIED_RUNTIME_ID }, timingQualification: { runtimeIdentity: QUALIFIED_RUNTIME_ID } } };
  const bytes = Buffer.from(JSON.stringify(report));
  assert.throws(() => assertCalibrationReceipt(bytes, { runtimeIdentity: QUALIFIED_RUNTIME_ID, reportSha: sha(bytes) }),
    { code: 'LINUX_TRIM_CANDIDATE_SCOPE' });
});
test('AV1 developer composition reuses the guarded service and streaming integrity runner', async () => {
  const source = await fs.readFile(path.join(__dirname, 'workbench-av1-trim.cjs'), 'utf8');
  assert.match(source, /createCalibratedTrimServiceFactory\(\{/);
  assert.match(source, /verifyTool: verifyAv1Tool, createRunner: createAv1OperationRunner/);
  assert.match(source, /blue-linux-av1-trim-service-candidate-v1/);
  assert.doesNotMatch(source, /process\.argv|process\.env|ipcMain|createRemuxControls|OperationFamilySelector/);
  const main = await fs.readFile(path.join(__dirname, 'workbench-main.cjs'), 'utf8');
  assert.ok(!main.includes('workbench-av1-trim'));
  const ordinary = await fs.readFile(path.join(__dirname, 'workbench-av1-service.cjs'), 'utf8');
  assert.ok(!ordinary.includes('workbench-av1-trim'));
});
