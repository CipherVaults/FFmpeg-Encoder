'use strict';
// C4: genuine runtime, source, queue, oracle and publication over synthetic
// bytes/children and injected policy rows. No vendor hardware or media run.
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs/promises'), nodeFs = require('node:fs'), path = require('node:path');
const { randomUUID } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { NativeFileRuntimeOwner } = require('../src/native-file-runtime.cjs');
const { NativeFileSourceOwner } = require('../src/native-file-source.cjs');
const { readNativeFileContract } = require('../src/native-file-contract.cjs');
const { createTestNativeFileControls, NATIVE_MESSAGES } = require('../src/native-file-controls.cjs');
const { nativeDisposition, executeNativeJob } = require('../src/native-file-workspace.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { PROFILES } = require('../src/media.cjs');
const { capabilityKey } = require('../src/backend-adapters.cjs');
const { fixture, referenceFor, nativeInspection, deferred, tick, sha } = require('./native-file-fixture.cjs');
const fault = (code = 'EACCES') => Object.assign(new Error('private-error C:\\zq-secret\\input.mp4 destination executable argv errno'),
  { code, stderr: 'zq-secret stderr', cause: new Error('zq-secret cause') });
function wrap(t, object, key, action) {
  const original = object[key]; object[key] = function (...args) { return action.call(this, original.bind(this), ...args); };
  t.after(() => { object[key] = original; });
}
async function harness(t, { changes = {}, editReference, editPolicy, extra = 0 } = {}) {
  const h = await fixture(t, { matroska: true, ...changes });
  await h.owner.close();
  const stateDir = path.join(h.root, 'state'), output = path.join(h.root, 'published');
  await fs.mkdir(stateDir); await fs.mkdir(output);
  const reference = referenceFor(h), policy = { ...h.policy, reference: editReference ? editReference(reference) : reference };
  editPolicy?.(policy);
  // The moved fake child has one source filename. Normalize additional source
  // names only inside its simulation of probe/raw output, retaining real queue
  // source identity checks and the original encode invocation.
  const run = (executable, argv, options) => h.config.run(executable,
    executable === h.runtime.ffprobe.file || argv.includes('rawvideo')
      ? argv.map(v => typeof v === 'string' && /^source-\d+\.mp4$/.test(path.basename(v)) ? h.source : v) : argv, options);
  const controls = createTestNativeFileControls({ runtime: h.runtime, stateDir, nativeBackends: h.native, policies: [policy], run });
  const probe = structuredClone(readNativeFileContract(h.contract).probe);
  for (let i = 0; i < extra; i++) await fs.copyFile(h.source, path.join(h.root, `source-${i}.mp4`));
  const s = new EncoderService({ ffmpeg: h.runtime.ffmpeg.file, ffprobe: h.runtime.ffprobe.file, stateDir, nativeBackends: h.native,
    nativeFiles: controls, allowInjectedNativeFiles: true, inspectionCache: null, inspectionWorkers: 1,
    storageEligibility: { check: async () => ({ eligible: false }) }, inspect: async () => nativeInspection(structuredClone(probe)),
    capabilities: async () => ({ profiles: PROFILES.map(p => ({ ...p, available: true })), versions: {} }),
    run: async () => { throw new Error('ordinary runner must not encode a native job'); } });
  const events = [], snapshots = [], counts = { intent: 0, published: 0, verify: 0, source: 0, inspect: 0 }, published = [];
  s.on('update', value => snapshots.push(value));
  wrap(t, s, 'recordIncident', async (original, event) => { events.push(structuredClone(event)); return original(event); });
  wrap(t, s, 'verifyFolders', async original => { counts.verify++; return original(); });
  wrap(t, s, 'assertSourceMatches', async (original, ...args) => { counts.source++; return original(...args); });
  wrap(t, s, 'inspect', async (original, ...args) => { counts.inspect++; return original(...args); });
  wrap(t, s.provenanceJournal, 'recordIntent', async (original, ...args) => {
    assert.equal(s.nativeFileRuntime.snapshot().phase, 'prepared-runtime'); counts.intent++; return original(...args);
  });
  wrap(t, s.provenanceJournal, 'recordPublished', async (original, ...args) => {
    counts.published++; published.push(args); assert.deepEqual(args[1], await readSourceIdentity(args[1].canonicalPath)); return original(...args);
  });
  await s.getCapabilities();
  const inputFolder = await s.registerFolder(h.root, 'input'), outputFolder = await s.registerFolder(output, 'output');
  const selection = h.native.snapshot().selection;
  const ready = await s.prepareNativeFileBatch({ inputFolderId: inputFolder.id, outputFolderId: outputFolder.id,
    selectionId: selection.selectionId, revision: h.native.snapshot().revision });
  assert.equal(ready.phase, 'ready'); assert.ok(ready.items.every(i => i.status === 'ready'), JSON.stringify(ready.items));
  Object.assign(h, { s, stateDir, output, ready, probe, policy, counts, published, events, snapshots });
  h.item = s.state.items[0]; h.entry = s.plan.entries.get(h.item.id);
  h.start = () => s.startBatch({ planId: ready.planId, fileIds: ready.items.map(i => i.id) });
  h.finish = async () => { h.start(); await s.taskPromise; return s.snapshot(); };
  t.after(async () => {
    h.releaseEncode.resolve(); h.releaseLease.resolve();
    await s.cancelCurrent().catch(() => {}); await s.closeOperationResources().catch(() => {}); await s.closeDiagnostics().catch(() => {});
  });
  return h;
}
const noEncode = h => assert.equal(h.calls.filter(c => c.argv.includes('-c:v:0')).length, 0);
// A broken guard must fail its mutation test, not wait forever for a stage
// that a prematurely ended job can no longer reach.
const checkpoint = (h, reached) => Promise.race([reached, h.s.taskPromise.then(() => { throw new Error('Job ended before the expected checkpoint.'); })]);
const absent = async file => assert.rejects(fs.access(file), { code: 'ENOENT' });
const safe = value => {
  const text = JSON.stringify(value);
  assert.doesNotMatch(text, /zq-secret|private-error|ERR_ASSERTION|EACCES|EPERM|synthetic-test-only|synthetic-fixture-not-hardware-proof|native-v1:|[a-f0-9]{64}|-init_hw_device|-hide_banner/);
  const visit = v => { if (v && typeof v === 'object') for (const [key, child] of Object.entries(v)) {
    assert.ok(!['argv', 'actualArgs', 'executable', 'destination', 'policyId', 'nativeCellKey', 'evidenceIds', 'selectionEvidenceId', 'token', 'contract', 'selection'].includes(key), key); visit(child);
  } }; visit(value);
};
async function safeRecords(h) {
  const history = await h.s.getDiagnosticHistory({ limit: 200 });
  const native = history.events.filter(e => ['ENCODE_STARTED', 'ENCODE_CLOSED', 'OUTPUT_CHECKED', 'JOB_FAILED', 'JOB_CANCELLED',
    'JOB_DISPOSITION', 'NATIVE_PUBLICATION_CHANGED', 'NATIVE_PROVENANCE_PENDING'].includes(e.reason));
  for (const row of native) {
    const result = await h.s.getDiagnosticRecord({ eventId: row.id });
    assert.ok(result.event, row.reason); safe(result.event);
    assert.equal(result.event.context.nativePrivate, '[main-only]');
  }
  if (native.length) safe((await h.s.getDiagnosticExport({ eventIds: native.map(e => e.id).slice(0, 50) })).data);
}
const storedEvent = async (h, id) => JSON.parse(await fs.readFile(path.join(h.stateDir, 'diagnostics-v1', 'events', id + '.json'), 'utf8')).event;

test('NS-10: forged/stale Start and unavailable controls leave ready authority untouched; a later valid Start runs', async t => {
  const h = await harness(t), token = h.entry.selection, contract = h.entry.contract, controls = h.s.nativeFiles;
  const attempt = (code) => {
    const before = h.s.snapshot();
    assert.throws(h.start, { code, message: NATIVE_MESSAGES[code] });
    assert.deepEqual(h.s.snapshot(), before); assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeFileJob, null); noEncode(h);
  };
  h.entry.selection = { ...token }; attempt('NATIVE_FILE_SELECTION_STALE'); h.entry.selection = token;
  const requireSelection = h.native.requireFileSelection;
  h.native.requireFileSelection = () => { throw fault('NATIVE_BACKEND_BUSY'); }; attempt('NATIVE_BACKEND_BUSY');
  h.native.requireFileSelection = requireSelection;
  // Readiness is an independent Start gate, even when the genuine selection
  // and exact file assessment still pass. Project an unavailable inventory.
  const snapshot = h.native.snapshot;
  h.native.snapshot = function () {
    const view = snapshot.call(this);
    return { ...view, native: { ...view.native, profiles: view.native.profiles.map(p => ({ ...p, reason: 'MISSING_DEVICE' })) } };
  };
  attempt('NATIVE_HARDWARE_UNAVAILABLE'); h.native.snapshot = snapshot;
  h.entry.contract = { ...contract }; attempt('NATIVE_FILE_CONTRACT_UNOWNED'); h.entry.contract = contract;
  h.entry.native = false; attempt('NATIVE_FILE_CONTRACT_UNOWNED'); h.entry.native = true;
  h.s.nativeFiles = { ...controls }; attempt('NATIVE_FILE_RUNTIME_UNAVAILABLE'); h.s.nativeFiles = controls;
  // Reference-less and nonmatching catalogs cannot renew Start admission.
  for (const policies of [[{ ...h.policy, reference: undefined }], [{ ...h.policy, sourceProbeFingerprint: '0'.repeat(64) }]]) {
    h.s.nativeFiles = createTestNativeFileControls({ runtime: h.runtime, stateDir: h.stateDir, nativeBackends: h.native, policies, run: h.config.run });
    attempt(policies[0].reference ? 'NATIVE_FILE_POLICY_REQUIRED' : 'NATIVE_FILE_REFERENCE_REQUIRED');
  }
  h.s.nativeFiles = controls;
  await h.finish(); assert.equal(h.item.status, 'success');
});

