'use strict';

// Reviewed finite source-owned routes, not generic codec-table permission.
// Exact reports: artifacts/v0.7/slice3/service/<UUID>/report.json. Every new
// output still requires complete native collection and independent validation.
// Matroska->MP4 (record 47 Q2d) is video only: every audio stream must carry a
// current explicit omission, and its evidence is fresh run 838e1196 (VFR, CFR
// and B-frame sources under the 3fa87a3 complete-cadence validator).
// MOV, TS and HDR remain unqualified.
const runtimeIdentity = '56006c748ed2ee641597cd57e0874c11a86e52e6f634879afc503adb943f99d6';
const REMUX_POLICIES = Object.freeze([
  { id: 'full-remux-isobmff-matroska-v1', inputFamily: 'isobmff', target: 'matroska', allowAncillary: false,
    evidenceIds: ['84349ace-ed8c-4a88-a852-9856df0adee4:E-mkv', 'a01184cc-cbf2-40ad-a475-559eb965109c:B-video-mkv',
      'd81cefc5-3b90-49b1-b2e7-5862d3052556:D-mkv'] },
  { id: 'full-remux-isobmff-mp4-v1', inputFamily: 'isobmff', target: 'mp4', allowAncillary: false,
    evidenceIds: ['1acb16cc-6616-434d-a1f8-8a465d436b44:E-mp4', 'b9ec1209-7d3b-4b2c-b4ff-e022fae611d4:A-mp4'] },
  { id: 'full-remux-matroska-matroska-v1', inputFamily: 'matroska', target: 'matroska', allowAncillary: true,
    evidenceIds: ['7d838f1d-dc66-4e0e-8930-2298be77fc17:rich-mkv', '7d838f1d-dc66-4e0e-8930-2298be77fc17:timeline-mkv',
      'a01184cc-cbf2-40ad-a475-559eb965109c:lifecycle'] },
  { id: 'full-remux-matroska-mp4-v1', inputFamily: 'matroska', target: 'mp4', allowAncillary: false, audio: 'explicitly-omitted-only',
    evidenceIds: ['838e1196-80b3-43bf-8bbf-9de3bd4f965a:timeline-video-mp4', '838e1196-80b3-43bf-8bbf-9de3bd4f965a:cfr-video-mp4',
      '838e1196-80b3-43bf-8bbf-9de3bd4f965a:bframe-video-mp4'] },
].map(value => Object.freeze({ ...value, runtimeIdentity, allowRotation90: false, evidenceIds: Object.freeze(value.evidenceIds) })));
const REMUX_POLICY_ID = 'full-remux-v2:2026-11-13:four-routes';
module.exports = { REMUX_POLICIES, REMUX_POLICY_ID };
