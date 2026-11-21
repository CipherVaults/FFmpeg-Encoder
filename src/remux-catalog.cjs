'use strict';

// Reviewed finite source-owned routes, not generic codec-table permission.
// Exact reports are retained by run ID. Every new output still requires
// complete collection and independent validation.
// Verification method (record 47 Q2i/Q2o, sections 8-9): every route proves
// essence identity on compressed packets (packet-identity-v1), with compressed-
// domain admission, every NAL and slice header validated, and a bounded start
// and end decode. There is no fixed length or size ceiling. The interior is not
// decoded; complete-native-v1 remains only as internal code for a future route
// that changes packet bytes. Fresh evidence under this method: run c020cf60.
// Matroska->MP4 (record 47 Q2d) is video only: every audio stream must carry a
// current explicit omission, and its evidence is fresh run 838e1196 (VFR, CFR
// and B-frame sources under the 3fa87a3 complete-cadence validator).
// ISOBMFF->MOV (record 47 Q2e) admits only one H.264 video plus one 48 kHz
// stereo AAC-LC track, with no chapters: constant 30/60 fps (fresh run 7a7f87a2)
// or genuinely variable cadence up to 60 fps that stays variable on the output
// (record 47 Q2g, envelope v2, fresh run d252713e).
// MPEG-TS->MP4 (record 47 Q2j) admits one program, one progressive 8-bit 4:2:0
// BT.709 SDR H.264 video and zero or one 48 kHz mono/stereo AAC-LC ADTS track,
// with complete head framing, stable parameters/clocks and no extra streams.
// Source PTS/DTS and A/V offsets stay exact; Annex B/ADTS canonicalisation and
// bounded boundary decodes verify preservation without decoding the interior.
// Fresh run 1865c531 proves A/V, video-only, nonzero start, 20 minutes and the
// two-audio/cut-head refusals. All five earlier routes pass normal run 16477e14.
// Other MOV/TS shapes and HDR remain unqualified.
const { REGULAR_WINDOWS_PAIR } = require('./regular-windows-runtime.cjs');
const runtimeIdentity = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const REMUX_POLICIES = Object.freeze([
  { id: 'full-remux-mpegts-mp4-v1', inputFamily: 'mpegts', target: 'mp4', allowAncillary: false,
    sourceEnvelope: 'h264-adts-lc-48k-v1',
    evidenceIds: ['1865c531-2809-4170-870e-29f56dfc97a3:ts-mp4', '1865c531-2809-4170-870e-29f56dfc97a3:ts-video-mp4',
      '1865c531-2809-4170-870e-29f56dfc97a3:ts-offset-mp4', '1865c531-2809-4170-870e-29f56dfc97a3:ts-long-mp4',
      '1865c531-2809-4170-870e-29f56dfc97a3:ts-refused', '1865c531-2809-4170-870e-29f56dfc97a3:ts-refused-cut'] },
  { id: 'full-remux-isobmff-matroska-v1', inputFamily: 'isobmff', target: 'matroska', allowAncillary: false,
    evidenceIds: ['84349ace-ed8c-4a88-a852-9856df0adee4:E-mkv', 'a01184cc-cbf2-40ad-a475-559eb965109c:B-video-mkv',
      'd81cefc5-3b90-49b1-b2e7-5862d3052556:D-mkv', 'c020cf60-8664-483a-918c-e90d9b6dc35d:mp4-mkv'] },
  { id: 'full-remux-isobmff-mp4-v1', inputFamily: 'isobmff', target: 'mp4', allowAncillary: false,
    evidenceIds: ['1acb16cc-6616-434d-a1f8-8a465d436b44:E-mp4', 'b9ec1209-7d3b-4b2c-b4ff-e022fae611d4:A-mp4',
      'c020cf60-8664-483a-918c-e90d9b6dc35d:mp4-mp4', 'c020cf60-8664-483a-918c-e90d9b6dc35d:large-mp4', 'c020cf60-8664-483a-918c-e90d9b6dc35d:cancel-copy', 'c020cf60-8664-483a-918c-e90d9b6dc35d:cancel-verification'] },
  { id: 'full-remux-matroska-matroska-v1', inputFamily: 'matroska', target: 'matroska', allowAncillary: true,
    evidenceIds: ['7d838f1d-dc66-4e0e-8930-2298be77fc17:rich-mkv', '7d838f1d-dc66-4e0e-8930-2298be77fc17:timeline-mkv',
      'a01184cc-cbf2-40ad-a475-559eb965109c:lifecycle', 'c020cf60-8664-483a-918c-e90d9b6dc35d:mkv-mkv'] },
  { id: 'full-remux-matroska-mp4-v1', inputFamily: 'matroska', target: 'mp4', allowAncillary: false, audio: 'explicitly-omitted-only',
    evidenceIds: ['838e1196-80b3-43bf-8bbf-9de3bd4f965a:timeline-video-mp4', '838e1196-80b3-43bf-8bbf-9de3bd4f965a:cfr-video-mp4',
      '838e1196-80b3-43bf-8bbf-9de3bd4f965a:bframe-video-mp4', 'c020cf60-8664-483a-918c-e90d9b6dc35d:mkv-mp4', 'c020cf60-8664-483a-918c-e90d9b6dc35d:timeline-video-mp4',
      'c020cf60-8664-483a-918c-e90d9b6dc35d:cfr-video-mp4', 'c020cf60-8664-483a-918c-e90d9b6dc35d:bframe-video-mp4'] },
  { id: 'full-remux-isobmff-mov-v1', inputFamily: 'isobmff', target: 'mov', allowAncillary: false, sourceEnvelope: 'h264-aac-lc-48k-stereo-v2',
    evidenceIds: ['7a7f87a2-7eb9-4bc5-82d0-f119710e0fb3:mp4-a-mov', '7a7f87a2-7eb9-4bc5-82d0-f119710e0fb3:mov-b-mov',
      '7a7f87a2-7eb9-4bc5-82d0-f119710e0fb3:mp4-c-mov', 'd252713e-6629-4627-a176-1653355a3e23:vfr-mp4-mov',
      'd252713e-6629-4627-a176-1653355a3e23:vfr-mov-mov', 'd252713e-6629-4627-a176-1653355a3e23:cfr-mp4-mov',
      'c020cf60-8664-483a-918c-e90d9b6dc35d:mp4-mov', 'c020cf60-8664-483a-918c-e90d9b6dc35d:vfr-mp4-mov', 'c020cf60-8664-483a-918c-e90d9b6dc35d:vfr-mov-mov', 'c020cf60-8664-483a-918c-e90d9b6dc35d:cfr-mp4-mov'] },
].map(value => Object.freeze({ ...value, runtimeIdentity, allowRotation90: false, verificationMethod: 'packet-identity-v1', evidenceIds: Object.freeze(value.evidenceIds) })));
const REMUX_POLICY_ID = 'full-remux-v6:2026-11-14:packet-identity-transport';
// Fresh regular Windows qualification covers moving CFR H.264/AAC-LC and
// rejects a paired cut before the first IDR. The packet-identity collector
// and exact transport thresholds stay mandatory on every admitted file.
// Lab receipt SHA-256: 80d755b40cb8e0b8d2bd42fd3ba1af194793ce2463127d818edfe44dfa47a364
const REGULAR_WINDOWS_REMUX_POLICY_ID = 'full-remux-windows-9.1-v2:2026-11-21:transport-layer3';
const REGULAR_WINDOWS_REMUX_POLICIES = Object.freeze([Object.freeze({
  ...REMUX_POLICIES[0], id: 'full-remux-mpegts-mp4-windows-9.1-v1', runtimeIdentity: REGULAR_WINDOWS_PAIR,
  evidenceIds: Object.freeze(['6fe624a3-bb17-4e18-94b4-97ad2017515a:moving-h264-aac-ts-seek',
    '6fe624a3-bb17-4e18-94b4-97ad2017515a:mid-gop-refused']),
}), Object.freeze({
  // Regular Windows service lab SHA-256: 4981224cecee9cc093fa95b35554f28f13946d7f01a6c99c5b9c1f6b8cab460b
  id: 'full-remux-mp3-mp4-windows-9.1-v1', inputFamily: 'mp3', target: 'mp4',
  runtimeIdentity: REGULAR_WINDOWS_PAIR, allowAncillary: false, allowRotation90: false,
  sourceEnvelope: 'mpeg1-layer3-untagged-v1', verificationMethod: 'complete-native-v1',
  evidenceIds: Object.freeze(['883d570b-2d2f-43f6-a911-26873be841ef:three-exact-copies',
    '883d570b-2d2f-43f6-a911-26873be841ef:protected-lifecycle']),
})]);

module.exports = { REMUX_POLICIES, REMUX_POLICY_ID, REGULAR_WINDOWS_REMUX_POLICIES, REGULAR_WINDOWS_REMUX_POLICY_ID };
