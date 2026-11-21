'use strict';

// The renderer presents main-owned state. It never scans folders, constructs an
// FFmpeg command, or decides that a child process has finished. The only system
// authority available here is the named application API exposed by preload.
(() => {
  const api = window.encoder;
  const byId = id => document.getElementById(id);
  const busyPhases = new Set(['checking', 'native-checking', 'preparing', 'running', 'cancelling']);
  const terminalPhases = new Set(['completed', 'cancelled', 'failed']);
  const selectableStatuses = new Set(['ready', 'conflict']);
  const attentionStatuses = new Set(['conflict', 'unsupported', 'ambiguous', 'provenance-issue', 'failed']);
  const statusLabels = {
    ready: 'Ready', conflict: 'Choose one', skipped: 'Skipped', unsupported: 'Unsupported',
    pending: 'Waiting', running: 'Encoding', validating: 'Processing', success: 'Succeeded', failed: 'Failed',
    cancelled: 'Cancelled', unprocessed: 'Unprocessed',
    generated: 'Generated output', ambiguous: 'Possible previous output', 'provenance-issue': 'Provenance issue',
  };
  const phaseLabels = {
    idle: 'Ready', checking: 'Checking encoders', 'native-checking': 'Checking native backend', preparing: 'Inspecting files',
    ready: 'Review batch', running: 'Encoding', cancelling: 'Cancelling',
    completed: 'Completed', cancelled: 'Cancelled', failed: 'Stopped',
  };
  const jobStageLabels = { encoding: 'Encoding', remuxing: 'Remuxing', 'encoder-input-check': 'Checking encoder input',
    'evidence-collection': 'Checking preservation', 'output-validation': 'Validating output', 'source-check': 'Checking source', publication: 'Publishing output' };
  const processingStages = new Set(['encoder-input-check', 'evidence-collection', 'output-validation', 'source-check', 'publication']);
  const currentOperation = () => snapshot.operation || snapshot.operationDraft?.operation || 'encode';
  const isRemux = () => currentOperation() === 'remux';
  const operationName = () => isRemux() ? 'Remux' : 'Encode';
  const currentJobLabel = () => cancelPending ? 'Cancelling' : snapshot.phase === 'running'
    ? snapshot.progress?.stage === 'encoding' && isRemux() ? 'Remuxing'
      : jobStageLabels[snapshot.progress?.stage] || (isRemux() ? 'Remuxing' : phaseLabels.running)
    : phaseLabels[snapshot.phase] || 'Current operation';
  let capabilities = null;
  let developerPreview = null, developerSessionClosed = false, ordinaryRecovery = null, developerSessionChoices = null;
  let nativeState = null;

  function nativeProofMatchesDisplay() {
    const request = nativeState?.selection?.request, settings = request?.settings;
    if (!settings || request.profileId !== byId('native-profile').value || request.bitDepth !== Number(byId('native-depth').value)
        || settings.deviceId !== byId('native-device').value || settings.preset !== byId('native-preset').value
        || settings.mode !== byId('native-mode').value) return false;
    const same = (id, value) => byId(id).value.trim() !== '' && Number(byId(id).value) === value;
    return typeof settings.quality === 'number' ? same('native-quality', settings.quality)
      : Object.entries(settings.quality).every(([key, value]) => same(`native-qp-${key}`, value));
  }
  function renderNativeStatus() {
    if (!nativeState) return;
    put('native-status', nativeState.selection?.probeVerified
      ? nativeProofMatchesDisplay() ? 'Generated sample check passed for these exact settings. File encoding remains unavailable.'
        : 'The displayed settings are not checked. The earlier sample result applies to a different selection.'
      : nativeState.lastOutcome ? `Last check: ${nativeState.lastOutcome.status} · ${nativeState.lastOutcome.reason || 'No exact-settings proof'}${nativeState.lastOutcome.persistenceFailure ? ' · capture was not confirmed saved' : ''}`
      : 'Session inventory only. Choose a device and exact settings to run an explicit sample check.');
  }

  function nativeProfile() { return nativeState?.controls?.find(profile => profile.id === byId('native-profile').value); }
  function nativeOptions(id, entries, preferred) {
    const select = byId(id); select.replaceChildren();
    for (const [value, label] of entries) { const option = document.createElement('option'); option.value = value; option.textContent = label; select.append(option); }
    if (entries.some(([value]) => String(value) === String(preferred))) select.value = preferred;
    else select.value = entries[0]?.[0] ?? '';
  }
  function nativeQualityChanged() {
    const profile = nativeProfile(), mode = profile?.modes[byId('native-mode').value];
    visible('native-scalar-field', Boolean(mode && mode.kind !== 'frame-quantizers'));
    for (const key of ['i', 'p', 'b']) visible(`native-qp-${key}-field`, Boolean(mode?.fields?.includes(key)));
    if (!mode) return;
    for (const id of ['native-quality', 'native-qp-i', 'native-qp-p', 'native-qp-b']) {
      const field = byId(id); field.min = mode.min; field.max = mode.max; field.value = mode.seed;
    }
  }
  function nativeProfileChanged() {
    const profile = nativeProfile();
    nativeOptions('native-device', (nativeState?.devices || []).filter(device => device.backend === profile?.backend)
      .map(device => [device.id, `${device.description} · driver ${device.driverVersion}`]));
    nativeOptions('native-depth', (profile?.bitDepths || []).map(depth => [String(depth), `${depth}-bit`]));
    nativeOptions('native-preset', (profile?.presets || []).map(preset => [preset, preset]), profile?.operationalSeed.preset);
    nativeOptions('native-mode', Object.entries(profile?.modes || {}).map(([id, mode]) => [id, mode.label]), profile?.operationalSeed.mode);
    nativeQualityChanged(); render();
  }
  function showNativeState(next) {
    if (nativeState && next.revision < nativeState.revision) return;
    const preferred = byId('native-profile').value; nativeState = next;
    nativeOptions('native-profile', (next.controls || []).map(profile => [profile.id, `${profile.label} · Beta`]), preferred);
    nativeProfileChanged();
    if (next.selection?.request?.profileId === byId('native-profile').value) {
      const request = next.selection.request, settings = request.settings;
      byId('native-device').value = settings.deviceId; byId('native-depth').value = String(request.bitDepth);
      byId('native-preset').value = settings.preset; byId('native-mode').value = settings.mode; nativeQualityChanged();
      if (typeof settings.quality === 'number') byId('native-quality').value = settings.quality;
      else for (const [key, value] of Object.entries(settings.quality)) byId(`native-qp-${key}`).value = value;
    }
    renderNativeStatus();
  }
  async function loadNativeState() {
    if (typeof api?.getNativeBackendState !== 'function') return;
    showNativeState(await api.getNativeBackendState());
  }
  async function checkNativeSettings() {
    const profile = nativeProfile(), mode = profile?.modes[byId('native-mode').value];
    if (!profile || !mode || !byId('native-device').value) throw new Error('Choose a discovered device and valid native settings.');
    const fields = mode.kind === 'frame-quantizers' ? mode.fields.map(key => `native-qp-${key}`) : ['native-quality'];
    if (fields.some(id => byId(id).value.trim() === '')) throw new Error('Enter each displayed native quality value.');
    const quality = mode.kind === 'frame-quantizers'
      ? Object.fromEntries(mode.fields.map(key => [key, Number(byId(`native-qp-${key}`).value)])) : Number(byId('native-quality').value);
    const values = typeof quality === 'number' ? [quality] : Object.values(quality);
    if (values.some(value => !Number.isInteger(value) || value < mode.min || value > mode.max)) throw new Error('Enter integer native quality values within the displayed limits.');
    try {
      const selected = await api.selectNativeBackend({ revision: nativeState.revision, profileId: profile.id, bitDepth: Number(byId('native-depth').value),
        settings: { deviceId: byId('native-device').value, preset: byId('native-preset').value, mode: byId('native-mode').value, quality } });
      showNativeState(selected);
      showNativeState(await api.qualifyNativeBackend({ selectionId: selected.selection.selectionId, revision: selected.revision }));
    } catch (error) {
      // A failed/cancelled main attempt still advances its revision. Read the
      // inert current DTO so the next explicit check does not reuse old IDs.
      try { await loadNativeState(); } catch { /* retain the actual check error */ }
      throw error;
    }
  }
  let inputFolder = null;
  let outputFolder = null;
  let snapshot = { revision: -1, phase: 'idle', items: [], counts: {}, progress: null };
  let selectedIds = new Set();
  // An explicit re-encode intent is separate from the queue selection. Merely
  // filtering or checking an excluded file never grants main-owned authority.
  let reencodeChoices = new Set();
  let selectionPlanId = null;
  let selectionDraftId = null;
  // This records which folder capabilities created the current draft; it never
  // restores paths or grants. Main alone keeps the file requests and authority.
  let preparedFolderPair = null;
  let dirty = true;
  let editing = true;
  let pendingCommands = 0;
  let cancelPending = false;
  let cancelSettlementFailure = null;
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
  const workspaceNames = ['encode', 'remux', 'jobs', 'history', 'settings', 'help'];
  let activeWorkspace = 'encode';
  let workspaceNavigationRevision = 0;
  // Focus is a presentation cursor, deliberately independent of queue selection
  // and main-owned source/re-encode/omission authority. No draft is cloned here.
  let focusedFileId = null;
  let displayedFileId = null;
  let filesDrawerOpen = false;
  const narrowFilesLayout = typeof window.matchMedia === 'function' ? window.matchMedia('(max-width: 900px)') : null;
  narrowFilesLayout?.addEventListener('change', syncFilesLayout);
  let selectedReviewKey = null;
  let appDefaults = null;
  let defaultsLoading = false;
  let defaultsDirty = false;
  let defaultsNeedsReload = false;
  let runtimeRequest = 0;
  let historyLoaded = false;
  let historyLoading = false;
  let historyRequest = 0;
  let historyRecordRequest = 0;
  let historyExportRequest = 0;
  let historyExportLoading = false;
  let historyEvents = [];
  let historyNextCursor = null;
  let historyCursors = [undefined];
  let historyPage = 0;
  const historySelection = new Set();
  const defaultFields = {
    fullAudioPolicy: 'default-full-audio', rangeAudioPolicy: 'default-range-audio',
    resolution: 'default-resolution', hdrPolicy: 'default-hdr', remuxTarget: 'default-remux-target',
    previewExpanded: 'default-preview-expanded',
  };
  const batchOperationFields = { resolution: 'batch-operation-resolution', fullAudioPolicy: 'batch-operation-full-audio',
    rangeAudioPolicy: 'batch-operation-range-audio', hdrPolicy: 'batch-operation-hdr' };
  const batchOperationEdits = new Set();
  const operationAudioLabels = { copy: 'Copy compatible audio', 'precision-aac': 'Precision AAC', 'precision-flac': 'Precision FLAC' };
  let batchOperationKey = null;
  let operationControlId = 0;
  let draftFiles = new Map();
  let remuxTargetChosen = false;
  const preparedRemuxTarget = () => snapshot.operationDraft?.batchDefaults?.values?.remuxTarget
    || snapshot.items?.find(item => item.remux?.target)?.remux.target;
  const remuxTargetChanged = () => isRemux() && snapshot.phase === 'ready'
    && byId('remux-target').value !== preparedRemuxTarget();

  const vendorProfiles = () => capabilities?.vendorProfiles || [];
  const profiles = () => [...(capabilities?.profiles || []), ...vendorProfiles()];
  const selectedVendorProfile = () => vendorProfiles().find(profile => profile.id === byId('profile').value);
  const untestedHardwareNotice = 'Not yet tested on real AMD/Intel hardware. Results are checked after encoding.';
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

  function setWorkspaceTabStop(name) {
    for (const candidate of workspaceNames) byId(`tab-${candidate}`).tabIndex = candidate === name ? 0 : -1;
  }

  // Workspace navigation changes presentation only. It never prepares, cancels
  // or changes main-owned plans. Manual keyboard activation avoids starting a
  // disk-backed History read merely while arrowing through the tab labels.
  function activateWorkspace(name, focusPanel = false) {
    if (!workspaceNames.includes(name)) return;
    workspaceNavigationRevision++;
    activeWorkspace = name;
    closeHelp();
    setWorkspaceTabStop(name);
    for (const candidate of workspaceNames) {
      const selected = candidate === name;
      byId(`tab-${candidate}`).setAttribute('aria-selected', String(selected));
      visible(`workspace-${candidate}`, selected);
    }
    // Navigation never reinterprets or prepares the main-owned operation.
    visible('location-panel', name === 'encode' || name === 'remux');
    put('location-source-permission', name === 'remux'
      ? 'Recognized generated outputs need deliberate permission as sources for this Remux batch.'
      : 'Recognized generated outputs need deliberate re-encoding permission.');
    if (name === 'remux') {
      renderRemuxSummary();
      if (!appDefaults && !defaultsLoading) void loadAppDefaults();
    }
    if (focusPanel) byId(`workspace-${name}`).focus();
    if (name === 'settings' && !appDefaults && !defaultsLoading) void loadAppDefaults();
    if (name === 'history' && !historyLoaded && !historyLoading) void loadHistoryPage();
    if (name === 'help') void loadRuntimeInformation();
  }

  function localError(id, error) {
    const message = error?.message || (error ? String(error) : '');
    put(id, message); visible(id, Boolean(message));
  }

  let appearance = null;
  let appearanceSaving = false;
  function showAppearance(result, message = '') {
    if (!result || result.schema !== 1 || !['dark', 'light'].includes(result.theme)
      || typeof result.persistence?.persisted !== 'boolean') throw new Error('The appearance preference could not be read.');
    appearance = result;
    // Only the two inert, main-validated names reach CSS. Appearance never
    // adopts processing defaults, changes a draft, or grants media authority.
    document.querySelector('html').dataset.theme = result.theme;
    byId('appearance-theme').value = result.theme;
    const label = result.theme === 'light' ? 'Light' : 'Dark';
    put('appearance-status', [message || (result.persistence.persisted
      ? `${label} theme saved on this device.` : `${label} theme is in use; no saved preference was confirmed.`),
      ...(Array.isArray(result.notices) ? result.notices : [])].join(' '));
  }

  async function loadAppearance() {
    byId('appearance-theme').disabled = true;
    try {
      if (typeof api?.getAppearance !== 'function') throw new Error('Appearance controls are unavailable. Reopen the application.');
      showAppearance(await api.getAppearance());
    } catch (error) {
      localError('appearance-error', error);
      put('appearance-status', 'Using the current application appearance. A saved choice was not confirmed.');
    } finally { byId('appearance-theme').disabled = !appearance; }
  }

  async function saveAppearance() {
    if (!appearance || appearanceSaving) return;
    const theme = byId('appearance-theme').value;
    if (!['dark', 'light'].includes(theme)) {
      byId('appearance-theme').value = appearance.theme;
      localError('appearance-error', new Error('Choose Light or Dark.'));
      return;
    }
    appearanceSaving = true; byId('appearance-theme').disabled = true;
    localError('appearance-error', null); put('appearance-status', 'Saving your theme…');
    try {
      // Dispatch immediately from change, without a timer or beforeunload
      // promise. Main owns the accepted write and drains it before exit.
      showAppearance(await api.saveAppearance({ theme }));
    } catch (error) {
      byId('appearance-theme').value = appearance.theme;
      localError('appearance-error', error);
      put('appearance-status', 'The theme was not saved. Your previous appearance remains in use. Reopen the application before trying again.');
    } finally { appearanceSaving = false; byId('appearance-theme').disabled = false; }
  }

  byId('appearance-theme').addEventListener('change', saveAppearance);

  function renderDefaultActions() {
    byId('app-settings-fields').disabled = !appDefaults || defaultsLoading || Boolean(appDefaults.persistence?.resetRequired);
    byId('app-settings-save').disabled = !appDefaults || defaultsLoading || !defaultsDirty || defaultsNeedsReload || Boolean(appDefaults.persistence?.resetRequired);
    byId('app-settings-reset').disabled = !appDefaults || defaultsLoading || defaultsNeedsReload;
    byId('app-settings-reload').disabled = defaultsLoading;
  }

  function showAppDefaults(result, message = '') {
    if (!result || result.schema !== 1 || !Number.isSafeInteger(result.revision) || !result.defaults) throw new Error('App Settings could not be read.');
    appDefaults = result;
    if (!remuxTargetChosen && !isRemux()) byId('remux-target').value = result.defaults.remuxTarget;
    for (const [field, id] of Object.entries(defaultFields)) {
      if (field === 'previewExpanded') byId(id).checked = result.defaults[field] === true;
      else byId(id).value = result.defaults[field];
    }
    defaultsDirty = false; defaultsNeedsReload = false;
    const state = result.persistence || {};
    put('app-settings-status', [message, `Revision ${result.revision}.`, state.persisted ? 'Confirmed saved locally.' : state.resetRequired ? 'Stored settings need explicit recovery.' : 'Current defaults are not yet confirmed saved.', ...(result.notices || [])].filter(Boolean).join(' '));
    renderRemuxSummary();
  }

  async function loadAppDefaults() {
    if (defaultsLoading) return;
    defaultsLoading = true; renderDefaultActions(); localError('app-settings-error', null);
    put('app-settings-status', 'Reading stored defaults…');
    try { showAppDefaults(await api.getAppSettings()); }
    catch (error) { localError('app-settings-error', error); put('app-settings-status', 'Stored defaults could not be loaded. Current jobs were not changed.'); }
    finally { defaultsLoading = false; renderDefaultActions(); }
  }

  async function saveAppDefaults(reset = false) {
    if (!appDefaults || defaultsLoading || defaultsNeedsReload || (!reset && !defaultsDirty)) return;
    const request = { revision: appDefaults.revision };
    if (!reset) request.defaults = Object.fromEntries(Object.entries(defaultFields).map(([field, id]) =>
      [field, field === 'previewExpanded' ? byId(id).checked : byId(id).value]));
    defaultsLoading = true; renderDefaultActions(); localError('app-settings-error', null);
    try {
      showAppDefaults(await (reset ? api.resetAppSettings(request) : api.saveAppSettings(request)),
        reset ? 'Factory defaults restored.' : 'Defaults saved for new batches.');
    } catch (error) {
      defaultsNeedsReload = true;
      localError('app-settings-error', error);
      put('app-settings-status', 'Save was not confirmed. Your form values are still visible. Reload stored defaults to review their current revision before retrying.');
    } finally { defaultsLoading = false; renderDefaultActions(); }
  }

  async function loadRuntimeInformation() {
    const request = ++runtimeRequest;
    byId('runtime-refresh').disabled = true;
    localError('runtime-error', null); put('runtime-status', 'Reading reported runtime versions…');
    try {
      const information = await api.getRuntimeInformation();
      if (request !== runtimeRequest) return;
      const rows = [['Application', information.appVersion], ['Electron', information.electron], ['Chromium', information.chromium],
        ['Node.js', information.node], ['Platform / architecture', [information.platform, information.architecture].filter(Boolean).join(' / ')]];
      for (const name of ['ffmpeg', 'ffprobe']) {
        const media = information.media?.[name];
        rows.push([name, media?.status === 'observed' && media.version ? media.version : 'Not yet observed in this session']);
      }
      const list = byId('runtime-information'); list.replaceChildren();
      for (const [label, value] of rows) {
        const term = document.createElement('dt'); term.textContent = label;
        const detail = document.createElement('dd'); detail.textContent = value || 'Not reported by this runtime';
        list.append(term, detail);
      }
      put('runtime-locations', ['ffmpeg', 'ffprobe'].map(name => `${name}: ${information.media?.[name]?.executable || 'Not reported'}`).join('\n'));
      put('runtime-status', 'Reported by the running application. A version observation does not establish encoder or device availability.');
    } catch (error) { if (request === runtimeRequest) { localError('runtime-error', error); put('runtime-status', 'Current runtime information is unavailable. Any previous display below has not been refreshed.'); } }
    finally { if (request === runtimeRequest) byId('runtime-refresh').disabled = false; }
  }

  function historyStatus(status) {
    return [status?.available === false ? 'History is currently unavailable.' : '', status?.incomplete ? 'Known gaps: diagnostic history is incomplete.' : '',
      ...(status?.notices || [])].filter(Boolean).join(' ');
  }

  function syncHistorySelection() {
    put('history-selection-count', `${historySelection.size} selected across pages (maximum 50)`);
    byId('history-export').disabled = !historySelection.size || historyLoading || historyExportLoading;
    byId('history-clear-selection').disabled = !historySelection.size || historyExportLoading;
    for (const checkbox of byId('history-items').querySelectorAll('input[type="checkbox"]')) {
      checkbox.checked = historySelection.has(checkbox.dataset.eventId);
      checkbox.disabled = historyExportLoading || (!checkbox.checked && historySelection.size >= 50);
    }
  }

  function invalidateHistoryExport() {
    historyExportRequest++;
    visible('history-export-panel', false); byId('history-export-text').value = '';
  }

  function renderHistoryRows() {
    const list = byId('history-items'); list.replaceChildren();
    for (const event of historyEvents) {
      const row = document.createElement('tr');
      const use = document.createElement('td'); use.className = 'selection-cell';
      const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.eventId = event.id;
      checkbox.setAttribute('aria-label', `Select ${event.reason} for redacted export`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked && historySelection.size < 50) historySelection.add(event.id);
        else historySelection.delete(event.id);
        invalidateHistoryExport(); syncHistorySelection();
      });
      use.append(checkbox);
      const description = document.createElement('td');
      const title = document.createElement('p'); title.className = 'history-event-title'; title.textContent = `${event.stage} · ${event.reason}`;
      const at = new Date(event.at);
      const time = document.createElement('p'); time.className = 'history-event-time'; time.textContent = Number.isFinite(at.getTime()) ? at.toLocaleString() : 'Time unavailable';
      description.append(title, time);
      const action = document.createElement('td');
      const severity = document.createElement('span'); severity.className = 'history-event-severity'; severity.textContent = [event.severity, event.outcome].filter(Boolean).join(' · ');
      const details = document.createElement('button'); details.type = 'button'; details.className = 'subtle'; details.textContent = 'Inspect record';
      details.setAttribute('aria-label', `Inspect ${event.reason}`);
      details.addEventListener('click', () => { void loadHistoryRecord(event.id); });
      action.append(severity, details); row.append(use, description, action); list.append(row);
    }
    visible('history-empty', historyEvents.length === 0);
    syncHistorySelection();
  }

  async function loadHistoryPage(reset = false, nextPage = historyPage) {
    if (historyLoading) return;
    if (reset) {
      historyCursors = [undefined]; nextPage = 0; historySelection.clear();
      invalidateHistoryExport(); historyRecordRequest++; visible('history-record', false);
    }
    const request = ++historyRequest;
    historyLoading = true; localError('history-error', null);
    for (const id of ['history-refresh', 'history-newer', 'history-more']) byId(id).disabled = true;
    syncHistorySelection(); put('history-status', 'Reading saved events…');
    try {
      const cursor = historyCursors[nextPage];
      const result = await api.getDiagnosticHistory({ limit: 50, ...(cursor === undefined ? {} : { cursor }) });
      if (request !== historyRequest) return;
      if (!Array.isArray(result.events) || result.persisted === false) throw new Error(historyStatus(result.status) || 'Saved history could not be read.');
      historyEvents = result.events; historyNextCursor = result.nextCursor; historyPage = nextPage; historyLoaded = true;
      put('history-status', [`Page ${historyPage + 1} · ${historyEvents.length} saved events.`, historyStatus(result.status)].filter(Boolean).join(' '));
      renderHistoryRows();
    } catch (error) { localError('history-error', error); put('history-status', 'History could not be refreshed. Any previously shown records remain unchanged.'); }
    finally {
      historyLoading = false; byId('history-refresh').disabled = false;
      byId('history-newer').disabled = historyPage === 0;
      byId('history-more').disabled = !historyNextCursor;
      syncHistorySelection();
    }
  }

  async function loadHistoryRecord(eventId) {
    const request = ++historyRecordRequest;
    localError('history-error', null); visible('history-record', true);
    put('history-record-json', 'Loading the selected local record…');
    visible('history-stderr', false); visible('history-record-notice', false);
    try {
      // Only the ID returned by History crosses this bridge. No displayed path
      // or record field becomes a read, export or filesystem capability.
      const result = await api.getDiagnosticRecord({ eventId });
      if (request !== historyRecordRequest) return;
      if (!result.event) throw new Error(historyStatus(result.status) || 'This record is missing, changed or expired.');
      const { stderr, ...event } = result.event;
      put('history-record-heading', `Local record · ${event.reason}`);
      put('history-record-json', JSON.stringify(event, null, 2));
      const warnings = [historyStatus(result.status), event.messageTruncated ? 'Message was truncated.' : '', event.contextTruncated ? 'Context was truncated.' : '',
        stderr?.truncated ? 'Only a tail of process diagnostics was captured.' : '', stderr && !Object.hasOwn(stderr, 'totalBytes') ? 'Upstream diagnostic capture completeness is unknown.' : '',
        stderr?.unavailable ? 'Captured process diagnostics are missing or changed.' : ''].filter(Boolean).join(' ');
      visible('history-record-notice', Boolean(warnings)); put('history-record-notice', warnings);
      visible('history-stderr', Boolean(stderr)); put('history-stderr-text', stderr?.unavailable ? 'Captured text is unavailable.' : stderr?.text || 'No diagnostic text was captured.');
    } catch (error) {
      if (request === historyRecordRequest) { put('history-record-json', 'The selected record could not be read.'); localError('history-error', error); }
    }
  }

  async function previewHistoryExport() {
    if (!historySelection.size || historyExportLoading) return;
    const request = ++historyExportRequest;
    const eventIds = [...historySelection];
    historyExportLoading = true; syncHistorySelection(); localError('history-error', null);
    visible('history-export-panel', false);
    try {
      const result = await api.getDiagnosticExportPreview({ eventIds });
      if (request !== historyExportRequest) return;
      if (!result.data || typeof result.json !== 'string') throw new Error(historyStatus(result.status) || 'Redacted preview could not be created.');
      byId('history-export-text').value = result.json;
      put('history-export-notice', [result.data.notice, historyStatus(result.status)].filter(Boolean).join(' '));
      visible('history-export-panel', true);
    } catch (error) { if (request === historyExportRequest) localError('history-error', error); }
    finally { historyExportLoading = false; syncHistorySelection(); }
  }

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
    const preview = next.developerProduct?.enabled ? next.developerProduct
      : next.developerOrdinary?.enabled ? next.developerOrdinary
      : next.developerFullCopy?.enabled ? next.developerFullCopy
      : next.developerResize?.enabled ? next.developerResize : next.developerKeep720;
    if (preview?.enabled) {
      developerPreview = preview;
      developerSessionClosed ||= preview.relaunchRequired === true;
    }
    const previousPhase = snapshot.phase;
    const previousBatch = snapshot.batchId;
    // A new accepted preparation supersedes the failed cancellation; navigation
    // or a repeated terminal event alone is not evidence of cleanup settlement.
    if (cancelSettlementFailure && next.phase === 'ready' && next.planId && next.planId !== cancelSettlementFailure.planId) cancelSettlementFailure = null;
    snapshot = next;
    snapshotReceivedAt = performance.now();
    if (isBusy()) editing = false;
    if (terminalPhases.has(next.phase) && (busyPhases.has(previousPhase) || previousBatch !== next.batchId)) editing = false;
    if (next.phase === 'ready' && next.planId && selectionPlanId !== next.planId) {
      selectionPlanId = next.planId;
      reencodeChoices.clear();
      const sameDraft = next.operationDraft?.id && selectionDraftId === next.operationDraft.id;
      if (!sameDraft && isRemux() && preparedRemuxTarget()) byId('remux-target').value = preparedRemuxTarget();
      selectedIds = new Set((next.items || []).filter(item => sameDraft
        ? selectedIds.has(item.id) && selectableStatuses.has(item.status) : item.status === 'ready').map(item => item.id));
      selectionDraftId = next.operationDraft?.id || null;
      dirty = Boolean(next.encodingSettingsStale);
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

  function invalidatePreview(encodingOnly = false) {
    // Editing the retained Encode controls cannot revoke a Remux preview.
    // Main independently enforces the same operation boundary on autosave.
    if (encodingOnly && isRemux()) { render(); return; }
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
        if (selectedVendorProfile()) updateQualityLabels(selectedProfile(), recipe.qualityMode);
        const defaults = selectedVendorProfile() ? recipe.startingValues : recipe.testedDefault;
        put('default-recipe-label', `${defaults.label} · ${defaults.encoder} · preset ${defaults.settings.preset} · ${defaults.qualityMode} ${defaults.settings.quality}`);
        put('default-args', formatArguments(defaults.args));
        put('tested-default-values', `Preset ${defaults.settings.preset} · ${defaults.qualityMode} ${defaults.settings.quality}`);
        byId('tested-default').title = selectedProfile()?.candidateFixedSettings === true ? 'Restores this route’s fixed candidate settings. Inspect the adjacent help for its exact encoder arguments.' : `${selectedVendorProfile() ? 'Applies untested starting values: ' : 'Applies '}preset ${defaults.settings.preset} and ${defaults.qualityMode} ${defaults.settings.quality}. Inspect the adjacent help for all production encoder options.`;
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

  async function settleWorkspaceSettings() {
    if (activeWorkspace !== 'remux') return flushSettings();
    // Retain pending Encode preference writes without making their success a
    // prerequisite for the independent stream-copy preparation route.
    drainPendingSave(); await saveChain;
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

  function updateQualityLabels(profile, mode = profile.quality.mode) {
    put('quality-label', `${mode} quality (${profile.quality.min}–${profile.quality.max})`);
    put('slider-label', `Adjust ${mode}`);
    put('quality-hint', selectedVendorProfile()
      ? `${mode} values are untested starting values. Equal numbers across profiles do not mean equal quality.`
      : 'CRF and NVIDIA VBR-CQ differ. Equal numbers across profiles do not mean equal quality.');
    byId('quality-hint').title = selectedVendorProfile()
      ? `${mode} uses this encoder's rate control. Lower values generally request higher quality. Values are not equivalent to CRF or CQ.`
      : 'CPU CRF and NVIDIA VBR-CQ use different rate-control systems. Lower values generally request higher quality within the same encoder; equal numbers across encoders do not imply equal perceptual quality.';
  }

  function populateProfileSettings() {
    const profile = selectedProfile();
    const vendor = selectedVendorProfile();
    visible('profile-untested', Boolean(vendor));
    // Help panels live in the shared display. Revoke an open vendor disclosure
    // on profile changes too, so its text cannot outlive the selected encoder.
    if (activeHelp?.help === byId('profile-untested')) closeHelp();
    put('profile-untested-disclosure', vendor ? vendor.hardware === 'AMD'
      ? 'The app cannot confirm which encoder settings AMD actually used.'
      : 'The app cannot prove which Intel adapter encoded the file.' : '');
    const fixedCandidate = profile?.candidateFixedSettings === true;
    put('tested-default', fixedCandidate ? 'Candidate settings' : vendor ? 'Starting values' : 'Tested Default');
    byId('tested-default').setAttribute('aria-label', fixedCandidate ? 'Restore fixed candidate settings' : vendor
      ? 'Reset current profile to untested starting values' : 'Reset current profile to Tested Default');
    byId('default-help').setAttribute('aria-label', fixedCandidate ? 'Inspect fixed candidate settings and arguments' : vendor
      ? 'Inspect untested starting values and arguments' : 'Inspect Tested Default values and arguments');
    byId('default-args').setAttribute('aria-label', fixedCandidate ? 'Fixed candidate encoder arguments' : vendor ? 'Untested starting value encoder arguments' : 'Tested Default encoder arguments');
    put('default-help-text', fixedCandidate ? 'This experimental route uses fixed candidate settings, not the production Tested Default. Other settings require a different qualified route.' : vendor
      ? 'These are untested starting values for this encoder, and remain editable. They are not a claim of optimal quality.'
      : "The current profile's tested operational starting point remains editable. It is not a claim of universally optimal quality.");
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
    updateQualityLabels(profile);
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
    for (const profile of result.profiles) {
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
    for (const hardware of ['AMD', 'Intel']) {
      const entries = vendorProfiles().filter(profile => profile.hardware === hardware);
      if (!entries.length) continue;
      const group = document.createElement('optgroup');
      group.label = `${hardware} — not yet tested on real hardware`;
      for (const profile of entries) {
        const option = document.createElement('option');
        option.value = profile.id;
        option.textContent = `${profile.label} ⚠${profile.available ? '' : ' — unavailable'}`;
        option.disabled = !profile.available;
        if (!profile.available) option.title = profile.reason;
        group.append(option);
        const row = document.createElement('li');
        const depths = profile.supportedBitDepths || [];
        const failures = (profile.checks || []).filter(check => !check.available);
        row.textContent = `${profile.label} ⚠${profile.device ? ` · ${profile.device.description}` : ''}: `
          + (profile.available ? `${depths.join(' / ')}-bit${failures.length ? ' only on this computer' : ' supported on this computer'}`
            + failures.map(check => ` — ${check.bitDepth}-bit: ${check.reason}`).join('') : profile.reason)
          + (profile.disclosures || []).map(disclosure => ` · ${disclosure.message}`).join('');
        if (!profile.available) row.className = 'unavailable';
        byId('capability-list').append(row);
      }
      byId('profile').append(group);
    }
    for (const recipe of recipes()) {
      const row = document.createElement('li');
      row.textContent = `${recipe.label}: ${recipe.available ? `available · ${(recipe.supportedBitDepths || []).join(' / ')}-bit` : 'unavailable'}${recipe.reason ? ` · ${recipe.reason}` : ''}${recipe.evidenceNote ? ` ${recipe.evidenceNote}` : ''}`;
      if (!recipe.available) row.className = 'unavailable';
      byId('capability-list').append(row);
    }
    for (const backend of result.backendDiscovery?.profiles || []) {
      const row = document.createElement('li');
      const explanation = backend.reason === 'MISSING_DEVICE' ? 'No matching hardware was discovered.'
        : backend.reason === 'UNSUPPORTED_CODEC' ? 'This runtime does not contain the encoder wrapper.'
        : backend.reason === 'CHOOSE_AND_QUALIFY_CELL' ? 'Hardware discovered; native runtime and exact settings still need qualification.'
        : 'Discovery or qualification is incomplete.';
      const family = /_amf$/.test(backend.encoder) ? 'AMD AMF — Beta' : /_qsv$/.test(backend.encoder) ? 'Intel Quick Sync — Beta' : 'Backend discovery';
      row.textContent = `${family} · ${backend.encoder}: ${backend.state} · ${explanation} Local hardware execution is not established by discovery. Exact device/runtime/driver/rate-control/depth/transform qualification is required. No automatic fallback.`;
      row.className = 'unavailable';
      byId('capability-list').append(row);
    }
    for (const notice of result.backendDiscovery?.notices || []) {
      const row = document.createElement('li'); row.textContent = notice;
      byId('capability-list').append(row);
    }
    const preferred = profiles().find(profile => profile.id === 'h265-cpu') || profiles()[0];
    byId('profile').value = preferred?.id || '';
    if (!profiles().some(profile => profile.available)) {
      byId('capability-details').open = true;
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

  function sourceMediaSummary(summary) {
    // item.summary is the input inspection, not the validated output probe.
    // A requested trim or resize is not authority to invent output metadata.
    const text = mediaSummary(summary);
    return text ? `Source metadata: ${text}` : '';
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
    syncFilesDrawerPresentation();
    const canSelect = snapshot.phase === 'ready' && !dirty && !pendingCommands && !developerSessionClosed;
    const eligible = (snapshot.items || []).filter(item => selectableStatuses.has(item.status));
    const eligibleIds = new Set(eligible.map(item => item.id));
    const retainedIds = snapshot.phase === 'ready' ? eligibleIds : new Set((snapshot.items || []).map(item => item.id));
    selectedIds = new Set([...selectedIds].filter(id => retainedIds.has(id)));
    for (const checkbox of byId('batch-items').querySelectorAll('[data-testid="encode-file"]')) {
      checkbox.checked = selectedIds.has(checkbox.dataset.fileId);
      checkbox.disabled = !canSelect || !eligibleIds.has(checkbox.dataset.fileId);
    }
    put('selected-count', `${selectedIds.size} selected · ${(snapshot.items || []).length} found`);
    const hiddenSelected = (snapshot.items || []).filter(item => selectedIds.has(item.id) && outsideFileListView(item)).length;
    put('hidden-selected-count', `${hiddenSelected} selected hidden`);
    byId('start-batch').disabled = !canSelect || !selectedIds.size || !snapshot.planId || hasOperationEdits() || remuxTargetChanged();
    byId('select-ready').disabled = !canSelect || !eligible.some(item => item.status === 'ready');
    byId('clear-selection').disabled = !canSelect || !selectedIds.size;
    const authorizable = new Set((snapshot.items || []).filter(canAuthorize).map(item => item.id));
    reencodeChoices = new Set([...reencodeChoices].filter(id => authorizable.has(id)));
    for (const checkbox of byId('batch-items').querySelectorAll('[data-testid="choose-reencode"]')) {
      checkbox.checked = reencodeChoices.has(checkbox.dataset.fileId);
      checkbox.disabled = !canSelect || remuxTargetChanged() || !authorizable.has(checkbox.dataset.fileId);
    }
    byId('reencode-selected').disabled = !canSelect || remuxTargetChanged() || !reencodeChoices.size;
    const hiddenChoices = (snapshot.items || []).filter(item => reencodeChoices.has(item.id) && outsideFileListView(item)).length;
    put('reencode-selected-count', `${reencodeChoices.size} chosen for authorization${hiddenChoices ? ` · ${hiddenChoices} hidden` : ''}`);
    renderOperationActions();
    renderSelectedReview(); renderFocusedFile();
  }

  function outsideFileListView(item) {
    // The narrow drawer hides only an editor list. It does not hide a list
    // moved into Current Jobs and never changes membership or main grants.
    const closedDrawer = narrowFilesLayout?.matches && !filesDrawerExpanded()
      && ['encode', 'remux'].some(name => byId(`workspace-${name}`).contains(byId('batch-panel')));
    return previewCollapsed || closedDrawer || !matchesFilter(item);
  }

  function editorOwnsFileList(name) {
    const list = byId('batch-panel');
    return !list.hidden && byId(`workspace-${name}`).contains(list);
  }

  function filesDrawerTrigger(name) {
    return byId(name === 'remux' ? 'remux-files-toggle' : 'files-toggle');
  }

  function syncFilesLayout() {
    if (activeWorkspace === 'encode' || activeWorkspace === 'remux') {
      const workspace = byId(`workspace-${activeWorkspace}`);
      const trigger = filesDrawerTrigger(activeWorkspace);
      const collapse = byId('preview-collapse'), focused = document.activeElement;
      const ownsList = editorOwnsFileList(activeWorkspace);
      // CSS keeps the currently focused control visible long enough for this
      // handoff. Do not reopen the drawer or move focus out of another region.
      if (narrowFilesLayout.matches && ownsList && (focused === collapse || (!filesDrawerExpanded()
          && [byId('preview-list'), collapse.parentElement, byId('reencode-toolbar')].some(region => region.contains(focused))))) {
        trigger.focus();
      } else if (!narrowFilesLayout.matches && focused === trigger) {
        (ownsList ? collapse : workspace).focus();
      }
    }
    syncSelection();
  }

  function filesDrawerExpanded() {
    // Remember the narrow drawer choice across resizes without overriding a
    // collapsed preview. The trigger describes the list it actually controls.
    return filesDrawerOpen && !previewCollapsed;
  }

  function syncFilesDrawerPresentation() {
    for (const name of ['encode', 'remux']) {
      const panel = byId(`workspace-${name}`);
      const trigger = filesDrawerTrigger(name), ownsList = editorOwnsFileList(name);
      const expanded = ownsList && filesDrawerExpanded();
      // Escape the disappearing control before hiding it. This is not an
      // implicit switch to Jobs, and the last drawer choice is not reset.
      if (!ownsList && document.activeElement === trigger) {
        (panel.hidden ? byId(`tab-${activeWorkspace}`) : panel).focus();
      }
      if (trigger.hidden === ownsList) trigger.hidden = !ownsList;
      const className = `${(panel.className || '').replace(/\bfiles-drawer-open\b/g, '').trim()}${expanded ? ' files-drawer-open' : ''}`;
      if (panel.className !== className) panel.className = className;
      if (trigger.getAttribute('aria-expanded') !== String(expanded)) trigger.setAttribute('aria-expanded', String(expanded));
    }
  }

  function setFilesDrawer(open, returnFocus = false) {
    filesDrawerOpen = Boolean(open);
    if (filesDrawerOpen && previewCollapsed) {
      // Opening the narrow file drawer is an explicit view action; expand the
      // same list, not a second selection model or a second collapsed state.
      previewCollapsed = false; renderItems();
    } else syncSelection();
    if (returnFocus) {
      const trigger = filesDrawerTrigger(currentOperation());
      const shown = typeof trigger.getClientRects !== 'function' || trigger.getClientRects().length > 0;
      (shown ? trigger : byId('focused-file-name')).focus();
    }
  }

  function focusFile(id, focusHeading = false) {
    if (!itemRows.has(id)) return;
    focusedFileId = id;
    renderFocusedFile();
    setFilesDrawer(false);
    if (focusHeading) {
      byId('focused-file-name').focus();
      byId('file-inspector').scrollIntoView({ block: 'nearest' });
    }
  }

  function renderFocusedFile() {
    const previous = itemRows.get(displayedFileId);
    const entry = itemRows.get(focusedFileId);
    if (previous && previous !== entry && previous.body.parentElement !== previous.details) previous.details.append(previous.body);
    if (!entry) {
      focusedFileId = null; displayedFileId = null;
      byId('focused-file-details-slot').replaceChildren();
      put('focused-file-name', 'Inspect a file');
      put('focused-file-origin', 'Focus is separate from batch selection.');
      put('focused-file-state', 'Choose Inspect beside any file.');
      put('focused-file-summary', 'Review preservation, processing requests and resolved arguments without changing selection.');
      put('focused-file-settings', isRemux() ? 'Full stream copy. Focus a file to inspect its target, preservation and omission decisions.' : 'Encoder controls apply to the Encode batch; processing overrides below belong to this file.');
    } else {
      displayedFileId = focusedFileId;
      if (entry.body.parentElement !== byId('focused-file-details-slot')) byId('focused-file-details-slot').append(entry.body);
      const item = entry.item, request = draftFiles.get(item.id)?.request;
      put('focused-file-name', item.name);
      put('focused-file-origin', [originLabel(item), generationSummary(item)].filter(Boolean).join(' · '));
      put('focused-file-state', `${entry.status.textContent}${selectedIds.has(item.id) ? ' · Selected for this batch' : ' · Not selected'}${outsideFileListView(item) ? ' · Outside current file-list view' : ''}`);
      put('focused-file-summary', item.reason || sourceMediaSummary(item.summary) || 'Inspection details are unavailable.');
      put('focused-file-settings', request ? `This file · ${processingLabel(request)}. Exact requests remain subject to main validation; see origin and effective details below.` : 'Read-only file details. No processing authority is granted by Inspect.');
    }
    byId('focused-file-clear').disabled = !entry;
    for (const [id, row] of itemRows) {
      row.inspect.setAttribute('aria-pressed', String(id === focusedFileId));
      row.row.setAttribute('data-focused', String(id === focusedFileId));
    }
  }

  function renderSelectedReview() {
    const list = byId('selected-review-list');
    const chosen = (snapshot.items || []).filter(item => selectedIds.has(item.id));
    const key = JSON.stringify(chosen.map(item => [item.id, item.name, item.status, Boolean(outsideFileListView(item))]));
    // Keep the selected-set controls alive across unrelated progress/default
    // updates, so a keyboard user does not lose focus during inspection.
    if (key !== selectedReviewKey) {
    selectedReviewKey = key;
    list.replaceChildren();
    for (const item of chosen) {
      const row = document.createElement('li');
      const label = document.createElement('span');
      label.textContent = `${item.name} · ${statusLabels[item.status] || item.status}${outsideFileListView(item) ? ' · Hidden in file-list view' : ''}`;
      const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'subtle';
      inspect.textContent = 'Inspect'; inspect.setAttribute('aria-label', `Inspect selected file ${item.name}`);
      inspect.addEventListener('click', () => focusFile(item.id, true));
      row.append(label, inspect); list.append(row);
    }
    if (!chosen.length) { const row = document.createElement('li'); row.textContent = 'No files selected for this batch.'; list.append(row); }
    }
    put('review-selected', `Review selected files (${chosen.length})`);
    const state = isBusy() ? 'Frozen current job — settings cannot change queued work.'
      : dirty || hasOperationEdits() || remuxTargetChanged() ? 'Draft changed — prepare again before starting.'
        : snapshot.planId && snapshot.phase === 'ready' ? 'Prepared snapshot — main revalidates selected files at Start.'
          : 'Not prepared — choose folders and review the batch.';
    put('prepared-readiness', state);
    put('editing-scope-caption', 'Encoding controls: batch · Processing overrides: this file · App Settings: future batches');
    renderRemuxSummary();
  }

  function availableRemuxTargets() {
    const targets = snapshot.remuxSupport?.targets;
    const known = ['matroska', 'mp4', 'mov'];
    // Main's current projection is availability, not renderer qualification.
    return Array.isArray(targets) && targets.every(target => known.includes(target))
      ? targets : [];
  }

  // Only the current main-owned unified composition may lift the legacy
  // encode-preview lock. Target admission and main validation remain separate.
  function remuxPreviewBlocked() {
    return Boolean(developerPreview) && !(snapshot.developerProduct?.enabled === true
      && snapshot.developerProduct.composition === 'unified-linux-operations-v1'
      && snapshot.developerProduct.relaunchRequired === false && !developerSessionClosed);
  }
  function remuxTargetAvailable(target = byId('remux-target').value) {
    return availableRemuxTargets().includes(target);
  }

  function renderRemuxSummary() {
    const targets = availableRemuxTargets();
    for (const option of byId('remux-target').options) {
      if (!option.dataset.availableLabel) option.dataset.availableLabel = option.textContent;
      option.disabled = !targets.includes(option.value);
      option.textContent = option.dataset.availableLabel + (option.disabled ? ' — unavailable here' : '');
    }
    put('remux-target-summary', `Selected: ${byId('remux-target').value} · Saved preference: ${appDefaults?.defaults?.remuxTarget || 'not yet read'} · Full stream copy`);
    put('remux-support-notice', snapshot.remuxSupport?.notice || 'Each file requires exact current qualification. Unsupported streams, relationships and targets remain blocked; an omission decision may not resolve every refusal.');
    const changed = remuxTargetChanged();
    const notices = [];
    if (!remuxTargetAvailable()) notices.push(targets.length
      ? `Selected target is unavailable in this app session. Choose ${targets.join(', ')} explicitly; your saved preference has not changed.`
      : 'Remux targets are unavailable in this app session. Your selected target and saved preference have not changed.');
    if (changed) notices.push(`Target changed from prepared ${preparedRemuxTarget()}. Prepare a new Remux batch before Start, or restore the prepared target.`);
    visible('remux-target-notice', notices.length > 0);
    put('remux-target-notice', notices.join(' '));
  }

  function hasOperationEdits() {
    return batchOperationEdits.size > 0 || [...itemRows.values()].some(entry => entry.operationEdits.size > 0);
  }

  function editableOperationDraft() {
    return !developerSessionClosed && discardableOperationDraft() && !dirty && !snapshot.encodingSettingsStale;
  }

  function discardableOperationDraft() {
    return snapshot.phase === 'ready' && !pendingCommands && snapshot.planId
      && snapshot.operationDraft?.operation === 'encode' && !snapshot.operationDraft.frozen;
  }

  function operationRequest() {
    if (!editableOperationDraft()) throw new Error('Review an editable batch before changing processing choices.');
    return { planId: snapshot.planId, draftId: snapshot.operationDraft.id, revision: snapshot.operationDraft.revision };
  }

  function exactSeconds(value, label) {
    const text = value.trim();
    if (!text) return undefined;
    if (!/^\d{1,10}(?:\.\d{1,6})?$/.test(text)) throw new Error(`${label}: use nonnegative seconds with up to six decimal places.`);
    const [whole, part = ''] = text.split('.');
    const us = BigInt(whole) * 1000000n + BigInt(part.padEnd(6, '0'));
    if (us > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`${label} exceeds the exact supported time range.`);
    return Number(us);
  }

  function secondsText(value) {
    if (!Number.isSafeInteger(value) || value < 0) return '';
    const us = BigInt(value), fraction = String(us % 1000000n).padStart(6, '0').replace(/0+$/, '');
    return `${us / 1000000n}${fraction ? `.${fraction}` : ''}`;
  }

  function readOperationEdits(entry) {
    const controls = entry.operationControls, overrides = {};
    if (entry.operationEdits.has('range')) {
      if (controls.mode.value === 'full') overrides.range = null;
      else if (controls.mode.value === 'range') {
        const startUs = exactSeconds(controls.start.value, 'Start'), endUs = exactSeconds(controls.end.value, 'End');
        if (startUs === undefined && endUs === undefined) throw new Error('Enter at least one range boundary, or choose Full.');
        if (startUs !== undefined && endUs !== undefined && endUs <= startUs) throw new Error('Range end must be later than its start.');
        overrides.range = { ...(startUs === undefined ? {} : { startUs }), ...(endUs === undefined ? {} : { endUs }) };
      } else throw new Error('Choose Full or one time range.');
    }
    for (const key of ['resolution', 'audioPolicy']) if (entry.operationEdits.has(key)) overrides[key] = controls[key].value;
    if (entry.operationEdits.has('aacBitrateKbps')) {
      const text = controls.aacBitrateKbps.value.trim();
      if (text && (!/^\d{1,4}$/.test(text) || Number(text) < 32 || Number(text) > 1536)) throw new Error('AAC bitrate must be a whole number from 32 to 1536 kb/s, or blank for the layout default.');
      overrides.aacBitrateKbps = text ? Number(text) : null;
    }
    if (overrides.audioPolicy && overrides.audioPolicy !== 'precision-aac') overrides.aacBitrateKbps = null;
    return overrides;
  }

  function processingLabel(request) {
    if (request.operation === 'remux') return `Current request: Full · ${request.target} · Preserve compatible streams by copy · No transcoding`;
    const range = request.range === null ? 'Full' : `${secondsText(request.range?.startUs) || 'beginning'} → ${secondsText(request.range?.endUs) || 'end'} seconds`;
    const origins = request.origins || {};
    return `Current request: ${range} (${origins.range || 'unknown origin'}) · ${request.resolution === 'source' ? 'Keep source' : `${request.resolution}p`} (${origins.resolution || 'unknown origin'}) · ${operationAudioLabels[request.audioPolicy] || request.audioPolicy} (${origins.audioPolicy || 'unknown origin'})${request.aacBitrateKbps ? ` · AAC ${request.aacBitrateKbps} kb/s` : ''}`;
  }

  function renderOperationActions() {
    const editable = Boolean(editableOperationDraft()), ids = [...selectedIds].filter(id => draftFiles.has(id));
    visible('operation-unsaved-notice', hasOperationEdits());
    byId('batch-operation-fields').disabled = !editable;
    byId('batch-operation-apply').disabled = !editable || !batchOperationEdits.size;
    byId('batch-operation-discard').disabled = !discardableOperationDraft() || !batchOperationEdits.size;
    byId('batch-app-defaults-choice').disabled = !editable || hasOperationEdits();
    byId('batch-app-defaults-apply').disabled = !editable || hasOperationEdits();
    for (const entry of itemRows.values()) {
      const controls = entry.operationControls, available = editable && draftFiles.has(entry.item.id);
      entry.operationFields.disabled = !available;
      controls.start.disabled = controls.end.disabled = !available || controls.mode.value !== 'range';
      renderRangeSliders(entry, available);
      controls.aacBitrateKbps.disabled = !available || controls.audioPolicy.value !== 'precision-aac';
      entry.operationApply.disabled = !available || !entry.operationEdits.size;
      entry.operationApplySelected.disabled = !available || !entry.operationEdits.size || !ids.length;
      entry.operationApplySelected.textContent = `Apply changed fields to selected (${ids.length})`;
      entry.operationDiscard.disabled = !discardableOperationDraft() || !draftFiles.has(entry.item.id) || !entry.operationEdits.size;
    }
  }

  function rangeLimitText(item) {
    return Number.isSafeInteger(item.rangeLimitUs) && item.rangeLimitUs > 0 ? ` Latest range end: ${secondsText(item.rangeLimitUs)} s.`
      : ' Range sliders are off: main has not established the exact range limit for this file. The exact fields still work.';
  }

  // Read-only description of a finished changed-path job, from main's checked
  // decoded timing. Plain text only; anything malformed shows nothing.
  function timingText(timing) {
    const int = value => Number.isSafeInteger(value), count = value => int(value) && value >= 0;
    const signed = value => value < 0 ? `-${secondsText(-value)}` : secondsText(value);
    const span = part => int(part?.startUs) && int(part?.endUs) && part.endUs > part.startUs ? `${signed(part.startUs)}–${signed(part.endUs)} s` : '';
    if (!timing || typeof timing !== 'object' || !['request-relative', 'source-timestamps'].includes(timing.timeline)
        || !Array.isArray(timing.audio) || timing.audio.length > 64) return '';
    const parts = [];
    if (timing.timeline === 'request-relative') {
      const resolved = timing.resolved, asked = timing.requested || {};
      const video = span(timing.video);
      if (!count(resolved?.startUs) || !count(resolved?.endUs) || !video || !count(timing.video.frames)) return '';
      if (asked.startUs != null && !count(asked.startUs) || asked.endUs != null && !count(asked.endUs)) return '';
      const start = int(asked.startUs) ? `${secondsText(asked.startUs)} s` : `the file start (${secondsText(resolved.startUs)} s)`;
      const end = int(asked.endUs) ? `${secondsText(asked.endUs)} s` : `the file end (${secondsText(resolved.endUs)} s)`;
      parts.push(`Trim asked: ${start} to ${end}. Video kept ${video} (${timing.video.frames} frames).`);
    }
    for (const audio of timing.audio) {
      if (!count(audio?.inputIndex)) return '';
      const kept = timing.timeline === 'request-relative' ? span(audio) : '';
      const details = [];
      if (kept) details.push(`kept ${kept}`);
      if (audio.mode === 'precision-aac' && count(audio.encoderDelaySamples) && count(audio.discardPaddingSamples)) {
        details.push(`AAC start delay ${audio.encoderDelaySamples} samples, end padding ${audio.discardPaddingSamples} samples`);
      }
      if (int(audio.sampleCountDifference) && audio.sampleCountDifference !== 0) {
        details.push(`${audio.sampleCountDifference > 0 ? '+' : ''}${audio.sampleCountDifference} samples versus the source`);
      }
      if (details.length) parts.push(`Audio ${audio.inputIndex}: ${details.join('; ')}.`);
    }
    return parts.join(' ');
  }

  function renderRangeSliders(entry, editable) {
    // Main sends the exact latest range end it would accept for this file's
    // video timeline; the rounded inspected duration is never used as a bound.
    const controls = entry.operationControls, exact = entry.item.rangeLimitUs;
    const limit = Number.isSafeInteger(exact) && exact > 0 ? exact : null;
    for (const key of ['start', 'end']) {
      const slider = controls[`${key}Slider`];
      slider.disabled = !editable || controls.mode.value !== 'range' || limit === null;
      slider.max = limit === null ? '1' : secondsText(limit);
      let requested;
      try { requested = exactSeconds(controls[key].value, key); } catch { requested = undefined; }
      const displayed = requested ?? (key === 'start' ? 0 : limit ?? 0);
      // A slider visual is bounded; the exact field is NEVER silently clamped or
      // rounded when rendering. Main still validates the submitted interval.
      slider.value = secondsText(Math.min(limit ?? 0, Math.max(0, displayed)));
      slider.setAttribute('aria-valuetext', `Slider approximation ${slider.value} seconds; exact field ${controls[key].value.trim() || (key === 'start' ? 'beginning' : 'source end')}. Apply changes to use the exact field.`);
      slider.title = limit === null ? 'Main has not established the exact range limit for this file, so the slider is off. You can still enter exact seconds above; main checks them.'
        : 'Move this boundary in millisecond steps, or enter exact seconds in the field above. Apply changes to prepare it.';
    }
  }

  function renderBatchOperations() {
    const draft = snapshot.operationDraft;
    const show = draft?.operation === 'encode' && draft.batchDefaults?.values;
    visible('batch-operation-editor', Boolean(show));
    if (!show) { batchOperationKey = null; batchOperationEdits.clear(); return; }
    const key = `${draft.id}:${draft.revision}`;
    if (key !== batchOperationKey) {
      batchOperationKey = key; batchOperationEdits.clear();
      for (const [field, id] of Object.entries(batchOperationFields)) byId(id).value = draft.batchDefaults.values[field];
      byId('batch-app-defaults-choice').value = 'keep';
    }
    const labels = { resolution: 'Resolution', fullAudioPolicy: 'Full audio', rangeAudioPolicy: 'Trimmed audio', hdrPolicy: 'HDR' };
    put('batch-operation-summary', `Draft revision ${draft.revision} · saved app revision ${draft.batchDefaults.appDefaultsRevision} · `
      + Object.keys(batchOperationFields).map(field => `${labels[field]}: ${operationAudioLabels[draft.batchDefaults.values[field]] || draft.batchDefaults.values[field]} (${draft.batchDefaults.origins[field]})`).join(' · '));
  }

  function renderFileOperation(entry) {
    const file = draftFiles.get(entry.item.id), draft = snapshot.operationDraft;
    entry.operationEditor.hidden = !file || draft?.operation !== 'encode';
    if (!file || draft?.operation !== 'encode') { entry.operationEdits.clear(); return; }
    const key = `${draft.id}:${draft.revision}`;
    if (entry.operationKey !== key) {
      entry.operationKey = key; entry.operationEdits.clear();
      const request = file.request, controls = entry.operationControls;
      controls.mode.value = request.range === null ? 'full' : 'range';
      controls.start.value = secondsText(request.range?.startUs); controls.end.value = secondsText(request.range?.endUs);
      controls.resolution.value = request.resolution; controls.audioPolicy.value = request.audioPolicy;
      controls.aacBitrateKbps.value = request.aacBitrateKbps === null ? '' : String(request.aacBitrateKbps ?? '');
      entry.operationNotice.textContent = '';
    }
    entry.operationSummary.textContent = processingLabel(file.request);
    entry.operationDuration.textContent = finite(entry.item.summary?.durationSeconds) && entry.item.summary.durationSeconds > 0
      ? `Inspected duration: ${duration(entry.item.summary.durationSeconds)}.${rangeLimitText(entry.item)} Main checks exact bounds separately for every file; nothing is silently clamped.`
      : 'Duration is not available in this preview. You may enter exact seconds; main must establish valid bounds before it can prepare a range.';
  }

  async function applyFileOperation(entry, selected) {
    if (!editableOperationDraft() || !entry.operationEdits.size) return;
    try {
      if (batchOperationEdits.size || [...itemRows.values()].some(other => other !== entry && other.operationEdits.size)) {
        throw new Error('Apply or discard edits in the other file or batch editor first. This action will not silently discard those edits.');
      }
      const fileIds = selected ? [...selectedIds].filter(id => draftFiles.has(id)) : [entry.item.id];
      if (!fileIds.length || !draftFiles.has(entry.item.id)) throw new Error('Select files from this current draft.');
      const request = { ...operationRequest(), fileIds, overrides: readOperationEdits(entry) };
      entry.operationNotice.textContent = '';
      await command(async () => {
        const next = await api.updateFileOperations(request); applySnapshot(next);
        entry.operationNotice.textContent = next.phase === 'ready'
          ? 'Changed fields applied. Review each resulting file status; unsupported requests have not been approved for encoding.'
          : 'Repreparation did not finish ready. Review the current batch error before proceeding.';
      });
    } catch (error) { entry.operationNotice.textContent = error?.message || String(error); }
  }

  function createOperationEditor(item) {
    const editor = document.createElement('details'); editor.className = 'operation-editor'; editor.dataset.testid = 'file-operation-editor';
    const heading = document.createElement('summary'); heading.textContent = 'File processing / Full or Time Range';
    const summary = document.createElement('p'); summary.className = 'hint'; summary.dataset.testid = 'file-operation-summary';
    const info = document.createElement('p'); info.className = 'hint'; info.textContent = 'Only fields you edit are applied. Range sliders use millisecond steps; exact fields accept up to six decimal places. Range changes inherit the batch audio default unless audio was explicitly overridden. Apply changes to prepare; unsupported operations remain refused.';
    const durationInfo = document.createElement('p'); durationInfo.className = 'hint';
    const form = document.createElement('form');
    const fields = document.createElement('fieldset'); const legend = document.createElement('legend'); legend.textContent = 'Requested processing'; fields.append(legend);
    const grid = document.createElement('div'); grid.className = 'operation-fields';
    const controls = {}, prefix = `operation-${++operationControlId}`;
    info.id = `${prefix}-help`;
    const options = {
      mode: [['full', 'Full video'], ['range', 'Single time range']],
      resolution: [['source', 'Keep source resolution'], ['2160', '2160p'], ['1440', '1440p'], ['1080', '1080p'], ['720', '720p']],
      audioPolicy: [['copy', 'Copy, where qualified'], ['precision-aac', 'Precision AAC'], ['precision-flac', 'Precision FLAC']],
    };
    for (const [key, label] of [['mode', 'Interval'], ['start', 'Start seconds (included)'], ['end', 'End seconds (excluded)'],
      ['resolution', 'Resolution'], ['audioPolicy', 'Audio policy'], ['aacBitrateKbps', 'AAC kb/s (blank = layout default)']]) {
      const field = document.createElement('div'); field.className = 'field';
      const caption = document.createElement('label'); caption.textContent = label; caption.setAttribute('for', `${prefix}-${key}`);
      const control = document.createElement(options[key] ? 'select' : 'input'); control.id = `${prefix}-${key}`; control.dataset.testid = `file-operation-${key}`;
      if (options[key]) for (const [value, text] of options[key]) { const option = document.createElement('option'); option.value = value; option.textContent = text; control.append(option); }
      else { control.type = 'text'; control.inputMode = key === 'aacBitrateKbps' ? 'numeric' : 'decimal'; control.maxLength = 24; control.spellcheck = false; control.placeholder = key === 'start' ? 'Blank = beginning' : key === 'end' ? 'Blank = source end' : ''; }
      const edited = () => {
        const entry = itemRows.get(item.id); if (!entry || !editableOperationDraft()) return;
        entry.operationEdits.add(['mode', 'start', 'end'].includes(key) ? 'range' : key);
        entry.operationNotice.textContent = ''; syncSelection();
      };
      control.addEventListener('change', edited); if (!options[key]) control.addEventListener('input', edited);
      controls[key] = control; field.append(caption, control);
      if (['start', 'end'].includes(key)) {
        const slider = document.createElement('input'); slider.type = 'range'; slider.min = '0'; slider.max = '1'; slider.step = '0.001';
        slider.dataset.testid = `file-operation-${key}-slider`; slider.className = 'range-boundary';
        slider.setAttribute('aria-label', `${key === 'start' ? 'Start' : 'End'} boundary for ${item.name}`);
        slider.setAttribute('aria-describedby', `${prefix}-help`);
        slider.addEventListener('input', () => {
          const entry = itemRows.get(item.id);
          if (!entry || !editableOperationDraft() || slider.disabled) return;
          controls[key].value = slider.value; edited();
        });
        controls[`${key}Slider`] = slider; field.append(slider);
      }
      grid.append(field);
    }
    fields.append(grid);
    const buttons = document.createElement('div'); buttons.className = 'action-row';
    const apply = document.createElement('button'); apply.type = 'submit'; apply.className = 'subtle'; apply.textContent = 'Apply changes to this file'; apply.dataset.testid = 'file-operation-apply';
    const selected = document.createElement('button'); selected.type = 'button'; selected.className = 'subtle'; selected.dataset.testid = 'file-operation-selected';
    const discard = document.createElement('button'); discard.type = 'button'; discard.className = 'subtle'; discard.textContent = 'Discard file edits'; discard.dataset.testid = 'file-operation-discard';
    form.addEventListener('submit', event => { event.preventDefault(); const entry = itemRows.get(item.id); if (entry) void applyFileOperation(entry, false); });
    selected.addEventListener('click', () => { const entry = itemRows.get(item.id); if (entry) void applyFileOperation(entry, true); });
    discard.addEventListener('click', () => { const entry = itemRows.get(item.id); if (entry && discardableOperationDraft()) { entry.operationKey = null; renderFileOperation(entry); syncSelection(); } });
    buttons.append(apply, selected, discard); form.append(fields, buttons);
    const notice = document.createElement('p'); notice.className = 'operation-notice'; notice.setAttribute('role', 'status'); notice.setAttribute('aria-live', 'polite'); notice.dataset.testid = 'file-operation-notice';
    editor.append(heading, summary, info, durationInfo, form, notice);
    return { operationEditor: editor, operationSummary: summary, operationDuration: durationInfo, operationFields: fields,
      operationControls: controls, operationApply: apply, operationApplySelected: selected, operationDiscard: discard,
      operationNotice: notice, operationKey: null, operationEdits: new Set() };
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
    if (previous.version === 2 && previous.kind === 'native-encoder') {
      const backend = previous.backend === 'amf' ? 'AMD AMF' : previous.backend === 'qsv' ? 'Intel Quick Sync' : 'Unknown native backend';
      const quality = previous.qualityMode === 'CQP'
        ? ['i', 'p', 'b'].filter(key => Object.hasOwn(previous.quality, key)).map(key => `${key.toUpperCase()}${previous.quality[key]}`).join('/') : String(previous.quality);
      return `${previous.codec} · ${backend} · ${previous.encoder} · preset ${previous.preset} · ${previous.qualityMode} ${quality} · ${previous.bitDepth}-bit · recorded requested settings`;
    }
    if (previous.version === 4 && previous.kind === 'remux') {
      const targets = { matroska: 'MKV', mp4: 'MP4', mov: 'MOV' }, families = { isobmff: 'MP4/MOV', matroska: 'MKV', mpegts: 'TS' };
      const copied = Array.isArray(previous.streams) ? previous.streams.length : 0, omitted = Array.isArray(previous.omittedStreams) ? previous.omittedStreams.length : 0;
      return `Remux · ${families[previous.inputFamily] || 'Unknown input'} to ${targets[previous.target] || 'unknown target'} · ${copied} stream${copied === 1 ? '' : 's'} copied${omitted ? ` · ${omitted} omitted` : ''} · no new encoding generation`;
    }
    const previousRecipe = recipes().find(recipe => recipe.id === previous.recipeId);
    return `${previous.codec} · ${previous.backend} · ${previous.encoder}${previousRecipe ? ` · ${previousRecipe.label}` : ''} · preset ${previous.preset} · ${previous.qualityMode} ${previous.quality} · ${previous.bitDepth}-bit`;
  }

  function originLabel(item) {
    if (isGenerated(item)) return item.reencodeAuthorized ? isRemux() ? 'Generated output · Remux source authorized' : 'Generated output · Re-encoding authorized' : 'Generated output · Excluded';
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

  function renderRemuxDecisions(entry) {
    const remux = isRemux(), field = remux ? 'remux' : 'encodePreservation';
    const details = entry.item[field];
    entry.remuxDetails.hidden = !details;
    if (!details) { entry.remuxButtons = []; return; }
    const key = JSON.stringify([snapshot.planId, snapshot.operationDraft?.id, snapshot.operationDraft?.revision, details]);
    if (key !== entry.remuxKey) {
      entry.remuxKey = key; entry.remuxBody.replaceChildren(); entry.remuxButtons = [];
      const text = value => typeof value === 'string' ? value : value?.message || value?.reason || value?.label || '';
      const addText = value => { const p = document.createElement('p'); p.className = 'hint'; p.textContent = value; entry.remuxBody.append(p); };
      addText(`Full · ${details.target} · ${details.status}. ${details.notice || ''}`);
      const streams = document.createElement('ul'); streams.className = 'remux-streams';
      const actions = { 'preserve-copy': 'Preserve by stream copy', 'encode-video': 'Encode video with the displayed settings', 'explicitly-omitted': 'Explicitly omitted from this output', blocked: 'Blocked; preservation is not qualified' };
      for (const stream of details.streams || []) {
        const li = document.createElement('li');
        li.textContent = `${stream.label || `Stream ${stream.streamIndex}: ${stream.codecType} / ${stream.codecName}`} · ${actions[stream.action] || stream.action}`;
        const notes = [...(stream.reasons || []), ...(stream.representations || [])].map(text).filter(Boolean);
        if (notes.length) { const p = document.createElement('p'); p.className = 'hint'; p.textContent = notes.join(' '); li.append(p); }
        streams.append(li);
      }
      entry.remuxBody.append(streams);
      for (const blocker of details.blockers || []) addText(`${blocker.code}: ${blocker.message}`);
      for (const candidate of details.omissionCandidates || []) {
        const approved = (details.omissionDecisionIds || []).includes(candidate.id);
        const row = document.createElement('div'); row.className = 'remux-decision';
        const description = document.createElement('p'); description.className = 'hint';
        description.textContent = `${candidate.label} · Target: ${candidate.target}. ${(candidate.reasons || []).map(text).filter(Boolean).join(' ')} ${approved ? 'This stream is deliberately omitted from the prepared output.' : 'Omitting removes this stream from the output. The source is preserved. Other qualification blockers may remain.'}`;
        const button = document.createElement('button'); button.type = 'button'; button.className = 'subtle';
        button.dataset.testid = remux ? 'remux-omission' : 'encode-preservation-decision'; button.dataset.decisionId = candidate.id;
        button.textContent = remux ? approved ? 'Restore preservation of this stream' : 'Omit this stream and prepare again'
          : approved ? 'Require preservation of the timed track and link' : 'Omit this timed track and link; prepare again';
        button.setAttribute('aria-label', `${button.textContent}: ${candidate.label} for ${candidate.target}`);
        button.addEventListener('click', async () => {
          const focusReturn = document.activeElement === button ? { fileId: entry.item.id, decisionId: candidate.id,
            target: candidate.target, draftId: snapshot.operationDraft?.id, workspace: activeWorkspace,
            navigationRevision: workspaceNavigationRevision, inInspector: focusedFileId === entry.item.id } : null;
          await command(async () => {
            if (isRemux() !== remux || snapshot.phase !== 'ready' || dirty || remux && remuxTargetChanged() || snapshot.operationDraft?.frozen) throw new Error('Review the current prepared file before changing a preservation decision.');
            const current = snapshot.items?.find(item => item.id === entry.item.id)?.[field];
            if (!current?.omissionCandidates?.some(value => value.id === candidate.id)) throw new Error('That stream decision is no longer current. Review the file again.');
            // Submit the exact desired set of opaque main-issued IDs. No stream
            // index, source path, fingerprint, FFmpeg option or approval is minted here.
            const decisionIds = new Set((snapshot.items || []).flatMap(item => item[field]?.omissionDecisionIds || []));
            if (decisionIds.has(candidate.id)) decisionIds.delete(candidate.id); else decisionIds.add(candidate.id);
            const draft = snapshot.operationDraft;
            const request = { planId: snapshot.planId, draftId: draft.id, revision: draft.revision, decisionIds: [...decisionIds] };
            applySnapshot(await (remux ? api.setRemuxOmissions(request) : api.setEncodePreservationDecisions(request)));
          });
          // Repreparation replaces decision controls and can temporarily move
          // their inspector into Jobs. Restore only this exact action's focus,
          // after command() has enabled the final controls; never renew a grant.
          if (!focusReturn || snapshot.phase !== 'ready' || isRemux() !== remux
              || snapshot.operationDraft?.id !== focusReturn.draftId || activeWorkspace !== focusReturn.workspace
              || workspaceNavigationRevision !== focusReturn.navigationRevision
              || (focusReturn.inInspector && focusedFileId !== focusReturn.fileId)) return;
          const active = document.activeElement;
          if (active && active !== document.body && active !== button && active !== byId('tab-jobs')) return;
          const currentEntry = itemRows.get(focusReturn.fileId);
          if (!currentEntry) return;
          const replacement = currentEntry.item[field]?.target === focusReturn.target
            ? currentEntry.remuxButtons.find(value => value.dataset.decisionId === focusReturn.decisionId) : null;
          const shown = replacement && (typeof replacement.getClientRects !== 'function' || replacement.getClientRects().length > 0);
          if (shown && !replacement.disabled) replacement.focus();
          else focusFile(focusReturn.fileId, true);
        });
        row.append(description, button); entry.remuxBody.append(row); entry.remuxButtons.push(button);
      }
    }
    const editable = snapshot.phase === 'ready' && snapshot.operationDraft && !snapshot.operationDraft.frozen
      && !dirty && !pendingCommands && (!remux || !remuxTargetChanged());
    for (const button of entry.remuxButtons) button.disabled = !editable;
  }

  function completedOutputId(item) {
    const receipt = item.outputAccess;
    // Only main's successful publication receipt enables a local action. A
    // destination path, diagnostic record or earlier generated-file provenance
    // is descriptive data and can never substitute for this ephemeral token.
    return item.status === 'success' && item.outputDisposition?.published === true
      && receipt && Object.keys(receipt).length === 1 && typeof receipt.outputId === 'string'
      && /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(receipt.outputId)
      ? receipt.outputId : null;
  }

  function remuxVerificationCoverage(item) {
    // The same method is projected when Prepare selects it and during
    // collection, so the claim alone never means the user has a saved copy.
    if (!isRemux() || item.remux?.status !== 'qualified' || item.status !== 'success'
        || item.outputDisposition?.kind !== 'published' || item.outputDisposition.published !== true
        || !['saved', 'saved-with-warning'].includes(item.outcome)) return '';
    const claim = item.verificationClaim, method = item.verificationMethod;
    if (claim?.version !== 1 || claim.method !== method) return '';
    // Match the finite known main descriptions, but render fixed UI text.
    // Never echo a free-form description or turn it into UI authority.
    const boundaries = 'Only the start and end of the video were decoded; the middle was not decoded.';
    if (method === 'packet-identity-v1' && claim.interiorVideoDecoded === false) {
      if (claim.completeAudioDecoded === true
          && claim.statement === 'Output packets identical to source; every header validated; start and end decoded.') {
        return `Copy verification: The retained compressed streams matched and every video header was checked. ${boundaries} Any retained audio was decoded and compared in full.`;
      }
      if (claim.completeAudioDecoded === false && claim.statement ===
          'Every ordered AVC NAL and raw AAC frame preserved; source clocks kept exactly; every header validated; start and end decoded.') {
        return `Copy verification: Coded media and source timing were checked, including every video header. ${boundaries} No full audio decode was performed.`;
      }
    }
    if (method === 'complete-native-v1' && claim.interiorVideoDecoded === true && claim.completeAudioDecoded === true
        && claim.statement === 'Every retained video frame and audio sample decoded and compared completely.') {
      return 'Copy verification: Every retained video frame and audio sample were decoded and compared.';
    }
    return '';
  }

  function renderOutputAccess(entry) {
    const outputId = completedOutputId(entry.item);
    if (entry.outputAccessId !== outputId) {
      entry.outputAccessId = outputId;
      entry.outputRequest++;
      entry.outputPending = false;
      entry.outputResult = '';
      entry.outputFailed = false;
      entry.outputControls.replaceChildren();
      if (outputId) {
        for (const [action, label] of [['open', 'Open output'], ['reveal', 'Show in folder']]) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'subtle'; button.textContent = label;
          button.dataset.testid = `completed-output-${action}`;
          button.setAttribute('aria-label', `${label}: ${entry.item.outputName || entry.item.name}`);
          button.addEventListener('click', () => { void dispatchOutputAction(entry, action); });
          entry.outputControls.append(button);
        }
      }
    }
    entry.outputControls.hidden = !outputId;
    entry.outputControls.setAttribute('aria-busy', String(entry.outputPending));
    for (const button of entry.outputControls.children) button.disabled = entry.outputPending;
    const warning = entry.item.status === 'success' ? entry.item.outputAccessWarning : '';
    entry.outputNotice.textContent = entry.outputResult || warning || '';
    entry.outputNotice.hidden = !entry.outputNotice.textContent;
    entry.outputNotice.className = `file-detail output-access-notice${entry.outputFailed || warning ? ' output-access-error' : ''}`;
  }

  async function dispatchOutputAction(entry, action) {
    const outputId = completedOutputId(entry.item);
    if (!outputId || entry.outputPending || itemRows.get(entry.item.id) !== entry) return;
    const request = ++entry.outputRequest;
    const current = () => itemRows.get(entry.item.id) === entry && entry.outputRequest === request
      && completedOutputId(entry.item) === outputId;
    entry.outputPending = true;
    entry.outputFailed = false;
    entry.outputResult = action === 'open' ? 'Requesting the default player…' : 'Requesting the output folder…';
    renderOutputAccess(entry);
    try {
      // Submit only the main-issued token and fixed action. In particular, do
      // not send the displayed output name, destination or any command text.
      const result = await api.openCompletedOutput({ outputId, action });
      if (!current()) return;
      if (result?.dispatched !== true) throw new Error('The system did not confirm the output action.');
      entry.outputResult = action === 'open'
        ? 'Open request sent to your default player. Playback has not been verified.'
        : 'Show-in-folder request sent to your file manager.';
    } catch (error) {
      if (!current()) return;
      entry.outputFailed = true;
      entry.outputResult = `Could not ${action === 'open' ? 'open the output' : 'show the output folder'}: ${error?.message || error}`;
    } finally {
      if (current()) { entry.outputPending = false; renderOutputAccess(entry); }
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
    const operation = createOperationEditor(item);
    const remuxDetails = document.createElement('details'); remuxDetails.className = 'remux-preservation';
    remuxDetails.dataset.testid = 'remux-preservation';
    const remuxHeading = document.createElement('summary'); remuxHeading.textContent = 'Stream preservation and omission decisions';
    const remuxBody = document.createElement('div'); remuxDetails.append(remuxHeading, remuxBody);
    const output = document.createElement('p');
    output.className = 'output-name';
    const outputControls = document.createElement('div');
    outputControls.className = 'output-access-actions';
    const outputNotice = document.createElement('p');
    outputNotice.dataset.testid = 'completed-output-notice';
    outputNotice.setAttribute('role', 'status');
    outputNotice.setAttribute('aria-live', 'polite');
    const summary = document.createElement('p');
    summary.className = 'file-detail';
    summary.setAttribute('data-testid', 'source-media-summary');
    const reason = document.createElement('p');
    reason.className = 'item-reason';
    const sampling = document.createElement('p');
    sampling.className = 'file-detail';
    const timing = document.createElement('p');
    timing.className = 'file-detail';
    timing.dataset.testid = 'operation-timing';
    timing.hidden = true;
    const verificationCoverage = document.createElement('p');
    verificationCoverage.className = 'file-detail';
    verificationCoverage.dataset.testid = 'remux-verification-coverage';
    verificationCoverage.hidden = true;
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
    body.append(output, outputControls, outputNotice, summary, reason, timing, verificationCoverage, metadata, sampling, operation.operationEditor, remuxDetails, previousDetails, action, commandDetails);
    details.append(name, body);
    // Classification and its deliberate action stay visible in compact rows.
    // Heavy provenance/argument details expand only when requested.
    const inspect = document.createElement('button'); inspect.type = 'button'; inspect.className = 'subtle inspect-file';
    inspect.dataset.testid = 'inspect-file'; inspect.textContent = 'Inspect';
    inspect.addEventListener('click', () => focusFile(item.id, true));
    name.addEventListener('click', event => {
      if (body.parentElement !== details) { event.preventDefault(); focusFile(item.id, true); }
    });
    fileCell.append(details, origin, previous, reencodeBox, inspect);
    const statusCell = document.createElement('td');
    const status = document.createElement('span');
    const untested = document.createElement('span');
    untested.className = 'untested-mark';
    untested.dataset.testid = 'result-untested';
    untested.textContent = '⚠';
    untested.title = untestedHardwareNotice;
    untested.setAttribute('aria-label', untestedHardwareNotice);
    untested.setAttribute('role', 'img');
    statusCell.append(status, untested);
    row.append(useCell, fileCell, statusCell);
    return { row, checkbox, details, body, inspect, name, output, summary, reason, timing, verificationCoverage, metadata, sampling, action, status, untested, item, key: '', origin, previous, ...operation,
      outputControls, outputNotice, outputAccessId: undefined, outputRequest: 0, outputPending: false, outputResult: '', outputFailed: false,
      previousDetails, previousInfo, previousArgs, reencodeBox, reencodeChoice, reencode, remuxDetails, remuxBody, remuxKey: null, remuxButtons: [],
      commandDetails, commandHeading, commandNotice, commandExecutable, commandDestination, commandArgs, commandKey: null };
  }

  function renderItems() {
    const items = snapshot.items || [];
    draftFiles = new Map((snapshot.operationDraft?.files || []).map(file => [file.fileId, file]));
    renderBatchOperations();
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
      entry.untested.hidden = item.hardwareTier !== 'untested';
      renderFileOperation(entry);
      renderRemuxDecisions(entry);
      renderOutputAccess(entry);
      const jobStage = snapshot.progress?.fileId === item.id ? snapshot.progress.stage : null;
      const verificationCoverage = remuxVerificationCoverage(item);
      const key = JSON.stringify([currentOperation(), item.name, item.outputName, item.status, item.reason, item.summary, item.origin, item.reencodeAuthorized, item.outcome, item.outputDisposition, item.timing, verificationCoverage, jobStage]);
      if (key !== entry.key) {
        entry.key = key;
        entry.checkbox.setAttribute('aria-label', `${operationName()} ${item.name}`);
        entry.name.textContent = item.name;
        entry.name.title = item.name;
        entry.inspect.setAttribute('aria-label', `Inspect ${item.name} without changing selection`);
        entry.output.textContent = `Output: ${item.outputName || 'No output destination'}`;
        entry.summary.textContent = sourceMediaSummary(item.summary);
        entry.summary.hidden = !entry.summary.textContent;
        entry.reason.textContent = item.reason || '';
        entry.reason.hidden = !item.reason;
        entry.timing.textContent = item.status === 'success' ? timingText(item.timing) : '';
        entry.timing.hidden = !entry.timing.textContent;
        entry.verificationCoverage.textContent = verificationCoverage;
        entry.verificationCoverage.hidden = !verificationCoverage;
        // Main's inspection describes container representation changes. Render
        // plain text only; media metadata never becomes HTML or IPC authority.
        entry.metadata.textContent = [...(item.summary?.metadataNotices || []), ...(item.hdr?.notice ? [item.hdr.notice] : [])].join(' ');
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
          ? `${generationSummary(item)} · FFmpeg Encoder ${previous.appVersion}${previous.runtimeVersion ? ` · ${previous.runtimeVersion}` : ''} · ${previous.createdAt}. ${previous.version === 4
            ? 'Recorded copied and omitted streams only. A remux copies coded media, so no encoder settings were recorded.'
            : previous.version === 2
            ? `Planned pipeline ${previous.pipelineId}. Recorded requested encoder settings only; no current device or effective-mode proof, source transform or complete previous invocation.`
            : 'Recorded encoder arguments are descriptive provenance, not a complete previous invocation.'}` : '';
        entry.previousArgs.textContent = previous && previous.version !== 4 ? formatArguments(previous.encoderArgs) : '';
        entry.previousArgs.hidden = !entry.previousArgs.textContent;
        entry.reencodeBox.hidden = !canAuthorize(item);
        entry.reencodeChoice.setAttribute('aria-label', `Choose ${item.name} for ${isRemux() ? 'Remux source' : 're-encoding'} authorization`);
        entry.reencodeChoice.parentElement.querySelector('span').textContent = isRemux() ? 'Choose as a Remux source' : 'Choose for re-encoding';
        entry.reencode.textContent = isRemux() ? 'Use this generated output as a Remux source' : 'Re-encode this output';
        entry.commandDetails.hidden = !['ready', 'conflict', 'pending', 'running', 'validating', 'success', 'failed', 'cancelled', 'unprocessed'].includes(item.status);
        if (entry.commandDetails.open && !entry.commandDetails.hidden) loadEncodingDetails(entry);
        const knownStatus = Object.hasOwn(statusLabels, item.status) ? item.status : 'pending';
        const savedWarning = item.outcome === 'saved-with-warning';
        const retained = ['retained-completed', 'publication-uncertain'].includes(item.outputDisposition?.kind);
        entry.status.className = `status status-${savedWarning || retained ? 'conflict' : knownStatus}`;
        entry.status.textContent = savedWarning ? 'Saved with warning' : retained ? 'Completed stage retained'
          : knownStatus === 'validating' ? jobStageLabels[jobStage] || statusLabels.validating : knownStatus === 'running' && isRemux() ? 'Remuxing' : statusLabels[knownStatus];
        entry.status.title = item.reason || entry.status.textContent;
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
    put('reencode-warning', isRemux() ? 'Choose exact generated outputs, then explicitly authorize them as sources for this prepared Remux batch. Remux copies qualified streams without a new lossy encoding generation.' : 'Re-encoding an already compressed video can introduce additional quality loss. Choose individual generated outputs below, then explicitly authorize them for this prepared batch.');
    put('generated-source-permission', isRemux()
      ? 'Filtering does not authorize files. Remux source permission applies only to unchanged files in this preparation.'
      : 'Filtering does not authorize files. Re-encoding permission applies only to unchanged files in this preparation.');
    put('reencode-selected', isRemux() ? 'Use chosen outputs as Remux sources' : 'Re-encode chosen outputs');
    syncSelection();
  }

  function renderTelemetry() {
    const preparing = snapshot.phase === 'preparing' || (snapshot.phase === 'cancelling' && snapshot.preparation);
    const preparation = snapshot.preparation || {};
    const progress = cancelPending || snapshot.phase === 'cancelling' ? {} : preparing ? { fileId: preparation.fileId, percent: preparation.total > 0 ? preparation.resolved / preparation.total * 100 : null } : snapshot.progress || {};
    const items = snapshot.items || [];
    const item = items.find(entry => entry.id === progress.fileId)
      || items.find(entry => ['running', 'validating'].includes(entry.status))
      || (snapshot.phase === 'preparing' ? items.find(entry => entry.status === 'pending') : null);
    put('current-file', item?.name || (snapshot.phase === 'checking' ? 'Testing available encoders…' : snapshot.phase === 'preparing' ? 'Inspecting input media…' : 'Waiting for the current operation to settle…'));
    put('monitor-count', item ? `File ${items.indexOf(item) + 1} of ${items.length}` : '');
    // Post-encode work is indeterminate. Never keep a stale encoding percent,
    // speed or ETA visible as though probing/publication were still an encode.
    const processing = cancelPending || snapshot.phase === 'cancelling' || (!preparing && processingStages.has(progress.stage));
    const hasPercent = !processing && finite(progress.percent);
    if (hasPercent) byId('encode-progress').value = Math.min(100, Math.max(0, progress.percent));
    else byId('encode-progress').removeAttribute('value');
    if (hasPercent) byId('active-job-progress').value = Math.min(100, Math.max(0, progress.percent));
    else byId('active-job-progress').removeAttribute('value');
    const activeStage = currentJobLabel();
    byId('active-job-summary').setAttribute('role', 'status');
    byId('active-job-summary').setAttribute('aria-live', 'polite');
    for (const progressId of ['encode-progress', 'active-job-progress']) {
      byId(progressId).setAttribute('aria-label', `${activeStage} progress`);
      byId(progressId).setAttribute('aria-valuetext', hasPercent ? `${Math.min(100, Math.max(0, progress.percent)).toFixed(1)}%` : `${activeStage}; progress is indeterminate`);
    }
    put('active-job-summary', [activeStage, item?.name, hasPercent ? `${Math.min(100, Math.max(0, progress.percent)).toFixed(1)}%` : '',
      preparing && preparation.total ? `${preparation.resolved} of ${preparation.total} files inspected · ${preparation.reused || 0} reused` : ''].filter(Boolean).join(' · '));
    put('percent', hasPercent ? `${Math.min(100, Math.max(0, progress.percent)).toFixed(1)}%` : processing ? 'Processing' : 'In progress');
    put('progress-label', snapshot.phase === 'preparing' ? 'Inspecting media' : snapshot.phase === 'checking' ? 'Checking encoders' : processing ? activeStage : isRemux() ? 'Remux progress' : 'Encoding progress');
    put('monitor-heading', preparing ? '03 / Inspecting recordings' : isRemux() ? '03 / Remux monitor' : '03 / Encoding monitor');
    visible('inspection-details', preparing);
    visible('encoding-telemetry', !preparing && !processing);
    put('progress-note', cancelPending || snapshot.phase === 'cancelling' ? 'Cancellation is awaiting process and cleanup settlement. No reliable progress or ETA is available.' : preparing ? 'Progress counts resolved files. Individual inspection times vary with the recording.'
      : processing ? `${jobStageLabels[progress.stage]}. The job remains active until protected checks, publication and cleanup settle. There is no reliable percentage or ETA for this stage.`
        : `A file is complete after the ${isRemux() ? 'remuxed' : 'encoded'} output has been verified and saved.`);
    const stages = { identity: 'Checking file identity', metadata: 'Reading duration, video properties and streams', frames: 'Checking sampled SDR/HDR metadata', reused: 'Reusing validated inspection' };
    put('inspection-stage', `${stages[preparation.stage] || 'Preparing inspection'}${preparation.window ? ` · ${preparation.window}` : ''}`);
    visible('inspection-notice', Boolean(preparation.notice));
    put('inspection-notice', preparation.notice || '');
    put('encoded-time', processing ? '—' : duration(progress.seconds));
    put('speed', !processing && finite(progress.speed) ? `${progress.speed.toFixed(2)}×` : '—');
    put('fps', !processing && finite(progress.fps) ? progress.fps.toFixed(1) : '—');
    put('output-size', processing ? '—' : bytes(progress.bytes));
    put('eta', processing ? '—' : duration(progress.etaSeconds));
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
    const checking = phase === 'checking' || phase === 'native-checking';
    const busy = isBusy();
    const terminal = terminalPhases.has(phase);
    const ready = phase === 'ready' && !dirty;
    const showResults = terminal;
    const error = uiError || (!editing ? snapshot.error : '') || '';
    visible('error-banner', Boolean(error)); put('error-banner', error);
    put('phase-badge', currentJobLabel());
    let activity = '';
    if (cancelPending) activity = 'Waiting for cancellation and cleanup to settle. Setup remains locked until the cancellation request finishes.';
    else if (phase === 'native-checking') activity = 'Checking the selected native backend. Cancellation remains available in Current Jobs.';
    else if (phase === 'checking') activity = 'Checking the bundled encoders on this computer. This can take a moment.';
    else if (phase === 'preparing') {
      const p = snapshot.preparation;
      activity = p ? `Checking ${p.total} recordings · ${p.resolved} resolved · ${p.reused} reused · ${p.active} inspecting` : 'Preparing inspection and checking output names…';
    }
    else if (phase === 'cancelling') activity = 'Waiting for the active process to exit and temporary files to be cleaned up.';
    else if (phase === 'running') activity = processingStages.has(snapshot.progress?.stage)
      ? `${currentJobLabel()}. The job is still active; cancellation and Jobs remain available.`
      : `${isRemux() ? 'Remuxing' : 'Encoding'} locally. Each completed output is verified before it is saved.`;
    else if (pendingCommands) activity = 'Working…';
    else if (ready) activity = `Review the effective settings and select the files to ${isRemux() ? 'remux' : 'encode'}.`;
    else if (dirty && editing && capabilities) activity = 'Choose your settings, then review the batch.';
    put('activity-message', developerPreview ? `${developerSessionClosed ? (ordinaryRecovery ? 'This session is closed. New ordinary session discards this batch and output access after cleanup; close and relaunch if cleanup fails.' : developerSessionChoices?.replaceClosed ? 'This session is closed. Choose an explicit session below after cleanup; no work is replayed.' : developerPreview.relaunchNotice) : developerPreview.notice} ${activity}` : activity);
    visible('diagnostic-warning', Boolean(snapshot.diagnosticWarning)); put('diagnostic-warning', snapshot.diagnosticWarning || '');
    visible('setup-panel', true);
    visible('location-panel', activeWorkspace === 'encode' || activeWorkspace === 'remux');
    // Move the existing rows instead of rendering a second queue. Expanded
    // details, ID-bound actions and focus stay attached to the same DOM nodes.
    const batchWorkspace = busy || terminal ? 'jobs' : currentOperation();
    const batchSlot = byId(`${batchWorkspace}-batch-slot`);
    if (byId('batch-panel').parentElement !== batchSlot) {
      const movingFocus = byId('batch-panel').contains(document.activeElement);
      batchSlot.append(byId('batch-panel'));
      // An event can arrive before the originating invoke returns. Do not leave
      // keyboard focus inside a newly hidden workspace while that call settles.
      if (movingFocus && activeWorkspace !== batchWorkspace) byId(`tab-${batchWorkspace}`).focus();
    }
    // The same inspector follows the existing queue panel into Current Jobs;
    // no cloned controls or second execution snapshot is introduced.
    const inspector = byId('file-inspector');
    if (inspector.parentElement !== batchSlot) {
      const movingFocus = inspector.contains(document.activeElement);
      batchSlot.append(inspector);
      if (movingFocus && activeWorkspace !== batchWorkspace) byId(`tab-${batchWorkspace}`).focus();
    }
    visible('batch-panel', (ready || busy || showResults) && (snapshot.items || []).length > 0);
    visible('monitor-panel', busy && !checking);
    visible('results-panel', showResults);
    visible('jobs-empty', (!busy && !terminal) || checking);
    put('jobs-empty-message', phase === 'native-checking' ? 'The selected native backend is being checked with generated data. File encoding remains unavailable for this backend.'
      : phase === 'checking' ? 'The bundled encoders are being checked. The current operation remains visible below.'
      : ready ? `This ${operationName()} batch is prepared but has not started. Review its files and start the selected items in ${operationName()}.` : 'No batch is running. Choose folders and prepare an Encode or Remux batch.');
    put('jobs-open-encode', `Go to ${operationName()}`);
    visible('preview-actions', ready);
    visible('cancel-bar', busy || cancelPending);
    put('cancel-explanation', checking ? 'Cancel this capability check.' : 'Cancellation stops this operation and the remaining queue.');
    byId('cancel-batch').disabled = !snapshot.batchId || cancelPending || phase === 'cancelling';
    put('cancel-batch', phase === 'cancelling' || cancelPending ? 'Cancelling…' : phase === 'preparing' ? 'Cancel inspection' : checking ? 'Cancel check' : 'Cancel batch');
    const locked = busy || cancelPending || pendingCommands > 0 || developerSessionClosed;
    if (developerSessionChoices) for (const {button, kind} of developerSessionChoices.buttons) button.disabled = busy || pendingCommands > 0 || cancelPending || developerSessionChoices.pending || (developerSessionChoices.selected === kind && !(developerSessionChoices.replaceClosed && developerSessionClosed));
    if (ordinaryRecovery) ordinaryRecovery.disabled = !developerSessionClosed || busy || pendingCommands > 0 || cancelPending || ordinaryRecovery.restarting === true;
    byId('native-settings-fields').disabled = Boolean(developerPreview) || locked || !nativeState || Boolean(nativeState.ownerBlock);
    byId('native-refresh').disabled = Boolean(developerPreview) || locked || typeof api?.refreshNativeBackends !== 'function' || Boolean(nativeState?.ownerBlock);
    const native = nativeProfile(), availability = nativeState?.native.profiles.find(profile => profile.profileId === native?.id);
    byId('native-qualify').disabled = Boolean(developerPreview) || locked || !native || !byId('native-device').value || native.backend === 'amf'
      || availability?.reason !== 'CHOOSE_AND_QUALIFY_CELL' || Boolean(nativeState?.ownerBlock);
    renderNativeStatus();
    for (const id of ['choose-input', 'choose-output']) byId(id).disabled = locked;
    byId('remux-target').disabled = locked;
    byId('prepare-remux').disabled = remuxPreviewBlocked() || locked || !remuxTargetAvailable() || !inputFolder?.id || !outputFolder?.id || inputFolder.available === false || outputFolder.available === false;
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
    put('choose-input', inputFolder ? 'Change input folder' : 'Choose input folder');
    put('choose-output', outputFolder ? 'Change output folder' : 'Choose output folder');
    put('output-path', outputFolder?.path || 'No folder selected');
    for (const [role, folder] of [['input', inputFolder], ['output', outputFolder]]) {
      const unavailable = Boolean(folder && (!folder.id || folder.available === false));
      visible(`${role}-unavailable`, unavailable);
      put(`${role}-unavailable`, unavailable ? `${folder.reason || 'Remembered folder is unavailable.'} Choose a folder to continue.` : '');
    }
    const profileUnavailable = Boolean(capabilities && !selectedProfile()?.available);
    visible('profile-unavailable', profileUnavailable);
    put('profile-unavailable', profileUnavailable ? profiles().length
      ? `Selected profile is unavailable: ${selectedProfile()?.reason || 'This profile cannot initialize on this computer.'} Choose an available profile to review an Encode batch.`
      : 'No encoding profile is available. See encoder availability for the reported reasons. Remux preparation checks its own qualification.' : '');
    renderPreferencesNotice();
    const settingsSummary = isRemux() ? `Full stream copy · ${preparedRemuxTarget() || 'target pending inspection'} · No transcoding` : describeSettings(snapshot.settings);
    put('effective-settings', settingsSummary ? `Effective settings: ${settingsSummary}` : '');
    put('monitor-settings', settingsSummary);
    const hasEligible = (snapshot.items || []).some(item => selectableStatuses.has(item.status));
    put('preview-message', ready && !hasEligible
      ? `Nothing to ${isRemux() ? 'remux' : 'encode'} in this batch. Review the skipped or unsupported reasons below, or change your folders and settings.`
      : showResults ? 'Completed batch. Each file result and any skipped or unsupported reason is shown below.'
        : `Select files to ${isRemux() ? 'remux' : 'encode'}. Existing outputs stay unchanged. For conflicting output names, select one input per destination.`);
    renderItems(); renderTelemetry();
    // A focused details body may live in the inspector, outside the table.
    // Lock identity-bound actions by their retained references, never subtree.
    for (const entry of itemRows.values()) {
      entry.action.disabled = locked || !ready;
      entry.reencode.disabled = locked || !ready || remuxTargetChanged();
    }
    const recovery = snapshot.provenanceRecovery;
    if (byId('provenance-notice')) {
      const show = recovery && (recovery.matching || recovery.absent || recovery.unrelated || recovery.uncertain || recovery.warnings?.length);
      visible('provenance-notice', Boolean(show));
      put('provenance-notice', show ? `Previous output bookkeeping: ${recovery.matching} matching · ${recovery.absent} absent · ${recovery.unrelated} unrelated · ${recovery.uncertain} uncertain. No files were changed.${recovery.warnings?.length ? ' ' + recovery.warnings[0] : ''}` : '');
    }
    // Main already freezes whole-operation wall time at settlement. Do not
    // extrapolate terminal results or substitute the last file's media time/ETA.
    put('result-elapsed', showResults && finite(snapshot.elapsedSeconds) && snapshot.elapsedSeconds >= 0 ? duration(snapshot.elapsedSeconds) : '—');
    put('result-elapsed-label', phase === 'completed' ? 'Batch elapsed' : 'Operation elapsed');
    put('result-elapsed-note', cancelPending ? 'The terminal snapshot is retained while cancellation and cleanup settlement are still being awaited.' : cancelSettlementFailure ? 'The cancellation request failed to confirm settlement. Cleanup completion is unverified; the retained terminal time is not proof of cleanup success.' : showResults ? (phase === 'completed'
      ? 'Wall-clock time from Start through all selected files, validation and cleanup. Excludes batch preparation; not encode-only time.'
      : 'Wall-clock time until this operation stopped and cleanup finished. May include preparation if stopped before Start; not encode-only time.') : '');
    if (showResults) {
      for (const key of ['success', 'failed', 'skipped', 'cancelled', 'unprocessed']) put(`count-${key}`, snapshot.counts?.[key] || 0);
      put('result-phase', phaseLabels[phase]);
      put('result-message', phase === 'completed' ? 'The batch has finished. Review individual results above; skipped and unsupported files are listed with their reasons.' : phase === 'cancelled' ? 'The operation was cancelled. Completed outputs are preserved. Remaining files were not processed.' : snapshot.error || 'The batch stopped. Review the file results before preparing a new batch.');
    }
  }

  const workspaceTabList = byId('workspace-tabs');
  workspaceTabList.addEventListener('focusout', event => {
    // Keep the roving focus stop during manual navigation. On exit, only the
    // selected tab should be reachable when tabbing back from either side.
    if (!workspaceTabList.contains(event.relatedTarget)) setWorkspaceTabStop(activeWorkspace);
  });
  for (const [index, name] of workspaceNames.entries()) {
    const tab = byId(`tab-${name}`);
    tab.addEventListener('click', () => activateWorkspace(name));
    tab.addEventListener('keydown', event => {
      const positions = { ArrowRight: (index + 1) % workspaceNames.length, ArrowLeft: (index + workspaceNames.length - 1) % workspaceNames.length,
        Home: 0, End: workspaceNames.length - 1 };
      if (Object.hasOwn(positions, event.key)) {
        event.preventDefault();
        workspaceNavigationRevision++;
        const next = workspaceNames[positions[event.key]];
        setWorkspaceTabStop(next);
        byId(`tab-${next}`).focus();
      } else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activateWorkspace(name); }
    });
  }
  for (const name of ['encode', 'remux']) filesDrawerTrigger(name).addEventListener('click', () => {
    if (activeWorkspace === name && editorOwnsFileList(name)) setFilesDrawer(!filesDrawerExpanded());
  });
  byId('focused-file-clear').addEventListener('click', () => {
    const previous = itemRows.get(focusedFileId); focusedFileId = null; renderFocusedFile();
    const rowVisible = previous && !previous.row.hidden && !previewCollapsed
      && (typeof previous.inspect.getClientRects !== 'function' || previous.inspect.getClientRects().length > 0);
    if (rowVisible) previous.inspect.focus();
    else byId('focused-file-name').focus();
  });
  byId('review-selected').addEventListener('click', () => {
    const review = byId('selected-review'); review.open = !review.open;
    syncReviewDisclosure();
    if (review.open) review.querySelector('summary').focus();
  });
  function syncReviewDisclosure() {
    byId('review-selected').setAttribute('aria-expanded', String(byId('selected-review').open));
  }
  byId('selected-review').addEventListener('toggle', syncReviewDisclosure);
  for (const name of ['encode', 'remux']) byId(`workspace-${name}`).addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeWorkspace === name && editorOwnsFileList(name) && filesDrawerExpanded() && !activeHelp) {
      event.preventDefault(); setFilesDrawer(false, true);
    }
  });
  byId('view-jobs').addEventListener('click', () => activateWorkspace('jobs', true));
  byId('jobs-open-encode').addEventListener('click', () => activateWorkspace(currentOperation(), true));
  byId('app-settings-reload').addEventListener('click', () => { void loadAppDefaults(); });
  byId('app-settings-form').addEventListener('submit', event => { event.preventDefault(); void saveAppDefaults(); });
  byId('app-settings-reset').addEventListener('click', () => { void saveAppDefaults(true); });
  for (const [field, id] of Object.entries(batchOperationFields)) byId(id).addEventListener('change', () => {
    if (!editableOperationDraft()) return;
    batchOperationEdits.add(field); put('batch-operation-notice', ''); syncSelection();
  });
  byId('batch-operation-discard').addEventListener('click', () => {
    if (!discardableOperationDraft()) return;
    batchOperationKey = null; renderBatchOperations(); put('batch-operation-notice', ''); syncSelection();
  });
  byId('batch-operation-form').addEventListener('submit', event => {
    event.preventDefault();
    if (!editableOperationDraft() || !batchOperationEdits.size) return;
    if ([...itemRows.values()].some(entry => entry.operationEdits.size)) {
      put('batch-operation-notice', 'Apply or discard file edits before changing batch defaults. The unsubmitted file edits remain intact.'); return;
    }
    const request = operationRequest(), defaults = snapshot.operationDraft.batchDefaults;
    // Main's batch setter replaces the complete override snapshot. Reconstruct
    // only existing batch-origin values, then patch changed visible fields; do
    // not accidentally convert inherited app defaults into permanent overrides.
    const overrides = Object.fromEntries(Object.keys(defaults.values).filter(key => defaults.origins[key] === 'batch').map(key => [key, defaults.values[key]]));
    for (const field of batchOperationEdits) overrides[field] = byId(batchOperationFields[field]).value;
    void command(async () => {
      const next = await api.updateBatchOperationDefaults({ ...request, overrides }); applySnapshot(next);
      put('batch-operation-notice', next.phase === 'ready' ? 'Batch defaults applied. Review the newly prepared statuses; qualification refusals remain blocked.'
        : 'Repreparation did not finish ready. Review the current batch error before proceeding.');
    });
  });
  byId('batch-app-defaults-apply').addEventListener('click', () => {
    if (!editableOperationDraft() || hasOperationEdits()) return;
    const choice = byId('batch-app-defaults-choice').value;
    if (!['keep', 'reset'].includes(choice)) { setError(new Error('Choose whether to keep or reset file overrides.')); return; }
    const request = { ...operationRequest(), resetFileOverrides: choice === 'reset' };
    void command(async () => {
      const next = await api.applyAppDefaultsToBatch(request); applySnapshot(next);
      put('batch-operation-notice', next.phase !== 'ready' ? 'Repreparation did not finish ready. Review the current batch error before proceeding.'
        : choice === 'reset' ? 'Saved App Settings applied; file overrides and ranges were reset. Review all statuses.' : 'Saved App Settings applied; existing file overrides and ranges were kept. Review all statuses.');
    });
  });
  for (const id of Object.values(defaultFields)) byId(id).addEventListener('change', () => { defaultsDirty = true; renderDefaultActions(); });
  byId('runtime-refresh').addEventListener('click', () => { void loadRuntimeInformation(); });
  byId('history-refresh').addEventListener('click', () => { void loadHistoryPage(true); });
  byId('history-more').addEventListener('click', () => {
    if (!historyNextCursor || historyLoading) return;
    historyCursors[historyPage + 1] = historyNextCursor;
    void loadHistoryPage(false, historyPage + 1);
  });
  byId('history-newer').addEventListener('click', () => { if (historyPage > 0) void loadHistoryPage(false, historyPage - 1); });
  byId('history-clear-selection').addEventListener('click', () => {
    historySelection.clear(); invalidateHistoryExport(); syncHistorySelection();
  });
  byId('history-export').addEventListener('click', () => { void previewHistoryExport(); });
  byId('history-select-export').addEventListener('click', () => { byId('history-export-text').focus(); byId('history-export-text').select(); });

  byId('profile').addEventListener('change', () => {
    drainPendingSave(); populateProfileSettings(); invalidatePreview(true); rememberCurrentSettings();
  });
  byId('preset').addEventListener('change', () => { invalidatePreview(true); rememberCurrentSettings(); refreshRecipe(); });
  byId('quality').addEventListener('input', () => {
    const value = byId('quality').valueAsNumber;
    if (finite(value)) byId('quality-slider').value = value;
    put('quality-value', finite(value) ? value : '—'); invalidatePreview(true); rememberCurrentSettings(true); refreshRecipe();
  });
  byId('quality-slider').addEventListener('input', () => {
    byId('quality').value = byId('quality-slider').value;
    put('quality-value', byId('quality').value); invalidatePreview(true); rememberCurrentSettings(true); refreshRecipe();
  });
  for (const id of ['quality', 'quality-slider']) byId(id).addEventListener('change', () => rememberCurrentSettings());
  byId('tested-default').addEventListener('click', () => command(async () => {
    await flushSettings();
    const result = await api.resetProfile({ profileId: byId('profile').value });
    applyPreferences(result, selectedProfile()?.candidateFixedSettings === true ? 'Fixed candidate settings restored.' : selectedVendorProfile()
      ? 'Untested starting values applied to the current profile. You can edit these values.'
      : 'Tested Default applied to the current profile. You can edit these values.');
    invalidatePreview(true);
  }));
  byId('archive-quality').addEventListener('click', () => command(async () => {
    const recipe = profileRecipe();
    if (!recipe?.available || !selectedProfile()?.available) throw new Error(recipe?.reason || 'Archive Quality is unavailable on this computer.');
    await flushSettings();
    selectedRecipeId = recipe.id;
    byId('preset').value = recipe.preset;
    for (const id of ['quality', 'quality-slider']) byId(id).value = recipe.quality;
    put('quality-value', recipe.quality);
    invalidatePreview(true); rememberCurrentSettings(); refreshRecipe();
    // The helper exposes its complete production contribution immediately;
    // native preset/quality controls remain available for deliberate changes.
    byId('current-recipe').open = true;
    await flushSettings();
  }));
  byId('clear-recipe').addEventListener('click', () => command(async () => {
    await flushSettings();
    selectedRecipeId = null;
    invalidatePreview(true); rememberCurrentSettings(); refreshRecipe();
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
    if (hasOperationEdits()) throw new Error('Apply or discard processing edits before choosing another source folder.');
    await settleWorkspaceSettings();
    const selected = await api.chooseInputFolder();
    if (selected) { inputFolder = selected; invalidatePreview(); }
  }));
  byId('choose-output').addEventListener('click', () => command(async () => {
    if (hasOperationEdits()) throw new Error('Apply or discard processing edits before choosing another output folder.');
    await settleWorkspaceSettings();
    const selected = await api.chooseOutputFolder();
    if (selected) { outputFolder = selected; invalidatePreview(); }
  }));
  byId('prepare-batch').addEventListener('click', () => command(async () => {
    if (!settingsValid() || !inputFolder?.id || !outputFolder?.id || inputFolder.available === false || outputFolder.available === false) throw new Error('Choose both folders and valid encoding settings.');
    if (hasOperationEdits()) throw new Error('Apply or discard pending processing edits before preparing encoder settings.');
    rememberCurrentSettings();
    await flushSettings();
    const draft = snapshot.operationDraft;
    const keepDraft = snapshot.phase === 'ready' && draft?.operation === 'encode' && !draft.frozen
      && preparedFolderPair?.draftId === draft.id && preparedFolderPair.inputFolderId === inputFolder.id
      && preparedFolderPair.outputFolderId === outputFolder.id;
    const next = keepDraft
      ? await api.reprepareEncodingSettings({ planId: snapshot.planId, draftId: draft.id, revision: draft.revision, settings: currentSettings() })
      : await api.prepareBatch({ inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, settings: currentSettings() });
    if (!keepDraft) preparedFolderPair = next?.phase === 'ready' && next.operationDraft?.id
      ? { inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, draftId: next.operationDraft.id } : null;
    applySnapshot(next);
    if (snapshot.phase === 'ready') byId('batch-heading').scrollIntoView({ block: 'start' });
  }));
  byId('remux-target').addEventListener('change', () => { remuxTargetChosen = true; render(); });
  byId('prepare-remux').addEventListener('click', () => command(async () => {
    if (!inputFolder?.id || !outputFolder?.id || inputFolder.available === false || outputFolder.available === false) throw new Error('Choose both folders before preparing Remux.');
    if (hasOperationEdits()) throw new Error('Apply or discard processing edits before preparing a new Remux batch.');
    const target = byId('remux-target').value;
    if (remuxPreviewBlocked() || !remuxTargetAvailable(target)) throw new Error('Choose a currently available Remux target.');
    drainPendingSave(); await saveChain;
    if (remuxPreviewBlocked() || !remuxTargetAvailable(target) || byId('remux-target').value !== target) throw new Error('Remux target availability or selection changed. Review it before preparing.');
    const next = await api.prepareRemuxBatch({ inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, target });
    preparedFolderPair = next?.phase === 'ready' && next.operationDraft?.id
      ? { inputFolderId: inputFolder.id, outputFolderId: outputFolder.id, draftId: next.operationDraft.id } : null;
    applySnapshot(next);
    if (snapshot.phase === 'ready') byId('batch-heading').scrollIntoView({ block: 'start' });
  }));
  byId('start-batch').addEventListener('click', () => command(async () => {
    if (dirty || !selectedIds.size || hasOperationEdits() || remuxTargetChanged()) throw new Error('Review the batch, prepare the current target, apply or discard processing edits, and select at least one ready file.');
    applySnapshot(await api.startBatch({ planId: snapshot.planId, fileIds: [...selectedIds] }));
    activateWorkspace('jobs');
    byId('monitor-heading').scrollIntoView({ block: 'start' });
  }));
  byId('select-ready').addEventListener('click', () => {
    selectedIds = new Set((snapshot.items || []).filter(item => item.status === 'ready').map(item => item.id)); syncSelection();
  });
  byId('clear-selection').addEventListener('click', () => { selectedIds.clear(); syncSelection(); });
  byId('cancel-batch').addEventListener('click', async () => {
    if (!snapshot.batchId || cancelPending) return;
    cancelPending = true; uiError = ''; render();
    try { const next = await api.cancelBatch({ batchId: snapshot.batchId }); cancelSettlementFailure = null; applySnapshot(next); }
    catch (error) { cancelSettlementFailure = { batchId: snapshot.batchId, planId: snapshot.planId }; setError(error); }
    finally { cancelPending = false; render(); }
  });
  byId('new-batch').addEventListener('click', () => {
    if (isBusy() || cancelPending) return;
    preparedFolderPair = null;
    editing = true; dirty = true; selectedIds.clear(); reencodeChoices.clear(); uiError = ''; render();
    activateWorkspace(currentOperation(), true);
    if (!capabilities) command(loadCapabilities);
    byId(isRemux() ? 'remux-heading' : 'setup-heading').scrollIntoView({ block: 'start' });
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
  byId('native-settings-details').addEventListener('toggle', () => {
    if (byId('native-settings-details').open) void command(loadNativeState);
  });
  byId('native-profile').addEventListener('change', nativeProfileChanged);
  byId('native-mode').addEventListener('change', () => { nativeQualityChanged(); render(); });
  byId('native-device').addEventListener('change', render);
  byId('native-settings-fields').addEventListener('input', render);
  byId('native-settings-fields').addEventListener('change', render);
  byId('native-refresh').addEventListener('click', () => command(async () => showNativeState(await api.refreshNativeBackends())));
  byId('native-qualify').addEventListener('click', () => command(checkNativeSettings));
  window.addEventListener('beforeunload', () => { drainPendingSave(); clearInterval(elapsedTimer); clearTimeout(recipeTimer); unsubscribe?.(); }, { once: true });
  if (!api) {
    setError(new Error('The application bridge is unavailable. Close and reopen FFmpeg Encoder.'));
    put('activity-message', 'Unable to connect to the application.');
    return;
  }
  unsubscribe = api.onUpdate(applySnapshot);
  void loadAppearance();
  command(async () => {
    applySnapshot(await api.getSnapshot());
    await loadCapabilities();
    applyPreferences(await api.getPreferences());
  });
  // Absent on ordinary/default and Windows main: no visible controls without opt-in.
  if (typeof api.getWorkbenchSession === 'function') void api.getWorkbenchSession().then(state => {
    if (!state?.enabled) return;
    if (state.recoveryOnly === true) {
      const group = document.createElement('section');
      const notice = document.createElement('p'); notice.textContent = 'New ordinary session discards this batch and completed-output access. No work is replayed.';
      const button = document.createElement('button'); button.textContent = 'New ordinary session'; button.disabled = true;
      ordinaryRecovery = button;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        button.disabled = true; button.restarting = true;
        try { await api.selectWorkbenchSession('restart-ordinary'); }
        catch (error) { notice.textContent = `${error.message} Close and relaunch if cleanup cannot complete.`; button.restarting = false; }
      });
      group.appendChild(notice); group.appendChild(button); document.body.appendChild(group);
      render(); return;
    }
    const group = document.createElement('section');
    const notice = document.createElement('p'); notice.textContent = state.notice; group.appendChild(notice);
    const buttons = [];
    developerSessionChoices = { buttons, selected: state.selected, replaceClosed: state.replaceClosed === true, pending: false };
    for (const [kind, label] of [['ordinary', 'Ordinary encoding'], ['full-copy', 'Experimental whole-file 720p / copied AAC'], ...(state.resizeRangeAvailable === true ? [['resize-range', 'Experimental precise 720p range / FLAC']] : []), ...(state.resizeRange1440Available === true ? [['resize-range1440', 'Experimental precise 1440p to 720p range / FLAC']] : [])]) {
      const button = document.createElement('button'); button.textContent = label; button.disabled = state.selected === kind;
      button.addEventListener('click', async () => {
        if (button.disabled) return;
        developerSessionChoices.pending = true; render();
        try { await api.selectWorkbenchSession(kind); }
        catch (error) {
          notice.textContent = error.message;
          developerSessionChoices.pending = false;
          // Acquisition may have retired the old owner. Read its actual status; never silently fall back.
          try { const current = await api.getWorkbenchSession(); developerSessionChoices.selected = current.selected; } catch {}
          render();
        }
      });
      buttons.push({button, kind}); group.appendChild(button);
    }
    document.body.appendChild(group); render();
  }).catch(() => {});
})();
