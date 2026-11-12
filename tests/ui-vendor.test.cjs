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
    get options() { return this.children.flatMap(child => child.tagName === 'option' ? [child] : child.tagName === 'optgroup' ? child.options : []); }
    set innerHTML(_value) { throw new Error('HTML injection sink is forbidden'); }
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

async function harness(overrides = {}, { narrow = false, rendererSource = renderer } = {}) {
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
  const timers = new Map(); let timerId = 0;
  let layoutListener;
  const mediaQuery = { matches: narrow, addEventListener: (_name, listener) => { layoutListener = listener; } };
  const window = { encoder: api, addEventListener() {}, matchMedia: () => mediaQuery };
  vm.runInNewContext(rendererSource, { window, document: view.document, performance: { now: () => 100 }, setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, delay }); return id; }, clearTimeout: id => timers.delete(id), setInterval: () => 1, clearInterval() {} }, { filename: 'ui/renderer.js' });
  await settle();
  assert.equal(view.byId('error-banner').textContent, '');
  return { ...view, calls, resolveRecipes: async () => { for (const [id, timer] of [...timers]) if (timer.delay === 80) { timers.delete(id); await timer.callback(); } await settle(); }, update: value => update(value), setNarrow: value => { mediaQuery.matches = value; layoutListener?.(); } };
}

const { createHash } = require('node:crypto');
const { VENDOR_PROFILES, VENDOR_MESSAGES } = require('../src/vendor-profiles.cjs');
const { projectVendorCapabilities } = require('../src/vendor-capabilities.cjs');
const { describeCatalogRecipe } = require('../src/encoder-catalog.cjs');
const { PROFILES } = require('../src/media.cjs');
const notice = 'Not yet tested on real AMD/Intel hardware. Results are checked after encoding.';
const disclosure = {
  AMD: 'The app cannot confirm which encoder settings AMD actually used.',
  Intel: 'The app cannot prove which Intel adapter encoded the file.',
};
const preferences = profileId => ({ settingsByProfile: {}, inputFolder: null, outputFolder: null, profileId, notices: [] });
function vendorView() {
  // The production projection supplies fixed failure/disclosure text. This is
  // pure injected evidence: no discovery, helper, FFmpeg or native app runs.
  return projectVendorCapabilities({ profiles: VENDOR_PROFILES.map(profile => ({ id: profile.id,
    checks: [8, 10].map(bitDepth => ({ bitDepth,
      available: profile.id !== 'h264-intel' && !(profile.id === 'h265-amd' && bitDepth === 10),
      reasonCode: 'VENDOR_CHECK_FAILED', device: { description: `${profile.hardware} fixture adapter` },
      disclosures: [{ code: 'VENDOR_PARAMS_ADJUSTED' }, { code: 'VENDOR_MULTIPLE_ADAPTERS' }],
    })),
  })) });
}
async function vendorHarness({ vendorProfiles = vendorView(), profiles = [profile], ...overrides } = {}, options) {
  return harness({
    getCapabilities: async () => ({ profiles, vendorProfiles, recipes: [], versions: {} }),
    getRecipe: async settings => describeCatalogRecipe(plain(settings)),
    saveSettings: async () => ({ notices: [] }),
    resetProfile: async request => preferences(request.profileId),
    ...overrides,
  }, options);
}
async function choose(h, id) {
  h.byId('profile').value = id;
  await h.byId('profile').emit('change');
  await h.resolveRecipes();
}
const normalized = element => element.textContent.replace(/\s+/g, ' ').trim();

async function checkAbsentGroups(rendererSource = renderer) {
  for (const vendorProfiles of [null, []]) {
    const h = await vendorHarness({ vendorProfiles }, { rendererSource });
    assert.equal(h.byId('profile').children.length, 1);
    assert.equal(h.byId('profile').options.length, 1);
    assert.equal(h.byId('profile').querySelectorAll('optgroup').length, 0);
    assert.equal(h.byId('capability-list').children.length, 1);
  }
  const h = await harness({}, { rendererSource });
  assert.equal(h.byId('profile').children.length, 1);
  assert.equal(h.byId('profile').options.length, 1);
  assert.equal(h.byId('profile').querySelectorAll('optgroup').length, 0);
}
test('missing or empty vendorProfiles adds no options, groups or capability rows', () => checkAbsentGroups());

