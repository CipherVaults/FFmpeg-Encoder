'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodeOutputName } = require('../src/operation-names.cjs');
const { PROFILES, ARCHIVE_RECIPE } = require('../src/media.cjs');
const { historicalSuffix } = require('../src/provenance.cjs');

test('ordinary CPU/NVIDIA names and Archive CQ29 remain the accepted encoder-suffix names', () => {
  for (const profile of PROFILES) {
    assert.equal(encodeOutputName('Scene.final.mp4', profile.suffix), `Scene.final_${profile.suffix}.mkv`);
  }
  assert.equal(ARCHIVE_RECIPE.quality, 29);
  const archive = PROFILES.find(profile => profile.id === ARCHIVE_RECIPE.profileId);
  assert.equal(encodeOutputName('Scene.mov', archive.suffix), 'Scene_H265-Nvidia-GPU.mkv');
});

test('a resolved SDR name is distinct, stable and retains historical generated-name recognition', () => {
  const transform = { transformId: '012345abcdef' };
  const actual = encodeOutputName('Scene.mp4', 'H265-CPU', transform);
  assert.equal(actual, 'Scene_SDR-012345abcdef_H265-CPU.mkv');
  assert.equal(historicalSuffix(actual), 'H265-CPU');
  assert.notEqual(actual, encodeOutputName('Scene.mp4', 'H265-CPU'));
  assert.equal(actual, encodeOutputName('Scene.mp4', 'H265-CPU', { ...transform, ignoredDisplayOnly: 'not an authority' }));
  assert.notEqual(actual, encodeOutputName('Scene.mp4', 'H265-CPU', { transformId: '112345abcdef' }));
});

test('names preserve Unicode/spaces and existing SDR text without sanitizing or numbered alternatives', () => {
  assert.equal(encodeOutputName('مشهد one_SDR-old.mov', 'H265-CPU', { transformId: 'abcdef012345' }),
    'مشهد one_SDR-old_SDR-abcdef012345_H265-CPU.mkv');
  assert.equal(encodeOutputName('Scene.mov', 'H265-CPU', { transformId: 'abcdef012345' }).toLowerCase(),
    encodeOutputName('scene.mp4', 'H265-CPU', { transformId: 'abcdef012345' }).toLowerCase());
});

test('unsafe components, unresolved IDs, accessors and overlong transformed names fail before filesystem use', () => {
  for (const name of ['../Scene.mp4', 'folder\\Scene.mp4', 'D:Scene.mp4', 'Scene\n.mp4', 'Scene.mp4 ']) {
    assert.throws(() => encodeOutputName(name, 'H265-CPU'), { code: 'INVALID_OUTPUT_NAME' });
  }
  for (const value of [{}, { transformId: 'ABCDEF012345' }, { transformId: '../output' },
    Object.defineProperty({}, 'transformId', { get() { throw new Error('Do not evaluate an accessor'); } })]) {
    assert.throws(() => encodeOutputName('Scene.mp4', 'H265-CPU', value), { code: 'INVALID_OUTPUT_NAME' });
  }
  assert.throws(() => encodeOutputName('x'.repeat(240) + '.mp4', 'H265-CPU', { transformId: 'abcdef012345' }),
    { code: 'OUTPUT_NAME_TOO_LONG' });
});
