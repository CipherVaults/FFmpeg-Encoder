'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { buildEncodeArgs } = require('./media.cjs');
const { verifyVideo, parseProbe, failureReason } = require('./capabilities.cjs');
const { runTool, ToolError, boundedToolStderr } = require('./process-runner.cjs');
const { queryWindowsAdapters, parseAdapterInventory } = require('./windows-adapters.cjs');
const { VENDOR_PROFILES, VENDOR_MESSAGES } = require('./vendor-profiles.cjs');
const { resolveCatalogSettings } = require('./encoder-catalog.cjs');
const { overlayVendorArgs, createVendorBinding } = require('./vendor-encode.cjs');

const CODECS = { H264: 'h264', H265: 'hevc', AV1: 'av1' };
const STDERR_LIMIT = 64 * 1024;
const DISCLOSURES = ['VENDOR_PARAMS_ADJUSTED', 'VENDOR_MULTIPLE_ADAPTERS'];
const REASONS = ['VENDOR_DEPTH_NOT_OFFERED', 'VENDOR_NO_ADAPTER', 'VENDOR_DISCOVERY_INCOMPLETE',
  'VENDOR_CHECK_BUDGET', 'VENDOR_CHECK_FAILED'];
const ADAPTER_FIELDS = ['adapterIndex', 'description', 'luid', 'umdVersion', 'vendorId', 'deviceId',
  'subsystemId', 'revision', 'flags', 'dedicatedVideoBytes', 'driverQueryHresult'];
// Match only the known QSV diagnostics, never use a child's text as UI text.
const QSV_WARNINGS = [/\bincompatible video param(?:s|eters)\b/i, /\bpartial acceleration\b/i];
const cancelled = signal => {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Vendor capability inspection cancelled.');
};
function guard(name, condition, code = 'VENDOR_CHECK_FAILED') {
  if (!condition) throw new ToolError(code, VENDOR_MESSAGES[code]);
}
const disclosure = code => ({ code, message: VENDOR_MESSAGES[code] });
const unavailable = (bitDepth, reasonCode) => ({ bitDepth, available: false,
  reasonCode, code: reasonCode, reason: VENDOR_MESSAGES[reasonCode], disclosures: [], device: null });

// Construct the public DTO from the closed catalog. Neither arbitrary extra
// properties nor child-provided messages can cross this projection.
function projectVendorCapabilities(result) {
  return VENDOR_PROFILES.map(profile => {
    const source = result?.profiles?.find(row => row.id === profile.id);
    const checks = [8, 10].map(bitDepth => {
      if (!profile.bitDepths.includes(bitDepth)) return unavailable(bitDepth, 'VENDOR_DEPTH_NOT_OFFERED');
      const check = source?.checks?.find(row => row.bitDepth === bitDepth);
      if (check?.available !== true) return unavailable(bitDepth,
        REASONS.includes(check?.reasonCode) ? check.reasonCode : 'VENDOR_CHECK_FAILED');
      const description = check.device?.description;
      guard('display-description', typeof description === 'string' && description.length <= 128
        && !/[\x00-\x1f\x7f]/.test(description));
      return { bitDepth, available: true, reason: null, reasonCode: null,
        codec: CODECS[profile.codec], pixelFormat: bitDepth === 10 ? 'yuv420p10le' : 'yuv420p', frames: 2,
        device: { description }, disclosures: DISCLOSURES.filter(code => check.disclosures?.some(row => row.code === code)).map(disclosure) };
    });
    const passed = checks.filter(check => check.available), failed = checks.filter(check => !check.available);
    return { ...profile, available: passed.length > 0, supportedBitDepths: passed.map(check => check.bitDepth),
      reason: failed.length ? VENDOR_MESSAGES[failed[0].reasonCode] : null,
      reasonCode: failed[0]?.reasonCode || null, checks, device: passed[0]?.device || null,
      disclosures: DISCLOSURES.filter(code => checks.some(check => check.disclosures.some(row => row.code === code))).map(disclosure) };
  });
}
function failedVendorCapabilities(reasonCode = 'VENDOR_CHECK_FAILED') {
  return projectVendorCapabilities({ profiles: VENDOR_PROFILES.map(profile => ({ id: profile.id,
    checks: [8, 10].map(bitDepth => unavailable(bitDepth, reasonCode)) })) });
}

/** Independent ordinary-vendor startup check. It consumes only the pure vendor
 * syntax and its own DXGI observation; no native service or registry is read.
 * Bindings and bounded child diagnostics are main-only return values. */
