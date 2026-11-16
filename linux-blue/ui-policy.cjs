'use strict';
// Main-process policy only. Not registered as IPC and not a filesystem service.
// Input must be a structured-cloned DTO; arbitrary Proxy reflection traps can
// execute caller code. This function is not a sandbox for executable objects.
// A future Electron composition must validate sender identity and obtain paths,
// probe evidence, storage leases and output publication authority in main.
const { PROFILES, validateSettings } = require('../src/media.cjs');
const IDS = Object.freeze(['h264-cpu', 'h265-cpu', 'av1-cpu']);
const refuse = () => Object.assign(new Error('Linux experiment accepts CPU settings only; no recipes, paths, tools or execution options.'), { code: 'LINUX_UI_SETTINGS' });

function acceptCpuSettings(request) {
  if (!request || ![Object.prototype, null].includes(Object.getPrototypeOf(request))) throw refuse();
  const keys = Reflect.ownKeys(request);
  if (keys.length !== 3 || !['profileId', 'preset', 'quality'].every(key => keys.includes(key))) throw refuse();
  // Capture data descriptors once. Never reread request properties after the
  // allowlist check: even an in-process Proxy cannot switch the copied profile.
  const captured = {};
  for (const key of ['profileId', 'preset', 'quality']) {
    const descriptor = Object.getOwnPropertyDescriptor(request, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw refuse();
    captured[key] = descriptor.value;
  }
  const snapshot = Object.freeze(captured);
  if (!IDS.includes(snapshot.profileId)) throw refuse();
  return Object.freeze(validateSettings(snapshot));
}

function cpuChoices() {
  // Advertised choices are not capability/qualification claims. Copy nested
  // fields so renderer consumption cannot mutate the production profile table.
  return IDS.map(id => {
    const profile = PROFILES.find(item => item.id === id);
    return { id, label: profile.label, presets: [...profile.presets],
      defaultPreset: profile.defaultPreset, quality: { ...profile.quality },
      experimental: true, qualified: false };
  });
}
module.exports = { acceptCpuSettings, cpuChoices };
