'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'ui/index.html'), 'utf8');
const renderer = fs.readFileSync(path.join(root, 'ui/renderer.js'), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); };

// A small DOM/event fixture executes the complete production renderer without
// Electron, a browser process, native dialogs or media work. This verifies data
// flow and accessibility attributes, not native layout or screen-reader output.
function dom() {
  const ids = new Map();
  let document;
  class Element {
    constructor(tag) { this.tagName = tag.toLowerCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.events = new Map(); this.hidden = false; this.disabled = false; this.checked = false; this._value = undefined; this._text = ''; }
    set id(value) { this._id = value; ids.set(value, this); }
    get id() { return this._id || ''; }
    set textContent(value) { this._text = String(value); this.replaceChildren(); }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set value(value) { this._value = String(value); }
    get value() { return this._value ?? (this.tagName === 'select' ? this.options[0]?.value || '' : this.attributes.value || ''); }
    get valueAsNumber() { return this.value === '' ? NaN : Number(this.value); }
    get options() { return this.children.filter(child => child.tagName === 'option'); }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
      if (name === 'id') this.id = value;
      else if (name === 'class') this.className = value;
      else if (['hidden', 'disabled', 'checked', 'open'].includes(name)) this[name] = true;
      else if (name === 'tabindex') this.tabIndex = Number(value);
      else if (name === 'type') this.type = value;
      else if (name === 'value') this.value = value;
      else if (name.startsWith('data-')) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
    }
    getAttribute(name) { return this.attributes[name] ?? null; }
    removeAttribute(name) { delete this.attributes[name]; if (name === 'value') this._value = undefined; }
    append(...children) { for (const child of children) { child.remove(); child.parentElement = this; this.children.push(child); } }
    insertBefore(child, before) { child.remove(); child.parentElement = this; const index = this.children.indexOf(before); if (index < 0) this.children.push(child); else this.children.splice(index, 0, child); }
    replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
    remove() { if (this.parentElement) { if (this.contains(document.activeElement)) document.activeElement = document.body; const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
    addEventListener(name, listener) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(listener); }
    async emit(name, values = {}) { const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values }; for (const listener of this.events.get(name) || []) await listener(event); await settle(); return event; }
    async click() { if (!this.disabled) return this.emit('click'); }
    focus() { if (!this.disabled && document.contains(this)) document.activeElement = this; }
    select() { this.selected = true; }
    scrollIntoView() { this.scrolled = true; }
    contains(element) { return element === this || this.children.some(child => child.contains(element)); }
    matches(selector) {
      if (selector.startsWith('.')) return (this.className || '').split(/\s+/).includes(selector.slice(1));
      const match = /^(\w+)?\[([\w-]+)="([^"]+)"\]$/.exec(selector);
      if (match) {
        const attribute = match[2] === 'type' ? this.type : match[2].startsWith('data-')
          ? this.dataset[match[2].slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] : this.getAttribute(match[2]);
        return (!match[1] || this.tagName === match[1]) && attribute === match[3];
      }
      return this.tagName === selector;
    }
    querySelectorAll(selector) { const selectors = selector.split(',').map(value => value.trim()); const result = []; const visit = element => { for (const child of element.children) { if (selectors.some(item => child.matches(item))) result.push(child); visit(child); } }; visit(this); return result; }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  }
  document = new Element('document');
  document.getElementById = id => ids.get(id) || null;
  document.createElement = tag => new Element(tag);
  const stack = [document];
  const voidTags = new Set(['meta', 'link', 'input', 'br', 'hr', 'img']);
  for (const token of html.match(/<!--[\s\S]*?-->|<![^>]*>|<[^>]+>|[^<]+/g)) {
    if (token.startsWith('<!')) continue;
    if (token.startsWith('</')) {
      const name = token.slice(2, -1).trim();
      assert.equal(stack.at(-1).tagName, name, 'balanced HTML element: ' + name);
      stack.pop();
    } else if (token.startsWith('<')) {
      const name = /^<([\w-]+)/.exec(token)[1];
      const element = new Element(name);
      for (const attribute of token.slice(name.length + 1, -1).matchAll(/([\w-]+)(?:="([^"]*)")?/g)) element.setAttribute(attribute[1], attribute[2] || '');
      stack.at(-1).append(element);
      if (!voidTags.has(name)) stack.push(element);
    } else stack.at(-1)._text += token;
  }
  assert.equal(stack.length, 1);
  document.body = document.querySelector('body');
  document.activeElement = document.body;
  return { document, byId: id => ids.get(id) };
}

const defaults = () => ({ schema: 1, revision: 4, defaults: { fullAudioPolicy: 'copy', rangeAudioPolicy: 'precision-aac', resolution: 'source', hdrPolicy: 'preserve', remuxTarget: 'matroska', previewExpanded: false }, persistence: { state: 'ready', persisted: true, resetRequired: false }, notices: [] });
const profile = { id: 'h265-cpu', label: 'H.265 CPU', available: true, presets: ['slow', 'medium'], defaultPreset: 'slow', quality: { mode: 'CRF', min: 0, max: 51, default: 25 }, suffix: 'H265-CPU', supportedBitDepths: [8, 10] };

function nativeView() {
  const { NATIVE_PROFILES } = require('../src/backend-adapters.cjs');
  return { revision: 1, fileExecutionReady: false, controls: plain(NATIVE_PROFILES), ownerBlock: null,
    native: { profiles: NATIVE_PROFILES.map(item => ({ profileId: item.id, reason: 'CHOOSE_AND_QUALIFY_CELL' })) },
    devices: [{ id: 'opaque-intel-device', backend: 'qsv', description: 'Injected Intel adapter', driverVersion: '32.0.1.2' }] };
}
test('native panel sends exact frame quantizers and preserves displayed settings after a sample result', async () => {
  const view = nativeView(); let selected;
  const h = await harness({ getNativeBackendState: async () => view,
    selectNativeBackend: async request => { selected = request; return { ...view, revision: 2,
      selection: { selectionId: 'opaque-selection', request, probeVerified: false } }; },
    qualifyNativeBackend: async request => { assert.deepEqual(plain(request), { selectionId: 'opaque-selection', revision: 2 });
      return { ...view, revision: 3, selection: { selectionId: request.selectionId, request: selected, probeVerified: true } }; } });
  h.byId('native-settings-details').open = true; await h.byId('native-settings-details').emit('toggle');
  h.byId('native-profile').value = 'h264-qsv'; await h.byId('native-profile').emit('change');
  h.byId('native-mode').value = 'cqp'; await h.byId('native-mode').emit('change');
  for (const [key, value] of [['i', '22'], ['p', '25'], ['b', '28']]) h.byId(`native-qp-${key}`).value = value;
  await h.byId('native-qualify').click();
  assert.deepEqual(plain(selected.settings.quality), { i: 22, p: 25, b: 28 }); assert.equal(selected.settings.mode, 'cqp');
  assert.equal(h.byId('native-qp-b').value, '28'); assert.match(h.byId('native-status').textContent, /sample check passed.*File encoding remains unavailable/);
  assert.equal(h.byId('profile').options.length, 1); assert.equal(h.calls.some(call => call.name === 'startBatch'), false);
});
test('blank native CQP fields get no IPC and native activity locks controls with a cancel path', async () => {
  const h = await harness({ getNativeBackendState: async () => nativeView(), selectNativeBackend: async () => { throw new Error('Must not be called'); } });
  h.byId('native-settings-details').open = true; await h.byId('native-settings-details').emit('toggle');
  h.byId('native-profile').value = 'h264-qsv'; await h.byId('native-profile').emit('change');
  h.byId('native-mode').value = 'cqp'; await h.byId('native-mode').emit('change'); h.byId('native-qp-i').value = '';
  await h.byId('native-qualify').click(); assert.equal(h.calls.some(call => call.name === 'selectNativeBackend'), false);
  h.update({ revision: 50, batchId: 'native-operation', phase: 'native-checking', items: [], counts: {} });
  assert.equal(h.byId('native-settings-fields').disabled, true); assert.equal(h.byId('native-refresh').disabled, true);
  assert.equal(h.byId('cancel-batch').disabled, false); assert.equal(h.byId('cancel-batch').textContent, 'Cancel check');
});
test('a different displayed native profile cannot inherit a previous exact-settings success on reopen', async () => {
  let current = nativeView();
  const h = await harness({ getNativeBackendState: async () => current,
    selectNativeBackend: async request => (current = { ...current, revision: 2, selection: { selectionId: 'opaque', request } }),
    qualifyNativeBackend: async () => (current = { ...current, revision: 3, selection: { ...current.selection, probeVerified: true } }) });
  h.byId('native-settings-details').open = true; await h.byId('native-settings-details').emit('toggle');
  h.byId('native-profile').value = 'h264-qsv'; await h.byId('native-profile').emit('change'); await h.byId('native-qualify').click();
  assert.match(h.byId('native-status').textContent, /sample check passed/);
  h.byId('native-profile').value = 'h265-qsv'; await h.byId('native-profile').emit('change');
  await h.byId('native-settings-details').emit('toggle');
  assert.equal(h.byId('native-profile').value, 'h265-qsv'); assert.match(h.byId('native-status').textContent, /displayed settings are not checked/);
  assert.doesNotMatch(h.byId('native-status').textContent, /sample check passed/);
});
test('a cancelled native attempt refreshes its revision and permits a deliberate second check', async () => {
  let current = nativeView(), attempts = 0; const revisions = [];
  const h = await harness({ getNativeBackendState: async () => current,
    selectNativeBackend: async request => { assert.equal(request.revision, current.revision); revisions.push(request.revision);
      return (current = { ...current, revision: current.revision + 1, selection: { selectionId: 'opaque-' + attempts, request } }); },
    qualifyNativeBackend: async () => { attempts++; current = { ...current, revision: current.revision + 1,
      selection: { ...current.selection, probeVerified: attempts > 1 }, lastOutcome: { status: 'untested', reason: 'CANCELLED' } };
      if (attempts === 1) throw Object.assign(new Error('Check cancelled'), { code: 'CANCELLED' }); return current; } });
  h.byId('native-settings-details').open = true; await h.byId('native-settings-details').emit('toggle');
  h.byId('native-profile').value = 'h264-qsv'; await h.byId('native-profile').emit('change');
  await h.byId('native-qualify').click(); assert.match(h.byId('native-status').textContent, /CANCELLED/);
  await h.byId('native-qualify').click(); assert.deepEqual(revisions, [1, 3]); assert.equal(attempts, 2);
  assert.match(h.byId('native-status').textContent, /sample check passed/);
});

test('native backend discovery is explanatory and cannot silently populate an enabled profile', async () => {
  const h = await harness({ getCapabilities: async () => ({ profiles: [profile], versions: {}, backendDiscovery: {
    profiles: [{ encoder: 'hevc_amf', state: 'unavailable', reason: 'MISSING_DEVICE' },
      { encoder: 'av1_qsv', state: 'discovered', reason: 'CHOOSE_AND_QUALIFY_CELL' }], notices: ['Inventory warning'] } }) });
  assert.match(h.byId('capability-list').textContent, /hevc_amf: unavailable.*No matching hardware/);
  assert.match(h.byId('capability-list').textContent, /av1_qsv: discovered.*exact settings still need qualification/);
  assert.equal(h.byId('profile').options.length, 1);
  assert.match(h.byId('capability-list').textContent, /Inventory warning/);
});

