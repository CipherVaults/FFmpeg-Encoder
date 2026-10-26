'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Main-private only. Reuse the retained operation store's genuine reservation,
// directory checks, cumulative accounting and lease. No renderer paths or saved
// JSON receipts can restore a live native initialization capability.
const MAX_BYTES = 512 * 1024;
const fail = message => Object.assign(new Error(message), { code: 'NATIVE_INITIALIZATION_NOT_RETAINED' });
async function retainNativeInitialization({ store, report }) {
  if (!report || !['observed', 'untested'].includes(report.status)
      || !Array.isArray(report.invocations) || report.invocations.length !== 1) {
    throw fail('Only a terminal owned initializer capture can be retained.');
  }
  const { initialization, ...description } = report;
  const bytes = Buffer.from(JSON.stringify({ schema: 1, kind: 'native-initialization-capture',
    authority: 'diagnostic-only; serialized bytes do not restore initialization',
    storageCompletionMeans: 'capture retained, independent of initialization/qualification outcome', report: description }) + '\n');
  if (bytes.length > MAX_BYTES) throw fail('The initializer report exceeds its retained byte bound.');
  let reservation, handle, finalizing = false, completed = false;
  try {
    reservation = await store.admit({ forecastBytes: MAX_BYTES + 65536 });
    await store.assertReservation(reservation);
    const file = path.join(reservation.directory, 'native-initialization.json');
    handle = await fs.open(file, 'wx+');
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.nlink !== 1n || !before.dev || !before.ino) throw fail('Initializer evidence is not an ordinary exclusive file.');
    await handle.writeFile(bytes); await handle.sync();
    const actual = Buffer.alloc(bytes.length + 1), read = await handle.read(actual, 0, actual.length, 0);
    const after = await handle.stat({ bigint: true }), named = await fs.lstat(file, { bigint: true });
    if (read.bytesRead !== bytes.length || !actual.subarray(0, read.bytesRead).equals(bytes)
        || after.size !== BigInt(bytes.length) || after.nlink !== 1n || named.isSymbolicLink()
        || ['dev', 'ino', 'birthtimeNs'].some(key => before[key] !== after[key] || after[key] !== named[key])
        || ['size', 'mtimeNs', 'ctimeNs', 'nlink'].some(key => after[key] !== named[key])) throw fail('Initializer evidence changed during durable readback.');
    await handle.close(); handle = null;
    await store.assertReservation(reservation); await store.observeGrowth(reservation);
    finalizing = true; await store.finish(reservation, { status: 'completed' }); completed = true;
    return Object.freeze({ persisted: true, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), reservationId: reservation.id });
  } catch (error) {
    reservation ||= error.storageReservation;
    throw Object.assign(fail('The initializer capture was not confirmed durably retained. Qualification remains unavailable.'), { cause: error });
  } finally {
    // A close/final accounting failure rejects this promise. Existing incomplete
    // evidence is retained; no retry, replacement or deletion is inferred.
    try { if (handle) await handle.close(); }
    finally { if (reservation && !completed && !finalizing) await store.finish(reservation, { status: 'failed' }); }
  }
}

module.exports = { retainNativeInitialization, MAX_BYTES };
