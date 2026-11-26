'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { observeSubRip, clipSubRip } = require('../src/operation-subrip.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { EncoderService } = require('../src/encoder-service.cjs');
const { createOperationControls } = require('../src/operation-controls.cjs');
const { REGULAR_WINDOWS_PAIR } = require('../src/regular-windows-runtime.cjs');
const { WINDOWS_TIMED_MATROSKA } = require('../src/remux-windows-chapters.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { readNativeMetadata } = require('../src/remux-native-reader.cjs');
const { observeNativeInventory, compareNativeInventories } = require('../src/remux-native-checks.cjs');
const { createOwnedSession, hashFile, readBoundedFile, copyPinnedFile, fault, ROOT } = require('./v07-remux-long-fixtures.cjs');

const MiB = 1024 ** 2, GiB = 1024 ** 3;
const LIMITS = Object.freeze({ totalMs: 150000, childMs: 25000, maxChildren: 28, maxStarts: 0,
  minimumDFreeBytes: 25 * GiB, marginBytes: 256 * MiB, forecastBytes: 256 * MiB, reportBytes: 6 * MiB });
const CUES = [[0, 500, 'outside before'], [250, 800, 'مرحبا'], [750, 1100, 'one\ntwo'],
  [1250, 1800, 'at right'], [1500, 2250, 'outside after']];
const EXPECTED_CLIP = [[0, 300, 'مرحبا'], [250, 600, 'one\ntwo'], [750, 1000, 'at right']];
const CHAPTERS = [[0, 1000, 'Opening'], [1300, 2400, 'Closing']];
const CHAPTER_LAB_ID = '3b790e0d-1128-4a98-9074-d1821465bf06';
const COMMON = ['-hide_banner', '-nostdin', '-v', 'error', '-xerror'];
const HASH = bytes => createHash('sha256').update(bytes).digest('hex');
const MKV = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'matroska,webm'];

function stamp(ms) {
  const clock = [Math.floor(ms / 3600000), Math.floor(ms / 60000) % 60, Math.floor(ms / 1000) % 60];
  return clock.map(value => String(value).padStart(2, '0')).join(':') + ',' + String(ms % 1000).padStart(3, '0');
}
function srt(rows) {
  return rows.map(([start, end, text], i) => [String(i + 1), stamp(start) + ' --> ' + stamp(end), text, '', ''].join('\n')).join('');
}

async function generate(session, file, kind, input, size = '160x96') {
  const ancillary = kind === 'chapters'
    ? ['-f', 'ffmetadata', '-i', input, '-map', '0:v:0', '-map_chapters', '1']
    : ['-f', kind, '-i', input, '-map', '0:v:0', '-map', '1:s:0', '-map_chapters', '-1'];
  const text = kind === 'chapters' ? [] : ['-c:s', 'copy', '-metadata:s:s:0', 'language=ara',
    '-metadata:s:s:0', 'title=Captions', '-disposition:s:0', 'default+forced'];
  await session.run(session.runtime.ffmpeg, [...COMMON, '-f', 'lavfi', '-i', 'testsrc2=size=' + size + ':rate=30:duration=2.5',
    ...ancillary, '-map_metadata', kind === 'chapters' ? '1' : '-1', '-c:v', 'libx264', '-pix_fmt:v', '+yuv420p', '-threads:v', '1', '-bf', '0',
    '-vf', 'setsar=1,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
    ...text, '-fflags', '+bitexact', '-avoid_negative_ts', 'disabled', '-n', '-f', 'matroska', file]);
}

function copyFull(session, source, output) {
  return session.run(session.runtime.ffmpeg, [...COMMON, '-copyts', ...MKV, '-i', source,
    '-map', '0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy',
    '-fflags', '+bitexact', '-avoid_negative_ts', 'disabled', '-n', '-f', 'matroska', output]);
}

async function subRipSnapshot(file) {
  const pin = await hashFile(file);
  const bytes = await readBoundedFile(file, 4 * MiB);
  return observeSubRip(bytes.toString('base64'), pin.sha256, '2');
}

