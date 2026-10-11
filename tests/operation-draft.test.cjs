'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { OperationDraft } = require('../src/operation-draft.cjs');
const { OPERATION_DEFAULTS } = require('../src/operation-contract.cjs');

function fixture(operation = 'encode') {
  const app = { defaults: { ...OPERATION_DEFAULTS }, revision: 2 };
  const draft = new OperationDraft({ operation, appDefaults: app.defaults, appDefaultsRevision: app.revision });
  const ids = [randomUUID(), randomUUID()];
  draft.addSources(ids.map(fileId => ({ fileId, identityRevision: 0 })));
  const request = extra => ({ draftId: draft.id, revision: draft.snapshot().revision, ...extra });
  return { app, draft, ids, request };
}
test('new files start Full and inherit a captured app snapshot, not future settings mutation', () => {
  const { draft, app, ids } = fixture(); app.defaults.fullAudioPolicy = 'precision-aac';
  assert.equal(draft.fileRequest(ids[0]).range, null);
  assert.equal(draft.fileRequest(ids[0]).audioPolicy, 'copy');
  assert.equal(draft.fileRequest(ids[0]).origins.audioPolicy, 'app');
  assert.equal(draft.snapshot().batchDefaults.appDefaultsRevision, 2);
  assert.throws(() => { draft.snapshot().files[0].request.audioPolicy = 'injected'; }, TypeError);
  assert.throws(() => { draft.id = randomUUID(); }, TypeError);
});
test('file range changes precision policy and explicit batch application preserves unrelated file choices', () => {
  const { draft, ids, request } = fixture();
  const changed = draft.setFiles(request({ fileIds: [ids[0]], overrides: { range: { startUs: 120000, endUs: 2300000 }, resolution: '720' } }));
  assert.deepEqual(changed.changedFileIds, [ids[0]]);
  assert.equal(changed.invalidateTemporaryAuthority, true);
  assert.equal(draft.fileRequest(ids[0]).audioPolicy, 'precision-aac');
  assert.equal(draft.fileRequest(ids[0]).origins.resolution, 'file');
  assert.equal(draft.fileRequest(ids[1]).range, null);
  const batch = draft.setBatchOverrides(request({ overrides: { resolution: '1080' } }));
  assert.deepEqual(batch.changedFileIds, [ids[1]]);
  assert.equal(draft.fileRequest(ids[0]).resolution, '720');
  assert.equal(draft.fileRequest(ids[1]).resolution, '1080');
  assert.equal(draft.fileRequest(ids[1]).origins.resolution, 'batch');
});
test('multi-file changes validate atomically, reject foreign IDs and stale revisions', () => {
  const { draft, ids, request } = fixture(); const before = draft.snapshot();
  for (const extra of [
    { fileIds: ids, overrides: { range: { startUs: 20, endUs: 10 } } },
    { fileIds: [ids[0], randomUUID()], overrides: {} },
    { fileIds: [ids[0], ids[0]], overrides: {} },
    { fileIds: ids, overrides: { args: ['-y'] } },
    { fileIds: ids, overrides: { aacBitrateKbps: NaN } },
  ]) { assert.throws(() => draft.setFiles(request(extra))); assert.deepEqual(draft.snapshot(), before); }
  const stale = request({ fileIds: ids, overrides: {} });
  draft.setFiles(request({ fileIds: ids, overrides: { range: { startUs: 0, endUs: 1000000 } } }));
  assert.throws(() => draft.setFiles(stale), { code: 'STALE_DRAFT' });
});
test('explicit app-default refresh clears batch choices but retains file overrides unless requested', () => {
  const { draft, ids, request } = fixture();
  draft.setBatchOverrides(request({ overrides: { resolution: '1080' } }));
  draft.setFiles(request({ fileIds: [ids[0]], overrides: { resolution: '720' } }));
  const app = { defaults: { ...OPERATION_DEFAULTS, resolution: '1440' }, revision: 7 };
  draft.applyAppDefaults(request({ resetFileOverrides: false }), app);
  assert.equal(draft.fileRequest(ids[0]).resolution, '720');
  assert.equal(draft.fileRequest(ids[1]).resolution, '1440');
  assert.equal(draft.fileRequest(ids[1]).origins.resolution, 'app');
  assert.equal(draft.fileRequest(ids[1]).appDefaultsRevision, 7);
  draft.applyAppDefaults(request({ resetFileOverrides: true }), app);
  assert.equal(draft.fileRequest(ids[0]).resolution, '1440');
});
test('frozen queue snapshots cannot change through later draft/default edits or external objects', () => {
  const { draft, ids, request } = fixture();
  const queued = draft.freezeForQueue(request({ fileIds: [ids[0]] }));
  assert.equal(queued.requests.length, 1); assert.equal(draft.snapshot().frozen, true);
  assert.throws(() => draft.setFiles(request({ fileIds: ids, overrides: {} })), { code: 'FROZEN_DRAFT' });
  assert.throws(() => draft.setBatchOverrides(request({ overrides: {} })), { code: 'FROZEN_DRAFT' });
  assert.throws(() => draft.applyAppDefaults(request({ resetFileOverrides: true }), { defaults: OPERATION_DEFAULTS, revision: 20 }), { code: 'FROZEN_DRAFT' });
  assert.throws(() => { queued.requests[0].range = { endUs: 10 }; }, TypeError);
});
test('new drafts cannot restore source decisions, generated grants or queued authority', () => {
  const { draft, ids, request } = fixture();
  assert.throws(() => draft.setFiles({ ...request({ fileIds: ids, overrides: {} }), reencodeAuthorized: true }), { code: 'INVALID_DRAFT_REQUEST' });
  assert.throws(() => draft.setFiles(request({ fileIds: ids, overrides: { sourceFingerprint: 'x' } })));
  draft.setFiles(request({ fileIds: [ids[0]], overrides: { omissionRequestIds: ['display-decision-id'] } }));
  assert.equal(draft.fileRequest(ids[0]).omissionAuthority, 'unbound-request-ids');
  const fresh = fixture();
  assert.notEqual(fresh.draft.id, draft.id);
  assert.throws(() => fresh.draft.setFiles(request({ fileIds: ids, overrides: {} })), { code: 'STALE_DRAFT' });
});
test('remux refuses time range/transform overrides and returns only full-copy requests', () => {
  const { draft, ids, request } = fixture('remux');
  assert.throws(() => draft.setFiles(request({ fileIds: ids, overrides: { range: { endUs: 1000 } } })));
  assert.throws(() => draft.setFiles(request({ fileIds: ids, overrides: { resolution: '720' } })));
  const snapshot = draft.setBatchOverrides(request({ overrides: { remuxTarget: 'mp4' } })).snapshot;
  assert.equal(snapshot.files[0].request.target, 'mp4');
  assert.equal(snapshot.files[0].request.range, null);
  assert.equal(snapshot.files[0].request.audioPolicy, 'copy');
});
test('source admission is transactional, bounded and one-time within a draft', () => {
  const draft = new OperationDraft({ operation: 'encode', appDefaults: {}, appDefaultsRevision: 0 });
  const id = randomUUID();
  assert.throws(() => draft.addSources([{ fileId: id, identityRevision: 0 }, { fileId: 'C:\\source.mp4', identityRevision: 0 }]), { code: 'INVALID_DRAFT_SOURCES' });
  assert.equal(draft.snapshot().files.length, 0);
  draft.addSources([{ fileId: id, identityRevision: 0 }]);
  assert.throws(() => draft.addSources([{ fileId: randomUUID(), identityRevision: 0 }]), { code: 'FROZEN_DRAFT' });
});

