'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { PROFILES, ARCHIVE_RECIPE } = require('../src/media.cjs');
const { classifyMarker, createOutputId } = require('../src/provenance.cjs');

const artifactParent = path.resolve(__dirname, '..', 'artifacts', 'service-tests');
const defaultSettings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
const tick = () => new Promise((resolve) => setImmediate(resolve));
const failure = (code, message) => Object.assign(new Error(message), { code });
const generatedInspection = outputId => ({ ...inspection(), probe: { ...inspection().probe,
  format: { tags: { FFMPEG_ENCODER_PROVENANCE: '1', FFMPEG_ENCODER_OUTPUT_ID: outputId } } } });

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, refuse) => { resolve = accept; reject = refuse; });
  return { promise, resolve, reject };
}

function inspection() {
  return {
    probe: { streams: [{
      index: 0, codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p',
      width: 320, height: 180, color_transfer: 'bt709', color_primaries: 'bt709',
      color_space: 'bt709', color_range: 'tv', disposition: { default: 1 },
    }] },
    color: { classification: 'sdr', supported: true, transfer: 'bt709', videoIndex: 0, reasons: [] },
    duration: 2,
    summary: { selectedVideoIndex: 0, codec: 'h264', width: 320, height: 180, bitDepth: 8 },
  };
}

async function harness(t, { names = ['a.mp4', 'b.mp4'], onEncode, onInspect, verify, sameFolder = false, eligible = true, inspectResult, outputTags, runtimeIdentity } = {}) {
  await fs.mkdir(artifactParent, { recursive: true });
  const root = await fs.mkdtemp(path.join(artifactParent, 'run-'));
  const input = path.join(root, 'input');
  const output = sameFolder ? input : path.join(root, 'output');
  const stateDir = path.join(root, 'state');
  await fs.mkdir(input);
  if (!sameFolder) await fs.mkdir(output);
  for (const name of names) await fs.writeFile(path.join(input, name), `Original input ${name}`);
  t.after(async () => {
    // This unique tree contains only this test's fixtures and service outputs.
    // Resolve and check its boundary before deleting it; never clean a selected
    // real media directory or use a wildcard across other test runs.
    const actual = await fs.realpath(root);
    const parent = await fs.realpath(artifactParent);
    if (!actual.startsWith(parent + path.sep) || !path.basename(actual).startsWith('run-')) {
      throw new Error('Refusing to remove a path outside the owned test artifact tree.');
    }
    await fs.rm(actual, { recursive: true });
  });
  const calls = [];
  const inspections = [];
  let active = 0;
  let maximumActive = 0;
  const service = new EncoderService({
    ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir, inspectionWorkers: 1, runtimeIdentity,
    storageEligibility: { check: async () => ({ eligible, reason: eligible ? null : 'Injected unsupported storage.' }) },
    capabilities: async () => ({
      profiles: PROFILES.map((profile) => ({ ...profile, available: true, supportedBitDepths: [8, 10] })),
      versions: { ffmpeg: 'test', ffprobe: 'test' },
    }),
    inspect: async (file, options) => {
      inspections.push(file);
      if (onInspect) await onInspect({ file, options, input, output, service });
      return inspectResult ? inspectResult(file) : inspection();
    },
    verify: verify || (() => ({ valid: true, errors: [] })),
    run: async (executable, args, options) => {
      if (executable === 'injected-ffprobe') {
        const encode = calls.find(call => call.temporary === args.at(-1));
        const tags = {};
        for (let index = 0; index < (encode?.args.length || 0); index++) if (encode.args[index] === '-metadata') {
          const value = encode.args[index + 1]; const split = value.indexOf('=');
          tags[value.slice(0, split)] = value.slice(split + 1);
        }
        return { stdout: JSON.stringify({ format: { tags: outputTags ? outputTags(tags) : tags } }), stderr: '', exitCode: 0 };
      }
      const file = args[args.indexOf('-i') + 1];
      const temporary = args.at(-1);
      const call = { file, temporary, args, options };
      calls.push(call);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      try {
        if (onEncode) await onEncode({ ...call, input, output, service, number: calls.length });
        if (options.signal.aborted) throw failure('CANCELLED', 'Child closed after cancellation.');
        await fs.writeFile(temporary, `Encoded output ${path.basename(file)}`);
        options.onProgress?.({ seconds: 2, speed: 1, fps: 30, bytes: 100, frame: 60, ended: true });
        return { stdout: '', stderr: '', exitCode: 0 };
      } finally {
        active -= 1;
      }
    },
  });
  const inputFolder = await service.registerFolder(input, 'input');
  const outputFolder = await service.registerFolder(output, 'output');
  const request = { inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, settings: defaultSettings };
  return {
    root, input, output, stateDir, service, calls, inspections, request,
    maximumActive: () => maximumActive,
    prepare: () => service.prepareBatch(request),
    async finish(plan) {
      service.startBatch({ planId: plan.planId, fileIds: plan.items.filter((item) => item.status === 'ready').map((item) => item.id) });
      await service.taskPromise;
      return service.snapshot();
    },
  };
}

async function diagnosticRecord(service, reason, fileId) {
  const page = await service.getDiagnosticHistory({ limit: 200 });
  for (const summary of page.events.filter(entry => entry.reason === reason)) {
    const { event } = await service.getDiagnosticRecord({ eventId: summary.id });
    if (!fileId || event.fileId === fileId) return event;
  }
  assert.fail(`Expected persisted diagnostic ${reason}`);
}

test('new batches snapshot persisted operation defaults; saving later does not mutate the prepared request', async t => {
  const h = await harness(t);
  const app = await h.service.getAppSettings();
  const plan = await h.prepare();
  assert.equal(plan.operationDraft.files[0].request.range, null);
  assert.equal(plan.operationDraft.files[0].request.audioPolicy, 'copy');
  await h.service.saveAppSettings({ revision: app.revision, defaults: { ...app.defaults, resolution: '720' } });
  assert.equal(h.service.snapshot().operationDraft.files[0].request.resolution, 'source');
  const next = await h.prepare();
  assert.equal(next.operationDraft.files[0].request.resolution, '720');
  assert.ok(next.items.every(item => item.reasonCode === 'OPERATION_QUALIFICATION_REQUIRED'));
  assert.equal(h.calls.length, 0, 'unqualified choices cannot silently run the old argv');
});

test('per-file operation edits reprepare with a new plan, preserve source reservations and refuse stale start', async t => {
  const h = await harness(t); const plan = await h.prepare();
  const reserved = h.service.plan.reservedPaths;
  const next = await h.service.updateFileOperations({ planId: plan.planId, draftId: plan.operationDraft.id, revision: plan.operationDraft.revision,
    fileIds: [plan.items[0].id], overrides: { range: { startUs: 0, endUs: 1000000 } } });
  assert.notEqual(next.planId, plan.planId); assert.equal(h.service.plan.reservedPaths, reserved);
  assert.equal(next.items[0].operationRequest.audioPolicy, 'precision-aac');
  assert.equal(next.items[0].status, 'unsupported');
  assert.equal(next.items[1].operationRequest.range, null); assert.equal(next.items[1].status, 'ready');
  assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[1].id] }), { code: 'STALE_PLAN' });
  assert.equal(h.calls.length, 0);
});

test('changing encoder settings preserves each file operation and invalidates the prepared argv', async t => {
  const h = await harness(t); const initial = await h.prepare();
  const firstId = initial.items[0].id;
  const plan = await h.service.updateFileOperations({ planId: initial.planId, draftId: initial.operationDraft.id,
    revision: initial.operationDraft.revision, fileIds: [firstId], overrides: { range: { startUs: 0, endUs: 1000000 }, resolution: '720' } });
  const reserved = h.service.plan.reservedPaths;
  const settings = { profileId: 'h264-cpu', preset: 'slow', quality: 21 };
  const next = await h.service.reprepareEncodingSettings({ planId: plan.planId, draftId: plan.operationDraft.id,
    revision: plan.operationDraft.revision, settings });
  assert.notEqual(next.planId, plan.planId);
  assert.equal(next.operationDraft.id, plan.operationDraft.id);
  assert.equal(next.operationDraft.revision, plan.operationDraft.revision + 1);
  assert.equal(h.service.plan.reservedPaths, reserved);
  assert.deepEqual(next.items.map(item => item.id), plan.items.map(item => item.id));
  assert.deepEqual(next.items[0].operationRequest.range, { startUs: 0, endUs: 1000000 });
  assert.equal(next.items[0].operationRequest.resolution, '720');
  assert.equal(next.items[1].operationRequest.range, null);
  assert.equal(next.items[1].operationRequest.resolution, 'source');
  assert.equal(next.items[1].status, 'ready');
  assert.match(next.items[1].outputName, /_H264-CPU\.mkv$/);
  assert.deepEqual(next.settings, settings);
  await h.finish(next);
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].args[h.calls[0].args.indexOf('-c:v:0') + 1], 'libx264');
  assert.equal(h.calls[0].args[h.calls[0].args.indexOf('-crf:v:0') + 1], '21');
});

