'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES } = require('../src/media.cjs');
const { createOperationControls, EVIDENCE_BUDGET, EXECUTION_BUDGET_MS } = require('../src/operation-controls.cjs');
const { normalizeProbe, parseProbeJson } = require('../src/inspection.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { UHD_FULL_FAMILY_ID, UHD_FULL_RESOURCE_POLICY, RESIZE_1440_FAMILY_ID, RESIZE_1440_RESOURCE_POLICY } =
  require('../src/operation-resource-budget.cjs');
const { createOwnedSession, hashFile, copyPinnedFile, readBoundedFile, sha, ROOT, fault } = require('./v07-remux-long-fixtures.cjs');
const { frozenQualifications } = require('./v07-sdr-flac-range-calibration.cjs');

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ totalMs: 25 * 60000, childMs: 9 * 60000, maxChildren: 95, maxStarts: 4,
  minimumDFreeBytes: 25 * GiB, marginBytes: 1024 * MiB, forecastBytes: 4 * GiB, reportBytes: 32 * MiB });
const SETTINGS = Object.freeze({ profileId: 'h265-cpu', preset: 'slow', quality: 25 });
const SPECIMENS = Object.freeze([
  { label: 'short-uhd', width: 3840, height: 2160, seconds: 8, frequency: 433 },
  { label: 'short-1440p', width: 2560, height: 1440, seconds: 8, frequency: 383 },
]);
const CASES = Object.freeze([
  { specimen: 0, resolution: '1440', width: 2560, height: 1440, range: null, frames: 240, samples: 384000 },
  { specimen: 0, resolution: '1080', width: 1920, height: 1080, range: null, frames: 240, samples: 384000 },
  // The existing shared UHD family has three outputs. Measure all three
  // before proposing any Windows default activation for that designation.
  { specimen: 0, resolution: '720', width: 1280, height: 720, range: null, frames: 240, samples: 384000 },
  { specimen: 1, resolution: '720', width: 1280, height: 720, range: { startUs: 1013000, endUs: 2787000 }, frames: 53, samples: 85152 },
]);

const LONG_SPECIMENS = Object.freeze([
  { label: 'long-uhd', width: 3840, height: 2160, seconds: 150, frequency: 477 },
  { label: 'long-1440p', width: 2560, height: 1440, seconds: 150, frequency: 523 },
]);
const LONG_CASES = Object.freeze([
  { specimen: 0, resolution: '1440', width: 2560, height: 1440, range: null, frames: 4500, samples: 7200000 },
  { specimen: 1, resolution: '720', width: 1280, height: 720, range: { startUs: 110000000 }, frames: 1200, samples: 1920000 },
]);


const NORMAL_SPECIMENS = Object.freeze([
  { label: 'normal-uhd', width: 3840, height: 2160, seconds: 125, frequency: 587 },
  { label: 'normal-1440p', width: 2560, height: 1440, seconds: 145, frequency: 641 },
]);
const NORMAL_CASES = Object.freeze([
  { specimen: 0, resolution: '720', width: 1280, height: 720, range: null, frames: 3750, samples: 6000000 },
  { specimen: 1, resolution: '720', width: 1280, height: 720, range: { startUs: 106000000 }, frames: 1170, samples: 1872000 },
]);

function fixtureArgs({ width, height, seconds, frequency }, output) {
  const video = 'testsrc2=size=' + width + 'x' + height + ':rate=30:duration=' + seconds;
  const audio = 'aevalsrc=0.18*sin(2*PI*(' + frequency + '*t+5.5*t*t))|0.18*sin(2*PI*('
    + (frequency + 219) + '*t+6.5*t*t)):s=48000:c=stereo:d=' + seconds;
  return ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-f', 'lavfi', '-i', video, '-f', 'lavfi', '-i', audio,
    '-map', '0:v:0', '-map', '1:a:0', '-map_metadata', '-1', '-map_chapters', '-1',
    '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    '-c:v:0', 'libx264', '-preset:v:0', 'veryfast', '-crf:v:0', '23', '-threads:v:0', '4',
    '-profile:v:0', 'high', '-pix_fmt:v:0', '+yuv420p', '-x264-params', 'keyint=60:min-keyint=60:scenecut=0:bframes=3:b-adapt=0:open-gop=0',
    '-fps_mode:v:0', 'passthrough', '-color_primaries:v:0', 'bt709', '-color_trc:v:0', 'bt709',
    '-colorspace:v:0', 'bt709', '-color_range:v:0', 'tv', '-c:a:0', 'pcm_s16le', '-sample_fmt:a:0', 's16',
    '-ar:a:0', '48000', '-channel_layout:a:0', 'stereo', '-t', String(seconds), '-video_track_timescale', '15360',
    '-movflags', '+faststart', '-f', 'mov', output];
}

