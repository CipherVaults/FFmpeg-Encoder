'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveHdrContract, HDR_CONTRACT_VERSION, HDR_TRANSFORM_VERSION } = require('../src/hdr-contract.cjs');
const { buildMediaEvidence } = require('../src/media-evidence.cjs');

const known = value => ({ state: 'known', value });
const unknown = reason => ({ state: 'unknown', reason: reason || 'not-reported' });
const mastering = () => ({ side_data_type: 'Mastering display metadata', red_x: '34000/50000', red_y: '16000/50000',
  green_x: '13250/50000', green_y: '34500/50000', blue_x: '7500/50000', blue_y: '3000/50000',
  white_point_x: '15635/50000', white_point_y: '16450/50000', min_luminance: '1/10000', max_luminance: '1000/1' });
const light = (maximum = 1000, average = 400) => ({ side_data_type: 'Content light level metadata', max_content: maximum, max_average: average });
const ambient = () => ({ side_data_type: 'Ambient viewing environment', ambient_illuminance: '314/1', ambient_light_x: '15635/50000', ambient_light_y: '16450/50000' });
const dolby = () => ({ side_data_type: 'DOVI configuration record', dv_version_major: 1, dv_version_minor: 0, dv_profile: 8, dv_level: 10,
  rpu_present_flag: 1, el_present_flag: 0, bl_present_flag: 1, dv_bl_signal_compatibility_id: 4, dv_md_compression: 'none' });
function video(transfer = 'smpte2084', sideData = []) {
  return buildMediaEvidence({ format: {}, streams: [{ index: 0, codec_type: 'video', codec_name: 'hevc', profile: 'Main 10',
    width: 3840, height: 2160, pix_fmt: 'yuv420p10le', field_order: 'progressive', color_transfer: transfer,
    color_primaries: 'bt2020', color_space: 'bt2020nc', color_range: 'tv', side_data_list: sideData }] }).streams[0];
}
const request = (policy = 'preserve', videoEvidence = video(), extra = {}) => ({ policy, videoEvidence, outputCodec: 'h265', ...extra });
const result = (policy, evidence, extra) => resolveHdrContract(request(policy, evidence, extra));
const graph = contract => [...contract.filterContribution.beforeScale, ...contract.filterContribution.afterScale].join(',');

test('coherent ten-bit BT2020 SDR keeps the existing no-filter path, without inferring HDR from depth', () => {
  const evidence = video('bt2020-10');
  const output = result('preserve', evidence);
  assert.equal(output.version, HDR_CONTRACT_VERSION); assert.equal(output.route, 'existing-sdr');
  assert.equal(output.expectedOutput.label, 'SDR'); assert.equal(output.filterContribution, null);
  assert.equal(output.expectedOutput.primaries, 'bt2020'); assert.equal(output.expectedOutput.bitDepthPolicy, 'existing-profile-builder');
  assert.equal(output.executable, false); assert.equal(output.ancillaryStreamAuthority, 'none');
  assert.deepEqual(output, result('preserve', evidence));
  assert.equal(result('sdr', evidence).filterContribution, null);
});

test('the existing accepted frame-derived SDR decision can supply missing stream transfer only for the same video', () => {
  const evidence = video('bt709'); evidence.color.transfer = unknown(); evidence.color.primaries = unknown();
  const colorDecision = { classification: 'sdr', supported: true, reasons: ['coherent frame sample'], transfer: 'bt709', videoIndex: 0 };
  assert.equal(result('preserve', evidence, { colorDecision }).expectedOutput.transfer, 'bt709');
  assert.equal(result('preserve', evidence, { colorDecision }).expectedOutput.primaries, null);
  assert.throws(() => result('preserve', evidence), { code: 'HDR_EVIDENCE_UNRESOLVED' });
  assert.throws(() => result('preserve', evidence, { colorDecision: { ...colorDecision, videoIndex: 1 } }), { code: 'HDR_EVIDENCE_CONFLICT' });
  assert.throws(() => result('preserve', evidence, { colorDecision: { ...colorDecision, supported: false } }), { code: 'HDR_EVIDENCE_UNRESOLVED' });
  evidence.color.transfer = known('smpte2084');
  assert.throws(() => result('preserve', evidence, { colorDecision }), { code: 'HDR_EVIDENCE_CONFLICT' });
});

