'use strict';

// Explicit Windows archive acquisition only. No extraction, installation, media,
// activation or cleanup. Gyan is the selected third-party FFmpeg distributor.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { expectedCandidateManifest, assertOrdinaryPath, verifyPinnedFile } = require('../src/candidate-runtime.cjs');
const HOSTS = new Set(['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);
const FLOOR = 27n * 1024n ** 3n;
function localDrivePath(value) {
  assert(typeof value === 'string' && /^[A-Za-z]:[\\\\/]/.test(value)
    && !/[\x00-\x1f]/.test(value) && !value.slice(2).includes(':'), 'Expected a fully-qualified drive path on a known local runner volume.');
  return value;
}
async function retainDirectory(directory) {
  await assertOrdinaryPath(directory, 'directory');
  const original = await fs.lstat(directory, { bigint: true });
  return async () => {
    await assertOrdinaryPath(directory, 'directory');
    const current = await fs.lstat(directory, { bigint: true });
    assert(current.dev === original.dev && current.ino === original.ino && current.birthtimeNs === original.birthtimeNs,
      'Acquisition directory ownership changed.');
  };
}

function allowedUrl(value) {
  const url = new URL(value);
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.port
    && HOSTS.has(url.hostname) && !url.hash, 'Unapproved archive transport destination.');
  return url;
}

// Test seam accepts only an explicit pin; CLI obtains pins solely from the
// production manifest. No arbitrary URL/pin is exposed on the command line.
async function downloadPinned(pin, destination, { fetchImpl = fetch, timeoutMs = 120000, assertOwned = null } = {}) {
  assert(Number.isSafeInteger(pin.sizeBytes) && pin.sizeBytes > 0 && /^[a-f0-9]{64}$/.test(pin.sha256), 'Invalid pin.');
  assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000, 'Invalid acquisition timeout.');
  let url = allowedUrl(pin.url);
  const ownsParent = assertOwned || await retainDirectory(path.dirname(destination));
  await ownsParent();
  const handle = await fs.open(destination, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  const original = await handle.stat({ bigint: true });
  const signal = AbortSignal.timeout(timeoutMs);
  let reader, response;
  try {
    for (let redirects = 0; ; redirects++) {
      response = await fetchImpl(url.href, { redirect: 'manual', signal, headers: { 'Accept-Encoding': 'identity' } });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      await response.body?.cancel();
      assert(redirects < 3, 'Too many archive redirects.');
      const location = response.headers.get('location');
      assert(location, 'Missing archive redirect.');
      url = allowedUrl(new URL(location, url).href);
    }
    assert(response.status === 200 && response.body, 'Archive response was not successful.');
    const encoding = response.headers.get('content-encoding');
    assert(!encoding || encoding === 'identity', 'Encoded archive response refused.');
    const length = response.headers.get('content-length');
    assert(length === null || /^\d+$/.test(length) && BigInt(length) === BigInt(pin.sizeBytes), 'Archive Content-Length differs from pin.');
    reader = response.body.getReader();
    let total = 0; const hash = createHash('sha256');
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      assert(value instanceof Uint8Array && total + value.byteLength <= pin.sizeBytes, 'Archive exceeds its exact byte budget.');
      let offset = 0;
      while (offset < value.byteLength) {
        const result = await handle.write(value, offset, value.byteLength - offset, total + offset);
        assert(result.bytesWritten > 0, 'Archive write made no progress.');
        offset += result.bytesWritten;
      }
      total += value.byteLength; hash.update(value);
    }
    assert(total === pin.sizeBytes && hash.digest('hex') === pin.sha256, 'Archive bytes differ from pin.');
    await handle.sync();
    await ownsParent();
    await assertOrdinaryPath(destination);
    const observed = await fs.lstat(destination, { bigint: true });
    assert(observed.dev === original.dev && observed.ino === original.ino && observed.nlink === 1n, 'Archive pathname changed during acquisition.');
  } catch {
    // Do not expose signed redirect URLs, headers or transport error strings.
    throw new Error('Pinned archive acquisition failed; preserve this attempt for diagnosis.');
  } finally {
    try {
      if (reader) await reader.cancel();
      else await response?.body?.cancel();
    } catch { /* Preserve sanitized failure. */ }
    await handle.close();
  }
  await ownsParent();
  await verifyPinnedFile(destination, pin);
  await ownsParent();
  return { path: destination, sizeBytes: pin.sizeBytes, sha256: pin.sha256 };
}

function parseArguments(args) {
  assert(args.length === 2 && args[0] === '--parent' && path.isAbsolute(args[1])
    && !args[1].includes('\0'), 'Use --parent EXISTING_ABSOLUTE_DIRECTORY.');
  if (process.platform === 'win32') localDrivePath(args[1]);
  return { parent: path.resolve(args[1]) };
}

async function preserveFailure(directory, assertOwned, verifiedArchiveCount) {
    try { await assertOwned(); } catch {
      throw new Error('Archive attempt failed and directory ownership was lost; no failure receipt written.');
    }
    await fs.writeFile(path.join(directory, 'failed.json'), JSON.stringify({ status: 'failed', verifiedArchiveCount: verifiedArchiveCount,
      scope: 'Preserve partial attempt; no extraction/installation occurred.' }) + '\n', { flag: 'wx', mode: 0o600 });
}

async function acquire({ parent }, { fetchImpl = fetch, platform = process.platform } = {}) {
  assert(platform === 'win32', 'This acquisition lane is Windows-only.');
  if (process.platform === 'win32') localDrivePath(parent);
  await assertOrdinaryPath(parent, 'directory');
  const ownsParent = await retainDirectory(parent);
  const manifest = expectedCandidateManifest();
  const pins = [manifest.archive, manifest.electron.archive];
  const free = await fs.statfs(parent, { bigint: true });
  const required = FLOOR + pins.reduce((sum, pin) => sum + BigInt(pin.sizeBytes), 0n);
  assert(free.bavail * free.bsize > required, 'Keep the 27 GiB floor plus archive bytes; do not lower the floor for hosted runners.');
  await ownsParent();
  const directory = await fs.mkdtemp(path.join(parent, 'candidate-acquire-'));
  await assertOrdinaryPath(directory, 'directory');
  const assertOwned = await retainDirectory(directory);
  const items = [];
  try {
    for (const pin of pins) {
      const downloaded = await downloadPinned(pin, path.join(directory, pin.fileName), { fetchImpl, assertOwned });
      items.push({ name: pin.fileName, path: downloaded.path, release: pin.releasePage || manifest.releasePage,
        url: pin.url, verified: true, expectedBytes: pin.sizeBytes, expectedSha256: pin.sha256 });
    }
    await assertOwned();
    for (const pin of pins) await verifyPinnedFile(path.join(directory, pin.fileName), pin);
    await assertOwned();
    const receipt = path.join(directory, 'transfer-report.json');
    await fs.writeFile(receipt, JSON.stringify({ schema: 1, items }, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { directory, receipt, status: 'archives-verified-only', extraction: 'not-run', installation: 'not-run' };
  } catch {
    await preserveFailure(directory, assertOwned, items.length);
    throw new Error('Archive attempt failed; retained at ' + directory);
  }
}
module.exports = { allowedUrl, downloadPinned, parseArguments, acquire, localDrivePath, retainDirectory, preserveFailure };
if (require.main === module) acquire(parseArguments(process.argv.slice(2)))
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(error => { console.error(error.message); process.exitCode = 1; });
