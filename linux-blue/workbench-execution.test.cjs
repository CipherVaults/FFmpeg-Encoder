'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { LinuxWorkbenchService } = require('./workbench-service.cjs');
const { PROFILES } = require('../src/media.cjs');

test('missing source completion is deterministic when the test keeps the deleted inode owned', async t => {
  const parent = path.join(__dirname, 'artifacts'); await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'held-source-regression-'));
  const input = path.join(root, 'input'), output = path.join(root, 'output'), stateDir = path.join(root, 'state');
  for (const folder of [input, output, stateDir]) await fs.mkdir(folder);
  const source = path.join(input, 'synthetic.mkv'); await fs.writeFile(source, 'original synthetic test bytes');
  // Unlink may immediately free an inode on Linux. Keep this fixture's descriptor
  // open until its replacement output exists, so the intended missing-path test
  // cannot accidentally turn into a protected-inode-reuse test.
  const held = await fs.open(source, 'r'), original = await held.stat({ bigint: true });
  let encoded, tags = {};
  const video = { index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 320, height: 180,
    color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', color_range: 'tv', disposition: { default: 1 } };
  const service = new LinuxWorkbenchService({ ffmpeg: 'fake-ffmpeg', ffprobe: 'fake-ffprobe', stateDir,
    capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile, available: profile.hardware === 'CPU', supportedBitDepths: [8, 10] })), versions: {} }),
    inspect: async () => ({ probe: { streams: [video] }, color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: 0, reasons: [] },
      duration: 0.4, summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 } }),
    verify: () => ({ valid: true, errors: [] }),
    run: async (binary, args) => {
      if (binary === 'fake-ffprobe') return { stdout: JSON.stringify({ format: { tags } }), stderr: '', exitCode: 0 };
      encoded = args.at(-1);
      tags = Object.fromEntries(args.flatMap((arg, i) => {
        if (arg !== '-metadata') return [];
        const value = args[i + 1], split = value.indexOf('='); return [[value.slice(0, split), value.slice(split + 1)]];
      }));
      await fs.unlink(source); await fs.writeFile(encoded, 'completed synthetic test bytes');
      return { exitCode: 0, stdout: '', stderr: '' };
    } });
  t.after(async () => { service.closeAdmission(); await service.cancelCurrent(); await held.close(); await service.closeDiagnostics('completed'); });
  const inFolder = await service.registerFolder(input, 'input'), outFolder = await service.registerFolder(output, 'output');
  const profile = PROFILES.find(row => row.id === 'h264-cpu');
  const plan = await service.prepareBatch({ inputFolderId: inFolder.id, outputFolderId: outFolder.id,
    settings: { profileId: profile.id, preset: profile.defaultPreset, quality: profile.quality.default } });
  assert.equal(plan.items[0].status, 'ready', plan.items[0].reason);
  service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }); await service.taskPromise;
  const item = service.snapshot().items[0], completed = await fs.stat(encoded, { bigint: true });
  assert.notEqual(`${completed.dev}:${completed.ino}`, `${original.dev}:${original.ino}`);
  assert.equal((await held.stat()).nlink, 0);
  assert.equal(item.status, 'failed'); assert.equal(item.reasonCode, 'SOURCE_CHECK_INCOMPLETE');
  assert.equal(item.sourceAssessment.kind, 'incomplete'); assert.equal(item.sourceIdentityDiagnostic.readFailure, 'ENOENT');
  assert.equal(item.outputDisposition.kind, 'retained-completed');
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'completed synthetic test bytes');
  await assert.rejects(fs.stat(path.join(output, plan.items[0].outputName)), { code: 'ENOENT' });
});
