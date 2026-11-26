'use strict';

// Main's production wiring. Neither persisted state nor renderer requests can
// choose a catalog, executable, device observation or evidence namespace.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createHash } = require('node:crypto');
const { OperationRuntimeObserver, parseNvidiaObservation } = require('./operation-runtime.cjs');
const { OperationFamilySelector } = require('./operation-family.cjs');
const { openEvidenceStorage } = require('./operation-storage.cjs');
const { RemuxOperations } = require('./remux-operation.cjs');
const { REMUX_POLICIES, REMUX_POLICY_ID, REGULAR_WINDOWS_REMUX_POLICIES, REGULAR_WINDOWS_REMUX_POLICY_ID } = require('./remux-catalog.cjs');
const { REGULAR_WINDOWS_PAIR } = require('./regular-windows-runtime.cjs');
const { WINDOWS_AAC_FAMILY, EXPLICIT_AAC_DISCARD_CLOCK, EXPLICIT_AAC_DISCARD_ALIGNMENT } = require('./operation-aac-discard-clock.cjs');
const { FAMILIES, POLICY_ID } = require('./operation-catalog.cjs');
const { UHD_FULL_FAMILY_ID, UHD_FULL_RESOURCE_POLICY, RESIZE_1440_FAMILY_ID, RESIZE_1440_RESOURCE_POLICY } =
  require('./operation-resource-budget.cjs');
const { HdrOperations } = require('./hdr-operation.cjs');
const { HDR_POLICIES, HDR_POLICY_ID } = require('./hdr-catalog.cjs');
const { EncodePreservationOperations } = require('./encode-preservation.cjs');
const { loadEncodePreservationPolicies, ENCODE_PRESERVATION_POLICY_ID } = require('./encode-preservation-catalog.cjs');

const EVIDENCE_BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000,
  maxFrameBytes: 8 * 1024 * 1024, maxPcmBytes: 128 * 1024 * 1024,
  maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const EXECUTION_BUDGET_MS = 600000;

const RESIZE_SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const RESIZE_TOLERANCES = Object.freeze({ videoTimestampUs: 1067, audioTimestampUs: 1042,
  avSyncUs: 2109, durationUs: 1088, sampleCount: 0 });
const RESIZE_LONG_RUN = '73532990-b3ff-4aef-81fd-2e8809d56f80';

function resizeFamily(id, resourcePolicy, evidence, shortRun) {
  const endpointId = `windows-91-q2n:${RESIZE_LONG_RUN}:${evidence}:endpoints`;
  const interiorId = `windows-91-q2n:${RESIZE_LONG_RUN}:${evidence}:interior`;
  return Object.freeze({
    id, resourcePolicy, runtimeIdentity: REGULAR_WINDOWS_PAIR, environment: null, settings: RESIZE_SETTINGS,
    qualification: Object.freeze({ evidenceId: endpointId, runtimeIdentity: REGULAR_WINDOWS_PAIR,
      containerDuration: 'end-timestamp', tolerances: RESIZE_TOLERANCES }),
    timingQualification: Object.freeze({ evidenceId: interiorId, runtimeIdentity: REGULAR_WINDOWS_PAIR,
      videoDurationUs: 1067, audioTimelineUs: 1042, aac: null }),
    evidenceIds: Object.freeze([endpointId, interiorId, `windows-91-q2n:${shortRun}:${evidence}:short`]),
  });
}

const WINDOWS_AAC_LAB = 'c38c5ef3-0e2f-428d-ad66-0bd7c61faf3f';
const WINDOWS_AAC_SERVICE = '6822d578-d758-4f1b-91a1-e5f7bcf8973c';
const WINDOWS_AAC_ENDPOINT = WINDOWS_AAC_LAB + ':endpoints';
const WINDOWS_AAC_INTERIOR = WINDOWS_AAC_LAB + ':interior';
const WINDOWS_AAC_RANGE = Object.freeze({
  id: WINDOWS_AAC_FAMILY, runtimeIdentity: REGULAR_WINDOWS_PAIR, environment: null, settings: RESIZE_SETTINGS,
  budget: EVIDENCE_BUDGET, executionBudgetMs: EXECUTION_BUDGET_MS,
  qualification: Object.freeze({ evidenceId: WINDOWS_AAC_ENDPOINT, runtimeIdentity: REGULAR_WINDOWS_PAIR,
    containerDuration: EXPLICIT_AAC_DISCARD_CLOCK,
    tolerances: Object.freeze({ videoTimestampUs: 1067, audioTimestampUs: 1046, avSyncUs: 2113, durationUs: 1088, sampleCount: 0 }) }),
  timingQualification: Object.freeze({ evidenceId: WINDOWS_AAC_INTERIOR, runtimeIdentity: REGULAR_WINDOWS_PAIR,
    videoDurationUs: 1067, audioTimelineUs: 1046, aac: Object.freeze({ alignment: EXPLICIT_AAC_DISCARD_ALIGNMENT,
      encoderDelaySamples: 1024, discardPaddingSamples: null }) }),
  evidenceIds: Object.freeze([WINDOWS_AAC_ENDPOINT, WINDOWS_AAC_INTERIOR, WINDOWS_AAC_SERVICE + ':two-published-holdouts']),
});
const REGULAR_WINDOWS_ENCODE = Object.freeze({
  policyIdentity: 'encode-windows-9.1-v2:2026-11-22:cpu-resize-and-explicit-aac-discard',
  families: Object.freeze([
    resizeFamily(UHD_FULL_FAMILY_ID, UHD_FULL_RESOURCE_POLICY, 'uhd-full', '7a86e7e6-296b-4b7a-b478-171b58c6263a'),
    resizeFamily(RESIZE_1440_FAMILY_ID, RESIZE_1440_RESOURCE_POLICY, '1440p-range', '382855fe-cf94-41e2-a4a7-cf30ccf58a78'),
    WINDOWS_AAC_RANGE,
  ]),
});

