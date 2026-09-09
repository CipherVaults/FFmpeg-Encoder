'use strict';

// The renderer presents main-owned state. It never scans folders, constructs an
// FFmpeg command, or decides that a child process has finished. The only system
// authority available here is the named application API exposed by preload.
(() => {
  const api = window.encoder;
  const byId = id => document.getElementById(id);
  const busyPhases = new Set(['checking', 'preparing', 'running', 'cancelling']);
  const terminalPhases = new Set(['completed', 'cancelled', 'failed']);
  const selectableStatuses = new Set(['ready', 'conflict']);
  const statusLabels = {
    ready: 'Ready', conflict: 'Choose one', skipped: 'Skipped', unsupported: 'Unsupported',
    pending: 'Waiting', running: 'Encoding', success: 'Succeeded', failed: 'Failed',
    cancelled: 'Cancelled', unprocessed: 'Unprocessed',
  };
  const phaseLabels = {
    idle: 'Ready', checking: 'Checking encoders', preparing: 'Inspecting files',
    ready: 'Review batch', running: 'Encoding', cancelling: 'Cancelling',
    completed: 'Completed', cancelled: 'Cancelled', failed: 'Stopped',
  };
  let capabilities = null;
  let inputFolder = null;
  let outputFolder = null;
  let snapshot = { revision: -1, phase: 'idle', items: [], counts: {}, progress: null };
  let selectedIds = new Set();
  let selectionPlanId = null;
  let dirty = true;
  let editing = true;
  let pendingCommands = 0;
  let cancelPending = false;
  let uiError = '';
  let lastTableKey = '';
  let snapshotReceivedAt = performance.now();
  let unsubscribe = null;

  const profiles = () => capabilities?.profiles || [];
  const selectedProfile = () => profiles().find(profile => profile.id === byId('profile').value);
  const isBusy = () => busyPhases.has(snapshot.phase);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const put = (id, value) => { byId(id).textContent = String(value ?? ''); };
  const visible = (id, show) => { byId(id).hidden = !show; };

  function duration(value) {
    if (!finite(value) || value < 0) return '—';
    const seconds = Math.floor(value);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds % 3600 / 60);
    const remainder = seconds % 60;
    return hours
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
      : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
  }

  function bytes(value) {
    if (!finite(value) || value < 0) return '—';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let number = value;
    let index = 0;
    while (number >= 1024 && index < units.length - 1) { number /= 1024; index++; }
    return `${number.toFixed(index ? 1 : 0)} ${units[index]}`;
  }

  function currentSettings() {
    return { profileId: byId('profile').value, preset: byId('preset').value, quality: byId('quality').valueAsNumber };
  }

  function settingsValid() {
    const profile = selectedProfile();
    const settings = currentSettings();
    return Boolean(profile?.available && profile.presets.includes(settings.preset)
      && Number.isInteger(settings.quality) && settings.quality >= profile.quality.min
      && settings.quality <= profile.quality.max);
  }

  function describeSettings(settings) {
    if (!settings) return '';
    const profile = profiles().find(item => item.id === settings.profileId);
    return `${profile?.label || settings.profileId} · preset ${settings.preset} · ${profile?.quality.mode || 'Quality'} ${settings.quality}`;
  }

  // Snapshot revisions prevent a delayed invoke response from repainting an
  // older batch after an update event already delivered a newer state.
  function applySnapshot(next) {
    if (!next || !Number.isInteger(next.revision) || next.revision < snapshot.revision) return;
    const previousPhase = snapshot.phase;
    const previousBatch = snapshot.batchId;
    snapshot = next;
    snapshotReceivedAt = performance.now();
    if (isBusy()) editing = false;
    if (terminalPhases.has(next.phase) && (busyPhases.has(previousPhase) || previousBatch !== next.batchId)) editing = false;
    if (next.phase === 'ready' && next.planId && selectionPlanId !== next.planId) {
      selectionPlanId = next.planId;
      selectedIds = new Set((next.items || []).filter(item => item.status === 'ready').map(item => item.id));
      dirty = false;
    }
    render();
  }

  function setError(error) {
    uiError = error?.message || String(error || 'The operation could not be completed.');
    render();
  }

  async function command(action) {
    pendingCommands++;
    uiError = '';
    render();
    try { return await action(); }
    catch (error) { setError(error); return null; }
    finally { pendingCommands--; render(); }
  }

  function invalidatePreview() {
    dirty = true;
    selectedIds.clear();
    editing = true;
    uiError = '';
    render();
  }

  function populateProfileSettings() {
    const profile = selectedProfile();
    byId('preset').replaceChildren();
    if (!profile) return;
    for (const preset of profile.presets) {
      const option = document.createElement('option');
      option.value = preset;
      option.textContent = preset;
      byId('preset').append(option);
    }
    byId('preset').value = profile.defaultPreset;
    for (const id of ['quality', 'quality-slider']) {
      byId(id).min = profile.quality.min;
      byId(id).max = profile.quality.max;
      byId(id).value = profile.quality.default;
    }
    put('quality-label', `${profile.quality.mode} quality (${profile.quality.min}–${profile.quality.max})`);
    put('slider-label', `Adjust ${profile.quality.mode}`);
    put('quality-value', profile.quality.default);
    const depths = profile.supportedBitDepths || profile.bitDepths || [];
    put('profile-description', `${profile.label} · ${depths.length ? `${depths.join(' / ')}-bit supported` : 'See availability details'} · output: name_${profile.suffix}.mkv`);
    visible('default-note', profile.provisional === true);
  }

  async function loadCapabilities() {
    const result = await api.getCapabilities();
    if (!result || !Array.isArray(result.profiles)) throw new Error('Encoder capability information is unavailable.');
    capabilities = result;
    byId('profile').replaceChildren();
    byId('capability-list').replaceChildren();
    for (const profile of profiles()) {
      const option = document.createElement('option');
      option.value = profile.id;
      option.textContent = `${profile.label}${profile.available ? '' : ' — unavailable'}`;
      option.disabled = !profile.available;
      byId('profile').append(option);
      const row = document.createElement('li');
      const depths = profile.supportedBitDepths || [];
      row.textContent = profile.available
        ? `${profile.label}: available${depths.length ? ` · ${depths.join(' / ')}-bit` : ''}${profile.reason ? ` · ${profile.reason}` : ''}`
        : `${profile.label}: ${profile.reason || 'Encoder cannot initialize on this computer.'}`;
      if (!profile.available) row.className = 'unavailable';
      byId('capability-list').append(row);
    }
    const preferred = profiles().find(profile => profile.id === 'h265-cpu' && profile.available)
      || profiles().find(profile => profile.available);
    byId('profile').value = preferred?.id || '';
    if (!preferred) {
      byId('capability-details').open = true;
      uiError = 'No encoding profile is available. See encoder availability for the reported reasons.';
    }
    const versions = result.versions || {};
    put('runtime-versions', Object.entries(versions).filter(([, value]) => ['string', 'number'].includes(typeof value))
      .map(([name, value]) => `${name}: ${value}`).join(' · '));
    populateProfileSettings();
    render();
  }

  function mediaSummary(summary) {
    if (!summary || typeof summary !== 'object') return typeof summary === 'string' ? summary : '';
    const parts = [];
    if (summary.width && summary.height) parts.push(`${summary.width} × ${summary.height}`);
    if (finite(summary.frameRate)) parts.push(`${Number(summary.frameRate.toFixed(3))} fps`);
    if (summary.bitDepth) parts.push(`${summary.bitDepth}-bit`);
    if (finite(summary.durationSeconds)) parts.push(duration(summary.durationSeconds));
    const counts = summary.streamCounts || {};
    if (counts.audio) parts.push(`${counts.audio} audio`);
    if (counts.subtitle) parts.push(`${counts.subtitle} subtitle${counts.subtitle === 1 ? '' : 's'}`);
    if (counts.attachment) parts.push(`${counts.attachment} attachment${counts.attachment === 1 ? '' : 's'}`);
    return parts.join(' · ');
  }

  function changeSelection(item, checked) {
    if (checked) {
      // Windows destination comparison matches main. Main validates again at
      // start; this UI rule only makes conflict resolution understandable.
      for (const other of snapshot.items || []) {
        if (other.outputName.toLowerCase() === item.outputName.toLowerCase()) selectedIds.delete(other.id);
      }
      selectedIds.add(item.id);
    } else selectedIds.delete(item.id);
    syncSelection();
  }

  function syncSelection() {
    const canSelect = snapshot.phase === 'ready' && !dirty && !pendingCommands;
    const eligible = (snapshot.items || []).filter(item => selectableStatuses.has(item.status));
    const eligibleIds = new Set(eligible.map(item => item.id));
    selectedIds = new Set([...selectedIds].filter(id => eligibleIds.has(id)));
    for (const checkbox of byId('batch-items').querySelectorAll('input[type="checkbox"]')) {
      checkbox.checked = selectedIds.has(checkbox.dataset.fileId);
      checkbox.disabled = !canSelect || !eligibleIds.has(checkbox.dataset.fileId);
    }
    put('selected-count', `${selectedIds.size} selected · ${(snapshot.items || []).length} found`);
    byId('start-batch').disabled = !canSelect || !selectedIds.size || !snapshot.planId;
    byId('select-ready').disabled = !canSelect || !eligible.some(item => item.status === 'ready');
    byId('clear-selection').disabled = !canSelect || !selectedIds.size;
  }

  function renderItems() {
    const items = snapshot.items || [];
    // Progress can arrive many times per second. Rebuilding unchanged rows would
    // steal checkbox focus and make a large preview needlessly expensive.
    const key = JSON.stringify(items.map(item => [item.id, item.name, item.outputName, item.status, item.reason, item.summary]));
    if (key !== lastTableKey) {
      lastTableKey = key;
      const fragment = document.createDocumentFragment();
      for (const item of items) {
        const row = document.createElement('tr');
        const useCell = document.createElement('td');
        useCell.className = 'selection-cell';
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.dataset.fileId = item.id;
        checkbox.setAttribute('aria-label', `Encode ${item.name}`);
        checkbox.addEventListener('change', () => changeSelection(item, checkbox.checked));
        useCell.append(checkbox);
        const fileCell = document.createElement('td');
        const name = document.createElement('p');
        name.className = 'file-name'; name.textContent = item.name;
        const output = document.createElement('p');
        output.className = 'output-name'; output.textContent = `→ ${item.outputName}`;
        fileCell.append(name, output);
        const summary = mediaSummary(item.summary);
        if (summary) {
          const detail = document.createElement('p');
          detail.className = 'file-detail'; detail.textContent = summary; fileCell.append(detail);
        }
        if (item.reason) {
          const reason = document.createElement('p');
          reason.className = 'item-reason'; reason.textContent = item.reason; fileCell.append(reason);
        }
        if (item.summary?.samplingLimit) {
          const details = document.createElement('details');
          const title = document.createElement('summary'); title.textContent = 'Color inspection limits';
          const text = document.createElement('p'); text.className = 'hint'; text.textContent = item.summary.samplingLimit;
          details.append(title, text); fileCell.append(details);
        }
        const statusCell = document.createElement('td');
        const status = document.createElement('span');
        const knownStatus = Object.hasOwn(statusLabels, item.status) ? item.status : 'pending';
        status.className = `status status-${knownStatus}`;
        status.textContent = statusLabels[knownStatus]; statusCell.append(status);
        row.append(useCell, fileCell, statusCell); fragment.append(row);
      }
      byId('batch-items').replaceChildren(fragment);
    }
    visible('empty-message', !items.length);
    syncSelection();
  }

  function renderTelemetry() {
    const preparing = snapshot.phase === 'preparing' || (snapshot.phase === 'cancelling' && snapshot.preparation);
    const preparation = snapshot.preparation || {};
    const progress = preparing ? { fileId: preparation.fileId, percent: preparation.total > 0 ? preparation.resolved / preparation.total * 100 : null } : snapshot.progress || {};
    const items = snapshot.items || [];
    const item = items.find(entry => entry.id === progress.fileId)
      || items.find(entry => entry.status === 'running')
      || (snapshot.phase === 'preparing' ? items.find(entry => entry.status === 'pending') : null);
    put('current-file', item?.name || (snapshot.phase === 'checking' ? 'Testing available encoders…' : snapshot.phase === 'preparing' ? 'Inspecting input media…' : 'Waiting for the current operation to settle…'));
    put('monitor-count', item ? `File ${items.indexOf(item) + 1} of ${items.length}` : '');
    const hasPercent = finite(progress.percent);
    if (hasPercent) byId('encode-progress').value = Math.min(100, Math.max(0, progress.percent));
    else byId('encode-progress').removeAttribute('value');
    put('percent', hasPercent ? `${Math.min(100, Math.max(0, progress.percent)).toFixed(1)}%` : 'In progress');
    put('progress-label', snapshot.phase === 'preparing' ? 'Inspecting media' : snapshot.phase === 'checking' ? 'Checking encoders' : 'Encoding progress');
    put('monitor-heading', preparing ? '03 / Inspecting recordings' : '03 / Encoding monitor');
    visible('inspection-details', preparing);
    visible('encoding-telemetry', !preparing);
    put('progress-note', preparing ? 'Progress counts resolved files. Individual inspection times vary with the recording.' : 'A file is complete after the encoded output has been verified and saved.');
    const stages = { identity: 'Checking file identity', metadata: 'Reading duration, video properties and streams', frames: 'Checking sampled SDR/HDR metadata', reused: 'Reusing validated inspection' };
    put('inspection-stage', `${stages[preparation.stage] || 'Preparing inspection'}${preparation.window ? ` · ${preparation.window}` : ''}`);
    visible('inspection-notice', Boolean(preparation.notice));
    put('inspection-notice', preparation.notice || '');
    put('encoded-time', duration(progress.seconds));
    put('speed', finite(progress.speed) ? `${progress.speed.toFixed(2)}×` : '—');
    put('fps', finite(progress.fps) ? progress.fps.toFixed(1) : '—');
    put('output-size', bytes(progress.bytes));
    put('eta', duration(progress.etaSeconds));
    renderElapsed();
  }

  function renderElapsed() {
    // Extrapolate elapsed display between snapshots only while main reports an
    // active phase. This is presentation, never a queue/lifecycle timer.
    const base = finite(snapshot.elapsedSeconds) ? snapshot.elapsedSeconds : 0;
    put('elapsed', duration(base + (isBusy() ? (performance.now() - snapshotReceivedAt) / 1000 : 0)));
    put('inspection-elapsed', duration(base + (isBusy() ? (performance.now() - snapshotReceivedAt) / 1000 : 0)));
  }

  function render() {
    const phase = snapshot.phase;
    const busy = isBusy();
    const terminal = terminalPhases.has(phase);
    const ready = phase === 'ready' && !dirty;
    const showResults = terminal && !editing;
    const error = uiError || (!editing ? snapshot.error : '') || '';
    visible('error-banner', Boolean(error)); put('error-banner', error);
    put('phase-badge', phaseLabels[phase] || 'Ready');
    let activity = '';
    if (phase === 'checking') activity = 'Checking the bundled encoders on this computer. This can take a moment.';
    else if (phase === 'preparing') {
      const p = snapshot.preparation;
      activity = p ? `Checking ${p.total} recordings · ${p.resolved} resolved · ${p.reused} reused · ${p.active} inspecting` : 'Preparing inspection and checking output names…';
    }
    else if (phase === 'cancelling') activity = 'Waiting for the active process to exit and temporary files to be cleaned up.';
    else if (phase === 'running') activity = 'Encoding locally. Each completed output is verified before it is saved.';
    else if (pendingCommands) activity = 'Working…';
    else if (ready) activity = 'Review the effective settings and select the files to encode.';
    else if (dirty && editing && capabilities) activity = 'Choose your settings, then review the batch.';
    put('activity-message', activity);
    visible('setup-panel', true);
    visible('batch-panel', (ready || busy || showResults) && (snapshot.items || []).length > 0);
    visible('monitor-panel', busy && phase !== 'checking');
    visible('results-panel', showResults);
    visible('preview-actions', ready);
    visible('cancel-bar', busy && Boolean(snapshot.batchId));
    put('cancel-explanation', phase === 'checking' ? 'Cancel this capability check.' : 'Cancellation stops this operation and the remaining queue.');
    byId('cancel-batch').disabled = cancelPending || phase === 'cancelling';
    put('cancel-batch', phase === 'cancelling' || cancelPending ? 'Cancelling…' : phase === 'preparing' ? 'Cancel inspection' : phase === 'checking' ? 'Cancel check' : 'Cancel batch');
    const locked = busy || pendingCommands > 0;
    for (const id of ['choose-input', 'choose-output']) byId(id).disabled = locked || !capabilities;
    for (const id of ['profile', 'preset', 'quality', 'quality-slider']) byId(id).disabled = locked || !selectedProfile()?.available;
    byId('prepare-batch').disabled = locked || !inputFolder || !outputFolder || !settingsValid();
    byId('new-batch').disabled = locked || !terminal;
    put('input-path', inputFolder?.path || 'No folder selected');
    put('output-path', outputFolder?.path || 'No folder selected');
    put('effective-settings', snapshot.settings ? `Effective settings: ${describeSettings(snapshot.settings)}` : '');
    put('monitor-settings', describeSettings(snapshot.settings));
    const hasEligible = (snapshot.items || []).some(item => selectableStatuses.has(item.status));
    put('preview-message', ready && !hasEligible
      ? 'Nothing to encode in this batch. Review the skipped or unsupported reasons below, or change your folders and settings.'
      : showResults ? 'Completed batch. Each file result and any skipped or unsupported reason is shown below.'
        : 'Select files to encode. Existing outputs stay unchanged. For conflicting output names, select one input per destination.');
    renderItems(); renderTelemetry();
    if (showResults) {
      for (const key of ['success', 'failed', 'skipped', 'cancelled', 'unprocessed']) put(`count-${key}`, snapshot.counts?.[key] || 0);
      put('result-phase', phaseLabels[phase]);
      put('result-message', phase === 'completed' ? 'The batch has finished. Review individual results above; skipped and unsupported files are listed with their reasons.' : phase === 'cancelled' ? 'The operation was cancelled. Completed outputs are preserved. Remaining files were not encoded.' : snapshot.error || 'The batch stopped. Review the file results before preparing a new batch.');
    }
  }

  byId('profile').addEventListener('change', () => { populateProfileSettings(); invalidatePreview(); });
  byId('preset').addEventListener('change', invalidatePreview);
  byId('quality').addEventListener('input', () => {
    const value = byId('quality').valueAsNumber;
    if (finite(value)) byId('quality-slider').value = value;
    put('quality-value', finite(value) ? value : '—'); invalidatePreview();
  });
  byId('quality-slider').addEventListener('input', () => {
    byId('quality').value = byId('quality-slider').value;
    put('quality-value', byId('quality').value); invalidatePreview();
  });
  byId('choose-input').addEventListener('click', () => command(async () => {
    const selected = await api.chooseInputFolder();
    if (selected) { inputFolder = selected; invalidatePreview(); }
  }));
  byId('choose-output').addEventListener('click', () => command(async () => {
    const selected = await api.chooseOutputFolder();
    if (selected) { outputFolder = selected; invalidatePreview(); }
  }));
  byId('prepare-batch').addEventListener('click', () => command(async () => {
    if (!settingsValid() || !inputFolder || !outputFolder) throw new Error('Choose both folders and valid encoding settings.');
    const next = await api.prepareBatch({ inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, settings: currentSettings() });
    applySnapshot(next);
    if (snapshot.phase === 'ready') byId('batch-heading').scrollIntoView({ block: 'start' });
  }));
  byId('start-batch').addEventListener('click', () => command(async () => {
    if (dirty || !selectedIds.size) throw new Error('Review the batch and select at least one ready file.');
    applySnapshot(await api.startBatch({ planId: snapshot.planId, fileIds: [...selectedIds] }));
    byId('monitor-heading').scrollIntoView({ block: 'start' });
  }));
  byId('select-ready').addEventListener('click', () => {
    selectedIds = new Set((snapshot.items || []).filter(item => item.status === 'ready').map(item => item.id)); syncSelection();
  });
  byId('clear-selection').addEventListener('click', () => { selectedIds.clear(); syncSelection(); });
  byId('cancel-batch').addEventListener('click', async () => {
    if (!snapshot.batchId || cancelPending) return;
    cancelPending = true; uiError = ''; render();
    try { applySnapshot(await api.cancelBatch({ batchId: snapshot.batchId })); }
    catch (error) { setError(error); }
    finally { cancelPending = false; render(); }
  });
  byId('new-batch').addEventListener('click', () => {
    if (isBusy()) return;
    editing = true; dirty = true; selectedIds.clear(); uiError = ''; render();
    if (!capabilities) command(loadCapabilities);
    byId('setup-heading').scrollIntoView({ block: 'start' });
  });

  const elapsedTimer = setInterval(renderElapsed, 1000);
  window.addEventListener('beforeunload', () => { clearInterval(elapsedTimer); unsubscribe?.(); }, { once: true });
  if (!api) {
    setError(new Error('The application bridge is unavailable. Close and reopen FFmpeg Encoder.'));
    put('activity-message', 'Unable to connect to the application.');
    return;
  }
  unsubscribe = api.onUpdate(applySnapshot);
  command(async () => {
    applySnapshot(await api.getSnapshot());
    await loadCapabilities();
  });
})();
