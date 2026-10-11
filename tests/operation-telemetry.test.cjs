'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { FORMATS, summarizeTelemetry, createOperationTelemetry, assertTelemetryReady, collectOperationTelemetry, closeOperationTelemetry } = require('../src/operation-telemetry.cjs');
const { compareDecodedFrames, diagnoseAudioTiming, floatingRebaseObservation } = require('../scripts/v07-telemetry-smoke.cjs');
const video = (n, pts, extra = {}) => ['ffet1', 'v', '0', '0', String(n), String(n), '1/12800', String(pts), '1/12800', String(320512 + n * 512), ...[]].map((v, i) => Object.hasOwn(extra, i) ? extra[i] : v).join('\t') + '\n';
const audio = (n, pts, sn, samples, extra = {}) => ['ffet1', 'a', '0', '1', String(n), String(n), '1/48000', String(pts), '1/48000', String(1200624 + sn), String(sn), String(samples)].map((v, i) => Object.hasOwn(extra, i) ? extra[i] : v).join('\t') + '\n';
const v = { outputIndex: 0, kind: 'video' }, a = { outputIndex: 1, kind: 'audio', sampleRate: 48000 };
const done = { childClosed: true, exitCode: 0, cancelled: false };
async function parse(text, spec = v, options) { return summarizeTelemetry([Buffer.from(text)], spec, options); }
async function session(t, streams = [v]) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'ffmpeg-telemetry-test-'));
  const handle = await createOperationTelemetry({ stageDirectory: directory, runtimeIdentity: 'a'.repeat(64), planFingerprint: 'b'.repeat(64), streams });
  t.after(async () => { await closeOperationTelemetry(handle, { childClosed: true }); await fs.rm(directory, { recursive: true, force: true }); });
  return handle;
}

