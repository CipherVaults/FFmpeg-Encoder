'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assessRemux } = require('../src/remux-contract.cjs');
const { createRemuxValidator, remuxProbeFingerprint, validateRemuxMediaQualification } = require('../src/remux-validation.cjs');
const { MARKER_KEY, OUTPUT_ID_KEY, GENERATION_KEY } = require('../src/provenance.cjs');
const { observeMovRepresentation } = require('../src/mov-representation.cjs');
const { fixture, writeFixture } = require('./helpers/mov-fixture.cjs');

// Registry and collector receipts below are direct-test fixtures, never claims
// of native codec/container qualification or actual decoded-media acceptance.
const SOURCE = 'a'.repeat(64), RUNTIME = 'b'.repeat(64);
const OUTPUT_ID = '715e278f-1b7e-4d19-948d-a952b68c328e';
const clone = value => structuredClone(value);
const zero = () => ({ numerator: '0', denominator: '1' });
const rat = (n, d = 1) => ({ numerator: String(n), denominator: String(d) });
function source() {
  return { streams: [
    { index: 0, codec_type: 'video', codec_name: 'h264', profile: 'High', level: 40, width: 1920, height: 1080, pix_fmt: 'yuv420p',
      color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', chroma_location: 'left', field_order: 'progressive',
      sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9', time_base: '1/90000', start_pts: 900000, start_time: '10', duration_ts: 180000,
      duration: '2', avg_frame_rate: '60/1', r_frame_rate: '60/1', disposition: { default: 1, attached_pic: 0 }, tags: { language: 'eng', title: 'Main video' } },
    { index: 2, codec_type: 'audio', codec_name: 'aac', profile: 'LC', sample_fmt: 'fltp', sample_rate: '48000', channels: 2, channel_layout: 'stereo',
      time_base: '1/48000', start_pts: 480000, start_time: '10', duration_ts: 96000, duration: '2', disposition: { default: 1 }, tags: { language: 'eng', title: 'Audio' } },
  ], format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', nb_streams: 2, nb_programs: 0, nb_stream_groups: 0,
    start_time: '10', duration: '2', tags: { title: 'Source', creation_time: '2026-10-01T12:00:00.123456Z', major_brand: 'isom' } },
  chapters: [], programs: [], stream_groups: [] };
}
function registry(policy) {
  return { status: 'verified', runtimeIdentity: policy.runtimeIdentity, operation: 'remux', inputFamily: policy.inputFamily,
    target: policy.target, cellId: policy.cellId, evidenceId: 'owned-native-cell-1', requirementIds: [...policy.requirementIds],
    maxTimestampError: rat(1, 1000), maxChapterError: rat(1, 1000) };
}
function setup({ probe = source(), target = 'matroska', requireQualification = registry, assessmentOptions = {} } = {}) {
  const assessment = assessRemux({ request: { fileId: 'file-1', identityRevision: 3, draftRevision: 8, operation: 'remux', target,
    range: null, omissionRequestIds: [], ...assessmentOptions.request }, probe, sourceFingerprint: SOURCE, ...assessmentOptions });
  const validator = createRemuxValidator({ requireQualification });
  const plan = validator.prepare({ assessment, runtimeIdentity: RUNTIME, cellId: 'native-cell-1', outputId: OUTPUT_ID });
  const output = clone(probe);
  output.streams = assessment.expectedOutput.streams.map(stream => {
    const result = clone(probe.streams.find(item => item.index === stream.inputIndex)); result.index = stream.outputIndex;
    if (stream.metadata.creationAlias !== null) result.tags = { ...result.tags, SOURCE_CREATION_TIME: stream.metadata.creationAlias };
    if (target !== 'matroska' && result.tags?.title !== undefined) { result.tags.name = result.tags.title; delete result.tags.title; }
    return result;
  });
  output.format.format_name = target === 'matroska' ? 'matroska,webm' : 'mov,mp4,m4a,3gp,3g2,mj2';
  output.format.nb_streams = output.streams.length; output.format.nb_programs = 0; output.format.nb_stream_groups = 0;
  output.programs = []; output.stream_groups = [];
  output.format.tags = { ...output.format.tags, [MARKER_KEY]: '1', [OUTPUT_ID_KEY]: OUTPUT_ID }; delete output.format.tags[GENERATION_KEY];
  const decode = type => ({ complete: true, exitCode: 0, stderrComplete: true, errors: [],
    representation: { video: 'native-video-v1', audio: 'native-audio-v1', subtitle: 'subtitle-events-v1', attachment: 'attachment-extradata-v1' }[type],
    contentSha256: 'c'.repeat(64), metadataSha256: 'd'.repeat(64), unitCount: type === 'attachment' ? '1' : type === 'video' ? '120' : type === 'audio' ? '96000' : '2',
    firstPts: type === 'attachment' ? null : rat(10), endPts: type === 'attachment' ? null : rat(12) });
  const evidence = { version: 1, runtimeIdentity: RUNTIME, sourceFingerprint: SOURCE, sourceEvidenceFingerprint: assessment.sourceEvidenceFingerprint,
    outputId: OUTPUT_ID, outputEvidenceFingerprint: remuxProbeFingerprint(output), complete: true,
    streams: assessment.expectedOutput.streams.map(stream => {
      const before = decode(stream.codecType);
      return { inputIndex: stream.inputIndex, outputIndex: stream.outputIndex, codecType: stream.codecType, source: before, output: clone(before),
        timestamps: stream.codecType === 'attachment' ? null : { complete: true, comparedUnits: before.unitCount, maxPtsError: zero(), maxDurationError: zero() } };
    }) };
  const refresh = () => { evidence.outputEvidenceFingerprint = remuxProbeFingerprint(output); };
  const validate = () => validator.validate({ plan, outputProbe: output, essenceEvidence: evidence });
  return { assessment, validator, plan, output, evidence, refresh, validate };
}
function rejected(result, fragment) { assert.equal(result.valid, false); assert.match(result.errors.join('\n'), fragment); }
function add(probe, stream) { probe.streams.push(stream); probe.format.nb_streams = probe.streams.length; return probe; }