async function inspectFile(session, file, rows, sourceEnvelope) {
  const pin = await hashFile(file);
  const response = await session.run(session.runtime.ffprobe, ['-v', 'error', ...MKV, '-show_streams', '-show_format',
    '-show_chapters', '-show_programs', '-show_stream_groups', '-show_packets', '-show_data_hash', 'sha256',
    '-of', 'json', file], { stdoutLimit: 3 * MiB });
  const probe = JSON.parse(response.stdout);
  const video = probe.streams[0];
  assert.equal(video.codec_type, 'video');
  assert.equal(video.codec_name, 'h264');
  assert.deepEqual([video.color_range, video.color_primaries, video.color_transfer, video.color_space], ['tv', 'bt709', 'bt709', 'bt709']);
  assert.equal(probe.streams.length, rows ? 2 : 1);
  const packets = probe.packets.map(packet => [packet.stream_index, packet.pts, packet.dts, packet.duration, packet.size, packet.flags, packet.data_hash]);
  const decoded = await session.run(session.runtime.ffmpeg, [...COMMON, '-copyts', ...MKV, '-i', file, '-map', '0:v:0',
    '-an', '-sn', '-dn', '-c:v', 'rawvideo', '-threads:v', '1', '-pix_fmt:v', '+yuv420p', '-fps_mode:v', 'passthrough',
    '-enc_time_base:v', 'demux', '-avoid_negative_ts', 'disabled', '-hash', 'sha256', '-f', 'framehash',
    '-format_version', '1', 'pipe:1'], { stdoutLimit: MiB });
  const videoFrames = decoded.stdout.split(/\r?\n/).filter(line => line && !line.startsWith('#'));
  assert.equal(videoFrames.length, 75);
  let subtitles;
  if (rows) {
    subtitles = await subRipSnapshot(file);
    assert.equal(subtitles.timestampScaleNs, '1000000');
    assert.deepEqual(subtitles.cues.map(cue => [Number(cue.startTicks), Number(cue.endTicks), cue.text]), rows);
    assert.deepEqual([subtitles.track.language, subtitles.track.name, subtitles.track.default, subtitles.track.forced], ['ara', 'Captions', true, true]);
    assert.deepEqual(probe.packets.filter(packet => packet.stream_index === 1)
      .map(packet => [packet.pts, packet.duration, packet.data_hash]),
    rows.map(([start, end, text]) => [start, end - start, 'SHA256:' + HASH(Buffer.from(text))]));
    const text = await session.run(session.runtime.ffmpeg, [...COMMON, ...MKV, '-i', file, '-map', '0:s:0',
      '-c:s', 'srt', '-f', 'srt', 'pipe:1'], { stdoutLimit: 65536 });
    assert.equal(text.stdout.replace(/\r\n/g, '\n').trim(), srt(rows).trim());
  }
  const identity = await readSourceIdentity(file);
  let native, nativeRefusal, chapterDisplays;
  try {
    native = await observeNativeInventory({ file, probe, identity, family: 'matroska', target: 'matroska',
      maxRecords: 2048, timeoutMs: 10000, sourceEnvelope });
  } catch (error) {
    const subtitleIndexRefusal = rows && error.code === 'REMUX_NATIVE_CUETRACK';
    const chapterLanguageRefusal = !rows && probe.chapters.length === CHAPTERS.length && error.code === 'REMUX_NATIVE_CHAPLANGUAGE';
    if (sourceEnvelope || !subtitleIndexRefusal && !chapterLanguageRefusal) throw error;
    nativeRefusal = fault(error);
    if (chapterLanguageRefusal) {
      chapterDisplays = await readNativeMetadata({ file, identity, family: 'matroska', maxRecords: 2048, timeoutMs: 10000,
        async withMetadata(meta) {
          const rows = meta.nodes.filter(node => ['ChapString', 'ChapLanguage'].includes(node.name));
          return Promise.all(rows.map(async node => {
            assert(node.end - node.body <= 256);
            return [node.name, (await meta.read(node.body, node.end - node.body)).toString('utf8')];
          }));
        } });
      assert.deepEqual(chapterDisplays, CHAPTERS.flatMap(([, , title]) => [['ChapString', title], ['ChapLanguage', 'und']]));
    }
  }
  assert.deepEqual(await hashFile(file), pin);
  return { file, pin, probe, packets, videoFrames, subtitles, native, nativeRefusal, chapterDisplays };
}

