'use strict';

const { selectVideo } = require('./media.cjs');
const { VENDOR_PROFILES, VENDOR_MESSAGES, vendorPixelFormat } = require('./vendor-profiles.cjs');
const { vendorArgsHash } = require('./vendor-encode.cjs');
const { queryWindowsAdapters, parseAdapterInventory } = require('./windows-adapters.cjs');
const { ToolError, boundedToolStderr } = require('./process-runner.cjs');

function vendorGuard(name, condition, code) {
  if (!condition) throw new ToolError(code, VENDOR_MESSAGES[code]);
}
function vendorRefusal(error) {
  const code = Object.hasOwn(VENDOR_MESSAGES, error?.code) ? error.code : 'VENDOR_ENCODE_FAILED';
  return { reasonCode: code, reason: VENDOR_MESSAGES[code], nativePrivate: {
    code: error?.code, message: error?.message, ...boundedToolStderr(error),
    sourceIdentityDiagnostic: error?.sourceIdentityDiagnostic,
    context: error?.nativePrivate,
  } };
}
function vendorPublicItem(item) {
  // Result state carries status and safe actions. Source identities, retained
  // stage paths and child diagnostics belong to the private incident records.
  const result = { ...item };
  for (const key of ['details', 'sourceIdentityDiagnostic', 'evidenceWarning', 'outputAccessWarning']) delete result[key];
  if (item.sourceAssessment) result.sourceAssessment = { kind: item.sourceAssessment.kind };
  if (item.cleanup) result.cleanup = { retained: item.cleanup.retained, completed: item.cleanup.completed,
    validationCurrent: item.cleanup.validationCurrent };
  if (item.outputDisposition) result.outputDisposition = { kind: item.outputDisposition.kind,
    published: item.outputDisposition.published, validationCurrent: item.outputDisposition.validationCurrent };
  if (item.warnings?.length) result.warnings = [{ code: 'VENDOR_OUTPUT_WARNING', message: 'Output saved with validation warnings. Review the private diagnostic record.' }];
  if (['failed', 'unsupported', 'cancelled'].includes(item.status)) {
    result.reason = VENDOR_MESSAGES[item.reasonCode] || VENDOR_MESSAGES.VENDOR_ENCODE_FAILED;
  } else if (item.status === 'success') result.reason = item.reason === 'Output saved; provenance bookkeeping remains pending.'
    ? item.reason : item.warnings?.length ? 'Output saved with validation warnings.' : '';
  return result;
}
function requireVendorRoute(inspection, request) {
  vendorGuard('sdr', inspection.color?.classification !== 'hdr', 'VENDOR_HDR_DEFERRED');
  vendorGuard('color', inspection.color?.supported === true, 'UNSUPPORTED_COLOR');
  vendorGuard('route', request?.operation === 'encode' && request.target === 'matroska'
    && request.resolution === 'source' && request.range === null && request.audioPolicy === 'copy'
    && ['preserve', 'sdr'].includes(request.hdrPolicy) && request.omissionRequestIds?.length === 0,
  'VENDOR_ROUTE_UNQUALIFIED');
}
function declaredVendorFrames(video) {
  const value = video.nb_frames;
  if (value === undefined || value === null || value === 'N/A') return null;
  vendorGuard('declared-count', (typeof value === 'string' && /^[1-9]\d*$/.test(value)
    || typeof value === 'number') && Number.isSafeInteger(Number(value)) && Number(value) > 0,
  'VENDOR_FRAME_COUNT_MISMATCH');
  return Number(value);
}
function requireVendorArgs(entry) {
  let hash;
  try { hash = vendorArgsHash(entry.preparedArgs); } catch { /* malformed argv is an invalid plan too */ }
  vendorGuard('args-hash', hash !== undefined && hash === entry.vendor.argsHash, 'INVALID_PLAN');
}
const ADAPTER_FIELDS = ['adapterIndex', 'description', 'luid', 'umdVersion', 'vendorId', 'deviceId',
  'subsystemId', 'revision', 'flags', 'dedicatedVideoBytes', 'driverQueryHresult'];