test('invalid or stale encoder edits leave the current draft and settings unchanged', async t => {
  const h = await harness(t); const plan = await h.prepare();
  const request = { planId: plan.planId, draftId: plan.operationDraft.id, revision: plan.operationDraft.revision,
    settings: { profileId: 'h264-cpu', preset: 'slow', quality: 21 } };
  for (const invalid of [{ ...request, path: h.input }, { ...request, revision: request.revision - 1 },
    { ...request, draftId: randomUUID() }, { ...request, settings: { ...request.settings, quality: NaN } }]) {
    await assert.rejects(h.service.reprepareEncodingSettings(invalid));
    assert.equal(h.service.snapshot().planId, plan.planId);
    assert.deepEqual(h.service.snapshot().operationDraft, plan.operationDraft);
    assert.deepEqual(h.service.snapshot().settings, defaultSettings);
  }
  h.service.capabilityResult.profiles.find(profile => profile.id === 'h264-cpu').available = false;
  await assert.rejects(h.service.reprepareEncodingSettings(request), { code: 'UNAVAILABLE_PROFILE' });
  assert.deepEqual(h.service.snapshot().operationDraft, plan.operationDraft);
  assert.deepEqual(h.service.snapshot().settings, defaultSettings);
});

test('settings autosave revokes execution but retains the editable draft before encoder reprepare', async t => {
  const h = await harness(t); const initial = await h.prepare();
  const edited = await h.service.updateFileOperations({ planId: initial.planId, draftId: initial.operationDraft.id,
    revision: initial.operationDraft.revision, fileIds: [initial.items[0].id], overrides: { range: { startUs: 100001, endUs: 1200002 } } });
  const settings = { profileId: 'h264-cpu', preset: 'slow', quality: 21 };
  await h.service.saveSettings(settings);
  const stale = h.service.snapshot();
  assert.notEqual(stale.planId, edited.planId);
  assert.deepEqual(stale.operationDraft, edited.operationDraft);
  assert.equal(h.service.plan.entries.size, 0);
  assert.ok(stale.items.every(item => item.status === 'unprocessed' && item.reasonCode === 'ENCODING_SETTINGS_CHANGED'));
  assert.equal(stale.encodingSettingsStale, true);
  assert.throws(() => h.service.updateFileOperations({ planId: stale.planId, draftId: stale.operationDraft.id,
    revision: stale.operationDraft.revision, fileIds: [edited.items[1].id], overrides: { resolution: '720' } }), { code: 'ENCODING_SETTINGS_CHANGED' });
  assert.throws(() => h.service.updateBatchOperationDefaults({ planId: stale.planId, draftId: stale.operationDraft.id,
    revision: stale.operationDraft.revision, overrides: { resolution: '720' } }), { code: 'ENCODING_SETTINGS_CHANGED' });
  await assert.rejects(h.service.applyAppDefaultsToBatch({ planId: stale.planId, draftId: stale.operationDraft.id,
    revision: stale.operationDraft.revision, resetFileOverrides: false }), { code: 'ENCODING_SETTINGS_CHANGED' });
  assert.throws(() => h.service.startBatch({ planId: edited.planId, fileIds: [edited.items[1].id] }), { code: 'STALE_PLAN' });
  assert.throws(() => h.service.startBatch({ planId: stale.planId, fileIds: [edited.items[1].id] }), { code: 'INVALID_SELECTION' });
  assert.throws(() => h.service.getEncodingDetails({ planId: stale.planId, fileId: edited.items[1].id }), { code: 'UNPREPARED_FILE' });
  const next = await h.service.reprepareEncodingSettings({ planId: stale.planId, draftId: stale.operationDraft.id,
    revision: stale.operationDraft.revision, settings });
  assert.deepEqual(next.items[0].operationRequest.range, { startUs: 100001, endUs: 1200002 });
  assert.equal(next.items[1].status, 'ready');
  assert.equal(next.encodingSettingsStale, false);
  await h.service.resetProfile({ profileId: 'h264-cpu' });
  assert.equal(h.service.snapshot().operationDraft.id, edited.operationDraft.id);
  assert.equal(h.service.plan.entries.size, 0);
});

test('encoder edits cannot restore temporary generated-source authority or race a newer preparation', async t => {
  const h = await harness(t, { names: ['original.mp4', 'generated.mkv'],
    inspectResult: file => path.basename(file) === 'generated.mkv' ? generatedInspection(createOutputId()) : inspection() });
  const initial = await h.prepare(); const generated = initial.items.find(item => item.status === 'generated');
  const plan = await h.service.reencodeOutputs({ planId: initial.planId, fileIds: [generated.id] });
  const request = { planId: plan.planId, draftId: plan.operationDraft.id, revision: plan.operationDraft.revision,
    settings: { profileId: 'h264-cpu', preset: 'slow', quality: 21 } };
  const next = await h.service.reprepareEncodingSettings(request);
  assert.equal(next.items.find(item => item.id === generated.id).status, 'generated');
  assert.equal(h.service.plan.reencodeAuthorizations.size, 0);
  const release = deferred(); const originalGet = h.service.getCapabilities.bind(h.service);
  h.service.getCapabilities = async () => { await release.promise; return originalGet(); };
  const pending = h.service.reprepareEncodingSettings({ ...request, planId: next.planId,
    revision: next.operationDraft.revision, settings: defaultSettings });
  const newer = await h.service.updateBatchOperationDefaults({ planId: next.planId, draftId: next.operationDraft.id,
    revision: next.operationDraft.revision, overrides: { resolution: '720' } });
  release.resolve();
  await assert.rejects(pending, { code: 'STALE_PLAN' });
  assert.equal(h.service.snapshot().planId, newer.planId);
  assert.deepEqual(h.service.snapshot().settings, request.settings);
});

for (const overrides of [{ target: 'mp4' }, { target: 'mov' }, { hdrPolicy: 'hlg-base' },
  { hdrPolicy: 'dolby-pq' }, { omissionRequestIds: ['requested-stream-omission'] }]) {
  test(`unqualified operation ${JSON.stringify(overrides)} never silently reaches the old builder`, async t => {
    const h = await harness(t, { names: ['a.mp4'] }), plan = await h.prepare();
    const next = await h.service.updateFileOperations({ planId: plan.planId, draftId: plan.operationDraft.id,
      revision: plan.operationDraft.revision, fileIds: [plan.items[0].id], overrides });
    assert.notEqual(next.planId, plan.planId);
    assert.equal(next.items[0].reasonCode, 'OPERATION_QUALIFICATION_REQUIRED');
    assert.equal(next.items[0].status, 'unsupported');
    assert.equal(h.service.plan.entries.size, 0);
    assert.throws(() => h.service.startBatch({ planId: next.planId, fileIds: [plan.items[0].id] }), { code: 'INVALID_SELECTION' });
    assert.equal(h.calls.length, 0);
  });
}

test('runtime identity is a main-supplied constructor field and existing mocks default to null', async t => {
  const legacy = await harness(t, { names: ['a.mp4'] });
  assert.equal(legacy.service.runtimeIdentity, null);
  const runtimeIdentity = 'a'.repeat(64);
  const candidate = await harness(t, { names: ['a.mp4'], runtimeIdentity });
  assert.equal(candidate.service.runtimeIdentity, runtimeIdentity);
  assert.equal((await candidate.prepare()).items[0].status, 'ready');
});

test('meaningful operation edits expire generated-source grants and never make filtering into authority', async t => {
  const outputId = createOutputId();
  const h = await harness(t, { names: ['original.mp4', 'generated.mkv'], inspectResult: file => path.basename(file) === 'generated.mkv' ? generatedInspection(outputId) : inspection() });
  const plan = await h.prepare(); const generated = plan.items.find(item => item.status === 'generated');
  const allowed = await h.service.reencodeOutputs({ planId: plan.planId, fileIds: [generated.id] });
  assert.equal(allowed.items.find(item => item.id === generated.id).reencodeAuthorized, true);
  const changed = await h.service.updateBatchOperationDefaults({ planId: allowed.planId, draftId: allowed.operationDraft.id,
    revision: allowed.operationDraft.revision, overrides: { hdrPolicy: 'sdr' } });
  assert.equal(changed.items.find(item => item.id === generated.id).status, 'generated');
  assert.equal(changed.items.find(item => item.id === generated.id).reencodeAuthorized, false);
  assert.equal(h.service.plan.reencodeAuthorizations.size, 0);
});

