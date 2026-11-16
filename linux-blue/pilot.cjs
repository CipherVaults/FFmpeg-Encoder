'use strict';

// Finite synthetic-only developer pilot. No input path or command-line options
// are accepted; this cannot be pointed at someone's media collection.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { PROFILES } = require('../src/media.cjs');
const { PINS, verifyTool, runFixedTool, cpuArgs, runCpuEncode, sha256 } = require('./runtime.cjs');

async function main() {
  assert.equal(process.argv.length, 2, 'This synthetic-only pilot accepts no arguments.');
  const root = path.join(__dirname, 'artifacts');
  try { await fs.mkdir(root, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  const rootStat = await fs.lstat(root);
  assert(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'Artifacts root must not be a symlink.');
  assert.equal(await fs.realpath(root), root);
  const runDirectory = await fs.mkdtemp(path.join(root, 'cpu-pilot-'));
  const reportPath = path.join(runDirectory, 'report.json');
  const report = { schemaVersion: 1, status: 'RUNNING', startedAt: new Date().toISOString(),
    claim: 'Linux component compatibility on one tiny synthetic SDR corpus, not application or release qualification',
    node: process.version, platform: process.platform, arch: process.arch, runtime: PINS,
    calls: [], cases: [], children: { spawned: 0, closed: 0, maximumLive: 0 },
    limits: ['No Windows, NVIDIA, AMD, Intel, UI, service, packaging, HDR or representative-quality claim',
      'System FFmpeg is dynamically linked; only executables are hash-bound, not a release-pinned library closure',
      'No production qualification catalog or policy is changed'] };
  let live = 0;
  const owned = new Set();
  const run = async (kind, args, options = {}, encodeRequest) => {
    const call = { kind, args, startedAt: new Date().toISOString() };
    report.calls.push(call);
    try {
      const observedOptions = { ...options, onChild(child) {
        report.children.spawned++;
        live++;
        report.children.maximumLive = Math.max(report.children.maximumLive, live);
        owned.add(child);
        child.once('close', (code, signal) => {
          live--; report.children.closed++; owned.delete(child);
          call.close = { code, signal };
        });
        options.onChild?.(child);
      } };
      const result = encodeRequest
        ? await runCpuEncode(encodeRequest, observedOptions)
        : await runFixedTool(kind, args, observedOptions);
      call.status = 'PASSED'; call.stderr = result.stderr; call.stderrCapture = result.stderrCapture;
      return result;
    } catch (error) {
      call.status = 'FAILED'; call.error = { code: error.code, message: error.message,
        exitCode: error.exitCode, exitSignal: error.exitSignal, stderr: error.stderr,
        stderrCapture: error.stderrCapture };
      throw error;
    } finally { call.finishedAt = new Date().toISOString(); }
  };
  const probe = async filename => JSON.parse((await run('ffprobe', [
    '-v', 'error', '-protocol_whitelist', 'file,pipe', '-count_frames', '-show_streams',
    '-show_format', '-show_chapters', '-of', 'json', filename,
  ])).stdout);
  const decode = filename => run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error',
    '-xerror', '-err_detect', 'explode', '-protocol_whitelist', 'file,pipe', '-i', filename,
    '-map', '0:v:0', '-map', '0:a:0', '-f', 'null', '-']);
  const audioHash = async filename => (await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error',
    '-protocol_whitelist', 'file,pipe', '-i', filename, '-map', '0:a:0', '-c', 'copy',
    '-f', 'hash', '-hash', 'sha256', 'pipe:1'])).stdout.trim();

  try {
    for (const kind of Object.keys(PINS)) {
      await verifyTool(kind);
      const version = (await run(kind, ['-version'])).stdout;
      assert(version.startsWith(`${kind} version 7.1.5-0+deb13u1 `));
      report[`${kind}Version`] = version;
    }
    const source = path.join(runDirectory, 'synthetic-source.mkv');
    await run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-n',
      '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=30:duration=0.4,setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=0.4',
      '-map', '0:v:0', '-map', '1:a:0', '-t', '0.4', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '0',
      '-pix_fmt', 'yuv420p', '-color_trc', 'bt709', '-color_primaries', 'bt709',
      '-colorspace', 'bt709', '-color_range', 'tv', '-c:a', 'pcm_s16le', '-ac', '2',
      '-metadata', 'title=Linux Blue synthetic pilot', '-metadata:s:a:0', 'language=eng', source]);
    const sourceBytes = await fs.readFile(source);
    report.source = { sha256: sha256(sourceBytes), bytes: sourceBytes.length, generated: true };
    const sourceProbe = await probe(source);
    report.source.probe = sourceProbe;
    await decode(source);
    const expectedAudio = await audioHash(source);
    const sourceVideo = sourceProbe.streams.find(stream => stream.codec_type === 'video');
    assert.equal(sourceVideo.nb_read_frames, '12');
    const expectedCodecs = { 'h264-cpu': 'h264', 'h265-cpu': 'hevc', 'av1-cpu': 'av1' };
    for (const id of Object.keys(expectedCodecs)) {
      const profile = PROFILES.find(item => item.id === id);
      const settings = { profileId: id, preset: profile.defaultPreset, quality: profile.quality.default };
      const output = path.join(runDirectory, `${id}.mkv`);
      const args = cpuArgs({ input: source, output, settings, probe: sourceProbe });
      const progress = [];
      await run('ffmpeg', args, { onProgress: value => progress.push(value) },
        { input: source, output, settings, probe: sourceProbe });
      const outputProbe = await probe(output);
      const video = outputProbe.streams.find(stream => stream.codec_type === 'video');
      const audio = outputProbe.streams.find(stream => stream.codec_type === 'audio');
      assert.equal(outputProbe.streams.length, 2);
      assert.equal(video.codec_name, expectedCodecs[id]);
      assert.equal(video.nb_read_frames, '12');
      assert.equal(video.width, 320); assert.equal(video.height, 180);
      assert.equal(video.pix_fmt, 'yuv420p');
      for (const field of ['color_transfer', 'color_primaries', 'color_space', 'color_range']) {
        assert.equal(video[field], sourceVideo[field], `${id}: ${field}`);
      }
      assert.equal(audio.codec_name, 'pcm_s16le'); assert.equal(audio.sample_rate, '48000');
      assert.equal(audio.channels, 2); assert.equal(audio.tags?.language, 'eng');
      assert.equal(outputProbe.format.tags?.title, sourceProbe.format.tags?.title);
      assert.equal(await audioHash(output), expectedAudio);
      await decode(output);
      assert(progress.some(item => item.ended), `${id}: missing complete progress record`);
      const bytes = await fs.readFile(output);
      report.cases.push({ profileId: id, status: 'PASSED', settings, outputBytes: bytes.length,
        outputSha256: sha256(bytes), frameCount: 12, audioPayloadPreserved: true,
        fullDecode: true, progress, probe: outputProbe });
      if (id === 'h264-cpu') {
        const collisionProgress = [];
        let collision;
        try { collision = await run('ffmpeg', args, { onProgress: p => collisionProgress.push(p) }); }
        catch (error) { assert.equal(error.code, 'TOOL_FAILED'); collision = error; }
        assert.match(collision.stderr, /already exists\. Exiting\./);
        assert(!collisionProgress.some(item => item.ended));
        assert.equal(sha256(await fs.readFile(output)), sha256(bytes));
        report.overwriteRefusal = { status: 'PASSED', existingOutputUnchanged: true,
          runtimeExitCode: collision.exitCode, terminalProgress: false,
          note: 'A zero exit can be an overwrite refusal, not a completed encode.' };
        await assert.rejects(runCpuEncode({ input: source, output, settings, probe: sourceProbe }),
          { code: 'LINUX_PILOT_OUTPUT_EXISTS' });
        report.adapterExistingOutputRefusal = 'PASSED: refused before launch';
      }
    }

    // Real bounded child cancellation uses generated frames and a null sink,
    // never a source file or a product publication. Abort only after progress.
    const abort = new AbortController();
    let cancelledChild, cancellationProgress = false;
    await assert.rejects(run('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-nostats',
      '-progress', 'pipe:1', '-re', '-f', 'lavfi', '-i', 'testsrc2=size=64x64:rate=10:duration=30',
      '-f', 'null', '-'], { signal: abort.signal, timeoutMs: 5000,
      onChild: child => { cancelledChild = child; },
      onProgress: progress => { if (progress.frame > 0) { cancellationProgress = true; abort.abort(); } },
    }), { code: 'CANCELLED' });
    assert(cancellationProgress); assert(cancelledChild);
    assert.throws(() => process.kill(cancelledChild.pid, 0), { code: 'ESRCH' });
    report.activeCancellation = 'PASSED: progress observed, cancellation rejected after close, child absent';
    assert.equal(sha256(await fs.readFile(source)), report.source.sha256);
    report.sourceUnchanged = true;
    assert.equal(live, 0); assert.equal(owned.size, 0);
    assert.equal(report.children.spawned, report.children.closed);
    assert.equal(report.children.maximumLive, 1);
    report.status = 'PASSED';
  } catch (error) {
    report.status = 'FAILED'; report.failure = { code: error.code, message: error.message, stack: error.stack };
    process.exitCode = 1;
  } finally {
    // runTool retains every handle until close, including errors. Never erase a
    // failed run or its incomplete file. The receipt records negative calls as
    // failures even when the surrounding refusal assertion intentionally passed.
    report.finishedAt = new Date().toISOString(); report.children.liveAtEnd = live;
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, reportPath, cases: report.cases.length,
      children: report.children, failure: report.failure?.message }, null, 2));
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
