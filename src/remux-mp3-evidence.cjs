'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { ToolError, boundedToolStderr } = require('./process-runner.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { parseProbeJson } = require('./inspection.cjs');
const { getRemuxMp3Source, remuxVerificationDescription } = require('./remux-contract.cjs');
const { remuxProbeFingerprint } = require('./remux-validation.cjs');
const { compareCompressedCopy } = require('./remux-mp3-copy.cjs');
const { readMp3File, rereadMp3Source } = require('./remux-mp3-source.cjs');
const { REGULAR_WINDOWS_PAIR } = require('./regular-windows-runtime.cjs');

function requireCopy(value, message, code = 'MP3_COPY_UNVERIFIED') {
  if (!value) throw new ToolError(code, message);
}

async function collectMp3RemuxEvidence({ assessment, runtimeIdentity, outputId, sourceProbe, outputProbe, sourcePath, outputPath,
  stageDirectory, ffmpeg, ffprobe, run, signal, budget, verificationMethod, maxConcurrentChildren = 1 }) {
  const observed = getRemuxMp3Source(assessment);
  requireCopy(runtimeIdentity === REGULAR_WINDOWS_PAIR && verificationMethod === 'complete-native-v1' && maxConcurrentChildren === 1
    && typeof run === 'function', 'MP3 verification requires the exact regular Windows pair and its serial runner.');
  requireCopy(sourcePath !== outputPath, 'MP3 verification requires a distinct owned temporary output.');
  await assertOrdinaryPath(stageDirectory, 'directory');
  const directory = await fs.mkdtemp(path.join(stageDirectory, 'remux-mp3-evidence-'));
  await assertOrdinaryPath(directory, 'directory');
  const lease = await fs.lstat(directory, { bigint: true });
  const verificationClaim = remuxVerificationDescription(verificationMethod, 'mp3');
  const receipt = { version: 1, status: 'collecting', scope: 'complete-standalone-mp3-copy-and-sample-clock',
    directory, runtimeIdentity, outputId, sourcePath, outputPath,
    verificationMethod, verificationClaim, invocations: [], qualificationGranted: false, publicationAuthorized: false };
  const requireCurrent = () => requireCopy(!signal?.aborted, 'MP3 verification was cancelled.', 'CANCELLED');
  const assertEvidencePath = async () => {
    await assertOrdinaryPath(directory, 'directory');
    const stat = await fs.lstat(directory, { bigint: true });
    requireCopy(lease.dev !== 0n && lease.ino !== 0n && lease.dev === stat.dev && lease.ino === stat.ino
      && lease.birthtimeNs === stat.birthtimeNs, 'The owned MP3 evidence directory changed.', 'MP3_EVIDENCE_PATH');
  };
  const save = async (filename) => {
    await assertEvidencePath();
    await fs.writeFile(path.join(directory, filename), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    await assertEvidencePath();
  };
  async function invoke(label, executable, args, stdoutLimit, onStdoutChunk) {
    requireCurrent();
    const row = { label, executable, args, startedAt: new Date().toISOString() };
    receipt.invocations.push(row);
    try {
      const result = await run(executable, args, { signal, timeoutMs: budget.timeoutMs, stdoutLimit,
        stderrLimit: 64 * 1024, ...(onStdoutChunk ? { onStdoutChunk } : {}) });
      requireCopy(result.exitCode === 0 && !result.stderr && result.stderrCapture?.truncated === false,
        'A complete MP3 verification child did not close cleanly.');
      row.status = 'completed';
      row.exitCode = result.exitCode;
      return result.stdout;
    } catch (error) {
      row.status = 'failed';
      row.failure = { code: error.code ?? 'MP3_COPY_UNVERIFIED', ...boundedToolStderr(error, 64 * 1024) };
      throw error;
    } finally {
      row.finishedAt = new Date().toISOString();
    }
  }
  const probe = async (name, file, format) => parseProbeJson(await invoke(name, ffprobe,
    ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', format, '-show_streams', '-show_format',
      '-show_chapters', '-show_programs', '-show_stream_groups', '-show_packets', '-show_data_hash', 'sha256',
      '-of', 'json', '-i', file], budget.maxTextBytes), 'Complete MP3 packets');
  const pcm = async (name, file, format) => {
    const digest = createHash('sha256');
    let bytes = 0;
    await invoke(name, ffmpeg, ['-hide_banner', '-v', 'error', '-nostdin', '-xerror', '-threads', '1',
      '-protocol_whitelist', 'file,pipe', '-format_whitelist', format, '-err_detect', 'explode', '-i', file,
      '-map', '0:0', '-c:a:0', 'pcm_s32le', '-f', 's32le', 'pipe:1'], budget.maxPcmBytes,
    chunk => { bytes += chunk.length; digest.update(chunk); });
    requireCopy(bytes === budget.maxPcmBytes, 'The complete decoded MP3 sample count differs.', 'MP3_PCM_MISMATCH');
    return { bytes, sha256: digest.digest('hex') };
  };
  try {
    requireCurrent();
    receipt.sourceProbeFingerprint = remuxProbeFingerprint(sourceProbe, 'mp3');
    receipt.outputProbeFingerprint = remuxProbeFingerprint(outputProbe, 'mp3');
    requireCopy(receipt.sourceProbeFingerprint === assessment.sourceEvidenceFingerprint, 'The MP3 source probe differs from the prepared assessment.');
    const before = await rereadMp3Source(sourcePath, observed, { signal });
    const staged = await readMp3File(outputPath, { maximumBytes: budget.maxOutputBytes, signal });
    requireCopy(before.stamp.dev !== staged.stamp.dev || before.stamp.ino !== staged.stamp.ino,
      'The MP3 temporary output aliases the source file.');
    receipt.sourceBefore = before.stamp;
    receipt.outputBefore = staged.stamp;
    const sourcePackets = await probe('mp3-source-packets', sourcePath, 'mp3');
    const outputPackets = await probe('mp3-output-packets', outputPath, 'mov');
    requireCopy(remuxProbeFingerprint(sourcePackets, 'mp3') === receipt.sourceProbeFingerprint
      && remuxProbeFingerprint(outputPackets, 'mp3') === receipt.outputProbeFingerprint,
    'The complete MP3 packet observation differs from the source or temporary output probe.');
    const copy = compareCompressedCopy({ source: before.bytes, output: staged.bytes, sourceProbe: sourcePackets, outputProbe: outputPackets, outputId });
    const sourcePcm = await pcm('mp3-source-native-audio', sourcePath, 'mp3');
    const outputPcm = await pcm('mp3-output-native-audio', outputPath, 'mov');
    requireCopy(sourcePcm.sha256 === outputPcm.sha256 && sourcePcm.bytes === outputPcm.bytes,
      'The complete signed 32-bit decoded MP3 samples differ.', 'MP3_PCM_MISMATCH');
    const sourceAfter = await rereadMp3Source(sourcePath, observed, { signal });
    const outputAfter = await readMp3File(outputPath, { maximumBytes: budget.maxOutputBytes, expectedIdentity: staged.stamp, signal });
    requireCopy(copy.sourceSha256 === sourceAfter.sha256 && copy.outputSha256 === outputAfter.sha256,
      'The verified MP3 source or temporary output changed.', 'MP3_COPY_CHANGED');
    receipt.sourceAfter = sourceAfter.stamp;
    receipt.outputAfter = outputAfter.stamp;
    receipt.essenceEvidence = { verificationMethod, verificationClaim, outputFileSha256: copy.outputSha256,
      mp3Copy: { ...copy, pcmS32leSha256: sourcePcm.sha256 } };
    requireCurrent();
    receipt.status = 'completed';
    await save('receipt.json');
    requireCurrent();
  } catch (error) {
    receipt.status = signal?.aborted ? 'cancelled' : 'failed';
    receipt.essenceEvidence = null;
    receipt.failure = { code: error.code ?? 'MP3_COPY_UNVERIFIED',
      message: error instanceof ToolError ? error.message : 'Complete MP3 preservation could not be verified. The temporary output was retained.' };
    try { await save('failure.json'); } catch { receipt.persistenceFailed = true; }
  }
  return receipt;
}

module.exports = { collectMp3RemuxEvidence };
