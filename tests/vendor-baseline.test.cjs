'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { captureOrdinary } = require('../scripts/capture-ordinary-argv.cjs');

// Each pin names the commit whose raw bytes it holds. 253c567 is the last
// commit before any vendor code. Milestone Q changes some of these files on
// purpose (record 47); each such slice re-pins only the files it changed, so
// every edit stays deliberate. The golden capture below remains the byte proof
// that ordinary argv, plans and defaults are unchanged.
const PROTECTED = {
  // 0.7.0-alpha.1 adds only the FFmpeg 9.1 -keep_metadata block (as in 0.6.0-beta.1). The golden was
  // re-captured after a field-by-field proof that each case differs from the 253c567 capture by
  // exactly that 40-value block (args, operationArgs, capability test encodes); see the release receipt.
  'src/media.cjs': ['Alpha 9.1 keep_metadata', '42bb237302ccbbaa8230492b24038b2b54f94a5fe4fdd981f4661f1d16d7ea51'],
  'src/encode-operation.cjs': ['Q2c', 'ebd24233c03a78f2c67f6ce3787694eb9d73b0b3ee8da2f6758ae42deeb20a3a'],
  'src/operation-family.cjs': ['Q2c', '8d46658971df607180dba68c9412d6ebd74aeea68321643c30e4f610566e20aa'],
  'src/operation-contract.cjs': ['Q1b', 'e87c0bd40a27e9bc4309cfff489a3270899edc6505face10a9c4461272bb343d'],
};
for (const [file, [since, expected]] of Object.entries(PROTECTED)) test(`${file} retains its ${since} bytes`, () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex'), expected);
});

test('ordinary argv, plans, recipes, preferences and fake capability calls match the unmodified golden capture', async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ordinary-argv-golden.json'), 'utf8'));
  assert.deepEqual(await captureOrdinary(), golden);
});
