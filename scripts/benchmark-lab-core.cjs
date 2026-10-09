'use strict';

// Benchmark-only infrastructure. No production encoder/profile behavior is
// imported or changed here; the caller supplies validated run identities.
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { createReadStream } = require('node:fs');

function fault(code, message, details) {
  return Object.assign(new Error(message), { code, details });
}

function canonicalJson(value) {
  function visit(item) {
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number' && Number.isFinite(item)) return Object.is(item, -0) ? 0 : item;
    if (Array.isArray(item)) {
      // JSON would silently turn holes into null; an identity must reject
      // those ambiguities rather than normalize an accidental omission.
      for (let index = 0; index < item.length; index++) {
        if (!Object.hasOwn(item, index)) throw fault('IDENTITY_NOT_JSON_SAFE', 'Sparse identity arrays are not supported.');
      }
      return item.map(visit);
    }
    if (item && typeof item === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(item))) {
      const sorted = Object.create(null);
      for (const key of Object.keys(item).sort()) sorted[key] = visit(item[key]);
      return sorted;
    }
    throw fault('IDENTITY_NOT_JSON_SAFE', 'Identities must contain only finite JSON values.');
  }
  return JSON.stringify(visit(value));
}

function stableId(kind, value) {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(kind)) throw fault('INVALID_ID_KIND', 'Invalid identity namespace.');
  return `${kind}-${createHash('sha256').update(canonicalJson({ schema: 1, kind, value })).digest('hex')}`;
}

function sourceId(sha256) {
  if (!/^[a-fA-F0-9]{64}$/.test(sha256)) throw fault('INVALID_SOURCE_HASH', 'Source identity requires a complete SHA-256.');
  return stableId('source', { sha256: sha256.toLowerCase() });
}
const windowId = definition => stableId('window', definition);
const configurationId = definition => stableId('configuration', definition);
const runId = definition => stableId('run', definition);

async function sha256File(file) {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}

async function readJson(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }

async function writeTemporaryJson(file, value) {
  const payload = `${canonicalJson(value)}\n`;
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${randomUUID()}.tmp`);
  const handle = await fs.open(temporary, 'wx');
  try {
    await handle.writeFile(payload, 'utf8');
    await handle.sync();
  } catch (error) {
    await handle.close();
    await fs.unlink(temporary).catch(() => {});
    throw error;
  } finally { await handle.close(); }
  return temporary;
}

async function writeJsonExclusive(file, value) {
  const temporary = await writeTemporaryJson(file, value);
  try {
    // Hard-link publication is atomic and refuses an existing destination.
    // rename() is intentionally unsuitable for immutable evidence: it can
    // replace a previously completed record on Windows and POSIX.
    await fs.link(temporary, file);
  } finally { await fs.unlink(temporary).catch(() => {}); }
}

async function replaceJsonAtomic(file, value) {
  const temporary = await writeTemporaryJson(file, value);
  try { await fs.rename(temporary, file); }
  finally { await fs.unlink(temporary).catch(() => {}); }
}

function safeComponent(value, label) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,180}$/.test(value)) {
    throw fault('INVALID_PATH_COMPONENT', `${label} must be a single safe path component.`);
  }
  return value;
}

async function createAttempt(root, identity, options = {}) {
  const safeRun = safeComponent(identity, 'Run ID');
  const attemptId = safeComponent(options.attemptId || `attempt-${randomUUID()}`, 'Attempt ID');
  const runDirectory = path.resolve(root, safeRun);
  await fs.mkdir(runDirectory, { recursive: true });
  const directory = path.join(runDirectory, attemptId);
  // Existing attempts are never reused, including attempts left by a crash.
  await fs.mkdir(directory);
  await writeJsonExclusive(path.join(directory, 'attempt.json'), {
    schema: 1, runId: identity, attemptId, status: 'incomplete', createdAt: new Date().toISOString(),
  });
  return { directory, attemptId, runId: identity };
}

async function completeAttempt(directory, record) {
  const attempt = await readJson(path.join(directory, 'attempt.json'));
  if (record.runId !== attempt.runId) throw fault('ATTEMPT_IDENTITY_MISMATCH', 'Completion belongs to another run.');
  if (!['complete', 'failed', 'excluded'].includes(record.status)) throw fault('INVALID_COMPLETION', 'Invalid terminal attempt status.');
  if (record.status === 'complete' && record.validity?.valid !== true) {
    throw fault('INVALID_COMPLETION', 'A complete attempt must explicitly pass validation.');
  }
  const file = path.join(directory, 'result.json');
  await writeJsonExclusive(file, { ...record, schema: 1, attemptId: attempt.attemptId });
  return file;
}

function defaultPidAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw fault('LOCK_PID_INVALID', 'Owner PID is invalid.');
  try { process.kill(pid, 0); return true; }
  catch (error) {
    if (error.code === 'ESRCH') return false;
    if (error.code === 'EPERM') return true;
    throw error;
  }
}

async function assertNoLiveRecordedChildren(commands, options = {}) {
  if (!Array.isArray(commands)) throw fault('COMMAND_RECORDS_INVALID', 'Persisted commands must be an array.');
  const isPidAlive = options.isPidAlive || defaultPidAlive;
  const interrupted = [];
  for (const record of commands) {
    if (!record || record.status !== 'running') continue;
    const hasPid = Number.isSafeInteger(record.pid) && record.pid > 0;
    // A terminated controller is not proof that its independent FFmpeg child
    // stopped. Recovery must reconcile every recorded live child before it
    // can admit new encoding or analysis work into the timing environment.
    const live = hasPid ? await isPidAlive(record.pid) : false;
    if (hasPid && live !== true && live !== false) {
      throw fault('RECORDED_CHILD_UNKNOWN', 'A non-authoritative PID observation cannot permit recovery.', { pid: record.pid });
    }
    if (live) {
      throw fault('RECORDED_CHILD_LIVE', `Recorded command PID ${record.pid} is still alive; recovery cannot start new work.`, {
        pid: record.pid, sequence: record.sequence ?? null, label: record.label ?? null,
      });
    }
    const classified = {
      ...record,
      status: 'interrupted',
      interruptionReason: hasPid ? 'recorded-child-authoritatively-dead' : 'recorded-pid-missing',
    };
    // No observed child-close event exists for these records. Reconciliation
    // classifies interruption; it must never manufacture successful exit data.
    delete classified.code;
    delete classified.exitCode;
    delete classified.signal;
    interrupted.push(classified);
  }
  return interrupted;
}

async function acquireOwnershipLock(file, options = {}) {
  const pid = options.pid ?? process.pid;
  if (!Number.isSafeInteger(pid) || pid <= 0) throw fault('LOCK_PID_INVALID', 'Owner PID is invalid.');
  const isPidAlive = options.isPidAlive || defaultPidAlive;
  const record = { schema: 1, pid, token: randomUUID(), createdWallMs: options.nowMs ?? Date.now() };
  async function publish() { await writeJsonExclusive(file, record); }
  try { await publish(); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const old = await readJson(file).catch(() => { throw fault('LOCK_UNCERTAIN', 'Unreadable lock requires explicit investigation.'); });
    if (await isPidAlive(old.pid)) throw fault('LOCK_LIVE', `PID ${old.pid} still owns the benchmark process lock.`, old);

    // A distinct exclusive recovery claim elects exactly one reaper. All
    // reapers recheck the old token and PID before unlinking it. A corrupt or
    // abandoned recovery claim fails closed instead of guessing ownership.
    const recovery = `${file}.recovery`;
    try { await writeJsonExclusive(recovery, record); }
    catch (claimError) {
      if (claimError.code === 'EEXIST') throw fault('LOCK_RECOVERY_BUSY', 'Another recovery claim needs reconciliation.');
      throw claimError;
    }
    try {
      const current = await readJson(file);
      if (current.token !== old.token || await isPidAlive(current.pid)) {
        throw fault('LOCK_CHANGED', 'Ownership changed during stale-lock recovery.');
      }
      await fs.unlink(file);
      await publish();
    } finally { await fs.unlink(recovery).catch(() => {}); }
  }
  let released = false;
  return {
    token: record.token, pid, file,
    async release() {
      if (released) return;
      const current = await readJson(file);
      if (current.token !== record.token) throw fault('LOCK_CHANGED', 'Refusing to release another owner’s lock.');
      await fs.unlink(file);
      released = true;
    },
  };
}

function clockSample() {
  return { wallMs: Date.now(), monotonicMs: Number(process.hrtime.bigint()) / 1e6 };
}
function validSample(sample) {
  if (!sample || !Number.isFinite(sample.wallMs) || !Number.isFinite(sample.monotonicMs)) {
    throw fault('INVALID_CLOCK_SAMPLE', 'Both wall and monotonic timestamps are required.');
  }
  return sample;
}

function createActiveTimeLedger(file, options = {}) {
  const limitMs = options.limitMs ?? 12 * 60 * 60 * 1000;
  const clockToleranceMs = options.clockToleranceMs ?? 5000;
  const heartbeatMaxMs = options.heartbeatMaxMs ?? 15_000;
  const pid = options.pid ?? process.pid;
  const now = options.now || clockSample;
  const isPidAlive = options.isPidAlive || defaultPidAlive;
  const token = randomUUID();
  if (![limitMs, clockToleranceMs, heartbeatMaxMs].every(n => Number.isFinite(n) && n >= 0)) {
    throw fault('INVALID_LEDGER_OPTIONS', 'Ledger limits must be finite nonnegative milliseconds.');
  }

  async function initialize() {
    const state = { schema: 1, limitMs, accumulatedMs: 0, intervals: [], open: null };
    try { await writeJsonExclusive(file, state); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
    const existing = await readJson(file);
    if (existing.schema !== 1 || existing.limitMs !== limitMs || !Number.isFinite(existing.accumulatedMs) || existing.accumulatedMs < 0) {
      throw fault('LEDGER_INVALID', 'Persisted budget is incompatible or corrupt.');
    }
    return existing;
  }
  function view(state) {
    return { ...state, remainingMs: Math.max(0, limitMs - state.accumulatedMs), budgetExceeded: state.accumulatedMs >= limitMs };
  }
  async function update(change) {
    const lock = await acquireOwnershipLock(`${file}.lock`, { pid, isPidAlive });
    try {
      const state = await initialize();
      await change(state, validSample(now()));
      await replaceJsonAtomic(file, state);
      return view(state);
    } finally { await lock.release(); }
  }
  function requireOwned(state) {
    if (!state.open || state.open.token !== token || state.open.pid !== pid) {
      throw fault('LEDGER_NOT_OWNER', 'This process does not own the active accounting interval.');
    }
  }
  function accrue(state, sample) {
    requireOwned(state);
    const previous = state.open.lastSample;
    const elapsed = sample.monotonicMs - previous.monotonicMs;
    const wallElapsed = sample.wallMs - previous.wallMs;
    if (elapsed < 0 || wallElapsed < 0 || Math.abs(elapsed - wallElapsed) > clockToleranceMs) {
      throw fault('CLOCK_INCONSISTENT', 'Clock discontinuity requires recovery before budget accounting continues.', { previous, sample });
    }
    state.accumulatedMs += elapsed;
    state.open.accountedMs += elapsed;
    state.open.lastSample = sample;
    state.open.maxObservedHeartbeatGapMs = Math.max(state.open.maxObservedHeartbeatGapMs, elapsed);
  }
  return {
    async snapshot() { return view(await initialize()); },
    async begin(label = 'campaign-work') {
      return update((state, sample) => {
        if (state.open) throw fault('LEDGER_OPEN_INTERVAL', 'Reconcile the existing interval before starting another.', state.open);
        if (state.accumulatedMs >= limitMs) throw fault('ACTIVE_BUDGET_EXCEEDED', 'The cumulative active-time allowance is exhausted.');
        state.open = { token, pid, label, startedSample: sample, lastSample: sample, accountedMs: 0, maxObservedHeartbeatGapMs: 0, heartbeatMaxMs };
      });
    },
    async heartbeat() { return update(accrue); },
    async end(reason = 'completed-active-work') {
      return update((state, sample) => {
        accrue(state, sample);
        state.intervals.push({ ...state.open, endedWallMs: sample.wallMs, reason, recovery: null });
        state.open = null;
      });
    },
    async recoverDeadOwner(recovery = {}) {
      return update(async (state, sample) => {
        if (!state.open) return;
        if (await isPidAlive(state.open.pid)) throw fault('LEDGER_OWNER_LIVE', 'A live interval owner cannot be recovered.');
        const last = state.open.lastSample.wallMs;
        const terminal = recovery.lastActiveWallMs ?? sample.wallMs;
        if (!Number.isFinite(terminal) || terminal < last || terminal > sample.wallMs) {
          throw fault('RECOVERY_TIME_INVALID', 'Terminal evidence must be between the last heartbeat and now.');
        }
        if (recovery.lastActiveWallMs !== undefined && (typeof recovery.evidence !== 'string' || !recovery.evidence.trim())) {
          throw fault('RECOVERY_EVIDENCE_REQUIRED', 'A shortened recovery interval requires recorded terminal evidence.');
        }
        const tailMs = terminal - last;
        // A dead PID proves it stopped, not WHEN. Without terminal evidence,
        // conservatively charge the whole wall gap. Heartbeat cadence alone
        // cannot justify silently dropping hours after an interrupted observer.
        state.accumulatedMs += tailMs;
        state.open.accountedMs += tailMs;
        state.intervals.push({ ...state.open, endedWallMs: terminal, reason: 'recovered-dead-owner', recovery: {
          policy: recovery.lastActiveWallMs === undefined ? 'conservative-wall-gap' : 'evidenced-terminal-time',
          evidence: recovery.evidence || null, tailMs, observedWallGapMs: sample.wallMs - last,
          withinHeartbeatBound: tailMs <= state.open.heartbeatMaxMs,
        } });
        state.open = null;
      });
    },
  };
}

async function directoryBytes(directory) {
  let bytes = 0;
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    const stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) throw fault('RESOURCE_SYMLINK', 'Campaign growth counting does not follow links.', { file });
    if (stat.isDirectory()) bytes += await directoryBytes(file);
    else if (stat.isFile()) bytes += stat.size;
    else throw fault('RESOURCE_SPECIAL_FILE', 'Unexpected special file in campaign workspace.', { file });
  }
  return bytes;
}

async function assertResourceEnvelope(options) {
  const { campaignRoot, workspacePath, maxGrowthBytes, minFreeBytes, additionalBytes = 0 } = options;
  if (![maxGrowthBytes, minFreeBytes, additionalBytes].every(n => Number.isSafeInteger(n) && n >= 0)) {
    throw fault('RESOURCE_OPTIONS_INVALID', 'Resource limits must be nonnegative safe integer byte counts.');
  }
  const growthBytes = await directoryBytes(campaignRoot);
  const volume = await fs.statfs(workspacePath, { bigint: true });
  const available = volume.bavail * volume.bsize;
  if (BigInt(growthBytes) + BigInt(additionalBytes) > BigInt(maxGrowthBytes)) {
    throw fault('CAMPAIGN_GROWTH_EXCEEDED', 'Planned work exceeds the campaign growth ceiling.', { growthBytes, additionalBytes, maxGrowthBytes });
  }
  if (available - BigInt(additionalBytes) < BigInt(minFreeBytes)) {
    throw fault('FREE_SPACE_FLOOR', 'Planned work would cross the workspace free-space floor.', { freeBytes: String(available), additionalBytes, minFreeBytes });
  }
  return { growthBytes, freeBytes: String(available), additionalBytes, remainingGrowthBytes: maxGrowthBytes - growthBytes };
}

async function inspectResume(record, expected) {
  const reasons = [];
  if (!record || record.status !== 'complete' || record.validity?.valid !== true) reasons.push('attempt-not-valid-and-complete');
  for (const key of ['sourceHash', 'configurationHash', 'runtimeHash']) {
    if (!expected?.[key] || record?.[key] !== expected[key]) reasons.push(`${key}-mismatch`);
  }
  for (const key of Object.keys(expected || {})) {
    if (!['sourceHash', 'configurationHash', 'runtimeHash'].includes(key) && canonicalJson(record?.[key] ?? null) !== canonicalJson(expected[key])) {
      reasons.push(`${key}-mismatch`);
    }
  }
  const output = record?.output;
  if (!output || typeof output.path !== 'string' || !/^[a-f0-9]{64}$/.test(output.sha256 || '') || !Number.isSafeInteger(output.bytes) || output.bytes <= 0) {
    reasons.push('output-identity-missing');
  } else {
    try {
      const stat = await fs.lstat(output.path);
      if (!stat.isFile() || stat.isSymbolicLink()) reasons.push('output-not-regular-file');
      else if (stat.size !== output.bytes) reasons.push('output-size-mismatch');
      else if (await sha256File(output.path) !== output.sha256) reasons.push('output-hash-mismatch');
    } catch (error) { reasons.push(`output-unavailable:${error.code || 'ERROR'}`); }
  }
  return { accepted: reasons.length === 0, reasons };
}

module.exports = {
  canonicalJson, stableId, sourceId, windowId, configurationId, runId, sha256File,
  readJson, writeJsonExclusive, createAttempt, completeAttempt,
  defaultPidAlive, assertNoLiveRecordedChildren, acquireOwnershipLock, createActiveTimeLedger,
  directoryBytes, assertResourceEnvelope, inspectResume,
};
