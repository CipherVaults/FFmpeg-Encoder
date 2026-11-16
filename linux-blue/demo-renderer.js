'use strict';
const $ = id => document.getElementById(id);
let choices = [], pendingRequest = false, phase = 'loading', inspection = { busy: false, phase: 'empty' };
const labels = { idle: 'Ready for a synthetic job', running: 'Encoding synthetic frames', validating: 'Validating before publication', cancelling: 'Cancelling and draining children', completed: 'Validated output published', 'published-warning': 'Output published; cleanup needs review', uncertain: 'Publication uncertain; retain all evidence', collision: 'Existing output preserved', cancelled: 'Cancelled safely', failed: 'Job stopped without success', closing: 'Closing safely', closed: 'Closed' };
function controls() {
  const busy = pendingRequest || inspection.busy || ['loading', 'running', 'validating', 'cancelling', 'closing', 'closed'].includes(phase);
  for (const id of ['profile', 'preset', 'quality', 'start', 'inspect']) $(id).disabled = busy;
  $('cancel').disabled = pendingRequest || (!['running', 'validating'].includes(phase) && inspection.phase !== 'inspecting');
}
function show(snapshot) {
  inspection = snapshot.inspection;
  const sourceLabels = { empty: 'No source inspected.', choosing: 'Choose one local MP4, Matroska or WebM file. Cancel in the dialog to go back.', inspecting: 'Reading bounded source information…', ready: 'Source information only. Encode still uses the synthetic fixture.', cancelled: 'Inspection cancelled. No source selected for encoding.', failed: `Inspection refused (${inspection.errorCode}). No source selected for encoding.` };
  $('source-status').textContent = sourceLabels[inspection.phase] || 'Source information unavailable.';
  const report = inspection.report;
  $('source-info').textContent = report ? [`${report.container} · ${report.bytes.toLocaleString()} bytes · ${report.durationSeconds === null ? 'unknown duration' : `${report.durationSeconds} seconds (reported)`}`,
    ...report.streams.map(stream => `#${stream.index} ${stream.type}: ${stream.codec || 'unknown codec'}${stream.type === 'video' ? ` · ${stream.width ?? '?'} × ${stream.height ?? '?'} · ${stream.frameRate || '?'} fps · ${stream.pixelFormat || '?'}` : stream.type === 'audio' ? ` · ${stream.sampleRate ?? '?'} Hz · ${stream.channels ?? '?'} channels` : ''}`)].join('\n') : '';
  phase = snapshot.phase; $('phase').textContent = labels[phase] || 'Unavailable';
  $('progress').value = snapshot.frame; $('frames').textContent = `${snapshot.frame} / 12 frames`;
  $('detail').textContent = phase === 'completed' ? 'Probe, full decode and copied-audio hash checks passed before no-overwrite publication.' : phase === 'validating' ? 'Encoded frames are not success: checking streams, audio payload and full decode.' : phase === 'published-warning' || phase === 'uncertain' ? 'Do not delete or retry blindly. Output may exist; review the retained local evidence.' : 'Main owns all paths, tool pins and output publication.';
  $('error').textContent = snapshot.errorCode ? `Result: ${snapshot.errorCode}. No broader qualification is implied.` : '';
  controls();
}
function populatePreset() {
  const profile = choices.find(item => item.id === $('profile').value);
  $('preset').replaceChildren(...profile.presets.map(value => new Option(value, value)));
  $('preset').value = profile.defaultPreset;
  $('quality').min = profile.quality.min; $('quality').max = profile.quality.max; $('quality').value = profile.quality.default;
}
async function call(method, ...args) {
  const response = await window.linuxDemo[method](...args);
  if (!response.ok) throw new Error(`${response.error.code}: ${response.error.message}`);
  return response.value;
}
async function request(method, ...args) {
  if (pendingRequest) return;
  pendingRequest = true; controls();
  try { show(await call(method, ...args)); }
  catch (failure) { $('error').textContent = failure.message; }
  finally { pendingRequest = false; controls(); }
}
$('profile').addEventListener('change', populatePreset);
$('settings').addEventListener('submit', event => { event.preventDefault(); void request('start', { profileId: $('profile').value, preset: $('preset').value, quality: Number($('quality').value) }); });
$('cancel').addEventListener('click', () => { void request('cancel'); });
$('inspect').addEventListener('click', () => { void request('inspect'); });
(async () => {
  try {
    choices = await call('choices');
    $('profile').replaceChildren(...choices.map(item => new Option(item.label, item.id)));
    populatePreset(); show(await call('state'));
    async function poll() { try { if (!pendingRequest) show(await call('state')); } catch { phase = 'closed'; controls(); return; } setTimeout(poll, 100); }
    setTimeout(poll, 100);
  } catch (failure) { $('error').textContent = failure.message; }
})();
