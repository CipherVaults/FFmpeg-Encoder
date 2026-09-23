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
  const attentionStatuses = new Set(['conflict', 'unsupported', 'ambiguous', 'provenance-issue', 'failed']);
  const statusLabels = {
    ready: 'Ready', conflict: 'Choose one', skipped: 'Skipped', unsupported: 'Unsupported',
    pending: 'Waiting', running: 'Encoding', success: 'Succeeded', failed: 'Failed',
    cancelled: 'Cancelled', unprocessed: 'Unprocessed',
    generated: 'Generated output', ambiguous: 'Possible previous output', 'provenance-issue': 'Provenance issue',
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
  // An explicit re-encode intent is separate from the queue selection. Merely
  // filtering or checking an excluded file never grants main-owned authority.
  let reencodeChoices = new Set();
  let selectionPlanId = null;
  let dirty = true;
  let editing = true;
  let pendingCommands = 0;
  let cancelPending = false;
  let uiError = '';
  const itemRows = new Map();
  let batchFilter = 'all';
  let previewCollapsed = false;
  let previousAttention = new Set();
  let rememberedSettings = {};
  let selectedRecipeId = null;
  let preferencesNotice = '';
  let saveTimer = null;
  let pendingSave = null;
  let saveChain = Promise.resolve();
  let saveFailure = null;
  let snapshotReceivedAt = performance.now();
  let unsubscribe = null;
  let recipeRequest = 0;
  let recipeTimer = null;

  const profiles = () => capabilities?.profiles || [];
  const recipes = () => capabilities?.recipes || [];
  const selectedProfile = () => profiles().find(profile => profile.id === byId('profile').value);
  const profileRecipe = () => recipes().find(recipe => recipe.profileId === byId('profile').value);
  const selectedRecipe = () => recipes().find(recipe => recipe.id === selectedRecipeId && recipe.profileId === byId('profile').value);
  const isBusy = () => busyPhases.has(snapshot.phase);
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  const put = (id, value) => { byId(id).textContent = String(value ?? ''); };
  const visible = (id, show) => { byId(id).hidden = !show; };
  const isGenerated = item => item.origin?.kind === 'generated' || item.status === 'generated';
  const canAuthorize = item => isGenerated(item) && !item.reencodeAuthorized && item.status === 'generated';
  const formatArguments = args => JSON.stringify(args || [], null, 2);

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
    return { profileId: byId('profile').value, preset: byId('preset').value, quality: byId('quality').valueAsNumber,
      ...(selectedRecipeId ? { recipeId: selectedRecipeId } : {}) };
  }

  function settingsValid(requireAvailable = true) {
    const profile = selectedProfile();
    const settings = currentSettings();
    return Boolean(profile && (!requireAvailable || profile.available) && profile.presets.includes(settings.preset)
      && Number.isInteger(settings.quality) && settings.quality >= profile.quality.min
      && settings.quality <= profile.quality.max
      && (!requireAvailable || !selectedRecipeId || selectedRecipe()?.available));
  }

  function describeSettings(settings) {
    if (!settings) return '';
    const profile = profiles().find(item => item.id === settings.profileId);
    const recipe = recipes().find(item => item.id === settings.recipeId);
    return `${profile?.label || settings.profileId}${settings.recipeId ? ` · ${recipe?.label || settings.recipeId}` : ''} · preset ${settings.preset} · ${profile?.quality.mode || 'Quality'} ${settings.quality}`;
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
      reencodeChoices.clear();
      selectedIds = new Set((next.items || []).filter(item => item.status === 'ready').map(item => item.id));
      dirty = false;
      batchFilter = next.items.some(item => attentionStatuses.has(item.status)) ? 'attention' : 'all';
      previewCollapsed = batchFilter === 'all' && next.items.length > 20;
      previousAttention = new Set(next.items.filter(item => attentionStatuses.has(item.status)).map(item => `${item.id}:${item.status}`));
    } else if (next.phase !== 'preparing' && next.phase !== 'checking') {
      const attention = new Set((next.items || []).filter(item => attentionStatuses.has(item.status)).map(item => `${item.id}:${item.status}`));
      if ([...attention].some(key => !previousAttention.has(key))) {
        batchFilter = 'attention';
        previewCollapsed = false;
      }
      previousAttention = attention;
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
    reencodeChoices.clear();
    editing = true;
    uiError = '';
    render();
  }

  // These fragments are returned by main's canonical production builder. The
  // renderer formats data for reading; it never invents FFmpeg options or sends
  // arbitrary arguments back across the bridge. Ignore delayed old responses.
  function refreshRecipe() {
    const request = ++recipeRequest;
    clearTimeout(recipeTimer);
    put('recipe-args', '');
    put('recipe-description', '');
    put('recipe-note', settingsValid(false) ? 'Resolving current encoder options…' : 'Choose valid settings to inspect encoder options.');
    put('preset-contribution', '');
    put('default-args', '');
    put('default-recipe-label', '');
    put('archive-args', '');
    put('archive-recipe-label', 'Resolving the recipe’s production options…');
    put('archive-evidence-note', '');
    put('preset-help-text', 'Resolving this preset’s production contribution…');
    put('quality-help-text', 'Resolving this profile’s quality and rate-control explanation…');
    put('profile-help-text', 'Resolving the selected encoder profile…');
    byId('preset').removeAttribute('title');
    byId('tested-default').removeAttribute('title');
    byId('archive-quality').removeAttribute('title');
    if (!settingsValid(false)) return;
    const settings = currentSettings();
    const candidate = profileRecipe();
    recipeTimer = setTimeout(async () => {
      try {
        const [recipe, candidateRecipe] = await Promise.all([
          api.getRecipe(settings),
          candidate ? api.getRecipe({ profileId: candidate.profileId, preset: candidate.preset, quality: candidate.quality, recipeId: candidate.id }) : null,
        ]);
        if (request !== recipeRequest) return;
        put('recipe-description', `${recipe.label} · ${recipe.encoder}${recipe.recipe ? ` · ${recipe.recipe.label}` : ' · standard options'} · preset ${recipe.settings.preset} · ${recipe.qualityMode} ${recipe.settings.quality}`);
        put('recipe-args', formatArguments(recipe.args));
        put('recipe-note', `${recipe.mediaNote} Arguments below are JSON strings, not a shell command. Expand a prepared file for its resolved media-specific arguments.`);
        put('preset-help-text', recipe.presetHelp);
        put('preset-contribution', (recipe.presetContribution || []).join(' '));
        put('quality-help-text', recipe.qualityHelp);
        put('profile-help-text', `${recipe.label} uses ${recipe.encoder}. ${recipe.mediaNote}`);
        // The native selector's help follows its current value. The adjacent
        // focusable disclosure supports technical text beyond native tooltips.
        byId('preset').title = `${recipe.presetHelp} This preset contributes: ${(recipe.presetContribution || []).join(' ')}`;
        const defaults = recipe.testedDefault;
        put('default-recipe-label', `${defaults.label} · ${defaults.encoder} · preset ${defaults.settings.preset} · ${defaults.qualityMode} ${defaults.settings.quality}`);
        put('default-args', formatArguments(defaults.args));
        put('tested-default-values', `Preset ${defaults.settings.preset} · ${defaults.qualityMode} ${defaults.settings.quality}`);
        byId('tested-default').title = `Applies preset ${defaults.settings.preset} and ${defaults.qualityMode} ${defaults.settings.quality}. Inspect the adjacent help for all production encoder options.`;
        if (candidateRecipe) {
          put('archive-recipe-label', `${candidateRecipe.recipe?.label || candidate.label} · preset ${candidateRecipe.settings.preset} · ${candidateRecipe.qualityMode} ${candidateRecipe.settings.quality}`);
          put('archive-args', formatArguments(candidateRecipe.args));
          put('archive-evidence-note', candidateRecipe.recipe?.evidenceNote || candidate.evidenceNote || 'See the reported capability and benchmark limitations.');
          byId('archive-quality').title = `Applies preset ${candidateRecipe.settings.preset} and ${candidateRecipe.qualityMode} ${candidateRecipe.settings.quality}, plus the production options shown in the adjacent recipe help.`;
        }
      } catch (error) {
        if (request !== recipeRequest) return;
        put('recipe-note', `Encoder details could not be loaded: ${error?.message || error}`);
        put('preset-help-text', 'Current preset details are unavailable.');
        put('quality-help-text', 'Current quality details are unavailable.');
        put('archive-recipe-label', `Recipe details unavailable: ${error?.message || error}`);
      }
    }, 80);
  }

  // A save captures one profile's values before any switch. Serializing invokes
  // keeps older writes from winning on disk; their responses never repaint the
  // controls or replace newer in-memory values. Preparing/resetting first drains
  // the debounce and queue, so main sees the same settings as the visible form.
  function enqueueSave(settings) {
    saveChain = saveChain.then(async () => {
      try {
        const result = await api.saveSettings(settings);
        saveFailure = null;
        preferencesNotice = (result?.notices || []).join(' ');
      } catch (error) {
        saveFailure = error;
        preferencesNotice = `Settings could not be remembered: ${error?.message || error}`;
      }
      renderPreferencesNotice();
    });
  }

  function drainPendingSave() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (pendingSave) {
      enqueueSave(pendingSave);
      pendingSave = null;
    }
  }

  function rememberCurrentSettings(debounce = false) {
    if (!settingsValid(false)) return;
    const settings = currentSettings();
    rememberedSettings[settings.profileId] = { preset: settings.preset, quality: settings.quality,
      ...(settings.recipeId ? { recipeId: settings.recipeId } : {}) };
    // Do not drop another profile's pending values when switching quickly.
    if (pendingSave && pendingSave.profileId !== settings.profileId) drainPendingSave();
    pendingSave = settings;
    clearTimeout(saveTimer);
    if (debounce) saveTimer = setTimeout(drainPendingSave, 200);
    else drainPendingSave();
  }

  async function flushSettings() {
    drainPendingSave();
    await saveChain;
    if (saveFailure) throw new Error(`Settings could not be remembered: ${saveFailure.message || saveFailure}`);
  }

  function renderPreferencesNotice() {
    visible('preferences-notice', Boolean(preferencesNotice));
    put('preferences-notice', preferencesNotice);
  }

  function applyPreferences(result, message = '') {
    if (!result || !result.settingsByProfile) throw new Error('Remembered workflow information is unavailable.');
    inputFolder = result.inputFolder;
    outputFolder = result.outputFolder;
    rememberedSettings = { ...result.settingsByProfile };
    preferencesNotice = [message, ...(result.notices || [])].filter(Boolean).join(' ');
    if (result.profileId) {
      // Retain a stored unavailable backend; choosing another is the user's
      // decision. A removed profile also remains explicit, without a fallback.
      if (!profiles().some(profile => profile.id === result.profileId)) {
        const option = document.createElement('option');
        option.value = result.profileId;
        option.textContent = `${result.profileId} — unavailable`;
        option.disabled = true;
        byId('profile').append(option);
      }
      byId('profile').value = result.profileId;
    }
    populateProfileSettings();
    render();
  }

  function populateProfileSettings() {
    const profile = selectedProfile();
    byId('preset').replaceChildren();
    if (!profile) {
      selectedRecipeId = rememberedSettings[byId('profile').value]?.recipeId || null;
      for (const id of ['quality', 'quality-slider']) byId(id).value = '';
      put('quality-value', '—');
      put('tested-default-values', 'Unavailable profile');
      put('profile-description', 'Choose an available profile to review a batch.');
      refreshRecipe();
      return;
    }
    for (const preset of profile.presets) {
      const option = document.createElement('option');
      option.value = preset;
      option.textContent = preset;
      byId('preset').append(option);
    }
    const stored = rememberedSettings[profile.id];
    const settings = stored && profile.presets.includes(stored.preset)
      && Number.isInteger(stored.quality) && stored.quality >= profile.quality.min && stored.quality <= profile.quality.max
      ? stored : { preset: profile.defaultPreset, quality: profile.quality.default };
    // A stored recipe remains explicit even when unavailable on this machine.
    // Availability gates preparation; it never silently changes encoder options.
    selectedRecipeId = stored?.recipeId || null;
    byId('preset').value = settings.preset;
    for (const id of ['quality', 'quality-slider']) {
      byId(id).min = profile.quality.min;
      byId(id).max = profile.quality.max;
      byId(id).value = settings.quality;
    }
    put('quality-label', `${profile.quality.mode} quality (${profile.quality.min}–${profile.quality.max})`);
    put('slider-label', `Adjust ${profile.quality.mode}`);
    put('quality-value', settings.quality);
    const depths = profile.supportedBitDepths || profile.bitDepths || [];
    put('profile-description', `${profile.label} · ${depths.length ? `${depths.join(' / ')}-bit supported` : 'See availability details'} · output: name_${profile.suffix}.mkv`);
    put('tested-default-values', `Preset ${profile.defaultPreset} · ${profile.quality.mode} ${profile.quality.default}`);
    refreshRecipe();
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
    for (const recipe of recipes()) {
      const row = document.createElement('li');
      row.textContent = `${recipe.label}: ${recipe.available ? `available · ${(recipe.supportedBitDepths || []).join(' / ')}-bit` : 'unavailable'}${recipe.reason ? ` · ${recipe.reason}` : ''}${recipe.evidenceNote ? ` ${recipe.evidenceNote}` : ''}`;
      if (!recipe.available) row.className = 'unavailable';
      byId('capability-list').append(row);
    }
    const preferred = profiles().find(profile => profile.id === 'h265-cpu') || profiles()[0];
    byId('profile').value = preferred?.id || '';
    if (!profiles().some(profile => profile.available)) {
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
        if (String(other.outputName).toLowerCase() === String(item.outputName).toLowerCase()) selectedIds.delete(other.id);
      }
      selectedIds.add(item.id);
    } else selectedIds.delete(item.id);
    syncSelection();
  }

  function syncSelection() {
    const canSelect = snapshot.phase === 'ready' && !dirty && !pendingCommands;
    const eligible = (snapshot.items || []).filter(item => selectableStatuses.has(item.status));
    const eligibleIds = new Set(eligible.map(item => item.id));
    const retainedIds = snapshot.phase === 'ready' ? eligibleIds : new Set((snapshot.items || []).map(item => item.id));
    selectedIds = new Set([...selectedIds].filter(id => retainedIds.has(id)));
    for (const checkbox of byId('batch-items').querySelectorAll('[data-testid="encode-file"]')) {
      checkbox.checked = selectedIds.has(checkbox.dataset.fileId);
      checkbox.disabled = !canSelect || !eligibleIds.has(checkbox.dataset.fileId);
    }
    put('selected-count', `${selectedIds.size} selected · ${(snapshot.items || []).length} found`);
    const hiddenSelected = (snapshot.items || []).filter(item => selectedIds.has(item.id) && (previewCollapsed || !matchesFilter(item))).length;
    put('hidden-selected-count', `${hiddenSelected} selected hidden`);
    byId('start-batch').disabled = !canSelect || !selectedIds.size || !snapshot.planId;
    byId('select-ready').disabled = !canSelect || !eligible.some(item => item.status === 'ready');
    byId('clear-selection').disabled = !canSelect || !selectedIds.size;
    const authorizable = new Set((snapshot.items || []).filter(canAuthorize).map(item => item.id));
    reencodeChoices = new Set([...reencodeChoices].filter(id => authorizable.has(id)));
    for (const checkbox of byId('batch-items').querySelectorAll('[data-testid="choose-reencode"]')) {
      checkbox.checked = reencodeChoices.has(checkbox.dataset.fileId);
      checkbox.disabled = !canSelect || !authorizable.has(checkbox.dataset.fileId);
    }
    byId('reencode-selected').disabled = !canSelect || !reencodeChoices.size;
    const hiddenChoices = (snapshot.items || []).filter(item => reencodeChoices.has(item.id) && (previewCollapsed || !matchesFilter(item))).length;
    put('reencode-selected-count', `${reencodeChoices.size} chosen for authorization${hiddenChoices ? ` · ${hiddenChoices} hidden` : ''}`);
  }

  function matchesFilter(item) {
    return batchFilter === 'all' || (batchFilter === 'attention' && attentionStatuses.has(item.status))
      || (batchFilter === 'skipped' && item.status === 'skipped')
      || (batchFilter === 'generated' && isGenerated(item));
  }

  async function authorizeReencode(fileIds) {
    const next = await api.reencodeOutputs({ planId: snapshot.planId, fileIds });
    applySnapshot(next);
    for (const id of fileIds) {
      reencodeChoices.delete(id);
      const current = snapshot.items.find(item => item.id === id);
      if (current?.reencodeAuthorized && current.status === 'ready') selectedIds.add(id);
    }
    syncSelection();
  }

  function generationSummary(item) {
    const previous = item.origin?.previousGeneration;
    if (!previous) return isGenerated(item)
      ? 'Generated by FFmpeg Encoder · previous settings unavailable'
      : item.origin?.kind === 'legacy' || item.status === 'ambiguous'
        ? 'Historical filename evidence · exact generation details unknown' : '';
    // Never infer previous settings from suffixes, current controls or codecs
    // found in the stream. Only main's validated descriptive provenance is used.
    const previousRecipe = recipes().find(recipe => recipe.id === previous.recipeId);
    return `${previous.codec} · ${previous.backend} · ${previous.encoder}${previousRecipe ? ` · ${previousRecipe.label}` : ''} · preset ${previous.preset} · ${previous.qualityMode} ${previous.quality} · ${previous.bitDepth}-bit`;
  }

  function originLabel(item) {
    if (isGenerated(item)) return item.reencodeAuthorized ? 'Generated output · Re-encoding authorized' : 'Generated output · Excluded';
    if (item.origin?.kind === 'legacy' || item.status === 'ambiguous') return 'Possible previous output';
    if (item.origin?.kind === 'suspicious') return 'Uncertain provenance';
    return 'Original';
  }

  async function loadEncodingDetails(entry) {
    if (!entry.commandDetails.open || !snapshot.planId || dirty) return;
    const requestKey = `${snapshot.planId}:${entry.item.id}:${entry.item.status}`;
    if (entry.commandKey === requestKey) return;
    entry.commandKey = requestKey;
    entry.commandNotice.textContent = 'Loading the production plan…';
    entry.commandArgs.textContent = '';
    try {
      const details = await api.getEncodingDetails({ planId: snapshot.planId, fileId: entry.item.id });
      if (entry.commandKey !== requestKey || !itemRows.has(entry.item.id)) return;
      entry.commandHeading.textContent = details.kind === 'actual-invocation' ? 'Executed FFmpeg arguments' : 'Resolved FFmpeg argument template';
      entry.commandNotice.textContent = `${details.notice} Each JSON string below is one literal argument in order. This is not a shell command.${details.outputPlaceholder ? ` ${details.outputPlaceholder} is replaced by the protected temporary output path at execution.` : ''}`;
      entry.commandExecutable.textContent = `Executable: ${details.executable}`;
      entry.commandDestination.textContent = `Published destination: ${details.destination}`;
      entry.commandArgs.textContent = formatArguments(details.args);
    } catch (error) {
      if (entry.commandKey !== requestKey) return;
      entry.commandNotice.textContent = `Resolved arguments unavailable: ${error?.message || error}`;
      entry.commandExecutable.textContent = '';
      entry.commandDestination.textContent = '';
      entry.commandKey = null;
    }
  }

  function createItemRow(item) {
    const row = document.createElement('tr');
    row.dataset.fileId = item.id;
    const useCell = document.createElement('td');
    useCell.className = 'selection-cell';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.testid = 'encode-file';
    checkbox.dataset.fileId = item.id;
    checkbox.addEventListener('change', () => {
      const current = itemRows.get(item.id)?.item;
      if (current) changeSelection(current, checkbox.checked);
    });
    useCell.append(checkbox);
    const fileCell = document.createElement('td');
    const details = document.createElement('details');
    details.className = 'file-details';
    details.dataset.testid = 'file-details';
    details.dataset.fileId = item.id;
    const name = document.createElement('summary');
    name.className = 'file-name';
    const body = document.createElement('div');
    body.className = 'file-detail-body';
    const output = document.createElement('p');
    output.className = 'output-name';
    const summary = document.createElement('p');
    summary.className = 'file-detail';
    const reason = document.createElement('p');
    reason.className = 'item-reason';
    const sampling = document.createElement('p');
    sampling.className = 'file-detail';
    const metadata = document.createElement('p');
    metadata.className = 'file-detail';
    metadata.dataset.testid = 'metadata-notices';
    const origin = document.createElement('p');
    origin.className = 'origin-label';
    origin.dataset.testid = 'origin-label';
    const previous = document.createElement('p');
    previous.className = 'file-detail previous-generation';
    previous.dataset.testid = 'previous-generation';
    const previousDetails = document.createElement('details');
    previousDetails.className = 'encoding-details';
    previousDetails.dataset.testid = 'previous-generation-details';
    const previousHeading = document.createElement('summary');
    previousHeading.textContent = 'Previous generation details';
    const previousInfo = document.createElement('p');
    previousInfo.className = 'hint';
    const previousArgs = document.createElement('pre');
    previousArgs.className = 'argument-list';
    previousArgs.tabIndex = 0;
    previousArgs.setAttribute('aria-label', 'Recorded previous encoder arguments');
    previousDetails.append(previousHeading, previousInfo, previousArgs);
    const action = document.createElement('button');
    action.type = 'button';
    action.dataset.testid = 'treat-as-original';
    action.dataset.fileId = item.id;
    action.className = 'subtle';
    action.textContent = 'Treat as original';
    action.title = 'This ambiguous, unmarked legacy file is an original, not a previous output. Applies only to this unchanged file in the current prepared plan.';
    action.addEventListener('click', () => command(async () => {
      const next = await api.treatAsOriginal({ planId: snapshot.planId, fileId: item.id });
      applySnapshot(next);
      if (next.items.find(entry => entry.id === item.id)?.status === 'ready') selectedIds.add(item.id);
      syncSelection();
    }));
    const reencodeBox = document.createElement('div');
    reencodeBox.className = 'reencode-actions';
    const reencodeChoiceLabel = document.createElement('label');
    const reencodeChoice = document.createElement('input');
    reencodeChoice.type = 'checkbox';
    reencodeChoice.dataset.testid = 'choose-reencode';
    reencodeChoice.dataset.fileId = item.id;
    const choiceText = document.createElement('span');
    choiceText.textContent = 'Choose for re-encoding';
    reencodeChoiceLabel.append(reencodeChoice, choiceText);
    reencodeChoice.addEventListener('change', () => {
      if (reencodeChoice.checked) reencodeChoices.add(item.id);
      else reencodeChoices.delete(item.id);
      syncSelection();
    });
    const reencode = document.createElement('button');
    reencode.type = 'button';
    reencode.className = 'subtle';
    reencode.dataset.testid = 'reencode-output';
    reencode.dataset.fileId = item.id;
    reencode.textContent = 'Re-encode this output';
    reencode.setAttribute('aria-describedby', 'reencode-warning');
    reencode.addEventListener('click', () => command(() => authorizeReencode([item.id])));
    reencodeBox.append(reencodeChoiceLabel, reencode);
    const commandDetails = document.createElement('details');
    commandDetails.className = 'encoding-details';
    commandDetails.dataset.testid = 'encoding-details';
    const commandHeading = document.createElement('summary');
    commandHeading.textContent = 'Resolved FFmpeg arguments';
    const commandNotice = document.createElement('p');
    commandNotice.className = 'hint';
    commandNotice.dataset.testid = 'command-notice';
    const commandExecutable = document.createElement('p');
    commandExecutable.className = 'hint';
    commandExecutable.dataset.testid = 'resolved-executable';
    const commandDestination = document.createElement('p');
    commandDestination.className = 'hint';
    const commandArgs = document.createElement('pre');
    commandArgs.className = 'argument-list';
    commandArgs.dataset.testid = 'resolved-args';
    commandArgs.tabIndex = 0;
    commandArgs.setAttribute('aria-label', 'Resolved FFmpeg arguments, one JSON string per argument');
    commandDetails.append(commandHeading, commandNotice, commandExecutable, commandDestination, commandArgs);
    commandDetails.addEventListener('toggle', () => {
      const entry = itemRows.get(item.id);
      if (entry) loadEncodingDetails(entry);
    });
    body.append(output, summary, reason, metadata, sampling, previousDetails, action, commandDetails);
    details.append(name, body);
    // Classification and its deliberate action stay visible in compact rows.
    // Heavy provenance/argument details expand only when requested.
    fileCell.append(details, origin, previous, reencodeBox);
    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    statusCell.append(status);
    row.append(useCell, fileCell, statusCell);
    return { row, checkbox, details, name, output, summary, reason, metadata, sampling, action, status, item, key: '', origin, previous,
      previousDetails, previousInfo, previousArgs, reencodeBox, reencodeChoice, reencode,
      commandDetails, commandHeading, commandNotice, commandExecutable, commandDestination, commandArgs, commandKey: null };
  }

  function renderItems() {
    const items = snapshot.items || [];
    const tbody = byId('batch-items');
    const ids = new Set(items.map(item => item.id));
    for (const [id, entry] of itemRows) {
      if (!ids.has(id)) { entry.row.remove(); itemRows.delete(id); }
    }
    // Keep each row and native details element alive as statuses change. That
    // preserves focus, expansion and scroll without virtualizing this file scale.
    for (const [index, item] of items.entries()) {
      let entry = itemRows.get(item.id);
      if (!entry) { entry = createItemRow(item); itemRows.set(item.id, entry); }
      entry.item = item;
      const key = JSON.stringify([item.name, item.outputName, item.status, item.reason, item.summary, item.origin, item.reencodeAuthorized]);
      if (key !== entry.key) {
        entry.key = key;
        entry.checkbox.setAttribute('aria-label', `Encode ${item.name}`);
        entry.name.textContent = item.name;
        entry.name.title = item.name;
        entry.output.textContent = `Output: ${item.outputName || 'No output destination'}`;
        entry.summary.textContent = mediaSummary(item.summary);
        entry.summary.hidden = !entry.summary.textContent;
        entry.reason.textContent = item.reason || '';
        entry.reason.hidden = !item.reason;
        // Main's inspection describes container representation changes. Render
        // plain text only; media metadata never becomes HTML or IPC authority.
        entry.metadata.textContent = (item.summary?.metadataNotices || []).join(' ');
        entry.metadata.hidden = !entry.metadata.textContent;
        entry.sampling.textContent = item.summary?.samplingLimit ? `Color inspection limits: ${item.summary.samplingLimit}` : '';
        entry.sampling.hidden = !entry.sampling.textContent;
        entry.action.hidden = item.status !== 'ambiguous';
        entry.origin.textContent = originLabel(item);
        entry.origin.className = `origin-label${isGenerated(item) ? ' origin-generated' : item.status === 'ambiguous' ? ' origin-legacy' : ''}`;
        entry.origin.title = [item.origin?.reason, item.origin?.descriptionNotice].filter(Boolean).join(' ');
        entry.previous.textContent = generationSummary(item);
        entry.previous.hidden = !entry.previous.textContent;
        const previous = item.origin?.previousGeneration;
        entry.previousDetails.hidden = !previous;
        entry.previousInfo.textContent = previous
          ? `${generationSummary(item)} · FFmpeg Encoder ${previous.appVersion}${previous.runtimeVersion ? ` · ${previous.runtimeVersion}` : ''} · ${previous.createdAt}. Recorded encoder arguments are descriptive provenance, not a complete previous invocation.` : '';
        entry.previousArgs.textContent = previous ? formatArguments(previous.encoderArgs) : '';
        entry.reencodeBox.hidden = !canAuthorize(item);
        entry.reencodeChoice.setAttribute('aria-label', `Choose ${item.name} for re-encoding authorization`);
        entry.commandDetails.hidden = !['ready', 'conflict', 'pending', 'running', 'success', 'failed', 'cancelled', 'unprocessed'].includes(item.status);
        if (entry.commandDetails.open && !entry.commandDetails.hidden) loadEncodingDetails(entry);
        const knownStatus = Object.hasOwn(statusLabels, item.status) ? item.status : 'pending';
        entry.status.className = `status status-${knownStatus}`;
        entry.status.textContent = statusLabels[knownStatus];
        entry.status.title = item.reason || statusLabels[knownStatus];
      }
      entry.row.hidden = !matchesFilter(item);
      if (tbody.children[index] !== entry.row) tbody.insertBefore(entry.row, tbody.children[index] || null);
    }
    const counts = { all: items.length, attention: items.filter(item => attentionStatuses.has(item.status)).length,
      skipped: items.filter(item => item.status === 'skipped').length, generated: items.filter(isGenerated).length };
    const filterLabels = { all: 'All', attention: 'Needs attention', skipped: 'Skipped', generated: 'Generated outputs' };
    for (const option of byId('batch-filter').options) option.textContent = `${filterLabels[option.value]} (${counts[option.value]})`;
    byId('batch-filter').value = batchFilter;
    put('filter-count', `${counts[batchFilter]} of ${items.length} files`);
    visible('preview-list', !previewCollapsed);
    byId('preview-collapse').setAttribute('aria-expanded', String(!previewCollapsed));
    put('preview-collapse', previewCollapsed ? 'Expand file list' : 'Collapse file list');
    visible('filter-empty', !counts[batchFilter]);
    visible('attention-warning', counts.attention > 0);
    const problems = [...attentionStatuses].map(status => {
      const count = items.filter(item => item.status === status).length;
      return count ? `${count} ${statusLabels[status].toLowerCase()}` : '';
    }).filter(Boolean);
    put('attention-warning', problems.length ? `Needs attention: ${problems.join(' · ')}. Expand a filename for its reason and available actions.` : '');
    visible('empty-message', !items.length);
    visible('reencode-toolbar', counts.generated > 0 && snapshot.phase === 'ready' && !dirty);
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
    byId('profile').disabled = locked || !capabilities;
    for (const id of ['preset', 'quality', 'quality-slider', 'tested-default']) byId(id).disabled = locked || !selectedProfile();
    const candidate = profileRecipe();
    const activeRecipe = selectedRecipe();
    visible('archive-quality-row', Boolean(candidate || selectedRecipeId));
    put('archive-quality', candidate ? `Apply ${candidate.label}` : 'Archive Quality unavailable');
    byId('archive-quality').disabled = locked || !selectedProfile()?.available || !candidate?.available;
    byId('clear-recipe').disabled = locked;
    visible('clear-recipe', Boolean(selectedRecipeId));
    visible('active-recipe', Boolean(selectedRecipeId));
    const modifiedRecipe = activeRecipe && (byId('preset').value !== activeRecipe.preset || byId('quality').valueAsNumber !== activeRecipe.quality);
    put('active-recipe', selectedRecipeId ? `${activeRecipe?.label || selectedRecipeId} active${modifiedRecipe ? ' · modified preset/quality' : ''}. Compound encoder options remain active; inspect Current encoding recipe for every option.` : '');
    const unavailableRecipe = Boolean((selectedRecipeId && !activeRecipe?.available) || (candidate && !candidate.available));
    visible('recipe-unavailable', unavailableRecipe);
    put('recipe-unavailable', unavailableRecipe ? `${activeRecipe?.label || candidate?.label || selectedRecipeId}: ${activeRecipe?.reason || candidate?.reason || 'Recipe unavailable on this computer.'}${selectedRecipeId ? ' Select Use standard options or Tested Default to review a batch without this recipe.' : ' Standard settings and Tested Default remain available.'}` : '');
    for (const id of ['forget-preferences', 'clear-inspection-cache']) byId(id).disabled = locked || !capabilities;
    byId('prepare-batch').disabled = locked || !inputFolder?.id || !outputFolder?.id || inputFolder.available === false || outputFolder.available === false || !settingsValid();
    byId('new-batch').disabled = locked || !terminal;
    put('input-path', inputFolder?.path || 'No folder selected');
    put('output-path', outputFolder?.path || 'No folder selected');
    for (const [role, folder] of [['input', inputFolder], ['output', outputFolder]]) {
      const unavailable = Boolean(folder && (!folder.id || folder.available === false));
      visible(`${role}-unavailable`, unavailable);
      put(`${role}-unavailable`, unavailable ? `${folder.reason || 'Remembered folder is unavailable.'} Choose a folder to continue.` : '');
    }
    const profileUnavailable = Boolean(capabilities && !selectedProfile()?.available);
    visible('profile-unavailable', profileUnavailable);
    put('profile-unavailable', profileUnavailable ? `Selected profile is unavailable: ${selectedProfile()?.reason || 'This profile cannot initialize on this computer.'} Choose an available profile to review a batch.` : '');
    renderPreferencesNotice();
    put('effective-settings', snapshot.settings ? `Effective settings: ${describeSettings(snapshot.settings)}` : '');
    put('monitor-settings', describeSettings(snapshot.settings));
    const hasEligible = (snapshot.items || []).some(item => selectableStatuses.has(item.status));
    put('preview-message', ready && !hasEligible
      ? 'Nothing to encode in this batch. Review the skipped or unsupported reasons below, or change your folders and settings.'
      : showResults ? 'Completed batch. Each file result and any skipped or unsupported reason is shown below.'
        : 'Select files to encode. Existing outputs stay unchanged. For conflicting output names, select one input per destination.');
    renderItems(); renderTelemetry();
    for (const action of byId('batch-items').querySelectorAll('[data-testid="treat-as-original"], [data-testid="reencode-output"]')) action.disabled = locked || !ready;
    const recovery = snapshot.provenanceRecovery;
    if (byId('provenance-notice')) {
      const show = recovery && (recovery.matching || recovery.absent || recovery.unrelated || recovery.uncertain || recovery.warnings?.length);
      visible('provenance-notice', Boolean(show));
      put('provenance-notice', show ? `Previous output bookkeeping: ${recovery.matching} matching · ${recovery.absent} absent · ${recovery.unrelated} unrelated · ${recovery.uncertain} uncertain. No files were changed.${recovery.warnings?.length ? ' ' + recovery.warnings[0] : ''}` : '');
    }
    if (showResults) {
      for (const key of ['success', 'failed', 'skipped', 'cancelled', 'unprocessed']) put(`count-${key}`, snapshot.counts?.[key] || 0);
      put('result-phase', phaseLabels[phase]);
      put('result-message', phase === 'completed' ? 'The batch has finished. Review individual results above; skipped and unsupported files are listed with their reasons.' : phase === 'cancelled' ? 'The operation was cancelled. Completed outputs are preserved. Remaining files were not encoded.' : snapshot.error || 'The batch stopped. Review the file results before preparing a new batch.');
    }
  }

  byId('profile').addEventListener('change', () => {
    drainPendingSave(); populateProfileSettings(); invalidatePreview(); rememberCurrentSettings();
  });
  byId('preset').addEventListener('change', () => { invalidatePreview(); rememberCurrentSettings(); refreshRecipe(); });
  byId('quality').addEventListener('input', () => {
    const value = byId('quality').valueAsNumber;
    if (finite(value)) byId('quality-slider').value = value;
    put('quality-value', finite(value) ? value : '—'); invalidatePreview(); rememberCurrentSettings(true); refreshRecipe();
  });
  byId('quality-slider').addEventListener('input', () => {
    byId('quality').value = byId('quality-slider').value;
    put('quality-value', byId('quality').value); invalidatePreview(); rememberCurrentSettings(true); refreshRecipe();
  });
  for (const id of ['quality', 'quality-slider']) byId(id).addEventListener('change', () => rememberCurrentSettings());
  byId('tested-default').addEventListener('click', () => command(async () => {
    await flushSettings();
    const result = await api.resetProfile({ profileId: byId('profile').value });
    applyPreferences(result, 'Tested Default applied to the current profile. You can edit these values.');
    invalidatePreview();
  }));
  byId('archive-quality').addEventListener('click', () => command(async () => {
    const recipe = profileRecipe();
    if (!recipe?.available || !selectedProfile()?.available) throw new Error(recipe?.reason || 'Archive Quality is unavailable on this computer.');
    await flushSettings();
    selectedRecipeId = recipe.id;
    byId('preset').value = recipe.preset;
    for (const id of ['quality', 'quality-slider']) byId(id).value = recipe.quality;
    put('quality-value', recipe.quality);
    invalidatePreview(); rememberCurrentSettings(); refreshRecipe();
    // The helper exposes its complete production contribution immediately;
    // native preset/quality controls remain available for deliberate changes.
    byId('current-recipe').open = true;
    await flushSettings();
  }));
  byId('clear-recipe').addEventListener('click', () => command(async () => {
    await flushSettings();
    selectedRecipeId = null;
    invalidatePreview(); rememberCurrentSettings(); refreshRecipe();
    await flushSettings();
  }));
  byId('forget-preferences').addEventListener('click', () => command(async () => {
    // Drain pending writes before forgetting, so an older debounce cannot
    // restore locations/settings after the explicit reset has completed.
    drainPendingSave(); await saveChain;
    const result = await api.forgetPreferences();
    saveFailure = null;
    applyPreferences(result, 'Remembered locations/settings forgotten. Output provenance and media were preserved.');
    invalidatePreview();
  }));
  byId('clear-inspection-cache').addEventListener('click', () => command(async () => {
    await flushSettings();
    const result = await api.clearInspectionCache();
    preferencesNotice = result?.cleared
      ? 'Inspection cache cleared. Remembered settings, output provenance and media were preserved.'
      : result?.notice || 'Inspection cache could not be cleared.';
    if (result?.cleared && result.notice) preferencesNotice += ` ${result.notice}`;
    renderPreferencesNotice();
  }));
  byId('batch-filter').addEventListener('change', () => {
    batchFilter = byId('batch-filter').value;
    previewCollapsed = false;
    renderItems();
  });
  byId('preview-collapse').addEventListener('click', () => { previewCollapsed = !previewCollapsed; renderItems(); });
  byId('reencode-selected').addEventListener('click', () => command(() => authorizeReencode([...reencodeChoices])));
  byId('choose-input').addEventListener('click', () => command(async () => {
    await flushSettings();
    const selected = await api.chooseInputFolder();
    if (selected) { inputFolder = selected; invalidatePreview(); }
  }));
  byId('choose-output').addEventListener('click', () => command(async () => {
    await flushSettings();
    const selected = await api.chooseOutputFolder();
    if (selected) { outputFolder = selected; invalidatePreview(); }
  }));
  byId('prepare-batch').addEventListener('click', () => command(async () => {
    if (!settingsValid() || !inputFolder?.id || !outputFolder?.id || inputFolder.available === false || outputFolder.available === false) throw new Error('Choose both folders and valid encoding settings.');
    rememberCurrentSettings();
    await flushSettings();
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
    editing = true; dirty = true; selectedIds.clear(); reencodeChoices.clear(); uiError = ''; render();
    if (!capabilities) command(loadCapabilities);
    byId('setup-heading').scrollIntoView({ block: 'start' });
  });

  // One in-flow explanation area sits below every encoder control. An open
  // explanation must never cover the next control or its help affordance.
  // Keep the existing disclosures as triggers and move their real content,
  // retaining IDs/accessible descriptions without duplicated recipe text.
  const helpDisplay = byId('control-help-display');
  let activeHelp = null;
  let helpCloseTimer = null;
  let restoringHelpFocus = false;
  function closeHelp() {
    clearTimeout(helpCloseTimer);
    if (!activeHelp) return;
    // Closing by outside interaction or another help trigger must clear the
    // old pin too, so the next deliberate click pins instead of toggling stale state.
    activeHelp.pinned = false;
    activeHelp.help.open = false;
    activeHelp.summary.setAttribute('aria-expanded', 'false');
    activeHelp.panel.hidden = true;
    activeHelp = null;
    helpDisplay.hidden = true;
  }
  function showHelp(entry) {
    clearTimeout(helpCloseTimer);
    if (activeHelp !== entry) closeHelp();
    activeHelp = entry;
    entry.help.open = true;
    entry.summary.setAttribute('aria-expanded', 'true');
    entry.panel.hidden = false;
    helpDisplay.hidden = false;
  }
  function scheduleHelpClose(entry) {
    clearTimeout(helpCloseTimer);
    helpCloseTimer = setTimeout(() => {
      if (activeHelp === entry && !entry.pinned && !entry.pointerInside
        && document.activeElement !== entry.summary && !entry.panel.contains(document.activeElement)) closeHelp();
    }, 400);
  }
  for (const help of document.querySelectorAll('.control-help')) {
    const summary = help.querySelector('summary');
    const panel = help.querySelector('.help-panel');
    panel.tabIndex = 0;
    panel.id = `${help.id}-content`;
    panel.hidden = true;
    helpDisplay.append(panel);
    summary.setAttribute('aria-controls', panel.id);
    summary.setAttribute('aria-expanded', 'false');
    const entry = { help, summary, panel, pinned: false, pointerInside: false };
    for (const target of [summary, panel]) {
      target.addEventListener('pointerenter', () => { entry.pointerInside = true; showHelp(entry); });
      target.addEventListener('pointerleave', () => { entry.pointerInside = false; scheduleHelpClose(entry); });
      target.addEventListener('focusin', () => { if (!restoringHelpFocus) showHelp(entry); });
      target.addEventListener('focusout', () => scheduleHelpClose(entry));
    }
    summary.addEventListener('click', event => {
      event.preventDefault();
      entry.pinned = !entry.pinned;
      if (entry.pinned) showHelp(entry);
      else closeHelp();
    });
    summary.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown') { event.preventDefault(); showHelp(entry); panel.focus(); }
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || !activeHelp) return;
    event.preventDefault();
    const previous = activeHelp;
    previous.pinned = false;
    closeHelp();
    restoringHelpFocus = true;
    previous.summary.focus();
    restoringHelpFocus = false;
  });
  document.addEventListener('pointerdown', event => {
    if (activeHelp && !activeHelp.help.contains(event.target) && !activeHelp.panel.contains(event.target)) closeHelp();
  });
  const elapsedTimer = setInterval(renderElapsed, 1000);
  window.addEventListener('beforeunload', () => { drainPendingSave(); clearInterval(elapsedTimer); clearTimeout(recipeTimer); unsubscribe?.(); }, { once: true });
  if (!api) {
    setError(new Error('The application bridge is unavailable. Close and reopen FFmpeg Encoder.'));
    put('activity-message', 'Unable to connect to the application.');
    return;
  }
  unsubscribe = api.onUpdate(applySnapshot);
  command(async () => {
    applySnapshot(await api.getSnapshot());
    await loadCapabilities();
    applyPreferences(await api.getPreferences());
  });
})();
