'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PROFILES, describeRecipe, buildEncodeArgs } = require('../src/media.cjs');

function defaultSettings(profile) {
  return { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default };
}

function argsFor(settings, pix_fmt = 'yuv420p') {
  return buildEncodeArgs({
    input: 'C:\\source media\\original.mkv', output: 'D:\\output media\\owned.partial', settings,
    probe: { streams: [{ index: 0, codec_type: 'video', pix_fmt, color_transfer: 'bt709' }] },
  });
}

function valueOf(args, flag) { return args[args.indexOf(flag) + 1]; }

test('six Tested Defaults expose the accepted preset, quality and every fixed encoder option', () => {
  const expected = [
    ['h264-cpu', 'slower', 24, ['-c:v:0', 'libx264', '-preset:v:0', 'slower', '-crf:v:0', '24']],
    ['h265-cpu', 'slow', 25, ['-c:v:0', 'libx265', '-preset:v:0', 'slow', '-crf:v:0', '25', '-x265-params', 'aq-mode=3:psy-rd=2']],
    ['av1-cpu', '6', 32, ['-c:v:0', 'libsvtav1', '-preset:v:0', '6', '-crf:v:0', '32']],
    ...[
      ['h264-nvidia', 'h264_nvenc', 28], ['h265-nvidia', 'hevc_nvenc', 25], ['av1-nvidia', 'av1_nvenc', 30],
    ].map(([id, encoder, quality]) => [id, 'p5', quality, [
      '-c:v:0', encoder, '-preset:v:0', 'p5', '-rc:v:0', 'vbr', '-cq:v:0', String(quality),
      '-b:v:0', '0', '-tune:v:0', 'hq',
    ]]),
  ];
  for (const [profileId, preset, quality, args] of expected) {
    const settings = { profileId, preset, quality };
    const recipe = describeRecipe(settings);
    assert.deepEqual(recipe.args, args);
    assert.deepEqual(recipe.testedDefault.settings, settings);
    assert.deepEqual(recipe.testedDefault.args, args);
    assert.equal(Object.hasOwn(recipe.testedDefault, 'testedDefault'), false);
  }
});

test('all exposed presets and quality boundaries display the exact production option values', () => {
  for (const profile of PROFILES) {
    for (const preset of profile.presets) {
      for (const quality of [profile.quality.min, profile.quality.default, profile.quality.max]) {
        const settings = { profileId: profile.id, preset, quality };
        const recipe = describeRecipe(settings);
        const actual = argsFor(settings);
        assert.deepEqual(recipe.settings, settings);
        assert.deepEqual(recipe.presetContribution, ['-preset:v:0', preset]);
        // Flags are matched against the full production argv, including the
        // stream mapping and disposition gap between codec and preset options.
        for (let index = 0; index < recipe.args.length; index += 2) {
          const flag = recipe.args[index];
          assert.equal(actual.filter((arg) => arg === flag).length, 1);
          assert.equal(valueOf(actual, flag), recipe.args[index + 1], `${profile.id} ${flag}`);
        }
        assert.equal(recipe.qualityMode, profile.quality.mode);
        assert.equal(recipe.backend, profile.hardware);
        assert.equal(recipe.encoder, profile.encoder);
        assert.deepEqual(recipe.testedDefault.settings, defaultSettings(profile));
      }
    }
  }
});

test('preparation alone resolves bit depth and NVIDIA hardware profile, with no fabricated recipe command', () => {
  const settings = { profileId: 'h265-nvidia', preset: 'p7', quality: 24 };
  const recipe = describeRecipe(settings);
  for (const flag of ['-pix_fmt:v:0', '-profile:v:0', '-color_trc:v:0', '-map', '-i']) {
    assert.equal(recipe.args.includes(flag), false, flag);
  }
  assert.match(recipe.mediaNote, /not a complete command/);
  const eight = argsFor(settings);
  const ten = argsFor(settings, 'yuv420p10le');
  assert.equal(valueOf(eight, '-profile:v:0'), 'main');
  assert.equal(valueOf(ten, '-profile:v:0'), 'main10');
  assert.equal(valueOf(eight, '-pix_fmt:v:0'), '+yuv420p');
  assert.equal(valueOf(ten, '-pix_fmt:v:0'), 'p010le');
});

test('recipe help distinguishes native presets, rate-control semantics and independently editable defaults', () => {
  const nv = describeRecipe({ profileId: 'h265-nvidia', preset: 'p7', quality: 24 });
  const cpu = describeRecipe({ profileId: 'h265-cpu', preset: 'fast', quality: 20 });
  const svt = describeRecipe({ profileId: 'av1-cpu', preset: '5', quality: 30 });
  assert.match(nv.presetHelp, /native NVENC preset only/);
  assert.match(nv.qualityHelp, /CQ and CPU CRF numbers are not quality-equivalent/);
  assert.match(cpu.presetHelp, /separate from CRF/);
  assert.match(svt.presetHelp, /Lower SVT-AV1/);
  assert.deepEqual(nv.settings, { profileId: 'h265-nvidia', preset: 'p7', quality: 24 });
  assert.deepEqual(nv.testedDefault.settings, { profileId: 'h265-nvidia', preset: 'p5', quality: 25 });
  nv.args.push('not authority');
  nv.testedDefault.settings.preset = 'p1';
  assert.equal(describeRecipe(nv.settings).args.includes('not authority'), false);
  assert.equal(describeRecipe(nv.settings).testedDefault.settings.preset, 'p5');
});

test('read-only recipe descriptions use the same strict settings boundary as execution', () => {
  for (const settings of [
    { profileId: 'h265-nvidia', preset: 'p7', quality: 24, args: ['-y'] },
    { profileId: 'h265-nvidia', preset: 'p7', quality: '24' },
    { profileId: 'h265-cpu', preset: 'p7', quality: 24 },
    { profileId: 'av1-cpu', preset: '10', quality: 32 },
  ]) assert.throws(() => describeRecipe(settings), { code: 'INVALID_SETTINGS' });
});
