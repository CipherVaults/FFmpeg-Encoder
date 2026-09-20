'use strict';

// A bounded, independently reproducible engineering benchmark. Personal footage is
// opened only for reading; every new file belongs to a fresh artifacts directory.
// This deliberately does not import application settings: it records the proposed
// recipe and the current product's x265 reference explicitly for independent review.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const binaries = ['ffmpeg.exe', 'ffprobe.exe'].map(name => path.join(root, 'ffmpeg', name));
const [ffmpeg, ffprobe] = binaries;
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources/binary-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const sha = data => crypto.createHash('sha256').update(data).digest('hex');
for (const binary of manifest.binaries) assert.equal(sha(fs.readFileSync(path.join(root, 'ffmpeg', binary.name))), binary.sha256);
const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = option('phase') || 'discover';
const runRoot = option('run') ? path.resolve(option('run')) : path.join(root, 'artifacts', `archive-quality-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`);
assert.ok(runRoot.startsWith(path.join(root, 'artifacts', 'archive-quality-')), 'Only owned archive-quality artifacts may be written.');
fs.mkdirSync(runRoot, { recursive: true });
const reportName = phase === 'converge' ? 'convergence.json' : 'report.json';
let report = fs.existsSync(path.join(runRoot, reportName)) ? JSON.parse(fs.readFileSync(path.join(runRoot, reportName), 'utf8')) : {
  schemaVersion: 1, startedUtc: new Date().toISOString(), pinnedRuntime: manifest.version,
  binaryHashes: manifest.binaries.map(({name, sha256}) => ({name, sha256})), commands: [], sources: [], cases: [],
  limits: ['Bounded personally recorded OBS clips, not statistical archive coverage or a perceptual-equivalence claim.',
    'Original recordings are already compressed. Metrics compare against decoded original clips, not pristine game renderings.',
    'Timing includes software decode and startup under the recorded host load; it is not an isolated encoder throughput measurement.',
    'Benchmark outputs contain only the selected video. App stream preservation and packaged behavior require separate endpoint evidence.',
    'Source identity uses filesystem metadata and sparse sampled SHA256, not a complete original-media hash.',
    'Local hardware evidence applies only to RTX5060 Blackwell and this driver; no Ada hardware was tested.']
};
function save() { fs.writeFileSync(path.join(runRoot, reportName), JSON.stringify(report, null, 2)); }
function command(binary, argv, label, timeout = 180000) {
  console.log(label);
  const started = Date.now();
  const result = spawnSync(binary, argv, { cwd: runRoot, shell: false, windowsHide: true, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(runRoot, `${label}.stdout.txt`), result.stdout || '');
  fs.writeFileSync(path.join(runRoot, `${label}.stderr.txt`), result.stderr || '');
  const record = { executable: binary, argv, label, startedUtc: new Date(started).toISOString(), elapsedSeconds: (Date.now() - started) / 1000, status: result.status, error: result.error?.message || null };
  report.commands.push(record); save();
  assert.equal(result.status, 0, `${label} failed: ${result.stderr?.slice(-2500)}`);
  return { record, stdout: result.stdout || '', stderr: result.stderr || '' };
}
function stamp(file) {
  const stat = fs.statSync(file, { bigint: true });
  assert.ok(stat.isFile() && stat.size > 0n);
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(key => [key, stat[key].toString()]));
}
function identity(file) {
  const before = stamp(file); const handle = fs.openSync(file, 'r'); const hash = crypto.createHash('sha256');
  try {
    const size = Number(before.size); const span = Math.min(256 * 1024, size);
    for (const offset of [0, Math.max(0, Math.floor(size / 2) - Math.floor(span / 2)), Math.max(0, size - span)]) {
      const buffer = Buffer.alloc(span); const count = fs.readSync(handle, buffer, 0, span, offset);
      hash.update(`${offset}:${count}:`); hash.update(buffer.subarray(0, count));
    }
  } finally { fs.closeSync(handle); }
  assert.deepEqual(stamp(file), before, 'Source changed during identity read.');
  return { ...before, sparseSha256: hash.digest('hex') };
}
function checkSource(source) { assert.deepEqual(identity(source.path), source.identity, `Source changed: ${source.path}`); }
function probe(file, label, countFrames = false) {
  return JSON.parse(command(ffprobe, ['-v', 'error', ...(countFrames ? ['-count_frames'] : []), '-show_format', '-show_streams', '-of', 'json', file], label).stdout);
}
function gpu(label) { return command('nvidia-smi.exe', ['--query-gpu=name,driver_version,pci.device_id,compute_cap,utilization.gpu,utilization.encoder', '--format=csv'], label).stdout.trim(); }

