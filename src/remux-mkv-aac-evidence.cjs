'use strict';

// A complete witness for the finite, separately admitted AAC clock repair.
// The common Remux validator and publisher still own metadata and publication.
const { createHash } = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ToolError, boundedToolStderr } = require('./process-runner.cjs');
const { assertOrdinaryPath } = require('./candidate-runtime.cjs');
const { readNativeMetadata, ancestor } = require('./remux-native-reader.cjs');
const { observeNativeInventory, compareNativeInventories } = require('./remux-native-checks.cjs');
const { observeRemuxEditLists } = require('./remux-edit-lists.cjs');
const { readSourceIdentity, sameIdentity } = require('./source-identity.cjs');
const { parseProbeJson } = require('./inspection.cjs');
const { observeMkvAacClock, requireMkvAacClock, MAX_SOURCE_BYTES, VERIFICATION_METHOD: AAC_CLOCK_METHOD } = require('./remux-mkv-aac-clock.cjs');
const { REGULAR_WINDOWS_PAIR } = require('./regular-windows-runtime.cjs');
const { getRemuxMkvAacClock, remuxVerificationDescription } = require('./remux-contract.cjs');
const { REMUX_VALIDATION_VERSION, remuxProbeFingerprint } = require('./remux-validation.cjs');

const MiB = 1024 ** 2;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const demand = (value, message) => {
  if (!value) throw new ToolError('REMUX_MKV_AAC_COPY_UNVERIFIED', message);
};

async function hashHeldMetadata(meta) {
  const whole = createHash('sha256');
  for (let at = 0; at < meta.fileBytes; at += 65536) {
    whole.update(await meta.read(at, Math.min(65536, meta.fileBytes - at)));
  }
  return whole.digest('hex');
}

async function recheckMkvAacStage(file, receipt, signal) {
  const identity = receipt?.outputAfter, sha256 = receipt?.essenceEvidence?.outputFileSha256;
  demand(identity && sha256 && Number(identity.size) > 0 && Number(identity.size) <= MAX_SOURCE_BYTES + MiB,
    'There is no complete verified MP4 stage.');
  const actual = await readNativeMetadata({ file, identity, family: 'isobmff', maxRecords: 512, timeoutMs: 10000,
    signal, withMetadata: hashHeldMetadata });
  demand(actual === sha256, 'The verified MP4 stage changed before publication.');
}

