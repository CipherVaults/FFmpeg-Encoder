'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

// Main-private retained evidence accounting. No saved object grants media,
// publication or cleanup authority. Reconcile filesystem truth on every action.
// stat.size budgets logical named-file bytes; statfs separately observes volume
// free space. Polling can detect an overrun after a child writes it, never impose
// a hard write cap. lstat/realpath reject observable links/junctions/aliases, not
// every Windows filter/reparse class or malicious same-user path replacement.
const LIMITS = Object.freeze({ capBytes: 1024 * 1024 * 1024, initialReserveBytes: 32 * 1024 * 1024,
  minFreeBytes: 25 * 1024 * 1024 * 1024, metadataHeadroomBytes: 64 * 1024, maxEntries: 4096, maxDepth: 4 });
const LEASE = '.storage-lease.json', LEDGER = '.storage-ledger.json', MAX_METADATA = 32 * 1024;
const MAX_WALK_ATTEMPTS = 3;
const PROCESS_TOKEN = randomUUID();
const fault = (code, message, details = {}) => Object.assign(new Error(message), { code, ...details });
const need = (value, message, code = 'OPERATION_STORAGE_INVALID') => { if (!value) throw fault(code, message); };
const freeze = value => { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const sameObject = (a, b) => a && b && a.dev !== 0n && a.ino !== 0n && a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameFile = (a, b) => sameObject(a, b) && ['size', 'nlink', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const canonical = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const errorRecord = error => ({ code: String(error?.code || 'ERROR').slice(0, 128), message: String(error?.message || error).slice(0, 1000) });
function safeNumber(value, name, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  need(Number.isSafeInteger(value) && value >= minimum && value <= maximum, `${name} must be an exact bounded integer.`); return value;
}
function safeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 255 && !/[\x00-\x1f\x7f<>:"/\\|?*]/.test(name)
    && !/[. ]$/.test(name) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) && name !== '.' && name !== '..';
}
function rootPath(value) {
  need(typeof value === 'string' && value.length <= 32760 && path.isAbsolute(value) && path.normalize(value) === value,
    'An absolute canonical main-owned evidence root is required.', 'OPERATION_STORAGE_PATH');
  const base = path.parse(value).root;
  need(process.platform === 'win32' ? /^[A-Za-z]:\\$/.test(base) : base === '/' && !value.startsWith('//'),
    'Evidence requires an ordinary local filesystem path.', 'OPERATION_STORAGE_PATH');
  const parts = value.slice(base.length).split(path.sep);
  need(parts.length > 0 && parts.length <= 128 && parts.every(safeName), 'Unsafe evidence root components.', 'OPERATION_STORAGE_PATH');
  return { base, parts };
}
function regular(stat) { return stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n && stat.dev !== 0n && stat.ino !== 0n; }
function directory(stat) { return stat.isDirectory() && !stat.isSymbolicLink() && stat.dev !== 0n && stat.ino !== 0n; }

async function openEvidenceStorage(options = {}) {
  const { root, io = fs } = options;
  const parsed = rootPath(root), config = Object.fromEntries(Object.keys(LIMITS).map(key => [key, options[key] ?? LIMITS[key]]));
  safeNumber(config.capBytes, 'Cumulative cap', LIMITS.initialReserveBytes + LIMITS.metadataHeadroomBytes, LIMITS.capBytes);
  safeNumber(config.initialReserveBytes, 'Initial reservation', LIMITS.initialReserveBytes, config.capBytes);
  safeNumber(config.metadataHeadroomBytes, 'Metadata headroom', LIMITS.metadataHeadroomBytes, LIMITS.metadataHeadroomBytes);
  safeNumber(config.minFreeBytes, 'Free-space floor'); safeNumber(config.maxEntries, 'Walk entries', 4, LIMITS.maxEntries);
  safeNumber(config.maxDepth, 'Walk depth', 1, LIMITS.maxDepth);
  const ancestors = [], reservations = new WeakMap(), active = new Map();
  let name = parsed.base, closed = false, tail = Promise.resolve(), leaseHandle, leaseIdentity, leaseBytes;
  let lastSnapshot = null, ledgerState = 'missing-reconciled', startupLedgerState = 'missing-reconciled', leaseRecovery = 'none', directorySync = 'not-attempted';
  async function ordinaryDirectory(file) {
    const stat = await io.lstat(file, { bigint: true });
    need(directory(stat) && canonical(await io.realpath(file)) === canonical(file), 'Linked, redirected or ambiguous evidence directory.', 'OPERATION_STORAGE_PATH');
    return stat;
  }
  // Only the final namespace may be created. Never recursively create through
  // an unobserved ancestor, and retain identities for every later operation.
  for (let index = -1; index < parsed.parts.length; index++) {
    if (index >= 0) name = path.join(name, parsed.parts[index]);
    let stat;
    try { stat = await ordinaryDirectory(name); }
    catch (error) {
      if (error.code !== 'ENOENT' || index !== parsed.parts.length - 1) throw error;
      await io.mkdir(name); stat = await ordinaryDirectory(name);
    }
    ancestors.push({ path: name, stat });
  }
  async function guardDirectories() {
    for (const entry of ancestors) need(sameObject(entry.stat, await ordinaryDirectory(entry.path)),
      'An evidence namespace ancestor changed.', 'OPERATION_STORAGE_PATH');
  }
  async function readMetadata(file, maximum = MAX_METADATA) {
    const before = await io.lstat(file, { bigint: true });
    need(regular(before) && before.size <= BigInt(maximum), 'Unsafe or oversized storage metadata; preserved.', 'OPERATION_STORAGE_PATH');
    const handle = await io.open(file, 'r');
    try {
      need(sameFile(before, await handle.stat({ bigint: true })), 'Storage metadata changed before reading.', 'OPERATION_STORAGE_PATH');
      const bytes = await handle.readFile();
      need(bytes.length <= maximum && sameFile(before, await handle.stat({ bigint: true })) && sameFile(before, await io.lstat(file, { bigint: true })),
        'Storage metadata changed while reading.', 'OPERATION_STORAGE_PATH');
      return { bytes, stat: before };
    } finally { await handle.close(); }
  }
  const leasePath = path.join(root, LEASE);
  async function acquireLease() {
    await guardDirectories();
    try { leaseHandle = await io.open(leasePath, 'wx+'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Parent PID death (including ESRCH) cannot prove that an orphaned FFmpeg
      // child stopped writing. Saved lease/ledger/reservation JSON supplies no
      // writer-closure authority. Preserve the entire old namespace and refuse
      // new work until a separate scoped manual reconciliation proves closure.
      throw fault('OPERATION_STORAGE_RECOVERY_REQUIRED',
        'A prior evidence lease exists; writer closure is unverified. Preserve the lease and evidence for scoped manual recovery.',
        { recoveryRequired: true, writerClosure: 'unverified', leaseRetained: true });
    }
    leaseBytes = Buffer.from(JSON.stringify({ schema: 1, pid: process.pid, processToken: PROCESS_TOKEN, token: randomUUID(),
      writerClosureAuthority: false, recoveryPolicy: 'manual-scoped-writer-closure-reconciliation' }) + '\n');
    leaseIdentity = await leaseHandle.stat({ bigint: true });
    need(regular(leaseIdentity) && leaseIdentity.size === 0n && sameFile(leaseIdentity, await io.lstat(leasePath, { bigint: true })),
      'Exclusive evidence lease is not bound.', 'OPERATION_STORAGE_LEASE');
    await leaseHandle.writeFile(leaseBytes); leaseIdentity = await leaseHandle.stat({ bigint: true }); await leaseHandle.sync();
  }
  async function guard() {
    need(!closed, 'Evidence storage is closed.', 'OPERATION_STORAGE_CLOSED'); await guardDirectories();
    const named = await io.lstat(leasePath, { bigint: true });
    need(regular(named) && sameFile(leaseIdentity, named) && sameFile(named, await leaseHandle.stat({ bigint: true })),
      'Evidence lease identity changed; no further admission is permitted.', 'OPERATION_STORAGE_LEASE');
  }
  async function walk() {
    const identities = new Map();
    for (let attempt = 1; attempt <= MAX_WALK_ATTEMPTS; attempt++) {
      await guard(); let total = 0n, entries = 0, membershipChanged = false; const jobs = new Map();
      async function visit(file, depth, jobId, expected = null) {
        const before = await ordinaryDirectory(file), previous = identities.get(file);
        need((!expected || sameObject(expected, before)) && (!previous || sameObject(previous, before)),
          'An evidence directory changed identity while accounting.', 'OPERATION_STORAGE_OBSERVATION');
        identities.set(file, before);
        const listing = await io.opendir(file);
        for await (const entry of listing) {
          need(++entries <= config.maxEntries && safeName(entry.name), 'Evidence walk entry limit or unsafe name; space is unknown.', 'OPERATION_STORAGE_OBSERVATION');
          const child = path.join(file, entry.name), stat = await io.lstat(child, { bigint: true });
          const id = depth === 0 && active.has(entry.name) ? entry.name : jobId;
          if (directory(stat)) {
            need(depth + 1 <= config.maxDepth, 'Evidence walk depth limit; space is unknown.', 'OPERATION_STORAGE_OBSERVATION');
            await visit(child, depth + 1, id, stat);
          } else {
            need(regular(stat) && canonical(await io.realpath(child)) === canonical(child),
              'Evidence contains a link, special file or ambiguous object; preserved.', 'OPERATION_STORAGE_PATH');
            const after = await io.lstat(child, { bigint: true });
            need(regular(after) && sameObject(stat, after) && after.size >= stat.size,
              'An evidence file changed identity or shrank while accounting.', 'OPERATION_STORAGE_OBSERVATION');
            total += after.size; if (id) jobs.set(id, (jobs.get(id) || 0n) + after.size);
          }
        }
        const after = await ordinaryDirectory(file);
        need(sameObject(before, after), 'An evidence directory changed identity while accounting.', 'OPERATION_STORAGE_OBSERVATION');
        // A collector may add an owned spool while this full scan is running.
        // Finish checking the namespace so a later unsafe object/read/limit is
        // never hidden by churn, then discard all counts and start afresh. Only
        // this observed same-object mtime change permits a bounded retry.
        if (before.mtimeNs !== after.mtimeNs) membershipChanged = true;
      }
      await visit(root, 0, null); await guard();
      need(total <= BigInt(Number.MAX_SAFE_INTEGER), 'Evidence total cannot be represented exactly.', 'OPERATION_STORAGE_OBSERVATION');
      if (membershipChanged) {
        if (attempt < MAX_WALK_ATTEMPTS) continue;
        throw fault('OPERATION_STORAGE_OBSERVATION', 'Evidence namespace membership changed during accounting.',
          { reason: 'namespace-membership-changed', observationAttempts: attempt, maxObservationAttempts: MAX_WALK_ATTEMPTS });
      }
      const statfs = await io.statfs(root, { bigint: true });
      need(typeof statfs.bavail === 'bigint' && typeof statfs.bsize === 'bigint' && statfs.bavail >= 0n && statfs.bsize > 0n,
        'Available filesystem space is unknown.', 'OPERATION_STORAGE_OBSERVATION');
      const free = statfs.bavail * statfs.bsize;
      let reserved = 0; const currentJobs = [];
      for (const item of active.values()) {
        const actual = Number(jobs.get(item.id) || 0n); const remaining = Math.max(0, item.reservedBytes - actual); reserved += remaining;
        currentJobs.push({ id: item.id, actualBytes: actual, reservedBytes: item.reservedBytes, remainingBytes: remaining, overReservation: actual > item.reservedBytes });
      }
      const usedBytes = Number(total), projectedBytes = usedBytes + reserved + config.metadataHeadroomBytes;
      const result = { schema: 1, observation: 'complete', consistency: 'bounded-point-observations', observationAttempts: attempt,
        maxObservationAttempts: MAX_WALK_ATTEMPTS, usedBytes, reservedBytes: reserved,
        projectedBytes, capBytes: config.capBytes, metadataHeadroomBytes: config.metadataHeadroomBytes, entries,
        freeBytes: Number(free > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : free), minFreeBytes: config.minFreeBytes,
        overCap: usedBytes > config.capBytes, overAdmissionCap: projectedBytes > config.capBytes,
        lowFree: free < BigInt(config.minFreeBytes), jobs: currentJobs, leaseRecovery, ledgerState, startupLedgerState, directorySync,
        hardWriteCap: false };
      lastSnapshot = freeze(result); return lastSnapshot;
    }
  }
  async function writeExclusive(file, payload) {
    const bytes = Buffer.from(JSON.stringify(payload) + '\n'); need(bytes.length <= MAX_METADATA, 'Storage metadata bound exceeded.');
    await guard(); const handle = await io.open(file, 'wx+'); let stat;
    try {
      stat = await handle.stat({ bigint: true });
      need(regular(stat) && stat.size === 0n && sameFile(stat, await io.lstat(file, { bigint: true })), 'Storage metadata reservation changed.', 'OPERATION_STORAGE_PATH');
      await handle.writeFile(bytes); await handle.sync(); stat = await handle.stat({ bigint: true });
      need(regular(stat) && sameFile(stat, await io.lstat(file, { bigint: true })), 'Storage metadata changed while saving.', 'OPERATION_STORAGE_PATH');
      await guard(); return stat;
    } finally { await handle.close(); }
  }
  async function syncDirectory() {
    let handle;
    try { handle = await io.open(root, 'r'); await handle.sync(); directorySync = 'synced'; }
    catch (error) {
      if (['EPERM', 'EACCES', 'EISDIR', 'EINVAL', 'ENOTSUP', 'ENOSYS'].includes(error.code)) directorySync = 'unsupported';
      else throw error;
    } finally { if (handle) await handle.close(); }
  }
  async function persist(snapshot, final = null) {
    const temporary = path.join(root, '.storage-ledger.next-' + randomUUID());
    const created = await writeExclusive(temporary, { schema: 1, authority: 'diagnostic-only', reconciliationRequiredOnRestart: true,
      accounting: snapshot, final, durability: 'file-synced-before-rename; directory-sync-reported-separately' });
    const file = path.join(root, LEDGER);
    try { const current = await io.lstat(file, { bigint: true }); need(regular(current), 'Ledger target is linked or special; preserved.', 'OPERATION_STORAGE_PATH'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await guard(); need(sameFile(created, await io.lstat(temporary, { bigint: true })), 'Ledger temporary changed; preserved.', 'OPERATION_STORAGE_PATH');
    await io.rename(temporary, file); await syncDirectory(); await guard();
    need(sameObject(created, await io.lstat(file, { bigint: true })), 'Published ledger changed identity.', 'OPERATION_STORAGE_PATH');
    ledgerState = 'reconciled';
  }
  function attach(error, partial = null) {
    if (!String(error.code || '').startsWith('OPERATION_STORAGE_')) error = fault('OPERATION_STORAGE_OBSERVATION', 'Evidence accounting is unavailable; retained files are unchanged.', { cause: error });
    error.storageSnapshot = partial || lastSnapshot;
    error.accounting = freeze({ observation: 'unavailable', lastObserved: partial || lastSnapshot, failure: errorRecord(error), recordPersisted: false, retained: true });
    return error;
  }
  function violations(snapshot, item = null) {
    const reasons = [];
    if (snapshot.overCap || snapshot.overAdmissionCap) reasons.push('cumulative-cap');
    if (snapshot.lowFree) reasons.push('free-space-floor');
    if (item && snapshot.jobs.find(job => job.id === item.id)?.overReservation) reasons.push('job-reservation');
    return reasons;
  }
  function enforce(snapshot, item = null) {
    const reasons = violations(snapshot, item);
    if (reasons.length) throw fault('OPERATION_STORAGE_LIMIT', 'Evidence storage budget exceeded; cancel owned work and retain final accounting.',
      { storageSnapshot: snapshot, accounting: freeze({ observation: 'complete', violations: reasons, retained: true }) });
  }
  function trusted(reservation, allowFinished = false) {
    const item = reservations.get(reservation);
    need(item && (allowFinished || !item.finished), 'A live main-owned storage reservation is required.', 'OPERATION_STORAGE_RESERVATION'); return item;
  }
  function serial(action) {
    const pending = tail.then(action); tail = pending.catch(() => {}); return pending;
  }
  async function releaseLease() {
    if (!leaseHandle) return;
    const handle = leaseHandle;
    try {
      await guard(); const current = await readMetadata(leasePath, 4096);
      need(sameFile(leaseIdentity, current.stat) && current.bytes.equals(leaseBytes), 'Own lease changed; preserved.', 'OPERATION_STORAGE_LEASE');
      await io.unlink(leasePath);
    } finally { closed = true; leaseHandle = null; await handle.close(); }
  }
  try {
    await acquireLease();
    try {
      const previous = await readMetadata(path.join(root, LEDGER));
      try { const value = JSON.parse(previous.bytes.toString('utf8')); ledgerState = value?.schema === 1 && value.authority === 'diagnostic-only' ? 'existing-reconciled' : 'corrupt-reconciled'; }
      catch { ledgerState = 'corrupt-reconciled'; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    startupLedgerState = ledgerState;
    const initial = await walk(); await persist(initial); await walk();
  } catch (error) {
    let failure = attach(error);
    if (leaseHandle) { try { await releaseLease(); } catch (releaseError) { failure.leaseReleaseFailure = errorRecord(releaseError); } }
    throw failure;
  }
  return Object.freeze({
    admit(request) { return serial(async () => {
      need(request && Object.keys(request).length === 1 && Object.hasOwn(request, 'forecastBytes'), 'Admission requires an explicit disk-byte forecast.');
      const forecast = safeNumber(request.forecastBytes, 'Disk-byte forecast', 1, config.capBytes);
      let observed;
      try { observed = await walk(); } catch (error) { throw attach(error); }
      enforce(observed); const reservedBytes = Math.max(config.initialReserveBytes, forecast);
      if (observed.projectedBytes + reservedBytes > config.capBytes || observed.freeBytes - observed.reservedBytes - reservedBytes - config.metadataHeadroomBytes < config.minFreeBytes) {
        throw fault('OPERATION_STORAGE_ADMISSION', 'Insufficient retained evidence capacity or free space for this reservation.',
          { storageSnapshot: observed, accounting: freeze({ observation: 'complete', requestedReserveBytes: reservedBytes, admitted: false, retained: true }) });
      }
      const id = 'job-' + randomUUID(), directoryPath = path.join(root, id); await guard(); await io.mkdir(directoryPath);
      const item = { id, directory: directoryPath, identity: await ordinaryDirectory(directoryPath), reservedBytes, finished: false };
      const reservation = freeze({ directory: directoryPath, id }); reservations.set(reservation, item); active.set(id, item);
      try {
        await writeExclusive(path.join(directoryPath, 'storage-reservation.json'), { schema: 1, id, reservedBytes, forecastBytes: forecast,
          authority: 'diagnostic-only', streamedStdoutIsDiskUsage: false });
        const current = await walk(); await persist(current); enforce(current, item); return reservation;
      } catch (error) { const failure = attach(error); failure.storageReservation = reservation; throw failure; }
    }); },
    assertReservation(reservation) { return serial(async () => {
      const item = trusted(reservation); await guard();
      need(sameObject(item.identity, await ordinaryDirectory(item.directory)), 'Reservation directory changed.', 'OPERATION_STORAGE_PATH'); return true;
    }); },
    observeGrowth(reservation) { return serial(async () => {
      const item = trusted(reservation); let current;
      try {
        await guard(); need(sameObject(item.identity, await ordinaryDirectory(item.directory)), 'Reservation directory changed.', 'OPERATION_STORAGE_PATH');
        current = await walk(); await persist(current);
      } catch (error) { throw attach(error, current); }
      enforce(current, item); return current;
    }); },
    finish(reservation, { status } = {}) { return serial(async () => {
      const item = trusted(reservation, true); need(['completed', 'failed', 'cancelled', 'interrupted'].includes(status), 'An explicit final job status is required.');
      if (item.finished) return item.finalSnapshot;
      let current;
      try {
        await guard(); need(sameObject(item.identity, await ordinaryDirectory(item.directory)), 'Final reservation directory changed.', 'OPERATION_STORAGE_PATH');
        current = await walk();
        let final = item.finalRecord;
        if (final) need(final.status === status, 'Final status cannot change after the retained record was written.');
        else {
          final = { schema: 1, id: item.id, status, retained: true, observation: 'complete', observedBeforeRecord: current,
            violations: violations(current, item), authority: 'diagnostic-only', hardWriteCap: false };
          await writeExclusive(path.join(item.directory, 'storage-final.json'), final); item.finalRecord = final;
        }
        // Terminal metadata is allowed even after an overrun so the failure is
        // recorded honestly; it never authorizes another admission or deletion.
        active.delete(item.id); current = await walk();
        await persist(current, final.observation === 'unavailable' ? { ...final, reconciledObservation: current } : final); current = await walk();
        item.finished = true; item.finalSnapshot = freeze({ ...current, final: { id: item.id, status, recordPersisted: true,
          violations: [...new Set([...final.violations, ...violations(current)])], retained: true }, directorySync }); return item.finalSnapshot;
      } catch (error) {
        const failure = attach(error, current); let recordPersisted = Boolean(item.finalRecord), ledgerPersisted = false, recordFailure = null;
        if (!item.finalRecord) {
          try {
            await guard(); need(sameObject(item.identity, await ordinaryDirectory(item.directory)), 'Uncertain final directory; diagnostic write refused.', 'OPERATION_STORAGE_PATH');
            const final = { schema: 1, id: item.id, status, retained: true, observation: 'unavailable', lastObserved: current || lastSnapshot,
              failure: errorRecord(failure), violations: ['observation-unavailable'], authority: 'diagnostic-only', hardWriteCap: false };
            await writeExclusive(path.join(item.directory, 'storage-final.json'), final); item.finalRecord = final; recordPersisted = true;
          } catch (recordError) { recordFailure = errorRecord(recordError); }
        }
        if (item.finalRecord?.observation === 'unavailable') {
          try {
            await persist({ schema: 1, observation: 'unavailable', lastObserved: current || lastSnapshot, failure: errorRecord(failure),
              capBytes: config.capBytes, accountingReset: false }, item.finalRecord); ledgerPersisted = true;
          } catch (persistError) { recordFailure ||= errorRecord(persistError); }
        }
        failure.accounting = freeze({ observation: 'unavailable', lastObserved: current || lastSnapshot, failure: errorRecord(failure),
          recordPersisted, ledgerPersisted, recordFailure, retained: true }); throw failure;
      }
    }); },
    snapshot() { return serial(async () => { try { return await walk(); } catch (error) { throw attach(error); } }); },
    close() { return serial(async () => { if (closed) return; await releaseLease(); }); },
  });
}

module.exports = { openEvidenceStorage, LIMITS };