test('missing or contradictory color evidence cannot be repaired by naming a desired HDR operation', () => {
  for (const field of ['transfer', 'primaries', 'matrix', 'range', 'pixelFormat']) {
    const evidence = video(); evidence.color[field] = unknown();
    assert.throws(() => result('preserve', evidence), error => ['HDR_EVIDENCE_UNRESOLVED', 'HDR_SIGNAL_UNSUPPORTED'].includes(error.code));
  }
  assert.throws(() => result('preserve', video(), { colorDecision: { classification: 'ambiguous', supported: false, transfer: 'smpte2084', videoIndex: 0 } }), { code: 'HDR_EVIDENCE_UNRESOLVED' });
  assert.throws(() => result('sdr', video('bt709', [mastering()])), { code: 'HDR_EVIDENCE_CONFLICT' });
  assert.throws(() => result('preserve', video('linear')), { code: 'HDR_TRANSFER_UNSUPPORTED' });
});

test('PQ preserve retains exact rational static metadata as writer requirements without fabricating an HDR10 claim', () => {
  const evidence = video('smpte2084', [mastering(), light()]);
  const output = result('preserve', evidence);
  assert.equal(output.route, 'pq-preserve'); assert.equal(output.filterContribution, null);
  assert.equal(output.expectedOutput.transfer, 'smpte2084'); assert.equal(output.expectedOutput.bitDepth, 10);
  assert.equal(output.expectedOutput.hdr10Claim, false); assert.equal(output.expectedOutput.label, 'PQ HDR');
  assert.deepEqual(output.metadataDisposition.retained, ['mastering', 'contentLight']);
  assert.deepEqual(output.metadataDisposition.values.mastering.min_luminance, { numerator: '1', denominator: '10000' });
  assert.equal(output.metadataDisposition.values.contentLight.max_content.value, 1000);
  assert.ok(output.qualificationRequirements.includes('backend-static-and-ambient-metadata-writers'));
  assert.equal(output.status, 'descriptive-unqualified-contract');
  evidence.hdr.entries[0].fields.min_luminance.value.numerator = '9';
  assert.equal(output.metadataDisposition.values.mastering.min_luminance.numerator, '1');
  assert.throws(() => { output.expectedOutput.transfer = 'bt709'; }, TypeError);
});

test('HLG preserve remains HLG, keeps observed ambient metadata pending writer qualification and never silently becomes SDR', () => {
  const output = result('preserve', video('arib-std-b67', [ambient()]));
  assert.equal(output.route, 'hlg-preserve'); assert.equal(output.expectedOutput.label, 'HLG HDR');
  assert.equal(output.expectedOutput.transfer, 'arib-std-b67'); assert.equal(output.filterContribution, null);
  assert.deepEqual(output.metadataDisposition.retained, ['ambient']);
  assert.ok(output.qualificationRequirements.includes('hdr-display-judgment-not-yet-verified'));
});

test('initial HDR retention cannot silently select H264, AV1 or 8-bit output', () => {
  for (const extra of [{ outputCodec: 'h264' }, { outputCodec: 'av1' }, { outputBitDepth: 8 }]) {
    assert.throws(() => result('preserve', video(), extra), { code: 'HDR_OUTPUT_UNSUPPORTED' });
  }
  for (const fieldOrder of ['tt', 'bb', 'tb', 'bt', 'unknown']) {
    const evidence = video(); evidence.geometry.fieldOrder = known(fieldOrder);
    assert.throws(() => result('sdr', evidence), { code: 'HDR_SCAN_UNSUPPORTED' });
  }
  for (const [field, value] of [['range', 'pc'], ['matrix', 'bt2020c'], ['pixelFormat', 'yuv422p10le'], ['pixelFormat', 'yuv420p'], ['primaries', 'smpte432']]) {
    const evidence = video(); evidence.color[field] = known(value);
    assert.throws(() => result('preserve', evidence), { code: 'HDR_SIGNAL_UNSUPPORTED' });
  }
});

