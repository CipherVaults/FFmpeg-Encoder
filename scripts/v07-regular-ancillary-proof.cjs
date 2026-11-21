'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { observeSubRip, clipSubRip } = require('../src/operation-subrip.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
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

async function generate(session, file, kind, input) {
  const ancillary = kind === 'chapters'
    ? ['-f', 'ffmetadata', '-i', input, '-map', '0:v:0', '-map_chapters', '1']
    : ['-f', kind, '-i', input, '-map', '0:v:0', '-map', '1:s:0', '-map_chapters', '-1'];
  const text = kind === 'chapters' ? [] : ['-c:s', 'copy', '-metadata:s:s:0', 'language=ara',
    '-metadata:s:s:0', 'title=Captions', '-disposition:s:0', 'default+forced'];
  await session.run(session.runtime.ffmpeg, [...COMMON, '-f', 'lavfi', '-i', 'testsrc2=size=160x96:rate=30:duration=2.5',
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

async function inspectFile(session, file, rows) {
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
      maxRecords: 2048, timeoutMs: 10000 });
  } catch (error) {
    const subtitleIndexRefusal = rows && error.code === 'REMUX_NATIVE_CUETRACK';
    const chapterLanguageRefusal = !rows && probe.chapters.length === CHAPTERS.length && error.code === 'REMUX_NATIVE_CHAPLANGUAGE';
    if (!subtitleIndexRefusal && !chapterLanguageRefusal) throw error;
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
    assert.equal(source.nativeRefusal?.code, 'REMUX_NATIVE_CUETRACK');
    assert.equal(copied.nativeRefusal?.code, 'REMUX_NATIVE_CUETRACK');
    assert.deepEqual(source.subtitles.track, copied.subtitles.track);
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

if (require.main === module) {
  const [mode, id, receipt, file, ...extra] = process.argv.slice(2);
  assert(!mode || (mode === '--reuse-caption-source' && id && receipt && file && !extra.length)
    || (mode === '--chapters-only' && id && receipt && !file)
    || (mode === '--reuse-chapter-source' && id && receipt && file && !extra.length));
  (async () => {
    if (mode === '--reuse-chapter-source') {
      const seed = await recoverChapterSource(id, receipt, file);
      return run(null, seed.subtitles, seed);
    }
    if (mode === '--chapters-only') return run(null, await recoverSubtitleMeasurement(id, receipt));
    return run(mode ? await recoverCaptionSource(id, receipt, file) : null);
  })().then(report => {
    console.log(JSON.stringify({ id: report.id, status: report.status, children: report.childrenClosed,
      report: path.join(report.directory, 'report.json'), failure: report.failure, closureFailures: report.closureFailures }));
    if (report.status !== 'completed-regular-ancillary-measurement') process.exitCode = 1;
  }).catch(error => { console.error(error); process.exitCode = 1; });
}
