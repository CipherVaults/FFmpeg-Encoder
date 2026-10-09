'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { describeRecipe } = require('../src/media.cjs');
const lab = require('../scripts/benchmark-lab-config.cjs');

test('production anchors use authoritative recipe contributions without normalizing bit depth', () => {
  for (const [family, quality] of [['x265', 25], ['hevc-archive', 29]]) {
    const c = lab.configuration(family, quality);
    assert.deepEqual(c.args, describeRecipe(c.settings).args);
  }
  assert.ok(lab.configuration('x265', 25).args.includes('aq-mode=3:psy-rd=2'));
});
test('AV1 quality recipe never imports HEVC-specific B-frame overrides', () => {
  const c = lab.configuration('av1-quality', 30);
  assert.equal(c.args[c.args.indexOf('-tune:v:0') + 1], 'uhq');
  assert.ok(c.args.includes('fullres'));
  assert.ok(!c.args.includes('-bf:v:0') && !c.args.includes('-b_ref_mode:v:0'));
});
test('protected recipe windows and mandatory anchors survive finalist selection', () => {
  assert.deepEqual(lab.PAIRED_HELDOUT, ['cd', 'sf', 'desk']);
  assert.equal(lab.FAMILIES.find(f => f.id === 'hevc-archive').anchorQuality, 29);
  assert.equal(lab.pilotCases().length, 20);
  assert.equal(lab.MATRIX.candidateInvocationMaximum + lab.MATRIX.warmupSupportMaximum + lab.MATRIX.diagnosticRetryMaximum, lab.LIMITS.encodeInvocations);
});
test('configuration identity distinguishes deliberate disable from omitted preset inheritance', () => {
  const c = lab.configuration('hevc-archive', 29, { options: { '-multipass:v:0': 'disabled', '-tf_level:v:0': '0' } });
  assert.equal(c.args[c.args.indexOf('-multipass:v:0') + 1], 'disabled');
  assert.equal(c.args[c.args.indexOf('-tf_level:v:0') + 1], '0');
  assert.throws(() => lab.configuration('hevc-archive', 29, { options: { '-arbitrary': 'anything' } }));
});