async function probe(session, file, countFrames = false) {
  const result = await session.run(session.runtime.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file',
    ...(countFrames ? ['-count_frames'] : []), '-show_streams', '-show_format', '-show_chapters', '-show_programs', '-show_stream_groups',
    '-show_data_hash', 'sha256', '-of', 'json', '-i', file], { stdoutLimit: 2 * MiB });
  assert.equal(result.stderr, '');
  assert.equal(result.stderrCapture.truncated, false);
  return parseProbeJson(result.stdout, 'Windows owned resize');
}

function checkSpecimen(metadata, spec) {
  const evidence = normalizeProbe(metadata), [video, audio] = evidence.streams;
  assert.equal(evidence.format.tags.major_brand, 'qt  ');
  assert.equal(evidence.streams.length, 2);
  assert.deepEqual([evidence.chapters, evidence.programs, evidence.stream_groups], [[], [], []]);
  for (const [key, value] of Object.entries({ width: spec.width, height: spec.height, codec_name: 'h264', profile: 'High',
    pix_fmt: 'yuv420p', field_order: 'progressive', sample_aspect_ratio: '1:1', display_aspect_ratio: '16:9',
    r_frame_rate: '30/1', avg_frame_rate: '30/1', color_primaries: 'bt709', color_transfer: 'bt709',
    color_space: 'bt709', color_range: 'tv', chroma_location: 'left', time_base: '1/15360', start_pts: 0 })) assert.equal(video[key], value, key);
  for (const [key, value] of Object.entries({ codec_name: 'pcm_s16le', sample_fmt: 's16', sample_rate: '48000',
    channels: 2, channel_layout: 'stereo', time_base: '1/48000', start_pts: 0 })) assert.equal(audio[key], value, key);
  assert.equal(Number(video.duration_ts), spec.seconds * 15360);
  assert.equal(Number(audio.duration_ts), spec.seconds * 48000);
  return evidence;
}

async function observeCpu(session, source, previous) {
  const output = path.join(session.owned, 'cpu-slow-capability.mkv');
  if (previous) {
    const saved = path.join(previous.owned, 'cpu-slow-capability.mkv');
    await copyPinnedFile(saved, output, await hashFile(saved));
  } else {
    const result = await session.run(session.runtime.ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-n', '-threads', '2',
    '-protocol_whitelist', 'file', '-i', source, '-map', '0:v:0', '-vf', 'scale=320:180:flags=lanczos',
    '-c:v:0', 'libx265', '-preset:v:0', 'slow', '-crf:v:0', '25', '-pix_fmt:v:0', '+yuv420p',
    '-x265-params', 'log-level=error', '-frames:v', '2', '-an', '-f', 'matroska', output]);
    assert.equal(result.stderr, '');
  }
  const metadata = await probe(session, output, true), [video] = metadata.streams;
  assert.equal(metadata.streams.length, 1);
  assert.equal(video.codec_name, 'hevc');
  assert.equal(video.width, 320);
  assert.equal(video.height, 180);
  assert.equal(video.nb_read_frames, '2');
  assert.equal(video.pix_fmt, 'yuv420p');
  const versions = {};
  for (const name of ['ffmpeg', 'ffprobe']) {
    versions[name] = (await session.run(session.runtime[name], ['-version'], { stdoutLimit: 64 * 1024 })).stdout.split(/\r?\n/, 1)[0];
    assert(versions[name].startsWith(name + ' version 9.1 '));
  }
  session.report.cpuCapability = { settings: SETTINGS, output: await hashFile(output), validatedFrames: 2, startupProfileScope: 'Only h265-cpu', versions };
  const selected = PROFILES.find(profile => profile.id === SETTINGS.profileId);
  return { profiles: [{ ...selected, available: true, supportedBitDepths: [8] }], recipes: [], vendorProfiles: [], versions };
}

