'use strict';
// Local experiment only: accepts exactly the known 12-frame synthetic pilot
// fixture, never personal media. Main owns constructor paths and observers.
// This is not registered IPC and does not replace EncoderService/storage gates.
const fs = require('node:fs/promises');
const path = require('node:path');
const { constants } = require('node:fs');
const assert = require('node:assert/strict');
const { acceptCpuSettings } = require('./ui-policy.cjs');
const { runFixedTool, runCpuEncode, sha256 } = require('./runtime.cjs');
const { createStage, sealStage, markStageValidated, publishOutput, cleanupStage } = require('../src/outputs.cjs');
const FIXTURE_SHA = '145c63faaaa6052e7fd7b0dc206319c67355edbb8b5e2c43a2687af5100a5d06';
const fail = (code, message) => Object.assign(new Error(message), { code });
const cancelled = signal => { if (signal.aborted) throw fail('CANCELLED', 'Synthetic job cancelled.'); };

async function fixtureIdentity(source) {
  const before = await fs.lstat(source, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > 1024n * 1024n
      || await fs.realpath(source) !== source) throw fail('SYNTHETIC_FIXTURE', 'An ordinary canonical synthetic fixture is required.');
  const handle = await fs.open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = await handle.stat({ bigint: true });
    const same = stat => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].every(key => before[key] === stat[key]);
    if (!opened.isFile() || !same(opened)) throw fail('SYNTHETIC_FIXTURE', 'Fixture changed while opening.');
    // Bound the read even if a caller grows its original during capture.
    const buffer = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (!bytesRead) break;
      length += bytesRead;
    }
    const bytes = buffer.subarray(0, length);
    const after = await handle.stat({ bigint: true });
    const named = await fs.lstat(source, { bigint: true });
    if (length > 1024 * 1024 || sha256(bytes) !== FIXTURE_SHA || !same(after) || !same(named)) {
      throw fail('SYNTHETIC_FIXTURE', 'Only the unchanged known synthetic fixture is supported.');
    }
    return { identity: `${after.dev}:${after.ino}`, bytes };
  } finally { await handle.close(); }
}