async function harness(overrides = {}, { narrow = false } = {}) {
  const view = dom();
  const calls = [];
  let update;
  const initial = { revision: 1, phase: 'idle', items: [], counts: {}, progress: null };
  const methods = {
    getSnapshot: async () => initial,
    getCapabilities: async () => ({ profiles: [profile], recipes: [], versions: {} }),
    getPreferences: async () => ({ settingsByProfile: {}, inputFolder: null, outputFolder: null, profileId: 'h265-cpu', notices: [] }),
    getAppSettings: async () => defaults(),
    getAppearance: async () => ({ schema: 1, theme: 'dark', persistence: { state: 'default', persisted: false }, notices: [] }),
    saveAppearance: async request => ({ schema: 1, theme: request.theme, persistence: { state: 'saved', persisted: true }, notices: [] }),
    saveAppSettings: async request => ({ ...defaults(), revision: request.revision + 1, defaults: request.defaults }),
    resetAppSettings: async request => ({ ...defaults(), revision: request.revision + 1 }),
    getRuntimeInformation: async () => ({ appVersion: '0.7.0-alpha.1', electron: null, chromium: null, node: 'test-node', platform: 'win32', architecture: 'x64', media: { ffmpeg: { status: 'not-yet-observed', version: null, executable: 'D:\\owned\\ffmpeg.exe' }, ffprobe: { status: 'observed', version: '9.0.1', executable: 'D:\\owned\\ffprobe.exe' } } }),
    getDiagnosticHistory: async () => ({ events: [], nextCursor: null, status: { available: true } }),
    cancelBatch: async () => ({ revision: 99, phase: 'cancelled', items: [], counts: {} }),
    ...overrides,
  };
  const api = { onUpdate: callback => { update = callback; return () => {}; } };
  for (const [name, method] of Object.entries(methods)) api[name] = async (...args) => { calls.push({ name, args: plain(args) }); return method(...args); };
  let layoutListener;
  const mediaQuery = { matches: narrow, addEventListener: (_name, listener) => { layoutListener = listener; } };
  const window = { encoder: api, addEventListener() {}, matchMedia: () => mediaQuery };
  vm.runInNewContext(renderer, { window, document: view.document, performance: { now: () => 100 }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} }, { filename: 'ui/renderer.js' });
  await settle();
  assert.equal(view.byId('error-banner').textContent, '');
  return { ...view, calls, update: value => update(value), setNarrow: value => { mediaQuery.matches = value; layoutListener?.(); } };
}

test('appearance changes real presentation without adopting or altering unsaved processing settings', async () => {
  const h = await harness();
  assert.equal(h.document.querySelector('html').dataset.theme, 'dark');
  await h.byId('tab-settings').click();
  h.byId('default-resolution').value = '720';
  await h.byId('default-resolution').emit('change');
  const before = h.calls.filter(call => !['getAppearance', 'getAppSettings'].includes(call.name)).length;
  h.byId('appearance-theme').value = 'light';
  await h.byId('appearance-theme').emit('change');
  assert.equal(h.document.querySelector('html').dataset.theme, 'light');
  assert.equal(h.byId('default-resolution').value, '720');
  assert.match(h.byId('appearance-status').textContent, /Light theme saved/);
  assert.deepEqual(h.calls.at(-1), { name: 'saveAppearance', args: [{ theme: 'light' }] });
  assert.equal(h.calls.filter(call => !['getAppearance', 'getAppSettings'].includes(call.name)).length, before + 1);
  assert.equal(h.calls.some(call => ['saveAppSettings', 'prepareBatch', 'startBatch'].includes(call.name)), false);
});

test('unconfirmed appearance save preserves the current theme and gives an honest local failure', async () => {
  const h = await harness({ saveAppearance: async () => { throw Object.assign(new Error('Appearance changed on disk.'), { code: 'APPEARANCE_CHANGED' }); } });
  h.byId('appearance-theme').value = 'light'; await h.byId('appearance-theme').emit('change');
  assert.equal(h.document.querySelector('html').dataset.theme, 'dark');
  assert.equal(h.byId('appearance-theme').value, 'dark');
  assert.match(h.byId('appearance-error').textContent, /changed on disk/);
  assert.match(h.byId('appearance-status').textContent, /not saved/);
  assert.equal(h.calls.filter(call => call.name === 'saveAppearance').length, 1);
});

test('appearance rejects an unknown UI value before IPC and applies saved light at startup', async () => {
  const h = await harness({ getAppearance: async () => ({ schema: 1, theme: 'light', persistence: { state: 'saved', persisted: true }, notices: [] }) });
  assert.equal(h.document.querySelector('html').dataset.theme, 'light');
  h.byId('appearance-theme').value = 'system'; await h.byId('appearance-theme').emit('change');
  assert.equal(h.byId('appearance-theme').value, 'light');
  assert.equal(h.calls.some(call => call.name === 'saveAppearance'), false);
  assert.match(h.byId('appearance-error').textContent, /Light or Dark/);
});

test('workbench has unique IDs, matched tab/panel semantics, and no executable renderer content', () => {
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(allIds).size, allIds.length);
  const view = dom();
  for (const name of ['encode', 'remux', 'jobs', 'history', 'settings', 'help']) {
    assert.equal(view.byId(`tab-${name}`).getAttribute('role'), 'tab');
    assert.equal(view.byId(`tab-${name}`).getAttribute('aria-controls'), `workspace-${name}`);
    assert.equal(view.byId(`workspace-${name}`).getAttribute('aria-labelledby'), `tab-${name}`);
    assert.equal(view.byId(`workspace-${name}`).hidden, name !== 'encode');
  }
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|eval\(/);
});

test('keyboard tab navigation is manual, preserves controls, and never submits a queue action', async () => {
  const h = await harness();
  const profileValue = h.byId('profile').value;
  await h.byId('tab-encode').emit('keydown', { key: 'End' });
  assert.equal(h.document.activeElement, h.byId('tab-help'));
  assert.equal(h.byId('workspace-encode').hidden, false);
  assert.equal(h.calls.filter(call => call.name === 'getRuntimeInformation').length, 0);
  await h.byId('tab-help').emit('keydown', { key: 'Enter' });
  assert.equal(h.byId('workspace-help').hidden, false);
  assert.equal(h.byId('tab-help').getAttribute('aria-selected'), 'true');
  assert.equal(h.byId('tab-encode').tabIndex, -1);
  await h.byId('tab-help').emit('keydown', { key: 'Home' });
  await h.byId('tab-encode').emit('keydown', { key: ' ' });
  assert.equal(h.byId('profile').value, profileValue);
  assert.equal(h.byId('preset').value, 'slow');
  assert.equal(h.byId('quality').value, '25');
  assert.equal(h.calls.some(call => ['prepareBatch', 'startBatch', 'cancelBatch', 'saveSettings'].includes(call.name)), false);
});

test('running jobs reuse preview nodes, retain live progress across tabs, and keep cancellation available', async () => {
  const h = await harness();
  const item = { id: 'file-1', name: 'Source.mkv', outputName: 'Source_H265-CPU.mkv', status: 'ready', reason: '', summary: {} };
  h.update({ revision: 2, phase: 'ready', batchId: 'batch-1', planId: 'plan-1', settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, items: [item], counts: {} });
  const row = h.byId('batch-items').children[0];
  assert.equal(h.byId('batch-panel').parentElement, h.byId('encode-batch-slot'));
  h.update({ revision: 3, phase: 'running', batchId: 'batch-1', planId: 'plan-1', settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, items: [{ ...item, status: 'running' }], counts: {}, progress: { fileId: item.id, percent: 17.5, seconds: 2, speed: 1.5 } });
  assert.equal(h.byId('batch-panel').parentElement, h.byId('jobs-batch-slot'));
  assert.equal(h.byId('batch-items').children[0], row);
  assert.equal(h.byId('profile').disabled, true);
  await h.byId('tab-history').click();
  assert.equal(h.byId('cancel-bar').hidden, false);
  assert.match(h.byId('active-job-summary').textContent, /Source\.mkv.*17\.5%/);
  assert.equal(h.byId('active-job-progress').value, '17.5');
  assert.equal(h.byId('tab-encode').disabled, false);
  await h.byId('cancel-batch').click();
  assert.deepEqual(h.calls.find(call => call.name === 'cancelBatch').args, [{ batchId: 'batch-1' }]);
});

test('post-encode stages have accessible indeterminate labels, retained details and working Jobs/cancel navigation', async () => {
  const h = await harness();
  const item = { id: 'file-1', name: 'Source.mkv', outputName: 'Source_H265-CPU.mkv', status: 'running', reason: '', summary: {} };
  const base = { phase: 'running', batchId: 'batch-1', planId: 'plan-1', settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, items: [item], counts: {} };
  h.update({ ...base, revision: 2, progress: { fileId: item.id, stage: 'encoding', percent: 99, seconds: 2, fps: 30, speed: 1, etaSeconds: 0 } });
  const row = h.byId('batch-items').children[0];
  await h.byId('tab-help').click();
  let revision = 2;
  for (const [stage, label] of [['encoder-input-check', 'Checking encoder input'], ['evidence-collection', 'Checking preservation'],
    ['output-validation', 'Validating output'], ['source-check', 'Checking source'], ['publication', 'Publishing output']]) {
    // Even stale telemetry in a main snapshot cannot fabricate a percentage or
    // ETA for a processing stage. Normal service snapshots omit these values.
    h.update({ ...base, revision: ++revision, items: [{ ...item, status: 'validating' }], progress: { fileId: item.id, stage, percent: 99, seconds: 2, fps: 30, speed: 1, etaSeconds: 0 } });
    assert.equal(h.byId('batch-items').children[0], row);
    assert.match(row.textContent, new RegExp(label));
    assert.equal(row.querySelector('[data-testid="encoding-details"]').hidden, false);
    assert.equal(h.byId('phase-badge').textContent, label);
    assert.match(h.byId('active-job-summary').textContent, new RegExp(`${label}.*Source\\.mkv`));
    assert.doesNotMatch(h.byId('active-job-summary').textContent, /%/);
    assert.equal(h.byId('active-job-summary').getAttribute('role'), 'status');
    assert.equal(h.byId('active-job-summary').getAttribute('aria-live'), 'polite');
    for (const progress of ['encode-progress', 'active-job-progress']) {
      assert.equal(h.byId(progress).getAttribute('value'), null); assert.equal(h.byId(progress).value, '');
      assert.match(h.byId(progress).getAttribute('aria-label'), new RegExp(label));
      assert.match(h.byId(progress).getAttribute('aria-valuetext'), /indeterminate/);
    }
    assert.equal(h.byId('progress-label').textContent, label);
    assert.equal(h.byId('percent').textContent, 'Processing');
    assert.equal(h.byId('encoding-telemetry').hidden, true);
    for (const id of ['encoded-time', 'speed', 'fps', 'output-size', 'eta']) assert.equal(h.byId(id).textContent, '—');
    assert.equal(h.byId('cancel-bar').hidden, false); assert.equal(h.byId('cancel-batch').disabled, false);
    assert.equal(h.byId('profile').disabled, true); assert.equal(h.byId('tab-jobs').disabled, false);
  }
  await h.byId('view-jobs').click();
  assert.equal(h.byId('workspace-jobs').hidden, false); assert.equal(h.byId('batch-panel').parentElement, h.byId('jobs-batch-slot'));
  await h.byId('cancel-batch').click();
  assert.deepEqual(h.calls.find(call => call.name === 'cancelBatch').args, [{ batchId: 'batch-1' }]);
});

test('App Settings persist exact visible defaults and revision without modifying Encode controls', async () => {
  const h = await harness();
  await h.byId('tab-settings').click();
  h.byId('default-resolution').value = '1080';
  h.byId('default-preview-expanded').checked = true;
  await h.byId('default-resolution').emit('change');
  assert.equal(h.byId('app-settings-save').disabled, false);
  await h.byId('app-settings-form').emit('submit');
  assert.deepEqual(h.calls.find(call => call.name === 'saveAppSettings').args, [{ revision: 4, defaults: { ...defaults().defaults, resolution: '1080', previewExpanded: true } }]);
  assert.match(h.byId('app-settings-status').textContent, /Revision 5.*Confirmed saved/);
  assert.equal(h.byId('quality').value, '25');
  assert.equal(h.byId('app-settings-save').disabled, true);
  await h.byId('app-settings-reset').click();
  assert.deepEqual(h.calls.find(call => call.name === 'resetAppSettings').args, [{ revision: 5 }]);
  assert.match(h.byId('app-settings-integration-note').textContent, /Saved processing defaults apply to new batches/);
  assert.match(h.byId('app-settings-integration-note').textContent, /Preview expansion.*not yet applied/);
});