test('fixed formats contain integer PTS and media-specific sample fields only', () => {
  assert.ok(FORMATS.video.includes('{pts}') && !FORMATS.video.includes('{t}') && !FORMATS.video.includes('{samp}'));
  assert.ok(FORMATS.audio.endsWith('{sn}\t{samp}'));
});
test('exact PTS, ordered hashes and bounds survive byte-sized chunks without retaining a frame array', async () => {
  const input = video(0, 345) + video(1, 857) + video(2, 1881);
  const summary = await summarizeTelemetry(Array.from(Buffer.from(input), b => Buffer.from([b])), v);
  assert.equal(summary.records, '3'); assert.deepEqual(summary.first.time, { numerator: '69', denominator: '2560' });
  assert.deepEqual(summary.minPtsDelta, { numerator: '1', denominator: '25' }); assert.deepEqual(summary.maxPtsDelta, { numerator: '2', denominator: '25' });
  assert.equal(summary.hashes.raw, createHash('sha256').update(input).digest('hex')); assert.equal(summary.hashes.contentHash, false);
  assert.equal(summary.completeOutputValidation, false); assert.equal(summary.videoDurationAvailable, false);
  assert.ok(!Object.hasOwn(summary, 'frames')); assert.ok(Object.isFrozen(summary.first));
});
test('audio cumulative sample accounting and exclusive end time use exact rational arithmetic', async () => {
  const summary = await parse(audio(0, 0, 0, 1024) + audio(1, 1024, 1024, 240), a);
  assert.equal(summary.sampleCount, '1264'); assert.equal(summary.audioDiscontinuities, '0');
  assert.deepEqual(summary.last.endTime, { numerator: '79', denominator: '3000' });
});
test('nonmonotonic/repeated timing is reported, never silently normalized away', async () => {
  const result = await parse(video(0, 300) + video(1, 300) + video(2, 200));
  assert.equal(result.repeatedPts, '1'); assert.equal(result.backwardsPts, '1');
  assert.equal((await parse(audio(0, 0, 0, 8) + audio(1, 9, 8, 8), a)).audioDiscontinuities, '1');
});
test('unavailable filtered input correspondence is explicit including FFmpeg unsigned sentinel', async () => {
  const result = await parse(video(0, 0, { 5: '18446744073709551615', 8: '0/1', 9: '9223372036854775807' }));
  assert.equal(result.unknownInputRecords, '1'); assert.equal(result.first.inputFrame, null); assert.equal(result.first.inputTime, null);
});
test('CRLF hashes retain original bytes but canonical hashes match LF evidence', async () => {
  const input = video(0, 0), lf = await parse(input), crlf = await parse(input.replace(/\n/g, '\r\n'));
  assert.equal(lf.hashes.canonicalRecords, crlf.hashes.canonicalRecords); assert.notEqual(lf.hashes.raw, crlf.hashes.raw);
});
test('empty/truncated, malicious, version-drift and unsafe numeric statistics fail closed', async () => {
  for (const text of ['', video(0, 0).trimEnd(), video(0, 0, { 0: 'ffet2' }), video(0, 0, { 7: '1.2' }), video(0, 0, { 7: '-9223372036854775808' }),
    video(0, 0, { 7: '9223372036854775808' }), video(0, 0, { 6: '0/1' }), video(0, 0, { 6: '1/0' }), video(0, 0, { 2: '1' }), video(0, 0, { 3: '2' }), video(0, 0, { 1: 'a' }), video(0, 0) + '\0']) {
    await assert.rejects(parse(text), { code: 'TELEMETRY_INVALID' });
  }
});
test('sequence and cumulative-sample corruption fails instead of estimating missing frames', async () => {
  await assert.rejects(parse(video(0, 0) + video(2, 1)), { code: 'TELEMETRY_INVALID' });
  await assert.rejects(parse(audio(0, 0, 0, 1024) + audio(1, 1024, 1025, 8), a), { code: 'TELEMETRY_INVALID' });
  await assert.rejects(parse(audio(0, 0, 0, 0), a), { code: 'TELEMETRY_INVALID' });
});
test('byte, record and unfinished-line caps reject bounded evidence overflow', async () => {
  await assert.rejects(parse(video(0, 0), v, { maxBytes: 10 }), { code: 'TELEMETRY_LIMIT' });
  await assert.rejects(parse(video(0, 0) + video(1, 1), v, { maxRecords: 1 }), { code: 'TELEMETRY_LIMIT' });
  await assert.rejects(parse('a'.repeat(1100)), { code: 'TELEMETRY_LIMIT' });
});
test('large counts are kept as exact integers, not IEEE754 counters', async () => {
  const result = await parse(video(0, '9007199254740993', { 6: '1/1000000' }));
  assert.equal(result.first.pts, '9007199254740993'); assert.equal(result.first.time.numerator, '9007199254740993');
});
test('parser cancellation is observable without altering any source', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(parse(video(0, 0), v, { signal: controller.signal }), { code: 'CANCELLED' });
});
test('fresh exclusive main-owned reservations produce detached immutable options and collect after close', async t => {
  const handle = await session(t, [v, a]);
  assert.ok(Object.isFrozen(handle.ffmpegArgs)); assert.equal((await fs.stat(handle.streams[0].path)).size, 0);
  await assertTelemetryReady(handle);
  await fs.writeFile(handle.streams[0].path, video(0, 0)); await fs.writeFile(handle.streams[1].path, audio(0, 0, 0, 10));
  const receipt = await collectOperationTelemetry(handle, { completion: done });
  assert.equal(receipt.streams.length, 2); assert.equal(receipt.streams[1].summary.sampleCount, '10'); assert.equal(receipt.publicationAuthorized, false);
  await assert.rejects(collectOperationTelemetry(handle, { completion: done }), { code: 'TELEMETRY_INVALID' });
});
test('serialized handles cannot create authority and collection needs normal child close', async t => {
  const handle = await session(t); await assertTelemetryReady(handle);
  await assert.rejects(collectOperationTelemetry(structuredClone(handle), { completion: done }), { code: 'TELEMETRY_INVALID' });
  for (const completion of [{ ...done, childClosed: false }, { ...done, exitCode: 1 }, { ...done, cancelled: true }, undefined]) {
    await assert.rejects(collectOperationTelemetry(handle, { completion }), { code: 'TELEMETRY_INCOMPLETE' });
  }
  await assert.rejects(closeOperationTelemetry(handle, { childClosed: false }), { code: 'TELEMETRY_INCOMPLETE' });
});
test('prelaunch file changes and foreign files cannot be silently truncated', async t => {
  const handle = await session(t); await fs.writeFile(handle.streams[0].path, 'existing evidence');
  await assert.rejects(assertTelemetryReady(handle), { code: 'TELEMETRY_PATH' });
  assert.equal(await fs.readFile(handle.streams[0].path, 'utf8'), 'existing evidence');
});
test('same-size substituted file is rejected through retained handle identity', async t => {
  const handle = await session(t); await assertTelemetryReady(handle);
  const file = handle.streams[0].path;
  await fs.writeFile(file, video(0, 0)); await fs.rename(file, `${file}.retained`); await fs.writeFile(file, video(0, 0));
  await assert.rejects(collectOperationTelemetry(handle, { completion: done }), { code: 'TELEMETRY_PATH' });
  assert.equal(await fs.readFile(`${file}.retained`, 'utf8'), video(0, 0));
});
test('single-link requirement rejects a hardlink alias and retains all evidence', async t => {
  const handle = await session(t); await assertTelemetryReady(handle);
  const file = handle.streams[0].path; await fs.writeFile(file, video(0, 0)); await fs.link(file, `${file}.alias`);
  await assert.rejects(collectOperationTelemetry(handle, { completion: done }), { code: 'TELEMETRY_PATH' });
});
test('cancelled parse leaves logs intact and explicit close grants no cleanup authority', async t => {
  const handle = await session(t); await assertTelemetryReady(handle); await fs.writeFile(handle.streams[0].path, video(0, 0));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(collectOperationTelemetry(handle, { completion: done, signal: controller.signal }), { code: 'CANCELLED' });
  await closeOperationTelemetry(handle, { childClosed: true });
  assert.equal(await fs.readFile(handle.streams[0].path, 'utf8'), video(0, 0));
});
test('retained-evidence comparison does not invent unavailable old duration but still requires timestamps', () => {
  const result = compareDecodedFrames([{ pts: 27, duration: 80 }], [{ pts: 27 }], 'video');
  assert.deepEqual(result.comparedFields, ['pts']); assert.deepEqual(result.newOnlyDuration, [80]);
  assert.throws(() => compareDecodedFrames([{ pts: 27, duration: 80 }], [{ pts: 28 }], 'video'));
  assert.throws(() => compareDecodedFrames([{ pts: 27 }], [{}], 'video'));
  assert.throws(() => compareDecodedFrames([{ pts: 27, duration: 80 }], [{ pts: 27, duration: 40 }], 'video'));
  assert.throws(() => compareDecodedFrames([{ pts: 0, nb_samples: 1024 }], [{ pts: 0, nb_samples: 1023 }], 'audio'));
  const changed = compareDecodedFrames([{ pts: 1, nb_samples: 1024 }], [{ pts: 0, nb_samples: 1024 }], 'audio', { changedOriginPolicy: true });
  assert.deepEqual(changed.comparedFields, ['nb_samples']); assert.deepEqual(changed.historicalPtsDifferences, [{ index: 0, old: 0, actual: 1 }]);
  assert.throws(() => compareDecodedFrames([{ pts: 1, nb_samples: 1023 }], [{ pts: 0, nb_samples: 1024 }], 'audio', { changedOriginPolicy: true }));
});
test('one-sample timestamp discontinuity remains a finding despite exact cumulative sample count', () => {
  const result = diagnoseAudioTiming(audio(0, 0, 0, 1024) + audio(1, 1023, 1024, 224), 48000);
  assert.deepEqual(result.timestampMinusSampleOffset, { '0/1': 1, '-1/1': 1 });
  assert.equal(result.discontinuities[0].gapInSamples, '-1/1'); assert.equal(result.discontinuities[0].n, '1');
});
test('48k binary64 origin subtraction reproduces the retained native one-sample timestamp defect', () => {
  const result = floatingRebaseObservation({ numerator: '25013', denominator: '1000' }, 48000, [1200624n, 1200896n]);
  assert.equal(result.exactOriginInSampleTicks, '1200624/1'); assert.ok(result.evaluatedBinary64Origin > 1200624);
  assert.equal(result.examples[0].truncatedBinary64Pts, -0); assert.equal(result.examples[0].exactTruncatedPts, '0');
  assert.equal(result.examples[1].truncatedBinary64Pts, 271); assert.equal(result.examples[1].exactTruncatedPts, '272');
});
