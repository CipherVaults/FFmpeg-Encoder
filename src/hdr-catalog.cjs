'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { verifyHdrCatalogSeals } = require('./hdr-catalog-seals.cjs');

// Four independently reviewed fitting cases qualify only these complete native
// configurations under the pinned implementation/runtime. Picture bytes are
// not a membership list. Every source still needs complete fresh, private
// acquisition and its own full identity/SHA through protected publication.
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const REPORT = '95c1de9288ac6a6aa78fb4aa6878c5971c9eeb96c1675bcc2fa43774c6ca34bc';
const PRODUCERS = '6b68e709d2147c17c14228531e0927650f6e2c385e27d7c5c137768eaebe7984';
// Explicit reviewed presentation-only amendment; historical media campaigns remain
// exact prior evidence. No media/control/validation/publication path changed.
const APPEARANCE_REVIEW = '765edb5ba5d1a461e2eac12b4f8f117e218bee69a00f3269c1d6f1af75f23316';
const CONFIGURATIONS = 'd3bc7baaa80a99ac8f8a03ad0a4d53d508beea7f722f1f9b93f3462aa9b0df28';
const freeze = value => { if (value && typeof value === 'object') { for (const item of Object.values(value)) freeze(item); Object.freeze(value); } return value; };
function policies() {
  try {
    if (!verifyHdrCatalogSeals(PRODUCERS)) return [];
    const file = path.join(__dirname, '../resources/hdr-content-configurations.json');
    if (fs.statSync(file).size > 65536) return [];
    const bytes = fs.readFileSync(file);
    if (createHash('sha256').update(bytes).digest('hex') !== CONFIGURATIONS) return [];
    const parsed = JSON.parse(bytes);
    if (parsed.schema !== 1 || !Array.isArray(parsed.profiles) || parsed.profiles.length !== 10) return [];
    return ['smpte2084','arib-std-b67'].map(transfer => ({
      id: 'content-cpu-hdr-' + transfer + '-v1', transfer, runtimeIdentity: RUNTIME,
      evidenceIds: ['content-hdr-service:e2585ab6-1bc0-422a-ab2c-3209f194920e:sha256:' + REPORT,
        'appearance-only-reviewed-delta:b977fece-ee12-491b-af54-e5eb7017ff69:sha256:' + APPEARANCE_REVIEW],
      profiles: parsed.profiles.filter(p => p.role === 'source' && p.transfer === transfer).map(({role,...profile}) => profile),
      outputProfiles: parsed.profiles.filter(p => p.role === 'output' && p.transfer === transfer).map(({role,...profile}) => profile),
    }));
  } catch { return []; }
}
const HDR_POLICIES = freeze(policies());
const HDR_POLICY_ID = 'content-cpu-hdr-v1:e2585ab6-1bc0-422a-ab2c-3209f194920e:sha256:' + REPORT;
module.exports = { HDR_POLICIES, HDR_POLICY_ID };
