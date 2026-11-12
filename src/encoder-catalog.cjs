'use strict';

const { types } = require('node:util');
const { PROFILES, validateSettings, describeRecipe } = require('./media.cjs');
const { VENDOR_PROFILES, validateVendorSettings, describeVendorRecipe } = require('./vendor-profiles.cjs');

function vendorProfile(request) {
  // Look only at an inert data field for dispatch. Everything else retains the
  // accepted validator's return values and errors, including ordinary proxies.
  if (!request || typeof request !== 'object' || types.isProxy(request)) return undefined;
  const field = Object.getOwnPropertyDescriptor(request, 'profileId');
  return field && Object.hasOwn(field, 'value') ? VENDOR_PROFILES.find(row => row.id === field.value) : undefined;
}
function resolveCatalogSettings(request) {
  const profile = vendorProfile(request);
  if (!profile) return validateSettings(request);
  const settings = validateVendorSettings(request), twin = PROFILES.find(row => row.id === profile.twin);
  return { settings, profile, twinSettings: { profileId: twin.id, preset: twin.defaultPreset, quality: twin.quality.default } };
}
function catalogProfile(id) { return VENDOR_PROFILES.find(row => row.id === id) || PROFILES.find(row => row.id === id); }
function describeCatalogRecipe(request) { return vendorProfile(request) ? describeVendorRecipe(request) : describeRecipe(request); }
function catalogCapability(caps, id) {
  return (VENDOR_PROFILES.some(row => row.id === id) ? caps?.vendorProfiles : caps?.profiles)?.find(row => row.id === id);
}

module.exports = { resolveCatalogSettings, catalogProfile, describeCatalogRecipe, catalogCapability };
