'use strict';

// Main's production wiring. Neither persisted state nor renderer requests can
// choose a catalog, executable, device observation or evidence namespace.
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { OperationRuntimeObserver, parseNvidiaObservation } = require('./operation-runtime.cjs');
const { OperationFamilySelector } = require('./operation-family.cjs');
const { openEvidenceStorage } = require('./operation-storage.cjs');

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
function createOperationControls({ runtime, stateDir, families, policyIdentity }) {
  const observer = new OperationRuntimeObserver({ runtime: { ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe },
    pins: Object.fromEntries(['ffmpeg', 'ffprobe'].map((name, index) => [name,
      { sizeBytes: runtime.verified[index].sizeBytes, sha256: runtime.verified[index].sha256 }])), observeNvidia });
  return { operationQualifications: new OperationFamilySelector({ families, policyIdentity }),
    operationRuntime: observer, operationTelemetry: true, operationEvidenceBudget: EVIDENCE_BUDGET,
    operationDeadlineMs: EXECUTION_BUDGET_MS,
    // Lazy admission: unavailable retained-evidence storage refuses a changed
    // operation without preventing ordinary Full application startup.
    operationStorage: () => openEvidenceStorage({ root: path.join(stateDir, 'operation-evidence') }) };
}
module.exports = { createOperationControls, EVIDENCE_BUDGET, EXECUTION_BUDGET_MS };
