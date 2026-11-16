'use strict';
// Main-owned resource forecasts, not timing tolerances or media qualifications.
// Versioned conservative coefficients are frozen before the first campaign.
// Streaming keeps memory bounded independently of total permitted byte counts.
const RESOURCE_POLICY = 'cfr720p30-flac-resources-v1';
const FAMILY_ID = 'cfr-sdr-range-flac-v2';
const RESIZE_FAMILY_ID = 'cfr-sdr-range-resize-flac-v1';
const RESIZE_RESOURCE_POLICY = 'cfr1080p30-to720p-flac-resources-v1';
const FULL_RESIZE_FAMILY_ID = 'cfr-sdr-full-resize-flac-v1';
const FULL_RESIZE_RESOURCE_POLICY = 'cfr1080p30-full-to720p-flac-resources-v1';
const FULL_1440_RESIZE_FAMILY_ID = 'cfr-sdr-full-1440-to720-flac-v1';
const FULL_1440_RESIZE_RESOURCE_POLICY = 'cfr1440p30-full-to720p-flac-resources-v1';
const MiB = 1024n * 1024n, TIMER = 2147483647n;
const fault = message => { throw Object.assign(new Error(message), { code: 'OPERATION_RESOURCE_CAPACITY' }); };
const ceil = (n, d) => (n + d - 1n) / d;
function integer(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) fault(`${label} needs a positive exact integer.`);
  return BigInt(value);
}
function number(value, label, maximum = BigInt(Number.MAX_SAFE_INTEGER)) {
  if (value <= 0n || value > maximum) fault(`${label} exceeds the current resource capacity; no truncation or fallback is permitted.`);
  return Number(value);
}
function deriveResources({ sourceExtentUs, selectedExtentUs, sourceBytes }, decodePerSecond, scaling) {
  const source = integer(sourceExtentUs, 'Source extent'), selected = integer(selectedExtentUs, 'Selected extent');
  if (selected > source) fault('Selected extent exceeds source extent.');
  if (typeof sourceBytes !== 'string' || !/^[1-9]\d{0,18}$/.test(sourceBytes)) fault('Exact positive source size is required.');
  number(BigInt(sourceBytes), 'Source size');
  // Conservative frozen I/O scheduling allowance: 64 MiB/s per complete
  // read, two passes per child / eight across the job. Not measured throughput.
  const ioMs = ceil(BigInt(sourceBytes) * 1000n, 64n * MiB);
  const sourceSeconds = ceil(source, 1000000n), selectedSeconds = ceil(selected, 1000000n);
  // 256 records/s allows fragmented PCM/FLAC frames beyond ordinary packet
  // sizes. Exhaustion is a resource refusal, never evidence of corrupt media.
  const sourceRecords = 20000n + sourceSeconds * 256n;
  const selectedRecords = 1024n + selectedSeconds * 256n;
  const frameBytes = sourceRecords * 1024n;
  // Complete source PCM is read even for a late short selection. One sample
  // plus a millisecond of endpoint rounding remains within this 1 s allowance.
  const sourcePcm = ceil(source * 48000n, 1000000n) * 4n + 192000n;
  const outputPcm = ceil(selected * 48000n, 1000000n) * 4n + 192000n;
  const telemetryBytes = selectedRecords * 256n;
  const spoolBytes = MiB + selectedRecords * 3n * 512n;
  const reserve = 16n * MiB + spoolBytes + telemetryBytes * 2n;
  // Preserve existing telemetry/storage structural capacities. These are
  // explicit resource limits, not a new fixed source/range-duration promise.
  number(reserve, 'Evidence reservation', 1024n * MiB - 65536n);
  number(telemetryBytes, 'Telemetry bytes', 256n * MiB);
  number(selectedRecords, 'Telemetry records', 10000000n);
  // Fixed 1080p input has 9/4 and fixed 1440p has 4 times the 720p source pixels.
  // Charge complete decoding and selected scaling at the matching fixed
  // coefficient. Output encoding stays 720p. These are frozen
  // conservative scheduling allowances, NOT measured hardware throughput.
  // Aggregate CPU allowances are twice per-child, as in the original policy.
  const decodeMs = sourceSeconds * decodePerSecond;
  const scaleMs = scaling ? selectedSeconds * decodePerSecond : 0n;
  const timeoutMs = number(30000n + decodeMs + scaleMs + selectedSeconds * 15000n + 2n * ioMs, 'Child deadline', TIMER);
  const executionBudgetMs = number(60000n + 2n * (decodeMs + scaleMs) + selectedSeconds * 30000n + 8n * ioMs, 'Operation deadline', TIMER);
  // Five frame/packet passes plus margin, and both complete PCM streams.
  const evidenceBytes = 7n * frameBytes + sourcePcm + outputPcm;
  const budget = Object.freeze({ sourceDecode: 'complete', timeoutMs,
    maxFrameBytes: number(frameBytes, 'Frame bytes', 1024n * MiB), maxPcmBytes: number(sourcePcm, 'PCM bytes', 1024n * MiB),
    maxRecords: number(sourceRecords, 'Frame records'), maxSpoolBytes: number(spoolBytes, 'Spool bytes') });
  const resources = Object.freeze({ pipeBytes: number(evidenceBytes + 16n * MiB, 'Aggregate pipe bytes'),
    evidenceBytes: number(evidenceBytes, 'Aggregate evidence bytes'), maxChildren: 64,
    evidenceReserveBytes: number(reserve, 'Evidence reservation'), stallMs: null,
    telemetryBytes: number(telemetryBytes, 'Telemetry bytes'), telemetryRecords: number(selectedRecords, 'Telemetry records') });
  return Object.freeze({ budget, resources, executionBudgetMs });
}
function deriveCfrFlacResources(options) { return deriveResources(options, 1500n, false); }
function deriveCfrResizeFlacResources(options) { return deriveResources(options, 3375n, true); }
// Full has no invented interval: every source stream is processed to its own
// end. The selector supplies the maximum observed video/audio/container extent
// as both decoding and output workload, conservatively including audio tails.
function deriveCfrFullResizeFlacResources({ sourceExtentUs, sourceBytes }) {
  return deriveResources({ sourceExtentUs, selectedExtentUs: sourceExtentUs, sourceBytes }, 3375n, true);
}
// Fixed 1440p has four times the 720p source pixels. Only this separately
// qualified Full variant supplies the 6000 ms coefficient; no caller can
// choose geometry or coefficients. Output 720p and audio/record budgets stay fixed.
function deriveCfrFull1440ResizeFlacResources({ sourceExtentUs, sourceBytes }) {
  return deriveResources({ sourceExtentUs, selectedExtentUs: sourceExtentUs, sourceBytes }, 6000n, true);
}
module.exports = { FULL_1440_RESIZE_FAMILY_ID, FULL_1440_RESIZE_RESOURCE_POLICY, deriveCfrFull1440ResizeFlacResources, FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY, deriveCfrFullResizeFlacResources, RESOURCE_POLICY, FAMILY_ID, deriveCfrFlacResources, RESIZE_RESOURCE_POLICY, RESIZE_FAMILY_ID, deriveCfrResizeFlacResources };