test('NS-11/NS-09d: exact reference publishes once, records the verified identity and keeps frozen details after authority drop', async t => {
  const h = await harness(t), details = h.entry.details, selection = h.entry.selection, foldersBefore = h.counts.verify;
  await h.finish();
  assert.equal(h.s.state.phase, 'completed'); assert.equal(h.item.status, 'success', JSON.stringify(h.events.filter(e => e.reason === 'JOB_FAILED'))); assert.equal(h.item.outcome, 'saved');
  assert.deepEqual(h.item.outputDisposition, { kind: 'published', published: true });
  assert.equal(h.counts.intent, 1); assert.equal(h.counts.published, 1);
  assert.equal(h.counts.verify - foldersBefore, 3, 'initial, early publication and immediate pre-link folder checks');
  assert.equal(h.published[0][0], h.entry.outputId);
  // Removing the stage's hard link can change ctime after recordPublished.
  const { ctimeNs: beforeCleanup, ...publishedIdentity } = h.published[0][1];
  const { ctimeNs: afterCleanup, ...currentIdentity } = await readSourceIdentity(h.entry.destination);
  assert.deepEqual(publishedIdentity, currentIdentity);
  assert.equal(sha(await fs.readFile(h.entry.destination)), sha(h.encoded.bytes));
  assert.equal(h.entry.selection, null); assert.equal(h.entry.contract, null); assert.equal(h.s.plan.nativeSelection, null);
  assert.equal(h.entry.details, details); assert.ok(Object.isFrozen(details)); assert.equal(Object.hasOwn(h.entry, 'actualArgs'), false);
  assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeFileJob, null); assert.equal(h.s.nativeMediaSlot, null);
  const reasons = h.events.map(e => e.reason);
  assert.ok(reasons.indexOf('ENCODE_STARTED') < reasons.indexOf('ENCODE_CLOSED'));
  assert.ok(reasons.indexOf('ENCODE_CLOSED') < reasons.indexOf('OUTPUT_CHECKED'));
  assert.ok(reasons.indexOf('OUTPUT_CHECKED') < reasons.indexOf('JOB_DISPOSITION'));
  const started = h.events.find(e => e.reason === 'ENCODE_STARTED');
  assert.equal(started.context.nativePrivate.nativeCellKey, capabilityKey(selection.policy));
  assert.ok(started.context.nativePrivate.argv.includes('-c:v:0'));
  assert.equal(started.context.contractId, 'native-file-h264-bt709-full-v1');
  const history = await h.s.getDiagnosticHistory({ limit: 200 });
  const stored = await storedEvent(h, history.events.find(e => e.reason === 'ENCODE_STARTED').id);
  assert.deepEqual(stored.context.nativePrivate.evidenceIds, ['synthetic-fixture-not-hardware-proof']);
  assert.equal(stored.context.nativePrivate.selectionEvidenceId, selection.evidenceId);
  assert.deepEqual(h.entry.evidenceIds, h.policy.evidenceIds); assert.ok(Object.isFrozen(h.entry.evidenceIds));
  const scanSelectionEvidence = value => {
    if (typeof value === 'string') assert.ok(!value.includes(selection.evidenceId));
    else if (value && typeof value === 'object') Object.values(value).forEach(scanSelectionEvidence);
  };
  const readable = (await h.s.getDiagnosticRecord({ eventId: stored.id })).event;
  const exported = (await h.s.getDiagnosticExport({ eventIds: [stored.id] })).data;
  [h.snapshots, h.s.getEncodingDetails({ planId: h.ready.planId, fileId: h.item.id }), readable, exported].forEach(scanSelectionEvidence);
  h.snapshots.forEach(s => safe(s.items)); safe(h.s.getEncodingDetails({ planId: h.ready.planId, fileId: h.item.id })); await safeRecords(h);
});

