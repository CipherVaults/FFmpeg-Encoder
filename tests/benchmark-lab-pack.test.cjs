'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../scripts/benchmark-lab-core.cjs');
const lab = require('../scripts/benchmark-lab-config.cjs');
const { generateReview } = require('../scripts/benchmark-lab-pack.cjs');

test('review bundle resumes without re-encoding, rejects tampering and cannot admit held-outs', async t => {
  const root = path.resolve(__dirname, '../artifacts');
  const directory = fs.mkdtempSync(path.join(root, 'benchmark-pack-test-'));
  t.after(() => { assert.equal(path.dirname(directory), root); fs.rmSync(directory, { recursive: true }); });
  const source = { id: 'cd', sourceId: 'source-test', stagedPath: 'staged.mp4',
    video: { width: 3, height: 2, pix_fmt: 'yuv420p', color_space: 'bt709', color_range: 'tv' } };
  const frameTrace = { frames: Array.from({ length: 6 }, (_, index) => ({ hash: `pixel-${index}` })) };
  const window = { id: 'cd-b', sourceId: 'cd', windowId: 'window-test', role: 'b', start: 95, end: 107,
    frameCount: 6, selectionValidated: true, frameHashPath: path.join(directory, 'trace.json') };
  fs.writeFileSync(window.frameHashPath, JSON.stringify({ frameTrace }));
  const configurations = [lab.configuration('x265', 25), lab.configuration('av1-ordinary', 32)];
  const cases = [];
  for (const [index, config] of configurations.entries()) {
    const file = path.join(directory, `case-${index}.mkv`); fs.writeFileSync(file, `case-${index}`);
    cases.push({ runId: `run-${index}`, window: 'cd-b', configurationHash: core.configurationId(config), config,
      status: 'complete', stage: 'coarse', validity: { valid: true }, timingValidity: { valid: true },
      argv: ['verified', file], output: { path: file, sha256: await core.sha256File(file) } });
  }
  const state = { baseline: 'baseline', runtime: {}, generalizationEvidence: Array(23).fill('verified'),
    windows: [window], cases, commands: [], humanReview: {} };
  const api = { state, campaign: directory, ffmpeg: 'fake-ffmpeg', source: () => source,
    guard: async () => {}, checkSource: () => {}, save: () => {}, outputValidation: async () => ({ valid: true }),
    parseFrameHash: JSON.parse, supportCount: () => state.supportInvocations || 0, supportMaximum: () => 24,
    command: async (executable, argv, label, options = {}) => {
      const record = { sequence: state.commands.length + 1, executable, argv, role: options.role || 'analysis', status: 'success', code: 0 };
      state.commands.push(record);
      if (label.endsWith('-lossless')) {
        assert.equal(options.trackedOutput, argv.at(-1), 'Live growth fence must track lossless review output.');
        fs.writeFileSync(argv.at(-1), 'lossless-fixture', { flag: 'wx' });
      }
      if (label.endsWith('-stills')) for (let index = 0; index < 3; index++) {
        const png = Buffer.alloc(24); Buffer.from('89504e470d0a1a0a', 'hex').copy(png); png.writeUInt32BE(3, 16); png.writeUInt32BE(2, 20);
        fs.writeFileSync(argv.at(-1).replace('%d', index), png, { flag: 'wx' });
      }
      return { record, stdout: JSON.stringify(frameTrace) };
    } };
  const allocation = [{ sourceId: 'cd', role: 'b', title: 'Difficult scene', context: 'Calibration only', configurations }];
  await assert.rejects(() => generateReview(api, [{ ...allocation[0], role: 'holdout' }]));
  assert.equal(state.reviewBundle, undefined);
  const bundle = await generateReview(api, allocation);
  assert.equal(bundle.status, 'complete'); assert.equal(state.supportInvocations, 1);
  assert.equal(state.humanReview.status, 'awaiting-calibration-judgment');
  const count = state.commands.length;
  state.humanReview = { status: 'preparing' }; // Crash after complete-bundle save, before gate save.
  await generateReview(api, allocation); assert.equal(state.commands.length, count, 'Finalized resume launched more work.');
  assert.equal(state.humanReview.status, 'awaiting-calibration-judgment');
  assert.equal(state.humanReview.bundlePath, bundle.directory);
  const image = bundle.files.find(f => f.path.endsWith('.png'));
  fs.appendFileSync(path.join(bundle.directory, image.path), 'changed');
  await assert.rejects(() => generateReview(api, allocation)); assert.equal(state.commands.length, count);
});