async function outputClock(file, identity, probe, clock, signal) {
  demand(Number(identity.size) > 0 && Number(identity.size) <= MAX_SOURCE_BYTES + MiB,
    'The staged MP4 exceeds the bounded complete verification size.');
  return readNativeMetadata({ file, identity, family: 'isobmff', maxRecords: 512, timeoutMs: 10000, signal,
    async withMetadata(meta) {
      const one = (nodes, type) => {
        const matches = nodes.filter(node => node.type === type);
        demand(matches.length === 1, 'A unique staged MP4 ' + type + ' is required.');
        return matches[0];
      };
      const body = node => {
        demand(node.end > node.body && node.end - node.body <= 4096, 'An MP4 clock table exceeds its bound.');
        return meta.read(node.body, node.end - node.body);
      };
      const movie = one(meta.nodes, 'mvhd'), tracks = meta.nodes.filter(node => node.type === 'trak');
      const storage = one(meta.nodes, 'mdat'), header = await body(movie);
      demand(tracks.length === 2 && !meta.seenTypes.has('moof') && [0, 1].includes(header[0])
        && header.readUInt32BE(header[0] ? 20 : 12) === clock.sampleRate,
      'The MP4 track set or movie clock differs from the measured mux.');
      const audio = tracks[1];
      const audioNodes = meta.nodes.filter(node => ancestor(node, 'trak') === audio);
      const media = await body(one(audioNodes, 'mdhd')), timings = await body(one(audioNodes, 'stts'));
      const handler = await body(one(audioNodes, 'hdlr'));
      demand(handler.toString('ascii', 8, 12) === 'soun' && [0, 1].includes(media[0])
        && media.readUInt32BE(media[0] ? 20 : 12) === clock.sampleRate,
      'The native AAC media clock or track type differs.');
      const coded = clock.codedAudioPackets * clock.initialPadding;
      const mediaDuration = media[0] ? media.readBigUInt64BE(24) : BigInt(media.readUInt32BE(16));
      demand(mediaDuration === BigInt(coded) && timings.length === 16 && timings.readUInt32BE(0) === 0
        && timings.readUInt32BE(4) === 1 && timings.readUInt32BE(8) === clock.codedAudioPackets
        && timings.readUInt32BE(12) === clock.initialPadding,
      'The complete MP4 AAC sample table does not retain the exact coded extent.');
      const edit = await body(one(audioNodes, 'elst'));
      demand(edit.length === 20 && edit.readUInt32BE(0) === 0 && edit.readUInt32BE(4) === 1
        && edit.readUInt32BE(8) === clock.sampleFrames && edit.readInt32BE(12) === clock.initialPadding
        && edit.readUInt32BE(16) === 65536, 'The MP4 AAC edit does not expose exactly the approved visible sample span.');
      demand(probe.packets.length === clock.videoFrames + clock.codedAudioPackets,
        'The staged MP4 packet count changed.');
      const extents = [];
      let audioOrdinal = 0;
      for (const packet of probe.packets) {
        const size = Number(packet.size), start = Number(packet.pos), stop = start + size;
        demand([0, 1].includes(packet.stream_index) && Number.isSafeInteger(start) && Number.isSafeInteger(size)
          && size > 0 && size <= 65536 && start >= storage.body && stop <= storage.end,
        'A staged MP4 packet has an unproved local extent.');
        const physicalHash = hash(await meta.read(start, size));
        demand(packet.data_hash === 'SHA256:' + physicalHash, 'A staged MP4 packet does not match its physical file bytes.');
        extents.push([start, stop]);
        if (packet.stream_index !== 1) continue;
        const expected = clock.accessUnits[audioOrdinal], pts = (audioOrdinal - 1) * clock.initialPadding;
        demand(expected?.size === size && expected.sha256 === physicalHash
          && packet.pts === pts && packet.dts === pts && packet.duration === clock.initialPadding,
        'The ordered staged AAC units or their exact coded clocks changed.');
        const skip = packet.side_data_list ?? [];
        const head = audioOrdinal === 0 ? clock.initialPadding : 0;
        const tail = audioOrdinal === clock.codedAudioPackets - 1 ? clock.terminalPadding : 0;
        demand(head || tail ? skip.length === 1 && skip[0].side_data_type === 'Skip Samples'
          && skip[0].skip_samples === head && skip[0].discard_padding === tail
          && skip[0].skip_reason === 0 && skip[0].discard_reason === 0 : skip.length === 0,
        'The verified priming or discard padding did not round-trip through MP4.');
        audioOrdinal++;
      }
      extents.sort((left, right) => left[0] - right[0]);
      demand(audioOrdinal === clock.codedAudioPackets
        && extents.every(([start], index) => index === 0 || start >= extents[index - 1][1]),
      'The staged MP4 contains overlapping or incomplete packet extents.');
      return { sha256: await hashHeldMetadata(meta), codedSamples: coded, mediaStartSamples: clock.initialPadding,
        presentedSamples: clock.sampleFrames };
    } });
}

