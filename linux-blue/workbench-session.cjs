'use strict';
const fail = (code, message) => Object.assign(new Error(message), { code });
// Exactly two main-owned session types. No paths, options, fallback or persistence.
class WorkbenchSession {
  constructor({ ordinary, fullCopy, createAccess, publish }) {
    this.factories = { ordinary, 'full-copy': fullCopy }; this.createAccess = createAccess;
    this.publish = publish; this.owner = null; this.transitioning = false; this.closed = false; this.poisoned = false; this.epoch = 0;
  }
  status() { return { enabled: true, selected: this.owner?.kind || null, transitioning: this.transitioning,
    notice: 'Switching resets the workbench window and discards this batch and completed-output access. Candidate inputs must already be restored; no fallback.' }; }
  async retire(owner) {
    if (!owner) return;
    owner.service.closeAdmission(); owner.access.clear(); owner.service.removeListener('update', owner.listener);
    const errors = [];
    for (const action of [() => owner.service.cancelCurrent(), () => owner.service.closeOperationResources(),
      async () => { const receipt = await owner.service.closeDiagnostics('completed'); if (receipt?.persisted !== true) throw new Error('Session diagnostics were not persisted.'); }]) {
      try { await action(); } catch (error) { errors.push(error); }
    }
    owner.access.clear();
    owner.service.plan = null;
    if (errors.length) throw new AggregateError(errors, 'Previous session cleanup failed.');
  }
  async select(kind) {
    if (!['ordinary', 'full-copy'].includes(kind)) throw fail('INVALID_REQUEST', 'Choose ordinary or full-copy.');
    if (this.poisoned) throw fail('SESSION_CLEANUP_FAILED', 'Cleanup failed; close and relaunch the workbench.');
    if (this.closed) throw fail('SHUTTING_DOWN', 'Workbench session is closed.');
    if (this.transitioning) throw fail('BUSY', 'A session transition is active.');
    this.owner?.service.requireIdle();
    if (this.owner?.kind === kind) return this.owner.service;
    this.transitioning = true;
    const previous = this.owner; this.owner = null; const epoch = ++this.epoch;
    try {
      try { await this.retire(previous); } catch (error) { this.poisoned = true; throw error; }
      if (this.closed) throw fail('SHUTTING_DOWN', 'Workbench closed during transition.');
      const access = this.createAccess(); let service;
      try {
        service = await this.factories[kind](access);
        await service.initializeDiagnostics();
        const owner = { kind, service, access, listener: null };
        owner.listener = snapshot => { if (!this.closed && this.owner === owner && this.epoch === epoch) this.publish(snapshot); };
        if (this.closed) { throw fail('SHUTTING_DOWN', 'Workbench closed during acquisition.'); }
        this.owner = owner; service.on('update', owner.listener); return service;
      } catch (error) {
        access.clear();
        if (service) { try { await this.retire({service, access, listener: () => {}}); } catch (cleanup) { this.poisoned = true; throw new AggregateError([error, cleanup], 'Acquisition and cleanup failed.'); } }
        throw error;
      }
    } finally { this.transitioning = false; }
  }
  beginClose() { this.closed = true; ++this.epoch; this.owner?.service.closeAdmission(); this.owner?.access.clear(); }
}
module.exports = { WorkbenchSession };