test('unreported scan mode stays unknown with a source qualification requirement, never guessed from HEVC or cadence', () => {
  const evidence = video('arib-std-b67', [dolby()]); evidence.geometry.fieldOrder = unknown();
  const output = result('hlg-base', evidence);
  assert.equal(output.source.scanMode, null); assert.equal(output.executable, false);
  assert.ok(output.qualificationRequirements.includes('source-progressive-scan-evidence-required'));
  evidence.geometry.fieldOrder = { state: 'malformed', reason: 'invalid-text' };
  assert.throws(() => result('hlg-base', evidence), { code: 'HDR_EVIDENCE_UNRESOLVED' });
});

test('malformed, incomplete, duplicate or contradictory static metadata fails with a specific reason', () => {
  const missing = mastering(); delete missing.red_x;
  const inverted = mastering(); inverted.min_luminance = '1001/1';
  const impossible = mastering(); impossible.blue_x = '2/1';
  for (const entry of [missing, inverted, impossible, light(500, 700)]) {
    assert.throws(() => result('preserve', video('smpte2084', [entry])), { code: 'HDR_METADATA_INVALID' });
    assert.throws(() => result('sdr', video('smpte2084', [entry])), { code: 'HDR_METADATA_INVALID' });
  }
  assert.throws(() => result('preserve', video('smpte2084', [mastering(), mastering()])), { code: 'HDR_METADATA_AMBIGUOUS' });
});

test('zero CLL is retained as explicitly unspecified and cannot become a measured zero-nit peak', () => {
  const evidence = video('smpte2084', [light(0, 0)]);
  const preserve = result('preserve', evidence);
  assert.deepEqual(preserve.metadataDisposition.values.contentLight.max_content, { value: null, signalValue: 0, reason: 'unspecified-zero-light-level' });
  const sdr = result('sdr', evidence);
  assert.equal(sdr.filterContribution.interpretation.sourcePeakBasis, 'assumed-1000nit-pq-source-peak');
  assert.match(graph(sdr), /tonemap=tonemap=hable:desat=2:peak=10,/);
});

test('PQ SDR uses real linear-float transformation, explicit MaxCLL normalization and declared gamut limitations', () => {
  const output = result('sdr', video('smpte2084', [mastering(), light(4000, 300)]));
  assert.equal(output.route, 'pq-to-sdr'); assert.equal(output.filterContribution.version, HDR_TRANSFORM_VERSION);
  assert.equal(output.expectedOutput.transfer, 'bt709'); assert.equal(output.expectedOutput.primaries, 'bt709');
  assert.equal(output.expectedOutput.matrix, 'bt709'); assert.equal(output.expectedOutput.range, 'tv');
  assert.equal(output.expectedOutput.bitDepth, 10);
  assert.match(graph(output), /tin=smpte2084.*t=linear.*npl=100:agamma=0/);
  assert.match(graph(output), /format=gbrpf32le/); assert.match(graph(output), /tonemap=tonemap=hable:desat=2:peak=40/);
  assert.match(graph(output), /dither=error_diffusion/);
  assert.equal(output.filterContribution.interpretation.sourcePeakBasis, 'reported-maxcll');
  assert.equal(output.filterContribution.interpretation.clippingQualificationRequired, true);
  assert.equal(output.filterContribution.scaleInsertion, 'optional-qualified-downscale-in-linear-float-bt709');
  assert.deepEqual(output.metadataDisposition.removed, ['mastering', 'contentLight']);
  assert.ok(output.qualificationRequirements.includes('linear-float-and-luminance-numeric-fixtures'));
});

