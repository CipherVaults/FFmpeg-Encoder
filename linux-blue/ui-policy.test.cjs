'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { acceptCpuSettings, cpuChoices } = require('./ui-policy.cjs');
const { PROFILES, validateSettings } = require('../src/media.cjs');
const request = () => ({ profileId: 'h264-cpu', preset: 'slower', quality: 24 });
test('all three CPU defaults preserve production validation and detach caller state', () => {
  for (const item of cpuChoices()) {
    const input = { profileId: item.id, preset: item.defaultPreset, quality: item.quality.default };
    const accepted = acceptCpuSettings(input);
    assert.deepEqual(accepted, validateSettings(input));
    input.quality = -1;
    assert(Object.isFrozen(accepted));
    assert.equal(accepted.quality, item.quality.default);
  }
});
test('main policy rejects every GPU profile, unknown profile and Archive recipe', () => {
  for (const profile of PROFILES.filter(item => item.hardware !== 'CPU')) {
    assert.throws(() => acceptCpuSettings({ ...request(), profileId: profile.id }), { code: 'LINUX_UI_SETTINGS' });
  }
  assert.throws(() => acceptCpuSettings({ ...request(), profileId: 'unknown' }), { code: 'LINUX_UI_SETTINGS' });
  assert.throws(() => acceptCpuSettings({ ...request(), recipeId: 'archive-quality-hevc-v1' }), { code: 'LINUX_UI_SETTINGS' });
});
test('renderer cannot submit paths, tools, probe evidence or process options', () => {
  for (const key of ['input', 'output', 'ffmpeg', 'args', 'probe', 'colorEvidence', 'signal', 'timeoutMs', '__proto__']) {
    const value = request(); Object.defineProperty(value, key, { value: '/untrusted' });
    assert.throws(() => acceptCpuSettings(value), { code: 'LINUX_UI_SETTINGS' });
  }
});
test('malformed DTOs and accessor side effects refuse', () => {
  for (const value of [null, [], 'CPU', {}, Object.create(request()), { ...request(), [Symbol('extra')]: 1 }]) {
    assert.throws(() => acceptCpuSettings(value), { code: 'LINUX_UI_SETTINGS' });
  }
  let touched = false;
  const value = { ...request(), get quality() { touched = true; return 24; } };
  assert.throws(() => acceptCpuSettings(value), { code: 'LINUX_UI_SETTINGS' }); assert.equal(touched, false);
});
test('preset and quality bounds remain the production validator responsibility', () => {
  for (const changed of [{ quality: -1 }, { quality: 52 }, { quality: 1.2 }, { quality: '24' }, { preset: 'unknown' }]) {
    assert.throws(() => acceptCpuSettings({ ...request(), ...changed }), { code: 'INVALID_SETTINGS' });
  }
});
test('choices are independent copies, CPU only and explicitly unqualified', () => {
  const choices = cpuChoices();
  assert.deepEqual(choices.map(item => item.id), ['h264-cpu', 'h265-cpu', 'av1-cpu']);
  assert(choices.every(item => item.experimental && !item.qualified));
  choices[0].presets.length = 0; choices[0].quality.default = -1;
  assert(cpuChoices()[0].presets.length > 0); assert.equal(cpuChoices()[0].quality.default, 24);
});

test('Proxy cannot swap an allowed CPU profile for a GPU during admission', () => {
  let reads = 0;
  const value = new Proxy({ profileId: 'h264-nvidia', preset: 'p5', quality: 28 }, {
    get(target, key) {
      if (key === 'profileId') return ++reads === 1 ? 'h264-cpu' : 'h264-nvidia';
      return Reflect.get(target, key);
    }
  });
  assert.throws(() => acceptCpuSettings(value), { code: 'LINUX_UI_SETTINGS' });
  assert.equal(reads, 0);
});
test('each data descriptor is captured once and admitted output uses that snapshot', () => {
  const reads = new Map();
  const value = new Proxy(request(), {
    getOwnPropertyDescriptor(target, key) {
      reads.set(key, (reads.get(key) || 0) + 1);
      return Reflect.getOwnPropertyDescriptor(target, key);
    },
    get() { throw new Error('must not reread caller properties'); }
  });
  assert.deepEqual(acceptCpuSettings(value), request());
  assert.deepEqual([...reads], [['profileId', 1], ['preset', 1], ['quality', 1]]);
});
test('null-prototype DTO is accepted and retains non-default CPU settings', () => {
  const value = Object.assign(Object.create(null), { profileId: 'h265-cpu', preset: 'fast', quality: 17 });
  assert.deepEqual(acceptCpuSettings(value), { profileId: 'h265-cpu', preset: 'fast', quality: 17 });
});
test('every CPU profile preserves its boundaries and rejects wrong types', () => {
  for (const profile of cpuChoices()) {
    const base = { profileId: profile.id, preset: profile.presets[0], quality: profile.quality.min };
    for (const quality of [profile.quality.min, profile.quality.max]) {
      assert.deepEqual(acceptCpuSettings({ ...base, quality }), { ...base, quality });
    }
    for (const quality of [profile.quality.min - 1, profile.quality.max + 1, NaN, Infinity, 1.5, '24', null, {}, true]) {
      assert.throws(() => acceptCpuSettings({ ...base, quality }), { code: 'INVALID_SETTINGS' });
    }
    for (const preset of [null, 6, {}, true]) {
      assert.throws(() => acceptCpuSettings({ ...base, preset }), { code: 'INVALID_SETTINGS' });
    }
    for (const profileId of [null, 1, {}, true]) {
      assert.throws(() => acceptCpuSettings({ ...base, profileId }), { code: 'LINUX_UI_SETTINGS' });
    }
  }
});