// Only choose the kind of budget here. The selector still requires a genuine
// plan, exact source family, runtime observation and frozen quality settings.
function usesRegularResizeBudget(plan, settings) {
  if (plan?.runtimeIdentity !== REGULAR_WINDOWS_PAIR || plan.compatibilityPath
      || plan.expectedOutput?.color?.classification !== 'sdr'
      || settings?.profileId !== RESIZE_SETTINGS.profileId
      || settings.preset !== RESIZE_SETTINGS.preset || settings.quality !== RESIZE_SETTINGS.quality) return false;
  const { request, geometry, range } = plan.contract;
  if (request.target !== 'matroska' || request.audioPolicy !== 'precision-flac' || !geometry.filterRequired) return false;
  const { width, height } = geometry.source;
  return (range.kind === 'full' && width === 3840 && height === 2160 && ['1440', '1080', '720'].includes(request.resolution))
    || (range.kind === 'range' && width === 2560 && height === 1440 && request.resolution === '720');
}
async function observeNvidia({ signal } = {}) {
  const executable = path.join(process.env.SystemRoot, 'System32', 'nvidia-smi.exe');
  const { stdout } = await promisify(execFile)(executable,
    ['--query-gpu=uuid,driver_version', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 10000, maxBuffer: 65536, signal });
  return parseNvidiaObservation(stdout);
}
function createOperationControls({ runtime, stateDir, families, policyIdentity,
  remuxPolicies, remuxPolicyIdentity,
  hdrPolicies = HDR_POLICIES, hdrPolicyIdentity = HDR_POLICY_ID,
  encodePreservationPolicies = loadEncodePreservationPolicies(), encodePreservationPolicyIdentity = ENCODE_PRESERVATION_POLICY_ID }) {
  const observer = new OperationRuntimeObserver({ runtime: { ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe },
    pins: Object.fromEntries(['ffmpeg', 'ffprobe'].map((name, index) => [name,
      { sizeBytes: runtime.verified[index].sizeBytes, sha256: runtime.verified[index].sha256 }])), observeNvidia });
  const runtimeIdentity = createHash('sha256').update(JSON.stringify(runtime.verified.slice(0, 2)
    .map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 })))).digest('hex');
  const regularWindows = runtimeIdentity === REGULAR_WINDOWS_PAIR;
  const defaultEncodeCatalog = families === undefined && policyIdentity === undefined;
  const encodeCatalog = defaultEncodeCatalog
    ? (regularWindows ? REGULAR_WINDOWS_ENCODE : { families: FAMILIES, policyIdentity: POLICY_ID })
    : { families, policyIdentity };
  return { operationQualifications: new OperationFamilySelector(encodeCatalog),
    ...(encodeCatalog === REGULAR_WINDOWS_ENCODE ? { usesProportionalEncodeBudget: usesRegularResizeBudget } : {}),
    remuxOperations: new RemuxOperations({ runtimeIdentity,
      policies: remuxPolicies ?? (regularWindows ? REGULAR_WINDOWS_REMUX_POLICIES : REMUX_POLICIES),
      policyIdentity: remuxPolicyIdentity ?? (regularWindows ? REGULAR_WINDOWS_REMUX_POLICY_ID : REMUX_POLICY_ID) }),
    hdrOperations: new HdrOperations({ runtimeIdentity, policies: hdrPolicies, policyIdentity: hdrPolicyIdentity }),
    encodePreservationOperations: new EncodePreservationOperations({ runtimeIdentity, policies: encodePreservationPolicies, policyIdentity: encodePreservationPolicyIdentity }),
    operationRuntime: observer, operationTelemetry: true, operationEvidenceBudget: EVIDENCE_BUDGET,
    operationDeadlineMs: EXECUTION_BUDGET_MS,
    // Lazy admission: unavailable retained-evidence storage refuses a changed
    // operation without preventing ordinary Full application startup.
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }) };
}
module.exports = { createOperationControls, EVIDENCE_BUDGET, EXECUTION_BUDGET_MS };
