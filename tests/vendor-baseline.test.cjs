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
  'src/encode-operation.cjs': ['Q1c', 'a94ca2bb4f94cfa91c62f3df3fbd8223587c0129e660abaa4c2b256dee1110ea'],
  'src/operation-family.cjs': ['Q1a', '7de5909b2e20ed081bbd16b866e325788920e5b5e32940832c422b9a1bc3797b'],
  'src/operation-contract.cjs': ['Q1b', 'e87c0bd40a27e9bc4309cfff489a3270899edc6505face10a9c4461272bb343d'],
};
for (const [file, [since, expected]] of Object.entries(PROTECTED)) test(`${file} retains its ${since} bytes`, () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex'), expected);
});

test('ordinary argv, plans, recipes, preferences and fake capability calls match the unmodified golden capture', async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ordinary-argv-golden.json'), 'utf8'));
  assert.deepEqual(await captureOrdinary(), golden);
});
