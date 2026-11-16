'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { micros, count, SOURCES } = require('./workbench-long-range-calibration.cjs');
test('observed generated durations are parsed exactly without floating-point rounding', () => {
  assert.equal(micros('150.000000'), 150000000); assert.equal(micros('11'), 11000000);
  assert.equal(micros('0.000001'), 1); assert.equal(micros('1.013'), 1013000);
  for (const value of ['-1', 'NaN', '1.0000001', '1e6', '9007199254740992']) assert.throws(() => micros(value));
});
test('independent half-open source count arithmetic covers aligned and nonaligned ranges', () => {
  assert.equal(count(100000000, 140000000, 30), 1200);
  assert.equal(count(130000000, 150000000, 30), 600);
  assert.equal(count(1013000, 3087000, 30), 62);
  assert.equal(count(413000, 8621000, 48000), 393984);
});
test('campaign crosses both legacy duration ceilings and uses an independently generated held-out pattern', () => {
  assert.ok(SOURCES[0].seconds > 120);
  assert.ok(SOURCES[0].cases[0].range.endUs - SOURCES[0].cases[0].range.startUs > 30000000);
  assert.equal(SOURCES[0].cases[1].range.endUs, undefined);
  assert.notEqual(SOURCES[0].flip, SOURCES[1].flip); assert.notEqual(SOURCES[0].frequency, SOURCES[1].frequency);
});
