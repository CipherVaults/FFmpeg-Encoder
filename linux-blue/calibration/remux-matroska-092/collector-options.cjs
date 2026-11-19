'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const SOURCE_ROOT = path.resolve(__dirname, '../ffmpeg-integration091');
function collectorOptions(input) {
  assert(input && Number.isSafeInteger(input.sourceBytes) && input.sourceBytes > 0);
  const { sourceBytes, ...options } = input;
  assert(!Object.hasOwn(options, 'budget') && !Object.hasOwn(options, 'verificationMethod') && !Object.hasOwn(options, 'maxConcurrentChildren'));
  const { deriveRemuxAssessmentBudget } = require(path.join(SOURCE_ROOT, 'src/remux-operation.cjs'));
  const cost = deriveRemuxAssessmentBudget(options.assessment, String(sourceBytes), 'packet-identity-v1');
  // Exact legacy 32 MiB means approval, not a lower bound. Strictly smaller binds.
  const budget = Object.freeze({ ...cost.budget, maxSpoolBytes: 16 * 1024 * 1024 });
  return { ...options, verificationMethod: 'packet-identity-v1', maxConcurrentChildren: 1, budget };
}
async function collectActual(input) {
  const { collectRemuxEvidence } = require(path.join(SOURCE_ROOT, 'src/remux-evidence.cjs'));
  return collectRemuxEvidence(collectorOptions(input));
}
module.exports = { SOURCE_ROOT, collectorOptions, collectActual };
