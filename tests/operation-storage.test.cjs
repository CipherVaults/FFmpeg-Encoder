'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { openEvidenceStorage, LIMITS } = require('../src/operation-storage.cjs');
const { createRemuxStorageAllowance, REMUX_SANITY_BYTES } = require('../src/operation-storage.cjs');
const { assessRemux } = require('../src/remux-contract.cjs');
const { normalizeProbe } = require('../src/inspection.cjs');
const { deriveRemuxBudget } = require('../src/remux-operation.cjs');
const MiB = 1024 * 1024;
const hugeSpace = async () => ({ bavail: 1024n * 1024n * 1024n, bsize: 4096n });

async function fixture(t, defaults = {}) {
  const base = await fs.realpath(os.tmpdir());
  const home = await fs.mkdtemp(path.join(base, 'ffmpeg-operation-storage-'));
  const root = path.join(home, 'operation-evidence'); const stores = [];
  t.after(async () => {
    await Promise.allSettled(stores.map(store => store.close()));
    const actual = await fs.realpath(home);
    assert.equal(path.dirname(actual), base); assert.ok(path.basename(actual).startsWith('ffmpeg-operation-storage-'));
    await fs.rm(actual, { recursive: true });
  });
  const open = async (options = {}) => {
    const store = await openEvidenceStorage({ root, minFreeBytes: 0, io: { ...fs, statfs: hugeSpace }, ...defaults, ...options });
    stores.push(store); return store;
  };
  return { home, root, open };
}
async function sized(file, bytes) { await fs.writeFile(file, ''); await fs.truncate(file, bytes); }

function longStorageAssessment(seconds = 10800) {
  const probe = { streams: [{ index: 0, codec_type: 'video', codec_name: 'h264', width: 2, height: 2, pix_fmt: 'yuv420p',
    color_range: 'tv', color_transfer: 'bt709', color_primaries: 'bt709', color_space: 'bt709', time_base: '1/1000',
    sample_aspect_ratio: '1:1', duration: String(seconds), disposition: {}, tags: {} }],
  format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: String(seconds), size: String(40 * 1024 ** 3), nb_streams: 1,
    nb_programs: 0, nb_stream_groups: 0, tags: {} }, chapters: [], programs: [], stream_groups: [] };
  return { probe, assessment: assessRemux({ probe, sourceFingerprint: 'a'.repeat(64), request: { fileId: 'long', identityRevision: 0,
    draftRevision: 0, operation: 'remux', target: 'matroska', range: null, omissionRequestIds: [] } }) };
}

test('remux intermediate observations enforce actual growth without redundant diagnostic fsyncs; restart reconciles it', async t => {
  let writes = 0;
  const io = { ...fs, statfs: hugeSpace, async rename(a, b) { writes++; return fs.rename(a, b); } };
  const h = await fixture(t, { io }), store = await h.open(), { probe, assessment } = longStorageAssessment(2);
  const forecastBytes = deriveRemuxBudget(normalizeProbe(probe), '1024').budget.maxSpoolBytes;
  const remuxAllowance = createRemuxStorageAllowance(assessment, '1024');
  const reservation = await store.admit({ forecastBytes, remuxAllowance }), before = writes;
  const file = path.join(reservation.directory, 'actual.txt'); await fs.writeFile(file, Buffer.alloc(8192, 1));
  const observed = await store.observeGrowth(reservation); assert.ok(observed.jobs[0].actualBytes >= 8192);
  assert.equal(writes, before, 'Only main-branded remux skips intermediate diagnostic ledger writes.');
  await store.close();
  const restarted = await h.open(); assert.ok((await restarted.snapshot()).usedBytes >= 8192);
  assert.ok(JSON.parse(await fs.readFile(path.join(h.root, '.storage-ledger.json'), 'utf8')).accounting.usedBytes >= 8192);
  assert.ok(writes > before, 'Restart reconciles filesystem bytes instead of trusting the old ledger.');
  const ordinary = await restarted.admit({ forecastBytes: 1 }), mark = writes;
  await restarted.observeGrowth(ordinary); assert.equal(writes, mark + 1, 'Ordinary durable-observation behavior is unchanged.');
});

test('remux coalescing retains free-space and per-reservation guards on every observation', async t => {
  let available = 1n << 60n;
  const h = await fixture(t, { minFreeBytes: MiB, io: { ...fs, statfs: async () => ({ bavail: available, bsize: 1n }) } });
  const store = await h.open(), { probe, assessment } = longStorageAssessment(2);
  const forecastBytes = deriveRemuxBudget(normalizeProbe(probe), '1024').budget.maxSpoolBytes;
  const reservation = await store.admit({ forecastBytes, remuxAllowance: createRemuxStorageAllowance(assessment, '1024') });
  available = 0n; await assert.rejects(store.observeGrowth(reservation), e => e.code === 'OPERATION_STORAGE_LIMIT' && e.accounting.violations.includes('free-space-floor'));
  available = 1n << 60n; await sized(path.join(reservation.directory, 'over-budget'), forecastBytes + 1);
  await assert.rejects(store.observeGrowth(reservation), e => e.code === 'OPERATION_STORAGE_LIMIT' && e.accounting.violations.includes('job-reservation'));
});