function mediaOptions(s) {
  return { assessment: s.assessment, runtimeIdentity: RUNTIME, cellId: 'native-cell-1', outputId: OUTPUT_ID,
    outputProbe: s.output, essenceEvidence: s.evidence, maxTimestampError: rat(1, 1000), maxChapterError: rat(1, 1000) };
}

test('MOV omitted und requires genuine stable-file mdhd32767 proof for this exact output and native stream', async t => {
  const probe = source(); probe.streams[0].tags.language = 'und';
  const s = setup({ probe, target: 'mov' }); s.output.streams[0].id = '0x17'; s.output.streams[1].id = '0x2';
  delete s.output.streams[0].tags.language; s.refresh();
  rejected(s.validate(), /language/);
  const file = await writeFixture(t, fixture([{ id: 2, language: 0 }, { id: 23, language: 32767 }]));
  const receipt = await observeMovRepresentation({ outputId: OUTPUT_ID, outputProbe: s.output, fileReceipt: file });
  s.evidence.outputFileSha256 = file.sha256;
  const validate = representation => s.validator.validate({ plan: s.plan, outputProbe: s.output, essenceEvidence: s.evidence, movRepresentationReceipt: representation });
  assert.equal(validate(receipt).valid, true);
  assert.equal(validateRemuxMediaQualification({ ...mediaOptions(s), movRepresentationReceipt: receipt }).valid, true);
  rejected(validate(clone(receipt)), /genuine matching/);
  s.evidence.outputFileSha256 = 'f'.repeat(64); rejected(validate(receipt), /genuine matching/); s.evidence.outputFileSha256 = file.sha256;
  s.output.streams[0].id = '0x3'; s.refresh(); rejected(validate(receipt), /genuine matching/);
});

test('non-und loss, other target and native language0 cannot borrow MOV unspecified-language evidence', async t => {
  for (const language of ['eng', 'und']) {
    const probe = source(); probe.streams[0].tags.language = language;
    const s = setup({ probe, target: 'mov' }); s.output.streams[0].id = '0x1'; s.output.streams[1].id = '0x2';
    delete s.output.streams[0].tags.language; s.refresh();
    const file = await writeFixture(t, fixture([{ id: 1, language: language === 'und' ? 0 : 32767 }, { id: 2 }]));
    const receipt = await observeMovRepresentation({ outputId: OUTPUT_ID, outputProbe: s.output, fileReceipt: file });
    s.evidence.outputFileSha256 = file.sha256;
    rejected(s.validator.validate({ plan: s.plan, outputProbe: s.output, essenceEvidence: s.evidence, movRepresentationReceipt: receipt }), /language/);
    const mp4 = setup({ probe, target: 'mp4' });
    rejected(mp4.validator.validate({ plan: mp4.plan, outputProbe: mp4.output, essenceEvidence: mp4.evidence, movRepresentationReceipt: receipt }), /another target/);
  }
});

test('native MOV/MP4 track-name representation still refuses missing/changed or contradictory names', () => {
  for (const target of ['mov', 'mp4']) {
    const probe = source(); probe.streams[1].tags = { name: 'Stereo stream' };
    const s = setup({ probe, target }); assert.equal(s.validate().valid, true);
    s.output.streams[1].tags.name = 'Changed'; s.refresh(); rejected(s.validate(), /metadata 'name'/);
    delete s.output.streams[1].tags.name; s.refresh(); rejected(s.validate(), /metadata 'name'/);
  }
});

test('media-only qualification shares validation but cannot become production registry authority', () => {
  const s = setup();
  const result = validateRemuxMediaQualification(mediaOptions(s));
  assert.equal(result.valid, true); assert.equal(result.status, 'media-validation-passed');
  assert.equal(result.executionReady, false); assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(result.missingQualificationIds, ['provenance:matroska', 'publication-and-lifecycle']);
  assert.equal(result.mediaChecks.some(item => item.id === 'publication-and-lifecycle' || item.id.startsWith('provenance:')), false);
  const production = createRemuxValidator({ requireQualification: () => result });
  assert.throws(() => production.prepare({ assessment: s.assessment, runtimeIdentity: RUNTIME,
    cellId: 'native-cell-1', outputId: OUTPUT_ID }), { code: 'INVALID_REMUX_VALIDATION' });
  const mov = setup({ target: 'mov' });
  const movResult = validateRemuxMediaQualification(mediaOptions(mov));
  assert.equal(movResult.valid, true);
  assert.ok(movResult.missingQualificationIds.includes('mov-family-metadata-mode'));
  assert.equal(movResult.mediaChecks.some(item => item.id === 'mov-family-metadata-mode'), false);
});

