'use strict';
// Headless diagnosis: the committed EncoderService with the qualified 9.1 engine, the smoke's
// synthetic fixture and settings, in a fresh folder under release scratch. Prints every item.
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const [src, engine, work, profileId = 'h264-cpu', preset = 'veryfast', quality = '23'] = process.argv.slice(2);
(async () => {
  if (!/ffenc-release-work-[0-9a-f]{12}/.test(work)) throw Error('scratch only');
  await fs.mkdir(work);
  for (const d of ['input', 'output', 'state']) await fs.mkdir(path.join(work, d));
  const ffmpeg = path.join(engine, 'ffmpeg.exe'), ffprobe = path.join(engine, 'ffprobe.exe');
  const a = path.join(work, 'input', 'Fixture A.mp4');
  execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
    'testsrc2=size=320x180:rate=24:duration=2,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
    '-f', 'lavfi', '-i', 'sine=sample_rate=48000:duration=2', '-c:v', 'libx264', '-preset', 'ultrafast',
    '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', '-n', a]);
  // A Matroska source carrying every other key family FFmpeg 9.1 drops on re-encode (stream copy keeps them).
  execFileSync(ffmpeg, ['-nostdin', '-v', 'error', '-i', a, '-map', '0', '-c', 'copy',
    '-metadata', 'encoded_by=Fixture encoder', '-metadata', 'encoding_tool=Fixture tool', '-metadata', 'iTunNORM=00000001',
    '-metadata:s:v:0', 'BPS=123456', '-metadata:s:v:0', 'DURATION=00:00:02.000000000', '-metadata:s:v:0', 'NUMBER_OF_FRAMES=48',
    '-metadata:s:v:0', 'NUMBER_OF_BYTES=1000', '-metadata:s:v:0', 'vendor_id=FXTR', '-metadata:s:a:0', 'iTunSMPB=fixture',
    '-metadata:s:a:0', 'BPS-eng=64000', '-n', path.join(work, 'input', 'Fixture B.mkv')]);
  const { EncoderService } = require(path.join(src, 'src', 'encoder-service.cjs'));
  const service = new EncoderService({ ffmpeg, ffprobe, stateDir: path.join(work, 'state') });
  const i = await service.registerFolder(path.join(work, 'input'), 'input');
  const o = await service.registerFolder(path.join(work, 'output'), 'output');
  const caps = await service.getCapabilities();
  console.log('profiles', JSON.stringify(caps.profiles.map(p => [p.id, p.available, p.reason || ''])));
  await service.prepareBatch({ inputFolderId: i.id, outputFolderId: o.id, settings: { profileId, preset, quality: Number(quality) } });
  await service.taskPromise;
  let s = service.snapshot();
  console.log('prepared', s.phase, JSON.stringify(s.items.map(x => [x.name, x.status, x.reason])));
  if (s.phase !== 'ready') { console.log(JSON.stringify(s.error)); return; }
  service.startBatch({ planId: s.planId, fileIds: s.items.filter(x => x.status === 'ready').map(x => x.id) });
  await service.taskPromise;
  s = service.snapshot();
  console.log('finished', s.phase, JSON.stringify(s.counts), JSON.stringify(s.error));
  for (const x of s.items) console.log(JSON.stringify({ name: x.name, status: x.status, reason: x.reason, details: x.details }, null, 1));
})().catch(e => { console.error('REPRO ERROR', e.code, e.message); process.exitCode = 1; });