if (phase === 'discover') {
  assert.equal(report.sources.length, 0, 'Discovery already exists; reuse it.');
  report.driver = gpu('hardware');
  command(ffmpeg, ['-version'], 'runtime');
  command(ffmpeg, ['-hide_banner', '-h', 'encoder=hevc_nvenc'], 'hevc-nvenc-help');
  command(ffmpeg, ['-hide_banner', '-filters'], 'filters');
  command(ffmpeg, ['-hide_banner', '-h', 'filter=libvmaf'], 'libvmaf-help');
  for (const [index, name] of ['2026-04-19 13-03-19.mkv', '2026-07-09 01-56-26.mkv', '2026-09-04 09-34-49.mkv'].entries()) {
    assert.notEqual(name, '2026-09-08 19-02-39.mkv');
    const file = path.join('F:\\shadow play\\OBS', name);
    const source = { id: `source${index + 1}`, path: file, identity: identity(file) };
    source.probe = probe(file, `${source.id}-probe`);
    const video = source.probe.streams.find(stream => stream.codec_type === 'video' && !stream.disposition?.attached_pic);
    assert.ok(video && ['yuv420p', 'yuv420p10le'].includes(video.pix_fmt));
    assert.equal(video.color_transfer, 'bt709', 'This benchmark only selects explicitly SDR recordings.');
    source.video = { index: video.index, width: video.width, height: video.height, pixelFormat: video.pix_fmt, frameRate: video.avg_frame_rate, color: video.color_transfer };
    source.durationSeconds = Number(source.probe.format.duration);
    source.previews = [];
    for (const fraction of [0.15, 0.5, 0.8]) {
      const atSeconds = Math.floor(source.durationSeconds * fraction);
      const output = path.join(runRoot, `${source.id}-${atSeconds}s.png`);
      command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-ss', String(atSeconds), '-i', file, '-map', `0:${video.index}`, '-frames:v', '1', '-vf', 'scale=960:-2', output], `${source.id}-${atSeconds}s-preview`);
      source.previews.push({ atSeconds, path: output });
    }
    checkSource(source); report.sources.push(source); save();
  }
} else if (phase === 'options') {
  report.optionCases ||= [];
  for (const bits of [8, 10]) for (const preset of ['p1', 'p6', 'p7']) {
    const id = `options-${bits}-${preset}`;
    if (report.optionCases.some(item => item.id === id)) continue;
    const pixel = bits === 8 ? 'yuv420p' : 'p010le';
    const output = path.join(runRoot, `${id}.mkv`);
    const encoded = command(ffmpeg, ['-hide_banner', '-loglevel', 'verbose', '-nostdin', '-n', '-f', 'lavfi', '-i',
      `testsrc2=size=320x180:rate=30,format=${pixel},setparams=range=limited:color_primaries=bt709:color_trc=bt709:colorspace=bt709`,
      '-frames:v', '96', '-an', '-c:v', 'hevc_nvenc', '-preset', preset, '-tune', 'uhq', '-multipass', 'fullres', '-rc', 'vbr', '-cq', '24', '-b:v', '0', '-bf', '4', '-b_ref_mode', 'each',
      '-pix_fmt', `+${pixel}`, ...(bits === 10 ? ['-profile:v', 'main10'] : []), output], `${id}-encode`);
    assert.ok(!/not supported|unsupported|ignoring|has not been used/i.test(encoded.stderr));
    const checked = probe(output, `${id}-probe`, true);
    assert.equal(Number(checked.streams[0].nb_read_frames), 96);
    assert.equal(checked.streams[0].pix_fmt, bits === 8 ? 'yuv420p' : 'yuv420p10le');
    command(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-nostdin', '-i', output, '-f', 'null', '-'], `${id}-decode`);
    const frames = JSON.parse(command(ffprobe, ['-v', 'error', '-select_streams', 'v:0', '-show_frames', '-show_entries', 'frame=pict_type', '-of', 'json', output], `${id}-frames`).stdout);
    report.optionCases.push({ id, bits, preset, argv: encoded.record.argv, probe: checked, sha256: sha(fs.readFileSync(output)), frameTypes: frames.frames.map(frame => frame.pict_type).join(''), complete: true }); save();
  }
} else if (phase === 'converge') {
  // Follow-up changes quality only, retaining every original result byte-for-byte.
  // It uses already extracted owned lossless clips and never reopens personal media.
  const originalBytes = fs.readFileSync(path.join(runRoot, 'report.json'));
  const original = JSON.parse(originalBytes);
  assert.equal(original.complete, true);
  report.originalReportSha256 = sha(originalBytes);
  const cqValues = (option('cq') || '28,30').split(',').map(Number);
  assert.ok(cqValues.length <= 2 && cqValues.every(cq => Number.isInteger(cq) && cq >= 25 && cq <= 40));
  for (const baseline of original.cases.filter(item => item.variant.id === 'x265-product-crf25')) {
    const id = baseline.selection.id; const clip = path.join(runRoot, `${id}-reference.mkv`);
    const before = stamp(clip); const referenceVideo = baseline.probe.streams[0];
    for (const cq of cqValues) {
      const caseId = `${id}-archive-cq${cq}`;
      if (report.cases.some(item => item.id === caseId && item.complete)) continue;
      const output = path.join(runRoot, `${caseId}.mkv`);
      const beforeGpu = gpu(`${caseId}-gpu-before`);
      const argv = [...baseline.argv];
      const optionsStart = argv.indexOf('-c:v'); const pixelStart = argv.indexOf('-pix_fmt');
      argv.splice(optionsStart, pixelStart - optionsStart, '-c:v', 'hevc_nvenc', '-preset', 'p7', '-tune', 'uhq', '-multipass', 'fullres', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0', '-bf', '4', '-b_ref_mode', 'each');
      argv[argv.length - 1] = output;
      argv.splice(1, 0, '-loglevel', 'verbose');
      const encode = command(ffmpeg, argv, `${caseId}-encode`, 300000);
      assert.ok(!/not supported|unsupported|ignoring|has not been used/i.test(encode.stderr));
      assert.ok(encode.stderr.includes(`CQ(${cq * 256}) mode enabled.`));
      const decoded = probe(output, `${caseId}-probe`, true); const stream = decoded.streams[0];
      for (const field of ['width', 'height', 'pix_fmt', 'color_transfer']) assert.equal(stream[field], referenceVideo[field]);
      assert.equal(Number(stream.nb_read_frames), baseline.frameCount);
      command(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-nostdin', '-i', output, '-map', '0:v:0', '-f', 'null', '-'], `${caseId}-decode`);
      command(ffmpeg, ['-hide_banner', '-nostdin', '-i', output, '-i', clip, '-filter_complex',
        `[0:v]settb=AVTB,setpts=PTS-STARTPTS[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS[r];[d][r]libvmaf=log_fmt=json:log_path=${caseId}-vmaf.json:n_threads=6`,
        '-an', '-f', 'null', '-'], `${caseId}-vmaf`, 300000);
      const vmaf = JSON.parse(fs.readFileSync(path.join(runRoot, `${caseId}-vmaf.json`), 'utf8'));
      assert.equal(vmaf.frames.length, baseline.frameCount);
      const ssim = command(ffmpeg, ['-hide_banner', '-nostdin', '-i', output, '-i', clip, '-lavfi',
        '[0:v]settb=AVTB,setpts=PTS-STARTPTS[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS[r];[d][r]ssim', '-an', '-f', 'null', '-'], `${caseId}-ssim`, 300000);
      const scores = vmaf.frames.map(frame => frame.metrics.vmaf).sort((a, b) => a - b);
      const bytes = fs.statSync(output).size;
      report.cases.push({ id: caseId, sourceId: baseline.sourceId, selection: baseline.selection, quality: cq,
        frameCount: baseline.frameCount, durationSeconds: baseline.durationSeconds, encodeSeconds: encode.record.elapsedSeconds,
        realtimeFactor: baseline.durationSeconds / encode.record.elapsedSeconds, bytes, sizeRatioToX265: bytes / baseline.bytes,
        speedRatioToX265: baseline.encodeSeconds / encode.record.elapsedSeconds, sha256: sha(fs.readFileSync(output)), argv,
        vmafMean: vmaf.pooled_metrics.vmaf.mean, vmafP5: scores[Math.floor(scores.length * 0.05)], vmafMin: scores[0],
        ssimAll: Number(ssim.stderr.match(/All:([0-9.]+)/)?.[1]), beforeGpu, probe: decoded, complete: true }); save();
      command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-i', output, '-vf', `select=eq(n\\,${Math.floor(baseline.frameCount * 0.65)})`,
        '-frames:v', '1', path.join(runRoot, `${caseId}-frame.png`)], `${caseId}-still`);
    }
    assert.deepEqual(stamp(clip), before, 'Lossless reference changed.');
  }
  assert.equal(sha(fs.readFileSync(path.join(runRoot, 'report.json'))), report.originalReportSha256);
  report.finishedUtc = new Date().toISOString(); report.complete = true; save();
} else if (phase === 'benchmark') {
  // Selection is explicit and durable, after visual reconnaissance. Every variant
  // receives the identical losslessly decoded frame sequence, resolution and depth.
  const selections = JSON.parse(fs.readFileSync(path.join(runRoot, 'selection.json'), 'utf8'));
  for (const selection of selections) {
    const source = report.sources.find(item => item.id === selection.sourceId); assert.ok(source); checkSource(source);
    const id = selection.id; assert.match(id, /^[a-z0-9-]+$/);
    const clip = path.join(runRoot, `${id}-reference.mkv`);
    if (!fs.existsSync(clip)) {
      command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-ss', String(selection.atSeconds), '-i', source.path, '-map', `0:${source.video.index}`, '-t', String(selection.durationSeconds), '-an', '-sn', '-dn', '-c:v', 'ffv1', '-level', '3', '-g', '1', '-pix_fmt', `+${source.video.pixelFormat}`, '-fps_mode', 'passthrough', clip], `${id}-reference`, 300000);
    }
    checkSource(source);
    const reference = probe(clip, `${id}-reference-probe`, true);
    const video = reference.streams[0]; const frameCount = Number(video.nb_read_frames);
    const fps = video.avg_frame_rate.split('/').reduce((a, b) => a / b);
    const duration = frameCount / fps;
    assert.ok(frameCount > 100 && video.width === source.video.width && video.pix_fmt === source.video.pixelFormat);
    const variants = [
      { id: 'x265-product-crf25', args: ['-c:v', 'libx265', '-preset', 'slow', '-crf', '25', '-x265-params', 'aq-mode=3:psy-rd=2'] },
      ...(selection.stockBaseline ? [{ id: 'x265-stock-crf25', args: ['-c:v', 'libx265', '-preset', 'slow', '-crf', '25'] }] : []),
      ...[24, 23].map(cq => ({ id: `archive-cq${cq}`, args: ['-c:v', 'hevc_nvenc', '-preset', 'p7', '-tune', 'uhq', '-multipass', 'fullres', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0', '-bf', '4', '-b_ref_mode', 'each'] }))
    ];
    for (const variant of variants) {
      if (report.cases.some(item => item.id === `${id}-${variant.id}` && item.complete)) continue;
      const caseId = `${id}-${variant.id}`; const output = path.join(runRoot, `${caseId}.mkv`);
      const pixelFormat = source.video.pixelFormat === 'yuv420p10le' && variant.id.startsWith('archive') ? 'p010le' : source.video.pixelFormat;
      const beforeGpu = gpu(`${caseId}-gpu-before`);
      const argv = ['-hide_banner', '-nostdin', '-n', '-i', clip, '-map', '0:v:0', '-an', '-sn', '-dn', ...variant.args,
        '-pix_fmt', `+${pixelFormat}`, ...(pixelFormat === 'p010le' ? ['-profile:v', 'main10'] : []),
        '-fps_mode', 'passthrough', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', output];
      const encode = command(ffmpeg, argv, `${caseId}-encode`, 900000);
      assert.ok(!/not supported|unsupported|ignoring|has not been used/i.test(encode.stderr), 'No requested option may be silently ignored.');
      const decoded = probe(output, `${caseId}-probe`, true); const stream = decoded.streams[0];
      assert.equal(Number(stream.nb_read_frames), frameCount);
      assert.equal(stream.width, source.video.width); assert.equal(stream.height, source.video.height);
      assert.equal(stream.pix_fmt, source.video.pixelFormat); assert.equal(stream.color_transfer, 'bt709');
      command(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-nostdin', '-i', output, '-map', '0:v:0', '-f', 'null', '-'], `${caseId}-decode`);
      const metricPath = `${caseId}-vmaf.json`;
      const metric = command(ffmpeg, ['-hide_banner', '-nostdin', '-i', output, '-i', clip,
        '-filter_complex', `[0:v]settb=AVTB,setpts=PTS-STARTPTS[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS[r];[d][r]libvmaf=log_fmt=json:log_path=${metricPath}:n_threads=6`, '-an', '-f', 'null', '-'], `${caseId}-vmaf`, 300000);
      const vmaf = JSON.parse(fs.readFileSync(path.join(runRoot, metricPath), 'utf8'));
      assert.equal(vmaf.frames.length, frameCount, 'Metric frame alignment must be complete.');
      const ssim = command(ffmpeg, ['-hide_banner', '-nostdin', '-i', output, '-i', clip, '-lavfi', '[0:v]settb=AVTB,setpts=PTS-STARTPTS[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS[r];[d][r]ssim', '-an', '-f', 'null', '-'], `${caseId}-ssim`, 300000);
      const scores = vmaf.frames.map(frame => frame.metrics.vmaf).sort((a, b) => a - b);
      const result = { id: caseId, sourceId: source.id, selection, variant, frameCount, durationSeconds: duration,
        encodeSeconds: encode.record.elapsedSeconds, realtimeFactor: duration / encode.record.elapsedSeconds,
        bytes: fs.statSync(output).size, sha256: sha(fs.readFileSync(output)), argv,
        videoBitrate: fs.statSync(output).size * 8 / duration, vmafMean: vmaf.pooled_metrics.vmaf.mean,
        vmafP5: scores[Math.floor(scores.length * 0.05)], vmafMin: scores[0],
        ssimAll: Number(ssim.stderr.match(/All:([0-9.]+)/)?.[1]), beforeGpu,
        probe: decoded, complete: true };
      report.cases.push(result); save();
    }
    // Four same-frame comparison rows, preserving the full source-sized crop in a
    // separate image. Downscaled overview sheets are navigation aids only.
    const frame = Math.floor(frameCount * 0.65);
    for (const variant of ['reference', ...variants.map(item => item.id)]) {
      const file = path.join(runRoot, `${id}-${variant}.mkv`);
      command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', path.join(runRoot, `${id}-${variant}-frame.png`)], `${id}-${variant}-still`);
    }
    checkSource(source);
  }
  report.finishedUtc = new Date().toISOString(); report.complete = true; save();
} else throw new Error('Use --phase=discover, --phase=options or --phase=benchmark.');
console.log(`Evidence: ${runRoot}`);