test('NS-11: cross-volume EXDEV copy is exclusive and the runtime reads the complete published bytes back', async t => {
  const h = await harness(t); let copies = 0, readbacks = 0;
  wrap(t, fs, 'link', async (original, from, to) => { if (to === h.entry.destination) throw fault('EXDEV'); return original(from, to); });
  wrap(t, fs, 'copyFile', async (original, from, to, flags) => { assert.equal(flags, nodeFs.constants.COPYFILE_EXCL); copies++; return original(from, to, flags); });
  wrap(t, nodeFs, 'createReadStream', (original, file, ...args) => { if (file === h.entry.destination) readbacks++; return original(file, ...args); });
  await h.finish(); assert.equal(h.item.status, 'success'); assert.equal(copies, 1); assert.equal(readbacks, 1); assert.equal(h.counts.published, 1);
});

test('NS-11: failed provenance bookkeeping is a fixed warning after verified publication', async t => {
  const h = await harness(t);
  wrap(t, h.s.provenanceJournal, 'recordPublished', async () => { throw fault(); });
  await h.finish(); assert.equal(h.item.status, 'success'); assert.equal(h.item.outcome, 'saved-with-warning');
  assert.equal(h.item.reason, NATIVE_MESSAGES.NATIVE_PROVENANCE_PENDING); assert.equal(h.item.outputDisposition.kind, 'published');
  assert.ok(await fs.readFile(h.entry.destination)); safe(h.item); await safeRecords(h);
});

test('NS-12: source changes before the lease and after validate refuse without publication', async t => {
  for (const when of ['before-encode', 'after-provenance-check', 'after-validate']) await t.test(when, async t => {
    const h = await harness(t);
    if (when === 'after-validate') wrap(t, NativeFileRuntimeOwner.prototype, 'validate', async (original, ...args) => {
      const result = await original(...args); await fs.writeFile(h.source, Buffer.alloc(4096, 99)); return result;
    });
    else wrap(t, h.s, 'assertSourceMatches', async (original, entry, signal, stage, ...args) => {
      if (stage === when) await fs.writeFile(h.source, Buffer.alloc(4096, 99)); return original(entry, signal, stage, ...args);
    });
    await h.finish(); assert.equal(h.item.status, 'failed'); assert.equal(h.counts.published, 0); await absent(h.entry.destination);
    if (when !== 'after-validate') { noEncode(h); assert.equal(h.counts.intent, 0); assert.equal(h.s.nativeFiles.keptStages(), null); }
    else assert.equal(h.item.outputDisposition.kind, 'retained-completed');
    safe(h.item);
  });
});

test('NS-12: current marker, provenance identity and probe fingerprint are each rechecked before prepare', async t => {
  for (const changed of ['marker', 'indexed', 'probe']) await t.test(changed, async t => {
    const h = await harness(t);
    if (changed === 'indexed') wrap(t, h.s.provenanceJournal, 'lookupIdentity', async () => ({ outputId: randomUUID() }));
    else wrap(t, h.s, 'inspect', async original => { const r = await original();
      if (changed === 'marker') r.probe.format.tags = { FFMPEG_ENCODER_GENERATED: '1', FFMPEG_ENCODER_OUTPUT_ID: randomUUID() };
      else r.probe.streams[0].index = 3;
      return r;
    });
    await h.finish(); assert.equal(h.item.status, 'failed'); noEncode(h); assert.equal(h.counts.intent, 0);
    assert.equal(h.item.reasonCode, changed === 'probe' ? 'NATIVE_FILE_APPLICABILITY_STALE' : 'GENERATED_SOURCE');
  });
});