function checkFull(source, copied) {
  assert.deepEqual(source.packets, copied.packets);
  assert.deepEqual(source.videoFrames, copied.videoFrames);
  assert.deepEqual(source.probe.chapters, copied.probe.chapters);
  if (source.subtitles) {
    // Each file's native inspector binds its UID and any tag references to
    // the same local track. The muxer may assign a new file-local UID.
    const controls = track => Object.fromEntries(Object.entries(track).filter(([key]) => key !== 'uid'));
    assert.deepEqual(controls(source.subtitles.track), controls(copied.subtitles.track));
  }
  if (source.subtitles && source.nativeRefusal) {
    assert.deepEqual(source.subtitles.track, copied.subtitles.track);
    assert.equal(source.nativeRefusal?.code, 'REMUX_NATIVE_CUETRACK');
    assert.equal(copied.nativeRefusal?.code, 'REMUX_NATIVE_CUETRACK');
    return { essenceAndCues: true, nativeIndexSupported: false };
  }
  if (source.chapterDisplays) {
    assert.equal(source.nativeRefusal?.code, 'REMUX_NATIVE_CHAPLANGUAGE');
    assert.equal(copied.nativeRefusal?.code, 'REMUX_NATIVE_CHAPLANGUAGE');
    assert.deepEqual(source.chapterDisplays, copied.chapterDisplays);
    return { essenceAndChapters: true, nativeLanguageSupported: false };
  }
  const mappings = source.probe.streams.map(({ index }) => ({ inputIndex: index, outputIndex: index }));
  return compareNativeInventories(source.native, copied.native, mappings).complete;
}

function assessment(source, target) {
  return assessRemux({ request: { fileId: 'owned-ancillary-fixture', identityRevision: 1, draftRevision: 1,
    operation: 'remux', target, range: null, omissionRequestIds: [] }, probe: source.probe, sourceFingerprint: source.pin.sha256 });
}


async function recoverCaptionSource(id, receiptSha, fileSha) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  for (const digest of [receiptSha, fileSha]) assert.match(digest, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2m-regular-ancillary/smoke', id);
  const report = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(HASH(report), receiptSha);
  const saved = JSON.parse(report);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.childrenClosed, 4);
  assert.deepEqual(saved.closureFailures, []);
  assert.equal(saved.leaseReleased, true);
  assert.equal(saved.failure.code, 'REMUX_NATIVE_CUETRACK');
  const source = path.join(directory, 'owned', 'captions.mkv');
  assert.equal(saved.invocations[0].argv.at(-1), source);
  const pin = await hashFile(source);
  assert.equal(pin.sha256, fileSha);
  return { id, source, pin };
}


async function recoverSubtitleMeasurement(id, receiptSha) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.match(receiptSha, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2m-regular-ancillary/smoke', id);
  const bytes = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(HASH(bytes), receiptSha);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.childrenClosed, 15);
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.deepEqual(saved.subtitleComparison, { essenceAndCues: true, nativeIndexSupported: false });
  assert.equal(saved.chapterSource.probe.chapters.length, CHAPTERS.length);
  assert.equal(saved.chapterCopy, undefined);
  for (const [observed, filename] of [
    [saved.subtitleSource, 'captions.mkv'], [saved.subtitleCopy, 'captions-copy.mkv'],
    [saved.subtitleClip.actual, 'clipped-component.mkv'], [saved.styled, 'styled.mkv'],
  ]) {
    assert.equal(observed.file, path.join(directory, 'owned', filename));
    assert.deepEqual(await hashFile(observed.file), observed.pin);
  }
  return { id, receiptSha };
}