test('PQ without CLL declares an assumed peak and does not substitute the mastering display peak', () => {
  const display = mastering(); display.max_luminance = '4000/1';
  const output = result('sdr', video('smpte2084', [display]));
  assert.equal(output.filterContribution.interpretation.sourcePeakNits, 1000);
  assert.equal(output.filterContribution.interpretation.sourcePeakBasis, 'assumed-1000nit-pq-source-peak');
  assert.equal(output.filterContribution.interpretation.sourcePeakMeasuredByApplication, false);
  assert.throws(() => result('sdr', video('smpte2084', [light(10001, 400)])), { code: 'HDR_PEAK_UNSUPPORTED' });
});

test('HLG SDR explicitly declares its reference-display interpretation, gamma and normalized peak', () => {
  const output = result('sdr', video('arib-std-b67'));
  assert.equal(output.route, 'hlg-to-sdr'); assert.match(graph(output), /tin=arib-std-b67/);
  assert.equal(output.filterContribution.interpretation.hlgSystemGamma, 1.2);
  assert.equal(output.filterContribution.interpretation.sourcePeakNits, 1000);
  assert.equal(output.filterContribution.interpretation.nominalSdrNits, 100);
  assert.equal(output.filterContribution.interpretation.sourcePeakBasis, 'assumed-1000nit-hlg-reference-display');
  assert.match(graph(output), /tonemap=tonemap=hable:desat=2:peak=10/);
  assert.doesNotMatch(graph(output), /gamma=1\.2|peak=1000/);
});

test('SDR conversion output depths are codec-specific, not a universal hidden 8-bit conversion', () => {
  assert.equal(result('sdr', video(), { outputCodec: 'h264' }).expectedOutput.bitDepth, 8);
  assert.match(graph(result('sdr', video(), { outputCodec: 'h264' })), /format=yuv420p,/);
  assert.equal(result('sdr', video(), { outputCodec: 'av1' }).expectedOutput.bitDepth, 10);
  assert.equal(result('sdr', video(), { outputBitDepth: 8 }).expectedOutput.bitDepth, 8);
  assert.throws(() => result('sdr', video(), { outputCodec: 'h264', outputBitDepth: 10 }), { code: 'HDR_OUTPUT_UNSUPPORTED' });
});

test('SDR filters remove only specifically obsolete HDR side data, never every side-data record or ancillary stream', () => {
  const output = result('sdr', video());
  const cleanup = output.filterContribution.afterScale.filter(value => value.startsWith('sidedata='));
  assert.ok(cleanup.includes('sidedata=mode=delete:type=MASTERING_DISPLAY_METADATA'));
  assert.ok(cleanup.includes('sidedata=mode=delete:type=DOVI_METADATA'));
  assert.equal(cleanup.length, 7);
  assert.ok(cleanup.every(value => !/DISPLAYMATRIX|TIMECODE|delete$|type=-1/.test(value)));
  assert.equal(output.ancillaryStreamAuthority, 'none');
});

test('recognized Dolby is never silently accepted by ordinary preserve', () => {
  assert.throws(() => result('preserve', video('arib-std-b67', [dolby()])), { code: 'HDR_DOLBY_CHOICE_REQUIRED' });
  for (const policy of ['hlg-base', 'dolby-pq']) {
    assert.throws(() => result(policy, video('arib-std-b67')), { code: 'HDR_POLICY_NOT_APPLICABLE' });
    assert.throws(() => result(policy, video('bt709')), { code: 'HDR_POLICY_NOT_APPLICABLE' });
  }
});

