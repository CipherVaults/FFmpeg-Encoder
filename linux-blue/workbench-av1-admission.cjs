'use strict';
// Main-only whole-batch admission for the explicit qualified AV1 composition.
// It does not create receipts, runtime observations, runners or qualifications.
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { OperationFamilySelector, isProportionalFamilySelection } = require('../src/operation-family.cjs');
const { fingerprintEncodeSource } = require('../src/encode-operation.cjs');
const { OperationRuntimeObserver } = require('../src/operation-runtime.cjs');
const { FAMILY_ID, RESIZE_FAMILY_ID, FULL_RESIZE_FAMILY_ID, FULL_1440_RESIZE_FAMILY_ID } = require('../src/operation-resource-budget.cjs');
const { isOrdinaryWorkbenchEntry } = require('./workbench-service.cjs');
const { RUNTIME_ID, PINS } = require('./runtime-av1.cjs');
const fail = message => { throw Object.assign(new Error(message), { code: 'LINUX_AV1_ADMISSION' }); };
function requireQualifiedEntry(service, entry) {
  const operation = entry?.operationPlan, request = operation?.contract?.request;
  if (!entry || operation?.compatibilityPath !== false || !operation.instrumentation
      || !entry.qualificationSelection || !entry.operationRuntimeToken
      || ['native', 'vendor', 'remux', 'hdr', 'encodePreservation'].some(key => entry[key])
      || entry.inspection?.color?.classification !== 'sdr' || entry.inspection.color.supported !== true
      || request?.operation !== 'encode' || request.target !== 'matroska' || request.audioPolicy !== 'precision-flac'
      || !['preserve', 'sdr'].includes(request.hdrPolicy) || request.omissionRequestIds?.length !== 0
      || operation.contract.omissionRequests?.ids?.length !== 0
      || service.plan.settings.profileId !== 'h265-cpu' || service.plan.settings.preset !== 'slow' || service.plan.settings.quality !== 25
      || service.runtimeIdentity !== RUNTIME_ID || service.ffmpeg !== PINS.ffmpeg.path || service.ffprobe !== PINS.ffprobe.path
      || !(service.operationQualifications instanceof OperationFamilySelector)
      || !(service.operationRuntime instanceof OperationRuntimeObserver))
    fail('Only genuinely prepared CPU H265 slow25 proportional SDR operations may start.');
  // Use the base implementation to preserve its private-token check even if a
  // main-owned subclass adds restrictions. No snapshot supplied by IPC is used.
  const observation = OperationRuntimeObserver.prototype.snapshot.call(service.operationRuntime, entry.operationRuntimeToken);
  if (observation.runtimeIdentity !== RUNTIME_ID || observation.environment !== null
      || observation.tools.ffmpeg.canonicalPath !== PINS.ffmpeg.path || observation.tools.ffprobe.canonicalPath !== PINS.ffprobe.path)
    fail('Changed operations require the fixed AV1 runtime observation.');
  const bindings = {
    ...entry.qualificationBindings, plan: operation, settings: service.plan.settings,
    sourceIdentity: entry.fingerprint, sourceProbeFingerprint: fingerprintEncodeSource(entry.inspection.probe),
    runtimeIdentity: service.runtimeIdentity, environment: observation.environment,
    budget: service.operationEvidenceBudget, executionBudgetMs: service.operationDeadlineMs,
  };
  const qualified = OperationFamilySelector.prototype.requireCurrent.call(service.operationQualifications, entry.qualificationSelection, bindings);
  // Preserve extra restrictions supplied by the reviewed clock-qualified subclass.
  if (service.operationQualifications.requireCurrent(entry.qualificationSelection, bindings) !== qualified)
    fail('The selector must return its own current qualification.');
  if (!isProportionalFamilySelection(qualified) || qualified.controlsRequired !== true
      || ![FAMILY_ID, RESIZE_FAMILY_ID, FULL_RESIZE_FAMILY_ID, FULL_1440_RESIZE_FAMILY_ID].includes(qualified.sourcePolicy?.id))
    fail('Only the independently qualified proportional families may start.');
}
class Av1WorkbenchAdmissionService extends EncoderService {
  async prepareRemuxBatch() { fail('Remux is not qualified for this AV1 workbench route.'); }
  startBatch(request) {
    this.requireIdle();
    const plan = this.plan;
    // Delegate invalid/stale selection handling unchanged; none can start.
    if (!plan || this.state.phase !== 'ready' || request?.planId !== plan.id
        || !Array.isArray(request?.fileIds) || !request.fileIds.length
        || new Set(request.fileIds).size !== request.fileIds.length
        || request.fileIds.some(id => !this.state.items.some(item => item.id === id && ['ready', 'conflict'].includes(item.status))))
      return super.startBatch(request);
    if (plan.operation !== 'encode' || plan.sameFolder || PROFILES.find(p => p.id === plan.settings?.profileId)?.hardware !== 'CPU')
      fail('This AV1 workbench admits only separate-folder CPU SDR encoding.');
    // No state changes or superclass execution until every selected entry passes.
    for (const id of request.fileIds) {
      const entry = plan.entries.get(id);
      if (!isOrdinaryWorkbenchEntry(entry)) requireQualifiedEntry(this, entry);
    }
    // Shared service performs async runtime/source rechecks, aggregate limits,
    // no-overwrite publication and child/sink settlement; admission replaces none.
    return super.startBatch(request);
  }
}
module.exports = { Av1WorkbenchAdmissionService };