async function checkOptions(rendererSource = renderer) {
  const h = await vendorHarness({}, { rendererSource });
  const select = h.byId('profile'), groups = select.querySelectorAll('optgroup');
  assert.equal(select.children[0].tagName, 'option');
  assert.deepEqual(groups.map(group => group.label), [
    'AMD — not yet tested on real hardware', 'Intel — not yet tested on real hardware',
  ]);
  for (const hardware of ['AMD', 'Intel']) {
    const group = groups.find(group => group.label.startsWith(hardware));
    const rows = vendorView().filter(row => row.hardware === hardware);
    assert.equal(group.children.length, rows.length);
    for (const row of rows) {
      const option = group.options.find(option => option.value === row.id);
      assert.equal(option.textContent, `${row.codec} · ${hardware} ⚠${row.available ? '' : ' — unavailable'}`);
      assert.equal(option.disabled, !row.available);
      if (!row.available) assert.equal(option.title, row.reason);
    }
  }
  const unavailable = select.options.find(option => option.value === 'h264-intel');
  assert.equal(unavailable.disabled, true);
  assert.equal(unavailable.title, VENDOR_MESSAGES.VENDOR_CHECK_FAILED);
}
test('vendor optgroups follow ordinary options and disabled choices disclose their fixed reason', () => checkOptions());

test('capability rows name the adapter, partial depth support and fixed disclosures', async () => {
  const h = await vendorHarness();
  const rows = h.byId('capability-list').children;
  const amd = rows.find(row => row.textContent.startsWith('H265 · AMD'));
  assert.ok(amd.textContent.includes('AMD fixture adapter'));
  assert.ok(amd.textContent.includes(`8-bit only on this computer — 10-bit: ${VENDOR_MESSAGES.VENDOR_CHECK_FAILED}`));
  assert.ok(amd.textContent.includes(VENDOR_MESSAGES.VENDOR_PARAMS_ADJUSTED));
  assert.ok(amd.textContent.includes(VENDOR_MESSAGES.VENDOR_MULTIPLE_ADAPTERS));
  const intel = rows.find(row => row.textContent.startsWith('H265 · Intel'));
  assert.ok(intel.textContent.includes('Intel fixture adapter: 8 / 10-bit supported on this computer'));
  const disabled = rows.find(row => row.textContent.startsWith('H264 · Intel'));
  assert.equal(disabled.className, 'unavailable');
  assert.equal(disabled.textContent, `H264 · Intel ⚠: ${VENDOR_MESSAGES.VENDOR_CHECK_FAILED}`);
});

async function checkMark(rendererSource = renderer) {
  const ordinary = PROFILES.map(row => ({ ...plain(row), available: true, supportedBitDepths: [...row.bitDepths] }));
  const h = await vendorHarness({ profiles: ordinary }, { rendererSource });
  assert.equal(h.byId('profile-untested').hidden, true);
  for (const id of ['h265-amd', 'h265-intel', 'h265-cpu', 'h265-nvidia', 'h264-amd', 'h264-cpu']) {
    await choose(h, id);
    const vendor = vendorView().find(profile => profile.id === id), mark = h.byId('profile-untested-mark');
    assert.equal(h.byId('profile-untested').hidden, !vendor);
    assert.equal(normalized(mark), '⚠');
    assert.equal(mark.getAttribute('title'), notice);
    assert.equal(mark.getAttribute('aria-label'), notice);
    assert.equal(h.byId('profile-untested-disclosure').textContent, vendor ? disclosure[vendor.hardware] : '');
    assert.equal(h.byId('tested-default').textContent, vendor ? 'Starting values' : 'Tested Default');
    assert.equal(h.byId('tested-default').getAttribute('aria-label'), vendor
      ? 'Reset current profile to untested starting values' : 'Reset current profile to Tested Default');
    if (vendor) {
      assert.match(h.byId('default-help-text').textContent, /untested starting values/);
      assert.doesNotMatch(h.byId('default-help-text').textContent, /(?<!un)tested/i);
      assert.match(h.byId('default-help').getAttribute('aria-label'), /untested starting values/);
      assert.doesNotMatch(h.byId('default-args').getAttribute('aria-label'), /Tested Default/);
    } else assert.match(h.byId('default-help-text').textContent, /tested operational starting point/);
  }
}
test('profile warning, disclosure and starting-values wording follow AMD/Intel versus CPU/NVIDIA', () => checkMark());

