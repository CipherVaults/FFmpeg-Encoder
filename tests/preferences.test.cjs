'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { Preferences, defaultPreferences, PREFERENCES_NAMESPACE, PREFERENCES_FILE, MAX_PREFERENCES_BYTES } = require('../src/preferences.cjs');
const { PROFILES, ARCHIVE_RECIPE } = require('../src/media.cjs');
const parent = path.resolve(__dirname, '../artifacts/preferences-tests');
const settings = { profileId: 'h265-cpu', preset: 'veryslow', quality: 23 };

async function fixture(t) {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'run-'));
  t.after(async () => {
    const actual = await fs.realpath(root);
    if (!actual.startsWith((await fs.realpath(parent)) + path.sep) || !path.basename(actual).startsWith('run-')) throw new Error('Unsafe fixture cleanup.');
    await fs.rm(actual, { recursive: true });
  });
  const directory = path.join(root, PREFERENCES_NAMESPACE);
  const filename = path.join(directory, PREFERENCES_FILE);
  const write = async record => {
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(filename, typeof record === 'string' ? record : JSON.stringify(record));
  };
  const record = () => ({ namespace: PREFERENCES_NAMESPACE, version: 1, ...defaultPreferences() });
  return { root, directory, filename, write, record, open: () => new Preferences({ directory: root }) };
}

test('absent preferences use exact profile defaults and do not create any directory', async t => {
  const h = await fixture(t);
  assert.deepEqual(await h.open().load(), { ...defaultPreferences(), notices: [] });
  assert.deepEqual(await fs.readdir(h.root), []);
  assert.deepEqual(Object.values(defaultPreferences().settingsByProfile), PROFILES.map(p => ({ preset: p.defaultPreset, quality: p.quality.default })));
});

test('bounded atomic settings survive restart independently per profile and never include tokens', async t => {
  const h = await fixture(t);
  const prefs = h.open();
  await prefs.rememberFolder('input', h.root);
  await prefs.saveSettings(settings);
  await prefs.saveSettings({ profileId: 'h265-nvidia', preset: 'p6', quality: 23 });
  const restored = await h.open().load();
  assert.equal(restored.inputPath, h.root);
  assert.equal(restored.profileId, 'h265-nvidia');
  assert.deepEqual(restored.settingsByProfile['h265-cpu'], { preset: 'veryslow', quality: 23 });
  assert.deepEqual(restored.settingsByProfile['h265-nvidia'], { preset: 'p6', quality: 23 });
  assert.deepEqual(await fs.readdir(h.directory), [PREFERENCES_FILE]);
  const disk = JSON.parse(await fs.readFile(h.filename));
  assert.deepEqual(Object.keys(disk), ['namespace', 'version', 'inputPath', 'outputPath', 'profileId', 'settingsByProfile']);
  assert.ok((await fs.stat(h.filename)).size < MAX_PREFERENCES_BYTES);
});

test('invalid disk values use tested defaults with explanations while valid profiles remain intact', async t => {
  const h = await fixture(t);
  const record = h.record();
  Object.assign(record, { inputPath: '../not-authority', outputPath: '\u0000bad', profileId: 'unknown' });
  record.settingsByProfile['h264-cpu'] = { preset: 'bogus', quality: 500 };
  record.settingsByProfile['av1-cpu'] = { preset: '6', quality: 0 };
  record.settingsByProfile['h265-cpu'] = { preset: 'veryslow', quality: 23 };
  delete record.settingsByProfile['av1-nvidia'];
  await h.write(record);
  const restored = await h.open().load();
  assert.equal(restored.inputPath, null);
  assert.equal(restored.outputPath, null);
  assert.equal(restored.profileId, 'h265-cpu');
  assert.deepEqual(restored.settingsByProfile['h264-cpu'], { preset: 'slower', quality: 24 });
  assert.deepEqual(restored.settingsByProfile['av1-cpu'], { preset: '6', quality: 32 });
  assert.deepEqual(restored.settingsByProfile['h265-cpu'], { preset: 'veryslow', quality: 23 });
  assert.deepEqual(restored.settingsByProfile['av1-nvidia'], { preset: 'p5', quality: 30 });
  assert.equal(restored.notices.length, 6);
});

test('renderer-style invalid settings are rejected rather than normalized or persisted', async t => {
  const h = await fixture(t);
  const prefs = h.open();
  await prefs.load();
  for (const request of [null, [], { ...settings, arbitraryPath: h.root }, { ...settings, profileId: 'amd' },
    { ...settings, quality: '23' }, { ...settings, quality: Infinity }, { ...settings, preset: 'p6' }]) {
    assert.throws(() => prefs.saveSettings(request), { code: 'INVALID_SETTINGS' });
  }
  assert.deepEqual(await fs.readdir(h.root), []);
});

