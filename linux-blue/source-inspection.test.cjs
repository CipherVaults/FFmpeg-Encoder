'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { inspectSource, summarize } = require('./source-inspection.cjs');
const report = () => ({ stdout: JSON.stringify({ format: { format_name: 'matroska,webm', duration: '0.400000', filename: '/secret', tags: { title: 'private' } },
  streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 320, height: 180, pix_fmt: 'yuv420p', avg_frame_rate: '30/1', tags: { title: 'private' } },
    { index: 1, codec_type: 'audio', codec_name: 'pcm_s16le', sample_rate: '48000', channels: 2 }] }) });
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'blue-source-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'synthetic.mkv'); await fs.writeFile(source, 'test-only-bytes'); return { dir, source };
}
test('bounded metadata drops tags and paths; nested report is frozen and never grants encoding', () => {
  const result = summarize(report().stdout, 123);
  assert.equal(result.encodeAllowed, false); assert.equal(result.durationSeconds, 0.4); assert.equal(result.streams[0].width, 320);
  assert.equal(result.streams[1].sampleRate, 48000); assert.equal(result.streams[1].channels, 2);
  assert(Object.isFrozen(result)); assert(Object.isFrozen(result.streams)); assert(Object.isFrozen(result.streams[0]));
  assert(!JSON.stringify(result).includes('private')); assert(!JSON.stringify(result).includes('/secret'));
});
test('malformed, huge, unexpected-format, excessive and duplicate-stream reports refuse', () => {
  const data = JSON.parse(report().stdout);
  for (const text of ['null', '{', 'x'.repeat(65537), '{}', JSON.stringify({ ...data, format: { format_name: 'hls' } }),
    JSON.stringify({ ...data, streams: Array(33).fill(data.streams[0]) }), JSON.stringify({ ...data, streams: [data.streams[0], data.streams[0]] })]) {
    assert.throws(() => summarize(text, 123), { code: 'SOURCE_REPORT' });
  }
});
test('MP4 summary is format-bound, sanitized and never an encoding grant', () => {
  const data = JSON.parse(report().stdout); data.format.format_name = 'mov,mp4,m4a,3gp,3g2,mj2';
  const text = JSON.stringify(data), result = summarize(text, 123, 'mp4');
  assert.equal(result.container, 'MP4 / MOV family'); assert.equal(result.scope, 'read-only-container-observation');
  assert.equal(result.encodeAllowed, false); assert(!JSON.stringify(result).includes('/secret'));
  assert.throws(() => summarize(text, 123, 'matroska'), { code: 'SOURCE_REPORT' });
  assert.throws(() => summarize(report().stdout, 123, 'mp4'), { code: 'SOURCE_REPORT' });
  for (const format of ['__proto__', 'hls', {}, null]) assert.throws(() => summarize(text, 123, format), { code: 'SOURCE_REPORT' });
});
test('MP4 selects only fixed MOV arguments with external tracks and absolute references disabled', async t => {
  const { dir } = await fixture(t); const source = path.join(dir, 'synthetic.MP4'); await fs.writeFile(source, 'test-only-bytes');
  const result = await inspectSource(source, { run: async (kind, args, options) => {
    assert.equal(kind, 'ffprobe'); assert.equal(options.timeoutMs, 10000);
    for (const [key, value] of [['-f', 'mov'], ['-format_whitelist', 'mov,mp4,m4a,3gp,3g2,mj2'], ['-protocol_whitelist', 'file'], ['-enable_drefs', '0'], ['-use_absolute_path', '0']]) {
      assert.equal(args.filter(arg => arg === key).length, 1); assert.equal(args[args.indexOf(key) + 1], value);
    }
    assert(!args.includes(source)); const data = JSON.parse(report().stdout); data.format.format_name = 'mov,mp4,m4a,3gp,3g2,mj2'; return { stdout: JSON.stringify(data) };
  } });
  assert.equal(result.container, 'MP4 / MOV family'); assert.equal(result.encodeAllowed, false);
});
test('Matroska profile does not receive MOV-specific switches', async t => {
  const { source } = await fixture(t); const result = await inspectSource(source, { run: async (_kind, args) => {
    assert(!args.includes('-enable_drefs')); assert(!args.includes('-use_absolute_path')); return report();
  } }); assert.equal(result.container, 'Matroska / WebM');
});
test('unsupported containers still refuse before launching, including MOV and playlists', async t => {
  const { dir } = await fixture(t); let launches = 0;
  for (const suffix of ['mov', 'm4a', 'm3u8', 'avi']) await assert.rejects(inspectSource(path.join(dir, `source.${suffix}`), { run: async () => { launches++; return report(); } }), { code: 'SOURCE_PATH' });
  assert.equal(launches, 0);
});
test('unavailable and malformed numeric/codec metadata remains unknown, not fabricated', () => {
  const data = JSON.parse(report().stdout); Object.assign(data.streams[0], { codec_name: '<script>', width: -1, height: 1e9, pix_fmt: '/private/path', avg_frame_rate: '0/0' });
  data.format.duration = 'N/A'; const result = summarize(JSON.stringify(data), 1);
  for (const field of ['codec', 'width', 'height', 'pixelFormat', 'frameRate']) assert.equal(result.streams[0][field], null);
  assert.equal(result.durationSeconds, null);
});
test('probe uses held fd and fixed bounded args; successful inspection leaves bytes unchanged and closes fd', async t => {
  const { source } = await fixture(t); let descriptor;
  const before = await fs.readFile(source);
  const result = await inspectSource(source, { run: async (kind, args, options) => {
    assert.equal(kind, 'ffprobe'); descriptor = args.at(-1); assert.match(descriptor, new RegExp(`^/proc/${process.pid}/fd/\\d+$`));
    assert.deepEqual(await fs.readFile(descriptor), before); assert(!args.includes(source));
    assert.equal(args[args.indexOf('-f') + 1], 'matroska'); assert.equal(args[args.indexOf('-protocol_whitelist') + 1], 'file');
    assert.equal(args[args.indexOf('-max_streams') + 1], '32'); assert.equal(options.timeoutMs, 10000); return report();
  } });
  assert.equal(result.bytes, before.length); assert.deepEqual(await fs.readFile(source), before); await assert.rejects(fs.stat(descriptor), { code: 'ENOENT' });
});
test('relative paths, URLs, unsupported suffix, empty, directory and symlink inputs never launch', async t => {
  const { source, dir } = await fixture(t); const link = path.join(dir, 'link.mkv'); await fs.symlink(source, link);
  const empty = path.join(dir, 'empty.mkv'); await fs.writeFile(empty, ''); const folder = path.join(dir, 'folder.mkv'); await fs.mkdir(folder);
  let calls = 0; for (const input of ['relative.mkv', 'https://host/file.mkv', `${source}\0`, source.replace('.mkv', '.m3u8'), link, empty, folder]) {
    await assert.rejects(inspectSource(input, { run: async () => { calls++; return report(); } }));
  } assert.equal(calls, 0);
});
test('path replacement and in-place changes cannot return an observation', async t => {
  const { source, dir } = await fixture(t);
  await assert.rejects(inspectSource(source, { run: async () => { await fs.rename(source, path.join(dir, 'retained.mkv')); await fs.writeFile(source, 'replacement'); return report(); } }), { code: 'SOURCE_CHANGED' });
  await assert.rejects(inspectSource(source, { run: async () => { await fs.appendFile(source, 'changed'); return report(); } }), { code: 'SOURCE_CHANGED' });
});
test('abort before launch, abort after child and probe failure all release file handles', async t => {
  const { source } = await fixture(t); let calls = 0;
  await assert.rejects(inspectSource(source, { signal: AbortSignal.abort(), run: async () => { calls++; return report(); } }), { code: 'CANCELLED' }); assert.equal(calls, 0);
  for (const mode of ['abort', 'failure']) {
    const controller = new AbortController(); let descriptor;
    await assert.rejects(inspectSource(source, { signal: controller.signal, run: async (_kind, args) => {
      descriptor = args.at(-1); if (mode === 'abort') { controller.abort(); return report(); } throw Object.assign(new Error('private'), { code: 'TOOL_EXIT' });
    } }), { code: mode === 'abort' ? 'CANCELLED' : 'TOOL_EXIT' }); await assert.rejects(fs.stat(descriptor), { code: 'ENOENT' });
  }
});
test('abort keeps the descriptor open until the owned probe promise actually settles', async t => {
  const { source } = await fixture(t); const abort = new AbortController(); let descriptor, rejectRun, launched;
  const started = new Promise(resolve => { launched = resolve; });
  const inspection = inspectSource(source, { signal: abort.signal, run: async (_kind, args) => {
    descriptor = args.at(-1); launched(); await new Promise((_resolve, reject) => { rejectRun = reject; });
  } });
  const rejected = assert.rejects(inspection, { code: 'CANCELLED' });
  await started; abort.abort(); assert((await fs.stat(descriptor)).isFile());
  rejectRun(Object.assign(new Error('cancelled after child close'), { code: 'CANCELLED' }));
  await rejected; await assert.rejects(fs.stat(descriptor), { code: 'ENOENT' });
});