test('media-only qualification preserves exact stream/content/color/timing checks and private assessment brand', () => {
  for (const change of [s => { s.output.streams[0].color_transfer = 'smpte2084'; s.refresh(); },
    s => { s.evidence.streams[1].output.contentSha256 = 'f'.repeat(64); },
    s => { s.evidence.streams[0].timestamps.maxPtsError = rat(1); }]) {
    const s = setup(); change(s);
    const result = validateRemuxMediaQualification(mediaOptions(s));
    assert.equal(result.valid, false); assert.equal(result.status, 'media-validation-failed');
    assert.equal(result.mediaChecks.every(item => item.status === 'not-qualified'), true);
  }
  const s = setup();
  assert.throws(() => validateRemuxMediaQualification({ ...mediaOptions(s), assessment: clone(s.assessment) }), { code: 'REMUX_NOT_PLANNABLE' });
  assert.throws(() => validateRemuxMediaQualification({ ...mediaOptions(s), maxTimestampError: rat(2) }), { code: 'INVALID_REMUX_VALIDATION' });
});

test('media-only qualification cannot relax timed-data or MOV chapter-carrier refusals', () => {
  for (const probe of [add(source(), { index: 4, codec_type: 'data', codec_name: 'tmcd', codec_tag_string: 'tmcd' }),
    { ...source(), chapters: [{ id: 0, time_base: '1/1000', start: 10000, end: 11000, tags: { title: 'One' } }] }]) {
    const assessment = assessRemux({ request: { fileId: 'file-1', identityRevision: 3, draftRevision: 8,
      operation: 'remux', target: 'mov', range: null, omissionRequestIds: [] }, probe, sourceFingerprint: SOURCE });
    const s = setup();
    assert.throws(() => validateRemuxMediaQualification({ ...mediaOptions(s), assessment }),
      { code: probe.chapters.length ? 'REMUX_AUXILIARY_UNQUALIFIED' : 'REMUX_RELATIONSHIP_UNQUALIFIED' });
  }
});

test('genuine plans require the exact registry and validate Full copied output for each target', () => {
  for (const target of ['matroska', 'mp4', 'mov']) {
    const s = setup({ target }); assert.equal(s.validate().valid, true);
    assert.equal(Object.isFrozen(s.plan), true); assert.equal(s.plan.operation, 'remux');
    assert.match(s.validate().contentClaim, /container and framed packet bytes may differ/);
  }
});

test('codec tables, copied assessments and copied plans never become validation authority', () => {
  assert.throws(() => createRemuxValidator(), { code: 'REMUX_QUALIFICATION_REQUIRED' });
  const s = setup();
  assert.throws(() => s.validator.prepare({ assessment: clone(s.assessment), runtimeIdentity: RUNTIME, cellId: 'native-cell-1', outputId: OUTPUT_ID }), { code: 'REMUX_NOT_PLANNABLE' });
  assert.throws(() => s.validator.validate({ plan: clone(s.plan), outputProbe: s.output, essenceEvidence: s.evidence }), { code: 'REMUX_VALIDATION_PLAN_REQUIRED' });
  const unrelated = createRemuxValidator({ requireQualification: registry });
  assert.throws(() => unrelated.validate({ plan: s.plan, outputProbe: s.output, essenceEvidence: s.evidence }), { code: 'REMUX_VALIDATION_PLAN_REQUIRED' });
});

test('runtime, operation, target, input-family, cell and all requirement IDs bind qualification', () => {
  for (const change of [receipt => { receipt.runtimeIdentity = 'e'.repeat(64); }, receipt => { receipt.operation = 'encode'; }, receipt => { receipt.inputFamily = 'avi'; },
    receipt => { receipt.target = 'mp4'; }, receipt => { receipt.cellId = 'other-cell'; }, receipt => { receipt.requirementIds.pop(); },
    receipt => { receipt.requirementIds.push(receipt.requirementIds[0]); }, receipt => { receipt.status = 'advertised'; }]) {
    assert.throws(() => setup({ requireQualification: policy => { const receipt = registry(policy); change(receipt); return receipt; } }), { code: 'REMUX_QUALIFICATION_REQUIRED' });
  }
});

test('blocked assessments and timed-data/related MOV paths remain refused', () => {
  const missing = source(); delete missing.programs;
  assert.throws(() => setup({ probe: missing }), { code: 'REMUX_NOT_PLANNABLE' });
  const timed = add(source(), { index: 4, codec_type: 'data', codec_name: 'tmcd', codec_tag_string: 'tmcd' });
  assert.throws(() => setup({ probe: timed, target: 'mov' }), { code: 'REMUX_RELATIONSHIP_UNQUALIFIED' });
  const chapter = source(); chapter.chapters = [{ id: 0, time_base: '1/1000', start: 10000, end: 11000, tags: { title: 'One' } }];
  assert.throws(() => setup({ probe: chapter, target: 'mp4' }), { code: 'REMUX_AUXILIARY_UNQUALIFIED' });
});

test('exact stream map preserves sparse source indexes and refuses missing, extra or swapped streams', () => {
  for (const change of [s => { s.output.streams.pop(); s.output.format.nb_streams--; }, s => {
    s.output.streams.push({ ...clone(s.output.streams[1]), index: 3 }); s.output.format.nb_streams++;
  }, s => { s.output.streams[1].index = 5; }, s => { s.output.streams[1].codec_type = 'subtitle'; }, s => { s.output.streams[1].codec_name = 'opus'; }]) {
    const s = setup(); change(s); s.refresh(); assert.equal(s.validate().valid, false);
  }
  assert.deepEqual(setup().assessment.expectedOutput.streams.map(item => [item.inputIndex, item.outputIndex]), [[0, 0], [2, 1]]);
});