test('explicit compatible HLG-base use keeps HLG pixels and exposes removal of Dolby metadata', () => {
  const output = result('hlg-base', video('arib-std-b67', [dolby(), ambient()]));
  assert.equal(output.route, 'dolby84-hlg-base'); assert.equal(output.expectedOutput.transfer, 'arib-std-b67');
  assert.equal(output.expectedOutput.dolbyVision, false); assert.equal(output.metadataDisposition.dolby, 'discarded-without-rpu-application');
  assert.deepEqual(output.metadataDisposition.retained, ['ambient']); assert.deepEqual(output.metadataDisposition.removed, ['dolby']);
  assert.deepEqual(output.filterContribution.beforeScale, []);
  assert.deepEqual(output.filterContribution.afterScale, ['sidedata=mode=delete:type=DOVI_RPU_BUFFER', 'sidedata=mode=delete:type=DOVI_METADATA']);
  assert.equal(output.metadataDisposition.validateAbsentDolbyConfiguration, true);
  assert.ok(output.warnings.some(value => value.includes('not applied or retained')));
});

test('Dolby SDR requires a narrow additional base-layer decision, which this module cannot authorize', () => {
  const output = result('sdr', video('arib-std-b67', [dolby()]));
  assert.equal(output.route, 'dolby84-hlg-base-to-sdr'); assert.equal(output.expectedOutput.label, 'SDR');
  assert.equal(output.metadataDisposition.dolby, 'discarded-without-rpu-application');
  assert.equal(output.decisionRequirements.length, 1);
  assert.equal(output.decisionRequirements[0].kind, 'dolby-hlg-base-to-sdr');
  assert.equal(output.decisionRequirements[0].scope, 'exact-source-and-draft');
  assert.equal(output.decisionRequirements[0].authority, 'unbound'); assert.equal(output.executable, false);
  assert.throws(() => result('sdr', video('arib-std-b67', [dolby()]), { approved: true }), { code: 'INVALID_HDR_REQUEST' });
});

test('Dolby-aware PQ specifies supported fixed libplacebo options and keeps RPU/target/display qualification pending', () => {
  const output = result('dolby-pq', video('arib-std-b67', [dolby(), ambient()]));
  assert.equal(output.route, 'dolby84-aware-pq'); assert.equal(output.expectedOutput.label, 'PQ HDR');
  assert.equal(output.expectedOutput.transfer, 'smpte2084'); assert.equal(output.expectedOutput.hdr10Claim, false);
  assert.equal(output.expectedOutput.dolbyVision, false); assert.equal(output.metadataDisposition.dolby, 'applied-not-retained');
  assert.deepEqual(output.metadataDisposition.retained, []); assert.deepEqual(output.metadataDisposition.removed, ['ambient', 'dolby']);
  assert.equal(output.metadataDisposition.replacementStaticMetadata, 'none-fabricated');
  assert.match(graph(output), /apply_dolbyvision=1/); assert.match(graph(output), /color_trc=smpte2084/);
  assert.match(graph(output), /peak_detect=0/); assert.match(graph(output), /contrast_recovery=0/);
  assert.match(graph(output), /deband=0:frame_mixer=none:deinterlace=weave:send_fields=0/);
  assert.doesNotMatch(graph(output), /target_peak|fps=|custom_shader|extra_opts|hwupload|h=|w=/);
  assert.equal(output.filterContribution.interpretation.targetPeakNits, null);
  for (const required of ['decoded-rpu-reaches-filter', 'pq-target-interpretation', 'dolby-on-off-controlled-comparison', 'vulkan-device-and-frame-path']) assert.ok(output.qualificationRequirements.includes(required));
});