async function checkOpenHelp(rendererSource = renderer) {
  const h = await vendorHarness({}, { rendererSource });
  await choose(h, 'h265-amd');
  const mark = h.byId('profile-untested-mark');
  await mark.click();
  assert.equal(mark.getAttribute('aria-expanded'), 'true');
  assert.equal(h.byId('profile-untested-content').hidden, false);
  await choose(h, 'h265-cpu');
  assert.equal(h.byId('profile-untested').hidden, true);
  assert.equal(h.byId('profile-untested-content').hidden, true);
  assert.equal(h.byId('control-help-display').hidden, true);
  assert.equal(mark.getAttribute('aria-expanded'), 'false');
}
test('switching to an ordinary profile closes the shared vendor help panel', () => checkOpenHelp());

test('vendor recipes supply starting arguments and QP/ICQ labels without a testedDefault field', async () => {
  const h = await vendorHarness();
  for (const row of VENDOR_PROFILES) {
    await choose(h, row.id);
    const recipe = describeCatalogRecipe({ profileId: row.id, preset: row.defaultPreset, quality: row.quality.default });
    assert.equal(recipe.testedDefault, undefined);
    assert.equal(h.byId('quality-label').textContent, `${recipe.qualityMode} quality (${row.quality.min}–${row.quality.max})`);
    assert.equal(h.byId('slider-label').textContent, `Adjust ${recipe.qualityMode}`);
    assert.ok(h.byId('quality-hint').textContent.startsWith(`${recipe.qualityMode} values`));
    assert.ok(h.byId('quality-hint').title.startsWith(`${recipe.qualityMode} uses`));
    assert.equal(h.byId('quality-help-text').textContent, recipe.qualityHelp);
    assert.equal(h.byId('quality').min, row.quality.min);
    assert.equal(h.byId('quality').max, row.quality.max);
    assert.equal(h.byId('quality').value, String(row.quality.default));
    assert.deepEqual(JSON.parse(h.byId('default-args').textContent), recipe.startingValues.args);
    assert.match(h.byId('tested-default').title, /untested starting values/);
    assert.doesNotMatch(h.byId('recipe-note').textContent, /could not be loaded/);
  }
});

test('quality labels use the returned recipe mode and ignore a delayed old vendor response', async () => {
  let finish;
  const pending = new Promise(resolve => { finish = resolve; });
  const h = await vendorHarness({ getRecipe: async settings => settings.profileId === 'h265-amd' ? pending
    : { ...describeCatalogRecipe(plain(settings)), qualityMode: 'QP' } });
  h.byId('profile').value = 'h265-amd'; await h.byId('profile').emit('change');
  const old = h.resolveRecipes();
  await choose(h, 'h265-intel');
  assert.match(h.byId('quality-label').textContent, /^QP quality/);
  finish(describeCatalogRecipe({ profileId: 'h265-amd', preset: 'quality', quality: 25 }));
  await old;
  assert.equal(h.byId('profile').value, 'h265-intel');
  assert.match(h.byId('recipe-description').textContent, /Intel/);
  assert.match(h.byId('quality-label').textContent, /^QP quality/);
});