test('significant video geometry, depth, cadence, color, profile and level cannot disappear or change', () => {
  for (const [field, value] of Object.entries({ width: 1280, height: 720, pix_fmt: 'yuv420p10le', sample_aspect_ratio: '4:3',
    display_aspect_ratio: '4:3', avg_frame_rate: '30/1', color_transfer: 'smpte2084', color_primaries: 'bt2020', color_space: 'bt2020nc',
    color_range: 'pc', chroma_location: 'center', field_order: 'tt', profile: 'Baseline', level: 30 })) {
    const s = setup(); s.output.streams[0][field] = value; s.refresh(); rejected(s.validate(), new RegExp(field));
  }
  const s = setup(); delete s.output.streams[0].color_transfer; s.refresh(); rejected(s.validate(), /color_transfer/);
});

test('equivalent SAR and declared constant rate rationals remain valid', () => {
  const s = setup(); s.output.streams[0].sample_aspect_ratio = '2:2'; s.output.streams[0].avg_frame_rate = '120/2'; s.refresh();
  assert.equal(s.validate().valid, true);
});

function variableRateFixture() {
  const s = setup();
  for (const side of ['source', 'output']) s.evidence.streams[0][side].cadence = {
    version: 1, classification: 'variable', intervalCount: '119', firstStep: rat(1, 25), differingStep: rat(2, 25) };
  s.output.streams[0].avg_frame_rate = '30/1'; s.refresh(); return s;
}

test('only complete variable witnesses on both sides waive differing valid average summaries', () => {
  const s = variableRateFixture(), result = s.validate();
  assert.equal(result.valid, true); assert.match(result.warnings.join('\n'), /average frame-rate summaries differ/);
  for (const side of ['source', 'output']) {
    const missing = variableRateFixture(); delete missing.evidence.streams[0][side].cadence;
    rejected(missing.validate(), /avg_frame_rate/);
    const constant = variableRateFixture(); constant.evidence.streams[0][side].cadence.classification = 'constant';
    constant.evidence.streams[0][side].cadence.differingStep = null; rejected(constant.validate(), /avg_frame_rate/);
  }
  for (const value of [undefined, '0/1', '0/0', 'not-a-rate', '-30/1']) {
    const invalid = variableRateFixture();
    if (value === undefined) delete invalid.output.streams[0].avg_frame_rate;
    else invalid.output.streams[0].avg_frame_rate = value;
    invalid.refresh(); rejected(invalid.validate(), /avg_frame_rate/);
  }
});

test('cadence witnesses reject malformed, incomplete and rationally equivalent variable claims', () => {
  const mutations = [c => { c.version = 2; }, c => { c.classification = 'unknown'; }, c => { c.intervalCount = '118'; },
    c => { c.firstStep = rat(0); }, c => { c.firstStep = rat(-1); }, c => { c.firstStep.denominator = '0'; },
    c => { c.differingStep = null; }, c => { c.differingStep = rat(40, 1000); }, c => { c.differingStep = rat(-1, 25); },
    c => { c.classification = 'constant'; }, c => { c.classification = 'insufficient'; }, c => { c.extra = true; }];
  for (const side of ['source', 'output']) for (const mutate of mutations) {
    const s = variableRateFixture(); mutate(s.evidence.streams[0][side].cadence); rejected(s.validate(), /cadence/);
  }
  const skippedHeaderBranch = setup(); skippedHeaderBranch.evidence.streams[0].source.cadence = { version: 999 };
  rejected(skippedHeaderBranch.validate(), /cadence/);
});

test('constant and insufficient cadence retain strict rate behavior and exact count conventions', () => {
  for (const units of ['1', '2', '120']) {
    const s = setup();
    for (const side of ['source', 'output']) {
      s.evidence.streams[0][side].unitCount = units;
      s.evidence.streams[0][side].cadence = { version: 1, classification: units === '1' ? 'insufficient' : 'constant',
        intervalCount: String(BigInt(units) - 1n), firstStep: units === '1' ? null : rat(1, 60), differingStep: null };
    }
    s.evidence.streams[0].timestamps.comparedUnits = units; assert.equal(s.validate().valid, true);
    s.output.streams[0].avg_frame_rate = '30/1'; s.refresh(); rejected(s.validate(), /avg_frame_rate/);
  }
  const two = setup();
  for (const side of ['source', 'output']) {
    two.evidence.streams[0][side].unitCount = '2';
    two.evidence.streams[0][side].cadence = { version: 1, classification: 'variable', intervalCount: '1', firstStep: rat(1, 25), differingStep: rat(2, 25) };
  }
  two.evidence.streams[0].timestamps.comparedUnits = '2'; rejected(two.validate(), /two observed intervals/);
});

test('a VFR average representation cannot mask any native preservation failure', () => {
  for (const change of [
    s => { s.evidence.streams[0].output.contentSha256 = 'e'.repeat(64); },
    s => { s.evidence.streams[0].output.metadataSha256 = 'e'.repeat(64); },
    s => { s.evidence.streams[0].timestamps.comparedUnits = '119'; },
    s => { s.evidence.streams[0].timestamps.maxPtsError = rat(1); },
    s => { s.evidence.streams[0].timestamps.maxDurationError = rat(1); },
    s => { s.evidence.streams[0].output.endPts = rat(13); },
    s => { s.output.streams[0].width = 1280; s.refresh(); },
    s => { delete s.output.format.tags[OUTPUT_ID_KEY]; s.refresh(); },
    s => { s.output.streams[1].channel_layout = 'mono'; s.refresh(); },
  ]) { const s = variableRateFixture(); change(s); assert.equal(s.validate().valid, false); }
});

