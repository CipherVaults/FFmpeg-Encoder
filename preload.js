const { contextBridge, ipcRenderer } = require('electron');
async function invoke(channel, ...args) {
  const response = await ipcRenderer.invoke(channel, ...args);
  if (!response?.ok) {
    const error = new Error(response?.error?.message || 'The application request failed.');
    error.code = response?.error?.code || 'OPERATION_FAILED';
    throw error;
  }
  return response.value;
}
// Expose named capabilities only. Callbacks never receive Electron event objects.
contextBridge.exposeInMainWorld('encoder', Object.freeze({
  getCapabilities: () => invoke('encoder:capabilities'),
  getPreferences: () => invoke('encoder:preferences'),
  getAppSettings: () => invoke('encoder:app-settings'),
  saveAppSettings: request => invoke('encoder:save-app-settings', request),
  resetAppSettings: request => invoke('encoder:reset-app-settings', request),
  getRuntimeInformation: () => invoke('encoder:runtime-information'),
  openCompletedOutput: request => invoke('encoder:open-completed-output', request),
  saveSettings: request => invoke('encoder:save-settings', request),
  resetProfile: request => invoke('encoder:reset-profile', request),
  forgetPreferences: () => invoke('encoder:forget-preferences'),
  clearInspectionCache: () => invoke('encoder:clear-inspection-cache'),
  getRecipe: request => invoke('encoder:recipe', request),
  getEncodingDetails: request => invoke('encoder:encoding-details', request),
  chooseInputFolder: () => invoke('encoder:input-folder'),
  chooseOutputFolder: () => invoke('encoder:output-folder'),
  prepareBatch: request => invoke('encoder:prepare', request),
  prepareRemuxBatch: request => invoke('encoder:prepare-remux', request),
  setRemuxOmissions: request => invoke('encoder:remux-omissions', request),
  updateFileOperations: request => invoke('encoder:update-file-operations', request),
  updateBatchOperationDefaults: request => invoke('encoder:update-batch-operation-defaults', request),
  applyAppDefaultsToBatch: request => invoke('encoder:apply-app-defaults-to-batch', request),
  reprepareEncodingSettings: request => invoke('encoder:reprepare-encoding-settings', request),
  treatAsOriginal: request => invoke('encoder:treat-original', request),
  reencodeOutputs: request => invoke('encoder:reencode-outputs', request),
  startBatch: request => invoke('encoder:start', request),
  cancelBatch: request => invoke('encoder:cancel', request),
  getSnapshot: () => invoke('encoder:snapshot'),
  getDiagnosticHistory: request => invoke('encoder:diagnostic-history', request),
  getDiagnosticRecord: request => invoke('encoder:diagnostic-record', request),
  getDiagnosticExportPreview: request => invoke('encoder:diagnostic-export-preview', request),
  onUpdate: callback => {
    if (typeof callback !== 'function') throw new TypeError('An update callback is required.');
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('encoder:update', listener);
    return () => ipcRenderer.removeListener('encoder:update', listener);
  },
}));