test('queued operation snapshots survive App Settings edits while draft mutation is denied', async t => {
  const entered = deferred(), release = deferred();
  const h = await harness(t, { onEncode: async () => { entered.resolve(); await release.promise; } });
  const plan = await h.prepare();
  h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] }); await entered.promise;
  const queued = h.service.plan.queueOperationSnapshot;
  assert.equal(Object.isFrozen(queued), true);
  const app = await h.service.getAppSettings();
  await h.service.saveAppSettings({ revision: app.revision, defaults: { ...app.defaults, fullAudioPolicy: 'precision-aac' } });
  assert.equal(queued.requests[0].audioPolicy, 'copy');
  assert.throws(() => h.service.updateFileOperations({ planId: plan.planId, draftId: plan.operationDraft.id, revision: plan.operationDraft.revision,
    fileIds: [plan.items[0].id], overrides: {} }), { code: 'BUSY' });
  release.resolve(); await h.service.taskPromise;
  assert.equal(h.service.snapshot().items[0].status, 'success');
});

test('only saved outputs obtain post-cleanup action tokens; stale contents cannot open', async t => {
  const { OutputAccess } = require('../src/output-access.cjs');
  const h = await harness(t, { names: ['a.mp4'] }); const opened = [];
  h.service.outputAccess = new OutputAccess({ openPath: async file => { opened.push(file); return ''; }, showItemInFolder() {} });
  const result = await h.finish(await h.prepare()); const item = result.items[0];
  assert.ok(item.outputAccess?.outputId); assert.equal(item.outputAccessWarning, undefined);
  assert.equal((await fs.stat(path.join(h.output, item.outputName))).nlink, 1);
  assert.equal((await h.service.openCompletedOutput({ outputId: item.outputAccess.outputId, action: 'open' })).dispatched, true);
  assert.deepEqual(opened, [await fs.realpath(path.join(h.output, item.outputName))]);
  await fs.appendFile(path.join(h.output, item.outputName), 'changed');
  await assert.rejects(h.service.openCompletedOutput({ outputId: item.outputAccess.outputId, action: 'open' }), { code: 'OUTPUT_ACCESS_CHANGED' });
  assert.equal(opened.length, 1);
});

test('output action issuance failure does not relabel a safely published encode as failure', async t => {
  const h = await harness(t, { names: ['a.mp4'] });
  h.service.outputAccess = { issue: async () => { throw new Error('link changed'); } };
  const result = await h.finish(await h.prepare()); const item = result.items[0];
  assert.equal(item.status, 'success'); assert.equal(item.outputDisposition.published, true);
  assert.match(item.outputAccessWarning, /could not be bound safely/);
  assert.equal(item.outputAccess, undefined);
  await assert.rejects(h.service.openCompletedOutput({ outputId: randomUUID(), action: 'open', path: h.input }), { code: 'INVALID_REQUEST' });
});

for (const mutation of ['replacement', 'same-object-content']) {
  test(`a ${mutation} before the first publication observation obtains neither provenance nor output access`, async t => {
    const h = await harness(t, { names: ['a.mp4'] });
    const recordIncident = h.service.recordIncident.bind(h.service), recordPublished = h.service.provenanceJournal.recordPublished.bind(h.service.provenanceJournal);
    let publishedRecords = 0, outputIssues = 0, before, destination;
    h.service.outputAccess = { issue: async () => { outputIssues++; return { outputId: randomUUID() }; } };
    h.service.provenanceJournal.recordPublished = async (...args) => { publishedRecords++; return recordPublished(...args); };
    h.service.recordIncident = async request => {
      const result = await recordIncident(request);
      if (request.reason === 'OUTPUT_PUBLISHED') {
        destination = request.context.destination; before = await fs.stat(destination, { bigint: true });
        if (mutation === 'replacement') await fs.rename(destination, `${destination}.validated`);
        await fs.writeFile(destination, Buffer.alloc(Number(before.size), 81));
        await fs.utimes(destination, new Date(), new Date(Number(before.mtimeNs / 1000000n) + 1000));
        assert.equal((await fs.stat(destination, { bigint: true })).ino === before.ino, mutation === 'same-object-content');
      }
      return result;
    };
    const result = await h.finish(await h.prepare()), item = result.items[0];
    assert.equal(item.status, 'success', 'an already completed publication is not undone by later identity refusal');
    assert.equal(item.outputDisposition.published, true);
    assert.equal(publishedRecords, 0); assert.equal(outputIssues, 0);
    assert.equal(item.outputAccess, undefined);
    assert.match(item.outputAccessWarning, /could not be bound safely/);
    assert.match(item.reason, /provenance bookkeeping remains pending/);
    assert.deepEqual(await fs.readFile(destination), Buffer.alloc(Number(before.size), 81));
  });
}

test('a verified exclusive-copy fallback binds provenance and output actions to the copied inode', async t => {
  const { OutputAccess } = require('../src/output-access.cjs');
  const h = await harness(t, { names: ['a.mp4'] });
  const link = fs.link.bind(fs), opened = [];
  t.mock.method(fs, 'link', async (source, destination) => {
    if (path.basename(source) === 'encoded.mkv') throw failure('ENOTSUP', 'Force the existing distinct-folder copy fallback.');
    return link(source, destination);
  });
  h.service.outputAccess = new OutputAccess({ openPath: async file => { opened.push(file); return ''; }, showItemInFolder() {} });
  const result = await h.finish(await h.prepare()), item = result.items[0];
  assert.equal(item.status, 'success'); assert.equal(item.outputDisposition.published, true);
  assert.ok(item.outputAccess?.outputId); assert.equal(item.outputAccessWarning, undefined);
  await h.service.openCompletedOutput({ outputId: item.outputAccess.outputId, action: 'open' });
  assert.deepEqual(opened, [await fs.realpath(path.join(h.output, item.outputName))]);
});

test('two selected jobs run sequentially, publish validated outputs, and leave an accurate recoverable result', async (t) => {
  const h = await harness(t);
  const plan = await h.prepare();
  assert.deepEqual(plan.items.map((item) => item.status), ['ready', 'ready']);
  const result = await h.finish(plan);
  assert.equal(result.phase, 'completed');
  assert.deepEqual(result.counts, { success: 2, failed: 0, skipped: 0, cancelled: 0, unprocessed: 0 });
  assert.equal(h.maximumActive(), 1);
  assert.deepEqual(h.calls.map((call) => path.basename(call.file)), ['a.mp4', 'b.mp4']);
  assert.deepEqual((await fs.readdir(h.output)).sort(), ['a_H265-CPU.mkv', 'b_H265-CPU.mkv']);
  assert.equal(await fs.readFile(path.join(h.input, 'a.mp4'), 'utf8'), 'Original input a.mp4');
  const log = (await diagnosticRecord(h.service, 'BATCH_FINISHED')).context;
  assert.deepEqual(log.counts, result.counts);
  assert.equal(log.phase, 'completed');
});

test('a file-specific encode failure continues to the next selected input without publishing the failed output', async (t) => {
  const h = await harness(t, { onEncode: ({ number }) => {
    if (number === 1) throw failure('TOOL_FAILED', 'Corrupt input packet.');
  } });
  const result = await h.finish(await h.prepare());
  assert.equal(result.phase, 'completed');
  assert.deepEqual(result.counts, { success: 1, failed: 1, skipped: 0, cancelled: 0, unprocessed: 0 });
  assert.deepEqual(result.items.map((item) => item.status), ['failed', 'success']);
  assert.deepEqual(await fs.readdir(h.output), ['b_H265-CPU.mkv']);
});

test('a shared infrastructure failure stops remaining work and preserves explicit unprocessed counts', async (t) => {
  const h = await harness(t, { onEncode: () => { throw failure('ENOSPC', 'The output disk is full.'); } });
  const result = await h.finish(await h.prepare());
  assert.equal(result.phase, 'failed');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(result.counts, { success: 0, failed: 1, skipped: 0, cancelled: 0, unprocessed: 1 });
  assert.deepEqual(await fs.readdir(h.output), []);
});