test('all copied audio properties remain significant', () => {
  for (const [field, value] of Object.entries({ sample_fmt: 's16p', sample_rate: '44100', channels: 1, channel_layout: 'mono', profile: 'HE-AAC' })) {
    const s = setup(); s.output.streams[1][field] = value; s.refresh(); rejected(s.validate(), new RegExp(field));
  }
});

// October23 owner amendment changes only descriptive label/date failures below
// into warnings. Track/chapter interpretation and all media checks stay strict.
test('dispositions and track metadata remain strict while container titles produce descriptive warnings', () => {
  const s = setup(); s.output.streams[1].disposition.forced = 1; s.refresh(); rejected(s.validate(), /dispositions/);
  const track = setup(); delete track.output.streams[1].tags.title; track.refresh(); rejected(track.validate(), /metadata 'title'/);
  const global = setup(); global.output.format.tags.title = 'Different'; global.refresh();
  const result = global.validate(); assert.equal(result.valid, true); assert.deepEqual(result.errors, []);
  assert.equal(result.warnings.length, 1); assert.match(result.warnings[0].message, /Container.*title/);
});

test('creation-time equivalence retains precision while descriptive differences are warned without rounding them away', () => {
  const s = setup(); s.output.format.tags.creation_time = '2026-10-01T14:00:00.123456000+02:00'; s.refresh();
  assert.equal(s.validate().valid, true); assert.deepEqual(s.validate().warnings, []);
  s.output.format.tags.creation_time = '2026-10-01T12:00:00.123457Z'; s.refresh();
  const result = s.validate(); assert.equal(result.valid, true); assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /creation_time/);
});

test('Matroska exact creation-time alias is still attempted and its loss or alteration yields one descriptive warning', () => {
  const probe = source(); probe.streams[0].tags.creation_time = '2026-10-01T12:00:00.123456Z';
  const s = setup({ probe }); delete s.output.streams[0].tags.creation_time; s.refresh(); assert.equal(s.validate().valid, true);
  assert.deepEqual(s.validate().warnings, []);
  s.output.streams[0].tags.SOURCE_CREATION_TIME = '2026-10-01T12:00:00.123456000Z'; s.refresh();
  let result = s.validate(); assert.equal(result.valid, true); assert.equal(result.warnings.length, 1);
  assert.match(result.warnings[0].message, /creation_time/);
  delete s.output.streams[0].tags.SOURCE_CREATION_TIME; s.refresh();
  result = s.validate(); assert.equal(result.valid, true); assert.equal(result.warnings.length, 1);
  const priorAlias = clone(probe); priorAlias.streams[0].tags.SOURCE_CREATION_TIME = priorAlias.streams[0].tags.creation_time;
  const duplicate = setup({ probe: priorAlias }); delete duplicate.output.streams[0].tags.SOURCE_CREATION_TIME; duplicate.refresh();
  assert.equal(duplicate.validate().warnings.length, 1, 'a matching preexisting descriptive alias does not duplicate the same warning');
});

test('known descriptive metadata differences return structured warnings for every target while copied descriptions stay quiet', () => {
  for (const target of ['matroska', 'mp4', 'mov']) {
    const probe = source(); Object.assign(probe.streams[0].tags, { vendor_id: 'FFMP', encoder: 'Source tool' });
    Object.assign(probe.format.tags, { comment: 'A source note', author: 'Author', description: 'Container description' });
    const s = setup({ probe, target }); assert.deepEqual(s.validate().warnings, []);
    s.output.streams[0].tags.vendor_id = '0000'; delete s.output.streams[0].tags.encoder;
    delete s.output.format.tags.comment; s.output.format.tags.author = 'Changed'; delete s.output.format.tags.description;
    s.refresh(); const result = s.validate();
    assert.equal(result.valid, true); assert.deepEqual(result.errors, []);
    assert.deepEqual(result.warnings.map(item => item.key).sort(), ['author', 'comment', 'description', 'encoder', 'vendor_id']);
    for (const warning of result.warnings) {
      assert.equal(warning.code, 'REMUX_DESCRIPTIVE_METADATA_DIFFERENCE');
      assert.equal(typeof warning.message, 'string'); assert.ok(warning.message.length);
      assert.equal(warning.policy, 'remux-functional-consequence'); assert.equal(warning.policyVersion, 1);
      assert.equal(Object.isFrozen(warning), true);
    }
    assert.equal(Object.isFrozen(result.warnings), true);
  }
});