test('unknown and malformed schemas remain byte-for-byte intact until explicit Forget', async t => {
  const h = await fixture(t);
  for (const record of [{ ...h.record(), version: 22 }, { ...h.record(), authority: { id: 'fake', path: h.root } },
    { ...h.record(), settingsByProfile: { '__proto__': { polluted: true }, unknown: {} } }, '{truncated', ' '.repeat(MAX_PREFERENCES_BYTES + 1)]) {
    await h.write(record);
    const bytes = await fs.readFile(h.filename);
    const prefs = h.open();
    assert.ok((await prefs.load()).notices.some(n => /preserved/.test(n)));
    assert.equal((await prefs.saveSettings(settings)).settingsByProfile['h265-cpu'].quality, 23);
    await prefs.resetProfile('h265-cpu');
    assert.deepEqual(await fs.readFile(h.filename), bytes);
    await prefs.forget();
    await assert.rejects(fs.stat(h.filename), { code: 'ENOENT' });
    await prefs.saveSettings(settings);
    assert.equal((await h.open().load()).settingsByProfile['h265-cpu'].quality, 23);
  }
});

test('an unknown schema introduced after load is preserved rather than overwritten', async t => {
  const h = await fixture(t);
  const prefs = h.open();
  await prefs.saveSettings(settings);
  await h.write({ ...h.record(), version: 99 });
  const before = await fs.readFile(h.filename);
  const value = await prefs.resetProfile('h265-cpu');
  assert.ok(value.notices.some(n => /preserved/.test(n)));
  assert.deepEqual(await fs.readFile(h.filename), before);
});

test('reset affects only the named profile; Forget deletes only its exact file', async t => {
  const h = await fixture(t);
  const prefs = h.open();
  await prefs.rememberFolder('input', h.root);
  await prefs.saveSettings(settings);
  await prefs.saveSettings({ profileId: 'h264-nvidia', preset: 'p7', quality: 17 });
  const reset = await prefs.resetProfile('h265-cpu');
  assert.equal(reset.inputPath, h.root);
  assert.deepEqual(reset.settingsByProfile['h265-cpu'], { preset: 'slow', quality: 25 });
  assert.deepEqual(reset.settingsByProfile['h264-nvidia'], { preset: 'p7', quality: 17 });
  const files = ['media.mkv', 'cache/inspection-v1/record.json', 'provenance-v1/intent.json', `${PREFERENCES_NAMESPACE}/unrelated.txt`];
  for (const file of files) { await fs.mkdir(path.dirname(path.join(h.root, file)), { recursive: true }); await fs.writeFile(path.join(h.root, file), file); }
  assert.deepEqual(await prefs.forget(), { ...defaultPreferences(), notices: [] });
  for (const file of files) assert.equal(await fs.readFile(path.join(h.root, file), 'utf8'), file);
});

test('linked preference files fail closed without modifying the link target', async t => {
  const h = await fixture(t);
  const target = path.join(h.root, 'unrelated.json');
  await fs.writeFile(target, JSON.stringify(h.record()));
  await fs.mkdir(h.directory);
  await fs.link(target, h.filename);
  const prefs = h.open();
  const before = await fs.readFile(target);
  assert.ok((await prefs.load()).notices.length);
  await prefs.saveSettings(settings);
  await assert.rejects(prefs.forget(), /ordinary file/);
  assert.deepEqual(await fs.readFile(target), before);
});

test('failed preference writes preserve the valid session settings and give a bounded explanation', async t => {
  const h = await fixture(t);
  await fs.writeFile(h.directory, 'not a directory');
  const prefs = h.open();
  const value = await prefs.saveSettings(settings);
  assert.equal(value.settingsByProfile['h265-cpu'].quality, 23);
  assert.ok(value.notices.length);
  assert.equal(await fs.readFile(h.directory, 'utf8'), 'not a directory');
});

test('reading v1 preferences never enables Archive Quality or rewrites the saved file', async t => {
  const h = await fixture(t);
  const record = h.record();
  record.profileId = 'h265-nvidia';
  record.settingsByProfile['h265-nvidia'] = { preset: 'p7', quality: 24 };
  await h.write(record);
  const before = await fs.readFile(h.filename);
  const restored = await h.open().load();
  assert.deepEqual(restored.settingsByProfile['h265-nvidia'], { preset: 'p7', quality: 24 });
  assert.equal(restored.notices.length, 0);
  assert.deepEqual(await fs.readFile(h.filename), before);
});

