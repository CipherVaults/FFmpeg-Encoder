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
const { REMUX_POLICIES, REMUX_POLICY_ID } = require('./remux-catalog.cjs');
const { HdrOperations } = require('./hdr-operation.cjs');
const { HDR_POLICIES, HDR_POLICY_ID } = require('./hdr-catalog.cjs');
const { EncodePreservationOperations } = require('./encode-preservation.cjs');
const { loadEncodePreservationPolicies, ENCODE_PRESERVATION_POLICY_ID } = require('./encode-preservation-catalog.cjs');

const EVIDENCE_BUDGET = Object.freeze({ sourceDecode: 'complete', timeoutMs: 120000,
  maxFrameBytes: 8 * 1024 * 1024, maxPcmBytes: 128 * 1024 * 1024,
  maxRecords: 20000, maxSpoolBytes: 32 * 1024 * 1024 });
const EXECUTION_BUDGET_MS = 600000;
async function observeNvidia({ signal } = {}) {
  const executable = path.join(process.env.SystemRoot, 'System32', 'nvidia-smi.exe');
  const { stdout } = await promisify(execFile)(executable,
    ['--query-gpu=uuid,driver_version', '--format=csv,noheader,nounits'],
    { windowsHide: true, timeout: 10000, maxBuffer: 65536, signal });
  return parseNvidiaObservation(stdout);
}
function createOperationControls({ runtime, stateDir, families, policyIdentity,
  remuxPolicies = REMUX_POLICIES, remuxPolicyIdentity = REMUX_POLICY_ID,
  hdrPolicies = HDR_POLICIES, hdrPolicyIdentity = HDR_POLICY_ID,
  encodePreservationPolicies = loadEncodePreservationPolicies(), encodePreservationPolicyIdentity = ENCODE_PRESERVATION_POLICY_ID }) {
  const observer = new OperationRuntimeObserver({ runtime: { ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe },
    pins: Object.fromEntries(['ffmpeg', 'ffprobe'].map((name, index) => [name,
      { sizeBytes: runtime.verified[index].sizeBytes, sha256: runtime.verified[index].sha256 }])), observeNvidia });
  const runtimeIdentity = createHash('sha256').update(JSON.stringify(runtime.verified.slice(0, 2)
    .map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 })))).digest('hex');
  return { operationQualifications: new OperationFamilySelector({ families, policyIdentity }),
    remuxOperations: new RemuxOperations({ runtimeIdentity, policies: remuxPolicies, policyIdentity: remuxPolicyIdentity }),
    hdrOperations: new HdrOperations({ runtimeIdentity, policies: hdrPolicies, policyIdentity: hdrPolicyIdentity }),
    encodePreservationOperations: new EncodePreservationOperations({ runtimeIdentity, policies: encodePreservationPolicies, policyIdentity: encodePreservationPolicyIdentity }),
    operationRuntime: observer, operationTelemetry: true, operationEvidenceBudget: EVIDENCE_BUDGET,
    operationDeadlineMs: EXECUTION_BUDGET_MS,
    // Lazy admission: unavailable retained-evidence storage refuses a changed
    // operation without preventing ordinary Full application startup.
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }) };
}
module.exports = { createOperationControls, EVIDENCE_BUDGET, EXECUTION_BUDGET_MS };