test('failed or stale default saves retain edits and require explicit reload before retrying', async () => {
  const h = await harness({ saveAppSettings: async () => { throw new Error('Revision conflict'); } });
  await h.byId('tab-settings').click();
  h.byId('default-resolution').value = '720'; await h.byId('default-resolution').emit('change');
  await h.byId('app-settings-form').emit('submit');
  assert.equal(h.byId('default-resolution').value, '720');
  assert.match(h.byId('app-settings-error').textContent, /Revision conflict/);
  assert.equal(h.byId('app-settings-save').disabled, true);
  await h.byId('app-settings-form').emit('submit');
  assert.equal(h.calls.filter(call => call.name === 'saveAppSettings').length, 1);
  await h.byId('app-settings-reload').click();
  assert.equal(h.byId('default-resolution').value, 'source');
  assert.equal(h.byId('app-settings-error').hidden, true);
});

test('Help distinguishes unobserved runtime versions and renders hostile-looking values as text', async () => {
  const h = await harness({ getRuntimeInformation: async () => ({ appVersion: '<script>version text</script>', electron: null, chromium: null,
    node: 'test-node', platform: 'win32', architecture: 'x64', media: { ffmpeg: { status: 'not-yet-observed', version: null, executable: 'D:\\owned\\ffmpeg.exe' }, ffprobe: { status: 'observed', version: '9.0.1' } } }) });
  await h.byId('tab-help').click();
  const text = h.byId('runtime-information').textContent;
  assert.match(text, /ffmpegNot yet observed/);
  assert.match(text, /ffprobe9\.0\.1/);
  assert.match(text, /ElectronNot reported/);
  assert.match(text, /<script>version text/);
  assert.equal(h.byId('runtime-information').querySelectorAll('script').length, 0);
  assert.match(h.byId('runtime-locations').textContent, /D:\\owned\\ffmpeg.exe/);
  assert.equal(h.calls.filter(call => call.name === 'getCapabilities').length, 1, 'Help performs no capability rerun');
});

test('App Settings recovery preserves the corrupt record until explicit reset and keeps edits on workspace changes', async () => {
  const h = await harness({ getAppSettings: async () => ({ ...defaults(), persistence: { state: 'reset-required', persisted: false, resetRequired: true }, notices: ['Unknown stored schema preserved.'] }) });
  await h.byId('tab-settings').click();
  assert.equal(h.byId('app-settings-fields').disabled, true);
  assert.equal(h.byId('app-settings-save').disabled, true);
  assert.equal(h.byId('app-settings-reset').disabled, false);
  assert.match(h.byId('app-settings-status').textContent, /Unknown stored schema preserved/);
  assert.equal(h.calls.some(call => call.name === 'resetAppSettings'), false);
  await h.byId('app-settings-reset').click();
  assert.equal(h.byId('app-settings-fields').disabled, false);
  h.byId('default-resolution').value = '1440'; await h.byId('default-resolution').emit('change');
  await h.byId('tab-jobs').click(); await h.byId('tab-settings').click();
  assert.equal(h.byId('default-resolution').value, '1440');
  assert.equal(h.calls.filter(call => call.name === 'getAppSettings').length, 1);
});

test('delayed incident detail responses cannot replace the record selected more recently', async () => {
  const pending = new Map();
  const h = await harness({
    getDiagnosticHistory: async () => ({ events: ['first', 'second'].map(id => ({ id, at: 123, stage: 'encoding', reason: id, severity: 'info' })), nextCursor: null, status: { available: true } }),
    getDiagnosticRecord: request => new Promise(resolve => pending.set(request.eventId, resolve)),
  });
  await h.byId('tab-history').click();
  const buttons = h.byId('history-items').querySelectorAll('button');
  await buttons[0].click(); await buttons[1].click();
  pending.get('second')({ event: { id: 'second', reason: 'SECOND_SELECTED' }, status: {} }); await settle();
  pending.get('first')({ event: { id: 'first', reason: 'STALE_FIRST' }, status: {} }); await settle();
  assert.match(h.byId('history-record-json').textContent, /SECOND_SELECTED/);
  assert.doesNotMatch(h.byId('history-record-json').textContent, /STALE_FIRST/);
});

test('history failure is visible without changing job state or claiming empty complete history', async () => {
  const h = await harness({ getDiagnosticHistory: async () => ({ events: [], nextCursor: null, persisted: false, status: { available: false, incomplete: true } }) });
  await h.byId('tab-history').click();
  assert.match(h.byId('history-error').textContent, /unavailable/);
  assert.equal(h.byId('history-empty').hidden, true);
  assert.equal(h.byId('profile').disabled, false);
  assert.equal(h.byId('phase-badge').textContent, 'Ready');
});

test('History uses opaque page cursors and ID-only details/export with truthful incomplete capture notices', async () => {
  const events = [0, 1].map(index => ({ id: `event-${index}`, at: 123000 + index, stage: 'encoding', reason: index ? 'SECOND_EVENT' : '<img src=x onerror=bad()>', severity: 'warning' }));
  const h = await harness({
    getDiagnosticHistory: async request => ({ events: [events[request.cursor ? 1 : 0]], nextCursor: request.cursor ? null : 'opaque-main-cursor', status: { available: true, incomplete: true } }),
    getDiagnosticRecord: async request => ({ event: { id: request.eventId, reason: 'JOB_FAILED', message: '<script>private text</script>', stderr: { text: '<img> stderr', truncated: true } }, status: { available: true } }),
    getDiagnosticExportPreview: async request => ({ data: { notice: 'Review before sharing.' }, json: JSON.stringify({ selected: request.eventIds, path: '[PATH_001]' }), status: { available: true } }),
  });
  await h.byId('tab-history').click();
  assert.match(h.byId('history-status').textContent, /Known gaps/);
  assert.equal(h.byId('history-items').querySelectorAll('img').length, 0);
  let checkbox = h.byId('history-items').querySelector('input[type="checkbox"]');
  checkbox.checked = true; await checkbox.emit('change');
  await h.byId('history-items').querySelector('button').click();
  assert.deepEqual(h.calls.find(call => call.name === 'getDiagnosticRecord').args, [{ eventId: 'event-0' }]);
  assert.match(h.byId('history-record-notice').textContent, /tail.*unknown/);
  assert.match(h.byId('history-record-json').textContent, /<script>private text/);
  assert.equal(h.byId('history-record-json').children.length, 0);
  await h.byId('history-more').click();
  assert.deepEqual(h.calls.filter(call => call.name === 'getDiagnosticHistory').at(-1).args, [{ limit: 50, cursor: 'opaque-main-cursor' }]);
  checkbox = h.byId('history-items').querySelector('input[type="checkbox"]');
  checkbox.checked = true; await checkbox.emit('change');
  await h.byId('history-export').click();
  assert.deepEqual(h.calls.find(call => call.name === 'getDiagnosticExportPreview').args, [{ eventIds: ['event-0', 'event-1'] }]);
  assert.equal(h.byId('history-export-panel').hidden, false);
  await h.byId('history-select-export').click();
  assert.equal(h.byId('history-export-text').selected, true);
  await h.byId('history-clear-selection').click();
  assert.equal(h.byId('history-export-panel').hidden, true);
  assert.equal(h.byId('history-export-text').value, '');
});

const completedId = '21345678-1234-4234-8234-123456789abc';
const completedItem = extra => ({ id: 'published-file', name: 'Source.mkv', outputName: 'Source_H265-CPU.mkv',
  status: 'success', summary: {}, outputDisposition: { published: true, kind: 'published', file: 'D:\\owned\\Source_H265-CPU.mkv' },
  outputAccess: { outputId: completedId }, ...extra });
const completedSnapshot = (items, revision = 2) => ({ revision, phase: 'completed', batchId: 'finished-batch', planId: 'finished-plan',
  settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, items, counts: { success: items.length } });

test('native generation history formats exact frame quantizers without current inventory or automatic actions', async () => {
  const h = await harness(), previous = { version: 2, kind: 'native-encoder', codec: 'H265', backend: 'qsv', encoder: 'hevc_qsv', preset: 'medium',
    qualityMode: 'CQP', quality: { p: 25, b: 28, i: 22 }, bitDepth: 10, pipelineId: 'software-d3d11-upload-v1', encoderArgs: ['-c:v:0', 'hevc_qsv'],
    appVersion: '0.7.0-alpha.1', createdAt: '2026-10-26T08:00:00.000Z', runtimeVersion: '<img src=x onerror=unsafe()> runtime text' };
  h.update(completedSnapshot([completedItem({ status: 'generated', outputAccess: undefined, outputDisposition: undefined,
    origin: { kind: 'generated', previousGeneration: previous } })]));
  const row = h.byId('batch-items').children[0], summary = row.querySelector('[data-testid="previous-generation"]'), details = row.querySelector('[data-testid="previous-generation-details"]');
  assert.match(summary.textContent, /Intel Quick Sync.*CQP I22\/P25\/B28.*10-bit.*recorded requested settings/);
  assert.doesNotMatch(summary.textContent, /\[object Object\]/); assert.match(details.textContent, /Planned pipeline software-d3d11-upload-v1/);
  assert.match(details.textContent, /no current device or effective-mode proof/); assert.match(details.textContent, /<img src=x/);
  assert.equal(details.querySelectorAll('img').length, 0); assert.equal(row.querySelector('[data-testid="completed-output-open"]'), null);
  assert.equal(h.byId('profile').options.length, 1);
  assert.equal(h.calls.some(call => ['getNativeBackendState', 'qualifyNativeBackend', 'startBatch', 'reencodeOutputs'].includes(call.name)), false);
});
test('native generation history distinguishes AMF I/P and scalar ICQ or QVBR values', async () => {
  const h = await harness();
  for (const [index, backend, qualityMode, quality, expected] of [[0, 'amf', 'CQP', { i: 20, p: 27 }, /AMD AMF.*CQP I20\/P27/],
    [1, 'qsv', 'ICQ', 29, /Intel Quick Sync.*ICQ 29/], [2, 'amf', 'QVBR', 37, /AMD AMF.*QVBR 37/]]) {
    h.update(completedSnapshot([completedItem({ origin: { kind: 'generated', previousGeneration: { version: 2, kind: 'native-encoder', codec: 'H265', backend,
      encoder: backend === 'amf' ? 'hevc_amf' : 'hevc_qsv', preset: 'medium', qualityMode, quality, bitDepth: 10, pipelineId: 'software-d3d11-upload-v1',
      encoderArgs: [], appVersion: '0.7.0-alpha.1', createdAt: '2026-10-26T08:00:00.000Z' } } })], 10 + index));
    const summary = h.byId('batch-items').children[0].querySelector('[data-testid="previous-generation"]'); assert.match(summary.textContent, expected);
    if (qualityMode === 'CQP') assert.doesNotMatch(summary.textContent, /\/B/);
  }
});

test('completed-output controls submit only a receipt token and fixed action, with pending click suppression', async () => {
  let resolveOpen;
  const h = await harness({ openCompletedOutput: request => request.action === 'open'
    ? new Promise(resolve => { resolveOpen = resolve; }) : Promise.resolve({ dispatched: true }) });
  h.update(completedSnapshot([completedItem()]));
  const row = h.byId('batch-items').children[0];
  const open = row.querySelector('[data-testid="completed-output-open"]');
  const reveal = row.querySelector('[data-testid="completed-output-reveal"]');
  assert.equal(open.textContent, 'Open output'); assert.equal(reveal.textContent, 'Show in folder');
  assert.equal(row.querySelector('[data-testid="file-details"]').contains(open), true);
  await open.click(); await open.click(); await reveal.click();
  assert.equal(open.disabled, true); assert.equal(reveal.disabled, true);
  assert.deepEqual(h.calls.filter(call => call.name === 'openCompletedOutput').map(call => call.args), [[{ outputId: completedId, action: 'open' }]]);
  resolveOpen({ dispatched: true }); await settle();
  assert.equal(open.disabled, false); assert.equal(reveal.disabled, false);
  const notice = row.querySelector('[data-testid="completed-output-notice"]');
  assert.match(notice.textContent, /Playback has not been verified/);
  assert.equal(notice.getAttribute('role'), 'status'); assert.equal(notice.getAttribute('aria-live'), 'polite');
  await reveal.click();
  assert.deepEqual(h.calls.filter(call => call.name === 'openCompletedOutput').at(-1).args, [{ outputId: completedId, action: 'reveal' }]);
  assert.match(notice.textContent, /request sent to Windows/);
});

