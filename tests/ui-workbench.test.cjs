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
    replaceChildren(...children) { for (const child of this.children) child.parentElement = null; this.children = []; this.append(...children); }
    remove() { if (this.parentElement) { const siblings = this.parentElement.children; siblings.splice(siblings.indexOf(this), 1); this.parentElement = null; } }
    addEventListener(name, listener) { if (!this.events.has(name)) this.events.set(name, []); this.events.get(name).push(listener); }
    async emit(name, values = {}) { const event = { target: this, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...values }; for (const listener of this.events.get(name) || []) await listener(event); await settle(); return event; }
    async click() { if (!this.disabled) return this.emit('click'); }
    focus() { document.activeElement = this; }
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
  return { document, byId: id => ids.get(id) };
}

const defaults = () => ({ schema: 1, revision: 4, defaults: { fullAudioPolicy: 'copy', rangeAudioPolicy: 'precision-aac', resolution: 'source', hdrPolicy: 'preserve', remuxTarget: 'matroska', previewExpanded: false }, persistence: { state: 'ready', persisted: true, resetRequired: false }, notices: [] });
const profile = { id: 'h265-cpu', label: 'H.265 CPU', available: true, presets: ['slow', 'medium'], defaultPreset: 'slow', quality: { mode: 'CRF', min: 0, max: 51, default: 25 }, suffix: 'H265-CPU', supportedBitDepths: [8, 10] };

async function harness(overrides = {}) {
  const view = dom();
  const calls = [];
  let update;
  const initial = { revision: 1, phase: 'idle', items: [], counts: {}, progress: null };
  const methods = {
    getSnapshot: async () => initial,
    getCapabilities: async () => ({ profiles: [profile], recipes: [], versions: {} }),
    getPreferences: async () => ({ settingsByProfile: {}, inputFolder: null, outputFolder: null, profileId: 'h265-cpu', notices: [] }),
    getAppSettings: async () => defaults(),
    saveAppSettings: async request => ({ ...defaults(), revision: request.revision + 1, defaults: request.defaults }),
    resetAppSettings: async request => ({ ...defaults(), revision: request.revision + 1 }),
    getRuntimeInformation: async () => ({ appVersion: '0.7.0-alpha.1', electron: null, chromium: null, node: 'test-node', platform: 'win32', architecture: 'x64', media: { ffmpeg: { status: 'not-yet-observed', version: null, executable: 'D:\\owned\\ffmpeg.exe' }, ffprobe: { status: 'observed', version: '9.0.1', executable: 'D:\\owned\\ffprobe.exe' } } }),
    getDiagnosticHistory: async () => ({ events: [], nextCursor: null, status: { available: true } }),
    cancelBatch: async () => ({ revision: 99, phase: 'cancelled', items: [], counts: {} }),
    ...overrides,
  };
  const api = { onUpdate: callback => { update = callback; return () => {}; } };
  for (const [name, method] of Object.entries(methods)) api[name] = async (...args) => { calls.push({ name, args: plain(args) }); return method(...args); };
  const window = { encoder: api, addEventListener() {} };
  vm.runInNewContext(renderer, { window, document: view.document, performance: { now: () => 100 }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {} }, { filename: 'ui/renderer.js' });
  await settle();
  assert.equal(view.byId('error-banner').textContent, '');
  return { ...view, calls, update: value => update(value) };
}

test('workbench has unique IDs, matched tab/panel semantics, and no invented Remux API', () => {
  const allIds = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(allIds).size, allIds.length);
  const view = dom();
  for (const name of ['encode', 'jobs', 'history', 'settings', 'help']) {
    assert.equal(view.byId(`tab-${name}`).getAttribute('role'), 'tab');
    assert.equal(view.byId(`tab-${name}`).getAttribute('aria-controls'), `workspace-${name}`);
    assert.equal(view.byId(`workspace-${name}`).getAttribute('aria-labelledby'), `tab-${name}`);
    assert.equal(view.byId(`workspace-${name}`).hidden, name !== 'encode');
  }
  assert.doesNotMatch(renderer, /innerHTML|insertAdjacentHTML|eval\(|api\.\w*[Rr]emux/);
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

async function processingHarness({ fileOverrides = [], batchOverrides = {}, refuse = false, failUpdate = false, withFolders = false, invalidateOnSave = false } = {}) {
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
    items: ids.map((id, index) => ({ id, name: `Source ${index + 1}.mkv`, outputName: `Source ${index + 1}_H265-CPU.mkv`, summary: {},
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
  h.update(snapshot());
  return { ...h, draft, ids, snapshot, row: index => h.byId('batch-items').children[index],
    control: (index, name) => h.byId('batch-items').children[index].querySelector(`[data-testid="file-operation-${name}"]`) };
}

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