test('reset uses the selected vendor id, untested notice and editable canonical starting values', async () => {
  const h = await vendorHarness();
  for (const id of ['h265-amd', 'h265-intel', 'h265-cpu']) {
    await choose(h, id);
    h.byId('quality').value = '30'; await h.byId('quality').emit('change');
    await h.byId('tested-default').click(); await h.resolveRecipes();
    assert.deepEqual(h.calls.filter(call => call.name === 'resetProfile').at(-1).args, [{ profileId: id }]);
    assert.match(h.byId('preferences-notice').textContent, id === 'h265-cpu' ? /Tested Default applied/ : /Untested starting values applied/);
    assert.equal(h.byId('quality').disabled, false);
    assert.equal(h.byId('error-banner').textContent, '');
  }
});

test('vendor saved selection stays visible when unavailable and cannot prepare a batch', async () => {
  const h = await vendorHarness({ getPreferences: async () => ({ ...preferences('h264-intel'),
    inputFolder: { id: 'input', available: true }, outputFolder: { id: 'output', available: true } }) });
  await h.resolveRecipes();
  assert.equal(h.byId('profile').value, 'h264-intel');
  assert.equal(h.byId('profile-untested').hidden, false);
  assert.equal(h.byId('prepare-batch').disabled, true);
  await h.byId('prepare-batch').click();
  assert.equal(h.calls.some(call => call.name === 'prepareBatch'), false);
  await choose(h, 'h265-amd');
  assert.equal(h.byId('prepare-batch').disabled, false);
});

async function checkResults(rendererSource = renderer) {
  const h = await vendorHarness({}, { rendererSource });
  const item = { id: 'vendor-result', name: 'video.mkv', outputName: 'video_H265-AMD-GPU.mkv', status: 'success', hardwareTier: 'untested' };
  const update = items => h.update({ revision: 5, batchId: 'batch', phase: 'completed', items, counts: { success: items.length } });
  update([item, { ...item, id: 'cpu-result', hardwareTier: undefined }]);
  const row = h.byId('batch-items').children[0], mark = row.querySelector('[data-testid="result-untested"]');
  assert.equal(mark.hidden, false);
  assert.equal(mark.textContent, '⚠'); assert.equal(mark.title, notice);
  assert.equal(mark.getAttribute('aria-label'), notice);
  assert.equal(h.byId('batch-items').children[1].querySelector('[data-testid="result-untested"]').hidden, true);
  update([{ ...item, hardwareTier: undefined }]);
  assert.equal(h.byId('batch-items').children[0], row);
  assert.equal(mark.hidden, true, 'tier-only updates revoke the warning on a retained row');
  update([item]); assert.equal(mark.hidden, false);
}
test('result rows mark only untested hardware and update without rebuilding the row', () => checkResults());