test('output failures and issuance warnings are visible text; fulfilled failure is never called success', async () => {
  let result = 'reject';
  const h = await harness({ openCompletedOutput: async () => {
    if (result === 'reject') throw new Error('<img src=x onerror=unsafe()> File changed.');
    return result;
  } });
  h.update(completedSnapshot([completedItem()]));
  const row = h.byId('batch-items').children[0], open = row.querySelector('[data-testid="completed-output-open"]');
  await open.click();
  const notice = row.querySelector('[data-testid="completed-output-notice"]');
  assert.match(notice.textContent, /Could not open.*<img.*File changed/);
  assert.equal(notice.hidden, false); assert.equal(notice.children.length, 0); assert.equal(open.disabled, false);
  result = {};
  await open.click(); assert.match(notice.textContent, /did not confirm/); assert.doesNotMatch(notice.textContent, /request sent/);
  h.update(completedSnapshot([completedItem({ outputAccess: undefined, outputAccessWarning: '<script>Saved; opening unavailable.</script>' })], 3));
  assert.equal(row.querySelector('[data-testid="completed-output-open"]'), null);
  assert.match(notice.textContent, /Saved; opening unavailable/); assert.equal(notice.children.length, 0);
});

test('paths, provenance, diagnostics, skipped and retained files cannot create output actions', async () => {
  const h = await harness({
    getDiagnosticHistory: async () => ({ events: [{ id: 'past-event', reason: 'Completed previously', at: 123, severity: 'info',
      outputAccess: { outputId: completedId } }], nextCursor: null, status: { available: true } }),
    getDiagnosticRecord: async () => ({ event: { outputAccess: { outputId: completedId }, file: 'D:\\existing.mp4', status: 'success' }, status: { available: true } })
  });
  const items = [
    completedItem({ outputAccess: undefined, file: 'D:\\existing.mp4', details: { outputId: completedId } }),
    completedItem({ outputAccess: undefined, origin: { previousGeneration: { encoderArgs: [], outputAccess: { outputId: completedId } } } }),
    ...['skipped', 'failed', 'cancelled', 'running', 'ready', 'generated'].map(status => completedItem({ status })),
    completedItem({ outputDisposition: { kind: 'retained-completed', published: false } }),
    completedItem({ outputDisposition: { kind: 'publication-uncertain', published: null } }),
    completedItem({ outputAccess: { outputId: 'D:\\existing.mp4' } }),
    completedItem({ outputAccess: { outputId: completedId, path: 'D:\\existing.mp4' } }),
  ].map((item, index) => ({ ...item, id: `file-${index}` }));
  h.update(completedSnapshot(items));
  assert.equal(h.document.querySelectorAll('[data-testid="completed-output-open"]').length, 0);
  assert.equal(h.document.querySelectorAll('[data-testid="completed-output-reveal"]').length, 0);
  await h.byId('tab-history').click(); await h.byId('history-items').querySelector('button').click();
  assert.match(h.byId('history-record-json').textContent, /outputId/);
  assert.equal(h.document.querySelectorAll('[data-testid="completed-output-open"]').length, 0);
  assert.equal(h.calls.filter(call => call.name === 'openCompletedOutput').length, 0);
});

test('a stale output response cannot replace the state of a new receipt or removed row', async () => {
  const pending = [];
  const h = await harness({ openCompletedOutput: () => new Promise(resolve => pending.push(resolve)) });
  h.update(completedSnapshot([completedItem()]));
  const row = h.byId('batch-items').children[0];
  await row.querySelector('[data-testid="completed-output-open"]').click();
  const nextId = '31345678-1234-4234-8234-123456789abc';
  h.update(completedSnapshot([completedItem({ outputAccess: { outputId: nextId } })], 3));
  const notice = row.querySelector('[data-testid="completed-output-notice"]');
  assert.equal(notice.textContent, '');
  const nextOpen = row.querySelector('[data-testid="completed-output-open"]');
  await nextOpen.click(); pending[0]({ dispatched: true }); await settle();
  assert.equal(nextOpen.disabled, true); assert.match(notice.textContent, /Requesting the default player/);
  h.update(completedSnapshot([], 4)); pending[1]({ dispatched: true }); await settle();
  assert.equal(h.byId('batch-items').children.length, 0);
  assert.equal(h.byId('error-banner').textContent, '');
});

async function processingHarness({ fileOverrides = [], batchOverrides = {}, refuse = false, failUpdate = false, withFolders = false, invalidateOnSave = false, durationSeconds, rangeLimitUs, narrow = false } = {}) {
  const { OperationDraft } = require('../src/operation-draft.cjs');
  const ids = ['11345678-1234-4234-8234-123456789abc', '22345678-1234-4234-8234-123456789abc'];
  const draft = new OperationDraft({ operation: 'encode', appDefaults: defaults().defaults, appDefaultsRevision: 4 });
  draft.addSources(ids.map(fileId => ({ fileId, identityRevision: 0 })));
  if (Object.keys(batchOverrides).length) draft.setBatchOverrides({ draftId: draft.id, revision: draft.snapshot().revision, overrides: batchOverrides });
  for (const [index, overrides] of fileOverrides.entries()) if (overrides) draft.patchFiles({ draftId: draft.id, revision: draft.snapshot().revision, fileIds: [ids[index]], overrides });
  let stateRevision = 1, plan = 'processing-plan-1', refused = false, encodingSettingsStale = false;
  let settings = { profileId: 'h265-cpu', preset: 'slow', quality: 25 };
  const snapshot = (phase = 'ready') => ({ revision: ++stateRevision, phase, batchId: 'processing-batch', planId: plan,
    settings, encodingSettingsStale, operationDraft: draft.snapshot(), counts: {},
    items: ids.map((id, index) => ({ id, name: `Source ${index + 1}.mkv`, outputName: `Source ${index + 1}_H265-CPU.mkv`, summary: { durationSeconds }, ...(rangeLimitUs === undefined ? {} : { rangeLimitUs }),
      status: encodingSettingsStale ? 'unprocessed' : refused && index === 0 ? 'unsupported' : 'ready',
      reason: encodingSettingsStale ? 'Encoding settings changed. Prepare this draft again before starting.' : refused && index === 0 ? 'This range/audio cell is not yet qualified.' : '' })) });
  const check = request => assert.equal(request.planId, plan);
  const after = () => { plan = `processing-plan-${stateRevision + 1}`; return snapshot(); };
  const h = await harness({
    ...(withFolders ? {
      getCapabilities: async () => ({ profiles: [profile, { ...profile, id: 'h264-cpu', label: 'H.264 CPU' }], recipes: [], versions: {} }),
      getPreferences: async () => ({ settingsByProfile: {}, profileId: 'h265-cpu', notices: [],
        inputFolder: { id: 'input-token', path: 'D:\\owned-input' }, outputFolder: { id: 'output-token', path: 'D:\\owned-output' } }),
      saveSettings: async () => {
        // Main autosave rotates prepared authority but intentionally preserves
        // the draft revision, so unsent renderer edits are not overwritten.
        if (invalidateOnSave) { encodingSettingsStale = true; h.update(after()); }
        return { notices: [] };
      },
      chooseInputFolder: async () => ({ id: 'new-input-token', path: 'D:\\other-owned-input' }),
      chooseOutputFolder: async () => ({ id: 'new-output-token', path: 'D:\\other-owned-output' }),
      prepareBatch: async request => { settings = plain(request.settings); encodingSettingsStale = false; return after(); },
      reprepareEncodingSettings: async request => { request = plain(request); check(request);
        draft.invalidateEncodingSettings({ draftId: request.draftId, revision: request.revision }); settings = request.settings; encodingSettingsStale = false; return after(); },
    } : {}),
    // Electron's bridge serializes renderer data into main's realm. Reproduce
    // that boundary before invoking the real pure main-owned draft module.
    updateFileOperations: async request => { request = plain(request); check(request); if (failUpdate) throw new Error('This draft changed; review it before applying again.');
      const { planId, ...change } = request; draft.patchFiles(change); refused = refuse; return after(); },
    updateBatchOperationDefaults: async request => { request = plain(request); check(request); const { planId, ...change } = request; draft.setBatchOverrides(change); return after(); },
    applyAppDefaultsToBatch: async request => { request = plain(request); check(request); const { planId, ...change } = request;
      draft.applyAppDefaults(change, { defaults: { ...defaults().defaults, resolution: '1440' }, revision: 8 }); return after(); },
  });
  h.setNarrow(narrow);
  h.update(snapshot());
  return { ...h, draft, ids, snapshot, row: index => h.byId('batch-items').children[index],
    control: (index, name) => h.byId('batch-items').children[index].querySelector(`[data-testid="file-operation-${name}"]`) };
}

test('range sliders reflect known duration and preserve exact text until the user moves a boundary', async () => {
  const h = await processingHarness({ durationSeconds: 12.123456, rangeLimitUs: 12123456,
    fileOverrides: [{ range: { startUs: 1234567, endUs: 9123456 } }] });
  assert.equal(h.control(0, 'start-slider').disabled, false);
  assert.equal(h.control(0, 'start-slider').step, '0.001');
  assert.equal(h.control(0, 'end-slider').max, '12.123456');
  assert.equal(h.control(0, 'start').value, '1.234567');
  assert.match(h.control(0, 'start-slider').getAttribute('aria-valuetext'), /Slider approximation .*exact field 1\.234567/);
  h.control(0, 'start-slider').value = '2.345'; await h.control(0, 'start-slider').emit('input');
  assert.equal(h.control(0, 'start').value, '2.345'); assert.equal(h.control(0, 'end').value, '9.123456');
  assert.equal(h.calls.some(call => call.name === 'updateFileOperations'), false);
  await h.row(0).querySelector('form').emit('submit');
  assert.deepEqual(h.calls.find(call => call.name === 'updateFileOperations').args[0].overrides.range,
    { startUs: 2345000, endUs: 9123456 });
});

test('range sliders never clamp exact fields, authorize a crossed interval, or invent a missing duration', async () => {
  const h = await processingHarness({ durationSeconds: 10, rangeLimitUs: 10000000, fileOverrides: [{ range: { startUs: 1000000, endUs: 2000000 } }] });
  h.control(0, 'end').value = '12.987654'; await h.control(0, 'end').emit('input');
  assert.equal(h.control(0, 'end-slider').value, '10'); assert.equal(h.control(0, 'end').value, '12.987654');
  h.control(0, 'start-slider').value = '5'; await h.control(0, 'start-slider').emit('input');
  h.control(0, 'end-slider').value = '4'; await h.control(0, 'end-slider').emit('input');
  await h.row(0).querySelector('form').emit('submit');
  assert.equal(h.calls.some(call => call.name === 'updateFileOperations'), false);
  assert.match(h.control(0, 'notice').textContent, /later than its start/);
  const unknown = await processingHarness({ fileOverrides: [{ range: { endUs: 2000000 } }] });
  assert.equal(unknown.control(0, 'start-slider').disabled, true); assert.equal(unknown.control(0, 'start').disabled, false);
  const full = await processingHarness({ durationSeconds: 10, rangeLimitUs: 10000000 });
  assert.equal(full.control(0, 'start-slider').disabled, true);
  h.update(h.snapshot('running')); assert.equal(h.control(0, 'start-slider').disabled, true);
});