test('NS-13: output appeared after preview is skipped without an intent or lease', async t => {
  const h = await harness(t); await fs.writeFile(h.entry.destination, 'owner file'); await h.finish();
  assert.equal(h.item.status, 'skipped'); assert.equal(h.item.reason, NATIVE_MESSAGES.NATIVE_OUTPUT_APPEARED); noEncode(h);
  assert.equal(h.counts.intent, 0); assert.equal(await fs.readFile(h.entry.destination, 'utf8'), 'owner file');
});

test('NS-13: mid-job destination collision retains the validated stage and never records publication', async t => {
  const h = await harness(t);
  wrap(t, NativeFileRuntimeOwner.prototype, 'validate', async (original, ...args) => { const r = await original(...args); await fs.writeFile(h.entry.destination, 'race winner'); return r; });
  await h.finish(); assert.equal(h.item.status, 'skipped'); assert.equal(h.item.outcome, 'destination-collision');
  assert.equal(h.item.outputDisposition.kind, 'retained-completed'); assert.equal(h.item.nativeKeptStages, 1); assert.equal(h.counts.published, 0);
  assert.equal(await fs.readFile(h.entry.destination, 'utf8'), 'race winner');
});

test('NS-13: output folder swapped during a slow complete-source assessment is refused before any link', async t => {
  const h = await harness(t), entered = deferred(), release = deferred(), oldOutput = h.output + '-old'; let links = 0;
  wrap(t, NativeFileSourceOwner.prototype, 'assessCompleted', async (original, ...args) => { entered.resolve(); await release.promise; return original(...args); });
  wrap(t, fs, 'link', async (original, from, to) => { if (to === h.entry.destination) links++; return original(from, to); });
  h.start(); await checkpoint(h, entered.promise);
  await fs.rename(h.output, oldOutput); await fs.symlink(h.root, h.output, 'junction'); release.resolve();
  await h.s.taskPromise; await fs.unlink(h.output);
  assert.equal(h.item.status, 'failed'); assert.ok(['OUTPUT_FOLDER_CHANGED', 'NATIVE_FILE_DESTINATION'].includes(h.item.reasonCode));
  assert.equal(links, 0); assert.equal(h.item.outputDisposition.kind, 'retained-completed');
  await absent(path.join(h.root, h.item.outputName)); await absent(path.join(h.stateDir, h.item.outputName));
});

test('NS-13: protected destinations refuse at initial, early publication and immediate pre-link checks', async t => {
  for (const when of ['initial', 'validated', 'assessed']) await t.test(when, async t => {
    const h = await harness(t); const protect = () => h.s.plan.reservedPaths.add(h.entry.destination.toLowerCase());
    if (when === 'initial') protect();
    else wrap(t, when === 'validated' ? NativeFileRuntimeOwner.prototype : NativeFileSourceOwner.prototype,
      when === 'validated' ? 'validate' : 'assessCompleted', async (original, ...args) => { const r = await original(...args); protect(); return r; });
    await h.finish(); assert.equal(h.item.reasonCode, 'PROTECTED_SOURCE'); assert.equal(h.counts.published, 0); await absent(h.entry.destination);
    if (when === 'initial') noEncode(h);
  });
});

test('NS-13: a destination reserved after validation refuses before runtime.publish is entered', async t => {
  const h = await harness(t); let publishes = 0;
  wrap(t, NativeFileRuntimeOwner.prototype, 'validate', async (original, ...args) => {
    const checked = await original(...args); h.s.plan.reservedPaths.add(h.entry.destination.toLowerCase()); return checked;
  });
  wrap(t, NativeFileRuntimeOwner.prototype, 'publish', async (original, ...args) => { publishes++; return original(...args); });
  await h.finish(); assert.equal(h.item.reasonCode, 'PROTECTED_SOURCE'); assert.equal(publishes, 0);
  assert.equal(h.item.outputDisposition.kind, 'retained-completed'); assert.equal(h.counts.published, 0); await absent(h.entry.destination);
});

test('NS-14: full-SHA refusal at prepare leaves no pending intent or encoder child', async t => {
  const h = await harness(t, { editPolicy: p => { p.sourceSha256 = '0'.repeat(64); p.reference.source.fileSha256 = p.sourceSha256; } });
  await h.finish(); assert.equal(h.item.reasonCode, 'NATIVE_FILE_SOURCE_UNQUALIFIED'); assert.equal(h.counts.intent, 0); noEncode(h);
  assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeMediaSlot, null);
});

test('NS-14: both required persisted records fail closed; intent failures cannot start encoding', async t => {
  for (const point of ['ENCODE_STARTED', 'OUTPUT_CHECKED', 'intent']) await t.test(point, async t => {
    const h = await harness(t);
    if (point === 'intent') wrap(t, h.s.provenanceJournal, 'recordIntent', async () => { throw fault(); });
    else wrap(t, h.s, 'recordIncident', async (original, event) => event.reason === point ? { persisted: false } : original(event));
    await h.finish(); assert.equal(h.item.status, 'failed'); assert.equal(h.counts.published, 0); await absent(h.entry.destination);
    if (point !== 'OUTPUT_CHECKED') noEncode(h);
    assert.equal(h.item.reasonCode, point === 'intent' ? 'NATIVE_FILE_JOB_FAILED' : 'OPERATION_DIAGNOSTICS_INCOMPLETE');
    assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeMediaSlot, null);
  });
});

