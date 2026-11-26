'use strict';

// Remux-specific presentation and temporary decisions live on the same service
// workspace as Encode. These functions are not renderer-supplied extensions.
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { assessRemux, getRemuxAssessmentSource } = require('./remux-contract.cjs');
const { remuxProbeFingerprint } = require('./remux-validation.cjs');
const { fingerprintRemuxSourceIdentity, deriveRemuxAssessmentBudget } = require('./remux-operation.cjs');
const { prepareTransport } = require('./remux-transport-evidence.cjs');
const { observeRemuxSourcePlayback } = require('./remux-edit-lists.cjs');
const { WINDOWS_TWO_AAC, observeTwoAacNative } = require('./remux-windows-two-aac.cjs');
const { REGULAR_WINDOWS_PAIR } = require('./regular-windows-runtime.cjs');
const { observeNativeInventory } = require('./remux-native-checks.cjs');
const { readSourceIdentity, sameIdentity } = require('./source-identity.cjs');
const { normalizeProbe, normalizeMp3RemuxProbe } = require('./inspection.cjs');
const { prepareMp3Source } = require('./remux-mp3-source.cjs');
const { observeMkvAacClock } = require('./remux-mkv-aac-clock.cjs');
const { COPY_NOTICE } = require('./remux-mp3-copy.cjs');
const OUTPUT_PLACEHOLDER = '<temporary output assigned at start>';
const fail = (code, message) => Object.assign(new Error(message), { code });
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const extensions = Object.freeze({ matroska: 'mkv', mp4: 'mp4', mov: 'mov' });

function remuxOutputName(name, target) {
  if (!Object.hasOwn(extensions, target)) throw fail('INVALID_REMUX_REQUEST', 'Choose a supported Remux target.');
  return `${path.parse(name).name}_Remux-${extensions[target].toUpperCase()}.${extensions[target]}`;
}

function requireRemuxGrants(entry) {
  if (!entry.remux) return;
  const plan = this.plan, request = entry.remuxRequest;
  if (!plan || plan.operation !== 'remux' || entry.remuxOwner !== plan || entry.preparedPlanId !== plan.id
      || request.draftRevision !== plan.draft.snapshot().revision) {
    throw fail('REMUX_AUTHORITY_STALE', 'The prepared Remux workspace changed. Prepare again.');
  }
  if (entry.mkvAacClock?.shiftSamples) {
    const clock = entry.mkvAacClock, stream = getRemuxAssessmentSource(entry.remuxAssessment).streams[1];
    if (!currentAudioChoice(plan.remuxAudioChoices.get(request.fileId), plan, request, clock, entry.fingerprint, stream, this.runtimeIdentity)) {
      throw fail('REMUX_AUDIO_SHIFT_STALE', 'The explicit audio shift no longer belongs to the current file and target.');
    }
  }
  for (const grantId of request.omissionRequestIds) {
    const grant = plan.remuxGrants.get(grantId);
    if (!grant || grant.planId !== plan.id || grant.draftId !== plan.draft.id
        || grant.draftRevision !== request.draftRevision || grant.fileId !== request.fileId
        || grant.target !== request.target || grant.sourceFingerprint !== fingerprintRemuxSourceIdentity(entry.fingerprint)
        || !sameIdentity(grant.identity, entry.fingerprint)) {
      throw fail('REMUX_OMISSION_STALE', 'A stream omission no longer belongs to this exact prepared file and target.');
    }
    const stream = getRemuxAssessmentSource(entry.remuxAssessment).streams.find(value => value.index === grant.streamIndex);
    if (!stream || hash(stream) !== grant.streamFingerprint) throw fail('REMUX_OMISSION_STALE', 'The omitted stream changed.');
  }
}