test('range sliders use only main\'s exact range limit, never the rounded inspected duration', async () => {
  // The inspected duration is a rounded description; main's limit is the exact latest end it accepts.
  const h = await processingHarness({ durationSeconds: 10.2, rangeLimitUs: 9999999, fileOverrides: [{ range: { startUs: 1000000, endUs: 2000000 } }] });
  assert.equal(h.control(0, 'end-slider').max, '9.999999'); assert.equal(h.control(0, 'end-slider').disabled, false);
  assert.match(h.row(0).textContent, /Latest range end: 9\.999999 s\./);
  // Without main's limit, or with anything but a positive safe integer, the slider stays off; exact fields stay usable.
  for (const rangeLimitUs of [undefined, null, '10000000', -1, 0, 1.5, 2 ** 60, Number.NaN]) {
    const other = await processingHarness({ durationSeconds: 10, rangeLimitUs, fileOverrides: [{ range: { startUs: 1000000, endUs: 2000000 } }] });
    assert.equal(other.control(0, 'end-slider').disabled, true, String(rangeLimitUs));
    assert.equal(other.control(0, 'end').disabled, false);
    assert.match(other.control(0, 'end-slider').title, /exact range limit for this file, so the slider is off/);
    assert.doesNotMatch(other.row(0).textContent, /Latest range end/);
    assert.match(other.row(0).textContent, /Range sliders are off: main has not established the exact range limit for this file\. The exact fields still work\./);
  }
});

test('file range edits use exact integer microseconds, preserve unrelated choices, and surface qualification refusal', async () => {
  const h = await processingHarness({ fileOverrides: [{ resolution: '720' }], refuse: true });
  assert.match(h.control(0, 'summary').textContent, /Full.*720p \(file\).*Copy compatible audio \(app\)/);
  assert.match(h.row(0).textContent, /Duration is not available/);
  h.control(0, 'mode').value = 'range'; await h.control(0, 'mode').emit('change');
  h.control(0, 'start').value = '1.234567'; await h.control(0, 'start').emit('input');
  h.control(0, 'end').value = '2.000001'; await h.control(0, 'end').emit('input');
  assert.equal(h.byId('start-batch').disabled, true); assert.equal(h.byId('operation-unsaved-notice').hidden, false);
  await h.row(0).querySelector('form').emit('submit');
  const sent = h.calls.find(call => call.name === 'updateFileOperations').args[0];
  assert.deepEqual(sent, { planId: 'processing-plan-1', draftId: h.draft.id, revision: 1,
    fileIds: [h.ids[0]], overrides: { range: { startUs: 1234567, endUs: 2000001 } } });
  const file = h.draft.snapshot().files[0];
  assert.equal(file.request.resolution, '720'); assert.equal(file.request.origins.resolution, 'file');
  assert.equal(file.request.audioPolicy, 'precision-aac'); assert.equal(file.request.origins.audioPolicy, 'app');
  assert.match(h.row(0).textContent, /This range\/audio cell is not yet qualified/);
  assert.equal(h.control(0, 'mode').value, 'range'); assert.equal(h.control(0, 'start').value, '1.234567');
  assert.equal(h.byId('quality').value, '25'); assert.equal(h.byId('preset').value, 'slow');
  assert.equal(h.calls.some(call => call.name === 'startBatch'), false);
});

test('profile/preset/quality changes reprepare the same main draft without resetting file ranges', async () => {
  const h = await processingHarness({ withFolders: true, fileOverrides: [{ range: { startUs: 1234567, endUs: 9000000 }, resolution: '720' }] });
  await h.byId('prepare-batch').click();
  const before = h.draft.snapshot();
  h.byId('profile').value = 'h264-cpu'; await h.byId('profile').emit('change');
  h.byId('preset').value = 'medium'; await h.byId('preset').emit('change');
  h.byId('quality').value = '27'; await h.byId('quality').emit('input');
  await h.byId('prepare-batch').click();
  const call = h.calls.find(call => call.name === 'reprepareEncodingSettings');
  assert.deepEqual(call.args, [{ planId: 'processing-plan-3', draftId: before.id, revision: before.revision,
    settings: { profileId: 'h264-cpu', preset: 'medium', quality: 27 } }]);
  assert.equal(h.calls.filter(call => call.name === 'prepareBatch').length, 1);
  assert.equal(h.draft.snapshot().revision, before.revision + 1);
  assert.deepEqual(h.draft.snapshot().files[0].overrides, before.files[0].overrides);
  assert.deepEqual(h.draft.snapshot().files.map(file => file.fileId), h.ids);
  assert.equal(h.control(0, 'start').value, '1.234567');
  assert.equal(h.byId('error-banner').textContent, '');
});

test('folder token changes or terminal drafts create a fresh batch instead of borrowing old authority', async () => {
  for (const trigger of ['choose-input', 'choose-output', 'completed']) {
    const h = await processingHarness({ withFolders: true });
    await h.byId('prepare-batch').click();
    if (trigger === 'completed') h.update(h.snapshot('completed'));
    else await h.byId(trigger).click();
    await h.byId('prepare-batch').click();
    const calls = h.calls.filter(call => call.name === 'prepareBatch');
    assert.equal(calls.length, 2, trigger);
    assert.equal(h.calls.filter(call => call.name === 'reprepareEncodingSettings').length, 0, trigger);
    assert.deepEqual(calls.at(-1).args[0], {
      inputFolderId: trigger === 'choose-input' ? 'new-input-token' : 'input-token',
      outputFolderId: trigger === 'choose-output' ? 'new-output-token' : 'output-token',
      settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }
    });
  }
});

test('Prepare cannot silently discard unsent per-file processing text', async () => {
  const h = await processingHarness({ withFolders: true });
  h.control(0, 'mode').value = 'range'; await h.control(0, 'mode').emit('change');
  h.control(0, 'end').value = '4.125'; await h.control(0, 'end').emit('input');
  await h.byId('prepare-batch').click();
  assert.equal(h.calls.some(call => ['prepareBatch', 'reprepareEncodingSettings'].includes(call.name)), false);
  assert.match(h.byId('error-banner').textContent, /Apply or discard pending processing edits/);
  assert.equal(h.control(0, 'end').value, '4.125');
});

test('encoder autosave revokes processing/start authority without deleting unsent edits and permits explicit discard', async () => {
  const h = await processingHarness({ withFolders: true, invalidateOnSave: true,
    fileOverrides: [{ range: { startUs: 1234567, endUs: 9000000 }, resolution: '720' }] });
  await h.byId('prepare-batch').click();
  const before = h.draft.snapshot();
  h.control(0, 'end').value = '8.125'; await h.control(0, 'end').emit('input');
  h.byId('batch-operation-resolution').value = '1080'; await h.byId('batch-operation-resolution').emit('change');
  h.byId('quality').value = '27'; await h.byId('quality').emit('input');
  await h.byId('quality').emit('change');

  assert.equal(h.draft.snapshot().revision, before.revision);
  assert.equal(h.control(0, 'end').value, '8.125');
  assert.equal(h.byId('batch-operation-resolution').value, '1080');
  assert.equal(h.control(0, 'apply').disabled, true);
  assert.equal(h.control(0, 'selected').disabled, true);
  assert.equal(h.byId('batch-operation-apply').disabled, true);
  assert.equal(h.byId('batch-app-defaults-apply').disabled, true);
  assert.equal(h.byId('start-batch').disabled, true);
  assert.equal(h.control(0, 'discard').disabled, false);
  assert.equal(h.byId('batch-operation-discard').disabled, false);
  assert.equal(h.byId('operation-unsaved-notice').hidden, false);

  // Programmatic submits must be blocked too, not merely disabled buttons.
  await h.row(0).querySelector('form').emit('submit');
  await h.byId('batch-operation-form').emit('submit');
  await h.byId('batch-app-defaults-apply').emit('click');
  assert.equal(h.calls.some(call => ['updateFileOperations', 'updateBatchOperationDefaults', 'applyAppDefaultsToBatch', 'startBatch'].includes(call.name)), false);
  await h.byId('prepare-batch').click();
  assert.match(h.byId('error-banner').textContent, /Apply or discard pending processing edits/);
  assert.equal(h.calls.filter(call => call.name === 'prepareBatch').length, 1);
  assert.equal(h.calls.some(call => call.name === 'reprepareEncodingSettings'), false);
  assert.equal(h.control(0, 'end').value, '8.125');

  await h.control(0, 'discard').click();
  assert.equal(h.control(0, 'end').value, '9');
  assert.equal(h.control(0, 'start').value, '1.234567');
  await h.byId('batch-operation-discard').click();
  assert.equal(h.byId('batch-operation-resolution').value, 'source');
  assert.equal(h.byId('operation-unsaved-notice').hidden, true);
  assert.equal(h.byId('start-batch').disabled, true);
  assert.equal(h.control(0, 'apply').disabled, true);

  await h.byId('prepare-batch').click();
  const request = h.calls.find(call => call.name === 'reprepareEncodingSettings').args[0];
  assert.equal(request.draftId, before.id);
  assert.equal(request.revision, before.revision);
  assert.deepEqual(request.settings, { profileId: 'h265-cpu', preset: 'slow', quality: 27 });
  assert.equal(h.draft.snapshot().revision, before.revision + 1);
  assert.deepEqual(h.draft.snapshot().files[0].overrides, before.files[0].overrides);
  assert.equal(h.byId('batch-operation-fields').disabled, false);
  assert.equal(h.byId('batch-app-defaults-apply').disabled, false);
  assert.equal(h.byId('error-banner').textContent, '');
});

test('folder changes require explicit pending-edit disposal and full invalidation cannot strand new preparation', async () => {
  const h = await processingHarness({ withFolders: true });
  await h.byId('prepare-batch').click();
  h.byId('batch-operation-resolution').value = '1080'; await h.byId('batch-operation-resolution').emit('change');
  assert.equal(h.byId('operation-unsaved-notice').hidden, false);
  await h.byId('choose-input').click();
  assert.match(h.byId('error-banner').textContent, /Apply or discard processing edits/);
  assert.equal(h.calls.some(call => call.name === 'chooseInputFolder'), false);
  assert.equal(h.byId('batch-operation-resolution').value, '1080');
  await h.byId('batch-operation-discard').click();
  await h.byId('choose-input').click();
  // Folder authority changes are a full main invalidation, unlike encoder
  // autosave: there is no current draft to which the unsent batch edit belongs.
  h.update({ ...h.snapshot('idle'), planId: null, operationDraft: null, items: [], encodingSettingsStale: false });
  assert.equal(h.byId('batch-operation-editor').hidden, true);
  assert.equal(h.byId('operation-unsaved-notice').hidden, true);
  assert.equal(h.byId('prepare-batch').disabled, false);
  await h.byId('prepare-batch').click();
  const prepares = h.calls.filter(call => call.name === 'prepareBatch');
  assert.equal(prepares.length, 2);
  assert.equal(prepares.at(-1).args[0].inputFolderId, 'new-input-token');
  assert.equal(h.calls.some(call => call.name === 'reprepareEncodingSettings'), false);
  assert.equal(h.byId('error-banner').textContent, '');
});

test('apply changed fields to selected files preserves each file existing overrides', async () => {
  const h = await processingHarness({ fileOverrides: [{ resolution: '720' }, { resolution: '1080', audioPolicy: 'precision-flac' }] });
  h.control(0, 'mode').value = 'range'; await h.control(0, 'mode').emit('change');
  h.control(0, 'end').value = '3.5'; await h.control(0, 'end').emit('input');
  await h.control(0, 'selected').click();
  const sent = h.calls.find(call => call.name === 'updateFileOperations').args[0];
  assert.deepEqual(sent.fileIds, h.ids); assert.deepEqual(sent.overrides, { range: { endUs: 3500000 } });
  const files = h.draft.snapshot().files;
  assert.deepEqual(files.map(file => file.request.resolution), ['720', '1080']);
  assert.deepEqual(files.map(file => file.request.audioPolicy), ['precision-aac', 'precision-flac']);
  assert.deepEqual(files.map(file => plain(file.request.range)), [{ endUs: 3500000 }, { endUs: 3500000 }]);
});

