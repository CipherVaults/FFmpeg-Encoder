'use strict';

// Candidate evidence only. No service, route registration, writer, or launch
// authority. Do not substitute this for the shared media/lifecycle validator.
const path = require('node:path');
const { isDeepStrictEqual: equal } = require('node:util');
const { ToolError } = require('../src/process-runner.cjs');
const { getRemuxAssessmentSource } = require('../src/remux-contract.cjs');
const { getCollectedRemuxEvidence } = require('../src/remux-evidence.cjs');
const { remuxProbeFingerprint } = require('../src/remux-validation.cjs');
const RUNTIME = 'dfbae18ef79bdec94db9cb75260816cd5cddade19f411ca3ff985d37f1d48d13';
const {matchesTwoAacStageContainer}=require('./product-two-aac-custody.cjs');
const SOURCE = 'REMUX_TWO_AAC_MP4_SOURCE_UNQUALIFIED', EVIDENCE = 'REMUX_TWO_AAC_MP4_EVIDENCE_UNQUALIFIED';
const HASH = /^[a-f\d]{64}$/;
const N = /^(0|[1-9]\d{0,19})$/, P = /^[1-9]\d{0,19}$/;
const identityMatrix = Object.freeze([65536, 0, 0, 0, 65536, 0, 0, 0, 1073741824]);
function need(condition, code, reason) { if (!condition) throw new ToolError(code, reason); }
const admit = (ok, msg) => need(ok, SOURCE, msg);
const prove = (ok, msg) => need(ok, EVIDENCE, msg);
const exact = (x, y) => /^-?\d{1,20}$/.test(x?.numerator) && P.test(x?.denominator)
  && /^-?\d{1,20}$/.test(y?.numerator) && P.test(y?.denominator)
  && BigInt(x.numerator) * BigInt(y.denominator) === BigInt(y.numerator) * BigInt(x.denominator);
