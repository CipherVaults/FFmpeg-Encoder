'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { PROFILES, selectVideo, classifyColor, buildEncodeArgs } = require('./media.cjs');
const { runTool, ToolError } = require('./process-runner.cjs');

const EXPECTED_CODEC = { H264: 'h264', H265: 'hevc', AV1: 'av1' };
const TEST_BITS = [8, 10];

function parseProbe(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (cause) {
    throw new ToolError('INVALID_PROBE', 'Capability inspection returned invalid JSON.', { cause });
  }
}

function failureReason(error) {
  // Keep the useful encoder diagnostic while bounding what reaches the UI.
  const detail = typeof error.stderr === 'string' ? error.stderr.trim().slice(-1400) : '';
  return detail || error.message || 'Encoder validation failed.';
}

function verifyVideo(data, { bitDepth, codec, countFrames = false }) {
  const stream = selectVideo(data);
  const expectedPixels = bitDepth === 10 ? 'yuv420p10le' : 'yuv420p';
  const frameCount = Number(stream.nb_read_frames);
  const color = classifyColor(data);
  if (stream.codec_name !== codec || stream.pix_fmt !== expectedPixels
      || stream.width !== 320 || stream.height !== 180
      || stream.color_transfer !== 'bt709' || stream.color_primaries !== 'bt709'
      || stream.color_space !== 'bt709' || stream.color_range !== 'tv'
      || color.classification !== 'sdr'
      || (countFrames && frameCount !== 2)) {
    throw new ToolError('CAPABILITY_OUTPUT_MISMATCH', 'The encoded sample did not preserve the requested codec, SDR color, dimensions, bit depth, or two frames.');
  }
  return stream;
}

/**
 * Probe actual encode/decode operation using the same argument builder as jobs.
 * This is a small device check, not a perceptual-quality benchmark. Availability
 * is never inferred merely because an encoder name appears in `-encoders`.
 *
 * All temporary media lives in a unique owned directory. Cleanup names only the
 * files this invocation reserved; it never recursively removes a directory.
 */
