'use strict';
// Main-owned resource forecasts, not timing tolerances or media qualifications.
// Versioned conservative coefficients are frozen before the first campaign.
// Streaming keeps memory bounded independently of total permitted byte counts.
const AAC_FAMILY_ID = 'cfr-sdr-range-aac-v2';
const AAC_RESOURCE_POLICY = 'cfr720p30-aac-resources-v1';
const AAC_DECODED_TAIL_SAMPLES = 1024; // 1023 AAC terminal samples + one exact 48 kHz source tick.
const RESOURCE_POLICY = 'cfr720p30-flac-resources-v1';
const FAMILY_ID = 'cfr-sdr-range-flac-v2';
const RESIZE_FAMILY_ID = 'cfr-sdr-range-resize-flac-v1';
const RESIZE_1440_FAMILY_ID = 'cfr-sdr-range-resize1440-flac-v1';
const RESIZE_1440_RESOURCE_POLICY = 'cfr1440p30-to720p-flac-resources-v1';
const RESIZE_RESOURCE_POLICY = 'cfr1080p30-to720p-flac-resources-v1';
const FULL_RESIZE_FAMILY_ID = 'cfr-sdr-full-resize-flac-v1';
const FULL_RESIZE_RESOURCE_POLICY = 'cfr1080p30-full-to720p-flac-resources-v1';
const FULL_1440_RESIZE_FAMILY_ID = 'cfr-sdr-full-1440-to720-flac-v1';
const FULL_1440_RESIZE_RESOURCE_POLICY = 'cfr1440p30-full-to720p-flac-resources-v1';
const FULL_COPY_FAMILY_ID = 'cfr-sdr-full-resize-copy-v1';
const FULL_COPY_RESOURCE_POLICY = 'cfr1080p30-full-to720-copy-resources-v1';
const UHD_FULL_FAMILY_ID = 'cfr-sdr-uhd-full-resize-flac-v1';
const UHD_FULL_RESOURCE_POLICY = 'cfr2160p30-full-to1440-1080-720-flac-resources-v1';
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
function deriveResources({ sourceExtentUs, selectedExtentUs, sourceBytes }, decodePerSecond, scaling, aacTail = false, fullCopy = false, encodePerSecond = 15000n) {
  const source = integer(sourceExtentUs, 'Source extent'), selected = integer(selectedExtentUs, 'Selected extent');
  if (selected > source) fault('Selected extent exceeds source extent.');
  if (typeof sourceBytes !== 'string' || !/^[1-9]\d{0,18}$/.test(sourceBytes)) fault('Exact positive source size is required.');
  number(BigInt(sourceBytes), 'Source size');
  // Conservative frozen I/O scheduling allowance: 64 MiB/s per complete
  // read, two passes per child / eight across the job. Not measured throughput.
  const ioMs = ceil(BigInt(sourceBytes) * 1000n, 64n * MiB);
  // AAC decode can exceed reported metadata by1023 samples plus one source tick.
  // Forecast source and output workloads conservatively; never alter the requested interval.
  const tail = aacTail ? BigInt(AAC_DECODED_TAIL_SAMPLES) : 0n;
  const tailUs = ceil(tail * 1000000n, 48000n), pcmWidth = aacTail ? 8n : 4n;
  const sourceSeconds = ceil(source + tailUs, 1000000n), selectedSeconds = ceil(selected + tailUs, 1000000n);
  // 256 records/s allows fragmented PCM/FLAC frames beyond ordinary packet
  // sizes. Exhaustion is a resource refusal, never evidence of corrupt media.
  const sourceRecords = 20000n + sourceSeconds * 256n;
  const selectedRecords = 1024n + selectedSeconds * 256n;
  const frameBytes = sourceRecords * 1024n;
  // Complete source PCM is read even for a late short selection. One sample
  // plus a millisecond of endpoint rounding remains within this 1 s allowance.
  const sourcePcm = (ceil(source * 48000n, 1000000n) + tail) * pcmWidth + 48000n * pcmWidth;
  const outputPcm = (ceil(selected * 48000n, 1000000n) + tail) * pcmWidth + 48000n * pcmWidth;
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
  const timeoutMs = number(30000n + decodeMs + scaleMs + selectedSeconds * encodePerSecond + 2n * ioMs, 'Child deadline', TIMER);
  const executionBudgetMs = number(60000n + 2n * (decodeMs + scaleMs) + selectedSeconds * 2n * encodePerSecond + 8n * ioMs, 'Operation deadline', TIMER);
  // Five frame/packet passes plus margin, and both complete PCM streams.
  // Full copy: nine collector streams (two video/two audio frame scans,
  // output padding, two packet identities and two headers), no PCM decode.
  // Each is conservatively charged the complete-source frame/record cap.
  const evidenceBytes = fullCopy ? 9n * frameBytes : 7n * frameBytes + sourcePcm + outputPcm;
  const budget = Object.freeze({ sourceDecode: 'complete', timeoutMs,
    maxFrameBytes: number(frameBytes, 'Frame bytes', 1024n * MiB), maxPcmBytes: number(sourcePcm, 'PCM bytes', 1024n * MiB),
    maxRecords: number(sourceRecords, 'Frame records'), maxSpoolBytes: number(spoolBytes, 'Spool bytes') });
  const resources = Object.freeze({ pipeBytes: number(evidenceBytes + 16n * MiB, 'Aggregate pipe bytes'),
    evidenceBytes: number(evidenceBytes, 'Aggregate evidence bytes'), maxChildren: 64,
    evidenceReserveBytes: number(reserve, 'Evidence reservation'), stallMs: null,
    telemetryBytes: number(telemetryBytes, 'Telemetry bytes'), telemetryRecords: number(selectedRecords, 'Telemetry records') });
  return Object.freeze({ budget, resources, executionBudgetMs });
}
// Eight bytes/sample-frame cover stereo float32 calibration, not lossless AAC identity.
function deriveCfrAacResources(options) { return deriveResources(options, 1500n, false, true); }
function deriveCfrFlacResources(options) { return deriveResources(options, 1500n, false); }
// Fixed 1440p range input has four times 720p pixels: 1500 * 4.
// Same conservative scheduling model as Full1440, not measured throughput.
function deriveCfrResize1440FlacResources(options) { return deriveResources(options, 6000n, true); }
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
function deriveCfrFullResizeCopyResources({ sourceExtentUs, sourceBytes }) {
  return deriveResources({ sourceExtentUs, selectedExtentUs: sourceExtentUs, sourceBytes }, 3375n, true, false, true);
}
// UHD input decode/scale: nine times 720p pixels. Output encoding is charged
// at its own pixel ratio, not the old fixed 720p allowance. These are conservative
// scheduling forecasts, not measured speed or runtime qualification.
function deriveCfrUhdFullFlacResources({ sourceExtentUs, sourceBytes, resolution }) {
  const coefficients = { '1440': 60000n, '1080': 33750n, '720': 15000n };
  if (!Object.hasOwn(coefficients, resolution)) fault('Unsupported UHD output resolution.');
  return deriveResources({ sourceExtentUs, selectedExtentUs: sourceExtentUs, sourceBytes }, 13500n, true, false, false, coefficients[resolution]);
}
module.exports = { UHD_FULL_FAMILY_ID, UHD_FULL_RESOURCE_POLICY, deriveCfrUhdFullFlacResources, RESIZE_1440_FAMILY_ID, RESIZE_1440_RESOURCE_POLICY, deriveCfrResize1440FlacResources, FULL_COPY_FAMILY_ID, FULL_COPY_RESOURCE_POLICY, deriveCfrFullResizeCopyResources, AAC_FAMILY_ID, AAC_RESOURCE_POLICY, AAC_DECODED_TAIL_SAMPLES, deriveCfrAacResources, FULL_1440_RESIZE_FAMILY_ID, FULL_1440_RESIZE_RESOURCE_POLICY, deriveCfrFull1440ResizeFlacResources, FULL_RESIZE_FAMILY_ID, FULL_RESIZE_RESOURCE_POLICY, deriveCfrFullResizeFlacResources, RESOURCE_POLICY, FAMILY_ID, deriveCfrFlacResources, RESIZE_RESOURCE_POLICY, RESIZE_FAMILY_ID, deriveCfrResizeFlacResources };
