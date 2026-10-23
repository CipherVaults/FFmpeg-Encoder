'use strict';

// Temporary Full Encode decisions belong to this exact main-owned workspace.
// Renderer-visible identifiers describe a choice; they carry no media authority.
const { randomUUID } = require('node:crypto');
const { readSourceIdentity, sameIdentity } = require('./source-identity.cjs');
const { fingerprintEncodePreservationProbe, fingerprintEncodePreservationIdentity,
  fingerprintEncodePreservationSettings } = require('./encode-preservation.cjs');
const fail = (code, message) => Object.assign(new Error(message), { code });

function prepareEncodePreservation(item, { probe, identity, settings }) {
  const plan = this.plan, request = item.operationRequest;
  const described = this.encodePreservationOperations?.describe({ probe, request, settings });
  const grants = [...plan.encodePreservationGrants.values()].filter(value => value.fileId === item.id);
  if (!described) {
    if (grants.length) throw fail('ENCODE_PRESERVATION_STALE', 'The acknowledged timecode track or source class changed. Review this file again.');
    return undefined;
  }
  const candidate = { id: grants[0]?.id || randomUUID(), planId: plan.id, draftId: plan.draft.id,
    fileId: item.id, identityRevision: request.identityRevision, draftRevision: request.draftRevision,
    operation: 'encode', target: request.target, action: 'omit-timed-timecode', runtimeIdentity: this.runtimeIdentity,
    settingsFingerprint: fingerprintEncodePreservationSettings(settings), sourceFingerprint: fingerprintEncodePreservationIdentity(identity),
    probeFingerprint: fingerprintEncodePreservationProbe(probe), streamIndex: described.streamIndex,
    streamFingerprint: described.streamFingerprint, relationshipFingerprint: described.relationshipFingerprint,
    identity, label: described.label, reasons: [described.warning.message] };
  plan.encodePreservationCandidates.set(candidate.id, candidate);
  item.encodePreservation = { target: request.target, status: 'blocked', notice: described.notice,
    streams: probe.streams.map(stream => ({ streamIndex: stream.index, codecType: stream.codec_type,
      codecName: stream.codec_name || stream.codec_tag_string, label: `Stream ${stream.index}: ${stream.codec_type} / ${stream.codec_name || stream.codec_tag_string}`,
      action: stream.index === described.streamIndex ? grants.length ? 'explicitly-omitted' : 'blocked'
        : stream.index === described.videoIndex ? 'encode-video' : 'preserve-copy', reasons: stream.index === described.streamIndex ? [described.warning.message] : [] })),
    omissionCandidates: described.applicable ? [{ id: candidate.id, streamIndex: candidate.streamIndex, label: candidate.label,
      reasons: candidate.reasons, target: candidate.target }] : [], omissionDecisionIds: grants.map(value => value.id) };
  if (!described.applicable) throw fail('ENCODE_PRESERVATION_SETTINGS', described.notice);
  if (!grants.length) throw fail('ENCODE_PRESERVATION_DECISION_REQUIRED', 'This source contains a timed timecode track and linked editing/synchronization relationship that cannot be preserved in this Encode output. Review the explicit per-file choice.');
  const selection = this.encodePreservationOperations.prepare({ probe, sourceIdentity: identity, settings, request,
    planId: plan.id, draftId: plan.draft.id, decisionIds: grants.map(value => value.id),
    resolveDecision: value => {
      const grant = plan.encodePreservationGrants.get(value);
      return grant && Object.fromEntries(['id', 'planId', 'draftId', 'fileId', 'identityRevision', 'draftRevision', 'operation', 'target', 'action',
        'runtimeIdentity', 'settingsFingerprint', 'sourceFingerprint', 'probeFingerprint', 'streamIndex', 'streamFingerprint', 'relationshipFingerprint']
        .map(key => [key, grant[key]]));
    } });
  item.encodePreservation.status = 'qualified';
  item.warnings = [described.warning];
  return selection;
}

function requireEncodePreservation(entry, probe) {
  if (!entry?.encodePreservation) return null;
  probe ??= entry.inspection.probe;
  const plan = this.plan;
  if (!plan || plan !== entry.encodePreservationOwner || plan.operation !== 'encode' || plan.id !== entry.preparedPlanId
      || plan.draft.snapshot().revision !== entry.encodePreservationRequest.draftRevision) {
    throw fail('ENCODE_PRESERVATION_STALE', 'The prepared Encode preservation workspace changed. Prepare again.');
  }
  return this.encodePreservationOperations.requireCurrent(entry.encodePreservationSelection, { probe,
    sourceIdentity: entry.fingerprint, request: plan.draft.fileRequest(entry.encodePreservationRequest.fileId),
    settings: plan.settings, planId: plan.id, draftId: plan.draft.id, runtimeIdentity: this.runtimeIdentity });
}

function setEncodePreservationDecisions(request) {
  const keys = ['planId', 'draftId', 'revision', 'decisionIds'];
  if (!request || Object.keys(request).length !== keys.length || keys.some(key => !Object.hasOwn(request, key))) {
    throw fail('INVALID_REQUEST', 'Supply only the current plan, draft, revision and selected preservation identifiers.');
  }
  const plan = this.requireEditableDraft(request.planId), draft = plan.draft.snapshot();
  if (plan.operation !== 'encode' || request.draftId !== draft.id || request.revision !== draft.revision
      || !Array.isArray(request.decisionIds) || request.decisionIds.length > 1024
      || new Set(request.decisionIds).size !== request.decisionIds.length) throw fail('ENCODE_PRESERVATION_STALE', 'Review the current per-file preservation choices.');
  const decisions = request.decisionIds.map(value => {
    const decision = typeof value === 'string' && plan.encodePreservationCandidates.get(value);
    if (!decision || decision.planId !== plan.id || decision.draftId !== draft.id || decision.draftRevision !== draft.revision) {
      throw fail('ENCODE_PRESERVATION_STALE', 'A selected preservation choice belongs to another file, source or preparation.');
    }
    return decision;
  });
  plan.draft.invalidatePreparedChoices({ draftId: draft.id, revision: draft.revision });
  return this.reprepareDraft({ encodePreservationDecisions: decisions });
}

async function installEncodePreservationDecisions(decisions, signal) {
  for (const decision of decisions) {
    const current = await readSourceIdentity(decision.identity.canonicalPath, { signal });
    if (!sameIdentity(current, decision.identity)) throw fail('INPUT_CHANGED', 'The selected timecode source changed. Prepare again.');
    this.plan.encodePreservationGrants.set(decision.id, { ...decision, planId: this.plan.id,
      draftId: this.plan.draft.id, draftRevision: this.plan.draft.snapshot().revision });
  }
}

module.exports = { prepareEncodePreservation, requireEncodePreservation, setEncodePreservationDecisions, installEncodePreservationDecisions };
