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
  chooseInputFolder: () => invoke('encoder:input-folder'),
  chooseOutputFolder: () => invoke('encoder:output-folder'),
  prepareBatch: request => invoke('encoder:prepare', request),
  treatAsOriginal: request => invoke('encoder:treat-original', request),
  startBatch: request => invoke('encoder:start', request),
  cancelBatch: request => invoke('encoder:cancel', request),
  getSnapshot: () => invoke('encoder:snapshot'),
  onUpdate: callback => {
    if (typeof callback !== 'function') throw new TypeError('An update callback is required.');
    const listener = (_event, snapshot) => callback(snapshot);
    ipcRenderer.on('encoder:update', listener);
    return () => ipcRenderer.removeListener('encoder:update', listener);
  },
}));