test('cancellation waits for the owned child to close, prevents restart, and never starts the next queued file', async (t) => {
  const started = deferred();
  const closed = deferred();
  const h = await harness(t, { onEncode: async ({ number }) => {
    if (number === 1) { started.resolve(); await closed.promise; }
  } });
  const plan = await h.prepare();
  const start = { planId: plan.planId, fileIds: plan.items.map((item) => item.id) };
  const running = h.service.startBatch(start);
  await started.promise;
  let settled = false;
  const cancelling = h.service.cancelBatch({ batchId: running.batchId }).then((result) => { settled = true; return result; });
  await tick();
  assert.equal(settled, false);
  assert.equal(h.service.snapshot().phase, 'cancelling');
  assert.equal(h.service.busy, true);
  assert.throws(() => h.service.startBatch(start), { code: 'BUSY' });
  await assert.rejects(h.prepare(), { code: 'BUSY' });
  assert.equal(h.calls.length, 1);
  closed.resolve();
  const result = await cancelling;
  assert.equal(result.phase, 'cancelled');
  assert.deepEqual(result.counts, { success: 0, failed: 0, skipped: 0, cancelled: 1, unprocessed: 1 });
  assert.deepEqual(await fs.readdir(h.output), []);
  assert.equal(h.service.busy, false);
  const newPlan = await h.prepare();
  const completed = await h.finish(newPlan);
  assert.equal(completed.counts.success, 2);
  const revision = completed.revision;
  h.calls[0].options.onProgress({ seconds: 999, speed: 1, ended: true });
  assert.equal(h.service.snapshot().revision, revision);
  assert.notEqual(h.service.snapshot().progress?.seconds, 999);
});

test('cancelling preparation waits for inspection settlement and invalidates the incomplete plan', async (t) => {
  const inspecting = deferred();
  const inspected = deferred();
  const h = await harness(t, { onInspect: async ({ options }) => {
    inspecting.resolve();
    await inspected.promise;
    if (options.signal.aborted) throw failure('CANCELLED', 'Probe closed after cancellation.');
  } });
  const preparing = h.prepare();
  await inspecting.promise;
  let settled = false;
  const cancelled = h.service.cancelCurrent().then((result) => { settled = true; return result; });
  await tick();
  assert.equal(settled, false);
  assert.equal(h.service.busy, true);
  inspected.resolve();
  await preparing;
  const result = await cancelled;
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.planId, null);
  assert.equal(result.counts.unprocessed, 2);
  assert.equal(h.calls.length, 0);
  assert.equal(h.inspections.length, 1);
});

test('malicious payloads and stale identities cannot start an unprepared or replacement plan', async (t) => {
  const h = await harness(t);
  await assert.rejects(h.service.prepareBatch({ ...h.request, args: ['-y'] }), { code: 'INVALID_REQUEST' });
  await assert.rejects(h.service.prepareBatch({ ...h.request, settings: { ...defaultSettings, executable: 'cmd.exe' } }), { code: 'INVALID_SETTINGS' });
  await assert.rejects(h.service.prepareBatch({ ...h.request, inputFolderId: '../input' }), { code: 'INVALID_ID' });
  const first = await h.prepare();
  const second = await h.prepare();
  assert.throws(() => h.service.startBatch({ planId: first.planId, fileIds: first.items.map((item) => item.id) }), { code: 'STALE_PLAN' });
  assert.throws(() => h.service.startBatch({ planId: second.planId, fileIds: [randomUUID()] }), { code: 'INVALID_SELECTION' });
  assert.throws(() => h.service.startBatch({ planId: second.planId, fileIds: [second.items[0].id, second.items[0].id] }), { code: 'INVALID_SELECTION' });
  await assert.rejects(h.service.cancelBatch({ batchId: randomUUID() }), { code: 'STALE_BATCH' });
  assert.equal(h.calls.length, 0);
});

test('duplicate output stems require choosing one input and keep the other explicitly unprocessed', async (t) => {
  const h = await harness(t, { names: ['same.mp4', 'same.mkv'] });
  const plan = await h.prepare();
  assert.deepEqual(plan.items.map((item) => item.status), ['conflict', 'conflict']);
  assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: plan.items.map((item) => item.id) }), { code: 'OUTPUT_CONFLICT' });
  h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] });
  await h.service.taskPromise;
  const result = h.service.snapshot();
  assert.deepEqual(result.counts, { success: 1, failed: 0, skipped: 0, cancelled: 0, unprocessed: 1 });
  assert.equal(h.calls.length, 1);
  assert.deepEqual(await fs.readdir(h.output), ['same_H265-CPU.mkv']);
});

test('an input changed after preview is rejected before encoding while other inputs can continue', async (t) => {
  const h = await harness(t);
  const plan = await h.prepare();
  await fs.appendFile(path.join(h.input, 'a.mp4'), 'Changed after preview');
  const result = await h.finish(plan);
  assert.deepEqual(result.items.map((item) => item.status), ['failed', 'success']);
  assert.match(result.items[0].reason, /changed since preview/i);
  assert.deepEqual(h.calls.map((call) => path.basename(call.file)), ['b.mp4']);
});

test('an input changed during encoding prevents publication and retains the validated completed output', async (t) => {
  const h = await harness(t, { names: ['a.mp4'], onEncode: ({ file }) => fs.appendFile(file, 'Changed during encode') });
  const result = await h.finish(await h.prepare());
  assert.equal(result.counts.failed, 1);
  assert.match(result.items[0].reason, /changed while/i);
  assert.equal(result.items[0].sourceIdentityDiagnostic.stage, 'after-encode');
  assert.ok(result.items[0].sourceIdentityDiagnostic.changedFields.includes('size'));
  assert.ok(result.items[0].sourceIdentityDiagnostic.changedFields.includes('sparseDigest'));
  assert.equal(result.items[0].outputDisposition.kind, 'retained-completed');
  assert.equal(result.items[0].cleanup.completed, true);
  assert.equal(await fs.readFile(result.items[0].cleanup.file, 'utf8'), 'Encoded output a.mp4');
  await assert.rejects(fs.stat(path.join(h.output, 'a_H265-CPU.mkv')), { code: 'ENOENT' });
});

test('ctime-only completion publishes with exact warning evidence while revoking future grants and protecting sources', async t => {
  const sourceId = createOutputId();
  const h = await harness(t, { sameFolder: true, names: ['a.mkv'], inspectResult: () => generatedInspection(sourceId),
    onEncode: async ({ file }) => {
      try { await fs.chmod(file, 0o444); }
      finally { await fs.chmod(file, 0o666); }
    } });
  const source = path.join(h.input, 'a.mkv');
  const beforeBytes = await fs.readFile(source);
  const first = await h.prepare();
  const ready = await h.service.reencodeOutputs({ planId: first.planId, fileIds: [first.items[0].id] });
  const expected = structuredClone(h.service.plan.entries.get(first.items[0].id).fingerprint);
  const result = await h.finish(ready);
  const item = result.items[0];
  assert.equal(item.status, 'success');
  assert.equal(item.outcome, 'saved-with-warning');
  assert.equal(item.reencodeAuthorized, false);
  assert.equal(h.service.plan.reencodeAuthorizations.size, 0);
  assert.match(item.reason, /Output saved/);
  assert.match(item.reason, /filesystem change time changed/);
  assert.match(item.reason, /cannot rule out changes outside/);
  assert.equal(item.warnings[0].code, 'SOURCE_CTIME_ONLY');
  assert.deepEqual(item.sourceIdentityDiagnostic.changedFields, ['ctimeNs']);
  assert.equal(item.sourceIdentityDiagnostic.stage, 'after-encode');
  assert.equal(item.sourceIdentityDiagnostic.checkpoint, 'after-encode');
  assert.deepEqual(item.sourceIdentityDiagnostic.expected, expected);
  assert.equal(item.sourceIdentityDiagnostic.actual.sparseDigest, expected.sparseDigest);
  assert.notEqual(item.sourceIdentityDiagnostic.actual.ctimeNs, expected.ctimeNs);
  const log = (await diagnosticRecord(h.service, 'JOB_DISPOSITION', item.id)).context;
  assert.deepEqual(log.sourceIdentityDiagnostic, item.sourceIdentityDiagnostic);
  assert.deepEqual(log.warnings, item.warnings);
  assert.ok(JSON.stringify(item.sourceIdentityDiagnostic).length < 4000);
  assert.deepEqual(await fs.readFile(source), beforeBytes);
  assert.deepEqual((await fs.readdir(h.input)).sort(), ['a.mkv', 'a_H265-CPU.mkv']);
});