async function createSyntheticService({ source, parent, onProgress, onChild } = {}) {
  if (typeof source !== 'string' || typeof parent !== 'string' || !path.isAbsolute(source) || !path.isAbsolute(parent)
      || [onProgress, onChild].some(fn => fn !== undefined && typeof fn !== 'function')) throw fail('SYNTHETIC_CONFIG', 'Main-owned canonical paths and observers required.');
  const capturedFixture = await fixtureIdentity(source);
  const parentStat = await fs.lstat(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || await fs.realpath(parent) !== parent) throw fail('SYNTHETIC_CONFIG', 'Canonical output parent required.');
  const directory = await fs.mkdtemp(path.join(parent, 'synthetic-service-'));
  const directoryIdentity = await fs.lstat(directory, { bigint: true });
  // Never give a child the caller-owned pathname. Retain the verified bytes
  // in our private directory using exclusive creation; original stays read-only.
  source = path.join(directory, '.synthetic-fixture');
  await fs.writeFile(source, capturedFixture.bytes, { flag: 'wx', mode: 0o400 });
  await fixtureIdentity(source);
  let active = null, controller = null, closed = false;
  async function verifyDirectory() {
    const stat = await fs.lstat(directory, { bigint: true });
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory
        || ['dev', 'ino', 'birthtimeNs'].some(key => stat[key] !== directoryIdentity[key])) throw fail('SYNTHETIC_DIRECTORY', 'Owned output directory changed.');
  }
  async function execute(settings, signal) {
    let stage, cleanup, published = false;
    const destination = path.join(directory, `${settings.profileId}.mkv`);
    const { identity: sourceIdentity } = await fixtureIdentity(source);
    const opts = { signal, onChild };
    const run = (kind, args) => runFixedTool(kind, args, opts);
    const probe = async file => JSON.parse((await run('ffprobe', ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-count_frames', '-show_streams', '-show_format', '-of', 'json', file])).stdout);
    const audioHash = async file => (await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-protocol_whitelist', 'file,pipe', '-i', file, '-map', '0:a:0', '-c', 'copy', '-f', 'hash', '-hash', 'sha256', 'pipe:1'])).stdout.trim();
    try {
      cancelled(signal); await verifyDirectory();
      try { await fs.lstat(destination); throw fail('SYNTHETIC_OUTPUT_EXISTS', 'Existing synthetic output is preserved.'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const sourceProbe = await probe(source), expectedAudio = await audioHash(source);
      cancelled(signal); await verifyDirectory(); stage = await createStage(directory);
      await runCpuEncode({ input: source, output: stage.file, settings, probe: sourceProbe }, { ...opts, onProgress });
      cancelled(signal); await sealStage(stage);
      const result = await probe(stage.file);
      const video = result.streams.find(item => item.codec_type === 'video');
      const audio = result.streams.find(item => item.codec_type === 'audio');
      assert.equal(result.streams.length, 2);
      assert.equal(video?.codec_name, { 'h264-cpu': 'h264', 'h265-cpu': 'hevc', 'av1-cpu': 'av1' }[settings.profileId]);
      assert.equal(video.nb_read_frames, '12'); assert.equal(video.width, 320); assert.equal(video.height, 180);
      const originalVideo = sourceProbe.streams.find(item => item.codec_type === 'video');
      for (const key of ['pix_fmt', 'color_range', 'color_space', 'color_transfer', 'color_primaries']) assert.equal(video[key], originalVideo[key]);
      assert.equal(audio?.codec_name, 'pcm_s16le'); assert.equal(audio.sample_rate, '48000'); assert.equal(audio.channels, 2);
      assert.equal(audio.tags?.language, 'eng'); assert.equal(result.format.tags?.title, sourceProbe.format.tags?.title);
      assert.equal(await audioHash(stage.file), expectedAudio);
      await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-err_detect', 'explode', '-protocol_whitelist', 'file,pipe', '-i', stage.file, '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
      await fixtureIdentity(source); await verifyDirectory(); cancelled(signal);
      await markStageValidated(stage);
      published = await publishOutput(stage, destination, { signal, atomicOnly: true });
      cleanup = await cleanupStage(stage, { protectedIdentities: new Set([sourceIdentity]) });
      return { status: published ? 'published' : 'collision', published, destination, cleanup,
        scope: 'Known synthetic fixture only; not application qualification' };
    } catch (error) {
      // Preserve any uncertain publication and identity-unbound partial outputs.
      // Existing primitive decides cleanup authority, never pathname familiarity.
      try { cleanup = await cleanupStage(stage, { protectedIdentities: new Set([sourceIdentity]) }); }
      catch (cleanupError) { cleanup = { retained: true, reason: cleanupError.message }; }
      error.receipt = { published: error.code === 'PUBLICATION_UNCERTAIN' ? null : published, destination, cleanup };
      throw error;
    }
  }
  function start(request) {
    if (closed) return Promise.reject(fail('SYNTHETIC_CLOSED', 'Service is closed.'));
    if (active) return Promise.reject(fail('SYNTHETIC_BUSY', 'Only one synthetic job may run.'));
    let settings;
    try { settings = acceptCpuSettings(request); } catch (error) { return Promise.reject(error); }
    controller = new AbortController();
    active = execute(settings, controller.signal).finally(() => { active = null; controller = null; });
    return active;
  }
  async function cancel() {
    const pending = active; controller?.abort();
    if (pending) { try { await pending; } catch { /* Caller of start owns outcome/receipt. */ } }
  }
  async function close() { closed = true; await cancel(); }
  return Object.freeze({ start, cancel, close, directory });
}
module.exports = { createSyntheticService, FIXTURE_SHA };
