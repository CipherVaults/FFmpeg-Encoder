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

test('reduced B allocation retains every mandatory anchor and protects recipe challenges', () => {
  const selections = [{ familyId: 'svt', selectedQuality: 34 }, { familyId: 'hevc-ordinary', selectedQuality: 29 },
    { familyId: 'av1-ordinary', selectedQuality: 36 }, { familyId: 'av1-quality', selectedQuality: 36 }];
  const cases = lab.reducedGeneralization(selections); assert.equal(cases.length, 23);
  for (const source of lab.SOURCES) for (const [family, quality] of [['x265', 25], ['hevc-archive', 29]])
    assert.ok(cases.some(c => c.window.id === `${source.id}-b` && c.config.familyId === family && c.config.settings.quality === quality));
  for (const source of lab.PAIRED_HELDOUT) for (const family of ['hevc-ordinary', 'av1-ordinary', 'av1-quality'])
    assert.ok(cases.some(c => c.window.id === `${source}-b` && c.config.familyId === family));
  assert.equal(lab.refinementCases('cd-challenges').length, 4);
  assert.ok(lab.refinementCases('cd-challenges').every(c => c.window.id === 'cd-b'));
  assert.equal(lab.refinementCases('av1-fh').length + lab.refinementCases('av1-rest').length, 8);
  assert.ok(lab.refinementCases('av1-rest').every(c => c.config.settings.quality === 32 && c.window.role === 'a'));
  assert.equal(lab.refinementCases('av1-b').length, 6);
  assert.ok(lab.refinementCases('av1-b').every(c => c.config.settings.quality === 32 && c.window.role === 'b'));
});

test('calibration review uses only six A/B scenes and retains anchors and both recipe arms', () => {
  const groups = lab.calibrationReview(); assert.equal(groups.length, 6);
  for (const group of groups) {
    assert.ok(['a', 'b'].includes(group.role));
    assert.ok(group.configurations.some(c => c.familyId === 'x265' && c.settings.quality === 25));
    assert.ok(group.configurations.some(c => c.familyId === 'hevc-archive' && c.settings.quality === 29));
    assert.ok(group.configurations.length + 1 <= 9, 'Keep one scene within nine accessible choices.');
  }
  assert.ok(!groups.find(g => g.sourceId === 'sf').configurations.some(c => c.familyId === 'svt'));
});

test('pending human judgment blocks all encode/search phases before ownership or accounting starts', () => {
  for (const phase of ['pilot', 'coarse', 'generalize', 'refine', 'bootstrap', 'prepare-pilot'])
    assert.throws(() => lab.assertHumanGate(phase, 'awaiting-calibration-judgment'), /judgment is pending/);
  for (const phase of ['status', 'checks', 'forecast', 'allocate-review', 'review'])
    assert.doesNotThrow(() => lab.assertHumanGate(phase, 'awaiting-calibration-judgment'));
  assert.doesNotThrow(() => lab.assertHumanGate('refine', 'not-ready'));
});
