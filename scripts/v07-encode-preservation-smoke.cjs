'use strict';

// Root-scheduled O07 proof on one short generated ISO-BMFF source. Lab and
// default-factory evidence are distinct; personal media is never an input.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { verifyCandidateRuntime, assertOrdinaryPath } = require('../src/candidate-runtime.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { FAMILIES, POLICY_ID } = require('../src/operation-catalog.cjs');
const { SOURCE_CLASS, describeEncodePreservationSource } = require('../src/encode-preservation.cjs');
const { ENCODE_PRESERVATION_PRODUCER_PATHS } = require('../src/encode-preservation-producers.cjs');
const { verifySourceCatalogSeals } = require('../src/source-catalog-seals.cjs');
const { inspectMetadata } = require('../src/inspection.cjs');
const { readSourceIdentity, sameIdentity } = require('../src/source-identity.cjs');
const { classifyMarker } = require('../src/provenance.cjs');
const ROOT = path.resolve(__dirname, '..');
const OWNED = 'F:\\FFmpeg Encoder Project supplied videos\\_FFmpeg-0.7-Owned';
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const [mode, campaignArgument] = process.argv.slice(2);
  assert.ok(['--generate', '--lab', '--default', '--cancel'].includes(mode));
  assert.equal(process.argv.length, mode === '--generate' ? 3 : 4);
  const id = randomUUID(), campaign = mode === '--generate' ? path.join(OWNED, 'outputs/o07-tmcd-' + id) : path.resolve(campaignArgument);
  assert.ok(campaign.startsWith(path.join(OWNED, 'outputs/o07-tmcd-')) && path.dirname(campaign) === path.join(OWNED, 'outputs'));
  const input = path.join(campaign, 'input'), source = path.join(input, 'source.mp4');
  const directory = path.join(ROOT, 'artifacts/v0.7/o-acceptance-2026-10-23/actual', id);
  const reportPath = path.join(directory, 'report.json'), leasePath = path.join(ROOT, 'artifacts/v0.7/media-job.lock');
  const report = { schema: 1, id, mode, status: 'running', startedAt: new Date().toISOString(), campaign, directory,
    limits: { totalMs: 15 * 60000, maxChildren: 160, forecastBytes: 2 * 1024 ** 3, fixtureGenerations: mode === '--generate' ? 1 : 0, workflowStarts: mode === '--generate' ? 0 : mode === '--default' ? 2 : 1 },
    invocations: [], maximumConcurrentChildren: 0,
    limitations: ['One generated four-second1080p60 AV1/AAC/tmcd MP4 source; no general MOV/timecode/HDR/vendor qualification.',
      'Timed timecode track and linked editing/synchronization relationship are explicitly lost; copied starting text is not timed-track equivalence.',
      'Short complete verification qualifies this fixed mapping/configuration, not lossless video, perceptual quality or a long-source full decode.',
      'Service workflow only; no Electron/native/portable/clean-machine/owner acceptance.'] };
  const controller = new AbortController(), children = new Set();
  let service, lease, leaseIdentity, runtime, cancelTimer, manifest, reportHandle, pendingTool = false, cancelNext = false;
  const leaseBytes = Buffer.from(JSON.stringify({ token: id, pid: process.pid, purpose: 'Bounded O07 generated MP4 timed-track omission proof' }));
  const directoryIdentities = new Map();
  const ordinary = value => value.isFile() && !value.isSymbolicLink() && value.nlink === 1n;
  const fileStamp = value => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => String(value[key])).join(':');
  async function save() {
    if (!reportHandle) return;
    const held = await reportHandle.stat({ bigint: true }), named = await fs.lstat(reportPath, { bigint: true });
    assert.ok(ordinary(held) && ordinary(named) && held.dev === named.dev && held.ino === named.ino);
    const bytes = Buffer.from(JSON.stringify(report, null, 2)); assert.ok(bytes.length <= 8 * 1024 ** 2);
    let offset = 0; while (offset < bytes.length) { const value = await reportHandle.write(bytes, offset, bytes.length - offset, offset); assert.ok(value.bytesWritten > 0); offset += value.bytesWritten; }
    await reportHandle.truncate(bytes.length); await reportHandle.sync();
  }
  async function guardDirectory(folder) {
    await assertOrdinaryPath(folder, 'directory');
    const stat = await fs.lstat(folder, { bigint: true }), identity = [stat.dev, stat.ino, stat.birthtimeNs].map(String).join(':');
    if (directoryIdentities.has(folder)) assert.equal(identity, directoryIdentities.get(folder)); else directoryIdentities.set(folder, identity);
  }
  async function requireLease() {
    assert.ok(lease && leaseIdentity);
    const held = await lease.stat({ bigint: true }), named = await fs.lstat(leasePath, { bigint: true });
    assert.ok(ordinary(held) && ordinary(named)); assert.equal(fileStamp(held), fileStamp(leaseIdentity)); assert.equal(fileStamp(named), fileStamp(leaseIdentity));
    assert.ok((await fs.readFile(leasePath)).equals(leaseBytes));
  }
  function requireComplete(result) {
    assert.equal(result.exitCode, 0); assert.equal(result.stderrCapture?.truncated, false); assert.equal(result.stderr.trim(), '');
    if (result.stdoutCapture) assert.equal(result.stdoutCapture.truncated, false);
  }
  const abort = () => { controller.abort(); void service?.cancelCurrent(); };
  const totalTimer = setTimeout(abort, report.limits.totalMs); totalTimer.unref();
  async function resources() {
    const [d, f] = await Promise.all([fs.statfs(ROOT), fs.statfs(OWNED)]);
    const value = { at: new Date().toISOString(), DFreeBytes: d.bavail * d.bsize, FFreeBytes: f.bavail * f.bsize };
    assert.ok(value.DFreeBytes >= 25 * 1024 ** 3 && value.FFreeBytes >= report.limits.forecastBytes + 512 * 1024 ** 2); return value;
  }
  async function run(...parameters) {
    assert.equal(pendingTool, false, 'Tool admission remains owned through all awaits, close and sink drainage.'); pendingTool = true;
    try { return await tracked(...parameters); } finally { pendingTool = false; }
  }
  async function tracked(executable, args, options = {}, execute = runTool) {
    assert.ok(!controller.signal.aborted); assert.equal(children.size, 0); assert.ok(report.invocations.length < report.limits.maxChildren);
    await requireLease();
    for (const folder of directoryIdentities.keys()) await guardDirectory(folder);
    assert.ok(verifySourceCatalogSeals(report.producers, ROOT)); await resources();
    const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
    if (executable === helper) {
      assert.deepEqual(args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command']);
      assert.equal(args.length, 5); assert.deepEqual(JSON.parse(options.input), { root: 'F:\\' }); assert.ok(args[4].includes('[System.IO.DriveInfo]::new'));
    } else assert.ok([runtime.ffmpeg, runtime.ffprobe].includes(executable));
    assert.ok(!args.includes('-y'));
    for (let index = 0; index < args.length; index++) if (args[index] === '-i') assert.ok(args[index + 1].startsWith(campaign + path.sep)
      || /^(testsrc2=|sine=|color=)/.test(args[index + 1]), 'Only owned fixture or built-in capability inputs.');
    const inputs = args.flatMap((value, index) => value === '-i' && path.isAbsolute(args[index + 1]) ? [args[index + 1]] : []);
    if (executable === runtime.ffprobe && path.isAbsolute(args.at(-1))) inputs.push(args.at(-1));
    for (const file of inputs) { await assertOrdinaryPath(file); assert.ok(ordinary(await fs.lstat(file, { bigint: true }))); }
    if (executable === runtime.ffmpeg && path.isAbsolute(args.at(-1))) assert.ok(args.at(-1).startsWith(campaign + path.sep));
    if (executable === runtime.ffmpeg && path.isAbsolute(args.at(-1))) await assertOrdinaryPath(path.dirname(args.at(-1)), 'directory');
    const call = { executable, args: [...args], phase: service?.snapshot().phase || 'fixture', startedAt: new Date().toISOString(), status: 'running' };
    report.invocations.push(call); await save(); let child;
    const cancellingWorkflow = (mode === '--cancel' || cancelNext) && executable === runtime.ffmpeg && args.includes(source) && service?.snapshot().phase === 'running';
    const requestOwnedCancel = () => {
      if (report.cancelRequestedAt) return;
      clearTimeout(cancelTimer); report.cancelRequestedAt = new Date().toISOString(); void service.cancelCurrent();
    };
    try {
      const result = await execute(executable, args, { ...options, signal: options.signal || controller.signal,
        ...(typeof options.onProgress === 'function' ? { onProgress: progress => {
          options.onProgress(progress);
          if (cancellingWorkflow && Number(progress.frame) > 0 && !report.cancelRequestedAt) {
            report.cancelObservedProgress = { ...progress }; requestOwnedCancel();
          }
        } } : {}), onChild(value) {
        assert.equal(children.size, 0);
        child = value; children.add(value); report.maximumConcurrentChildren = Math.max(report.maximumConcurrentChildren, children.size);
        value.once('close', (code, signal) => { call.closed = { code, signal }; children.delete(value); }); options.onChild?.(value);
        if (cancellingWorkflow) {
          report.cancelOwnedChildPid = value.pid;
          cancelTimer = setTimeout(requestOwnedCancel, 5000);
        }
      } });
      Object.assign(call, { status: 'completed', exitCode: result.exitCode, stderr: result.stderr, stderrCapture: result.stderrCapture,
        stdout: result.stdout, stdoutCapture: result.stdoutCapture }); return result;
    } catch (error) { Object.assign(call, { status: 'failed', code: error.code, message: error.message, stderr: error.stderr, exitCode: error.exitCode, exitSignal: error.exitSignal }); throw error; }
    finally { if (child) assert.ok(call.closed); call.finishedAt = new Date().toISOString(); await save(); }
  }
  async function verifyOutput(file, entry) {
    const combined = await inspectMetadata(file, { ffprobe: runtime.ffprobe, run }); report.independentOutputProbe = combined;
    assert.equal(combined.streams.length, 2); assert.equal(combined.chapters.length, 0); assert.equal(combined.programs.length, 0); assert.equal(combined.stream_groups.length, 0);
    assert.equal(combined.mediaEvidence.container.relationships.state, 'known');
    const [video, audio] = combined.streams;
    assert.equal(video.codec_name, 'hevc'); assert.equal(video.width, 1920); assert.equal(video.height, 1080); assert.equal(video.sample_aspect_ratio, '1:1'); assert.equal(video.field_order, 'progressive');
    assert.deepEqual([video.color_transfer, video.color_primaries, video.color_space, video.color_range], ['bt709', 'bt709', 'bt709', 'tv']);
    assert.deepEqual([audio.codec_name, audio.profile, audio.sample_rate, audio.channels, audio.channel_layout], ['aac', 'LC', '48000', 2, 'stereo']);
    const marker = classifyMarker(combined); assert.equal(marker.kind, 'generated'); assert.equal(marker.outputId, entry.outputId); assert.deepEqual(marker.previousGeneration, entry.generationDescription);
    const observe = async (target, args) => {
      const result = await run(runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', ...args, '-of', 'json', target], { timeoutMs: 120000, stdoutLimit: 8 * 1024 ** 2 });
      requireComplete(result); return JSON.parse(result.stdout);
    };
    const frames = [];
    for (const target of [source, file]) {
      const data = await observe(target, ['-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pts_time,duration_time,width,height,pix_fmt,interlaced_frame,sample_aspect_ratio']);
      assert.equal(data.frames.length, 240); assert.ok(data.frames.every(frame => frame.width === 1920 && frame.height === 1080 && frame.pix_fmt === 'yuv420p' && frame.interlaced_frame === 0));
      frames.push(data.frames);
    }
    const sourceZero = Number(frames[0][0].pts_time), outputZero = Number(frames[1][0].pts_time);
    const maxVideoTimestampDifference = Math.max(...frames[0].map((frame, index) => Math.abs(Number(frame.pts_time) - sourceZero - Number(frames[1][index].pts_time) + outputZero)));
    assert.ok(maxVideoTimestampDifference <= .00051);
    const maxFrameDurationDifference = Math.max(...frames[0].map((frame, index) => Math.abs(Number(frame.duration_time) - Number(frames[1][index].duration_time))));
    assert.ok(maxFrameDurationDifference <= .0011);
    const packets = [];
    for (const target of [source, file]) {
      const data = await observe(target, ['-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=pts_time,duration_time,size,data_hash,side_data_list']);
      assert.ok(data.packets.length > 0);
      assert.ok(data.packets.every(packet => /^SHA256:[a-f0-9]{64}$/i.test(packet.data_hash)
        && /^[1-9]\d*$/.test(String(packet.size)) && Number.isFinite(Number(packet.pts_time)) && packet.pts_time !== undefined));
      packets.push(data.packets);
    }
    assert.deepEqual(packets[0].map(packet => [packet.size, packet.data_hash]), packets[1].map(packet => [packet.size, packet.data_hash]));
    const commonTimestampShift = outputZero - sourceZero;
    const maxPacketTimestampDifference = Math.max(...packets[0].map((packet, index) => Math.abs(Number(packet.pts_time) + commonTimestampShift - Number(packets[1][index].pts_time))));
    assert.ok(maxPacketTimestampDifference <= .0011, 'Audio and video must retain their relative timing under the same container shift.');
    const pcm = [];
    for (const target of [source, file]) {
      let bytes = 0; const digest = createHash('sha256');
      const result = await run(runtime.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-protocol_whitelist', 'file,pipe', '-i', target,
        '-map', '0:a:0', '-vn', '-sn', '-dn', '-c:a', 'pcm_f32le', '-f', 'f32le', 'pipe:1'], { timeoutMs: 120000,
        onStdoutChunk: chunk => { bytes += chunk.length; assert.ok(bytes <= 4 * 1024 ** 2); digest.update(chunk); } });
      requireComplete(result); assert.ok(bytes > 0); assert.equal(result.stdoutCapture.totalBytes, bytes);
      pcm.push({ bytes, sha256: digest.digest('hex') });
    }
    report.independentPartial = { frames: 240, maxVideoTimestampDifference, commonTimestampShift,
      maxPacketTimestampDifference, packetPayloadsIdentical: true, pcm };
    await save();
    assert.deepEqual(pcm[0], pcm[1], 'Copied AAC must preserve complete playable samples, not only packet payloads.');
    assert.equal(pcm[0].bytes % 8, 0);
    const audioFrames = [];
    for (const target of [source, file]) {
      const data = await observe(target, ['-select_streams', 'a:0', '-show_frames', '-show_entries', 'frame=pts_time,nb_samples,sample_fmt,channels,channel_layout']);
      assert.ok(data.frames.length > 0); assert.ok(data.frames.every(frame => frame.channels === 2 && frame.channel_layout === 'stereo' && frame.sample_fmt === 'fltp'));
      audioFrames.push(data.frames);
    }
    assert.equal(audioFrames[0].reduce((sum, frame) => sum + Number(frame.nb_samples), 0), audioFrames[1].reduce((sum, frame) => sum + Number(frame.nb_samples), 0));
    for (let index = 0; index < 2; index++) assert.equal(pcm[index].bytes, audioFrames[index].reduce((sum, frame) => sum + Number(frame.nb_samples), 0) * 2 * 4);
    assert.ok(Math.abs(Number(audioFrames[0][0].pts_time) + commonTimestampShift - Number(audioFrames[1][0].pts_time)) <= .0011);
    return { frames: 240, maxVideoTimestampDifference, maxFrameDurationDifference, sourceVideoOrigin: sourceZero, outputVideoOrigin: outputZero,
      commonTimestampShift, maxPacketTimestampDifference, copiedAudioPackets: packets[0].length, packetPayloadsIdentical: true,
      pcm, samples: pcm[0].bytes / 8, completePcmIdentical: true };
  }
  try {
    await guardDirectory(OWNED); await guardDirectory(path.join(OWNED, 'outputs'));
    await guardDirectory(path.dirname(path.dirname(directory))); await fs.mkdir(path.dirname(directory), { recursive: true }); await guardDirectory(path.dirname(directory));
    await fs.mkdir(directory); await guardDirectory(directory); reportHandle = await fs.open(reportPath, 'wx+');
    await fs.writeFile(path.join(directory, 'executed-harness.cjs'), await fs.readFile(__filename), { flag: 'wx' });
    report.resourcesBefore = await resources(); await save();
    lease = await fs.open(leasePath, 'wx+');
    const empty = await lease.stat({ bigint: true }); assert.ok(ordinary(empty) && empty.size === 0n);
    assert.equal(fileStamp(empty), fileStamp(await fs.lstat(leasePath, { bigint: true })));
    await lease.writeFile(leaseBytes); await lease.sync(); leaseIdentity = await lease.stat({ bigint: true }); await requireLease();
    runtime = await verifyCandidateRuntime({ root: ROOT }); report.runtime = runtime.verified;
    report.runtimeIdentity = sha(JSON.stringify(runtime.verified.slice(0, 2).map(({ sizeBytes, sha256 }) => ({ sizeBytes, sha256 }))));
    report.producers = Object.fromEntries(await Promise.all(ENCODE_PRESERVATION_PRODUCER_PATHS.map(async file => [file, sha(await fs.readFile(path.join(ROOT, file)))])));
    report.harnessSha256 = sha(await fs.readFile(__filename)); assert.ok(verifySourceCatalogSeals(report.producers, ROOT));
    assert.equal(sha(await fs.readFile(path.join(directory, 'executed-harness.cjs'))), report.harnessSha256);
    if (mode === '--generate') {
      await fs.mkdir(campaign); await guardDirectory(campaign); await fs.mkdir(input); await guardDirectory(input);
      await run(runtime.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'warning', '-n', '-f', 'lavfi', '-i',
        'testsrc2=size=1920x1080:rate=60:duration=4', '-f', 'lavfi', '-i', 'sine=frequency=997:sample_rate=48000:duration=4',
        '-map', '0:v:0', '-map', '1:a:0', '-vf', 'setsar=1,setfield=prog,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709', '-frames:v', '240', '-c:v', 'libsvtav1', '-preset', '9', '-crf', '32',
        '-svtav1-params', 'color-primaries=1:transfer-characteristics=1:matrix-coefficients=1:color-range=0',
        '-pix_fmt', 'yuv420p', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv',
        '-c:a', 'aac', '-profile:a', 'aac_low', '-ar', '48000', '-ac', '2', '-b:a', '192k',
        '-field_order', 'progressive', '-metadata:s:v:0', 'timecode=01:02:03:04', '-video_track_timescale', '15360', '-write_tmcd', '1', '-f', 'mp4', source], { timeoutMs: 180000, stdoutLimit: 1024 * 1024 });
      report.sourceProbe = await inspectMetadata(source, { ffprobe: runtime.ffprobe, run });
      report.describedSource = describeEncodePreservationSource(report.sourceProbe);
      report.source = { file: source, sha256: sha(await fs.readFile(source)), bytes: (await fs.stat(source)).size, identity: await readSourceIdentity(source) };
      assert.ok(report.describedSource, 'Actual generated source must independently match the finite class; no synthetic probe substitution.');
      manifest = { schema: 1, campaign, source: report.source, generationReport: reportPath, generationId: id, workflowStarts: [] };
      await fs.writeFile(path.join(campaign, 'campaign.json'), JSON.stringify(manifest, null, 2), { flag: 'wx' });
      report.status = 'passed-one-generated-source';
    } else {
      await guardDirectory(campaign); await guardDirectory(input); await assertOrdinaryPath(source); assert.ok(ordinary(await fs.lstat(source, { bigint: true })));
      manifest = JSON.parse(await fs.readFile(path.join(campaign, 'campaign.json'), 'utf8'));
      assert.equal(manifest.campaign, campaign); assert.equal(manifest.source.file, source);
      assert.equal(sha(await fs.readFile(source)), manifest.source.sha256); assert.ok(sameIdentity(await readSourceIdentity(source), manifest.source.identity));
      assert.ok(Array.isArray(manifest.workflowStarts) && manifest.workflowStarts.length < 3 && !manifest.workflowStarts.some(value => value.mode === mode));
      const stateDir = path.join(campaign, 'state-' + mode.slice(2)), output = path.join(campaign, 'output-' + mode.slice(2)); await fs.mkdir(output); await fs.mkdir(stateDir);
      await guardDirectory(output); await guardDirectory(stateDir);
      const controls = createOperationControls({ runtime, stateDir, families: FAMILIES, policyIdentity: POLICY_ID,
        ...(mode === '--lab' ? { encodePreservationPolicies: [{ id: 'prospective-owned-tmcd-proof', sourceClass: SOURCE_CLASS,
          runtimeIdentity: report.runtimeIdentity, evidenceIds: ['prospective-O07-proof'] }], encodePreservationPolicyIdentity: 'prospective-O07-only' } : {}) });
      const observer = controls.operationRuntime, original = observer.invoke.bind(observer);
      observer.invoke = (token, tool, args, options) => run(runtime[tool], args, options, (_file, argv, opts) => original(token, tool, argv, opts));
      service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir, runtimeIdentity: report.runtimeIdentity,
        inspectionWorkers: 1, run, ...controls });
      await service.initializeDiagnostics();
      const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
      await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: SETTINGS });
      report.initial = service.snapshot(); let s = report.initial, item = s.items[0];
      assert.equal(item.reasonCode, 'ENCODE_PRESERVATION_DECISION_REQUIRED', item.reason);
      const decision = item.encodePreservation.omissionCandidates[0];
      await service.setEncodePreservationDecisions({ planId: s.planId, draftId: s.operationDraft.id, revision: s.operationDraft.revision, decisionIds: [decision.id] });
      s = service.snapshot(); item = s.items[0]; report.prepared = s; assert.equal(item.status, 'ready', item.reason);
      report.preparedDetails = service.getEncodingDetails({ planId: s.planId, fileId: item.id });
      assert.equal(report.preparedDetails.operation.validationMode, 'full-preservation-selection');
      manifest.workflowStarts.push({ mode, id, startedAt: new Date().toISOString() }); await fs.writeFile(path.join(campaign, 'campaign.json'), JSON.stringify(manifest, null, 2));
      service.startBatch({ planId: s.planId, fileIds: [item.id] }); await service.taskPromise;
      report.result = service.snapshot(); const result = report.result.items[0], entry = service.plan.entries.get(item.id);
      if (mode === '--cancel') {
        assert.ok(report.cancelRequestedAt && report.cancelOwnedChildPid && report.cancelObservedProgress?.frame > 0); assert.equal(result.status, 'cancelled', result.reason);
        assert.equal(await fs.stat(entry.destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false);
        assert.throws(() => service.startBatch({ planId: s.planId, fileIds: [item.id] }), { code: 'STALE_PLAN' });
        report.status = 'passed-actual-owned-cancel';
      } else {
        assert.equal(result.status, 'success', result.reason); assert.equal(result.outcome, 'saved-with-warning');
        assert.ok(result.warnings.some(warning => warning.code === 'TIMED_TIMECODE_TRACK_OMITTED'));
        report.output = { file: entry.destination, bytes: (await fs.stat(entry.destination)).size, sha256: sha(await fs.readFile(entry.destination)) };
        report.independent = await verifyOutput(entry.destination, entry); report.status = 'passed-bounded-full-preservation-service';
        await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: SETTINGS });
        report.existingOutput = service.snapshot(); assert.equal(report.existingOutput.items[0].status, 'skipped');
        assert.throws(() => service.startBatch({ planId: report.existingOutput.planId, fileIds: [report.existingOutput.items[0].id] }), { code: 'INVALID_SELECTION' });
        assert.equal(sha(await fs.readFile(entry.destination)), report.output.sha256);
        if (mode === '--default') {
          // The default-success service already owns fresh capability evidence.
          // Reuse it for the third Start, with a distinct destination and a new
          // exact per-file decision; no repeated cold capability campaign.
          assert.equal(manifest.workflowStarts.length, 2);
          const cancelOutput = path.join(campaign, 'output-cancel'); await fs.mkdir(cancelOutput); await guardDirectory(cancelOutput);
          const c = await service.registerFolder(cancelOutput, 'output');
          await service.prepareBatch({ inputFolderId: a.id, outputFolderId: c.id, settings: SETTINGS });
          let next = service.snapshot(), nextItem = next.items[0]; assert.equal(nextItem.reasonCode, 'ENCODE_PRESERVATION_DECISION_REQUIRED');
          await service.setEncodePreservationDecisions({ planId: next.planId, draftId: next.operationDraft.id, revision: next.operationDraft.revision,
            decisionIds: [nextItem.encodePreservation.omissionCandidates[0].id] });
          next = service.snapshot(); nextItem = next.items[0]; assert.equal(nextItem.status, 'ready', nextItem.reason);
          report.cancellationPrepared = next;
          manifest.workflowStarts.push({ mode: '--cancel', id, startedAt: new Date().toISOString(), reusedCapabilities: true });
          await fs.writeFile(path.join(campaign, 'campaign.json'), JSON.stringify(manifest, null, 2));
          cancelNext = true; service.startBatch({ planId: next.planId, fileIds: [nextItem.id] }); await service.taskPromise; cancelNext = false;
          report.cancellationResult = service.snapshot(); const cancelled = report.cancellationResult.items[0], cancelledEntry = service.plan.entries.get(nextItem.id);
          assert.ok(report.cancelRequestedAt && report.cancelOwnedChildPid && report.cancelObservedProgress?.frame > 0); assert.equal(cancelled.status, 'cancelled', cancelled.reason);
          assert.equal(await fs.stat(cancelledEntry.destination).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error)), false);
          assert.throws(() => service.startBatch({ planId: next.planId, fileIds: [nextItem.id] }), { code: 'STALE_PLAN' });
          assert.equal(service.plan.encodePreservationGrants.size, 0);
          report.status = 'passed-default-full-preservation-and-actual-cancel';
        }
      }
      assert.equal(sha(await fs.readFile(source)), manifest.source.sha256); assert.ok(sameIdentity(await readSourceIdentity(source), manifest.source.identity));
    }
    report.resourcesAfter = await resources();
  } catch (error) { report.status = 'failed-retained'; report.failure = { code: error.code, message: error.message, stack: error.stack }; process.exitCode = 1; }
  finally {
    clearTimeout(totalTimer); clearTimeout(cancelTimer); report.closureFailures = [];
    const attempt = async (label, fn) => { try { await fn(); } catch (error) { report.closureFailures.push({ label, code: error.code, message: error.message }); report.status = 'failed-retained'; process.exitCode = 1; } };
    if (service) { await attempt('cancel', () => service.cancelCurrent()); await attempt('resources', () => service.closeOperationResources());
      await attempt('diagnostics', async () => { report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed'); assert.equal(report.diagnosticClosure.persisted, true); });
      await attempt('durable-warning-readback', async () => {
        const history = await service.diagnostics.list({ limit: 200 });
        report.durableDecisions = [];
        for (const event of history.events.filter(value => ['ENCODE_STARTED', 'OUTPUT_CHECKED', 'JOB_DISPOSITION'].includes(value.reason))) {
          const read = await service.diagnostics.read(event.id); assert.ok(read.event); report.durableDecisions.push(read.event);
        }
        for (const event of report.durableDecisions.filter(value => value.reason === 'ENCODE_STARTED')) assert.equal(event.context.operation.resolved.preservation.warning.code, 'TIMED_TIMECODE_TRACK_OMITTED');
        for (const event of report.durableDecisions.filter(value => value.reason === 'OUTPUT_CHECKED')) assert.ok(event.context.validation.warnings.some(value => value.code === 'TIMED_TIMECODE_TRACK_OMITTED'));
      }); }
    report.liveChildren = children.size; await attempt('children', async () => assert.equal(children.size, 0));
    if (lease && !children.size) await attempt('lease', async () => {
      await requireLease(); await lease.close();
      const finalNamed = await fs.lstat(leasePath, { bigint: true }); assert.ok(ordinary(finalNamed)); assert.equal(fileStamp(finalNamed), fileStamp(leaseIdentity));
      assert.ok((await fs.readFile(leasePath)).equals(leaseBytes)); await fs.unlink(leasePath); report.leaseReleased = true;
    });
    if (report.producers) await attempt('producer-freeze', async () => assert.ok(verifySourceCatalogSeals(report.producers, ROOT)));
    report.finishedAt = new Date().toISOString(); await save(); await reportHandle?.close(); console.log(JSON.stringify({ status: report.status, report: reportPath, campaign, failure: report.failure }));
  }
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