async function requireVendorDevice(binding, { signal, run, adapters = queryWindowsAdapters }) {
  try {
    const observed = await adapters({ signal, run });
    if (signal?.aborted) throw new ToolError('CANCELLED', 'Encoding cancelled.');
    vendorGuard('device-discovery', observed?.status === 'complete', 'VENDOR_DEVICE_CHANGED');
    const inventory = parseAdapterInventory(JSON.stringify({ status: observed.status,
      adapters: observed.adapters.map(row => Object.fromEntries(ADAPTER_FIELDS.map(key => [key, row[key]]))) }));
    const current = inventory.adapters[binding.adapterIndex];
    vendorGuard('device-identity', current && !current.software
      && current.backendCandidate === (binding.vendor === 'AMD' ? 'amf' : 'qsv')
      && ['adapterIndex', 'luid', 'vendorId', 'deviceId', 'umdVersion'].every(key => current[key] === binding[key]),
    'VENDOR_DEVICE_CHANGED');
  } catch (error) {
    if (signal?.aborted || error?.code === 'CANCELLED') throw new ToolError('CANCELLED', 'Encoding cancelled.');
    throw new ToolError('VENDOR_DEVICE_CHANGED', VENDOR_MESSAGES.VENDOR_DEVICE_CHANGED,
      { nativePrivate: { message: error?.message, ...boundedToolStderr(error) } });
  }
}
function vendorDecodeBudget(duration) {
  vendorGuard('duration', typeof duration === 'number' && Number.isFinite(duration) && duration > 0,
    'VENDOR_OUTPUT_DECODE_FAILED');
  return Math.min(6 * 60 * 60 * 1000, Math.max(120_000, Math.ceil(duration * 3000)));
}

// Both progress values belong to closed children. A source header is only an
// additional refusal: agreement never proves that every source frame survived.
async function vendorOutputCheck({ vendor, outputProbe, encoderProgress, duration, file, ffmpeg, run, signal }) {
  const profile = VENDOR_PROFILES.find(row => row.id === vendor.profileId);
  const video = selectVideo(outputProbe);
  vendorPixelFormat(profile, video.pix_fmt);
  const encoderTags = Object.entries(video.tags || {}).filter(([key]) => key.toUpperCase() === 'ENCODER');
  vendorGuard('encoder-tag', encoderTags.length === 1 && typeof encoderTags[0][1] === 'string'
    && new RegExp(`^Lavc\\d+\\.\\d+\\.\\d+ ${profile.encoder}$`).test(encoderTags[0][1]), 'VENDOR_ENCODER_TAG_MISMATCH');
  vendorGuard('encoder-end', encoderProgress?.ended === true, 'VENDOR_OUTPUT_DECODE_FAILED');
  vendorGuard('encoder-count', Number.isSafeInteger(encoderProgress.frame) && encoderProgress.frame > 0,
    'VENDOR_FRAME_COUNT_MISMATCH');
  const timeoutMs = vendorDecodeBudget(duration), controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  let expired = false, decoded;
  const timer = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);
  try {
    // No Promise.race: abort requests termination; run resolves/rejects only
    // when the owned child closes, before this item can release the queue.
    const result = await run(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-nostats',
      '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:v:0', '-progress', 'pipe:1', '-f', 'null', '-'],
    { signal: controller.signal, timeoutMs, stdoutLimit: 1024 * 1024, stderrLimit: 64 * 1024,
      onProgress: record => { decoded = { frame: record.frame, ended: record.ended }; } });
    if (signal?.aborted) throw new ToolError('CANCELLED', 'Encoding cancelled.');
    vendorGuard('decode-budget', !expired, 'VENDOR_VALIDATION_TIMEOUT');
    vendorGuard('decode-exit', result?.exitCode === 0, 'VENDOR_OUTPUT_DECODE_FAILED');
    vendorGuard('decode-end', decoded?.ended === true, 'VENDOR_OUTPUT_DECODE_FAILED');
    vendorGuard('decode-count', Number.isSafeInteger(decoded.frame) && decoded.frame > 0
      && decoded.frame === encoderProgress.frame, 'VENDOR_FRAME_COUNT_MISMATCH');
    vendorGuard('source-count', vendor.sourceFrameCount === null || vendor.sourceFrameCount === decoded.frame,
      'VENDOR_FRAME_COUNT_MISMATCH');
  } catch (error) {
    if (signal?.aborted) throw new ToolError('CANCELLED', 'Encoding cancelled.', boundedToolStderr(error));
    if (expired || error?.code === 'TIMEOUT') throw new ToolError('VENDOR_VALIDATION_TIMEOUT',
      VENDOR_MESSAGES.VENDOR_VALIDATION_TIMEOUT, boundedToolStderr(error));
    if (Object.hasOwn(VENDOR_MESSAGES, error?.code)) throw error;
    throw new ToolError('VENDOR_OUTPUT_DECODE_FAILED', VENDOR_MESSAGES.VENDOR_OUTPUT_DECODE_FAILED, boundedToolStderr(error));
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

module.exports = { vendorGuard, vendorRefusal, vendorPublicItem, requireVendorRoute, declaredVendorFrames, requireVendorArgs,
  requireVendorDevice, vendorDecodeBudget, vendorOutputCheck };
