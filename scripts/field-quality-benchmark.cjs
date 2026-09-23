'use strict';

// Field follow-up to Decision 15. All personal inputs, existing generated files,
// and historical benchmark outputs stay read-only. Every write is owned here.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const arg = name => process.argv.find(v => v.startsWith(`--${name}=`))?.slice(name.length + 3);
const phase = arg('phase') || 'discover';
const run = path.resolve(arg('run') || path.join(root, 'artifacts', `field-quality-${Date.now()}`));
assert.equal(path.dirname(run), path.join(root, 'artifacts'));
assert.match(path.basename(run), /^field-quality-[a-z0-9-]+$/);
fs.mkdirSync(run, { recursive: true });
const old = path.join(root, 'artifacts', 'archive-quality-1789838337640-a45fc8');
const originalReport = JSON.parse(fs.readFileSync(path.join(old, 'report.json')));
const convergence = JSON.parse(fs.readFileSync(path.join(old, 'convergence.json')));
assert.equal(originalReport.complete, true); assert.equal(convergence.complete, true);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'resources', 'binary-manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
for (const b of manifest.binaries) assert.equal(sha(fs.readFileSync(path.join(root, 'ffmpeg', b.name))), b.sha256);
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
const reportPath = path.join(run, 'report.json');
const report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath)) : {
  schemaVersion: 1, startedUtc: new Date().toISOString(), runtime: manifest, historical: {
    path: old, reportSha256: sha(fs.readFileSync(path.join(old, 'report.json'))),
    convergenceSha256: sha(fs.readFileSync(path.join(old, 'convergence.json'))),
    note: 'Historical completed campaign reused unchanged. New scope adds field coverage and original compressed packet denominators.'
  }, sources: [], commands: [], selections: [], cases: [],
  limits: [
    'Eight-second selected video samples are not statistical whole-archive coverage or proof of perceptual acceptance.',
    'Personal sources are compressed recordings. FFV1 files are lossless decoded references, never original-size denominators.',
    'Segment ratios use compressed video packet payloads in the exact presentation-time interval; container/audio overhead is excluded.',
    'Whole-file actual historical CQ32/original ratios include container and copied auxiliary streams and are reported separately.',
    'Timing includes lossless-reference decode and process startup; historical timing is retained and identified.',
    'Metrics support original-size still and motion review; metrics alone do not establish subjective equivalence.',
    'RTX5060 Blackwell evidence only, not Ada. Sparse identities do not prove cryptographic whole-file equality.'
  ]
};
const save = () => {
  fs.writeFileSync(`${reportPath}.pending`, JSON.stringify(report, null, 2));
  fs.renameSync(`${reportPath}.pending`, reportPath);
};
function command(exe, argv, label, timeout = 300000) {
  assert.match(label, /^[a-z0-9-]+$/);
  const previous = report.commands.find(x => x.label === label && x.status === 0);
  if (previous) {
    assert.equal(previous.executable, exe, 'A saved command label cannot change its executable.');
    assert.deepEqual(previous.argv, argv, 'A saved command label cannot change its arguments.');
    return { record: previous, stdout: fs.readFileSync(path.join(run, `${label}.stdout.txt`), 'utf8'), stderr: fs.readFileSync(path.join(run, `${label}.stderr.txt`), 'utf8') };
  }
  console.log(label);
  const start = Date.now();
  const result = spawnSync(exe, argv, { cwd: run, windowsHide: true, shell: false, encoding: 'utf8', timeout, maxBuffer: 32 * 1024 * 1024 });
  fs.writeFileSync(path.join(run, `${label}.stdout.txt`), result.stdout || '');
  fs.writeFileSync(path.join(run, `${label}.stderr.txt`), result.stderr || '');
  const record = { label, executable: exe, argv, startedUtc: new Date(start).toISOString(), seconds: (Date.now() - start) / 1000, status: result.status, error: result.error?.message || null };
  report.commands.push(record); save();
  assert.equal(result.status, 0, `${label}: ${result.stderr?.slice(-2500)}`);
  return { record, stdout: result.stdout, stderr: result.stderr };
}
function stamp(file) {
  const s = fs.statSync(file, { bigint: true }); assert.ok(s.isFile() && s.size > 0n);
  return Object.fromEntries(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'birthtimeNs'].map(k => [k, String(s[k])]));
}
function identity(file) {
  const before = stamp(file); const fd = fs.openSync(file, 'r'); const h = crypto.createHash('sha256');
  try { const size = Number(before.size); const span = Math.min(size, 262144);
    for (const at of [0, Math.max(0, Math.floor((size - span) / 2)), Math.max(0, size - span)]) {
      const b = Buffer.alloc(span); const count = fs.readSync(fd, b, 0, span, at); h.update(`${at}:${count}:`); h.update(b.subarray(0, count));
    }
  } finally { fs.closeSync(fd); }
  assert.deepEqual(stamp(file), before); return { ...before, sparseSha256: h.digest('hex') };
}
function checkSource(s) {
  assert.deepEqual(identity(s.path), s.identity);
  assert.deepEqual(identity(s.fieldOutput.path), s.fieldOutput.identity);
  s.lastVerifiedUnchangedUtc = new Date().toISOString();
}
function probe(file, label, frames = false) { return JSON.parse(command(ffprobe, ['-v', 'error', ...(frames ? ['-count_frames'] : []), '-show_format', '-show_streams', '-of', 'json', file], label).stdout); }
function gpu(label) { return command('nvidia-smi.exe', ['--query-gpu=name,driver_version,utilization.gpu,utilization.encoder', '--format=csv'], label).stdout.trim(); }
function packets(file, label, at, duration) {
  const argv = ['-v', 'error', '-select_streams', 'v:0', ...(at === undefined ? [] : ['-read_intervals', `${Math.max(0, at - 3)}%${at + duration + 1}`]), '-show_packets', '-show_entries', 'packet=pts_time,dts_time,duration_time,size,flags', '-of', 'json', file];
  const data = JSON.parse(command(ffprobe, argv, label).stdout).packets;
  const selected = at === undefined ? data : data.filter(p => Number(p.pts_time) >= at - 0.00001 && Number(p.pts_time) < at + duration - 0.00001);
  return { bytes: selected.reduce((n, p) => n + Number(p.size), 0), packetCount: selected.length, firstPts: Math.min(...selected.map(p => Number(p.pts_time))), lastPts: Math.max(...selected.map(p => Number(p.pts_time))), basis: 'Compressed primary-video packet payload; presentation-time-filtered, no container/audio overhead.' };
}
function still(file, label, frame) { command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-i', file, '-vf', `select=eq(n\\,${frame})`, '-frames:v', '1', path.join(run, `${label}.png`)], label); }
if (phase === 'discover') {
  report.hardware = gpu('hardware');
  const logPath = 'F:\\FFmpeg Station 1\\FFmpeg-Encoder-0.6.0-win32-x64\\data\\logs\\ca0be904-9149-422d-9312-424f0af875a1.json';
  const logBytes = fs.readFileSync(logPath); const log = JSON.parse(logBytes);
  report.fieldLog = { path: logPath, sha256: sha(logBytes), settings: log.settings };
  assert.deepEqual(log.settings, { profileId: 'h265-nvidia', preset: 'p7', quality: 32, recipeId: 'archive-quality-hevc-v1' });
  const names = ['2026-04-19 13-03-19.mkv', '2026-07-09 01-56-26.mkv', '2026-04-15 10-24-09.mkv', '2026-08-19 15-22-14.mkv', '2026-04-19 11-55-51.mkv'];
  for (const [n, name] of names.entries()) {
    if (report.sources.some(s => s.name === name)) continue;
    assert.notEqual(name, '2026-09-08 19-02-39.mkv');
    const item = log.items.find(i => i.name === name); assert.equal(item.status, 'success');
    const file = path.join('F:\\shadow play\\OBS', name); const generated = path.join(path.dirname(file), item.outputName);
    const s = { id: `source${n + 1}`, name, path: file, identity: identity(file), fieldOutput: { path: generated, identity: identity(generated) }, fieldLogItem: item };
    assert.ok(Date.now() - Number(s.identity.mtimeNs) / 1e6 > 86400000, 'Exclude new or potentially active recordings.');
    s.probe = probe(file, `${s.id}-probe`); s.fieldOutput.probe = probe(generated, `${s.id}-field-probe`);
    s.video = s.probe.streams.find(v => v.codec_type === 'video');
    assert.equal(s.video.color_transfer, 'bt709'); assert.equal(s.video.pix_fmt, 'yuv420p');
    s.duration = Number(s.probe.format.duration); s.fieldOutput.ratioToWholeOriginal = Number(s.fieldOutput.identity.size) / Number(s.identity.size);
    s.previews = [];
    if (n >= 2) for (const fraction of [0.15, 0.5, 0.8]) {
      const at = Math.floor(s.duration * fraction); const image = path.join(run, `${s.id}-${at}s.png`);
      command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-ss', String(at), '-i', file, '-frames:v', '1', '-vf', 'scale=960:-2', image], `${s.id}-${at}s-preview`);
      s.previews.push({ at, path: image });
    }
    checkSource(s); report.sources.push(s); save();
  }
} else if (['prepare', 'benchmark', 'converge29'].includes(phase)) {
  if (phase === 'converge29') {
    assert.ok(report.benchmarkCompletedUtc, 'Finish the initial CQ32/31/30 comparison before another CQ step.');
    report.cq29Justification = 'Track foliage CQ30 VMAF90.53 remains below x26594.25; CQ32 is87.29. Test only three difficult texture scenes (track foliage, grass/crates, flowers/foliage) to assess another bounded step. Metrics support visual review; no universal ratio or quality equivalence is assumed.';
  }
  const selections = JSON.parse(fs.readFileSync(path.join(run, 'selection.json')));
  assert.ok(selections.length >= 6 && selections.length <= 8);
  for (const selection of selections) {
    if (phase === 'converge29' && !['track-foliage', 'grass-crates', 'flowers-foliage'].includes(selection.id)) continue;
    assert.match(selection.id, /^[a-z0-9-]+$/); assert.ok(selection.durationSeconds <= 10);
    const s = report.sources.find(x => x.id === selection.sourceId); assert.ok(s); checkSource(s);
    let prepared = report.selections.find(x => x.id === selection.id);
    if (!prepared) {
      const historical = originalReport.cases.find(x => x.selection.id === selection.id && x.variant.id === 'x265-product-crf25');
      const referencePath = historical ? path.join(old, `${selection.id}-reference.mkv`) : path.join(run, `${selection.id}-reference.mkv`);
      if (!historical) command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-ss', String(selection.atSeconds), '-i', s.path, '-map', '0:v:0', '-t', String(selection.durationSeconds), '-an', '-sn', '-dn', '-c:v', 'ffv1', '-level', '3', '-g', '1', '-pix_fmt', '+yuv420p', '-fps_mode', 'passthrough', referencePath], `${selection.id}-reference`);
      const p = probe(referencePath, `${selection.id}-reference-probe`, true); const frames = Number(p.streams[0].nb_read_frames);
      assert.equal(frames, selection.durationSeconds * 60);
      prepared = { ...selection, referencePath, historicalReference: Boolean(historical), referenceSha256: sha(fs.readFileSync(referencePath)), frameCount: frames,
        originalPackets: packets(s.path, `${selection.id}-original-packets`, selection.atSeconds, selection.durationSeconds),
        fieldPackets: packets(s.fieldOutput.path, `${selection.id}-field-packets`, selection.atSeconds, selection.durationSeconds) };
      assert.equal(prepared.originalPackets.packetCount, frames); assert.equal(prepared.fieldPackets.packetCount, frames);
      assert.equal(prepared.originalPackets.firstPts, prepared.fieldPackets.firstPts);
      assert.equal(prepared.originalPackets.lastPts, prepared.fieldPackets.lastPts);
      const fieldClip = path.join(run, `${selection.id}-field-cq32.mkv`);
      command(ffmpeg, ['-hide_banner', '-nostdin', '-n', '-ss', String(selection.atSeconds), '-i', s.fieldOutput.path, '-map', '0:v:0', '-t', String(selection.durationSeconds), '-an', '-sn', '-dn', '-c:v', 'ffv1', '-level', '3', '-g', '1', '-pix_fmt', '+yuv420p', '-fps_mode', 'passthrough', fieldClip], `${selection.id}-field-clip`);
      const fp = probe(fieldClip, `${selection.id}-field-clip-probe`, true); assert.equal(Number(fp.streams[0].nb_read_frames), frames);
      prepared.fieldClipPath = fieldClip;
      for (const [kind, file] of [['reference', referencePath], ['field-cq32', fieldClip]]) still(file, `${selection.id}-${kind}-frame`, Math.floor(frames * 0.65));
      checkSource(s); report.selections.push(prepared); save();
    }
    if (phase === 'prepare') continue;
    for (const variant of phase === 'converge29' ? ['archive-cq29'] : ['x265-product-crf25', 'archive-cq32', 'archive-cq31', 'archive-cq30']) {
      const id = `${selection.id}-${variant}`; if (report.cases.some(x => x.id === id && x.complete)) continue;
      const historical = [...originalReport.cases, ...convergence.cases].find(x => x.id === id && x.complete);
      let out; let result;
      if (historical) {
        out = path.join(old, `${id}.mkv`); assert.equal(sha(fs.readFileSync(out)), historical.sha256);
        result = { ...historical, reusedHistorical: true, path: out };
      } else {
        out = path.join(run, `${id}.mkv`); const cq = Number(variant.slice(-2));
        const opts = variant.startsWith('x265') ? ['-c:v', 'libx265', '-preset', 'slow', '-crf', '25', '-x265-params', 'aq-mode=3:psy-rd=2'] : ['-c:v', 'hevc_nvenc', '-preset', 'p7', '-tune', 'uhq', '-multipass', 'fullres', '-rc', 'vbr', '-cq', String(cq), '-b:v', '0', '-bf', '4', '-b_ref_mode', 'each'];
        const beforeGpu = gpu(`${id}-gpu-before`);
        const encode = command(ffmpeg, ['-hide_banner', '-loglevel', 'verbose', '-nostdin', '-n', '-i', prepared.referencePath, '-map', '0:v:0', '-an', '-sn', '-dn', ...opts, '-pix_fmt', '+yuv420p', '-fps_mode', 'passthrough', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709', '-color_range', 'tv', out], `${id}-encode`);
        assert.ok(!/not supported|unsupported|ignoring|has not been used/i.test(encode.stderr));
        if (!variant.startsWith('x265')) assert.ok(encode.stderr.includes(`CQ(${cq * 256}) mode enabled.`));
        const p = probe(out, `${id}-probe`, true); const v = p.streams[0];
        assert.equal(Number(v.nb_read_frames), prepared.frameCount);
        for (const k of ['width', 'height', 'pix_fmt', 'color_transfer', 'color_primaries', 'color_space', 'color_range']) assert.equal(v[k], s.video[k]);
        command(ffmpeg, ['-hide_banner', '-v', 'error', '-xerror', '-nostdin', '-i', out, '-map', '0:v:0', '-f', 'null', '-'], `${id}-decode`);
        command(ffmpeg, ['-hide_banner', '-nostdin', '-i', out, '-i', prepared.referencePath, '-filter_complex', `[0:v]settb=AVTB,setpts=PTS-STARTPTS[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS[r];[d][r]libvmaf=log_fmt=json:log_path=${id}-vmaf.json:n_threads=6`, '-an', '-f', 'null', '-'], `${id}-vmaf`);
        const vmaf = JSON.parse(fs.readFileSync(path.join(run, `${id}-vmaf.json`))); assert.equal(vmaf.frames.length, prepared.frameCount);
        const scores = vmaf.frames.map(x => x.metrics.vmaf).sort((a, b) => a - b);
        const ssim = command(ffmpeg, ['-hide_banner', '-nostdin', '-i', out, '-i', prepared.referencePath, '-lavfi', '[0:v]settb=AVTB,setpts=PTS-STARTPTS[d];[1:v]settb=AVTB,setpts=PTS-STARTPTS[r];[d][r]ssim', '-an', '-f', 'null', '-'], `${id}-ssim`);
        result = { id, sourceId: s.id, selection, variant, path: out, reusedHistorical: false, encodeSeconds: encode.record.seconds, durationSeconds: selection.durationSeconds, frameCount: prepared.frameCount, bytes: fs.statSync(out).size, sha256: sha(fs.readFileSync(out)), argv: encode.record.argv, beforeGpu,
          vmafMean: vmaf.pooled_metrics.vmaf.mean, vmafP5: scores[Math.floor(scores.length * 0.05)], ssimAll: Number(ssim.stderr.match(/All:([0-9.]+)/)?.[1]), probe: p, complete: true };
      }
      result.outputPackets = packets(out, `${id}-packets`);
      result.videoPayloadRatioToOriginal = result.outputPackets.bytes / prepared.originalPackets.bytes;
      result.containerBytesRatioToOriginalVideoPayload = result.bytes / prepared.originalPackets.bytes;
      still(out, `${id}-frame`, Math.floor(prepared.frameCount * 0.65));
      report.cases.push(result); save();
    }
    checkSource(s);
  }
  report[`${phase}CompletedUtc`] = new Date().toISOString(); save();
} else throw new Error('Use discover, prepare, benchmark or converge29.');
save(); console.log(`Evidence: ${run}`);