test('per-field multi-file edits preserve other overrides and validate the entire patch before mutation', () => {
  const { draft, ids, request } = fixture();
  draft.setFiles(request({ fileIds: [ids[0]], overrides: { resolution: '720', range: { endUs: 1000000 } } }));
  draft.patchFiles(request({ fileIds: ids, overrides: { audioPolicy: 'precision-flac' } }));
  assert.equal(draft.fileRequest(ids[0]).resolution, '720');
  assert.deepEqual(draft.fileRequest(ids[0]).range, { endUs: 1000000 });
  assert.equal(draft.fileRequest(ids[1]).range, null);
  assert.ok(ids.every(id => draft.fileRequest(id).audioPolicy === 'precision-flac'));
  const before = draft.snapshot();
  assert.throws(() => draft.patchFiles(request({ fileIds: ids, overrides: { range: { startUs: 2, endUs: 1 } } })));
  assert.deepEqual(draft.snapshot(), before);
  let read = false; const overrides = {};
  Object.defineProperty(overrides, 'resolution', { enumerable: true, get() { read = true; return '1080'; } });
  assert.throws(() => draft.patchFiles(request({ fileIds: ids, overrides })));
  assert.equal(read, false); assert.deepEqual(draft.snapshot(), before);
  draft.setFiles(request({ fileIds: [ids[0]], overrides: {} }));
  assert.equal(draft.fileRequest(ids[0]).range, null); assert.equal(draft.fileRequest(ids[0]).resolution, 'source');
  assert.equal(draft.fileRequest(ids[1]).audioPolicy, 'precision-flac');
});
