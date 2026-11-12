'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Preferences, decodePreferences, defaultPreferences, PREFERENCES_NAMESPACE } = require('../src/preferences.cjs');
const { VendorPreferences, decodeVendorPreferences, VENDOR_PREFERENCES_NAMESPACE, VENDOR_PREFERENCES_FILE } = require('../src/vendor-preferences.cjs');
const { harness, settings } = require('./vendor-s34-fixtures.cjs');
const record = () => ({ namespace: VENDOR_PREFERENCES_NAMESPACE, version: 1,
  settingsByProfile: { 'h265-amd': { preset: 'balanced', quality: 24 } } });

test('vendor preference storage requires an absolute main-owned directory', () => {
  for (const directory of [null, 'relative', 1]) assert.throws(() => new VendorPreferences({ directory }), TypeError);
});

test('main v1/v2 accepts only a vendor selection; vendor setting keys remain schema errors', () => {
  for (const version of [1, 2]) {
    const main = { namespace: PREFERENCES_NAMESPACE, version, ...defaultPreferences(), profileId: 'h265-amd' };
    assert.equal(decodePreferences(main).data.profileId, 'h265-amd');
    main.settingsByProfile['h265-amd'] = { preset: 'balanced', quality: 24 };
    assert.throws(() => decodePreferences(main), /Unrecognized preference schema/);
  }
});

for (const [label, make] of [
  ['unknown version', () => ({ ...record(), version: 2 })],
  ['unknown namespace', () => ({ ...record(), namespace: 'localpreferences-v1' })],
  ['extra key', () => ({ ...record(), binding: 'PRIVATE' })],
  ['unknown id', () => ({ ...record(), settingsByProfile: { unknown: { preset: 'balanced', quality: 24 } } })],
  ['native id', () => ({ ...record(), settingsByProfile: { 'h265-amf': { preset: 'balanced', quality: 24 } } })],
  ['extra setting', () => ({ ...record(), settingsByProfile: { 'h265-amd': { preset: 'balanced', quality: 24, mode: 'cqp' } } })],
  ['map symbol', () => { const value = record(); value.settingsByProfile[Symbol('PRIVATE')] = 1; return value; }],
  ['accessor', () => { const value = record(); Object.defineProperty(value, 'version', { enumerable: true, get() { throw new Error('Getter ran'); } }); return value; }],
  ['map accessor', () => { const value = record(); Object.defineProperty(value.settingsByProfile, 'h265-amd', { enumerable: true, get() { throw new Error('Getter ran'); } }); return value; }],
  ['setting accessor', () => { const value = record(); Object.defineProperty(value.settingsByProfile['h265-amd'], 'preset', { enumerable: true, get() { throw new Error('Getter ran'); } }); return value; }],
  ['proxy', () => new Proxy(record(), { getPrototypeOf() { throw new Error('Trap ran'); } })],
]) test(`vendor preference decoder refuses ${label} without accepting forged data`, () => {
  assert.throws(() => decodeVendorPreferences(make()), error => !/Getter ran|Trap ran/.test(error.message));
});

test('vendor settings persist atomically in a separate namespace and leave ordinary tuples intact', async t => {
  const h = await harness(t), prefs = new Preferences({ directory: h.root });
  await prefs.saveSettings({ profileId: 'h265-cpu', preset: 'veryslow', quality: 23 });
  await prefs.saveSettings({ ...settings, quality: 21 });
  const main = JSON.parse(await fs.readFile(path.join(h.root, PREFERENCES_NAMESPACE, 'preferences.json')));
  assert.equal(main.version, 1); assert.equal(main.profileId, 'h265-amd');
  assert.equal(main.settingsByProfile['h265-amd'], undefined);
  assert.deepEqual(main.settingsByProfile['h265-cpu'], { preset: 'veryslow', quality: 23 });
  const directory = path.join(h.root, VENDOR_PREFERENCES_NAMESPACE), filename = path.join(directory, VENDOR_PREFERENCES_FILE);
  assert.deepEqual(await fs.readdir(directory), [VENDOR_PREFERENCES_FILE]);
  assert.deepEqual(decodeVendorPreferences(JSON.parse(await fs.readFile(filename))).settingsByProfile['h265-amd'], { preset: 'balanced', quality: 21 });
  const fresh = new Preferences({ directory: h.root }), loaded = await fresh.load();
  assert.equal(loaded.profileId, 'h265-amd'); assert.deepEqual(loaded.settingsByProfile['h265-amd'], { preset: 'balanced', quality: 21 });
  assert.equal((await fresh.resetProfile('h265-amd')).settingsByProfile['h265-amd'].quality, 24);
  await fresh.forget(); await assert.rejects(fs.stat(filename), { code: 'ENOENT' });
});

test('forged disk schema stays intact until explicit Forget, including a replacement after load', async t => {
  const h = await harness(t), prefs = new VendorPreferences({ directory: h.root });
  await prefs.saveSettings(settings);
  const forged = JSON.stringify({ ...record(), version: 99 }); await fs.writeFile(prefs.filename, forged);
  assert.ok((await prefs.saveSettings({ ...settings, quality: 20 })).notices.length);
  assert.equal(await fs.readFile(prefs.filename, 'utf8'), forged);
  const fresh = new VendorPreferences({ directory: h.root });
  assert.ok((await fresh.load()).notices.length);
  await fresh.saveSettings(settings); assert.equal(await fs.readFile(prefs.filename, 'utf8'), forged);
  await fresh.forget(); await fresh.saveSettings(settings); assert.equal((await new VendorPreferences({ directory: h.root }).load()).notices.length, 0);
});

test('hard-linked, oversized and redirected vendor preference storage is refused without changing its target', async t => {
  for (const mode of ['link', 'size', 'directory']) {
    const h = await harness(t), prefs = new VendorPreferences({ directory: h.root });
    await fs.mkdir(prefs.directory);
    const target = path.join(h.root, 'target.json'); await fs.writeFile(target, JSON.stringify(record()));
    if (mode === 'link') await fs.link(target, prefs.filename);
    else if (mode === 'size') await fs.writeFile(prefs.filename, ' '.repeat(256 * 1024 + 1));
    else { await fs.rmdir(prefs.directory); await fs.writeFile(prefs.directory, 'not a directory'); }
    const before = await fs.readFile(target);
    assert.ok((await prefs.load()).notices.length);
    await prefs.saveSettings(settings); assert.deepEqual(await fs.readFile(target), before);
    if (mode === 'link') await assert.rejects(prefs.forget(), /ordinary file/);
  }
});
module.exports = { record };
