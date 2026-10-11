'use strict';

const { randomUUID } = require('node:crypto');
const { createBatchDefaults, resolveFileRequest } = require('./operation-contract.cjs');
const { ToolError } = require('./process-runner.cjs');

const MAX_FILES = 10000;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = (code, message) => { throw new ToolError(code, message); };
function exact(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
      || Reflect.ownKeys(value).length !== keys.length
      || keys.some(key => !Object.hasOwn(value, key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value'))) {
    fail('INVALID_DRAFT_REQUEST', 'Unexpected workspace request fields.');
  }
}
function frozen(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(frozen); Object.freeze(value);
  }
  return value;
}

// A draft owns ordinary choices only. Source fingerprints, omission decisions,
// re-encode grants and prepared argv belong to the service and are never loaded
// from these snapshots. Main supplies source IDs/revisions after admission.
class OperationDraft {
  #files = new Map();
  #overrides = new Map();
  #app;
  #defaults;
  #revision = 0;
  #locked = false;
  constructor({ operation, appDefaults, appDefaultsRevision }) {
    if (!['encode', 'remux'].includes(operation)) fail('INVALID_DRAFT_REQUEST', 'Unknown workspace operation.');
    Object.defineProperties(this, { id: { value: randomUUID(), enumerable: true }, operation: { value: operation, enumerable: true } });
    this.#defaults = createBatchDefaults({ appDefaults, appDefaultsRevision });
    this.#app = frozen({ defaults: structuredClone(appDefaults), revision: appDefaultsRevision });
  }
  #editable(request) {
    if (this.#locked) fail('FROZEN_DRAFT', 'Queued or running jobs retain their settings. Create a new batch to make changes.');
    if (request.draftId !== this.id || request.revision !== this.#revision) fail('STALE_DRAFT', 'The workspace changed. Review its current values before editing.');
  }
  #request(fileId, overrides = this.#overrides.get(fileId) || {}, defaults = this.#defaults, revision = this.#revision) {
    const identityRevision = this.#files.get(fileId);
    if (identityRevision === undefined) fail('UNKNOWN_DRAFT_FILE', 'That file does not belong to this workspace.');
    return resolveFileRequest({ fileId, identityRevision, draftRevision: revision,
      operation: this.operation, batchDefaults: defaults, overrides });
  }
  #selected(fileIds) {
    if (!Array.isArray(fileIds) || !fileIds.length || fileIds.length > this.#files.size
        || new Set(fileIds).size !== fileIds.length || fileIds.some(id => !this.#files.has(id))) {
      fail('INVALID_DRAFT_SELECTION', 'Choose distinct files from this workspace.');
    }
    return [...fileIds];
  }
  addSources(sources) {
    if (this.#locked || this.#files.size) fail('FROZEN_DRAFT', 'Create a new workspace to replace its admitted sources.');
    if (!Array.isArray(sources) || !sources.length || sources.length > MAX_FILES) fail('INVALID_DRAFT_SOURCES', 'Source admission must be a bounded nonempty list.');
    const next = new Map();
    for (const source of sources) {
      exact(source, ['fileId', 'identityRevision']);
      if (!UUID.test(source.fileId) || !Number.isSafeInteger(source.identityRevision) || source.identityRevision < 0 || next.has(source.fileId)) {
        fail('INVALID_DRAFT_SOURCES', 'Source IDs and identity revisions must be distinct main-issued values.');
      }
      next.set(source.fileId, source.identityRevision);
    }
    this.#files = next;
    return this.snapshot();
  }
  snapshot() {
    return frozen({ id: this.id, revision: this.#revision, operation: this.operation, frozen: this.#locked,
      batchDefaults: structuredClone(this.#defaults),
      files: [...this.#files.keys()].map(fileId => ({ fileId, request: this.#request(fileId),
        overrides: structuredClone(this.#overrides.get(fileId) || {}) })) });
  }
  fileRequest(fileId) { return this.#request(fileId); }
  patchFiles(request) {
    exact(request, ['draftId', 'revision', 'fileIds', 'overrides']); this.#editable(request);
    const selected = this.#selected(request.fileIds);
    // Visible field edits apply to each file's own override snapshot. A batch
    // range action must not erase another file's explicit resolution/audio.
    // setFiles below remains the intentional complete-snapshot/reset operation.
    if (!request.overrides || typeof request.overrides !== 'object' || Array.isArray(request.overrides)) fail('INVALID_DRAFT_REQUEST', 'Overrides must be plain data.');
    exact(request.overrides, Object.keys(request.overrides));
    const next = new Map();
    for (const fileId of selected) {
      const overrides = { ...(this.#overrides.get(fileId) || {}), ...request.overrides };
      this.#request(fileId, overrides, this.#defaults, this.#revision + 1);
      next.set(fileId, frozen(structuredClone(overrides)));
    }
    for (const [fileId, overrides] of next) this.#overrides.set(fileId, overrides);
    this.#revision++;
    return frozen({ snapshot: this.snapshot(), changedFileIds: selected, invalidatePrepared: true, invalidateTemporaryAuthority: true });
  }
  setFiles(request) {
    exact(request, ['draftId', 'revision', 'fileIds', 'overrides']); this.#editable(request);
    const selected = this.#selected(request.fileIds);
    // Full validation precedes mutation: invalid one-file range syntax or
    // foreign IDs cannot partly apply an intended multi-file action. Media-
    // specific duration compatibility is a later preparation requirement.
    for (const fileId of selected) this.#request(fileId, request.overrides, this.#defaults, this.#revision + 1);
    const overrides = frozen(structuredClone(request.overrides));
    for (const fileId of selected) this.#overrides.set(fileId, overrides);
    this.#revision++;
    return frozen({ snapshot: this.snapshot(), changedFileIds: selected, invalidatePrepared: true, invalidateTemporaryAuthority: true });
  }
  setBatchOverrides(request) {
    exact(request, ['draftId', 'revision', 'overrides']); this.#editable(request);
    const next = createBatchDefaults({ appDefaults: this.#app.defaults, appDefaultsRevision: this.#app.revision, batchOverrides: request.overrides });
    const changed = this.#changedFiles(next);
    this.#defaults = next; this.#revision++;
    return frozen({ snapshot: this.snapshot(), changedFileIds: changed, invalidatePrepared: true, invalidateTemporaryAuthority: true });
  }
  #changedFiles(defaults) {
    return [...this.#files.keys()].filter(fileId => {
      // Compare effective values/origins at a common revision. Even an origin
      // change remains visible; it is never an excuse to mutate a queued plan.
      const before = this.#request(fileId), after = this.#request(fileId, this.#overrides.get(fileId) || {}, defaults);
      return JSON.stringify({ ...before, appDefaultsRevision: 0 }) !== JSON.stringify({ ...after, appDefaultsRevision: 0 });
    });
  }
  applyAppDefaults(request, appSnapshot) {
    exact(request, ['draftId', 'revision', 'resetFileOverrides']); this.#editable(request);
    if (typeof request.resetFileOverrides !== 'boolean') fail('INVALID_DRAFT_REQUEST', 'Reset-file choice must be explicit.');
    // The second argument comes from main's validated settings store, never
    // from IPC. Applying app defaults explicitly clears batch-level choices.
    exact(appSnapshot, ['defaults', 'revision']);
    const next = createBatchDefaults({ appDefaults: appSnapshot.defaults, appDefaultsRevision: appSnapshot.revision });
    const changed = request.resetFileOverrides ? [...this.#files.keys()] : this.#changedFiles(next);
    this.#app = frozen(structuredClone(appSnapshot)); this.#defaults = next;
    if (request.resetFileOverrides) this.#overrides.clear();
    this.#revision++;
    return frozen({ snapshot: this.snapshot(), changedFileIds: changed, invalidatePrepared: true, invalidateTemporaryAuthority: true });
  }
  freezeForQueue(request) {
    exact(request, ['draftId', 'revision', 'fileIds']); this.#editable(request);
    const selected = this.#selected(request.fileIds);
    const result = frozen({ draftId: this.id, draftRevision: this.#revision,
      batchDefaults: structuredClone(this.#defaults), requests: selected.map(fileId => this.#request(fileId)) });
    this.#locked = true;
    return result;
  }
}

module.exports = { OperationDraft, MAX_FILES };