test('unsampled change with restored mtime honestly saves with uncertainty under bounded completion policy', async t => {
  const fixedTime = 1_700_000_000;
  const h = await harness(t, { names: ['a.mkv'], onEncode: async ({ file }) => {
    const handle = await fs.open(file, 'r+');
    try { await handle.write(Buffer.from([99]), 0, 1, 500_000); }
    finally { await handle.close(); }
    await fs.utimes(file, fixedTime, fixedTime);
  } });
  const source = path.join(h.input, 'a.mkv');
  await fs.writeFile(source, Buffer.alloc(4 * 1024 * 1024, 37));
  await fs.utimes(source, fixedTime, fixedTime);
  const result = await h.finish(await h.prepare());
  assert.equal(result.items[0].status, 'success');
  assert.equal(result.items[0].sourceAssessment.kind, 'ctime-only');
  assert.equal(result.items[0].outcome, 'saved-with-warning');
  assert.match(result.items[0].reason, /cannot rule out changes outside the sampled regions/);
  const diagnostic = result.items[0].sourceIdentityDiagnostic;
  assert.deepEqual(diagnostic.changedFields, ['ctimeNs']);
  assert.equal(diagnostic.expected.sparseDigest, diagnostic.actual.sparseDigest);
  assert.equal(diagnostic.expected.mtimeNs, diagnostic.actual.mtimeNs);
  assert.equal((await fs.readFile(source))[500_000], 99);
  assert.deepEqual(await fs.readdir(h.output), ['a_H265-CPU.mkv']);
});

test('an output that appears after preview is skipped without encoding or changing its bytes', async (t) => {
  const h = await harness(t, { names: ['a.mp4'] });
  const plan = await h.prepare();
  const destination = path.join(h.output, 'a_H265-CPU.mkv');
  await fs.writeFile(destination, 'Existing protected bytes');
  const result = await h.finish(plan);
  assert.equal(result.counts.skipped, 1);
  assert.equal(h.calls.length, 0);
  assert.equal(await fs.readFile(destination, 'utf8'), 'Existing protected bytes');
});

test('an output publication race preserves the competitor and the validated completed stage', async (t) => {
  const h = await harness(t, { names: ['a.mp4'], onEncode: ({ output }) => fs.writeFile(path.join(output, 'a_H265-CPU.mkv'), 'Publication race winner') });
  const result = await h.finish(await h.prepare());
  assert.equal(result.counts.skipped, 1);
  assert.match(result.items[0].reason, /publication race/i);
  assert.equal(await fs.readFile(path.join(h.output, 'a_H265-CPU.mkv'), 'utf8'), 'Publication race winner');
  assert.equal(result.items[0].outputDisposition.kind, 'retained-completed');
  assert.equal(await fs.readFile(result.items[0].outputDisposition.file, 'utf8'), 'Encoded output a.mp4');
});

test('a missing source after valid completion is incomplete evidence, not a ctime warning or publication', async t => {
  const h = await harness(t, { names: ['a.mp4'], onEncode: ({ file }) => fs.unlink(file) });
  const result = await h.finish(await h.prepare());
  const item = result.items[0];
  assert.equal(item.status, 'failed');
  assert.equal(item.reasonCode, 'SOURCE_CHECK_INCOMPLETE');
  assert.equal(item.sourceAssessment.kind, 'incomplete');
  assert.equal(item.sourceIdentityDiagnostic.actual, null);
  assert.equal(item.sourceIdentityDiagnostic.readFailure, 'ENOENT');
  assert.equal(item.outputDisposition.kind, 'retained-completed');
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'Encoded output a.mp4');
  assert.equal(item.warnings, undefined);
  await assert.rejects(fs.stat(path.join(h.output, 'a_H265-CPU.mkv')), { code: 'ENOENT' });
});

test('cancellation after valid output checks retains the completed result and stops queued jobs', async t => {
  let service;
  const h = await harness(t, { verify: () => { service.controller.abort(); return { valid: true, errors: [] }; } });
  service = h.service;
  const result = await h.finish(await h.prepare());
  assert.equal(result.phase, 'cancelled');
  assert.equal(result.items[0].status, 'cancelled');
  assert.equal(result.items[0].outputDisposition.kind, 'retained-completed');
  assert.equal(result.items[1].status, 'unprocessed');
  assert.equal(h.calls.length, 1);
  assert.equal(await fs.readFile(result.items[0].outputDisposition.file, 'utf8'), 'Encoded output a.mp4');
  await assert.rejects(fs.stat(path.join(h.output, 'a_H265-CPU.mkv')), { code: 'ENOENT' });
});

test('invalid output remains a validation failure even when source change is only ctime', async t => {
  const h = await harness(t, { names: ['a.mp4'], onEncode: async ({ file }) => {
    try { await fs.chmod(file, 0o444); } finally { await fs.chmod(file, 0o666); }
  }, verify: () => ({ valid: false, errors: ['Injected invalid media'] }) });
  const result = await h.finish(await h.prepare());
  assert.equal(result.items[0].status, 'failed');
  assert.equal(result.items[0].reasonCode, 'INVALID_OUTPUT');
  assert.equal(result.items[0].sourceAssessment, undefined);
  assert.equal(result.items[0].warnings, undefined);
  assert.deepEqual(await fs.readdir(h.output), []);
  assert.match(await fs.readFile(path.join(h.input, 'a.mp4'), 'utf8'), /Original input/);
});

test('ctime-only change before job start still expires preparation and never launches the encoder', async t => {
  const h = await harness(t, { names: ['a.mp4'] });
  const plan = await h.prepare();
  const file = path.join(h.input, 'a.mp4');
  try { await fs.chmod(file, 0o444); } finally { await fs.chmod(file, 0o666); }
  const result = await h.finish(plan);
  assert.equal(result.items[0].status, 'failed');
  assert.deepEqual(result.items[0].sourceIdentityDiagnostic.changedFields, ['ctimeNs']);
  assert.equal(result.items[0].sourceIdentityDiagnostic.stage, 'before-encode');
  assert.equal(result.items[0].warnings, undefined);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(await fs.readdir(h.output), []);
});

test('a disappeared output folder is a shared failure and stops the remaining queue', async (t) => {
  const h = await harness(t);
  const plan = await h.prepare();
  await fs.rename(h.output, path.join(h.root, 'temporarily-unavailable-output'));
  const result = await h.finish(plan);
  assert.equal(result.phase, 'failed');
  assert.deepEqual(result.counts, { success: 0, failed: 1, skipped: 0, cancelled: 0, unprocessed: 1 });
  assert.equal(h.calls.length, 0);
});


test('same-folder requires verified storage and refuses unsupported helper results', async t => {
  const h = await harness(t, { sameFolder: true, eligible: false });
  const plan = await h.prepare();
  assert.equal(plan.phase, 'failed'); assert.match(plan.error, /verified local fixed NTFS/);
  assert.equal(h.calls.length, 0);
});

test('all baseline paths stay forbidden after a colliding source disappears during preparation', async t => {
  let moved = false;
  const h = await harness(t, { sameFolder: true, names: ['a.mp4', 'a_H265-CPU.mkv'], onInspect: async ({ file, input }) => {
    if (!moved && path.basename(file) === 'a.mp4') {
      moved = true;
      await fs.rename(path.join(input, 'a_H265-CPU.mkv'), path.join(input, 'preserved-original.bin'));
    }
  } });
  const plan = await h.prepare();
  assert.equal(plan.items.find(i => i.name === 'a.mp4').status, 'unsupported');
  assert.match(plan.items.find(i => i.name === 'a.mp4').reason, /protected/);
  assert.equal(h.service.plan.reservedPaths.has(path.join(h.input, 'a_H265-CPU.mkv').toLowerCase()), true);
  assert.match(await fs.readFile(path.join(h.input, 'preserved-original.bin'), 'utf8'), /Original input/);
  assert.equal(h.calls.length, 0);
});

test('hardlinked aliases are excluded before probing and their filesystem identities stay reserved', async t => {
  const h = await harness(t, { sameFolder: true, names: ['a.mp4'] });
  await fs.link(path.join(h.input, 'a.mp4'), path.join(h.input, 'alias.mkv'));
  const plan = await h.prepare();
  assert.ok(plan.items.every(i => i.status === 'unsupported' && /Hard-linked/.test(i.reason)));
  assert.equal(h.inspections.length, 0); assert.equal(h.service.plan.reservedIdentities.size, 1);
});

test('reserved marker classification precedes a pre-existing destination skip', async t => {
  const h = await harness(t, { names: ['a.mp4'], inspectResult: () => ({ ...inspection(), probe: { ...inspection().probe,
    format: { tags: { FFMPEG_ENCODER_PROVENANCE: '99', FFMPEG_ENCODER_OUTPUT_ID: randomUUID() } } } }) });
  await fs.writeFile(path.join(h.output, 'a_H265-CPU.mkv'), 'unrelated protected winner');
  const plan = await h.prepare();
  assert.equal(plan.items[0].status, 'provenance-issue');
  await assert.rejects(h.service.treatAsOriginal({ planId: plan.planId, fileId: plan.items[0].id }), { code: 'INVALID_OVERRIDE' });
});