async function recoverChapterSource(id, receiptSha, fileSha) {
  assert.match(id, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  for (const digest of [receiptSha, fileSha]) assert.match(digest, /^[a-f0-9]{64}$/);
  const directory = path.join(ROOT, 'artifacts/v0.7/q2m-regular-ancillary/smoke', id);
  const bytes = await readBoundedFile(path.join(directory, 'report.json'), LIMITS.reportBytes);
  assert.equal(HASH(bytes), receiptSha);
  const saved = JSON.parse(bytes);
  assert.equal(saved.id, id);
  assert.equal(saved.status, 'failed-retained');
  assert.equal(saved.childrenClosed, 3);
  assert.equal(saved.leaseReleased, true);
  assert.deepEqual(saved.closureFailures, []);
  assert.equal(saved.failure.code, 'REMUX_NATIVE_CHAPLANGUAGE');
  const original = path.join(directory, 'owned', 'chapters.mkv');
  assert.equal(saved.invocations[0].argv.at(-1), original);
  const pin = await hashFile(original);
  assert.equal(pin.sha256, fileSha);
  const subtitles = await recoverSubtitleMeasurement(saved.priorSubtitleMeasurement.id, saved.priorSubtitleMeasurement.receiptSha);
  return { id, original, pin, subtitles };
}

async function run(previous, priorSubtitles, chapterSeed) {
  const session = createOwnedSession({ kind: 'smoke', limits: LIMITS, regularProof: 'ancillary' });
  const { report, io } = session;
  report.scope = 'Windows 9.1 owned Matroska subtitle and chapter measurements';
  if (previous) report.recoveredCaptionSource = previous.id;
  if (priorSubtitles) report.priorSubtitleMeasurement = priorSubtitles;
  if (chapterSeed) report.recoveredChapterSource = chapterSeed.id;
  try {
    await session.open();
    const here = name => path.join(session.owned, name);
    if (!priorSubtitles) {
      const captions = here('captions.srt'), source = here('captions.mkv'), copied = here('captions-copy.mkv');
      if (previous) {
        await copyPinnedFile(previous.source, source, previous.pin);
      } else {
        await io.writeFile(captions, srt(CUES), { flag: 'wx' });
        await generate(session, source, 'srt', captions);
      }
      report.subtitleSource = await inspectFile(session, source, CUES);
      await copyFull(session, source, copied);
      report.subtitleCopy = await inspectFile(session, copied, CUES);
      report.subtitleComparison = checkFull(report.subtitleSource, report.subtitleCopy);
      const plan = clipSubRip(report.subtitleSource.subtitles, report.subtitleSource.pin.sha256, '1/2', '3/2');
      assert.deepEqual(plan.omitted, [1, 5]);
      assert.deepEqual(plan.clipped, [{ ordinal: 2, start: true, end: false }, { ordinal: 4, start: false, end: true }]);
      const planned = plan.cues.map(cue => [Number(cue.startMs), Number(cue.endMs), cue.text]);
      assert.deepEqual(planned, EXPECTED_CLIP);
      assert.throws(() => clipSubRip(report.subtitleSource.subtitles, report.subtitleSource.pin.sha256, '1/2000', '3/2'),
        { code: 'SUBRIP_BOUNDARY_INEXACT' });
      const clipText = here('clipped.srt'), clipFile = here('clipped-component.mkv');
      await io.writeFile(clipText, srt(planned), { flag: 'wx' });
      await generate(session, clipFile, 'srt', clipText);
      report.subtitleClip = { plan, actual: await inspectFile(session, clipFile, planned) };
      const styled = here('styled.srt'), styledFile = here('styled.mkv');
      await io.writeFile(styled, srt([[0, 100, '<i>styled text</i>']]), { flag: 'wx' });
      await generate(session, styledFile, 'srt', styled);
      await assert.rejects(subRipSnapshot(styledFile), { code: 'SUBRIP_TEXT_UNSUPPORTED' });
      report.styled = { file: styledFile, pin: await hashFile(styledFile), refusal: 'SUBRIP_TEXT_UNSUPPORTED' };
      report.mp4SubtitleAssessment = assessment(report.subtitleSource, 'mp4');
      assert.equal(report.mp4SubtitleAssessment.executionReady, false);
      assert(report.mp4SubtitleAssessment.blockers.some(row => row.code === 'REMUX_STREAM_UNSUPPORTED' && row.streamIndex === 1));
      await session.save();
    }

    const chapters = here('chapters.ffmeta'), chapterSource = here('chapters.mkv'), chapterCopy = here('chapters-copy.mkv');
    const metadata = ';FFMETADATA1\n' + CHAPTERS.map(([start, end, title]) =>
      '[CHAPTER]\nTIMEBASE=1/1000\nSTART=' + start + '\nEND=' + end + '\ntitle=' + title + '\n').join('');
    if (chapterSeed) {
      await copyPinnedFile(chapterSeed.original, chapterSource, chapterSeed.pin);
    } else {
      await io.writeFile(chapters, metadata, { flag: 'wx' });
      await generate(session, chapterSource, 'chapters', chapters);
    }
    report.chapterSource = await inspectFile(session, chapterSource);
    assert.deepEqual(report.chapterSource.probe.chapters.map(row => [row.time_base, row.start, row.end, row.tags.title]),
      CHAPTERS.map(([start, end, title]) => ['1/1000000000', start * 1000000, end * 1000000, title]));
    await copyFull(session, chapterSource, chapterCopy);
    report.chapterCopy = await inspectFile(session, chapterCopy);
    report.chapterComparison = checkFull(report.chapterSource, report.chapterCopy);
    report.mp4ChapterAssessment = assessment(report.chapterSource, 'mp4');
    assert.equal(report.mp4ChapterAssessment.executionReady, false);
    assert.equal(report.mp4ChapterAssessment.expectedOutput.auxiliaryStreams.chapterCarrierQualificationRequired, true);
    report.status = 'completed-regular-ancillary-measurement';
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    await session.close();
  }
  return report;
}

async function timedMatroskaServiceProof(normal, kind) {
  const session = createOwnedSession({ kind: 'smoke', limits: { ...LIMITS, totalMs: 240000, maxChildren: 36, maxStarts: 1 },
    regularProof: 'ancillary' });
  const { report, io, controller: { signal } } = session;
  const subtitles = kind === 'subtitle';
  report.scope = 'Windows 9.1 ' + (normal ? 'normal service' : 'prospective service') + ' Matroska ' + kind;
  const chapterRows = normal ? [[240, 1130, 'First scene'], [1460, 2440, 'Closing scene']]
    : [[120, 980, 'Intro'], [1270, 2320, 'End credits']];
  const cueRows = normal ? [[0, 480, 'Opening text'], [320, 720, 'نص جديد'], [820, 1170, 'line one\nline two'],
    [1350, 1590, 'Next'], [1510, 2380, 'Final words']] : [[0, 420, 'Start'], [290, 760, 'ترجمة'],
    [810, 1150, 'two\nlines'], [1190, 1680, 'Next caption'], [1590, 2270, 'End']];
  report.expectedRows = subtitles ? cueRows : chapterRows;
  let service;
  try {
    await session.open();
    const { runtime } = session, here = name => path.join(session.owned, name);
    const options = { runtime, stateDir: here('state'), ...(normal ? {} : {
      remuxPolicyIdentity: 'windows-timed-matroska-prospective-v1',
      remuxPolicies: [{ id: 'full-remux-windows-timed-matroska-prospective-v1', inputFamily: 'matroska', target: 'matroska',
        sourceEnvelope: WINDOWS_TIMED_MATROSKA, runtimeIdentity: REGULAR_WINDOWS_PAIR, allowAncillary: true, allowRotation90: false,
        verificationMethod: 'packet-identity-v1', evidenceIds: [subtitles ? 'cb909cb1-77bf-4799-9142-9524d5d2285a:exact-captions' : CHAPTER_LAB_ID + ':flat-ordinary-chapters'] }],
    }) };
    report.factoryInputs = Object.keys(options).sort();
    const src = here('source'), out = here('out'), alt = here('unsupported-source');
    const altOut = here('alternate-out'), mp4Out = here('mp4-out');
    for (const folder of [options.stateDir, src, out, alt, altOut, mp4Out]) await io.mkdir(folder);
    const controls = createOperationControls(options), { operationRuntime } = controls;
    for (const method of ['invoke', 'invokeRemux']) {
      const invoke = operationRuntime[method].bind(operationRuntime);
      operationRuntime[method] = (token, tool, args, options) => session.run(runtime[tool], args, options,
        (_file, argv, owned) => invoke(token, tool, argv, owned));
    }
    service = new EncoderService({ ffmpeg: runtime.ffmpeg, ffprobe: runtime.ffprobe, stateDir: options.stateDir,
      runtimeIdentity: REGULAR_WINDOWS_PAIR, inspectionWorkers: 1, run: session.run, ...controls });
    await service.initializeDiagnostics();
    signal.addEventListener('abort', () => { void service.cancelCurrent(); }, { once: true });
    const sidecar = here(subtitles ? 'captions.srt' : 'chapters.ffmeta');
    const source = path.join(src, 'source.mkv');
    const authored = subtitles ? srt(cueRows) : ';FFMETADATA1\n' + chapterRows.map(([start, end, title]) =>
      '[CHAPTER]\nTIMEBASE=1/1000\nSTART=' + start + '\nEND=' + end + '\ntitle=' + title + '\n').join('');
    await io.writeFile(sidecar, authored, { flag: 'wx' });
    await generate(session, source, subtitles ? 'srt' : 'chapters', sidecar, normal ? '224x112' : '192x96');
    report.source = await inspectFile(session, source, subtitles ? cueRows : null, WINDOWS_TIMED_MATROSKA);
    if (subtitles) {
      assert.deepEqual(report.source.native.subtitleBlocks.map(row => [Number(row.pts), Number(row.pts) + Number(row.duration)]),
        cueRows.map(([start, end]) => [start, end]));
      assert.deepEqual(report.source.native.randomAccess.streams.find(row => row.index === 1).indexed, [1, 2, 3, 4, 5]);
    } else {
      assert.deepEqual(report.source.native.chapterDisplays, chapterRows.map(([start, end, title], index) => ({
        id: String(index + 1), start: String(start * 1e6), end: String(end * 1e6), title, language: 'und',
      })));
    }
    async function prepare(input, output, target) {
      const a = await service.registerFolder(input, 'input'), b = await service.registerFolder(output, 'output');
      await service.prepareRemuxBatch({ inputFolderId: a.id, outputFolderId: b.id, target });
      await service.taskPromise;
      const ready = service.snapshot();
      assert.equal(ready.phase, 'ready', ready.error);
      assert.equal(ready.items.length, 1);
      return { ready, item: ready.items[0] };
    }
    const selected = await prepare(src, out, 'matroska');
    report.prepared = selected.item;
    await session.save();
    assert.equal(selected.item.status, 'ready', selected.item.reason);
    const entry = service.plan.entries.get(selected.item.id);
    assert.equal(entry.operationPlan.sourceEnvelope, WINDOWS_TIMED_MATROSKA);
    service.startBatch({ planId: selected.ready.planId, fileIds: [selected.item.id] });
    report.acceptedStarts++;
    await service.taskPromise;
    report.result = service.snapshot().items[0];
    report.evidence = entry.operationEvidence;
    await session.save();
    assert.equal(report.result.status, 'success', report.result.reason);
    assert.equal(report.result.outputDisposition.published, true);
    assert.equal(report.evidence.verificationMethod, 'packet-identity-v1');
    report.copy = await inspectFile(session, entry.destination, subtitles ? cueRows : null, WINDOWS_TIMED_MATROSKA);
    assert.equal(checkFull(report.source, report.copy), true);
    assert.equal(report.copy.pin.sha256, report.evidence.essenceEvidence.outputFileSha256);
    assert.deepEqual(await io.readdir(out), [path.basename(entry.destination)]);
    assert.deepEqual(await hashFile(source), report.source.pin);

    const alternate = path.join(alt, 'alternate.mkv');
    if (subtitles) {
      const styled = here('styled.srt');
      await io.writeFile(styled, srt([[0, 400, '<i>Styled text</i>']]), { flag: 'wx' });
      await generate(session, alternate, 'srt', styled);
      report.alternate = { file: alternate, pin: await hashFile(alternate), style: 'italic' };
    } else {
      const labelOffset = await readNativeMetadata({ file: source, identity: await readSourceIdentity(source),
        family: 'matroska', maxRecords: 2048, timeoutMs: 10000, signal, withMetadata(meta) {
          const label = meta.nodes.find(node => node.name === 'ChapLanguage');
          assert.equal(label.end - label.body, 3);
          return label.body;
        } });
      const raw = await readBoundedFile(source, 4 * MiB);
      assert.equal(raw.subarray(labelOffset, labelOffset + 3).toString(), 'und');
      raw.write('eng', labelOffset, 3, 'ascii');
      await io.writeFile(alternate, raw, { flag: 'wx' });
      report.alternate = { file: alternate, pin: await hashFile(alternate), offset: labelOffset, language: 'eng' };
    }

    const refusals = [
      ['sourceRefusal', alt, altOut, 'matroska', subtitles ? 'SUBRIP_TEXT_UNSUPPORTED' : 'REMUX_NATIVE_CHAPTER_COPY'],
      ['targetRefusal', src, mp4Out, 'mp4', subtitles ? 'REMUX_STREAM_UNSUPPORTED' : 'REMUX_AUXILIARY_UNQUALIFIED'],
    ];
    if (subtitles) {
      const cueFile = path.join(here('cue-source'), 'cue.mkv');
      const cueOut = here('cue-out');
      await io.mkdir(path.dirname(cueFile));
      await io.mkdir(cueOut);
      const offset = await readNativeMetadata({ file: source, identity: await readSourceIdentity(source),
        family: 'matroska', maxRecords: 2048, timeoutMs: 10000, signal, async withMetadata(meta) {
          for (const node of meta.nodes.filter(value => value.name === 'CueDuration')) {
            const track = node.parent.children.find(value => value.name === 'CueTrack');
            if (track.end - track.body === 1 && (await meta.read(track.body, 1))[0] === 2) return node.end - 1;
          }
          assert.fail('Expected a native subtitle CueDuration.');
        } });
      const raw = await readBoundedFile(source, 4 * MiB);
      raw[offset] ^= 1;
      await io.writeFile(cueFile, raw, { flag: 'wx' });
      report.badCueDuration = { file: cueFile, offset, pin: await hashFile(cueFile) };
      refusals.push(['cueRefusal', path.dirname(cueFile), cueOut, 'matroska', 'REMUX_NATIVE_CUEDURATION']);
    }
    for (const [key, input, output, target, code] of refusals) {
      const refused = await prepare(input, output, target), before = report.invocations.length;
      report[key] = refused.item;
      await session.save();
      assert.equal(refused.item.status, 'unsupported', refused.item.reason);
      assert.equal(refused.item.reasonCode, code);
      assert.throws(() => service.startBatch({ planId: refused.ready.planId, fileIds: [refused.item.id] }), { code: 'INVALID_SELECTION' });
      assert.equal(report.invocations.length, before);
      assert.deepEqual(await io.readdir(output), []);
    }
    report.status = 'passed-regular-' + kind + (normal ? '-service' : '-prospective');
  } catch (error) {
    report.status = 'failed-retained';
    report.failure = fault(error);
    if (typeof error.stderr === 'string') report.toolDiagnostic = error.stderr.slice(-8192);
  } finally {
    try {
      if (service) {
        await service.cancelCurrent();
        await service.closeOperationResources();
        report.diagnosticClosure = await service.closeDiagnostics(report.status.startsWith('passed') ? 'completed' : 'failed');
        assert.equal(report.diagnosticClosure.persisted, true);
      }
    } catch (error) { report.status = 'failed-retained'; report.serviceClosureFailure = fault(error); }
    finally { await session.close(); }
  }
  return report;
}

if (require.main === module) {
  const [mode, id, receipt, file, ...extra] = process.argv.slice(2);
  const serviceMode = /^(?:--)(chapter|subtitle)-(prospective|normal)$/.exec(mode || '');
  assert(!mode || serviceMode && !id || (mode === '--reuse-caption-source' && id && receipt && file && !extra.length)
    || (mode === '--chapters-only' && id && receipt && !file)
    || (mode === '--reuse-chapter-source' && id && receipt && file && !extra.length));
  (async () => {
    if (serviceMode) return timedMatroskaServiceProof(serviceMode[2] === 'normal', serviceMode[1]);
    if (mode === '--reuse-chapter-source') {
      const seed = await recoverChapterSource(id, receipt, file);
      return run(null, seed.subtitles, seed);
    }
    if (mode === '--chapters-only') return run(null, await recoverSubtitleMeasurement(id, receipt));
    return run(mode ? await recoverCaptionSource(id, receipt, file) : null);
  })().then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, children: report.childrenClosed,
      report: path.join(report.directory, 'report.json'), failure: report.failure, closureFailures: report.closureFailures }));
    if (report.status !== 'completed-regular-ancillary-measurement' && !report.status.startsWith('passed')) process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
