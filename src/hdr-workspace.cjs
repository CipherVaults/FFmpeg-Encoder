'use strict';

// Main-only adapter from the existing folder/draft workspace into the finite
// HDR owner. A detected HDR source stays HDR/unsupported by ordinary SDR rules;
// only an exact, current private HDR selection can make this item Ready.
const { PROFILES, selectVideo, describeRecipe } = require('./media.cjs');
const { finishInspection, normalizeProbe } = require('./inspection.cjs');
const { buildHdrEncoding } = require('./hdr-encoding.cjs');
const { isDeepStrictEqual: same } = require('node:util');
const { generationDescriptionOf, createOutputId } = require('./provenance.cjs');
const { readFileStamp, assertIdentityMatches } = require('./source-identity.cjs');
const { fingerprintHdrProbe } = require('./hdr-operation.cjs');
const { observeHdrInput, getObservedHdrInput } = require('./hdr-input.cjs');
const fs = require('node:fs/promises');
const { createHash } = require('node:crypto');
const APP_VERSION = require('../package.json').version;
const OUTPUT_PLACEHOLDER = '<temporary output assigned at start>';
const fail = (code, message) => Object.assign(new Error(message), { code });

function hdrSdrDescriptor(contract, expectedSignal, filterGraph) {
  const semantic = { route: contract.route, transformVersion: contract.filterContribution.version,
    interpretation: contract.filterContribution.interpretation, expectedSignal, depth: expectedSignal.bitDepth, filterGraph };
  const transformId = createHash('sha256').update(JSON.stringify(semantic)).digest('hex').slice(0,12);
  // Serialization severs the descriptive writer's object graph. This object
  // carries no source path, revision, runtime-install path or execution grant.
  const result = JSON.parse(JSON.stringify({ ...semantic, transformId }));
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
  return freeze(result);
}

function describeHdrSdrTransform({ probe, settings, request, frameEvidence }) {
  if (request?.hdrPolicy !== 'sdr') return null;
  const normalized = normalizeProbe(probe), video = selectVideo(normalized);
  const typedVideo = normalized.mediaEvidence.streams.find(value => value.index === video.index);
  // Explicit SDR on an ordinary SDR source retains its accepted compatibility
  // path and filename. Missing/conflicting HDR evidence must throw precisely.
  const { classifyColor } = require('./media.cjs');
  if (classifyColor(normalized).classification === 'sdr') return null;
  const writer = buildHdrEncoding({ settings, policy:'sdr', videoEvidence:typedVideo,
    ...(frameEvidence === undefined ? {} : {frameEvidence}), target:request.target });
  if (writer.missingWriters.length || !writer.filterGraph || !writer.contract.filterContribution)
    throw fail('HDR_TRANSFORM_UNAVAILABLE', 'The requested HDR-to-SDR transform cannot be described by this writer.');
  return hdrSdrDescriptor(writer.contract,writer.expectedOutput.signal,writer.filterGraph);
}