function family(id, policy, metadata, evidenceId) {
  const { qualification, timingQualification } = frozenQualifications(evidenceId, REGULAR_WINDOWS_PAIR, metadata);
  return { id, resourcePolicy: policy, runtimeIdentity: REGULAR_WINDOWS_PAIR, environment: null, settings: SETTINGS,
    qualification, timingQualification, evidenceIds: [qualification.evidenceId, timingQualification.evidenceId] };
}

async function previousFixtures(id, digest, recoverRange) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(digest, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2n-regular-resize/smoke', id);
  const content = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(sha(content), digest);
  const saved = JSON.parse(content);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'failed-retained');
  if (recoverRange) assert.equal(saved.monitorFailure.message, 'Owned growth file changed identity.');
  else assert.equal(saved.failure.message, 'Owned output only.');
  assert.equal(saved.enginePair, REGULAR_WINDOWS_PAIR);
  assert.equal(saved.owned, path.join(directory, 'owned'));
  assert.equal(saved.specimens.length, SPECIMENS.length);
  if (recoverRange) {
    assert.equal(saved.acceptedStarts, 4);
    assert.equal(saved.childrenClosed, 48);
    assert.deepEqual(saved.cases.map(item => item.result.status), ['success', 'success', 'success', 'cancelled']);
  } else {
    assert.equal(saved.acceptedStarts, 0);
    assert.equal(saved.childrenClosed, 6);
  }
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  return saved;
}


async function proveUhdRangeRefusal(session, service, input) {
  const output = path.join(session.owned, 'unqualified-uhd-range');
  await session.io.mkdir(output);
  const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
  await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: SETTINGS });
  const ready = service.snapshot(), item = ready.items[0];
  assert.equal(item.status, 'ready', item.reason);
  await service.updateFileOperations({ planId: ready.planId, draftId: ready.operationDraft.id, revision: ready.operationDraft.revision,
    fileIds: [item.id], overrides: { target: 'matroska', hdrPolicy: 'preserve', range: { startUs: 0, endUs: 4000000 },
      resolution: '720', audioPolicy: 'precision-flac', aacBitrateKbps: null, omissionRequestIds: [] } });
  await service.taskPromise;
  const refused = service.snapshot(), row = refused.items.find(candidate => candidate.id === item.id);
  assert.equal(row.status, 'unsupported', row.reason);
  assert.match(row.reasonCode, /^OPERATION_(?:RESIZE_UNQUALIFIED|QUALIFICATION_REQUIRED)$/);
  const invocations = session.report.invocationAttempts;
  assert.throws(() => service.startBatch({ planId: refused.planId, fileIds: [row.id] }), { code: 'INVALID_SELECTION' });
  assert.equal(session.report.invocationAttempts, invocations);
  assert.deepEqual(await session.io.readdir(output), []);
  return { item: row, startsFromRefusedRequest: 0, childrenFromRefusedStart: 0, destinationEmpty: true };
}