async function verifyMkvAacCopy({ clock, sourcePath, sourceIdentity, outputPath, ffprobe,
  ffmpeg, signal, invoke, onProgress }) {
  requireMkvAacClock(clock, sourceIdentity);
  const formats = { source: 'matroska,webm', output: 'mov' };
  async function probe(label, file) {
    return parseProbeJson(await invoke(label + '-packets', ffprobe,
      ['-v', 'error', '-protocol_whitelist', 'file', '-format_whitelist', formats[label],
        '-show_streams', '-show_format', '-show_chapters', '-show_programs', '-show_stream_groups',
        '-show_packets', '-show_data_hash', 'sha256', '-of', 'json', '-i', file], 3 * MiB), 'Complete AAC copy packets');
  }
  async function decoded(label, file) {
    const args = ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-copyts',
      '-protocol_whitelist', 'file,pipe', '-format_whitelist', formats[label],
      ...(label === 'output' ? ['-ignore_editlist', '0'] : []), '-i', file];
    const video = await invoke(label + '-video', ffmpeg, [...args, '-map', '0:v:0', '-c:v', 'rawvideo',
      '-threads:v', '1', '-pix_fmt:v', '+yuv420p', '-fps_mode:v', 'passthrough', '-enc_time_base:v', 'demux',
      '-avoid_negative_ts', 'disabled', '-hash', 'sha256', '-f', 'framehash', '-format_version', '1', 'pipe:1'], MiB);
    demand(/^#tb 0: 1\/1000\r?$/m.test(video) && /^#hash: SHA256\r?$/m.test(video), 'The independent video clock differs.');
    const frames = video.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
    demand(frames.length === clock.videoFrames && frames.every((line, index) => {
      const [stream, dts, pts, duration, size, sha256, ...rest] = line.split(',').map(part => part.trim());
      return stream === '0' && pts === String(index * 40) && dts === pts && duration === '40'
        && size === '86400' && /^[a-f0-9]{64}$/.test(sha256) && rest.length === 0;
    }), 'The independently decoded video does not retain the exact complete timeline.');
    const pcm = createHash('sha256');
    let bytes = 0;
    await invoke(label + '-audio', ffmpeg, [...args, '-map', '0:a:0', '-vn', '-sn', '-dn',
      '-threads:a', '1', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], clock.sampleFrames * 8,
    chunk => { pcm.update(chunk); bytes += chunk.length; });
    demand(bytes === clock.sampleFrames * 8, 'The independently decoded AAC sample count changed.');
    return { videoSha256: hash(JSON.stringify(frames.map(line => line.split(',').at(-1).trim()))), pcmSha256: pcm.digest('hex') };
  }

  const before = await probe('source', sourcePath), after = await probe('output', outputPath);
  const current = await observeMkvAacClock({ file: sourcePath, identity: sourceIdentity, probe: before, signal });
  demand(current.sha256 === clock.sha256, 'The complete Matroska source differs from its approved clock.');
  const outputIdentity = await readSourceIdentity(outputPath, { signal });
  demand(sourceIdentity.dev !== outputIdentity.dev || sourceIdentity.ino !== outputIdentity.ino, 'The temporary output aliases the source.');
  demand(after.streams.length === 2 && after.streams[0].extradata_hash === 'SHA256:' + clock.videoConfig
    && after.streams[0].time_base === '1/1000' && after.streams[0].start_pts === 0
    && after.streams[1].extradata_hash === 'SHA256:' + clock.audioConfig && after.streams[1].codec_name === 'aac'
    && after.streams[1].time_base === '1/48000' && after.streams[1].start_pts === 0
    && after.streams[1].duration_ts === clock.sampleFrames,
  'The staged MP4 omitted its admitted streams, configurations, or exact audio placement.');
  const videoRows = probe => probe.packets.filter(row => row.stream_index === 0)
    .map(row => [row.pts, row.duration, row.size, row.data_hash, row.flags]);
  const video = videoRows(before);
  demand(video.length === clock.videoFrames && JSON.stringify(video) === JSON.stringify(videoRows(after)),
    'The ordered coded video and its exact clocks did not survive the copy.');
  const native = await outputClock(outputPath, outputIdentity, after, clock, signal);
  onProgress?.({ stage: 'verification-content', completed: 1, total: 3 });
  const sourceDecoded = await decoded('source', sourcePath), outputDecoded = await decoded('output', outputPath);
  demand(sourceDecoded.videoSha256 === outputDecoded.videoSha256 && sourceDecoded.pcmSha256 === outputDecoded.pcmSha256,
    'The complete decoded video or float PCM samples changed.');
  // Both tools opened by path. Re-pin actual named bytes after every child
  // closes so a stage or source replacement cannot acquire copy authority.
  const sourceAfter = await readSourceIdentity(sourcePath, { signal });
  requireMkvAacClock(clock, sourceAfter);
  const finalSource = await observeMkvAacClock({ file: sourcePath, identity: sourceAfter, probe: before, signal });
  const outputAfter = await readSourceIdentity(outputPath, { signal });
  demand(sameIdentity(outputIdentity, outputAfter), 'The owned MP4 stage identity changed while decoding.');
  const finalStage = await outputClock(outputPath, outputAfter, after, clock, signal);
  demand(finalSource.sha256 === clock.sha256 && finalStage.sha256 === native.sha256,
    'The Matroska source or temporary MP4 changed during complete comparison.');
  onProgress?.({ stage: 'verification-content', completed: 3, total: 3 });
  return { sourceBefore: sourceIdentity, sourceAfter, outputBefore: outputIdentity, outputAfter,
    copy: { sourceSha256: clock.sha256, outputSha256: native.sha256,
      sampleRate: clock.sampleRate, sampleFrames: clock.sampleFrames, shiftSamples: clock.shiftSamples,
      codedAudioPackets: clock.codedAudioPackets, videoFrames: clock.videoFrames,
      audioConfig: clock.audioConfig, videoConfig: clock.videoConfig, ...sourceDecoded },
    sourcePackets: before, outputPackets: after };
}