test('repreparing a draft preserves deliberate queue selection and Full explicitly clears its one range', async () => {
  const h = await processingHarness({ fileOverrides: [{ range: { startUs: 1000000, endUs: 2000000 }, resolution: '720' }] });
  const checkbox = h.row(1).querySelector('[data-testid="encode-file"]'); checkbox.checked = false; await checkbox.emit('change');
  h.control(0, 'mode').value = 'full'; await h.control(0, 'mode').emit('change');
  await h.row(0).querySelector('form').emit('submit');
  assert.deepEqual(h.calls.find(call => call.name === 'updateFileOperations').args[0].overrides, { range: null });
  assert.equal(h.draft.snapshot().files[0].request.resolution, '720');
  assert.equal(h.row(1).querySelector('[data-testid="encode-file"]').checked, false);
  assert.match(h.byId('selected-count').textContent, /^1 selected/);
});

test('invalid precision/range syntax sends no request and leaves visible recoverable edits', async () => {
  const h = await processingHarness();
  h.control(0, 'mode').value = 'range'; await h.control(0, 'mode').emit('change');
  for (const text of ['-1', '1e3', '1.0000001', '9007199254.740992', '1,2']) {
    h.control(0, 'start').value = text; await h.control(0, 'start').emit('input');
    await h.row(0).querySelector('form').emit('submit');
    assert.notEqual(h.control(0, 'notice').textContent, '');
  }
  h.control(0, 'start').value = '2'; h.control(0, 'end').value = '1';
  await h.row(0).querySelector('form').emit('submit'); assert.match(h.control(0, 'notice').textContent, /later than/);
  assert.equal(h.calls.filter(call => call.name === 'updateFileOperations').length, 0);
  await h.control(0, 'discard').click(); assert.equal(h.control(0, 'mode').value, 'full');
  assert.equal(h.byId('operation-unsaved-notice').hidden, true); assert.equal(h.byId('start-batch').disabled, false);
});

test('batch complete-snapshot updates preserve untouched batch overrides without copying inherited values', async () => {
  const h = await processingHarness({ batchOverrides: { hdrPolicy: 'sdr', remuxTarget: 'mov' }, fileOverrides: [{ resolution: '720' }] });
  h.byId('batch-operation-resolution').value = '1080'; await h.byId('batch-operation-resolution').emit('change');
  await h.byId('batch-operation-form').emit('submit');
  assert.deepEqual(h.calls.find(call => call.name === 'updateBatchOperationDefaults').args[0].overrides,
    { hdrPolicy: 'sdr', remuxTarget: 'mov', resolution: '1080' });
  assert.deepEqual(h.draft.snapshot().files.map(file => file.request.resolution), ['720', '1080']);
  assert.equal(h.draft.snapshot().batchDefaults.origins.fullAudioPolicy, 'app');
  assert.match(h.byId('batch-operation-summary').textContent, /1080 \(batch\)/);
});

test('saved app defaults require an explicit keep/reset decision and never alter draft values on settings save alone', async () => {
  const h = await processingHarness({ fileOverrides: [{ range: { endUs: 2000000 }, resolution: '720' }] });
  await h.byId('tab-settings').click();
  h.byId('default-resolution').value = '1440'; await h.byId('default-resolution').emit('change'); await h.byId('app-settings-form').emit('submit');
  assert.equal(h.draft.snapshot().files[1].request.resolution, 'source');
  assert.equal(h.calls.some(call => call.name === 'applyAppDefaultsToBatch'), false);
  await h.byId('tab-encode').click(); await h.byId('batch-app-defaults-apply').click();
  assert.equal(h.calls.find(call => call.name === 'applyAppDefaultsToBatch').args[0].resetFileOverrides, false);
  assert.deepEqual(h.draft.snapshot().files.map(file => file.request.resolution), ['720', '1440']);
  assert.deepEqual(h.draft.snapshot().files[0].request.range, { endUs: 2000000 });
  h.byId('batch-app-defaults-choice').value = 'reset'; await h.byId('batch-app-defaults-apply').click();
  assert.equal(h.calls.filter(call => call.name === 'applyAppDefaultsToBatch').at(-1).args[0].resetFileOverrides, true);
  assert.equal(h.draft.snapshot().files[0].request.range, null);
  assert.deepEqual(h.draft.snapshot().files.map(file => file.request.resolution), ['1440', '1440']);
});

test('frozen jobs disable processing actions while navigation remains available', async () => {
  const h = await processingHarness();
  h.draft.freezeForQueue({ draftId: h.draft.id, revision: h.draft.snapshot().revision, fileIds: h.ids });
  h.update(h.snapshot('running'));
  assert.equal(h.byId('batch-operation-fields').disabled, true);
  assert.equal(h.control(0, 'editor').querySelector('fieldset').disabled, true);
  h.control(0, 'mode').value = 'range'; await h.control(0, 'mode').emit('change'); await h.row(0).querySelector('form').emit('submit');
  await h.byId('batch-app-defaults-apply').click();
  assert.equal(h.calls.some(call => /updateFileOperations|updateBatchOperationDefaults|applyAppDefaultsToBatch/.test(call.name)), false);
  await h.byId('tab-help').click(); assert.equal(h.byId('workspace-help').hidden, false);
});

test('unsubmitted edits in another editor cannot disappear through a separate apply action', async () => {
  const h = await processingHarness();
  h.control(0, 'resolution').value = '720'; await h.control(0, 'resolution').emit('change');
  h.control(1, 'resolution').value = '1080'; await h.control(1, 'resolution').emit('change');
  await h.row(0).querySelector('form').emit('submit');
  assert.equal(h.calls.some(call => call.name === 'updateFileOperations'), false);
  assert.match(h.control(0, 'notice').textContent, /other file or batch editor/);
  assert.equal(h.control(1, 'resolution').value, '1080');
  await h.control(1, 'discard').click(); await h.row(0).querySelector('form').emit('submit');
  assert.equal(h.draft.snapshot().files[0].request.resolution, '720');
  assert.equal(h.draft.snapshot().files[1].request.resolution, 'source');
});

test('failed draft requests retain editable input and show the main refusal without claiming application', async () => {
  const h = await processingHarness({ failUpdate: true });
  h.control(0, 'resolution').value = '720'; await h.control(0, 'resolution').emit('change');
  await h.row(0).querySelector('form').emit('submit');
  assert.match(h.byId('error-banner').textContent, /This draft changed/);
  assert.equal(h.control(0, 'resolution').value, '720');
  assert.equal(h.draft.snapshot().files[0].request.resolution, 'source');
  assert.equal(h.control(0, 'apply').disabled, false);
  assert.equal(h.byId('start-batch').disabled, true);
  assert.doesNotMatch(h.control(0, 'notice').textContent, /applied/);
});

test('audio policy changes clear incompatible AAC bitrate explicitly and preserve other file fields', async () => {
  const h = await processingHarness({ fileOverrides: [{ audioPolicy: 'precision-aac', aacBitrateKbps: 320, resolution: '720' }] });
  h.control(0, 'audioPolicy').value = 'copy'; await h.control(0, 'audioPolicy').emit('change');
  await h.row(0).querySelector('form').emit('submit');
  assert.deepEqual(h.calls.find(call => call.name === 'updateFileOperations').args[0].overrides, { audioPolicy: 'copy', aacBitrateKbps: null });
  assert.equal(h.draft.snapshot().files[0].request.resolution, '720');
  assert.equal(h.draft.snapshot().files[0].request.aacBitrateKbps, null);
});


test('Remux navigation retains Encode requests, pending edits and authority without preparing an operation', async () => {
  const h = await processingHarness({ withFolders: true, fileOverrides: [{ resolution: '720' }] });
  h.control(0, 'mode').value = 'range'; await h.control(0, 'mode').emit('change');
  h.control(0, 'start').value = '0.125001';
  const before = JSON.stringify(h.draft.snapshot());
  const calls = h.calls.length;
  await h.byId('tab-remux').click();
  assert.equal(h.byId('workspace-remux').hidden, false);
  assert.equal(h.byId('location-panel').hidden, false);
  assert.match(h.byId('workspace-remux').textContent, /Full/);
  assert.match(h.byId('workspace-remux').textContent, /unavailable|qualification/i);
  assert.equal(h.byId('profile').value, 'h265-cpu');
  await h.byId('tab-encode').click();
  assert.equal(JSON.stringify(h.draft.snapshot()), before);
  assert.equal(h.control(0, 'mode').value, 'range');
  assert.equal(h.control(0, 'start').value, '0.125001');
  assert.equal(h.calls.slice(calls).some(call => !['getAppSettings'].includes(call.name)), false, 'operation switching calls no authority-changing API');
  assert.equal(h.byId('start-batch').disabled, true, 'unsubmitted edits still block Start');
});

test('Slice1 file inspection is independent of selection and preserves the real editor node and unsaved values', async () => {
  const h = await processingHarness({ withFolders: true });
  const row = h.byId('batch-items').children[0];
  const originalEditor = row.querySelector('[data-testid="file-operation-editor"]');
  h.control(0, 'resolution').value = '720'; await h.control(0, 'resolution').emit('change');
  await h.byId('clear-selection').click();
  const callCount = h.calls.length;
  await row.querySelector('[data-testid="inspect-file"]').click();
  assert.match(h.byId('focused-file-name').textContent, /Source 1/);
  assert.match(h.byId('focused-file-state').textContent, /Not selected/);
  assert.equal(h.byId('focused-file-details-slot').contains(originalEditor), true);
  assert.equal(originalEditor.querySelector('[data-testid="file-operation-resolution"]').value, '720');
  assert.match(h.byId('selected-count').textContent, /^0 selected/);
  assert.equal(h.calls.length, callCount, 'Inspect invokes no permission or preparation API');
  await h.byId('focused-file-clear').click();
  assert.equal(row.contains(originalEditor), true);
  assert.equal(h.document.activeElement, row.querySelector('[data-testid="inspect-file"]'));
  assert.equal(h.byId('start-batch').disabled, true);
});

test('Slice1 hidden-selected review lists exact selected files without selecting filtered or focused items', async () => {
  const h = await processingHarness();
  h.byId('batch-filter').value = 'generated'; await h.byId('batch-filter').emit('change');
  assert.match(h.byId('hidden-selected-count').textContent, /2 selected hidden/);
  const before = h.calls.length;
  await h.byId('review-selected').click();
  assert.equal(h.byId('selected-review').open, true);
  const list = h.byId('selected-review-list');
  assert.match(list.textContent, /Source 1.*Hidden/);
  assert.match(list.textContent, /Source 2.*Hidden/);
  assert.equal(list.children.length, 2);
  await list.querySelector('button').click();
  assert.match(h.byId('focused-file-name').textContent, /Source 1/);
  assert.match(h.byId('selected-count').textContent, /^2 selected/);
  assert.equal(h.calls.length, before);
  const firstNode = list.children[0];
  h.update(h.snapshot());
  assert.equal(h.byId('selected-review-list').children[0], firstNode, 'unrelated snapshot preserves review nodes');
});