test('only genuine remux observations batch file checks, cap eight and drain every pending check on listing failure (mutants killed)', async t => {
  async function exercise(api, remux, listingFailure = false, fileFailure = null) {
    const h = await fixture(t), cache = new Map(), reads = new Map(), issued = [];
    let scanning = false, target, names, rootNames, running = 0, peak = 0;
    const io = { ...fs, statfs: hugeSpace,
      async lstat(file, options) {
        if (!scanning || !cache.has(file)) return fs.lstat(file, options);
        const stat = Object.assign(Object.create(Object.getPrototypeOf(cache.get(file))), cache.get(file)), count = (reads.get(file) || 0) + 1; reads.set(file, count);
        if (path.basename(file) === 'batch-01') {
          if (fileFailure === 'link') stat.isSymbolicLink = () => true;
          if (count > 1 && fileFailure === 'identity') stat.ino += 1n;
          if (count > 1 && fileFailure === 'shrink') stat.size = 0n;
        }
        return stat;
      },
      async realpath(file) {
        if (!scanning || !cache.has(file)) return fs.realpath(file);
        running++; peak = Math.max(peak, running);
        const pending = new Promise(resolve => setImmediate(resolve)); issued.push(pending);
        try { await pending;
          if (path.basename(file) === 'batch-01' && fileFailure === 'EIO') throw Object.assign(Error('injected file I/O'), { code: 'EIO' });
          return path.basename(file) === 'batch-01' && fileFailure === 'alias' ? file + '-alias' : file;
        } finally { running--; }
      },
      async opendir(file) {
        if (!scanning || file !== target && file !== h.root) return fs.opendir(file);
        return { async *[Symbol.asyncIterator]() { let count = 0; for (const name of file === target ? names : rootNames) {
          if (file === target && listingFailure && ++count === 4) throw Object.assign(Error('injected listing I/O error'), { code: 'EIO' });
          yield { name };
        } } };
      } };
    const store = await api.openEvidenceStorage({ root: h.root, io, minFreeBytes: 0 });
    try {
      const { probe, assessment } = longStorageAssessment(2);
      const request = remux ? { forecastBytes: deriveRemuxBudget(normalizeProbe(probe), '1024').budget.maxSpoolBytes,
        remuxAllowance: api.createRemuxStorageAllowance(assessment, '1024') } : { forecastBytes: 1 };
      const reservation = await store.admit(request); target = reservation.directory;
      for (let i = 0; i < 32; i++) { const file = path.join(target, 'batch-' + String(i).padStart(2, '0'));
        await fs.writeFile(file, 'x'); cache.set(file, await fs.lstat(file, { bigint: true })); }
      names = (await fs.readdir(target)).sort(); rootNames = (await fs.readdir(h.root)).sort(); scanning = true;
      if (listingFailure || fileFailure) await assert.rejects(store.observeGrowth(reservation),
        { code: ['link', 'alias'].includes(fileFailure) ? 'OPERATION_STORAGE_PATH' : 'OPERATION_STORAGE_OBSERVATION' });
      else { const result = await store.observeGrowth(reservation); assert.ok(result.jobs[0].actualBytes >= 32); }
      assert.equal(running, 0, 'Every issued check must drain before the observation settles.');
      assert.ok(peak <= (remux ? 8 : 1), 'Main metadata concurrency is bounded; ordinary callers remain serial.');
      if (remux && !listingFailure && !fileFailure) assert.equal(peak, 8);
    } finally { await Promise.allSettled(issued); scanning = false; await store.close(); }
  }
  const api = require('../src/operation-storage.cjs');
  await exercise(api, false); await exercise(api, true); await exercise(api, true, true);
  for (const kind of ['link', 'alias', 'identity', 'shrink', 'EIO']) await exercise(api, true, false, kind);
  const filename = require.resolve('../src/operation-storage.cjs'), raw = require('node:fs').readFileSync(filename, 'utf8'), Module = require('node:module');
  function variant(before, after) { assert.equal(raw.split(before).length, 2); const m = new Module(filename, module); m.filename = filename;
    m.paths = Module._nodeModulePaths(path.dirname(filename)); m._compile(raw.replace(before, after), filename); return m.exports; }
  await assert.rejects(exercise(variant('pending.length >= 8', 'pending.length >= 9'), true), { code: 'ERR_ASSERTION' });
  await assert.rejects(exercise(variant('walk(item.remux)', 'walk(true)'), false), { code: 'ERR_ASSERTION' });
  await assert.rejects(exercise(variant('try { await drain(); } catch (error) { listingFailure ||= error; }',
    '/* mutant omits final drain */'), true, true), { code: 'ERR_ASSERTION' });
});
test('only genuine remux allowances enlarge retention; ordinary admissions keep the legacy cap', async t => {
  const h = await fixture(t), { probe, assessment } = longStorageAssessment();
  const costs = deriveRemuxBudget(normalizeProbe(probe), probe.format.size);
  const token = createRemuxStorageAllowance(assessment, probe.format.size), store = await h.open();
  assert.ok(costs.budget.maxSpoolBytes > LIMITS.capBytes);
  for (const request of [{ forecastBytes: costs.budget.maxSpoolBytes }, { forecastBytes: costs.budget.maxSpoolBytes, remuxAllowance: {} },
    { forecastBytes: costs.budget.maxSpoolBytes, remuxAllowance: structuredClone(token) },
    { forecastBytes: costs.budget.maxSpoolBytes - 1, remuxAllowance: token }, { forecastBytes: 1, capBytes: REMUX_SANITY_BYTES }])
    await assert.rejects(store.admit(request));
  let reads = 0; const request = { forecastBytes: 1 }; Object.defineProperty(request, 'remuxAllowance', { enumerable: true, get() { reads++; return token; } });
  await assert.rejects(store.admit(request)); assert.equal(reads, 0);
  assert.throws(() => createRemuxStorageAllowance(structuredClone(assessment), probe.format.size));
  const reservation = await store.admit({ forecastBytes: costs.budget.maxSpoolBytes, remuxAllowance: token });
  assert.ok((await store.snapshot()).capBytes > LIMITS.capBytes);
  await store.finish(reservation, { status: 'completed' });
  const ordinary = await store.admit({ forecastBytes: 1 }); assert.equal((await store.snapshot()).capBytes, LIMITS.capBytes);
  const ordinaryFinal = await store.finish(ordinary, { status: 'completed' }); assert.equal(ordinaryFinal.capBytes, LIMITS.capBytes);
  await assert.rejects(store.admit({ forecastBytes: LIMITS.capBytes + 1 }));
  await assert.rejects(h.open({ capBytes: LIMITS.capBytes + 1 }));
});
test('remux source-derived allowance retains free-space, growth and cumulative sanity guards', async t => {
  const { probe, assessment } = longStorageAssessment(), costs = deriveRemuxBudget(normalizeProbe(probe), probe.format.size);
  const token = createRemuxStorageAllowance(assessment, probe.format.size);
  const low = await fixture(t, { minFreeBytes: LIMITS.minFreeBytes, io: { ...fs, statfs: async () => ({ bavail: BigInt(LIMITS.minFreeBytes), bsize: 1n }) } });
  await assert.rejects((await low.open()).admit({ forecastBytes: costs.budget.maxSpoolBytes, remuxAllowance: token }), { code: 'OPERATION_STORAGE_ADMISSION' });
  const h = await fixture(t); await fs.mkdir(h.root); const retained = path.join(h.root, 'old-retained.bin'); await fs.writeFile(retained, 'owned');
  const io = { ...fs, statfs: hugeSpace, lstat: async (file, options) => { const stat = await fs.lstat(file, options);
    if (file === retained) stat.size = BigInt(REMUX_SANITY_BYTES); return stat; } };
  const store = await h.open({ io });
  await assert.rejects(store.admit({ forecastBytes: costs.budget.maxSpoolBytes, remuxAllowance: token }), /sanity/);
  const enormous = longStorageAssessment(1e12); assert.throws(() => createRemuxStorageAllowance(enormous.assessment, probe.format.size), /sanity|overflow/i);
});