async function checkVendorCapabilities({ ffmpeg, ffprobe, stateDir, signal, run = runTool, adapters = queryWindowsAdapters }) {
  cancelled(signal);
  let inventory;
  try {
    const observed = await adapters({ signal, run });
    cancelled(signal);
    guard('complete-discovery', observed?.status === 'complete', 'VENDOR_DISCOVERY_INCOMPLETE');
    // Revalidate even injected inventories with the DXGI parser. In particular,
    // never trust a supplied backendCandidate, software flag or device ordinal.
    inventory = parseAdapterInventory(JSON.stringify({ status: observed.status,
      adapters: observed.adapters.map(row => Object.fromEntries(ADAPTER_FIELDS.map(key => [key, row[key]]))) }));
  } catch (error) {
    cancelled(signal);
    if (error?.code === 'CANCELLED') throw error;
    return { profiles: failedVendorCapabilities('VENDOR_DISCOVERY_INCOMPLETE'), bindings: new Map(),
      nativePrivate: { discovery: failureReason(error || {}), ...boundedToolStderr(error, STDERR_LIMIT) } };
  }
  guard('state-directory', typeof stateDir === 'string' && path.isAbsolute(stateDir) && !/[\0\r\n]/.test(stateDir));
  const rows = [], bindings = new Map(), privateChecks = [];
  // No fixture or encode is created when neither vendor has an adapter.
  if (!inventory.adapters.some(row => row.backendCandidate)) {
    return { profiles: failedVendorCapabilities('VENDOR_NO_ADAPTER'), bindings, nativePrivate: {} };
  }
  await fs.mkdir(stateDir, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(stateDir, 'vendor-capability-'));
  const owned = new Set();
  const own = name => { const file = path.join(temporary, name); owned.add(file); return file; };
  try {
    for (const vendor of ['AMD', 'Intel']) {
      const backend = vendor === 'AMD' ? 'amf' : 'qsv';
      const matching = inventory.adapters.filter(row => row.backendCandidate === backend);
      const candidates = matching.slice(0, 4);
      const deadline = performance.now() + 90_000;
      const fixtures = new Map();
      // The timer requests termination, but the runner's settlement (close) is
      // still the ownership boundary. Never race cleanup against a live child.
      const execute = async (binary, args) => {
        cancelled(signal);
        const remaining = deadline - performance.now();
        guard('vendor-budget', remaining > 0, 'VENDOR_CHECK_BUDGET');
        const timeoutMs = Math.min(20_000, Math.ceil(remaining));
        const controller = new AbortController();
        const abort = () => controller.abort();
        signal?.addEventListener('abort', abort, { once: true });
        let expired = false;
        const timer = setTimeout(() => { expired = true; controller.abort(); }, timeoutMs);
        try {
          const result = await run(binary, args, { signal: controller.signal, timeoutMs,
            stdoutLimit: 1024 * 1024, stderrLimit: STDERR_LIMIT });
          cancelled(signal);
          guard('child-deadline', !expired, remaining <= 20_000 ? 'VENDOR_CHECK_BUDGET' : 'VENDOR_CHECK_FAILED');
          guard('vendor-budget-after-child', performance.now() < deadline, 'VENDOR_CHECK_BUDGET');
          guard('child-exit', result.exitCode === 0);
          return result;
        } catch (error) {
          cancelled(signal);
          if (expired) throw new ToolError(remaining <= 20_000 ? 'VENDOR_CHECK_BUDGET' : 'VENDOR_CHECK_FAILED',
            VENDOR_MESSAGES.VENDOR_CHECK_FAILED, boundedToolStderr(error, STDERR_LIMIT));
          throw error;
        } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
      };
      const fixture = async bitDepth => {
        if (fixtures.has(bitDepth)) return fixtures.get(bitDepth);
        const input = own(`${vendor}-input-${bitDepth}.mkv`);
        const pixels = bitDepth === 10 ? 'yuv420p10le' : 'yuv420p';
        const source = `testsrc2=size=320x180:rate=30,format=${pixels},setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
        await execute(ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-n', '-f', 'lavfi', '-i', source,
          '-frames:v', '2', '-an', '-c:v', 'ffv1', '-level', '3', '-pix_fmt', `+${pixels}`,
          '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', '-f', 'matroska', input]);
        const inspected = await execute(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe',
          '-count_frames', '-show_streams', '-show_format', '-of', 'json', input]);
        const probe = parseProbe(inspected);
        verifyVideo(probe, { bitDepth, codec: 'ffv1', countFrames: true }, inspected);
        const result = { input, probe }; fixtures.set(bitDepth, result); return result;
      };
      for (const profile of VENDOR_PROFILES.filter(row => row.hardware === vendor)) {
        const checks = [];
        for (const bitDepth of [8, 10]) {
          cancelled(signal);
          if (!profile.bitDepths.includes(bitDepth)) { checks.push(unavailable(bitDepth, 'VENDOR_DEPTH_NOT_OFFERED')); continue; }
          if (!candidates.length) { checks.push(unavailable(bitDepth, 'VENDOR_NO_ADAPTER')); continue; }
          let check = unavailable(bitDepth, 'VENDOR_CHECK_FAILED');
          for (const adapter of candidates) {
            try {
              const { input, probe } = await fixture(bitDepth);
              const binding = createVendorBinding({ vendor, ...Object.fromEntries(
                ['adapterIndex', 'luid', 'vendorId', 'deviceId', 'umdVersion', 'description'].map(key => [key, adapter[key]])) });
              const { settings, twinSettings } = resolveCatalogSettings({ profileId: profile.id,
                preset: profile.defaultPreset, quality: profile.quality.default });
              const output = own(`${profile.id}-${bitDepth}-${adapter.adapterIndex}.mkv`);
              const encoded = await execute(ffmpeg, overlayVendorArgs(buildEncodeArgs({ input, output, settings: twinSettings, probe }),
                { twinSettings, profile, settings, bitDepth, binding }));
              const inspected = await execute(ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-count_frames',
                '-show_streams', '-show_format', '-of', 'json', output]);
              const stream = verifyVideo(parseProbe(inspected), { bitDepth, codec: CODECS[profile.codec], countFrames: true }, inspected);
              const decoded = await execute(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-nostats',
                '-protocol_whitelist', 'file,pipe', '-i', output, '-map', '0:v:0', '-progress', 'pipe:1', '-f', 'null', '-']);
              const counts = [...decoded.stdout.matchAll(/^frame=(\d+)\s*$/gm)].map(match => Number(match[1]));
              guard('decoded-frames', counts.at(-1) === 2, 'VENDOR_CHECK_FAILED');
              guard('decode-ended', /^progress=end\s*$/m.test(decoded.stdout), 'VENDOR_CHECK_FAILED');
              const disclosures = [];
              if (matching.length > 1) disclosures.push(disclosure('VENDOR_MULTIPLE_ADAPTERS'));
              if (vendor === 'Intel' && QSV_WARNINGS.some(pattern => pattern.test(encoded.stderr || ''))) {
                disclosures.push(disclosure('VENDOR_PARAMS_ADJUSTED'));
              }
              check = { bitDepth, available: true, reason: null, reasonCode: null, codec: stream.codec_name,
                pixelFormat: stream.pix_fmt, frames: 2, device: { description: binding.description }, disclosures };
              bindings.set(`${profile.id}:${bitDepth}`, binding);
              privateChecks.push({ profileId: profile.id, bitDepth, binding, input, output, ...boundedToolStderr(encoded, STDERR_LIMIT) });
              break;
            } catch (error) {
              cancelled(signal);
              if (error?.code === 'CANCELLED') throw error;
              privateChecks.push({ profileId: profile.id, bitDepth, adapterIndex: adapter.adapterIndex,
                detail: failureReason(error || {}), ...boundedToolStderr(error, STDERR_LIMIT) });
              const budget = error?.code === 'VENDOR_CHECK_BUDGET' || performance.now() >= deadline;
              check = unavailable(bitDepth, budget ? 'VENDOR_CHECK_BUDGET' : 'VENDOR_CHECK_FAILED');
              if (budget) break;
            }
          }
          checks.push(check);
        }
        rows.push({ id: profile.id, checks });
      }
    }
    return { profiles: projectVendorCapabilities({ profiles: rows }), bindings,
      nativePrivate: { temporary, checks: privateChecks } };
  } finally {
    // Only explicitly owned paths are removed, after all children settled. An
    // unexpected entry leaves the directory intact and makes this check fail.
    const errors = [];
    for (const file of owned) {
      try { await fs.unlink(file); } catch (error) { if (error?.code !== 'ENOENT') errors.push(error); }
    }
    try { await fs.rmdir(temporary); } catch (error) { errors.push(error); }
    if (errors.length) throw new ToolError(signal?.aborted ? 'CANCELLED' : 'VENDOR_CHECK_FAILED', VENDOR_MESSAGES.VENDOR_CHECK_FAILED,
      { nativePrivate: { temporary, cleanupErrors: errors.map(error => error.message) } });
  }
}

module.exports = { checkVendorCapabilities, projectVendorCapabilities, failedVendorCapabilities };
