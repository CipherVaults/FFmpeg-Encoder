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
  'src/media.cjs': ['253c567', '4aaf7227e43b8ba10134fa1e34d15be7362eb5195d001eb1cfc629b66c677e66'],
  'src/encode-operation.cjs': ['253c567', 'd78f98d00abb55c507c6996d0a0c064af757efdc4ee27929a80739c2a6ea5355'],
  'src/operation-family.cjs': ['Q1a', '7de5909b2e20ed081bbd16b866e325788920e5b5e32940832c422b9a1bc3797b'],
  'src/operation-contract.cjs': ['Q1a', '84111682aeef801e1438904e695aa7c46c09fe23b1afe059d3a11e90142be4b1'],
};
for (const [file, [since, expected]] of Object.entries(PROTECTED)) test(`${file} retains its ${since} bytes`, () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex'), expected);
});

test('ordinary argv, plans, recipes, preferences and fake capability calls match the unmodified golden capture', async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ordinary-argv-golden.json'), 'utf8'));
  assert.deepEqual(await captureOrdinary(), golden);
});
