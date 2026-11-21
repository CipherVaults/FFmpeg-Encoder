'use strict';

// Narrow CP138 R03 evidence contract. No launcher, shell, workflow, network,
// executable, credentials, media, mutable product path, or public pass state.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const PRODUCT = Object.freeze({
  original: '08b3f55488c71d35c1b1a52a2435e3a1638912f8',
  mirror: '33196f7434d781e683bb35ed4445fd1db3cc118a',
  tree: '98067ae82443fa03bd21fe20e9f86593d01ad092',
  packageInputs: '5da439d49926db38516c421f5b40f749c6cb5259ee845ee09bf13ca6f807aec6',
  version: '0.7.0-alpha.1',
  electron: '44.7.0',
});
const FACTORY = Object.freeze({ fullAudioPolicy: 'copy', rangeAudioPolicy: 'precision-aac',
  resolution: 'source', hdrPolicy: 'preserve', remuxTarget: 'matroska', previewExpanded: false });
const CHANGE = Object.freeze(['1080', '720']);
const STEP_MS = 15_000;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const isDigest = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const expected = revision => ({ ...FACTORY, resolution: revision ? CHANGE[revision - 1] : FACTORY.resolution });
const settled = Object.freeze({ normalWindowClose: true, launcherClosedZero: true, mainObservedGone: true,
  observedDescendantsGone: true, durableSessionEndCompleted: true });

function requireIdle(snapshot) {
  assert.deepEqual(snapshot, { phase: 'idle', batch: false, plan: false, draft: false,
    rows: 0, startDisabled: true, inputFolder: false, outputFolder: false }, 'No media job, prepared authority or remembered folders');
}

function readSettingsDisk(observation, revision) {
  // The enclosing owned-profile reader must enforce ordinary, one-link
  // entries, custody and before/after identity; this is its format boundary.
  assert.deepEqual(observation.neighbors, { appearancePresent: false, preferencesPresent: false, provenanceEntries: 0 });
  const bytes = observation.record;
  if (!revision) { assert.equal(bytes, null, 'Fresh profile has no settings record'); return null; }
  assert(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 16 * 1024, 'Small ordinary App Settings record');
  const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  assert.deepEqual(value, { namespace: 'appsettings-v1', schema: 1, revision, defaults: expected(revision) }, 'Exact durable settings record');
  return Buffer.from(bytes);
}

function verifyUi(mark, revision, savedJustNow = false) {
  const defaults = expected(revision);
  assert.equal(mark.active, true, 'Settings is the selected visible workspace');
  assert.equal(mark.fieldsDisabled, false, 'Settings fieldset unlocked');
  assert.equal(mark.saveDisabled, true, 'No unsaved baseline remains');
  assert.equal(mark.errorHidden, true);
  assert.equal(mark.bootErrorHidden, true);
  assert.deepEqual(mark.defaults, defaults, 'All displayed defaults, not just the changed field');
  assert.equal(mark.status, [
    savedJustNow ? 'Defaults saved for new batches.' : '',
    `Revision ${revision}.`,
    revision ? 'Confirmed saved locally.' : 'Current defaults are not yet confirmed saved.',
  ].filter(Boolean).join(' '), 'Actual persisted status, not a pre-save form value');
  assert.deepEqual(mark.bridge, { schema: 1, revision, defaults,
    persistence: { state: 'ready', persisted: revision !== 0, resetRequired: false } }, 'Read-only cross-check of actual main snapshot');
  requireIdle(mark.queue);
}