test('legacy override is explicit, expires with a new plan, and rejects a changed file', async t => {
  const h = await harness(t, { names: ['legacy_AV1-Nvidia-GPU.mkv'] });
  const first = await h.prepare(); assert.equal(first.items[0].status, 'ambiguous');
  const request = { planId: first.planId, fileId: first.items[0].id };
  const overridden = await h.service.treatAsOriginal(request);
  assert.equal(overridden.items[0].status, 'ready'); assert.equal(h.service.plan.overrides.size, 1);
  const second = await h.prepare(); assert.equal(second.items[0].status, 'ambiguous');
  await assert.rejects(h.service.treatAsOriginal(request), { code: 'STALE_PLAN' });
  await fs.appendFile(path.join(h.input, second.items[0].name), 'changed');
  const changed = await h.service.treatAsOriginal({ planId: second.planId, fileId: second.items[0].id });
  assert.equal(changed.phase, 'failed'); assert.match(changed.error, /changed/); assert.equal(h.calls.length, 0);
});

test('required intent failure prevents encoder launch and any media publication', async t => {
  const h = await harness(t, { sameFolder: true, names: ['a.mp4'] });
  const plan = await h.prepare();
  h.service.provenanceJournal.recordIntent = async () => { throw failure('PROVENANCE_UNAVAILABLE', 'Intent disk failure'); };
  const result = await h.finish(plan);
  assert.equal(result.counts.failed, 1); assert.equal(h.calls.length, 0);
  assert.deepEqual(await fs.readdir(h.input), ['a.mp4']);
});

test('a mismatched output UUID never publishes even if the injected media validator accepts', async t => {
  const h = await harness(t, { names: ['a.mp4'], outputTags: tags => ({ ...tags, FFMPEG_ENCODER_OUTPUT_ID: randomUUID() }) });
  const result = await h.finish(await h.prepare());
  assert.equal(result.counts.failed, 1); assert.match(result.items[0].reason, /expected application marker/);
  assert.deepEqual(await fs.readdir(h.output), []);
});

test('final bookkeeping failure preserves completed output and durable intent', async t => {
  const h = await harness(t, { sameFolder: true, names: ['a.mp4'] });
  const plan = await h.prepare(); const outputId = [...h.service.plan.entries.values()][0].outputId;
  h.service.provenanceJournal.recordPublished = async () => { throw failure('PROVENANCE_UNAVAILABLE', 'Final index failure'); };
  const result = await h.finish(plan);
  assert.equal(result.counts.success, 1); assert.match(result.items[0].reason, /bookkeeping remains pending/);
  assert.match(await fs.readFile(path.join(h.input, 'a_H265-CPU.mkv'), 'utf8'), /Encoded output/);
  assert.equal((await fs.readdir(path.join(h.stateDir, 'provenance-v1'))).includes(outputId + '.intent.json'), true);
});

test('unbound cancelled output is retained with notice while restart and source protection remain safe', async t => {
  const started = deferred(); const closed = deferred();
  const h = await harness(t, { sameFolder: true, names: ['a.mp4'], onEncode: async ({ temporary }) => {
    await fs.writeFile(temporary, 'owned child incomplete bytes'); started.resolve(); await closed.promise;
  } });
  const plan = await h.prepare(); h.service.startBatch({ planId: plan.planId, fileIds: [plan.items[0].id] });
  await started.promise; const cancelling = h.service.cancelCurrent(); closed.resolve(); const result = await cancelling;
  assert.equal(result.phase, 'cancelled'); assert.equal(result.items[0].cleanup.retained, true);
  assert.equal(await fs.readFile(result.items[0].cleanup.file, 'utf8'), 'owned child incomplete bytes');
  assert.equal(h.service.busy, false);
  const next = await h.prepare(); assert.deepEqual(next.items.map(i => i.name), ['a.mp4']);
  assert.equal(next.items[0].status, 'ready'); assert.match(await fs.readFile(path.join(h.input, 'a.mp4'), 'utf8'), /Original input/);
});

test('generated sources require explicit per-plan subset intent and preserve separate legacy/original states', async t => {
  const generated = new Map(['generated-a.mkv', 'generated-b.mkv', 'generated-c.mkv'].map(name => [name, createOutputId()]));
  const h = await harness(t, { sameFolder: true, names: [...generated.keys(), 'normal.mkv', 'old_H265-CPU.mkv'],
    inspectResult: file => generated.has(path.basename(file)) ? generatedInspection(generated.get(path.basename(file))) : inspection() });
  const before = new Map(await Promise.all([...generated.keys()].map(async name => [name, await fs.readFile(path.join(h.input, name))])));
  const first = await h.prepare();
  const targets = first.items.filter(item => generated.has(item.name));
  assert.ok(targets.every(item => item.status === 'generated' && item.origin.kind === 'generated' && !item.reencodeAuthorized));
  assert.ok(targets.every(item => item.origin.previousGeneration === undefined));
  assert.equal(first.items.find(item => item.name === 'normal.mkv').origin.kind, 'original');
  assert.equal(first.items.find(item => item.name.startsWith('old_')).origin.kind, 'legacy');
  await assert.rejects(h.service.treatAsOriginal({ planId: first.planId, fileId: targets[0].id }), { code: 'INVALID_OVERRIDE' });
  const picked = targets.slice(0, 2).map(item => item.id);
  const authorized = await h.service.reencodeOutputs({ planId: first.planId, fileIds: picked });
  assert.ok(authorized.items.filter(item => picked.includes(item.id)).every(item => item.status === 'ready' && item.reencodeAuthorized && item.origin.kind === 'generated'));
  assert.equal(authorized.items.find(item => item.id === targets[2].id).status, 'generated');
  assert.equal(authorized.items.find(item => item.id === targets[2].id).reencodeAuthorized, false);
  const details = h.service.getEncodingDetails({ planId: first.planId, fileId: picked[0] });
  assert.equal(details.kind, 'resolved-argument-template');
  assert.equal(details.args.at(-1), details.outputPlaceholder);
  assert.equal(details.args[details.args.indexOf('-i') + 1], path.join(h.input, targets[0].name));
  h.service.startBatch({ planId: first.planId, fileIds: picked });
  await h.service.taskPromise;
  assert.equal(h.service.snapshot().counts.success, 2);
  const actual = h.service.getEncodingDetails({ planId: first.planId, fileId: picked[0] });
  assert.equal(actual.kind, 'actual-invocation');
  assert.deepEqual(actual.args, h.calls[0].args);
  assert.deepEqual(actual.args.slice(0, -1), details.args.slice(0, -1));
  assert.notEqual(actual.args.at(-1), details.outputPlaceholder);
  for (const [name, bytes] of before) assert.deepEqual(await fs.readFile(path.join(h.input, name)), bytes);
  const newPlan = await h.prepare();
  assert.ok(newPlan.items.filter(item => item.origin.kind === 'generated').every(item => item.status === 'generated' && !item.reencodeAuthorized));
  const generatedAgain = newPlan.items.find(item => item.name === targets[0].outputName);
  assert.equal(generatedAgain.origin.previousGeneration.preset, defaultSettings.preset);
  assert.equal(generatedAgain.origin.previousGeneration.quality, defaultSettings.quality);
  await assert.rejects(h.service.reencodeOutputs({ planId: first.planId, fileIds: picked }), { code: 'STALE_PLAN' });
  assert.equal(h.calls.length, 2);
});

test('mixed, duplicate and forged re-encode requests never grant a partial subset', async t => {
  const outputId = createOutputId();
  const h = await harness(t, { names: ['generated.mkv', 'normal.mkv'], inspectResult: file => path.basename(file).startsWith('generated') ? generatedInspection(outputId) : inspection() });
  const plan = await h.prepare();
  const generated = plan.items.find(item => item.status === 'generated');
  const normal = plan.items.find(item => item.status === 'ready');
  for (const fileIds of [[generated.id, normal.id], [generated.id, generated.id], [randomUUID()], [], [generated.id, randomUUID()]]) {
    await assert.rejects(h.service.reencodeOutputs({ planId: plan.planId, fileIds }));
    assert.equal(h.service.plan.reencodeAuthorizations.size, 0);
    assert.equal(h.service.snapshot().items.find(item => item.id === generated.id).status, 'generated');
  }
  await assert.rejects(h.service.reencodeOutputs({ planId: plan.planId, fileIds: [generated.id], allowAll: true }), { code: 'INVALID_REQUEST' });
  assert.throws(() => h.service.getEncodingDetails({ planId: plan.planId, fileId: generated.id }), { code: 'UNPREPARED_FILE' });
  assert.throws(() => h.service.getEncodingDetails({ planId: plan.planId, fileId: normal.id, args: [] }), { code: 'INVALID_REQUEST' });
  assert.equal(h.calls.length, 0);
});

