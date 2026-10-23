'use strict';

const path = require('node:path');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };

// Main supplies an enumerated source basename and a trusted profile suffix.
// These names describe a transform; they grant no source, omission or execution
// authority. Keep the encoder suffix last for historical-output recognition.
function encodeOutputName(sourceName, profileSuffix, transform = null) {
  if (typeof sourceName !== 'string' || !sourceName.length || /[\\/\x00-\x1f<>:"|?*]/.test(sourceName)
      || /[. ]$/.test(sourceName) || typeof profileSuffix !== 'string' || !/^[A-Za-z0-9-]{1,40}$/.test(profileSuffix)) {
    fail('INVALID_OUTPUT_NAME', 'The source basename or encoder suffix cannot form a safe output name.');
  }
  let descriptor = '';
  if (transform !== null) {
    const id = transform && Object.getOwnPropertyDescriptor(transform, 'transformId');
    if (!id || !Object.hasOwn(id, 'value') || typeof id.value !== 'string' || !/^[a-f0-9]{12}$/.test(id.value)) {
      fail('INVALID_OUTPUT_NAME', 'A resolved SDR transform needs its deterministic identifier.');
    }
    descriptor = `_SDR-${id.value}`;
  }
  const result = `${path.parse(sourceName).name}${descriptor}_${profileSuffix}.mkv`;
  if (transform !== null && result.length > 255) fail('OUTPUT_NAME_TOO_LONG', 'The derived output name exceeds the Windows filename limit. This file cannot be prepared with that name.');
  return result;
}

module.exports = { encodeOutputName };
