'use strict';
// Main-owned composition. No paths, child objects or raw errors leave snapshot().
const { acceptCpuSettings, cpuChoices } = require('./ui-policy.cjs');
const error = code => Object.assign(new Error(code), { code });
const terminalError = code => ['CANCELLED', 'SYNTHETIC_OUTPUT_EXISTS', 'PUBLICATION_UNCERTAIN'].includes(code) ? code : 'JOB_FAILED';

async function createDemoController({ createService, source, parent, onChild }) {
  let closing = false, pending = null;
  let state = { phase: 'idle', jobId: 0, profileId: null, frame: 0, errorCode: null, publication: 'none' };
  const snapshot = () => ({ ...state });
  const service = await createService({ source, parent, onChild, onProgress(value) {
    if (!['running', 'validating'].includes(state.phase)) return;
    if (Number.isFinite(value.frame)) state.frame = Math.min(12, Math.max(0, Math.floor(value.frame)));
    if (value.ended) state.phase = 'validating';
  } });
  function start(request) {
    if (closing) throw error('DEMO_CLOSED');
    if (pending) throw error('DEMO_BUSY');
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
    const job = pending;
    if (job) { state.phase = 'cancelling'; await service.cancel(); await job; }
    return snapshot();
  }
  let closure;
  function close() {
    if (!closure) {
      closing = true;
      state.phase = 'closing';
      closure = (async () => { await service.close(); await pending; state.phase = 'closed'; })();
    }
    return closure;
  }
  return Object.freeze({ start, cancel, close, snapshot, choices: cpuChoices });
}
module.exports = { createDemoController };