function controlledScanIO() {
  const control = { directory: null, generation: 0, attempts: 0, visits: [], afterEntries: null, mutateStat: null };
  const io = { ...fs, statfs: hugeSpace, async lstat(file, options) {
    const stat = await fs.lstat(file, options);
    if (file === control.directory) {
      // Explicit generations avoid relying on filesystem timestamp resolution.
      stat.mtimeNs = BigInt(control.generation);
      if (control.mutateStat) control.mutateStat(stat);
    }
    return stat;
  }, async opendir(file) {
    const listing = await fs.opendir(file);
    if (!control.directory) return listing;
    control.visits.push(file);
    const entries = [];
    for await (const entry of listing) entries.push(entry);
    entries.sort((a, b) => a.name.localeCompare(b.name));
    return { async *[Symbol.asyncIterator]() {
      for (const entry of entries) yield entry;
      if (file === control.directory) {
        control.attempts++;
        if (control.afterEntries) await control.afterEntries(control.attempts);
      }
    } };
  } };
  return { control, io };
}

test('filesystem totals retain unknown files and failed/cancelled jobs across restart', async t => {
  const h = await fixture(t); await fs.mkdir(h.root); await fs.writeFile(path.join(h.root, 'older-receipt.txt'), 'existing evidence');
  let store = await h.open();
  assert.ok((await store.snapshot()).usedBytes >= 17);
  for (const status of ['failed', 'cancelled']) {
    const reservation = await store.admit({ forecastBytes: 1000 });
    assert.equal(Object.isFrozen(reservation), true); assert.equal(await store.assertReservation(reservation), true);
    await fs.writeFile(path.join(reservation.directory, 'retained-stats.tsv'), Buffer.alloc(5000));
    const observed = await store.observeGrowth(reservation);
    assert.equal(observed.jobs[0].reservedBytes, LIMITS.initialReserveBytes);
    assert.equal(observed.hardWriteCap, false); assert.ok(observed.jobs[0].actualBytes >= 5000);
    const final = await store.finish(reservation, { status });
    assert.equal(final.final.status, status); assert.equal(final.final.recordPersisted, true);
    assert.equal(JSON.parse(await fs.readFile(path.join(reservation.directory, 'storage-final.json'), 'utf8')).status, status);
  }
  const before = await store.snapshot(); await store.close(); store = await h.open();
  const after = await store.snapshot(); assert.ok(after.usedBytes >= 10017); assert.ok(Math.abs(after.usedBytes - before.usedBytes) < 4096);
  assert.equal(await fs.readFile(path.join(h.root, 'older-receipt.txt'), 'utf8'), 'existing evidence');
  assert.equal(after.reservedBytes, 0); assert.equal(after.jobs.length, 0);
});

