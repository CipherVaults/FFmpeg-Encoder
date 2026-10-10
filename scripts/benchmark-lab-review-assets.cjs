'use strict';

// Pure asset plans only. The campaign runner owns execution, accounting,
// no-overwrite paths, source checks and manifests. This is not an app encoder.
const assert = require('node:assert/strict');
const lab = require('./benchmark-lab-config.cjs');

function supportArgs(source, window, output) {
  assert.equal(source.video.pix_fmt, 'yuv420p');
  assert.equal(source.video.color_space, 'bt709');
  assert.equal(source.video.color_range, 'tv');
  return ['-hide_banner', '-nostdin', '-n', '-loglevel', 'error', ...lab.selector(source, window).input,
    '-map', '0:v:0', '-an', '-sn', '-dn', '-vf', lab.selector(source, window).filter,
    '-c:v', 'ffv1', '-level', '3', '-g', '1', '-slicecrc', '1', '-pix_fmt', '+yuv420p',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
    '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-frames:v', String(window.frameCount),
    '-map_metadata', '-1', '-f', 'matroska', output];
}

function stillArgs(input, frameIndices, outputPattern) {
  assert.ok(frameIndices.length && frameIndices.every(n => Number.isInteger(n) && n >= 0));
  assert.equal(new Set(frameIndices).size, frameIndices.length);
  const select = frameIndices.map(n => `eq(n\\,${n})`).join('+');
  // All verified inputs are native 8-bit BT.709 limited-range 4:2:0. Convert
  // each identically to full-range RGB for display without resizing. PNG is a
  // display aid; the untouched video clips remain the motion/color authority.
  return ['-hide_banner', '-nostdin', '-n', '-v', 'error', '-i', input,
    '-vf', `select=${select},scale=iw:ih:in_range=tv:out_range=pc:in_color_matrix=bt709:out_color_matrix=bt709,format=rgb24`,
    '-fps_mode', 'passthrough', '-frames:v', String(frameIndices.length), '-start_number', '0', outputPattern];
}

function frameIndices(frameCount) {
  assert.ok(Number.isInteger(frameCount) && frameCount >= 6);
  return [...new Set([1 / 6, 1 / 2, 5 / 6].map(f => Math.floor(frameCount * f)))];
}

module.exports = { supportArgs, stillArgs, frameIndices };
