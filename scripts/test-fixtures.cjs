const fs = require('node:fs/promises');
const path = require('node:path');
const { runTool } = require('../src/process-runner.cjs');

// Generated media keeps endpoint verification reproducible without user videos
// or an ignored artifact from an earlier development session.
async function createRichFixture(ffmpeg, directory, destination) {
  await fs.mkdir(directory, { recursive: true });
  const captions = path.join(directory, 'rich-captions.srt');
  const metadata = path.join(directory, 'rich-chapters.ffmeta');
  const attachment = path.join(directory, 'rich-attachment.txt');
  await fs.writeFile(captions, '1\n00:00:00,000 --> 00:00:05,000\nFirst preserved caption\n\n2\n00:00:06,000 --> 00:00:11,000\nSecond preserved caption\n');
  await fs.writeFile(metadata, ';FFMETADATA1\ntitle=Rich preservation fixture\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=0\nEND=6000\ntitle=First chapter\n[CHAPTER]\nTIMEBASE=1/1000\nSTART=6000\nEND=12000\ntitle=Second chapter\n');
  await fs.writeFile(attachment, 'Controlled attachment: preserve these exact bytes.\n');
  await runTool(ffmpeg, ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=160x90:rate=10:duration=12,setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=limited',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=12', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=12',
    '-i', captions, '-f', 'ffmetadata', '-i', metadata,
    '-map', '0:v', '-map', '1:a', '-map', '2:a', '-map', '3:s', '-map_metadata', '4', '-map_chapters', '4',
    '-c:v', 'ffv1', '-pix_fmt', 'yuv420p', '-c:a:0', 'aac', '-c:a:1', 'flac', '-c:s', 'copy',
    '-metadata:s:v:0', 'title=Primary video', '-metadata:s:a:0', 'language=eng', '-metadata:s:a:0', 'title=Main audio',
    '-metadata:s:a:1', 'language=ara', '-metadata:s:a:1', 'title=Commentary', '-metadata:s:s:0', 'language=eng', '-metadata:s:s:0', 'title=Forced captions',
    '-disposition:a:0', 'default', '-disposition:a:1', 'comment', '-disposition:s:0', 'forced',
    '-attach', attachment, '-metadata:s:t:0', 'filename=preserved-note.txt', '-metadata:s:t:0', 'mimetype=text/plain',
    '-default_mode', 'passthrough', '-n', destination]);
}

module.exports = { createRichFixture };
