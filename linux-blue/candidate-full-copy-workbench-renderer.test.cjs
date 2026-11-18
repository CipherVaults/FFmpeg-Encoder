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


const { OperationDraft } = require('../src/operation-draft.cjs');
const info = { enabled: true, relaunchRequired: false, notice: 'Experimental whole-file 1080p30 to 720p copied AAC only; CPU topology warnings; native threading unqualified.', relaunchNotice: 'Close and relaunch; same-session retry unavailable.' };
test('candidate inspection-only rows remain editable but cannot be selected or started; Full uses existing IPC', async () => {
  const draft = new OperationDraft({ operation: 'encode', appDefaults: defaults().defaults, appDefaultsRevision: 4 });
  draft.addSources([{ fileId: '11345678-1234-4234-8234-123456789abc', identityRevision: 0 }]); let revision = 10;
  const snapshot = status => ({ revision: ++revision, phase: 'ready', batchId: 'batch', planId: 'plan', settings: { profileId: 'h265-cpu', preset: 'slow', quality: 25 },
    developerFullCopy: info, operationDraft: draft.snapshot(), counts: {}, items: [{ id: '11345678-1234-4234-8234-123456789abc', name: 'source.mov', outputName: 'output.mkv', status, summary: { durationSeconds: 8 }, reason: status === 'unsupported' ? 'Inspection only: choose Full720Copy.' : '' }] });
  const h = await harness({ updateFileOperations: async request => {
    request = plain(request); assert.equal(request.planId, 'plan'); const { planId, ...change } = request; draft.patchFiles(change); return snapshot('ready');
  } });
  h.update(snapshot('unsupported'));
  const row = h.byId('batch-items').children[0], control = name => row.querySelector(`[data-testid="file-operation-${name}"]`);
  assert.equal(row.querySelector('[data-testid="encode-file"]').disabled, true); assert.equal(h.byId('start-batch').disabled, true);
  assert.equal(control('mode').disabled, false);
  control('mode').value = 'full'; await control('mode').emit('change');
  control('resolution').value = '720'; await control('resolution').emit('change');
  control('audioPolicy').value = 'copy'; await control('audioPolicy').emit('change');
  await row.querySelector('form').emit('submit');
  const sent = h.calls.find(c => c.name === 'updateFileOperations'); assert.ok(sent);
  assert.equal(sent.args[0].overrides.range, null); assert.equal(sent.args[0].overrides.audioPolicy, 'copy'); assert.equal(sent.args[0].overrides.resolution, '720');
  assert.equal(h.byId('prepare-remux').disabled, true); assert.match(h.byId('activity-message').textContent, /native threading unqualified/);
});
test('candidate cancellation stays visibly closed across newer late callbacks and stale snapshots', async () => {
  const h = await harness();
  h.update({ revision: 10, phase: 'cancelled', items: [], counts: {}, developerFullCopy: { ...info, relaunchRequired: true } });
  assert.match(h.byId('activity-message').textContent, /Close and relaunch/);
  h.update({ revision: 11, phase: 'ready', planId: 'late', items: [{ id: 'late', name: 'late.mov', status: 'ready' }], counts: {}, developerFullCopy: info });
  assert.equal(h.byId('start-batch').disabled, true); assert.equal(h.byId('prepare-batch').disabled, true); assert.equal(h.byId('select-ready').disabled, true);
  assert.match(h.byId('activity-message').textContent, /Close and relaunch/);
  h.update({ revision: 9, phase: 'idle', items: [], counts: {} }); assert.equal(h.byId('prepare-batch').disabled, true);
});
