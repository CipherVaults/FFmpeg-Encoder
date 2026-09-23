'use strict';

// Bounded diagnosis of the two explicitly supplied phone recordings. Sources and
// historical logs are read only; every command destination is a new artifact.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { runTool } = require('../src/process-runner.cjs');
const { inspectInput, inspectMetadata, validateOutput } = require('../src/inspection.cjs');
const { buildEncodeArgs, selectVideo, mappedStreams } = require('../src/media.cjs');
const { readSourceIdentity, sameIdentity } = require('../src/source-identity.cjs');

const root = path.resolve(__dirname, '..');
const artifacts = path.join(root, 'artifacts', `phone-metadata-field-${Date.now()}-${randomUUID().slice(0, 8)}`);
const ffmpeg = path.join(root, 'ffmpeg', 'ffmpeg.exe');
const ffprobe = path.join(root, 'ffmpeg', 'ffprobe.exe');
const names = ['Screen_Recording_20260502_014538_Azahar.mp4', 'Screen_Recording_20260502_021156_YouTube.mp4'];
// Supply a prior report to reuse its owned fixtures after a policy correction.
// This preserves the failing native evidence and avoids repeating diagnosis.
const reuseReportPath = process.argv[2] ? path.resolve(process.argv[2]) : null;
const report = { status: 'running', artifacts, started: new Date().toISOString(), cases: [], commands: [], historical: [], limits: [
  'Only the two explicitly supplied originals and the two known portable batch logs are read. Originals are never command destinations.',
  'The historical JSON logs contain final summaries/reasons, not full ffprobe JSON, argv, stderr or failed temporary output. New evidence reproduces the recorded failure; it cannot reconstruct unavailable historical bytes.',
  'Three-second stream-copy MP4 fixtures preserve the source stream tag dictionaries explicitly; their duration and global MP4 muxer metadata differ from the originals. A direct three-second original-to-Matroska remux separately checks the original global tags.',
  'Source unchanged checks use the production sparse identity, not a full-file digest or filesystem writer lock.',
  'This is exact native production-builder/inspection validation evidence, not a packaged UI acceptance run or a full-duration encode.',
] };
report.reference = { url: 'https://www.ffmpeg.org/doxygen/trunk/matroskaenc_8c_source.html', explanation: 'mkv_check_tag_name excludes creation_time from SimpleTags. mkv_write_info separately stores the global creation_time as DateUTC. The pinned local runtime is the behavioral evidence; current upstream source is corroboration.' };
const save = () => fs.writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2));
async function invoke(label, executable, argv) {
  const entry = { label, executable, argv, started: new Date().toISOString() }; report.commands.push(entry); await save();
  try {
    const result = await runTool(executable, argv, { timeoutMs: 180000, stdoutLimit: 24 * 1024 * 1024 });
    Object.assign(entry, { exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr });
    return result;
  } catch (error) {
    Object.assign(entry, { error: { code: error.code, message: error.message, stderr: error.stderr } }); throw error;
  } finally { entry.finished = new Date().toISOString(); await save(); }
}
async function probe(file, label) {
  const result = await invoke(label, ffprobe, ['-v', 'error', '-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi', '-show_streams', '-show_format', '-show_chapters', '-show_data_hash', 'sha256', '-of', 'json', '-i', file]);
  const filename = path.join(artifacts, `${label}.ffprobe.json`); await fs.writeFile(filename, result.stdout);
  assert.equal(result.stderr, ''); return JSON.parse(result.stdout);
}
async function audioPacketHashes(file, label) {
  const result = await invoke(label, ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_packets', '-show_data_hash', 'sha256', '-show_entries', 'packet=data_hash', '-of', 'json', '-i', file]);
  assert.equal(result.stderr, ''); return JSON.parse(result.stdout).packets.map(packet => packet.data_hash);
}
async function main() {
  await fs.mkdir(artifacts, { recursive: true });
  try {
    report.sourceHashes = {};
    for (const file of ['src/inspection.cjs', 'src/media.cjs', 'scripts/phone-metadata-field.cjs']) report.sourceHashes[file] = createHash('sha256').update(await fs.readFile(path.join(root, file))).digest('hex');
    report.runtime = await invoke('runtime-version', ffmpeg, ['-version']);
    for (const log of ['ca0be904-9149-422d-9312-424f0af875a1.json', '147b3470-ba62-48bd-96dd-2afe126d911f.json']) {
      const file = path.join('F:\\FFmpeg Station 1\\FFmpeg-Encoder-0.6.0-win32-x64\\data\\logs', log);
      const text = await fs.readFile(file, 'utf8'); const json = JSON.parse(text);
      report.historical.push({ file, sha256: createHash('sha256').update(text).digest('hex'), settings: json.settings, items: json.items.filter(item => names.includes(item.name)), availableTopLevelKeys: Object.keys(json) });
    }
    const previous = reuseReportPath ? JSON.parse(await fs.readFile(reuseReportPath, 'utf8')) : null;
    report.reusedEvidence = reuseReportPath;
    for (const [index, name] of names.entries()) {
      const input = path.join('F:\\shadow play\\OBS', name);
      const entry = { input, identityBefore: await readSourceIdentity(input) }; report.cases.push(entry); await save();
      const prior = previous?.cases.find(item => item.input === input);
      let fixture;
      if (prior) {
        assert.equal(sameIdentity(prior.identityAfter, entry.identityBefore), true, 'Original identity changed since the saved reproduction.');
        fixture = path.resolve(prior.fixture);
        assert.ok(fixture.startsWith(path.join(root, 'artifacts') + path.sep), 'Reused fixture must belong to repository artifacts.');
        Object.assign(entry, { originalProbe: prior.originalProbe, fixtureProbe: prior.fixtureProbe, fixture, fixtureGlobalMetadataDifference: prior.fixtureGlobalMetadataDifference, directRemuxProbe: prior.directRemuxProbe, reproducedFailure: prior.validation });
      } else {
        entry.originalProbe = await probe(input, `phone-${index}-original`);
        fixture = path.join(artifacts, `phone-${index}-three-seconds.mp4`); entry.fixture = fixture;
        const args = ['-hide_banner', '-nostdin', '-v', 'warning', '-n', '-i', input, '-t', '3', '-map', '0', '-map_metadata', '0', '-map_chapters', '0', '-c', 'copy'];
        for (const stream of entry.originalProbe.streams) {
          args.push(`-map_metadata:s:${stream.index}`, `0:s:${stream.index}`);
          for (const [key, value] of Object.entries(stream.tags || {})) args.push(`-metadata:s:${stream.index}`, `${key}=${value}`);
        }
        args.push(fixture);
        await invoke(`phone-${index}-extract`, ffmpeg, args);
        entry.fixtureProbe = await probe(fixture, `phone-${index}-fixture`);
        for (const source of entry.originalProbe.streams) for (const [key, value] of Object.entries(source.tags || {})) assert.equal(entry.fixtureProbe.streams[source.index].tags[key], value, `${name}: fixture ${source.index} ${key}`);
        entry.fixtureGlobalMetadataDifference = { original: entry.originalProbe.format.tags, fixture: entry.fixtureProbe.format.tags };
        const directOutput = path.join(artifacts, `phone-${index}-direct-original-remux.mkv`);
        await invoke(`phone-${index}-direct-original-remux`, ffmpeg, ['-hide_banner', '-nostdin', '-v', 'warning', '-n', '-i', input, '-t', '3', '-map', '0:1', '-map', '0:0', '-c', 'copy', '-map_metadata', '0', '-map_metadata:s:0', '0:s:1', '-map_metadata:s:1', '0:s:0', directOutput]);
        entry.directRemuxProbe = await probe(directOutput, `phone-${index}-direct-remux`);
      }
      const inspection = await inspectInput(fixture, { ffprobe }); entry.inspection = inspection;
      assert.equal(inspection.color.supported, true);
      entry.streamMap = mappedStreams(inspection.probe, selectVideo(inspection.probe)).map((stream, outputIndex) => ({ inputIndex: stream.index, outputIndex, type: stream.codec_type, codec: stream.codec_name }));
      const settings = { profileId: 'h265-nvidia', preset: 'p7', quality: 32, recipeId: 'archive-quality-hevc-v1' };
      const output = path.join(artifacts, `phone-${index}-production.mkv`); entry.output = output; entry.settings = settings;
      const encodeArgs = buildEncodeArgs({ input: fixture, output, settings, probe: inspection.probe, colorEvidence: inspection.color });
      await invoke(`phone-${index}-production-encode`, ffmpeg, encodeArgs);
      entry.outputProbe = await probe(output, `phone-${index}-output`);
      entry.validation = validateOutput(inspection, await inspectMetadata(output, { ffprobe }), settings);
      assert.equal(entry.validation.valid, true, JSON.stringify(entry.validation));
      for (const map of entry.streamMap) {
        assert.equal(entry.outputProbe.streams[map.outputIndex].tags.SOURCE_CREATION_TIME, inspection.probe.streams.find(stream => stream.index === map.inputIndex).tags.creation_time);
      }
      await invoke(`phone-${index}-decode`, ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-xerror', '-i', output, '-map', '0:v:0', '-map', '0:a?', '-f', 'null', '-']);
      entry.audioPackets = { source: await audioPacketHashes(fixture, `phone-${index}-source-audio-packets`), output: await audioPacketHashes(output, `phone-${index}-output-audio-packets`) };
      assert.deepEqual(entry.audioPackets.output, entry.audioPackets.source, 'Copied AAC payload changed.');
      entry.identityAfter = await readSourceIdentity(input); entry.sourceUnchanged = sameIdentity(entry.identityBefore, entry.identityAfter); assert.equal(entry.sourceUnchanged, true);
      await save();
    }
    const first = report.cases[0];
    const reinspection = await inspectInput(first.output, { ffprobe });
    assert.deepEqual(reinspection.summary.metadataNotices, []);
    const reoutput = path.join(artifacts, 'phone-0-reencoded.mkv');
    const reargs = buildEncodeArgs({ input: first.output, output: reoutput, settings: first.settings, probe: reinspection.probe, colorEvidence: reinspection.color });
    await invoke('phone-0-reencode-existing-alias', ffmpeg, reargs);
    const reprobe = await probe(reoutput, 'phone-0-reencoded');
    const revalidation = validateOutput(reinspection, reprobe, first.settings);
    assert.equal(revalidation.valid, true, JSON.stringify(revalidation));
    for (const [index, stream] of first.outputProbe.streams.entries()) assert.equal(reprobe.streams[index].tags.SOURCE_CREATION_TIME, stream.tags.SOURCE_CREATION_TIME);
    report.reencode = { input: first.output, output: reoutput, validation: revalidation, outputProbe: reprobe, metadataNotices: reinspection.summary.metadataNotices };
    report.status = 'complete';
  } catch (error) { report.status = 'failed'; report.error = { message: error.message, stack: error.stack }; throw error; }
  finally { await save(); console.log(JSON.stringify({ status: report.status, report: path.join(artifacts, 'report.json'), results: report.cases.map(entry => ({ input: entry.input, validation: entry.validation })) })); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