test('NS-15: cancellation at prepare, encode, evidence, validate and post-link readback drains the queue', async t => {
  for (const point of ['lease', 'hash', 'encode', 'evidence', 'validate', 'readback']) await t.test(point, async t => {
    const h = await harness(t, { changes: point === 'encode' ? { holdEncode: true } : {} }), entered = deferred(), release = deferred();
    const cancel = () => h.s.controller.abort();
    if (point === 'lease') wrap(t, h.s, 'acquireNativeFileSlot', async (original, ...args) => { const r = original(...args); entered.resolve(); await release.promise; return r; });
    if (point === 'hash') wrap(t, NativeFileSourceOwner.prototype, 'seal', async (original, ...args) => { entered.resolve(); await release.promise; return original(...args); });
    if (point === 'evidence') wrap(t, NativeFileRuntimeOwner.prototype, 'collect', async (original, ...args) => { cancel(); return original(...args); });
    if (point === 'validate') wrap(t, NativeFileRuntimeOwner.prototype, 'validate', async (original, ...args) => { cancel(); return original(...args); });
    if (point === 'readback') wrap(t, nodeFs, 'createReadStream', (original, file, ...args) => { if (file === h.entry.destination) cancel(); return original(file, ...args); });
    h.start();
    if (['lease', 'hash'].includes(point)) { await checkpoint(h, entered.promise); const cancelling = h.s.cancelCurrent(); release.resolve(); await cancelling; }
    else if (point === 'encode') { await checkpoint(h, h.encodeEntered.promise); const cancelling = h.s.cancelCurrent(); await tick(); assert.ok(h.encodeChild.kills > 0); h.releaseEncode.resolve(); await cancelling; }
    await h.s.taskPromise;
    assert.equal(h.s.state.phase, 'cancelled'); assert.equal(h.item.status, 'cancelled'); assert.equal(h.counts.published, 0);
    assert.equal(h.item.outputDisposition.kind, point === 'readback' ? 'publication-uncertain' : ['evidence', 'validate'].includes(point) ? 'retained-unvalidated' : point === 'encode' ? 'retained-incomplete' : 'stage-unavailable');
    assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeMediaSlot, null); safe(h.item);
  });
});

test('NS-16b: real runtime release failure quarantines the job; a single-flight retry releases it once', async t => {
  const h = await harness(t); let failed = false, releases = 0;
  wrap(t, h.s, 'acquireNativeFileSlot', (original, ...args) => { const slot = original(...args); return { release: async () => {
    if (!failed) { failed = true; throw fault('EBUSY'); } releases++; return slot.release();
  } }; });
  await h.finish(); assert.equal(h.s.state.phase, 'failed'); assert.equal(h.s.state.error, NATIVE_MESSAGES.NATIVE_OWNER_UNSETTLED);
  assert.ok(h.s.nativeFileRuntime); assert.ok(h.s.nativeFileJob); assert.ok(h.s.nativeMediaSlot);
  assert.throws(() => h.s.requireIdle(), { code: 'NATIVE_OWNER_UNSETTLED' });
  const settling = h.s.nativeSettle; assert.ok(settling); assert.equal(h.s.settleNativeFileRuntime(), settling);
  await settling; assert.equal(releases, 1); assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeFileJob, null); assert.equal(h.s.nativeMediaSlot, null);
  assert.doesNotThrow(() => h.s.requireIdle());
});

test('NS-16b: shutdown waits for real runtime settlement before invalidating native selections', async t => {
  const h = await harness(t, { changes: { holdEncode: true } });
  h.start(); await checkpoint(h, h.encodeEntered.promise);
  const cancel = h.s.cancelCurrent(), close = h.s.closeOperationResources();
  await tick(); assert.ok(h.s.nativeFileRuntime); assert.ok(h.s.nativeMediaSlot);
  h.releaseEncode.resolve(); await cancel; await close;
  assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeMediaSlot, null); assert.equal(h.native.snapshot().selection, null);
});

test('NS-16b/NS-09d: confirmed settlement survives later disposition and record failures and stops the batch', async t => {
  for (const point of ['snapshot', 'keptStages', 'disposition-throw', 'disposition-unpersisted', 'settled-record', 'settled-unpersisted']) await t.test(point, async t => {
    const h = await harness(t, { extra: 1 }); let settled = false;
    wrap(t, h.s, 'settleNativeFileRuntime', async (original, ...args) => { const result = await original(...args); settled = result; return result; });
    if (point === 'snapshot') wrap(t, NativeFileRuntimeOwner.prototype, 'snapshot', (original, ...args) => {
      if (settled) throw fault(); return original(...args);
    });
    if (point === 'keptStages') {
      wrap(t, NativeFileRuntimeOwner.prototype, 'publish', async () => { throw fault(); });
      // The controls are frozen. Intercept the runtime fact used by keptStages,
      // after the disposition snapshot has succeeded once.
      let reads = 0;
      wrap(t, NativeFileRuntimeOwner.prototype, 'snapshot', (original, ...args) => {
        if (settled && ++reads === 2) throw fault(); return original(...args);
      });
    }
    if (point.startsWith('disposition') || point.startsWith('settled-')) wrap(t, h.s, 'recordIncident', async (original, event) => {
      if (event.reason === (point.startsWith('settled-') ? 'NATIVE_RUNTIME_SETTLED' : 'JOB_DISPOSITION')) {
        const result = await original(event);
        if (point.endsWith('-unpersisted')) return { persisted: false };
        throw fault();
      }
      return original(event);
    });
    await h.finish();
    // Record failures after the disposition is derived keep the publication fact.
    const derived = point.startsWith('disposition') || point.startsWith('settled-');
    const code = derived ? 'OPERATION_DIAGNOSTICS_INCOMPLETE' : 'NATIVE_FILE_JOB_FAILED';
    assert.equal(h.s.state.phase, 'failed'); assert.equal(h.s.state.error, NATIVE_MESSAGES[code]);
    assert.equal(h.s.state.items[1].status, 'unprocessed');
    assert.deepEqual(h.item.outputDisposition, derived ? { kind: 'published', published: true } : { kind: 'stage-unavailable', published: false });
    if (derived) assert.equal(h.item.status, 'success');
    assert.equal(Object.hasOwn(h.item, 'nativeKeptStages'), false);
    assert.equal(h.s.nativeFileRuntime, null); assert.equal(h.s.nativeFileJob, null); assert.equal(h.s.nativeMediaSlot, null);
    assert.equal(h.events.filter(e => e.reason === 'NATIVE_RUNTIME_SETTLED').length, 1);
    assert.equal(h.events.filter(e => e.reason === 'NATIVE_RUNTIME_CLOSE_FAILED').length, 0);
    const failures = h.events.filter(e => e.reason === code); assert.equal(failures.length, 1);
    assert.equal(failures[0].message, NATIVE_MESSAGES[code]);
    if (!point.endsWith('-unpersisted')) assert.match(failures[0].context.nativePrivate.message, /zq-secret/);
    safe(h.item); safe(h.s.state.error);
    const row = (await h.s.getDiagnosticHistory({ limit: 200 })).events.find(e => e.reason === code);
    const stored = await storedEvent(h, row.id); assert.deepEqual(stored.context.nativePrivate, failures[0].context.nativePrivate);
    safe((await h.s.getDiagnosticRecord({ eventId: row.id })).event);
    safe((await h.s.getDiagnosticExport({ eventIds: [row.id] })).data);
  });
});

