'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { micros, count, SOURCES, campaign } = require('./workbench-long-range-calibration.cjs');
test('observed generated durations are parsed exactly without floating-point rounding', () => {
  assert.equal(micros('150.000000'), 150000000); assert.equal(micros('11'), 11000000);
  assert.equal(micros('0.000001'), 1); assert.equal(micros('1.013'), 1013000);
  for (const value of ['-1', 'NaN', '1.0000001', '1e6', '9007199254740992']) assert.throws(() => micros(value));
});
test('fixed campaigns retain the original geometry and isolate resize qualification', () => {
  const ordinary = campaign(), resize = campaign('resize1080to720');
  assert.equal(ordinary.width, 1280); assert.equal(ordinary.height, 720); assert.equal(ordinary.resolution, 'source');
  assert.equal(resize.width, 1920); assert.equal(resize.height, 1080); assert.equal(resize.resolution, '720');
  assert.notEqual(ordinary.familyId, resize.familyId); assert.notEqual(ordinary.resourcePolicy, resize.resourcePolicy);
  assert.notEqual(ordinary.label, resize.label); assert.notEqual(ordinary.derive, resize.derive);
  assert.ok(Object.isFrozen(ordinary) && Object.isFrozen(resize));
  assert.throws(() => campaign('../other'));
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

test('Full resize keeps null requests and independently counts a longer complete audio tail', () => {
  const { sourcesForCampaign, selectedCounts } = require('./workbench-long-range-calibration.cjs');
  const full = campaign('fullResize1080to720'), sources = sourcesForCampaign('fullResize1080to720');
  assert.equal(full.full, true); assert.equal(full.familyId, 'cfr-sdr-full-resize-flac-v1');
  assert.equal(full.resourcePolicy, 'cfr1080p30-full-to720p-flac-resources-v1');
  assert.notEqual(full.derive, campaign('resize1080to720').derive);
  assert.deepEqual(sources.map(s => s.cases[0].range), [null, null]);
  assert.deepEqual(selectedCounts(full, sources[0], null, 150000000), { frames: 4500, samples: 7200000 });
  assert.deepEqual(selectedCounts(full, sources[1], null, 43217000), { frames: 1293, samples: 2074416 });
  assert.throws(() => selectedCounts(full, sources[1], { startUs: 0 }, 43217000));
  sources[0].seconds = 1; assert.equal(sourcesForCampaign('fullResize1080to720')[0].seconds, 150);
  assert.equal(sourcesForCampaign('keep720')[0].cases[0].range.startUs, 100000000);
});

test('non-round fixture durations get a positive integer deadline without relaxing runner guards', () => {
  const { fixtureTimeoutMs } = require('./workbench-long-range-calibration.cjs');
  assert.equal(fixtureTimeoutMs(150, 1920, 1080), 1042500);
  assert.equal(fixtureTimeoutMs(43.217, 1920, 1080), 321715);
  assert.equal(fixtureTimeoutMs(11, 1280, 720), 63000);
  assert.throws(() => fixtureTimeoutMs(Infinity, 1920, 1080));
  assert.throws(() => fixtureTimeoutMs(1e9, 1920, 1080));
});


test('1440p Full calibration has a distinct fixed short matrix and independent audio-tail counts', () => {
  const { sourcesForCampaign, selectedCounts, fixtureTimeoutMs } = require('./workbench-long-range-calibration.cjs');
  const next = campaign('fullResize1440to720'), old = campaign('fullResize1080to720');
  assert.equal(next.width, 2560); assert.equal(next.height, 1440); assert.equal(next.resolution, '720');
  assert.equal(next.familyId, 'cfr-sdr-full-1440-to720-flac-v1');
  assert.equal(next.resourcePolicy, 'cfr1440p30-full-to720p-flac-resources-v1');
  assert.notEqual(next.derive, old.derive); assert.notEqual(next.label, old.label);
  const sources = sourcesForCampaign('fullResize1440to720');
  assert.deepEqual(sources.map(s => s.cases[0].range), [null, null]);
  assert.deepEqual(selectedCounts(next, sources[0], null, 12000000), { frames: 360, samples: 576000 });
  assert.deepEqual(selectedCounts(next, sources[1], null, 7217000), { frames: 213, samples: 346416 });
  assert.notEqual(sources[0].flip, sources[1].flip); assert.notEqual(sources[0].frequency, sources[1].frequency);
  assert.equal(fixtureTimeoutMs(7.217, 2560, 1440), 116604);
  sources[0].seconds = 500; assert.equal(sourcesForCampaign('fullResize1440to720')[0].seconds, 12);
  assert.equal(sourcesForCampaign('fullResize1080to720')[0].seconds, 150);
  assert.equal(campaign().width, 1280);
});