async function prepareRemuxItem(item, { file, destination, probe, identity, marker, indexed, signal }) {
  if (!this.remuxOperations || !this.operationRuntime || !this.operationStorage) {
    throw fail('REMUX_CONTROLS_UNAVAILABLE', 'Remux needs the main-owned runtime, evidence storage and qualified route policy.');
  }
  const ordinary = this.plan.draft.fileRequest(item.id);
  if (ordinary.range !== null || ordinary.resolution !== 'source' || ordinary.audioPolicy !== 'copy'
      || ordinary.hdrPolicy !== 'preserve' || ordinary.omissionRequestIds.length) {
    throw fail('INVALID_REMUX_REQUEST', 'Remux is Full-only with no encoding transforms. Stream omissions require the explicit current decision action.');
  }
  const request = { fileId: item.id, identityRevision: ordinary.identityRevision, draftRevision: ordinary.draftRevision,
    operation: 'remux', target: ordinary.target, range: null,
    omissionRequestIds: [...this.plan.remuxGrants.values()].filter(grant => grant.fileId === item.id).map(grant => grant.id) };
  const sourceFingerprint = fingerprintRemuxSourceIdentity(identity);
  const resolve = grantId => {
    const grant = this.plan.remuxGrants.get(grantId);
    if (!grant || grant.planId !== this.plan.id || grant.draftId !== this.plan.draft.id || !sameIdentity(grant.identity, identity)) return null;
    return Object.fromEntries(['id', 'fileId', 'identityRevision', 'draftRevision', 'sourceFingerprint', 'target',
      'operation', 'streamIndex', 'streamFingerprint', 'action'].map(key => [key, grant[key]]));
  };
  const mp3Source = this.remuxOperations.allowsStandaloneMp3?.(request.target) && path.extname(file).toLowerCase() === '.mp3'
    ? await prepareMp3Source(file, identity, { signal }) : undefined;
  const source = (mp3Source ? normalizeMp3RemuxProbe : normalizeProbe)(structuredClone(probe));
  let mkvAacClock, audioShift, clockRefusal;
  const measuredAudioRoute = this.remuxOperations.allowsMkvAacClock?.(request.target)
    && source.format.format_name === 'matroska,webm' && source.chapters.length === 0;
  if (measuredAudioRoute && !request.omissionRequestIds.length) {
    try {
      mkvAacClock = await observeMkvAacClock({ file, identity, probe: source, signal });
    } catch (error) {
      if (error.code !== 'REMUX_MKV_AAC_CLOCK_UNQUALIFIED') throw error;
      clockRefusal = { code: error.code, message: error.message, streamIndex: 1 };
    }
    if (mkvAacClock?.shiftSamples) {
      const granted = this.plan.remuxAudioChoices.get(item.id), stream = source.streams[1];
      const approved = currentAudioChoice(granted, this.plan, request, mkvAacClock, identity, stream, this.runtimeIdentity);
      const offer = {
        id: approved ? granted.id : randomUUID(), fileId: item.id, planId: this.plan.id, draftId: this.plan.draft.id,
        identityRevision: request.identityRevision, draftRevision: request.draftRevision, target: request.target,
        runtimeIdentity: this.runtimeIdentity, identity, sourceSha256: mkvAacClock.sha256,
        streamFingerprint: hash(stream), shiftSamples: mkvAacClock.shiftSamples,
      };
      this.plan.remuxAudioOffers.set(offer.id, offer);
      const milliseconds = Math.abs(mkvAacClock.shiftSamples) * 1000 / mkvAacClock.sampleRate;
      audioShift = { id: offer.id, approved, shiftSamples: offer.shiftSamples, milliseconds,
        message: 'This option moves audio ' + milliseconds + ' ms earlier. The app verifies every sample before saving.' };
      if (!approved) {
        clockRefusal = { code: 'REMUX_AUDIO_SHIFT_CHOICE_REQUIRED',
          message: 'Choose the disclosed audio shift before starting this file.', streamIndex: 1 };
      }
    }
  }
  const assessment = assessRemux({ request, probe, sourceFingerprint, resolveOmission: resolve,
    ...(mp3Source ? { mp3Source } : {}), ...(mkvAacClock ? { mkvAacClock } : {}) });
  const primary = assessment.expectedOutput.selectedVideoInputIndex;
  // An individual main-process service can add a refusal, never a grant.
  // Its text is presented only after the shared assessment's own blockers.
  const localReason = this.additionalAncillaryRefusal?.({ assessment, source, request, file });
  const localBlocker = typeof localReason === 'string' && localReason.length
    ? { code: 'REMUX_ANCILLARY_NOT_QUALIFIED', message: localReason, streamIndex: null } : null;
  const omissionsAvailable = this.remuxOmissionDecisionsSupported !== false && !measuredAudioRoute;
  if (audioShift && (assessment.blockers.length || localBlocker)) {
    this.plan.remuxAudioOffers.delete(audioShift.id);
    audioShift = undefined;
  }
  const candidates = [];
  // Data/timecode/relationship cases remain refused even after a proposed
  // omission. Do not offer a button that falsely promises to resolve them.
  const unsafeRelationships = assessment.blockers.some(value => /RELATIONSHIP|PROGRAM|GROUP/.test(value.code));
  for (const stream of source.streams) {
    if (!omissionsAvailable || localBlocker || mp3Source || assessment.inputFamily === 'mpegts' || unsafeRelationships || stream.index === primary || !['audio', 'subtitle', 'attachment'].includes(stream.codec_type)) continue;
    const fingerprint = hash(stream);
    const approved = [...this.plan.remuxGrants.values()].find(grant => grant.fileId === item.id && grant.streamIndex === stream.index);
    const candidate = { id: approved?.id || randomUUID(), fileId: item.id, planId: this.plan.id, draftId: this.plan.draft.id,
      identityRevision: request.identityRevision, draftRevision: request.draftRevision, sourceFingerprint,
      target: request.target, operation: 'remux', streamIndex: stream.index, streamFingerprint: fingerprint,
      action: 'omit-stream', identity, label: `Stream ${stream.index}: ${stream.codec_type} / ${stream.codec_name || 'unknown'}`,
      reasons: assessment.decisionsNeeded.find(value => value.streamIndex === stream.index)?.reasons
        || ['Explicit omission removes this stream from the output; the original is preserved.'] };
    this.plan.remuxCandidates.set(candidate.id, candidate); candidates.push(candidate);
  }
  const streams = source.streams.map(stream => {
    const mapped = assessment.expectedOutput.streams.find(value => value.inputIndex === stream.index);
    const omitted = assessment.expectedOutput.omittedStreams.some(value => value.inputIndex === stream.index);
    const blocked = assessment.blockers.filter(value => value.streamIndex === stream.index);
    return { streamIndex: stream.index, codecType: stream.codec_type, codecName: stream.codec_name,
      action: omitted ? 'explicitly-omitted' : localBlocker || blocked.length ? 'blocked' : 'preserve-copy',
      label: `Stream ${stream.index}: ${stream.codec_type} / ${stream.codec_name || 'unknown'}`,
      reasons: blocked.length ? blocked.map(value => value.message) : localBlocker
        ? ['This file is blocked as a whole. No stream will be copied.'] : [], representations: mapped?.metadata?.representations || [] };
  });
  const chapterCarrierBlocker = assessment.expectedOutput.auxiliaryStreams.chapterCarrierQualificationRequired
    ? { code: 'REMUX_AUXILIARY_UNQUALIFIED', message: 'This target needs a separately verified chapter carrier. Choose Matroska to retain supported chapters.', streamIndex: null } : null;
  const blockers = [...assessment.blockers, ...[chapterCarrierBlocker, localBlocker, clockRefusal].filter(Boolean)];
  item.remux = { target: request.target, status: 'assessment', streams, blockers,
    omissionCandidates: candidates.map(({ id, streamIndex, label, reasons, target }) => ({ id, streamIndex, label, reasons, target })),
    omissionDecisionIds: request.omissionRequestIds,
    ...(audioShift ? { audioShift } : {}),
    notice: mp3Source ? COPY_NOTICE : 'Full stream copy. Content, timing and functional metadata must validate before publication. Known nonfunctional descriptive tags are copied where possible; differences are reported as warnings.'
      + (omissionsAvailable ? '' : ' Stream omission is unavailable in this build.') };
  this.plan.remuxFacts.set(item.id, { file, fingerprint: identity, probe, request, assessment });
  const video = source.streams.find(value => value.index === primary);
  const duration = mp3Source ? mp3Source.sampleFrames / mp3Source.rate : Number(source.format.duration);
  const inspection = { probe: source, duration,
    summary: { durationSeconds: duration, codec: mp3Source ? 'mp3' : video?.codec_name, width: video?.width, height: video?.height,
      pixelFormat: video?.pix_fmt, bitDepth: mp3Source ? null : 8, frameRate: null,
      streamCounts: Object.fromEntries(['video', 'audio', 'subtitle', 'attachment', 'data'].map(type => [type, source.streams.filter(value => value.codec_type === type).length])) } };
  item.summary = inspection.summary;
  if (assessment.blockers.length) {
    item.remux.status = 'blocked'; throw fail(assessment.blockers[0].code, assessment.blockers.map(value => value.message).join(' '));
  }
  if (blockers.length) {
    const [first] = blockers;
    item.remux.status = 'blocked'; throw fail(first.code, first.message);
  }
  const outputId = randomUUID();
  let operationPlan;
  try { operationPlan = this.remuxOperations.prepare({ assessment, input: file, output: destination, outputId, sourceIdentity: identity, request }); }
  catch (error) { item.remux.status = 'blocked'; item.remux.blockers = [{ code: error.code, message: error.message, streamIndex: null }]; throw error; }
  // Metadata workers may prepare two files concurrently. Serialize only the
  // runtime-owned admission step, so one file's TS scan cannot collide with
  // another file's runtime observation. No renderer-selected runner is used.
  const admission = (this.remuxPreparationTail || Promise.resolve()).catch(() => {}).then(async () => {
    if (signal?.aborted) throw fail('CANCELLED', 'Remux preparation cancelled.');
    const operationRuntimeToken = await this.operationRuntime.observe({ hardware: 'CPU', signal });
    const observed = this.operationRuntime.snapshot(operationRuntimeToken);
    if (observed.runtimeIdentity !== this.runtimeIdentity) throw fail('OPERATION_RUNTIME_STALE', 'The current Remux runtime differs from the prepared pair.');
    if (!mp3Source && assessment.inputFamily !== 'mpegts') await observeNativeInventory({file,probe:source,identity,signal,family:assessment.inputFamily,target:assessment.target,
      sourceEnvelope:operationPlan.sourceEnvelope,selectedIndexes:assessment.expectedOutput.streams.map(s=>s.inputIndex),
      ...deriveRemuxAssessmentBudget(assessment,identity.size,operationPlan.verificationMethod).budget});
    if (assessment.inputFamily === 'isobmff') {
      const budget = deriveRemuxAssessmentBudget(assessment, identity.size, operationPlan.verificationMethod).budget;
      const playback = await observeRemuxSourcePlayback({ file, probe: source, identity, signal, target: assessment.target,
        selectedIndexes: assessment.expectedOutput.streams.map(stream => stream.inputIndex), ...budget });
      if (operationPlan.sourceEnvelope === WINDOWS_TWO_AAC) {
        await observeTwoAacNative({ file, probe: source, identity, playback, signal, ...budget });
      }
    }
    const transportPreparation = assessment.inputFamily === 'mpegts' ? await prepareTransport({ file, probe: source, identity, ffprobe: this.ffprobe,
      ffmpeg: this.runtimeIdentity === REGULAR_WINDOWS_PAIR ? this.ffmpeg : null,
      run: typeof this.operationRuntime.invoke === 'function'
        ? (binary, args, options) => {
          if (binary !== this.ffprobe && (binary !== this.ffmpeg || this.runtimeIdentity !== REGULAR_WINDOWS_PAIR))
            throw fail('OPERATION_RUNTIME_STALE', 'The transport read requires an exact observed media tool.');
          return this.operationRuntime.invoke(operationRuntimeToken, binary === this.ffprobe ? 'ffprobe' : 'ffmpeg', args, options);
        } : this.run,
      signal, budget: deriveRemuxAssessmentBudget(assessment, identity.size, 'packet-identity-v1').budget }) : null;
    return { operationRuntimeToken, transportPreparation };
  });
  this.remuxPreparationTail = admission.then(() => {}, () => {});
  let operationRuntimeToken, transportPreparation;
  try { ({ operationRuntimeToken, transportPreparation } = await admission); }
  catch (error) { item.remux.status = 'blocked'; item.remux.blockers = [{ code: error.code, message: error.message, streamIndex: null }]; throw error; }
  const qualificationBindings = { plan: operationPlan, settings: null, sourceIdentity: identity,
    sourceProbeFingerprint: remuxProbeFingerprint(source, assessment.inputFamily), runtimeIdentity: this.runtimeIdentity,
    environment: null, budget: this.operationEvidenceBudget, executionBudgetMs: this.operationDeadlineMs };
  const qualificationSelection = this.remuxOperations.select(qualificationBindings);
  const entry = { remux: true, remuxOwner: this.plan, preparedPlanId: this.plan.id,
    remuxRequest: request, remuxAssessment: assessment, transportPreparation, ...(mp3Source ? { mp3Source } : {}),
    ...(mkvAacClock ? { mkvAacClock } : {}), file, destination, inspection, fingerprint: identity,
    overridden: this.plan.overrides.has(item.id), reencodeAuthorized: item.reencodeAuthorized,
    sourceOutputId: marker.outputId || indexed?.outputId, outputId, operationPlan,
    preparedArgs: Object.freeze([...operationPlan.args.slice(0, -1), OUTPUT_PLACEHOLDER]),
    qualificationBindings, qualificationSelection, operationRuntimeToken };
  // The shared service publishes the prepared entry and the Ready row together
  // after the file inspection journal and current-owner check settle.
  return { entry, ready: { status: 'ready', summary: inspection.summary,
    reason: item.reencodeAuthorized ? 'Explicitly authorized as a Remux source for this prepared batch only.' : '',
    remux: { ...item.remux, status: 'qualified' },
    verificationMethod: operationPlan.verificationMethod, verificationClaim: operationPlan.verificationClaim } };
}