async function checkCapabilities({ ffmpeg, ffprobe, stateDir, signal, run = runTool }) {
  if (signal?.aborted) throw new ToolError('CANCELLED', 'Capability inspection cancelled.');
  for (const [name, executable] of Object.entries({ ffmpeg, ffprobe })) {
    try {
      if (typeof executable !== 'string' || !(await fs.stat(executable)).isFile()) throw new Error('Not a file');
    } catch (cause) {
      throw new ToolError('MISSING_BINARY', `The bundled ${name} executable is missing.`, { cause });
    }
  }
  if (typeof stateDir !== 'string' || !path.isAbsolute(stateDir)) {
    throw new ToolError('INVALID_PATH', 'Capability state directory must be an absolute application-owned path.');
  }

  const execute = (binary, args) => run(binary, args, {
    signal, timeoutMs: 20_000, stdoutLimit: 1024 * 1024, stderrLimit: 64 * 1024,
  });
  const versions = {};
  // A missing runtime or broken binary is shared infrastructure failure, not an
  // unsupported individual encoder. Complete these checks before per-profile work.
  for (const [name, binary] of Object.entries({ ffmpeg, ffprobe })) {
    const result = await execute(binary, ['-version']);
    versions[name] = result.stdout.split(/\r?\n/)[0];
    if (!versions[name].startsWith(`${name} version `)) {
      throw new ToolError('INVALID_BINARY', `The bundled ${name} did not identify itself correctly.`);
    }
  }

  await fs.mkdir(stateDir, { recursive: true });
  const temporary = await fs.mkdtemp(path.join(stateDir, 'capability-'));
  const ownedFiles = new Set();
  const own = (name) => {
    const filename = path.join(temporary, name);
    ownedFiles.add(filename);
    return filename;
  };
  let primaryFailure;
  let result;
  try {
    const fixtures = new Map();
    for (const bitDepth of TEST_BITS) {
      const input = own(`input-${bitDepth}.mkv`);
      const pixelFormat = bitDepth === 10 ? 'yuv420p10le' : 'yuv420p';
      // Color is defined before negotiation, so strict pixel preservation does
      // not trigger an implicit conversion from unspecified to BT.709 signaling.
      const source = `testsrc2=size=320x180:rate=30,format=${pixelFormat},setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
      await execute(ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-n',
        '-f', 'lavfi', '-i', source, '-frames:v', '2', '-an', '-c:v', 'ffv1', '-level', '3',
        '-pix_fmt', `+${pixelFormat}`, '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-colorspace', 'bt709', '-color_range', 'tv', '-f', 'matroska', input,
      ]);
      const inspected = await execute(ffprobe, [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', input,
      ]);
      const probe = parseProbe(inspected.stdout);
      verifyVideo(probe, { bitDepth, codec: 'ffv1' });
      fixtures.set(bitDepth, { input, probe });
    }

    const profiles = [];
    for (const profile of PROFILES) {
      const checks = [];
      for (const bitDepth of TEST_BITS) {
        const { input, probe } = fixtures.get(bitDepth);
        const output = own(`${profile.id}-${bitDepth}.mkv`);
        const settings = { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default };
        try {
          await execute(ffmpeg, buildEncodeArgs({ input, output, settings, probe }));
          const inspected = await execute(ffprobe, [
            '-v', 'error', '-protocol_whitelist', 'file,pipe', '-count_frames',
            '-show_streams', '-show_format', '-of', 'json', output,
          ]);
          const stream = verifyVideo(parseProbe(inspected.stdout), {
            bitDepth, codec: EXPECTED_CODEC[profile.codec], countFrames: true,
          });
          // Probe metadata alone cannot prove that coded packets actually decode.
          // Decode all two frames with strict errors and independently verify the
          // final frame count emitted by FFmpeg's machine-readable progress.
          const decoded = await execute(ffmpeg, [
            '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-nostats',
            '-protocol_whitelist', 'file,pipe', '-i', output, '-map', '0:v:0',
            '-progress', 'pipe:1', '-f', 'null', '-',
          ]);
          const counts = [...decoded.stdout.matchAll(/^frame=(\d+)\s*$/gm)].map((match) => Number(match[1]));
          if (counts.at(-1) !== 2 || !/^progress=end\s*$/m.test(decoded.stdout)) {
            throw new ToolError('CAPABILITY_DECODE_FAILED', 'The sample did not decode exactly two complete frames.');
          }
          checks.push({ bitDepth, available: true, reason: null, codec: stream.codec_name, pixelFormat: stream.pix_fmt, frames: 2 });
        } catch (error) {
          if (signal?.aborted || ['CANCELLED', 'SPAWN_FAILED', 'MISSING_BINARY'].includes(error.code)) throw error;
          checks.push({ bitDepth, available: false, reason: failureReason(error), code: error.code || 'CAPABILITY_FAILED' });
        }
      }
      const supportedBitDepths = checks.filter((check) => check.available).map((check) => check.bitDepth);
      const failed = checks.filter((check) => !check.available);
      profiles.push({
        ...profile,
        available: supportedBitDepths.length > 0,
        supportedBitDepths,
        reason: failed.length ? failed.map((check) => `${check.bitDepth}-bit SDR: ${check.reason}`).join('\n') : null,
        checks,
      });
    }
    result = { profiles, versions };
  } catch (error) {
    primaryFailure = error;
  } finally {
    const cleanupFailures = [];
    for (const filename of ownedFiles) {
      try {
        await fs.unlink(filename);
      } catch (error) {
        if (error.code !== 'ENOENT') cleanupFailures.push(error);
      }
    }
    try {
      await fs.rmdir(temporary);
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length) {
      if (primaryFailure) primaryFailure.cleanupErrors = cleanupFailures.map((error) => error.message);
      else primaryFailure = new ToolError('CLEANUP_FAILED', 'Capability temporary files could not be fully cleaned up.', {
        cleanupErrors: cleanupFailures.map((error) => error.message),
      });
    }
  }
  if (primaryFailure) throw primaryFailure;
  return result;
}

module.exports = { checkCapabilities };
