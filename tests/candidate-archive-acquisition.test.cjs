'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createHash } = require('node:crypto');
const { allowedUrl, downloadPinned, parseArguments, acquire } = require('../scripts/acquire-candidate-archives.cjs');
const { parseArguments: electronArgs } = require('../scripts/provision-candidate-electron.cjs');
const bytes = Buffer.from('injected archive fixture');
const pin = { url: 'https://github.com/selected/publisher/archive.zip', sizeBytes: bytes.length,
  sha256: createHash('sha256').update(bytes).digest('hex') };
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()), 'archive-unit-'));
  t.after(() => fs.rm(dir, { recursive: true }));
  return path.join(dir, 'archive.zip');
}
const response = (body = bytes, headers = {}) => new Response(body, { status: 200, headers });
test('URL admission refuses credentials, non-HTTPS, ports and other hosts', () => {
  assert.equal(allowedUrl(pin.url).hostname, 'github.com');
  for (const url of ['http://github.com/a', 'https://example.com/a', 'https://user:secret@github.com/a', 'https://github.com:444/a', 'https://github.com/a#fragment']) assert.throws(() => allowedUrl(url));
});
test('CLI paths are narrow and Electron preserves default when omitted', () => {
  assert.deepEqual(electronArgs([]), {});
  const absolute = path.resolve('archive.zip');
  assert.deepEqual(electronArgs(['--archive', absolute]), { archivePath: absolute });
  assert.equal(parseArguments(['--parent', path.resolve('.')]).parent, path.resolve('.'));
  for (const args of [['--archive', 'relative'], ['--archive', absolute, '--archive', absolute], ['--url', absolute], ['--archive', absolute+'\0']]) assert.throws(() => electronArgs(args));
  assert.throws(() => parseArguments(['--parent', 'relative']));
});
test('exact injected archive verifies; manual redirect follows only allowed hosts', async t => {
  const file = await fixture(t); let calls = 0;
  const result = await downloadPinned(pin, file, { fetchImpl: async (url, options) => {
    assert.equal(options.redirect, 'manual'); assert(options.signal instanceof AbortSignal);
    calls++; return calls === 1 ? new Response(null, { status: 302, headers: { location: 'https://release-assets.githubusercontent.com/fixed?sig=not-logged' } }) : response(bytes, { 'Content-Length': String(bytes.length) });
  } });
  assert.equal(calls, 2); assert.equal(result.sha256, pin.sha256); assert.deepEqual(await fs.readFile(file), bytes);
});
test('existing destination refuses before network and remains unchanged', async t => {
  const file = await fixture(t); await fs.writeFile(file, 'existing'); let called = false;
  await assert.rejects(downloadPinned(pin, file, { fetchImpl: async () => { called = true; return response(); } }));
  assert.equal(called, false); assert.equal(await fs.readFile(file, 'utf8'), 'existing');
});
for (const [label, reply] of [
  ['short', () => response(bytes.subarray(1))],
  ['oversize', () => response(Buffer.concat([bytes, bytes]))],
  ['digest', () => response(Buffer.alloc(bytes.length))],
  ['length', () => response(bytes, { 'Content-Length': '1' })],
  ['encoding', () => response(bytes, { 'Content-Encoding': 'gzip' })],
  ['http-error', () => new Response('no', { status: 403 })],
  ['redirect-host', () => new Response(null, { status: 302, headers: { location: 'https://evil.invalid/?secret=value' } })],
  ['redirect-loop', () => new Response(null, { status: 302, headers: { location: pin.url } })],
]) test(`${label} refuses and preserves owned attempt without verified result`, async t => {
  const file = await fixture(t); let count = 0;
  await assert.rejects(downloadPinned(pin, file, { fetchImpl: async () => { count++; return reply(); } }), /Pinned archive acquisition failed/);
  assert(count <= 4); assert((await fs.stat(file)).isFile()); assert((await fs.stat(file)).size <= pin.sizeBytes);
});
test('aborted transport failure is sanitized and retains partial file', async t => {
  const file = await fixture(t);
  await assert.rejects(downloadPinned(pin, file, { timeoutMs: 1, fetchImpl: async (_url, {signal}) => {
    await new Promise(resolve => setTimeout(resolve, 10)); signal.throwIfAborted();
  } }), error => error.message === 'Pinned archive acquisition failed; preserve this attempt for diagnosis.');
  assert((await fs.stat(file)).isFile());
});
test('host gate refuses acquisition without filesystem or network work', async () => {
  await assert.rejects(acquire({ parent: 'not-a-directory' }, { platform: 'linux', fetchImpl: () => { throw new Error('must not fetch'); } }), /Windows-only/);
});
test('Windows local drive syntax excludes UNC, device, drive-relative and ADS inputs', () => {
  const { localDrivePath } = require('../scripts/acquire-candidate-archives.cjs');
  for (const value of ['C:\\owned\\archive.zip', 'D:/runner/archives']) assert.equal(localDrivePath(value), value);
  for (const value of ['\\\\host\\share', '\\\\?\\C:\\archive', '\\rooted', 'C:relative', '/unix', 'C:/a:stream', 'C:/a\0']) assert.throws(() => localDrivePath(value));
});
test('owned directory replacement refuses new archive reservation and retains both directories', async t => {
  const { retainDirectory, preserveFailure } = require('../scripts/acquire-candidate-archives.cjs');
  const file = await fixture(t); const parent = path.dirname(file);
  const attempt = path.join(parent, 'attempt'); await fs.mkdir(attempt);
  const owned = await retainDirectory(attempt);
  await fs.rename(attempt, attempt + '-original'); await fs.mkdir(attempt);
  let fetched = false;
  await assert.rejects(downloadPinned(pin, path.join(attempt, 'archive.zip'), { assertOwned: owned,
    fetchImpl: async () => { fetched = true; return response(); } }), /ownership changed/);
  assert.equal(fetched, false);
  await assert.rejects(preserveFailure(attempt, owned, 0), /ownership was lost/);
  assert.deepEqual(await fs.readdir(attempt), []);
  assert.deepEqual(await fs.readdir(attempt + '-original'), []);
});

for (const [label, status, headers] of [
  ['status', 403, {}], ['encoding', 200, { 'content-encoding': 'gzip' }],
  ['length', 200, { 'content-length': '1' }],
]) test(`rejected final ${label} response cancels its body before reader acquisition`, async t => {
  const file = await fixture(t); let cancellations = 0, readers = 0;
  await assert.rejects(downloadPinned(pin, file, { fetchImpl: async () => ({
    status, headers: new Headers(headers), body: {
      getReader() { readers++; throw new Error('Unexpected reader'); },
      async cancel() { cancellations++; throw new Error('signed-secret-not-for-log'); },
    },
  }) }), error => error.message === 'Pinned archive acquisition failed; preserve this attempt for diagnosis.');
  assert.equal(cancellations, 1); assert.equal(readers, 0);
  assert.equal((await fs.stat(file)).size, 0);
});