test('functional and unassessed metadata remain errors alongside descriptive warnings', () => {
  for (const key of ['title', 'name', 'language', 'timecode', 'encoder_delay', 'description', 'unassessed_playback_mode']) {
    const probe = source(); probe.streams[0].tags[key] = 'Important'; probe.streams[0].tags.vendor_id = 'FFMP';
    const s = setup({ probe }); delete s.output.streams[0].tags[key]; delete s.output.streams[0].tags.vendor_id; s.refresh();
    const result = s.validate(); rejected(result, new RegExp(`metadata '${key}'`));
    assert.deepEqual(result.warnings.map(item => item.key), ['vendor_id']);
  }
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const probe = source(); Object.defineProperty(probe.format.tags, key, { value: 'Unassessed original', enumerable: true, writable: true, configurable: true });
    const s = setup({ probe }); delete s.output.format.tags[key]; s.refresh(); rejected(s.validate(), new RegExp(key));
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('output-only functional and unknown tags are refused at stream, container and chapter scope despite matching essence', () => {
  for (const scope of ['stream', 'container', 'chapter']) {
    for (const key of ['replaygain_track_gain', 'unknown_playback_mode', 'constructor', '__proto__']) {
      const probe = source();
      if (scope === 'chapter') probe.chapters = [{ id: 0, time_base: '1/1000', start: 10000, end: 11000, tags: { title: 'Chapter' } }];
      const s = setup({ probe });
      const tags = scope === 'stream' ? s.output.streams[1].tags : scope === 'container' ? s.output.format.tags : s.output.chapters[0].tags;
      Object.defineProperty(tags, key, { value: key === 'replaygain_track_gain' ? '-12 dB' : 'New playback interpretation', enumerable: true, writable: true, configurable: true });
      s.refresh(); const result = s.validate();
      rejected(result, new RegExp(`output-only .*metadata '${key}'`));
      assert.deepEqual(result.warnings, []);
    }
  }
  for (const key of ['rotate', 'color_transfer', 'timecode']) {
    const s = setup(); s.output.streams[0].tags[key] = 'Changed interpretation'; s.refresh();
    rejected(s.validate(), new RegExp(`output-only .*metadata '${key}'`));
  }
  assert.equal(Object.prototype.polluted, undefined);
});

test('only exact unspecified language and codec-matched native handler defaults are neutral additions', () => {
  const neutral = target => {
    const probe = add(source(), { index: 5, codec_type: 'subtitle', codec_name: 'mov_text', disposition: {}, tags: { title: 'Captions' } });
    for (const stream of probe.streams) delete stream.tags.language;
    const s = setup({ probe, target });
    for (const [index, handler] of ['VideoHandler', 'SoundHandler', 'SubtitleHandler'].entries()) {
      Object.assign(s.output.streams[index].tags, { language: 'und', handler_name: handler });
    }
    s.refresh(); return s;
  };
  for (const target of ['mp4', 'mov']) {
    const s = neutral(target); assert.equal(s.validate().valid, true); assert.deepEqual(s.validate().warnings, []);
    for (const [index, key, value] of [[0, 'language', 'eng'], [1, 'language', 'UND'], [0, 'handler_name', 'SoundHandler'],
      [1, 'handler_name', 'VideoHandler'], [2, 'handler_name', 'Arbitrary subtitle label']]) {
      const wrong = neutral(target); wrong.output.streams[index].tags[key] = value; wrong.refresh();
      rejected(wrong.validate(), new RegExp(`output-only functional metadata '${key}'`));
    }
  }
  const sourceHandler = source(); sourceHandler.streams[0].tags.handler_name = 'A source label';
  const replaced = setup({ probe: sourceHandler, target: 'mp4' }); replaced.output.streams[0].tags.handler_name = 'VideoHandler'; replaced.refresh();
  rejected(replaced.validate(), /metadata 'handler_name' was not preserved/);
  const specified = setup({ target: 'mp4' }); specified.output.streams[0].tags.language = 'und'; specified.refresh();
  rejected(specified.validate(), /metadata 'language' was not preserved/);
});

test('track language defaults never authorize container or chapter language additions', () => {
  for (const scope of ['container', 'chapter']) {
    const probe = source();
    if (scope === 'chapter') probe.chapters = [{ id: 0, time_base: '1/1000', start: 10000, end: 11000, tags: { title: 'Chapter' } }];
    const s = setup({ probe });
    (scope === 'container' ? s.output.format.tags : s.output.chapters[0].tags).language = 'und'; s.refresh();
    rejected(s.validate(), /output-only functional metadata 'language'/);
  }
});

test('a declared native title-to-name addition requires the exact source label', () => {
  for (const target of ['mp4', 'mov']) {
    const s = setup({ target });
    assert.equal(s.output.streams[0].tags.title, undefined);
    assert.equal(s.output.streams[0].tags.name, 'Main video');
    assert.equal(s.validate().valid, true);
    s.output.streams[0].tags.name = 'Another track'; s.refresh();
    rejected(s.validate(), /output-only functional metadata 'name'/);
  }
});

test('output-only descriptive/derived tags and declared target brands remain allowed without granting unknown tag authority', () => {
  for (const target of ['matroska', 'mp4', 'mov']) {
    const probe = source(); delete probe.format.tags.major_brand;
    const s = setup({ probe, target });
    Object.assign(s.output.streams[0].tags, { vendor_id: 'FFMP', encoder: 'Output muxer', comment: 'A new description', number_of_frames: '120' });
    Object.assign(s.output.format.tags, { description: 'A container description', duration: '00:00:02' });
    if (target !== 'matroska') Object.assign(s.output.format.tags, { major_brand: 'isom', minor_version: '512', compatible_brands: 'isomiso2avc1mp41' });
    s.refresh(); assert.equal(s.validate().valid, true); assert.deepEqual(s.validate().warnings, []);
    s.output.format.tags.unassessed_playback_mode = 'Unexpected'; s.refresh(); rejected(s.validate(), /output-only unassessed metadata/);
  }
});

test('descriptive loss never waives essence, PCM unit count, timing or fresh-provenance failures', () => {
  for (const [change, reason] of [
    [s => { s.evidence.streams[0].output.contentSha256 = 'f'.repeat(64); }, /native essence/],
    [s => { s.evidence.streams[1].output.unitCount = '95999'; }, /unit count/],
    [s => { s.evidence.streams[0].timestamps.maxPtsError = rat(1); }, /maxPtsError/],
    [s => { delete s.output.format.tags[MARKER_KEY]; }, /provenance/],
  ]) {
    const probe = source(); probe.streams[0].tags.vendor_id = 'FFMP';
    const s = setup({ probe }); delete s.output.streams[0].tags.vendor_id; change(s); s.refresh();
    const result = s.validate(); rejected(result, reason);
    assert.deepEqual(result.warnings.map(item => item.key), ['vendor_id']);
  }
});

test('undefined Matroska language may be omitted but a real language may not', () => {
  const probe = source(); probe.streams[0].tags.language = 'und';
  const s = setup({ probe }); delete s.output.streams[0].tags.language; s.refresh(); assert.equal(s.validate().valid, true);
  const actual = setup(); delete actual.output.streams[0].tags.language; actual.refresh(); rejected(actual.validate(), /language/);
});

test('case-folded metadata collisions are never resolved by choosing a convenient value', () => {
  const s = setup(); s.output.streams[0].tags.TITLE = s.output.streams[0].tags.title; s.refresh(); rejected(s.validate(), /case-folded/);
});

test('meaningful rotation/HDR side-data and decoded per-frame metadata must be retained', () => {
  const probe = source(); probe.streams[0].side_data_list = [{ side_data_type: 'Content light level metadata', max_content: 1000, max_average: 200 }];
  const s = setup({ probe }); assert.equal(s.validate().valid, true);
  s.output.streams[0].side_data_list[0].max_content = 900; s.refresh(); rejected(s.validate(), /side-data/);
  const decoded = setup(); decoded.evidence.streams[0].output.metadataSha256 = 'e'.repeat(64); rejected(decoded.validate(), /per-unit metadata/);
});

test('chapters preserve exact rational boundaries and meaningful tags', () => {
  const probe = source(); probe.chapters = [{ id: 7, time_base: '1/1000', start: 10000, end: 11000, tags: { title: 'Chapter' } }];
  const s = setup({ probe }); s.output.chapters[0].time_base = '1/2000'; s.output.chapters[0].start = 20000; s.output.chapters[0].end = 22000;
  s.refresh(); assert.equal(s.validate().valid, true);
  s.output.chapters[0].end += 3; s.refresh(); rejected(s.validate(), /Chapter 0: end/);
  const missing = setup({ probe }); missing.output.chapters = []; missing.refresh(); rejected(missing.validate(), /Chapter count/);
  const contradictory = setup({ probe }); contradictory.output.chapters[0].start_time = '200'; contradictory.refresh(); rejected(contradictory.validate(), /contradict/);
  const label = setup({ probe }); delete label.output.chapters[0].tags.title; label.refresh(); rejected(label.validate(), /Chapter 0.*metadata 'title'/);
});

test('only exact per-file omission grants remove streams from the expected validation map', () => {
  const probe = add(source(), { index: 5, codec_type: 'subtitle', codec_name: 'ass', disposition: {}, tags: { title: 'Unsupported in MP4' } });
  const request = { fileId: 'file-1', identityRevision: 3, draftRevision: 8, operation: 'remux', target: 'mp4', range: null, omissionRequestIds: [] };
  const initial = assessRemux({ request, probe, sourceFingerprint: SOURCE });
  const omitted = initial.expectedOutput.streams.find(stream => stream.inputIndex === 5);
  const grant = { id: 'omit-subtitle', fileId: 'file-1', identityRevision: 3, draftRevision: 8, operation: 'remux', target: 'mp4', sourceFingerprint: SOURCE,
    streamIndex: 5, streamFingerprint: omitted.streamFingerprint, action: 'omit-stream' };
  const s = setup({ probe, target: 'mp4', assessmentOptions: { request: { ...request, omissionRequestIds: [grant.id] }, resolveOmission: id => id === grant.id ? grant : null } });
  assert.equal(s.validate().valid, true); assert.equal(s.assessment.expectedOutput.omittedStreams.length, 1);
  s.output.streams.push({ ...clone(probe.streams[2]), index: 2 }); s.output.format.nb_streams++; s.refresh(); rejected(s.validate(), /Stream count/);
});

test('attachments need both exact extradata and complete payload evidence', () => {
  const probe = add(source(), { index: 8, codec_type: 'attachment', codec_name: 'ttf', extradata_hash: `SHA256:${'f'.repeat(64)}`,
    extradata_size: 99, disposition: {}, tags: { filename: 'font.ttf', mimetype: 'application/x-truetype-font' } });
  const s = setup({ probe }); assert.equal(s.validate().valid, true);
  s.output.streams[2].extradata_hash = `SHA256:${'e'.repeat(64)}`; s.refresh(); rejected(s.validate(), /attachment content/);
  const missing = setup({ probe }); missing.evidence.streams.pop(); rejected(missing.validate(), /every admitted/);
  for (const key of ['filename', 'mimetype']) {
    const identity = setup({ probe }); delete identity.output.streams[2].tags[key]; identity.refresh(); rejected(identity.validate(), new RegExp(`metadata '${key}'`));
  }
});

test('subtitle semantic content and events cannot be lost while the codec remains unchanged', () => {
  const probe = add(source(), { index: 5, codec_type: 'subtitle', codec_name: 'ass', disposition: { forced: 1 }, tags: { title: 'Signs' } });
  const s = setup({ probe }); assert.equal(s.validate().valid, true);
  s.evidence.streams[2].output.contentSha256 = 'e'.repeat(64); rejected(s.validate(), /native essence/);
});

test('normal fresh provenance must round-trip and prior encode recipes must not survive remux', () => {
  for (const change of [s => { delete s.output.format.tags[MARKER_KEY]; }, s => { s.output.format.tags[MARKER_KEY] = '2'; },
    s => { s.output.format.tags[MARKER_KEY] = 1; }, s => { s.output.format.tags[OUTPUT_ID_KEY] = '9690cc4c-fd65-4b75-a0a2-c4b81e4f24e3'; },
    s => { s.output.format.tags[GENERATION_KEY] = '{}'; }, s => { s.output.streams[0].tags[MARKER_KEY] = '1'; }]) {
    const s = setup(); change(s); s.refresh(); assert.equal(s.validate().valid, false);
  }
});

test('same encoded output ID is not fresh generation authority', () => {
  const probe = source(); probe.format.tags[MARKER_KEY] = '1'; probe.format.tags[OUTPUT_ID_KEY] = OUTPUT_ID;
  assert.throws(() => setup({ probe }), /fresh output ID/);
});

test('missing, bounded-only, failed or incomplete decoder evidence never proves Full preservation', () => {
  for (const change of [s => { s.evidence.complete = false; }, s => { s.evidence.streams[0].source.complete = false; },
    s => { s.evidence.streams[1].output.stderrComplete = false; }, s => { s.evidence.streams[0].output.exitCode = 1; },
    s => { s.evidence.streams[0].output.errors = ['decode failure']; }, s => { s.evidence.streams[0].output.representation = 'bounded-sample'; }]) {
    const s = setup(); change(s); assert.equal(s.validate().valid, false);
  }
});

test('runtime/source/probe/output evidence bindings cannot be mixed between runs', () => {
  for (const [field, value] of Object.entries({ runtimeIdentity: 'e'.repeat(64), sourceFingerprint: 'e'.repeat(64), sourceEvidenceFingerprint: 'e'.repeat(64),
    outputId: '9690cc4c-fd65-4b75-a0a2-c4b81e4f24e3', outputEvidenceFingerprint: 'e'.repeat(64) })) {
    const s = setup(); s.evidence[field] = value; rejected(s.validate(), /another runtime\/source\/output/);
  }
});

test('counts, content, intervals and source A/V offsets cannot silently change', () => {
  for (const change of [s => { s.evidence.streams[0].output.unitCount = '119'; }, s => { s.evidence.streams[0].output.contentSha256 = 'e'.repeat(64); },
    s => { s.evidence.streams[1].output.firstPts = rat(0); s.evidence.streams[1].output.endPts = rat(2); },
    s => { s.evidence.streams[0].output.endPts = rat(13); }]) {
    const s = setup(); change(s); assert.equal(s.validate().valid, false);
  }
});

test('every timestamp unit is compared against measured cell tolerance', () => {
  const s = setup(); s.evidence.streams[0].output.firstPts = rat(100001, 10000); s.evidence.streams[0].output.endPts = rat(120001, 10000);
  s.evidence.streams[0].timestamps.maxPtsError = rat(1, 10000); assert.equal(s.validate().valid, true);
  s.evidence.streams[0].timestamps.maxPtsError = rat(2, 1000); rejected(s.validate(), /measured cell tolerance/);
  const incomplete = setup(); incomplete.evidence.streams[0].timestamps.comparedUnits = '119'; rejected(incomplete.validate(), /comparison is incomplete/);
});

test('duplicate/unmapped essence streams cannot substitute for an omitted stream', () => {
  const s = setup(); s.evidence.streams[1] = clone(s.evidence.streams[0]); rejected(s.validate(), /duplicated, unmapped/);
});

test('packet-framing differences are not used as a proxy for decoded content loss', () => {
  const probe = source(); probe.format.format_name = 'mpegts'; probe.format.tags = {}; probe.format.nb_programs = 1;
  probe.streams[0].id = '0x100'; probe.streams[1].id = '0x101';
  probe.programs = [{ program_id: 1, program_num: 1, nb_streams: 2, pmt_pid: 4096, pcr_pid: 256, streams: [{ index: 0 }, { index: 2 }] }];
  const s = setup({ probe }); assert.equal(s.assessment.expectedOutput.bitstream[0].filter, 'aac_adtstoasc');
  assert.equal(s.validate().valid, true); // Complete native evidence matches; no framed packet hash is required.
});

test('missing output relationship coverage and foreign containers remain refused', () => {
  const s = setup(); delete s.output.programs; s.refresh(); rejected(s.validate(), /relationships/);
  const target = setup(); target.output.format.format_name = 'avi'; target.refresh(); rejected(target.validate(), /container/);
});

test('probe/evidence accessors are rejected without execution and caller data is never mutated', () => {
  const s = setup(), before = clone(s.output), evidence = clone(s.evidence);
  assert.equal(s.validate().valid, true); assert.deepEqual(s.output, before); assert.deepEqual(s.evidence, evidence);
  let reads = 0; const output = clone(s.output);
  Object.defineProperty(output.streams[0], 'codec_name', { enumerable: true, get() { reads++; return 'h264'; } });
  rejected(s.validator.validate({ plan: s.plan, outputProbe: output, essenceEvidence: s.evidence }), /unsupported properties/);
  assert.equal(reads, 0);
  const runtime = { toString() { reads++; return RUNTIME; } };
  assert.throws(() => s.validator.prepare({ assessment: s.assessment, runtimeIdentity: runtime, cellId: 'native-cell-1', outputId: OUTPUT_ID }), /runtime identity/);
  assert.equal(reads, 0);
});
