'use strict';
// Explicit historical qualification prerequisite checks, intentionally outside
// the default *.test.cjs portable suite. Run:
// node --test linux-blue/candidate-producer-qualification.cjs
// These checks read source hashes only. They execute no media and do not confer
// media qualification. Current stale producer pins deliberately fail; do not
// repin them merely to make this prerequisite suite green.
const test = require('node:test');
const { verifyCandidateServiceProducers: verifyKeep720 } = require('./candidate-keep720-service.cjs');
const { verifyCandidateServiceProducers: verifyResize } = require('./candidate-resize-service.cjs');
// Preserve both original positive assertion bodies, each with its own binding.
{
  const verifyCandidateServiceProducers = verifyKeep720;
  test('Keep720: calibration producer literal closure still equals immutable tested source', async () => {
    await verifyCandidateServiceProducers();
  });
}
{
  const verifyCandidateServiceProducers = verifyResize;
  test('resize: calibration producer literal closure still equals immutable tested source', async () => {
    await verifyCandidateServiceProducers();
  });
}
