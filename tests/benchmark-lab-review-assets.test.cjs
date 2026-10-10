'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const assets = require('../scripts/benchmark-lab-review-assets.cjs');

test('native lossless source review plan keeps verified selector, frames and time base', () => {
  const source = { stagedPath: 'staged.mp4', video: { pix_fmt: 'yuv420p', color_space: 'bt709', color_range: 'tv' } };
  const argv = assets.supportArgs(source, { start: 95, end: 107, frameCount: 719 }, 'source.mkv');
  assert.ok(argv.includes('trim=start=95:end=107,setpts=PTS-STARTPTS'));
  assert.equal(argv[argv.indexOf('-frames:v') + 1], '719');
  assert.equal(argv[argv.indexOf('-enc_time_base') + 1], 'demux');
  assert.equal(argv[argv.indexOf('-pix_fmt') + 1], '+yuv420p');
  assert.ok(argv.includes('-n') && argv.includes('ffv1'));
  assert.throws(() => assets.supportArgs({ ...source, video: { ...source.video, pix_fmt: 'yuv420p10le' } }, { frameCount: 719 }, 'x'));
});

test('still plan samples identical presentation indices and does not resize or force CFR', () => {
  const indices = assets.frameIndices(719); assert.deepEqual(indices, [119, 359, 599]);
  const argv = assets.stillArgs('input.mkv', indices, 'frame-%d.png');
  assert.ok(argv.includes('select=eq(n\\,119)+eq(n\\,359)+eq(n\\,599),scale=iw:ih:in_range=tv:out_range=pc:in_color_matrix=bt709:out_color_matrix=bt709,format=rgb24'));
  assert.ok(!argv.includes('-r')); assert.equal(argv[argv.indexOf('-fps_mode') + 1], 'passthrough');
  assert.throws(() => assets.stillArgs('x', [3, 3], 'y'));
});
