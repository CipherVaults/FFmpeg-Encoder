'use strict';

// Stock-product UI and on-disk observation only. The separately reviewed
// hosted boundary owns the Windows spawn-from-before-PID capability, timeout,
// failed-launch quarantine, no-clobber profile and package pin custody.
// There is intentionally no local launcher, shell, GitHub event or CLI here.
const assert = require('node:assert/strict');
const path = require('node:path').win32;
const { createStateWitness } = require('./state-witness.cjs');
const { PRODUCT, settingsJourney } = require('./settings-restart.cjs');

const DIGEST = /^[a-f0-9]{64}$/;
const WIN_PATH = /^[A-Za-z]:\\[^\x00-\x1f\x7f:*?"<>|]*$/;
const clean = p => typeof p === 'string' && p.length <= 500 && WIN_PATH.test(p) && path.normalize(p) === p
  && !p.split('\\').slice(1).some(s => !s || s === '.' || s === '..' || /[ .]$/.test(s));
const same = (a, b) => clean(a) && clean(b) && a.toLowerCase() === b.toLowerCase();
const below = (a, b) => clean(a) && clean(b) && a.toLowerCase().startsWith(b.toLowerCase() + '\\');
const assertLaunch = (ready, expected) => {
  assert(Number.isSafeInteger(ready.pid) && ready.pid > 0);
  assert([ready.executable, ready.appExe].every(value => same(value, expected.exePath)));
  assert(same(ready.asar, expected.asarPath));
  assert(same(ready.userData, expected.stateDir) && same(ready.sessionData, expected.stateDir));
  assert.deepEqual(ready.security, { packaged: true, sandbox: true, contextIsolation: true, nodeIntegration: false,
    platform: 'win32', arch: 'x64', version: PRODUCT.version, electron: PRODUCT.electron });
};
function settingsLayout(lease) {
  assert.deepEqual(lease.product, PRODUCT);
  assert(lease.provider === 'github-hosted' && lease.image === 'windows-2022');
  for (const field of ['exe', 'asar', 'profile']) assert(DIGEST.test(lease[field]));
  // Stock build-portable's real package role: do not copy, repackage or
  // relocate it to satisfy the hosted test. State/cwd remain sibling roles.
  assert(clean(lease.jobRoot) && same(lease.packageDir, path.join(lease.jobRoot, 'package', 'FFmpeg Encoder-win32-x64')));
  const stateDir = path.join(lease.jobRoot, 'settings-profile'), cwd = path.join(lease.jobRoot, 'settings-cwd');
  assert(below(stateDir, lease.jobRoot) && below(cwd, lease.jobRoot));
  return Object.freeze({ stateDir, cwd, exePath: path.join(lease.packageDir, 'FFmpeg Encoder.exe'),
    asarPath: path.join(lease.packageDir, 'resources', 'app.asar') });
}
function ordinaryCloseRequest({ BrowserWindow }) {
  const [first, ...others] = BrowserWindow.getAllWindows();
  if (!first || others.length !== 0 || first.isDestroyed()) return false;
  // Acknowledge scheduling before Electron tears down the Playwright endpoint.
  // The request is not the result: the independent join + journal prove closure.
  setImmediate(() => { if (!first.isDestroyed()) first.close(); });
  return true;
}
async function createWindowsSettingsAdapter(hosted) {
  assert(process.platform === 'win32' && process.arch === 'x64', 'No Windows adapter in an offline/non-Windows process');
  for (const [name, value] of Object.entries(process.env)) {
    assert(!value || !['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_FORCE_IS_PACKAGED'].includes(name.toUpperCase()),
      'Do not override packaging or runtime security');
  }
  assert(hosted && typeof hosted === 'object');
  for (const name of ['claimOnce', 'assertCustody', 'openPackaged', 'bindOwner', 'assertOwner', 'step', 'joinNormal',
    'retireUnqualified', 'verifyFinalPackage']) assert.equal(typeof hosted[name], 'function');
  let lease, names, witness, active = null, phase = 'new';
  function step(name, maxMs, action) {
    // The caller must quiesce or quarantine outstanding operations at timeout;
    // a local Promise.race is not authority to continue with live descendants.
    return hosted.step(lease, name, maxMs, action);
  }
  const failAndRetire = async (opened, primary) => {
    phase = 'failed';
    try { await hosted.retireUnqualified(lease, opened); }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'Unqualified launch retirement failed'); }
    throw primary;
  };
  return Object.freeze({
    async attest() {
      assert.equal(phase, 'new');
      phase = 'committing';
      // Durable admission is deliberately outside. A typed lease must already
      // prove the one authorized hosted invocation and fixed setup/capacity;
      // matching a user-supplied environment string alone cannot issue it.
      lease = await hosted.claimOnce(PRODUCT);
      assert(Object.isFrozen(lease), 'Retain the exact host-issued lease identity');
      names = settingsLayout(lease);
      assert.equal(await hosted.assertCustody(lease, names, 'fresh'), true);
      witness = await step('fresh-profile', 15_000, async () => {
        const mode = await createStateWitness(names.stateDir);
        await mode.verifyFresh();
        return mode;
      });
      phase = 'first';
      return { product: PRODUCT, exe: lease.exe, asar: lease.asar, profile: lease.profile };
    },
    async readDisk() {
      assert(witness && phase !== 'failed');
      return await step('read-profile', 15_000, () => witness.readDisk());
    },
    async openReady(label) {
      assert((label === 'first' || label === 'restart') && phase === label && !active);
      phase = 'opening';
      const ordinal = label === 'first' ? 1 : 2;
      let opened;
      try {
        assert.equal(await hosted.assertCustody(lease, names, label), true);
        // The future admitted process owner must own partial-launch failure
        // before calling Playwright, and return a bound launcher, not a PID
        // guessed after timeout. No environment-controlled CLI is accepted.
        opened = await hosted.openPackaged(lease, {
          executablePath: names.exePath, args: [`--user-data-dir=${names.stateDir}`],
          cwd: names.cwd, timeout: 60_000, ordinal,
        });
        const observe = (name, action) => step(name, 15_000, action);
        const ready = await observe('main-witness', () => opened.app.evaluate(({ app, BrowserWindow }) => {
          const [window, ...others] = BrowserWindow.getAllWindows();
          if (!window || others.length) return null;
          const prefs = window.webContents.getLastWebPreferences();
          return { pid: process.pid, executable: process.execPath, appExe: app.getPath('exe'), asar: app.getAppPath(),
            userData: app.getPath('userData'), sessionData: app.getPath('sessionData'),
            security: { packaged: app.isPackaged, sandbox: prefs.sandbox, contextIsolation: prefs.contextIsolation,
              nodeIntegration: prefs.nodeIntegration, platform: process.platform, arch: process.arch,
              version: app.getVersion(), electron: process.versions.electron } };
        }));
        assert(ready); assertLaunch(ready, names);
        const owner = await hosted.bindOwner(lease, opened, ready.pid, names.exePath);
        assert(DIGEST.test(owner.identity));
        const page = opened.page;
        await step('ordinary-discovery', 240_000, () => page.waitForFunction(async () => {
          const profile = document.getElementById('profile');
          if (!profile || profile.disabled || typeof require !== 'undefined' || typeof process !== 'undefined') return false;
          const snapshot = await window.encoder.getSnapshot();
          return snapshot.phase === 'idle' && snapshot.batchId == null && snapshot.planId == null && snapshot.items.length === 0;
        }, null, { timeout: 240_000 }));
        assert.equal(await hosted.assertOwner(lease, owner, names.exePath), true);
        const pageView = Object.freeze({
          click: (id, options) => observe('settings-click', () => page.click(id, options)),
          selectOption: (id, value, options) => observe('settings-select', () => page.selectOption(id, value, options)),
          waitForFunction: (call, value, options) => observe('settings-observe', () => page.waitForFunction(call, value, options)),
          evaluate: call => observe('settings-read', () => page.evaluate(call)),
        });
        const result = Object.freeze({ identity: owner.identity, exe: lease.exe, asar: lease.asar,
          profile: lease.profile, security: ready.security, page: pageView });
        active = { result, opened, owner, ordinal, mainPid: ready.pid };
        phase = 'active';
        return result;
      } catch (error) {
        return await failAndRetire(opened, error);
      }
    },
    async closeWindowAndJoin(app) {
      assert(phase === 'active' && active?.result === app, 'Only the active owned launch may close');
      phase = 'closing';
      const { opened, owner, ordinal, mainPid } = active;
      try {
        const closed = await step('normal-close', 30_000, async () => {
          assert.equal(await hosted.assertOwner(lease, owner, names.exePath), true);
          assert.equal(await opened.app.evaluate(ordinaryCloseRequest), true, 'One verified normal BrowserWindow close');
          return hosted.joinNormal(lease, opened, owner);
        });
        assert.deepEqual(closed, { launcherClosedZero: true, mainObservedGone: true, observedDescendantsGone: true });
        const sessionEnd = await step('durable-session', 15_000, () => witness.verifyDurableClose({ mainPid, ordinal }));
        assert.equal(sessionEnd, true);
        assert.equal(await hosted.assertCustody(lease, names, 'closed'), true);
        if (ordinal === 2) assert.equal(await hosted.verifyFinalPackage(lease, names), true);
        active = null;
        phase = ordinal === 1 ? 'restart' : 'done';
        return Object.freeze({ normalWindowClose: true, ...closed, durableSessionEndCompleted: true });
      } catch (error) {
        return await failAndRetire(opened, error);
      }
    },
  });
}

async function runWindowsSettingsProof(hosted) {
  return await settingsJourney(await createWindowsSettingsAdapter(hosted))();
}

module.exports = { runWindowsSettingsProof, settingsLayout, assertLaunch, ordinaryCloseRequest };