async function observe(page, revision, savedJustNow = false) {
  await page.waitForFunction(({ revision }) => {
    const status = document.querySelector('#app-settings-status'), fields = document.querySelector('#app-settings-fields');
    return status?.textContent.includes(`Revision ${revision}.`) && fields?.disabled === false;
  }, { revision }, { timeout: STEP_MS });
  const mark = await page.evaluate(async () => {
    const node = id => document.getElementById(id);
    const source = await window.encoder.getAppSettings();
    const snapshot = await window.encoder.getSnapshot(), prefs = await window.encoder.getPreferences();
    return {
      active: !node('workspace-settings').hidden && node('tab-settings').getAttribute('aria-selected') === 'true',
      fieldsDisabled: node('app-settings-fields').disabled, saveDisabled: node('app-settings-save').disabled,
      errorHidden: node('app-settings-error').hidden, bootErrorHidden: node('error-banner').hidden,
      status: node('app-settings-status').textContent,
      defaults: { fullAudioPolicy: node('default-full-audio').value, rangeAudioPolicy: node('default-range-audio').value,
        resolution: node('default-resolution').value, hdrPolicy: node('default-hdr').value,
        remuxTarget: node('default-remux-target').value, previewExpanded: node('default-preview-expanded').checked },
      bridge: { schema: source.schema, revision: source.revision, defaults: source.defaults, persistence: source.persistence },
      queue: { phase: snapshot.phase, batch: snapshot.batchId != null, plan: snapshot.planId != null,
        draft: snapshot.operationDraft != null, rows: snapshot.items.length, startDisabled: node('start-batch').disabled,
        inputFolder: prefs.inputFolder != null, outputFolder: prefs.outputFolder != null },
    };
  });
  verifyUi(mark, revision, savedJustNow);
}

function verifyLaunch(value, policy, earlier) {
  assert(isDigest(value.identity) && value.identity !== earlier, 'Distinct stable process identity');
  assert.equal(value.exe, policy.exe);
  assert.equal(value.asar, policy.asar);
  assert.equal(value.profile, policy.profile);
  assert.deepEqual(value.security, { packaged: true, sandbox: true, contextIsolation: true,
    nodeIntegration: false, platform: 'win32', arch: 'x64', version: PRODUCT.version, electron: PRODUCT.electron });
}

function settingsJourney(adapter) {
  let consumed = false;
  return async function verify() {
    assert(!consumed, 'One attempt only'); consumed = true;
    // The adapter belongs to the separately reviewed job. It must also bound
    // evaluate/launch/close across timeouts, drain in-flight work and handle
    // partial/no-handle launch failures; this contract doesn't emulate those.
    const policy = await adapter.attest();
    assert.deepEqual(policy.product, PRODUCT, 'Exact CP138 mapped original and mirror, not adjacent source');
    for (const field of ['exe', 'asar', 'profile']) assert(isDigest(policy[field]));
    readSettingsDisk(await adapter.readDisk(), 0);
    let first, finalBytes;
    for (const label of ['first', 'restart']) {
      const app = await adapter.openReady(label);
      let primary;
      try {
        verifyLaunch(app, policy, label === 'restart' ? first : null);
        const page = app.page;
        await page.click('#tab-settings', { timeout: STEP_MS });
        if (label === 'first') {
          first = app.identity;
          await observe(page, 0);
          readSettingsDisk(await adapter.readDisk(), 0);
          for (const [index, resolution] of CHANGE.entries()) {
            assert.deepEqual(await page.selectOption('#default-resolution', resolution, { timeout: STEP_MS }), [resolution]);
            await page.click('#app-settings-save', { timeout: STEP_MS });
            await observe(page, index + 1, true);
            finalBytes = readSettingsDisk(await adapter.readDisk(), index + 1);
          }
        } else {
          await observe(page, 2);
          assert(readSettingsDisk(await adapter.readDisk(), 2).equals(finalBytes), 'Exact second save bytes after distinct restart');
        }
      } catch (cause) {
        primary = cause;
        throw cause;
      } finally {
        try { assert.deepEqual(await adapter.closeWindowAndJoin(app), settled, 'Normal close and owned process observations'); }
        catch (cleanup) {
          if (primary) throw new AggregateError([primary, cleanup], 'Both scenario and normal closure failed');
          throw cleanup;
        }
      }
      assert(readSettingsDisk(await adapter.readDisk(), 2).equals(finalBytes), 'Saved bytes unchanged across normal close');
    }
    // Safe bounded evidence summary; independent package/runner binding,
    // qualified execution and the terminal provider result remain external.
    return Object.freeze({ scope: 'cp138-r03-clean-settings-restart-observations', settingsSha256: hash(finalBytes),
      settingsBytes: finalBytes.length, savedRevisions: Object.freeze([1, 2]), isolatedLaunches: 2, cleanWindowCloses: 2,
      startup: 'unmodified-ordinary-capability-self-tests', r02: 'not-run', userJob: 'not-requested' });
  };
}

module.exports = { settingsJourney, PRODUCT };