test('NS-17: owned discovery failure discards qualification and the next file stops before folders, probes or intent', async t => {
  const h = await harness(t, { extra: 2 }); let discoveries = 0;
  wrap(t, h.native, 'observeFileSelection', async (original, ...args) => {
    if (++discoveries === 1) { await h.native.invalidate(); throw fault('TOOL_FAILED'); } return original(...args);
  });
  const before = { ...h.counts }; await h.finish();
  assert.equal(h.s.state.phase, 'failed'); assert.equal(h.s.state.items[1].reasonCode, 'NATIVE_FILE_SELECTION_STALE');
  assert.equal(h.s.state.items[0].status, 'failed'); assert.ok(h.s.state.items.slice(0, 2).every(i => i.reason.endsWith(NATIVE_MESSAGES.NATIVE_SELECTION_DISCARDED)));
  assert.equal(h.s.state.items[2].status, 'unprocessed');
  assert.equal(h.counts.verify - before.verify, 1); assert.equal(h.counts.inspect - before.inspect, 1); assert.equal(h.counts.intent, 0); noEncode(h);
});

test('NS-07b: oracle reference mismatch retains unvalidated bytes and never publishes', async t => {
  const h = await harness(t, { editReference: r => ({ ...r, output: { ...r.output, rawSha256: '0'.repeat(64) } }) });
  await h.finish(); assert.equal(h.item.reasonCode, 'NATIVE_ORACLE_RAW'); assert.equal(h.item.status, 'failed');
  assert.equal(h.item.outputDisposition.kind, 'retained-unvalidated'); assert.equal(h.item.nativeKeptStages, 1); assert.equal(h.counts.published, 0); await absent(h.entry.destination); safe(h.item);
});

test('NS-09d: path-bearing errno/assertions stay private through job records, item and batch errors', async t => {
  for (const site of ['folders', 'mkdtemp', 'link', 'assertion']) await t.test(site, async t => {
    const h = await harness(t);
    if (site === 'folders') wrap(t, h.s, 'verifyFolders', async () => { throw fault('SPAWN_FAILED'); });
    if (site === 'mkdtemp') wrap(t, fs, 'mkdtemp', async () => { throw fault('EPERM'); });
    if (site === 'link') wrap(t, fs, 'link', async (original, from, to) => { if (to === h.entry.destination) throw fault('EACCES'); return original(from, to); });
    if (site === 'assertion') wrap(t, h.s, 'assertSourceMatches', async () => { throw fault('ERR_ASSERTION'); });
    await h.finish(); assert.equal(h.item.reasonCode, site === 'folders' ? 'SPAWN_FAILED' : 'NATIVE_FILE_JOB_FAILED');
    assert.equal(h.item.reason, NATIVE_MESSAGES[h.item.reasonCode]); assert.equal(Object.hasOwn(h.item, 'details'), false);
    safe(h.item); if (h.s.state.error) assert.equal(h.s.state.error, NATIVE_MESSAGES[h.item.reasonCode]);
    if (['folders', 'mkdtemp', 'assertion'].includes(site)) noEncode(h);
    await safeRecords(h);
    const failed = h.events.find(e => e.reason === 'JOB_FAILED'); assert.match(JSON.stringify(failed.context.nativePrivate), /zq-secret/);
  });
});

test('NS-09d: Start error envelope uses table text even for an unexpected path-bearing error', async t => {
  const h = await harness(t);
  wrap(t, h.native, 'requireFileSelection', () => { throw fault('EACCES'); });
  assert.throws(h.start, error => { assert.equal(error.code, 'NATIVE_FILE_JOB_FAILED'); assert.equal(error.message, NATIVE_MESSAGES.NATIVE_FILE_JOB_FAILED); safe({ code: error.code, message: error.message }); return true; });
  assert.equal(h.s.state.phase, 'ready'); noEncode(h);
});

test('NS-09d: a 262144-byte failure stderr persists separately and is withheld from record reads and exports', async t => {
  for (const upstream of [false, true]) await t.test(`upstream capture=${upstream}`, async t => {
    const h = await harness(t), stderr = 'zq-secret ' + 'x'.repeat(262124) + ' tail-end!';
    assert.equal(Buffer.byteLength(stderr), 262144);
    const error = Object.assign(fault(), { stderr, ...(upstream ? { stderrCapture: { totalBytes: 300000, truncated: true } } : {}) });
    wrap(t, h.s, 'verifyFolders', async () => { throw error; });
    await h.finish(); noEncode(h);
    const row = (await h.s.getDiagnosticHistory({ limit: 200 })).events.find(e => e.reason === 'JOB_FAILED'); assert.ok(row);
    const stored = await storedEvent(h, row.id);
    assert.equal(stored.stderr.bytes, 262144); assert.equal(stored.stderr.truncated, upstream);
    if (upstream) assert.equal(stored.stderr.totalBytes, 300000);
    assert.equal(Object.hasOwn(stored.context.nativePrivate, 'stderr'), false);
    assert.equal(await fs.readFile(path.join(h.stateDir, 'diagnostics-v1', 'stderr', row.id + '.txt'), 'utf8'), stderr);
    const readable = (await h.s.getDiagnosticRecord({ eventId: row.id })).event;
    const exported = await h.s.getDiagnosticExport({ eventIds: [row.id] });
    assert.deepEqual(readable.stderr, { withheld: true, bytes: 262144 });
    // The redacted export already omits every stderr text and digest.
    assert.deepEqual(exported.data.events[0].stderr, { omitted: true, bytes: 262144, truncated: upstream,
      ...(upstream ? { totalBytes: 300000 } : {}), unavailable: false });
    assert.equal(exported.json.includes('tail-end!'), false);
    assert.deepEqual(JSON.parse(exported.json), exported.data); safe(readable); safe(exported.data);
  });
});