async function prepareHdrItem(item, { file, destination, inspection, identity, marker, indexed, settings, caps, signal, onStage,
  transformDescriptor = null, resolveTransformDestination = null }) {
  if (!this.hdrOperations || !this.operationRuntime || !this.operationStorage || !this.operationTelemetry) {
    throw fail('HDR_CONTROLS_UNAVAILABLE', 'HDR preservation requires current main-owned tools, storage, telemetry and a qualified finite family.');
  }
  const request = item.operationRequest;
  const video = selectVideo(inspection.probe);
  const inputProfiles = this.hdrOperations.inputProfiles?.(inspection.probe, request?.hdrPolicy) || null;
  // Bound preparation sampling before invoking the existing HDR frame reader.
  // The owner independently checks the complete signature and all other fields.
  if (settings.profileId !== 'h265-cpu' || settings.preset !== 'slow' || settings.quality !== 25 || settings.recipeId
      || request?.range !== null || request.resolution !== 'source' || request.target !== 'matroska'
      || !['preserve', 'sdr'].includes(request.hdrPolicy) || request.hdrPolicy === 'sdr' && !inputProfiles || request.audioPolicy !== 'copy' || request.aacBitrateKbps !== null
      || request.omissionRequestIds.length || (!inputProfiles && (video.width !== 320 || video.height !== 180))
      || video.codec_name !== 'hevc' || video.pix_fmt !== 'yuv420p10le' || BigInt(identity.size) > (inputProfiles ? 16777216n : 1048576n)) {
    throw fail('HDR_QUALIFICATION_REQUIRED', 'This HDR source/options combination has no qualified CPU Full route for the explicitly requested HDR policy. No fallback was selected.');
  }
  const capability = caps.profiles.find(value => value.id === 'h265-cpu');
  if (!capability?.supportedBitDepths?.includes(10)) throw fail('UNSUPPORTED_DEPTH', 'The current CPU HEVC capability has no observed 10-bit support.');
  assertIdentityMatches(identity, await readFileStamp(file), { stage: 'before-hdr-inspection', message: 'Source changed before HDR inspection.' });
  const profile = PROFILES.find(value => value.id === settings.profileId);
  const operationRuntimeToken = await this.operationRuntime.observe({ hardware: profile.hardware, signal });
  const runtimeObservation = this.operationRuntime.snapshot(operationRuntimeToken);
  if (runtimeObservation.runtimeIdentity !== this.runtimeIdentity) throw fail('OPERATION_RUNTIME_STALE', 'The current tools differ from the prepared HDR runtime.');
  let sourceFileSha256, observed, frameEvidence, inputReceipt;
  if (inputProfiles) {
    inputReceipt = await observeHdrInput({ sourcePath: file, sourceIdentity: identity, probe: inspection.probe,
      runtimeIdentity: this.runtimeIdentity, profiles: inputProfiles, ffprobe: this.ffprobe, signal,
      run: (_executable,args,options) => this.operationRuntime.invoke(operationRuntimeToken,'ffprobe',args,options) });
    const complete = getObservedHdrInput(inputReceipt,{sourcePath:file,sourceIdentity:identity,probe:inspection.probe,runtimeIdentity:this.runtimeIdentity,profiles:inputProfiles});
    sourceFileSha256 = complete.sourceFileSha256; observed = inspection;
    // The owner consumes the genuine complete receipt. This descriptive small
    // frame contribution cannot turn a cache/snapshot into eligibility authority.
    frameEvidence = { videoIndex:0,coverage:'sampled',decodedFrameCount:complete.frameCount,decodeExitCode:0,frames:complete.frames.slice(0,256) };
  } else {
  // The first family admits only the two reviewed generated source byte sets.
  // A structural HDR match cannot classify an unknown proprietary SEI payload.
  const sourceHandle = await fs.open(file, 'r'), sourceBytes = Buffer.alloc(1048577);
  let sourceLength = 0;
  try {
    while (sourceLength < sourceBytes.length) {
      if (signal?.aborted) throw fail('CANCELLED', 'HDR source hashing cancelled.');
      const read = await sourceHandle.read(sourceBytes, sourceLength, sourceBytes.length - sourceLength, sourceLength);
      if (!read.bytesRead) break; sourceLength += read.bytesRead;
    }
  } finally { await sourceHandle.close(); }
  if (sourceLength > 1048576) throw fail('HDR_QUALIFICATION_REQUIRED', 'The source exceeds this finite HDR byte envelope.');
  sourceFileSha256 = createHash('sha256').update(sourceBytes.subarray(0, sourceLength)).digest('hex');
  observed = await finishInspection(file, inspection.probe, { ffprobe: this.ffprobe, signal, run: this.run, onStage, inspectHdrFrames: true });
  assertIdentityMatches(identity, await readFileStamp(file), { stage: 'after-hdr-inspection', message: 'Source changed during HDR inspection.' });
  const windows = observed.evidence?.windows;
  if (observed.evidence?.mode !== 'frames' || !Array.isArray(windows) || !windows.length
      || windows.some(window => window.error !== null || !Array.isArray(window.frames) || !window.frames.length)) {
    throw fail('HDR_SOURCE_OBSERVATION_INCOMPLETE', 'Decoded HDR preparation evidence is incomplete; metadata-only cache entries do not qualify the writer.');
  }
  const frames = windows.flatMap(window => window.frames);
  frameEvidence = { videoIndex: selectVideo(observed.probe).index, coverage: 'sampled', decodedFrameCount: frames.length,
    decodeExitCode: 0, frames };
  }
  assertIdentityMatches(identity, await readFileStamp(file), { stage: 'after-hdr-complete-inspection', message: 'Source changed during complete HDR inspection.' });
  let outputId = createOutputId();
  const recipe = describeRecipe(settings);
  // v1 provenance describes the ordinary recipe contribution, as for existing
  // outputs. Full HDR writer/filter arguments belong to the immutable plan and
  // actual correlated invocation, never a weakened recipe equality check.
  const generationDescription = generationDescriptionOf({ version: 1, profileId: profile.id, codec: profile.codec, backend: profile.hardware,
    encoder: profile.encoder, preset: settings.preset, qualityMode: recipe.qualityMode, quality: settings.quality,
    bitDepth: 10, encoderArgs: recipe.args, appVersion: APP_VERSION, createdAt: new Date().toISOString(),
    ...(typeof caps.versions?.ffmpeg === 'string' ? { runtimeVersion: caps.versions.ffmpeg.slice(0, 256) } : {}) });
  if (!generationDescription) throw fail('INVALID_RECIPE', 'The canonical HDR recipe description is invalid.');
  const prepareOperation = () => this.hdrOperations.prepare({ input: file, output: destination, outputId, sourceIdentity: identity, sourceFileSha256,
    request, settings, inspection: observed, frameEvidence, generationDescription, ...(inputReceipt ? { inputReceipt } : {}) });
  let operationPlan = prepareOperation();
  if (request.hdrPolicy === 'sdr') {
    // The owner has checked every genuine source frame, including all chunks.
    // Rebuild naming semantics from that exact full writer/graph, not from the
    // original metadata-only description or a caller-supplied display object.
    const describePlan = plan => hdrSdrDescriptor(plan.expectedOutput.hdrContract, plan.expectedOutput.hdr.signal,
      plan.args[plan.args.indexOf('-filter:v:0') + 1]);
    const completeDescriptor = describePlan(operationPlan);
    if (resolveTransformDestination !== null) {
      // Complete frame-only MaxCLL may change the peak from metadata-only
      // assumptions. Resolve the final name from this genuine full writer.
      // The provisional plan is never selected, installed or executed.
      const provisional = operationPlan;
      let resolved;
      try {
        if (typeof resolveTransformDestination !== 'function') throw fail('INVALID_OUTPUT_NAME', 'Main must resolve the transformed destination.');
        resolved = await resolveTransformDestination(completeDescriptor);
      } finally { this.hdrOperations.discard(provisional); }
      if (signal?.aborted) throw fail('CANCELLED', 'HDR conversion preparation cancelled.');
      if (resolved === null) return; // Main recorded the precise protected/existing outcome.
      if (typeof resolved !== 'string') throw fail('INVALID_OUTPUT_NAME', 'The resolved transformed destination is invalid.');
      assertIdentityMatches(identity, await readFileStamp(file), { stage: 'after-transform-destination', message: 'Source changed while its transformed destination was checked.' });
      if (signal?.aborted) throw fail('CANCELLED', 'HDR conversion preparation cancelled.');
      destination = resolved;
      // Discard never makes a consumed output UUID reusable. The final plan
      // receives a fresh one, while its semantic filename remains stable.
      outputId = createOutputId();
      operationPlan = prepareOperation();
      transformDescriptor = completeDescriptor;
    }
    const finalDescriptor = describePlan(operationPlan);
    if (!transformDescriptor || !same(transformDescriptor,finalDescriptor)) {
      this.hdrOperations.discard(operationPlan);
      throw fail('HDR_TRANSFORM_NAME_STALE', 'Complete source evidence changed the HDR-to-SDR interpretation; prepare a matching transformed destination again.');
    }
  } else if (transformDescriptor !== null || resolveTransformDestination !== null) {
    this.hdrOperations.discard(operationPlan);
    throw fail('HDR_TRANSFORM_NAME_STALE', 'A transformed destination cannot be reused by an HDR preservation request.');
  }
  const qualificationBindings = { plan: operationPlan, settings, sourceIdentity: identity,
    sourceProbeFingerprint: fingerprintHdrProbe(observed.probe), runtimeIdentity: this.runtimeIdentity,
    environment: runtimeObservation.environment, budget: this.operationEvidenceBudget, executionBudgetMs: this.operationDeadlineMs };
  const qualificationSelection = this.hdrOperations.select(qualificationBindings);
  if (!qualificationSelection) throw fail('HDR_QUALIFICATION_REQUIRED', 'No current finite HDR qualification is available.');
  this.hdrOperations.requireCurrent(qualificationSelection, qualificationBindings);
  const preparedArgs = Object.freeze([...operationPlan.args.slice(0, -1), OUTPUT_PLACEHOLDER]);
  this.plan.entries.set(item.id, { file, destination, inspection: observed, fingerprint: identity,
    overridden: this.plan.overrides.has(item.id), reencodeAuthorized: item.reencodeAuthorized,
    sourceOutputId: marker.outputId || indexed?.outputId, outputId, generationDescription, operationPlan,
    preparedArgs, qualificationBindings, qualificationSelection, operationRuntimeToken, hdr: true });
  this.plan.ambiguities.delete(item.id);
  const sdr = request.hdrPolicy === 'sdr', transform = operationPlan.expectedOutput.hdrTransform;
  const interpretation = transform?.interpretation;
  Object.assign(item, { status: 'ready', summary: observed.summary,
    reason: sdr ? 'Qualified finite CPU Full HDR-to-SDR conversion; visual acceptance remains unverified.'
      : 'Qualified finite CPU Full HDR preservation; display quality remains unverified.',
    hdr: { policy: request.hdrPolicy, transfer: video.color_transfer,
      scope: sdr ? 'content-cpu-hdr-sdr-v1' : inputProfiles ? 'content-cpu-hdr-preserve-v1' : 'tiny-cpu-hdr-preserve-v1',
      ...(sdr ? { transformVersion: transform.version, targetTransfer: 'bt709', interpretation } : {}),
      notice: sdr ? `Convert ${video.color_transfer === 'smpte2084' ? 'PQ' : 'HLG'} HDR to BT.709 limited-range 10-bit SDR using Hable and a nominal 100-nit SDR interpretation. Source peak: ${interpretation.sourcePeakNits} nits (${interpretation.sourcePeakBasis});${interpretation.hlgSystemGamma === null ? '' : ` HLG system gamma ${interpretation.hlgSystemGamma};`} the application has not measured this peak. Obsolete HDR metadata is removed. Dolby, audio and display acceptance are outside this finite route.`
        : `${video.color_transfer === 'smpte2084' ? 'PQ' : 'HLG'} HDR: preserve the observed signal and mastering/content-light metadata within this finite family. Tone mapping, Dolby retention, audio and HDR-display acceptance remain unavailable or unverified.` } });
}

module.exports = { prepareHdrItem, describeHdrSdrTransform };
