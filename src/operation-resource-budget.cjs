'use strict';
// Main-owned resource forecasts, not timing tolerances or media qualifications.
// Versioned conservative coefficients are frozen before the first campaign.
// Streaming keeps memory bounded independently of total permitted byte counts.
const RESOURCE_POLICY = 'cfr720p30-flac-resources-v1';
const FAMILY_ID = 'cfr-sdr-range-flac-v2';
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
function deriveCfrFlacResources({ sourceExtentUs, selectedExtentUs, sourceBytes }) {
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
  const timeoutMs = number(30000n + sourceSeconds * 1500n + selectedSeconds * 15000n + 2n * ioMs, 'Child deadline', TIMER);
  const executionBudgetMs = number(60000n + sourceSeconds * 3000n + selectedSeconds * 30000n + 8n * ioMs, 'Operation deadline', TIMER);
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
module.exports = { RESOURCE_POLICY, FAMILY_ID, deriveCfrFlacResources };
