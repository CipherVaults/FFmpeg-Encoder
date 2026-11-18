'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { authority, execute, publishReport, attestReport } = require('../scripts/windows-hosted-archive-check.cjs');
const identity = { head: 'a'.repeat(40), runId: '123', attempt: '1' };
const environment = () => ({ GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'CipherVaults/FFmpeg-Encoder-Blue-Linux',
  GITHUB_REF: 'refs/heads/blue/linux-development', GITHUB_EVENT_NAME: 'push',
  GITHUB_SHA: identity.head, GITHUB_RUN_ID: identity.runId, GITHUB_RUN_ATTEMPT: '1' });
const event = { after: identity.head, before: '38c5042039035e429cdb48748eec18d5ea96150f', forced: false, created: false, deleted: false };
async function folder(t) { const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'hosted-archive-unit-'));
  t.after(() => fs.rm(dir, { recursive: true })); return dir; }
test('exact one-successor push admitted; manual, PR, other refs, mismatches and reruns refused', () => {
  assert.deepEqual(authority(environment(), event), identity);
  assert.deepEqual(authority({ ...environment(), GITHUB_EVENT_NAME: 'push' }, { after: identity.head, before: '38c5042039035e429cdb48748eec18d5ea96150f', forced: false, created: false, deleted: false }), identity);
  for (const patch of [{ GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/main' }, { GITHUB_REPOSITORY: 'other/repo' },
    { GITHUB_RUN_ATTEMPT: '2' }, { GITHUB_SHA: 'b'.repeat(40) }, { GITHUB_ACTIONS: 'false' }]) assert.throws(() => authority({ ...environment(), ...patch }, event));
});
test('resource floor reports blocked without attempting acquisition', async t => {
  const parent = await folder(t); let acquired = false;
  const report = await execute({ root: path.resolve(__dirname, '..'), parent, identity }, { platform: 'win32',
    inspectDrive() {}, statfsImpl: async () => ({ bavail: 14n * 1024n ** 3n, bsize: 1n }),
    acquireImpl: async () => { acquired = true; throw new Error('must not acquire'); } });
  assert.equal(acquired, false); assert.equal(report.state, 'BLOCKED_RESOURCE_FLOOR');
  assert.equal(report.installation, 'not-run'); assert.deepEqual(report.archives, []);
});
test('failure remains failure without signed redirect text in report', async t => {
  const parent = await folder(t);
  const report = await execute({ root: path.resolve(__dirname, '..'), parent, identity }, { platform: 'win32',
    inspectDrive() {}, statfsImpl: async () => ({ bavail: 100n * 1024n ** 3n, bsize: 1n }),
    acquireImpl: async () => { throw new Error('https://signed.secret/?credential=hidden'); } });
  assert.equal(report.state, 'ACQUISITION_FAILED'); assert(!JSON.stringify(report).includes('credential'));
});
test('fresh report ready is emitted only after bounded exclusive report readback', async t => {
  const parent = await folder(t); const output = path.join(parent, 'outputs'); await fs.writeFile(output, '');
  await fs.writeFile(path.join(parent, 'report.json'), 'untrusted old report');
  const report = { schema: 1, ...identity, state: 'BLOCKED_RESOURCE_FLOOR', availableBytes: '14', requiredBytes: '27',
    archives: [], extraction: 'not-run', installation: 'not-run', startup: null };
  const saved = await publishReport(parent, report, output);
  assert.notEqual(saved.file, path.join(parent, 'report.json')); assert.equal((await fs.readFile(path.join(parent, 'report.json'), 'utf8')), 'untrusted old report');
  assert.match(await fs.readFile(output, 'utf8'), /report_ready=true/);
  assert.deepEqual(JSON.parse(await fs.readFile(saved.file)), report);
});
test('extra report fields prevent ready signal', async t => {
  const parent = await folder(t); const output = path.join(parent, 'outputs'); await fs.writeFile(output, '');
  await assert.rejects(publishReport(parent, { schema: 1, secret: 'not allowed' }, output));
  assert.equal(await fs.readFile(output, 'utf8'), '');
});

test('bounded closed report attestation rejects oversized, changed and nonordinary input', async t => {
  const parent = await folder(t); const file = path.join(parent, 'report.json'); const bytes = Buffer.from('{"schema":1}');
  await fs.writeFile(file, Buffer.alloc(32769, 32));
  await assert.rejects(attestReport(file, bytes, async () => {}), /bounded read/);
  await fs.writeFile(file, '{"schema":2}');
  await assert.rejects(attestReport(file, bytes, async () => {}), /changed/);
  await assert.rejects(attestReport(parent, bytes, async () => {}));
});

test('introduction-only push refuses later parent, forced, created, deleted and missing flags', () => {
  const base = { after: identity.head, before: '38c5042039035e429cdb48748eec18d5ea96150f', forced: false, created: false, deleted: false };
  const env = { ...environment(), GITHUB_EVENT_NAME: 'push' };
  for (const patch of [{ before: 'b'.repeat(40) }, { forced: true }, { created: true }, { deleted: true }, { forced: undefined }, { after: 'b'.repeat(40) }]) {
    assert.throws(() => authority(env, { ...base, ...patch }));
  }
});

test('workflow agrees with single-successor push and cannot dispatch manually', async () => {
 const yaml=await fs.readFile(path.resolve(__dirname,'../.github/workflows/windows-archives.yml'),'utf8');
 assert(!yaml.includes('workflow_dispatch')); assert(yaml.includes("github.event.before == '38c5042039035e429cdb48748eec18d5ea96150f'"));
 assert(yaml.includes('github.run_attempt == 1')); assert(yaml.includes('github.event.forced == false'));
 assert(yaml.includes('github.event.created == false')); assert(yaml.includes('github.event.deleted == false'));
});
