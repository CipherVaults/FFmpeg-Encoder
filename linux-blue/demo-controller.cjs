'use strict';
// Main-owned composition. No paths, child objects or raw errors leave snapshot().
const { acceptCpuSettings, cpuChoices } = require('./ui-policy.cjs');
const error = code => Object.assign(new Error(code), { code });
const terminalError = code => ['CANCELLED', 'SYNTHETIC_OUTPUT_EXISTS', 'PUBLICATION_UNCERTAIN'].includes(code) ? code : 'JOB_FAILED';

async function createDemoController({ createService, source, parent, onChild, selectSource, inspectSource }) {
  let closing = false, pending = null;
  let inspection = null;
  let sourceState = { phase: 'empty', report: null, errorCode: null };
  let state = { phase: 'idle', jobId: 0, profileId: null, frame: 0, errorCode: null, publication: 'none' };
  const snapshot = () => ({ ...state, inspection: { ...sourceState, busy: Boolean(inspection) } });
  const service = await createService({ source, parent, onChild, onProgress(value) {
    if (!['running', 'validating'].includes(state.phase)) return;
    if (Number.isFinite(value.frame)) state.frame = Math.min(12, Math.max(0, Math.floor(value.frame)));
    if (value.ended) state.phase = 'validating';
  } });
  function start(request) {
    if (closing) throw error('DEMO_CLOSED');
    if (pending || inspection) throw error('DEMO_BUSY');
    const settings = acceptCpuSettings(request);
    state = { phase: 'running', jobId: state.jobId + 1, profileId: settings.profileId, frame: 0, errorCode: null, publication: 'none' };
    // Start synchronously so an immediately following cancel sees the same job.
    let task;
    try { task = service.start(settings); } catch (failure) { task = Promise.reject(failure); }
    pending = Promise.resolve(task).then(result => {
      state.phase = result.published ? 'completed' : 'collision';
      state.publication = result.published ? 'published' : 'collision';
    }, failure => {
      state.errorCode = terminalError(failure?.code);
      if (failure?.receipt?.published === true) { state.phase = 'published-warning'; state.publication = 'published'; }
      else if (failure?.receipt?.published === null || failure?.code === 'PUBLICATION_UNCERTAIN') { state.phase = 'uncertain'; state.publication = 'uncertain'; }
      else state.phase = state.errorCode === 'CANCELLED' ? 'cancelled' : 'failed';
    }).finally(() => { pending = null; });
    return snapshot();
  }
  async function cancel() {
    if (closing) throw error('DEMO_CLOSED');
    if (inspection) {
      const active = inspection; active.abort.abort();
      // Native pickers have their own Cancel button. Do not wait for dismissal.
      // Keep admission locked until a late selection has been ignored.
      if (!active.selecting) await active.task;
      return snapshot();
    }
    const job = pending;
    if (job) { state.phase = 'cancelling'; await service.cancel(); await job; }
    return snapshot();
  }
  function inspect() {
    if (closing) throw error('DEMO_CLOSED');
    if (pending || inspection) throw error('DEMO_BUSY');
    if (typeof selectSource !== 'function' || typeof inspectSource !== 'function') throw error('DEMO_FAILED');
    const active = { abort: new AbortController(), selecting: true, task: null };
    inspection = active; sourceState = { phase: 'choosing', report: null, errorCode: null };
    active.task = (async () => {
      try {
        const selected = await selectSource(); active.selecting = false;
        if (closing) return;
        if (!selected || active.abort.signal.aborted) { sourceState.phase = 'cancelled'; return; }
        sourceState.phase = 'inspecting';
        const report = await inspectSource(selected, { signal: active.abort.signal, onChild });
        if (!closing) sourceState = active.abort.signal.aborted ? { phase: 'cancelled', report: null, errorCode: null }
          : { phase: 'ready', report, errorCode: null };
      } catch (failure) {
        if (!closing) sourceState = { phase: active.abort.signal.aborted ? 'cancelled' : 'failed', report: null,
          errorCode: active.abort.signal.aborted ? null : ['SOURCE_PATH', 'SOURCE_CHANGED', 'SOURCE_REPORT', 'TIMEOUT'].includes(failure?.code) ? failure.code : 'INSPECTION_FAILED' };
      } finally { if (inspection === active) inspection = null; }
    })();
    return snapshot();
  }
  let closure;
  function close() {
    if (!closure) {
      closing = true;
      state.phase = 'closing';
      inspection?.abort.abort();
      closure = (async () => {
        await service.close(); await pending;
        // A picker has no owned child. Window destruction dismisses it; late
        // results are ignored. A launched probe must drain before destruction.
        if (inspection && !inspection.selecting) await inspection.task;
        state.phase = 'closed';
      })();
    }
    return closure;
  }
  return Object.freeze({ start, cancel, close, snapshot, inspect, choices: cpuChoices });
}
module.exports = { createDemoController };
