'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const media = require('../src/media.cjs');
const { VENDOR_PROFILES, validateVendorSettings, describeVendorRecipe } = require('../src/vendor-profiles.cjs');
const { resolveCatalogSettings, catalogProfile, describeCatalogRecipe, catalogCapability } = require('../src/encoder-catalog.cjs');
const defaults = profile => ({ profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default });

test('ordinary settings and recipe results are exactly the accepted media results at every control boundary', () => {
  for (const profile of media.PROFILES) for (const preset of profile.presets) {
    for (const quality of [profile.quality.min, profile.quality.default, profile.quality.max]) {
      const settings = { profileId: profile.id, preset, quality };
      assert.deepEqual(resolveCatalogSettings(settings), media.validateSettings(settings));
      assert.deepEqual(describeCatalogRecipe(settings), media.describeRecipe(settings));
    }
  }
  const archive = { profileId: media.ARCHIVE_RECIPE.profileId, preset: media.ARCHIVE_RECIPE.preset,
    quality: media.ARCHIVE_RECIPE.quality, recipeId: media.ARCHIVE_RECIPE.id };
  assert.deepEqual(resolveCatalogSettings(archive), media.validateSettings(archive));
  assert.deepEqual(describeCatalogRecipe(archive), media.describeRecipe(archive));
});

function outcome(fn) {
  try { return { value: fn() }; } catch (error) { return { name: error.name, code: error.code, message: error.message }; }
}
for (const [label, make] of [
  ['null', () => null], ['array', () => []], ['primitive', () => 4], ['missing fields', () => ({})],
  ['native id', () => ({ profileId: 'h265-amf', preset: 'balanced', quality: 24 })],
  ['unknown id', () => ({ profileId: '__proto__', preset: 'slow', quality: 25 })],
  ['unsupported ordinary preset', () => ({ profileId: 'h265-cpu', preset: 'balanced', quality: 25 })],
  ['invalid ordinary quality', () => ({ profileId: 'h265-cpu', preset: 'slow', quality: '25' })],
  ['extra key', () => ({ ...defaults(media.PROFILES[1]), deviceId: 'injected' })],
  ['symbol', () => ({ ...defaults(media.PROFILES[1]), [Symbol('extra')]: true })],
  ['ordinary recipe mismatch', () => ({ ...defaults(media.PROFILES[1]), recipeId: media.ARCHIVE_RECIPE.id })],
  ['null prototype', () => Object.assign(Object.create(null), defaults(media.PROFILES[1]))],
  ['ordinary accessor', () => ({ profileId: 'h265-cpu', preset: 'slow', get quality() { return 25; } })],
  ['ordinary proxy', () => new Proxy(defaults(media.PROFILES[1]), {})],
  ['throwing proxy', () => new Proxy({}, { getPrototypeOf() { throw new Error('sentinel'); } })],
]) test(`non-vendor ${label} retains media return values and errors`, () => {
  assert.deepEqual(outcome(() => resolveCatalogSettings(make())), outcome(() => media.validateSettings(make())));
  assert.deepEqual(outcome(() => describeCatalogRecipe(make())), outcome(() => media.describeRecipe(make())));
});

for (const profile of VENDOR_PROFILES) test(`${profile.id} resolves a default CPU twin and vendor description`, () => {
  const settings = defaults(profile), resolved = resolveCatalogSettings(settings), twin = catalogProfile(profile.twin);
  assert.deepEqual(resolved.settings, validateVendorSettings(settings));
  assert.equal(resolved.profile, profile);
  assert.deepEqual(resolved.twinSettings, defaults(twin));
  assert.deepEqual(describeCatalogRecipe(settings), describeVendorRecipe(settings));
  assert.equal(catalogProfile(profile.id), profile);
});

test('vendor extra keys, accessors, proxies and recipes fail without widening the settings tuple', () => {
  const settings = defaults(VENDOR_PROFILES[0]);
  for (const request of [{ ...settings, deviceId: '0' }, { ...settings, mode: 'cqp' },
    { ...settings, recipeId: media.ARCHIVE_RECIPE.id }, new Proxy(settings, {}),
    { ...settings, get preset() { assert.fail('vendor accessor executed'); } }]) {
    assert.throws(() => resolveCatalogSettings(request), { code: 'INVALID_SETTINGS' });
    assert.throws(() => describeCatalogRecipe(request), { code: 'INVALID_SETTINGS' });
  }
});
test('catalog lookup preserves row identity and keeps ordinary and vendor capability namespaces separate', () => {
  const ordinary = { id: 'h265-cpu', available: true }, vendor = { id: 'h265-amd', available: false };
  const caps = { profiles: [ordinary, { ...vendor, available: true }], vendorProfiles: [vendor, { ...ordinary, available: false }] };
  assert.equal(catalogCapability(caps, ordinary.id), ordinary);
  assert.equal(catalogCapability(caps, vendor.id), vendor);
  assert.equal(catalogCapability({ profiles: [vendor] }, vendor.id), undefined);
  for (const id of ['__proto__', 'h265-amf', 'h265-qsv', null, undefined]) {
    assert.equal(catalogProfile(id), undefined); assert.equal(catalogCapability(caps, id), undefined);
  }
  assert.equal(catalogCapability(null, vendor.id), undefined);
  for (const profile of media.PROFILES) assert.equal(catalogProfile(profile.id), profile);
});