async function collectMkvAacRemuxEvidence(options) {
  const { assessment, runtimeIdentity, outputId, sourceProbe, outputProbe, sourcePath, outputPath,
    stageDirectory, ffprobe, ffmpeg, run, signal, budget, verificationMethod, onProgress } = options;
  const clock = getRemuxMkvAacClock(assessment);
  demand(runtimeIdentity === REGULAR_WINDOWS_PAIR && verificationMethod === AAC_CLOCK_METHOD
    && (options.maxConcurrentChildren ?? 1) === 1 && typeof run === 'function',
  'AAC sample-clock verification requires the exact Windows pair and serial runner.');
  const sourceIdentity = requireMkvAacClock(clock);
  demand(sourcePath === sourceIdentity.canonicalPath && sourcePath !== outputPath,
    'AAC sample-clock verification requires that exact source and a distinct temporary output.');
  await assertOrdinaryPath(stageDirectory, 'directory');
  const directory = await fs.mkdtemp(path.join(stageDirectory, 'remux-aac-clock-evidence-'));
  await assertOrdinaryPath(directory, 'directory');
  const lease = await fs.lstat(directory, { bigint: true });
  const verificationClaim = remuxVerificationDescription(verificationMethod, 'matroska');
  const receipt = { version: 1, status: 'collecting', scope: 'complete-matroska-aac-sample-clock-copy', directory,
    verificationMethod, verificationClaim, runtimeIdentity, outputId, sourcePath, outputPath, invocations: [],
    qualificationGranted: false, publicationAuthorized: false };
  async function save(name) {
    await assertOrdinaryPath(directory, 'directory');
    const now = await fs.lstat(directory, { bigint: true });
    demand(now.dev !== 0n && now.ino !== 0n && now.dev === lease.dev && now.ino === lease.ino
      && now.birthtimeNs === lease.birthtimeNs, 'The owned AAC evidence directory changed.');
    await fs.writeFile(path.join(directory, name), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
  }
  async function invoke(label, executable, args, stdoutLimit, onStdoutChunk) {
    if (signal?.aborted) throw new ToolError('CANCELLED', 'AAC copy verification was cancelled.');
    const row = { label, startedAt: new Date().toISOString(), argv: args };
    receipt.invocations.push(row);
    try {
      const result = await run(executable, args, { signal, timeoutMs: budget.timeoutMs, stdoutLimit,
        stderrLimit: 64 * 1024, ...(onStdoutChunk ? { onStdoutChunk } : {}) });
      demand(result.exitCode === 0 && !result.stderr && result.stderrCapture?.truncated === false
        && (onStdoutChunk ? result.stdoutCapture?.truncated === false : result.stdoutCapture?.truncated !== true),
      'A complete AAC verification child did not close cleanly.');
      row.status = 'completed';
      row.exitCode = result.exitCode;
      return result.stdout;
    } catch (error) {
      row.status = 'failed';
      row.failure = { code: error.code ?? 'REMUX_MKV_AAC_COPY_UNVERIFIED', ...boundedToolStderr(error, 64 * 1024) };
      throw error;
    } finally {
      row.finishedAt = new Date().toISOString();
    }
  }
  try {
    receipt.sourceProbeFingerprint = remuxProbeFingerprint(sourceProbe);
    receipt.outputProbeFingerprint = remuxProbeFingerprint(outputProbe);
    demand(receipt.sourceProbeFingerprint === assessment.sourceEvidenceFingerprint, 'The source probe differs from the existing AAC assessment.');
    const evidence = await verifyMkvAacCopy({ clock, sourcePath, sourceIdentity, outputPath, ffprobe, ffmpeg, signal, invoke, onProgress });
    demand(remuxProbeFingerprint(evidence.sourcePackets) === receipt.sourceProbeFingerprint
      && remuxProbeFingerprint(evidence.outputPackets) === receipt.outputProbeFingerprint,
    'The fresh packet probes differ from the assessed source or temporary output.');
    for (const field of ['sourceBefore', 'sourceAfter', 'outputBefore', 'outputAfter']) receipt[field] = evidence[field];
    const mappings = assessment.expectedOutput.streams;
    const inventory = { signal, target: assessment.target, maxRecords: budget.maxRecords, timeoutMs: budget.timeoutMs };
    const nativeSource = await observeNativeInventory({ ...inventory, file: sourcePath, probe: sourceProbe,
      identity: evidence.sourceAfter, family: 'matroska', selectedIndexes: mappings.map(row => row.inputIndex) });
    const nativeOutput = await observeNativeInventory({ ...inventory, file: outputPath, probe: outputProbe,
      identity: evidence.outputAfter, family: 'isobmff', selectedIndexes: mappings.map(row => row.outputIndex) });
    receipt.nativeInventory = compareNativeInventories(nativeSource, nativeOutput, mappings);
    const ratio = (numerator, denominator) => ({ numerator: String(numerator), denominator: String(denominator) });
    const visibleStart = ratio(0, 1);
    // Compare the admitted *output* intervals. The optional signed audio
    // movement is independently derived from the current source and verified
    // by the complete AAC witness before choosing these exact edits.
    receipt.nativeEditLists = await observeRemuxEditLists({
      fileReceipt: { path: outputPath, sha256: evidence.copy.outputSha256, bytes: Number(evidence.outputAfter.size),
        identity: { ...evidence.outputAfter, nlink: '1' } },
      outputProbe, exact: true, signal, maxRecords: budget.maxRecords, timeoutMs: budget.timeoutMs,
      intervals: [
        { outputIndex: 0, firstPts: visibleStart, visibleStart, endPts: ratio(clock.videoFrames, 25), packetCount: clock.videoFrames },
        { outputIndex: 1, firstPts: ratio(-clock.initialPadding, clock.sampleRate), visibleStart,
          endPts: ratio(clock.sampleFrames, clock.sampleRate), packetCount: clock.codedAudioPackets },
      ],
    });
    receipt.essenceEvidence = {
      version: REMUX_VALIDATION_VERSION, complete: true, runtimeIdentity, outputId: outputId.toLowerCase(),
      sourceFingerprint: assessment.sourceFingerprint, sourceEvidenceFingerprint: receipt.sourceProbeFingerprint,
      outputEvidenceFingerprint: receipt.outputProbeFingerprint, outputFileSha256: evidence.copy.outputSha256,
      verificationMethod, verificationClaim, streams: [], mkvAacCopy: evidence.copy,
    };
    if (signal?.aborted) throw new ToolError('CANCELLED', 'AAC copy verification was cancelled.');
    receipt.status = 'completed';
    await save('receipt.json');
    if (signal?.aborted) throw new ToolError('CANCELLED', 'AAC copy verification was cancelled.');
  } catch (error) {
    receipt.status = signal?.aborted ? 'cancelled' : 'failed';
    receipt.essenceEvidence = null;
    receipt.failure = { code: error.code ?? 'REMUX_MKV_AAC_COPY_UNVERIFIED',
      message: error instanceof ToolError ? error.message : 'Complete AAC preservation could not be verified. The temporary output was retained.' };
    try { await save('failure.json'); } catch { receipt.persistenceFailed = true; }
  }
  return receipt;
}

module.exports = { verifyMkvAacCopy, collectMkvAacRemuxEvidence, recheckMkvAacStage };