test('Slice1 Files drawer Escape restores its trigger without changing processing or selected membership', async () => {
  const h = await processingHarness();
  const before = JSON.stringify(h.draft.snapshot()); const calls = h.calls.length;
  await h.byId('files-toggle').click();
  assert.equal(h.byId('files-toggle').getAttribute('aria-expanded'), 'true');
  await h.byId('workspace-encode').emit('keydown', { key: 'Escape' });
  assert.equal(h.byId('files-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(h.document.activeElement, h.byId('files-toggle'));
  assert.equal(JSON.stringify(h.draft.snapshot()), before);
  assert.equal(h.calls.length, calls);
  assert.match(h.byId('selected-count').textContent, /^2 selected/);
});


test('focused legacy classification actions lock outside the table on dirty and busy transitions', async () => {
  const h = await processingHarness();
  const ready = h.snapshot(); ready.items[0].status = 'ambiguous';
  ready.items[0].origin = { kind: 'legacy-ambiguous' }; h.update(ready);
  await h.row(0).querySelector('[data-testid="inspect-file"]').click();
  const action = h.byId('focused-file-details-slot').querySelector('[data-testid="treat-as-original"]');
  assert.equal(action.hidden, false); assert.equal(action.disabled, false);
  h.byId('quality').value = '26'; await h.byId('quality').emit('input');
  assert.equal(action.disabled, true, 'dirty encoder settings revoke the focused action');
  h.update({ ...h.snapshot('running'), progress: { stage: 'output-validation' } });
  assert.equal(action.disabled, true);
  assert.equal(h.calls.some(call => call.name === 'treatAsOriginal'), false);
});

test('moving a focused inspector into Current Jobs gives visible navigation focus without auto-switch or draft mutation', async () => {
  const h = await processingHarness();
  await h.row(0).querySelector('[data-testid="inspect-file"]').click();
  const heading = h.byId('focused-file-name'); heading.focus();
  h.update({ ...h.snapshot('preparing'), progress: { stage: 'metadata' } });
  assert.equal(h.byId('file-inspector').parentElement, h.byId('jobs-batch-slot'));
  assert.equal(h.document.activeElement, h.byId('tab-jobs'));
  assert.equal(h.byId('workspace-encode').hidden, false, 'move does not auto-navigate');
});


test('narrow drawer and breakpoint changes disclose hidden selections without changing queue membership', async () => {
  const h = await processingHarness({ narrow: true });
  const calls = h.calls.length;
  assert.match(h.byId('hidden-selected-count').textContent, /2 selected hidden/);
  assert.match(h.byId('selected-review-list').textContent, /Hidden in file-list view/);
  await h.byId('files-toggle').click();
  assert.match(h.byId('hidden-selected-count').textContent, /0 selected hidden/);
  await h.row(0).querySelector('[data-testid="inspect-file"]').click();
  assert.equal(h.byId('files-toggle').getAttribute('aria-expanded'), 'false');
  assert.match(h.byId('hidden-selected-count').textContent, /2 selected hidden/);
  h.setNarrow(false);
  assert.match(h.byId('hidden-selected-count').textContent, /0 selected hidden/);
  assert.doesNotMatch(h.byId('selected-review-list').textContent, /Hidden in file-list view/);
  h.setNarrow(true);
  assert.match(h.byId('hidden-selected-count').textContent, /2 selected hidden/);
  assert.match(h.byId('selected-count').textContent, /^2 selected/);
  assert.equal(h.calls.length, calls);
});

test('selected-review disclosure reports expansion for its button and native summary toggles', async () => {
  const h = await processingHarness();
  await h.byId('review-selected').click();
  assert.equal(h.byId('review-selected').getAttribute('aria-expanded'), 'true');
  h.byId('selected-review').open = false; await h.byId('selected-review').emit('toggle');
  assert.equal(h.byId('review-selected').getAttribute('aria-expanded'), 'false');
  h.byId('selected-review').open = true; await h.byId('selected-review').emit('toggle');
  assert.equal(h.byId('review-selected').getAttribute('aria-expanded'), 'true');
});

test('Remux saved-target summary follows App Settings load/save without altering a prepared draft', async () => {
  const h = await processingHarness();
  const draft = JSON.stringify(h.draft.snapshot());
  await h.byId('tab-settings').click();
  assert.match(h.byId('remux-target-summary').textContent, /Selected: matroska.*Saved preference: matroska/);
  h.byId('default-remux-target').value = 'mp4'; await h.byId('default-remux-target').emit('change');
  await h.byId('app-settings-form').emit('submit');
  await h.byId('tab-remux').click();
  assert.match(h.byId('remux-target-summary').textContent, /Selected: mp4.*Saved preference: mp4/);
  assert.equal(JSON.stringify(h.draft.snapshot()), draft);
  assert.equal(h.calls.some(call => ['prepareBatch', 'updateFileOperations', 'updateBatchOperationDefaults', 'startBatch'].includes(call.name)), false);
});

async function remuxHarness({ unavailableEncoder = false, generated = false, narrow = false, onOmission } = {}) {
  let revision = 1, draftRevision = 0, planId = 'remux-plan-1', draftId = 'remux-draft-1', target = 'matroska';
  let phase = 'ready', decisions = ['decision-other'], sourceAuthorized = false;
  const snapshot = (changes = {}) => ({ revision: ++revision, phase, operation: 'remux', batchId: 'remux-batch', planId,
    counts: {}, settings: null, remuxSupport: { notice: 'Exact family qualification only; other inputs remain refused.', targets: ['matroska'] },
    operationDraft: { id: draftId, revision: draftRevision, operation: 'remux', frozen: phase === 'running',
      batchDefaults: { values: { remuxTarget: target } }, files: ['remux-a', 'remux-b'].map(fileId => ({ fileId,
        request: { operation: 'remux', target, range: null, resolution: 'source', audioPolicy: 'copy' } })) },
    items: ['remux-a', 'remux-b'].map((id, index) => {
      const decisionId = index ? 'decision-other' : 'decision-a';
      const omitted = decisions.includes(decisionId);
      return { id, name: `Remux ${index + 1}.mkv`, outputName: `Remux ${index + 1}_Remux.mkv`,
        status: phase === 'running' ? index ? 'running' : 'unprocessed' : index ? generated && !sourceAuthorized ? 'generated' : 'ready' : 'unsupported',
        reason: index ? '' : 'Unknown relationships remain blocked.', origin: { kind: generated && index ? 'generated' : 'original' }, reencodeAuthorized: sourceAuthorized && index === 1,
        remux: { target, status: index ? 'qualified' : 'blocked', notice: 'Only main can qualify this file.',
          streams: [{ streamIndex: index + 5, codecType: 'subtitle', codecName: 'example', action: omitted ? 'explicitly-omitted' : index ? 'preserve-copy' : 'blocked',
            label: `<stream ${index + 5}>`, reasons: ['Representation needs review.'], representations: ['Declared equivalent representation.'] }],
          blockers: index ? [] : [{ code: 'RELATIONSHIPS_UNKNOWN', message: 'Unknown relationships remain blocked.', streamIndex: null }],
          omissionCandidates: [{ id: decisionId, streamIndex: index + 5, label: `<stream ${index + 5}>`, reasons: ['Exact unsupported stream.'], target }],
          omissionDecisionIds: omitted ? [decisionId] : [] } };
    }), ...changes });
  const h = await harness({
    getCapabilities: async () => ({ profiles: unavailableEncoder ? [] : [profile], recipes: [], versions: {} }),
    getPreferences: async () => ({ settingsByProfile: {}, inputFolder: { id: 'input-token', path: 'D:\\owned-input' }, outputFolder: { id: 'output-token', path: 'D:\\owned-output' }, notices: [] }),
    saveSettings: async () => ({ notices: [] }),
    prepareRemuxBatch: async request => { target = request.target; planId = `remux-plan-${revision}`; draftId = `remux-draft-${revision}`; draftRevision = 0; decisions = []; return snapshot(); },
    setRemuxOmissions: async request => {
      decisions = [...request.decisionIds]; draftRevision++; planId = `remux-plan-${revision}`;
      const changes = await onOmission?.({ request, snapshot, update: changes => h.update(snapshot(changes)) });
      return snapshot(changes);
    },
    reencodeOutputs: async () => { sourceAuthorized = true; return snapshot(); },
    startBatch: async () => { phase = 'running'; return snapshot({ progress: { stage: 'encoding', fileId: 'remux-b', seconds: 1, percent: 12 } }); },
    getEncodingDetails: async () => ({ kind: 'resolved-argument-template', args: ['-c', 'copy', '<owned-stage>'], executable: 'D:\\owned\\ffmpeg.exe', destination: 'D:\\owned-output\\result.mkv', notice: 'Canonical main plan.', outputPlaceholder: '<owned-stage>' }),
  }, { narrow });
  const initial = snapshot(); h.update(initial);
  return { ...h, initial, snapshot };
}

test('Encode timecode loss uses named exact-set IPC, clear functional warning and focus restoration', async () => {
  const { OperationDraft } = require('../src/operation-draft.cjs');
  const ids = ['11345678-1234-4234-8234-123456789abc', '22345678-1234-4234-8234-123456789abc'];
  const draft = new OperationDraft({ operation: 'encode', appDefaults: defaults().defaults, appDefaultsRevision: 4 });
  draft.addSources(ids.map(fileId => ({ fileId, identityRevision: 0 })));
  let decisions = ['decision-other'], revision = 1, planId = 'encode-preservation-plan-1';
  const snapshot = (phase = 'ready') => ({ revision: ++revision, phase, operation: 'encode', batchId: 'preservation-batch', planId,
    settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 }, operationDraft: draft.snapshot(), counts: {},
    items: ids.map((id, index) => { const decisionId = index ? 'decision-other' : 'decision-a', chosen = decisions.includes(decisionId);
      return { id, name: `Source ${index}.mov`, outputName: `Source ${index}_H265-CPU.mkv`, status: chosen ? 'ready' : 'unsupported',
        reason: chosen ? '' : 'Explicitly review this timed track and its link.', operationRequest: draft.fileRequest(id),
        encodePreservation: { target: 'matroska', status: chosen ? 'qualified' : 'blocked', notice: 'Full source; no settings change.',
          streams: [{ streamIndex: 0, action: 'encode-video', label: 'Video' }, { streamIndex: 1, action: 'preserve-copy', label: 'Audio' },
            { streamIndex: 2, action: chosen ? 'explicitly-omitted' : 'blocked', label: '<timed tmcd track>', reasons: ['Timed track and linked editing/synchronization relationship are lost. Starting text is not equivalent.'] }],
          omissionCandidates: [{ id: decisionId, streamIndex: 2, label: '<timed tmcd track> and link', target: 'matroska', reasons: ['Functional timing relationship loss; original preserved.'] }],
          omissionDecisionIds: chosen ? [decisionId] : [] } }; }) });
  const h = await harness({
    setEncodePreservationDecisions: async request => { request = plain(request);
      assert.deepEqual(Object.keys(request).sort(), ['decisionIds', 'draftId', 'planId', 'revision']);
      assert.equal(request.planId, planId); decisions = request.decisionIds;
      draft.invalidatePreparedChoices({ draftId: request.draftId, revision: request.revision });
      planId = `encode-preservation-plan-${revision}`; h.update(snapshot('preparing')); return snapshot(); },
    getEncodingDetails: async () => ({ kind: 'resolved-argument-template', args: [], notice: 'Main-selected mapping.' }),
  });
  h.update(snapshot());
  await h.byId('batch-items').children[0].querySelector('[data-testid="inspect-file"]').click();
  const slot = h.byId('focused-file-details-slot'), details = slot.querySelector('[data-testid="remux-preservation"]');
  assert.equal(details.hidden, false); assert.match(details.textContent, /Encode video.*Preserve by stream copy.*editing\/synchronization.*not equivalent/);
  let button = details.querySelector('[data-testid="encode-preservation-decision"]');
  assert.match(button.textContent, /Omit this timed track and link/); button.focus(); await button.click();
  assert.deepEqual(h.calls.find(call => call.name === 'setEncodePreservationDecisions').args[0].decisionIds, ['decision-other', 'decision-a']);
  assert.equal(h.calls.some(call => call.name === 'setRemuxOmissions'), false);
  button = slot.querySelector('[data-testid="encode-preservation-decision"]');
  assert.match(button.textContent, /Require preservation/); assert.equal(h.document.activeElement, button);
  await button.click();
  assert.deepEqual(h.calls.filter(call => call.name === 'setEncodePreservationDecisions').at(-1).args[0].decisionIds, ['decision-other']);
  h.update(snapshot('running')); assert.equal(slot.querySelector('[data-testid="encode-preservation-decision"]')?.disabled ?? true, true);
});

test('Remux preparation uses only folder capabilities and Full target while all encoders are unavailable', async () => {
  const h = await remuxHarness({ unavailableEncoder: true });
  await h.byId('tab-remux').click();
  assert.equal(h.byId('prepare-batch').disabled, true);
  assert.equal(h.byId('prepare-remux').disabled, false);
  assert.equal(h.byId('choose-input').disabled, false); assert.equal(h.byId('choose-output').disabled, false);
  h.byId('remux-target').value = 'mov'; await h.byId('remux-target').emit('change');
  await h.byId('prepare-remux').click();
  assert.deepEqual(h.calls.find(call => call.name === 'prepareRemuxBatch').args,
    [{ inputFolderId: 'input-token', outputFolderId: 'output-token', target: 'mov' }]);
  assert.equal(h.calls.some(call => ['prepareBatch', 'reprepareEncodingSettings'].includes(call.name)), false);
  assert.equal(h.byId('batch-panel').parentElement, h.byId('remux-batch-slot'));
  assert.match(h.byId('effective-settings').textContent, /Full stream copy.*mov.*No transcoding/);
  assert.match(h.byId('remux-support-notice').textContent, /Exact family qualification only/);
});

test('Remux target changes disable old Start and omission authority until new preparation or exact restoration', async () => {
  const h = await remuxHarness();
  assert.equal(h.byId('start-batch').disabled, false);
  const calls = h.calls.length;
  h.byId('remux-target').value = 'mp4'; await h.byId('remux-target').emit('change');
  assert.equal(h.byId('start-batch').disabled, true);
  assert.equal(h.byId('remux-target-notice').hidden, false);
  assert.equal(h.byId('batch-items').children[0].querySelector('[data-testid="remux-omission"]').disabled, true);
  h.update(h.snapshot());
  assert.equal(h.byId('remux-target').value, 'mp4', 'unrelated snapshots retain the unprepared target choice');
  assert.equal(h.byId('start-batch').disabled, true);
  h.byId('remux-target').value = 'matroska'; await h.byId('remux-target').emit('change');
  assert.equal(h.byId('start-batch').disabled, false);
  assert.equal(h.byId('remux-target-notice').hidden, true);
  assert.equal(h.calls.length, calls, 'target editing does not call preparation or grant APIs');
});

test('Remux omission actions submit the exact main-issued decision set and retain unrelated file decisions', async () => {
  const h = await remuxHarness();
  const row = h.byId('batch-items').children[0];
  await row.querySelector('[data-testid="inspect-file"]').click();
  const details = h.byId('focused-file-details-slot').querySelector('[data-testid="remux-preservation"]');
  assert.equal(details.hidden, false);
  assert.match(details.textContent, /<stream 5>.*Blocked.*Unknown relationships remain blocked/);
  const button = details.querySelector('[data-testid="remux-omission"]');
  assert.match(button.getAttribute('aria-label'), /<stream 5> for matroska/);
  await button.click();
  assert.deepEqual(h.calls.find(call => call.name === 'setRemuxOmissions').args,
    [{ planId: 'remux-plan-1', draftId: 'remux-draft-1', revision: 0, decisionIds: ['decision-other', 'decision-a'] }]);
  assert.equal(row.querySelector('[data-testid="encode-file"]').disabled, true, 'unresolved blockers cannot become selectable');
  assert.match(details.textContent, /Explicitly omitted.*Unknown relationships remain blocked/);
  await details.querySelector('[data-testid="remux-omission"]').click();
  const requests = h.calls.filter(call => call.name === 'setRemuxOmissions');
  assert.deepEqual(requests[1].args[0].decisionIds, ['decision-other']);
  assert.deepEqual(Object.keys(requests[1].args[0]).sort(), ['decisionIds', 'draftId', 'planId', 'revision']);
});

test('DOM focus fixture clears removed descendants and refuses detached or disabled focus', () => {
  const h = dom(), container = h.document.createElement('div'), button = h.document.createElement('button');
  h.document.body.append(container); container.append(button); button.focus();
  assert.equal(h.document.activeElement, button);
  container.replaceChildren();
  assert.equal(h.document.activeElement, h.document.body);
  button.focus();
  assert.equal(h.document.activeElement, h.document.body);
  container.append(button); button.disabled = true; button.focus();
  assert.equal(h.document.activeElement, h.document.body);
});

for (const changedDecision of [false, true]) {
  test(`Remux decision reprepare restores ${changedDecision ? 'the same file heading when its decision changes' : 'the exact replacement control'} after inspector movement`, async () => {
    let finish;
    const response = new Promise(resolve => { finish = resolve; });
    const h = await remuxHarness({ onOmission: async ({ update, snapshot }) => {
      update({ phase: 'preparing' });
      await response;
      return changedDecision ? { items: snapshot().items.map(item => item.id === 'remux-a'
        ? { ...item, remux: { ...item.remux, omissionCandidates: [{ ...item.remux.omissionCandidates[0], id: 'replacement-authority' }] } } : item) } : {};
    } });
    await h.byId('tab-remux').click();
    const row = h.byId('batch-items').children[0], selectedRow = h.byId('batch-items').children[1];
    await row.querySelector('[data-testid="inspect-file"]').click();
    const details = h.byId('focused-file-details-slot').querySelector('[data-testid="remux-preservation"]'); details.open = true;
    const original = details.querySelector('[data-testid="remux-omission"]'); original.focus();
    const pending = original.click(); await settle();
    assert.equal(h.byId('file-inspector').parentElement, h.byId('jobs-batch-slot'));
    assert.equal(h.document.activeElement, h.byId('tab-jobs'));
    assert.equal(h.byId('workspace-remux').hidden, false);
    assert.equal(h.document.contains(original), false, 'the preparing snapshot actually removed the activated control');
    finish(); await pending;
    const replacement = details.querySelector('[data-testid="remux-omission"]');
    assert.notEqual(replacement, original);
    assert.equal(h.document.activeElement, changedDecision ? h.byId('focused-file-name') : replacement);
    assert.equal(replacement.disabled, false, 'focus is restored after the final command render enables controls');
    assert.match(h.byId('focused-file-name').textContent, /Remux 1/);
    assert.equal(details.open, true);
    assert.equal(h.byId('file-inspector').parentElement, h.byId('remux-batch-slot'));
    assert.equal(row.querySelector('[data-testid="encode-file"]').checked, false);
    assert.equal(selectedRow.querySelector('[data-testid="encode-file"]').checked, true);
    assert.deepEqual(h.calls.filter(call => call.name === 'setRemuxOmissions').map(call => call.args[0].decisionIds), [['decision-other', 'decision-a']]);
    assert.equal(h.calls.some(call => ['reencodeOutputs', 'prepareRemuxBatch', 'prepareBatch', 'startBatch'].includes(call.name)), false);
  });
}

test('a pending Remux decision never takes focus back from a deliberate workspace change', async () => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const h = await remuxHarness({ onOmission: async ({ update }) => { update({ phase: 'preparing' }); await response; } });
  await h.byId('tab-remux').click();
  await h.byId('batch-items').children[0].querySelector('[data-testid="inspect-file"]').click();
  const button = h.byId('focused-file-details-slot').querySelector('[data-testid="remux-omission"]'); button.focus();
  const pending = button.click(); await settle();
  await h.byId('tab-help').click();
  const deliberateFocus = h.document.activeElement;
  finish(); await pending;
  assert.equal(h.byId('workspace-help').hidden, false);
  assert.equal(h.document.activeElement, deliberateFocus);
  assert.equal(h.calls.filter(call => call.name === 'setRemuxOmissions').length, 1);
});