test('Dolby profile/compatibility/layer/version contradictions are unsupported rather than ignored', () => {
  for (const [key, value] of [['dv_profile', 5], ['dv_profile', 7], ['dv_bl_signal_compatibility_id', 1], ['bl_present_flag', 0], ['el_present_flag', 1], ['rpu_present_flag', 0], ['dv_version_major', 2], ['dv_version_minor', 1]]) {
    const entry = dolby(); entry[key] = value;
    for (const policy of ['hlg-base', 'dolby-pq', 'sdr']) assert.throws(() => result(policy, video('arib-std-b67', [entry])), { code: 'HDR_DOLBY_UNSUPPORTED' });
  }
  const entry = dolby(); delete entry.rpu_present_flag;
  assert.throws(() => result('hlg-base', video('arib-std-b67', [entry])), { code: 'HDR_METADATA_INVALID' });
  assert.throws(() => result('dolby-pq', video('smpte2084', [dolby()])), { code: 'HDR_DOLBY_UNSUPPORTED' });
});

test('unqualified dynamic formats cannot acquire a generic ignore-metadata fallback', () => {
  for (const type of ['HDR Dynamic Metadata SMPTE2094-40 (HDR10+)', 'Dolby Vision RPU Data', 'HDR Vivid Dynamic Metadata']) {
    for (const policy of ['preserve', 'sdr']) {
      assert.throws(() => result(policy, video('smpte2084', [{ side_data_type: type }])), { code: 'HDR_DYNAMIC_METADATA_UNSUPPORTED' });
    }
  }
});

test('policy input cannot submit filters, paths, arbitrary peak/options or guessed codec aliases', () => {
  for (const extra of [{ rawFilter: 'movie=C:/private' }, { shader: 'file' }, { targetPeak: 2000 }, { outputCodec: 'hevc' },
    { outputCodec: 'H265' }, { outputBitDepth: '10' }, { outputBitDepth: NaN }, { target: 'mpegts' }]) {
    assert.throws(() => result('sdr', video(), extra), { code: 'INVALID_HDR_REQUEST' });
  }
  let read = false;
  const options = request(); Object.defineProperty(options, 'rawFilter', { enumerable: true, get() { read = true; return 'bad'; } });
  assert.throws(() => resolveHdrContract(options), { code: 'INVALID_HDR_REQUEST' }); assert.equal(read, false);
});

test('typed source data is snapshotted with bounds, rejecting accessor execution, cycles and injected filter text', () => {
  let read = false;
  const evidence = video(); Object.defineProperty(evidence.color, 'transfer', { enumerable: true, get() { read = true; return known('smpte2084'); } });
  assert.throws(() => result('sdr', evidence), { code: 'INVALID_HDR_EVIDENCE' }); assert.equal(read, false);
  const cyclic = video(); cyclic.extra = cyclic;
  assert.throws(() => result('sdr', cyclic), { code: 'INVALID_HDR_EVIDENCE' });
  const large = video(); large.extra = 'x'.repeat(16385);
  assert.throws(() => result('sdr', large), { code: 'INVALID_HDR_EVIDENCE' });
  const injected = video(); injected.color.transfer = known('smpte2084,movie=file');
  assert.throws(() => result('sdr', injected), { code: 'HDR_TRANSFER_UNSUPPORTED' });
  const wrongType = video(); wrongType.codec.type = known('audio');
  assert.throws(() => result('sdr', wrongType), { code: 'INVALID_HDR_EVIDENCE' });
});

test('no color route changes cadence, geometry, quality controls or ancillary stream authority', () => {
  for (const [policy, evidence] of [['preserve', video()], ['sdr', video()], ['hlg-base', video('arib-std-b67', [dolby()])], ['dolby-pq', video('arib-std-b67', [dolby()])]]) {
    const output = result(policy, evidence); const filters = output.filterContribution ? graph(output) : '';
    assert.doesNotMatch(filters, /(?:^|[, :])(?:fps|trim|setpts|scale|crop|pad|preset|crf|cq|rate)=/);
    assert.equal(output.ancillaryStreamAuthority, 'none'); assert.equal(output.executable, false);
    assert.ok(output.qualificationRequirements.includes('preservation-validation-and-ancillary-decisions'));
  }
});
