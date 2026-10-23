'use strict';

// One reviewed owned-fixture campaign binds this exact runtime and raw code/UI
// ingress. Any pin failure remains nonexecutable; consent alone grants no route.
const { verifySourceCatalogSeals } = require('./source-catalog-seals.cjs');
const { ENCODE_PRESERVATION_PRODUCER_PATHS } = require('./encode-preservation-producers.cjs');
// The immutable lab report predates this catalog activation. Default-factory
// success/cancel receipts are additive; they never rewrite the fitting report.
const PRODUCERS = Object.freeze({
  "main.js": "a4e86ed97db88cc9c6f31a0ec4bbe1a606f3b977c794e410e801243133bcc515",
  "package.json": "b5678dc133c1e5fb8da250bfe828c9da55f50d89dac3728af1f0870693e69a82",
  "preload.js": "c7794718f3f33acee3f1e84c27e6d55c9e64062bc2e85c396387c39dc7a6a763",
  "resources/candidate-binary-manifest.json": "79ed7d063dc57480e065c86795dd14af11c179d9a377ef0fa0e47beab8339e3a",
  "src/candidate-runtime.cjs": "9566a7691feab7cb65f5c739a723f99c48833064aea2edfe8cf410cc5dc0d712",
  "src/diagnostics.cjs": "89f7506b549b31ecb0ad4d323619a95ecb28e5c6af0d619e97866932dbc4cf71",
  "src/encode-operation.cjs": "d78f98d00abb55c507c6996d0a0c064af757efdc4ee27929a80739c2a6ea5355",
  "src/encode-preservation-producers.cjs": "1f3b46a66cda83e174eafb23766be1b323e46f4b4fb73dffd323d638379cb7c1",
  "src/encode-preservation-workspace.cjs": "30031b818ca362ea71c79a4cab6b6038e3b29ecaa5bc8efef00ce5fa5017bda9",
  "src/encode-preservation.cjs": "7de7fde7f20544f6b8480ca14b275865694163d3ed5608891c91c2be7aaabab4",
  "src/encoder-service.cjs": "5d0ae49a26574bfc00214d8ae02a9f217633362bf9a7ac68a4302debc858e691",
  "src/inspection-cache.cjs": "a8df2a0b65a4c4117e1efb903710ff159335424d4f3645adb53b99b278e55de1",
  "src/inspection.cjs": "4c28fbb010bef08ea17a0a61dce4877c8d0bf1d6fa6acfa570576608e5f1983a",
  "src/ipc.cjs": "7afd3fa18fb32ff61e108d41cde874c06baf5e30e2e8742c86692f4669c45009",
  "src/local-protocol.cjs": "4bfd2c041224594d3f67e766e73bb692fc4345bc449193fdecc6b40dca1fc08b",
  "src/media-evidence.cjs": "102de80ca6e3e4509448e015d2012bed7025502584e2f934ae2dbe2dfad19502",
  "src/media.cjs": "4aaf7227e43b8ba10134fa1e34d15be7362eb5195d001eb1cfc629b66c677e66",
  "src/operation-contract.cjs": "dc01350dc18d1cbcdfd68f0b2c83cd43f7879d7eb8bc3b497d57a73d1eb1d0ba",
  "src/operation-controls.cjs": "bd0977641d5fe62b182a70e58d9f89a69f4af4564daeea0c616dcb066238f59f",
  "src/operation-draft.cjs": "9c4a25e65021be52bff887830a5cbdf5db07c03720be69b0352020437707251a",
  "src/operation-runtime.cjs": "004b626e311a8bfbde8eec437eeccbb939929124637dd9d950bfb4f0569a9c52",
  "src/output-access.cjs": "52e5ab6793ce5ea493fcc922d49dad3d25202cff50aaaca953a919bb5b1d8d0c",
  "src/outputs.cjs": "308ba5c1dca459bfa4c6615e970e7c3d61b85bc82eb9e162735d900f73d31a02",
  "src/process-runner.cjs": "9c9a6d0c1b541d8d6f044e8665dad7846f98b16a0975aaa0e19533a49ba2828f",
  "src/provenance.cjs": "7ab92ac9171359daa525cc1579d3fd6baaac4008e389af757216d73e2e78f3e4",
  "src/source-catalog-seals.cjs": "87bfdd9f0f72a3d3c124a3f1befc8fe07a26daa727c18ba1c2fd77573c9404e7",
  "src/source-identity.cjs": "fe6f73342936aa70ed6bbda98348da6fb892d05ddb566ee6d1664ba3f38e42bd",
  "src/storage-eligibility.cjs": "a03a88ed0820beb807719d0e92ddbd761932efa8a11e9891cc6893902f930196",
  "ui/index.html": "a7a46ad1d79a1849b5276ca3157f497232e917157b571357276c7683dfbf6515",
  "ui/renderer.js": "aced0feda9d495fb96c1eb1893172c7bfef1604741b77ac3a277ce50d1f3c159",
  "ui/styles.css": "de2385747a5e3909dc80e638674e031215c9e5f8db5523bd9a4b8a12b9ac2dd5"
});
const REPORT = '5f66a152788f7db1ae27801d0b7a49dbf2779d9156d3258c9ea9c7aab0d1e0a2';
const RUNTIME = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
function loadEncodePreservationPolicies() {
  return Object.freeze(typeof REPORT === 'string' && /^[a-f0-9]{64}$/.test(REPORT)
    && JSON.stringify(Object.keys(PRODUCERS).sort()) === JSON.stringify(ENCODE_PRESERVATION_PRODUCER_PATHS)
    && verifySourceCatalogSeals(PRODUCERS) ? [Object.freeze({
  id: 'full-encode-linked-tmcd-v1', sourceClass: 'mov-av1-main8-1080p60-bt709-aac48-stereo-linked-tmcd-v1',
  runtimeIdentity: RUNTIME, evidenceIds: Object.freeze(['full-encode-tmcd:sha256:' + REPORT]),
  })] : []);
}
const ENCODE_PRESERVATION_POLICIES = loadEncodePreservationPolicies();
const ENCODE_PRESERVATION_POLICY_ID = 'full-encode-tmcd-preservation-v1:sha256:' + REPORT;
module.exports = { ENCODE_PRESERVATION_POLICIES, ENCODE_PRESERVATION_POLICY_ID, loadEncodePreservationPolicies };