const zero = {numerator: '0', denominator: '1'};
function defaultFlag(stream) { return Number(stream.disposition?.default || 0); }
function noExtraFlags(stream) {
  return [0, 1].includes(defaultFlag(stream))
    && Object.entries(stream.disposition || {}).every(([name,value]) => name === 'default' || Number(value) === 0);
}
function rate(s) {
  const r = /^([1-9]\d{0,15})\/([1-9]\d{0,15})$/.exec(s);
  return r && BigInt(r[1]) <= 60n * BigInt(r[2]);
}
function mp4(probe) {
  return String(probe.format?.format_name || '').split(',').includes('mp4')
    && ['isom','iso2','mp41','mp42','avc1'].includes(probe.format?.tags?.major_brand);
}
function trackId(stream) {
  const id = stream.id;
  if (typeof id !== 'string' || !/^(?:0x[\da-fA-F]{1,8}|[1-9]\d{0,9})$/.test(id)) return 0;
  const value = Number(id); return value > 0 && value <= 0xffffffff ? value : 0;
}
function audioShape(stream) {
  if (!(stream.codec_type === 'audio' && stream.codec_name === 'aac' && stream.codec_tag_string === 'mp4a'
      && stream.profile === 'LC' && stream.sample_fmt === 'fltp' && noExtraFlags(stream)
      && /^SHA256:[a-f\d]{64}$/.test(stream.extradata_hash) && !stream.side_data_list?.length)) return null;
  const rate = Number(stream.sample_rate), channels = stream.channels;
  if (!((rate === 48000 && channels === 2 && stream.channel_layout === 'stereo')
      || (rate === 44100 && channels === 1 && stream.channel_layout === 'mono'))) return null;
  const nativeId = trackId(stream);
  if (!nativeId || stream.time_base !== '1/'+rate || String(stream.start_pts) !== '0' || !P.test(String(stream.duration_ts))) return null;
  return Object.freeze({index: stream.index, trackId: nativeId, rate, channels, layout: stream.channel_layout,
    language: stream.tags?.language, default: defaultFlag(stream) === 1, headerSha256: stream.extradata_hash.slice(7)});
}
function qualifyTwoAacMp4Source(assessment) {
  let source;
  try { source = getRemuxAssessmentSource(assessment); }
  catch (error) {
    if (error?.code !== 'REMUX_NOT_PLANNABLE') throw error;
    admit(false, 'A current unblocked Remux assessment is required for the two-AAC MP4 candidate.');
  }
  const request = assessment.request, expected = assessment.expectedOutput;
  admit(assessment.inputFamily === 'isobmff' && request.operation === 'remux' && request.target === 'mp4'
    && request.range === null && request.omissionRequestIds.length === 0 && expected.omittedStreams.length === 0 && mp4(source),
    'Two-AAC evidence applies only to Full MP4-to-MP4 copy without explicit omissions.');
  const container = source.mediaEvidence.container;
  admit(source.streams.length === 3 && source.chapters.length === 0 && source.programs.length === 0 && source.stream_groups.length === 0
    && container.relationships.state === 'known' && !container.relationships.issues?.length
    && expected.streams.length === 3 && expected.streams.every((x,i) => x.inputIndex === i && x.outputIndex === i)
    && expected.selectedVideoInputIndex === 0 && !expected.auxiliaryStreams.chapterCarrierQualificationRequired,
    'Two-AAC evidence requires exactly one video followed by two audio tracks, without auxiliary streams, groups or chapters.');
  const [v,...a] = source.streams;
  const g = source.mediaEvidence.streams.find(x => x.index === 0);
  const sar = g?.geometry?.sampleAspectRatio, rot = g?.geometry?.rotationDegrees;
  const display = g?.geometry?.displayMatrix, legacy = g?.geometry?.legacyRotationDegrees;
  admit(v.index === 0 && v.codec_type === 'video' && v.codec_name === 'h264' && v.codec_tag_string === 'avc1'
    && v.pix_fmt === 'yuv420p' && (v.bits_per_raw_sample === undefined || String(v.bits_per_raw_sample) === '8')
    && v.field_order === 'progressive' && [v.width,v.height].every(x => Number.isSafeInteger(x) && x > 0 && x % 2 === 0)
    && v.width <= 1920 && v.height <= 1080 && rate(v.avg_frame_rate) && rate(v.r_frame_rate)
    && v.color_range === 'tv' && ['color_space','color_primaries','color_transfer'].every(key => v[key] === 'bt709')
    && noExtraFlags(v) && defaultFlag(v) === 1 && g?.hdr?.entries?.length === 0 && !g?.geometry?.issues?.length
    && sar?.state === 'known' && exact(sar.value,{numerator:'1',denominator:'1'})
    && (rot?.state === 'unknown' || rot?.state === 'known' && exact(rot.value,zero))
    && (legacy?.state === 'unknown' || legacy?.state === 'known' && exact(legacy.value,zero))
    && (display?.state === 'unknown' || display?.state === 'known' && equal(display.value,identityMatrix.map(String)))
    && (v.side_data_list || []).every(x => x.side_data_type === 'Display Matrix'),
    'Two-AAC evidence requires square-pixel, unrotated, progressive BT.709 SDR AVC up to 1920×1080 and rate summaries no greater than 60 fps.');
  const tracks = a.map(audioShape), videoId = trackId(v);
  admit(tracks.every(Boolean) && tracks[0].index === 1 && tracks[1].index === 2 && videoId
    && new Set([videoId,...tracks.map(x=>x.trackId)]).size === 3,
    'Both audio tracks need distinct native IDs, AAC-LC configuration and an exact 44.1/48 kHz audio clock.');
  const [first,second] = tracks;
  admit(first.language === 'eng' && first.rate === 48000 && first.channels === 2 && first.default !== second.default
    && (second.rate === 44100 && second.channels === 1 && second.language === 'ara'
      || second.rate === 48000 && second.channels === 2 && ['ara','deu'].includes(second.language)),
    'Only the reviewed ordered ENG stereo / ARA mono or ENG stereo / ARA or DEU stereo pairs with exactly one default are candidates.');
  return Object.freeze({kind:'two-aac-mp4-source-evidence', executionReady:false, videoIndex:0, videoTrackId:videoId,
    audio:Object.freeze(tracks), cadence:'preliminary-rate-summaries-only'});
}
function nativePresence(witness,id,indexes,count=indexes.length) {
  const rows = (witness.fields || []).filter(x => x.id === 'isobmff:'+id);
  return rows.length === 1 && rows[0].instances === count && equal(rows[0].values?.map(x=>x.index),indexes);
}
function matchTrack(a,b,facts,src,out,frames) {
  prove(a && b && a.trackId === facts.trackId && b.trackId === out.trackId
    && a.outputIndex === facts.index && b.outputIndex === facts.index && src.duration_ts !== undefined
    && BigInt(src.duration_ts) === BigInt(frames) && BigInt(out.durationTicks) === BigInt(frames)
    && a.controls?.flags === (facts.default ? 3 : 2) && equal(a.controls,b.controls)
    && a.controls.alternateGroup === 1 && equal(a.controls.matrix,identityMatrix)
    && a.mediaScale === String(facts.rate) && a.mediaScale === b.mediaScale
    && P.test(a.mediaDuration) && a.mediaDuration === b.mediaDuration && a.entries?.length === 1 && b.entries?.length === 1,
    'The output does not prove unchanged native AAC track flags, group, clock and a single media edit.');
  for (const track of [a,b]) {
    const entry = track.entries[0];
    prove(P.test(track.movieScale) && P.test(track.trackDuration) && P.test(entry.duration)
      && P.test(entry.mediaTime) && entry.rateInteger === 1 && entry.rateFraction === 0
      && entry.duration === track.trackDuration
      && BigInt(entry.duration)*BigInt(track.mediaScale) === BigInt(frames)*BigInt(track.movieScale)
      && BigInt(entry.mediaTime)+BigInt(frames) === BigInt(track.mediaDuration),
      'Native AAC edit span and priming do not match the exact complete decoded presentation.');
  }
  prove(a.entries[0].mediaTime === b.entries[0].mediaTime, 'AAC media edit priming changed.');
}
function verifyTwoAacMp4Evidence(options) {
  const fields = ['assessment','receipt','runtimeIdentity','outputId','outputProbe','custody'];
  prove(options && [Object.prototype,null].includes(Object.getPrototypeOf(options))
    && Reflect.ownKeys(options).length === fields.length && fields.every(k=>{
      const d = Object.getOwnPropertyDescriptor(options,k); return d?.enumerable && Object.hasOwn(d,'value');
    }), 'An explicit main-owned candidate evidence request is required.');
  const {assessment, receipt, runtimeIdentity, outputId, outputProbe, custody} = options;
  const shape = qualifyTwoAacMp4Source(assessment);
  prove(runtimeIdentity === RUNTIME, 'Only the exact paired Linux runtime has two-AAC candidate evidence.');
  let essence;
  try { essence = getCollectedRemuxEvidence(receipt,{assessment,runtimeIdentity,outputId}); }
  catch (error) {
    if (error?.code !== 'REMUX_EVIDENCE_RECEIPT_REQUIRED') throw error;
    prove(false,'A live, matching current collector receipt is required; persisted evidence is not execution authority.');
  }
  prove(outputProbe && typeof outputProbe === 'object', 'The original stage output probe is required.');
  let outputFingerprint;
  try { outputFingerprint = remuxProbeFingerprint(outputProbe); }
  catch (error) {
    if (!(error instanceof ToolError)) throw error;
    prove(false,'The observed stage output probe is not a valid Remux probe.');
  }
  prove(essence.complete === true && essence.verificationMethod === 'packet-identity-v1'
    && essence.sourceEvidenceFingerprint === assessment.sourceEvidenceFingerprint && receipt.outputProbeFingerprint === outputFingerprint
    && essence.outputEvidenceFingerprint === outputFingerprint && HASH.test(essence.outputFileSha256)
    && receipt.nativeEditLists?.outputSha256 === essence.outputFileSha256
    && outputProbe.streams?.length === 3 && outputProbe.streams[0]?.index === 0
    && outputProbe.streams[0]?.codec_type === 'video' && outputProbe.streams[0]?.codec_name === 'h264',
    'Complete packet evidence and the observed MP4 output probe must match the selected stage.');
  prove(matchesTwoAacStageContainer(custody,receipt,outputProbe),
    'The held output must have the measured physical MP4 file type and matching container-brand observations.');
  const source = getRemuxAssessmentSource(assessment);
  const inv = receipt.nativeInventory;
  prove(inv?.complete && receipt.sourcePlayback?.complete && receipt.nativeEditLists?.complete
    && equal(receipt.sourcePlayback.identity,receipt.sourceBefore) && equal(receipt.nativeEditLists.identity,receipt.outputBefore),
    'Native same-file inventory, source playback and output edit-list witnesses are required.');
  for (const side of ['source','output']) {
    const native = inv[side];
    prove(native?.family === 'isobmff' && native.metadataBridgeComplete === true
      && nativePresence(native,'mdhd.language',[0,1,2]) && nativePresence(native,'mp4a',[1,2]) && nativePresence(native,'esds',[1,2]),
      'The native MP4 AAC entry, configuration and effective-language observations are missing.');
  }
  prove(essence.streams?.length === 3 && essence.streams.every((x,i)=>x.inputIndex===i && x.outputIndex===i && x.codecType===(i?'audio':'video')),
    'The collector did not preserve exact source/output stream ordering.');
  const audio = shape.audio.map(facts => {
    const i = facts.index, observed = outputProbe.streams[i], out = audioShape(observed);
    prove(out && equal(out,facts), 'The output changed the selected AAC ID, codec configuration, layout, rate, language or default status.');
    const {source: a,output: b} = essence.streams[i];
    prove(a?.complete && b?.complete && a.representation === 'packet-identity-v1' && b.representation === a.representation
      && [a,b].every(x => x.exitCode === 0 && x.stderrComplete === true && x.errors?.length === 0
        && x.admission?.complete && x.admission.kind === 'aac-lc-packet-and-frozen-pcm-v1' && x.admission.configurationSha256 === facts.headerSha256)
      && P.test(a.unitCount) && a.unitCount === b.unitCount
      && ['contentSha256','metadataSha256','decoderParametersSha256'].every(k=>HASH.test(a[k]) && a[k] === b[k])
      && exact(a.firstPts,b.firstPts) && exact(a.endPts,b.endPts),
      'Complete ordered AAC payload, timing boundary and decoder evidence do not match.');
    const comparison = receipt.comparisons.filter(x => x.inputIndex === i && x.outputIndex === i);
    const coded = comparison.find(x=>x.evidenceKind==='packet-identity-audio');
    const timeline = comparison.find(x=>x.maxDtsError);
    const spools = ['source','output'].map(side => receipt.artifacts.filter(x => path.basename(x.path) === side+'-'+i+'.packets'));
    prove(timeline && exact(timeline.maxDtsError,zero) && timeline.sourceInferredDts === 0 && timeline.outputInferredDts === 0
      && spools.every(x=>x.length===1 && x[0].bytes>0 && HASH.test(x[0].sha256))
      && spools[0][0].sha256 === spools[1][0].sha256,
      'The complete AAC packet timeline and side facts must be exactly equal without inferred timestamps.');
    const pcm = a.pcm, w = coded?.pcmWindows;
    prove(pcm && equal(pcm,b.pcm) && Number.isSafeInteger(pcm.bytes) && P.test(pcm.samples) && HASH.test(pcm.sha256)
      && BigInt(pcm.samples)*BigInt(facts.channels*4) === BigInt(pcm.bytes)
      && Number.isSafeInteger(w?.windowBytes) && w.windowBytes > 0
      && coded.contentIdentical === true && coded.metadataIdentical === true && w.comparedWindows === Math.ceil(pcm.bytes/w.windowBytes)
      && w.firstMismatchByte === null, 'Complete unchanged decoded AAC sample windows were not proved.');
    matchTrack(receipt.sourcePlayback.tracks.find(t=>t.outputIndex===i),receipt.nativeEditLists.tracks.find(t=>t.outputIndex===i),
      facts,source.streams[i],{...out,durationTicks:observed.duration_ts},pcm.samples);
    return Object.freeze({inputIndex:i,outputIndex:i,trackId:facts.trackId,language:facts.language,default:facts.default,
      sampleFrames:pcm.samples,pcmF32leSha256:pcm.sha256,orderedPacketSha256:a.contentSha256,
      metadataSha256:a.metadataSha256});
  });
  // The existing native reader corroborates effective AAC parameters and
  // an allowed family of mp4a hints; it does not report literal hint values.
  return Object.freeze({kind:'two-aac-mp4-collected-evidence',executionReady:false,outputSha256:essence.outputFileSha256,
    audio:Object.freeze(audio),sampleEntryCoverage:'validated-effective-aac-configuration-not-literal-sound-entry-hints'});
}
module.exports = {qualifyTwoAacMp4Source,verifyTwoAacMp4Evidence};
