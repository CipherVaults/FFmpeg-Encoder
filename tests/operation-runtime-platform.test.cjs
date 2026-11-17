'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

// Evaluate the actual private guard in isolated platform contexts. No production
// export, global process.platform mutation, executable or native Windows claim.
const filename = path.join(__dirname, '../src/operation-runtime.cjs');
const source = fs.readFileSync(filename, 'utf8');
function guard(platform) {
  const unit = { exports: {} };
  vm.runInNewContext(`${source}\nmodule.exports.testOnly = { ordinary, stamp };`, {
    require: createRequire(filename), module: unit, exports: unit.exports,
    process: { platform },
  }, { filename });
  return unit.exports.testOnly;
}
const MIN_SIGNED_INODE = -(1n << 63n);
const stat = (ino, overrides = {}) => ({ ino, nlink: 1n, dev: 1n, size: 32n,
  mtimeNs: 2n, ctimeNs: 3n, birthtimeNs: 4n,
  isFile: () => true, isSymbolicLink: () => false, ...overrides });

test('Linux accepts exact nonzero positive and signed 64-bit inode representations', () => {
  const { ordinary } = guard('linux');
  for (const ino of [1n, 123456n, (1n << 64n) - 1n, -1n,
    MIN_SIGNED_INODE, -9223372036854474998n, -9223372036854474992n]) {
    assert.doesNotThrow(() => ordinary(stat(ino)), String(ino));
  }
});

test('Linux rejects unknown, zero and out-of-range negative inode identities', () => {
  const { ordinary } = guard('linux');
  for (const ino of [0n, MIN_SIGNED_INODE - 1n, -(1n << 128n),
    1, -1, '1', '-1', undefined, null, {}, NaN, Infinity]) {
    assert.throws(() => ordinary(stat(ino)), { code: 'OPERATION_RUNTIME_STALE' });
  }
});

test('Windows and other platforms retain positive-only inode admission', () => {
  for (const platform of ['win32', 'darwin', 'freebsd']) {
    const { ordinary } = guard(platform);
    for (const ino of [1n, 123456n, (1n << 64n) - 1n]) {
      assert.doesNotThrow(() => ordinary(stat(ino)));
    }
    for (const ino of [0n, -1n, MIN_SIGNED_INODE, MIN_SIGNED_INODE - 1n, 1, '1']) {
      assert.throws(() => ordinary(stat(ino)), { code: 'OPERATION_RUNTIME_STALE' });
    }
  }
});

test('signed identity acceptance does not relax ordinary-file or hardlink guards', () => {
  const { ordinary } = guard('linux');
  for (const overrides of [{ isFile: () => false }, { isSymbolicLink: () => true },
    { nlink: 0n }, { nlink: 2n }, { nlink: 1 }]) {
    assert.throws(() => ordinary(stat(-1n, overrides)), { code: 'OPERATION_RUNTIME_STALE' });
  }
});

test('raw identity stamps never normalize negative inodes to positive aliases', () => {
  const { stamp } = guard('linux');
  const negative = stamp(stat(-123n));
  assert.equal(negative.ino, '-123');
  assert.notEqual(JSON.stringify(negative), JSON.stringify(stamp(stat(123n))));
  assert.notEqual(JSON.stringify(negative), JSON.stringify(stamp(stat(-122n))));
  assert.notEqual(JSON.stringify(negative), JSON.stringify(stamp(stat((1n << 64n) - 123n))));
  assert.equal(JSON.stringify(negative), JSON.stringify(stamp(stat(-123n))));
});