async function proof(mode, previous) {
  const normal = mode === '--owned-normal';
  const long = mode === '--owned-long-lab';
  const recoverRange = mode === '--recover-owned-1440-range';
  const cases = normal ? NORMAL_CASES : long ? LONG_CASES : recoverRange ? CASES.slice(-1) : CASES;
  const specs = normal ? NORMAL_SPECIMENS : long ? LONG_SPECIMENS : SPECIMENS;
  const limits = (normal || long) ? { ...LIMITS, maxStarts: 2 } : recoverRange ? { ...LIMITS, maxStarts: 1 } : LIMITS;
  const session = createOwnedSession({ kind: 'smoke', limits, regularProof: 'resize' });
  const { report, io } = session;
  report.scope = normal ? 'Default Windows factory and Encode service with a separately exercised CPU-only capability provider'
    : 'Provisional ' + (long ? 'long' : 'short') + ' CPU resize family evidence through the real service';
  report.enginePair = REGULAR_WINDOWS_PAIR;
  let service;
  try {
    await session.open();
    const specimens = [];
    report.specimens = specimens;
    if (previous) report.reusedFixtureRun = previous.id;
    for (const [index, spec] of specs.entries()) {
      const input = path.join(session.owned, spec.label);
      await io.mkdir(input);
      const file = path.join(input, spec.label + '.mov');
      if (previous) {
        const saved = previous.specimens[index];
        assert.equal(saved.file, path.join(previous.owned, spec.label, spec.label + '.mov'));
        assert.equal(saved.label, spec.label);
        await copyPinnedFile(saved.file, file, saved.pin);
      } else {
        const result = await session.run(session.runtime.ffmpeg, fixtureArgs(spec, file));
        assert.equal(result.stderr, '');
      }
      specimens.push({ ...spec, input, file, pin: await hashFile(file), probe: checkSpecimen(await probe(session, file), spec) });
      await session.save();
    }
    const capabilities = await observeCpu(session, specimens[0].file, previous);
    const label = long ? 'long' : 'short';
    if (!normal) {
      report.frozenFamilies = [
        family(UHD_FULL_FAMILY_ID, UHD_FULL_RESOURCE_POLICY, specimens[0].probe, 'windows-91-uhd-' + label + '-prospective'),
        family(RESIZE_1440_FAMILY_ID, RESIZE_1440_RESOURCE_POLICY, specimens[1].probe, 'windows-91-1440-' + label + '-prospective'),
      ];
    }
    // The service owns atomic state/ledger replacement under its own
    // storage reservation. The media scan keeps its stricter object rule.
    const stateDir = path.join(session.directory, 'state');
    await io.mkdir(stateDir);
    report.stateDirectory = stateDir;
    const factoryInputs = { runtime: session.runtime, stateDir };
    if (!normal) Object.assign(factoryInputs, { families: report.frozenFamilies, policyIdentity: 'windows-91-q2n-' + label + '-laboratory' });
    const controls = createOperationControls(factoryInputs);
    report.factoryInputKeys = Object.keys(factoryInputs).sort();
    const invoke = controls.operationRuntime.invoke.bind(controls.operationRuntime);
    controls.operationRuntime.invoke = (token, tool, args, options) => session.run(session.runtime[tool], args, options,
      (_file, argv, opts) => invoke(token, tool, argv, opts));
    service = new EncoderService({ ffmpeg: session.runtime.ffmpeg, ffprobe: session.runtime.ffprobe, stateDir,
      inspectionWorkers: 1, runtimeIdentity: REGULAR_WINDOWS_PAIR, run: session.run, ...controls,
      ...(normal ? {} : { operationEvidenceBudget: null, operationDeadlineMs: 120000 }), capabilities: async () => capabilities });
    if (normal) {
      assert.deepEqual(service.operationEvidenceBudget, EVIDENCE_BUDGET);
      assert.equal(service.operationDeadlineMs, EXECUTION_BUDGET_MS);
    }
    await service.initializeDiagnostics();
    session.controller.signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });

    if (normal) {
      report.refused = await proveUhdRangeRefusal(session, service, specimens[0].input);
      await session.save();
    }
    for (const spec of cases) {
      const { input, file, pin } = specimens[spec.specimen];
      const output = path.join(session.owned, 'case-' + spec.specimen + '-' + spec.resolution);
      await io.mkdir(output);
      const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
      await service.prepareBatch({ inputFolderId: a.id, outputFolderId: b.id, settings: SETTINGS });
      let ready = service.snapshot(), item = ready.items[0];
      assert.equal(ready.phase, 'ready', ready.error);
      assert.equal(item.status, 'ready', item.reason);
      const record = { ...spec, source: file, defaultPrepare: ready };
      report.cases.push(record);
      await service.updateFileOperations({ planId: ready.planId, draftId: ready.operationDraft.id, revision: ready.operationDraft.revision,
        fileIds: [item.id], overrides: { target: 'matroska', hdrPolicy: 'preserve', range: spec.range, resolution: spec.resolution,
          audioPolicy: 'precision-flac', aacBitrateKbps: null, omissionRequestIds: [] } });
      await service.taskPromise;
      ready = service.snapshot();
      item = ready.items.find(row => row.id === item.id);
      record.prepared = ready;
      await session.save();
      assert.equal(item.status, 'ready', item.reason);
      const entry = service.plan.entries.get(item.id);
      assert(entry.operationPlan.args.some(value => value.includes('scale=w=' + spec.width + ':h=' + spec.height + ':flags=lanczos')));
      if (normal) {
        const selection = service.operationQualifications.requireCurrent(entry.qualificationSelection, entry.qualificationBindings);
        assert.equal(selection.policyIdentity, 'encode-windows-9.1-v1:2026-11-21:cpu-precision-flac-resize');
        assert.equal(selection.resourcePolicy, spec.range ? RESIZE_1440_RESOURCE_POLICY : UHD_FULL_RESOURCE_POLICY);
        assert.equal(selection.proportional, true);
        assert.deepEqual(entry.encodeControls, { budget: null, executionBudgetMs: EXECUTION_BUDGET_MS });
        record.selection = selection;
      }
      record.preparedArgs = entry.operationPlan.args;
      assert(report.acceptedStarts < limits.maxStarts);
      await service.startBatch({ planId: ready.planId, fileIds: [item.id] });
      report.acceptedStarts++;
      await service.taskPromise;
      const result = service.snapshot().items.find(row => row.id === item.id);
      record.result = result;
      record.evidence = entry.operationEvidence;
      record.telemetry = entry.telemetryValidation;
      await session.save();
      assert.equal(result.status, 'success', result.reason);
      assert.equal(result.outputDisposition.published, true);
      assert.equal(record.evidence.status, 'completed');
      assert.equal(record.telemetry.valid, true);
      assert.deepEqual(result.evidenceStorage.final.violations, []);
      const [audio] = record.evidence.decodedEvidence.audio;
      assert.equal(Number(audio.sourceSampleCount), spec.samples);
      assert.equal(Number(audio.outputSampleCount), spec.samples);
      assert.equal(audio.pcmIdentity.sourceHash, audio.pcmIdentity.outputHash);
      assert.equal(record.evidence.completeSource.video.frames, specimens[spec.specimen].seconds * 30);
      const metadata = await probe(session, entry.destination, true);
      const [video, actualAudio] = metadata.streams;
      assert.equal(metadata.streams.length, 2);
      assert.equal(video.codec_name, 'hevc');
      assert.equal(video.width, spec.width);
      assert.equal(video.height, spec.height);
      assert.equal(Number(video.nb_read_frames), spec.frames);
      assert.equal(video.color_transfer, 'bt709');
      assert.equal(actualAudio.codec_name, 'flac');
      record.output = { file: entry.destination, ...await hashFile(entry.destination), video, audio: actualAudio };
      assert.deepEqual(await hashFile(file), pin);
      assert.equal(session.children.size, 0);
    }
    report.status = normal ? 'passed-default-windows-resize' : long ? 'passed-long-resize-lab'
      : recoverRange ? 'passed-1440-range-recovery' : 'passed-short-resize-lab';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
  } finally {
    try {
      if (service) {
        await service.cancelCurrent();
        await service.closeOperationResources();
        report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed');
        assert.equal(report.diagnosticClosure.persisted, true);
      }
    } catch (error) {
      report.status = 'failed-retained';
      report.serviceClosureFailure = fault(error);
    } finally {
      await session.close();
    }
  }
  return report;
}

if (require.main === module) {
  const [mode, id, digest, ...extra] = process.argv.slice(2);
  const recoverRange = mode === '--recover-owned-1440-range';
  const resume = recoverRange || mode === '--resume-owned-short-lab';
  assert((['--owned-short-lab', '--owned-long-lab', '--owned-normal'].includes(mode) && !id)
    || (resume && id && digest && !extra.length));
  (async () => proof(mode, resume ? await previousFixtures(id, digest, recoverRange) : null))().then(result => {
    console.log(JSON.stringify({ id: result.id, status: result.status, acceptedStarts: result.acceptedStarts, children: result.childrenClosed,
      report: path.join(result.directory, 'report.json'), failure: result.failure, serviceClosureFailure: result.serviceClosureFailure, closureFailures: result.closureFailures }));
    if (!result.status.startsWith('passed')) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