function setRemuxOmissions(request) {
  const keys = ['planId', 'draftId', 'revision', 'decisionIds'];
  if (!request || Object.keys(request).length !== keys.length || keys.some(key => !Object.hasOwn(request, key))) {
    throw fail('INVALID_REMUX_REQUEST', 'Supply only current plan, draft, revision and selected omission identifiers.');
  }
  const plan = this.requireEditableDraft(request.planId);
  const snapshot = plan.draft.snapshot();
  if (plan.operation !== 'remux' || request.draftId !== snapshot.id || request.revision !== snapshot.revision
      || !Array.isArray(request.decisionIds) || request.decisionIds.length > 1024
      || new Set(request.decisionIds).size !== request.decisionIds.length) throw fail('REMUX_OMISSION_STALE', 'Review the current Remux stream decisions.');
  // A host that cannot honor an omission must refuse it before invalidating a
  // valid draft. Empty submissions must not trigger a needless reprepare.
  if (this.remuxOmissionDecisionsSupported === false) {
    throw fail('REMUX_OMISSIONS_UNAVAILABLE', 'Stream omission is unavailable in this build. The prepared batch was not changed.');
  }
  const decisions = request.decisionIds.map(value => {
    if (typeof value !== 'string') throw fail('REMUX_OMISSION_STALE', 'Only current stream decision identifiers are accepted.');
    const decision = plan.remuxCandidates.get(value);
    if (!decision || decision.planId !== plan.id || decision.draftId !== snapshot.id || decision.draftRevision !== snapshot.revision) {
      throw fail('REMUX_OMISSION_STALE', 'A selected omission belongs to another preparation, stream or target.');
    }
    return decision;
  });
  // This is one explicit exact-set action, not automatic grant renewal. The
  // ordinary preference draft stores no authority. Revalidation below occurs
  // under closed preparation admission before any new plan can start.
  plan.draft.invalidatePreparedChoices({ draftId: snapshot.id, revision: snapshot.revision });
  return this.reprepareDraft({ remuxDecisions: decisions });
}

