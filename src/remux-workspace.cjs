'use strict';

// Remux-specific presentation and temporary decisions live on the same service
// workspace as Encode. These functions are not renderer-supplied extensions.
const { randomUUID, createHash } = require('node:crypto');
const path = require('node:path');
const { assessRemux, getRemuxAssessmentSource } = require('./remux-contract.cjs');
const { remuxProbeFingerprint } = require('./remux-validation.cjs');
const { fingerprintRemuxSourceIdentity } = require('./remux-operation.cjs');
const { readSourceIdentity, sameIdentity } = require('./source-identity.cjs');
const { normalizeProbe } = require('./inspection.cjs');
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
  const assessment = assessRemux({ request, probe, sourceFingerprint, resolveOmission: resolve });
  // A blocked genuine assessment intentionally cannot issue a builder source
  // capability. Main already owns this inspected data; use its normalized copy
  // only for the refusal/decision view, never as execution authority.
  const source = normalizeProbe(structuredClone(probe));
  const primary = assessment.expectedOutput.selectedVideoInputIndex;
  const candidates = [];
  // Data/timecode/relationship cases remain refused even after a proposed
  // omission. Do not offer a button that falsely promises to resolve them.
  const unsafeRelationships = assessment.blockers.some(value => /RELATIONSHIP|PROGRAM|GROUP/.test(value.code));
  for (const stream of source.streams) {
    if (unsafeRelationships || stream.index === primary || !['audio', 'subtitle', 'attachment'].includes(stream.codec_type)) continue;
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
      action: omitted ? 'explicitly-omitted' : blocked.length ? 'blocked' : 'preserve-copy',
      label: `Stream ${stream.index}: ${stream.codec_type} / ${stream.codec_name || 'unknown'}`,
      reasons: blocked.map(value => value.message), representations: mapped?.metadata?.representations || [] };
  });
  item.remux = { target: request.target, status: 'assessment', streams, blockers: assessment.blockers,
    omissionCandidates: candidates.map(({ id, streamIndex, label, reasons, target }) => ({ id, streamIndex, label, reasons, target })),
    omissionDecisionIds: request.omissionRequestIds,
    notice: 'Full stream copy. Content, timing and functional metadata must validate before publication. Known nonfunctional descriptive tags are copied where possible; differences are reported as warnings.' };
  this.plan.remuxFacts.set(item.id, { file, fingerprint: identity, probe, request, assessment });
  const video = source.streams.find(value => value.index === primary);
  const duration = Number(source.format.duration);
  const inspection = { probe: source, duration,
    summary: { durationSeconds: duration, codec: video?.codec_name, width: video?.width, height: video?.height,
      pixelFormat: video?.pix_fmt, bitDepth: 8, frameRate: null,
      streamCounts: Object.fromEntries(['video', 'audio', 'subtitle', 'attachment', 'data'].map(type => [type, source.streams.filter(value => value.codec_type === type).length])) } };
  item.summary = inspection.summary;
  if (assessment.blockers.length) {
    item.remux.status = 'blocked'; throw fail(assessment.blockers[0].code, assessment.blockers.map(value => value.message).join(' '));
  }
  const outputId = randomUUID();
  let operationPlan;
  try { operationPlan = this.remuxOperations.prepare({ assessment, input: file, output: destination, outputId, sourceIdentity: identity, request }); }
  catch (error) { item.remux.status = 'blocked'; item.remux.blockers = [{ code: error.code, message: error.message, streamIndex: null }]; throw error; }
  const operationRuntimeToken = await this.operationRuntime.observe({ hardware: 'CPU', signal });
  const observed = this.operationRuntime.snapshot(operationRuntimeToken);
  if (observed.runtimeIdentity !== this.runtimeIdentity) throw fail('OPERATION_RUNTIME_STALE', 'The current Remux runtime differs from the prepared pair.');
  const qualificationBindings = { plan: operationPlan, settings: null, sourceIdentity: identity,
    sourceProbeFingerprint: remuxProbeFingerprint(source), runtimeIdentity: this.runtimeIdentity,
    environment: null, budget: this.operationEvidenceBudget, executionBudgetMs: this.operationDeadlineMs };
  const qualificationSelection = this.remuxOperations.select(qualificationBindings);
  this.plan.entries.set(item.id, { remux: true, remuxOwner: this.plan, preparedPlanId: this.plan.id,
    remuxRequest: request, remuxAssessment: assessment, file, destination, inspection, fingerprint: identity,
    overridden: this.plan.overrides.has(item.id), reencodeAuthorized: item.reencodeAuthorized,
    sourceOutputId: marker.outputId || indexed?.outputId, outputId, operationPlan,
    preparedArgs: Object.freeze([...operationPlan.args.slice(0, -1), OUTPUT_PLACEHOLDER]),
    qualificationBindings, qualificationSelection, operationRuntimeToken });
  this.plan.ambiguities.delete(item.id);
  item.remux.status = 'qualified';
  Object.assign(item, { status: 'ready', reason: item.reencodeAuthorized
    ? 'Explicitly authorized as a Remux source for this prepared batch only.' : '' });
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

module.exports = { prepareRemuxItem, setRemuxOmissions, requireRemuxGrants, installRemuxDecisions, remuxOutputName };