test('replaced generated input invalidates whole requested authorization subset before inspection or execution', async t => {
  const outputId = createOutputId();
  const h = await harness(t, { names: ['a.mkv', 'b.mkv'], inspectResult: () => generatedInspection(outputId) });
  const plan = await h.prepare();
  await fs.appendFile(path.join(h.input, 'b.mkv'), ' changed');
  const changed = await h.service.reencodeOutputs({ planId: plan.planId, fileIds: plan.items.map(item => item.id) });
  assert.equal(changed.phase, 'failed');
  assert.equal(changed.planId, null);
  assert.ok(changed.items.every(item => !item.reencodeAuthorized));
  assert.match(changed.error, /changed/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.service.plan, null);
});

test('generated input changed after authorization cannot encode or retain visible temporary authorization', async t => {
  const outputId = createOutputId();
  const h = await harness(t, { names: ['a.mkv'], inspectResult: () => generatedInspection(outputId) });
  const first = await h.prepare();
  const ready = await h.service.reencodeOutputs({ planId: first.planId, fileIds: [first.items[0].id] });
  await fs.appendFile(path.join(h.input, 'a.mkv'), ' changed');
  const result = await h.finish(ready);
  assert.equal(result.counts.failed, 1);
  assert.equal(result.items[0].reencodeAuthorized, false);
  assert.match(result.items[0].reason, /changed/);
  assert.equal(h.calls.length, 0);
  assert.equal(h.service.plan.reencodeAuthorizations.size, 0);
});

for (const change of ['empty', 'deleted']) test(`generated source ${change} invalidates authority even when identity reading throws`, async t => {
  const h = await harness(t, { names: ['a.mkv'], inspectResult: () => generatedInspection(createOutputId()) });
  // Use one stable provenance ID throughout preparation and final inspection.
  const stableId = createOutputId(); h.service.inspect = async () => generatedInspection(stableId);
  const first = await h.prepare();
  const ready = await h.service.reencodeOutputs({ planId: first.planId, fileIds: [first.items[0].id] });
  const file = path.join(h.input, 'a.mkv');
  if (change === 'empty') await fs.truncate(file, 0); else await fs.unlink(file);
  const result = await h.finish(ready);
  assert.equal(result.counts.failed, 1); assert.equal(result.items[0].reencodeAuthorized, false);
  assert.equal(result.items[0].sourceIdentityDiagnostic.stage, 'before-encode');
  assert.equal(result.items[0].sourceIdentityDiagnostic.readFailure, change === 'empty' ? 'EMPTY_INPUT' : 'ENOENT');
  assert.equal(result.items[0].sourceIdentityDiagnostic.actual, null);
  assert.equal(h.service.plan.reencodeAuthorizations.size, 0); assert.equal(h.calls.length, 0);
});

test('a generated re-encode remains skipped when its protected destination already exists', async t => {
  const outputId = createOutputId();
  const h = await harness(t, { sameFolder: true, names: ['a.mkv', 'a_H265-CPU.mkv'], inspectResult: () => generatedInspection(outputId) });
  const plan = await h.prepare();
  const item = plan.items.find(entry => entry.name === 'a.mkv');
  const before = await fs.readFile(path.join(h.input, item.outputName));
  const result = await h.service.reencodeOutputs({ planId: plan.planId, fileIds: [item.id] });
  const blocked = result.items.find(entry => entry.id === item.id);
  assert.equal(blocked.status, 'skipped');
  assert.equal(blocked.origin.kind, 'generated');
  assert.match(blocked.reason, /protected/);
  assert.deepEqual(await fs.readFile(path.join(h.input, item.outputName)), before);
  assert.equal(h.calls.length, 0);
});

test('resolved recipe details follow production settings and reject renderer argument injection', async t => {
  const h = await harness(t, { names: ['a.mkv'] });
  const first = await h.prepare();
  const one = h.service.getEncodingDetails({ planId: first.planId, fileId: first.items[0].id });
  assert.equal(one.args[one.args.indexOf('-crf:v:0') + 1], '25');
  assert.equal(one.args[one.args.indexOf('-preset:v:0') + 1], 'slow');
  h.request.settings = { profileId: 'h265-nvidia', preset: 'p7', quality: 30 };
  const second = await h.prepare();
  const two = h.service.getEncodingDetails({ planId: second.planId, fileId: second.items[0].id });
  assert.equal(two.args[two.args.indexOf('-cq:v:0') + 1], '30');
  assert.equal(two.args[two.args.indexOf('-preset:v:0') + 1], 'p7');
  assert.equal(two.args[two.args.indexOf('-c:v:0') + 1], 'hevc_nvenc');
  assert.throws(() => h.service.getEncodingDetails({ planId: first.planId, fileId: first.items[0].id }), { code: 'STALE_PLAN' });
  assert.throws(() => h.service.getRecipe({ ...h.request.settings, args: ['-y'] }), { code: 'INVALID_SETTINGS' });
  const pristine = [...two.args]; two.args[0] = '-y';
  assert.deepEqual(h.service.getEncodingDetails({ planId: second.planId, fileId: second.items[0].id }).args, pristine);
  const recipe = h.service.getRecipe(h.request.settings);
  assert.equal(recipe.qualityMode, 'CQ');
  await h.finish(second);
  assert.deepEqual(h.calls[0].args.slice(0, -1), pristine.slice(0, -1));
});

test('missing or corrupted output description is rejected before publication despite a valid identity marker', async t => {
  const h = await harness(t, { names: ['a.mkv'], outputTags: tags => ({ ...tags, FFMPEG_ENCODER_GENERATION: '{}' }) });
  const result = await h.finish(await h.prepare());
  assert.equal(result.counts.failed, 1);
  assert.match(result.items[0].reason, /generation description/);
  assert.deepEqual(await fs.readdir(h.output), []);
});

const archiveSettings = { profileId: ARCHIVE_RECIPE.profileId, preset: ARCHIVE_RECIPE.preset,
  quality: ARCHIVE_RECIPE.quality, recipeId: ARCHIVE_RECIPE.id };

for (const [label, recipes] of [
  ['missing capability result', undefined],
  ['unavailable recipe', [{ id: ARCHIVE_RECIPE.id, available: false, supportedBitDepths: [] }]],
  ['unrelated recipe ID', [{ id: 'unknown-future', available: true, supportedBitDepths: [8, 10] }]],
]) test(`preparation rejects ${label} before inspection even when ordinary HEVC is available`, async t => {
  let inspected = 0;
  const h = await harness(t, { names: ['source.mkv'], onInspect: () => { inspected++; } });
  await h.service.getCapabilities();
  h.service.capabilityResult.recipes = recipes;
  h.request.settings = { ...archiveSettings };
  await h.service.saveSettings(h.request.settings);
  await assert.rejects(h.prepare(), { code: 'UNAVAILABLE_RECIPE' });
  assert.equal(h.service.plan, null);
  assert.equal(inspected, 0);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(await fs.readdir(h.output), []);
  assert.equal((await h.service.getPreferences()).settingsByProfile['h265-nvidia'].recipeId, ARCHIVE_RECIPE.id);
});

test('a recipe capability cannot bypass an unavailable base encoder profile', async t => {
  const h = await harness(t, { names: ['source.mkv'] });
  await h.service.getCapabilities();
  h.service.capabilityResult.profiles.find(profile => profile.id === 'h265-nvidia').available = false;
  h.service.capabilityResult.recipes = [{ id: ARCHIVE_RECIPE.id, available: true, supportedBitDepths: [8, 10] }];
  h.request.settings = { ...archiveSettings };
  await assert.rejects(h.prepare(), { code: 'UNAVAILABLE_PROFILE' });
  assert.equal(h.service.plan, null);
  assert.equal(h.calls.length, 0);
});