test('Archive Quality v2 settings retain manual edits across restart and profile switching', async t => {
  const h = await fixture(t);
  const prefs = h.open();
  await prefs.rememberFolder('input', h.root);
  const archive = { profileId: 'h265-nvidia', preset: 'p6', quality: 23, recipeId: ARCHIVE_RECIPE.id };
  await prefs.saveSettings(archive);
  await prefs.saveSettings(settings);
  const disk = JSON.parse(await fs.readFile(h.filename));
  assert.equal(disk.version, 2);
  assert.deepEqual(disk.settingsByProfile['h265-nvidia'], { preset: 'p6', quality: 23, recipeId: ARCHIVE_RECIPE.id });
  assert.equal(Object.hasOwn(disk.settingsByProfile['h265-cpu'], 'recipeId'), false);
  const restored = await h.open().load();
  assert.equal(restored.profileId, settings.profileId);
  assert.equal(restored.inputPath, h.root);
  assert.deepEqual(restored.settingsByProfile['h265-nvidia'], disk.settingsByProfile['h265-nvidia']);
  assert.deepEqual(restored.settingsByProfile['h265-cpu'], { preset: 'veryslow', quality: 23 });
  assert.equal(restored.notices.length, 0);
});

test('Tested Default explicitly removes only that profile recipe and restores ordinary v1 persistence', async t => {
  const h = await fixture(t);
  const prefs = h.open();
  await prefs.saveSettings(settings);
  await prefs.saveSettings({ profileId: ARCHIVE_RECIPE.profileId, preset: ARCHIVE_RECIPE.preset,
    quality: ARCHIVE_RECIPE.quality, recipeId: ARCHIVE_RECIPE.id });
  const otherReset = await prefs.resetProfile('h264-cpu');
  assert.equal(otherReset.settingsByProfile['h265-nvidia'].recipeId, ARCHIVE_RECIPE.id);
  assert.equal(JSON.parse(await fs.readFile(h.filename)).version, 2);
  const reset = await prefs.resetProfile('h265-nvidia');
  assert.deepEqual(reset.settingsByProfile['h265-nvidia'], { preset: 'p5', quality: 25 });
  assert.deepEqual(reset.settingsByProfile['h265-cpu'], { preset: 'veryslow', quality: 23 });
  assert.equal(JSON.parse(await fs.readFile(h.filename)).version, 1);
  assert.deepEqual((await h.open().load()).settingsByProfile['h265-nvidia'], { preset: 'p5', quality: 25 });
});

test('unknown, wrong-profile and arbitrary recipe requests are rejected without changing persisted settings', async t => {
  const h = await fixture(t);
  const prefs = h.open();
  const archive = { profileId: 'h265-nvidia', preset: 'p7', quality: 24, recipeId: ARCHIVE_RECIPE.id };
  await prefs.saveSettings(archive);
  const before = await fs.readFile(h.filename);
  for (const invalid of [{ ...archive, recipeId: 'unknown-future' }, { ...archive, recipeId: null },
    { ...settings, recipeId: ARCHIVE_RECIPE.id }, { ...archive, profileId: 'av1-nvidia' },
    { ...archive, extraOptions: ['-y'] }, { ...archive, recipeId: { args: ['-y'] } }]) {
    assert.throws(() => prefs.saveSettings(invalid), { code: 'INVALID_SETTINGS' });
  }
  assert.deepEqual(await fs.readFile(h.filename), before);
  assert.equal(prefs.snapshot().settingsByProfile['h265-nvidia'].recipeId, ARCHIVE_RECIPE.id);
});

test('unknown recipe data from disk degrades with notice and grants no recipe state or write on read', async t => {
  const h = await fixture(t);
  for (const version of [1, 2]) {
    const record = { ...h.record(), version, profileId: 'h265-nvidia' };
    record.settingsByProfile['h265-nvidia'] = { preset: 'p7', quality: 24,
      recipeId: version === 1 ? ARCHIVE_RECIPE.id : 'unknown-future' };
    await h.write(record);
    const before = await fs.readFile(h.filename);
    const restored = await h.open().load();
    assert.deepEqual(restored.settingsByProfile['h265-nvidia'], { preset: 'p5', quality: 25 });
    assert.ok(restored.notices.some(notice => /H265.*NVIDIA.*invalid.*using Tested Default/.test(notice)));
    assert.deepEqual(await fs.readFile(h.filename), before);
  }
});
