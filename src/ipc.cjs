// Each channel has one purpose. Both WebContents and its top-level frame must
// match; a compromised subframe must not inherit the application's privileges.
function registerIpc({ ipcMain, window, service, appearance, dialog, entryUrl, workbenchSession }) {
  let pickingFolder = false, inFlight = 0, registered = true;
  const choose = role => async () => {
    service.requireIdle();
    if (pickingFolder) throw Object.assign(new Error('A folder picker is already open.'), { code: 'BUSY' });
    pickingFolder = true;
    // Fixed enums only: never persist dialog paths, folder tokens or raw errors.
    const record = async (reason, outcome) => {
      try { await service.recordIncident?.({ stage: 'admission', reason,
        context: { action: role === 'input' ? 'choose-input-folder' : 'choose-output-folder', outcome } }); }
      catch { /* Diagnostics must not change the picker business result. */ }
    };
    let step = 'admission';
    try {
      await record('FOLDER_PICKER_REQUESTED', 'requested');
      // Logging awaits must not open a dialog after admission closes.
      service.requireIdle();
      if (window.isDestroyed()) throw Object.assign(new Error('The application window is closed.'), { code: 'SHUTTING_DOWN' });
      step = 'dialog';
      const selection = await dialog.showOpenDialog(window, { title: role === 'input' ? 'Select input video folder' : 'Select output folder', properties: ['openDirectory'] });
      if (selection?.canceled === true) { await record('FOLDER_PICKER_CANCELLED', 'cancelled'); return null; }
      if (selection?.canceled !== false || !Array.isArray(selection.filePaths)
          || selection.filePaths.length !== 1 || typeof selection.filePaths[0] !== 'string' || !selection.filePaths[0].trim()) {
        step = 'invalid';
        await record('FOLDER_PICKER_INVALID_SELECTION', 'invalid-selection');
        throw Object.assign(new Error('Choose exactly one folder.'), { code: 'INVALID_FOLDER_SELECTION' });
      }
      step = 'registration';
      const registered = await service.registerFolder(selection.filePaths[0], role);
      await record('FOLDER_PICKER_REGISTERED', 'registered');
      return registered;
    } catch (error) {
      if (step !== 'invalid') await record('FOLDER_PICKER_REJECTED', step === 'admission' ? 'admission-rejected' : step === 'dialog' ? 'dialog-rejected' : 'registration-rejected');
      throw error;
    } finally { pickingFolder = false; }
  };
  const methods = {
    'encoder:capabilities': [0, () => service.getCapabilities()],
    'encoder:native-state': [0, () => service.getNativeBackendState()],
    'encoder:native-refresh': [0, () => service.refreshNativeBackends()],
    'encoder:native-select': [1, request => service.selectNativeBackend(request)],
    'encoder:native-qualify': [1, request => service.qualifyNativeBackend(request)],
    'encoder:preferences': [0, () => service.getPreferences()],
    'encoder:appearance': [0, () => appearance.load()],
    'encoder:save-appearance': [1, payload => appearance.set(payload)],
    'encoder:app-settings': [0, () => service.getAppSettings()],
    'encoder:save-app-settings': [1, payload => service.saveAppSettings(payload)],
    'encoder:reset-app-settings': [1, payload => service.resetAppSettings(payload)],
    'encoder:runtime-information': [0, () => service.getRuntimeInformation()],
    'encoder:open-completed-output': [1, payload => service.openCompletedOutput(payload)],
    'encoder:save-settings': [1, payload => service.saveSettings(payload)],
    'encoder:reset-profile': [1, payload => service.resetProfile(payload)],
    'encoder:forget-preferences': [0, () => service.forgetPreferences()],
    'encoder:clear-inspection-cache': [0, () => service.clearInspectionCache()],
    'encoder:recipe': [1, payload => service.getRecipe(payload)],
    'encoder:encoding-details': [1, payload => service.getEncodingDetails(payload)],
    'encoder:input-folder': [0, choose('input')],
    'encoder:output-folder': [0, choose('output')],
    'encoder:prepare': [1, payload => service.prepareBatch(payload)],
    'encoder:prepare-remux': [1, payload => service.prepareRemuxBatch(payload)],
    'encoder:remux-omissions': [1, payload => service.setRemuxOmissions(payload)],
    'encoder:encode-preservation-decisions': [1, payload => service.setEncodePreservationDecisions(payload)],
    'encoder:update-file-operations': [1, payload => service.updateFileOperations(payload)],
    'encoder:update-batch-operation-defaults': [1, payload => service.updateBatchOperationDefaults(payload)],
    'encoder:apply-app-defaults-to-batch': [1, payload => service.applyAppDefaultsToBatch(payload)],
    'encoder:reprepare-encoding-settings': [1, payload => service.reprepareEncodingSettings(payload)],
    'encoder:treat-original': [1, payload => service.treatAsOriginal(payload)],
    'encoder:reencode-outputs': [1, payload => service.reencodeOutputs(payload)],
    'encoder:start': [1, payload => service.startBatch(payload)],
    'encoder:cancel': [1, payload => service.cancelBatch(payload)],
    'encoder:snapshot': [0, () => service.snapshot()],
    'encoder:diagnostic-history': [1, request => service.getDiagnosticHistory(request)],
    'encoder:diagnostic-record': [1, request => service.getDiagnosticRecord(request)],
    'encoder:diagnostic-export-preview': [1, request => service.getDiagnosticExport(request)],
  };
  if (workbenchSession) {
    methods['encoder:workbench-session'] = [0, () => workbenchSession.status()];
    methods['encoder:select-workbench-session'] = [1, kind => {
      if (inFlight > 1 || pickingFolder) throw Object.assign(new Error('Wait for active requests.'), { code: 'BUSY' });
      return workbenchSession.select(kind);
    }];
  }
  for (const [channel, [argumentCount, method]] of Object.entries(methods)) {
    ipcMain.handle(channel, async (event, ...args) => {
      let counted = false;
      try {
        if (!registered) throw Object.assign(new Error('This session has been retired.'), { code: 'SESSION_RETIRED' });
        if (window.isDestroyed() || event.sender !== window.webContents
            || event.senderFrame !== window.webContents.mainFrame || event.senderFrame?.url !== entryUrl) {
          throw Object.assign(new Error('Request is not from the application window.'), { code: 'UNTRUSTED_SENDER' });
        }
        // Count trusted admission, including rejection diagnostics, before any await.
        inFlight++; counted = true;
        if (args.length !== argumentCount) throw Object.assign(new Error('Unexpected request arguments.'), { code: 'INVALID_REQUEST' });
        if (workbenchSession?.blocked() && channel !== 'encoder:workbench-session')
          throw Object.assign(new Error('Session ownership is changing.'), { code: 'BUSY' });
        return { ok: true, value: await method(...args) };
      } catch (error) {
        // Only trusted-window requests may produce admission diagnostics. Never
        // persist an attacker's raw IPC payload or give it filesystem authority.
        if (counted && registered && !workbenchSession?.blocked() && service.admissionClosed !== true
            && channel !== 'encoder:select-workbench-session' && error.code !== 'UNTRUSTED_SENDER'
            && typeof service.recordIncident === 'function') {
          await service.recordIncident({ stage: 'admission', reason: 'REQUEST_REJECTED', severity: 'warning', message: error.message,
            context: { channel, code: error.code || 'OPERATION_FAILED' } });
        }
        // Explicit envelopes retain error codes without exposing native objects.
        return { ok: false, error: { code: error.code || 'OPERATION_FAILED', message: error.message || 'Operation failed.' } };
      } finally { if (counted) inFlight--; }
    });
  }
  return () => { registered = false; for (const channel of Object.keys(methods)) ipcMain.removeHandler(channel); };
}
module.exports = { registerIpc };
