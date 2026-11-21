'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { appFiles } = require('../scripts/build-portable.cjs');
const { validatePlan } = require('../scripts/build-linux-inert-package.cjs');
const plan = require('../resources/linux-inert-package-plan.json');
const root = path.resolve(__dirname, '..');
const catalogues = new Map([
  ['src/operation-catalog.cjs', 'fc1465cb145c974df0aab859cd467e2b1527ffc555b42828839db127d188b032'],
  ['src/remux-catalog.cjs', '3aaa18c80349b3b9c98cfac165eb63d782c8a6b264e94ff3f71169e976394fac'],
]);

for (const source of catalogues.keys()) {
  test(source + ' is copied application source, without private evidence path comments', () => {
    assert.ok(appFiles(root).includes(source), 'Windows source inventory must actually include this catalogue');
    const rows = plan.files.filter(row => row.root === 'source' && row.source === source);
    assert.equal(rows.length, 1);
    const [row] = rows;
    assert.equal(row.target, 'electron/resources/app/' + source);
    const bytes = fs.readFileSync(path.join(root, source));
    assert.equal(row.bytes, bytes.length);
    assert.equal(row.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(/(?:^|[\s'"])artifacts[/\\]/m.test(bytes.toString('utf8')), false,
      'Copied catalogue source must not name a private evidence location');
  });
}

test('pathless catalogue comments do not change policy, evidence IDs, device bindings or freezing', () => {
  for (const [source, expected] of catalogues) {
    const value = require(path.join(root, source));
    assert.equal(createHash('sha256').update(JSON.stringify(value)).digest('hex'), expected);
    for (const rows of Object.values(value).filter(Array.isArray)) {
      assert.ok(Object.isFrozen(rows));
      assert.ok(rows.every(row => Object.isFrozen(row) && Object.isFrozen(row.evidenceIds)));
    }
  }
});

test('catalogue source inventory remains an inert Linux plan; the historical calibration CLI is not app source', () => {
  assert.ok(validatePlan(plan) > 0);
  const calibration = 'scripts/v07-sdr-flac-range-calibration.cjs';
  assert.equal(appFiles(root).includes(calibration), false);
  assert.equal(plan.files.filter(row => row.root === 'source' && row.source === calibration).length, 0);
});