test('disk reservations are distinct from streamed stdout and reject forged handles', async t => {
  const h = await fixture(t), store = await h.open();
  const reservation = await store.admit({ forecastBytes: 100 }); const before = await store.snapshot();
  // A large count of drained PCM bytes does not create a disk file or enter the
  // storage API. Only filesystem bytes and explicit disk forecasts count here.
  const streamedPcmBytes = 40 * MiB; assert.ok(streamedPcmBytes > before.usedBytes);
  assert.equal((await store.snapshot()).usedBytes, before.usedBytes);
  await assert.rejects(store.assertReservation({ ...reservation }), { code: 'OPERATION_STORAGE_RESERVATION' });
  await assert.rejects(store.observeGrowth({ directory: reservation.directory, id: reservation.id }), { code: 'OPERATION_STORAGE_RESERVATION' });
  await store.finish(reservation, { status: 'completed' });
  await assert.rejects(store.assertReservation(reservation), { code: 'OPERATION_STORAGE_RESERVATION' });
});

test('aggregate retained bytes plus concurrent outstanding reservations control admission', async t => {
  const h = await fixture(t, { capBytes: 96 * MiB }), store = await h.open();
  const results = await Promise.allSettled(Array.from({ length: 3 }, () => store.admit({ forecastBytes: 1 })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(results.filter(result => result.status === 'rejected')[0].reason.code, 'OPERATION_STORAGE_ADMISSION');
  const snapshot = await store.snapshot(); assert.equal(snapshot.jobs.length, 2);
  assert.ok(snapshot.projectedBytes <= snapshot.capBytes); assert.ok(snapshot.reservedBytes > 63 * MiB);
});

test('a corrupt ledger cannot reset actual retained usage or manufacture admission space', async t => {
  const h = await fixture(t, { capBytes: 64 * MiB }); await fs.mkdir(h.root);
  await sized(path.join(h.root, 'unknown-retained.bin'), 33 * MiB);
  await fs.writeFile(path.join(h.root, '.storage-ledger.json'), '{corrupt zero accounting');
  const store = await h.open(); const snapshot = await store.snapshot();
  assert.equal(snapshot.startupLedgerState, 'corrupt-reconciled'); assert.ok(snapshot.usedBytes >= 33 * MiB);
  await assert.rejects(store.admit({ forecastBytes: 1 }), { code: 'OPERATION_STORAGE_ADMISSION' });
  const ledger = JSON.parse(await fs.readFile(path.join(h.root, '.storage-ledger.json'), 'utf8'));
  assert.equal(ledger.authority, 'diagnostic-only'); assert.ok(ledger.accounting.usedBytes >= 33 * MiB);
  assert.equal((await fs.stat(path.join(h.root, 'unknown-retained.bin'))).size, 33 * MiB);
});

test('missing and forged zero-usage ledgers are reconciled from files', async t => {
  const h = await fixture(t); await fs.mkdir(h.root); await fs.writeFile(path.join(h.root, 'retained.txt'), 'q'.repeat(5000));
  let store = await h.open(); assert.equal((await store.snapshot()).startupLedgerState, 'missing-reconciled'); await store.close();
  await fs.writeFile(path.join(h.root, '.storage-ledger.json'), JSON.stringify({ schema: 1, authority: 'diagnostic-only', usedBytes: 0, files: ['C:\\do-not-delete'] }));
  store = await h.open(); assert.ok((await store.snapshot()).usedBytes >= 5000);
  assert.equal((await fs.stat(path.join(h.root, 'retained.txt'))).size, 5000);
});

test('one process lease excludes a second owner and close releases only its own name', async t => {
  const h = await fixture(t), store = await h.open();
  await assert.rejects(h.open(), { code: 'OPERATION_STORAGE_RECOVERY_REQUIRED' });
  await store.close(); const next = await h.open(); assert.equal((await next.snapshot()).leaseRecovery, 'none');
  await fs.writeFile(path.join(h.root, '.storage-lease.json'), 'changed owner metadata');
  await assert.rejects(next.close(), { code: 'OPERATION_STORAGE_LEASE' });
  assert.equal(await fs.readFile(path.join(h.root, '.storage-lease.json'), 'utf8'), 'changed owner metadata');
});

test('a stale parent lease is preserved even when the parent is reported absent', async t => {
  const h = await fixture(t); await fs.mkdir(h.root);
  const lease = path.join(h.root, '.storage-lease.json');
  const content = JSON.stringify({ schema: 1, pid: 2147483647, token: randomUUID(), processToken: randomUUID() });
  await fs.writeFile(lease, content);
  let observations = 0;
  await assert.rejects(h.open({ kill() { observations++; throw Object.assign(new Error('absent'), { code: 'ESRCH' }); } }),
    error => error.code === 'OPERATION_STORAGE_RECOVERY_REQUIRED' && error.writerClosure === 'unverified' && error.leaseRetained === true);
  assert.equal(observations, 0, 'Parent liveness is deliberately not a child-closure test.');
  assert.equal(await fs.readFile(lease, 'utf8'), content);
  assert.deepEqual(await fs.readdir(h.root), ['.storage-lease.json']);
});

test('dead parent plus unfinished reservation cannot authorize admission or reset accounting', async t => {
  const h = await fixture(t); await fs.mkdir(h.root);
  const id = 'job-' + randomUUID(), job = path.join(h.root, id); await fs.mkdir(job);
  const lease = JSON.stringify({ schema: 1, pid: 2147483647, token: randomUUID(), processToken: randomUUID() });
  const reservation = JSON.stringify({ schema: 1, id, reservedBytes: LIMITS.initialReserveBytes, forecastBytes: 1000, authority: 'diagnostic-only' });
  const ledger = JSON.stringify({ schema: 1, authority: 'diagnostic-only', accounting: { usedBytes: 123, reservedBytes: LIMITS.initialReserveBytes,
    jobs: [{ id, remainingBytes: LIMITS.initialReserveBytes - 123 }] } });
  await fs.writeFile(path.join(h.root, '.storage-lease.json'), lease);
  await fs.writeFile(path.join(h.root, '.storage-ledger.json'), ledger);
  await fs.writeFile(path.join(job, 'storage-reservation.json'), reservation);
  const telemetry = path.join(job, 'unfinished-encoder-stats.tsv'); await fs.writeFile(telemetry, 'writer may still be alive\n');
  const before = (await fs.readdir(h.root)).sort(); let admitted = false;
  await assert.rejects(async () => {
    const store = await h.open({ kill() { throw Object.assign(new Error('parent absent'), { code: 'ESRCH' }); } });
    await store.admit({ forecastBytes: 1 }); admitted = true;
  }, { code: 'OPERATION_STORAGE_RECOVERY_REQUIRED' });
  assert.equal(admitted, false); assert.deepEqual((await fs.readdir(h.root)).sort(), before);
  assert.equal(await fs.readFile(path.join(h.root, '.storage-lease.json'), 'utf8'), lease);
  assert.equal(await fs.readFile(path.join(h.root, '.storage-ledger.json'), 'utf8'), ledger);
  assert.equal(await fs.readFile(path.join(job, 'storage-reservation.json'), 'utf8'), reservation);
  assert.equal(await fs.readFile(telemetry, 'utf8'), 'writer may still be alive\n');
  assert.deepEqual((await fs.readdir(job)).sort(), ['storage-reservation.json', 'unfinished-encoder-stats.tsv']);
});

for (const kind of ['alive', 'unknown', 'corrupt']) test(`pre-existing ${kind} lease requires writer-closure recovery and remains preserved`, async t => {
  const h = await fixture(t); await fs.mkdir(h.root); const lease = path.join(h.root, '.storage-lease.json');
  const content = kind === 'corrupt' ? 'invalid' : JSON.stringify({ schema: 1, pid: 2147483647, token: randomUUID(), processToken: randomUUID() });
  await fs.writeFile(lease, content);
  await assert.rejects(h.open({ kill() { throw new Error('Parent liveness must not be consulted.'); } }), { code: 'OPERATION_STORAGE_RECOVERY_REQUIRED' });
  assert.equal(await fs.readFile(lease, 'utf8'), content);
});

test('hard-linked unknown files cannot redirect accounting or be deleted', async t => {
  const h = await fixture(t); await fs.mkdir(h.root); const outside = path.join(h.home, 'outside.txt');
  await fs.writeFile(outside, 'preserve'); await fs.link(outside, path.join(h.root, 'linked.txt'));
  await assert.rejects(h.open(), { code: 'OPERATION_STORAGE_PATH' });
  assert.equal(await fs.readFile(outside, 'utf8'), 'preserve'); assert.equal((await fs.stat(outside)).nlink, 2);
});

test('observable directory reparse markers and special files fail closed', async t => {
  const h = await fixture(t); await fs.mkdir(h.root); const special = path.join(h.root, 'special.txt'); await fs.writeFile(special, 'retained');
  for (const kind of ['root-reparse', 'special']) {
    const io = { ...fs, statfs: hugeSpace, async lstat(file, options) {
      const stat = await fs.lstat(file, options);
      if (kind === 'root-reparse' && file === h.root) stat.isSymbolicLink = () => true;
      if (kind === 'special' && file === special) { stat.isFile = () => false; stat.isDirectory = () => false; }
      return stat;
    } };
    await assert.rejects(h.open({ io }), { code: 'OPERATION_STORAGE_PATH' });
  }
  assert.equal(await fs.readFile(special, 'utf8'), 'retained');
});

test('fresh reservation directory identity cannot be replaced by another ordinary directory', async t => {
  const h = await fixture(t), store = await h.open(), reservation = await store.admit({ forecastBytes: 1 });
  const previous = reservation.directory + '-preserved'; await fs.rename(reservation.directory, previous); await fs.mkdir(reservation.directory);
  await assert.rejects(store.observeGrowth(reservation), { code: 'OPERATION_STORAGE_PATH' });
  assert.ok((await fs.readdir(previous)).includes('storage-reservation.json'));
});

test('one membership insertion retries a complete scan and counts new bytes once without resetting reservations', async t => {
  const { control, io } = controlledScanIO(), h = await fixture(t, { io }), store = await h.open();
  const first = await store.admit({ forecastBytes: 1 }), second = await store.admit({ forecastBytes: 1 });
  await fs.writeFile(path.join(first.directory, 'existing-spool.tsv'), Buffer.alloc(3000));
  const before = await store.snapshot(), inserted = Buffer.alloc(8192);
  control.directory = first.directory;
  control.afterEntries = async attempt => {
    if (attempt === 1) {
      await fs.writeFile(path.join(first.directory, 'new-owned-spool.tsv'), inserted); control.generation++;
    }
  };
  const observed = await store.observeGrowth(first);
  assert.equal(control.attempts, 2); assert.equal(observed.observationAttempts, 2); assert.equal(observed.maxObservationAttempts, 3);
  assert.equal(control.visits.filter(file => file === h.root).length, 2);
  assert.equal(control.visits.filter(file => file === second.directory).length, 2, 'Every retry visits the whole namespace.');
  assert.equal(observed.usedBytes, before.usedBytes + inserted.length); assert.equal(observed.entries, before.entries + 1);
  assert.equal(observed.reservedBytes, before.reservedBytes - inserted.length);
  assert.equal(observed.projectedBytes, before.projectedBytes);
  for (const job of observed.jobs) {
    const previous = before.jobs.find(old => old.id === job.id);
    assert.equal(job.reservedBytes, previous.reservedBytes); assert.equal(job.overReservation, false);
    assert.equal(job.remainingBytes, job.reservedBytes - job.actualBytes);
  }
  assert.equal(observed.jobs.find(job => job.id === first.id).actualBytes, before.jobs.find(job => job.id === first.id).actualBytes + inserted.length);
  assert.equal(observed.jobs.find(job => job.id === second.id).actualBytes, before.jobs.find(job => job.id === second.id).actualBytes);
  assert.equal(await store.assertReservation(first), true); assert.equal(await store.assertReservation(second), true);
});

test('persistent membership churn exhausts three complete scans and retains the last complete accounting', async t => {
  const { control, io } = controlledScanIO(), h = await fixture(t, { io }), store = await h.open();
  const reservation = await store.admit({ forecastBytes: 1 }), before = await store.snapshot();
  control.directory = reservation.directory;
  control.afterEntries = async attempt => {
    await fs.writeFile(path.join(reservation.directory, `owned-spool-${attempt}.tsv`), 'xx'); control.generation++;
  };
  await assert.rejects(store.observeGrowth(reservation), error => {
    assert.equal(error.code, 'OPERATION_STORAGE_OBSERVATION'); assert.equal(error.reason, 'namespace-membership-changed');
    assert.equal(error.message, 'Evidence namespace membership changed during accounting.');
    assert.equal(error.observationAttempts, 3); assert.equal(error.maxObservationAttempts, 3);
    assert.equal(error.accounting.observation, 'unavailable'); assert.equal(error.accounting.recordPersisted, false);
    assert.equal(error.accounting.lastObserved, before); assert.equal(error.storageSnapshot, before); return true;
  });
  assert.equal(control.attempts, 3); assert.equal(control.visits.filter(file => file === h.root).length, 3);
  control.afterEntries = null;
  const stable = await store.snapshot();
  assert.equal(stable.observationAttempts, 1); assert.equal(stable.usedBytes, before.usedBytes + 6);
  assert.equal(stable.reservedBytes, before.reservedBytes - 6); assert.equal(stable.projectedBytes, before.projectedBytes);
  assert.equal(stable.jobs[0].reservedBytes, before.jobs[0].reservedBytes);
  assert.equal(await store.assertReservation(reservation), true);
});

for (const kind of ['cumulative-cap', 'free-space-floor']) test(`a stable retry still enforces the ${kind}`, async t => {
  const { control, io } = controlledScanIO(); let available = 100n * BigInt(MiB);
  io.statfs = async () => ({ bavail: available, bsize: 1n });
  const h = await fixture(t, { io, capBytes: 64 * MiB, minFreeBytes: kind === 'free-space-floor' ? 40 * MiB : 0 });
  const store = await h.open(), reservation = await store.admit({ forecastBytes: 1 });
  control.directory = reservation.directory;
  control.afterEntries = async attempt => {
    if (attempt !== 1) return;
    await sized(path.join(reservation.directory, 'new-owned-spool.tsv'), kind === 'cumulative-cap' ? 65 * MiB : 1000);
    if (kind === 'free-space-floor') available = 39n * BigInt(MiB);
    control.generation++;
  };
  await assert.rejects(store.observeGrowth(reservation), error => {
    assert.equal(error.code, 'OPERATION_STORAGE_LIMIT'); assert.equal(error.accounting.observation, 'complete');
    assert.ok(error.accounting.violations.includes(kind)); assert.equal(error.storageSnapshot.observationAttempts, 2);
    assert.equal(error.storageSnapshot.jobs[0].reservedBytes, LIMITS.initialReserveBytes); return true;
  });
  assert.equal(control.attempts, 2);
});

for (const kind of ['identity', 'reparse', 'unreadable', 'same-message-error']) test(`directory ${kind} failure never authorizes a membership retry`, async t => {
  const { control, io } = controlledScanIO(), h = await fixture(t, { io }), store = await h.open();
  const reservation = await store.admit({ forecastBytes: 1 }), before = await store.snapshot();
  control.directory = reservation.directory;
  control.afterEntries = async () => {
    control.generation++;
    if (kind === 'unreadable') throw Object.assign(new Error('Injected directory read error.'), { code: 'EIO' });
    if (kind === 'same-message-error') throw Object.assign(new Error('Evidence namespace membership changed during accounting.'), { code: 'OPERATION_STORAGE_OBSERVATION' });
    control.mutateStat = stat => {
      if (kind === 'identity') stat.ino += 1n;
      if (kind === 'reparse') stat.isSymbolicLink = () => true;
    };
  };
  await assert.rejects(store.observeGrowth(reservation), error => {
    assert.equal(error.code, kind === 'reparse' ? 'OPERATION_STORAGE_PATH' : 'OPERATION_STORAGE_OBSERVATION');
    assert.equal(error.reason, undefined); assert.equal(error.observationAttempts, undefined);
    assert.equal(error.accounting.observation, 'unavailable'); assert.equal(error.accounting.lastObserved, before); return true;
  });
  assert.equal(control.attempts, 1); assert.equal(control.visits.filter(file => file === h.root).length, 1);
  control.directory = null;
  assert.equal(await store.assertReservation(reservation), true);
});

test('directory identity replacement between otherwise retryable scans fails before another directory listing', async t => {
  const { control, io } = controlledScanIO(); let replace = false;
  const wrapped = { ...io, async opendir(file) {
    if (control.directory && file === h.root && control.attempts === 1) replace = true;
    return io.opendir(file);
  }, async lstat(file, options) {
    const stat = await io.lstat(file, options);
    if (replace && file === control.directory) stat.ino += 1n;
    return stat;
  } };
  const h = await fixture(t, { io: wrapped }), store = await h.open();
  const reservation = await store.admit({ forecastBytes: 1 }); control.directory = reservation.directory;
  control.afterEntries = async () => { control.generation++; };
  await assert.rejects(store.observeGrowth(reservation), error => error.code === 'OPERATION_STORAGE_OBSERVATION'
    && /directory changed identity/.test(error.message) && error.observationAttempts === undefined);
  assert.equal(control.attempts, 1, 'The replacement must not be rescanned as a legitimate namespace.');
  control.directory = null;
});

for (const kind of ['special', 'entry-limit', 'depth-limit']) test(`membership churn cannot hide a later ${kind} failure in the same full scan`, async t => {
  const { control, io } = controlledScanIO(), h = await fixture(t, { io, ...(kind === 'entry-limit' ? { maxEntries: 7 } : {}),
    ...(kind === 'depth-limit' ? { maxDepth: 2 } : {}) }), store = await h.open();
  const reservation = await store.admit({ forecastBytes: 1 });
  const churn = path.join(reservation.directory, 'a-churn'), later = path.join(reservation.directory, 'z-later');
  await fs.mkdir(churn); await fs.mkdir(later);
  const suspect = path.join(later, 'retained.txt'); await fs.writeFile(suspect, 'preserve');
  if (kind === 'entry-limit') await fs.writeFile(path.join(later, 'more.txt'), 'preserve');
  if (kind === 'depth-limit') await fs.mkdir(path.join(later, 'too-deep'));
  if (kind === 'special') {
    const baseLstat = io.lstat;
    io.lstat = async (file, options) => {
      const stat = await baseLstat(file, options);
      if (file === suspect) { stat.isFile = () => false; stat.isDirectory = () => false; }
      return stat;
    };
  }
  control.directory = churn; control.afterEntries = async () => { control.generation++; };
  await assert.rejects(store.snapshot(), error => {
    assert.equal(error.code, kind === 'special' ? 'OPERATION_STORAGE_PATH' : 'OPERATION_STORAGE_OBSERVATION');
    assert.equal(error.reason, undefined); assert.equal(error.observationAttempts, undefined); return true;
  });
  assert.equal(control.attempts, 1); assert.equal(control.visits.filter(file => file === h.root).length, 1);
  assert.equal(await fs.readFile(suspect, 'utf8'), 'preserve'); control.directory = null;
});

test('entry and depth caps refuse incomplete namespace accounting', async t => {
  const a = await fixture(t, { maxEntries: 4 }), first = await a.open(), reservation = await first.admit({ forecastBytes: 1 });
  await fs.writeFile(path.join(reservation.directory, 'extra.txt'), 'x');
  await assert.rejects(first.snapshot(), { code: 'OPERATION_STORAGE_OBSERVATION' });
  const b = await fixture(t, { maxDepth: 1 }), second = await b.open(), job = await second.admit({ forecastBytes: 1 });
  await fs.mkdir(path.join(job.directory, 'nested'));
  await assert.rejects(second.snapshot(), { code: 'OPERATION_STORAGE_OBSERVATION' });
});

test('growth detects reservation and cumulative overrun, preserves final bytes and refuses the next job', async t => {
  const h = await fixture(t, { capBytes: 64 * MiB }), store = await h.open(), reservation = await store.admit({ forecastBytes: 1 });
  const file = path.join(reservation.directory, 'encoder-stats.tsv'); await sized(file, 65 * MiB);
  await assert.rejects(store.observeGrowth(reservation), error => {
    assert.equal(error.code, 'OPERATION_STORAGE_LIMIT'); assert.ok(error.storageSnapshot.usedBytes >= 65 * MiB);
    assert.equal(error.storageSnapshot.overCap, true); assert.ok(error.accounting.violations.includes('job-reservation')); return true;
  });
  const final = await store.finish(reservation, { status: 'failed' });
  assert.equal(final.final.recordPersisted, true); assert.ok(final.final.violations.includes('cumulative-cap')); assert.ok(final.final.violations.includes('job-reservation'));
  assert.ok(final.usedBytes >= 65 * MiB); assert.equal((await fs.stat(file)).size, 65 * MiB);
  assert.equal(JSON.parse(await fs.readFile(path.join(h.root, '.storage-ledger.json'), 'utf8')).final.status, 'failed');
  await assert.rejects(store.admit({ forecastBytes: 1 }), { code: 'OPERATION_STORAGE_LIMIT' });
  await store.close(); const reopened = await h.open(); assert.ok((await reopened.snapshot()).usedBytes >= 65 * MiB);
  await assert.rejects(reopened.admit({ forecastBytes: 1 }), { code: 'OPERATION_STORAGE_LIMIT' });
});

test('free-space admission includes outstanding reservations and growth reports an actual floor breach', async t => {
  let available = 100n * BigInt(MiB);
  const io = { ...fs, statfs: async () => ({ bavail: available, bsize: 1n }) };
  const h = await fixture(t, { io, minFreeBytes: 40 * MiB }), store = await h.open();
  const reservation = await store.admit({ forecastBytes: 1 });
  await assert.rejects(store.admit({ forecastBytes: 1 }), { code: 'OPERATION_STORAGE_ADMISSION' });
  available = 39n * BigInt(MiB);
  await assert.rejects(store.observeGrowth(reservation), error => error.code === 'OPERATION_STORAGE_LIMIT' && error.accounting.violations.includes('free-space-floor'));
  assert.ok((await store.finish(reservation, { status: 'cancelled' })).final.violations.includes('free-space-floor'));
});

test('unavailable observation reports uncertainty and cannot invent a zero-usage final record', async t => {
  let fail = false; const io = { ...fs, statfs: async () => { if (fail) throw Object.assign(new Error('unavailable'), { code: 'EIO' }); return hugeSpace(); } };
  const h = await fixture(t, { io }), store = await h.open(), reservation = await store.admit({ forecastBytes: 1 });
  await fs.writeFile(path.join(reservation.directory, 'retained.txt'), 'do not reset'); fail = true;
  await assert.rejects(store.observeGrowth(reservation), error => error.code === 'OPERATION_STORAGE_OBSERVATION' && error.accounting.observation === 'unavailable');
  await assert.rejects(store.finish(reservation, { status: 'failed' }), error => error.accounting.observation === 'unavailable' && error.accounting.recordPersisted === true);
  const retained = JSON.parse(await fs.readFile(path.join(reservation.directory, 'storage-final.json'), 'utf8'));
  assert.equal(retained.observation, 'unavailable'); assert.ok(retained.lastObserved.usedBytes > 0);
  const ledger = JSON.parse(await fs.readFile(path.join(h.root, '.storage-ledger.json'), 'utf8'));
  assert.equal(ledger.accounting.accountingReset, false); assert.equal(ledger.accounting.observation, 'unavailable');
  fail = false; const final = await store.finish(reservation, { status: 'failed' }); assert.equal(final.final.recordPersisted, true);
  assert.ok(final.final.violations.includes('observation-unavailable'));
});

test('ledger rename failure retains its temporary bytes and final recording can be retried', async t => {
  let deny = false;
  const io = { ...fs, statfs: hugeSpace, async rename(source, destination) {
    if (deny && path.basename(destination) === '.storage-ledger.json') throw Object.assign(new Error('injected rename failure'), { code: 'EIO' });
    return fs.rename(source, destination);
  } };
  const h = await fixture(t, { io }), store = await h.open(), reservation = await store.admit({ forecastBytes: 1 });
  deny = true; await assert.rejects(store.finish(reservation, { status: 'failed' }), { code: 'OPERATION_STORAGE_OBSERVATION' });
  assert.equal(JSON.parse(await fs.readFile(path.join(reservation.directory, 'storage-final.json'), 'utf8')).status, 'failed');
  assert.ok((await fs.readdir(h.root)).some(name => name.startsWith('.storage-ledger.next-')));
  deny = false; const final = await store.finish(reservation, { status: 'failed' }); assert.equal(final.final.recordPersisted, true);
});

test('unsupported directory fsync is stated explicitly while restart reconciliation remains mandatory', async t => {
  const h = await fixture(t);
  const io = { ...fs, statfs: hugeSpace, async open(file, flags) {
    if (file === h.root && flags === 'r') throw Object.assign(new Error('directory sync unsupported'), { code: 'EPERM' });
    return fs.open(file, flags);
  } };
  const store = await h.open({ io }); assert.equal((await store.snapshot()).directorySync, 'unsupported');
  const ledger = JSON.parse(await fs.readFile(path.join(h.root, '.storage-ledger.json'), 'utf8'));
  assert.equal(ledger.reconciliationRequiredOnRestart, true); assert.match(ledger.durability, /file-synced-before-rename/);
});