for (const supportedDepth of [8, 10]) test(`recipe preparation admits only the explicitly supported ${supportedDepth}-bit inputs`, async t => {
  const h = await harness(t, { names: ['eight.mkv', 'ten.mkv'], inspectResult: file => {
    const value = inspection();
    if (path.basename(file) === 'ten.mkv') { value.probe.streams[0].pix_fmt = 'yuv420p10le'; value.summary.bitDepth = 10; }
    return value;
  } });
  await h.service.getCapabilities();
  h.service.capabilityResult.recipes = [{ id: ARCHIVE_RECIPE.id, available: true, supportedBitDepths: [supportedDepth] }];
  h.request.settings = { ...archiveSettings };
  const plan = await h.prepare();
  const accepted = plan.items.find(item => item.name === (supportedDepth === 8 ? 'eight.mkv' : 'ten.mkv'));
  const rejected = plan.items.find(item => item.id !== accepted.id);
  assert.equal(accepted.status, 'ready');
  assert.equal(rejected.status, 'unsupported');
  assert.match(rejected.reason, /recipe has not passed a real encode\/decode check for this input bit depth/);
  assert.equal(h.service.plan.entries.has(rejected.id), false);
  assert.throws(() => h.service.getEncodingDetails({ planId: plan.planId, fileId: rejected.id }), { code: 'UNPREPARED_FILE' });
  assert.throws(() => h.service.startBatch({ planId: plan.planId, fileIds: [rejected.id] }), { code: 'INVALID_SELECTION' });
  const details = h.service.getEncodingDetails({ planId: plan.planId, fileId: accepted.id });
  assert.equal(details.args[details.args.indexOf('-tune:v:0') + 1], 'uhq');
  assert.equal(details.args[details.args.indexOf('-pix_fmt:v:0') + 1], supportedDepth === 8 ? '+yuv420p' : 'p010le');
  const result = await h.finish(plan);
  assert.equal(result.counts.success, 1);
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].args.slice(0, -1), details.args.slice(0, -1));
  const description = h.service.plan.entries.get(accepted.id).generationDescription;
  assert.equal(description.recipeId, ARCHIVE_RECIPE.id);
  assert.equal(description.bitDepth, supportedDepth);
});

test('a remembered recipe survives restart but cannot gain availability or silently fall back', async t => {
  const h = await harness(t, { names: ['source.mkv'] });
  await h.service.saveSettings(archiveSettings);
  const restarted = new EncoderService({ ffmpeg: 'injected-ffmpeg', ffprobe: 'injected-ffprobe', stateDir: h.stateDir,
    capabilities: async () => ({ profiles: PROFILES.map(profile => ({ ...profile, available: true, supportedBitDepths: [8, 10] })),
      recipes: [{ id: ARCHIVE_RECIPE.id, available: false, supportedBitDepths: [], reason: 'Injected unsupported device.' }] }) });
  const remembered = await restarted.getPreferences();
  assert.equal(remembered.profileId, 'h265-nvidia');
  assert.equal(remembered.settingsByProfile['h265-nvidia'].recipeId, ARCHIVE_RECIPE.id);
  assert.notEqual(remembered.inputFolder.id, h.request.inputFolderId);
  assert.notEqual(remembered.outputFolder.id, h.request.outputFolderId);
  await assert.rejects(restarted.prepareBatch({ inputFolderId: remembered.inputFolder.id, outputFolderId: remembered.outputFolder.id,
    settings: { profileId: remembered.profileId, ...remembered.settingsByProfile[remembered.profileId] } }), { code: 'UNAVAILABLE_RECIPE' });
  assert.equal(restarted.plan, null);
  const after = await restarted.getPreferences();
  assert.deepEqual(after.settingsByProfile['h265-nvidia'], remembered.settingsByProfile['h265-nvidia']);
  assert.deepEqual(await fs.readdir(h.output), []);
});

for (const change of ['replace-file', 'delete-file', 'replace-directory']) {
  test(`post-validation ${change} never leaves a stale validated-staged disposition`, async t => {
    const h = await harness(t, { names: ['a.mp4'] });
    const assess = h.service.assessCompletedSource.bind(h.service);
    let priorValidated, temporary;
    h.service.assessCompletedSource = async (...args) => {
      const assessment = await assess(...args);
      temporary = h.calls.at(-1).temporary;
      if (change === 'delete-file') await fs.unlink(temporary);
      else if (change === 'replace-file') {
        priorValidated = path.join(path.dirname(temporary), 'previously-validated.mkv');
        await fs.rename(temporary, priorValidated);
        await fs.writeFile(temporary, 'Unvalidated replacement');
      } else {
        const moved = path.dirname(temporary) + '-moved';
        await fs.rename(path.dirname(temporary), moved);
        priorValidated = path.join(moved, path.basename(temporary));
        await fs.mkdir(path.dirname(temporary));
        await fs.writeFile(temporary, 'Unvalidated replacement');
      }
      return assessment;
    };
    const result = await h.finish(await h.prepare());
    const item = result.items[0];
    assert.equal(item.status, 'failed');
    assert.equal(item.reasonCode, 'STAGE_CHANGED');
    assert.equal(item.outputDisposition.kind, change === 'delete-file' ? 'stage-unavailable' : 'retained-unverified');
    assert.equal(item.outputDisposition.published, false);
    assert.equal(item.outputDisposition.validationCurrent, false);
    await assert.rejects(fs.stat(path.join(h.output, 'a_H265-CPU.mkv')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(h.input, 'a.mp4'), 'utf8'), 'Original input a.mp4');
    if (priorValidated) {
      assert.equal(await fs.readFile(priorValidated, 'utf8'), 'Encoded output a.mp4');
      assert.equal(await fs.readFile(temporary, 'utf8'), 'Unvalidated replacement');
    } else await assert.rejects(fs.stat(path.dirname(temporary)), { code: 'ENOENT' });
  });
}

test('uncertain publication remains distinct from retained staging and never claims validated destination bytes', async t => {
  const h = await harness(t, { names: ['a.mp4'], sameFolder: true });
  const destination = path.join(h.output, 'a_H265-CPU.mkv');
  const link = fs.link;
  let priorValidated;
  t.mock.method(fs, 'link', async (source, target) => {
    if (source === h.calls.at(-1)?.temporary && target === destination) {
      priorValidated = path.join(path.dirname(source), 'previously-validated.mkv');
      await fs.rename(source, priorValidated);
      await fs.writeFile(source, 'Unvalidated publication replacement');
    }
    return link(source, target);
  });
  const result = await h.finish(await h.prepare());
  const item = result.items[0];
  assert.equal(item.status, 'failed');
  assert.equal(item.reasonCode, 'PUBLICATION_UNCERTAIN');
  assert.equal(item.outputDisposition.kind, 'publication-uncertain');
  assert.equal(item.outputDisposition.published, null);
  assert.equal(item.outputDisposition.file, destination);
  assert.equal(item.outputDisposition.validationCurrent, false);
  assert.equal(item.outputDisposition.stage.kind, 'retained-unverified');
  assert.equal(await fs.readFile(destination, 'utf8'), 'Unvalidated publication replacement');
  assert.equal(await fs.readFile(priorValidated, 'utf8'), 'Encoded output a.mp4');
  assert.equal(await fs.readFile(path.join(h.input, 'a.mp4'), 'utf8'), 'Original input a.mp4');
});

test('successful publication is never demoted when unrelated staging contents prevent directory cleanup', async t => {
  const h = await harness(t, { names: ['a.mp4'] });
  const recordPublished = h.service.provenanceJournal.recordPublished.bind(h.service.provenanceJournal);
  let retainedFile;
  h.service.provenanceJournal.recordPublished = async (...args) => {
    const recorded = await recordPublished(...args);
    retainedFile = path.join(path.dirname(h.calls.at(-1).temporary), 'keep-unrelated.txt');
    await fs.writeFile(retainedFile, 'Do not remove unrelated staging contents');
    return recorded;
  };
  const result = await h.finish(await h.prepare());
  const item = result.items[0];
  assert.equal(item.status, 'success');
  assert.equal(item.outputDisposition.kind, 'published');
  assert.equal(item.outputDisposition.published, true);
  assert.equal(item.cleanup.retained, true);
  assert.equal(await fs.readFile(item.outputDisposition.file, 'utf8'), 'Encoded output a.mp4');
  assert.equal(await fs.readFile(retainedFile, 'utf8'), 'Do not remove unrelated staging contents');
});

test('incomplete cleanup after failed publication cannot retain a current-validation claim', async t => {
  const h = await harness(t, { names: ['a.mp4'] });
  const assess = h.service.assessCompletedSource.bind(h.service);
  let temporary, cleanupStatFailed = false;
  const lstat = fs.lstat;
  h.service.assessCompletedSource = async (...args) => {
    const assessment = await assess(...args);
    temporary = h.calls.at(-1).temporary;
    await fs.unlink(temporary);
    t.mock.method(fs, 'lstat', async (file, options) => {
      // Publication inspects the missing file first; cleanup then cannot inspect
      // its owned directory. Both are real main-owned paths, no media process.
      if (cleanupStatFailed && file === path.dirname(temporary)) throw failure('EIO', 'Injected cleanup stat failure');
      if (file === temporary) cleanupStatFailed = true;
      return lstat(file, options);
    });
    return assessment;
  };
  const result = await h.finish(await h.prepare());
  assert.equal(result.items[0].status, 'failed');
  assert.equal(result.items[0].outputDisposition.kind, 'stage-unverified');
  assert.equal(result.items[0].outputDisposition.validationCurrent, false);
  assert.equal(result.phase, 'failed');
  assert.match(result.error, /Could not clean owned temporary output/);
});