async function installRemuxDecisions(decisions, signal) {
  const current = new Map();
  for (const decision of decisions) {
    if (!current.has(decision.fileId)) current.set(decision.fileId, await readSourceIdentity(decision.identity.canonicalPath, { signal }));
    if (!sameIdentity(current.get(decision.fileId), decision.identity)) throw fail('INPUT_CHANGED', 'A selected stream source changed. Prepare again.');
  }
  const revision = this.plan.draft.snapshot().revision;
  for (const decision of decisions) this.plan.remuxGrants.set(decision.id,
    { ...decision, planId: this.plan.id, draftRevision: revision, draftId: this.plan.draft.id });
}


function currentAudioChoice(choice, plan, request, clock, identity, stream, runtimeIdentity) {
  return choice?.planId === plan.id && choice.draftId === plan.draft.id
    && choice.fileId === request.fileId && choice.draftRevision === request.draftRevision
    && choice.identityRevision === request.identityRevision && choice.target === 'mp4' && request.target === 'mp4'
    && choice.runtimeIdentity === runtimeIdentity && choice.sourceSha256 === clock.sha256
    && choice.shiftSamples === clock.shiftSamples && choice.streamFingerprint === hash(stream)
    && sameIdentity(choice.identity, identity);
}

function setRemuxAudioChoices(request) {
  const keys = ['planId', 'draftId', 'revision', 'decisionIds'];
  if (!request || Object.keys(request).length !== keys.length || keys.some(key => !Object.hasOwn(request, key))) {
    throw fail('INVALID_REMUX_REQUEST', 'Supply only the current plan, draft, revision and explicit audio choices.');
  }
  if (!this.remuxOperations?.allowsMkvAacClock?.('mp4')) {
    throw fail('REMUX_AUDIO_SHIFT_UNAVAILABLE', 'The measured Matroska audio shift is unavailable in this build.');
  }
  const plan = this.requireEditableDraft(request.planId), snapshot = plan.draft.snapshot();
  if (plan.operation !== 'remux' || request.draftId !== snapshot.id || request.revision !== snapshot.revision
      || !Array.isArray(request.decisionIds) || request.decisionIds.length > 1024
      || new Set(request.decisionIds).size !== request.decisionIds.length) {
    throw fail('REMUX_AUDIO_SHIFT_STALE', 'Review the current per-file audio shift choices.');
  }
  const choices = request.decisionIds.map(value => {
    const choice = typeof value === 'string' && plan.remuxAudioOffers.get(value);
    if (!choice || choice.planId !== plan.id || choice.draftId !== snapshot.id || choice.draftRevision !== snapshot.revision
        || choice.runtimeIdentity !== this.runtimeIdentity || choice.target !== 'mp4') {
      throw fail('REMUX_AUDIO_SHIFT_STALE', 'An audio choice belongs to another file, target or preparation.');
    }
    return choice;
  });
  if (new Set(choices.map(row => row.fileId)).size !== choices.length) {
    throw fail('REMUX_AUDIO_SHIFT_STALE', 'Each file can have only one audio shift choice.');
  }
  plan.draft.invalidatePreparedChoices({ draftId: snapshot.id, revision: snapshot.revision });
  return this.reprepareDraft({ remuxAudioChoices: choices, remuxDecisions: [...plan.remuxGrants.values()] });
}

function installRemuxAudioChoices(choices) {
  const snapshot = this.plan.draft.snapshot();
  for (const choice of choices) {
    this.plan.remuxAudioChoices.set(choice.fileId,
      { ...choice, planId: this.plan.id, draftId: snapshot.id, draftRevision: snapshot.revision });
  }
}

module.exports = { prepareRemuxItem, setRemuxOmissions, setRemuxAudioChoices, requireRemuxGrants,
  installRemuxDecisions, installRemuxAudioChoices, remuxOutputName };
