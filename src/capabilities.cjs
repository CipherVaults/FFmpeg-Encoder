'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { PROFILES, ARCHIVE_RECIPE, selectVideo, classifyColor, buildEncodeArgs } = require('./media.cjs');
const { runTool, ToolError, boundedToolStderr } = require('./process-runner.cjs');

const EXPECTED_CODEC = { H264: 'h264', H265: 'hevc', AV1: 'av1' };
const TEST_BITS = [8, 10];
const RECIPE_TEST_FRAMES = 96;
const CAPABILITY_STDERR_LIMIT = 64 * 1024;

function unexpectedRecipeWarnings(stderr) {
  // The preservation builder deliberately sets global stream copy before the
  // selected video encoder. FFmpeg reports that exact override even though the
  // intended encoder wins. Exempt only this known diagnostic; an ignored recipe
  // option, a different encoder, or any additional warning still rejects it.
  const expectedOverride = /^\[vost#0:0 @ [0-9a-f]+\] Multiple -codec\/-c\/-acodec\/-vcodec\/-scodec\/-dcodec options specified for stream 0, only the last option '-codec:v:0 hevc_nvenc' will be used\.$/i;
  return (stderr || '').split(/\r?\n/).map(line => line.trim())
    .filter(line => line && !expectedOverride.test(line)).join('\n');
}

function parseProbe(result) {
  try {
    return JSON.parse(result.stdout);
  } catch (cause) {
    throw new ToolError('INVALID_PROBE', 'Capability inspection returned invalid JSON.', {
      cause, ...boundedToolStderr(result, CAPABILITY_STDERR_LIMIT),
    });
  }
}

function failureReason(error) {
  // Keep the useful encoder diagnostic while bounding what reaches the UI.
  const detail = typeof error.stderr === 'string' ? error.stderr.trim().slice(-1400) : '';
  return detail || error.message || 'Encoder validation failed.';
}

function verifyVideo(data, { bitDepth, codec, countFrames = false, expectedFrames = 2 }, toolResult) {
  try {
    const stream = selectVideo(data);
    const expectedPixels = bitDepth === 10 ? 'yuv420p10le' : 'yuv420p';
    const frameCount = Number(stream.nb_read_frames);
    const color = classifyColor(data);
    if (stream.codec_name !== codec || stream.pix_fmt !== expectedPixels
        || stream.width !== 320 || stream.height !== 180
        || stream.color_transfer !== 'bt709' || stream.color_primaries !== 'bt709'
        || stream.color_space !== 'bt709' || stream.color_range !== 'tv'
        || color.classification !== 'sdr'
        || (countFrames && frameCount !== expectedFrames)) {
      throw new ToolError('CAPABILITY_OUTPUT_MISMATCH', `The encoded sample did not preserve the requested codec, SDR color, dimensions, bit depth, or ${expectedFrames} frames.`);
    }
    return stream;
  } catch (error) {
    Object.assign(error, boundedToolStderr(toolResult, CAPABILITY_STDERR_LIMIT));
    throw error;
  }
}

/**
 * Probe actual encode/decode operation using the same argument builder as jobs.
 * This is a small device check, not a perceptual-quality benchmark. Availability
 * is never inferred merely because an encoder name appears in `-encoders`.
 *
 * All temporary media lives in a unique owned directory. Cleanup names only the
 * files this invocation reserved; it never recursively removes a directory.
 */
async function checkCapabilitiesRun({ ffmpeg, ffprobe, stateDir, signal, run = runTool }, versions) {
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
    signal, timeoutMs: 20_000, stdoutLimit: 1024 * 1024, stderrLimit: CAPABILITY_STDERR_LIMIT,
  });
  // A missing runtime or broken binary is shared infrastructure failure, not an
  // unsupported individual encoder. Complete these checks before per-profile work.
  for (const [name, binary] of Object.entries({ ffmpeg, ffprobe })) {
    const result = await execute(binary, ['-version']);
    const versionLine = result.stdout.split(/\r?\n/)[0];
    if (!new RegExp(`^${name} version [^\\x00-\\x1f\\x7f]{1,512}$`).test(versionLine)) {
      throw new ToolError('INVALID_BINARY', `The bundled ${name} did not identify itself correctly.`, boundedToolStderr(result, CAPABILITY_STDERR_LIMIT));
    }
    versions[name] = versionLine;
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
    for (const frameCount of [2, RECIPE_TEST_FRAMES]) for (const bitDepth of TEST_BITS) {
      const input = own(`${frameCount === 2 ? '' : 'recipe-'}input-${bitDepth}.mkv`);
      const pixelFormat = bitDepth === 10 ? 'yuv420p10le' : 'yuv420p';
      // Color is defined before negotiation, so strict pixel preservation does
      // not trigger an implicit conversion from unspecified to BT.709 signaling.
      const source = `testsrc2=size=320x180:rate=30,format=${pixelFormat},setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`;
      await execute(ffmpeg, [
        '-hide_banner', '-nostdin', '-loglevel', 'error', '-n',
        '-f', 'lavfi', '-i', source, '-frames:v', String(frameCount), '-an', '-c:v', 'ffv1', '-level', '3',
        '-pix_fmt', `+${pixelFormat}`, '-color_primaries', 'bt709', '-color_trc', 'bt709',
        '-colorspace', 'bt709', '-color_range', 'tv', '-f', 'matroska', input,
      ]);
      const inspected = await execute(ffprobe, [
        '-v', 'error', '-protocol_whitelist', 'file,pipe', '-show_streams', '-show_format', '-of', 'json', input,
      ]);
      const probe = parseProbe(inspected);
      verifyVideo(probe, { bitDepth, codec: 'ffv1' }, inspected);
      fixtures.set(`${bitDepth}-${frameCount}`, { input, probe });
    }

    const profiles = [];
    const recipes = [];
    const recipeBase = PROFILES.find(profile => profile.id === ARCHIVE_RECIPE.profileId);
    // Recipe presence is not availability. Exercise its complete canonical
    // settings on this device at each supported source depth, without fallback.
    const candidates = [...PROFILES, { ...recipeBase, id: ARCHIVE_RECIPE.id, profileId: recipeBase.id,
      recipeId: ARCHIVE_RECIPE.id, defaultPreset: ARCHIVE_RECIPE.preset,
      quality: { ...recipeBase.quality, default: ARCHIVE_RECIPE.quality } }];
    for (const profile of candidates) {
      const checks = [];
      for (const bitDepth of TEST_BITS) {
        const expectedFrames = profile.recipeId ? RECIPE_TEST_FRAMES : 2;
        const { input, probe } = fixtures.get(`${bitDepth}-${expectedFrames}`);
        const output = own(`${profile.id}-${bitDepth}.mkv`);
        const settings = { profileId: profile.profileId || profile.id, preset: profile.defaultPreset, quality: profile.quality.default,
          ...(profile.recipeId ? { recipeId: profile.recipeId } : {}) };
        try {
          const encoded = await execute(ffmpeg, buildEncodeArgs({ input, output, settings, probe }));
          if (profile.recipeId && (encoded.stderrCapture?.truncated || unexpectedRecipeWarnings(encoded.stderr))) {
            // A retained tail containing only the known override cannot prove
            // an earlier ignored-option warning was absent.
            throw new ToolError('RECIPE_OPTIONS_UNVERIFIED', 'The recipe warning check was not complete and clean; its settings are not accepted silently.', boundedToolStderr(encoded, CAPABILITY_STDERR_LIMIT));
          }
          const inspected = await execute(ffprobe, [
            '-v', 'error', '-protocol_whitelist', 'file,pipe', '-count_frames',
            ...(profile.recipeId ? ['-show_frames', '-show_entries', 'frame=pict_type'] : []),
            '-show_streams', '-show_format', '-of', 'json', output,
          ]);
          const decodedProbe = parseProbe(inspected);
          const stream = verifyVideo(decodedProbe, {
            bitDepth, codec: EXPECTED_CODEC[profile.codec], countFrames: true, expectedFrames,
          }, inspected);
          let longestBRun = 0;
          if (profile.recipeId) {
            // A two-frame sample cannot demonstrate four consecutive B frames.
            // This observable check is separate from option acceptance; it does
            // not claim to verify the complete reference-picture graph.
            if (!Array.isArray(decodedProbe.frames) || decodedProbe.frames.length !== expectedFrames) {
              throw new ToolError('RECIPE_STRUCTURE_UNVERIFIED', 'The recipe frame structure could not be inspected completely.', boundedToolStderr(inspected, CAPABILITY_STDERR_LIMIT));
            }
            let run = 0;
            for (const frame of decodedProbe.frames) {
              if (!frame || typeof frame !== 'object' || !['I', 'P', 'B'].includes(frame.pict_type)) {
                throw new ToolError('RECIPE_STRUCTURE_UNVERIFIED', 'The recipe contains missing or unknown picture-type evidence.', boundedToolStderr(inspected, CAPABILITY_STDERR_LIMIT));
              }
              run = frame.pict_type === 'B' ? run + 1 : 0;
              longestBRun = Math.max(longestBRun, run);
            }
            if (longestBRun !== 4) throw new ToolError('RECIPE_STRUCTURE_UNVERIFIED', 'The recipe did not produce the requested four-B-frame structure.', boundedToolStderr(inspected, CAPABILITY_STDERR_LIMIT));
          }
          // Probe metadata alone cannot prove that coded packets actually decode.
          // Decode the entire sample with strict errors and independently verify the
          // final frame count emitted by FFmpeg's machine-readable progress.
          const decoded = await execute(ffmpeg, [
            '-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-nostats',
            '-protocol_whitelist', 'file,pipe', '-i', output, '-map', '0:v:0',
            '-progress', 'pipe:1', '-f', 'null', '-',
          ]);
          const counts = [...decoded.stdout.matchAll(/^frame=(\d+)\s*$/gm)].map((match) => Number(match[1]));
          if (counts.at(-1) !== expectedFrames || !/^progress=end\s*$/m.test(decoded.stdout)) {
            throw new ToolError('CAPABILITY_DECODE_FAILED', `The sample did not decode exactly ${expectedFrames} complete frames.`, boundedToolStderr(decoded, CAPABILITY_STDERR_LIMIT));
          }
          checks.push({ bitDepth, available: true, reason: null, codec: stream.codec_name, pixelFormat: stream.pix_fmt, frames: expectedFrames,
            ...(profile.recipeId ? { longestBRun } : {}) });
        } catch (error) {
          if (signal?.aborted || ['CANCELLED', 'SPAWN_FAILED', 'MISSING_BINARY'].includes(error.code)) throw error;
          checks.push({ bitDepth, available: false, reason: failureReason(error), code: error.code || 'CAPABILITY_FAILED',
            ...boundedToolStderr(error, CAPABILITY_STDERR_LIMIT) });
        }
      }
      const supportedBitDepths = checks.filter((check) => check.available).map((check) => check.bitDepth);
      const failed = checks.filter((check) => !check.available);
      const availability = {
        available: supportedBitDepths.length > 0,
        supportedBitDepths,
        reason: failed.length ? failed.map((check) => `${check.bitDepth}-bit SDR: ${check.reason}`).join('\n') : null,
        checks,
      };
      if (profile.recipeId) recipes.push({ ...ARCHIVE_RECIPE, ...availability });
      else profiles.push({ ...profile, ...availability });
    }
    result = { profiles, recipes, versions };
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

async function checkCapabilities(options) {
  const versions = {};
  try { return await checkCapabilitiesRun(options, versions); }
  catch (error) {
    // A later failure does not erase versions actually observed earlier. This
    // is identification evidence, not a claim that capability checks passed.
    if (Object.keys(versions).length) error.runtimeVersions = { ...versions };
    throw error;
  }
}

module.exports = { checkCapabilities };
