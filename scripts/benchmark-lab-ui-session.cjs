'use strict';

// Account local rendered QA in the same active-time ledger. This controller
// holds the campaign lock but launches no encoder and changes no judgments.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const core = require('./benchmark-lab-core.cjs');
const lab = require('./benchmark-lab-config.cjs');
const root = path.resolve(__dirname, '..');
const campaign = path.join(root, 'artifacts', 'phase1-2026-10-10');

async function main() {
  const lock = await core.acquireOwnershipLock(path.join(campaign, 'ownership.lock'));
  const ledger = core.createActiveTimeLedger(path.join(campaign, 'active-time.json'), { limitMs: lab.LIMITS.activeMs });
  let started = false;
  try {
    const state = JSON.parse(fs.readFileSync(path.join(campaign, 'state.json')));
    assert.equal(state.reviewBundle?.status, 'complete');
    assert.equal(state.humanReview.status, 'awaiting-calibration-judgment');
    await core.assertNoLiveRecordedChildren(state.commands);
    if ((await ledger.snapshot()).open) await ledger.recoverDeadOwner();
    await ledger.begin('review-ui-qa'); started = true;
    const directory = path.join(campaign, `ui-qa-${crypto.randomUUID()}`); fs.mkdirSync(directory);
    const finish = path.join(directory, 'finish.json');
    await core.writeJsonExclusive(path.join(directory, 'session.json'), { pid: process.pid,
      startedUtc: new Date().toISOString(), bundlePath: state.reviewBundle.directory, finish,
      purpose: 'Rendered review-pack QA only; no human judgment or finalist freeze.' });
    console.log(JSON.stringify({ directory, finish, bundlePath: state.reviewBundle.directory }));
    const startedMs = Date.now();
    while (!fs.existsSync(finish)) {
      assert.ok(Date.now() - startedMs < 600000, 'UI QA exceeded ten minutes; preserve results and close accounting.');
      await ledger.heartbeat();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    const result = JSON.parse(fs.readFileSync(finish));
    assert.ok(['passed', 'limited', 'failed'].includes(result.status));
    assert.ok(Array.isArray(result.checks));
    await core.writeJsonExclusive(path.join(directory, 'result.json'), { ...result, endedUtc: new Date().toISOString(),
      activeSnapshot: await ledger.snapshot(), qualification: 'Codex UI verification, not Ahmed subjective acceptance.' });
    console.log(JSON.stringify({ status: result.status, result: path.join(directory, 'result.json') }));
  } finally {
    try { if (started) await ledger.end('ui-qa-ended'); }
    finally { await lock.release(); }
  }
}

main().catch(error => { console.error(error.stack); process.exitCode = 1; });