test('NS-09d: failure stderr and capture use own data properties once and never execute accessors', async t => {
  for (const accessors of [false, true]) await t.test(`accessors=${accessors}`, async t => {
    const h = await harness(t); let getters = 0;
    const reads = { stderr: 0, stderrCapture: 0, totalBytes: 0, truncated: 0 };
    const capture = new Proxy({ totalBytes: 16, truncated: false }, { getOwnPropertyDescriptor(target, key) {
      reads[key]++; return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    const original = Object.assign(fault(), { stderr: 'zq-secret stderr', stderrCapture: capture });
    if (accessors) for (const key of ['stderr', 'stderrCapture']) Object.defineProperty(original, key, { get() { getters++; throw fault(); } });
    const error = new Proxy(original, { getOwnPropertyDescriptor(target, key) {
      if (['stderr', 'stderrCapture'].includes(key)) {
        reads[key]++; assert.equal(reads[key], 1, key);
      }
      return Reflect.getOwnPropertyDescriptor(target, key);
    } });
    wrap(t, h.s, 'verifyFolders', async () => { throw error; });
    await h.finish(); assert.equal(getters, 0);
    assert.deepEqual(reads, { stderr: 1, stderrCapture: 1, totalBytes: accessors ? 0 : 1, truncated: accessors ? 0 : 1 });
    const row = (await h.s.getDiagnosticHistory({ limit: 200 })).events.find(e => e.reason === 'JOB_FAILED'); assert.ok(row);
    const stored = await storedEvent(h, row.id);
    assert.equal(stored.stderr.bytes, accessors ? 0 : 16);
    assert.equal(stored.stderr.totalBytes, accessors ? undefined : 16); await safeRecords(h);
  });
});

test('NS-21: disposition priority uses runtime publication facts for every kind', () => {
  const cases = [
    ['CANCELLED', 'verified', 'validated', true, 'published', true],
    ['NATIVE_FILE_PUBLISHED_CHANGED', 'committed', 'validated', true, 'published-changed', false],
    ['CANCELLED', 'committed', 'validated', true, 'publication-uncertain', null],
    ['PUBLICATION_UNCERTAIN', 'attempted', 'validated', true, 'publication-uncertain', null],
    ['EACCES', 'not-attempted', 'validated', true, 'retained-completed', false],
    [null, 'collision', 'validated', true, 'retained-completed', false],
    ['CANCELLED', 'not-attempted', 'sealed', true, 'retained-unvalidated', false],
    ['CANCELLED', 'not-attempted', 'unsealed', true, 'retained-incomplete', false],
    [null, 'not-attempted', 'validated', false, 'stage-unavailable', false],
  ];
  for (const [code, publication, stageState, stageRetained, kind, published] of cases)
    assert.deepEqual(nativeDisposition(code, { publication, stageState, stageRetained }), { kind, published });
});

test('NS-21: pre-link refusal followed by a third-party destination remains retained-completed', async t => {
  const h = await harness(t);
  wrap(t, NativeFileRuntimeOwner.prototype, 'publish', async () => { await fs.writeFile(h.entry.destination, 'third party'); throw fault('EPERM'); });
  await h.finish(); assert.equal(h.item.outputDisposition.kind, 'retained-completed'); assert.equal(h.counts.published, 0);
  assert.equal(await fs.readFile(h.entry.destination, 'utf8'), 'third party');
});

test('NS-21: changed published bytes persist their disposition and never get adopted or deleted', async t => {
  for (const persist of [true, false]) await t.test(`changed record persisted=${persist}`, async t => {
    const h = await harness(t, { extra: persist ? 0 : 1 });
    wrap(t, nodeFs, 'createReadStream', (original, file, ...args) => {
      if (file === h.entry.destination) nodeFs.appendFileSync(file, 'changed'); return original(file, ...args);
    });
    if (!persist) wrap(t, h.s, 'recordIncident', async (original, event) => event.reason === 'NATIVE_PUBLICATION_CHANGED' ? { persisted: false } : original(event));
    await h.finish(); assert.equal(h.item.outputDisposition.kind, 'published-changed'); assert.equal(h.item.reasonCode, 'NATIVE_FILE_PUBLISHED_CHANGED');
    assert.equal(h.counts.published, 0); assert.match((await fs.readFile(h.entry.destination)).toString(), /changed$/);
    if (!persist) { assert.equal(h.s.state.phase, 'failed'); assert.equal(h.s.state.error, NATIVE_MESSAGES.OPERATION_DIAGNOSTICS_INCOMPLETE); assert.equal(h.s.state.items[1].status, 'unprocessed'); }
    else { assert.ok(h.events.some(e => e.reason === 'NATIVE_PUBLICATION_CHANGED')); await safeRecords(h); }
  });
});

test('NS-22: kept-stage quota stops before any source seal or intent and reports the retained count', async t => {
  const h = await harness(t), root = path.join(h.stateDir, 'native-files'); await fs.mkdir(root);
  for (let i = 0; i < 8; i++) { const dir = path.join(root, `.ffmpeg-encoder-00000${i}`); await fs.mkdir(dir); await fs.writeFile(path.join(dir, 'encoded.mkv'), 'kept'); }
  let seals = 0; wrap(t, NativeFileSourceOwner.prototype, 'seal', async (original, ...args) => { seals++; return original(...args); });
  await h.finish(); assert.equal(h.item.reasonCode, 'NATIVE_FILE_STAGE_QUOTA'); assert.equal(h.s.state.phase, 'failed');
  assert.equal(seals, 0); assert.equal(h.counts.intent, 0); noEncode(h); assert.equal(h.s.nativeFiles.keptStages(), 8);
  assert.equal(h.s.nativeMediaSlot, null); assert.equal(h.s.nativeFileRuntime, null);
});

test('NS-23: progress is finite, clamped and monotonic; invalid seconds and durations cannot poison a snapshot', async t => {
  const h = await harness(t), progress = [];
  h.s.on('update', s => { if (s.progress?.stage === 'encoding' && s.progress.percent !== null) progress.push(s.progress.percent); });
  wrap(t, NativeFileRuntimeOwner.prototype, 'encode', async (original, token, options) => {
    for (const seconds of [NaN, Infinity, -1, null, '0.4', 0, 0.2, 0.1, 1, 0.3]) options.onProgress({ seconds });
    return original(token, options);
  });
  await h.finish(); assert.deepEqual(progress.slice(0, 6), [0, 40, 40, 99, 99, 99]);
  assert.ok(progress.every((p, i) => Number.isFinite(p) && p >= 0 && p <= 99 && (!i || p >= progress[i - 1])));
});

test('NS-23: an invalid duration ignores all encoder progress rather than dividing by zero or accepting infinity', async t => {
  const h = await harness(t), contract = h.entry.contract;
  wrap(t, NativeFileRuntimeOwner.prototype, 'prepare', async (original, ...args) => {
    const token = await original(...args);
    // Keep the runtime's genuine contract; corrupt only the service-side
    // progress denominator to exercise that defensive projection.
    h.entry.contract = { ...contract, expectedOutput: { ...contract.expectedOutput, frameRate: '0/1' } }; return token;
  });
  wrap(t, NativeFileRuntimeOwner.prototype, 'encode', async (original, token, options) => {
    for (const seconds of [0, 1, Number.MAX_VALUE]) options.onProgress({ seconds }); return original(token, options);
  });
  await h.finish(); assert.equal(h.item.status, 'success');
  assert.ok(h.snapshots.filter(s => s.progress?.stage === 'encoding').every(s => s.progress.percent === null));
});

test('NS-15: a CANCELLED error without an aborted controller stops queued work', async t => {
  const h = await harness(t, { extra: 1 });
  wrap(t, NativeFileRuntimeOwner.prototype, 'prepare', async () => { throw fault('CANCELLED'); });
  await h.finish(); assert.equal(h.item.status, 'cancelled'); assert.equal(h.s.state.items[1].status, 'unprocessed'); noEncode(h);
});

test('NS-07b/NS-17: stop codes stop the batch using original codes; ordinary per-file failure continues', async t => {
  for (const code of ['NATIVE_FILE_UNSETTLED', 'NATIVE_FILE_SOURCE_UNSETTLED', 'NATIVE_FILE_LEASE_REQUIRED', 'NATIVE_RUNTIME_STALE', 'NATIVE_FILE_STAGE_CHANGED', 'SPAWN_FAILED', 'EACCES', 'EPERM', 'TEST_LOCAL_FAILURE']) await t.test(code, async t => {
    const h = await harness(t, { extra: 1 }); let called = 0;
    wrap(t, NativeFileRuntimeOwner.prototype, 'prepare', async (original, ...args) => { if (++called === 1) throw fault(code); return original(...args); });
    await h.finish(); assert.equal(h.s.state.phase, code === 'TEST_LOCAL_FAILURE' ? 'completed' : 'failed');
    assert.equal(h.s.state.items[1].status, code === 'TEST_LOCAL_FAILURE' ? 'success' : 'unprocessed');
  });
});

test('NS-10/NS-16b: a pre-existing owner stops before selection, folders or construction and is kept quarantined', async t => {
  const h = await harness(t), prior = { snapshot: () => ({}) }, before = { ...h.counts };
  h.s.nativeFileRuntime = prior;
  const outcome = await executeNativeJob.call(h.s, h.item, h.entry, new AbortController().signal);
  assert.equal(outcome, 'stop'); assert.equal(h.s.nativeFileRuntime, prior); assert.equal(h.item.reasonCode, 'NATIVE_OWNER_UNSETTLED');
  assert.deepEqual(h.counts, before); noEncode(h); h.s.nativeFileRuntime = null;
});

test('NS-09d: primitive and accessor-bearing internal errors cannot escape the native queue helper', async t => {
  const h = await harness(t);
  for (const error of [null, 'zq-secret', { get code() { throw fault(); }, get stderr() { throw fault(); } }]) {
    const context = Object.assign(Object.create(EncoderService.prototype), h.s, { state: { ...h.s.state }, nativeFileRuntime: null, nativeFileJob: null,
      verifyFolders: async () => { throw error; }, emitState() {}, recordIncident: async () => ({ persisted: false }) });
    const item = { id: h.item.id };
    assert.equal(await executeNativeJob.call(context, item, h.entry, new AbortController().signal), 'stop');
    // Every record fails to persist here, so the settle's own record reports incomplete diagnostics.
    assert.equal(context.state.error, NATIVE_MESSAGES.OPERATION_DIAGNOSTICS_INCOMPLETE); assert.equal(item.outputDisposition.kind, 'stage-unavailable');
    assert.equal(item.reason, NATIVE_MESSAGES.NATIVE_FILE_JOB_FAILED); assert.equal(context.nativeFileRuntime, null); safe(item);
  }
});
