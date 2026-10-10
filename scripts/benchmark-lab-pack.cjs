'use strict';

// Review material is derived from verified calibration outputs only. It does
// not choose finalists, inspect held-outs, or alter a production recipe.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const core = require('./benchmark-lab-core.cjs');
const presentation = require('./benchmark-lab-review.cjs');
const assets = require('./benchmark-lab-review-assets.cjs');
const guide = require('./benchmark-lab-review-guide.cjs');

async function generateReview(api, allocation) {
  const { state, campaign, ffmpeg, command, source, guard, checkSource, save, outputValidation, parseFrameHash } = api;
  assert.equal(state.generalizationEvidence?.length, 23);
  assert.ok(allocation.length && allocation.every(group => ['a', 'b'].includes(group.role)));
  const allocationHash = core.configurationId(allocation);
  if (!state.reviewBundle) {
    const directory = path.join(campaign, `calibration-review-${crypto.randomUUID()}`);
    fs.mkdirSync(directory);
    state.reviewBundle = { directory, allocation, allocationHash, seed: crypto.randomUUID(), groups: [], supports: [], status: 'preparing' }; save();
  }
  const bundle = state.reviewBundle;
  assert.equal(bundle.allocationHash, allocationHash, 'A retained blind allocation cannot silently change.');
  if (bundle.status === 'complete') {
    for (const entry of bundle.files) assert.equal(await core.sha256File(path.join(bundle.directory, entry.path)), entry.sha256);
    state.humanReview = { ...state.humanReview, status: 'awaiting-calibration-judgment', bundlePath: bundle.directory, finalists: null }; save();
    return bundle;
  }
  const reveal = [];
  const files = [];
  for (const specification of allocation) {
    const window = state.windows.find(w => w.id === `${specification.sourceId}-${specification.role}`);
    assert.ok(window && window.selectionValidated && window.role !== 'holdout');
    const s = source(specification.sourceId); checkSource(s);
    const groupId = window.id;
    let support = bundle.supports.find(x => x.windowId === window.windowId && x.status === 'complete');
    if (support) {
      assert.equal(await core.sha256File(support.path), support.sha256);
    } else {
      // Recovery reuses a known zero-exit encode, never an unclosed/playable
      // partial file. Other attempts are retained and a new owned path is used.
      support = [...bundle.supports].reverse().find(x => x.windowId === window.windowId
        && state.commands.some(c => c.sequence === x.commandSequence && c.role === 'encode' && c.executable === ffmpeg
          && c.status === 'success' && c.code === 0 && core.canonicalJson(c.argv) === core.canonicalJson(x.argv)));
      if (!support) {
        await guard(s.video.width * s.video.height * 1.5 * window.frameCount);
        assert.ok(api.supportCount() < api.supportMaximum(), 'Review source clips cannot silently exhaust support allowance.');
        const directory = path.join(bundle.directory, `source-${groupId}-${crypto.randomUUID()}`);
        fs.mkdirSync(directory);
        support = { windowId: window.windowId, sourceId: s.sourceId, path: path.join(directory, 'source.mkv'), status: 'running' };
        support.argv = assets.supportArgs(s, window, support.path);
        support.commandSequence = state.commands.length + 1;
        bundle.supports.push(support); state.supportInvocations = (state.supportInvocations || 0) + 1; save();
        const result = await command(ffmpeg, support.argv, `review-${groupId}-lossless`,
          { role: 'encode', timeoutMs: 300000, trackedOutput: support.path });
        support.commandSequence = result.record.sequence; save();
      }
      support.validity = await outputValidation(support.path, s, window, `review-${groupId}-source`, { losslessReview: true });
      const hashes = await command(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-i', support.path,
        '-map', '0:v:0', '-an', '-pix_fmt', '+yuv420p', '-fps_mode', 'passthrough', '-enc_time_base', 'demux', '-f', 'framemd5', '-'],
      `review-${groupId}-source-hashes`);
      const decoded = parseFrameHash(hashes.stdout);
      const expected = JSON.parse(fs.readFileSync(window.frameHashPath)).frameTrace;
      assert.deepEqual(decoded.frames.map(f => f.hash), expected.frames.map(f => f.hash), 'Source review clip changed decoded pixels/order.');
      support.sha256 = await core.sha256File(support.path); support.hashCommandSequence = hashes.record.sequence;
      support.status = 'complete'; save();
    }
    const selected = specification.configurations.map(config => {
      const configurationHash = core.configurationId(config);
      const record = [...state.cases].reverse().find(c => c.window === window.id && c.configurationHash === configurationHash
        && c.status === 'complete' && c.validity?.valid && c.timingValidity?.valid);
      assert.ok(record && record.stage !== 'warmup' && record.output?.sha256, `Unverified calibration asset ${window.id} ${config.familyId}`);
      return record;
    });
    assert.ok(selected.some(c => c.config.familyId === 'x265'));
    const candidates = selected.filter(c => c.config.familyId !== 'x265');
    const ordered = presentation.randomizedOrder(candidates.map(c => ({ id: c.runId, record: c })), bundle.seed, groupId);
    const entries = [{ id: `source-${window.windowId}`, label: 'Captured source', path: support.path, sha256: support.sha256 },
      ...selected.filter(c => c.config.familyId === 'x265').map(c => ({ id: c.runId, label: 'x265 reference', record: c,
        path: c.output.path, sha256: c.output.sha256 })),
      ...ordered.map((c, index) => ({ ...c, label: `Candidate ${String.fromCharCode(65 + index)}`,
        path: c.record.output.path, sha256: c.record.output.sha256 }))];
    const group = { id: groupId, title: specification.title, context: specification.context,
      width: s.video.width, height: s.video.height, frameIndices: assets.frameIndices(window.frameCount), entries: [] };
    for (const entry of entries) {
      const identity = crypto.createHash('sha256').update(`${bundle.seed}:${groupId}:${entry.id}`).digest('hex').slice(0, 16);
      const previous = bundle.groups.find(g => g.id === groupId)?.entries.find(e => e.identity === identity);
      if (previous) {
        for (const file of previous.files) assert.equal(await core.sha256File(path.join(bundle.directory, file.path)), file.sha256);
        group.entries.push(previous); files.push(...previous.files);
      } else {
        assert.equal(await core.sha256File(entry.path), entry.sha256);
        await guard((entry.record ? fs.statSync(entry.path).size : 0) + s.video.width * s.video.height * 4 * group.frameIndices.length);
        const directory = path.join(bundle.directory, `view-${identity}-${crypto.randomUUID()}`); fs.mkdirSync(directory);
        // The lossless source is already owned inside this bundle; avoid a
        // second multi-GiB copy. Candidate originals stay immutable in runs,
        // and receive independent opaque review copies rather than hard links.
        const clip = entry.record ? path.join(directory, 'motion.mkv') : entry.path;
        if (entry.record) await fsp.copyFile(entry.path, clip, fs.constants.COPYFILE_EXCL);
        assert.equal(await core.sha256File(clip), entry.sha256);
        const still = await command(ffmpeg, assets.stillArgs(clip, group.frameIndices, path.join(directory, 'frame-%d.png')),
          `review-${groupId}-${identity}-stills`);
        const relative = file => path.relative(bundle.directory, file).replaceAll('\\', '/');
        const images = group.frameIndices.map((_, index) => path.join(directory, `frame-${index}.png`));
        assert.equal(fs.readdirSync(directory).filter(name => /^frame-\d+\.png$/.test(name)).length, images.length);
        const assetFiles = [{ path: relative(clip), sha256: entry.sha256, bytes: fs.statSync(clip).size }];
        for (const file of images) {
          const header = Buffer.alloc(24); const handle = await fsp.open(file, 'r');
          try { await handle.read(header, 0, 24, 0); } finally { await handle.close(); }
          assert.equal(header.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
          assert.equal(header.readUInt32BE(16), s.video.width); assert.equal(header.readUInt32BE(20), s.video.height);
          assetFiles.push({ path: relative(file), sha256: await core.sha256File(file), bytes: fs.statSync(file).size });
        }
        const displayed = { identity, label: entry.label, clip: relative(clip), images: images.map(relative), files: assetFiles,
          stillCommandSequence: still.record.sequence };
        group.entries.push(displayed); files.push(...assetFiles);
        // Save incrementally so a later interruption reuses completed assets.
        const saved = bundle.groups.find(g => g.id === groupId);
        if (saved) saved.entries.push(displayed); else bundle.groups.push({ ...group, entries: [displayed] });
        save();
      }
      reveal.push({ group: groupId, label: entry.label, identity, sourceId: s.sourceId, windowId: window.windowId,
        runId: entry.record?.runId || null, configuration: entry.record?.config || 'Decoded captured source, lossless FFV1 review copy',
        argv: entry.record?.argv || support.argv, sourceEvidence: entry.path, sha256: entry.sha256 });
    }
    const index = bundle.groups.findIndex(g => g.id === groupId); bundle.groups[index] = group; save(); checkSource(s);
  }
  const page = { groups: bundle.groups.map(g => ({ ...g, entries: g.entries.map(({ label, clip, images }) => ({ label, clip, images })) })) };
  const write = async (name, value) => {
    const file = path.join(bundle.directory, name);
    if (fs.existsSync(file)) assert.equal(await fsp.readFile(file, 'utf8'), value, 'A partially finalized review file differs; preserve it for investigation.');
    else await fsp.writeFile(file, value, { flag: 'wx' });
    files.push({ path: name, sha256: await core.sha256File(file), bytes: fs.statSync(file).size });
  };
  // A new finalized directory is append-only; failures retain all partials.
  await write('index.html', presentation.reviewHtml(page));
  for (const file of guide.companions(bundle.groups)) await write(file.name, file.text);
  await write('reveal-key.json', JSON.stringify({ seed: bundle.seed, allocationHash, entries: reveal }, null, 2));
  await write('review-manifest.json', JSON.stringify({ baseline: state.baseline, sourceWindows: allocation,
    runtime: state.runtime, files, sourceSupportEvidence: bundle.supports,
    caveats: ['Source is compressed AV1, not lossless ground truth.', 'Known source/x265 anchors, candidates randomized independently per scene.',
      'Player properties can reveal codec; labels are blinded, not a formally double-blind trial.',
      'RGB still conversion is identical BT.709 limited-to-full at native dimensions; judge motion/color in original clips.',
      'No held-out frames are present.'] }, null, 2));
  bundle.files = files; bundle.status = 'complete'; bundle.completedUtc = new Date().toISOString(); save();
  state.humanReview = { ...state.humanReview, status: 'awaiting-calibration-judgment', bundlePath: bundle.directory, finalists: null }; save();
  return bundle;
}

module.exports = { generateReview };
