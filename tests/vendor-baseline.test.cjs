'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { captureOrdinary } = require('../scripts/capture-ordinary-argv.cjs');

// Computed from raw `git show 253c567:<file>` bytes before any vendor code.
const PROTECTED = {
  'src/media.cjs': '4aaf7227e43b8ba10134fa1e34d15be7362eb5195d001eb1cfc629b66c677e66',
  'src/encode-operation.cjs': 'd78f98d00abb55c507c6996d0a0c064af757efdc4ee27929a80739c2a6ea5355',
  'src/operation-family.cjs': '1ea1c4092ce3c8a9b6deba6b8563f54cf048eb4fa466d98db23b5bc31e936e60',
  'src/operation-contract.cjs': 'dc01350dc18d1cbcdfd68f0b2c83cd43f7879d7eb8bc3b497d57a73d1eb1d0ba',
};
for (const [file, expected] of Object.entries(PROTECTED)) test(`${file} retains its 253c567 bytes`, () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.resolve(__dirname, '..', file))).digest('hex'), expected);
});

test('ordinary argv, plans, recipes, preferences and fake capability calls match the unmodified golden capture', async () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/ordinary-argv-golden.json'), 'utf8'));
  assert.deepEqual(await captureOrdinary(), golden);
});