for (const returnToJobs of [false, true]) {
  test(`pending Remux decision preserves manual tab focus ${returnToJobs ? 'back on Jobs' : 'on Remux'} without tab activation`, async () => {
    let finish;
    const response = new Promise(resolve => { finish = resolve; });
    const h = await remuxHarness({ onOmission: async ({ update }) => { update({ phase: 'preparing' }); await response; } });
    await h.byId('tab-remux').click();
    await h.byId('batch-items').children[0].querySelector('[data-testid="inspect-file"]').click();
    const button = h.byId('focused-file-details-slot').querySelector('[data-testid="remux-omission"]'); button.focus();
    const pending = button.click(); await settle();
    assert.equal(h.document.activeElement, h.byId('tab-jobs'));
    await h.byId('tab-jobs').emit('keydown', { key: 'ArrowLeft' });
    if (returnToJobs) await h.byId('tab-remux').emit('keydown', { key: 'ArrowRight' });
    const deliberateFocus = h.document.activeElement;
    assert.equal(deliberateFocus, h.byId(returnToJobs ? 'tab-jobs' : 'tab-remux'));
    finish(); await pending;
    assert.equal(h.document.activeElement, deliberateFocus);
    assert.equal(h.byId('workspace-remux').hidden, false, 'manual tab focus never activated another workspace');
    assert.equal(h.calls.filter(call => call.name === 'setRemuxOmissions').length, 1);
  });
}

test('Remux uses generated-source authorization with copy wording and shares the actual Jobs and argument view', async () => {
  const h = await remuxHarness({ generated: true });
  await h.byId('tab-remux').click();
  const row = h.byId('batch-items').children[1];
  assert.match(row.querySelector('[data-testid="reencode-output"]').textContent, /Use this generated output as a Remux source/);
  assert.doesNotMatch(h.byId('reencode-warning').textContent, /additional quality loss/);
  assert.match(h.byId('location-source-permission').textContent, /permission as sources for this Remux batch/);
  assert.match(h.byId('generated-source-permission').textContent, /Remux source permission applies only to unchanged files in this preparation/);
  assert.doesNotMatch(h.byId('reencode-toolbar').textContent, /re-encoding/i);
  await h.byId('tab-encode').click();
  assert.match(h.byId('location-source-permission').textContent, /re-encoding permission/);
  await h.byId('tab-remux').click();
  await row.querySelector('[data-testid="reencode-output"]').click();
  assert.deepEqual(h.calls.find(call => call.name === 'reencodeOutputs').args, [{ planId: 'remux-plan-1', fileIds: ['remux-b'] }]);
  assert.match(row.querySelector('[data-testid="origin-label"]').textContent, /Remux source authorized/);
  const command = row.querySelector('[data-testid="encoding-details"]'); command.open = true; await command.emit('toggle');
  assert.deepEqual(h.calls.find(call => call.name === 'getEncodingDetails').args, [{ planId: 'remux-plan-1', fileId: 'remux-b' }]);
  assert.match(row.querySelector('[data-testid="resolved-args"]').textContent, /"copy"/);
  await h.byId('start-batch').click();
  assert.deepEqual(h.calls.find(call => call.name === 'startBatch').args, [{ planId: 'remux-plan-1', fileIds: ['remux-b'] }]);
  assert.equal(h.byId('workspace-jobs').hidden, false);
  assert.equal(h.byId('batch-items').children[1], row);
  assert.equal(h.byId('batch-panel').parentElement, h.byId('jobs-batch-slot'));
  assert.match(h.byId('phase-badge').textContent, /Remuxing/);
  assert.match(h.byId('progress-label').textContent, /Remux progress/);
  assert.equal(h.byId('cancel-batch').disabled, false);
});

test('Remux narrow drawer and Encode-only settings retain source selection without changing operation authority', async () => {
  const h = await remuxHarness({ narrow: true });
  await h.byId('tab-remux').click();
  const row = h.byId('batch-items').children[1];
  assert.match(h.byId('hidden-selected-count').textContent, /1 selected hidden/);
  await h.byId('remux-files-toggle').click();
  assert.equal(h.byId('remux-files-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(h.byId('workspace-remux').className.includes('files-drawer-open'), true);
  assert.match(h.byId('hidden-selected-count').textContent, /1 selected hidden/, 'attention filter still hides the selected qualified file');
  await h.byId('workspace-remux').emit('keydown', { key: 'Escape' });
  assert.equal(h.document.activeElement, h.byId('remux-files-toggle'));
  assert.match(h.byId('hidden-selected-count').textContent, /1 selected hidden/);
  await h.byId('tab-encode').click();
  h.byId('preset').value = 'medium'; await h.byId('preset').emit('change');
  assert.equal(h.byId('start-batch').disabled, false);
  assert.equal(row.querySelector('[data-testid="encode-file"]').checked, true);
  assert.equal(h.byId('batch-panel').parentElement, h.byId('remux-batch-slot'));
  assert.equal(h.calls.some(call => ['prepareRemuxBatch', 'prepareBatch', 'setRemuxOmissions', 'startBatch'].includes(call.name)), false);
});
