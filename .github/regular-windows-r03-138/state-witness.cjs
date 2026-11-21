'use strict';

// Read-only normal-state oracle. Its nominated root must already be established
// by an owned exclusive supervisor; it creates/writes no product state.
const assert = require('node:assert/strict');
const { constants } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const ID = '[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}';
const uuid = new RegExp('^' + ID + '$'), eventName = new RegExp('^' + ID + '\\.json$');
const sameName = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const objectStamp = stat => [stat.dev, stat.ino, stat.birthtimeNs];
const byteStamp = stat => [...objectStamp(stat), stat.nlink, stat.size, stat.mtimeNs, stat.ctimeNs];
const absent = (e, ok) => { if (e.code === 'ENOENT') return ok; throw e; };
const reliable = st => st.dev !== 0n && st.ino !== 0n;
const namespaces = Object.freeze({ settings: ['appsettings-v1', 'settings.json'],
  appearance: ['appearance-v1', 'settings.json'], preferences: ['localpreferences-v1', 'preferences.json'],
  provenance: ['provenance-v1'], events: ['diagnostics-v1', 'events'] });
function components(base) { return Object.values(namespaces).some(value => value === base); }

async function createStateWitness(root) {
  assert(typeof root === 'string' && path.isAbsolute(root) && path.normalize(root) === root && root !== path.parse(root).root);
  const heldDirectories = new Map();
  let closed = [];
  let failedEnd = false;
  async function ordinaryDirectory(dir, allowMissing = false) {
    const st = await fs.lstat(dir, { bigint: true }).catch(e => absent(e, null));
    if (!st) {
      assert(allowMissing && !heldDirectories.has(dir), 'A held profile directory disappeared');
      return null;
    }
    assert(st.isDirectory() && !st.isSymbolicLink() && reliable(st) && sameName(await fs.realpath(dir), dir),
      'Profiling requires an ordinary canonical directory');
    const stamp = objectStamp(st);
    if (heldDirectories.has(dir)) assert.deepEqual(heldDirectories.get(dir), stamp, 'Profile directory identity changed');
    else heldDirectories.set(dir, stamp);
    return stamp;
  }
  await ordinaryDirectory(root);
  async function parentFor(names) {
    await ordinaryDirectory(root);
    let dir = root;
    for (const name of names) {
      dir = path.join(dir, name);
      if (!await ordinaryDirectory(dir, true)) return null;
    }
    return dir;
  }
  async function singleFile(base, cap, event = null) {
    assert(components(base) && (event === null || (base === namespaces.events && eventName.test(event))));
    const names = event ? [...base, event] : base;
    const dirs = names.slice(0, -1);
    const dir = await parentFor(dirs);
    if (!dir) return null;
    const file = path.join(dir, names.at(-1));
    const first = await fs.lstat(file, { bigint: true }).catch(e => absent(e, null));
    if (!first) return null;
    assert(first.isFile() && !first.isSymbolicLink() && reliable(first) && first.nlink === 1n && first.size > 0n
      && first.size <= BigInt(cap) && sameName(await fs.realpath(file), file), 'Bounded ordinary single-link state file required');
    const fd = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    try {
      const expected = byteStamp(first);
      assert.deepEqual(byteStamp(await fd.stat({ bigint: true })), expected);
      const bytes = Buffer.alloc(Number(first.size) + 1);
      let offset = 0, eof = false;
      while (offset < bytes.length) {
        const { bytesRead } = await fd.read(bytes, offset, bytes.length - offset, offset);
        if (bytesRead === 0) { eof = true; break; }
        offset += bytesRead;
      }
      assert(eof && offset === Number(first.size), 'Changed state file length or incomplete EOF');
      assert.deepEqual(byteStamp(await fd.stat({ bigint: true })), expected);
      assert.equal(await parentFor(dirs), dir);
      assert.deepEqual(byteStamp(await fs.lstat(file, { bigint: true })), expected);
      return bytes.subarray(0, offset);
    } finally { await fd.close(); }
  }
  async function list(base, max) {
    assert(components(base));
    const dir = await parentFor(base);
    if (!dir) return [];
    const handle = await fs.opendir(dir), entries = [];
    for await (const item of handle) {
      assert(entries.length < max, 'Finite state census exceeded');
      entries.push(item.name);
    }
    assert.equal(await parentFor(base), dir);
    return entries.sort();
  }
  async function readDisk() {
    const record = await singleFile(namespaces.settings, 16 * 1024);
    const neighbors = {
      appearancePresent: (await singleFile(namespaces.appearance, 16 * 1024)) !== null,
      preferencesPresent: (await singleFile(namespaces.preferences, 256 * 1024)) !== null,
      provenanceEntries: (await list(namespaces.provenance, 16)).length,
    };
    return { record, neighbors };
  }
  async function verifyFresh() {
    assert.deepEqual(await readDisk(), { record: null,
      neighbors: { appearancePresent: false, preferencesPresent: false, provenanceEntries: 0 } });
    assert.deepEqual(await list(namespaces.events, 128), [], 'No historical session can attest to this profile');
  }
  async function verifyDurableClose({ mainPid, ordinal }) {
    assert(!failedEnd && (ordinal === 1 || ordinal === 2) && ordinal === closed.length + 1);
    assert(Number.isSafeInteger(mainPid) && mainPid > 0);
    failedEnd = true;
    const names = await list(namespaces.events, 128), sessions = new Map();
    for (const name of names) {
      assert(eventName.test(name), 'Ordinary diagnostic record required');
      const raw = await singleFile(namespaces.events, 64 * 1024, name);
      assert(raw, 'Diagnostic list changed');
      const obj = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      assert.deepEqual(Object.keys(obj).sort(), ['digest', 'event', 'namespace', 'version']);
      assert(obj.namespace === 'diagnostics-v1' && obj.version === 1 && obj.digest === sha(JSON.stringify(obj.event)));
      const e = obj.event;
      assert(typeof e.id === 'string' && e.id + '.json' === name && typeof e.sessionId === 'string' && uuid.test(e.sessionId));
      assert(!Object.hasOwn(e, 'loggingGap'), 'A diagnostic logging gap cannot attest to a clean session');
      assert(Number.isSafeInteger(e.sequence) && e.sequence >= 0 && Number.isSafeInteger(e.at) && e.at >= 0);
      if (!sessions.has(e.sessionId)) { assert(sessions.size < ordinal, 'Unexpected session'); sessions.set(e.sessionId, []); }
      sessions.get(e.sessionId).push({ e, pin: sha(raw) });
    }
    assert.equal(sessions.size, ordinal, 'Expected distinct durable sessions');
    assert.deepEqual(await list(namespaces.events, 128), names, 'Diagnostic census changed');
    const chainPin = group => sha(group.map(row => row.pin).join('\n'));
    for (const old of closed) {
      const group = sessions.get(old.id);
      assert(group);
      group.sort((a, b) => a.e.sequence - b.e.sequence);
      assert.equal(chainPin(group), old.pin, 'Prior completed session changed');
      sessions.delete(old.id);
    }
    assert.equal(sessions.size, 1);
    const [id, rows] = [...sessions][0];
    rows.sort((a, b) => a.e.sequence - b.e.sequence);
    const events = rows.map(({ e }, sequence) => { assert.equal(e.sequence, sequence, 'Incomplete diagnostic sequence'); return e; });
    const first = events[0], last = events.at(-1);
    assert(first.type === 'session-start' && first.stage === 'startup' && first.reason === 'SESSION_STARTED'
      && first.owner?.pid === mainPid && typeof first.owner?.token === 'string' && uuid.test(first.owner.token), 'Session start is not owned by the measured main');
    assert(last.type === 'session-end' && last.stage === 'shutdown' && last.reason === 'SESSION_ENDED' && last.outcome === 'completed',
      'No durable completed session end');
    const middle = events.slice(1, -1);
    assert(middle.every(e => e.type === 'event' && e.severity === 'info'), 'Unexpected diagnostic operation');
    assert.deepEqual(middle.map(e => [e.stage, e.reason]), [
      ['capability', 'CAPABILITY_STARTED'], ['capability', 'CAPABILITY_FINISHED'], ['recovery', 'PROVENANCE_RECOVERY_FINISHED'],
      ...(ordinal === 1 ? [['admission', 'APP_DEFAULTS_SAVED'], ['admission', 'APP_DEFAULTS_SAVED']] : []),
    ], 'Only ordinary startup and two first-session settings saves');
    assert.deepEqual(middle[2].context?.recovery, {
      matching: 0, absent: 0, unrelated: 0, uncertain: 0, pendingRemaining: 0, warnings: [],
    }, 'No owned source/output should be consulted during clean provenance startup');
    assert.deepEqual(middle.filter(e => e.reason === 'APP_DEFAULTS_SAVED').map(e => e.context?.revision),
      ordinal === 1 ? [1, 2] : []);
    closed = [...closed, { id, pin: chainPin(rows) }];
    failedEnd = false;
    return true;
  }
  return Object.freeze({ readDisk, verifyFresh, verifyDurableClose });
}

module.exports = { createStateWitness };