async function checkInertText(rendererSource = renderer) {
  const attack = '<img src=x onerror="window.encoder.startBatch()">';
  const rows = vendorView().map(row => row.id === 'h265-amd' ? { ...row, label: attack, reason: attack,
    device: { description: attack }, checks: [{ bitDepth: 10, available: false, reason: attack }],
    disclosures: [{ message: attack }] } : row.id === 'h264-intel' ? { ...row, reason: attack } : row);
  const h = await vendorHarness({ vendorProfiles: rows, getRecipe: async settings => ({
    ...describeCatalogRecipe(plain(settings)), label: attack, mediaNote: attack, presetHelp: attack, qualityHelp: attack,
  }) }, { rendererSource });
  await choose(h, 'h265-amd');
  assert.equal(h.byId('profile').options.find(row => row.value === 'h265-amd').textContent, `${attack} ⚠`);
  assert.equal(h.byId('profile').options.find(row => row.value === 'h264-intel').title, attack);
  assert.ok(h.byId('capability-list').textContent.includes(attack));
  assert.ok(h.byId('recipe-description').textContent.includes(attack));
  assert.equal(h.byId('preset-help-text').textContent, attack);
  assert.equal(h.byId('quality-help-text').textContent, attack);
  h.update({ revision: 5, phase: 'failed', items: [{ id: 'attack', name: attack, reason: attack, status: 'failed', hardwareTier: 'untested' }], counts: {} });
  assert.ok(h.byId('batch-items').textContent.includes(attack));
  assert.equal(h.document.querySelectorAll('img').length, 0);
  assert.equal(h.calls.some(call => call.name === 'startBatch'), false);
  assert.equal(h.byId('error-banner').textContent, '');
}
test('vendor labels, adapter names, reasons, disclosures and recipes stay inert text', () => checkInertText());
test('vendor rendering has no innerHTML path and keeps warning tokens and Beta labels', async () => {
  assert.doesNotMatch(renderer, /\.innerHTML\b/);
  const h = await vendorHarness();
  const note = normalized(h.byId('vendor-beta-note'));
  assert.match(note, /AMD AMF Beta.*Intel Quick Sync Beta/);
  assert.match(note, /chosen as untested encoders/);
  assert.match(note, /Native backend checks Beta panel.*exact-reference lab/);
  const css = fs.readFileSync(path.join(root, 'ui/styles.css'), 'utf8');
  assert.match(css, /#profile-untested[^{}]*\{[^}]*var\(--warning-text\)[^}]*var\(--warning-accent\)/);
  assert.match(css, /\.untested-mark[^{}]*\{[^}]*var\(--warning-text\)[^}]*var\(--warning-accent\)/);
});

// Each guard is removed only from a VM source string. The corresponding real
// assertion must fail; source files never receive mutant bytes. Hashes before
// and after bind the passing controls to the unchanged on-disk implementation.
const mutations = [
  ['absent vendor groups', 'if (!entries.length) continue;', '', checkAbsentGroups],
  ['disabled vendor option', 'option.disabled = !profile.available;\n        if (!profile.available) option.title', 'option.disabled = false;\n        if (!profile.available) option.title', checkOptions],
  ['disabled option reason', 'if (!profile.available) option.title = profile.reason;', '', checkOptions],
  ['vendor-only profile mark', "visible('profile-untested', Boolean(vendor));", "visible('profile-untested', true);", checkMark],
  ['vendor-only starting values', "put('tested-default', vendor ? 'Starting values' : 'Tested Default');", "put('tested-default', 'Starting values');", checkMark],
  ['vendor-specific disclosure', "vendor ? vendor.hardware === 'AMD'", 'vendor ? true', checkMark],
  ['close obsolete vendor help', "if (activeHelp?.help === byId('profile-untested')) closeHelp();", '', checkOpenHelp],
  ['untested-only result mark', "entry.untested.hidden = item.hardwareTier !== 'untested';", 'entry.untested.hidden = false;', checkResults],
  ['text-only vendor option', "option.textContent = `${profile.label} ⚠${profile.available ? '' : ' — unavailable'}`;", "option.innerHTML = `${profile.label} ⚠${profile.available ? '' : ' — unavailable'}`;", checkInertText],
  ['text-only vendor capability', 'row.textContent = `${profile.label} ⚠', 'row.innerHTML = `${profile.label} ⚠', checkInertText],
];
for (const [name, before, after, check] of mutations) test(`guard removal in memory fails: ${name}; original bytes pass with unchanged hashes`, async () => {
  const files = ['ui/renderer.js', 'ui/index.html', 'ui/styles.css', 'tests/ui-vendor.test.cjs'];
  const hashes = () => files.map(file => createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex'));
  const originalHashes = hashes();
  assert.equal(renderer.split(before).length, 2, 'mutation target must occur exactly once');
  await assert.rejects(() => check(renderer.replace(before, after)), { name: 'AssertionError' });
  await check(renderer);
  assert.deepEqual(hashes(), originalHashes);
});

