'use strict';

// Service/owner seams with dummy source bytes and mocked decoded-frame JSON.
// These checks invoke no external tool and make no media/hardware claim.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { EncoderService } = require('../src/encoder-service.cjs');
const { HdrOperations } = require('../src/hdr-operation.cjs');
const { PROFILES, classifyColor } = require('../src/media.cjs');
const { readSourceIdentity } = require('../src/source-identity.cjs');
const { fixture, RUNTIME, SETTINGS, BUDGET, clone } = require('./hdr-owner-fixture.cjs');

async function harness(t) {
  const parent = path.resolve(__dirname, '../artifacts/v0.7/slice4a/service-contract-tests');
  await fs.mkdir(parent, { recursive: true });
  const directory = await fs.mkdtemp(path.join(parent, 'run-'));
  const input = path.join(directory, 'input'), output = path.join(directory, 'output');
  await fs.mkdir(input); await fs.mkdir(output);
  const file = path.join(input, 'source.mkv'), bytes = Buffer.from('owned-mocked-source'); await fs.writeFile(file, bytes);
  const h = fixture({ identity: await readSourceIdentity(file), noPrepare: true });
  const policies = h.policies.map(value => ({ ...value, sourceSha256: createHash('sha256').update(bytes).digest('hex') }));
  const owner = new HdrOperations({ runtimeIdentity: RUNTIME, policyIdentity: 'synthetic-service-hdr', policies });
  const calls = [];
  const run = async (_tool, args) => {
    assert.ok(args.includes('-read_intervals') && args.includes('-show_frames'), 'Only mocked preparation frames are requested');
    calls.push([...args]);
    return { stdout: JSON.stringify({ frames: h.sourceFrames.slice(0, 61).map(value => ({ ...value, pts_time: String(value.pts / 1000), best_effort_timestamp_time: String(value.pts / 1000) })) }),
      stderr: '', exitCode: 0, stderrCapture: { totalBytes: 0, truncated: false } };
  };
  const service = new EncoderService({ ffmpeg: path.join(directory, 'ffmpeg.exe'), ffprobe: path.join(directory, 'ffprobe.exe'),
    stateDir: path.join(directory, 'state'), runtimeIdentity: RUNTIME, run, inspectionWorkers: 1, inspectionCache: null,
    hdrOperations: owner, operationEvidenceBudget: BUDGET, operationDeadlineMs: 600000, operationTelemetry: true,
    operationStorage: async () => { throw new Error('Preparation must not open operation storage'); },
    operationRuntime: { async observe() { return Object.freeze({}); }, snapshot() { return { runtimeIdentity: RUNTIME, environment: null }; }, async close() {} },
    storageEligibility: { async check() { return { eligible: true, reason: 'Mocked local fixture only' }; } },
    capabilities: async () => ({ profiles: PROFILES.map(value => ({ ...value, available: true, supportedBitDepths: [8, 10] })), versions: { ffmpeg: 'mocked ffmpeg' } }),
    inspect: async () => {
      const probe = clone(h.probe); probe.format.size = String((await fs.stat(file)).size);
      return { probe, color: classifyColor(probe), duration: 3.2, summary: { durationSeconds: 3.2 } };
    } });
  t.after(async () => { await service.cancelCurrent(); await service.closeOperationResources(); await service.closeDiagnostics(); });
  const source = await service.registerFolder(input, 'input'), destination = await service.registerFolder(output, 'output');
  const request = { inputFolderId: source.id, outputFolderId: destination.id, settings: SETTINGS };
  const prepare = async () => {
    await service.prepareBatch(request); await service.taskPromise; const snapshot = service.snapshot();
    assert.equal(snapshot.items[0].status, 'ready', snapshot.items[0].reason);
    return { snapshot, entry: service.plan.entries.get(snapshot.items[0].id) };
  };
  t.diagnostic(`Retained dummy-source service fixture: ${directory}`);
  return { service, owner, request, prepare, file, calls };
}
function stale(h, entry) { assert.throws(() => h.owner.requireCurrent(entry.qualificationSelection, entry.qualificationBindings), { code: 'HDR_OPERATION_STALE' }); }

test('failed service reprepare revokes genuine HDR authority before early option refusal and clears its notice', async t => {
  const h = await harness(t), { snapshot, entry } = await h.prepare();
  assert.ok(snapshot.items[0].hdr?.notice);
  const next = await h.service.updateFileOperations({ planId: snapshot.planId, draftId: snapshot.operationDraft.id, revision: snapshot.operationDraft.revision,
    fileIds: [snapshot.items[0].id], overrides: { audioPolicy: 'precision-flac' } });
  assert.notEqual(next.planId, snapshot.planId); assert.equal(next.items[0].reasonCode, 'HDR_QUALIFICATION_REQUIRED');
  assert.equal(next.items[0].hdr, undefined); stale(h, entry);
  assert.throws(() => h.service.startBatch({ planId: snapshot.planId, fileIds: [snapshot.items[0].id] }), { code: 'STALE_PLAN' });
});
test('prepared HDR cancellation clears Start and revokes the selection without another mocked tool call', async t => {
  const h = await harness(t), { snapshot, entry } = await h.prepare(), count = h.calls.length;
  await h.service.cancelCurrent(); stale(h, entry); assert.equal(h.calls.length, count);
  assert.throws(() => h.service.startBatch({ planId: snapshot.planId, fileIds: [snapshot.items[0].id] }), { code: 'STALE_PLAN' });
});
test('new service preparation supersedes prior genuine HDR selection', async t => {
  const h = await harness(t), { entry } = await h.prepare(); await h.prepare(); stale(h, entry);
});
test('operation-resource shutdown revokes a prepared HDR selection', async t => {
  const h = await harness(t), { entry } = await h.prepare(); await h.service.closeOperationResources(); stale(h, entry);
});
test('workspace full-byte hashing refuses a different source despite matching injected HDR metadata', async t => {
  const h = await harness(t); await fs.appendFile(h.file, 'different-content');
  await h.service.prepareBatch(h.request); await h.service.taskPromise;
  const result = h.service.snapshot(); assert.equal(result.items[0].reasonCode, 'HDR_QUALIFICATION_REQUIRED'); assert.equal(h.service.plan.entries.size, 0);
});
